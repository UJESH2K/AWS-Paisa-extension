"""Local stand-in for the Paisa API. Responses are built with the REAL backend
report code so the shape matches production exactly."""
import json
import re
import sys
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer

sys.path.insert(0, r"C:\Users\aadit\OneDrive\Desktop\awshack\paisa\backend\src")
import report  # noqa: E402

RAW = {
    "usd": 47.30,
    "services": [{"name": n, "usd": u} for n, u in [("Amazon EC2", 18.62), ("Amazon RDS", 11.4), ("Amazon S3", 6.85), ("Amazon CloudFront", 4.1), ("AWS Lambda", 2.95), ("Amazon SNS", 0.5)]],
    "cachedAt": "2026-09-20T06:00:00+00:00",
    "source": "self",
}
FX = {"rate": 95.88, "fetchedAt": "2026-09-19T00:30:00+00:00", "source": "frankfurter.dev (ECB)"}
DEFAULT_SETTINGS = {"entity": "AWS_INC", "markup_pct": 0.035, "gst_pct": 0.18, "digest": "monthly", "threshold_inr": None}
SETTINGS = {}  # per-email, so a settings change is observable
STARTS = {}
CONNECTED = set()
LOG = []
ROLE_ARN = re.compile(r"^arn:aws:iam::\d{12}:role/[\w+=,.@/-]{1,200}$")


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "authorization, content-type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _settings(self, email):
        return SETTINGS.setdefault(email, dict(DEFAULT_SETTINGS))

    def do_OPTIONS(self):
        self._send(204, {})

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}") if n else {}

    def _email(self):
        auth = self.headers.get("Authorization", "")
        if not auth.startswith("Bearer tok-"):
            return None
        return auth[len("Bearer tok-"):]

    def do_GET(self):
        path = self.path.split("?")[0]
        LOG.append(("GET", self.path))
        if path == "/_log":
            return self._send(200, LOG)
        if path == "/me":
            email = self._email()
            if not email:
                return self._send(401, {"error": "Sign in to continue."})
            return self._send(200, {
                "email": email,
                "emailConfirmed": True,
                "externalId": "ext" + "0" * 29,
                "connected": email in CONNECTED,
                "roleArn": "arn:aws:iam::123456789012:role/PaisaReadOnlyRole" if email in CONNECTED else None,
                "isOwner": not email.startswith("stranger"),
                "settings": self._settings(email),
            })
        if path == "/spend":
            email = self._email()
            if not email:
                return self._send(401, {"error": "Sign in to continue."})
            if email.startswith("stranger") and email not in CONNECTED:
                return self._send(409, {"error": "Connect your AWS account to see your bill."})
            today = datetime.now(timezone.utc).date()
            return self._send(200, report.build_summary(RAW, FX, self._settings(email), today.day, report.days_in_month(today), f"{today:%Y-%m}", today.isoformat()))
        self._send(404, {"error": "Not found."})

    def do_PUT(self):
        path = self.path.split("?")[0]
        body = self._body()
        LOG.append(("PUT", path))
        if path == "/settings":
            email = self._email()
            if not email:
                return self._send(401, {"error": "Sign in to continue."})
            current = self._settings(email)
            for key in ("entity", "markup_pct", "gst_pct", "digest", "threshold_inr"):
                if key in body:
                    current[key] = body[key]
            return self._send(200, {"ok": True, "settings": current})
        self._send(404, {"error": "Not found."})

    def do_POST(self):
        path = self.path.split("?")[0]
        body = self._body()
        LOG.append(("POST", path))
        if path == "/auth/start":
            email = (body.get("email") or "").lower()
            STARTS[email] = STARTS.get(email, 0) + 1
            return self._send(200, {"status": "confirm_subscription" if STARTS[email] == 1 else "code_sent"})
        if path == "/auth/verify":
            if body.get("code") == "123456":
                return self._send(200, {"token": "tok-" + body["email"].lower(), "email": body["email"].lower()})
            return self._send(401, {"error": "That code is wrong or has expired. Ask for a new one."})
        if path == "/email-summary":
            email = self._email()
            if not email:
                return self._send(401, {"error": "Sign in to continue."})
            return self._send(200, {"ok": True, "sentTo": email, "subject": "Paisa: test"})
        if path == "/connect":
            email = self._email()
            if not email:
                return self._send(401, {"error": "Sign in to continue."})
            arn = body.get("roleArn")
            if not isinstance(arn, str) or not ROLE_ARN.match(arn):
                return self._send(400, {"error": "That doesn't look like an IAM role ARN."})
            if "Broken" in arn:  # stands in for a role Paisa cannot assume
                return self._send(400, {"error": "Paisa couldn't assume that role. Check its trust policy."})
            CONNECTED.add(email)
            return self._send(200, {"ok": True, "connected": True})
        if path == "/auth/signout":
            return self._send(200, {"ok": True})
        self._send(404, {"error": "Not found."})


HTTPServer(("127.0.0.1", 8766), H).serve_forever()
