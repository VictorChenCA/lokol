"""Twilio WhatsApp on the free 'Limited trial' tier: poll the REST API instead of a webhook.

The trial console cannot set the sandbox's "When a message comes in" URL (the settings page
redirects to an upgrade), but the REST API still lists inbound messages and still sends replies to
the verified tester. With TWILIO_MODE=poll the bridge runs this poller as a background task:

  every TWILIO_POLL_INTERVAL s (3):
    GET  /2010-04-01/Accounts/{SID}/Messages.json?To={TWILIO_WHATSAPP_FROM}&PageSize=20&DateSent>={yesterday, UTC}
    for each inbound WhatsApp message not seen yet (oldest first):
      mark it seen (bridge/.state/twilio_seen.json) BEFORE answering, so nothing is answered twice
      voice note? GET its Media.json, hand the media URL (Basic auth download) to the handler
      run it through the webhook's own handler (server._twilio_process: commands, ASR, retrieval, LLM, gate)
    POST /2010-04-01/Accounts/{SID}/Messages.json  From, To, Body (+ MediaUrl only when it is public https)

On the very first start (no seen file) every message already in the log is marked seen and nothing
is answered, so old messages never get replies. Messages older than TWILIO_POLL_MAX_AGE (600 s) and
sandbox keywords (`join <code>`, STOP/START) are marked seen without a reply. Errors back off
exponentially (3 s -> 60 s; 60 s straight away on 401/403). Logs carry masked SIDs and hashed
numbers, never the auth token or message bodies.

CLI (reads .env):
  .venv/bin/python -m bridge.twilio_poll                    # standalone poller loop
  .venv/bin/python -m bridge.twilio_poll --list             # read-only: inbound count + timestamps, no bodies
  .venv/bin/python -m bridge.twilio_poll --once --dry-run   # what --once would answer, sends nothing
  .venv/bin/python -m bridge.twilio_poll --once             # answer the newest unseen inbound message (24 h window), exit
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import logging
import os
import re
import time
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any, Awaitable, Callable

import httpx

from .config import BRIDGE_DIR, settings

log = logging.getLogger("lokol.twilio_poll")

API = "https://api.twilio.com"
DEFAULT_SEEN_FILE = BRIDGE_DIR / ".state" / "twilio_seen.json"
SEEN_CAP = 2000
MAX_BACKOFF_S = 60.0
# Sandbox control words that Twilio answers itself.
SANDBOX_KEYWORD = re.compile(r"^\s*(join\s+\S+|stop|start|unstop|unsubscribe)\s*$", re.I)

Process = Callable[[dict[str, str]], Awaitable[dict[str, Any]]]


class TwilioHTTPError(Exception):
    """A non-2xx answer from the Twilio REST API. The message never contains credentials or URLs."""

    def __init__(self, what: str, status: int, detail: str = "") -> None:
        super().__init__(f"{what}: HTTP {status}{(' ' + detail) if detail else ''}")
        self.status = status


def poll_mode_enabled() -> bool:
    return os.environ.get("TWILIO_MODE", "").strip().lower() == "poll"


def mask_sid(sid: str) -> str:
    return f"{sid[:2]}..{sid[-4:]}" if len(sid) > 8 else "??"


def mask_addr(addr: str) -> str:
    """whatsapp:+15551234567 -> whatsapp:+...4567"""
    head, _, num = addr.rpartition(":")
    return f"{head + ':' if head else ''}+...{num[-4:]}" if len(num) > 4 else "?"


def user_tag(addr: str) -> str:
    return hashlib.sha256(addr.encode()).hexdigest()[:8]


def message_ts(m: dict) -> float | None:
    for k in ("date_sent", "date_created"):
        v = m.get(k)
        if v:
            try:
                return parsedate_to_datetime(v).timestamp()
            except Exception:
                continue
    return None


def is_inbound_whatsapp(m: dict) -> bool:
    return m.get("direction") == "inbound" and str(m.get("from") or "").startswith("whatsapp:+") and bool(m.get("sid"))


def _twilio_detail(r: httpx.Response) -> str:
    try:
        d = r.json()
        return f"code={d.get('code')} {str(d.get('message') or '')[:160]}".strip()
    except Exception:
        return ""


async def _default_process(params: dict[str, str]) -> dict[str, Any]:
    from .server import _twilio_process  # the webhook's own handler

    return await _twilio_process(params)


class TwilioPoller:
    def __init__(
        self,
        *,
        account_sid: str,
        auth_token: str,
        whatsapp_from: str,
        seen_path: Path | str | None = None,
        interval: float = 3.0,
        page_size: int = 20,
        max_age_s: float = 600.0,
        process: Process | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self.sid = account_sid
        self._token = auth_token
        self.whatsapp_from = whatsapp_from
        self.seen_path = Path(seen_path) if seen_path else DEFAULT_SEEN_FILE
        self.interval = max(0.0, float(interval))
        self.page_size = page_size
        self.max_age_s = max_age_s
        self.process = process or _default_process
        self.transport = transport
        self.clock = clock
        self.seen: list[str] = []
        self._seen_set: set[str] = set()
        self.primed = False
        self.stats: dict[str, Any] = {"polls": 0, "answered": 0, "sent": 0, "skipped": 0, "errors": 0,
                                      "last_ok": None, "last_error": None}

    def __repr__(self) -> str:  # never show the token
        return f"TwilioPoller(from={self.whatsapp_from!r}, interval={self.interval})"

    # ------------------------------------------------------------------------------ seen SIDs
    def load_seen(self) -> bool:
        try:
            d = json.loads(self.seen_path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return False
        except Exception:
            log.warning("twilio poll: unreadable %s, starting fresh", self.seen_path.name)
            return False
        self.seen = [str(s) for s in (d.get("seen") or [])][-SEEN_CAP:]
        self._seen_set = set(self.seen)
        self.primed = True
        return True

    def save_seen(self) -> None:
        self.seen = self.seen[-SEEN_CAP:]
        self._seen_set = set(self.seen)
        self.seen_path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.seen_path.with_name(self.seen_path.name + ".tmp")
        tmp.write_text(json.dumps({"seen": self.seen, "updated": int(self.clock())}), encoding="utf-8")
        os.replace(tmp, self.seen_path)

    def mark(self, sid: str) -> None:
        if sid not in self._seen_set:
            self.seen.append(sid)
            self._seen_set.add(sid)

    # ------------------------------------------------------------------------------ REST
    def client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(timeout=20, auth=(self.sid, self._token), transport=self.transport)

    @property
    def messages_url(self) -> str:
        return f"{API}/2010-04-01/Accounts/{self.sid}/Messages.json"

    async def list_messages(self, client: httpx.AsyncClient) -> list[dict]:
        since = (datetime.fromtimestamp(self.clock(), timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%d")
        # "DateSent>" + value is Twilio's on-or-after filter (curl: --data-urlencode "DateSent>=2026-10-03").
        # Yesterday, not today: a message sent just before midnight UTC is still listed; seen SIDs dedupe.
        r = await client.get(self.messages_url, params={"To": self.whatsapp_from, "PageSize": str(self.page_size), "DateSent>": since})
        if not 200 <= r.status_code < 300:
            raise TwilioHTTPError("list messages", r.status_code, _twilio_detail(r))
        return list(r.json().get("messages") or [])

    async def webhook_params(self, client: httpx.AsyncClient, m: dict) -> dict[str, str]:
        """A Messages-list resource in the shape of Twilio's webhook form, for server._twilio_process."""
        p = {"MessageSid": str(m.get("sid") or ""), "AccountSid": self.sid, "From": str(m.get("from") or ""),
             "To": str(m.get("to") or ""), "Body": str(m.get("body") or ""), "NumMedia": "0"}
        if int(m.get("num_media") or 0) > 0:
            uri = (m.get("subresource_uris") or {}).get("media") or f"/2010-04-01/Accounts/{self.sid}/Messages/{p['MessageSid']}/Media.json"
            r = await client.get(API + uri)
            if 200 <= r.status_code < 300:
                items = r.json().get("media_list") or []
                for i, it in enumerate(items):
                    p[f"MediaContentType{i}"] = str(it.get("content_type") or "")
                    # The media content lives at the resource URI without ".json"; it needs Basic auth,
                    # which _twilio_process adds (SID:token) when it downloads.
                    p[f"MediaUrl{i}"] = API + str(it.get("uri") or "").removesuffix(".json")
                p["NumMedia"] = str(len(items))
            else:
                log.warning("twilio poll: media list for %s failed: HTTP %s", mask_sid(p["MessageSid"]), r.status_code)
        return p

    async def send(self, client: httpx.AsyncClient, to: str, body: str, media_url: str | None = None) -> int:
        data = {"From": self.whatsapp_from, "To": to, "Body": (body or "")[:1600]}
        if media_url and media_url.startswith("https://"):  # Twilio must fetch it: only a public https link
            data["MediaUrl"] = media_url
        r = await client.post(self.messages_url, data=data)
        if not 200 <= r.status_code < 300:
            log.warning("twilio poll: REST send failed: HTTP %s %s", r.status_code, _twilio_detail(r))
        return r.status_code

    # ------------------------------------------------------------------------------ one pass
    def _skip_reason(self, m: dict, now: float, max_age_s: float) -> str | None:
        ts = message_ts(m)
        if ts is not None and now - ts > max_age_s:
            return "too old"
        if int(m.get("num_media") or 0) == 0 and SANDBOX_KEYWORD.match(str(m.get("body") or "")):
            return "sandbox keyword"
        return None

    async def poll_once(self, *, limit: int | None = None, max_age_s: float | None = None,
                        prime_if_new: bool = True, dry_run: bool = False) -> list[dict]:
        """List, then answer every new inbound WhatsApp message (or only the newest `limit`).
        Returns one record per new message: {"sid", "sent"/"skipped"/"error", ...} (no bodies)."""
        max_age = self.max_age_s if max_age_s is None else max_age_s
        async with self.client() as client:
            msgs = await self.list_messages(client)
            self.stats["polls"] += 1
            self.stats["last_ok"] = int(self.clock())
            inbound = [m for m in msgs if is_inbound_whatsapp(m)]
            if not self.primed and prime_if_new:
                if not dry_run:
                    for m in inbound:
                        self.mark(m["sid"])
                    self.save_seen()
                self.primed = True
                log.info("twilio poll: first start, %d existing inbound message(s) marked seen, none answered", len(inbound))
                return []
            new = sorted((m for m in inbound if m["sid"] not in self._seen_set), key=lambda m: message_ts(m) or 0.0)
            chosen = {m["sid"] for m in (new if limit is None else new[len(new) - limit:] if limit > 0 else [])}
            now = self.clock()
            results: list[dict] = []
            for m in new:
                sid = m["sid"]
                reason = "over limit" if sid not in chosen else self._skip_reason(m, now, max_age)
                rec: dict[str, Any] = {"sid": mask_sid(sid), "from": mask_addr(str(m.get("from"))), "date_sent": m.get("date_sent"),
                                       "num_media": int(m.get("num_media") or 0)}
                if dry_run:
                    results.append({**rec, "would": "skip: " + reason if reason else "answer"})
                    continue
                self.mark(sid)
                self.save_seen()  # before answering: a crash mid-turn never leads to a double reply
                if reason:
                    self.stats["skipped"] += 1
                    results.append({**rec, "skipped": reason})
                    continue
                results.append({**rec, **await self._answer(client, m)})
            return results

    async def _answer(self, client: httpx.AsyncClient, m: dict) -> dict[str, Any]:
        t0 = time.time()
        to = str(m.get("from"))
        try:
            params = await self.webhook_params(client, m)
            out = await self.process(params)
            status = await self.send(client, to, str(out.get("reply_text") or ""), out.get("audio_url"))
        except Exception as e:  # one bad message must not stop the loop
            self.stats["errors"] += 1
            self.stats["last_error"] = type(e).__name__
            log.warning("twilio poll: answering %s failed: %s", mask_sid(str(m.get("sid"))), type(e).__name__)
            return {"sent": False, "error": type(e).__name__}
        ok = 200 <= status < 300
        self.stats["answered"] += 1
        self.stats["sent"] += int(ok)
        ms = int((time.time() - t0) * 1000)
        log.info("twilio poll: answered %s user=%s action=%s backend=%s in %d ms, send HTTP %s",
                 mask_sid(str(m.get("sid"))), user_tag(to), out.get("action"), out.get("backend"), ms, status)
        return {"sent": ok, "status": status, "action": out.get("action"), "backend": out.get("backend"),
                "voice_note": bool(out.get("audio_url") and str(out.get("audio_url")).startswith("https://")), "ms": ms}

    # ------------------------------------------------------------------------------ loop
    async def run(self, stop: asyncio.Event | None = None) -> None:
        self.load_seen()
        fails = 0
        while not (stop and stop.is_set()):
            delay = self.interval
            try:
                await self.poll_once()
                fails = 0
            except asyncio.CancelledError:
                raise
            except Exception as e:
                fails += 1
                self.stats["errors"] += 1
                self.stats["last_error"] = str(e) if isinstance(e, TwilioHTTPError) else type(e).__name__
                delay = MAX_BACKOFF_S if isinstance(e, TwilioHTTPError) and e.status in (401, 403) \
                    else min(max(self.interval, 0.001) * (2 ** min(fails, 6)), MAX_BACKOFF_S)
                log.warning("twilio poll: %s (retry in %.1f s)", self.stats["last_error"], delay)
            if stop is None:
                await asyncio.sleep(delay)
            else:
                try:
                    await asyncio.wait_for(stop.wait(), timeout=delay)
                except asyncio.TimeoutError:
                    pass


def from_settings(**kw: Any) -> TwilioPoller:
    return TwilioPoller(
        account_sid=settings.twilio_account_sid,
        auth_token=settings.twilio_auth_token,
        whatsapp_from=settings.twilio_whatsapp_from,
        seen_path=os.environ.get("TWILIO_SEEN_FILE") or None,
        interval=float(os.environ.get("TWILIO_POLL_INTERVAL", "3")),
        max_age_s=float(os.environ.get("TWILIO_POLL_MAX_AGE", "600")),
        **kw,
    )


_current: TwilioPoller | None = None


def start_background_poller() -> asyncio.Task | None:
    """Called from the bridge lifespan. A task when TWILIO_MODE=poll and SID + token are set, else None."""
    global _current
    if not poll_mode_enabled():
        return None
    if not (settings.twilio_account_sid and settings.twilio_auth_token):
        log.warning("TWILIO_MODE=poll but TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN are not set; poller off")
        return None
    _current = from_settings()
    # httpx logs every request URL at INFO: one line every 3 s, with the account SID in it.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    log.info("twilio poll: polling every %.0f s for WhatsApp messages to %s (no webhook needed)",
             _current.interval, settings.twilio_whatsapp_from)
    return asyncio.create_task(_current.run(), name="twilio-poll")


def status() -> dict | None:
    """For /health: None unless TWILIO_MODE=poll; counters only, no SIDs or numbers."""
    if not poll_mode_enabled():
        return None
    p = _current
    return {"enabled": True, "running": p is not None, "interval_s": p.interval if p else None,
            **({k: p.stats[k] for k in ("polls", "answered", "sent", "skipped", "errors", "last_ok", "last_error")} if p else {})}


# ---------------------------------------------------------------------------------------------- CLI

async def _list(p: TwilioPoller) -> dict:
    async with p.client() as client:
        msgs = await p.list_messages(client)
    inbound = [m for m in msgs if is_inbound_whatsapp(m)]
    p.load_seen()
    rows = [{"sid": mask_sid(m["sid"]), "from": mask_addr(str(m.get("from"))), "date_sent": m.get("date_sent"),
             "status": m.get("status"), "num_media": int(m.get("num_media") or 0),
             "sandbox_keyword": bool(SANDBOX_KEYWORD.match(str(m.get("body") or ""))), "seen": m["sid"] in p._seen_set}
            for m in inbound]
    return {"listed": len(msgs), "inbound_whatsapp": len(inbound), "outbound": sum(1 for m in msgs if str(m.get("direction", "")).startswith("outbound")),
            "inbound": rows}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Lokol: answer Twilio WhatsApp by polling the REST API (free trial tier)")
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--once", action="store_true", help="one pass: answer the newest unseen inbound message(s), then exit")
    mode.add_argument("--list", action="store_true", help="read-only: count inbound messages and print timestamps (no bodies)")
    ap.add_argument("--max", type=int, default=1, help="--once: answer at most this many (newest first), default 1")
    ap.add_argument("--max-age", type=float, default=86400.0, help="--once: ignore messages older than this many seconds (24 h)")
    ap.add_argument("--dry-run", action="store_true", help="--once: show what would be answered; send nothing, mark nothing")
    args = ap.parse_args(argv)
    settings.reload()
    if not (settings.twilio_account_sid and settings.twilio_auth_token):
        print("TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN are not set (.env)")
        return 2
    poller = from_settings()
    logging.getLogger("httpx").setLevel(logging.WARNING)
    if args.list:
        print(json.dumps(asyncio.run(_list(poller)), indent=2))
        return 0
    from .server import engine

    if not args.dry_run:
        engine.load()
    if args.once:
        poller.load_seen()
        res = asyncio.run(poller.poll_once(limit=args.max, max_age_s=args.max_age, prime_if_new=False, dry_run=args.dry_run))
        print(json.dumps({"results": res, "stats": {k: poller.stats[k] for k in ("answered", "sent", "skipped", "errors")}}, indent=2))
        return 0
    try:
        asyncio.run(poller.run())
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
