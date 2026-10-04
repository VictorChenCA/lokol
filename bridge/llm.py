"""LLM backends for the bridge (SPEC §2 prompt format).

  llama  OpenAI-compatible llama-server at LLM_URL (default)
  river  the River-hosted tuned 9B (RIVER_CHECKPOINT on RIVER_BASE), sampled the same way
         pipeline/eval.py does: Qwen3.5 renderer with thinking off, temperature 0, one long-lived
         client + session reused across turns, blocking call run in a worker thread.

`generate()` picks the backend, times River out at RIVER_TIMEOUT (25 s) and falls back to LLM_URL
when reachable, else to a canned ASK_PERSON reply. It returns which backend answered.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import threading
import time
from dataclasses import dataclass, field

import httpx

from .config import settings

log = logging.getLogger("lokol.llm")

SYSTEM_PROMPT = (
    "You are Lokol Health, an assistant for nurse aides and health workers in Solomon Islands. "
    "You follow the Solomon Islands Standard Treatment Manual for Children. You never diagnose; "
    "you help the nurse apply the manual and decide when to refer. Reply in the nurse's language "
    "(Solomon Islands Pijin or English). Use the exact output format."
)

# Appended for base (untuned) models so they have a chance of emitting the protocol. A tuned
# Lokol model does not need it, but it is harmless.
FORMAT_HINT = (
    "Output format, three parts and nothing else. "
    "Line 1: ACTION: followed by one of ADVISE, REFER_NOW, REFER_NEXT_TRANSPORT, ASK_PERSON. "
    "Line 2: STM: followed by the section title written in the [guideline: ...] line, or NONE. "
    "Line 3: ---. "
    "Then the reply to the nurse in her language: what to check, what to give (dose by weight from the guideline), "
    "when to refer; at most 6 short lines, plain words, no markdown, do not repeat the nurse's message."
)


def build_user_turn(flags: dict, guideline_line: str, message: str) -> str:
    lang = flags.get("lang", "en")
    rdt = flags.get("rdt", "unknown")
    act = flags.get("act", "unknown")
    transport = flags.get("transport", "now")
    return f"[lang={lang}] [rdt={rdt}] [act={act}] [transport={transport}]\n{guideline_line}\n{message}"


def build_messages(flags: dict, guideline_line: str, message: str, format_hint: bool = True) -> list[dict]:
    system = SYSTEM_PROMPT + ("\n" + FORMAT_HINT if format_hint else "")
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": build_user_turn(flags, guideline_line, message)},
    ]


async def chat(messages: list[dict]) -> str:
    payload = {
        "model": settings.llm_model,
        "messages": messages,
        "max_tokens": settings.llm_max_tokens,
        "temperature": settings.llm_temperature,
        "top_p": 0.9,
        "stream": False,
        # llama-server honours this with --jinja; disables Qwen3.5 thinking.
        "chat_template_kwargs": {"enable_thinking": False},
    }
    async with httpx.AsyncClient(timeout=settings.llm_timeout) as client:
        r = await client.post(settings.llm_url, json=payload)
        r.raise_for_status()
        data = r.json()
    msg = data["choices"][0]["message"]
    content = msg.get("content") or ""
    return content


async def llm_ready() -> bool:
    try:
        base = settings.llm_url.split("/v1/")[0]
        async with httpx.AsyncClient(timeout=3) as client:
            r = await client.get(base + "/health")
            return r.status_code == 200
    except Exception:
        return False


def mock_reply(lang: str, chunk_section: str | None, message: str) -> str:
    """Canned protocol-compliant reply for tests and for demos without a model."""
    if chunk_section is None:
        body = (
            "Mi no sua. Askem nes in charge o dokta."
            if lang == "pis"
            else "I am not sure. Ask the nurse in charge or the doctor."
        )
        return f"ACTION: ASK_PERSON\nSTM: NONE\n---\n{body}"
    if lang == "pis":
        body = (
            f"Folom STM {chunk_section.title()}.\n"
            "Lukim pikinini: hot bodi, brit, dring, danger sign.\n"
            "Givim meresin folom weight long STM table.\n"
            "Talem mama: kam bak long 2 dei, o kwiktaem sapos hem wos."
        )
    else:
        body = (
            f"Follow the STM section {chunk_section.title()}.\n"
            "Check the child: fever, breathing, drinking, danger signs.\n"
            "Give the medicine by weight from the STM table.\n"
            "Tell the caregiver: return in 2 days, or sooner if worse."
        )
    return f"ACTION: ADVISE\nSTM: {chunk_section}\n---\n{body}"


# ---------------------------------------------------------------------------------------------
# River (hosted tuned 9B)
# ---------------------------------------------------------------------------------------------

def parse_chat_response_json(response_json: str | bytes | dict) -> str:
    """River's chat-complete result carries `response_json`, an OpenAI-format body serialised as a
    JSON *string*. Return the assistant content ('' when absent)."""
    data = response_json
    if isinstance(data, (str, bytes, bytearray)):
        data = json.loads(data or "{}")
    if isinstance(data, str):  # double-encoded
        data = json.loads(data)
    choices = (data or {}).get("choices") or []
    if not choices:
        return ""
    msg = choices[0].get("message") or {}
    return msg.get("content") or choices[0].get("text") or ""


class RiverChat:
    """One lazily created river_client Client + session, reused for every turn and rebuilt after an
    error. `complete()` blocks; call it through asyncio.to_thread."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._client = None
        self._session_ctx = None
        self._session = None
        self._renderer = None
        self._renderer_failed = False
        self.last_ok: bool | None = None
        self.last_error: str | None = None
        self.last_secs: float | None = None

    # -- connection -----------------------------------------------------------------------------
    def _ensure(self):
        with self._lock:
            if self._session is not None:
                return self._session
            import river_client as river

            try:
                import river_client.client as _rc

                _rc._SAMPLE_POLL_INTERVAL_SECS = 0.05  # pipeline/eval.py: shave the poll lag
            except Exception:
                pass
            key = os.environ.get("RIVER_API_KEY")
            if not key:
                raise RuntimeError("RIVER_API_KEY not set")
            self._client = river.Client(api_key=key)
            self._session_ctx = self._client.session(experiment="lokol-bridge")
            self._session = self._session_ctx.__enter__()
            if self._renderer is None and not self._renderer_failed:
                try:
                    from river_client.renderers import get_renderer

                    self._renderer = get_renderer(settings.river_base, thinking=False)
                except Exception as e:  # tokenizer not cached etc.: use chat-complete instead
                    self._renderer_failed = True
                    log.warning("river renderer unavailable (%s); using chat_complete_from_checkpoint", e)
            return self._session

    def warm(self) -> None:
        try:
            self._ensure()
            log.info("river ready: base=%s checkpoint=%s", settings.river_base, settings.river_checkpoint or "(base)")
        except Exception as e:
            self.last_ok, self.last_error = False, str(e)[:200]
            log.warning("river warm-up failed: %s", e)

    def reset(self) -> None:
        with self._lock:
            ctx, client = self._session_ctx, self._client
            self._client = self._session_ctx = self._session = None
        try:
            if ctx is not None:
                ctx.__exit__(None, None, None)
        except Exception:
            pass
        try:
            if client is not None:
                client.close()
        except Exception:
            pass

    # -- sampling -------------------------------------------------------------------------------
    def complete(self, messages: list[dict]) -> str:
        t0 = time.time()
        try:
            session = self._ensure()
            ckpt = settings.river_checkpoint or None
            kw = dict(max_tokens=settings.river_max_tokens, temperature=0.0)
            if self._renderer is not None:
                prompt = self._renderer.build_sample_prompt(messages).to_kwargs()["prompt"]
                if ckpt:
                    out = session.sample([prompt], base_model=settings.river_base, checkpoint=ckpt,
                                         timeout=settings.river_timeout, **kw)[0][0]
                else:
                    out = self._client.sample([prompt], base_model=settings.river_base, timeout=settings.river_timeout, **kw)[0]
                text = out.text or ""
            else:
                extra = dict(kw, chat_template_kwargs={"enable_thinking": False})
                if ckpt:
                    res = self._client.chat_complete_from_checkpoint(messages, checkpoint_path=ckpt, base_model=settings.river_base,
                                                                     timeout=settings.river_timeout, **extra)
                else:
                    res = self._client.chat_complete(messages, base_model=settings.river_base, timeout=settings.river_timeout, **extra)
                if getattr(res, "status_code", 200) not in (0, 200):
                    raise RuntimeError(f"river chat status {res.status_code}")
                text = parse_chat_response_json(res.response_json)
            self.last_ok, self.last_error, self.last_secs = True, None, round(time.time() - t0, 2)
            return text
        except Exception as e:
            self.last_ok, self.last_error = False, str(e)[:200]
            self.reset()  # reconnect on the next turn
            raise


RIVER = RiverChat()


# ---------------------------------------------------------------------------------------------
# Backend selection + fallback
# ---------------------------------------------------------------------------------------------

def canned_ask_person(lang: str) -> str:
    body = ("Mi no fit ansa distaem. Plis askem nes in charge o dokta."
            if lang == "pis" else "I cannot answer right now. Please ask the nurse in charge or the doctor.")
    return f"ACTION: ASK_PERSON\nSTM: NONE\n---\n{body}"


@dataclass
class Generation:
    raw: str
    backend: str  # "river" | "llama" | "canned" | "mock"
    model: str
    error: str | None = None
    attempts: list[dict] = field(default_factory=list)


def river_model_name() -> str:
    ck = settings.river_checkpoint
    return f"river:{ck.rsplit('/', 1)[-1]}" if ck else f"river:{settings.river_base}"


async def _try_llama(gen: Generation, messages: list[dict]) -> bool:
    t0 = time.time()
    try:
        gen.raw = await chat(messages)
        gen.backend, gen.model = "llama", settings.llm_model
        gen.attempts.append({"backend": "llama", "ok": True, "secs": round(time.time() - t0, 2)})
        return True
    except Exception as e:
        gen.attempts.append({"backend": "llama", "ok": False, "error": str(e)[:200]})
        return False


async def generate(flags: dict, guideline_line: str, message: str, lang: str) -> Generation:
    """Run the configured backend with fallback. Never raises."""
    gen = Generation(raw="", backend="canned", model="canned")
    if settings.llm_backend == "river":
        # The tuned model was trained on SYSTEM_PROMPT alone (pipeline/train_common.py).
        messages = build_messages(flags, guideline_line, message, format_hint=False)
        t0 = time.time()
        try:
            raw = await asyncio.wait_for(asyncio.to_thread(RIVER.complete, messages), timeout=settings.river_timeout)
            gen.raw, gen.backend, gen.model = raw, "river", river_model_name()
            gen.attempts.append({"backend": "river", "ok": True, "secs": round(time.time() - t0, 2)})
            return gen
        except asyncio.TimeoutError:
            err = f"river timed out after {settings.river_timeout:g}s"
        except Exception as e:
            err = f"river error: {e}"
        log.warning("%s; falling back", err[:200])
        gen.attempts.append({"backend": "river", "ok": False, "error": err[:200]})
        gen.error = err[:200]
        fallback = build_messages(flags, guideline_line, message)
        if await llm_ready() and await _try_llama(gen, fallback):
            return gen
    else:
        if await _try_llama(gen, build_messages(flags, guideline_line, message)):
            return gen
        gen.error = gen.attempts[-1].get("error")
    gen.raw, gen.backend, gen.model = canned_ask_person(lang), "canned", "canned"
    return gen


async def backend_status() -> dict:
    """For /health: which backend, which model, and whether it looks reachable (no model call)."""
    if settings.llm_backend == "river":
        return {
            "backend": "river",
            "model": river_model_name(),
            "base": settings.river_base,
            "reachable": bool(os.environ.get("RIVER_API_KEY")) and RIVER.last_ok is not False,
            "last_secs": RIVER.last_secs,
            "last_error": RIVER.last_error,
            "fallback": {"url": settings.llm_url, "reachable": await llm_ready()},
        }
    return {"backend": "llama", "model": settings.llm_model, "url": settings.llm_url, "reachable": await llm_ready()}
