"""Scheduled daily (07:00 IST): threshold alerts and the monthly digest.

Digest: on the 1st, last month's final estimate; on the 15th, the projection for
the month in progress. Alerts fire at most once a month per user. Spend comes
through the cache in spend_handler, so this costs at most one Cost Explorer
request per user per day.
"""
import logging
from datetime import datetime, timezone

import email_handler
import notify
import spend_handler
from common import from_ddb, user_settings, users_table

log = logging.getLogger()
log.setLevel(logging.INFO)


def _all_users():
    table = users_table()
    kwargs = {"FilterExpression": "begins_with(pk, :p)", "ExpressionAttributeValues": {":p": "user#"}}
    while True:
        resp = table.scan(**kwargs)
        yield from (from_ddb(i) for i in resp.get("Items", []))
        if "LastEvaluatedKey" not in resp:
            return
        kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]


def _mark(user, field, value):
    users_table().update_item(
        Key={"pk": user["pk"]},
        UpdateExpression=f"SET {field} = :v",
        ExpressionAttributeValues={":v": value},
    )


def check_user(user, now):
    s = user_settings(user)
    today = now.date()
    month = f"{today:%Y-%m}"
    sent = []

    if s.get("threshold_inr") and user.get("lastAlertMonth") != month:
        summary = spend_handler.get_spend(user, now)
        if summary["projection"] > s["threshold_inr"]:
            email_handler.send_summary(user, "alert", now)
            _mark(user, "lastAlertMonth", month)
            sent.append("alert")

    if s.get("digest") == "monthly" and user.get("lastDigest") != today.isoformat():
        kind = "final" if today.day == 1 else "projection" if today.day == 15 else None
        if kind:
            email_handler.send_summary(user, kind, now)
            _mark(user, "lastDigest", today.isoformat())
            sent.append(kind)
    return sent


def run(now=None):
    now = now or datetime.now(timezone.utc)
    results = {}
    for user in _all_users():
        try:
            if not notify.is_confirmed(user["topicArn"], user["email"]):
                continue  # can't reach them yet
            sent = check_user(user, now)
            if sent:
                results[user["pk"]] = sent
        except Exception:  # one user's failure must not stop the rest
            log.exception("digest failed for %s", user.get("pk"))
    log.info("digest run complete: %s", results)
    return results


def handler(event, context):
    return {"sent": run()}
