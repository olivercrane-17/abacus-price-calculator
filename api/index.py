"""FastAPI wrapper around the pricing engine (Vercel Python function).

Run locally from the repo root: uvicorn api.index:app --port 8000
"""

import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from fastapi import FastAPI, Request  # noqa: E402
from fastapi.concurrency import run_in_threadpool  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402

from integrations import auth, pipedrive  # noqa: E402
from lookup.address import InvalidPostcode, lookup as address_lookup  # noqa: E402
from pricing import ValidationError, basket, public_config, quote  # noqa: E402

app = FastAPI(title="Abacus price calculator API", docs_url=None, redoc_url=None, openapi_url=None)


def _errors(errors: list[dict], status: int = 422) -> JSONResponse:
    return JSONResponse(status_code=status, content={"errors": errors})


@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/config")
def config():
    return {**public_config(), "pipedrive": {"enabled": pipedrive.enabled()}}


async def _json_body(request: Request):
    """The parsed JSON body, or a 422 response if it isn't valid JSON."""
    try:
        return json.loads(await request.body()), None
    except (ValueError, UnicodeDecodeError):
        return None, _errors([{"field": "body", "message": "The request must be valid JSON"}])


async def _handle(request: Request, fn):
    body, error = await _json_body(request)
    if error:
        return error
    try:
        return fn(body)
    except ValidationError as exc:
        return _errors(exc.errors)


@app.post("/api/quote")
async def post_quote(request: Request):
    return await _handle(request, quote)


@app.post("/api/basket")
async def post_basket(request: Request):
    return await _handle(request, basket)


@app.get("/api/address")
def get_address(postcode: str = ""):
    # Only the postcode reaches the server; the customer's other details stay in the browser.
    try:
        return address_lookup(postcode)
    except InvalidPostcode as exc:
        return _errors([{"field": "postcode", "message": str(exc)}])


# --- Pipedrive (behind the shared staff passcode) ----------------------------------------

_NOT_SET_UP = [{"field": "pipedrive", "message": "Sending to Pipedrive isn't set up"}]


def _unlocked(request: Request) -> bool:
    return auth.verify_token(request.cookies.get(auth.COOKIE_NAME))


@app.get("/api/session")
def session(request: Request):
    return {"unlocked": pipedrive.enabled() and _unlocked(request)}


@app.post("/api/unlock")
async def unlock(request: Request):
    if not pipedrive.enabled():
        return _errors(_NOT_SET_UP, 404)
    body, error = await _json_body(request)
    if error:
        return error
    attempt = body.get("passcode") if isinstance(body, dict) else None
    if not auth.check_passcode(attempt):
        await asyncio.sleep(auth.WRONG_PASSCODE_DELAY)  # slows guessing
        return _errors([{"field": "passcode", "message": "That passcode isn't right"}], 401)
    response = JSONResponse({"ok": True})
    response.set_cookie(auth.COOKIE_NAME, auth.make_token(), max_age=auth.MAX_AGE, path="/api",
                        httponly=True, secure=True, samesite="strict")
    return response


@app.post("/api/lock")
def lock():
    response = JSONResponse({"ok": True})
    response.delete_cookie(auth.COOKIE_NAME, path="/api", httponly=True, secure=True, samesite="strict")
    return response


@app.post("/api/pipedrive/send")
async def send_to_pipedrive(request: Request):
    if not pipedrive.enabled():
        return _errors(_NOT_SET_UP, 404)
    if not _unlocked(request):
        return _errors([{"field": "passcode", "message": "Unlock sending on this device first"}], 401)
    body, error = await _json_body(request)
    if error:
        return error
    try:
        # Pipedrive calls block, so run them off the event loop.
        return await run_in_threadpool(pipedrive.send_quote, body)
    except ValidationError as exc:
        return _errors(exc.errors)
    except pipedrive.PipedriveError as exc:
        return _errors([{"field": "pipedrive", "message": exc.message}], 502)
