"""LLM call to the local OpenAI-compatible llama-server (SPEC §2 prompt format) plus a mock."""

from __future__ import annotations

import httpx

from .config import settings

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
