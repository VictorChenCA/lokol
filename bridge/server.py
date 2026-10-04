"""Lokol bridge server (FastAPI, port 8090).

Routes
  POST /message             generic JSON for tests and the Studio demo
  POST /twilio/whatsapp     Twilio WhatsApp webhook (form-encoded, TwiML reply)
  GET  /messenger/webhook   Meta verify (hub.challenge)
  POST /messenger/webhook   Meta messages -> Send API
  GET  /health              status of corpus, LLM backend, sidecar, channels (CORS + PNA open)
  GET  /static/...          generated voice notes

Run:  .venv/bin/python -m bridge.server [--mock] [--port 8090] [--backend llama|river]
      bridge/run_local.sh    bridge + optional sidecar + cloudflared tunnel, prints the webhook URL
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import hashlib
import hmac
import inspect
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from typing import Any
from xml.sax.saxutils import escape

import httpx
from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import __version__
from . import llm
from .config import settings
from .corpus import Chunk, load_corpus
from .gate import RED_FLAG_SECTIONS, apply_gate, detect_lang, format_for_channel, match_red_flags, norm_title, parse_reply
from .llm import mock_reply
from .retrieval import BM25, guideline_line
from .speech import download_media, sidecar_ready, synthesize, transcribe
from .state import StateStore, handle_command

log = logging.getLogger("lokol.bridge")
logging.basicConfig(level=os.environ.get("LOKOL_LOGLEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s %(message)s")


class Engine:
    """Corpus + index + state, built once at startup."""

    def __init__(self) -> None:
        self.chunks: list[Chunk] = []
        self.sections: list[str] = []
        self.source = "none"
        self.index: BM25 | None = None
        self.store = StateStore()

    def load(self) -> None:
        self.chunks, self.sections, self.source = load_corpus()
        self.index = BM25(self.chunks) if self.chunks else None
        log.info("corpus: %d chunks, %d sections, source=%s, mock=%s", len(self.chunks), len(self.sections), self.source, settings.mock)

    def retrieve(self, query: str, preferred_sections: list[str] | None = None) -> tuple[Chunk | None, list[dict]]:
        """Top BM25 chunk above the threshold. When `preferred_sections` is given (the chapters a
        matched red flag belongs to), the best hit from one of those chapters is promoted to the top
        if it also clears the threshold, so the citation matches the danger sign."""
        if not self.index:
            return None, []
        hits = self.index.search(query, k=8 if preferred_sections else 3)
        if preferred_sections and hits:
            wanted = {norm_title(s) for s in preferred_sections}
            for h in hits:
                if h.score >= settings.min_retrieval_score and norm_title(h.chunk.section) in wanted:
                    hits = [h] + [x for x in hits if x is not h]
                    break
        hits = hits[:3]
        top = hits[0].chunk if hits and hits[0].score >= settings.min_retrieval_score else None
        return top, [{"id": h.chunk.id, "section": h.chunk.section, "page": h.chunk.page, "score": round(h.score, 2)} for h in hits]


engine = Engine()


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings.reload()
    engine.load()
    settings.static_dir.mkdir(parents=True, exist_ok=True)
    log.info("llm backend=%s%s", settings.llm_backend, f" checkpoint={settings.river_checkpoint}" if settings.llm_backend == "river" else "")
    warm = None
    if settings.llm_backend == "river" and not settings.mock:
        # open the River client/session in the background so the first message is not slower
        warm = asyncio.create_task(asyncio.to_thread(llm.RIVER.warm))
    yield
    if warm is not None and not warm.done():
        warm.cancel()


class PrivateNetworkAccess:
    """Chrome Private Network Access: an https page (the Studio on Vercel) may only read
    http://127.0.0.1:8090 if the preflight answers `Access-Control-Allow-Private-Network: true`.
    Sits outside CORSMiddleware so the header lands on its preflight responses too."""

    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        async def send_with_pna(message):
            if message["type"] == "http.response.start":
                headers = list(message.get("headers") or [])
                if not any(k.lower() == b"access-control-allow-private-network" for k, _ in headers):
                    headers.append((b"access-control-allow-private-network", b"true"))
                    message = {**message, "headers": headers}
            await send(message)

        return await self.app(scope, receive, send_with_pna)


app = FastAPI(title="Lokol bridge", version=__version__, lifespan=lifespan)
_cors = dict(allow_origins=["*"], allow_methods=["GET", "POST", "OPTIONS"], allow_headers=["*"])
if "allow_private_network" in inspect.signature(CORSMiddleware.__init__).parameters:
    _cors["allow_private_network"] = True  # Starlette >= 0.39 refuses PNA preflights (400) without it
app.add_middleware(CORSMiddleware, **_cors)
app.add_middleware(PrivateNetworkAccess)  # added last = outermost
settings.static_dir.mkdir(parents=True, exist_ok=True)
app.mount("/static", StaticFiles(directory=str(settings.static_dir)), name="static")


# ---------------------------------------------------------------------------------------------
# Core pipeline
# ---------------------------------------------------------------------------------------------

def _log_turn(rec: dict) -> None:
    try:
        settings.log_file.parent.mkdir(parents=True, exist_ok=True)
        with settings.log_file.open("a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    except Exception:
        pass


def _hash_user(user_id: str) -> str:
    return hashlib.sha256(user_id.encode()).hexdigest()[:12]


async def handle_text(
    channel: str,
    user_id: str,
    text: str,
    *,
    lang_override: str | None = None,
    flags_override: dict | None = None,
    want_voice: bool = False,
    voice_fmt: str = "ogg",
) -> dict[str, Any]:
    t0 = time.time()
    st = engine.store.get(channel, user_id)
    text = (text or "").strip()
    if not text:
        lang = st.lang if st.lang in ("pis", "en") else st.last_lang
        from .state import HELP

        return {"reply_text": HELP[lang], "action": None, "stm": None, "command": True, "lang": lang}

    hint = detect_lang(text)
    cmd_reply = handle_command(engine.store, st, text, hint)
    if cmd_reply is not None:
        return {"reply_text": cmd_reply, "action": None, "stm": None, "command": True, "lang": st.lang, "flags": st.flags(st.lang)}

    lang = lang_override or (st.lang if st.lang in ("pis", "en") else hint)
    flags = st.flags(lang)
    if flags_override:
        for k in ("rdt", "act", "transport"):
            if flags_override.get(k):
                flags[k] = str(flags_override[k])
    preferred = [s for r in match_red_flags(text) for s in RED_FLAG_SECTIONS.get(r["id"], [])]
    chunk, hits = engine.retrieve(text, preferred or None)
    gline = guideline_line(chunk)

    model = backend = "mock"
    error = None
    llm_secs = None
    if settings.mock:
        raw = mock_reply(lang, chunk.section if chunk else None, text)
    else:
        t_llm = time.time()
        gen = await llm.generate(flags, gline, text, lang)  # never raises; falls back to a canned ASK_PERSON
        raw, backend, model, error = gen.raw, gen.backend, gen.model, gen.error
        llm_secs = round(time.time() - t_llm, 2)
        log.info("turn answered by backend=%s model=%s in %.2fs%s", backend, model, llm_secs, f" (after: {error})" if error else "")
    parsed = parse_reply(raw)
    result = apply_gate(text, parsed, flags, chunk.section if chunk else None, lang, engine.sections,
                        excerpt=chunk.text if chunk else None, page=chunk.page if chunk else None)
    page = chunk.page if (chunk and result.stm and result.stm == chunk.section) else (chunk.page if chunk and result.stm else None)
    reply_text = format_for_channel(result, lang, page)

    audio_url = None
    if want_voice or st.voice:
        audio_url = await synthesize(result.body, lang, fmt=voice_fmt)

    st.last_lang = lang
    st.turns += 1
    engine.store.put(st)
    latency = int((time.time() - t0) * 1000)
    out = {
        "reply_text": reply_text,
        "action": result.action,
        "stm": result.stm,
        "body": result.body,
        "red_flags": result.red_flags,
        "overridden": result.overridden,
        "reasons": result.reasons,
        "compliant": result.compliant,
        "lang": lang,
        "flags": flags,
        "chunk": {"id": chunk.id, "section": chunk.section, "page": chunk.page} if chunk else None,
        "hits": hits,
        "audio_url": audio_url,
        "raw": parsed.raw,
        "model": model,
        "backend": backend,
        "error": error,
        "llm_secs": llm_secs,
        "latency_ms": latency,
        "command": False,
    }
    _log_turn({"ts": time.time(), "channel": channel, "user": _hash_user(user_id), "lang": lang, "action": result.action,
               "stm": result.stm, "red_flags": [r["id"] for r in result.red_flags], "overridden": result.overridden,
               "reasons": result.reasons, "latency_ms": latency, "model": model, "backend": backend})
    return out


# ---------------------------------------------------------------------------------------------
# Generic HTTP
# ---------------------------------------------------------------------------------------------

class MessageIn(BaseModel):
    text: str = Field(..., description="Nurse message or a /command")
    user_id: str = "test-user"
    channel: str = "http"
    lang: str | None = Field(None, description="Force 'pis' or 'en' (default: detect)")
    flags: dict | None = Field(None, description="Override rdt/act/transport for this turn")
    voice: bool = False
    audio_b64: str | None = Field(None, description="Base64 audio (any format) to transcribe instead of text")


@app.post("/message")
async def message(msg: MessageIn) -> JSONResponse:
    text = msg.text
    transcript = None
    if msg.audio_b64:
        try:
            audio = base64.b64decode(msg.audio_b64)
        except Exception:
            raise HTTPException(400, "audio_b64 is not valid base64")
        transcript = await transcribe(audio, msg.lang or "en")
        if not transcript:
            raise HTTPException(502, "ASR unavailable or returned empty transcript")
        text = transcript
    out = await handle_text(msg.channel, msg.user_id, text, lang_override=msg.lang, flags_override=msg.flags, want_voice=msg.voice)
    if transcript is not None:
        out["transcript"] = transcript
    return JSONResponse(out)


def _public_url() -> str | None:
    u = settings.public_base_url
    return u if u.startswith("https://") else None


@app.get("/health")
async def health() -> dict:
    """Read by the Studio Deploy page (CORS + PNA). Reports whether credentials are configured,
    never their values."""
    if settings.mock:
        llm_status = {"backend": "mock", "model": "mock", "reachable": True}
    else:
        llm_status = await llm.backend_status()
    sidecar_up = await sidecar_ready()
    twilio_configured = bool(settings.twilio_account_sid and settings.twilio_auth_token)
    return {
        "ok": True,
        "mode": "mock" if settings.mock else settings.llm_backend,
        "version": __version__,
        "mock": settings.mock,
        "corpus": {"chunks": len(engine.chunks), "sections": len(engine.sections), "source": engine.source},
        "llm": {**llm_status, "ready": bool(llm_status.get("reachable"))},
        "sidecar": {"url": settings.sidecar_url, "reachable": sidecar_up, "ready": sidecar_up},
        "public_base_url": _public_url(),
        "twilio": {"configured": twilio_configured, "signature_check": bool(settings.twilio_auth_token),
                   "async": bool(settings.twilio_async and twilio_configured)},
        "messenger": {"configured": bool(settings.meta_page_token), "send_configured": bool(settings.meta_page_token)},
        "users": len(engine.store.all()),
    }


@app.get("/")
async def root() -> dict:
    return {"name": "Lokol bridge", "version": __version__, "routes": ["/message", "/twilio/whatsapp", "/messenger/webhook", "/health"]}


# ---------------------------------------------------------------------------------------------
# Twilio WhatsApp
# ---------------------------------------------------------------------------------------------

def twilio_signature(url: str, params: dict[str, str], token: str) -> str:
    s = url + "".join(k + params[k] for k in sorted(params))
    return base64.b64encode(hmac.new(token.encode("utf-8"), s.encode("utf-8"), hashlib.sha1).digest()).decode()


def _candidate_urls(request: Request) -> list[str]:
    """URLs Twilio may have signed: the public (cloudflared) URL, the forwarded one, the raw one,
    each with and without an explicit :443 port."""
    from urllib.parse import urlsplit, urlunsplit

    path = request.url.path
    q = ("?" + request.url.query) if request.url.query else ""
    urls = [settings.public_base_url + path + q, str(request.url)]
    fwd_proto = request.headers.get("x-forwarded-proto")
    fwd_host = request.headers.get("x-forwarded-host") or request.headers.get("host")
    if fwd_host:
        urls.append(f"{fwd_proto or 'https'}://{fwd_host}{path}{q}")
    extra: list[str] = []
    for u in urls:
        p = urlsplit(u)
        if p.scheme != "https":
            continue
        host = p.netloc
        if host.endswith(":443"):
            extra.append(urlunsplit((p.scheme, host[:-4], p.path, p.query, "")))
        elif ":" not in host:
            extra.append(urlunsplit((p.scheme, host + ":443", p.path, p.query, "")))
    return list(dict.fromkeys(urls + extra))


def verify_twilio(request: Request, params: dict[str, str]) -> bool:
    if not settings.twilio_auth_token:
        return True
    sig = request.headers.get("x-twilio-signature", "")
    if not sig:
        return False
    for url in _candidate_urls(request):
        if hmac.compare_digest(twilio_signature(url, params, settings.twilio_auth_token), sig):
            return True
    return False


def build_twiml(body: str, media_url: str | None = None) -> str:
    media = f"<Media>{escape(media_url)}</Media>" if media_url else ""
    return f'<?xml version="1.0" encoding="UTF-8"?><Response><Message><Body>{escape(body)}</Body>{media}</Message></Response>'


# Tests swap in an httpx.MockTransport here so the REST path runs without the network.
_twilio_transport: httpx.AsyncBaseTransport | None = None


async def send_twilio_message(to: str, body: str, media_url: str | None = None) -> dict:
    """Twilio REST: POST /2010-04-01/Accounts/{SID}/Messages.json (Basic auth SID:token)."""
    url = f"https://api.twilio.com/2010-04-01/Accounts/{settings.twilio_account_sid}/Messages.json"
    data = {"From": settings.twilio_whatsapp_from, "To": to, "Body": body[:1600]}
    if media_url:
        data["MediaUrl"] = media_url
    async with httpx.AsyncClient(timeout=30, auth=(settings.twilio_account_sid, settings.twilio_auth_token),
                                 transport=_twilio_transport) as client:
        r = await client.post(url, data=data)
        try:
            return {"status": r.status_code, "json": r.json()}
        except Exception:
            return {"status": r.status_code, "text": r.text[:300]}


async def _twilio_process(params: dict[str, str]) -> dict[str, Any]:
    from_ = params.get("From", "unknown")
    body = params.get("Body", "") or ""
    num_media = int(params.get("NumMedia", "0") or 0)
    voice_in = False
    if num_media > 0:
        ctype = params.get("MediaContentType0", "")
        murl = params.get("MediaUrl0", "")
        if ctype.startswith("audio") and murl:
            voice_in = True
            auth = (settings.twilio_account_sid, settings.twilio_auth_token) if settings.twilio_auth_token else None
            try:
                audio, _ = await download_media(murl, auth=auth)
                st = engine.store.get("whatsapp", from_)
                asr_lang = st.lang if st.lang in ("pis", "en") else st.last_lang
                text = await transcribe(audio, asr_lang)
            except Exception as e:
                log.warning("twilio media failed: %s", e)
                text = ""
            if not text:
                return {"reply_text": "Sorry, I could not understand the voice note. Please type the message. / Mi no herem gud, plis taepem.",
                        "audio_url": None, "command": True}
            body = text
    return await handle_text("whatsapp", from_, body, want_voice=voice_in, voice_fmt="ogg")


async def _twilio_reply_later(params: dict[str, str]) -> None:
    to = params.get("From", "")
    try:
        out = await _twilio_process(params)
        res = await send_twilio_message(to, out["reply_text"], out.get("audio_url"))
        status = res.get("status")
        if not (isinstance(status, int) and 200 <= status < 300):
            err = (res.get("json") or {}).get("message") if isinstance(res.get("json"), dict) else res.get("text")
            log.warning("twilio REST send failed: status=%s %s", status, (err or "")[:200])
        else:
            log.info("twilio REST reply sent (backend=%s, %s ms)", out.get("backend"), out.get("latency_ms"))
    except Exception as e:
        log.exception("twilio async reply failed: %s", e)


@app.post("/twilio/whatsapp")
async def twilio_whatsapp(request: Request, background: BackgroundTasks) -> Response:
    form = await request.form()
    params = {k: str(v) for k, v in form.items()}
    if not verify_twilio(request, params):
        raise HTTPException(403, "invalid Twilio signature")
    if settings.twilio_async and settings.twilio_account_sid and settings.twilio_auth_token:
        # Recommended: Twilio gives the webhook 15 s, a River turn takes 4-12 s plus retrieval.
        # Answer with empty TwiML now; the reply goes out through the REST API.
        background.add_task(_twilio_reply_later, params)
        return Response(content='<?xml version="1.0" encoding="UTF-8"?><Response></Response>', media_type="application/xml")
    out = await _twilio_process(params)
    return Response(content=build_twiml(out["reply_text"], out.get("audio_url")), media_type="application/xml")


# ---------------------------------------------------------------------------------------------
# Messenger (Meta)
# ---------------------------------------------------------------------------------------------

@app.get("/messenger/webhook")
async def messenger_verify(request: Request) -> Response:
    q = request.query_params
    if q.get("hub.mode") == "subscribe" and q.get("hub.verify_token") == settings.meta_verify_token:
        return PlainTextResponse(q.get("hub.challenge", ""))
    raise HTTPException(403, "verification failed")


def verify_meta_signature(raw: bytes, header: str | None) -> bool:
    if not settings.meta_app_secret:
        return True
    if not header or not header.startswith("sha256="):
        return False
    expected = hmac.new(settings.meta_app_secret.encode(), raw, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header.split("=", 1)[1])


async def send_messenger(psid: str, text: str, audio_url: str | None = None) -> dict:
    url = f"https://graph.facebook.com/{settings.meta_graph_version}/me/messages"
    params = {"access_token": settings.meta_page_token}
    results = []
    async with httpx.AsyncClient(timeout=30) as client:
        for chunk in _split_messenger(text):
            r = await client.post(url, params=params, json={"recipient": {"id": psid}, "messaging_type": "RESPONSE", "message": {"text": chunk}})
            results.append(r.status_code)
        if audio_url:
            r = await client.post(url, params=params, json={"recipient": {"id": psid}, "messaging_type": "RESPONSE",
                                                              "message": {"attachment": {"type": "audio", "payload": {"url": audio_url, "is_reusable": False}}}})
            results.append(r.status_code)
    return {"status": results}


def _split_messenger(text: str, limit: int = 1900) -> list[str]:
    if len(text) <= limit:
        return [text]
    out, cur = [], ""
    for ln in text.splitlines():
        if len(cur) + len(ln) + 1 > limit:
            out.append(cur)
            cur = ln
        else:
            cur = (cur + "\n" + ln) if cur else ln
    if cur:
        out.append(cur)
    return out


async def process_messenger_event(ev: dict) -> dict | None:
    sender = (ev.get("sender") or {}).get("id")
    msg = ev.get("message") or {}
    if not sender or not msg or msg.get("is_echo"):
        return None
    text = msg.get("text") or ""
    voice_in = False
    for att in msg.get("attachments") or []:
        if att.get("type") == "audio" and (att.get("payload") or {}).get("url"):
            voice_in = True
            try:
                audio, _ = await download_media(att["payload"]["url"])
                st = engine.store.get("messenger", sender)
                text = await transcribe(audio, st.lang if st.lang in ("pis", "en") else st.last_lang)
            except Exception as e:
                log.warning("messenger media failed: %s", e)
                text = ""
            if not text:
                text = ""
                await send_messenger(sender, "Sorry, I could not understand the voice note. Please type the message. / Mi no herem gud, plis taepem.")
                return None
            break
    if not text:
        return None
    out = await handle_text("messenger", sender, text, want_voice=voice_in, voice_fmt="mp3")
    if settings.meta_page_token:
        await send_messenger(sender, out["reply_text"], out.get("audio_url"))
    else:
        log.warning("META_PAGE_TOKEN not set; reply not sent: %s", out["reply_text"][:120])
    return out


@app.post("/messenger/webhook")
async def messenger_webhook(request: Request, background: BackgroundTasks) -> Response:
    raw = await request.body()
    if not verify_meta_signature(raw, request.headers.get("x-hub-signature-256")):
        raise HTTPException(403, "invalid Meta signature")
    try:
        body = json.loads(raw or b"{}")
    except Exception:
        raise HTTPException(400, "invalid JSON")
    if body.get("object") != "page":
        raise HTTPException(404, "not a page event")
    n = 0
    for entry in body.get("entry", []):
        for ev in entry.get("messaging", []):
            if ev.get("message"):
                background.add_task(process_messenger_event, ev)
                n += 1
    return PlainTextResponse("EVENT_RECEIVED", headers={"X-Lokol-Events": str(n)})


# ---------------------------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser(description="Lokol bridge")
    ap.add_argument("--mock", action="store_true", help="canned protocol replies, no llama-server needed")
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--port", type=int, default=8090)
    ap.add_argument("--reload", action="store_true")
    ap.add_argument("--llm-url", default=None)
    ap.add_argument("--backend", choices=["llama", "river"], default=None, help="LLM_BACKEND (default: env or llama)")
    ap.add_argument("--public-base-url", default=None)
    args = ap.parse_args()
    if args.mock:
        os.environ["LOKOL_MOCK"] = "1"
    if args.llm_url:
        os.environ["LLM_URL"] = args.llm_url
    if args.backend:
        os.environ["LLM_BACKEND"] = args.backend
    if args.public_base_url:
        os.environ["PUBLIC_BASE_URL"] = args.public_base_url
    import uvicorn

    uvicorn.run("bridge.server:app", host=args.host, port=args.port, reload=args.reload, log_level="info")


if __name__ == "__main__":
    main()
