"""FastAPI wrapper around the pricing engine (Vercel Python function).

Run locally from the repo root: uvicorn api.index:app --port 8000
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from fastapi import FastAPI, Request  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402

from pricing import ValidationError, public_config, quote  # noqa: E402

app = FastAPI(title="Abacus price calculator API", docs_url=None, redoc_url=None, openapi_url=None)


def _errors(errors: list[dict]) -> JSONResponse:
    return JSONResponse(status_code=422, content={"errors": errors})


@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/config")
def config():
    return public_config()


@app.post("/api/quote")
async def post_quote(request: Request):
    raw = await request.body()
    try:
        body = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        return _errors([{"field": "body", "message": "The request must be valid JSON"}])
    try:
        return quote(body)
    except ValidationError as exc:
        return _errors(exc.errors)
