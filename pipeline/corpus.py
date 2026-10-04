#!/usr/bin/env python
"""Chunk the Solomon Islands Standard Treatment Manual for Children (2017) into
retrieval/training chunks.

Input : data/raw/SI_Standard_Treatment_Manual_for_Children_2017.txt
        (pdftotext -layout output, pages separated by form feeds, 125 pages)
Output: corpus/stm_children_chunks.jsonl   one object per chunk
        corpus/sections.json               ordered list of {title, page_start, page_end}

Section detection:
  1. The table of contents (PDF pages 6-8) is parsed for dotted lines
     "TITLE.......... 53".  Page 6 is interleaved by pdftotext so many of its
     lines do not parse.
  2. Fallback: every page whose first non-blank line is an ALL-CAPS, centred
     heading (indent >= 10) starts a new section, unless the line is a known
     sub-heading (MANAGEMENT, CLASSIFICATION, USING A SPACER ...).
  Printed page numbers are used everywhere (PDF page = printed page + 2).

Usage: .venv/bin/python pipeline/corpus.py [--no-tokenizer]
"""
from __future__ import annotations

import argparse
import difflib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data/raw/SI_Standard_Treatment_Manual_for_Children_2017.txt"
OUT_CHUNKS = ROOT / "corpus/stm_children_chunks.jsonl"
OUT_SECTIONS = ROOT / "corpus/sections.json"

PRINTED_OFFSET = 2  # PDF page index (1-based) = printed page + 2

# Front/back matter that is not clinical guidance.
SKIP_SECTIONS = {
    "CONTACT DIRECTORY", "ACKNOWLEDGEMENTS", "PREFACE", "CONTENTS", "ABBREVIATIONS",
    "REFERENCES", "USEFUL RESOURCES", "NEONATAL RESUSCITATION: FLOW CHART",
}
# ALL-CAPS centred lines that are sub-headings, never sections.
SUBHEADING_BLOCKLIST = (
    "MANAGEMENT", "CLASSIFICATION", "SIGNS", "INVESTIGATION", "TREATMENT",
    "USING A SPACER", "ASTHMA MANAGEMENT PLAN", "MEDICATIONS", "RE-FEEDING",
    "AIRWAY", "CHLAMYDIA", "DILUTION OF INJECTIONS", "WHITE", "NEONATAL MENINGITIS",
    "BAKUA", "B:", "A:",
)
NOT_SUBHEADINGS = {"PLUS", "AND/OR", "NOTE", "OR", "THEN", "TOTAL"}
TITLE_FIXES = {
    "GLOMUERLONEPHRITIS": "GLOMERULONEPHRITIS",
    "GLOMURULONEPHRITIS": "GLOMERULONEPHRITIS",
}

RUNNING_HEADER_RES = [
    re.compile(r"^\s*Standard Treatment Manual for Children\s*\d*\s*$"),
    re.compile(r"^\s*\d*\s*4th Edition\s*2017\s*$"),
    re.compile(r"^\s*\d{1,3}\s*$"),
]
TOC_LINE_RE = re.compile(r"^\s*([A-Z][A-Z0-9 ,&()/–\-:.']{3,}?)\s*\.{3,}\s*(\d{1,3})\s*$")

CHAR_MAP = {
    "": "-",   # bullet
    "": "  -",  # arrow sub-bullet
    "": "  -",  # square sub-bullet
    "": "-",    # tick
    "�": " ",    # NBSP mangled in tables
    "•": "-",
    " ": " ",
    "–": "-",
    "’": "'",
    "‘": "'",
    "“": '"',
    "”": '"',
}


def norm_title(s: str) -> str:
    s = TITLE_FIXES.get(s.strip(), s)
    s = re.sub(r"\s+", " ", s.strip())
    s = s.replace("–", "-").replace(" - ", " - ")
    return s


def is_caps_heading(line: str) -> bool:
    s = line.strip()
    if not s or len(s) > 75:
        return False
    letters = [c for c in s if c.isalpha()]
    if len(letters) < 4:
        return False
    if s != s.upper():
        return False
    if re.search(r"\S {3,}\S", s):  # multi-column table row
        return False
    if re.search(r"\d\s*(mg|ml|kg|g)\b", s, re.I):
        return False
    return True


def clean_line(line: str) -> str:
    for k, v in CHAR_MAP.items():
        line = line.replace(k, v)
    line = line.rstrip()
    lead = len(line) - len(line.lstrip(" "))
    # collapse huge internal column gaps but keep the indentation (used for heading detection)
    body = re.sub(r" {4,}", "   ", line[lead:])
    return " " * min(lead, 60) + body


# PDF pages whose -layout text is interleaved (the PDF carries two overlapping text layers on the
# CONVULSIONS pages).  When pdftotext and the PDF are available these pages are re-extracted in
# -raw mode and truncated at the second copy of the page; otherwise the layout text is kept.
GARBLED_PDF_PAGES = {36, 37}
PDF = RAW.with_suffix(".pdf")


def reextract_raw_page(pdf_page: int) -> list[str] | None:
    import shutil
    import subprocess
    if not PDF.exists() or not shutil.which("pdftotext"):
        return None
    try:
        out = subprocess.run(["pdftotext", "-f", str(pdf_page), "-l", str(pdf_page), "-raw", str(PDF), "-"],
                             capture_output=True, text=True, timeout=30).stdout
    except Exception:  # noqa: BLE001
        return None
    lines = out.replace("\f", "").split("\n")
    norm = [re.sub(r"\s+", "", l).lower() for l in lines]
    # the second text layer starts where a pair of long lines repeats an earlier pair
    seen: dict[str, int] = {}
    cut = None
    for k, n in enumerate(norm):
        if len(n) < 12:
            continue
        if n in seen:
            j = seen[n]
            nxt_k = next((x for x in norm[k + 1:k + 4] if len(x) >= 12), None)
            nxt_j = next((x for x in norm[j + 1:j + 4] if len(x) >= 12), None)
            if nxt_k is None or nxt_k == nxt_j:
                cut = k
                break
        else:
            seen[n] = k
    if cut is not None:
        lines = lines[:cut]
    while lines and (not lines[-1].strip() or (lines[-1].strip() == lines[-1].strip().upper()
                                               and sum(c.isalpha() for c in lines[-1]) >= 4)):
        lines.pop()  # drop a trailing bare heading that belongs to the duplicate layer
    first = next((k for k, l in enumerate(lines) if l.strip() and l.strip() == l.strip().upper()
                  and sum(c.isalpha() for c in l) >= 4), None)
    if first is not None and lines[first].strip() in ("CONVULSIONS",):
        lines[first] = " " * 30 + lines[first].strip()  # centre the section heading so detection works
    return [l for l in lines if not re.fullmatch(r"\s*(4th|Edition 2017 \d+|\d+)\s*", l)]


def load_pages() -> list[list[str]]:
    text = RAW.read_text(encoding="utf-8", errors="replace")
    text = re.sub(r"\s2017to\s", " to ", text)  # mangled footer inside a sentence (p56)
    pages = text.split("\f")
    out = []
    recent: list[str] = []
    for pno, p in enumerate(pages, 1):
        src_lines = p.split("\n")
        if pno in GARBLED_PDF_PAGES:
            fixed = reextract_raw_page(pno)
            if fixed:
                src_lines = fixed
        lines = []
        for raw in src_lines:
            if any(r.match(raw) for r in RUNNING_HEADER_RES):
                continue
            raw = re.sub(r"^\s*\d{1,3}\s+4th Edition\s*$", "", raw)
            key = re.sub(r"\s+", " ", raw.strip())
            if len(key) >= 25 and key in recent:  # pdftotext duplicated a block across the page break
                continue
            if len(key) >= 25:
                recent.append(key)
                recent = recent[-40:]
            lines.append(clean_line(raw))
        out.append(lines)
    return out


def parse_toc(pages: list[list[str]]) -> list[tuple[str, int]]:
    toc = []
    for i in range(5, 8):  # PDF pages 6-8
        for line in pages[i]:
            m = TOC_LINE_RE.match(line)
            if m:
                toc.append((norm_title(m.group(1)), int(m.group(2))))
    return toc


def match_toc(title: str, toc_titles: list[str]) -> str | None:
    t = norm_title(title)
    if t in toc_titles:
        return t
    best = difflib.get_close_matches(t, toc_titles, n=1, cutoff=0.82)
    if best:
        return best[0]
    # prefix match (CONJUNCTIVITIS, ORBITAL CELLULITIS vs ... (PRE-SEPTAL & SEPTAL))
    for cand in toc_titles:
        if cand.startswith(t) and len(t) >= 12:
            return cand
    return None


def detect_sections(pages: list[list[str]]):
    toc = parse_toc(pages)
    toc_titles = [t for t, _ in toc]
    sections = []  # dicts: title, page_start(pdf idx 0-based), lines
    cur = None
    for idx in range(8, len(pages)):  # from PDF page 9 (ABBREVIATIONS) onwards
        lines = pages[idx]
        nonblank = [(k, l) for k, l in enumerate(lines) if l.strip()]
        if not nonblank:
            if cur:
                cur["lines"].extend(lines)
            continue
        k0, first = nonblank[0]
        indent = len(first) - len(first.lstrip())
        heading = None
        stripped = first.strip()
        if stripped == stripped.upper() and sum(c.isalpha() for c in stripped) >= 4:
            m = match_toc(first, toc_titles)
            blocked = any(stripped.startswith(b) for b in SUBHEADING_BLOCKLIST)
            if m and not blocked:
                heading = m  # TOC title (exact or fuzzy)
            elif is_caps_heading(first) and indent >= 10 and not blocked:
                heading = norm_title(stripped)  # fallback: ALL-CAPS centred heading
        if heading:
            cur = {"title": heading, "page_start": idx + 1 - PRINTED_OFFSET,
                   "page_end": idx + 1 - PRINTED_OFFSET, "lines": lines[k0 + 1:]}
            sections.append(cur)
        elif cur:
            cur["page_end"] = idx + 1 - PRINTED_OFFSET
            cur["lines"].append("")
            cur["lines"].extend(lines)
    return sections


def split_subsections(lines: list[str]) -> list[tuple[str | None, list[str]]]:
    """Split a section's lines at ALL-CAPS sub-headings."""
    blocks: list[tuple[str | None, list[str]]] = [(None, [])]
    for l in lines:
        s = l.strip()
        if (is_caps_heading(s) and len(s.split()) <= 9 and not s.endswith(("mg", "ml"))
                and sum(c.isalpha() for c in s) >= 5 and s.rstrip(":") not in NOT_SUBHEADINGS):
            blocks.append((s.rstrip(":"), []))
        else:
            blocks[-1][1].append(l)
    return [(h, b) for h, b in blocks if any(x.strip() for x in b) or h]


def tidy(block: list[str]) -> str:
    text = "\n".join(block)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip("\n")


def wc(text: str) -> int:
    return len(text.split())


def split_long(text: str, target: int = 320, hard: int = 420) -> list[str]:
    if wc(text) <= hard:
        return [text]
    paras = re.split(r"\n\s*\n", text)
    out, cur = [], ""
    for p in paras:
        cand = (cur + "\n\n" + p).strip() if cur else p
        if wc(cand) > target and cur:
            out.append(cur)
            cur = p
        else:
            cur = cand
    if cur:
        out.append(cur)
    # a single paragraph can still be enormous (tables): split by lines
    final = []
    for piece in out:
        if wc(piece) <= hard:
            final.append(piece)
            continue
        lines, buf = piece.split("\n"), []
        for l in lines:
            buf.append(l)
            if wc("\n".join(buf)) >= target:
                final.append("\n".join(buf))
                buf = []
        if buf:
            final.append("\n".join(buf))
    return final


def slug(s: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return s[:28].rstrip("-") or "x"


def build_chunks(sections, tokenizer=None):
    chunks = []
    for sec in sections:
        subs = [(h, tidy(b)) for h, b in split_subsections(sec["lines"])]
        # merge tiny subsections into the next one (label kept from the first)
        merged: list[tuple[str | None, str]] = []
        carry: tuple[str | None, str] | None = None
        for h, body in subs:
            if carry:
                ch, cb = carry
                body = (cb + "\n\n" + (f"{h}\n" if h else "") + body).strip()
                h = ch
                carry = None
            if wc(body) < 60:
                carry = (h, body)
                continue
            merged.append((h, body))
        if carry:
            ch, cb = carry
            if merged:
                h, body = merged[-1]
                merged[-1] = (h, body + "\n\n" + (f"{ch}\n" if ch else "") + cb)
            else:
                merged.append((ch, cb))
        # a short section stays one chunk
        total = sum(wc(t) for _, t in merged)
        if total <= 420 and len(merged) > 1:
            joined = "\n\n".join((f"{h}\n{t}" if h else t) for h, t in merged)
            merged = [(None, joined)]
        pieces: list[tuple[str, str]] = []
        for h, body in merged:
            for piece in split_long(body):
                if pieces and wc(piece) < 25:  # glue a tiny tail onto the previous piece
                    ph, pt = pieces[-1]
                    pieces[-1] = (ph, pt + "\n\n" + ((h + "\n") if h and h != ph else "") + piece)
                else:
                    pieces.append((h or "", piece))
        if len(pieces) > 1 and wc(pieces[0][1]) < 25:  # tiny head (e.g. a table header) joins the next piece
            h0, t0 = pieces.pop(0)
            h1, t1 = pieces[0]
            pieces[0] = (h0 or h1, t0 + "\n" + t1)
        # token-aware split: dense dose tables tokenize at ~2.5 tokens/word
        if tokenizer:
            def ntok(sub, body):
                return len(tokenizer((f"{sub}\n{body}" if sub else body)).input_ids)
            out_pieces = []
            for sub, body in pieces:
                stack = [body]
                while stack:
                    b = stack.pop(0)
                    if ntok(sub, b) <= 560 or b.count("\n") < 4:
                        out_pieces.append((sub, b))
                        continue
                    lines = b.split("\n")
                    mid = len(lines) // 2
                    cut = next((k for k in range(mid, len(lines) - 1) if not lines[k].strip()), mid)
                    stack = ["\n".join(lines[:cut]).strip("\n"), "\n".join(lines[cut:]).strip("\n")] + stack
            pieces = out_pieces
        n = 0
        for sub, piece in pieces:
            if True:
                n += 1
                text = f"{sub}\n{piece}" if sub else piece
                tokens = len(tokenizer(text).input_ids) if tokenizer else int(wc(text) * 1.45)
                chunks.append({
                    "id": f"stm-c-{sec['page_start']:03d}-{slug(sec['title'])}-{n:02d}",
                    "section": sec["title"],
                    "subsection": sub,
                    "page": sec["page_start"],
                    "page_end": sec["page_end"],
                    "text": text,
                    "tokens": tokens,
                })
    return chunks


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-tokenizer", action="store_true", help="estimate tokens instead of loading Qwen tokenizer")
    args = ap.parse_args()
    if not RAW.exists():
        sys.exit(f"missing {RAW}")
    pages = load_pages()
    sections = [s for s in detect_sections(pages) if s["title"] not in SKIP_SECTIONS]
    tokenizer = None
    if not args.no_tokenizer:
        try:
            from transformers import AutoTokenizer
            tokenizer = AutoTokenizer.from_pretrained("Qwen/Qwen3.5-0.8B")
        except Exception as e:  # noqa: BLE001
            print(f"[corpus] tokenizer unavailable ({e}); estimating tokens", file=sys.stderr)
    chunks = build_chunks(sections, tokenizer)
    OUT_CHUNKS.parent.mkdir(parents=True, exist_ok=True)
    with OUT_CHUNKS.open("w", encoding="utf-8") as f:
        for c in chunks:
            f.write(json.dumps(c, ensure_ascii=False) + "\n")
    OUT_SECTIONS.write_text(json.dumps(
        [{"title": s["title"], "page_start": s["page_start"], "page_end": s["page_end"],
          "chunks": sum(1 for c in chunks if c["section"] == s["title"])} for s in sections],
        indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    words = [wc(c["text"]) for c in chunks]
    print(f"[corpus] sections={len(sections)} chunks={len(chunks)} "
          f"words min/med/max={min(words)}/{sorted(words)[len(words)//2]}/{max(words)} "
          f"tokens max={max(c['tokens'] for c in chunks)}")
    for s in sections:
        print(f"  p{s['page_start']:3d}-{s['page_end']:3d}  {s['title']}")


if __name__ == "__main__":
    main()
