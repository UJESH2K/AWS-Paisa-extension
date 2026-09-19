"""Sends the rupee bill summary to the user's confirmed inbox via SNS."""
from datetime import datetime, timezone

import notify
import report
import spend_handler
from common import HttpError


def send_summary(user, kind="projection", now=None):
    now = now or datetime.now(timezone.utc)
    if not notify.is_confirmed(user["topicArn"], user["email"]):
        raise HttpError(409, "Confirm the subscription email from AWS first, then try again.")
    summary = spend_handler.get_previous_month(user, now) if kind == "final" else spend_handler.get_spend(user, now)
    subject, message = report.email_text(summary, kind)
    notify.publish(user["topicArn"], subject, message)
    return {"ok": True, "sentTo": user["email"], "subject": subject}
