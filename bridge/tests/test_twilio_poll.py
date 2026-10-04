"""Twilio polling mode (free trial tier): list -> new inbound -> webhook handler -> REST reply.
Everything goes through an httpx.MockTransport; no test touches the network."""

import asyncio
import base64
import json
import logging
from email.utils import format_datetime
from datetime import datetime, timezone
from urllib.parse import parse_qs

import httpx
import pytest

from bridge import twilio_poll
from bridge.twilio_poll import TwilioPoller

SID = "ACpoll000000000000000000000000000"
TOKEN = "poll_secret_token_xyz"
FROM = "whatsapp:+17372583742"
NURSE = "whatsapp:+15550001234"
NOW = 1_790_000_000.0  # fixed clock


def _date(ts: float) -> str:
    return format_datetime(datetime.fromtimestamp(ts, timezone.utc))


def _msg(sid: str, body: str = "hello", *, ago: float = 5, direction: str = "inbound", frm: str = NURSE, num_media: int = 0) -> dict:
    return {"sid": sid, "from": frm, "to": FROM, "body": body, "direction": direction, "num_media": str(num_media),
            "status": "received", "date_sent": _date(NOW - ago), "date_created": _date(NOW - ago),
            "subresource_uris": {"media": f"/2010-04-01/Accounts/{SID}/Messages/{sid}/Media.json"}}


class FakeTwilio:
    """Records every request; serves a mutable message list, media lists and a send endpoint."""

    def __init__(self, messages=None, list_status=200, send_status=201):
        self.messages = list(messages or [])
        self.list_status = list_status
        self.send_status = send_status
        self.requests: list[httpx.Request] = []
        self.media: dict[str, list[dict]] = {}

    @property
    def sends(self) -> list[dict]:
        return [{k: v[0] for k, v in parse_qs(r.content.decode()).items()} for r in self.requests if r.method == "POST"]

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        path = request.url.path
        if request.method == "GET" and path.endswith(f"/Accounts/{SID}/Messages.json"):
            if self.list_status != 200:
                return httpx.Response(self.list_status, json={"code": 20003, "message": "Authenticate"})
            return httpx.Response(200, json={"messages": list(reversed(self.messages)), "page_size": 20})
        if request.method == "GET" and path.endswith("/Media.json"):
            msid = path.split("/Messages/")[1].split("/")[0]
            return httpx.Response(200, json={"media_list": self.media.get(msid, [])})
        if request.method == "POST" and path.endswith(f"/Accounts/{SID}/Messages.json"):
            return httpx.Response(self.send_status, json={"sid": "SMout" + str(len(self.requests)), "status": "queued"})
        return httpx.Response(404, json={"message": "not found"})

    @property
    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handler)


def _poller(fake: FakeTwilio, tmp_path, process=None, **kw) -> TwilioPoller:
    calls = []

    async def fake_process(params):
        calls.append(params)
        return {"reply_text": f"reply to {params['Body']}", "audio_url": None, "action": "ADVISE", "backend": "mock"}

    p = TwilioPoller(account_sid=SID, auth_token=TOKEN, whatsapp_from=FROM, seen_path=tmp_path / "seen.json",
                     interval=0.001, process=process or fake_process, transport=fake.transport, clock=lambda: NOW, **kw)
    p.calls = calls
    return p


def _seed_seen(tmp_path, sids):
    (tmp_path / "seen.json").write_text(json.dumps({"seen": sids}))


def test_first_start_marks_existing_seen_and_answers_nothing(tmp_path):
    fake = FakeTwilio([_msg("SMold1"), _msg("SMold2"), _msg("SMout1", direction="outbound-api", frm=FROM)])
    p = _poller(fake, tmp_path)
    assert p.load_seen() is False
    assert asyncio.run(p.poll_once()) == []
    assert fake.sends == [] and p.calls == []
    assert set(json.loads((tmp_path / "seen.json").read_text())["seen"]) == {"SMold1", "SMold2"}


def test_list_request_shape_and_basic_auth(tmp_path):
    fake = FakeTwilio([])
    p = _poller(fake, tmp_path)
    asyncio.run(p.poll_once())
    r = fake.requests[0]
    q = parse_qs(r.url.query.decode())
    assert r.url.host == "api.twilio.com" and r.url.path == f"/2010-04-01/Accounts/{SID}/Messages.json"
    assert q["To"] == [FROM] and q["PageSize"] == ["20"] and "DateSent>" in q
    assert q["DateSent>"][0] <= datetime.fromtimestamp(NOW, timezone.utc).strftime("%Y-%m-%d")
    assert r.headers["authorization"] == "Basic " + base64.b64encode(f"{SID}:{TOKEN}".encode()).decode()


def test_new_inbound_answered_once_via_rest(tmp_path):
    _seed_seen(tmp_path, ["SMold1"])
    fake = FakeTwilio([_msg("SMold1"), _msg("SMnew1", "child fever two days")])
    p = _poller(fake, tmp_path)
    p.load_seen()
    res = asyncio.run(p.poll_once())
    assert len(res) == 1 and res[0]["sent"] is True and res[0]["status"] == 201
    assert p.calls[0]["From"] == NURSE and p.calls[0]["Body"] == "child fever two days" and p.calls[0]["NumMedia"] == "0"
    assert fake.sends == [{"From": FROM, "To": NURSE, "Body": "reply to child fever two days"}]
    # second pass over the same list: nothing new, nothing sent
    asyncio.run(p.poll_once())
    assert len(fake.sends) == 1
    # a fresh poller (restart) reads the seen file and does not answer again either
    p2 = _poller(fake, tmp_path)
    p2.load_seen()
    assert asyncio.run(p2.poll_once()) == [] and len(fake.sends) == 1


def test_oldest_first_and_outbound_ignored(tmp_path):
    _seed_seen(tmp_path, [])
    fake = FakeTwilio([_msg("SMa", "first", ago=30), _msg("SMb", "second", ago=10),
                       _msg("SMc", "ours", direction="outbound-api", frm=FROM), _msg("SMd", "sms", frm="+15550001234")])
    p = _poller(fake, tmp_path)
    p.load_seen()
    asyncio.run(p.poll_once())
    assert [c["Body"] for c in p.calls] == ["first", "second"]


def test_old_and_sandbox_keyword_messages_skipped(tmp_path):
    _seed_seen(tmp_path, [])
    fake = FakeTwilio([_msg("SMjoin", "join brave-tiger"), _msg("SMstale", "fever", ago=3600), _msg("SMok", "fever now")])
    p = _poller(fake, tmp_path)
    p.load_seen()
    res = asyncio.run(p.poll_once())
    assert [c["Body"] for c in p.calls] == ["fever now"]
    assert sorted(r.get("skipped", "answered") for r in res) == ["answered", "sandbox keyword", "too old"]
    assert {"SMjoin", "SMstale", "SMok"} <= set(p.seen)


def test_once_limit_answers_newest_only_and_dry_run_sends_nothing(tmp_path):
    fake = FakeTwilio([_msg("SM1", "a", ago=50), _msg("SM2", "b", ago=20), _msg("SM3", "c", ago=10)])
    p = _poller(fake, tmp_path)
    dry = asyncio.run(p.poll_once(limit=1, max_age_s=86400, prime_if_new=False, dry_run=True))
    assert [d["would"] for d in dry] == ["skip: over limit", "skip: over limit", "answer"]
    assert fake.sends == [] and not (tmp_path / "seen.json").exists()
    res = asyncio.run(p.poll_once(limit=1, max_age_s=86400, prime_if_new=False))
    assert [c["Body"] for c in p.calls] == ["c"] and len(fake.sends) == 1
    assert sum(1 for r in res if r.get("skipped") == "over limit") == 2
    assert set(json.loads((tmp_path / "seen.json").read_text())["seen"]) == {"SM1", "SM2", "SM3"}


def test_voice_note_goes_through_webhook_handler_with_auth(client, tmp_path, monkeypatch):
    """The real server._twilio_process (mock LLM): media URL from Media.json, downloaded with SID:token."""
    import bridge.server as server

    got = {}

    async def fake_download(url, auth=None):
        got["url"], got["auth"] = url, auth
        return b"OggS-fake", "audio/ogg"

    async def fake_transcribe(audio, lang):
        got["audio"] = audio
        return "child with fever for 2 days, RDT positive, 13 kg, what to give"

    monkeypatch.setattr(server, "download_media", fake_download)
    monkeypatch.setattr(server, "transcribe", fake_transcribe)

    async def no_tts(text, lang, fmt="ogg"):
        return None

    monkeypatch.setattr(server, "synthesize", no_tts)  # never reach a real sidecar
    _seed_seen(tmp_path, [])
    fake = FakeTwilio([_msg("SMvoice", "", num_media=1)])
    fake.media["SMvoice"] = [{"sid": "MEabc", "content_type": "audio/ogg",
                              "uri": f"/2010-04-01/Accounts/{SID}/Messages/SMvoice/Media/MEabc.json"}]
    p = TwilioPoller(account_sid=SID, auth_token=TOKEN, whatsapp_from=FROM, seen_path=tmp_path / "seen.json",
                     transport=fake.transport, clock=lambda: NOW)  # default process = the webhook handler
    p.load_seen()
    res = asyncio.run(p.poll_once())
    assert got["url"] == f"https://api.twilio.com/2010-04-01/Accounts/{SID}/Messages/SMvoice/Media/MEabc"
    assert got["auth"] == (server.settings.twilio_account_sid, server.settings.twilio_auth_token)
    assert res[0]["sent"] is True and res[0]["action"] == "ADVISE"
    sent = fake.sends[0]
    assert sent["To"] == NURSE and "MALARIA" in sent["Body"] and "MediaUrl" not in sent


@pytest.mark.parametrize("audio_url,expect", [("https://x.trycloudflare.com/static/audio/a.ogg", True),
                                              ("http://localhost:8090/static/audio/a.ogg", False)])
def test_media_reply_only_when_public_https(tmp_path, audio_url, expect):
    async def proc(params):
        return {"reply_text": "ok", "audio_url": audio_url}

    _seed_seen(tmp_path, [])
    fake = FakeTwilio([_msg("SMv", "hi")])
    p = _poller(fake, tmp_path, process=proc)
    p.load_seen()
    asyncio.run(p.poll_once())
    assert ("MediaUrl" in fake.sends[0]) is expect


def test_handler_error_does_not_stop_and_is_not_retried(tmp_path):
    async def boom(params):
        raise RuntimeError("model exploded")

    _seed_seen(tmp_path, [])
    fake = FakeTwilio([_msg("SMx", "hi")])
    p = _poller(fake, tmp_path, process=boom)
    p.load_seen()
    res = asyncio.run(p.poll_once())
    assert res[0]["sent"] is False and res[0]["error"] == "RuntimeError" and fake.sends == []
    assert asyncio.run(p.poll_once()) == []  # already seen: never answered twice


def test_send_failure_logged_without_secrets(tmp_path, caplog):
    _seed_seen(tmp_path, [])
    fake = FakeTwilio([_msg("SMf", "hi")], send_status=401)
    p = _poller(fake, tmp_path)
    p.load_seen()
    with caplog.at_level(logging.INFO, logger="lokol.twilio_poll"):
        res = asyncio.run(p.poll_once())
    assert res[0]["sent"] is False and res[0]["status"] == 401
    assert "REST send failed: HTTP 401" in caplog.text
    assert TOKEN not in caplog.text and SID not in caplog.text and NURSE not in caplog.text


def test_run_loop_backs_off_on_errors_and_stops(tmp_path, caplog):
    fake = FakeTwilio([], list_status=500)
    p = _poller(fake, tmp_path)

    async def go():
        stop = asyncio.Event()
        task = asyncio.create_task(p.run(stop))
        await asyncio.sleep(0.15)
        stop.set()
        await asyncio.wait_for(task, 2)

    with caplog.at_level(logging.WARNING, logger="lokol.twilio_poll"):
        asyncio.run(go())
    assert p.stats["errors"] >= 2 and "list messages: HTTP 500" in caplog.text
    lists = [r for r in fake.requests if r.method == "GET"]
    assert 2 <= len(lists) < 20  # exponential backoff, not a hot loop (0.001 s base interval)
    assert TOKEN not in caplog.text and SID not in caplog.text


def test_auth_error_backs_off_to_max(tmp_path, monkeypatch):
    fake = FakeTwilio([], list_status=401)
    p = _poller(fake, tmp_path)
    delays = []

    async def go():
        stop = asyncio.Event()
        real_wait_for = asyncio.wait_for

        async def spy(aw, timeout):
            delays.append(timeout)
            stop.set()
            return await real_wait_for(aw, 1)

        monkeypatch.setattr(twilio_poll.asyncio, "wait_for", spy)
        await p.run(stop)

    asyncio.run(go())
    assert delays == [twilio_poll.MAX_BACKOFF_S]


def test_background_poller_off_unless_poll_mode(monkeypatch):
    monkeypatch.delenv("TWILIO_MODE", raising=False)
    assert twilio_poll.start_background_poller() is None and twilio_poll.status() is None
    monkeypatch.setenv("TWILIO_MODE", "poll")
    st = twilio_poll.status()
    assert st is not None and st["enabled"] is True


def test_health_reports_poll_off_by_default(client):
    d = client.get("/health").json()
    assert d["twilio"]["poll"] is None


def test_repr_hides_token():
    p = TwilioPoller(account_sid=SID, auth_token=TOKEN, whatsapp_from=FROM)
    assert TOKEN not in repr(p) and SID not in repr(p)
