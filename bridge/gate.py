"""Safety gate, language detector and protocol parser (SPEC §2).

RED_FLAGS mirrors ``pipeline/style_guide.md`` -> RED_FLAGS and ``app/src/runtime/gate.ts``.
Any match forces REFER_NOW (REFER_NEXT_TRANSPORT when transport=next_boat, with a
"what to give while waiting" line). The nurse decides; the gate only refuses to let the
model downgrade a danger sign to ADVISE.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

ACTIONS = ("ADVISE", "REFER_NOW", "REFER_NEXT_TRANSPORT", "ASK_PERSON")

# Each entry: id, label, English patterns, Pijin patterns (regex, case-insensitive).
RED_FLAGS: list[dict] = [
    {
        "id": "convulsions",
        "label": "convulsions",
        "en": [r"convuls", r"seizur", r"\bfit(s|ting|ted)?\b", r"\bjerk(ing|s)?\b"],
        "pis": [r"\bfit\b", r"sek[\s-]?sek", r"\bseksek\b", r"\bsek-sek\b"],
    },
    {
        "id": "unable_to_drink",
        "label": "unable to drink or breastfeed",
        "en": [
            r"(can(no|')t|cannot|unable to|not able to|won'?t|refus\w* to|stopp?ed|does ?n'?t|doesn't|not) (drink|breast ?feed|feed|suck|take fluid)",
            r"not (drinking|feeding|breastfeeding|sucking)",
            r"no (fluids?|feeds?) (taken|at all)",
        ],
        "pis": [r"no save (dring|susu|kaikai)", r"\bno (dring|susu)\b", r"no (wantem|laek) (dring|susu|kaikai)", r"no save tekem (wata|susu)"],
    },
    {
        "id": "vomits_everything",
        "label": "vomits everything",
        "en": [r"vomit(s|ing|ed)? everything", r"vomits? (all|every)", r"keeps? nothing down", r"brings? (everything|it all) (back )?up"],
        "pis": [r"toraot(em)? (evri|olgeta|evrisamting|evrising)", r"toraot evri", r"toraot olketa (samting|kaikai|wata)"],
    },
    {
        "id": "lethargic_unconscious",
        "label": "lethargic or unconscious",
        "en": [r"letharg", r"unconscious", r"unresponsive", r"not respond", r"\bdrowsy\b", r"\bfloppy\b", r"very sleepy", r"(hard|difficult) to wake", r"won'?t wake", r"(not|no) (waking|alert)", r"\bcoma\b"],
        "pis": [r"slip tumas", r"no save wekap", r"\bno wekap\b", r"\bded olsem\b", r"no muv", r"no luk raon", r"no save luk", r"\bbodi slak\b", r"slak tumas"],
    },
    {
        "id": "breathing_danger",
        "label": "chest indrawing or fast breathing with danger sign",
        "en": [r"chest in-?drawing", r"\bindrawing\b", r"fast breathing", r"breathing (very )?fast", r"difficult(y)? (in )?breathing", r"struggl\w* to breathe", r"\bgrunting\b", r"\bstridor\b", r"breathing (hard|heav)", r"gasping", r"respirat\w* distress", r"\bapnoea|apnea\b"],
        "pis": [r"brit hariap", r"hariap brit", r"\bsot ?win\b", r"hard (fo|long) brit", r"no save brit gud", r"brit (hard|had|nogud)", r"chest (hem )?go insaet", r"skin (lo|long) chest (hem )?go insaet", r"brit kwiktaem"],
    },
    {
        "id": "stiff_neck",
        "label": "stiff neck",
        "en": [r"stiff neck", r"neck (is )?stiff", r"neck stiffness", r"bulging fontanel", r"cannot bend (the )?neck"],
        "pis": [r"nek (hem )?stif", r"stif nek", r"nek stif", r"nek (hem )?hard", r"no save bendem nek"],
    },
    {
        "id": "severe_dehydration",
        "label": "severe dehydration",
        "en": [r"severe(ly)? dehydrat", r"sunken eyes", r"skin pinch (goes back )?(very )?slow", r"no tears", r"not pass(ing|ed) urine", r"no urine", r"very dry mouth"],
        "pis": [r"ai (hem )?go insaet", r"\bno pispis\b", r"no wata insaet", r"drae tumas", r"skin (hem )?drae", r"ai (hem )?drae", r"maot (hem )?drae tumas"],
    },
    {
        "id": "severe_malnutrition",
        "label": "severe malnutrition (visible wasting, oedema of both feet)",
        "en": [r"severe(ly)? (acute )?malnutri", r"visible (severe )?wasting", r"\bwasting\b", r"o?edema (of |in |on )?(both )?(feet|legs)", r"both feet (are )?swollen", r"swollen feet", r"skin and bones?", r"\bsam\b", r"\bmuac\b.*(red|<\s*11|under 11)", r"marasmus|kwashiorkor"],
        "pis": [r"bon(i|y)? tumas", r"tin tumas", r"skin an bon", r"tufala leg (hem )?swel", r"swel long tufala leg", r"leg (hem )?swel", r"bodi (hem )?bon nomoa", r"no garem mit long bodi"],
    },
    {
        "id": "bleeding",
        "label": "bleeding",
        "en": [r"\bbleed", r"blood (coming|from|in) ", r"h(a)?emorrhag", r"coughing (up )?blood", r"blood in (the )?stool", r"bloody (stool|diarrhoea|vomit)", r"vomit(ing|s)? blood", r"nose ?bleed"],
        "pis": [r"blad (hem )?(kam|ran|kamaot)", r"blad long", r"ran blad", r"sitsit blad", r"toraot blad", r"blad kamaot", r"kof(em)? blad"],
    },
    {
        "id": "cyanosis",
        "label": "cyanosis",
        "en": [r"cyano", r"blue lips", r"lips? (are |is |turning |going )?blue", r"turning blue", r"blue (around|in) (the )?(lips|mouth)", r"(grey|gray|dusky) (colour|color|skin|lips)", r"\bcentral blue"],
        "pis": [r"lips? (hem )?blu", r"maot (hem )?blu", r"blu (lips|maot|skin)", r"skin (hem )?blu", r"fes (hem )?blu"],
    },
    {
        "id": "burns_face_airway",
        "label": "burns of face or airway",
        "en": [r"burn\w* (to |on |of |around )?(the |his |her )?(face|mouth|airway|neck|nose|lips|throat)", r"(face|mouth|airway|facial) burn", r"inhal\w+ (smoke|hot|steam)", r"smoke inhalation", r"burn\w*[^.]{0,40}(face|mouth|airway|lips|nose)", r"singed (nasal|nose) hair"],
        "pis": [r"bon\w* long (fes|maot|nek|nus|lips?|throat)", r"fes (hem )?bon", r"maot (hem )?bon", r"fes bon", r"faea bonem (fes|maot)", r"smok go insaet"],
    },
]

# Special case: age under 2 months with fever (needs both an age cue and a fever cue).
_AGE_UNDER_2M = [
    # "3 weeks old", "10 dei ol", "aged 5 days", "bebi 3 wik", "baby of 6 weeks", "2wo"
    r"\b(\d{1,2})\s*(day|days|dei|deis|wik|wiks|week|weeks)[\s-]*(old|ol)\b",
    r"\b(?:aged?|age)\s*(\d{1,2})\s*(day|days|dei|deis|wik|wiks|week|weeks)\b",
    r"\b(?:bebi|baby|infant|neonate)\s*(?:of|blong|hem|ia|is)?\s*(\d{1,2})\s*(day|days|dei|deis|wik|wiks|week|weeks)\b",
    r"\b(newborn|neonate|neonatal|niu ?bebi|nyu ?bebi|new ?bebi|niufala bebi|bebi nomoa bon)\b",
    r"\b(1|one|wan)\s*(month|mun|manis)[\s-]*(old|ol)\b",
    r"\b(\d{1,2})\s*(d|w)o\b",
]
_FEVER = [r"\bfever", r"\bfebrile", r"hot bodi", r"hot body", r"bodi hot", r"temperature", r"\btemp\b", r"hot skin", r"\bhot tumas", r"skin hot", r"\bhot\b", r"\bfiva\b", r"\bwarm\b"]


_NEGATION = re.compile(r"(\bno\b|\bnot\b|\bwithout\b|\bnomoa\b|\bno gat\b|\bno garem\b|\bdenies\b|\bisn'?t\b|\bnever\b)\s*(\w+\s+){0,2}$", re.I)


def _negated(text: str, start: int) -> bool:
    """True when the 25 chars before a match carry a negation ("no chest indrawing", "nomoa fit")."""
    return bool(_NEGATION.search(text[max(0, start - 25):start]))


def _any(patterns: list[str], text: str) -> bool:
    for p in patterns:
        for m in re.finditer(p, text, re.I):
            if not _negated(text, m.start()):
                return True
    return False


def _age_under_2_months(text: str) -> bool:
    t = text.lower()
    for p in _AGE_UNDER_2M:
        m = re.search(p, t, re.I)
        if not m:
            continue
        g = m.group(1)
        if g.isdigit():
            n = int(g)
            unit = m.group(2) if m.lastindex and m.lastindex >= 2 else ""
            if unit.startswith(("day", "dei", "d")):
                return n <= 60
            if unit.startswith(("wik", "week", "w")):
                return n <= 8
            return True
        return True
    # "2 months" exactly is the threshold; "under 2 months" phrasing
    if re.search(r"(under|less than|below|younger than)\s*(2|two)\s*(months?|mun|manis)", t):
        return True
    return False


# Which STM chapter a red flag belongs to (titles as in corpus/sections.json). Used to steer
# retrieval so a convulsing child is cited to CONVULSIONS, not to whichever chapter lists the most
# danger-sign words. Flags without one clear chapter are left out on purpose.
RED_FLAG_SECTIONS: dict[str, list[str]] = {
    "convulsions": ["CONVULSIONS"],
    "breathing_danger": ["PNEUMONIA", "ASTHMA"],
    "stiff_neck": ["MENINGITIS"],
    "severe_dehydration": ["DIARRHOEA", "DEHYDRATION"],
    "severe_malnutrition": ["MALNUTRITION"],
    "burns_face_airway": ["BURNS AND SCALDS", "BURNS"],
    "young_infant_fever": ["NEWBORN BABIES - NEONATAL INFECTIONS", "THE 7-STEP CHECKLIST FOR YOUNG INFANTS"],
}


def match_red_flags(message: str) -> list[dict]:
    """Return the matched red-flag entries (id, label) for a nurse message, both languages."""
    text = message.lower()
    hits: list[dict] = []
    for rf in RED_FLAGS:
        if _any(rf["en"], text) or _any(rf["pis"], text):
            hits.append({"id": rf["id"], "label": rf["label"]})
    if _age_under_2_months(text) and _any(_FEVER, text):
        hits.append({"id": "young_infant_fever", "label": "age under 2 months with fever"})
    return hits


# ---------------------------------------------------------------------------------------------
# Language detection: Solomon Islands Pijin vs English (glossary heuristic)
# ---------------------------------------------------------------------------------------------

# weight 2: unambiguous Pijin; weight 1: Pijin spellings that are rare in English.
PIJIN_MARKERS: dict[str, int] = {
    "pikinini": 2, "pikinin": 2, "bebi": 2, "olketa": 2, "mifala": 2, "iufala": 2, "blong": 2, "bilong": 2,
    "tumas": 2, "nomoa": 2, "wanem": 2, "olsem": 2, "hemi": 2, "hem": 2, "meresin": 2, "dokta": 2, "hospitol": 2,
    "klinik": 2, "kaikai": 2, "toraot": 2, "sitsit": 2, "hariap": 2, "kwiktaem": 2, "sendem": 2, "lukim": 2,
    "givim": 2, "askem": 2, "folom": 2, "garem": 2, "kasem": 2, "wantem": 2, "stap": 2, "insaet": 2,
    "tudei": 2, "tumora": 2, "yestedei": 2, "bikfala": 2, "smolfala": 2, "nogud": 2, "disfala": 2,
    "datfala": 2, "wetem": 2, "seksek": 2, "sotwin": 2, "pispis": 2, "dringim": 2, "mekem": 2, "duim": 2,
    "tingting": 2, "fraet": 2, "tanggio": 2, "bodi": 2, "savve": 2, "wokabaot": 2, "hariop": 2,
    "sik": 1, "nes": 1, "wata": 1, "susu": 1, "brit": 1, "nek": 1, "stif": 1, "blad": 1, "bot": 1, "sua": 1,
    "dring": 1, "soa": 1, "swel": 1, "kof": 1, "kus": 1, "ded": 1, "dae": 1, "hed": 1, "bel": 1, "bele": 1,
    "fes": 1, "maot": 1, "nus": 1, "taem": 1, "dei": 1, "naet": 1, "wik": 1, "mun": 1, "yia": 1, "slip": 1,
    "gud": 1, "bae": 1, "bai": 1, "finis": 1, "pinis": 1, "plis": 1, "mere": 1, "laek": 1, "nao": 1, "iu": 1,
    "mi": 1, "ya": 1, "fo": 1, "lo": 1, "wanfala": 2, "tufala": 2, "trifala": 2, "evri": 1, "samting": 2,
    "hao": 1, "waswe": 2, "nating": 2, "stret": 1, "tru": 1, "barava": 2, "lelebet": 2, "lelebit": 2,
}
_ENGLISH_HINTS = {"the", "and", "with", "is", "has", "have", "child", "baby", "fever", "days", "what", "should", "please", "give", "medicine", "vomiting", "diarrhoea", "breathing", "not", "drinking"}


def detect_lang(text: str) -> str:
    """Return 'pis' or 'en'. A command or empty text defaults to 'en'."""
    words = re.findall(r"[a-zA-Z']+", text.lower())
    if not words:
        return "en"
    score = sum(PIJIN_MARKERS.get(w, 0) for w in words)
    en = sum(1 for w in words if w in _ENGLISH_HINTS)
    ratio = score / max(len(words), 1)
    if score >= 4 and score > en:
        return "pis"
    if score >= 2 and ratio >= 0.2 and score >= en:
        return "pis"
    return "en"


# ---------------------------------------------------------------------------------------------
# Protocol parser
# ---------------------------------------------------------------------------------------------

_THINK = re.compile(r"<think>.*?</think>", re.S)
_ACTION = re.compile(r"ACTION\s*[:=]\s*([A-Za-z_ \-]+)")
_STM = re.compile(r"STM\s*[:=]\s*(.+)")


@dataclass
class ParsedReply:
    action: str | None
    stm: str | None  # None means NONE / missing
    body: str
    raw: str
    compliant: bool


def _clean_body(body: str, max_lines: int = 6, max_line_chars: int = 240, max_chars: int = 800) -> str:
    lines: list[str] = []
    seen: set[str] = set()
    is_json = body.strip().startswith("{")
    for ln in body.strip().splitlines():
        ln = ln.strip()
        if not ln or ln == "---":
            continue
        ln = re.sub(r"[*`]+", "", ln)  # no markdown on WhatsApp (keep '_' for JSON keys)
        ln = re.sub(r"^#+\s*", "", ln)
        ln = re.sub(r"^[-•]\s*", "- ", ln)
        key = ln.lower()
        if key in seen:  # base models loop; drop exact repeats
            continue
        seen.add(key)
        if not is_json and len(ln) > max_line_chars:
            cut = ln[:max_line_chars]
            ln = cut[: cut.rfind(". ") + 1] if ". " in cut[40:] else cut.rstrip() + "…"
        lines.append(ln)
    out = "\n".join(lines[:max_lines])
    if not is_json and len(out) > max_chars:
        out = out[:max_chars].rstrip() + "…"
    return out


def parse_reply(text: str) -> ParsedReply:
    raw = text or ""
    t = _THINK.sub("", raw)
    t = re.sub(r"^\s*<think>.*", "", t, flags=re.S) if "</think>" not in t and t.lstrip().startswith("<think>") else t
    t = t.strip()
    action = None
    m = _ACTION.search(t)
    if m:
        a = m.group(1).strip().upper().replace(" ", "_").replace("-", "_")
        a = a.split("|")[0].strip("_ ")
        if a in ACTIONS:
            action = a
    stm = None
    stm_found = False
    m2 = _STM.search(t)
    if m2:
        stm_found = True
        s = m2.group(1).strip().strip(".").strip()
        if s.upper() != "NONE" and s:
            stm = s
    body = ""
    if "---" in t:
        body = t.split("---", 1)[1]
    elif m2:
        body = t[m2.end():]
    elif m:
        body = t[m.end():]
    else:
        body = t
    body = _clean_body(body)
    # JSON body for note tasks: keep as a single line if it parses
    if body.startswith("{"):
        try:
            import json as _json

            obj = _json.loads(body.split("\n", 1)[0]) if body.count("\n") == 0 else _json.loads(body)
            body = _json.dumps(obj, ensure_ascii=False)
        except Exception:
            pass
    # Template residue from a base model ("<reply in the nurse's language...>", "<title>") is not a reply.
    template_residue = bool(re.search(r"<\s*(reply|title|section|answer|your)[^>]*>", body, re.I)) or body.strip() in ("<", "<>", "...")
    compliant = action is not None and stm_found and bool(body) and not template_residue
    return ParsedReply(action=action, stm=stm, body=body, raw=raw, compliant=compliant)


# ---------------------------------------------------------------------------------------------
# Gate
# ---------------------------------------------------------------------------------------------

CANNED = {
    "refer_now": {
        "pis": "SENDEM PIKININI NAO. Hem garem danger sign. Ringim/radio long hospitol, givim first aid folom STM, an go wetem hem.",
        "en": "REFER NOW. This child has a danger sign. Call/radio the hospital, give first aid per the STM, and go with the child.",
    },
    "refer_boat": {
        "pis": "SENDEM LONG NEKIS BOT. Danger sign ia. Taem iu wet: givim pre-referral treatment folom STM, kipim pikinini wom, lukim brit an dring evri aoa.",
        "en": "REFER ON THE NEXT TRANSPORT. Danger sign. While waiting: give pre-referral treatment per the STM, keep the child warm, check breathing and drinking every hour.",
    },
    "refer_none": {
        "pis": "SENDEM NAO sapos eni wei. No transport: ringim/radio dokta o nes in charge nao, givim pre-referral treatment folom STM, lukim pikinini evri aoa.",
        "en": "REFER NOW by any means. No transport: call/radio the doctor or nurse in charge now, give pre-referral treatment per the STM, check the child every hour.",
    },
    "ask_person": {
        "pis": "Mi no sua. Askem nes in charge o dokta. Sapos pikinini garem danger sign, sendem nao.",
        "en": "I am not sure. Ask the nurse in charge or the doctor. If the child has a danger sign, refer now.",
    },
    "no_guideline": {
        "pis": "Mi no faendem disfala samting long STM for Children. Askem nes in charge o dokta.",
        "en": "I could not find this in the STM for Children. Ask the nurse in charge or the doctor.",
    },
}


@dataclass
class GateResult:
    action: str
    stm: str | None
    body: str
    red_flags: list[dict] = field(default_factory=list)
    overridden: bool = False
    reasons: list[str] = field(default_factory=list)
    compliant: bool = True


def _norm(s: str) -> str:
    s = s.upper().replace("–", "-").replace("—", "-").replace("&", "AND")
    s = re.sub(r"[^A-Z0-9 ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


norm_title = _norm


def canonical_section(stm: str | None, section_titles: list[str]) -> str | None:
    if not stm:
        return None
    n = _norm(stm)
    for t in section_titles:
        if _norm(t) == n:
            return t
    for t in section_titles:  # prefix / containment (model may shorten a long title)
        tn = _norm(t)
        if n and (tn.startswith(n) or n.startswith(tn)) and min(len(n), len(tn)) >= 5:
            return t
    return None


def _is_echo(body: str, message: str) -> bool:
    """True when the reply is mostly the nurse's own words repeated back."""
    b = re.sub(r"[^a-z0-9 ]+", " ", body.lower()).split()
    m = set(re.sub(r"[^a-z0-9 ]+", " ", message.lower()).split())
    if len(b) < 4 or not m:
        return False
    overlap = sum(1 for w in b if w in m) / len(b)
    return overlap >= 0.8


def apply_gate(
    message: str,
    parsed: ParsedReply,
    flags: dict,
    chunk_section: str | None,
    lang: str,
    section_titles: list[str],
) -> GateResult:
    lang = "pis" if lang == "pis" else "en"
    reasons: list[str] = []
    red = match_red_flags(message)
    action = parsed.action
    stm = canonical_section(parsed.stm, section_titles) if section_titles else parsed.stm
    if parsed.stm and not stm:
        reasons.append(f"stm_not_in_sections:{parsed.stm[:60]}")
    body = parsed.body
    overridden = False
    compliant = parsed.compliant

    # An echo of the nurse's message is not an answer (base models do this in Pijin).
    if compliant and _is_echo(body, message):
        reasons.append("echo_of_message")
        compliant = False

    if not compliant:
        if parsed.compliant is False:
            reasons.append("non_compliant_reply")
        action = "ASK_PERSON"
        stm = None
        body = CANNED["ask_person"][lang]
        overridden = True

    if red:
        transport = (flags.get("transport") or "now").lower()
        forced = "REFER_NEXT_TRANSPORT" if transport == "next_boat" else "REFER_NOW"
        key = "refer_boat" if transport == "next_boat" else ("refer_none" if transport == "none" else "refer_now")
        if action != forced:
            reasons.append("red_flag_forced_" + forced.lower())
            overridden = True
            model_lines = [ln for ln in body.splitlines() if ln.strip()] if compliant else []
            body = "\n".join([CANNED[key][lang]] + model_lines)[:900]
            body = "\n".join(body.splitlines()[:6])
        action = forced
        if stm is None and chunk_section:
            stm = canonical_section(chunk_section, section_titles) or chunk_section
    elif chunk_section is None and action == "ADVISE":
        reasons.append("no_guideline_abstain")
        action = "ASK_PERSON"
        stm = None
        body = CANNED["no_guideline"][lang]
        overridden = True

    if action == "ASK_PERSON":
        stm = None
    elif stm is None and chunk_section and action in ("ADVISE", "REFER_NOW", "REFER_NEXT_TRANSPORT"):
        stm = canonical_section(chunk_section, section_titles) or chunk_section

    if action is None:
        action = "ASK_PERSON"
        body = body or CANNED["ask_person"][lang]
    return GateResult(
        action=action,
        stm=stm,
        body=body,
        red_flags=red,
        overridden=overridden,
        reasons=reasons,
        compliant=compliant,
    )


ACTION_LABEL = {
    "ADVISE": {"pis": "", "en": ""},
    "REFER_NOW": {"pis": "[SENDEM NAO]", "en": "[REFER NOW]"},
    "REFER_NEXT_TRANSPORT": {"pis": "[SENDEM LONG NEKIS BOT]", "en": "[REFER ON NEXT TRANSPORT]"},
    "ASK_PERSON": {"pis": "[ASKEM NES / DOKTA]", "en": "[ASK A PERSON]"},
}


def format_for_channel(result: GateResult, lang: str, page: int | None = None) -> str:
    lang = "pis" if lang == "pis" else "en"
    parts: list[str] = []
    label = ACTION_LABEL.get(result.action, {}).get(lang, "")
    if label:
        parts.append(label)
    parts.append(result.body.strip())
    if result.stm:
        cite = f"STM: {result.stm}" + (f" p{page}" if page else "")
        parts.append(cite)
    if result.red_flags:
        names = ", ".join(r["label"] for r in result.red_flags)
        parts.append(("Danger sign: " if lang == "en" else "Danger sign: ") + names)
    return "\n".join(p for p in parts if p)
