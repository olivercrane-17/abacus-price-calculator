"""The Python customer block must match customerBlock() in src/customer.ts line for line
(same cases as src/customer.test.ts), because the Pipedrive note and the copied record should read the same."""

import pytest

from integrations.customer import customer_block, parse_customer, require_contact
from pricing import ValidationError

RULE = "-" * 40


def test_empty_customer_has_no_block():
    assert customer_block(parse_customer({})) == ""
    assert customer_block(parse_customer({"name": "   "})) == ""
    assert customer_block(parse_customer({"notes": " ", "heardOther": "x"})) == ""


def test_every_field_in_order():
    c = parse_customer({
        "name": "Jane Smith", "line1": "1 Example Road", "town": "Farnham", "county": "Surrey",
        "postcode": "GU9 8AB", "phone": "07920 422778", "email": "jane@gmail.com",
        "contactMethod": "text", "heardVia": "recommendation", "notes": "Gate code 1234\ndog in garden",
    })
    assert customer_block(c) == "\n".join([
        "CUSTOMER",
        "Name: Jane Smith",
        "Address: 1 Example Road, Farnham, Surrey, GU9 8AB",
        "Phone: 07920 422778",
        "Email: jane@gmail.com",
        "Prefers: Text message",
        "Heard via: Recommendation",
        "Notes: Gate code 1234; dog in garden",
        RULE,
    ])


def test_only_filled_fields():
    assert customer_block(parse_customer({"name": "Jane", "phone": "07920 422778"})) == \
        "\n".join(["CUSTOMER", "Name: Jane", "Phone: 07920 422778", RULE])
    assert customer_block(parse_customer({"postcode": "GU9 8AB"})) == \
        "\n".join(["CUSTOMER", "Address: GU9 8AB", RULE])


def test_other_heard_via():
    assert customer_block(parse_customer({"heardVia": "other", "heardOther": "Parish magazine"})) == \
        "\n".join(["CUSTOMER", "Heard via: Other (Parish magazine)", RULE])
    assert "Heard via: Other\n" in customer_block(parse_customer({"heardVia": "other"}))


def test_parse_ignores_unknown_values_and_caps_length():
    c = parse_customer({"name": 42, "heardVia": "tiktok", "contactMethod": "pigeon", "notes": "x" * 5000,
                        "townAuto": True, "evil": "y"})
    assert c["name"] == ""
    assert c["heardVia"] == "" and c["contactMethod"] == ""
    assert len(c["notes"]) == 2000
    assert "evil" not in c


def test_parse_rejects_non_object():
    with pytest.raises(ValidationError) as exc:
        parse_customer("Jane")
    assert exc.value.errors[0]["field"] == "customer"


def test_require_contact():
    require_contact(parse_customer({"name": "Jane", "phone": "07920 422778"}))
    require_contact(parse_customer({"name": "Jane", "email": "jane@gmail.com"}))
    with pytest.raises(ValidationError) as exc:
        require_contact(parse_customer({"name": " ", "postcode": "GU9 8AB"}))
    fields = {e["field"] for e in exc.value.errors}
    assert fields == {"customer.name", "customer.phone"}
