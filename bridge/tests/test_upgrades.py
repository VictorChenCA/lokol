"""CORS + Private Network Access, /health shape, the River backend (mocked, no network) with its
fallbacks, and the Twilio async path through a mocked REST call."""

import asyncio
import base64
import json
import time
from urllib.parse import parse_qs

import httpx
import pytest

import bridge.llm as llm
import bridge.server as srv
from bridge.config import default_river_checkpoint, settings

S180 = "river://a1fa006b-60ca-4457-b809-5fcbd9d63264/sampler_weights/lokol-health-9b-s180-inf"
STUDIO = "https://lokol.vercel.app"


async def _false() -> bool:
    return False


async def _true() -> bool:
    return True


@pytest.fixture()
def river_mode(monkeypatch):
    """Live (non-mock) River backend with nothing reachable unless a test says otherwise."""
    monkeypatch.setattr(settings, "mock", False)
    monkeypatch.setattr(settings, "llm_backend", "river")
    monkeypatch.setattr(settings, "river_checkpoint", S180)
    monkeypatch.setattr(llm, "llm_ready", _false)
    monkeypatch.setattr(srv, "sidecar_ready", _false)

    async def no_llama(messages):
        raise AssertionError("llama must not be called")

    monkeypatch.setattr(llm, "chat", no_llama)
    return monkeypatch


# ------------------------------------------------------------------------------- CORS + PNA

def test_pna_preflight(client):
    r = client.options("/health", headers={
        "Origin": STUDIO,
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Private-Network": "true",
    })
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == "*"
    assert r.headers["access-control-allow-private-network"] == "true"
    assert "GET" in r.headers["access-control-allow-methods"]


def test_cors_on_simple_get(client):
    r = client.get("/health", headers={"Origin": STUDIO})
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == "*"
    assert r.headers["access-control-allow-private-network"] == "true"


def test_cors_preflight_for_post_message(client):
    r = client.options("/message", headers={"Origin": STUDIO, "Access-Control-Request-Method": "POST",
                                            "Access-Control-Request-Headers": "content-type"})
    assert r.status_code == 200 and r.headers["access-control-allow-origin"] == "*"


# ----------------------------------------------------------------------------------- /health

def test_health_shape_never_leaks_secrets(client):
    r = client.get("/health")
    d = r.json()
    assert d["ok"] is True and d["mode"] == "mock"
    assert d["llm"]["backend"] == "mock" and d["llm"]["reachable"] is True
    assert isinstance(d["sidecar"]["reachable"], bool)
    assert d["twilio"]["configured"] is True and d["messenger"]["configured"] is True
    assert d["public_base_url"] == settings.public_base_url
    # backwards-compatible fields the Studio page reads
    assert d["llm"]["ready"] is True and "ready" in d["sidecar"] and d["corpus"]["chunks"] > 0
    for secret in (settings.twilio_auth_token, settings.twilio_account_sid, settings.meta_page_token):
        assert secret not in r.text


def test_health_river_mode(client, river_mode):
    d = client.get("/health").json()
    assert d["mode"] == "river"
    assert d["llm"]["backend"] == "river" and d["llm"]["model"] == "river:lokol-health-9b-s180-inf"
    assert d["llm"]["fallback"]["reachable"] is False and "reachable" in d["llm"]


def test_health_hides_localhost_public_url(client, monkeypatch):
    monkeypatch.setattr(settings, "public_base_url", "http://localhost:8090")
    assert client.get("/health").json()["public_base_url"] is None


# ------------------------------------------------------------------------------------ River

def test_default_checkpoint_prefers_step_180():
    assert default_river_checkpoint() == S180


def test_default_checkpoint_missing_file(tmp_path):
    assert default_river_checkpoint(tmp_path / "nope.json") == ""
    p = tmp_path / "c.json"
    p.write_text(json.dumps({"best": {"step": 90, "inference": "river://x/s090"}, "checkpoints": [{"step": 90, "inference": "river://x/s090"}]}))
    assert default_river_checkpoint(p) == "river://x/s090"


def test_parse_chat_response_json_string():
    body = {"choices": [{"message": {"role": "assistant", "content": "ACTION: ADVISE\nSTM: MALARIA\n---\nok"}}]}
    assert llm.parse_chat_response_json(json.dumps(body)).startswith("ACTION: ADVISE")
    assert llm.parse_chat_response_json(json.dumps(json.dumps(body))).endswith("ok")  # double-encoded
    assert llm.parse_chat_response_json("{}") == ""


def test_message_river_backend(client, fresh_user, river_mode):
    seen = {}

    def fake_complete(messages):
        seen["messages"] = messages
        return "ACTION: ADVISE\nSTM: MALARIA\n---\nGivim AL folom weight.\nKam bak long 2 dei."

    river_mode.setattr(llm.RIVER, "complete", fake_complete)
    r = client.post("/message", json={"text": "pikinini blong mi hem hot bodi tu dei, RDT positive, wanem meresin?", "user_id": fresh_user})
    d = r.json()
    assert r.status_code == 200 and d["backend"] == "river" and d["model"] == "river:lokol-health-9b-s180-inf"
    assert d["action"] == "ADVISE" and d["stm"] == "MALARIA" and d["error"] is None
    sys_msg, user_msg = seen["messages"]
    assert sys_msg["content"] == llm.SYSTEM_PROMPT  # tuned model: SYSTEM_PROMPT only, no format hint
    assert user_msg["content"].startswith("[lang=pis] ") and "[guideline: MALARIA" in user_msg["content"]


def test_message_river_red_flag_still_gated(client, fresh_user, river_mode):
    river_mode.setattr(llm.RIVER, "complete", lambda m: "ACTION: ADVISE\nSTM: FEVER\n---\nGive paracetamol.")
    d = client.post("/message", json={"text": "child with fever and convulsions this morning", "user_id": fresh_user}).json()
    assert d["backend"] == "river" and d["action"] == "REFER_NOW" and d["overridden"]


def test_river_timeout_falls_back_to_canned(client, fresh_user, river_mode):
    river_mode.setattr(settings, "river_timeout", 0.2)

    def slow(messages):
        time.sleep(0.6)
        return "ACTION: ADVISE\nSTM: MALARIA\n---\ntoo late"

    river_mode.setattr(llm.RIVER, "complete", slow)
    d = client.post("/message", json={"text": "child with fever for 2 days, RDT positive, what to give", "user_id": fresh_user}).json()
    assert d["backend"] == "canned" and d["action"] == "ASK_PERSON" and "timed out" in d["error"]
    assert "nurse in charge" in d["reply_text"]


def test_river_down_still_refers_danger_signs(client, fresh_user, river_mode):
    """Model unavailable + a danger sign: the canned ASK_PERSON is overridden to REFER_NOW."""
    def boom(messages):
        raise RuntimeError("UNAVAILABLE")

    river_mode.setattr(llm.RIVER, "complete", boom)
    d = client.post("/message", json={"text": "child with fever and convulsions this morning", "user_id": fresh_user}).json()
    assert d["backend"] == "canned" and d["action"] == "REFER_NOW" and d["overridden"]


def test_river_error_falls_back_to_llama(client, fresh_user, river_mode):
    def boom(messages):
        raise RuntimeError("UNAVAILABLE: connection reset")

    calls = []

    async def fake_chat(messages):
        calls.append(messages)
        return "ACTION: ADVISE\nSTM: MALARIA\n---\nGive AL by weight."

    river_mode.setattr(llm.RIVER, "complete", boom)
    river_mode.setattr(llm, "llm_ready", _true)
    river_mode.setattr(llm, "chat", fake_chat)
    d = client.post("/message", json={"text": "child with fever for 2 days, RDT positive, what to give", "user_id": fresh_user}).json()
    assert d["backend"] == "llama" and d["action"] == "ADVISE" and "connection reset" in d["error"]
    assert llm.FORMAT_HINT in calls[0][0]["content"]  # the base/llama fallback keeps the format hint


def test_river_complete_reconnects_after_error(monkeypatch):
    """RiverChat drops its client/session on error and builds a new one on the next call."""
    made = []

    class FakeSession:
        def __init__(self, fail):
            self.fail = fail

        def sample(self, prompts, **kw):
            if self.fail:
                raise RuntimeError("stream reset")

            class Out:
                text = "ACTION: ASK_PERSON\nSTM: NONE\n---\nask"
                tokens = [1, 2]

            return [[Out()]]

    class FakeCtx:
        def __init__(self, fail):
            self.s = FakeSession(fail)

        def __enter__(self):
            return self.s

        def __exit__(self, *a):
            pass

    class FakeClient:
        def __init__(self, api_key):
            made.append(self)

        def session(self, experiment):
            return FakeCtx(fail=len(made) == 1)

        def close(self):
            pass

    class FakePrompt:
        def to_kwargs(self):
            return {"prompt": "<prompt>"}

    class FakeRenderer:
        def build_sample_prompt(self, messages):
            return FakePrompt()

    import sys
    import types

    fake_mod = types.ModuleType("river_client")  # the real import takes seconds; nothing here touches it
    fake_mod.Client = FakeClient
    monkeypatch.setitem(sys.modules, "river_client", fake_mod)
    monkeypatch.setenv("RIVER_API_KEY", "test-key")
    rc = llm.RiverChat()
    rc._renderer = FakeRenderer()
    with pytest.raises(RuntimeError):
        rc.complete([{"role": "user", "content": "x"}])
    assert rc.last_ok is False and rc._session is None
    assert rc.complete([{"role": "user", "content": "x"}]).startswith("ACTION: ASK_PERSON")
    assert len(made) == 2 and rc.last_ok is True


# ------------------------------------------------------------------------------ Twilio async

def test_twilio_async_replies_via_rest(client, fresh_user, monkeypatch):
    """TWILIO_ASYNC=1: empty TwiML right away, then the reply through the REST API (mocked)."""
    from bridge.tests.test_webhooks import WEBHOOK_PATH, _signed_headers, _twilio_params

    sent = []

    def handler(request: httpx.Request) -> httpx.Response:
        sent.append(request)
        return httpx.Response(201, json={"sid": "SMfake", "status": "queued"})

    monkeypatch.setattr(settings, "twilio_async", True)
    monkeypatch.setattr(srv, "_twilio_transport", httpx.MockTransport(handler))
    params = _twilio_params(fresh_user, "child with fever for 2 days, RDT positive, what to give")
    r = client.post(WEBHOOK_PATH, data=params, headers=_signed_headers(params))
    assert r.status_code == 200
    assert r.text == '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'
    assert len(sent) == 1  # TestClient runs background tasks before returning
    req = sent[0]
    assert req.method == "POST"
    assert str(req.url) == f"https://api.twilio.com/2010-04-01/Accounts/{settings.twilio_account_sid}/Messages.json"
    user, _, pw = base64.b64decode(req.headers["authorization"].split()[1]).decode().partition(":")
    assert user == settings.twilio_account_sid and pw == settings.twilio_auth_token
    form = {k: v[0] for k, v in parse_qs(req.content.decode()).items()}
    # the reply goes out from the number the user wrote to (inbound "To"), falling back to the configured sender
    assert form["To"] == fresh_user and form["From"] in (params.get("To"), settings.twilio_whatsapp_from)
    assert "STM: MALARIA" in form["Body"] and "MediaUrl" not in form


def test_twilio_async_rest_failure_is_logged_not_raised(client, fresh_user, monkeypatch, caplog):
    from bridge.tests.test_webhooks import WEBHOOK_PATH, _signed_headers, _twilio_params

    monkeypatch.setattr(settings, "twilio_async", True)
    monkeypatch.setattr(srv, "_twilio_transport", httpx.MockTransport(
        lambda req: httpx.Response(401, json={"code": 20003, "message": "Authenticate"})))
    params = _twilio_params(fresh_user, "/rdt no")
    with caplog.at_level("WARNING", logger="lokol.bridge"):
        r = client.post(WEBHOOK_PATH, data=params, headers=_signed_headers(params))
    assert r.status_code == 200 and "<Message>" not in r.text
    assert any("twilio REST send failed: status=401" in m for m in caplog.messages)


def test_twilio_async_needs_credentials(client, fresh_user, monkeypatch):
    """Without SID+token the webhook stays synchronous (TwiML reply in the response)."""
    from bridge.tests.test_webhooks import WEBHOOK_PATH, _twilio_params

    monkeypatch.setattr(settings, "twilio_async", True)
    monkeypatch.setattr(settings, "twilio_account_sid", "")
    monkeypatch.setattr(settings, "twilio_auth_token", "")  # also disables the signature check
    params = _twilio_params(fresh_user, "child with fever for 2 days, RDT positive, what to give")
    r = client.post(WEBHOOK_PATH, data=params)
    assert r.status_code == 200 and "<Message><Body>" in r.text and "STM: MALARIA" in r.text


def test_generate_llama_down_is_canned(monkeypatch):
    monkeypatch.setattr(settings, "llm_backend", "llama")

    async def down(messages):
        raise httpx.ConnectError("refused")

    monkeypatch.setattr(llm, "chat", down)
    gen = asyncio.run(llm.generate({"lang": "en"}, "[guideline: none] none", "hello", "en"))
    assert gen.backend == "canned" and gen.raw.startswith("ACTION: ASK_PERSON") and "refused" in gen.error
