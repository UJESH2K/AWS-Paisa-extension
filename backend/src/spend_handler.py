"""Spend: cache first, then Cost Explorer. Cost Explorer bills per request, so
this cache is a cost decision, not a performance one: nothing calls ce.py
without going through get_raw_month_to_date().
"""
import json
import os
from datetime import datetime, timedelta, timezone

import ce
import report
from common import HttpError, cache_table, dumps, user_settings
from fx_refresher import get_fx, refresh

SPEND_TTL = 4 * 3600  # serve cached spend for 4 hours
MIN_REFRESH = 30 * 60  # a manual refresh can't re-query Cost Explorer more often than this


def owner_emails():
    return {e.strip().lower() for e in os.environ.get("OWNER_EMAILS", "").split(",") if e.strip()}


def data_source(user):
    """('role', arn) for a connected account; ('self', None) only for the stack owner."""
    if user.get("roleArn"):
        return "role", user["roleArn"]
    if user["email"].lower() in owner_emails():
        return "self", None
    raise HttpError(409, "Connect your AWS account to see your bill.")


def _creds_for(user, mode, role_arn):
    return ce.assume_role(role_arn, user["externalId"]) if mode == "role" else None


def get_raw_month_to_date(user, now, force=False):
    mode, role_arn = data_source(user)
    today = now.date()
    key = f"spend#{role_arn or 'self'}#{today:%Y-%m}"
    table = cache_table()
    item = table.get_item(Key={"pk": key}).get("Item")
    if item:
        age = int(now.timestamp()) - int(item["fetchedAt"])
        if age < SPEND_TTL and not (force and age >= MIN_REFRESH):
            return json.loads(item["json"])
    start, end = ce.month_to_date_window(today)
    raw = ce.fetch_period(start, end, _creds_for(user, mode, role_arn))
    raw["cachedAt"] = now.isoformat(timespec="seconds")
    raw["source"] = mode
    table.put_item(
        Item={
            "pk": key,
            "json": dumps(raw),
            "fetchedAt": int(now.timestamp()),
            "ttl": int(now.timestamp()) + SPEND_TTL * 3,
        }
    )
    return raw


def _fx():
    fx = get_fx() or refresh()
    if not fx:
        raise HttpError(503, "The exchange rate isn't available yet. Try again in a minute.")
    return fx


def get_spend(user, now=None, force=False):
    now = now or datetime.now(timezone.utc)
    raw = get_raw_month_to_date(user, now, force)
    today = now.date()
    return report.build_summary(
        raw,
        _fx(),
        user_settings(user),
        days_elapsed=today.day,
        month_days=report.days_in_month(today),
        month=f"{today:%Y-%m}",
        as_of=today.isoformat(),
    )


def get_previous_month(user, now):
    """Final figures for last month (used by the monthly digest). Not cached: runs once a month."""
    mode, role_arn = data_source(user)
    start, end = report.previous_month_window(now.date())
    raw = ce.fetch_period(start, end, _creds_for(user, mode, role_arn))
    raw["source"] = mode
    days = (end - start).days
    return report.build_summary(
        raw,
        _fx(),
        user_settings(user),
        days_elapsed=days,
        month_days=days,
        month=f"{start:%Y-%m}",
        as_of=(end - timedelta(days=1)).isoformat(),
    )

