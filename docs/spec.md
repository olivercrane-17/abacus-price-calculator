# Abacus price calculator: design spec

Date: 2026-10-05. Source price list: `Window Cleaning Price List Feb 25.xlsx`. All prices live in `prices.json`.

## Purpose

An internal web tool for Abacus Window Cleaning Ltd staff taking enquiries. Staff quickly and accurately quote
**window cleaning** and **gutter & fascia** work from the Feb 25 price list. It is desktop-first but works on a phone.

- Hosted on the Vercel free tier with **no login** (the prices are public).
- **Nothing is stored and there are no customer details.** The result is shown on screen with a "Copy" button that
  copies a compact **internal** breakdown for staff records.
- Prices **include VAT**. The UI never adds VAT.
- Window quotes and gutter quotes are **separate** (two tabs) and never combined.

## Architecture

- `prices.json` at the repo root is the single source of truth for every price and warning string.
- `pricing/`: a pure-Python pricing engine with no web code. It uses `Decimal` and rounds half-up to pence.
  All business rules live here and are covered by pytest in `tests/`.
- `api/index.py`: a FastAPI app (Vercel Python serverless function) that wraps the engine.
- Front end: a Vite + React + TypeScript static site at the repo root (`index.html`, `src/`), built to `dist/`.
  It calls the API live as staff change options (debounced, stale requests aborted). It holds **no pricing logic**
  and only formats what the API returns.
- `vercel.json` rewrites `/api/*` to the Python function and includes `prices.json` and `pricing/**` in it.
- Local dev: run `uvicorn api.index:app --port 8000`, and Vite proxies `/api` to it.

## Pricing rules: windows

Inputs:
- Property: a standard 1–5 bed house, OR "other" (staff enter a description and their own window price).
- Frequency: `4`, `6`, `8`, `12` (weekly) or `one_off`.
- Conservatory/extension: `none`, `standard`, `large`.
  - Regular: standard adds `conservatory_addon` for the bedroom count.
  - One-off: standard uses `one_off_with_conservatory` instead of `one_off`.
  - Large: staff enter the conservatory charge, which **replaces** the standard charge (regular: replaces the add-on;
    one-off: base = `one_off` + the staff amount). It shows the `large_conservatory` warning.
  - Not available for an "other" property (the staff price covers it).
- Internal windows (toggle): internal = `internal_multiplier` (2) × the external window price (house +
  conservatory, or the staff price for "other"). It is added to every visit on regular cleans, or once for a one-off.
- Conservatory roof: outside panels × £8, raised to a **£25 minimum** if outside panels > 0. Inside panels × £16 with
  no minimum.
- Velux: outside count × £1.50, inside count × £3.
- Roof lanterns: counts per size (small/medium/large) for outside and inside, at £10/£15/£20 outside and
  £20/£30/£40 inside. "Larger structure": staff enter a price (from customer photos). It shows the `larger_lantern`
  warning.
- All roof extras are charged on **every visit** for regular cleans, or once for a one-off.
- Comparison: for a standard property on a regular frequency, the response includes the per-visit total for all four
  frequencies with the same options (no override applied).

## Pricing rules: gutters

Inputs:
- Property: a standard 1–5 bed house, or "other" (staff description).
- Service (pick one): `clearance`, `outer`, `package3` (Package 3 = both together at the bundle price).
- Conservatory/extension: yes/no (2 bed is the same price either way).
- Heavily soiled (tick box): the sheet price × 2.5 for any of the three services. **Not available when the price is
  staff-entered** (1 bed or "other"), where staff just type the final price.
- 1 bed or "other": no set price, so `manual_price` is required. Shows the `gutters_1_bed` or `other_property` warning.
- Warnings: 1 and 2 bed show `gutters_small_property`, and 5 bed shows `gutters_5_bed`.
- Ask-about extras (gutters only): Hedgehog Gutter Guards, Power Source, Garden Waste. Each has a "selected" tick and
  an optional price. A selected item with a price adds a line. A selected item with no price is listed as
  "price TBC" (amount `null`) and is not added to the total.

## Both quote types

- Total override: staff may replace the final total with any amount and **must** give a reason. The response keeps
  the calculated subtotal and shows the override.
- Copy summary: plain text, compact, line by line, for internal records. It includes the date, quote type, the
  options chosen, each line, any override and reason, warnings, and "Prices include VAT".

## API contract

All money in **requests** is in pounds (JSON number). All money in **responses** is in integer **pence**.

### `GET /api/config`
Returns the content of `prices.json` (without `_readme`). The UI uses it for labels, available sizes and lantern
sizes, ask-about names and the price-list date.

### `GET /api/health` → `{"ok": true}`

### `POST /api/quote`

Windows request:
```json
{
  "quote_type": "windows",
  "property": {"kind": "standard", "bedrooms": 3},
  "frequency": "4",
  "conservatory": "standard",
  "large_conservatory_price": null,
  "internal": false,
  "conservatory_roof": {"external_panels": 0, "internal_panels": 0},
  "velux": {"external": 0, "internal": 0},
  "lanterns": {
    "small": {"external": 0, "internal": 0},
    "medium": {"external": 0, "internal": 0},
    "large": {"external": 0, "internal": 0},
    "larger_price": null
  },
  "override": null
}
```
- For an "other" property: `"property": {"kind": "other", "description": "6 bed detached", "price": 55}`.
- `override`: `{"total": 40, "reason": "Regular customer rate"}`.
- Optional fields may be omitted and default to zero, false or null.

Gutters request:
```json
{
  "quote_type": "gutters",
  "property": {"kind": "standard", "bedrooms": 3},
  "service": "package3",
  "conservatory": false,
  "heavily_soiled": false,
  "manual_price": null,
  "extras": [{"name": "Hedgehog Gutter Guards", "selected": true, "price": null}],
  "override": null
}
```

Response (both types):
```json
{
  "quote_type": "windows",
  "basis": "per_visit",
  "basis_label": "per visit, every 4 weeks",
  "lines": [
    {"key": "house", "label": "3 bed house: windows outside", "amount": 2700},
    {"key": "conservatory", "label": "Conservatory/extension", "amount": 900}
  ],
  "subtotal": 3600,
  "override": null,
  "total": 3600,
  "warnings": [{"key": "large_conservatory", "message": "..."}],
  "comparison": [
    {"frequency": "4", "label": "Every 4 weeks", "total": 3600, "selected": true},
    {"frequency": "6", "label": "Every 6 weeks", "total": 3700, "selected": false}
  ],
  "summary_text": "ABACUS WINDOW CLEANING: QUOTE ..."
}
```
- `basis`: `per_visit` (regular windows) or `one_off` (one-off windows and all gutter work).
- `comparison` is `null` unless it's a windows quote, a standard property and a regular frequency.
- `override` in the response: `{"total": 4000, "reason": "..."}` (pence) or `null`. `total` = the override total if
  set, otherwise `subtotal`.
- A line's `amount` may be `null` only for ask-about extras with no price.
- Validation errors → HTTP 422 `{"errors": [{"field": "large_conservatory_price", "message": "Enter the conservatory charge"}]}`.
  The messages are written for staff to read and are shown inline in the UI next to the field.

## UX / visual direction

- **Bold & branded**: a strong royal-blue (#0A1683) header and price panel, slate (#4A5263) secondary text, high
  contrast and punchy type. The logo is recreated in code: "Abacus" in a heavy geometric sans in royal blue, and
  "Window Cleaning Ltd" in a slate serif beneath (light-on-dark variant inside blue areas).
- Desktop layout: the options form on the left, and a sticky live price panel on the right (big animated total, line
  breakdown, warnings, frequency comparison, override, Copy button). Phone: the panel becomes a sticky bottom bar
  that expands.
- Tabs: Windows | Gutters & fascias. A Reset button clears the current tab.
- Fast to operate by keyboard: segmented controls, steppers for counts, and sensible defaults (3 bed, 4 weekly,
  no conservatory).
- Warnings are prominent amber banners in the price panel, and next to the relevant control.
- The footer shows the price-list date and the office numbers.

## Basket (added 2026-10-05)

Staff configure a quote in either tab, then click **Add to basket**. The basket holds any number of window and
gutter items.

- **Overrides** stay per item. The basket only adds up item totals.
- **Totals are grouped**, because per-visit prices can't be summed across frequencies or with one-off work: one
  group per regular frequency (per visit), plus one **One-off total** (one-off windows and all gutter work).
- **Basket UI:** each item shows its `title` and total, with Edit (loads it back into its tab; the button becomes
  "Update item") and Remove. There's also Clear basket (with confirmation) and **Copy basket for records**, which
  copies the combined `summary_text`.
- **Saving:** the basket is saved in the browser's localStorage as the list of quote *request* bodies (no customer
  data). Items are re-priced through the API on every load, so price changes apply to saved baskets.

### API additions
- Every quote response now also has `title` (a short item name, e.g. "3 bed windows · every 4 weeks ·
  conservatory") and `frequency` (`"4"|"6"|"8"|"12"|"one_off"` for windows, `null` for gutters).
- `POST /api/basket` with `{"items": [<quote request>, ...]}` (max 50) returns:
```json
{
  "count": 2,
  "items": [
    {"index": 0, "ok": true, "quote": {"...": "full quote response"}, "errors": []},
    {"index": 1, "ok": false, "quote": null, "errors": [{"field": "...", "message": "..."}]}
  ],
  "groups": [
    {"basis": "per_visit", "frequency": "4", "label": "Every 4 weeks", "suffix": "per visit", "total": 3600, "items": 1},
    {"basis": "one_off", "frequency": null, "label": "One-off total", "suffix": "one-off", "total": 20000, "items": 1}
  ],
  "summary_text": "ABACUS WINDOW CLEANING: BASKET ..."
}
```
  An invalid item is returned with its errors and left out of the totals. A malformed body returns 422
  `{"errors": [...]}`.

## Customer details (added 2026-10-07)

Customer contact details can be added to the basket. They exist only to go into **Copy basket for records**: no
sending, no customer database.

- **Fields (all optional):** name, address line 1, address line 2, town, postcode, phone, email, how they heard of
  us, preferred contact method, notes.
  - **How they heard of us:** Google / web search, Facebook / social media, Recommendation, Saw us working / van /
    flyer, or Other (free text).
  - **Preferred contact:** Phone call, Text message, Email, WhatsApp.
- **Placement:** a collapsible "Customer details" section at the top of the basket drawer. The header basket button
  shows the customer's first name once it's entered.
- **Frictionless entry:**
  - The postcode formats as it's typed and is looked up automatically. Town and county fill in, but never over
    anything staff typed.
  - Phone numbers are formatted when the field loses focus, and email typos get a one-click fix.
  - Chips are used instead of free text wherever possible, and Enter moves to the next field.
- **Privacy:**
  - The details are kept in **sessionStorage** (`abacus.customer.v1`), so they survive a refresh but are wiped when
    the tab closes.
  - **Clear basket** clears the customer as well.
  - The copied customer block is built in the browser. The only customer data sent to our server is the
    **postcode**, for the lookup, and it isn't stored or logged by the app.
- **Copied record:** a "CUSTOMER" block (only the filled-in fields) followed by the basket summary. With customer
  details but no jobs, the record is the block plus "No jobs in basket", so Copy basket works either way.

### Postcode lookup API
`GET /api/address?postcode=GU98AB` → `{"postcode", "valid": true|false|null, "town", "county", "addresses": [...],
"provider"}`.
- `valid: null` means the lookup service was unreachable, so staff type the address by hand.
- A malformed postcode returns 422 on the `postcode` field.
- **Free by default:** postcodes.io, which gives the town and county only. The town is the parish, or the local
  authority district when the area is unparished.
- **Paid full-address picker:** set the `IDEAL_POSTCODES_API_KEY` environment variable in Vercel. `addresses` then
  lists every address at the postcode, and the form shows an address dropdown. No code change is needed.
