"""Fallback spend source: CloudWatch AWS/Billing EstimatedCharges.

Cost Explorer is an opt-in, per-request-billed API, and plenty of accounts
cannot call it at all (SubscriptionRequiredException on accounts that never
enabled it, including brand-new and free-plan accounts). Those accounts still
publish EstimatedCharges to CloudWatch in us-east-1, for free, once billing
alerts are switched on.

It is a coarser source and we say so rather than pretending otherwise:
  - one datapoint every few hours, not per-day granularity;
  - it is AWS's own estimate of the month's charges, not raw usage, so credits
    may already be reflected;
  - per-service breakdown exists but only for services that publish it.
"""
from datetime import timedelta

import boto3
from botocore.exceptions import ClientError

from common import HttpError

NAMESPACE = "AWS/Billing"
METRIC = "EstimatedCharges"
REGION = "us-east-1"  # billing metrics are only published here
PERIOD = 6 * 3600
LOOKBACK_HOURS = 36  # EstimatedCharges updates roughly every 6 hours

PROVIDER = "cloudwatch"
NOTE = (
    "From CloudWatch billing metrics (AWS's own estimate of this month's charges). "
    "Cost Explorer isn't enabled on this account, so figures update every few hours "
    "and per-service detail may be incomplete."
)


def _client(creds=None):
    kwargs = {"region_name": REGION}
    if creds:
        kwargs.update(
            aws_access_key_id=creds["AccessKeyId"],
            aws_secret_access_key=creds["SecretAccessKey"],
            aws_session_token=creds["SessionToken"],
        )
    return boto3.client("cloudwatch", **kwargs)


def _latest(cw, dimensions, now):
    """Most recent EstimatedCharges datapoint, or None."""
    try:
        resp = cw.get_metric_statistics(
            Namespace=NAMESPACE,
            MetricName=METRIC,
            Dimensions=dimensions,
            StartTime=now - timedelta(hours=LOOKBACK_HOURS),
            EndTime=now,
            Period=PERIOD,
            Statistics=["Maximum"],
        )
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code", "")
        if code in ("AccessDenied", "AccessDeniedException", "OptInRequired", "SubscriptionRequiredException"):
            raise HttpError(502, "Paisa isn't allowed to read CloudWatch billing metrics in this account.") from e
        raise
    points = resp.get("Datapoints") or []
    if not points:
        return None
    return max(points, key=lambda p: p["Timestamp"])


def _service_names(cw):
    names = []
    paginator = cw.get_paginator("list_metrics")
    for page in paginator.paginate(Namespace=NAMESPACE, MetricName=METRIC):
        for metric in page.get("Metrics", []):
            dims = {d["Name"]: d["Value"] for d in metric.get("Dimensions", [])}
            if "ServiceName" in dims and "LinkedAccount" not in dims:
                names.append(dims["ServiceName"])
    return sorted(set(names))


def fetch_month_to_date(now, creds=None):
    """{usd, services, provider, note, asOf}. Raises HttpError if unavailable."""
    cw = _client(creds)
    total = _latest(cw, [{"Name": "Currency", "Value": "USD"}], now)
    if total is None:
        raise HttpError(
            502,
            "No spend data available yet. Paisa needs either Cost Explorer enabled, or billing alerts "
            "turned on (Billing and Cost Management > Billing preferences > Receive billing alerts). "
            "New accounts can take a few hours to publish the first figure.",
        )
    services = []
    for name in _service_names(cw):
        point = _latest(cw, [{"Name": "Currency", "Value": "USD"}, {"Name": "ServiceName", "Value": name}], now)
        if point and point["Maximum"] > 0:
            services.append({"name": name, "usd": round(float(point["Maximum"]), 6)})
    services.sort(key=lambda s: s["usd"], reverse=True)
    return {
        "usd": round(float(total["Maximum"]), 6),
        "services": services,
        "provider": PROVIDER,
        "note": NOTE,
        "asOf": total["Timestamp"].isoformat(),
    }
