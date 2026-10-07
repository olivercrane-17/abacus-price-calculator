"""Send a priced basket and the customer's details to Pipedrive: Person + Deal + Note.

Settings come only from environment variables (the repo is public):
  PIPEDRIVE_API_TOKEN       personal API token (Pipedrive > Personal preferences > API)
  PIPEDRIVE_COMPANY_DOMAIN  e.g. "abacus" for abacus.pipedrive.com
  PIPEDRIVE_STAGE_ID        optional; without it Pipedrive puts deals in the default pipeline's first stage
The token is sent in the x-api-token header, never in the URL, and customer data is never logged.
"""

from __future__ import annotations

import html
import json
import os
import re
import socket
import urllib.error
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from pricing import ValidationError, basket

from . import auth
from .customer import customer_block, parse_customer, require_contact

TIMEOUT_SECONDS = 8
MAX_TITLE = 200

_DOMAIN = re.compile(r"^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$")

NOTE_FAILED = ("The deal was created, but the quote note couldn't be added. "
               "Copy the basket and paste it into the deal in Pipedrive.")


class PipedriveError(Exception):
    """A problem talking to Pipedrive, with a message written for staff."""

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


# --- Settings ------------------------------------------------------------------------


def normalise_domain(raw) -> str | None:
    """'https://Abacus.pipedrive.com/' -> 'abacus'. None for anything that isn't a plain company name."""
    if not isinstance(raw, str):
        return None
    d = raw.strip().lower()
    d = re.sub(r"^https?://", "", d).rstrip("/")
    if d.endswith(".pipedrive.com"):
        d = d[: -len(".pipedrive.com")]
    return d if _DOMAIN.match(d) else None


def _token() -> str:
    return os.environ.get("PIPEDRIVE_API_TOKEN", "").strip()


def _domain() -> str | None:
    return normalise_domain(os.environ.get("PIPEDRIVE_COMPANY_DOMAIN", ""))


def _stage_id() -> int | None:
    raw = os.environ.get("PIPEDRIVE_STAGE_ID", "").strip()
    return int(raw) if raw.isdigit() else None


def enabled() -> bool:
    return bool(_token() and _domain() and auth.configured())


# --- HTTP ----------------------------------------------------------------------------


def _call(method: str, path: str, params: dict | None = None, body: dict | None = None) -> dict:
    url = f"https://{_domain()}.pipedrive.com{path}"
    if params:
        url += "?" + urlencode(params)
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Accept": "application/json", "x-api-token": _token(), "User-Agent": "abacus-price-calculator"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    req = Request(url, data=data, headers=headers, method=method)
    try:
        with urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403):
            raise PipedriveError("Pipedrive rejected the API key. Ask the office to check the Pipedrive "
                                 "settings in Vercel.") from None
        if exc.code == 429:
            raise PipedriveError("Pipedrive is busy right now. Wait a moment and try again.") from None
        if exc.code == 404:
            raise PipedriveError("Pipedrive couldn't be found at that company domain. Ask the office to check "
                                 "the Pipedrive settings in Vercel.") from None
        raise PipedriveError("Pipedrive didn't respond properly. Try again in a moment.") from None
    except (urllib.error.URLError, socket.timeout, TimeoutError, OSError, ValueError):
        raise PipedriveError("Pipedrive didn't respond. Try again in a moment.") from None
    if not isinstance(payload, dict) or payload.get("success") is False:
        raise PipedriveError("Pipedrive didn't respond properly. Try again in a moment.")
    return payload


# --- Pipedrive objects ---------------------------------------------------------------


def find_person(email: str, phone: str) -> int | None:
    """Exact match by email, then by phone (as typed, then digits only)."""
    terms = []
    if email.strip():
        terms.append(("email", email.strip()))
    if phone.strip():
        terms.append(("phone", phone.strip()))
        digits = re.sub(r"\D", "", phone)
        if digits and digits != phone.strip():
            terms.append(("phone", digits))
    for field, term in terms:
        if len(term) < 2:
            continue
        payload = _call("GET", "/api/v2/persons/search",
                        params={"term": term, "fields": field, "exact_match": "true", "limit": "1"})
        items = (payload.get("data") or {}).get("items") or []
        if items and isinstance(items[0].get("item"), dict) and items[0]["item"].get("id"):
            return items[0]["item"]["id"]
    return None


def create_person(name: str, email: str, phone: str) -> int:
    body = {"name": name.strip()}
    if email.strip():
        body["emails"] = [{"value": email.strip(), "primary": True, "label": "work"}]
    if phone.strip():
        digits = re.sub(r"\D", "", phone)
        label = "mobile" if digits.startswith(("07", "447")) else "home"
        body["phones"] = [{"value": phone.strip(), "primary": True, "label": label}]
    return _created_id(_call("POST", "/api/v2/persons", body=body))


def create_deal(title: str, value_pence: int, person_id: int) -> int:
    body = {"title": title, "value": value_pence / 100, "currency": "GBP", "person_id": person_id}
    stage = _stage_id()
    if stage is not None:
        body["stage_id"] = stage
    return _created_id(_call("POST", "/api/v2/deals", body=body))


def add_note(deal_id: int, text: str) -> None:
    content = html.escape(text, quote=False).replace("\n", "<br>")
    _call("POST", "/api/v1/notes", body={"content": content, "deal_id": deal_id})


def _created_id(payload: dict) -> int:
    data = payload.get("data")
    if not isinstance(data, dict) or not data.get("id"):
        raise PipedriveError("Pipedrive didn't respond properly. Try again in a moment.")
    return data["id"]


def deal_url(deal_id: int) -> str:
    return f"https://{_domain()}.pipedrive.com/deal/{deal_id}"


# --- Send ----------------------------------------------------------------------------


def _title(name: str, titles: list[str]) -> str:
    title = f"{name.strip()}: {' + '.join(titles)}"
    return title if len(title) <= MAX_TITLE else title[: MAX_TITLE - 1].rstrip() + "…"


def send_quote(body) -> dict:
    """Validate and re-price the basket on the server, then create Person (or reuse) + Deal + Note.

    Raises ValidationError before anything is sent to Pipedrive, or PipedriveError if Pipedrive fails
    before the deal exists. A failed note after the deal exists comes back as a warning instead,
    so staff don't send again and create a duplicate deal.
    """
    if not isinstance(body, dict):
        raise ValidationError([{"field": "body", "message": "The request must be a JSON object"}])

    errors = []
    customer = None
    try:
        customer = parse_customer(body.get("customer"))
        require_contact(customer)
    except ValidationError as exc:
        errors += exc.errors

    items = body.get("items")
    priced = None
    if not isinstance(items, list) or not items:
        errors.append({"field": "items", "message": "Add at least one job before sending"})
    else:
        try:
            priced = basket({"items": items})
        except ValidationError as exc:
            errors.append({"field": "items", "message": exc.errors[0]["message"]})
        else:
            if not all(r["ok"] for r in priced["items"]):
                errors.append({"field": "items", "message": "Fix the jobs marked 'Needs attention' before sending"})
    if errors:
        raise ValidationError(errors)

    quotes = [r["quote"] for r in priced["items"]]
    value = sum(q["total"] for q in quotes)
    note = customer_block(customer) + "\n\n" + priced["summary_text"]

    person_id = find_person(customer["email"], customer["phone"])
    reused = person_id is not None
    if not reused:
        person_id = create_person(customer["name"], customer["email"], customer["phone"])
    deal_id = create_deal(_title(customer["name"], [q["title"] for q in quotes]), value, person_id)

    warning = None
    try:
        add_note(deal_id, note)
    except PipedriveError:
        warning = NOTE_FAILED

    return {"deal_id": deal_id, "deal_url": deal_url(deal_id), "person_id": person_id,
            "person_reused": reused, "value": value, "warning": warning}
