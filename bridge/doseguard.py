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
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

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


def _clean(s: str) -> str:
    """NFKC (fullwidth digits, NBSP/thin spaces, Kelvin sign, micro sign) and drop zero-width characters,
    so a zero-width space inside "50 mg/kg" or fullwidth digits cannot hide a dose, and the app and bridge
    read the same text."""
    return _INVISIBLE.sub("", unicodedata.normalize("NFKC", s or ""))


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
    ex = extract_doses(excerpt) if excerpt else []
    weights = extract_weights(nurse_message or "")
    safe = safe_dose_line(lang, page, bool(excerpt))
    unsupported: list[str] = []
    lines: list[str] = []
    safe_added = False
    for line in (body or "").split("\n"):
        bad = [d for d in extract_doses(line) if not dose_supported(d, ex, weights)]
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
