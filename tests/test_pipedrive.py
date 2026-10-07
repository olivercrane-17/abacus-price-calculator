import io
import json
import urllib.error
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi.testclient import TestClient

from api.index import app
from integrations import auth, pipedrive
from integrations.pipedrive import PipedriveError, normalise_domain, send_quote
from pricing import ValidationError

TOKEN = "pd-secret-token"


class _Resp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class FakePipedrive:
    """Stands in for urlopen: routes by method + path and records every request."""

    def __init__(self, existing_email=None, existing_phone=None, fail=None, pipelines=None, stages=None):
        self.calls = []
        self.existing_email = existing_email or {}
        self.existing_phone = existing_phone or {}
        self.fail = fail or {}  # (method, path) -> HTTP status or exception
        # A "Deal Added" stage exists in another pipeline too, so the pipeline must be matched first.
        self.pipelines = pipelines if pipelines is not None else [
            {"id": 1, "name": "Sales"}, {"id": 3, "name": "Website"}]
        self.stages = stages if stages is not None else {
            1: [{"id": 10, "name": "Deal Added", "pipeline_id": 1}],
            3: [{"id": 31, "name": "Lead In", "pipeline_id": 3}, {"id": 32, "name": "Deal Added", "pipeline_id": 3}],
        }

    def __call__(self, req, timeout=None):
        url = urlparse(req.full_url)
        method = req.get_method()
        body = json.loads(req.data.decode()) if req.data else None
        query = {k: v[0] for k, v in parse_qs(url.query).items()}
        self.calls.append({"method": method, "host": url.netloc, "path": url.path, "query": query,
                           "body": body, "headers": {k.lower(): v for k, v in req.header_items()},
                           "timeout": timeout})
        failure = self.fail.get((method, url.path))
        if isinstance(failure, int):
            raise urllib.error.HTTPError(req.full_url, failure, "err", {}, io.BytesIO(b"{}"))
        if failure is not None:
            raise failure
        if method == "GET" and url.path == "/api/v2/pipelines":
            return _Resp(json.dumps({"success": True, "data": self.pipelines}).encode())
        if method == "GET" and url.path == "/api/v2/stages":
            data = self.stages.get(int(query["pipeline_id"]), [])
            return _Resp(json.dumps({"success": True, "data": data}).encode())
        if method == "GET" and url.path == "/api/v2/persons/search":
            table = self.existing_email if query["fields"] == "email" else self.existing_phone
            found = table.get(query["term"])
            items = [{"item": {"id": found}}] if found else []
            return _Resp(json.dumps({"success": True, "data": {"items": items}}).encode())
        if method == "POST" and url.path == "/api/v2/persons":
            return _Resp(json.dumps({"success": True, "data": {"id": 501}}).encode())
        if method == "POST" and url.path == "/api/v2/deals":
            return _Resp(json.dumps({"success": True, "data": {"id": 7001}}).encode())
        if method == "POST" and url.path == "/api/v1/notes":
            return _Resp(json.dumps({"success": True, "data": {"id": 9}}).encode())
        raise AssertionError(f"Unexpected call {method} {url.path}")

    def paths(self):
        return [(c["method"], c["path"]) for c in self.calls]

    def call(self, method, path):
        return next(c for c in self.calls if c["method"] == method and c["path"] == path)


@pytest.fixture(autouse=True)
def settings(monkeypatch):
    monkeypatch.setenv("PIPEDRIVE_API_TOKEN", TOKEN)
    monkeypatch.setenv("PIPEDRIVE_COMPANY_DOMAIN", "abacus")
    monkeypatch.setenv("STAFF_PASSCODE", "window-wash-42")
    for name in ("PIPEDRIVE_STAGE_ID", "PIPEDRIVE_PIPELINE", "PIPEDRIVE_STAGE"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(auth, "WRONG_PASSCODE_DELAY", 0)
    pipedrive._stage_cache.clear()


@pytest.fixture
def fake(monkeypatch):
    f = FakePipedrive()
    monkeypatch.setattr(pipedrive, "urlopen", f)
    return f


def windows(**kw):
    req = {"quote_type": "windows", "property": {"kind": "standard", "bedrooms": 3}, "frequency": "4",
           "conservatory": "standard"}
    req.update(kw)
    return req


def gutters(**kw):
    req = {"quote_type": "gutters", "property": {"kind": "standard", "bedrooms": 3}, "service": "package3",
           "conservatory": False, "heavily_soiled": False}
    req.update(kw)
    return req


JANE = {"name": "Jane Smith", "phone": "07920 422778", "email": "jane@gmail.com", "postcode": "GU9 8AB",
        "heardVia": "recommendation"}


# --- Settings -----------------------------------------------------------------------


@pytest.mark.parametrize("raw,expected", [
    ("abacus", "abacus"),
    ("Abacus", "abacus"),
    ("abacus.pipedrive.com", "abacus"),
    ("https://abacus.pipedrive.com/", "abacus"),
    ("abacus-windows", "abacus-windows"),
])
def test_normalise_domain(raw, expected):
    assert normalise_domain(raw) == expected


@pytest.mark.parametrize("raw", ["", "evil.com/x", "abacus.evil.com", "a b", "abacus@evil.com"])
def test_normalise_domain_rejects_other_hosts(raw):
    assert normalise_domain(raw) is None


@pytest.mark.parametrize("missing", ["PIPEDRIVE_API_TOKEN", "PIPEDRIVE_COMPANY_DOMAIN", "STAFF_PASSCODE"])
def test_disabled_without_any_setting(monkeypatch, missing):
    assert pipedrive.enabled() is True
    monkeypatch.delenv(missing)
    assert pipedrive.enabled() is False


# --- Sending -----------------------------------------------------------------------


def test_new_customer_creates_person_deal_and_note(fake):
    r = send_quote({"items": [windows(), gutters()], "customer": JANE})
    assert fake.paths() == [
        ("GET", "/api/v2/pipelines"),        # find "Website"
        ("GET", "/api/v2/stages"),           # find "Deal Added" in it
        ("GET", "/api/v2/persons/search"),   # by email
        ("GET", "/api/v2/persons/search"),   # by phone as typed
        ("GET", "/api/v2/persons/search"),   # by phone digits only
        ("POST", "/api/v2/persons"),
        ("POST", "/api/v2/deals"),
        ("POST", "/api/v1/notes"),
    ]
    assert r == {"deal_id": 7001, "deal_url": "https://abacus.pipedrive.com/deal/7001", "person_id": 501,
                 "person_reused": False, "value": 23600, "warning": None}

    person = fake.call("POST", "/api/v2/persons")["body"]
    assert person["name"] == "Jane Smith"
    assert person["emails"] == [{"value": "jane@gmail.com", "primary": True, "label": "work"}]
    assert person["phones"] == [{"value": "07920 422778", "primary": True, "label": "mobile"}]

    deal = fake.call("POST", "/api/v2/deals")["body"]
    assert deal == {"title": "Jane Smith: 3 bed windows · every 4 weeks · conservatory + 3 bed gutters · Package 3",
                    "value": 236.0, "currency": "GBP", "person_id": 501, "stage_id": 32}

    note = fake.call("POST", "/api/v1/notes")["body"]
    assert note["deal_id"] == 7001
    assert note["content"].startswith("CUSTOMER<br>Name: Jane Smith<br>")
    assert "ABACUS WINDOW CLEANING: BASKET" in note["content"]
    assert "Heard via: Recommendation" in note["content"]


def test_token_only_in_header_and_host_is_company_domain(fake):
    send_quote({"items": [windows()], "customer": JANE})
    for c in fake.calls:
        assert c["host"] == "abacus.pipedrive.com"
        assert c["headers"]["x-api-token"] == TOKEN
        assert TOKEN not in json.dumps(c["query"])
        assert c["timeout"] == pipedrive.TIMEOUT_SECONDS


def test_search_uses_exact_match(fake):
    send_quote({"items": [windows()], "customer": JANE})
    q = fake.call("GET", "/api/v2/persons/search")["query"]
    assert q == {"term": "jane@gmail.com", "fields": "email", "exact_match": "true", "limit": "1"}


def test_existing_person_found_by_email_is_reused(monkeypatch):
    f = FakePipedrive(existing_email={"jane@gmail.com": 42})
    monkeypatch.setattr(pipedrive, "urlopen", f)
    r = send_quote({"items": [windows()], "customer": JANE})
    assert r["person_id"] == 42 and r["person_reused"] is True
    assert ("POST", "/api/v2/persons") not in f.paths()
    assert f.call("POST", "/api/v2/deals")["body"]["person_id"] == 42


def test_existing_person_found_by_phone_digits(monkeypatch):
    f = FakePipedrive(existing_phone={"07920422778": 43})
    monkeypatch.setattr(pipedrive, "urlopen", f)
    r = send_quote({"items": [windows()], "customer": {"name": "Jane", "phone": "07920 422778"}})
    assert r["person_id"] == 43 and r["person_reused"] is True


def test_value_is_server_priced_and_ignores_client_totals(fake):
    item = windows(total=1, subtotal=1, value=999999)
    r = send_quote({"items": [item], "customer": JANE, "value": 1})
    assert r["value"] == 3600
    assert fake.call("POST", "/api/v2/deals")["body"]["value"] == 36.0


def test_overrides_count_in_the_value(fake):
    r = send_quote({"items": [gutters(override={"total": 150, "reason": "Repeat customer"})], "customer": JANE})
    assert r["value"] == 15000


def test_deals_go_to_deal_added_in_the_website_pipeline(fake):
    send_quote({"items": [windows()], "customer": JANE})
    assert fake.call("GET", "/api/v2/stages")["query"]["pipeline_id"] == "3"
    assert fake.call("POST", "/api/v2/deals")["body"]["stage_id"] == 32  # not 10, the Sales pipeline's stage


def test_stage_names_match_ignoring_case_and_spaces(monkeypatch):
    f = FakePipedrive(pipelines=[{"id": 3, "name": " website "}],
                      stages={3: [{"id": 32, "name": "DEAL ADDED", "pipeline_id": 3}]})
    monkeypatch.setattr(pipedrive, "urlopen", f)
    send_quote({"items": [windows()], "customer": JANE})
    assert f.call("POST", "/api/v2/deals")["body"]["stage_id"] == 32


def test_stage_is_looked_up_once_per_warm_function(fake):
    send_quote({"items": [windows()], "customer": JANE})
    send_quote({"items": [windows()], "customer": JANE})
    assert fake.paths().count(("GET", "/api/v2/pipelines")) == 1
    assert fake.paths().count(("GET", "/api/v2/stages")) == 1


@pytest.mark.parametrize("pipelines,stages,words", [
    ([{"id": 1, "name": "Sales"}], {1: [{"id": 10, "name": "Deal Added"}]}, "'Website' pipeline"),
    ([{"id": 3, "name": "Website"}], {3: [{"id": 31, "name": "Lead In"}]}, "'Deal Added' stage"),
])
def test_missing_pipeline_or_stage_stops_before_anything_is_created(monkeypatch, pipelines, stages, words):
    f = FakePipedrive(pipelines=pipelines, stages=stages)
    monkeypatch.setattr(pipedrive, "urlopen", f)
    with pytest.raises(PipedriveError) as exc:
        send_quote({"items": [windows()], "customer": JANE})
    assert words in exc.value.message
    assert not any(m == "POST" for m, _ in f.paths())


def test_pipeline_and_stage_names_can_be_changed_in_settings(monkeypatch):
    monkeypatch.setenv("PIPEDRIVE_PIPELINE", "Sales")
    monkeypatch.setenv("PIPEDRIVE_STAGE", "Deal Added")
    f = FakePipedrive()
    monkeypatch.setattr(pipedrive, "urlopen", f)
    send_quote({"items": [windows()], "customer": JANE})
    assert f.call("POST", "/api/v2/deals")["body"]["stage_id"] == 10


def test_stage_id_setting_skips_the_lookup(monkeypatch, fake):
    monkeypatch.setenv("PIPEDRIVE_STAGE_ID", "12")
    send_quote({"items": [windows()], "customer": JANE})
    assert fake.call("POST", "/api/v2/deals")["body"]["stage_id"] == 12
    assert ("GET", "/api/v2/pipelines") not in fake.paths()


def test_long_titles_are_trimmed(fake):
    send_quote({"items": [windows()] * 20, "customer": JANE})
    title = fake.call("POST", "/api/v2/deals")["body"]["title"]
    assert len(title) <= pipedrive.MAX_TITLE and title.endswith("…")


def test_note_failure_after_deal_still_succeeds_with_warning(monkeypatch):
    f = FakePipedrive(fail={("POST", "/api/v1/notes"): 500})
    monkeypatch.setattr(pipedrive, "urlopen", f)
    r = send_quote({"items": [windows()], "customer": JANE})
    assert r["deal_id"] == 7001
    assert "note" in r["warning"]


def test_note_escapes_html(fake):
    send_quote({"items": [windows()], "customer": {**JANE, "notes": "<script>alert(1)</script> & co"}})
    content = fake.call("POST", "/api/v1/notes")["body"]["content"]
    assert "<script>" not in content
    assert "&lt;script&gt;alert(1)&lt;/script&gt; &amp; co" in content


# --- Validation (nothing is sent to Pipedrive) ---------------------------------------


@pytest.mark.parametrize("body,field", [
    ({"items": [windows()], "customer": {"name": "Jane"}}, "customer.phone"),
    ({"items": [windows()], "customer": {"phone": "07920 422778"}}, "customer.name"),
    ({"items": [], "customer": JANE}, "items"),
    ({"items": [windows(conservatory="large")], "customer": JANE}, "items"),
    ({"customer": JANE}, "items"),
    ({"items": [windows()]}, "customer"),
    ("nope", "body"),
])
def test_invalid_sends_never_reach_pipedrive(fake, body, field):
    with pytest.raises(ValidationError) as exc:
        send_quote(body)
    assert field in {e["field"] for e in exc.value.errors}
    assert fake.calls == []


# --- Pipedrive errors ----------------------------------------------------------------


@pytest.mark.parametrize("failure,words", [
    (401, "API key"),
    (403, "API key"),
    (429, "busy"),
    (500, "didn't respond"),
    (urllib.error.URLError("down"), "didn't respond"),
    (TimeoutError(), "didn't respond"),
])
def test_pipedrive_errors_are_friendly(monkeypatch, failure, words):
    f = FakePipedrive(fail={("GET", "/api/v2/persons/search"): failure})
    monkeypatch.setattr(pipedrive, "urlopen", f)
    with pytest.raises(PipedriveError) as exc:
        send_quote({"items": [windows()], "customer": JANE})
    assert words in exc.value.message
    assert TOKEN not in exc.value.message


def test_deal_failure_raises(monkeypatch):
    f = FakePipedrive(fail={("POST", "/api/v2/deals"): 500})
    monkeypatch.setattr(pipedrive, "urlopen", f)
    with pytest.raises(PipedriveError):
        send_quote({"items": [windows()], "customer": JANE})


# --- API -----------------------------------------------------------------------------


@pytest.fixture
def client():
    return TestClient(app, base_url="https://testserver")


def test_config_reports_enabled(client, monkeypatch):
    assert client.get("/api/config").json()["pipedrive"] == {"enabled": True}
    monkeypatch.delenv("PIPEDRIVE_API_TOKEN")
    assert client.get("/api/config").json()["pipedrive"] == {"enabled": False}


def test_send_requires_unlock(client, fake):
    r = client.post("/api/pipedrive/send", json={"items": [windows()], "customer": JANE})
    assert r.status_code == 401
    assert r.json()["errors"][0]["field"] == "passcode"
    assert fake.calls == []


def test_wrong_passcode(client):
    r = client.post("/api/unlock", json={"passcode": "nope"})
    assert r.status_code == 401
    assert r.json() == {"errors": [{"field": "passcode", "message": "That passcode isn't right"}]}
    assert client.get("/api/session").json() == {"unlocked": False}


def test_unlock_send_and_lock(client, fake):
    r = client.post("/api/unlock", json={"passcode": "window-wash-42"})
    assert r.status_code == 200
    cookie = r.headers["set-cookie"].lower()
    assert "httponly" in cookie and "secure" in cookie and "samesite=strict" in cookie
    assert client.get("/api/session").json() == {"unlocked": True}

    r = client.post("/api/pipedrive/send", json={"items": [windows()], "customer": JANE})
    assert r.status_code == 200
    assert r.json()["deal_url"] == "https://abacus.pipedrive.com/deal/7001"

    client.post("/api/lock")
    assert client.get("/api/session").json() == {"unlocked": False}
    assert client.post("/api/pipedrive/send", json={"items": [windows()], "customer": JANE}).status_code == 401


def test_send_validation_error_shape(client, fake):
    client.post("/api/unlock", json={"passcode": "window-wash-42"})
    r = client.post("/api/pipedrive/send", json={"items": [windows()], "customer": {"name": "Jane"}})
    assert r.status_code == 422
    assert r.json()["errors"][0]["field"] == "customer.phone"


def test_send_pipedrive_error_shape(client, monkeypatch):
    monkeypatch.setattr(pipedrive, "urlopen", FakePipedrive(fail={("GET", "/api/v2/persons/search"): 401}))
    client.post("/api/unlock", json={"passcode": "window-wash-42"})
    r = client.post("/api/pipedrive/send", json={"items": [windows()], "customer": JANE})
    assert r.status_code == 502
    assert r.json()["errors"][0]["field"] == "pipedrive"


def test_everything_404s_when_not_configured(client, monkeypatch, fake):
    monkeypatch.delenv("PIPEDRIVE_API_TOKEN")
    assert client.post("/api/unlock", json={"passcode": "window-wash-42"}).status_code == 404
    assert client.post("/api/pipedrive/send", json={"items": [windows()], "customer": JANE}).status_code == 404
    assert fake.calls == []
