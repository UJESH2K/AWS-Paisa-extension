import os
import sys

os.environ.setdefault("AWS_DEFAULT_REGION", "ap-south-1")
os.environ.setdefault("AWS_ACCESS_KEY_ID", "testing")
os.environ.setdefault("AWS_SECRET_ACCESS_KEY", "testing")
os.environ.setdefault("AWS_SESSION_TOKEN", "testing")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

import boto3  # noqa: E402
import pytest  # noqa: E402
from moto import mock_aws  # noqa: E402

import notify  # noqa: E402

OWNER = "owner@example.com"


class Outbox:
    """Captures emails instead of sending, and controls whether SNS subscriptions count as confirmed."""

    def __init__(self):
        self.sent = []
        self.confirmed = True


@pytest.fixture
def aws(monkeypatch):
    monkeypatch.setenv("USERS_TABLE", "PaisaUsers")
    monkeypatch.setenv("CACHE_TABLE", "PaisaCache")
    monkeypatch.setenv("FX_TABLE", "PaisaFx")
    monkeypatch.setenv("OWNER_EMAILS", OWNER)
    with mock_aws():
        ddb = boto3.resource("dynamodb", region_name="ap-south-1")
        for name in ("PaisaUsers", "PaisaCache", "PaisaFx"):
            ddb.create_table(
                TableName=name,
                KeySchema=[{"AttributeName": "pk", "KeyType": "HASH"}],
                AttributeDefinitions=[{"AttributeName": "pk", "AttributeType": "S"}],
                BillingMode="PAY_PER_REQUEST",
            )
        yield


@pytest.fixture
def outbox(aws, monkeypatch):
    box = Outbox()
    monkeypatch.setattr(notify, "publish", lambda topic, subject, message: box.sent.append((topic, subject, message)))
    monkeypatch.setattr(notify, "is_confirmed", lambda topic, email: box.confirmed)
    return box


@pytest.fixture
def fx(aws):
    from common import fx_table, to_ddb

    item = {"pk": "USDINR", "rate": 80.0, "source": "test", "fetchedAt": "2026-09-20T00:30:00+00:00"}
    fx_table().put_item(Item=to_ddb(item))
    return item
