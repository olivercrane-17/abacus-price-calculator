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
