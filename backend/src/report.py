"""Pure functions: turn raw USD spend into the response summary and email text."""
import calendar
from datetime import date, timedelta

from convert import convert

TOP_N = 5


def fmt_inr(n, decimals=2, symbol="₹"):
    """Indian digit grouping: 1234567.891 -> ₹12,34,567.89"""
    sign = "-" if n < 0 else ""
    whole, _, frac = f"{abs(n):.{decimals}f}".partition(".")
    head, tail = whole[:-3], whole[-3:]
    groups = []
    while head:
        groups.insert(0, head[-2:])
        head = head[:-2]
    whole = ",".join(groups + [tail])
    return f"{sign}{symbol}{whole}" + (f".{frac}" if decimals else "")


def days_in_month(d):
    return calendar.monthrange(d.year, d.month)[1]


def build_summary(raw, fx, settings, days_elapsed, month_days, month, as_of):
    """raw = {usd, services:[{name,usd}], cachedAt?, source?}; fx = {rate, fetchedAt, source}."""
    r = convert(
        usd_spend=raw["usd"],
        fx_rate=fx["rate"],
        markup_pct=settings["markup_pct"],
        gst_pct=settings["gst_pct"],
        entity=settings["entity"],
        days_elapsed=days_elapsed,
        days_in_month=month_days,
    )
    per_usd = r["inr_total"] / raw["usd"] if raw["usd"] > 0 else fx["rate"] * (
        (1 + settings["markup_pct"] if settings["entity"] == "AWS_INC" else 1) * (1 + settings["gst_pct"])
    )
    top = raw["services"][:TOP_N]
    other = max(raw["usd"] - sum(s["usd"] for s in top), 0.0)
    return {
        "month": month,
        "asOf": as_of,
        "usd": raw["usd"],
        "fx": {"rate": fx["rate"], "fetchedAt": fx["fetchedAt"], "source": fx.get("source", "")},
        "settings": {k: settings[k] for k in ("entity", "markup_pct", "gst_pct", "digest", "threshold_inr")},
        "breakdown": {
            "base": r["inr_base"],
            "markup": r["inr_markup"],
            "gst": r["inr_gst"],
            "total": r["inr_total"],
        },
        "projection": r["projection"],
        "daysElapsed": days_elapsed,
        "daysInMonth": month_days,
        "services": [{"name": s["name"], "usd": s["usd"], "inr": s["usd"] * per_usd} for s in top],
        "otherUsd": other,
        "otherInr": other * per_usd,
        "cachedAt": raw.get("cachedAt"),
        "source": raw.get("source", "self"),
        "provider": raw.get("provider", "cost_explorer"),
        "providerNote": raw.get("note", ""),
        "excludes": ["Credit", "Refund", "Tax"] if raw.get("provider", "cost_explorer") == "cost_explorer" else [],
    }


def month_label(ym):
    y, m = (int(x) for x in ym.split("-"))
    return f"{calendar.month_name[m]} {y}"


def email_text(summary, kind="projection"):
    """Returns (subject, message). kind: 'projection' | 'final' | 'alert'."""
    s = summary
    b = s["breakdown"]
    st = s["settings"]
    inc = st["entity"] == "AWS_INC"
    label = month_label(s["month"])
    rs = "Rs "  # SNS subjects must be ASCII, so no rupee sign there
    if kind == "final":
        subject = f"Paisa: your {label} AWS bill was about {fmt_inr(b['total'], 0, rs)} (estimate)"
        headline = f"Your {label} AWS bill, in rupees (estimate)"
        total_line = f"Estimated bill for the month: {fmt_inr(b['total'])}"
    elif kind == "alert":
        subject = f"Paisa alert: {label} AWS bill is tracking to {fmt_inr(s['projection'], 0, rs)}"
        headline = f"Heads up: your {label} AWS bill is tracking above your {fmt_inr(st['threshold_inr'] or 0, 0)} alert"
        total_line = f"Projected month-end bill: {fmt_inr(s['projection'])}"
    else:
        subject = f"Paisa: your {label} AWS bill is tracking to {fmt_inr(s['projection'], 0, rs)} (estimate)"
        headline = f"Your {label} AWS bill so far, in rupees (estimate)"
        total_line = f"Projected month-end bill (incl. GST): {fmt_inr(s['projection'])}"

    lines = [
        headline,
        "=" * len(headline),
        "",
        f"As of {s['asOf']} (day {s['daysElapsed']} of {s['daysInMonth']})",
        "",
        f"AWS console spend (USD):      ${s['usd']:.2f}",
        f"x exchange rate:              {fmt_inr(s['fx']['rate'])} per USD",
        f"= Base:                       {fmt_inr(b['base'])}",
    ]
    if inc:
        lines.append(f"+ Card forex markup ({st['markup_pct'] * 100:.2f}%): {fmt_inr(b['markup'])}")
    else:
        lines.append("+ Card forex markup:          none (AISPL invoices in INR)")
    lines += [
        f"+ GST ({st['gst_pct'] * 100:.0f}%):                 {fmt_inr(b['gst'])}",
        f"= Total so far:               {fmt_inr(b['total'])}",
        "",
        total_line,
        "",
    ]
    if s["services"]:
        lines.append("Top services")
        for svc in s["services"]:
            lines.append(f"  {svc['name']:<38} {fmt_inr(svc['inr'], 0):>14}   (${svc['usd']:.2f})")
        if s["otherUsd"] > 0.005:
            lines.append(f"  {'Everything else':<38} {fmt_inr(s['otherInr'], 0):>14}   (${s['otherUsd']:.2f})")
        lines.append("")
    lines += [
        "This is an estimate. " + (s.get("providerNote") or ""),
        f"Exchange rate: mid-market from {s['fx']['source'] or 'a public source'}; your bank's rate on the",
        "settlement date, your card's markup and your AWS entity decide the real figure.",
        "",
        "Sent by Paisa. Change or stop these emails in the Paisa panel on the AWS console.",
    ]
    return subject, "\n".join(lines)


def previous_month_window(today: date):
    """[first of last month, first of this month)."""
    first_this = today.replace(day=1)
    last_prev = first_this - timedelta(days=1)
    return last_prev.replace(day=1), first_this
