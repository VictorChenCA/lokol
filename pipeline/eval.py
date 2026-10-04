"""Evaluate a Lokol Health model on the SPEC §2 protocol. SPEC §4.

    .venv/bin/python pipeline/eval.py --model models/gguf/qwen3.5-0.8b-base-Q4_K_M.gguf --data data/synth/test.jsonl --out eval/base-0.8b.json
    .venv/bin/python pipeline/eval.py --model models/gguf/lokol-health-0.8b-Q4_K_M.gguf --data data/synth/test.jsonl --out eval/tuned-0.8b.json --judge 60
    .venv/bin/python pipeline/eval.py --model river://... --base Qwen/Qwen3.5-9B --data data/synth/test.jsonl --out eval/tuned-9b.json
    .venv/bin/python pipeline/eval.py --model base --base Qwen/Qwen3.5-9B ...                 # untuned 9B via River
    .venv/bin/python pipeline/eval.py --model mlx:models/fused/0.8B ...                       # mlx-lm generate (fused or hub id)
    .venv/bin/python pipeline/eval.py --model <gguf> --smoke                                   # one protocol prompt, print the raw reply
    .venv/bin/python pipeline/eval.py --report eval/*.json --out eval/results.md              # base-vs-tuned table (+ eval/results.json)

Backends: *.gguf -> llama-server on --port (started here unless --server-url is reachable), OpenAI-compatible endpoint with
enable_thinking=false; river:// or "base" -> River sample (checkpoint or base model); mlx:<path> -> mlx_lm.generate.
Metrics: format compliance, ACTION accuracy, STM accuracy, red-flag recall, abstain precision/recall, Pijin glossary
hit-rate, note-JSON validity, per-task/per-language breakdown, latency, and an LLM-judge faithfulness score (0-3,
headless `claude -p --model sonnet`) on --judge N items.
"""
import argparse, glob, json, os, re, shutil, socket, statistics, subprocess, sys, time
# posix_spawn instead of fork: forking a process that holds River's gRPC client (or macOS XPC) aborts the child
# ("Python quit unexpectedly"). subprocess uses posix_spawn on macOS when the executable is an absolute path and close_fds=False.
CLAUDE_BIN = shutil.which("claude") or os.path.expanduser("~/.local/bin/claude")
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
from train_common import (ACTIONS, REFER, SYSTEM_PROMPT, glossary_hits, has_red_flag, parse_reply, prompt_messages,  # noqa: E402
                          read_jsonl, row_labels, user_turn)

LLAMA_BIN = os.environ.get("LLAMA_BIN", "/opt/homebrew/opt/llama.cpp/bin")
MAX_TOKENS = 220
NOTE_KEYS = {"age_months", "weight_kg", "symptoms", "danger_signs", "assessment_per_stm", "action", "drugs", "follow_up", "referral"}

SMOKE_ROW = {"flags": {"rdt": "yes", "act": "yes", "transport": "next_boat"}, "lang": "pis",
             "guideline": {"section": "MALARIA", "page": 53, "text": "All children with fever should have a malaria test (RDT or blood slide). Uncomplicated malaria: artemether-lumefantrine by weight twice daily for 3 days with food: 5-14 kg 1 tablet per dose, 15-24 kg 2 tablets, 25-34 kg 3 tablets. Severe malaria (unable to drink, convulsions, lethargy, severe anaemia, jaundice): give artesunate IM or rectal and refer urgently."},
             "message": "Pikinini 3 yia, 14 kg, hot bodi 2 dei. RDT hem positive. Hem drink gud. Wanem mi givim?"}

# ----------------------------------------------------------------------------- backends
class LlamaServer:
    def __init__(self, gguf, port=8081, url=None, parallel=4, ctx=4096):
        import httpx
        self.httpx = httpx
        self.url = url or f"http://127.0.0.1:{port}"
        self.proc = None
        if not self._alive():
            cmd = [f"{LLAMA_BIN}/llama-server", "-m", gguf, "--port", str(port), "--host", "127.0.0.1", "-c", str(ctx * parallel),
                   "-np", str(parallel), "--jinja", "-ngl", "99"]
            print(f"[eval] starting {' '.join(cmd)}", file=sys.stderr)
            self.proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, close_fds=False)
            for _ in range(600):
                if self._alive(): break
                if self.proc.poll() is not None: raise RuntimeError("llama-server exited early")
                time.sleep(0.2)
            else:
                raise RuntimeError("llama-server did not come up")
        self.parallel = parallel

    def _alive(self):
        try:
            return self.httpx.get(self.url + "/health", timeout=1.0).status_code == 200
        except Exception:
            return False

    def complete(self, messages):
        t0 = time.time()
        r = self.httpx.post(self.url + "/v1/chat/completions", json={
            "messages": messages, "max_tokens": MAX_TOKENS, "temperature": 0, "chat_template_kwargs": {"enable_thinking": False}},
            timeout=300)
        r.raise_for_status()
        j = r.json()
        text = j["choices"][0]["message"]["content"] or ""
        # some builds put the empty think block into reasoning_content; the content is what we score
        usage = j.get("usage", {})
        return text, {"secs": round(time.time() - t0, 3), "completion_tokens": usage.get("completion_tokens"), "prompt_tokens": usage.get("prompt_tokens")}

    def close(self):
        if self.proc:
            self.proc.terminate()
            try: self.proc.wait(5)
            except Exception: self.proc.kill()

class RiverBackend:
    def __init__(self, checkpoint, base):
        import river_client as river
        try:
            import river_client.client as _rc
            _rc._SAMPLE_POLL_INTERVAL_SECS = 0.05
        except Exception:
            pass
        from river_client.renderers import get_renderer
        self.river = river
        self.base = base
        self.ckpt = None if checkpoint in ("base", "", None) else checkpoint
        self.R = get_renderer(base, thinking=False)
        self.client = river.Client(api_key=os.environ["RIVER_API_KEY"])
        self.session_ctx = self.client.session(experiment="lokol-eval")
        self.session = self.session_ctx.__enter__()
        self.parallel = 8

    def complete(self, messages):
        prompt = self.R.build_sample_prompt(messages).to_kwargs()["prompt"]
        t0 = time.time()
        kw = dict(max_tokens=MAX_TOKENS, temperature=0.0)
        if self.ckpt:
            out = self.session.sample([prompt], base_model=self.base, checkpoint=self.ckpt, **kw)[0][0]
        else:
            out = self.client.sample([prompt], base_model=self.base, **kw)[0]
        return out.text or "", {"secs": round(time.time() - t0, 3), "completion_tokens": len(out.tokens or [])}

    def close(self):
        try: self.session_ctx.__exit__(None, None, None)
        except Exception: pass
        self.client.close()

class MlxBackend:
    def __init__(self, path, adapter=None):
        from mlx_lm import load, generate
        self.generate = generate
        self.model, self.tok = load(path, adapter_path=adapter)
        self.parallel = 1

    def complete(self, messages):
        prompt = self.tok.apply_chat_template(messages, add_generation_prompt=True, enable_thinking=False, tokenize=False)
        t0 = time.time()
        text = self.generate(self.model, self.tok, prompt=prompt, max_tokens=MAX_TOKENS, verbose=False)
        return text, {"secs": round(time.time() - t0, 3)}

    def close(self):
        pass

def make_backend(a):
    m = a.model
    if m.endswith(".gguf"):
        return LlamaServer(m, port=a.port, url=a.server_url)
    if m.startswith("river://") or m == "base":
        return RiverBackend(m, a.base)
    if m.startswith("mlx:"):
        return MlxBackend(m[4:], a.adapter)
    if m.startswith("http"):
        return LlamaServer(None, url=m)
    raise SystemExit(f"unknown model spec {m!r}")

# ----------------------------------------------------------------------------- scoring
def score(rows, preds):
    n = len(rows)
    labs = [row_labels(r) for r in rows]
    parsed = [parse_reply(p["text"]) for p in preds]
    fmt = [p["ok"] for p in parsed]
    act_ok = [p["action"] == l["action"] for p, l in zip(parsed, labs)]
    stm_ok = [(p["stm"] or "").strip().upper() == (l["stm"] or "").strip().upper() for p, l in zip(parsed, labs)]
    red_idx = [i for i, l in enumerate(labs) if l["red_flag"] or l["action"] in REFER]
    red_recall = (sum(parsed[i]["action"] in REFER for i in red_idx) / len(red_idx)) if red_idx else None
    # strict red-flag recall: rows whose message matches the red-flag list (the gate target)
    strict_idx = [i for i, l in enumerate(labs) if l["red_flag"]]
    strict_recall = (sum(parsed[i]["action"] in REFER for i in strict_idx) / len(strict_idx)) if strict_idx else None
    gold_abs = [l["action"] == "ASK_PERSON" for l in labs]
    pred_abs = [p["action"] == "ASK_PERSON" for p in parsed]
    tp = sum(g and p for g, p in zip(gold_abs, pred_abs)); fp = sum((not g) and p for g, p in zip(gold_abs, pred_abs)); fn = sum(g and not p for g, p in zip(gold_abs, pred_abs))
    abstain_p = tp / (tp + fp) if tp + fp else None
    abstain_r = tp / (tp + fn) if tp + fn else None
    pis_idx = [i for i, l in enumerate(labs) if l["lang"] == "pis" and labs[i]["task"] != "note"]
    hits = [glossary_hits(parsed[i]["body"]) for i in pis_idx]
    pijin_rate = (sum(h >= 3 for h in hits) / len(hits)) if hits else None
    note_idx = [i for i, l in enumerate(labs) if l["task"] == "note"]
    note_ok = (sum(parsed[i]["json"] is not None and NOTE_KEYS <= set(parsed[i]["json"]) for i in note_idx) / len(note_idx)) if note_idx else None
    over_refer = sum(parsed[i]["action"] in REFER for i, l in enumerate(labs) if l["action"] == "ADVISE") / max(1, sum(l["action"] == "ADVISE" for l in labs))
    secs = [p["meta"].get("secs") for p in preds if p["meta"].get("secs")]
    ctoks = [p["meta"].get("completion_tokens") for p in preds if p["meta"].get("completion_tokens")]
    def group(key):
        out = {}
        for k in sorted({l[key] for l in labs if l[key]}):
            idx = [i for i, l in enumerate(labs) if l[key] == k]
            out[k] = {"n": len(idx), "format": round(sum(fmt[i] for i in idx) / len(idx), 3),
                      "action_acc": round(sum(act_ok[i] for i in idx) / len(idx), 3), "stm_acc": round(sum(stm_ok[i] for i in idx) / len(idx), 3)}
        return out
    r3 = lambda x: None if x is None else round(x, 3)
    return {
        "n": n,
        "format_compliance": r3(sum(fmt) / n), "action_acc": r3(sum(act_ok) / n), "stm_acc": r3(sum(stm_ok) / n),
        "red_flag_recall": r3(red_recall), "red_flag_recall_strict": r3(strict_recall), "n_red_flag": len(red_idx),
        "abstain_precision": r3(abstain_p), "abstain_recall": r3(abstain_r), "n_abstain": sum(gold_abs),
        "pijin_glossary_hit_rate": r3(pijin_rate), "pijin_glossary_mean_hits": r3(statistics.mean(hits)) if hits else None, "n_pijin": len(pis_idx),
        "note_json_valid": r3(note_ok), "n_note": len(note_idx), "over_refer_rate": r3(over_refer),
        "latency_s_mean": r3(statistics.mean(secs)) if secs else None, "latency_s_p95": r3(sorted(secs)[int(0.95 * (len(secs) - 1))]) if secs else None,
        "completion_tokens_mean": r3(statistics.mean(ctoks)) if ctoks else None,
        "gen_tok_s": r3(sum(ctoks) / sum(secs)) if ctoks and secs and len(ctoks) == len(secs) else None,
        "per_task": group("task"), "per_lang": group("lang"),
    }, parsed, labs

# ----------------------------------------------------------------------------- judge
JUDGE_PROMPT = """You are grading a small assistant for nurse aides in Solomon Islands. It must follow the guideline excerpt
(from the Standard Treatment Manual for Children), never diagnose, refer on danger signs, and answer in the nurse's language.

GUIDELINE EXCERPT:
{guideline}

NURSE MESSAGE (flags: {flags}):
{message}

MODEL REPLY:
{reply}

Score faithfulness 0-3: 3 = every instruction/dose/action is supported by the excerpt and the referral decision is right;
2 = mostly right, one minor unsupported or missing detail; 1 = substantial error or unsupported dose/advice; 0 = wrong action,
dangerous, off-topic, or not in the protocol format. Reply with JSON only: {{"score": <0-3>, "reason": "<one sentence>"}}"""

def judge_one(row, text):
    user = next((m["content"] for m in (row.get("messages") or []) if m["role"] == "user"), None)
    if user:
        lines = user.split("\n", 2)
        flags, guideline, message = lines[0], lines[1] if len(lines) > 1 else "none", lines[2] if len(lines) > 2 else ""
    else:
        flags, guideline, message = json.dumps(row.get("flags")), json.dumps(row.get("guideline")), row.get("message", "")
    prompt = JUDGE_PROMPT.format(guideline=guideline, flags=flags, message=message, reply=text)
    env = {k: v for k, v in os.environ.items() if k not in ("CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT")}
    try:
        out = subprocess.run([CLAUDE_BIN, "-p", "--model", "sonnet", "--output-format", "json"], input=prompt, capture_output=True, close_fds=False,
                             text=True, timeout=180, env=env)
        res = json.loads(out.stdout).get("result", "")
        m = re.search(r"\{.*\}", res, re.S)
        j = json.loads(m.group(0)) if m else {}
        return {"score": int(j.get("score")), "reason": j.get("reason", "")}
    except Exception as e:
        return {"score": None, "reason": f"judge error: {type(e).__name__}: {e}"[:200]}

def run_judge(rows, preds, n, workers=4):
    idx = list(range(min(n, len(rows))))
    with ThreadPoolExecutor(workers) as ex:
        res = list(ex.map(lambda i: judge_one(rows[i], preds[i]["text"]), idx))
    scores = [r["score"] for r in res if r["score"] is not None]
    return {"n": len(idx), "scored": len(scores), "mean": round(statistics.mean(scores), 3) if scores else None,
            "dist": {str(k): scores.count(k) for k in range(4)}}, res

# ----------------------------------------------------------------------------- report
def load_bench(size):
    p = ROOT / "models" / "logs" / f"bench_{size}.txt"
    if not p.exists():
        return {}
    out = {}
    for line in p.read_text().splitlines():
        m = re.search(r"\|\s*(pp\d+|tg\d+)\s*\|\s*([\d.]+)\s*±", line)
        if m:
            out[m.group(1)] = float(m.group(2))
    return out

def report(paths, out_md):
    # Default target: pipeline/report_studio.py owns eval/results.md, eval/results.json and the Studio results.json
    # (adds the with-gate and dose-audit columns, samples and limitations). A custom --out keeps the plain table below.
    if Path(out_md).resolve() == (ROOT / "eval" / "results.md").resolve() and (HERE / "report_studio.py").exists():
        import report_studio
        report_studio.main(["--print"])
        return
    evs = []
    for p in paths:
        for f in sorted(glob.glob(p)):
            if f.endswith(".json") and not f.endswith("results.json"):
                try:
                    j = json.loads(Path(f).read_text())
                    if "metrics" in j: evs.append(j)
                except Exception:
                    pass
    cols = [("format_compliance", "Format"), ("action_acc", "ACTION acc"), ("stm_acc", "STM acc"), ("red_flag_recall", "Red-flag recall"),
            ("abstain_precision", "Abstain P"), ("abstain_recall", "Abstain R"), ("pijin_glossary_hit_rate", "Pijin ≥3 glossary"),
            ("note_json_valid", "Note JSON"), ("over_refer_rate", "Over-refer")]
    lines = ["# Lokol Health eval: base vs tuned", "",
             f"Held-out test rows per model in the `n` column. Protocol metrics are exact-match on the strict SPEC §2 format; the judge is headless Claude (sonnet) scoring guideline faithfulness 0–3 on the first N items. Generated {time.strftime('%Y-%m-%d %H:%M')}.", "",
             "| Model | n | " + " | ".join(c for _, c in cols) + " | Judge 0–3 | gen tok/s |", "|" + "---|" * (len(cols) + 4)]
    fmt = lambda v: "–" if v is None else (f"{v:.2f}" if isinstance(v, float) else str(v))
    for e in sorted(evs, key=lambda e: e.get("name", "")):
        m = e["metrics"]; j = (e.get("judge") or {}).get("mean")
        lines.append(f"| {e.get('name')} | {m['n']} | " + " | ".join(fmt(m.get(k)) for k, _ in cols) + f" | {fmt(j)} | {fmt(m.get('gen_tok_s'))} |")
    lines += ["", "## On-device speed (llama-bench, M1 Max, Q4_K_M)", "", "| model | pp256 tok/s | tg64 tok/s | file MB |", "|---|---|---|---|"]
    BENCH_SIZES = {"base-0.8B": "qwen3.5-0.8b-base-Q4_K_M.gguf", "0.8B": "lokol-health-0.8b-Q4_K_M.gguf", "2B": "lokol-health-2b-Q4_K_M.gguf",
                   "4B": "lokol-health-4b-Q4_K_M.gguf", "9B": "lokol-health-9b-Q4_K_M.gguf"}
    for size, fname in BENCH_SIZES.items():
        b = load_bench(size)
        gg = ROOT / "models" / "gguf" / fname
        if b or gg.exists():
            mb = round(gg.stat().st_size / 1e6) if gg.exists() else "–"
            lines.append(f"| {size} | {fmt(b.get('pp256'))} | {fmt(b.get('tg64'))} | {mb} |")
    lines += ["", "## Per-task ACTION accuracy", ""]
    tasks = sorted({t for e in evs for t in e["metrics"]["per_task"]})
    lines += ["| Model | " + " | ".join(tasks) + " |", "|" + "---|" * (len(tasks) + 1)]
    for e in sorted(evs, key=lambda e: e.get("name", "")):
        pt = e["metrics"]["per_task"]
        lines.append(f"| {e.get('name')} | " + " | ".join(fmt(pt.get(t, {}).get("action_acc")) for t in tasks) + " |")
    Path(out_md).write_text("\n".join(lines) + "\n")
    (Path(out_md).parent / "results.json").write_text(json.dumps(
        {"generated": time.strftime("%Y-%m-%dT%H:%M:%S"), "models": [{"name": e.get("name"), "model": e.get("model"), "data": e.get("data"),
         "metrics": e["metrics"], "judge": e.get("judge")} for e in evs],
         "bench": {s: load_bench(s) for s in ["base-0.8B", "0.8B", "2B", "4B", "9B"] if load_bench(s)}}, indent=2))
    studio = write_studio_results(evs)
    print("\n".join(lines))
    print(f"\nwrote {out_md}, {Path(out_md).parent / 'results.json'}" + (f" and {studio}" if studio else ""))

def write_studio_results(evs):
    """The Studio Eval page (app/src/pages/Eval.tsx) fetches /eval/results.json in the EvalResults shape of app/src/types.ts:
    rows[{model,size,variant,runtime,metrics{format_compliance,action_accuracy,stm_accuracy,red_flag_recall,abstain_precision,
    abstain_recall,pijin_glossary_hit_rate,judge_faithfulness_0_3,tokens_per_s?,ram_mb?}}]. Eval names must look like
    base-0.8b / tuned-0.8b / tuned-9b[-suffix]; other names are skipped. Returns the written path or None."""
    if (HERE / "report_studio.py").exists():  # the full Studio shape (rows + per_lang/per_task + samples + meta)
        import report_studio
        report_studio.build()
        return report_studio.STUDIO_OUT
    out = ROOT / "app" / "public" / "eval" / "results.json"
    if not out.parent.exists():
        return None
    rows, notes, n_test, data_path = [], [], 0, ""
    for e in evs:
        m = re.match(r"(base|tuned)-(\d+(?:\.\d+)?b)(?:-(.+))?$", (e.get("name") or "").lower())
        if not m:
            continue
        variant, size, suffix = m.group(1), m.group(2).upper(), m.group(3)
        met, j = e["metrics"], (e.get("judge") or {}).get("mean")
        bench = load_bench(f"base-{size}" if variant == "base" else size)
        gg = ROOT / "models" / "gguf" / (f"qwen3.5-{size.lower()}-base-Q4_K_M.gguf" if variant == "base" else f"lokol-health-{size.lower()}-Q4_K_M.gguf")
        river = str(e.get("model", "")).startswith("river://") or e.get("model") == "base"
        rows.append({"model": (f"Lokol-Health-{size}" if variant == "tuned" else f"Qwen3.5-{size}") + (f" ({suffix})" if suffix else ""),
                     "size": size, "variant": variant, "runtime": "River LoRA r16" if river and variant == "tuned" else ("River (hosted)" if river else "llama.cpp Q4_K_M"),
                     "metrics": {"format_compliance": met.get("format_compliance") or 0, "action_accuracy": met.get("action_acc") or 0,
                                 "stm_accuracy": met.get("stm_acc") or 0, "red_flag_recall": met.get("red_flag_recall") or 0,
                                 "abstain_precision": met.get("abstain_precision") or 0, "abstain_recall": met.get("abstain_recall") or 0,
                                 "pijin_glossary_hit_rate": met.get("pijin_glossary_hit_rate") or 0, "judge_faithfulness_0_3": j if j is not None else 0,
                                 **({"tokens_per_s": round(bench.get("tg64") or met.get("gen_tok_s") or 0)} if (bench.get("tg64") or met.get("gen_tok_s")) else {}),
                                 **({"ram_mb": round(gg.stat().st_size / 1e6)} if gg.exists() else {})}})
        n_test = max(n_test, met.get("n", 0)); data_path = data_path or str(e.get("data", ""))
        if suffix or "stub" in str(e.get("data", "")):
            notes.append(f"{e.get('name')}: smoke run on {e.get('data')} ({met.get('n')} rows), not the held-out test set.")
    if not rows:
        return None
    notes += ["Protocol metrics are exact-match on the SPEC §2 format; judge is headless Claude (sonnet) faithfulness 0–3 (0 when not run).",
              "tokens_per_s is llama-bench tg64 on an M1 Max (or the eval's generation rate); ram_mb is the Q4_K_M weight file size."]
    out.write_text(json.dumps({"sample": False, "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "test_set": {"n": n_test, "path": data_path},
                               "rows": rows, "notes": notes}, indent=2))
    return out

# ----------------------------------------------------------------------------- main
def fewshot_turns(n):
    """Gold exemplars from style_guide.md (same regex synth.py uses), never test rows.
    Order: exemplar 1 (guidance / Pijin), exemplar 4 (referral / English)."""
    if not n:
        return []
    text = (ROOT / "pipeline/style_guide.md").read_text(encoding="utf-8")
    ex = {int(m.group(1)): (m.group(4).strip(), m.group(5).strip()) for m in re.finditer(
        r"### exemplar (\d+): (\w+) / (\w+)[^\n]*\n\s*```user\n(.*?)\n```\s*```assistant\n(.*?)\n```", text, re.S)}
    turns = []
    for k in [1, 4][:n]:
        u, asst = ex[k]
        turns += [{"role": "user", "content": u}, {"role": "assistant", "content": asst}]
    return turns

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", help="path.gguf | river://... | base | mlx:<path> | http://host:port")
    ap.add_argument("--base", default="Qwen/Qwen3.5-9B", help="River base model for river:// or base")
    ap.add_argument("--adapter", default=None, help="mlx adapter path for mlx: backend")
    ap.add_argument("--data", default=str(ROOT / "data/synth/test.jsonl"))
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--out", default=None)
    ap.add_argument("--name", default=None, help="label in results.md (default: model basename)")
    ap.add_argument("--port", type=int, default=8081)
    ap.add_argument("--server-url", default=None, help="reuse a running llama-server instead of starting one")
    ap.add_argument("--judge", type=int, default=0, help="LLM-judge the first N items with headless Claude")
    ap.add_argument("--workers", type=int, default=None)
    ap.add_argument("--smoke", action="store_true", help="one protocol prompt; print the raw reply and exit")
    ap.add_argument("--report", nargs="*", default=None, help="eval json globs -> markdown table at --out")
    ap.add_argument("--fewshot", type=int, default=0, help="prepend N gold exemplars from style_guide.md as prior turns (prompted baseline; max 2: guidance/pis, referral/en)")
    a = ap.parse_args()

    if a.report is not None:
        report(a.report or [str(ROOT / "eval/*.json")], a.out or str(ROOT / "eval/results.md"))
        return
    if not a.model:
        ap.error("--model is required")

    be = make_backend(a)
    try:
        if a.smoke:
            msgs = [{"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_turn(SMOKE_ROW["flags"], SMOKE_ROW["guideline"], SMOKE_ROW["message"], "pis")}]
            text, meta = be.complete(msgs)
            p = parse_reply(text)
            print("--- prompt (user turn) ---\n" + msgs[1]["content"] + "\n--- reply ---\n" + text + "\n--- parsed ---")
            print(json.dumps({"format_ok": p["ok"], "action": p["action"], "stm": p["stm"], **meta}, ensure_ascii=False))
            sys.exit(0 if p["ok"] else 1)

        rows = read_jsonl(a.data, a.limit)
        if not rows:
            raise SystemExit(f"no rows in {a.data}")
        workers = a.workers or getattr(be, "parallel", 1)
        t0 = time.time()
        shots = fewshot_turns(a.fewshot)
        def one(r):
            try:
                msgs = prompt_messages(r)
                if shots:
                    msgs = msgs[:1] + shots + msgs[1:]
                text, meta = be.complete(msgs)
            except Exception as e:
                text, meta = "", {"error": f"{type(e).__name__}: {e}"[:200]}
            return {"text": text, "meta": meta}
        with ThreadPoolExecutor(workers) as ex:
            preds = list(ex.map(one, rows))
        wall = time.time() - t0
        metrics, parsed, labs = score(rows, preds)
        metrics["wall_s"] = round(wall, 1)
        res = {"name": a.name or Path(a.model).stem, "model": a.model, "data": a.data, "metrics": metrics,
               **({"fewshot": a.fewshot, "variant": "fewshot"} if a.fewshot else {})}
        if a.judge:
            res["judge"], jres = run_judge(rows, preds, a.judge)
        else:
            jres = []
        res["predictions"] = [{"id": r.get("id"), "gold": l, "pred": {"action": p["action"], "stm": p["stm"], "format_ok": p["ok"]},
                               "text": pr["text"], "meta": pr["meta"], **({"judge": jres[i]} if i < len(jres) else {})}
                              for i, (r, l, p, pr) in enumerate(zip(rows, labs, parsed, preds))]
        print(json.dumps({k: v for k, v in metrics.items() if k not in ("per_task", "per_lang")}, indent=1))
        print("per_task:", json.dumps(metrics["per_task"]))
        print("per_lang:", json.dumps(metrics["per_lang"]))
        if a.judge:
            print("judge:", json.dumps(res["judge"]))
        for ex_ in res["predictions"][:3]:
            print(f"\n[{ex_['id']}] gold={ex_['gold']['action']}/{ex_['gold']['stm']} pred={ex_['pred']['action']}/{ex_['pred']['stm']}\n{ex_['text'][:400]}")
        if a.out:
            Path(a.out).parent.mkdir(parents=True, exist_ok=True)
            Path(a.out).write_text(json.dumps(res, indent=1, ensure_ascii=False))
            print(f"\nwrote {a.out}")
    finally:
        be.close()

if __name__ == "__main__":
    main()
