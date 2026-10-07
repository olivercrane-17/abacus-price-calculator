# Abacus Price Calculator

An internal quoting tool for Abacus Window Cleaning Ltd staff. It handles window cleaning and gutter & fascia
quotes from the Feb 2025 price list.

- **Pricing engine:** Python (`pricing/`), tested with pytest (`tests/`).
- **API:** FastAPI (`api/index.py`), running as a Vercel serverless function.
- **Website:** Vite + React + TypeScript (`src/`), built to static files.
- **Prices:** `prices.json`. See [UPDATING-PRICES.md](UPDATING-PRICES.md).
- **Design and rules:** [docs/spec.md](docs/spec.md).

## Run locally

```bash
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt uvicorn pytest httpx
.venv\Scripts\python -m uvicorn api.index:app --port 8000
```

In a second terminal:

```bash
npm install
npm run dev
```

Then open the URL Vite prints (`/api` is proxied to port 8000).

## Tests

```bash
.venv\Scripts\python -m pytest
```

## Deploy

1. Import the GitHub repo into Vercel (Add New → Project). Vercel reads `vercel.json`, so no settings need changing.
2. Every push to `main` redeploys.

## Send to Pipedrive (optional)

To switch on the **Send to Pipedrive** button, add these in Vercel (Project → Settings → Environment Variables),
then redeploy:

- `PIPEDRIVE_API_TOKEN`: from Pipedrive → Personal preferences → API.
- `PIPEDRIVE_COMPANY_DOMAIN`: e.g. `abacus` if your Pipedrive address is abacus.pipedrive.com.
- `STAFF_PASSCODE`: a long shared passcode that staff enter once per device.
- New deals go to the **"Deal Added"** stage of the **"Website"** pipeline, found by name. To use a different
  place, set `PIPEDRIVE_PIPELINE` / `PIPEDRIVE_STAGE` (names) or `PIPEDRIVE_STAGE_ID` (optional).

Never put these values in the code; the repo is public. To try the flow locally without a real account, run
`.venv\Scripts\python scripts\dev_fake_pipedrive.py` (passcode `demo-passcode`) alongside `npm run dev`.

