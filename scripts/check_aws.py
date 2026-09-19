"""Classify what this machine can actually do with AWS right now.

Several very different failures look alike on the command line, and confusing
them wastes a debugging cycle (or worse, produces a false "it's deployed"
claim). This shells out to the AWS CLI rather than using boto3, because the CLI
owns the `aws login` device-flow session; boto3 cannot always read it and fails
with MissingDependencyException, which is a tooling problem and not an account
problem.

  NO_CREDENTIALS  nothing configured at all
  EXPIRED         `aws login` session has lapsed; the user must sign in again
  NOT_ACTIVATED   credentials fine, but the account has not finished signup, so
                  deployable services answer OptInRequired / NotSignedUp
  READY           deployable

Usage: python scripts/check_aws.py [--json]
Exit code 0 when READY, 1 otherwise, so a loop can gate a deploy on it.
"""
import json
import shutil
import subprocess
import sys

REGION = "ap-south-1"

# Ordered: the first probe that fails decides, except for per-service blocks.
PROBES = [
    ("sts", ["sts", "get-caller-identity"], None),
    ("s3", ["s3api", "list-buckets"], None),
    ("cloudformation", ["cloudformation", "list-stacks", "--max-items", "1"], REGION),
    ("dynamodb", ["dynamodb", "list-tables"], REGION),
    ("lambda", ["lambda", "list-functions", "--max-items", "1"], REGION),
    ("sns", ["sns", "list-topics"], REGION),
    ("cost_explorer", ["ce", "get-dimension-values", "--time-period", "Start=2026-09-01,End=2026-09-02", "--dimension", "SERVICE"], "us-east-1"),
    ("cloudwatch_billing", ["cloudwatch", "list-metrics", "--namespace", "AWS/Billing"], "us-east-1"),
]

NOT_ACTIVATED = ("OptInRequired", "SubscriptionRequired", "NotSignedUp")
EXPIRED = ("expired", "revoked", "malformed", "ExpiredToken", "InvalidClientTokenId", "InvalidGrant")
NO_CREDS = ("Unable to locate credentials", "NoCredentials", "You must specify a region")
# Deploying needs these; Cost Explorer and CloudWatch are data sources, not blockers.
REQUIRED_FOR_DEPLOY = {"s3", "cloudformation", "dynamodb", "lambda", "sns"}


def run(args, region):
    cmd = ["aws", *args, "--output", "json"]
    if region:
        cmd += ["--region", region]
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    except subprocess.TimeoutExpired:
        return False, "Timeout"
    if p.returncode == 0:
        return True, "ok"
    blob = (p.stderr or "") + (p.stdout or "")
    for needle in NOT_ACTIVATED:
        if needle in blob:
            return False, needle
    for needle in EXPIRED:
        if needle in blob:
            return False, "Expired"
    for needle in NO_CREDS:
        if needle in blob:
            return False, "NoCredentials"
    first = next((ln.strip() for ln in blob.splitlines() if ln.strip()), "unknown error")
    return False, first[:120]


def status():
    if not shutil.which("aws"):
        return {"status": "NO_CREDENTIALS", "detail": "The AWS CLI is not installed or not on PATH.", "checks": {}}

    checks = {}
    _, sts_args, sts_region = PROBES[0]
    ok, code = run(sts_args, sts_region)
    checks["sts"] = code
    if not ok:
        if code == "NoCredentials":
            return {"status": "NO_CREDENTIALS", "detail": "Run `aws login` (or `aws configure`) first.", "checks": checks}
        if code == "Expired":
            return {
                "status": "EXPIRED",
                "detail": "The `aws login` session has lapsed. Run `aws login` again, then re-run this check.",
                "checks": checks,
            }
        return {"status": "ERROR", "detail": f"sts failed: {code}", "checks": checks}

    blocked, expired = [], []
    for name, args, region in PROBES[1:]:
        ok, code = run(args, region)
        checks[name] = code
        if ok:
            continue
        if code in NOT_ACTIVATED:
            blocked.append(name)
        elif code == "Expired":
            expired.append(name)

    if expired:
        return {"status": "EXPIRED", "detail": "The `aws login` session has lapsed. Run `aws login` again.", "checks": checks}

    still_blocked = REQUIRED_FOR_DEPLOY & set(blocked)
    if still_blocked:
        return {
            "status": "NOT_ACTIVATED",
            "detail": (
                "Credentials work, but the account has not finished signup, so nothing can be deployed. "
                "Add a valid payment method and complete phone verification at "
                "console.aws.amazon.com > Billing > Payment preferences. "
                f"Blocked: {', '.join(sorted(still_blocked))}."
            ),
            "checks": checks,
        }

    note = ""
    if "cost_explorer" in blocked:
        note = " Cost Explorer is off, so Paisa will use the CloudWatch billing-metrics fallback."
    return {"status": "READY", "detail": "Deployable." + note, "checks": checks}


def main():
    result = status()
    if "--json" in sys.argv:
        print(json.dumps(result, indent=2))
    else:
        print(result["status"])
        print(result["detail"])
        if result["checks"]:
            print("  " + "  ".join(f"{k}={v}" for k, v in result["checks"].items()))
    return 0 if result["status"] == "READY" else 1


if __name__ == "__main__":
    raise SystemExit(main())
