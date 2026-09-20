"""User settings, the connect-a-role flow, and account deletion."""
import re
from datetime import datetime, timedelta, timezone

import ce
import notify
from common import HttpError, cache_table, sha, to_ddb, user_settings, users_table
from convert import ENTITIES

ROLE_ARN_RE = re.compile(r"^arn:aws:iam::\d{12}:role/[\w+=,.@/-]{1,200}\Z")


def _number(body, key, lo, hi):
    v = body[key]
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not (lo <= v <= hi):
        raise HttpError(400, f"{key} must be a number between {lo} and {hi}.")
    return float(v)


def update_settings(user, body):
    current = user_settings(user)
    if "entity" in body:
        if body["entity"] not in ENTITIES:
            raise HttpError(400, f"entity must be one of {list(ENTITIES)}.")
        current["entity"] = body["entity"]
    if "markup_pct" in body:
        current["markup_pct"] = _number(body, "markup_pct", 0, 0.1)
    if "gst_pct" in body:
        current["gst_pct"] = _number(body, "gst_pct", 0, 0.28)
    if "digest" in body:
        if body["digest"] not in ("monthly", "off"):
            raise HttpError(400, "digest must be 'monthly' or 'off'.")
        current["digest"] = body["digest"]
    if "threshold_inr" in body:
        current["threshold_inr"] = None if body["threshold_inr"] is None else _number(body, "threshold_inr", 1, 10_000_000)
    users_table().update_item(
        Key={"pk": user["pk"]},
        UpdateExpression="SET settings = :s",
        ExpressionAttributeValues={":s": to_ddb(current)},
    )
    return {"ok": True, "settings": current}


def connect_role(user, body, now=None):
    """Validates a role in the user's own account (test AssumeRole plus a 1-day
    Cost Explorer call) before storing it. roleArn: null disconnects."""
    role_arn = body.get("roleArn")
    if role_arn is None:
        users_table().update_item(Key={"pk": user["pk"]}, UpdateExpression="REMOVE roleArn")
        return {"ok": True, "connected": False}
    if not isinstance(role_arn, str) or not ROLE_ARN_RE.match(role_arn):
        raise HttpError(400, "That doesn't look like an IAM role ARN (arn:aws:iam::123456789012:role/...).")
    now = now or datetime.now(timezone.utc)
    creds = ce.assume_role(role_arn, user["externalId"])
    today = now.date()
    ce.fetch_period(today - timedelta(days=1), today, creds)  # proves Cost Explorer access
    users_table().update_item(
        Key={"pk": user["pk"]},
        UpdateExpression="SET roleArn = :r",
        ExpressionAttributeValues={":r": role_arn},
    )
    return {"ok": True, "connected": True}


def _delete_matching(table, prefix, extra=None, values=None):
    """Delete every item whose pk starts with prefix. Scans, which is fine at
    this size and keeps the table free of secondary indexes."""
    expr = "begins_with(pk, :p)" + (f" AND {extra}" if extra else "")
    kwargs = {"FilterExpression": expr, "ExpressionAttributeValues": {":p": prefix, **(values or {})}}
    removed = 0
    while True:
        resp = table.scan(**kwargs)
        for item in resp.get("Items", []):
            table.delete_item(Key={"pk": item["pk"]})
            removed += 1
        if "LastEvaluatedKey" not in resp:
            return removed
        kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]


def delete_account(user):
    """Erase everything Paisa holds about this user.

    Deliberately leaves the role in the user's own AWS account alone: it is
    theirs, we cannot delete it, and saying so is better than implying we did.
    """
    users = users_table()
    user_id = user["pk"].split("#", 1)[1]
    tokens = _delete_matching(users, "tok#", "userId = :u", {":u": user_id})
    cached = _delete_matching(cache_table(), f"spend#{user.get('roleArn') or 'self'}#")
    for key in (f"code#{user_id}", f"thr#{sha(user['email'])}", f"email#{sha(user['email'])}", user["pk"]):
        users.delete_item(Key={"pk": key})
    topic_gone = True
    try:
        notify.delete_topic(user["topicArn"])
    except Exception:  # the account is still gone; the topic is not worth failing over
        topic_gone = False
    return {
        "ok": True,
        "deleted": {"sessions": tokens, "cachedSpend": cached, "emailTopic": topic_gone},
        "note": "The read-only role still exists in your AWS account. Delete the PaisaReadOnly CloudFormation stack to remove it.",
    }
