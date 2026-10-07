import io
import json
import socket
import urllib.error

import pytest
from fastapi.testclient import TestClient

from api.index import app
from lookup import address
from lookup.address import InvalidPostcode, lookup, normalise_postcode

client = TestClient(app)


class _Resp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def _fake_urlopen(payload=None, status=200, raise_exc=None, seen=None):
    def fake(req, timeout=None):
        if seen is not None:
            seen.append((req.full_url if hasattr(req, "full_url") else req, timeout))
        if raise_exc is not None:
            raise raise_exc
        if status != 200:
            raise urllib.error.HTTPError(req.full_url, status, "err", {}, io.BytesIO(b"{}"))
        return _Resp(json.dumps(payload).encode())
    return fake


POSTCODES_IO_GU9 = {"status": 200, "result": {
    "postcode": "GU9 8AB", "admin_district": "Waverley", "admin_county": "Surrey",
    "parish": "Farnham", "region": "South East"}}


@pytest.fixture(autouse=True)
def no_paid_key(monkeypatch):
    monkeypatch.delenv("IDEAL_POSTCODES_API_KEY", raising=False)


# --- Normalisation ----------------------------------------------------------------


@pytest.mark.parametrize("raw,expected", [
    ("gu98ab", "GU9 8AB"),
    ("GU9 8AB", "GU9 8AB"),
    ("  gu9   8ab ", "GU9 8AB"),
    ("sw1a1aa", "SW1A 1AA"),
    ("m11ae", "M1 1AE"),
    ("GU511AA", "GU51 1AA"),
])
def test_normalise_valid(raw, expected):
    assert normalise_postcode(raw) == expected


@pytest.mark.parametrize("raw", ["", "hello", "GU9", "12345", "GU9 8ABX", None])
def test_normalise_invalid(raw):
    with pytest.raises(InvalidPostcode):
        normalise_postcode(raw)


# --- postcodes.io (free) ----------------------------------------------------------


def test_postcodes_io_valid(monkeypatch):
    seen = []
    monkeypatch.setattr(address, "urlopen", _fake_urlopen(POSTCODES_IO_GU9, seen=seen))
    assert lookup("gu98ab") == {"postcode": "GU9 8AB", "valid": True, "town": "Farnham",
                                "county": "Surrey", "addresses": [], "provider": "postcodes.io"}
    url, timeout = seen[0]
    assert url == "https://api.postcodes.io/postcodes/GU98AB"
    assert timeout == address.TIMEOUT_SECONDS


def test_postcodes_io_unparished_uses_district_and_london(monkeypatch):
    payload = {"status": 200, "result": {"postcode": "SW1A 1AA", "admin_district": "Westminster",
                                         "admin_county": None, "parish": "Westminster, unparished area",
                                         "region": "London"}}
    monkeypatch.setattr(address, "urlopen", _fake_urlopen(payload))
    r = lookup("SW1A 1AA")
    assert (r["town"], r["county"]) == ("Westminster", "London")


def test_postcodes_io_no_county(monkeypatch):
    payload = {"status": 200, "result": {"postcode": "M1 1AE", "admin_district": "Manchester",
                                         "admin_county": None, "parish": "Manchester, unparished area",
                                         "region": "North West"}}
    monkeypatch.setattr(address, "urlopen", _fake_urlopen(payload))
    r = lookup("M1 1AE")
    assert (r["town"], r["county"]) == ("Manchester", None)


def test_unknown_postcode(monkeypatch):
    monkeypatch.setattr(address, "urlopen", _fake_urlopen(status=404))
    r = lookup("ZZ1 1ZZ")
    assert r["valid"] is False
    assert r["postcode"] == "ZZ1 1ZZ"
    assert r["town"] is None and r["addresses"] == []


@pytest.mark.parametrize("exc", [socket.timeout("slow"), urllib.error.URLError("down"), TimeoutError()])
def test_provider_unreachable(monkeypatch, exc):
    monkeypatch.setattr(address, "urlopen", _fake_urlopen(raise_exc=exc))
    r = lookup("GU9 8AB")
    assert r["valid"] is None
    assert r["postcode"] == "GU9 8AB"


def test_provider_server_error(monkeypatch):
    monkeypatch.setattr(address, "urlopen", _fake_urlopen(status=500))
    assert lookup("GU9 8AB")["valid"] is None


# --- Ideal Postcodes (paid, switched on by env var) --------------------------------


def test_paid_provider_returns_addresses(monkeypatch):
    monkeypatch.setenv("IDEAL_POSTCODES_API_KEY", "ak_test")
    payload = {"code": 2000, "result": [
        {"line_1": "1 Example Road", "line_2": "", "line_3": "", "post_town": "FARNHAM",
         "county": "Surrey", "postcode": "GU9 8AB"},
        {"line_1": "Flat 2", "line_2": "3 Example Road", "line_3": "", "post_town": "FARNHAM",
         "county": "Surrey", "postcode": "GU9 8AB"},
    ]}
    seen = []
    monkeypatch.setattr(address, "urlopen", _fake_urlopen(payload, seen=seen))
    r = lookup("gu98ab")
    assert r["provider"] == "ideal-postcodes"
    assert r["valid"] is True
    assert r["town"] == "Farnham"
    assert r["county"] == "Surrey"
    assert r["addresses"] == [
        {"line1": "1 Example Road", "line2": "", "town": "Farnham", "postcode": "GU9 8AB"},
        {"line1": "Flat 2", "line2": "3 Example Road", "town": "Farnham", "postcode": "GU9 8AB"},
    ]
    assert "api_key=ak_test" in seen[0][0]
    assert "/postcodes/GU98AB" in seen[0][0]


def test_paid_provider_unknown_postcode(monkeypatch):
    monkeypatch.setenv("IDEAL_POSTCODES_API_KEY", "ak_test")
    monkeypatch.setattr(address, "urlopen", _fake_urlopen(status=404))
    assert lookup("ZZ1 1ZZ")["valid"] is False


# --- API --------------------------------------------------------------------------


def test_api_address(monkeypatch):
    monkeypatch.setattr(address, "urlopen", _fake_urlopen(POSTCODES_IO_GU9))
    r = client.get("/api/address", params={"postcode": "gu98ab"})
    assert r.status_code == 200
    assert r.json()["town"] == "Farnham"


def test_api_address_invalid():
    r = client.get("/api/address", params={"postcode": "nope"})
    assert r.status_code == 422
    assert r.json() == {"errors": [{"field": "postcode", "message": "That doesn't look like a UK postcode"}]}


def test_api_address_missing():
    r = client.get("/api/address")
    assert r.status_code == 422
    assert r.json()["errors"][0]["field"] == "postcode"
