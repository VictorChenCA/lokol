"""Corpus loader for the bridge.

Preferred source: ``corpus/stm_children_chunks.jsonl`` (DATA lane, SPEC §1). Fallback: chunk the
raw pdftotext dump of the STM for Children per page in ``bridge/corpus.py`` so the bridge works
before the DATA lane lands. Chunk objects follow the SPEC §1 shape::

    {"id": "stm-c-053-malaria-01", "section": "MALARIA", "subsection": "...", "page": 53, "text": "...", "tokens": 312}
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Iterable

from .config import settings

# Section titles as printed in the manual's table of contents (pages 4-6). Used to canonicalise
# headings detected in the page text. The DATA lane's corpus/sections.json wins when present.
KNOWN_SECTIONS: list[str] = [
    "INTRODUCTION",
    "PAEDIATRIC RULES",
    "THE 10-STEP CHECKLIST FOR CHILDREN",
    "THE 7-STEP CHECKLIST FOR YOUNG INFANTS",
    "ADVICE FOR TRANSFERING PATIENTS",
    "PAEDIATRIC PHARMACY ADVICE",
    "ANAEMIA",
    "ASTHMA",
    "BLOOD TRANSFUSION",
    "BREAST FEEDING",
    "BURNS",
    "CONVULSIONS",
    "DEHYDRATION",
    "DENGUE",
    "DIABETES",
    "DIARRHOEA",
    "EYE CONDITIONS",
    "FEVER",
    "GLOMUERLONEPHRITIS",
    "GLOMERULONEPHRITIS",
    "HIV INFECTION",
    "HYPOGLYCAEMIA",
    "IMMUNISATION",
    "SOLOMON ISLANDS IMMUNISATION SCHEDULE",
    "INTRAVENOUS FLUIDS",
    "LYMPHADENOPATHY",
    "MALARIA",
    "MALNUTRITION",
    "MEASLES",
    "MENINGITIS",
    "EARLY ESSENTIAL NEWBORN CARE",
    "NEWBORN BABIES- INTRAVENOUS FLUIDS",
    "NEWBORN BABIES LESS THAN 2.5 KG WEIGHT",
    "NEWBORN BABIES – HYPOGLYCAEMIA",
    "NEWBORN BABIES – NEONATAL INFECTIONS",
    "NEWBORN BABIES- JAUNDICE",
    "RESUSCITATION OF NEWBORN BABIES",
    "NEWBORN BABIES – DRUG DOSES: FOR BABIES LESS THAN 4 WEEKS",
    "OEDEMA",
    "OSTEOMYELITIS, SEPTIC ARTHRITIS, PYOMYOSITIS",
    "OTITIS MEDIA – ACUTE & CHRONIC",
    "PERTUSSIS (WHOOPING COUGH)",
    "PNEUMONIA",
    "POISONING",
    "RESUSCITATION OF CHILDREN",
    "RHEUMATIC FEVER",
    "SEXUALLY TRANSMITTED (& CONGENITAL) INFECTIONS",
    "SKIN DISEASES",
    "SURGICAL PROBLEMS",
    "TUBERCULOSIS",
    "HOW TO USE THE TB SCORE CHART",
    "PAEDIATRIC TUBERCULOSIS SCORE CHART",
    "URINARY TRACT INFECTION",
    "WORM & OTHER PARASITIC INFECTIONS",
    "PAEDIATRIC DRUG DOSES",
    "DRUG DOSING TABLE",
    "REFERENCES",
    "USEFUL RESOURCES",
    "NEONATAL RESUSCITATION: FLOW CHART",
]

# Upper-case lines that are sub-headings or layout, never section titles.
_NOT_SECTIONS = {
    "SIGNS & SYMPTOMS", "SIGNS AND SYMPTOMS", "MANAGEMENT", "TREATMENT", "DIFFERENTIALS",
    "SUGGESTIVE FEATURES", "SUGGESTED INVESTIGATIONS", "CONTENTS", "NOTES", "NOTE", "INVESTIGATIONS",
    "DIAGNOSIS", "ASSESSMENT", "CAUSES", "PREVENTION", "REFERRAL", "FOLLOW UP", "FOLLOW-UP",
    "COMPLICATIONS", "DEFINITION", "HISTORY", "EXAMINATION", "ACKNOWLEDGEMENTS", "PREFACE",
    "FOREWORD", "ABBREVIATIONS", "CONTACT DIRECTORY", "STANDARD TREATMENT MANUAL FOR CHILDREN",
    "DRUG", "DOSE", "ROUTE", "FREQUENCY", "DURATION", "AGE", "WEIGHT", "IMPORTANT", "WARNING",
    "DANGER SIGNS", "GENERAL", "SEVERE", "MILD", "MODERATE", "ANTIBIOTICS", "FLUIDS",
}

_RUNNING_FOOTER = re.compile(r"^\s*(\d{1,3}\s+)?4th Edition 2017\s*$", re.I)
_RUNNING_HEADER = re.compile(r"^\s*Standard Treatment Manual for Children(\s+\d{1,3})?\s*$", re.I)
_PAGE_NUM_LINE = re.compile(r"^\s*(\d{1,3})\s*$")


@dataclass
class Chunk:
    id: str
    section: str
    subsection: str
    page: int
    text: str
    tokens: int

    def to_dict(self) -> dict:
        return asdict(self)


def _norm_title(s: str) -> str:
    s = s.upper().replace("–", "-").replace("—", "-").replace("&", "AND")
    s = re.sub(r"[^A-Z0-9 ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


_KNOWN_BY_NORM = {_norm_title(t): t for t in KNOWN_SECTIONS}


def _slug(s: str, n: int = 24) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return s[:n].rstrip("-") or "section"


def _clean_page(raw: str) -> tuple[list[str], int | None]:
    """Strip running headers/footers; return (lines, printed page number if found)."""
    printed: int | None = None
    lines: list[str] = []
    for ln in raw.splitlines():
        if _RUNNING_FOOTER.match(ln):
            m = re.match(r"^\s*(\d{1,3})", ln)
            if m:
                printed = int(m.group(1))
            continue
        if _RUNNING_HEADER.match(ln):
            m = re.search(r"(\d{1,3})\s*$", ln)
            if m:
                printed = int(m.group(1))
            continue
        m = _PAGE_NUM_LINE.match(ln)
        if m and not lines:
            printed = int(m.group(1))
            continue
        lines.append(ln.rstrip())
    return lines, printed


def _detect_heading(lines: list[str]) -> str | None:
    """A centred ALL-CAPS line among the first non-empty lines of a page is a section title."""
    seen = 0
    for ln in lines:
        if not ln.strip():
            continue
        seen += 1
        if seen > 4:
            break
        stripped = ln.strip()
        indent = len(ln) - len(ln.lstrip())
        if len(stripped) < 4 or len(stripped) > 70:
            continue
        if stripped != stripped.upper() or not re.search(r"[A-Z]{4,}", stripped):
            continue
        norm = _norm_title(stripped)
        if norm in _KNOWN_BY_NORM:
            return _KNOWN_BY_NORM[norm]
        if indent < 8 or norm in {_norm_title(x) for x in _NOT_SECTIONS}:
            continue
        if re.search(r"\d{2,}", stripped):  # dose tables, not titles
            continue
        return stripped
    return None


def _words(text: str) -> int:
    return len(text.split())


def _split_long(text: str, max_words: int = 400) -> list[str]:
    if _words(text) <= max_words:
        return [text]
    paras = [p for p in re.split(r"\n\s*\n", text) if p.strip()]
    parts: list[str] = []
    cur: list[str] = []
    n = 0
    for p in paras:
        w = _words(p)
        if cur and n + w > max_words:
            parts.append("\n\n".join(cur))
            cur, n = [], 0
        cur.append(p)
        n += w
    if cur:
        parts.append("\n\n".join(cur))
    return parts


def chunk_raw_text(raw_path: Path | None = None) -> list[Chunk]:
    """Fallback chunker: one chunk per page (long pages split), section carried forward."""
    raw_path = raw_path or settings.raw_txt
    text = raw_path.read_text(encoding="utf-8", errors="replace")
    pages = text.split("\f")
    chunks: list[Chunk] = []
    section = "INTRODUCTION"
    for idx, raw in enumerate(pages):
        pdf_page = idx + 1
        if pdf_page < 8:  # cover, acknowledgements, preface, contents
            continue
        lines, printed = _clean_page(raw)
        heading = _detect_heading(lines)
        if heading:
            section = heading
        body = "\n".join(ln for ln in lines).strip()
        body = re.sub(r"[ \t]{3,}", "  ", body)  # collapse column padding, keep table-ish spacing
        body = re.sub(r"\n{3,}", "\n\n", body)
        if _words(body) < 25:
            continue
        page = printed if printed else pdf_page
        for n, part in enumerate(_split_long(body), start=1):
            sub = ""
            m = re.search(r"^\s*([A-Z][A-Z &/\-]{3,40})\s*$", part, re.M)
            if m and _norm_title(m.group(1)) != _norm_title(section):
                sub = m.group(1).strip().title()
            chunks.append(
                Chunk(
                    id=f"stm-c-{page:03d}-{_slug(section)}-{n:02d}",
                    section=section,
                    subsection=sub,
                    page=page,
                    text=part,
                    tokens=int(_words(part) * 1.4),
                )
            )
    return chunks


def load_chunks_jsonl(path: Path) -> list[Chunk]:
    out: list[Chunk] = []
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            d = json.loads(line)
            out.append(
                Chunk(
                    id=str(d.get("id") or f"chunk-{len(out):04d}"),
                    section=str(d.get("section") or "UNKNOWN"),
                    subsection=str(d.get("subsection") or ""),
                    page=int(d.get("page") or d.get("page_start") or 0),
                    text=str(d.get("text") or ""),
                    tokens=int(d.get("tokens") or _words(str(d.get("text") or "")) * 1.4),
                )
            )
    return out


def load_sections(chunks: Iterable[Chunk]) -> list[str]:
    """Ordered unique section titles: corpus/sections.json if present, else derived from chunks."""
    titles: list[str] = []
    if settings.sections_json.exists():
        try:
            data = json.loads(settings.sections_json.read_text(encoding="utf-8"))
            for item in data:
                t = item.get("title") if isinstance(item, dict) else item
                if isinstance(t, str) and t and t not in titles:
                    titles.append(t)
        except Exception:
            titles = []
    if not titles:
        for c in chunks:
            if c.section not in titles:
                titles.append(c.section)
    return titles


def load_corpus() -> tuple[list[Chunk], list[str], str]:
    """Return (chunks, section_titles, source) where source is 'jsonl' or 'raw'."""
    if settings.corpus_jsonl.exists():
        chunks = load_chunks_jsonl(settings.corpus_jsonl)
        if chunks:
            return chunks, load_sections(chunks), "jsonl"
    if settings.raw_txt.exists():
        chunks = chunk_raw_text(settings.raw_txt)
        return chunks, load_sections(chunks), "raw"
    return [], [], "none"


if __name__ == "__main__":  # quick inspection
    cs, secs, src = load_corpus()
    print(f"source={src} chunks={len(cs)} sections={len(secs)}")
    for s in secs:
        print(" -", s)
    for c in cs[:3]:
        print(json.dumps(c.to_dict())[:300])
