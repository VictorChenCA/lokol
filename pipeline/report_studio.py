"""Build the Studio Eval page data and the README eval table from eval/*.json. Re-runnable; picks up new evals.

    .venv/bin/python pipeline/report_studio.py            # writes app/public/eval/results.json + eval/results.md (+ eval/results.json)
    .venv/bin/python pipeline/report_studio.py --print    # also prints the markdown

Steps
  1. Any known eval json without "system" gets pipeline/system_metrics.py (gate-applied scores); without "dose_audit"
     it gets pipeline/dose_audit.py (when that script exists). Both write back into the eval json.
  2. app/public/eval/results.json in the EvalResults shape (app/src/types.ts, documented in app/public/eval/README.md):
     one row per model (base + tuned per size), model-only metrics under the page's keys, plus extra keys the page
     ignores: system_* (after the rule-based gate), unsafe_advise_rate, advise_kept, unsupported_dose_rate, ...
  3. samples[]: 4 test prompts (Pijin red-flag referral, out-of-scope abstain, Pijin guidance, English guidance) with
     base and tuned replies at every size. Picked where the tuned replies are right and the base is not, and never a
     tuned reply with a dose the dose guard flags as unsupported.
  4. meta: test set, date, limitations. 5. eval/results.md: model-only vs with-gate tables and the dose audit.
Scoring is not changed here: every number comes from pipeline/eval.py, system_metrics.py and dose_audit.py.
"""
import argparse, json, re, subprocess, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
EVAL_DIR = ROOT / "eval"
GGUF_DIR = ROOT / "models" / "gguf"
STUDIO_OUT = ROOT / "app" / "public" / "eval" / "results.json"
MD_OUT = EVAL_DIR / "results.md"
TEST = ROOT / "data" / "synth" / "test.jsonl"
TRAIN = ROOT / "data" / "synth" / "train.jsonl"
REFER = {"REFER_NOW", "REFER_NEXT_TRANSPORT"}

# eval file stem -> how it shows in the Studio. Order = row order (base before tuned inside a size).
MODELS = [
    dict(stem="base-qwen3.5-9b", size="9B", variant="base", model_id="qwen3.5-9b-base", tier="D", model="Qwen3.5-9B",
         runtime="river", runtime_detail="River (hosted), stock weights", gguf=None),
    dict(stem="tuned-qwen3.5-9b-s180", size="9B", variant="tuned", model_id="lokol-health-qwen3.5-9b", tier="D",
         model="Lokol Health 9B (River LoRA, step 180)", runtime="river", runtime_detail="River LoRA r16 (hosted), step 180",
         gguf=None, shipped=True),
    dict(stem="base-qwen3-0.6b", size="0.6B", variant="base", model_id="qwen3-0.6b-base", tier="A", model="Qwen3-0.6B",
         runtime="llama.cpp", runtime_detail="llama.cpp Q4_K_M", gguf="qwen3-0.6b-base-Q4_K_M.gguf"),
    dict(stem="tuned-qwen3-0.6b", size="0.6B", variant="tuned", model_id="lokol-health-qwen3-0.6b", tier="A",
         model="Lokol Health 0.6B (Apple silicon LoRA)", runtime="llama.cpp", runtime_detail="llama.cpp Q4_K_M (mlx-lm LoRA, fused)",
         gguf="lokol-health-qwen3-0.6b-Q4_K_M.gguf", shipped=True),
    dict(stem="base-qwen3-1.7b", size="1.7B", variant="base", model_id="qwen3-1.7b-base", tier="B", model="Qwen3-1.7B",
         runtime="llama.cpp", runtime_detail="llama.cpp Q4_K_M", gguf="qwen3-1.7b-base-Q4_K_M.gguf"),
    dict(stem="tuned-qwen3-1.7b", size="1.7B", variant="tuned", model_id="lokol-health-qwen3-1.7b", tier="B",
         model="Lokol Health 1.7B", runtime="llama.cpp", runtime_detail="llama.cpp Q4_K_M (mlx-lm LoRA, fused)",
         gguf="lokol-health-qwen3-1.7b-Q4_K_M.gguf", shipped=True),
]
# Extra checkpoints: scored and reported, not a page row (EvalRow.variant is only "base" | "tuned").
ALTS = [
    dict(stem="tuned-qwen3.5-9b-s090", size="9B", variant="tuned-alt", model_id="lokol-health-qwen3.5-9b", tier="D",
         model="Lokol Health 9B (River LoRA, step 90)", runtime="river", runtime_detail="River LoRA r16 (hosted), step 90", gguf=None),
]

# Gallery ids read and kept for clinical sense (measles referral, floppy dehydrated baby, facial oedema). Used first while
# they still pass every hard rule in pick_samples(); otherwise the automatic ranking picks.
PINNED = {"Pijin red-flag referral": ["j7-00416-0"], "Pijin guidance": ["j7-00603-2"], "English guidance": ["j7-00529-2"]}

TEST_SET_TEXT = ("300 held-out synthetic test cases (data/synth/test.jsonl, same teacher pipeline as training). "
                 "150 of them use 14 presentations that never appear in training. Languages: Pijin 122, English 126, "
                 "code-switched 52. Tasks: guidance 121, referral 61, visit note 60, follow-up 32, abstain 26.")


def limitations(evs, teacher=None):
    """Honest caveats, with the numbers read from the shipped tuned rows (so a new size updates them)."""
    pc = lambda v: f"{round(v * 100)}%" if v is not None else "n/a"
    tuned = [(s, e) for s, e in evs if s["variant"] == "tuned"]
    judge = ", ".join(f"tuned {s['size']} {e['judge']['mean']:.1f}" for s, e in tuned if (e.get("judge") or {}).get("mean") is not None)
    notes = [e["metrics"].get("note_json_valid") for _, e in tuned if e["metrics"].get("note_json_valid") is not None]
    small = min(tuned, key=lambda se: float(se[0]["size"].rstrip("B")), default=None)
    out = ["The test data is synthetic and written by the same teacher models as the training data, so it rewards imitating the "
           "teacher; it is not a clinical validation.",
           f"Judge faithfulness (headless Claude, 0 to 3, first 60 cases) is low for every model and lowest for the small ones: {judge}."]
    if notes:
        out.append(f"Visit-note JSON validity is only {pc(min(notes))} to {pc(max(notes))} for the tuned models, so a nurse must check the note form.")
    if small:
        m = small[1]["metrics"]
        out.append(f"The {small[0]['size']} model over-refers (refers {pc(m.get('over_refer_rate'))} of the cases that should be ADVISE) "
                   f"and rarely says 'ask a person' (abstain recall {pc(m.get('abstain_recall'))}).")
    out += ["With-gate scores include Lokol's rule-based safety gate (danger-sign keywords, protocol check, dose guard). "
            "They describe the shipped system, not the weights.",
            "Most doses the models write are not on the manual page they were given for that same drug (see the dose audit)"
            + (f"; the teacher's own reference replies fail the same check {pc(teacher[1] / teacher[0])} of the time "
               f"({teacher[1]} of {teacher[0]} replies with a dose)" if teacher and teacher[0] else "")
            + ", so the shipped dose guard replaces those lines with 'ask a person for the dose'."]
    return out


def _r(x, nd=3):
    return None if x is None else round(float(x), nd)


def load(path: Path):
    try:
        d = json.loads(path.read_text())
    except Exception as e:  # half-written by a running eval: skip this time
        print(f"[report] skip {path.name}: {type(e).__name__}", file=sys.stderr)
        return None
    return d if isinstance(d, dict) and "metrics" in d and "predictions" in d else None


def ensure_scored(paths):
    """Run system_metrics.py / dose_audit.py on eval files that miss those fields."""
    need_sys = [p for p in paths if (d := load(p)) is not None and "system" not in d]
    if need_sys:
        print(f"[report] system_metrics.py on {[p.name for p in need_sys]}", file=sys.stderr)
        subprocess.run([sys.executable, str(ROOT / "pipeline/system_metrics.py"), *map(str, need_sys)], check=True, cwd=ROOT)
    audit = ROOT / "pipeline" / "dose_audit.py"
    need_dose = [p for p in paths if (d := load(p)) is not None and "dose_audit" not in d]
    if need_dose and audit.exists():
        print(f"[report] dose_audit.py on {[p.name for p in need_dose]}", file=sys.stderr)
        subprocess.run([sys.executable, str(audit), *map(str, need_dose)], check=True, cwd=ROOT, stdout=subprocess.DEVNULL)


def gguf_mb(name):
    p = GGUF_DIR / name if name else None
    return round(p.stat().st_size / 2**20) if p and p.exists() else None


def row_for(spec, e):
    m, s, da = e["metrics"], e.get("system") or {}, e.get("dose_audit") or {}
    j = (e.get("judge") or {})
    met = {
        "format_compliance": m.get("format_compliance") or 0,
        "action_accuracy": m.get("action_acc") or 0,
        "stm_accuracy": m.get("stm_acc") or 0,
        "red_flag_recall": m.get("red_flag_recall") or 0,
        "abstain_precision": m.get("abstain_precision") or 0,  # undefined (never abstains) -> 0
        "abstain_recall": m.get("abstain_recall") or 0,
        "pijin_glossary_hit_rate": m.get("pijin_glossary_hit_rate") or 0,
        "judge_faithfulness_0_3": j.get("mean") if j.get("mean") is not None else 0,
    }
    if m.get("gen_tok_s"):
        met["tokens_per_s"] = round(m["gen_tok_s"], 1)
    mb = gguf_mb(spec.get("gguf"))
    if mb:
        met["ram_mb"] = mb
    extra = {
        "red_flag_recall_strict": m.get("red_flag_recall_strict"),       # model only, red-flag-list cases (n=61)
        "note_json_valid": m.get("note_json_valid"),
        "over_refer_rate": m.get("over_refer_rate"),
        "judge_scored": j.get("scored"),
        "system_action_accuracy": s.get("action_acc"),
        "system_red_flag_recall": s.get("red_flag_recall"),              # red-flag-list cases (n=61)
        "system_abstain_recall": s.get("abstain_recall"),
        "unsafe_advise_rate": s.get("unsafe_advise_rate"),              # with gate: ADVISE on a referral case
        "advise_kept": s.get("advise_kept"),                            # with gate: ADVISE cases still ADVISE
        "unsupported_dose_rate": da.get("unsupported_rate"),            # model only: replies with a dose not on the page
        "system_unsupported_dose_rate": da.get("system_unsupported_rate"),
    }
    met.update({k: v for k, v in extra.items() if v is not None})
    row = {"model": spec["model"], "size": spec["size"], "variant": spec["variant"], "runtime": spec["runtime"],
           "runtime_detail": spec["runtime_detail"], "model_id": spec["model_id"], "tier": spec["tier"], "eval": spec["stem"],
           "metrics": met, "per_lang": m.get("per_lang") or {}, "per_task": m.get("per_task") or {}}
    if spec.get("shipped"):
        row["shipped"] = True
    return row


# ----------------------------------------------------------------------------- samples
def split_user(user):
    lines = user.split("\n")
    g = re.match(r"\[guideline:\s*(.*?)(?:\s+p(\d+))?\]\s*(.*)$", lines[1]) if len(lines) > 1 else None
    if not g or g.group(1).strip().lower() == "none":
        guide, excerpt = None, None
    else:
        guide, excerpt = {"section": g.group(1).strip(), "page": int(g.group(2)) if g.group(2) else None}, g.group(3).strip()
    return guide, excerpt, "\n".join(lines[2:]).strip()


def clip(text, n=600):
    t = re.sub(r"^\s*<think>\s*</think>\s*", "", text or "")  # empty think block left by the chat template
    return t if len(t) <= n else t[: n - 1].rstrip() + "…"


def repetitive(text):
    lines = [ln.strip().lower() for ln in text.splitlines() if ln.strip()]
    words = re.findall(r"\w+", text.lower())
    grams = [" ".join(words[k:k + 4]) for k in range(len(words) - 3)]
    return len(set(lines)) < len(lines) or any(grams.count(g) >= 3 for g in set(grams))


def pick_samples(evs, test_rows, unseen):
    """4 gallery prompts. Hard rules: the tuned reply is right (format + ACTION) at every size shown, has no dose the dose
    guard flags, and is not a JSON note on a non-note task. Preferences, relaxed in order when nothing qualifies: the tuned
    STM is right at every size, guidance examples are ADVISE cases; then score by base wrong, judge score, unseen
    presentation, short replies. Deterministic (ties broken by id)."""
    from bridge.doseguard import guard_doses

    sizes = {}
    for spec, e in evs:
        sizes.setdefault(spec["size"], {})[spec["variant"]] = (spec, {p["id"]: p for p in e["predictions"]})
    pairs = {sz: v for sz, v in sizes.items() if "base" in v and "tuned" in v}
    if not pairs:
        return []
    ids = set.intersection(*[set(v["base"][1]) & set(v["tuned"][1]) for v in pairs.values()])

    def body(text):
        t = re.sub(r"<think>.*?</think>", "", text or "", flags=re.S).strip()
        return t.split("---", 1)[1].strip() if "---" in t else t

    def candidate(i, want):
        row = test_rows.get(i)
        if not row:
            return None
        user = next(m["content"] for m in row["messages"] if m["role"] == "user")
        guide, excerpt, message = split_user(user)
        gold = next(iter(pairs.values()))["tuned"][1][i]["gold"]
        if not want(row, gold):
            return None
        score, stm_all = 0.0, True
        for sz, v in pairs.items():
            t, b = v["tuned"][1][i], v["base"][1][i]
            if not (t["pred"]["format_ok"] and t["pred"]["action"] == gold["action"]):
                return None  # tuned must be right at every size shown
            tb = body(t["text"])
            if row["task"] != "note" and tb.startswith("{"):
                return None  # a visit-note JSON answer to a question
            if guard_doses(tb, excerpt, message, guide and guide["page"], row.get("lang", "en"))[1]:
                return None  # never showcase a tuned reply with an unsupported dose
            if repetitive(tb):
                return None  # degenerate loops ("report, report, report") are a decoding failure, not a typical reply
            stm_all &= (t["pred"]["stm"] or "").upper() == (gold["stm"] or "").upper()
            score += 2 * (b["pred"]["action"] != gold["action"])
            score += (t.get("judge") or {}).get("score") or 0
            score -= len(t["text"]) / 1500
        score += 1.5 * (row.get("presentation") in unseen)
        score -= len(message) / 400
        return dict(score=score, id=i, row=row, guide=guide, message=message, gold=gold, stm_all=stm_all)

    stm = lambda c: c["stm_all"]
    red = lambda c: bool(c["gold"].get("red_flag"))
    is_task = lambda t: (lambda c: c["row"]["task"] == t)
    advise = lambda c: c["gold"]["action"] == "ADVISE"
    both = lambda *fs: (lambda c: all(f(c) for f in fs))
    # (label, hard filter on (test row, gold), preference tiers tried in order)
    cats = [
        ("Pijin red-flag referral", lambda r, g: r["lang"] == "pis" and g["action"] in REFER,
         [both(is_task("referral"), red, stm), both(is_task("referral"), red), both(is_task("referral"), stm), is_task("referral"), both(red, stm)]),
        ("abstain", lambda r, g: r["task"] == "abstain" and g["action"] == "ASK_PERSON", [stm]),
        ("Pijin guidance", lambda r, g: r["task"] == "guidance" and r["lang"] == "pis", [both(advise, stm), stm]),
        ("English guidance", lambda r, g: r["task"] == "guidance" and r["lang"] == "en", [both(advise, stm), stm]),
    ]
    out, used = [], set()
    for task, want, prefs in cats:
        cands = sorted((c for i in sorted(ids - used) if (c := candidate(i, want))), key=lambda c: (-c["score"], c["id"]))
        pinned = [c for c in cands if c["id"] in PINNED.get(task, [])]
        c = pinned[0] if pinned else next((c for tier in prefs + [lambda c: True] for c in cands if tier(c)), None)
        if not c:
            print(f"[report] no clean sample for {task}", file=sys.stderr)
            continue
        i, row = c["id"], c["row"]
        used.add(i)
        outputs = []
        for sz, v in sorted(pairs.items(), key=lambda kv: float(kv[0].rstrip("B"))):
            for variant in ("base", "tuned"):
                spec, preds = v[variant]
                p = preds[i]
                label, rt = spec["model"], spec["runtime_detail"].split(" (")[0]
                if spec["gguf"]:  # one parenthetical: "Lokol Health 0.6B (Apple silicon LoRA, llama.cpp Q4_K_M)"
                    label = f"{label[:-1]}, {rt})" if label.endswith(")") else f"{label} ({rt})"
                outputs.append({"variant": variant, "model": label,
                                "size": sz, "text": clip(p["text"]), "action": p["pred"]["action"], "stm": p["pred"]["stm"],
                                "format_ok": bool(p["pred"]["format_ok"])})
        out.append({"id": i, "task": row["task"], "lang": row["lang"],
                    "flags": {k: row["flags"][k] for k in ("rdt", "act", "transport") if k in row["flags"]},
                    "guideline": c["guide"], "message": c["message"], "gold": {"action": c["gold"]["action"], "stm": c["gold"]["stm"]},
                    "unseen_presentation": row.get("presentation") in unseen, "outputs": outputs})
    return out


# ----------------------------------------------------------------------------- markdown
def teacher_dose_rate(test_rows):
    from bridge.doseguard import extract_doses, guard_doses
    wd = bad = 0
    for r in test_rows.values():
        user = next(m["content"] for m in r["messages"] if m["role"] == "user")
        gold = next((m["content"] for m in r["messages"] if m["role"] == "assistant"), "")
        guide, excerpt, message = split_user(user)
        b = gold.split("---", 1)[1].strip() if "---" in gold else gold
        if b.startswith("{") or not extract_doses(b):
            continue
        wd += 1
        bad += bool(guard_doses(b, excerpt, message, guide and guide["page"], r.get("lang", "en"))[1])
    return wd, bad


def markdown(evs, alts, test_rows, generated):
    pct = lambda v: "–" if v is None else f"{round(v * 100)}%"
    num = lambda v, nd=2: "–" if v is None else f"{v:.{nd}f}"
    allv = evs + alts
    sy = next((e["system"] for _, e in allv if e.get("system")), {})
    n_red, n_abs, n_ref, n_adv = (sy.get(k, "?") for k in ("n_red_flag", "n_abstain", "n_refer", "n_advise"))
    n_any = next((e["metrics"].get("n_red_flag") for _, e in allv), "?")
    L = ["# Lokol Health eval: base vs tuned", "",
         f"_Generated {generated} by `pipeline/report_studio.py` from `eval/*.json`._", "", TEST_SET_TEXT, "",
         "**Model only** scores the raw reply of the weights. **With gate** scores the same reply after Lokol's rule-based "
         "safety gate (`bridge/gate.py` = `app/src/runtime/gate.ts`): danger-sign keywords force a referral, a reply that "
         "breaks the protocol or has no guideline becomes \"ask a person\", and the dose guard replaces doses that are not on the manual page.", "",
         "## Model only vs with the safety gate", "",
         f"| Model | Size | Format | Right action: model / +gate | Danger signs (red-flag list, n={n_red}): model / +gate | "
         f"Says \"ask a person\" (n={n_abs}): model / +gate | Unsafe ADVISE on referral cases (n={n_ref}), +gate | ADVISE kept (n={n_adv}), +gate |",
         "|---|---|---|---|---|---|---|---|"]
    for spec, e in allv:
        m, s = e["metrics"], e.get("system") or {}
        name = spec["model"] + (" **(shipped)**" if spec.get("shipped") else (" (alt checkpoint)" if spec["variant"] == "tuned-alt" else ""))
        L.append(f"| {name} | {spec['size']} | {pct(m.get('format_compliance'))} | {pct(m.get('action_acc'))} / {pct(s.get('action_acc'))} | "
                 f"{pct(m.get('red_flag_recall_strict'))} / {pct(s.get('red_flag_recall'))} | {pct(m.get('abstain_recall'))} / {pct(s.get('abstain_recall'))} | "
                 f"{pct(s.get('unsafe_advise_rate'))} | {pct(s.get('advise_kept'))} |")
    L += ["", "Base models never follow the protocol, so with the gate they only ever refer (danger-sign keyword) or say \"ask a person\": "
          "their with-gate action accuracy comes entirely from the rules, and they never give advice (ADVISE kept 0%).", "",
          "## Model-only detail", "",
          f"| Model | Size | STM cited | Danger signs, any referral case (n={n_any}) | Abstain precision | Pijin reply (≥3 glossary words) | "
          "Note JSON valid | Over-refer | Judge 0–3 (scored) | tok/s | Q4 file |", "|---|---|---|---|---|---|---|---|---|---|---|"]
    for spec, e in allv:
        m, j = e["metrics"], e.get("judge") or {}
        mb = gguf_mb(spec.get("gguf"))
        L.append(f"| {spec['model']} | {spec['size']} | {pct(m.get('stm_acc'))} | {pct(m.get('red_flag_recall'))} | {pct(m.get('abstain_precision'))} | "
                 f"{pct(m.get('pijin_glossary_hit_rate'))} | {pct(m.get('note_json_valid'))} | {pct(m.get('over_refer_rate'))} | "
                 f"{num(j.get('mean'))} ({j.get('scored', 0)}/{j.get('n', 0)}) | {num(m.get('gen_tok_s'), 1)} | {f'{mb} MB' if mb else 'hosted'} |")
    wd, bad = teacher_dose_rate(test_rows)
    L += ["", "## Dose audit", "",
          "A reply fails when it contains at least one dose (number + mg/mcg/g/ml, per kg or absolute) that is neither on the manual "
          "excerpt it was given nor that page's per-kg dose times the child's weight (within 15%). Doses are bound to their drug: "
          "a dose counts as supported only when the cited page gives that dose for that same drug (each dose on the page belongs to "
          "the nearest drug name before it, so in a dense dosing table ampicillin's 50 mg/kg does not support 'gentamicin 50 mg/kg'); "
          "a dose bound to a drug that is not on the curated medicine list but looks like one (e.g. -mycin, -profen) is unsupported, "
          "and a dose with no drug name must not belong to two different drugs on the page. Visit-note JSON is skipped. "
          "Rule: `bridge/doseguard.py` = `app/src/runtime/doseguard.ts` (v3, nearest-drug ownership).", "",
          "| Model | Replies with a dose | Unsupported | Rate, model only | Rate, with gate |", "|---|---|---|---|---|"]
    for spec, e in allv:
        da = e.get("dose_audit")
        if not da:
            L.append(f"| {spec['model']} | – | – | – | – |")
            continue
        L.append(f"| {spec['model']} | {da['replies_with_dose']} | {da['unsupported_replies']} | {pct(da['unsupported_rate'])} | {pct(da['system_unsupported_rate'])} |")
    if wd:
        L.append(f"| Teacher reference replies (test set) | {wd} | {bad} | {pct(bad / wd)} | – |")
    L += ["", "## Limitations", ""] + [f"- {x}" for x in limitations(evs, (wd, bad))] + [""]
    return "\n".join(L)


# ----------------------------------------------------------------------------- main
def build(print_md=False):
    known = MODELS + ALTS
    paths = [EVAL_DIR / f"{s['stem']}.json" for s in known if (EVAL_DIR / f"{s['stem']}.json").exists()]
    ensure_scored(paths)
    loaded = {p.stem: d for p in paths if (d := load(p)) is not None}
    evs = [(s, loaded[s["stem"]]) for s in MODELS if s["stem"] in loaded]
    alts = [(s, loaded[s["stem"]]) for s in ALTS if s["stem"] in loaded]
    if not evs:
        raise SystemExit("no eval files found")

    test_rows = {json.loads(l)["id"]: json.loads(l) for l in TEST.open()}
    train_pres = {json.loads(l).get("presentation") for l in TRAIN.open()} if TRAIN.exists() else set()
    unseen = {r.get("presentation") for r in test_rows.values()} - train_pres
    langs = {}
    for r in test_rows.values():
        langs[r["lang"]] = langs.get(r["lang"], 0) + 1
    generated = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    n = max(e["metrics"]["n"] for _, e in evs)

    rows = [row_for(s, e) for s, e in evs]
    samples = pick_samples(evs, test_rows, unseen)
    by = {r["eval"]: r["metrics"] for r in rows}
    t9, t06 = by.get("tuned-qwen3.5-9b-s180"), by.get("tuned-qwen3-0.6b")
    notes = [TEST_SET_TEXT]
    if t9:
        notes.append(f"9B tuned = the shipped River LoRA checkpoint (step 180). With Lokol's rule-based safety gate on top it picks the right "
                     f"action {round(t9.get('system_action_accuracy', 0) * 100)}% of the time and refers "
                     f"{round(t9.get('system_red_flag_recall', 0) * 100)}% of red-flag-list cases; the table shows the model alone.")
    for s, e in alts:
        m = e["metrics"]
        notes.append(f"{s['model']} (not shipped): action {round(m['action_acc'] * 100)}%, danger signs {round(m['red_flag_recall'] * 100)}%, "
                     f"says 'ask a person' {round(m['abstain_recall'] * 100)}%. Step 180 trades danger-sign recall for better abstaining.")
    n_any = evs[0][1]["metrics"].get("n_red_flag")
    notes += [f"Danger signs caught = share of the {n_any} cases whose reference answer is a referral (or whose message has a red-flag word) "
              "that the model refers, now or by next transport.",
              "Abstain precision is undefined when a model never answers ASK_PERSON (base models); it shows as 0%.",
              "tokens/s = generation rate during the eval: llama-server with 4 parallel slots on an M1 Max for the GGUFs, the River hosted API "
              "(network included) for 9B. RAM = the Q4_K_M weight file; the 9B rows ran hosted, so no file size.",
              "Gallery examples were chosen where the tuned replies are right and contain no unsupported dose; the table gives the rates."]
    lims = limitations(evs, teacher_dose_rate(test_rows))
    notes += ["Limitation: " + x for x in lims]

    studio = {
        "sample": False,
        "generated_at": generated,
        "test_set": {"n": n, "path": "data/synth/test.jsonl", "held_out_presentations": len(unseen),
                     "rows_with_unseen_presentation": sum(r.get("presentation") in unseen for r in test_rows.values()), "langs": langs},
        "rows": rows,
        "alt_checkpoints": [row_for(s, e) for s, e in alts],
        "samples": samples,
        "notes": notes,
        "meta": {"test_set": TEST_SET_TEXT, "date": generated, "limitations": lims,
                 "sources": ["eval/*.json (pipeline/eval.py)", "system: pipeline/system_metrics.py", "dose_audit: pipeline/dose_audit.py"]},
    }
    STUDIO_OUT.write_text(json.dumps(studio, indent=2, ensure_ascii=False) + "\n")
    md = markdown(evs, alts, test_rows, generated)
    MD_OUT.write_text(md)
    # eval/results.json: the raw roll-up eval.py --report used to write, refreshed with system + dose_audit
    (EVAL_DIR / "results.json").write_text(json.dumps(
        {"generated": generated, "models": [{"name": e.get("name"), "model": e.get("model"), "data": e.get("data"), "metrics": e["metrics"],
                                             "judge": e.get("judge"), "system": e.get("system"), "dose_audit": e.get("dose_audit")}
                                            for _, e in evs + alts]}, indent=2, ensure_ascii=False) + "\n")
    if print_md:
        print(md)
    print(f"wrote {STUDIO_OUT} ({len(rows)} rows, {len(samples)} samples), {MD_OUT}, {EVAL_DIR / 'results.json'}", file=sys.stderr)
    return studio


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--print", action="store_true")
    a = ap.parse_args(argv)
    build(a.print)


if __name__ == "__main__":
    main()
