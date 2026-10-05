from datetime import date

import pytest
from fastapi.testclient import TestClient

from api.index import app
from pricing import ValidationError, basket, quote

TODAY = date(2026, 10, 5)
client = TestClient(app)


def windows(**kw):
    req = {"quote_type": "windows", "property": {"kind": "standard", "bedrooms": 3}, "frequency": "4"}
    req.update(kw)
    return req


def gutters(**kw):
    req = {"quote_type": "gutters", "property": {"kind": "standard", "bedrooms": 3}, "service": "package3",
           "conservatory": False, "heavily_soiled": False}
    req.update(kw)
    return req


# --- Item titles on single quotes ----------------------------------------------


def test_windows_title():
    r = quote(windows(conservatory="standard", internal=True), today=TODAY)
    assert r["title"] == "3 bed windows · every 4 weeks · conservatory · inside too"
    assert r["frequency"] == "4"


def test_windows_one_off_other_title():
    r = quote(windows(property={"kind": "other", "description": "Flat above shop", "price": 40},
                      frequency="one_off"), today=TODAY)
    assert r["title"] == "Flat above shop windows · one-off"
    assert r["frequency"] == "one_off"


def test_gutters_title():
    r = quote(gutters(conservatory=True, heavily_soiled=True), today=TODAY)
    assert r["title"] == "3 bed gutters · Package 3 · conservatory · heavily soiled"
    assert r["frequency"] is None


# --- Basket ---------------------------------------------------------------------


def test_empty_basket():
    r = basket({"items": []}, today=TODAY)
    assert r["items"] == []
    assert r["groups"] == []
    assert r["count"] == 0


def test_groups_by_frequency_and_one_off():
    r = basket({"items": [
        windows(frequency="8"),                         # 2900 per visit, 8 weekly
        windows(conservatory="standard"),               # 3600 per visit, 4 weekly
        windows(property={"kind": "standard", "bedrooms": 2}),  # 2400 per visit, 4 weekly
        windows(frequency="one_off"),                   # 6200 one-off
        gutters(),                                      # 20000 one-off
    ]}, today=TODAY)
    assert r["count"] == 5
    assert r["groups"] == [
        {"basis": "per_visit", "frequency": "4", "label": "Every 4 weeks", "suffix": "per visit",
         "total": 6000, "items": 2},
        {"basis": "per_visit", "frequency": "8", "label": "Every 8 weeks", "suffix": "per visit",
         "total": 2900, "items": 1},
        {"basis": "one_off", "frequency": None, "label": "One-off total", "suffix": "one-off",
         "total": 26200, "items": 2},
    ]


def test_items_keep_their_quotes_and_override_counts():
    r = basket({"items": [gutters(override={"total": 150, "reason": "Repeat customer"})]}, today=TODAY)
    item = r["items"][0]
    assert item["ok"] is True
    assert item["index"] == 0
    assert item["quote"]["total"] == 15000
    assert item["quote"]["subtotal"] == 20000
    assert r["groups"][0]["total"] == 15000


def test_invalid_item_is_reported_and_left_out_of_totals():
    r = basket({"items": [windows(conservatory="large"), gutters()]}, today=TODAY)
    bad, good = r["items"]
    assert bad["ok"] is False
    assert bad["quote"] is None
    assert bad["errors"] == [{"field": "large_conservatory_price", "message": "Enter the conservatory charge"}]
    assert good["ok"] is True
    assert r["groups"] == [
        {"basis": "one_off", "frequency": None, "label": "One-off total", "suffix": "one-off",
         "total": 20000, "items": 1},
    ]
    assert "needs attention" in r["summary_text"]


def test_basket_summary_text():
    r = basket({"items": [windows(conservatory="standard"), gutters()]}, today=TODAY)
    text = r["summary_text"]
    lines = text.splitlines()
    assert lines[0] == "ABACUS WINDOW CLEANING: BASKET"
    assert lines[1] == "05/10/2026"
    assert "ITEM 1 OF 2: 3 bed windows · every 4 weeks · conservatory" in text
    assert "ITEM 2 OF 2: 3 bed gutters · Package 3" in text
    assert "TOTAL PER VISIT" not in text.split("BASKET TOTALS")[1].split("\n", 1)[0]
    totals = text.split("BASKET TOTALS")[1]
    assert "Every 4 weeks (per visit)" in totals and "£36.00" in totals
    assert "One-off total" in totals and "£200.00" in totals
    assert text.count("Prices include VAT.") == 1
    assert lines[-1] == "Prices include VAT."


@pytest.mark.parametrize("body", [None, [], {"items": "x"}, {}])
def test_bad_basket_body(body):
    with pytest.raises(ValidationError) as exc:
        basket(body, today=TODAY)
    assert exc.value.errors[0]["field"] in ("body", "items")


def test_too_many_items():
    with pytest.raises(ValidationError):
        basket({"items": [gutters()] * 51}, today=TODAY)


# --- API ------------------------------------------------------------------------


def test_api_basket():
    r = client.post("/api/basket", json={"items": [windows(), gutters()]})
    assert r.status_code == 200
    body = r.json()
    assert body["count"] == 2
    assert [g["total"] for g in body["groups"]] == [2700, 20000]


def test_api_basket_bad_json():
    r = client.post("/api/basket", content=b"{nope", headers={"content-type": "application/json"})
    assert r.status_code == 422
    assert r.json()["errors"][0]["field"] == "body"
