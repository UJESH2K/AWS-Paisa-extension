"""Cost Explorer access. Cost Explorer bills per request, so callers must go
through the cache in spend_handler; nothing here is called on a bare request path.
"""
from datetime import timedelta

import boto3
from botocore.exceptions import ClientError

from common import HttpError

PROVIDER = "cost_explorer"
NOTE = "From AWS Cost Explorer: gross usage this month, before credits and excluding tax lines."


class Unavailable(HttpError):
    """Cost Explorer cannot be used for this account at all (not enabled, or no access).

    Distinct from a transient failure: the caller should fall back to another
    spend source rather than retry.
    """


# Gross usage: leave out credits, refunds and tax so the figure is what the
# console's "before credits" number shows and our own GST maths doesn't double count.
EXCLUDED_RECORD_TYPES = ["Credit", "Refund", "Tax"]


def month_to_date_window(today):
    """[first of month, tomorrow). Cost Explorer's End is exclusive and in UTC."""
    return today.replace(day=1), today + timedelta(days=1)


def _client(creds=None):
    kwargs = {"region_name": "us-east-1"}  # Cost Explorer's endpoint
    if creds:
        kwargs.update(
            aws_access_key_id=creds["AccessKeyId"],
            aws_secret_access_key=creds["SecretAccessKey"],
            aws_session_token=creds["SessionToken"],
        )
    return boto3.client("ce", **kwargs)


def assume_role(role_arn, external_id):
    try:
        resp = boto3.client("sts").assume_role(
            RoleArn=role_arn,
            RoleSessionName="paisa",
            ExternalId=external_id,
            DurationSeconds=900,
        )
    except ClientError as e:
        raise HttpError(
            400,
            "Paisa couldn't assume that role. Check the role ARN and that its trust policy uses your Paisa connect ID.",
        ) from e
    return resp["Credentials"]


def fetch_period(start, end, creds=None):
    """Gross USD spend by service for [start, end). Returns {usd, services:[{name,usd}]}."""
    ce = _client(creds)
    kwargs = dict(
        TimePeriod={"Start": start.isoformat(), "End": end.isoformat()},
        Granularity="MONTHLY",
        Metrics=["UnblendedCost"],
        GroupBy=[{"Type": "DIMENSION", "Key": "SERVICE"}],
        Filter={"Not": {"Dimensions": {"Key": "RECORD_TYPE", "Values": EXCLUDED_RECORD_TYPES}}},
    )
    by_service = {}
    try:
        while True:
            resp = ce.get_cost_and_usage(**kwargs)
            for period in resp.get("ResultsByTime", []):
                for group in period.get("Groups", []):
                    name = group["Keys"][0]
                    amount = float(group["Metrics"]["UnblendedCost"]["Amount"])
                    by_service[name] = by_service.get(name, 0.0) + amount
            token = resp.get("NextPageToken")
            if not token:
                break
            kwargs["NextPageToken"] = token
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code", "")
        if code in (
            "AccessDeniedException",
            "AccessDenied",
            "OptInRequiredException",
            "OptInRequired",
            "SubscriptionRequiredException",
        ):
            raise Unavailable(
                502,
                "Cost Explorer isn't enabled for this account. Enable it in the AWS console "
                "(Billing and Cost Management > Cost Explorer), or turn on billing alerts so Paisa "
                "can read CloudWatch billing metrics instead.",
            ) from e
        if code == "DataUnavailableException":
            raise HttpError(502, "Cost Explorer is still preparing your data (it can take up to 24 hours after enabling).") from e
        raise
    services = sorted(
        ({"name": n, "usd": round(v, 6)} for n, v in by_service.items() if v > 0),
        key=lambda s: s["usd"],
        reverse=True,
    )
    return {
        "usd": round(sum(s["usd"] for s in services), 6),
        "services": services,
        "provider": PROVIDER,
        "note": NOTE,
    }
