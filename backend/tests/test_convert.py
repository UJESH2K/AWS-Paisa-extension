import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from convert import convert  # noqa: E402


def test_aws_inc_breakdown():
    r = convert(100, 80, markup_pct=0.035, gst_pct=0.18, entity="AWS_INC",
                days_elapsed=10, days_in_month=30)
    assert r["inr_base"] == pytest.approx(8000)
    assert r["inr_markup"] == pytest.approx(280)
    assert r["inr_gst"] == pytest.approx((8000 + 280) * 0.18)
    assert r["inr_total"] == pytest.approx(8000 + 280 + 1490.4)
    assert r["projection"] == pytest.approx(r["inr_total"] * 3)


def test_aispl_has_no_markup():
    r = convert(100, 80, markup_pct=0.035, gst_pct=0.18, entity="AISPL",
                days_elapsed=15, days_in_month=30)
    assert r["inr_markup"] == 0
    assert r["markup_pct"] == 0
    assert r["inr_gst"] == pytest.approx(8000 * 0.18)
    assert r["inr_total"] == pytest.approx(8000 * 1.18)
    assert r["projection"] == pytest.approx(r["inr_total"] * 2)


def test_zero_spend():
    r = convert(0, 83.5, entity="AWS_INC", days_elapsed=5, days_in_month=30)
    assert r["inr_total"] == 0
    assert r["projection"] == 0


def test_day_one_of_month():
    r = convert(2, 80, entity="AWS_INC", days_elapsed=1, days_in_month=31)
    assert r["projection"] == pytest.approx(r["inr_total"] * 31)


def test_defaults_are_3_5_markup_18_gst():
    r = convert(1, 100, days_elapsed=1, days_in_month=30)
    assert r["markup_pct"] == 0.035
    assert r["gst_pct"] == 0.18


def test_returns_every_intermediate_value():
    r = convert(10, 80, days_elapsed=2, days_in_month=30)
    for key in ("usd_spend", "fx_rate", "markup_pct", "gst_pct", "inr_base",
                "inr_markup", "inr_gst", "inr_total", "projection"):
        assert key in r


def test_rejects_bad_input():
    with pytest.raises(ValueError):
        convert(1, 80, entity="NOPE")
    with pytest.raises(ValueError):
        convert(1, 80, days_elapsed=0)
    with pytest.raises(ValueError):
        convert(-1, 80)
    with pytest.raises(ValueError):
        convert(1, 0)
    with pytest.raises(ValueError):
        convert(1, 80, days_elapsed=10, days_in_month=5)
