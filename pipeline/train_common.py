"""TRAIN-lane shared helpers: the SPEC §2 protocol as code (prompt builder, reply parser, row adapters).

Row schema accepted everywhere (DATA lane rows or the stub). Either of:
  A) {"messages": [system, user, assistant], ...optional labels...}
  B) {"flags": {"rdt","act","transport"}, "lang", "guideline": {"section","page","text"} | "none",
      "message", "action", "stm", "reply"(str, or JSON string for task=note), "task", "red_flag"}
`row_labels(row)` returns the gold labels from the explicit fields when present, else by parsing the assistant turn.
"""
import json, re
from pathlib import Path

ROW_KEYS = ["id", "task", "lang", "flags", "guideline", "message", "action", "stm", "reply", "red_flag", "messages"]

SYSTEM_PROMPT = ("You are Lokol Health, an assistant for nurse aides and health workers in Solomon Islands. You follow the "
                 "Solomon Islands Standard Treatment Manual for Children. You never diagnose; you help the nurse apply the "
                 "manual and decide when to refer. Reply in the nurse's language (Solomon Islands Pijin or English). Use the "
                 "exact output format.")

ACTIONS = ["ADVISE", "REFER_NOW", "REFER_NEXT_TRANSPORT", "ASK_PERSON"]
REFER = {"REFER_NOW", "REFER_NEXT_TRANSPORT"}

# SPEC §2 red-flag list, as substrings (English + Pijin) so the eval can tag rows the DATA lane did not tag.
RED_FLAG_PATTERNS = [
    r"convuls", r"\bfit\b", r"sek-?sek", r"unable to (drink|breast)", r"cannot (drink|feed|breast)", r"no save drink",
    r"vomit(s|ing)? everything", r"toraot evri", r"letharg", r"unconscious", r"slip tumas", r"chest indrawing",
    r"stiff neck", r"nek stif", r"severe dehydration", r"severe (acute )?malnutrition", r"oedema of both", r"tufala leg.*swell",
    r"bleed", r"cyanos", r"lips? (going |smol )?blu", r"under 2 months", r"anda 2 manis", r"\b[1-7] wiki\b", r"burns? (of|on) the face",
    r"face and (neck|airway)", r"airway",
]
_RED = re.compile("|".join(RED_FLAG_PATTERNS), re.I)

PIJIN_GLOSSARY = ["pikinini", "bebi", "hot bodi", "sik", "meresin", "dokta", "nes", "klinik", "hospitol", "wata", "kaikai", "susu",
                  "toraot", "sitsit", "brit", "fit", "sek-sek", "slip tumas", "nek stif", "blad", "hariap", "kwiktaem", "bot",
                  "sendem", "lukim", "givim", "folom", "askem", "mi no sua", "long", "blong", "wetem", "evri", "sapos", "tumas",
                  "nomoa", "gud", "mami", "olketa", "garem", "taem", "dei", "manis", "yia", "kam bak"]

def has_red_flag(text):
    return bool(_RED.search(text or ""))

def user_turn(flags, guideline, message, lang=None, max_chars=1400):
    """SPEC §2 user turn. guideline: dict(section,page,text) | "none" | None."""
    lang = lang or flags.get("lang", "en")
    head = f"[lang={lang}] [rdt={flags.get('rdt','unknown')}] [act={flags.get('act','unknown')}] [transport={flags.get('transport','none')}]"
    if not guideline or guideline == "none" or guideline.get("text") in (None, "", "none") or not guideline.get("section"):
        gl = "[guideline: none] none"
    else:
        txt = re.sub(r"\s+", " ", guideline["text"]).strip()[:max_chars]  # ~350 tokens
        page = guideline.get("page")
        gl = f"[guideline: {guideline['section']}{' p' + str(page) if page else ''}] {txt}"
    return f"{head}\n{gl}\n{message.strip()}"

def assistant_turn(action, stm, reply):
    body = reply if isinstance(reply, str) else json.dumps(reply, ensure_ascii=False)
    return f"ACTION: {action}\nSTM: {stm or 'NONE'}\n---\n{body.strip()}"

def build_messages(row):
    if row.get("messages"):
        return row["messages"]
    return [{"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_turn(row["flags"], row.get("guideline"), row["message"], row.get("lang"))},
            {"role": "assistant", "content": assistant_turn(row["action"], row.get("stm"), row["reply"])}]

def to_mlx_row(row):
    return {"messages": build_messages(row)}

_HEAD = re.compile(r"^\s*ACTION:\s*([A-Z_]+)\s*\n\s*STM:\s*(.+?)\s*\n\s*---\s*\n?(.*)$", re.S)

def parse_reply(text):
    """-> dict(ok, action, stm, body, json) ; ok=False when the strict format is violated."""
    if text is None:
        return {"ok": False, "action": None, "stm": None, "body": "", "json": None}
    t = text.strip()
    t = re.sub(r"^<think>.*?</think>\s*", "", t, flags=re.S)  # tolerate an empty/leaked think block
    m = _HEAD.match(t)
    if not m:
        # lenient fallback so ACTION accuracy can still be scored on near-misses
        a = re.search(r"ACTION:\s*([A-Z_]+)", t); s = re.search(r"STM:\s*(.+)", t)
        return {"ok": False, "action": a.group(1) if a else None, "stm": s.group(1).strip() if s else None, "body": t, "json": None}
    action, stm, body = m.group(1), m.group(2).strip(), m.group(3).strip()
    ok = action in ACTIONS
    js = None
    if body.startswith("{"):
        try: js = json.loads(body)
        except Exception: js = None
    if body and not body.startswith("{"):
        ok = ok and len([l for l in body.splitlines() if l.strip()]) <= 6 and "**" not in body and "#" not in body[:2]
    return {"ok": ok, "action": action, "stm": stm, "body": body, "json": js}

def row_labels(row):
    """gold labels: action, stm, task, lang, red_flag; parsed from the assistant turn when not explicit."""
    msgs = row.get("messages") or []
    asst = next((m["content"] for m in reversed(msgs) if m.get("role") == "assistant"), None)
    user = next((m["content"] for m in msgs if m.get("role") == "user"), None)
    p = parse_reply(asst) if asst else {}
    action = row.get("action") or p.get("action")
    stm = row.get("stm") or p.get("stm")
    lang = row.get("lang") or (re.search(r"\[lang=(\w+)\]", user or "").group(1) if user and "[lang=" in user else None)
    task = row.get("task") or ("note" if p.get("json") is not None else ("abstain" if action == "ASK_PERSON" else "guidance"))
    msg_text = row.get("message") or (user.split("\n", 2)[-1] if user else "")
    red = row.get("red_flag")
    if red is None:
        red = has_red_flag(msg_text)
    return {"action": action, "stm": stm, "task": task, "lang": lang, "red_flag": bool(red)}

def prompt_messages(row):
    """system+user only (for sampling)."""
    msgs = build_messages(row)
    return [m for m in msgs if m["role"] != "assistant"]

def read_jsonl(path, limit=None):
    rows = []
    for p in str(path).split(","):
        p = p.strip()
        if not p or not Path(p).exists():
            continue
        with open(p) as fh:
            for line in fh:
                if line.strip():
                    rows.append(json.loads(line))
                    if limit and len(rows) >= limit:
                        return rows
    return rows

def glossary_hits(text):
    t = (text or "").lower()
    return sum(1 for g in PIJIN_GLOSSARY if g in t)
