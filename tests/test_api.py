import json
from pathlib import Path

from fastapi.testclient import TestClient

from api.index import app

client = TestClient(app)
PRICES = json.loads((Path(__file__).resolve().parent.parent / "prices.json").read_text(encoding="utf-8"))


def test_health():
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"ok": True}


def test_config_is_prices_without_readme():
    r = client.get("/api/config")
    assert r.status_code == 200
    body = r.json()
    assert "_readme" not in body
    expected = {k: v for k, v in PRICES.items() if k != "_readme"}
    assert body == expected


def test_quote_windows():
    r = client.post(
        "/api/quote",
        json={
            "quote_type": "windows",
            "property": {"kind": "standard", "bedrooms": 3},
            "frequency": "4",
            "conservatory": "standard",
            "large_conservatory_price": None,
            "internal": False,
            "conservatory_roof": {"external_panels": 0, "internal_panels": 0},
            "velux": {"external": 0, "internal": 0},
            "lanterns": {
                "small": {"external": 0, "internal": 0},
                "medium": {"external": 0, "internal": 0},
                "large": {"external": 0, "internal": 0},
                "larger_price": None,
            },
            "override": None,
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {
        "quote_type", "basis", "basis_label", "lines", "subtotal", "override",
        "total", "warnings", "comparison", "summary_text",
    }
    assert body["total"] == 3600
    assert body["comparison"][1] == {"frequency": "6", "label": "Every 6 weeks", "total": 3700, "selected": False}


def test_quote_gutters():
    r = client.post(
        "/api/quote",
        json={
            "quote_type": "gutters",
            "property": {"kind": "standard", "bedrooms": 2},
            "service": "package3",
            "conservatory": True,
            "heavily_soiled": False,
            "manual_price": None,
            "extras": [{"name": "Hedgehog Gutter Guards", "selected": True, "price": None}],
            "override": None,
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 18000
    assert body["lines"][-1]["amount"] is None


def test_validation_error_shape():
    r = client.post(
        "/api/quote",
        json={
            "quote_type": "windows",
            "property": {"kind": "standard", "bedrooms": 3},
            "frequency": "4",
            "conservatory": "large",
        },
    )
    assert r.status_code == 422
    assert r.json() == {
        "errors": [{"field": "large_conservatory_price", "message": "Enter the conservatory charge"}]
    }


def test_unknown_quote_type_is_422():
    r = client.post("/api/quote", json={"quote_type": "roofs"})
    assert r.status_code == 422
    assert r.json() == {"errors": [{"field": "quote_type", "message": "Choose a windows or gutters quote"}]}


def test_wrong_types_are_friendly_422():
    r = client.post(
        "/api/quote",
        json={"quote_type": "windows", "property": {"kind": "standard", "bedrooms": "three"}, "frequency": "4"},
    )
    assert r.status_code == 422
    assert r.json()["errors"] == [
        {"field": "property.bedrooms", "message": "Choose a bedroom count between 1 and 5"}
    ]


def test_non_object_body_is_422():
    r = client.post("/api/quote", json=[1, 2, 3])
    assert r.status_code == 422
    assert r.json() == {"errors": [{"field": "body", "message": "The request must be a JSON object"}]}


def test_malformed_json_is_422():
    r = client.post("/api/quote", content=b"{not json", headers={"content-type": "application/json"})
    assert r.status_code == 422
    assert r.json() == {"errors": [{"field": "body", "message": "The request must be valid JSON"}]}
