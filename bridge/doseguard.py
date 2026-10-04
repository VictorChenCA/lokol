"""Dose-grounding guard: every dose in a reply must come from the manual page the reply used.

Mirrors ``app/src/runtime/doseguard.ts`` (same regexes, same 15% tolerance, same safe lines).

A dose expression is a number or range plus a unit (mg/kg, mg, mcg/kg, mcg, microgram, g/kg, g,
ml/kg, ml, units/kg, IU; "mg per kg", "mg/kilo" and Pijin "mg fo evri kilo" are all mg/kg). It is SUPPORTED when
  (a) the same number + unit appears in the excerpt (for a range, the TOP endpoint must appear: "15-150 mg/kg"
      is not grounded by "15mg/kg", while "10-15 mg/kg" is, since a lower bottom only under-doses), or
  (b) it is an absolute amount (mg, mcg, g, ml), the nurse message gives a weight, and every endpoint
      is within 15% of an excerpt per-kg dose x weight (or inside an excerpt per-kg range x weight),
      or appears in the excerpt as an absolute amount (weight-band tables).
A reply line with any unsupported dose is replaced by one safe line. Route words (IV, IM, rectal)
are not checked here.

DRUG BINDING (v3, nearest-drug ownership). Drug names come from the CURATED medicine list in drug_lexicon.json
("drugs": groups of generic names, the manual's misspellings, Pijin spellings and brands, e.g. Augmentin = amoxicillin-
clavulanate, Tylenol = paracetamol; built by pipeline/build_drug_lexicon.py). A word matches a name exactly, or one
edit away (insert/delete/substitute) when the name has 7+ letters; multi-word names match as consecutive words. A word
that is not a curated name but ends in a drug suffix (-cillin, -mycin, -azole, -olac, -profen, ...; 6+ letters) is an
UNKNOWN DRUG, and so is a word one edit from two different medicines.
  Excerpt: every dose on the page is OWNED by the nearest drug name before it (across line breaks), else by the first
  drug name starting within 60 characters after it, else by nobody. Dense table rows and sub-rows under one drug
  heading are handled by this: in 'Ampicillin 50mg/kg ... PLUS Gentamicin ... 3mg/kg ... 7.5mg/kg' 50 mg/kg is
  ampicillin's and 7.5 mg/kg gentamicin's.
  Reply: a dose's drug is the nearest drug name to its left in the same sentence (. ! ? ; end it), else the first one
  to its right in the same sentence starting within 30 characters. A left drug already bound to an earlier dose on the
  line gives way to a right drug starting within 8 characters ('paracetamol 15 mg/kg and 500 mg morphine').
  With a drug, only excerpt doses OWNED by that drug (or a synonym) count for (a) and (b) above, so a weight-computed
  amount must come from that drug's per-kg dose; an unknown drug, or a drug that owns no matching dose, is unsupported.
  Without a drug, (a) and (b) apply to every excerpt dose, but the excerpt doses that support the value must be owned
  by at most one drug: '0.3 mg/kg' on a page where both midazolam and diazepam own 0.3 mg/kg is ambiguous, unsupported.
Distances are measured on text after NFKC, zero-width removal, whitespace runs collapsed to one space and astral
characters counted as one, so the app and the bridge measure the same characters.
"""

from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path

# ASCII digits only (JS \d is ASCII). "1,000" is thousands; "12,5" is a decimal comma; ".5" is 0.5.
_NUM = r"[0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?|[0-9]+(?:[.,][0-9]+)?|\.[0-9]+"
DOSE_RE = re.compile(
    # "2x250mg": a digit + x/× before the number also starts a dose. Range dashes: - ‐ ‑ ‒ – — ― − and "to".
    rf"(^|[^A-Za-z0-9_.]|[0-9][xX×])({_NUM})(?:\s*(?:[-\u2010-\u2015\u2212]|to)\s*({_NUM}))?\s*"
    r"(mgs?|milligram(?:me)?s?|mcgs?|[µμ]g|microgram(?:me)?s?|g|gms?|gram(?:me)?s?|mls?|millilit(?:re|er)s?|iu|units?)"
    # per-kg: "/kg", "per kg", Pijin "fo evri kilo" / "long wan kilo", "every kg"
    r"(\s*(?:/|per\b|(?:fo|for|long|lo)\s+(?:evri|every|each|wan|one|1)\b|(?:evri|every|each)\b)\s*(?:kg|kilograms?|kilos?)(?![A-Za-z]))?(?![A-Za-z])",
    re.I,
)
WEIGHT_RE = re.compile(r"(^|[^A-Za-z0-9_.])([0-9]+(?:\.[0-9]+)?)\s*(?:kgs?|kilos?|kilograms?)(?![A-Za-z])", re.I)
WEIGHT2_RE = re.compile(r"\bweigh(?:t|s|ing)?\s*(?:is|of|=|:)?\s*([0-9]+(?:\.[0-9]+)?)", re.I)
_INVISIBLE = re.compile("[\u00ad\u200b-\u200d\u2060\ufeff]")
_PY_ONLY_WS = re.compile("[\x1c-\x1f\x85]")


def _clean(s: str) -> str:
    """NFKC (fullwidth digits, NBSP/thin spaces, Kelvin sign, micro sign) and drop zero-width characters,
    so a zero-width space inside "50 mg/kg" or fullwidth digits cannot hide a dose, and the app and bridge
    read the same text."""
    # U+001C-001F and U+0085 are whitespace to Python's \s but not to JS's, so both sides turn them into a plain space.
    return _PY_ONLY_WS.sub(" ", _INVISIBLE.sub("", unicodedata.normalize("NFKC", s or "")))


ABSOLUTE = {"mg", "mcg", "g", "ml"}
TOL = 0.15
EPS = 1e-9


@dataclass
class Dose:
    text: str  # as written in the reply
    lo: float
    hi: float
    unit: str  # normalised: mg, mcg, g, ml, iu, units, each optionally with "/kg"


def _num(s: str) -> float:
    if re.fullmatch(r"[0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?", s):
        return float(s.replace(",", ""))
    return float(s.replace(",", "."))


def _norm_unit(u: str, per_kg: bool) -> str:
    b = u.lower()
    if b in ("µg", "μg", "mcgs") or b.startswith("microgram"):
        b = "mcg"
    elif b == "mgs" or b.startswith("milligram"):
        b = "mg"
    elif b in ("gm", "gms") or b.startswith("gram"):
        b = "g"
    elif b == "mls" or b.startswith("millilit"):
        b = "ml"
    elif b == "unit":
        b = "units"
    return f"{b}/kg" if per_kg else b


def extract_doses(text: str) -> list[Dose]:
    out: list[Dose] = []
    for m in DOSE_RE.finditer(_clean(text)):
        unit = _norm_unit(m.group(4), bool(m.group(5)))
        if unit == "units":  # bare "units" is not a dose unit here; units/kg is
            continue
        a = _num(m.group(2))
        b = _num(m.group(3)) if m.group(3) is not None else a
        out.append(Dose(text=m.group(0)[len(m.group(1)):].strip(), lo=min(a, b), hi=max(a, b), unit=unit))
    return out


def extract_weights(message: str) -> list[float]:
    message = _clean(message)
    ws = [_num(m.group(2)) for m in WEIGHT_RE.finditer(message)]
    ws += [_num(m.group(1)) for m in WEIGHT2_RE.finditer(message)]
    return [w for w in ws if 0.5 < w < 150]


def _same(x: float, y: float) -> bool:
    return abs(x - y) < EPS


def _in_excerpt(v: float, unit: str, ex: list[Dose]) -> bool:
    return any(e.unit == unit and (_same(e.lo, v) or _same(e.hi, v)) for e in ex)


def _by_weight(v: float, unit: str, ex: list[Dose], weights: list[float]) -> bool:
    if _in_excerpt(v, unit, ex):
        return True
    for w in weights:
        for e in ex:
            if e.unit != f"{unit}/kg":
                continue
            if e.lo * w * (1 - TOL) - EPS <= v <= e.hi * w * (1 + TOL) + EPS:
                return True
    return False


# ---- drug binding (v3: nearest-drug ownership) --------------------------------------------------------------------
_LEX = json.loads((Path(__file__).with_name("drug_lexicon.json")).read_text(encoding="utf-8"))
_TOK = re.compile(r"[A-Za-z]+|[0-9]+(?:[.,][0-9]+)*|[.!?;](?![0-9])")
_WS = re.compile(r"[ \t\n\r\f\v]+")
_ASTRAL = re.compile("[\U00010000-\U0010FFFF]")
WIN_AFTER = 60  # an excerpt dose with no drug before it is owned by a drug starting at most this far after it
REPLY_RIGHT = 30  # a reply dose with no drug on its left binds to a drug starting at most this far to its right
CLAIMED_GAP = 8  # " of the " : how far right of a dose a drug may start when the left drug is another dose's
FUZZY_MIN = 7  # names this long match a word one edit (insert/delete/substitute) away
UNKNOWN_MIN = 6
SUFFIXES = tuple(_LEX.get("unknown_suffixes", []))
NOT_DRUGS = frozenset(_LEX.get("not_drugs", []))


def _words(s: str) -> list[str]:
    return [w.lower() for w in re.findall(r"[A-Za-z]+", s)]


NAMES: dict[str, str] = {}  # curated name (space-joined lowercase words) -> canonical name of its medicine
for _g in _LEX.get("drugs", []):
    for _m in _g:
        NAMES[" ".join(_words(_m))] = " ".join(_words(_g[0]))
_PHRASES = sorted({k for k in NAMES if " " in k}, key=lambda k: (-len(k.split(" ")), k))  # longest first
_FUZZY = sorted(k for k in NAMES if " " not in k and len(k) >= FUZZY_MIN)


def _edit1(a: str, b: str) -> bool:
    """True when a and b differ by exactly one insert, delete or substitute."""
    la, lb = len(a), len(b)
    if la == lb:
        return sum(x != y for x, y in zip(a, b)) == 1
    if abs(la - lb) != 1:
        return False
    if la > lb:
        a, b, la, lb = b, a, lb, la
    i = 0
    while i < la and a[i] == b[i]:
        i += 1
    return a[i:] == b[i + 1:]


_IDENT: dict[str, str | None] = {}


def _ident(w: str) -> str | None:
    """Medicine identity of one lowercase word: its canonical name (exact, or one edit from a 7+ letter name), "?word"
    for an UNKNOWN DRUG (one edit from two different medicines, or a drug suffix and 6+ letters), else None."""
    if w in _IDENT:
        return _IDENT[w]
    r = NAMES.get(w)
    if r is None and len(w) >= FUZZY_MIN - 1:
        near = sorted({NAMES[n] for n in _FUZZY if abs(len(n) - len(w)) <= 1 and _edit1(w, n)})
        r = near[0] if len(near) == 1 else ("?" + w if near else None)
    if r is None and len(w) >= UNKNOWN_MIN and w not in NOT_DRUGS and w.endswith(SUFFIXES):
        r = "?" + w
    _IDENT[w] = r
    return r


def _bind_text(s: str) -> str:
    """Text distances are measured on: the guard's normalisation, whitespace runs -> one space, astral chars -> one char."""
    return _WS.sub(" ", _ASTRAL.sub("\ufffd", _clean(s)))


@dataclass
class _Tok:
    kind: str  # w (word), n (number), b (sentence boundary)
    low: str
    start: int
    end: int


def _tokens(s: str) -> list[_Tok]:
    out = []
    for m in _TOK.finditer(s):
        t = m.group()
        kind = "w" if t[0].isalpha() else ("n" if t[0].isdigit() else "b")
        out.append(_Tok(kind, t.lower(), m.start(), m.end()))
    return out


@dataclass
class _Drug:
    ident: str  # canonical name, or "?word" for an unknown drug
    start: int
    end: int


def _drugs(toks: list[_Tok]) -> list[_Drug]:
    """Every drug name in a token list, left to right; a multi-word name (consecutive words) wins over its first word."""
    out: list[_Drug] = []
    i = 0
    while i < len(toks):
        t = toks[i]
        if t.kind != "w":
            i += 1
            continue
        hit = None
        for ph in _PHRASES:
            parts = ph.split(" ")
            k = len(parts)
            if i + k <= len(toks) and all(toks[i + j].kind == "w" and toks[i + j].low == parts[j] for j in range(k)):
                hit = _Drug(NAMES[ph], t.start, toks[i + k - 1].end)
                i += k
                break
        if hit is None:
            ident = _ident(t.low)
            i += 1
            if ident is None:
                continue
            hit = _Drug(ident, t.start, t.end)
        out.append(hit)
    return out


def _dose_spans(s: str) -> list[tuple[Dose, int, int]]:
    """Doses in already bind-normalised text with (number start, dose end)."""
    out = []
    for m in DOSE_RE.finditer(s):
        unit = _norm_unit(m.group(4), bool(m.group(5)))
        if unit == "units":
            continue
        a = _num(m.group(2))
        b = _num(m.group(3)) if m.group(3) is not None else a
        out.append((Dose(text=m.group(0)[len(m.group(1)):].strip(), lo=min(a, b), hi=max(a, b), unit=unit), m.start(2), m.end()))
    return out


def excerpt_owners(excerpt: str) -> list[tuple[Dose, str | None]]:
    """Every dose in the excerpt with its OWNER: the nearest drug name before it (across line breaks; the nearest one
    is by definition not past another drug name), else the nearest drug starting within WIN_AFTER chars after it,
    else None."""
    bex = _bind_text(excerpt)
    drugs = _drugs(_tokens(bex))
    out = []
    for d, s, e in _dose_spans(bex):
        before = [g for g in drugs if g.end <= s]
        if before:
            owner = before[-1].ident
        else:
            owner = next((g.ident for g in drugs if g.start >= e and g.start - e <= WIN_AFTER), None)
        out.append((d, owner))
    return out


def _bind(toks: list[_Tok], drugs: list[_Drug], start: int, end: int, claimed) -> _Drug | None:
    """The drug of the reply dose at [start, end): the nearest drug name to its left in the same sentence, else the
    first one to its right in the same sentence starting within REPLY_RIGHT chars. A left drug already bound to an
    earlier dose on the line (start in ``claimed``) gives way to a right drug starting within CLAIMED_GAP chars:
    "paracetamol 15 mg/kg and 500 mg morphine" binds 500 mg to morphine, "diazepam 0.3 mg/kg (max 10 mg)" keeps
    diazepam."""
    stops = [t.start for t in toks if t.kind == "b"]
    left = None
    for g in drugs:
        if g.end <= start and not any(g.end <= b < start for b in stops):
            left = g
    right = None
    for g in drugs:
        if g.start >= end:
            if g.start - end <= REPLY_RIGHT and not any(end <= b < g.start for b in stops):
                right = g
            break
    if left is None:
        return right
    if left.start in claimed and right is not None and right.start - end <= CLAIMED_GAP:
        return right
    return left


def drug_word(line: str, start: int, end: int, claimed: set[int] | frozenset[int] = frozenset()) -> str | None:
    """The drug identity for the dose at [start, end) of a bind-normalised reply line (None when there is none)."""
    toks = _tokens(line)
    g = _bind(toks, _drugs(toks), start, end, claimed)
    return g.ident if g else None


def _supported(d: Dose, occ: list[tuple[Dose, str | None]], weights: list[float], drug: str | None) -> bool:
    """With a drug: only excerpt doses OWNED by that drug count (unknown drugs own nothing on a page they are not on).
    Without one: every excerpt dose counts, but the doses that support the value must be owned by at most one drug."""
    pool = [o for o in occ if o[1] == drug] if drug is not None else occ

    def ok(hits) -> bool:
        return bool(hits) and (drug is not None or len({o for _, o in hits if o is not None}) <= 1)

    def exact(v: float, unit: str):
        return [h for h in pool if h[0].unit == unit and (_same(h[0].lo, v) or _same(h[0].hi, v))]

    abs_w = d.unit in ABSOLUTE and bool(weights)

    def by_weight(v: float):
        hits = exact(v, d.unit)
        for w in weights:
            for h in pool:
                e = h[0]
                if e.unit == f"{d.unit}/kg" and e.lo * w * (1 - TOL) - EPS <= v <= e.hi * w * (1 + TOL) + EPS:
                    hits.append(h)
        return hits

    # The top of a range must be on the page. Without a drug, a per-kg dose x weight that also gives the top counts
    # toward ambiguity: '600 mg' for 10 kg is rifampicin's max AND benzylpenicillin 60 mg/kg x 10 kg.
    if ok(exact(d.hi, d.unit)) and (drug is not None or not abs_w or ok(by_weight(d.hi))):
        return True
    if abs_w:
        return all(ok(by_weight(v)) for v in (d.lo, d.hi))
    return False


def dose_supported(d: Dose, ex: list[Dose], weights: list[float]) -> bool:
    if _in_excerpt(d.hi, d.unit, ex):  # the top of a range must be on the page
        return True
    if d.unit in ABSOLUTE and weights:
        return all(_by_weight(v, d.unit, ex, weights) for v in (d.lo, d.hi))
    return False


def safe_dose_line(lang: str, page: int | None, has_excerpt: bool) -> str:
    pis = lang == "pis"
    if has_excerpt and page is not None:
        return (
            f"Dos: lukim buk STM pej {page} fastaem. Mi no faendem dos ya long pej mi iusim."
            if pis
            else f"Dose: check the manual page {page} before giving it. I could not find this dose in the page I used."
        )
    return "Dos: askem nes long jaj o dokta." if pis else "Dose: ask the nurse in charge or the doctor."


def guard_doses(body: str, excerpt_text: str | None, nurse_message: str, page: int | None, lang: str) -> tuple[str, list[str]]:
    """Return (new body, unsupported dose expressions). The body is unchanged when every dose is supported."""
    excerpt = (excerpt_text or "").strip()
    occ = excerpt_owners(excerpt) if excerpt else []
    weights = extract_weights(nurse_message or "")
    safe = safe_dose_line(lang, page, bool(excerpt))
    unsupported: list[str] = []
    lines: list[str] = []
    safe_added = False
    for line in (body or "").split("\n"):
        ds = extract_doses(line)
        bl = _bind_text(line)
        spans = _dose_spans(bl)
        toks = _tokens(bl)
        drugs = _drugs(toks)
        bad = []
        claimed: set[int] = set()  # start offsets of drug names already bound to an earlier dose on this line
        for i, d in enumerate(ds):
            g = _bind(toks, drugs, spans[i][1], spans[i][2], claimed) if len(spans) == len(ds) else None
            if g:
                claimed.add(g.start)
            if not _supported(d, occ, weights, g.ident if g else None):
                bad.append(d)
        if not bad:
            lines.append(line)
            continue
        unsupported += [d.text for d in bad]
        if not safe_added:
            lines.append(safe)
            safe_added = True
    return ("\n".join(lines) if unsupported else body), unsupported


# Same name as the app (guardDoses) for readers moving between the two.
guardDoses = guard_doses
