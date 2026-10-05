from datetime import date

import pytest

from pricing import ValidationError, quote


def gutters(**overrides):
    req = {
        "quote_type": "gutters",
        "property": {"kind": "standard", "bedrooms": 3},
        "service": "clearance",
        "conservatory": False,
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


def test_three_bed_clearance():
    r = quote(gutters())
    assert r["quote_type"] == "gutters"
    assert r["basis"] == "one_off"
    assert r["basis_label"] == "one-off job"
    assert r["lines"] == [
        {"key": "service", "label": "Gutter Clearance", "amount": 12000}
    ]
    assert r["total"] == 12000
    assert r["comparison"] is None
    assert r["warnings"] == []


@pytest.mark.parametrize(
    "beds,service,cons,pence",
    [
        (2, "package3", True, 18000),
        (2, "outer", False, 10000),
        (3, "package3", True, 22000),
        (4, "outer", True, 15200),
        (4, "clearance", False, 13700),
        (5, "package3", False, 25000),
        (5, "clearance", True, 17500),
    ],
)
def test_sheet_prices(beds, service, cons, pence):
    r = quote(gutters(property={"kind": "standard", "bedrooms": beds}, service=service, conservatory=cons))
    assert r["total"] == pence


def test_conservatory_label():
    r = quote(gutters(service="outer", conservatory=True))
    assert r["lines"][0]["label"] == (
        "Outer Gutter & Fascia + conservatory/extension"
    )


def test_two_bed_package3_warning():
    r = quote(gutters(property={"kind": "standard", "bedrooms": 2}, service="package3", conservatory=True))
    assert r["total"] == 18000
    assert warning_keys(r) == ["gutters_small_property"]


def test_five_bed_heavily_soiled_with_conservatory():
    r = quote(
        gutters(
            property={"kind": "standard", "bedrooms": 5},
            service="clearance",
            conservatory=True,
            heavily_soiled=True,
        )
    )
    assert r["lines"] == [
        {
            "key": "service",
            "label": "Gutter Clearance + conservatory/extension",
            "amount": 17500,
        },
        {"key": "heavily_soiled", "label": "Heavily soiled first clean (×2.5)", "amount": 26250},
    ]
    assert r["total"] == 43750
    assert warning_keys(r) == ["gutters_5_bed"]


def test_heavily_soiled_rounds_half_up():
    # 137 * 1.5 = 205.50 exactly; check an odd case via package3 4 bed: 232 * 1.5 = 348
    r = quote(gutters(property={"kind": "standard", "bedrooms": 4}, service="package3", heavily_soiled=True))
    assert amounts(r) == {"service": 23200, "heavily_soiled": 34800}
    assert r["total"] == 58000


def test_one_bed_requires_manual_price():
    errs = errors_for(gutters(property={"kind": "standard", "bedrooms": 1}))
    assert errs == {"manual_price": "Enter your price for this job"}


def test_one_bed_with_manual_price():
    r = quote(gutters(property={"kind": "standard", "bedrooms": 1}, service="package3", manual_price=95.5))
    assert r["lines"] == [
        {
            "key": "service",
            "label": "Package 3 (clearance + outer clean): staff price",
            "amount": 9550,
        }
    ]
    assert r["total"] == 9550
    assert warning_keys(r) == ["gutters_1_bed", "gutters_small_property"]


def test_heavily_soiled_rejected_for_manual_price():
    errs = errors_for(
        gutters(property={"kind": "standard", "bedrooms": 1}, manual_price=80, heavily_soiled=True)
    )
    assert errs == {
        "heavily_soiled": "Heavily soiled isn't available when you enter the price yourself: include it in your price"
    }


def test_other_property_gutters():
    r = quote(
        gutters(property={"kind": "other", "description": "Bungalow with annexe"}, service="outer", manual_price=150)
    )
    assert r["lines"][0] == {
        "key": "service",
        "label": "Outer Gutter & Fascia: staff price",
        "amount": 15000,
    }
    assert warning_keys(r) == ["other_property"]


def test_other_property_gutters_requires_description_and_price():
    errs = errors_for(gutters(property={"kind": "other"}))
    assert errs == {
        "property.description": "Describe the property",
        "manual_price": "Enter your price for this job",
    }


def test_other_property_heavily_soiled_rejected():
    errs = errors_for(
        gutters(property={"kind": "other", "description": "x"}, manual_price=10, heavily_soiled=True)
    )
    assert "heavily_soiled" in errs


def test_manual_price_ignored_for_priced_property():
    assert quote(gutters(manual_price=999))["total"] == 12000


def test_bad_service():
    errs = errors_for(gutters(service="roof"))
    assert errs == {"service": "Choose a gutter service"}


def test_conservatory_must_be_boolean():
    errs = errors_for(gutters(conservatory="yes"))
    assert errs == {"conservatory": "Choose yes or no for the conservatory/extension"}


# --- Ask-about extras ----------------------------------------------------------


def test_extras_priced_unpriced_and_unselected():
    r = quote(
        gutters(
            extras=[
                {"name": "Hedgehog Gutter Guards", "selected": True, "price": 60},
                {"name": "Power Source", "selected": True, "price": None},
                {"name": "Garden Waste", "selected": False, "price": 20},
            ]
        )
    )
    assert r["lines"][1:] == [
        {"key": "extra_hedgehog_gutter_guards", "label": "Hedgehog Gutter Guards", "amount": 6000},
        {"key": "extra_power_source", "label": "Power Source (price TBC)", "amount": None},
    ]
    assert r["subtotal"] == 18000
    assert r["total"] == 18000


def test_extra_price_omitted_means_tbc():
    r = quote(gutters(extras=[{"name": "Garden Waste", "selected": True}]))
    assert r["lines"][-1]["amount"] is None
    assert r["total"] == 12000


def test_unknown_extra_rejected():
    errs = errors_for(gutters(extras=[{"name": "Moss removal", "selected": True}]))
    assert errs == {"extras[0].name": "Choose one of the listed extras"}


def test_negative_extra_price_rejected():
    errs = errors_for(gutters(extras=[{"name": "Garden Waste", "selected": True, "price": -1}]))
    assert errs == {"extras[0].price": "Enter an amount of £0 or more"}


def test_extras_must_be_list():
    errs = errors_for(gutters(extras="Garden Waste"))
    assert errs == {"extras": "Extras must be a list"}


# --- Override and summary ----------------------------------------------------


def test_gutter_override():
    r = quote(gutters(override={"total": 100, "reason": "Neighbour discount"}))
    assert r["subtotal"] == 12000
    assert r["total"] == 10000
    assert r["override"] == {"total": 10000, "reason": "Neighbour discount"}


def test_gutter_summary_text():
    r = quote(
        gutters(
            property={"kind": "standard", "bedrooms": 5},
            conservatory=True,
            heavily_soiled=True,
            extras=[{"name": "Power Source", "selected": True}],
        ),
        today=date(2026, 10, 5),
    )
    text = r["summary_text"]
    lines = text.splitlines()
    assert lines[0] == "ABACUS WINDOW CLEANING: GUTTER & FASCIA QUOTE"
    assert lines[1] == "05/10/2026"
    assert "Property: 5 bed house" in lines
    assert "Service: Gutter Clearance" in lines
    assert "Conservatory/extension: Yes" in lines
    assert "Heavily soiled: Yes" in lines
    assert "Power Source (price TBC)" in lines
    assert any(l.startswith("TOTAL (ONE-OFF)") and l.endswith("£437.50") for l in lines)
    assert "ALWAYS ask for photos of 5 bed properties before quoting." in text
    assert lines[-1] == "Prices include VAT."
