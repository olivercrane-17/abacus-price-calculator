"""Run the API locally with a FAKE Pipedrive, to try the "Send to Pipedrive" flow without a real account.

    .venv\\Scripts\\python scripts\\dev_fake_pipedrive.py

Staff passcode for this fake server: demo-passcode
Nothing leaves this computer: Pipedrive calls are answered in memory and printed (without customer data).
"jane@example.com" is treated as an existing Pipedrive contact; any other email creates a new one.
For the real thing, set PIPEDRIVE_API_TOKEN, PIPEDRIVE_COMPANY_DOMAIN and STAFF_PASSCODE in Vercel.
"""

import io
import itertools
import json
import os
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

os.environ.update({
    "PIPEDRIVE_API_TOKEN": "fake-local-token",
    "PIPEDRIVE_COMPANY_DOMAIN": "abacus-demo",
    "STAFF_PASSCODE": "demo-passcode",
})

from integrations import pipedrive  # noqa: E402

_ids = itertools.count(1001)


class _Resp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def fake_urlopen(req, timeout=None):
    url = urlparse(req.full_url)
    method = req.get_method()
    print(f"[fake pipedrive] {method} {url.path}", flush=True)
    if url.path == "/api/v2/persons/search":
        term = parse_qs(url.query).get("term", [""])[0]
        items = [{"item": {"id": 42}}] if term == "jane@example.com" else []
        return _Resp(json.dumps({"success": True, "data": {"items": items}}).encode())
    return _Resp(json.dumps({"success": True, "data": {"id": next(_ids)}}).encode())


pipedrive.urlopen = fake_urlopen

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("api.index:app", host="127.0.0.1", port=8000)
