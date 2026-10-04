"""Test fixtures: mock LLM, fake Twilio/Meta credentials, temp state dir. Env is set before any
bridge module is imported (settings are read at import time)."""

import os
import sys
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

_TMP = Path(tempfile.mkdtemp(prefix="lokol-bridge-test-"))
os.environ["LOKOL_MOCK"] = "1"
os.environ["TWILIO_AUTH_TOKEN"] = "test_auth_token_123"
os.environ["TWILIO_ACCOUNT_SID"] = "ACtest0000000000000000000000000000"
os.environ["TWILIO_ASYNC"] = "0"
os.environ["PUBLIC_BASE_URL"] = "https://lokol-test.trycloudflare.com"
os.environ["META_VERIFY_TOKEN"] = "verify-me-please"
os.environ["META_PAGE_TOKEN"] = "EAAtestpagetoken"
os.environ["META_APP_SECRET"] = ""
os.environ["LOKOL_STATE_FILE"] = str(_TMP / "users.json")
os.environ["LOKOL_LOG_FILE"] = str(_TMP / "messages.jsonl")
os.environ["LOKOL_STATIC_DIR"] = str(_TMP / "static")


@pytest.fixture(scope="session")
def client():
    from fastapi.testclient import TestClient

    from bridge.config import settings

    settings.reload()
    from bridge.server import app

    with TestClient(app) as c:
        yield c


@pytest.fixture()
def fresh_user():
    """A unique user id per test so per-user state does not leak between tests."""
    import uuid

    return "whatsapp:+1555" + uuid.uuid4().hex[:7]
