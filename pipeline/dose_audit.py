"""Dose audit: how often does a model write a dose that is not on the manual page it was given?

For each eval/*.json (stubs skipped), every prediction is matched to its data/synth/test.jsonl row. The user
turn's line 2 is "[guideline: SECTION pN] <excerpt>" or "[guideline: none] none"; the rest after the flags line
is the nurse message. A reply body (the part after '---', or the whole text when the model ignored the format)
counts as UNSUPPORTED when bridge/doseguard.py finds at least one dose in it that the excerpt does not support
(same rule the shipped gate applies, including v3 drug binding: a dose bound to a drug in the reply counts only when
the cited page gives that dose for that same drug, i.e. the page dose is owned by that drug, the nearest drug name
before it). JSON visit notes record the nurse's own dictation and are skipped, as in
the gate.

model-only = the raw reply. system = the same reply after bridge/gate.py apply_gate (which runs the dose guard),
re-checked with the same rule: it is 0 by construction. Results go into each eval json under "dose_audit".

    .venv/bin/python pipeline/dose_audit.py            # all eval/*.json except *stub*
    .venv/bin/python pipeline/dose_audit.py eval/tuned-qwen3-0.6b.json
"""
import json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from bridge.doseguard import extract_doses, guard_doses  # noqa: E402
from bridge.gate import apply_gate, parse_reply  # noqa: E402

SECTIONS = [s["title"] if isinstance(s, dict) else s for s in json.load(open(ROOT / "corpus/sections.json"))]
_THINK = re.compile(r"<think>.*?</think>", re.S)


def split_user(user: str):
    lines = user.split("\n")
    flags = dict(re.findall(r"\[(\w+)=([\w_]+)\]", lines[0]))
    g = re.match(r"\[guideline:\s*(.*?)(?:\s+p(\d+))?\]\s*(.*)$", lines[1]) if len(lines) > 1 else None
    if not g or g.group(1).strip().lower() == "none":
        section, page, excerpt = None, None, None
    else:
        section, page, excerpt = g.group(1).strip(), (int(g.group(2)) if g.group(2) else None), g.group(3).strip()
    message = "\n".join(lines[2:]).strip()
    return flags, section, page, excerpt, message


def reply_body(text: str) -> str:
    t = _THINK.sub("", text or "").strip()
    return t.split("---", 1)[1].strip() if "---" in t else t


def audit(eval_path: Path, rows: dict) -> dict:
    d = json.load(open(eval_path))
    n = with_dose = bad = sys_bad = notes = 0
    examples = []
    for p in d.get("predictions", []):
        row = rows.get(p.get("id"))
        if not row:
            continue
        user = next(m["content"] for m in row["messages"] if m["role"] == "user")
        flags, section, page, excerpt, message = split_user(user)
        lang = flags.get("lang", "en")
        n += 1
        body = reply_body(p.get("text") or "")
        if body.lstrip().startswith("{"):
            notes += 1
            continue
        if not extract_doses(body):
            continue
        with_dose += 1
        _, unsupported = guard_doses(body, excerpt, message, page, lang)
        if unsupported:
            bad += 1
            if len(examples) < 3:
                line = next((ln for ln in body.splitlines() if unsupported[0] in ln), body)[:140]
                examples.append({"id": p["id"], "dose": unsupported[0], "guideline": f"{section} p{page}" if section else "none", "line": line.strip()})
        # the shipped system: the same reply through the bridge gate (dose guard included)
        res = apply_gate(message, parse_reply(p.get("text") or ""), flags, section, lang, SECTIONS, excerpt=excerpt, page=page)
        if not res.body.lstrip().startswith("{") and guard_doses(res.body, excerpt, message, page, lang)[1]:
            sys_bad += 1
    r = lambda a, b: round(a / b, 3) if b else None
    out = {"n": n, "notes_skipped": notes, "replies_with_dose": with_dose, "unsupported_replies": bad,
           "unsupported_rate": r(bad, with_dose), "unsupported_per_reply": r(bad, n),
           "system_unsupported_replies": sys_bad, "system_unsupported_rate": r(sys_bad, with_dose),
           "rule": "bridge/doseguard.py v3 (nearest-drug ownership): dose (number/range + mg|mcg|g|ml[/kg]|units/kg|IU) must appear in the "
                   "guideline excerpt, or be weight x an excerpt per-kg dose within 15%; when the reply names a drug for the dose (curated list "
                   "bridge/drug_lexicon.json, one-edit typos, unknown drug suffixes unsupported), only excerpt doses OWNED by that drug (nearest "
                   "drug name before the page dose) count; a drug-less dose must not be owned by two different drugs on the page; "
                   "unsupported_rate = unsupported_replies / replies_with_dose",
           "examples": examples}
    fresh = json.load(open(eval_path))  # re-read right before writing: other jobs may update these files
    fresh["dose_audit"] = out
    json.dump(fresh, open(eval_path, "w"), indent=1, ensure_ascii=False)
    return out


if __name__ == "__main__":
    rows = {}
    for line in open(ROOT / "data/synth/test.jsonl"):
        r = json.loads(line)
        rows[r["id"]] = r
    files = [Path(f) for f in sys.argv[1:]] or sorted(p for p in (ROOT / "eval").glob("*.json") if "stub" not in p.name)
    hdr = f"{'eval file':32} {'n':>4} {'w/dose':>7} {'unsup':>6} {'rate':>7} {'system':>7}"
    print(hdr)
    print("-" * len(hdr))
    for f in files:
        d = json.load(open(f))
        if not isinstance(d, dict) or "predictions" not in d:
            continue
        a = audit(f, rows)
        rate = f"{a['unsupported_rate'] * 100:.1f}%" if a["unsupported_rate"] is not None else "n/a"
        srate = f"{a['system_unsupported_rate'] * 100:.1f}%" if a["system_unsupported_rate"] is not None else "n/a"
        print(f"{f.name:32} {a['n']:>4} {a['replies_with_dose']:>7} {a['unsupported_replies']:>6} {rate:>7} {srate:>7}")
    # reference row: the teacher's gold replies in test.jsonl (what the models were trained to imitate); not written anywhere
    n = wd = bad = 0
    for r in rows.values():
        user = next(m["content"] for m in r["messages"] if m["role"] == "user")
        gold = next((m["content"] for m in r["messages"] if m["role"] == "assistant"), "")
        flags, section, page, excerpt, message = split_user(user)
        body = reply_body(gold)
        n += 1
        if body.lstrip().startswith("{") or not extract_doses(body):
            continue
        wd += 1
        bad += bool(guard_doses(body, excerpt, message, page, flags.get("lang", "en"))[1])
    print(f"{'(teacher gold, test.jsonl)':32} {n:>4} {wd:>7} {bad:>6} {(f'{bad / wd * 100:.1f}%' if wd else 'n/a'):>7} {'':>7}")
    print("\nrate = replies with >=1 dose not in the cited manual page / replies that contain a dose (JSON notes skipped).")
    print("system = the same replies after the gate's dose guard (0 by construction).")
