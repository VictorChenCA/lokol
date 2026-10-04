"""Settings for the bridge. Reads the repo-root .env (never committed) and the environment."""

from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BRIDGE_DIR = Path(__file__).resolve().parent

_TRUE = {"1", "true", "yes", "on"}


def load_dotenv(path: Path = ROOT / ".env") -> None:
    """Minimal .env loader: KEY=VALUE lines, '#' comments, never overrides a set variable."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


load_dotenv()


class Settings:
    def __init__(self) -> None:
        self.reload()

    def reload(self) -> None:
        e = os.environ
        self.mock = e.get("LOKOL_MOCK", "0").lower() in _TRUE
        # LLM (OpenAI-compatible llama-server)
        self.llm_url = e.get("LLM_URL", "http://127.0.0.1:8080/v1/chat/completions")
        self.llm_model = e.get("LLM_MODEL", "lokol-health")
        self.llm_max_tokens = int(e.get("LLM_MAX_TOKENS", "220"))
        self.llm_temperature = float(e.get("LLM_TEMPERATURE", "0.2"))
        self.llm_timeout = float(e.get("LLM_TIMEOUT", "90"))
        # Speech sidecar
        self.sidecar_url = e.get("SIDECAR_URL", "http://127.0.0.1:8091").rstrip("/")
        self.sidecar_timeout = float(e.get("SIDECAR_TIMEOUT", "60"))
        # Public URL (cloudflared) used for Twilio signature checks and media links
        self.public_base_url = e.get("PUBLIC_BASE_URL", "http://localhost:8090").rstrip("/")
        # Twilio
        self.twilio_account_sid = e.get("TWILIO_ACCOUNT_SID", "")
        self.twilio_auth_token = e.get("TWILIO_AUTH_TOKEN", "")
        self.twilio_whatsapp_from = e.get("TWILIO_WHATSAPP_FROM", "whatsapp:+14155238886")
        # When true, answer the webhook with an empty TwiML immediately and send the reply
        # through the REST API from a background task (avoids Twilio's 15 s webhook timeout
        # with the 9B model). Needs SID + token.
        self.twilio_async = e.get("TWILIO_ASYNC", "0").lower() in _TRUE
        # Meta / Messenger
        self.meta_verify_token = e.get("META_VERIFY_TOKEN", "lokol-verify")
        self.meta_page_token = e.get("META_PAGE_TOKEN", "")
        self.meta_app_secret = e.get("META_APP_SECRET", "")
        self.meta_graph_version = e.get("META_GRAPH_VERSION", "v21.0")
        # Corpus
        self.corpus_jsonl = Path(e.get("LOKOL_CORPUS", str(ROOT / "corpus" / "stm_children_chunks.jsonl")))
        self.sections_json = Path(e.get("LOKOL_SECTIONS", str(ROOT / "corpus" / "sections.json")))
        self.raw_txt = Path(
            e.get("LOKOL_RAW_TXT", str(ROOT / "data" / "raw" / "SI_Standard_Treatment_Manual_for_Children_2017.txt"))
        )
        # Retrieval: below this BM25 score the top hit is treated as "no guideline"
        # Real STM queries score 15-25 on the 182-chunk corpus; junk ("adult chest pain") scores 5-7.
        self.min_retrieval_score = float(e.get("LOKOL_MIN_SCORE", "8.0"))
        # Local files
        self.static_dir = Path(e.get("LOKOL_STATIC_DIR", str(BRIDGE_DIR / "static")))
        self.state_file = Path(e.get("LOKOL_STATE_FILE", str(BRIDGE_DIR / ".state" / "users.json")))
        self.log_file = Path(e.get("LOKOL_LOG_FILE", str(BRIDGE_DIR / ".state" / "messages.jsonl")))
        self.ffmpeg = e.get("FFMPEG", "ffmpeg")


settings = Settings()
