import re

import pytest

import auth_handler
from common import HttpError, sha, users_table

T0 = 1_800_000_000


def _code(outbox):
    return re.search(r"code is (\d{6})", outbox.sent[-1][2]).group(1)


def _signed_up_and_confirmed(outbox, email="a@example.com", now=T0):
    assert auth_handler.start(email, now)["status"] == "confirm_subscription"
    return now + 120  # after the resend cooldown


def test_first_start_creates_user_and_asks_to_confirm(outbox):
    assert auth_handler.start("A@Example.com ", T0) == {"status": "confirm_subscription"}
    mapping = users_table().get_item(Key={"pk": f"email#{sha('a@example.com')}"})["Item"]
    user = users_table().get_item(Key={"pk": f"user#{mapping['userId']}"})["Item"]
    assert user["email"] == "a@example.com"
    assert user["topicArn"].endswith(f"paisa-{mapping['userId'][:20]}")
    assert outbox.sent == []  # nothing is emailed until the subscription is confirmed


def test_start_is_throttled_per_email(outbox):
    auth_handler.start("a@example.com", T0)
    with pytest.raises(HttpError) as e:
        auth_handler.start("a@example.com", T0 + 5)
    assert e.value.status == 429


def test_unconfirmed_subscription_resends_confirmation_not_a_code(outbox):
    later = _signed_up_and_confirmed(outbox)
    outbox.confirmed = False
    assert auth_handler.start("a@example.com", later)["status"] == "confirm_subscription"
    assert outbox.sent == []


def test_full_login_flow(outbox):
    later = _signed_up_and_confirmed(outbox)
    assert auth_handler.start("a@example.com", later)["status"] == "code_sent"
    code = _code(outbox)
    assert len(outbox.sent) == 1 and outbox.sent[0][1] == "Your Paisa sign-in code"

    session = auth_handler.verify("a@example.com", code, later + 30)
    user = auth_handler.authenticate({"authorization": f"Bearer {session['token']}"}, later + 31)
    assert user["email"] == "a@example.com"

    with pytest.raises(HttpError):  # a code is single use
        auth_handler.verify("a@example.com", code, later + 40)


def test_wrong_code_and_attempt_limit(outbox):
    later = _signed_up_and_confirmed(outbox)
    auth_handler.start("a@example.com", later)
    good = _code(outbox)
    bad = "000000" if good != "000000" else "111111"
    for _ in range(auth_handler.MAX_ATTEMPTS):
        with pytest.raises(HttpError) as e:
            auth_handler.verify("a@example.com", bad, later + 10)
        assert e.value.status == 401
    with pytest.raises(HttpError):  # locked out, even with the right code
        auth_handler.verify("a@example.com", good, later + 20)


def test_expired_code(outbox):
    later = _signed_up_and_confirmed(outbox)
    auth_handler.start("a@example.com", later)
    with pytest.raises(HttpError):
        auth_handler.verify("a@example.com", _code(outbox), later + auth_handler.CODE_TTL + 1)


def test_authenticate_rejects_missing_bad_and_expired_tokens(outbox):
    later = _signed_up_and_confirmed(outbox)
    auth_handler.start("a@example.com", later)
    token = auth_handler.verify("a@example.com", _code(outbox), later + 1)["token"]
    for headers in ({}, {"authorization": "Bearer nope"}, {"authorization": "Basic abc"}):
        with pytest.raises(HttpError) as e:
            auth_handler.authenticate(headers, later + 2)
        assert e.value.status == 401
    with pytest.raises(HttpError):
        auth_handler.authenticate({"authorization": f"Bearer {token}"}, later + auth_handler.TOKEN_TTL + 5)


def test_sign_out_invalidates_token(outbox):
    later = _signed_up_and_confirmed(outbox)
    auth_handler.start("a@example.com", later)
    token = auth_handler.verify("a@example.com", _code(outbox), later + 1)["token"]
    headers = {"authorization": f"Bearer {token}"}
    auth_handler.sign_out(headers)
    with pytest.raises(HttpError):
        auth_handler.authenticate(headers, later + 2)


@pytest.mark.parametrize("bad", ["", "nope", "a@b", "a b@example.com", "x" * 300 + "@example.com", None])
def test_rejects_invalid_email(outbox, bad):
    with pytest.raises(HttpError) as e:
        auth_handler.start(bad, T0)
    assert e.value.status == 400
