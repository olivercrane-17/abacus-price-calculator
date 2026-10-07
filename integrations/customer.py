"""Customer details sent with a Pipedrive request.

customer_block() must produce exactly the same text as customerBlock() in src/customer.ts, so the
Pipedrive note reads the same as the copied record.
"""

from __future__ import annotations

from pricing import ValidationError

RULE = "-" * 40
MAX_LENGTH = 2000

TEXT_FIELDS = ("name", "line1", "line2", "town", "county", "postcode", "phone", "email", "heardOther", "notes")

HEARD_VIA = {
    "google": "Google / web search",
    "facebook": "Facebook / social media",
    "recommendation": "Recommendation",
    "seen": "Saw us working / van / flyer",
    "other": "Other",
}

CONTACT_METHODS = {
    "call": "Phone call",
    "text": "Text message",
    "email": "Email",
    "whatsapp": "WhatsApp",
}


def parse_customer(raw) -> dict:
    """Keep only the known fields, as capped strings. Unknown choice values become ""."""
    if not isinstance(raw, dict):
        raise ValidationError([{"field": "customer", "message": "Add the customer's details"}])
    c = {k: raw[k][:MAX_LENGTH] if isinstance(raw.get(k), str) else "" for k in TEXT_FIELDS}
    c["heardVia"] = raw.get("heardVia") if raw.get("heardVia") in HEARD_VIA else ""
    c["contactMethod"] = raw.get("contactMethod") if raw.get("contactMethod") in CONTACT_METHODS else ""
    return c


def require_contact(c: dict) -> None:
    """Pipedrive needs a name, and the office needs a way to follow up."""
    errors = []
    if not c["name"].strip():
        errors.append({"field": "customer.name", "message": "Add the customer's name"})
    if not c["phone"].strip() and not c["email"].strip():
        errors.append({"field": "customer.phone", "message": "Add a phone number or email"})
    if errors:
        raise ValidationError(errors)


def _heard_via_text(c: dict) -> str:
    if not c["heardVia"]:
        return ""
    if c["heardVia"] == "other":
        other = c["heardOther"].strip()
        return f"Other ({other})" if other else "Other"
    return HEARD_VIA[c["heardVia"]]


def _address_text(c: dict) -> str:
    parts = (c[k].strip() for k in ("line1", "line2", "town", "county", "postcode"))
    return ", ".join(p for p in parts if p)


def customer_block(c: dict) -> str:
    """The plain-text CUSTOMER block: only the filled-in fields. "" when there's nothing."""
    notes = "; ".join(line.strip() for line in c["notes"].splitlines() if line.strip())
    rows = [
        ("Name", c["name"].strip()),
        ("Address", _address_text(c)),
        ("Phone", c["phone"].strip()),
        ("Email", c["email"].strip()),
        ("Prefers", CONTACT_METHODS.get(c["contactMethod"], "")),
        ("Heard via", _heard_via_text(c)),
        ("Notes", notes),
    ]
    lines = [f"{k}: {v}" for k, v in rows if v]
    if not lines:
        return ""
    return "\n".join(["CUSTOMER", *lines, RULE])
