"""Twilio WhatsApp, Messenger and generic /message handlers with sample payloads (mock LLM)."""

import json

import pytest

from bridge.config import settings

WEBHOOK_PATH = "/twilio/whatsapp"


def _twilio_params(from_: str, body: str, **extra: str) -> dict:
    p = {
        "SmsMessageSid": "SM0000000000000000000000000000abcd",
        "NumMedia": "0",
        "ProfileName": "Test Nurse",
        "MessageType": "text",
        "SmsSid": "SM0000000000000000000000000000abcd",
        "WaId": from_.replace("whatsapp:+", ""),
        "SmsStatus": "received",
        "Body": body,
        "To": "whatsapp:+14155238886",
        "NumSegments": "1",
        "ReferralNumMedia": "0",
        "MessageSid": "SM0000000000000000000000000000abcd",
        "AccountSid": settings.twilio_account_sid,
        "From": from_,
        "ApiVersion": "2010-04-01",
    }
    p.update(extra)
    return p


def _signed_headers(params: dict) -> dict:
    from bridge.server import twilio_signature

    url = settings.public_base_url + WEBHOOK_PATH
    return {"X-Twilio-Signature": twilio_signature(url, params, settings.twilio_auth_token)}


# ------------------------------------------------------------------------------------------- /message

def test_message_guidance(client, fresh_user):
    r = client.post("/message", json={"text": "child with fever for 2 days, RDT positive, 13 kg, what to give", "user_id": fresh_user})
    assert r.status_code == 200
    d = r.json()
    assert d["action"] == "ADVISE" and d["stm"] == "MALARIA" and d["lang"] == "en"
    assert d["chunk"]["section"] == "MALARIA" and "STM: MALARIA" in d["reply_text"]
    assert d["compliant"] and not d["overridden"] and d["model"] == "mock"


def test_message_pijin_detected(client, fresh_user):
    r = client.post("/message", json={"text": "pikinini blong mi hem hot bodi tu dei, RDT positive, wanem meresin?", "user_id": fresh_user})
    d = r.json()
    assert d["lang"] == "pis" and d["action"] == "ADVISE" and "Folom STM" in d["body"]


def test_message_red_flag_overrides(client, fresh_user):
    r = client.post("/message", json={"text": "child with fever and convulsions this morning", "user_id": fresh_user})
    d = r.json()
    assert d["action"] == "REFER_NOW" and d["overridden"] and d["red_flags"][0]["id"] == "convulsions"
    assert d["reply_text"].startswith("[REFER NOW]")


def test_message_red_flag_cites_its_chapter(client, fresh_user):
    """A danger sign steers retrieval to its own STM chapter (BM25 alone ranks PNEUMONIA / COLDS first)."""
    r = client.post("/message", json={"text": "pikinini 2 yia hem hot bodi an hem sek-sek tude moning, hem slip tumas", "user_id": fresh_user})
    d = r.json()
    assert d["action"] == "REFER_NOW" and d["chunk"]["section"] == "CONVULSIONS" and "STM: CONVULSIONS" in d["reply_text"]
    r = client.post("/message", json={"text": "2 year old, cough 3 days, fast breathing and chest indrawing", "user_id": fresh_user})
    d = r.json()
    assert d["action"] == "REFER_NOW" and d["chunk"]["section"] == "PNEUMONIA"


def test_message_next_boat_flag(client, fresh_user):
    r = client.post("/message", json={"text": "child with fever and convulsions", "user_id": fresh_user, "flags": {"transport": "next_boat"}})
    assert r.json()["action"] == "REFER_NEXT_TRANSPORT"


def test_message_abstains_without_guideline(client, fresh_user):
    r = client.post("/message", json={"text": "what is the capital of France", "user_id": fresh_user})
    d = r.json()
    assert d["action"] == "ASK_PERSON" and d["stm"] is None and d["chunk"] is None


def test_message_commands_update_state(client, fresh_user):
    r = client.post("/message", json={"text": "/rdt no", "user_id": fresh_user})
    assert r.json()["command"] and r.json()["flags"]["rdt"] == "no"
    client.post("/message", json={"text": "/boat", "user_id": fresh_user})
    r = client.post("/message", json={"text": "child with fever, what to do", "user_id": fresh_user})
    assert r.json()["flags"] == {"lang": "en", "rdt": "no", "act": "unknown", "transport": "next_boat"}


def test_health(client):
    d = client.get("/health").json()
    assert d["ok"] and d["mock"] and d["corpus"]["chunks"] > 0 and d["twilio"]["signature_check"]


# --------------------------------------------------------------------------------------------- Twilio

def test_twilio_text_signed(client, fresh_user):
    params = _twilio_params(fresh_user, "child with fever for 2 days, RDT positive, what to give")
    r = client.post(WEBHOOK_PATH, data=params, headers=_signed_headers(params))
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("application/xml")
    assert r.text.startswith('<?xml version="1.0" encoding="UTF-8"?><Response><Message><Body>')
    assert "STM: MALARIA" in r.text and "<Media>" not in r.text


def test_twilio_rejects_bad_signature(client, fresh_user):
    params = _twilio_params(fresh_user, "hello")
    assert client.post(WEBHOOK_PATH, data=params, headers={"X-Twilio-Signature": "nope"}).status_code == 403
    assert client.post(WEBHOOK_PATH, data=params).status_code == 403


def test_twilio_command(client, fresh_user):
    params = _twilio_params(fresh_user, "/rdt no")
    r = client.post(WEBHOOK_PATH, data=params, headers=_signed_headers(params))
    assert r.status_code == 200 and "RDT = no" in r.text


def test_twilio_voice_note(client, fresh_user, monkeypatch):
    import bridge.server as srv

    calls = {}

    async def fake_download(url, auth=None):
        calls["download"] = (url, auth)
        return b"OggS fake", "audio/ogg"

    async def fake_transcribe(audio, lang):
        calls["asr"] = (audio, lang)
        return "pikinini hem hot bodi an sitsit wata tri dei"

    async def fake_synth(text, lang, fmt="ogg"):
        calls["tts"] = (text, lang, fmt)
        return settings.public_base_url + "/static/audio/test.ogg"

    monkeypatch.setattr(srv, "download_media", fake_download)
    monkeypatch.setattr(srv, "transcribe", fake_transcribe)
    monkeypatch.setattr(srv, "synthesize", fake_synth)

    params = _twilio_params(
        fresh_user, "", NumMedia="1", MediaContentType0="audio/ogg",
        MediaUrl0="https://api.twilio.com/2010-04-01/Accounts/ACtest/Messages/SM1/Media/ME1",
    )
    r = client.post(WEBHOOK_PATH, data=params, headers=_signed_headers(params))
    assert r.status_code == 200, r.text
    assert calls["download"][1] == (settings.twilio_account_sid, settings.twilio_auth_token)
    assert calls["tts"][1] == "pis" and calls["tts"][2] == "ogg"
    assert "<Media>" in r.text and "/static/audio/test.ogg" in r.text
    assert "DIARRHOEA" in r.text


def test_twilio_xml_escaping():
    from bridge.server import build_twiml

    x = build_twiml("a < b & c > d", "https://x.test/a.ogg?x=1&y=2")
    assert "&lt;" in x and "&amp;" in x and "&gt;" in x and "y=2</Media>" in x


# ------------------------------------------------------------------------------------------ Messenger

def test_messenger_verify_ok(client):
    r = client.get("/messenger/webhook", params={"hub.mode": "subscribe", "hub.verify_token": settings.meta_verify_token, "hub.challenge": "1234567"})
    assert r.status_code == 200 and r.text == "1234567"


def test_messenger_verify_bad_token(client):
    r = client.get("/messenger/webhook", params={"hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "1"})
    assert r.status_code == 403


def _messenger_event(psid: str, text: str | None = None, audio_url: str | None = None) -> dict:
    message = {"mid": "m_abc123"}
    if text is not None:
        message["text"] = text
    if audio_url:
        message["attachments"] = [{"type": "audio", "payload": {"url": audio_url}}]
    return {
        "object": "page",
        "entry": [{
            "id": "1234567890",
            "time": 1700000000000,
            "messaging": [{"sender": {"id": psid}, "recipient": {"id": "1234567890"}, "timestamp": 1700000000000, "message": message}],
        }],
    }


def test_messenger_text_event_sends_reply(client, monkeypatch):
    import bridge.server as srv

    sent = []

    async def fake_send(psid, text, audio_url=None):
        sent.append((psid, text, audio_url))
        return {"status": [200]}

    monkeypatch.setattr(srv, "send_messenger", fake_send)
    r = client.post("/messenger/webhook", json=_messenger_event("psid-001", "child with cough and fast breathing, 2 years old"))
    assert r.status_code == 200 and r.text == "EVENT_RECEIVED" and r.headers["x-lokol-events"] == "1"
    assert sent and sent[0][0] == "psid-001"
    assert sent[0][1].startswith("[REFER NOW]") and "STM:" in sent[0][1]


def test_messenger_audio_event(client, monkeypatch):
    import bridge.server as srv

    sent = []

    async def fake_send(psid, text, audio_url=None):
        sent.append((psid, text, audio_url))
        return {"status": [200]}

    async def fake_download(url, auth=None):
        return b"fake", "audio/mp4"

    async def fake_transcribe(audio, lang):
        return "child with fever for 2 days, RDT positive"

    async def fake_synth(text, lang, fmt="ogg"):
        return f"{settings.public_base_url}/static/audio/x.{fmt}"

    monkeypatch.setattr(srv, "send_messenger", fake_send)
    monkeypatch.setattr(srv, "download_media", fake_download)
    monkeypatch.setattr(srv, "transcribe", fake_transcribe)
    monkeypatch.setattr(srv, "synthesize", fake_synth)
    r = client.post("/messenger/webhook", json=_messenger_event("psid-002", audio_url="https://cdn.fbsbx.com/v/audio.mp4"))
    assert r.status_code == 200
    assert sent and "MALARIA" in sent[0][1] and sent[0][2].endswith(".mp3")


def test_messenger_ignores_echo_and_non_page(client, monkeypatch):
    import bridge.server as srv

    sent = []

    async def fake_send(psid, text, audio_url=None):
        sent.append(psid)

    monkeypatch.setattr(srv, "send_messenger", fake_send)
    ev = _messenger_event("psid-003", "hi")
    ev["entry"][0]["messaging"][0]["message"]["is_echo"] = True
    assert client.post("/messenger/webhook", json=ev).status_code == 200 and not sent
    assert client.post("/messenger/webhook", json={"object": "user"}).status_code == 404


def test_messenger_signature_when_secret_set(client, monkeypatch):
    import hashlib
    import hmac

    monkeypatch.setattr(settings, "meta_app_secret", "s3cret")
    body = json.dumps({"object": "page", "entry": []}).encode()
    sig = "sha256=" + hmac.new(b"s3cret", body, hashlib.sha256).hexdigest()
    assert client.post("/messenger/webhook", content=body, headers={"Content-Type": "application/json", "X-Hub-Signature-256": sig}).status_code == 200
    assert client.post("/messenger/webhook", content=body, headers={"Content-Type": "application/json", "X-Hub-Signature-256": "sha256=bad"}).status_code == 403
