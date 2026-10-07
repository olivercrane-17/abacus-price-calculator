"""Shared staff passcode for actions that write to other systems (Pipedrive).

The passcode lives only in the STAFF_PASSCODE environment variable. Unlocking sets an HttpOnly cookie
holding an expiry time and an HMAC of it, keyed on the passcode: no database needed, and changing the
passcode logs every device out. There's no per-IP lockout (the function is stateless); a fixed delay
on wrong attempts slows guessing, so use a long passcode.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import time

COOKIE_NAME = "abacus_staff"
MAX_AGE = 30 * 24 * 60 * 60  # 30 days
WRONG_PASSCODE_DELAY = 1.0


def _passcode() -> str:
    return os.environ.get("STAFF_PASSCODE", "").strip()


def configured() -> bool:
    return bool(_passcode())


def check_passcode(attempt) -> bool:
    secret = _passcode()
    if not secret or not isinstance(attempt, str):
        return False
    # Compare fixed-length digests so the comparison time doesn't depend on the passcode length.
    return hmac.compare_digest(hashlib.sha256(attempt.strip().encode()).digest(),
                               hashlib.sha256(secret.encode()).digest())


def _signature(expires: int, secret: str) -> str:
    return hmac.new(secret.encode(), f"abacus-staff:{expires}".encode(), hashlib.sha256).hexdigest()


def make_token(now: float | None = None) -> str:
    expires = int(now if now is not None else time.time()) + MAX_AGE
    return f"{expires}.{_signature(expires, _passcode())}"


def verify_token(token, now: float | None = None) -> bool:
    secret = _passcode()
    if not secret or not isinstance(token, str) or token.count(".") != 1:
        return False
    expires_text, signature = token.split(".")
    if not expires_text.isdigit():
        return False
    expires = int(expires_text)
    if expires < (now if now is not None else time.time()):
        return False
    return hmac.compare_digest(signature, _signature(expires, secret))
