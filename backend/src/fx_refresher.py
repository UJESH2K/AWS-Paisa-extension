"""Daily USD->INR mid-market rate into DynamoDB. Never blocks a request on the
network: readers serve the last good rate with its timestamp."""
import json
import logging
import urllib.request
from datetime import datetime, timezone

from common import fx_table, from_ddb, to_ddb

log = logging.getLogger()
log.setLevel(logging.INFO)

SOURCES = [
    ("frankfurter.dev (ECB)", "https://api.frankfurter.dev/v1/latest?base=USD&symbols=INR", lambda j: j["rates"]["INR"]),
    ("open.er-api.com", "https://open.er-api.com/v6/latest/USD", lambda j: j["rates"]["INR"]),
]


def fetch_rate():
    for name, url, parse in SOURCES:
        try:
            with urllib.request.urlopen(url, timeout=5) as resp:  # noqa: S310 (fixed https URLs)
                rate = float(parse(json.load(resp)))
            if rate > 0:
                return name, rate
        except Exception as e:  # try the next source
            log.warning("FX source %s failed: %s", name, e)
    return None


def get_fx():
    item = fx_table().get_item(Key={"pk": "USDINR"}).get("Item")
    return from_ddb(item) if item else None


def refresh():
    """Fetches a fresh rate and stores it; on failure keeps and returns the last good one."""
    found = fetch_rate()
    if not found:
        log.error("All FX sources failed; keeping the last stored rate")
        return get_fx()
    source, rate = found
    item = {
        "pk": "USDINR",
        "rate": rate,
        "source": source,
        "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    fx_table().put_item(Item=to_ddb(item))
    return item


def handler(event, context):
    fx = refresh()
    return {"ok": fx is not None, "fx": fx}
