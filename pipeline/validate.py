#!/usr/bin/env python
"""Validate, dedupe, split and export the synthetic Lokol Health dataset (SPEC §3).

Input : data/synth/raw.jsonl (from pipeline/synth.py)
Output: data/synth/{train,val,test}.jsonl      full records + `messages`
        data/synth/rejected.jsonl              rows that failed a check, with the reason
        data/synth/stats.json                  counts, reject reasons, judge score
        data/synth/judge.jsonl                 per-item judge results
        data/mlx/<size>/{train,valid,test}.jsonl   mlx-lm chat format, identical for all sizes

Checks: protocol regex; note body is a JSON object with the required keys (a note answered with
ASK_PERSON in prose is relabelled abstain); STM title exists in
corpus/sections.json; ACTION consistent with red flags, flags and guideline mode; Pijin rows
contain >= 3 glossary tokens; duplicates dropped.  A 10% sample is judged for guideline
faithfulness by headless Claude (`claude -p --model sonnet`), batched 10 items per call.

Usage: .venv/bin/python pipeline/validate.py [--no-judge] [--judge-max 300] [--judge-workers 4]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import re
import subprocess
import sys
import time
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "pipeline"))
from synth import PRESENTATIONS, load_style  # noqa: E402

RAW = ROOT / "data/synth/raw.jsonl"
SECTIONS = ROOT / "corpus/sections.json"
OUT_DIR = ROOT / "data/synth"
MLX_DIR = ROOT / "data/mlx"
SIZES = ["0.8B", "2B", "4B", "9B"]

ACTIONS = ("ADVISE", "REFER_NOW", "REFER_NEXT_TRANSPORT", "ASK_PERSON")
PROTOCOL_RE = re.compile(r"^ACTION: (ADVISE|REFER_NOW|REFER_NEXT_TRANSPORT|ASK_PERSON)\s*\nSTM: (.+?)\s*\n---\s*\n(.+)$", re.S)
NOTE_KEYS = {"age_months", "weight_kg", "symptoms", "danger_signs", "assessment_per_stm", "action", "drugs", "follow_up", "referral"}

# red-flag triggers in the NURSE message (English + Pijin), with simple negation handling
RED_FLAG_PATTERNS = [
    r"convuls", r"\bfit(s|ting)\b", r"\b(had|has|having|got|get|another|second|wan|wanfala) (a |wan |wanfala )?fit\b", r"seizure", r"sek[- ]sek", r"konvalsen",
    r"(unable|not able|can'?t|cannot|no fit|no save)\s+(to\s+)?(drink|breastfeed|feed|suck|dring|susu)",
    r"not (drinking|feeding|breastfeeding|sucking)( at all| anything| well)?\b", r"refus(es|ing|ed) (all|every|to|the) ?(feed|drink|breast|suck)",
    r"stopped (breastfeeding|feeding|drinking|sucking)", r"no (laik|laek|wantem) (susu|dring)\b", r"(won'?t|will not|does not|doesn'?t) (feed|drink|suck|breastfeed|take the breast)",
    r"chest (is |wall )?(pulling|sucking) in", r"(both|tufala) (legs|feet|leg|fut)( blong hem)? (are |i |hem )?(puffy|swollen|solap|swel)",
    r"no (save |fit )?(susu|dring)\b",
    r"vomit(s|ing)? (everything|all|evri)", r"tor(o)?aot evri", r"throws up everything",
    r"letharg", r"unconscious", r"unrespons", r"floppy", r"slip tumas", r"no (save )?wekap", r"\bcoma\b", r"drowsy and (not|no)",
    r"chest (in-?drawing|indrawing|retraction)", r"grunting", r"\bcyanos", r"blue (lips|tongue|skin)", r"lips blu", r"turn(ed|ing)? blue",
    r"stiff neck", r"neck (is )?stiff", r"nek (blong hem )?stif", r"bulging fontanel",
    r"severe dehydrat", r"very sunken", r"skin pinch (goes back|returns) very slow", r"drinks poorly",
    r"severe (acute )?malnutrition", r"visible (severe )?wasting", r"oedema (of|on) both feet", r"both feet (are )?swollen", r"swelling of both feet", r"muac (<|under|below|less than) ?11",
    r"bleeding", r"blad i? ?(kam|ran|stap) ?aot", r"blood (coming|is) (out|from)", r"vomit(ing|s|ed)? blood",
    r"burn[a-z]* (to|on|of) (the )?(face|mouth|neck|airway|nose)", r"bone long feis", r"inhaled smoke",
    r"silent chest", r"(can'?t|cannot|unable to) (talk|speak)",
]
NEGATION_RE = re.compile(r"\b(no|not|without|never|neva|nomoa|none|denies|denied|nating|no garem|hem no|didn'?t|no sign of|no signs of)\b", re.I)
YOUNG_INFANT_FEVER_RE = re.compile(r"\b(fever|febrile|hot bodi|bodi hot|skin hot|hot skin|temperature|\bhot\b|hot body|body hot|warm to touch)\b", re.I)


def load_titles():
    return [s["title"] for s in json.load(SECTIONS.open(encoding="utf-8"))]


def norm_text(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def has_red_flag(message: str, age_months) -> list[str]:
    hits = []
    low = message.lower()
    for pat in RED_FLAG_PATTERNS:
        for m in re.finditer(pat, low):
            before = low[max(0, m.start() - 40):m.start()]
            # skip negated mentions ("no convulsions", "hem no sek-sek", "danger signs: none")
            if NEGATION_RE.search(before.split(".")[-1].split(",")[-1]):
                continue
            hits.append(pat)
            break
    if age_months is not None and age_months < 2 and YOUNG_INFANT_FEVER_RE.search(low):
        before_ok = True
        for m in YOUNG_INFANT_FEVER_RE.finditer(low):
            before = low[max(0, m.start() - 30):m.start()]
            if NEGATION_RE.search(before.split(".")[-1].split(",")[-1]):
                before_ok = False
        if before_ok:
            hits.append("young_infant_fever")
    return hits


# Tok Pisin / Bislama forms that should not appear in Solomon Islands Pijin output
TOK_PISIN_MARKERS = ["dispela", "wanpela", "tupela", "tripela", "mitupela", "yutupela", "bilong", "wara", "bikpela",
                     "liklik", "tasol", "nogat", "haus sik", "olgeta", "i gat", "em i", "planti", "stret", "pinis",
                     "kisim", "lukautim", "sik man", "dring wara", "wanem samting", "mo ", "ale ", "wetem ol "]


def tok_pisin_leaks(text: str) -> list[str]:
    low = " " + re.sub(r"[^a-z0-9\-' ]+", " ", text.lower()) + " "
    return [m for m in TOK_PISIN_MARKERS if (" " + m.strip() + " ") in low or (m.endswith(" ") and (" " + m) in low)]


def pijin_hits(text: str, glossary_terms: list[str]) -> int:
    low = " " + re.sub(r"[^a-z0-9\-' ]+", " ", text.lower()) + " "
    n = 0
    for t in glossary_terms:
        if re.search(r"(?<![a-z])" + re.escape(t) + r"(?![a-z])", low):
            n += 1
    return n


def nurse_message(user: str) -> str:
    lines = user.split("\n")
    return "\n".join(lines[2:]).strip() if len(lines) >= 3 else user


STRAY_TAG_RE = re.compile(r"\s*\[(?:lang|rdt|act|transport)=[a-z_]+\]\s*|\s*\[guideline:[^\]]*\]\s*", re.I)


def strip_stray_tags(r: dict) -> None:
    """Teachers sometimes echo the flag tags inside the nurse message; the tags belong to line 1 only."""
    lines = r["user"].split("\n")
    if len(lines) >= 3:
        msg = "\n".join(lines[2:])
        cleaned = STRAY_TAG_RE.sub(" ", msg).strip()
        cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
        if cleaned != msg.strip():
            r["user"] = "\n".join(lines[:2] + [cleaned])
            r["_fixed"] = "stray_tags"


def check_row(r: dict, titles: set[str], glossary_terms: list[str]) -> str | None:
    """Return a reject reason or None."""
    strip_stray_tags(r)
    asst = r["assistant"].replace("\r\n", "\n").strip()
    m = PROTOCOL_RE.match(asst)
    if not m:
        return "format"
    action, stm, body = m.group(1), m.group(2).strip(), m.group(3).strip()
    r["_action"], r["_stm"] = action, stm
    if stm != "NONE" and stm not in titles:
        return "stm_title"
    if any(tok in body for tok in ("**", "```", "\n#", "##")):
        return "markdown"
    task = r["task"]
    if action == "ASK_PERSON" and stm != "NONE":  # protocol fix: ASK_PERSON always carries STM: NONE
        stm = "NONE"
        asst = re.sub(r"^(ACTION: ASK_PERSON\s*\nSTM: ).+?(\s*\n---)", r"\1NONE\2", asst, count=1, flags=re.S)
        r["assistant"], r["_stm"], r["_fixed"] = asst, stm, "ask_person_stm"
    if task == "note" and action == "ASK_PERSON" and not body.startswith("{"):
        # the teacher abstained in prose on a dictation request (missing or wrong guideline): per SPEC §2 a `note`
        # body must be JSON, so this row is an `abstain` example, not a `note` (eval.py scores note rows on JSON validity)
        task = r["task"] = "abstain"
        r["_fixed"] = "note_relabelled_abstain"
        r["_relabelled_note"] = True  # keeps the red-flag check below (a relabelled note is in scope, unlike a built abstain)
    if task == "note" and action != "ASK_PERSON":
        try:
            obj = json.loads(body)
        except Exception:  # noqa: BLE001
            return "note_json"
        if not isinstance(obj, dict) or not NOTE_KEYS.issubset(obj):
            return "note_keys"
        if obj.get("action") != action:
            return "note_action_mismatch"
    else:
        lines = [l for l in body.splitlines() if l.strip()]
        if not 1 <= len(lines) <= 6:
            return "too_long" if len(lines) > 6 else "empty"
        if len(body) > 1100:
            return "too_long"
    msg = nurse_message(r["user"])
    flags = r["flags"]
    red = has_red_flag(msg, r.get("age_months"))
    r["_red_flags"] = red
    if task == "abstain" and not r.get("_relabelled_note"):
        red = []  # out-of-scope by construction (adults, obstetrics ...): ASK_PERSON with "call the doctor" is the target
        r["_red_flags"] = red
    if action == "ADVISE" and stm == "NONE":
        return "advise_without_stm"
    if red and action not in ("REFER_NOW", "REFER_NEXT_TRANSPORT"):
        return "red_flag_not_referred"
    if action == "REFER_NEXT_TRANSPORT" and flags.get("transport") != "next_boat":
        return "next_transport_flag"
    if task == "abstain" and action != "ASK_PERSON":
        return "abstain_action"
    if task == "referral" and action not in ("REFER_NOW", "REFER_NEXT_TRANSPORT"):
        return "referral_action"
    if r["guideline_mode"] in ("none", "wrong") and action == "ADVISE":
        return "guideline_missing_not_ask"  # referring is always acceptable; advising from a missing/wrong guideline is not
    if r["guideline_mode"] == "match" and action == "ADVISE" and stm != r["section"]:
        return "stm_section_mismatch"
    if r["lang"] in ("pis", "mix"):
        need = 1 if task == "note" else (3 if r["lang"] == "pis" else 2)
        if pijin_hits(body, glossary_terms) < need:
            return "pijin_glossary"
        leaks = tok_pisin_leaks(body)
        r["_leaks"] = leaks
        if len(leaks) >= 2:
            return "tok_pisin_leak"
    if r["lang"] == "en" and pijin_hits(body, ["pikinini", "sapos", "givim", "olketa", "hemi", "blong"]) >= 2:
        # the teacher answered a lang=en job in Pijin: if the nurse message is Pijin too, relabel the row as pis
        if pijin_hits(body, glossary_terms) >= 3 and pijin_hits(msg, glossary_terms) >= 2 and len(tok_pisin_leaks(body)) < 2:
            r["lang"] = "pis"
            r["flags"]["lang"] = "pis"
            r["user"] = r["user"].replace("[lang=en]", "[lang=pis]", 1)
            r["_fixed"] = "relabelled_en_to_pis"
        else:
            return "en_has_pijin"
    return None


# ----------------------------------------------------------------------------- judge
JUDGE_CMD = ["claude", "-p", "--model", "sonnet", "--output-format", "json", "--strict-mcp-config",
             "--mcp-config", '{"mcpServers":{}}', "--settings", '{"disableAllHooks":true}', "--tools", "",
             "--no-session-persistence"]


def judge_batch(items: list[dict]) -> list[dict]:
    parts = []
    for k, r in enumerate(items, 1):
        parts.append(f"### ITEM {k} (id={r['id']}, task={r['task']}, lang={r['lang']}, guideline_mode={r['guideline_mode']})\n"
                     f"USER TURN:\n{r['user']}\n\nASSISTANT REPLY:\n{r['assistant']}\n")
    prompt = f"""You are grading synthetic training data for a clinical assistant used by nurse aides in Solomon Islands. The assistant must follow the Solomon Islands Standard Treatment Manual for Children. Each item has a USER TURN (flags line, a guideline excerpt line or [guideline: none], the nurse's message) and an ASSISTANT REPLY.

Grade each item:
- faithfulness (0-3): 3 = every clinical statement and dose in the reply is supported by the guideline excerpt (or the reply correctly abstains/refers when the excerpt is missing or wrong); 2 = minor unsupported detail that is still safe and standard; 1 = a meaningful unsupported or wrong statement/dose; 0 = dangerous or contradicts the excerpt.
- action_ok (true/false): the ACTION line is right given the nurse's message, the flags, and the red-flag rule (danger signs such as convulsions, unable to drink, vomits everything, lethargy, chest indrawing, stiff neck, severe dehydration, severe malnutrition, bleeding, cyanosis, fever under 2 months, face burns force REFER_NOW, or REFER_NEXT_TRANSPORT when transport=next_boat).
- pijin (0-3 or null): for Pijin replies, 3 = natural Solomon Islands Pijin, 1 = mostly Tok Pisin/Bislama or broken, null for English.
- issue: one short phrase if faithfulness < 3 or action_ok is false, else "".

Return ONLY a JSON array with one object per item in order: {{"id": "...", "faithfulness": n, "action_ok": bool, "pijin": n|null, "issue": "..."}}.

{chr(10).join(parts)}"""
    env = {k: v for k, v in os.environ.items() if k not in ("CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT")}
    try:
        p = subprocess.run(JUDGE_CMD, input=prompt, capture_output=True, text=True, timeout=400, cwd="/tmp", env=env)
        out = json.loads(p.stdout)
        text = out.get("result", "") if isinstance(out, dict) else ""
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip(), flags=re.S)
        i, j = text.find("["), text.rfind("]")
        arr = json.loads(text[i:j + 1])
        byid = {a.get("id"): a for a in arr if isinstance(a, dict)}
        res = []
        for r in items:
            a = byid.get(r["id"]) or {}
            res.append({"id": r["id"], "task": r["task"], "lang": r["lang"], "teacher": r["teacher"],
                        "faithfulness": a.get("faithfulness"), "action_ok": a.get("action_ok"),
                        "pijin": a.get("pijin"), "issue": a.get("issue", ""), "judge_ok": bool(a)})
        return res
    except Exception as e:  # noqa: BLE001
        return [{"id": r["id"], "task": r["task"], "lang": r["lang"], "teacher": r["teacher"], "judge_ok": False,
                 "error": f"{type(e).__name__}: {str(e)[:200]}"} for r in items]


def run_judge(rows: list[dict], frac: float, cap: int, workers: int, seed: int) -> dict:
    rng = random.Random(seed)
    n = min(cap, max(1, int(len(rows) * frac)))
    sample = rng.sample(rows, n)
    batches = [sample[i:i + 10] for i in range(0, len(sample), 10)]
    results = []
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = [ex.submit(judge_batch, b) for b in batches]
        for i, f in enumerate(as_completed(futs), 1):
            results.extend(f.result())
            print(f"[judge] batch {i}/{len(batches)} done ({time.time() - t0:.0f}s)", flush=True)
    with (OUT_DIR / "judge.jsonl").open("w", encoding="utf-8") as f:
        for r in results:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    return summarize_judge(results)


def summarize_judge(results: list[dict]) -> dict:
    scored = [r for r in results if r.get("judge_ok") and isinstance(r.get("faithfulness"), (int, float))]
    summary = {"n_sampled": len(results), "n_scored": len(scored)}
    if scored:
        summary["faithfulness_mean"] = round(sum(r["faithfulness"] for r in scored) / len(scored), 2)
        summary["faithfulness_hist"] = dict(Counter(int(r["faithfulness"]) for r in scored))
        summary["action_ok_rate"] = round(sum(1 for r in scored if r.get("action_ok")) / len(scored), 3)
        pij = [r["pijin"] for r in scored if isinstance(r.get("pijin"), (int, float))]
        summary["pijin_mean"] = round(sum(pij) / len(pij), 2) if pij else None
        by_t = defaultdict(list)
        for r in scored:
            by_t[r["teacher"].split("/")[-1]].append(r["faithfulness"])
        summary["faithfulness_by_teacher"] = {k: round(sum(v) / len(v), 2) for k, v in by_t.items()}
        by_l = defaultdict(list)
        for r in scored:
            by_l[r["lang"]].append(r["faithfulness"])
        summary["faithfulness_by_lang"] = {k: round(sum(v) / len(v), 2) for k, v in by_l.items()}
        summary["issues_sample"] = [r["issue"] for r in scored if r.get("issue")][:15]
    return summary


def usage_per_call(raw: list[dict]) -> dict:
    """Every row of a call carries that call's usage; count each call once."""
    seen: dict[str, dict] = {}
    for r in raw:
        seen.setdefault(r["job"], r.get("usage") or {})
    return {"calls": len(seen),
            "prompt_tokens": sum(u.get("prompt_tokens") or 0 for u in seen.values()),
            "completion_tokens": sum(u.get("completion_tokens") or 0 for u in seen.values())}


# ----------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", default=str(RAW) + "," + str(OUT_DIR / "raw_heldout.jsonl"),
                    help="comma-separated raw jsonl files (missing files are skipped)")
    ap.add_argument("--val", type=int, default=300)
    ap.add_argument("--test", type=int, default=300)
    ap.add_argument("--seed", type=int, default=11)
    ap.add_argument("--heldout-frac", type=float, default=0.5, help="share of the test set drawn from held-out presentations")
    ap.add_argument("--no-judge", action="store_true")
    ap.add_argument("--judge-frac", type=float, default=0.10)
    ap.add_argument("--judge-max", type=int, default=300)
    ap.add_argument("--judge-workers", type=int, default=4)
    ap.add_argument("--reuse-judge", action="store_true", help="recompute the judge summary from data/synth/judge.jsonl instead of calling Claude")
    args = ap.parse_args()

    style = load_style()
    titles = set(load_titles())
    glossary_terms = sorted({a.lower() for a, _ in style["glossary"] for a in re.split(r"\s*/\s*", a)}, key=len, reverse=True)
    held_out = {p[0] for p in PRESENTATIONS if p[3]}

    raw = []
    for path in args.raw.split(","):
        pth = Path(path.strip())
        if pth.exists():
            raw += [json.loads(l) for l in pth.open(encoding="utf-8") if l.strip()]
        else:
            print(f"[validate] skipping missing {pth}", file=sys.stderr)
    reasons = Counter()
    valid, rejected = [], []
    seen_msg, seen_pair = set(), set()
    for r in raw:
        why = check_row(r, titles, glossary_terms)
        if why is None:
            km = norm_text(nurse_message(r["user"]))
            kp = hashlib.md5((km[:80] + "|" + norm_text(r["assistant"])[:120]).encode()).hexdigest()
            if km in seen_msg or kp in seen_pair:
                why = "duplicate"
            else:
                seen_msg.add(km)
                seen_pair.add(kp)
        if why:
            reasons[why] += 1
            rejected.append({**{k: v for k, v in r.items() if not k.startswith("_")}, "reject": why})
        else:
            valid.append(r)
    print(f"[validate] raw={len(raw)} valid={len(valid)} rejected={len(rejected)} reasons={dict(reasons.most_common())}", flush=True)

    # ---- split: held-out presentations go to test only; fill test/val randomly from the rest
    rng = random.Random(args.seed)
    ho = [r for r in valid if r["presentation"] in held_out]
    rest = [r for r in valid if r["presentation"] not in held_out]
    rng.shuffle(ho)
    rng.shuffle(rest)
    test = ho[: int(args.test * args.heldout_frac)]  # half of test = held-out presentations, half in-distribution
    need = args.test - len(test)
    test += rest[:need]
    rest = rest[need:]
    val = rest[: args.val]
    train = rest[args.val:]
    # held-out rows beyond the test budget are dropped from train (keep the hold-out clean)
    dropped_ho = ho[int(args.test * args.heldout_frac):]
    print(f"[validate] split train={len(train)} val={len(val)} test={len(test)} (held-out presentations in test: {len(test) - need}, extra held-out rows dropped: {len(dropped_ho)})", flush=True)

    def to_record(r: dict) -> dict:
        rec = {k: v for k, v in r.items() if not k.startswith("_")}
        rec["red_flags_detected"] = r.get("_red_flags", [])
        rec["messages"] = [
            {"role": "system", "content": style["system"]},
            {"role": "user", "content": r["user"]},
            {"role": "assistant", "content": r["assistant"].replace("\r\n", "\n").strip()},
        ]
        return rec

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    splits = {"train": train, "val": val, "test": test}
    for name, rows in splits.items():
        with (OUT_DIR / f"{name}.jsonl").open("w", encoding="utf-8") as f:
            for r in rows:
                f.write(json.dumps(to_record(r), ensure_ascii=False) + "\n")
    with (OUT_DIR / "rejected.jsonl").open("w", encoding="utf-8") as f:
        for r in rejected:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    # ---- mlx-lm chat export (identical for every size; the Qwen3.5 family shares the chat template)
    mlx_names = {"train": "train", "val": "valid", "test": "test"}
    for size in SIZES:
        d = MLX_DIR / size
        d.mkdir(parents=True, exist_ok=True)
        for name, rows in splits.items():
            with (d / f"{mlx_names[name]}.jsonl").open("w", encoding="utf-8") as f:
                for r in rows:
                    f.write(json.dumps({"messages": to_record(r)["messages"]}, ensure_ascii=False) + "\n")

    # ---- stats
    def counts(rows):
        return {"task": dict(Counter(r["task"] for r in rows)), "lang": dict(Counter(r["lang"] for r in rows)),
                "action": dict(Counter(r["_action"] for r in rows)), "guideline_mode": dict(Counter(r["guideline_mode"] for r in rows)),
                "teacher": dict(Counter(r["teacher"].split("/")[-1] for r in rows)),
                "red_flag_rows": sum(1 for r in rows if r.get("_red_flags"))}
    stats = {"raw": len(raw), "valid": len(valid), "rejected": dict(reasons.most_common()),
             "splits": {k: len(v) for k, v in splits.items()},
             "counts": {k: counts(v) for k, v in splits.items()}, "all_valid": counts(valid),
             "sections_covered": len({r["section"] for r in valid}), "presentations_held_out": sorted(held_out),
             "usage": usage_per_call(raw)}
    if args.reuse_judge and (OUT_DIR / "judge.jsonl").exists():
        results = [json.loads(l) for l in (OUT_DIR / "judge.jsonl").open(encoding="utf-8") if l.strip()]
        stats["judge"] = summarize_judge(results)
        print(f"[validate] judge (reused): {json.dumps(stats['judge'])}", flush=True)
    elif not args.no_judge and valid:
        print(f"[validate] judging {args.judge_frac:.0%} sample (cap {args.judge_max}) with headless Claude ...", flush=True)
        stats["judge"] = run_judge(valid, args.judge_frac, args.judge_max, args.judge_workers, args.seed)
        print(f"[validate] judge: {json.dumps(stats['judge'])}", flush=True)
    (OUT_DIR / "stats.json").write_text(json.dumps(stats, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({k: stats[k] for k in ("raw", "valid", "rejected", "splits", "all_valid")}, indent=1))

    # ---- printed sample: 6 rows, 3 Pijin
    pis = [r for r in train if r["lang"] == "pis"][:3]
    oth = [r for r in train if r["lang"] != "pis"][:3]
    for r in pis + oth:
        print("=" * 78)
        print(f"[{r['id']}] task={r['task']} lang={r['lang']} gmode={r['guideline_mode']} teacher={r['teacher'].split('/')[-1]}")
        print("USER:\n" + r["user"][:700] + ("..." if len(r["user"]) > 700 else ""))
        print("ASSISTANT:\n" + r["assistant"])


if __name__ == "__main__":
    main()
