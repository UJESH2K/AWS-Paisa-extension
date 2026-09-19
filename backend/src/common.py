"""Shared helpers: HTTP responses, DynamoDB access, hashing, JSON <-> DynamoDB."""
import hashlib
import json
import os
import time
from decimal import Decimal

import boto3

REGION = os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION") or "ap-south-1"

DEFAULT_SETTINGS = {
    "entity": "AWS_INC",
    "markup_pct": 0.035,
    "gst_pct": 0.18,
    "digest": "monthly",  # "monthly" | "off"
    "threshold_inr": None,  # alert when the projection exceeds this many rupees
}


class HttpError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


def now_epoch():
    return int(time.time())


def _default(o):
    if isinstance(o, Decimal):
        return int(o) if o == o.to_integral_value() else float(o)
    raise TypeError(f"not JSON serializable: {type(o)}")


def dumps(obj):
    return json.dumps(obj, default=_default, separators=(",", ":"))


def to_ddb(obj):
    """Floats -> Decimal so DynamoDB accepts them."""
    return json.loads(json.dumps(obj), parse_float=Decimal)


def from_ddb(obj):
    """Decimal -> int/float."""
    return json.loads(dumps(obj))


def respond(status, body):
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json", "Cache-Control": "no-store"},
        "body": dumps(body),
    }


def ok(body):
    return respond(200, body)


def err(status, message):
    return respond(status, {"error": message})


def sha(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _table(env_name):
    return boto3.resource("dynamodb", region_name=REGION).Table(os.environ[env_name])


def users_table():
    return _table("USERS_TABLE")


def cache_table():
    return _table("CACHE_TABLE")


def fx_table():
    return _table("FX_TABLE")


def get_user(user_id):
    item = users_table().get_item(Key={"pk": f"user#{user_id}"}).get("Item")
    return from_ddb(item) if item else None


def user_settings(user):
    merged = dict(DEFAULT_SETTINGS)
    merged.update(user.get("settings") or {})
    return merged
