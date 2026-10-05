"""Quote calculation for window cleaning and gutter & fascia work.

Requests use pounds (JSON numbers); results use integer pence. All arithmetic is
done with Decimal and rounded half-up to the penny.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal

from .errors import ValidationError
from .prices import load_prices

SUMMARY_WIDTH = 40
RULE = "-" * SUMMARY_WIDTH
LANTERN_SIZES = ("small", "medium", "large")

MSG_COUNT = "Enter a whole number of 0 or more"
MSG_MONEY = "Enter an amount in pounds"
MSG_MONEY_NEGATIVE = "Enter an amount of £0 or more"


# --- Money helpers -------------------------------------------------------------


_GUTTER_SHORT = {
    "clearance": "Gutter Clearance",
    "outer": "Outer Gutter & Fascia",
    "package3": "Package 3 (clearance + outer clean)",
}


def _dec(value) -> Decimal:
    """Exact Decimal from a JSON number (floats go through str to avoid binary noise)."""
    if isinstance(value, Decimal):
        return value
    if isinstance(value, int):
        return Decimal(value)
    return Decimal(str(value))


def to_pence(pounds) -> int:
    return int((_dec(pounds) * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def format_pence(pence: int) -> str:
    return f"£{Decimal(pence) / 100:,.2f}"


def _format_pounds_short(pounds) -> str:
    d = _dec(pounds)
    return f"£{d:,.0f}" if d == d.to_integral_value() else f"£{d:,.2f}"


def _plural(n: int, word: str) -> str:
    return f"{n} {word}" if n == 1 else f"{n} {word}s"


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


def london_today() -> date:
    try:
        from zoneinfo import ZoneInfo

        return datetime.now(ZoneInfo("Europe/London")).date()
    except Exception:  # tzdata missing or zoneinfo unavailable
        return date.today()


# --- Input validation ----------------------------------------------------------


class _Errors:
    def __init__(self):
        self.items: list[dict] = []

    def add(self, field_name: str, message: str) -> None:
        self.items.append({"field": field_name, "message": message})

    def raise_if_any(self) -> None:
        if self.items:
            raise ValidationError(self.items)


def _is_number(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _whole(v):
    """Return v as an int if it is a whole JSON number, else None."""
    if isinstance(v, bool) or not _is_number(v):
        return None
    if isinstance(v, float):
        if not math.isfinite(v) or not v.is_integer():
            return None
        return int(v)
    return v


def _count(v, name: str, errs: _Errors) -> int:
    if v is None:
        return 0
    n = _whole(v)
    if n is None or n < 0:
        errs.add(name, MSG_COUNT)
        return 0
    return n


def _money(v, name: str, errs: _Errors, required_message: str | None = None):
    """Validate a pounds amount. Returns a Decimal, or None when absent/invalid."""
    if v is None:
        if required_message:
            errs.add(name, required_message)
        return None
    if not _is_number(v) or (isinstance(v, float) and not math.isfinite(v)):
        errs.add(name, MSG_MONEY)
        return None
    d = _dec(v)
    if d < 0:
        errs.add(name, MSG_MONEY_NEGATIVE)
        return None
    return d


def _flag(v, name: str, errs: _Errors, message: str) -> bool:
    if v is None:
        return False
    if not isinstance(v, bool):
        errs.add(name, message)
        return False
    return v


def _section(v, name: str, errs: _Errors) -> dict:
    if v is None:
        return {}
    if not isinstance(v, dict):
        errs.add(name, "This section is in the wrong format")
        return {}
    return v


@dataclass
class _Property:
    kind: str | None = None  # "standard" | "other" | None when invalid
    bedrooms: int | None = None
    description: str = ""
    price: Decimal | None = None  # windows staff price for "other"

    @property
    def name(self) -> str:
        if self.kind == "standard":
            return f"{self.bedrooms} bed house"
        return f"Other property ({self.description})"


def _parse_property(raw, errs: _Errors, *, needs_price: bool) -> _Property:
    if raw is not None and not isinstance(raw, dict):
        errs.add("property.kind", "Choose a standard house or another property")
        return _Property()
    raw = raw or {}
    kind = raw.get("kind")
    if kind == "standard":
        beds = _whole(raw.get("bedrooms"))
        if beds is None or not 1 <= beds <= 5:
            errs.add("property.bedrooms", "Choose a bedroom count between 1 and 5")
            return _Property()
        return _Property(kind="standard", bedrooms=beds)
    if kind == "other":
        desc = raw.get("description")
        desc = desc.strip() if isinstance(desc, str) else ""
        if not desc:
            errs.add("property.description", "Describe the property")
        price = None
        if needs_price:
            price = _money(raw.get("price"), "property.price", errs, "Enter your window price")
        return _Property(kind="other", description=desc, price=price)
    errs.add("property.kind", "Choose a standard house or another property")
    return _Property()


def _parse_override(raw, errs: _Errors):
    if raw is None:
        return None
    if not isinstance(raw, dict):
        errs.add("override", "This section is in the wrong format")
        return None
    total = _money(raw.get("total"), "override.total", errs, "Enter the override total")
    reason = raw.get("reason")
    reason = reason.strip() if isinstance(reason, str) else ""
    if not reason:
        errs.add("override.reason", "Give a reason for the override")
    if total is None or not reason:
        return None
    return {"total": to_pence(total), "reason": reason}


# --- Shared result assembly ----------------------------------------------------


def _line(key: str, label: str, amount: int | None) -> dict:
    return {"key": key, "label": label, "amount": amount}


def _subtotal(lines: list[dict]) -> int:
    return sum(l["amount"] for l in lines if l["amount"] is not None)


def _warning(prices: dict, key: str) -> dict:
    return {"key": key, "message": prices["warnings"][key]}


def _row(label: str, amount: str) -> str:
    if len(label) + len(amount) + 2 > SUMMARY_WIDTH:
        return f"{label}  {amount}"
    return label.ljust(SUMMARY_WIDTH - len(amount)) + amount


def _summary(title, today, options, lines, subtotal, override, total, basis, warnings) -> str:
    out = [f"ABACUS WINDOW CLEANING: {title}", today.strftime("%d/%m/%Y")]
    out += options
    out.append(RULE)
    for l in lines:
        out.append(l["label"] if l["amount"] is None else _row(l["label"], format_pence(l["amount"])))
    out.append(RULE)
    if override:
        out.append(_row("Calculated total", format_pence(subtotal)))
        out.append(_row("OVERRIDE", format_pence(override["total"])) + f"  (Reason: {override['reason']})")
    out.append(_row("TOTAL PER VISIT" if basis == "per_visit" else "TOTAL (ONE-OFF)", format_pence(total)))
    if warnings:
        out.append("Notes: " + " ".join(w["message"] for w in warnings))
    out.append("Prices include VAT.")
    return "\n".join(out)


def _result(quote_type, basis, basis_label, lines, override, warnings, comparison, summary_args, today,
            title, frequency):
    subtotal = _subtotal(lines)
    total = override["total"] if override else subtotal
    heading, options = summary_args
    return {
        "quote_type": quote_type,
        "title": title,
        "frequency": frequency,
        "basis": basis,
        "basis_label": basis_label,
        "lines": lines,
        "subtotal": subtotal,
        "override": override,
        "total": total,
        "warnings": warnings,
        "comparison": comparison,
        "summary_text": _summary(heading, today, options, lines, subtotal, override, total, basis, warnings),
    }


# --- Windows -------------------------------------------------------------------


@dataclass
class _WindowOptions:
    prop: _Property
    conservatory: str = "none"
    large_price: Decimal | None = None
    internal: bool = False
    roof_external: int = 0
    roof_internal: int = 0
    velux_external: int = 0
    velux_internal: int = 0
    lanterns: dict = field(default_factory=dict)  # size -> (external, internal)
    larger_price: Decimal | None = None


def _frequency_label(freq: str) -> str:
    return "One-off" if freq == "one_off" else f"Every {freq} weeks"


def _parse_windows(req: dict, prices: dict, errs: _Errors):
    w = prices["windows"]
    prop = _parse_property(req.get("property"), errs, needs_price=True)

    freq = req.get("frequency")
    if _whole(freq) is not None:
        freq = str(_whole(freq))
    if freq not in (*w["frequencies"], "one_off"):
        errs.add("frequency", "Choose how often: every 4, 6, 8 or 12 weeks, or one-off")

    cons = req.get("conservatory")
    if cons is None:
        cons = "none"
    if cons not in ("none", "standard", "large"):
        errs.add("conservatory", "Choose none, standard or large for the conservatory/extension")
        cons = "none"
    elif prop.kind == "other" and cons != "none":
        errs.add(
            "conservatory",
            "Conservatory/extension isn't available for another property: include it in your price",
        )
        cons = "none"

    large_price = None
    if cons == "large":
        large_price = _money(
            req.get("large_conservatory_price"), "large_conservatory_price", errs,
            "Enter the conservatory charge",
        )

    internal = _flag(req.get("internal"), "internal", errs, "Choose yes or no for internal windows")

    roof = _section(req.get("conservatory_roof"), "conservatory_roof", errs)
    velux = _section(req.get("velux"), "velux", errs)
    lant = _section(req.get("lanterns"), "lanterns", errs)
    lanterns = {}
    for size in LANTERN_SIZES:
        s = _section(lant.get(size), f"lanterns.{size}", errs)
        lanterns[size] = (
            _count(s.get("external"), f"lanterns.{size}.external", errs),
            _count(s.get("internal"), f"lanterns.{size}.internal", errs),
        )

    opts = _WindowOptions(
        prop=prop,
        conservatory=cons,
        large_price=large_price,
        internal=internal,
        roof_external=_count(roof.get("external_panels"), "conservatory_roof.external_panels", errs),
        roof_internal=_count(roof.get("internal_panels"), "conservatory_roof.internal_panels", errs),
        velux_external=_count(velux.get("external"), "velux.external", errs),
        velux_internal=_count(velux.get("internal"), "velux.internal", errs),
        lanterns=lanterns,
        larger_price=_money(lant.get("larger_price"), "lanterns.larger_price", errs),
    )
    return opts, freq


def _windows_lines(opts: _WindowOptions, freq: str, prices: dict) -> list[dict]:
    w = prices["windows"]
    lines = []
    prop = opts.prop

    cons_amount = 0
    if prop.kind == "standard":
        sheet = w["bedrooms"][str(prop.bedrooms)]
        if freq == "one_off":
            house = to_pence(sheet["one_off"])
            if opts.conservatory == "standard":
                cons_amount = to_pence(sheet["one_off_with_conservatory"]) - house
        else:
            house = to_pence(sheet["regular"][freq])
            if opts.conservatory == "standard":
                cons_amount = to_pence(sheet["conservatory_addon"])
        if opts.conservatory == "large":
            cons_amount = to_pence(opts.large_price)
    else:
        house = to_pence(opts.prop.price)

    lines.append(_line("house", f"{prop.name}: windows outside", house))
    if opts.conservatory == "standard":
        lines.append(_line("conservatory", "Conservatory/extension", cons_amount))
    elif opts.conservatory == "large":
        lines.append(_line("conservatory", "Larger conservatory/extension (staff price)", cons_amount))

    if opts.internal:
        external = house + cons_amount
        lines.append(_line("internal", "Internal windows", int(_dec(w["internal_multiplier"]) * external)))

    roof = w["conservatory_roof"]
    if opts.roof_external:
        raw = to_pence(_dec(roof["external_per_panel"]) * opts.roof_external)
        minimum = to_pence(roof["external_minimum"])
        label = f"Conservatory roof outside ({_plural(opts.roof_external, 'panel')}"
        if raw < minimum:
            label += f", {_format_pounds_short(roof['external_minimum'])} minimum"
        lines.append(_line("roof_external", label + ")", max(raw, minimum)))
    if opts.roof_internal:
        lines.append(_line(
            "roof_internal",
            f"Conservatory roof inside ({_plural(opts.roof_internal, 'panel')})",
            to_pence(_dec(roof["internal_per_panel"]) * opts.roof_internal),
        ))

    velux = w["velux"]
    if opts.velux_external:
        lines.append(_line(
            "velux_external", f"Velux outside × {opts.velux_external}",
            to_pence(_dec(velux["external_each"]) * opts.velux_external),
        ))
    if opts.velux_internal:
        lines.append(_line(
            "velux_internal", f"Velux inside × {opts.velux_internal}",
            to_pence(_dec(velux["internal_each"]) * opts.velux_internal),
        ))

    for side_index, side, side_word in ((0, "external", "outside"), (1, "internal", "inside")):
        parts, amount = [], Decimal(0)
        for size in LANTERN_SIZES:
            n = opts.lanterns[size][side_index]
            if n:
                parts.append(f"{n} {size}")
                amount += _dec(w["lanterns"][size][side]) * n
        if parts:
            lines.append(_line(f"lanterns_{side}", f"Roof lanterns {side_word}: {', '.join(parts)}", to_pence(amount)))

    if opts.larger_price is not None:
        lines.append(_line("larger_lantern", "Larger roof lantern/structure (staff price)", to_pence(opts.larger_price)))

    return lines


def _quote_windows(req: dict, prices: dict, errs: _Errors, today: date) -> dict:
    opts, freq = _parse_windows(req, prices, errs)
    override = _parse_override(req.get("override"), errs)
    errs.raise_if_any()

    lines = _windows_lines(opts, freq, prices)

    warnings = []
    if opts.prop.kind == "other":
        warnings.append(_warning(prices, "other_property"))
    if opts.conservatory == "large":
        warnings.append(_warning(prices, "large_conservatory"))
    if opts.larger_price is not None:
        warnings.append(_warning(prices, "larger_lantern"))

    comparison = None
    if opts.prop.kind == "standard" and freq != "one_off":
        comparison = [
            {
                "frequency": f,
                "label": _frequency_label(f),
                "total": _subtotal(_windows_lines(opts, f, prices)),
                "selected": f == freq,
            }
            for f in prices["windows"]["frequencies"]
        ]

    if freq == "one_off":
        basis, basis_label = "one_off", "one-off clean"
    else:
        basis, basis_label = "per_visit", f"per visit, every {freq} weeks"

    options = [f"Property: {opts.prop.name if opts.prop.kind == 'standard' else 'Other: ' + opts.prop.description}",
               f"Frequency: {_frequency_label(freq)}"]
    if opts.prop.kind == "standard":
        options.append("Conservatory/extension: " + {
            "none": "None", "standard": "Standard", "large": "Larger (staff price)",
        }[opts.conservatory])
    options.append(f"Internal windows: {'Yes' if opts.internal else 'No'}")
    options.append(f"Price list: {prices['price_list_date']}")

    name = opts.prop.name.replace(" house", "") if opts.prop.kind == "standard" else opts.prop.description
    parts = [f"{name} windows", "one-off" if freq == "one_off" else f"every {freq} weeks"]
    if opts.conservatory == "standard":
        parts.append("conservatory")
    elif opts.conservatory == "large":
        parts.append("large conservatory")
    if opts.internal:
        parts.append("inside too")
    if opts.roof_external or opts.roof_internal or opts.velux_external or opts.velux_internal             or any(e or i for e, i in opts.lanterns.values()) or opts.larger_price is not None:
        parts.append("roof glass")

    return _result("windows", basis, basis_label, lines, override, warnings, comparison,
                   ("WINDOW QUOTE", options), today, " · ".join(parts), freq)


# --- Gutters -------------------------------------------------------------------


def _quote_gutters(req: dict, prices: dict, errs: _Errors, today: date) -> dict:
    g = prices["gutters"]
    prop = _parse_property(req.get("property"), errs, needs_price=False)

    service = req.get("service")
    if service not in g["services"]:
        errs.add("service", "Choose a gutter service")
        service = None

    cons = _flag(req.get("conservatory"), "conservatory", errs,
                 "Choose yes or no for the conservatory/extension")
    soiled = _flag(req.get("heavily_soiled"), "heavily_soiled", errs,
                   "Choose yes or no for heavily soiled")

    manual = prop.kind == "other" or (
        prop.kind == "standard" and g["bedrooms"].get(str(prop.bedrooms)) is None
    )
    manual_price = None
    if manual:
        manual_price = _money(req.get("manual_price"), "manual_price", errs, "Enter your price for this job")
        if soiled:
            errs.add(
                "heavily_soiled",
                "Heavily soiled isn't available when you enter the price yourself: include it in your price",
            )

    extras = []
    raw_extras = req.get("extras")
    if raw_extras is not None and not isinstance(raw_extras, list):
        errs.add("extras", "Extras must be a list")
        raw_extras = []
    for i, item in enumerate(raw_extras or []):
        name_field = f"extras[{i}]"
        if not isinstance(item, dict):
            errs.add(name_field, "This extra is in the wrong format")
            continue
        name = item.get("name")
        if name not in g["ask_about"]:
            errs.add(f"{name_field}.name", "Choose one of the listed extras")
            continue
        selected = _flag(item.get("selected"), f"{name_field}.selected", errs, "Tick or untick this extra")
        price = _money(item.get("price"), f"{name_field}.price", errs)
        if selected:
            extras.append((name, price))

    override = _parse_override(req.get("override"), errs)
    errs.raise_if_any()

    label = _GUTTER_SHORT[service] + (" + conservatory/extension" if cons else "")
    lines = []
    if manual:
        lines.append(_line("service", label + ": staff price", to_pence(manual_price)))
    else:
        base = to_pence(g["bedrooms"][str(prop.bedrooms)][service]["with_cons" if cons else "no_cons"])
        lines.append(_line("service", label, base))
        if soiled:
            mult = _dec(g["heavily_soiled_multiplier"])
            uplift = int((base * (mult - 1)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
            lines.append(_line("heavily_soiled", f"Heavily soiled first clean (×{mult.normalize()})", uplift))

    for name, price in extras:
        if price is None:
            lines.append(_line(f"extra_{_slug(name)}", f"{name} (price TBC)", None))
        else:
            lines.append(_line(f"extra_{_slug(name)}", name, to_pence(price)))

    warnings = []
    if prop.kind == "other":
        warnings.append(_warning(prices, "other_property"))
    else:
        if prop.bedrooms == 1:
            warnings.append(_warning(prices, "gutters_1_bed"))
        if prop.bedrooms in (1, 2):
            warnings.append(_warning(prices, "gutters_small_property"))
        if prop.bedrooms == 5:
            warnings.append(_warning(prices, "gutters_5_bed"))

    options = [
        f"Property: {prop.name if prop.kind == 'standard' else 'Other: ' + prop.description}",
        f"Service: {g['services'][service]}",
        f"Conservatory/extension: {'Yes' if cons else 'No'}",
    ]
    if not manual:
        options.append(f"Heavily soiled: {'Yes' if soiled else 'No'}")
    options.append(f"Price list: {prices['price_list_date']}")

    name = prop.name.replace(" house", "") if prop.kind == "standard" else prop.description
    parts = [f"{name} gutters", _GUTTER_SHORT[service].split(" (")[0]]
    if cons:
        parts.append("conservatory")
    if soiled and not manual:
        parts.append("heavily soiled")

    return _result("gutters", "one_off", "one-off job", lines, override, warnings, None,
                   ("GUTTER & FASCIA QUOTE", options), today, " · ".join(parts), None)


# --- Entry point ---------------------------------------------------------------


def quote(request, today: date | None = None, prices: dict | None = None) -> dict:
    """Price a windows or gutters quote request (a dict shaped like the API body).

    Raises ValidationError with a list of {field, message} for bad input.
    """
    if not isinstance(request, dict):
        raise ValidationError([{"field": "body", "message": "The request must be a JSON object"}])
    quote_type = request.get("quote_type")
    if quote_type not in ("windows", "gutters"):
        raise ValidationError([{"field": "quote_type", "message": "Choose a windows or gutters quote"}])

    prices = prices if prices is not None else load_prices()
    today = today or london_today()
    errs = _Errors()
    if quote_type == "windows":
        return _quote_windows(request, prices, errs, today)
    return _quote_gutters(request, prices, errs, today)


# --- Basket --------------------------------------------------------------------

MAX_BASKET_ITEMS = 50


def basket(request, today: date | None = None, prices: dict | None = None) -> dict:
    """Price every item in a basket and group the totals.

    Per-visit items are grouped by frequency (they can't be added across frequencies);
    one-off windows and all gutter work share a single one-off total. An item that fails
    validation is returned with its errors and left out of the totals.
    """
    if not isinstance(request, dict):
        raise ValidationError([{"field": "body", "message": "The request must be a JSON object"}])
    items = request.get("items")
    if not isinstance(items, list):
        raise ValidationError([{"field": "items", "message": "The basket must be a list of items"}])
    if len(items) > MAX_BASKET_ITEMS:
        raise ValidationError([{"field": "items", "message": f"A basket can hold up to {MAX_BASKET_ITEMS} items"}])

    prices = prices if prices is not None else load_prices()
    today = today or london_today()

    results = []
    for i, item in enumerate(items):
        try:
            results.append({"index": i, "ok": True, "quote": quote(item, today, prices), "errors": []})
        except ValidationError as exc:
            results.append({"index": i, "ok": False, "quote": None, "errors": exc.errors})

    groups = []
    for f in prices["windows"]["frequencies"]:
        matching = [r["quote"] for r in results if r["ok"] and r["quote"]["frequency"] == f]
        if matching:
            groups.append({"basis": "per_visit", "frequency": f, "label": _frequency_label(f),
                           "suffix": "per visit", "total": sum(q["total"] for q in matching),
                           "items": len(matching)})
    one_offs = [r["quote"] for r in results if r["ok"] and r["quote"]["basis"] == "one_off"]
    if one_offs:
        groups.append({"basis": "one_off", "frequency": None, "label": "One-off total", "suffix": "one-off",
                       "total": sum(q["total"] for q in one_offs), "items": len(one_offs)})

    return {"count": len(results), "items": results, "groups": groups,
            "summary_text": _basket_summary(results, groups, today)}


def _basket_summary(results, groups, today) -> str:
    out = ["ABACUS WINDOW CLEANING: BASKET", today.strftime("%d/%m/%Y")]
    n = len(results)
    for r in results:
        out.append("")
        if not r["ok"]:
            out.append(f"ITEM {r['index'] + 1} OF {n}: needs attention (not included in totals)")
            out += [f"  {e['message']}" for e in r["errors"]]
            continue
        q = r["quote"]
        out.append(f"ITEM {r['index'] + 1} OF {n}: {q['title']}")
        body = q["summary_text"].splitlines()[2:]  # drop the per-quote heading and date
        out += [l for l in body if l != "Prices include VAT."]
    out += ["", "=" * SUMMARY_WIDTH, "BASKET TOTALS"]
    for g in groups:
        out.append(_row(f"{g['label']} ({g['suffix']})" if g["basis"] == "per_visit" else g["label"],
                        format_pence(g["total"])))
    if not groups:
        out.append("No priced items")
    out.append("Prices include VAT.")
    return "\n".join(out)
