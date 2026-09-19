from datetime import date, datetime, timedelta, timezone

import pytest

import ce
import spend_handler
from common import HttpError, to_ddb, users_table
from conftest import OWNER

NOW = datetime(2026, 9, 20, 6, 0, tzinfo=timezone.utc)
RAW = {"usd": 100.0, "services": [{"name": f"Svc{i}", "usd": 20.0 - i} for i in range(6)]}


def make_user(email=OWNER, **extra):
    user = {"pk": "user#u1", "email": email, "externalId": "ext", "settings": {}, **extra}
    users_table().put_item(Item=to_ddb(user))
    return user


@pytest.fixture
def ce_calls(monkeypatch):
    calls = []

    def fake(start, end, creds=None):
        calls.append((start, end, creds))
        return {"usd": RAW["usd"], "services": list(RAW["services"])}

    monkeypatch.setattr(ce, "fetch_period", fake)
    return calls


def test_month_to_date_window_is_first_of_month_to_tomorrow():
    assert ce.month_to_date_window(date(2026, 9, 20)) == (date(2026, 9, 1), date(2026, 9, 21))
    assert ce.month_to_date_window(date(2026, 9, 1)) == (date(2026, 9, 1), date(2026, 9, 2))


def test_second_request_is_served_from_cache(fx, ce_calls):
    user = make_user()
    first = spend_handler.get_spend(user, NOW)
    second = spend_handler.get_spend(user, NOW + timedelta(hours=3))
    assert len(ce_calls) == 1  # Cost Explorer is billed per request
    assert first["usd"] == second["usd"] == 100.0


def test_cache_expires_after_four_hours(fx, ce_calls):
    user = make_user()
    spend_handler.get_spend(user, NOW)
    spend_handler.get_spend(user, NOW + timedelta(hours=4, minutes=1))
    assert len(ce_calls) == 2


def test_manual_refresh_cannot_hammer_cost_explorer(fx, ce_calls):
    user = make_user()
    spend_handler.get_spend(user, NOW)
    spend_handler.get_spend(user, NOW + timedelta(minutes=5), force=True)  # too soon: ignored
    assert len(ce_calls) == 1
    spend_handler.get_spend(user, NOW + timedelta(minutes=31), force=True)
    assert len(ce_calls) == 2


def test_month_rollover_does_not_serve_last_months_cache(fx, ce_calls):
    user = make_user()
    spend_handler.get_spend(user, datetime(2026, 9, 30, 23, 0, tzinfo=timezone.utc))
    spend_handler.get_spend(user, datetime(2026, 10, 1, 0, 30, tzinfo=timezone.utc))
    assert len(ce_calls) == 2


def test_summary_maths_matches_convert(fx, ce_calls):
    s = spend_handler.get_spend(make_user(), NOW)
    base = 100.0 * 80.0
    assert s["breakdown"]["base"] == pytest.approx(base)
    assert s["breakdown"]["markup"] == pytest.approx(base * 0.035)
    assert s["breakdown"]["gst"] == pytest.approx((base + base * 0.035) * 0.18)
    assert s["projection"] == pytest.approx(s["breakdown"]["total"] / 20 * 30)
    assert s["daysElapsed"] == 20 and s["daysInMonth"] == 30 and s["month"] == "2026-09"
    assert len(s["services"]) == 5
    assert s["otherUsd"] == pytest.approx(100.0 - sum(x["usd"] for x in RAW["services"][:5]))
    assert sum(x["inr"] for x in s["services"]) + s["otherInr"] == pytest.approx(s["breakdown"]["total"])


def test_user_settings_change_the_maths(fx, ce_calls):
    user = make_user(settings={"entity": "AISPL", "gst_pct": 0.12})
    s = spend_handler.get_spend(user, NOW)
    assert s["breakdown"]["markup"] == 0
    assert s["breakdown"]["total"] == pytest.approx(8000 * 1.12)


def test_strangers_cannot_read_the_owners_account(fx, ce_calls):
    with pytest.raises(HttpError) as e:
        spend_handler.get_spend(make_user(email="stranger@example.com"), NOW)
    assert e.value.status == 409
    assert ce_calls == []


def test_connected_role_is_assumed_with_the_users_external_id(fx, ce_calls, monkeypatch):
    seen = {}

    def fake_assume(role_arn, external_id):
        seen.update(role=role_arn, ext=external_id)
        return {"AccessKeyId": "k", "SecretAccessKey": "s", "SessionToken": "t"}

    monkeypatch.setattr(ce, "assume_role", fake_assume)
    user = make_user(email="stranger@example.com", roleArn="arn:aws:iam::123456789012:role/PaisaReadOnlyRole")
    s = spend_handler.get_spend(user, NOW)
    assert seen == {"role": "arn:aws:iam::123456789012:role/PaisaReadOnlyRole", "ext": "ext"}
    assert ce_calls[0][2]["AccessKeyId"] == "k"
    assert s["source"] == "role"


def test_previous_month_is_the_full_prior_month(fx, ce_calls):
    s = spend_handler.get_previous_month(make_user(), datetime(2026, 10, 1, 1, 0, tzinfo=timezone.utc))
    assert ce_calls[0][:2] == (date(2026, 9, 1), date(2026, 10, 1))
    assert s["month"] == "2026-09" and s["daysElapsed"] == s["daysInMonth"] == 30
    assert s["projection"] == pytest.approx(s["breakdown"]["total"])


def test_missing_fx_rate_gives_a_clear_error(aws, ce_calls, monkeypatch):
    import fx_refresher

    monkeypatch.setattr(fx_refresher, "fetch_rate", lambda: None)
    with pytest.raises(HttpError) as e:
        spend_handler.get_spend(make_user(), NOW)
    assert e.value.status == 503


def test_fetch_period_paginates_sorts_and_filters(monkeypatch):
    pages = [
        {"ResultsByTime": [{"Groups": [
            {"Keys": ["Amazon S3"], "Metrics": {"UnblendedCost": {"Amount": "1.50"}}},
            {"Keys": ["Amazon EC2"], "Metrics": {"UnblendedCost": {"Amount": "10.25"}}},
        ]}], "NextPageToken": "next"},
        {"ResultsByTime": [{"Groups": [
            {"Keys": ["Amazon S3"], "Metrics": {"UnblendedCost": {"Amount": "0.50"}}},
            {"Keys": ["Free thing"], "Metrics": {"UnblendedCost": {"Amount": "0"}}},
        ]}]},
    ]
    seen = []

    class FakeCE:
        def get_cost_and_usage(self, **kw):
            seen.append(kw)
            return pages[len(seen) - 1]

    monkeypatch.setattr(ce, "_client", lambda creds=None: FakeCE())
    out = ce.fetch_period(date(2026, 9, 1), date(2026, 9, 21))
    assert out == {"usd": 12.25, "services": [{"name": "Amazon EC2", "usd": 10.25}, {"name": "Amazon S3", "usd": 2.0}]}
    assert seen[1]["NextPageToken"] == "next"
    assert seen[0]["TimePeriod"] == {"Start": "2026-09-01", "End": "2026-09-21"}
    excluded = seen[0]["Filter"]["Not"]["Dimensions"]["Values"]
    assert set(excluded) == {"Credit", "Refund", "Tax"}
