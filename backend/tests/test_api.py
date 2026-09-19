import json
import re

import pytest

import api
import ce
import settings_handler
from common import to_ddb, users_table
from conftest import OWNER


def call(route, body=None, token=None, query=None):
    event = {"routeKey": route, "headers": {}, "body": json.dumps(body) if body is not None else None}
    if token:
        event["headers"]["authorization"] = f"Bearer {token}"
    if query:
        event["queryStringParameters"] = query
    r = api.handler(event, None)
    return r["statusCode"], json.loads(r["body"])


@pytest.fixture
def session(outbox, fx, monkeypatch):
    """A signed-in owner, going through the real login routes."""
    monkeypatch.setattr(ce, "fetch_period", lambda s, e, creds=None: {"usd": 47.3, "services": [{"name": "Amazon EC2", "usd": 47.3}]})
    import auth_handler

    monkeypatch.setattr(auth_handler, "_throttle", lambda *a, **k: None)  # api tests ignore the cooldown
    assert call("POST /auth/start", {"email": OWNER})[1]["status"] == "confirm_subscription"
    assert call("POST /auth/start", {"email": OWNER})[1]["status"] == "code_sent"
    code = re.search(r"code is (\d{6})", outbox.sent[-1][2]).group(1)
    status, body = call("POST /auth/verify", {"email": OWNER, "code": code})
    assert status == 200
    return body["token"]


def test_health_is_public(aws, fx):
    assert call("GET /health") == (200, {"ok": True, "fx": True})


def test_protected_routes_need_a_token(aws):
    for route in ("GET /spend", "GET /me", "PUT /settings", "POST /connect", "POST /email-summary"):
        assert call(route, {})[0] == 401, route


def test_unknown_route_and_bad_bodies(session):
    assert call("GET /nope", token=session)[0] == 404
    r = api.handler({"routeKey": "POST /auth/start", "headers": {}, "body": "{not json"}, None)
    assert r["statusCode"] == 400
    r = api.handler({"routeKey": "POST /auth/start", "headers": {}, "body": "x" * 9000}, None)
    assert r["statusCode"] == 413


def test_spend_endpoint_returns_the_dashboard_shape(session):
    status, body = call("GET /spend", token=session)
    assert status == 200
    for key in ("month", "usd", "fx", "breakdown", "projection", "services", "daysElapsed", "daysInMonth", "settings", "cachedAt"):
        assert key in body, key
    assert body["breakdown"]["total"] == pytest.approx(47.3 * 80 * 1.035 * 1.18)


def test_me_and_settings_roundtrip(session):
    status, me = call("GET /me", token=session)
    assert status == 200 and me["email"] == OWNER and me["emailConfirmed"] and me["isOwner"] and len(me["externalId"]) == 32

    status, body = call("PUT /settings", {"entity": "AISPL", "gst_pct": 0.12, "threshold_inr": 9000}, token=session)
    assert status == 200 and body["settings"]["entity"] == "AISPL"
    spend = call("GET /spend", token=session)[1]
    assert spend["settings"]["entity"] == "AISPL" and spend["breakdown"]["markup"] == 0
    assert spend["breakdown"]["total"] == pytest.approx(47.3 * 80 * 1.12)


@pytest.mark.parametrize(
    "bad",
    [{"entity": "OTHER"}, {"markup_pct": 0.9}, {"gst_pct": -1}, {"gst_pct": "18"}, {"digest": "daily"}, {"threshold_inr": 0}, {"markup_pct": True}],
)
def test_settings_validation(session, bad):
    assert call("PUT /settings", bad, token=session)[0] == 400


def test_email_summary_route(session, outbox):
    status, body = call("POST /email-summary", token=session)
    assert status == 200 and body["sentTo"] == OWNER
    assert "₹" in outbox.sent[-1][2]
    outbox.confirmed = False
    assert call("POST /email-summary", token=session)[0] == 409


def test_connect_validates_arn_and_role(session, monkeypatch):
    assert call("POST /connect", {"roleArn": "nonsense"}, token=session)[0] == 400
    monkeypatch.setattr(ce, "assume_role", lambda arn, ext: {"AccessKeyId": "a", "SecretAccessKey": "b", "SessionToken": "c"})
    arn = "arn:aws:iam::123456789012:role/PaisaReadOnlyRole"
    assert call("POST /connect", {"roleArn": arn}, token=session) == (200, {"ok": True, "connected": True})
    assert call("GET /me", token=session)[1]["roleArn"] == arn
    assert call("POST /connect", {"roleArn": None}, token=session)[1] == {"ok": True, "connected": False}
    assert call("GET /me", token=session)[1]["connected"] is False


def test_stranger_without_a_role_is_told_to_connect(outbox, fx, monkeypatch):
    import auth_handler

    monkeypatch.setattr(auth_handler, "_throttle", lambda *a, **k: None)
    call("POST /auth/start", {"email": "new@example.com"})
    call("POST /auth/start", {"email": "new@example.com"})
    code = re.search(r"code is (\d{6})", outbox.sent[-1][2]).group(1)
    token = call("POST /auth/verify", {"email": "new@example.com", "code": code})[1]["token"]
    status, body = call("GET /spend", token=token)
    assert status == 409 and "Connect your AWS account" in body["error"]


def test_internal_errors_do_not_leak_details(session, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("secret internals")

    monkeypatch.setattr(ce, "fetch_period", boom)
    status, body = call("GET /spend", token=session)
    assert status == 500 and "secret" not in json.dumps(body)


def test_role_arn_pattern():
    ok = "arn:aws:iam::123456789012:role/PaisaReadOnlyRole"
    assert settings_handler.ROLE_ARN_RE.match(ok)
    for bad in ("arn:aws:iam::123:role/x", "arn:aws:iam::123456789012:user/x", ok + "\n; rm -rf"):
        assert not settings_handler.ROLE_ARN_RE.match(bad)


def test_scheduled_fx_task_dispatch(aws, monkeypatch):
    import fx_refresher

    monkeypatch.setattr(fx_refresher, "fetch_rate", lambda: ("test source", 91.25))
    result = api.handler({"task": "fx"}, None)
    assert result["ok"] and result["fx"]["rate"] == 91.25
    assert call("GET /health") == (200, {"ok": True, "fx": True})


def test_scheduled_digest_task_dispatch(aws, outbox):
    assert api.handler({"task": "digest"}, None) == {"sent": {}}
    import pytest as _p

    with _p.raises(ValueError):
        api.handler({"task": "nope"}, None)
