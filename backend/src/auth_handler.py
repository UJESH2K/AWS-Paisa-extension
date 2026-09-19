"""Passwordless email login without Cognito.

The first sign-in subscribes the address to the user's own SNS topic; clicking
SNS's confirmation link proves the user owns the inbox. After that, a sign-in
sends a 6-digit code to that inbox and /auth/verify exchanges it for a token.
"""
import hmac
import re
import secrets
import uuid

from botocore.exceptions import ClientError

import notify
from common import HttpError, get_user, now_epoch, sha, to_ddb, users_table

EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,255}\.[^@\s]{2,}$")
CODE_TTL = 10 * 60
MAX_ATTEMPTS = 5
TOKEN_TTL = 30 * 24 * 3600
START_COOLDOWN = 60


def normalize_email(email):
    email = (email or "").strip().lower()
    if len(email) > 254 or not EMAIL_RE.match(email):
        raise HttpError(400, "Enter a valid email address.")
    return email


def _throttle(key, seconds, now):
    try:
        users_table().put_item(
            Item={"pk": key, "ttl": now + seconds},
            ConditionExpression="attribute_not_exists(pk) OR #t < :now",
            ExpressionAttributeNames={"#t": "ttl"},
            ExpressionAttributeValues={":now": now},
        )
    except ClientError as e:
        if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
            raise HttpError(429, "Please wait a minute before asking for another code.") from e
        raise


def start(email, now=None):
    now = now or now_epoch()
    email = normalize_email(email)
    h = sha(email)
    _throttle(f"thr#{h}", START_COOLDOWN, now)

    mapping = users_table().get_item(Key={"pk": f"email#{h}"}).get("Item")
    if not mapping:
        user_id = uuid.uuid4().hex
        topic_arn = notify.create_topic(user_id)
        notify.subscribe_email(topic_arn, email)
        users_table().put_item(
            Item=to_ddb(
                {
                    "pk": f"user#{user_id}",
                    "email": email,
                    "topicArn": topic_arn,
                    "externalId": secrets.token_hex(16),
                    "settings": {},
                    "createdAt": now,
                }
            )
        )
        users_table().put_item(Item={"pk": f"email#{h}", "userId": user_id})
        return {"status": "confirm_subscription"}

    user = get_user(mapping["userId"])
    if not notify.is_confirmed(user["topicArn"], email):
        notify.subscribe_email(user["topicArn"], email)  # re-sends the confirmation
        return {"status": "confirm_subscription"}

    code = f"{secrets.randbelow(10**6):06d}"
    users_table().put_item(
        Item={
            "pk": f"code#{user['pk'].split('#', 1)[1]}",
            "codeHash": sha(code + user["pk"]),
            "expires": now + CODE_TTL,
            "attempts": 0,
            "ttl": now + CODE_TTL * 2,
        }
    )
    notify.publish(
        user["topicArn"],
        "Your Paisa sign-in code",
        f"Your Paisa sign-in code is {code}.\n\nIt expires in 10 minutes. If you didn't ask for it, ignore this email.",
    )
    return {"status": "code_sent"}


def verify(email, code, now=None):
    now = now or now_epoch()
    email = normalize_email(email)
    bad = HttpError(401, "That code is wrong or has expired. Ask for a new one.")
    mapping = users_table().get_item(Key={"pk": f"email#{sha(email)}"}).get("Item")
    if not mapping:
        raise bad
    user_id = mapping["userId"]
    code_key = {"pk": f"code#{user_id}"}
    item = users_table().get_item(Key=code_key).get("Item")
    code = (code or "").strip()
    if not item or int(item["expires"]) < now or int(item["attempts"]) >= MAX_ATTEMPTS:
        raise bad
    users_table().update_item(Key=code_key, UpdateExpression="ADD attempts :one", ExpressionAttributeValues={":one": 1})
    if not hmac.compare_digest(item["codeHash"], sha(code + f"user#{user_id}")):
        raise bad
    users_table().delete_item(Key=code_key)
    token = secrets.token_urlsafe(32)
    users_table().put_item(Item={"pk": f"tok#{sha(token)}", "userId": user_id, "ttl": now + TOKEN_TTL})
    return {"token": token, "email": email}


def authenticate(headers, now=None):
    now = now or now_epoch()
    auth = (headers or {}).get("authorization", "")
    if not auth.lower().startswith("bearer "):
        raise HttpError(401, "Sign in to continue.")
    token = auth[7:].strip()
    item = users_table().get_item(Key={"pk": f"tok#{sha(token)}"}).get("Item")
    if not item or int(item["ttl"]) < now:
        raise HttpError(401, "Your session has expired. Sign in again.")
    user = get_user(item["userId"])
    if not user:
        raise HttpError(401, "Sign in to continue.")
    return user


def sign_out(headers):
    auth = (headers or {}).get("authorization", "")
    if auth.lower().startswith("bearer "):
        users_table().delete_item(Key={"pk": f"tok#{sha(auth[7:].strip())}"})
    return {"ok": True}

