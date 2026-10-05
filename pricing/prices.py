import json
from functools import lru_cache
from pathlib import Path

PRICES_PATH = Path(__file__).resolve().parent.parent / "prices.json"


@lru_cache(maxsize=1)
def _load_text() -> str:
    return PRICES_PATH.read_text(encoding="utf-8")


def load_prices() -> dict:
    """Return a fresh copy of prices.json."""
    return json.loads(_load_text())


def public_config() -> dict:
    """prices.json without the `_readme` note, for GET /api/config."""
    data = load_prices()
    data.pop("_readme", None)
    return data
