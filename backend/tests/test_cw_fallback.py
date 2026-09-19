"""The CloudWatch billing-metrics fallback, and the choice between sources.

Motivated by a real account: AWS account 600219017400 returns
SubscriptionRequiredException for Cost Explorer, so Paisa has to work without it.
"""
from datetime import datetime, timezone

import boto3
import pytest

import ce
import cw
import spend_handler
from common import HttpError, to_ddb, users_table
from conftest import OWNER

NOW = datetime(2026, 9, 20, 6, 0, tzinfo=timezone.utc)


def publish(total=None, services=(), when=None):
    client = boto3.client("cloudwatch", region_name=cw.REGION)
    when = when or (NOW.replace(hour=3))
    data = []
    if total is not None:
        data.append({"MetricName": cw.METRIC, "Dimensions": [{"Name": "Currency", "Value": "USD"}], "Value": total, "Timestamp": when})
    for name, value in services:
        data.append(
            {
                "MetricName": cw.METRIC,
                "Dimensions": [{"Name": "Currency", "Value": "USD"}, {"Name": "ServiceName", "Value": name}],
                "Value": value,
                "Timestamp": when,
            }
        )
    if data:
        client.put_metric_data(Namespace=cw.NAMESPACE, MetricData=data)


def make_user(email=OWNER, **extra):
    user = {"pk": "user#u1", "email": email, "externalId": "ext", "settings": {}, **extra}
    users_table().put_item(Item=to_ddb(user))
    return user


def test_reads_total_and_services(aws):
    publish(total=12.5, services=[("Amazon Elastic Compute Cloud", 8.0), ("Amazon Simple Storage Service", 4.5)])
    out = cw.fetch_month_to_date(NOW)
    assert out["usd"] == 12.5
    assert out["provider"] == "cloudwatch"
    assert [s["name"] for s in out["services"]] == ["Amazon Elastic Compute Cloud", "Amazon Simple Storage Service"]
    assert out["services"][0]["usd"] == 8.0
    assert "Cost Explorer isn't enabled" in out["note"]


def test_services_sorted_and_zero_dropped(aws):
    publish(total=9.0, services=[("Small", 1.0), ("Big", 8.0), ("Free", 0.0)])
    out = cw.fetch_month_to_date(NOW)
    assert [s["name"] for s in out["services"]] == ["Big", "Small"]


def test_uses_the_most_recent_datapoint(aws):
    publish(total=5.0, when=NOW.replace(hour=0))
    publish(total=11.0, when=NOW.replace(hour=5))
    assert cw.fetch_month_to_date(NOW)["usd"] == 11.0


def test_ignores_datapoints_older_than_the_lookback(aws):
    publish(total=5.0, when=NOW.replace(day=17))  # three days ago
    with pytest.raises(HttpError) as e:
        cw.fetch_month_to_date(NOW)
    assert e.value.status == 502


def test_no_metrics_explains_how_to_turn_them_on(aws):
    with pytest.raises(HttpError) as e:
        cw.fetch_month_to_date(NOW)
    assert "billing alerts" in str(e.value).lower()


def test_total_only_still_works(aws):
    publish(total=3.25)
    out = cw.fetch_month_to_date(NOW)
    assert out["usd"] == 3.25 and out["services"] == []


# ---- the choice between sources -------------------------------------------


@pytest.fixture
def ce_unavailable(monkeypatch):
    def boom(*a, **k):
        raise ce.Unavailable(502, "Cost Explorer isn't enabled for this account. Enable it in the AWS console.")

    monkeypatch.setattr(ce, "fetch_period", boom)


def test_falls_back_to_cloudwatch_when_cost_explorer_is_off(fx, ce_unavailable):
    publish(total=10.0, services=[("Amazon EC2", 10.0)])
    s = spend_handler.get_spend(make_user(), NOW)
    assert s["provider"] == "cloudwatch"
    assert s["usd"] == 10.0
    assert s["breakdown"]["total"] == pytest.approx(10.0 * 80 * 1.035 * 1.18)
    assert s["excludes"] == []  # this source is not gross-usage-before-credits
    assert "Cost Explorer isn't enabled" in s["providerNote"]


def test_cost_explorer_is_preferred_when_available(fx, monkeypatch):
    publish(total=999.0)  # would be used only if the fallback fired
    monkeypatch.setattr(ce, "fetch_period", lambda s, e, creds=None: {"usd": 7.0, "services": [], "provider": "cost_explorer", "note": "From AWS Cost Explorer."})
    s = spend_handler.get_spend(make_user(), NOW)
    assert s["provider"] == "cost_explorer" and s["usd"] == 7.0


def test_when_both_sources_fail_the_user_hears_about_cost_explorer(fx, ce_unavailable):
    with pytest.raises(HttpError) as e:
        spend_handler.get_spend(make_user(), NOW)  # no CloudWatch metrics published either
    assert "Cost Explorer isn't enabled" in e.value.message


def test_fallback_result_is_cached_like_any_other(fx, ce_unavailable, monkeypatch):
    publish(total=10.0)
    calls = []
    real = cw.fetch_month_to_date
    monkeypatch.setattr(cw, "fetch_month_to_date", lambda now, creds=None: (calls.append(now), real(now, creds))[1])
    user = make_user()
    spend_handler.get_spend(user, NOW)
    spend_handler.get_spend(user, NOW)
    assert len(calls) == 1


def test_last_month_still_requires_cost_explorer(fx, ce_unavailable):
    publish(total=10.0)
    with pytest.raises(HttpError):
        spend_handler.get_previous_month(make_user(), datetime(2026, 10, 1, 1, tzinfo=timezone.utc))


def test_connected_role_credentials_reach_cloudwatch(fx, ce_unavailable, monkeypatch):
    seen = {}
    monkeypatch.setattr(ce, "assume_role", lambda arn, ext: {"AccessKeyId": "k", "SecretAccessKey": "s", "SessionToken": "t"})
    monkeypatch.setattr(cw, "fetch_month_to_date", lambda now, creds=None: seen.update(creds=creds) or {"usd": 1.0, "services": [], "provider": "cloudwatch", "note": "n"})
    user = make_user(email="stranger@example.com", roleArn="arn:aws:iam::123456789012:role/PaisaReadOnlyRole")
    spend_handler.get_spend(user, NOW)
    assert seen["creds"]["AccessKeyId"] == "k"
