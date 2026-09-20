"""The paths that only run when something has gone wrong.

Coverage showed these were the least-tested parts of the backend, which is
backwards: a user only ever meets this code on a bad day, and a confusing
message then is worse than one during normal use.
"""
from datetime import date, datetime, timezone

import pytest
from botocore.exceptions import ClientError

import ce
import cw
import fx_refresher
import notify
from common import HttpError


def client_error(code, op="Whatever"):
    return ClientError({"Error": {"Code": code, "Message": f"{code} happened"}}, op)


# ---- assuming the user's role ------------------------------------------------


def test_assume_role_failure_names_the_two_likely_causes(aws, monkeypatch):
    import boto3

    class FakeSts:
        def assume_role(self, **kwargs):
            raise client_error("AccessDenied", "AssumeRole")

    monkeypatch.setattr(boto3, "client", lambda *a, **k: FakeSts())
    with pytest.raises(HttpError) as e:
        ce.assume_role("arn:aws:iam::123456789012:role/PaisaReadOnlyRole", "ext")
    assert e.value.status == 400
    message = e.value.message.lower()
    assert "role arn" in message and "trust policy" in message


def test_assume_role_passes_the_external_id(aws, monkeypatch):
    import boto3

    seen = {}

    class FakeSts:
        def assume_role(self, **kwargs):
            seen.update(kwargs)
            return {"Credentials": {"AccessKeyId": "a", "SecretAccessKey": "b", "SessionToken": "c"}}

    monkeypatch.setattr(boto3, "client", lambda *a, **k: FakeSts())
    creds = ce.assume_role("arn:aws:iam::123456789012:role/PaisaReadOnlyRole", "the-external-id")
    assert creds["AccessKeyId"] == "a"
    assert seen["ExternalId"] == "the-external-id"
    assert seen["RoleSessionName"] == "paisa"
    # Short-lived by design: we only need one read.
    assert seen["DurationSeconds"] <= 3600


# ---- Cost Explorer's several ways of saying no -------------------------------


class FailingCE:
    def __init__(self, code):
        self.code = code

    def get_cost_and_usage(self, **kwargs):
        raise client_error(self.code, "GetCostAndUsage")


@pytest.mark.parametrize("code", ["AccessDeniedException", "AccessDenied", "OptInRequired", "OptInRequiredException", "SubscriptionRequiredException"])
def test_cost_explorer_unavailable_is_distinguishable(monkeypatch, code):
    """The caller has to tell 'this account can never use it' from 'it broke',
    because only the first should fall back to another source."""
    monkeypatch.setattr(ce, "_client", lambda creds=None: FailingCE(code))
    with pytest.raises(ce.Unavailable) as e:
        ce.fetch_period(date(2026, 9, 1), date(2026, 9, 21))
    assert e.value.status == 502
    assert "billing alerts" in e.value.message or "Cost Explorer" in e.value.message


def test_data_not_ready_yet_is_not_treated_as_unavailable(monkeypatch):
    monkeypatch.setattr(ce, "_client", lambda creds=None: FailingCE("DataUnavailableException"))
    with pytest.raises(HttpError) as e:
        ce.fetch_period(date(2026, 9, 1), date(2026, 9, 21))
    assert not isinstance(e.value, ce.Unavailable)  # retrying later is the right move
    assert "24 hours" in e.value.message


def test_an_unexpected_error_is_not_swallowed(monkeypatch):
    monkeypatch.setattr(ce, "_client", lambda creds=None: FailingCE("ThrottlingException"))
    with pytest.raises(ClientError):
        ce.fetch_period(date(2026, 9, 1), date(2026, 9, 21))


def test_credentials_reach_the_cost_explorer_client(monkeypatch):
    import boto3

    seen = {}
    monkeypatch.setattr(boto3, "client", lambda name, **kw: seen.update(service=name, **kw) or FailingCE("DataUnavailableException"))
    with pytest.raises(HttpError):
        ce.fetch_period(date(2026, 9, 1), date(2026, 9, 2), {"AccessKeyId": "k", "SecretAccessKey": "s", "SessionToken": "t"})
    assert seen["service"] == "ce"
    assert seen["aws_access_key_id"] == "k" and seen["aws_session_token"] == "t"
    assert seen["region_name"] == "us-east-1"  # Cost Explorer's only endpoint


# ---- the CloudWatch fallback -------------------------------------------------


def test_cloudwatch_access_denied_says_so_plainly(monkeypatch):
    class FailingCW:
        def get_metric_statistics(self, **kwargs):
            raise client_error("AccessDenied", "GetMetricStatistics")

    monkeypatch.setattr(cw, "_client", lambda creds=None: FailingCW())
    with pytest.raises(HttpError) as e:
        cw.fetch_month_to_date(datetime(2026, 9, 20, tzinfo=timezone.utc))
    assert e.value.status == 502 and "CloudWatch" in e.value.message


def test_cloudwatch_credentials_are_passed_through(monkeypatch):
    import boto3

    seen = {}

    class Empty:
        def get_metric_statistics(self, **kwargs):
            return {"Datapoints": []}

    monkeypatch.setattr(boto3, "client", lambda name, **kw: seen.update(service=name, **kw) or Empty())
    with pytest.raises(HttpError):  # no datapoints
        cw.fetch_month_to_date(datetime(2026, 9, 20, tzinfo=timezone.utc), {"AccessKeyId": "k", "SecretAccessKey": "s", "SessionToken": "t"})
    assert seen["service"] == "cloudwatch" and seen["region_name"] == "us-east-1"
    assert seen["aws_access_key_id"] == "k"


# ---- fetching the exchange rate ---------------------------------------------


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def read(self):
        return self.payload

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def fake_urlopen(responses):
    """responses: list of bytes or Exception, one per source, in order."""
    calls = []

    def opener(url, timeout=None):
        calls.append(url)
        item = responses[len(calls) - 1]
        if isinstance(item, Exception):
            raise item
        return FakeResponse(item)

    opener.calls = calls
    return opener


def test_fx_uses_the_first_source_that_answers(monkeypatch):
    opener = fake_urlopen([b'{"rates": {"INR": 88.25}}'])
    monkeypatch.setattr(fx_refresher.urllib.request, "urlopen", opener)
    name, rate = fx_refresher.fetch_rate()
    assert rate == 88.25
    assert "frankfurter" in name
    assert len(opener.calls) == 1  # no need to ask the second


def test_fx_falls_back_when_the_first_source_fails(monkeypatch):
    opener = fake_urlopen([OSError("connection refused"), b'{"rates": {"INR": 91.5}, "time_last_update_unix": 1789776151}'])
    monkeypatch.setattr(fx_refresher.urllib.request, "urlopen", opener)
    name, rate = fx_refresher.fetch_rate()
    assert rate == 91.5 and "er-api" in name
    assert len(opener.calls) == 2


def test_fx_rejects_a_nonsense_rate_and_tries_the_next(monkeypatch):
    opener = fake_urlopen([b'{"rates": {"INR": 0}}', b'{"rates": {"INR": 90.0}, "time_last_update_unix": 1789776151}'])
    monkeypatch.setattr(fx_refresher.urllib.request, "urlopen", opener)
    assert fx_refresher.fetch_rate()[1] == 90.0


def test_fx_gives_up_rather_than_inventing_a_rate(monkeypatch):
    opener = fake_urlopen([OSError("down"), b"not json at all"])
    monkeypatch.setattr(fx_refresher.urllib.request, "urlopen", opener)
    assert fx_refresher.fetch_rate() is None


def test_a_failed_refresh_keeps_the_last_good_rate(aws, fx, monkeypatch):
    monkeypatch.setattr(fx_refresher, "fetch_rate", lambda: None)
    kept = fx_refresher.refresh()
    assert kept["rate"] == 80.0  # the fixture's rate, not None and not a guess


# ---- email delivery ----------------------------------------------------------


def test_subject_is_coerced_to_what_sns_accepts(aws, monkeypatch):
    """SNS rejects subjects that are non-ASCII, multi-line, or over 100 chars.
    Our own summaries contain a rupee sign, so this is not hypothetical."""
    sent = {}

    class FakeSns:
        def publish(self, **kwargs):
            sent.update(kwargs)

    monkeypatch.setattr(notify, "_sns", lambda: FakeSns())
    notify.publish("arn:topic", "Paisa: ₹1,234\nsecond line " + "x" * 200, "body ₹ stays intact")
    assert sent["Subject"].isascii()
    assert "\n" not in sent["Subject"]
    assert len(sent["Subject"]) <= 100
    # The body has no such limits, so the rupee sign must survive there.
    assert "₹" in sent["Message"]


def test_is_confirmed_only_counts_a_real_subscription(aws, monkeypatch):
    class FakeSns:
        def __init__(self, arn):
            self.arn = arn

        def list_subscriptions_by_topic(self, TopicArn):
            return {"Subscriptions": [{"Endpoint": "Someone@Example.com", "SubscriptionArn": self.arn}]}

    monkeypatch.setattr(notify, "_sns", lambda: FakeSns("PendingConfirmation"))
    assert notify.is_confirmed("arn:topic", "someone@example.com") is False

    monkeypatch.setattr(notify, "_sns", lambda: FakeSns("arn:aws:sns:ap-south-1:1:t:sub-id"))
    # Case differences in the address must not stop us recognising it.
    assert notify.is_confirmed("arn:topic", "someone@example.com") is True
    assert notify.is_confirmed("arn:topic", "other@example.com") is False
