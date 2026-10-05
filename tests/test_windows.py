from datetime import date

import pytest

from pricing import ValidationError, quote


def windows(**overrides):
    req = {
        "quote_type": "windows",
        "property": {"kind": "standard", "bedrooms": 3},
        "frequency": "4",
        "conservatory": "none",
    }
    req.update(overrides)
    return req


def amounts(result):
    return {line["key"]: line["amount"] for line in result["lines"]}


def warning_keys(result):
    return [w["key"] for w in result["warnings"]]


def errors_for(req):
    with pytest.raises(ValidationError) as exc:
        quote(req)
    return {e["field"]: e["message"] for e in exc.value.errors}


# --- Basic house prices ------------------------------------------------------


def test_three_bed_four_weekly_no_conservatory():
    r = quote(windows())
    assert r["quote_type"] == "windows"
    assert r["basis"] == "per_visit"
    assert r["basis_label"] == "per visit, every 4 weeks"
    assert r["lines"] == [{"key": "house", "label": "3 bed house: windows outside", "amount": 2700}]
    assert r["subtotal"] == 2700
    assert r["total"] == 2700
    assert r["override"] is None
    assert r["warnings"] == []


@pytest.mark.parametrize(
    "beds,freq,pence",
    [(1, "4", 1500), (2, "6", 2500), (4, "8", 3200), (5, "12", 4500), (2, "12", 2800)],
)
def test_regular_house_prices(beds, freq, pence):
    r = quote(windows(property={"kind": "standard", "bedrooms": beds}, frequency=freq))
    assert r["total"] == pence
    assert r["basis_label"] == f"per visit, every {freq} weeks"


def test_frequency_may_be_given_as_number():
    assert quote(windows(frequency=8))["total"] == 2900


def test_three_bed_four_weekly_standard_conservatory():
    r = quote(windows(conservatory="standard"))
    assert r["lines"] == [
        {"key": "house", "label": "3 bed house: windows outside", "amount": 2700},
        {"key": "conservatory", "label": "Conservatory/extension", "amount": 900},
    ]
    assert r["total"] == 3600


def test_five_bed_conservatory_addon():
    r = quote(windows(property={"kind": "standard", "bedrooms": 5}, conservatory="standard"))
    assert r["total"] == 3700 + 1200


def test_internal_doubles_house_and_conservatory():
    r = quote(windows(conservatory="standard", internal=True))
    assert amounts(r)["internal"] == 7200
    assert r["total"] == 10800
    assert [l["label"] for l in r["lines"]][-1] == "Internal windows"


# --- One-off -----------------------------------------------------------------


def test_one_off_three_bed():
    r = quote(windows(frequency="one_off"))
    assert r["basis"] == "one_off"
    assert r["basis_label"] == "one-off clean"
    assert r["total"] == 6200
    assert r["comparison"] is None


def test_one_off_three_bed_with_conservatory_uses_with_conservatory_price():
    r = quote(windows(frequency="one_off", conservatory="standard"))
    assert r["total"] == 8000
    assert amounts(r) == {"house": 6200, "conservatory": 1800}


def test_one_off_three_bed_with_conservatory_and_internal():
    r = quote(windows(frequency="one_off", conservatory="standard", internal=True))
    assert amounts(r)["internal"] == 16000
    assert r["total"] == 24000


# --- Large conservatory -------------------------------------------------------


def test_large_conservatory_regular_replaces_addon():
    r = quote(
        windows(
            property={"kind": "standard", "bedrooms": 4},
            frequency="8",
            conservatory="large",
            large_conservatory_price=20,
        )
    )
    assert r["lines"] == [
        {"key": "house", "label": "4 bed house: windows outside", "amount": 3200},
        {
            "key": "conservatory",
            "label": "Larger conservatory/extension (staff price)",
            "amount": 2000,
        },
    ]
    assert r["total"] == 5200
    assert warning_keys(r) == ["large_conservatory"]
    assert r["warnings"][0]["message"].startswith("Larger than average conservatory")


def test_large_conservatory_one_off_is_one_off_plus_staff_amount():
    r = quote(
        windows(
            property={"kind": "standard", "bedrooms": 2},
            frequency="one_off",
            conservatory="large",
            large_conservatory_price=25,
        )
    )
    assert amounts(r) == {"house": 5600, "conservatory": 2500}
    assert r["total"] == 8100


def test_large_conservatory_with_internal():
    r = quote(
        windows(
            property={"kind": "standard", "bedrooms": 2},
            frequency="one_off",
            conservatory="large",
            large_conservatory_price=25,
            internal=True,
        )
    )
    assert amounts(r)["internal"] == 2 * 8100
    assert r["total"] == 3 * 8100


def test_large_conservatory_requires_price():
    errs = errors_for(windows(conservatory="large"))
    assert errs == {"large_conservatory_price": "Enter the conservatory charge"}


def test_large_conservatory_price_ignored_when_not_large():
    r = quote(windows(conservatory="standard", large_conservatory_price=99))
    assert r["total"] == 3600


def test_staff_price_rounds_half_up_to_pence():
    r = quote(windows(conservatory="large", large_conservatory_price=10.005))
    assert amounts(r)["conservatory"] == 1001


# --- Other property ----------------------------------------------------------


def test_other_property():
    r = quote(
        windows(property={"kind": "other", "description": "6 bed detached", "price": 55})
    )
    assert r["lines"] == [
        {"key": "house", "label": "Other property (6 bed detached): windows outside", "amount": 5500}
    ]
    assert warning_keys(r) == ["other_property"]
    assert r["comparison"] is None
    assert r["basis_label"] == "per visit, every 4 weeks"


def test_other_property_internal_is_double_staff_price():
    r = quote(
        windows(
            property={"kind": "other", "description": "Flat", "price": 20.5},
            internal=True,
        )
    )
    assert amounts(r)["internal"] == 4100
    assert r["total"] == 6150


def test_other_property_requires_description_and_price():
    errs = errors_for(windows(property={"kind": "other"}))
    assert errs == {
        "property.description": "Describe the property",
        "property.price": "Enter your window price",
    }


def test_other_property_rejects_conservatory():
    errs = errors_for(
        windows(property={"kind": "other", "description": "x", "price": 10}, conservatory="standard")
    )
    assert "conservatory" in errs


# --- Conservatory roof --------------------------------------------------------


def test_roof_outside_minimum_applies():
    r = quote(windows(conservatory_roof={"external_panels": 2, "internal_panels": 0}))
    assert amounts(r)["roof_external"] == 2500
    labels = {l["key"]: l["label"] for l in r["lines"]}
    assert labels["roof_external"] == "Conservatory roof outside (2 panels, £25 minimum)"
    assert "roof_internal" not in amounts(r)


def test_roof_outside_above_minimum():
    r = quote(windows(conservatory_roof={"external_panels": 4}))
    assert amounts(r)["roof_external"] == 3200
    labels = {l["key"]: l["label"] for l in r["lines"]}
    assert labels["roof_external"] == "Conservatory roof outside (4 panels)"


def test_roof_inside_only_has_no_minimum():
    r = quote(windows(conservatory_roof={"external_panels": 0, "internal_panels": 2}))
    assert amounts(r) == {"house": 2700, "roof_internal": 3200}
    labels = {l["key"]: l["label"] for l in r["lines"]}
    assert labels["roof_internal"] == "Conservatory roof inside (2 panels)"


def test_roof_single_inside_panel():
    r = quote(windows(conservatory_roof={"internal_panels": 1}))
    assert amounts(r)["roof_internal"] == 1600
    assert r["lines"][-1]["label"] == "Conservatory roof inside (1 panel)"


def test_roof_not_doubled_by_internal():
    r = quote(windows(internal=True, conservatory_roof={"external_panels": 4}))
    assert amounts(r)["internal"] == 5400
    assert r["total"] == 2700 + 5400 + 3200


# --- Velux and lanterns -------------------------------------------------------


def test_velux():
    r = quote(windows(velux={"external": 3, "internal": 2}))
    a = amounts(r)
    assert a["velux_external"] == 450
    assert a["velux_internal"] == 600
    labels = {l["key"]: l["label"] for l in r["lines"]}
    assert labels["velux_external"] == "Velux outside × 3"
    assert labels["velux_internal"] == "Velux inside × 2"
    assert r["total"] == 2700 + 1050


def test_lanterns_per_size_and_side():
    r = quote(
        windows(
            lanterns={
                "small": {"external": 1, "internal": 0},
                "medium": {"external": 2, "internal": 1},
                "large": {"external": 0, "internal": 1},
                "larger_price": None,
            }
        )
    )
    a = amounts(r)
    assert a["lanterns_external"] == 1000 + 3000
    assert a["lanterns_internal"] == 3000 + 4000
    labels = {l["key"]: l["label"] for l in r["lines"]}
    assert labels["lanterns_external"] == "Roof lanterns outside: 1 small, 2 medium"
    assert labels["lanterns_internal"] == "Roof lanterns inside: 1 medium, 1 large"
    assert r["warnings"] == []


def test_lanterns_single_small_outside():
    r = quote(windows(lanterns={"small": {"external": 1}}))
    assert r["lines"][-1] == {
        "key": "lanterns_external",
        "label": "Roof lanterns outside: 1 small",
        "amount": 1000,
    }


def test_larger_lantern_price_and_warning():
    r = quote(windows(lanterns={"larger_price": 45}))
    assert amounts(r)["larger_lantern"] == 4500
    assert r["lines"][-1]["label"] == "Larger roof lantern/structure (staff price)"
    assert warning_keys(r) == ["larger_lantern"]
    assert r["total"] == 7200


def test_extras_on_one_off():
    r = quote(
        windows(
            frequency="one_off",
            velux={"external": 2},
            conservatory_roof={"external_panels": 1},
        )
    )
    assert r["total"] == 6200 + 300 + 2500


# --- Comparison --------------------------------------------------------------


def test_comparison_all_frequencies_with_same_options():
    r = quote(windows(conservatory="standard", velux={"external": 2}))
    assert r["comparison"] == [
        {"frequency": "4", "label": "Every 4 weeks", "total": 3900, "selected": True},
        {"frequency": "6", "label": "Every 6 weeks", "total": 4000, "selected": False},
        {"frequency": "8", "label": "Every 8 weeks", "total": 4100, "selected": False},
        {"frequency": "12", "label": "Every 12 weeks", "total": 4300, "selected": False},
    ]


def test_comparison_ignores_override_and_includes_internal():
    r = quote(
        windows(
            frequency="6",
            internal=True,
            override={"total": 10, "reason": "Friend"},
        )
    )
    totals = {c["frequency"]: c["total"] for c in r["comparison"]}
    assert totals == {"4": 8100, "6": 8400, "8": 8700, "12": 9300}
    assert [c["selected"] for c in r["comparison"]] == [False, True, False, False]
    assert r["total"] == 1000


def test_comparison_with_large_conservatory():
    r = quote(windows(conservatory="large", large_conservatory_price=20))
    assert [c["total"] for c in r["comparison"]] == [4700, 4800, 4900, 5100]


# --- Override ----------------------------------------------------------------


def test_override_replaces_total_and_keeps_subtotal():
    r = quote(windows(conservatory="standard", override={"total": 40, "reason": "Regular customer rate"}))
    assert r["subtotal"] == 3600
    assert r["total"] == 4000
    assert r["override"] == {"total": 4000, "reason": "Regular customer rate"}


def test_override_requires_reason():
    errs = errors_for(windows(override={"total": 40, "reason": "   "}))
    assert errs == {"override.reason": "Give a reason for the override"}


def test_override_requires_total():
    errs = errors_for(windows(override={"total": None, "reason": "x"}))
    assert errs == {"override.total": "Enter the override total"}


def test_override_zero_is_allowed():
    assert quote(windows(override={"total": 0, "reason": "Free re-clean"}))["total"] == 0


# --- Validation --------------------------------------------------------------


@pytest.mark.parametrize("beds", [0, 6, -1, 2.5, "3", True, None])
def test_bedrooms_must_be_1_to_5(beds):
    errs = errors_for(windows(property={"kind": "standard", "bedrooms": beds}))
    assert errs == {"property.bedrooms": "Choose a bedroom count between 1 and 5"}


def test_bad_frequency():
    errs = errors_for(windows(frequency="5"))
    assert errs == {"frequency": "Choose how often: every 4, 6, 8 or 12 weeks, or one-off"}


def test_bad_conservatory():
    errs = errors_for(windows(conservatory="huge"))
    assert errs == {"conservatory": "Choose none, standard or large for the conservatory/extension"}


def test_negative_count_rejected():
    errs = errors_for(windows(velux={"external": -1}))
    assert errs == {"velux.external": "Enter a whole number of 0 or more"}


def test_non_integer_count_rejected():
    errs = errors_for(windows(conservatory_roof={"external_panels": 1.5}))
    assert errs == {"conservatory_roof.external_panels": "Enter a whole number of 0 or more"}


def test_integral_float_count_accepted():
    assert quote(windows(velux={"external": 2.0}))["total"] == 3000


def test_negative_money_rejected():
    errs = errors_for(windows(conservatory="large", large_conservatory_price=-5))
    assert errs == {"large_conservatory_price": "Enter an amount of £0 or more"}


def test_text_money_rejected():
    errs = errors_for(windows(lanterns={"larger_price": "lots"}))
    assert errs == {"lanterns.larger_price": "Enter an amount in pounds"}


def test_lantern_count_validated():
    errs = errors_for(windows(lanterns={"medium": {"internal": -2}}))
    assert errs == {"lanterns.medium.internal": "Enter a whole number of 0 or more"}


def test_multiple_errors_reported_together():
    with pytest.raises(ValidationError) as exc:
        quote(windows(frequency="x", velux={"external": -1}, override={"total": 5, "reason": ""}))
    fields = [e["field"] for e in exc.value.errors]
    assert set(fields) == {"frequency", "velux.external", "override.reason"}


def test_unknown_quote_type():
    errs = errors_for({"quote_type": "roofs"})
    assert errs == {"quote_type": "Choose a windows or gutters quote"}


def test_body_must_be_object():
    errs = errors_for(["not", "a", "dict"])
    assert errs == {"body": "The request must be a JSON object"}


def test_bad_property_kind():
    errs = errors_for(windows(property={"kind": "castle"}))
    assert errs == {"property.kind": "Choose a standard house or another property"}


def test_missing_property():
    errs = errors_for({"quote_type": "windows", "frequency": "4"})
    assert errs == {"property.kind": "Choose a standard house or another property"}


# --- Summary text ------------------------------------------------------------


def test_summary_text_with_override():
    r = quote(
        windows(conservatory="standard", override={"total": 40, "reason": "Regular customer rate"}),
        today=date(2026, 10, 5),
    )
    text = r["summary_text"]
    lines = text.splitlines()
    assert lines[0] == "ABACUS WINDOW CLEANING: WINDOW QUOTE"
    assert lines[1] == "05/10/2026"
    assert "Property: 3 bed house" in lines
    assert "Frequency: Every 4 weeks" in lines
    assert "Conservatory/extension: Standard" in lines
    assert "3 bed house: windows outside".ljust(34) + "£27.00" in lines
    assert any(l.startswith("Calculated total") and l.endswith("£36.00") for l in lines)
    assert any(l.startswith("OVERRIDE") and "£40.00" in l and "(Reason: Regular customer rate)" in l for l in lines)
    assert any(l.startswith("TOTAL PER VISIT") and l.endswith("£40.00") for l in lines)
    assert lines[-1] == "Prices include VAT."


def test_summary_text_without_override_and_with_warning():
    r = quote(
        windows(frequency="one_off", conservatory="large", large_conservatory_price=30),
        today=date(2026, 1, 2),
    )
    text = r["summary_text"]
    assert "02/01/2026" in text
    assert "Frequency: One-off" in text
    assert "Calculated total" not in text
    assert "OVERRIDE" not in text
    assert "TOTAL (ONE-OFF)" in text
    assert "Larger than average conservatory/extension" in text
    assert text.splitlines()[-1] == "Prices include VAT."


def test_summary_text_uses_today_by_default():
    r = quote(windows())
    assert r["summary_text"].splitlines()[1].count("/") == 2
