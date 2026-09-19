from datetime import datetime, timezone

import pytest

import alert_checker
import ce
import email_handler
import report
from common import HttpError, to_ddb, users_table
from conftest import OWNER

RAW = {"usd": 47.30, "services": [{"name": "Amazon EC2", "usd": 30.0}, {"name": "Amazon S3", "usd": 17.3}]}
FX = {"rate": 85.0, "fetchedAt": "2026-09-20T00:30:00+00:00", "source": "test"}
SETTINGS = {"entity": "AWS_INC", "markup_pct": 0.035, "gst_pct": 0.18, "digest": "monthly", "threshold_inr": None}


def summary(**over):
    s = report.build_summary(RAW, FX, {**SETTINGS, **over}, 18, 30, "2026-09", "2026-09-18")
    return s


def test_fmt_inr_uses_indian_grouping():
    assert report.fmt_inr(1234567.891) == "₹12,34,567.89"
    assert report.fmt_inr(999) == "₹999.00"
    assert report.fmt_inr(100000, 0) == "₹1,00,000"
    assert report.fmt_inr(-1500.5) == "-₹1,500.50"
    assert report.fmt_inr(4910.24, 0, "Rs ") == "Rs 4,910"


def test_email_shows_every_step_including_gst():
    subject, message = report.email_text(summary())
    assert subject.isascii() and "\n" not in subject and len(subject) <= 100
    assert "September 2026" in subject
    for needle in ("$47.30", "₹85.00 per USD", "Base:", "Card forex markup (3.50%)", "GST (18%)", "Total so far", "Projected month-end bill (incl. GST)", "Amazon EC2", "estimate"):
        assert needle in message, needle
    assert "₹4,910.24" in message  # the same total the dashboard shows


def test_aispl_email_says_no_markup():
    _, message = report.email_text(summary(entity="AISPL"))
    assert "none (AISPL invoices in INR)" in message


def test_alert_and_final_variants():
    s = summary(threshold_inr=5000)
    assert "alert" in report.email_text(s, "alert")[0].lower()
    assert "was about" in report.email_text(s, "final")[0]


def test_zero_spend_summary_does_not_divide_by_zero():
    s = report.build_summary({"usd": 0.0, "services": []}, FX, SETTINGS, 5, 30, "2026-09", "2026-09-05")
    assert s["breakdown"]["total"] == 0 and s["services"] == [] and s["otherUsd"] == 0
    report.email_text(s)  # must not raise


@pytest.fixture
def owner(fx, monkeypatch):
    monkeypatch.setattr(ce, "fetch_period", lambda start, end, creds=None: {"usd": RAW["usd"], "services": list(RAW["services"])})
    user = {"pk": "user#u1", "email": OWNER, "externalId": "e", "topicArn": "arn:aws:sns:ap-south-1:1:paisa-u1", "settings": {}}
    users_table().put_item(Item=to_ddb(user))
    return user


def test_send_summary_publishes_to_the_users_topic(owner, outbox):
    r = email_handler.send_summary(owner, "projection", datetime(2026, 9, 20, 6, tzinfo=timezone.utc))
    assert r["ok"] and r["sentTo"] == OWNER
    topic, subject, message = outbox.sent[0]
    assert topic == owner["topicArn"] and "₹" in message and subject.startswith("Paisa:")


def test_send_summary_refuses_until_subscription_confirmed(owner, outbox):
    outbox.confirmed = False
    with pytest.raises(HttpError) as e:
        email_handler.send_summary(owner)
    assert e.value.status == 409 and outbox.sent == []


def test_digest_sends_on_the_15th_once(owner, outbox):
    day15 = datetime(2026, 9, 15, 1, tzinfo=timezone.utc)
    assert alert_checker.run(day15) == {"user#u1": ["projection"]}
    assert alert_checker.run(day15) == {}  # same day: no duplicate
    assert len(outbox.sent) == 1


def test_digest_on_the_1st_is_last_months_final(owner, outbox):
    assert alert_checker.run(datetime(2026, 10, 1, 1, tzinfo=timezone.utc)) == {"user#u1": ["final"]}
    assert "was about" in outbox.sent[0][1]


def test_digest_stays_quiet_other_days_or_when_off(owner, outbox):
    assert alert_checker.run(datetime(2026, 9, 20, 1, tzinfo=timezone.utc)) == {}
    users_table().update_item(Key={"pk": owner["pk"]}, UpdateExpression="SET settings = :s", ExpressionAttributeValues={":s": {"digest": "off"}})
    assert alert_checker.run(datetime(2026, 9, 15, 1, tzinfo=timezone.utc)) == {}
    assert outbox.sent == []


def test_threshold_alert_fires_once_per_month(owner, outbox):
    users_table().update_item(Key={"pk": owner["pk"]}, UpdateExpression="SET settings = :s", ExpressionAttributeValues={":s": to_ddb({"digest": "off", "threshold_inr": 5000})})
    d1 = datetime(2026, 9, 20, 1, tzinfo=timezone.utc)
    assert alert_checker.run(d1) == {"user#u1": ["alert"]}  # projection ~8,184 > 5,000
    assert alert_checker.run(d1.replace(day=21)) == {}
    assert len(outbox.sent) == 1


def test_unconfirmed_users_are_skipped(owner, outbox):
    outbox.confirmed = False
    assert alert_checker.run(datetime(2026, 9, 15, 1, tzinfo=timezone.utc)) == {}
