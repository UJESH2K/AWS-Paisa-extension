"""SNS email helpers. One topic per user; email delivery is free-tier and the
subscription confirmation doubles as proof the user owns the address."""
import boto3

from common import REGION


def _sns():
    return boto3.client("sns", region_name=REGION)


def create_topic(user_id):
    return _sns().create_topic(Name=f"paisa-{user_id[:20]}")["TopicArn"]


def subscribe_email(topic_arn, email):
    """Sends (or re-sends) the confirmation email."""
    _sns().subscribe(TopicArn=topic_arn, Protocol="email", Endpoint=email)


def is_confirmed(topic_arn, email):
    resp = _sns().list_subscriptions_by_topic(TopicArn=topic_arn)
    for sub in resp.get("Subscriptions", []):
        if sub.get("Endpoint", "").lower() == email.lower():
            return sub["SubscriptionArn"].startswith("arn:")
    return False


def delete_topic(topic_arn):
    """Removing the topic also removes its subscription, so we stop being able
    to email the address at all."""
    _sns().delete_topic(TopicArn=topic_arn)


def publish(topic_arn, subject, message):
    # SNS subjects must be ASCII, single line, <= 100 chars.
    subject = subject.encode("ascii", "replace").decode("ascii").replace("\n", " ")[:100]
    _sns().publish(TopicArn=topic_arn, Subject=subject, Message=message)
