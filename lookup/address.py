"""UK postcode lookup for the customer details form.

Free by default (postcodes.io: checks the postcode is real and gives the town and county).
Setting the IDEAL_POSTCODES_API_KEY environment variable switches to Ideal Postcodes, which also
returns the full list of addresses at the postcode. No code change is needed to switch.

The provider being down never raises: the result comes back with valid=None so staff can type
the address by hand.
"""

from __future__ import annotations

import json
import os
import re
import socket
import urllib.error
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

TIMEOUT_SECONDS = 3
_POSTCODE = re.compile(r"^([A-Z]{1,2}[0-9][A-Z0-9]?)([0-9][A-Z]{2})$")


class InvalidPostcode(ValueError):
    pass


def normalise_postcode(text) -> str:
    """'gu98ab' -> 'GU9 8AB'. Raises InvalidPostcode if it isn't shaped like a UK postcode."""
    if not isinstance(text, str):
        raise InvalidPostcode("That doesn't look like a UK postcode")
    compact = re.sub(r"\s+", "", text).upper()
    m = _POSTCODE.match(compact)
    if not m:
        raise InvalidPostcode("That doesn't look like a UK postcode")
    return f"{m.group(1)} {m.group(2)}"


def _result(postcode, valid, provider, town=None, county=None, addresses=None) -> dict:
    return {"postcode": postcode, "valid": valid, "town": town, "county": county,
            "addresses": addresses or [], "provider": provider}


def _get_json(url: str):
    """Returns (status, body). Status is None if the provider couldn't be reached."""
    req = Request(url, headers={"Accept": "application/json", "User-Agent": "abacus-price-calculator"})
    try:
        with urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
            return 200, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        return exc.code, None
    except (urllib.error.URLError, socket.timeout, TimeoutError, OSError, ValueError):
        return None, None


def _postcodes_io(postcode: str) -> dict:
    status, body = _get_json(f"https://api.postcodes.io/postcodes/{quote(postcode.replace(' ', ''))}")
    if status == 404:
        return _result(postcode, False, "postcodes.io")
    if status != 200 or not isinstance(body, dict) or not isinstance(body.get("result"), dict):
        return _result(postcode, None, "postcodes.io")
    r = body["result"]
    parish = r.get("parish") or ""
    town = r.get("admin_district") if (not parish or "unparished" in parish) else parish
    county = r.get("admin_county") or ("London" if r.get("region") == "London" else None)
    return _result(r.get("postcode") or postcode, True, "postcodes.io", town, county)


def _ideal_postcodes(postcode: str, key: str) -> dict:
    url = (f"https://api.ideal-postcodes.co.uk/v1/postcodes/{quote(postcode.replace(' ', ''))}?"
           + urlencode({"api_key": key}))
    status, body = _get_json(url)
    if status == 404:
        return _result(postcode, False, "ideal-postcodes")
    if status != 200 or not isinstance(body, dict) or not isinstance(body.get("result"), list):
        return _result(postcode, None, "ideal-postcodes")
    addresses = []
    for a in body["result"]:
        second = ", ".join(p for p in (a.get("line_2"), a.get("line_3")) if p)
        addresses.append({"line1": a.get("line_1") or "", "line2": second,
                          "town": (a.get("post_town") or "").title(), "postcode": a.get("postcode") or postcode})
    first = body["result"][0] if body["result"] else {}
    return _result(postcode, bool(addresses), "ideal-postcodes",
                   (first.get("post_town") or "").title() or None, first.get("county") or None, addresses)


def lookup(raw_postcode) -> dict:
    """Look up a postcode. Raises InvalidPostcode for input that isn't a UK postcode."""
    postcode = normalise_postcode(raw_postcode)
    key = os.environ.get("IDEAL_POSTCODES_API_KEY", "").strip()
    return _ideal_postcodes(postcode, key) if key else _postcodes_io(postcode)
