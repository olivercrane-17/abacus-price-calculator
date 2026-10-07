import pytest

from integrations import auth


@pytest.fixture(autouse=True)
def passcode(monkeypatch):
    monkeypatch.setenv("STAFF_PASSCODE", "window-wash-42")


def test_passcode_check():
    assert auth.check_passcode("window-wash-42") is True
    assert auth.check_passcode(" window-wash-42 ") is True  # stray spaces from copy/paste
    assert auth.check_passcode("window-wash-43") is False
    assert auth.check_passcode("") is False
    assert auth.check_passcode(None) is False


def test_no_passcode_configured_never_unlocks(monkeypatch):
    monkeypatch.delenv("STAFF_PASSCODE")
    assert auth.check_passcode("") is False
    assert auth.check_passcode("anything") is False
    assert auth.verify_token(auth.make_token(now=1000), now=1001) is False


def test_token_round_trip_and_expiry():
    token = auth.make_token(now=1000)
    assert auth.verify_token(token, now=1000 + auth.MAX_AGE - 1) is True
    assert auth.verify_token(token, now=1000 + auth.MAX_AGE + 1) is False


@pytest.mark.parametrize("token", [None, "", "garbage", "123", "abc.def", "9999999999.deadbeef"])
def test_bad_tokens(token):
    assert auth.verify_token(token, now=1000) is False


def test_tampered_expiry_is_rejected():
    exp, sig = auth.make_token(now=1000).split(".")
    forged = f"{int(exp) + 10_000_000}.{sig}"
    assert auth.verify_token(forged, now=1000) is False


def test_changing_the_passcode_logs_everyone_out(monkeypatch):
    token = auth.make_token(now=1000)
    monkeypatch.setenv("STAFF_PASSCODE", "new-passcode")
    assert auth.verify_token(token, now=1001) is False
