"""HTTP API entry point (API Gateway HTTP API, payload v2). Thin router: every
route below delegates to a module that is tested on its own."""
import json
import logging
import os

import auth_handler
import email_handler
import settings_handler
import spend_handler
from common import HttpError, err, ok, user_settings
from fx_refresher import get_fx
from notify import is_confirmed

log = logging.getLogger()
log.setLevel(logging.INFO)

MAX_BODY = 8 * 1024


def _body(event):
    raw = event.get("body") or ""
    if len(raw) > MAX_BODY:
        raise HttpError(413, "Request too large.")
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except ValueError as e:
        raise HttpError(400, "Body must be JSON.") from e
    if not isinstance(data, dict):
        raise HttpError(400, "Body must be a JSON object.")
    return data


def _me(user):
    return {
        "email": user["email"],
        "emailConfirmed": is_confirmed(user["topicArn"], user["email"]),
        "externalId": user["externalId"],
        "connected": bool(user.get("roleArn")),
        "roleArn": user.get("roleArn"),
        "isOwner": user["email"].lower() in spend_handler.owner_emails(),
        "settings": user_settings(user),
    }


def handler(event, context):
    if event.get("task"):  # EventBridge Scheduler: {"task": "fx" | "digest"}
        import scheduled

        return scheduled.handler(event, context)
    route = event.get("routeKey", "")
    try:
        if route == "GET /health":
            return ok({"ok": True, "fx": bool(get_fx())})

        body = _body(event)
        headers = event.get("headers") or {}

        if route == "POST /auth/start":
            return ok(auth_handler.start(body.get("email")))
        if route == "POST /auth/verify":
            return ok(auth_handler.verify(body.get("email"), body.get("code")))

        user = auth_handler.authenticate(headers)
        query = event.get("queryStringParameters") or {}

        if route == "GET /me":
            return ok(_me(user))
        if route == "GET /spend":
            return ok(spend_handler.get_spend(user, force=query.get("refresh") == "1"))
        if route == "PUT /settings":
            return ok(settings_handler.update_settings(user, body))
        if route == "POST /connect":
            return ok(settings_handler.connect_role(user, body))
        if route == "POST /email-summary":
            return ok(email_handler.send_summary(user, "projection"))
        if route == "POST /auth/signout":
            return ok(auth_handler.sign_out(headers))
        return err(404, "Not found.")
    except HttpError as e:
        return err(e.status, e.message)
    except Exception:
        log.exception("unhandled error on %s", route)
        return err(500, "Something went wrong on our side. Try again in a moment.")
