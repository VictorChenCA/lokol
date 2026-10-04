"""Per-user state (flags) and slash commands. In-memory with best-effort JSON persistence."""

from __future__ import annotations

import json
import re
import threading
import time
from dataclasses import dataclass, asdict, field
from pathlib import Path

from .config import settings

VALID = {
    "rdt": {"yes", "no", "unknown"},
    "act": {"yes", "no", "unknown"},
    "transport": {"now", "next_boat", "none"},
    "lang": {"pis", "en", "auto"},
}

HELP = {
    "en": (
        "Lokol Health commands:\n"
        "/rdt yes|no  malaria test kit available?\n"
        "/act yes|no  artemether-lumefantrine available?\n"
        "/now  transport available now\n"
        "/boat  next boat/transport only\n"
        "/notransport  no transport\n"
        "/lang pis|en|auto  reply language\n"
        "/voice on|off  voice note replies\n"
        "/status  show flags   /reset  clear"
    ),
    "pis": (
        "Lokol Health komand:\n"
        "/rdt yes|no  malaria test kit stap?\n"
        "/act yes|no  ACT meresin stap?\n"
        "/now  transport stap nao\n"
        "/boat  nekis bot nomoa\n"
        "/notransport  no transport\n"
        "/lang pis|en|auto  langwis\n"
        "/voice on|off  voice note\n"
        "/status  lukim flags   /reset  klinim"
    ),
}


@dataclass
class UserState:
    user_id: str
    channel: str = "http"
    lang: str = "auto"
    rdt: str = "unknown"
    act: str = "unknown"
    transport: str = "now"
    voice: bool = False
    last_lang: str = "en"
    turns: int = 0
    updated_at: float = field(default_factory=time.time)

    def flags(self, lang: str) -> dict:
        return {"lang": lang, "rdt": self.rdt, "act": self.act, "transport": self.transport}

    def summary(self, lang: str) -> str:
        if lang == "pis":
            return (
                f"Flags: rdt={self.rdt}, act={self.act}, transport={self.transport}, "
                f"lang={self.lang}, voice={'on' if self.voice else 'off'}"
            )
        return (
            f"Flags: RDT={self.rdt}, ACT={self.act}, transport={self.transport}, "
            f"lang={self.lang}, voice={'on' if self.voice else 'off'}"
        )


class StateStore:
    def __init__(self, path: Path | None = None) -> None:
        self.path = path or settings.state_file
        self._lock = threading.Lock()
        self._users: dict[str, UserState] = {}
        self._load()

    @staticmethod
    def key(channel: str, user_id: str) -> str:
        return f"{channel}:{user_id}"

    def _load(self) -> None:
        try:
            if self.path.exists():
                data = json.loads(self.path.read_text(encoding="utf-8"))
                for k, v in data.items():
                    v = {kk: vv for kk, vv in v.items() if kk in UserState.__dataclass_fields__}
                    self._users[k] = UserState(**v)
        except Exception:
            self._users = {}

    def _save(self) -> None:
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps({k: asdict(v) for k, v in self._users.items()}, indent=1), encoding="utf-8")
            tmp.replace(self.path)
        except Exception:
            pass

    def get(self, channel: str, user_id: str) -> UserState:
        k = self.key(channel, user_id)
        with self._lock:
            st = self._users.get(k)
            if st is None:
                st = UserState(user_id=user_id, channel=channel)
                self._users[k] = st
            return st

    def put(self, st: UserState) -> None:
        st.updated_at = time.time()
        with self._lock:
            self._users[self.key(st.channel, st.user_id)] = st
            self._save()

    def reset(self, channel: str, user_id: str) -> UserState:
        st = UserState(user_id=user_id, channel=channel)
        self.put(st)
        return st

    def all(self) -> list[UserState]:
        return list(self._users.values())


_CMD = re.compile(r"^\s*/(\w+)\s*(.*)$", re.S)


def handle_command(store: StateStore, st: UserState, text: str, lang_hint: str = "en") -> str | None:
    """Apply a slash command; return the confirmation text, or None if `text` is not a command."""
    m = _CMD.match(text or "")
    if not m:
        return None
    cmd = m.group(1).lower()
    arg = m.group(2).strip().lower()
    lang = st.lang if st.lang in ("pis", "en") else (lang_hint if lang_hint in ("pis", "en") else "en")
    ok = "Oraet." if lang == "pis" else "OK."

    if cmd in ("help", "start", "hi", "hello"):
        return HELP[lang]
    if cmd in ("status", "flags"):
        return st.summary(lang)
    if cmd == "reset":
        new = store.reset(st.channel, st.user_id)
        st.__dict__.update(new.__dict__)
        return (ok + " Flags klinim finis. " if lang == "pis" else ok + " Flags cleared. ") + st.summary(lang)
    if cmd in ("rdt", "act"):
        val = {"y": "yes", "n": "no", "u": "unknown", "?": "unknown", "ies": "yes", "nomoa": "no"}.get(arg, arg)
        if val not in VALID[cmd]:
            return f"/{cmd} yes|no|unknown"
        setattr(st, cmd, val)
        store.put(st)
        return f"{ok} {cmd.upper()} = {val}. " + st.summary(lang)
    if cmd in ("boat", "bot", "nextboat", "next_boat"):
        st.transport = "next_boat"
        store.put(st)
        return f"{ok} transport = next_boat. " + st.summary(lang)
    if cmd in ("now", "nao"):
        st.transport = "now"
        store.put(st)
        return f"{ok} transport = now. " + st.summary(lang)
    if cmd in ("notransport", "none", "no_transport"):
        st.transport = "none"
        store.put(st)
        return f"{ok} transport = none. " + st.summary(lang)
    if cmd == "transport":
        val = {"boat": "next_boat", "nextboat": "next_boat", "next": "next_boat", "no": "none"}.get(arg, arg)
        if val not in VALID["transport"]:
            return "/transport now|next_boat|none"
        st.transport = val
        store.put(st)
        return f"{ok} transport = {val}. " + st.summary(lang)
    if cmd in ("lang", "langwis", "language"):
        val = {"pijin": "pis", "pidgin": "pis", "english": "en", "eng": "en"}.get(arg, arg)
        if val not in VALID["lang"]:
            return "/lang pis|en|auto"
        st.lang = val
        store.put(st)
        lang = val if val in ("pis", "en") else lang
        return ("Oraet. Langwis = " if lang == "pis" else "OK. Language = ") + val + ". " + st.summary(lang)
    if cmd == "voice":
        st.voice = arg in ("on", "yes", "1", "true", "ya", "ies")
        store.put(st)
        return f"{ok} voice = {'on' if st.voice else 'off'}."
    return HELP[lang]
