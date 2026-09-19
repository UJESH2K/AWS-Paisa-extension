"""Pure USD -> INR conversion logic for Paisa. No I/O, no AWS, no clock.

Every intermediate value is returned so the UI can show its inputs.
All figures are estimates: entity, markup and GST are user settings.
"""

ENTITIES = ("AWS_INC", "AISPL")


def convert(
    usd_spend,
    fx_rate,
    markup_pct=0.035,
    gst_pct=0.18,
    entity="AWS_INC",
    days_elapsed=1,
    days_in_month=30,
):
    """Convert month-to-date USD spend into an INR breakdown and projection.

    Percentages are fractions (0.035 == 3.5%).

    AWS_INC: the card is charged in USD, the bank adds its forex markup, and
             GST applies to the base plus the markup.
    AISPL:   invoiced in INR with GST; no card forex markup.

    days_elapsed is the number of days the usd_spend covers (must be >= 1);
    the caller decides how to count it.
    """
    if entity not in ENTITIES:
        raise ValueError(f"entity must be one of {ENTITIES}, got {entity!r}")
    if usd_spend < 0:
        raise ValueError("usd_spend must be >= 0")
    if fx_rate <= 0:
        raise ValueError("fx_rate must be > 0")
    if days_elapsed < 1:
        raise ValueError("days_elapsed must be >= 1")
    if days_in_month < days_elapsed:
        raise ValueError("days_in_month must be >= days_elapsed")

    inr_base = usd_spend * fx_rate
    if entity == "AWS_INC":
        inr_markup = inr_base * markup_pct
        inr_gst = (inr_base + inr_markup) * gst_pct
    else:
        inr_markup = 0.0
        inr_gst = inr_base * gst_pct

    inr_total = inr_base + inr_markup + inr_gst
    projection = inr_total / days_elapsed * days_in_month

    return {
        "usd_spend": usd_spend,
        "fx_rate": fx_rate,
        "markup_pct": markup_pct if entity == "AWS_INC" else 0.0,
        "gst_pct": gst_pct,
        "entity": entity,
        "days_elapsed": days_elapsed,
        "days_in_month": days_in_month,
        "inr_base": inr_base,
        "inr_markup": inr_markup,
        "inr_gst": inr_gst,
        "inr_total": inr_total,
        "projection": projection,
    }
