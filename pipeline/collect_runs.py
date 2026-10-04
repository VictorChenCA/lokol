"""Collect training runs and the dataset card for the Studio Train page.

    .venv/bin/python pipeline/collect_runs.py            # writes app/public/train/{runs,dataset}.json
    .venv/bin/python pipeline/collect_runs.py --print    # also prints a one-line summary per run
    nohup nice -n 10 .venv/bin/python pipeline/collect_runs.py --watch 60 > models/logs/collect_runs_watch.log 2>&1 &
                                                         # re-collects runs.json every 60 s; exits 5 min after the last
                                                         # mlx train/fuse/export process ends

Idempotent: re-run it any time (for example while the River 9B run is still appending to steps.jsonl, or after the
local mlx queue finishes). Reads only; never touches the training processes.

Inputs
  data/synth/stats.json, data/DATA_CARD.md, data/synth/{train,val,test}.jsonl     -> dataset.json (DatasetCard)
  models/river/*/{steps.jsonl,checkpoint.json,val_samples.jsonl}, models/logs/river_9b.log
  models/logs/train_mlx_*.log (latest per tag), models/logs/{queue,local_jobs}.log events,
  models/adapters/<tag>/, models/fused/<tag>/, models/gguf/                        -> runs.json (TrainRuns)
  An mlx run is "done" once its log shows the final iteration and models/fused/<tag>/ holds the fused model.
Shapes: TrainRuns / DatasetCard in app/src/types.ts (below the '// TRAIN-EVAL types below' marker).
"""
import argparse, json, os, re, subprocess, sys, time, traceback
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "app" / "public" / "train"
ANSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")
NOW = time.time()

# River pricing was not published in the docs we used; keep the assumption explicit and in one place.
RIVER_USD_PER_M_TRAIN_TOKENS = 1.50   # assumed LoRA training rate for a 9B base
TEACHER_USD = {"prompt": 0.30, "completion": 1.20}  # assumed $/M tokens, same as DATA_CARD.md §7

CATALOG = {  # tag / run dir -> (catalog id, display name, tier, base model, size label)
    "qwen3-0.6b": ("lokol-health-qwen3-0.6b", "Lokol Health 0.6B", "A", "Qwen/Qwen3-0.6B", "0.6B"),
    "0.8B": ("lokol-health-qwen3.5-0.8b", "Lokol Health 0.8B", "A", "Qwen/Qwen3.5-0.8B", "0.8B"),
    "qwen3-1.7b": ("lokol-health-qwen3-1.7b", "Lokol Health 1.7B", "B", "Qwen/Qwen3-1.7B", "1.7B"),
    "lokol-health-9b": ("lokol-health-qwen3.5-9b", "Lokol Health 9B", "D", "Qwen/Qwen3.5-9B", "9B"),
}


def iso(ts):
    return datetime.fromtimestamp(ts).astimezone().isoformat(timespec="seconds")


def read_jsonl(p):
    out = []
    if not Path(p).exists():
        return out
    for line in Path(p).read_text(errors="replace").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            pass  # a half-written last line while training appends
    return out


def clean(text):
    return ANSI.sub("", text).replace("\r", "\n")


# ----------------------------------------------------------------------------- River runs
def river_runs():
    runs = []
    base = ROOT / "models" / "river"
    if not base.exists():
        return runs
    river_log = ROOT / "models" / "logs" / "river_9b.log"
    log_events = []
    if river_log.exists():
        for line in clean(river_log.read_text(errors="replace")).splitlines():
            if line.startswith("{"):
                try:
                    log_events.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
    for d in sorted(p for p in base.iterdir() if p.is_dir()):
        steps_p, ck_p = d / "steps.jsonl", d / "checkpoint.json"
        steps = [s for s in read_jsonl(steps_p) if isinstance(s.get("step"), int)]
        ck = json.loads(ck_p.read_text()) if ck_p.exists() else {}
        is_main = d.name == "lokol-health-9b"
        start = next((e for e in log_events if e.get("event") == "start"), {}) if is_main else {}
        done_ev = next((e for e in log_events if e.get("event") == "done"), None) if is_main else None
        total = int(ck.get("steps") or start.get("steps") or (steps[-1]["step"] if steps else 0))
        done_n = steps[-1]["step"] if steps else 0
        elapsed = steps[-1].get("elapsed_s", 0) if steps else 0
        mtime = max((p.stat().st_mtime for p in (steps_p, ck_p) if p.exists()), default=d.stat().st_mtime)
        failed = is_main and river_log.exists() and "Traceback" in river_log.read_text(errors="replace")
        if done_ev or (total and done_n >= total):
            status = "done"
        elif failed:
            status = "failed"
        elif NOW - mtime < 15 * 60:
            status = "running"
        else:
            status = "stopped"
        eta = None
        if status == "running" and len(steps) >= 3:
            recent = steps[-10:]
            per = (recent[-1]["elapsed_s"] - recent[0]["elapsed_s"]) / max(1, recent[-1]["step"] - recent[0]["step"])
            eta = round(per * (total - done_n) + 90 * max(0, (total // 30) - (done_n // 30)))  # + ~90 s per checkpoint/val
        batch = int(ck.get("batch") or start.get("batch") or 0)
        tok_mean = float(start.get("tokens_mean") or 539.4)
        trained_tokens = done_n * batch * tok_mean
        val = [{"step": s["step"], **s["val"]} for s in steps if isinstance(s.get("val"), dict)]
        ckpts = []
        for c in ck.get("checkpoints", []):
            ckpts.append({"step": c["step"], "id": c.get("inference"), "kind": "inference"})
            if c.get("training"):
                ckpts.append({"step": c["step"], "id": c["training"], "kind": "training"})
        if not ckpts:
            ckpts = [{"step": s["step"], "id": s["checkpoint"], "kind": "inference"} for s in steps if s.get("checkpoint")]
        cat = CATALOG.get(d.name)
        smoke = not is_main
        examples = int(ck.get("examples") or start.get("examples") or 0)
        runs.append({
            "id": f"river-{d.name}",
            "name": cat[1] if cat else f"River smoke ({d.name})",
            "catalog_id": cat[0] if cat else None,
            "tier": cat[2] if cat else None,
            "backend": "river",
            "where": "River (hosted GPUs)",
            "base_model": ck.get("base") or start.get("base") or "Qwen/Qwen3.5-9B",
            "smoke": smoke,
            "status": status,
            "started_at": iso(mtime - elapsed) if steps else None,
            "updated_at": iso(mtime),
            "config": {"steps": total, "batch": batch, "lr": ck.get("lr") or start.get("lr"), "rank": ck.get("rank") or start.get("rank"),
                       "examples": examples, "epochs": start.get("epochs") or (round(total * batch / examples, 2) if examples else None),
                       "max_seq": 2048, "data": ck.get("data") or ("data/synth/train.jsonl" if is_main else None)},
            "steps_done": done_n,
            "steps_total": total,
            "elapsed_s": elapsed,
            "eta_s": eta,
            "loss": [{"step": s["step"], "loss": round(float(s["loss"]), 4)} for s in steps if s.get("loss") is not None],
            "val_loss": [],
            "val": val,
            "checkpoints": ckpts,
            "best": ck.get("best"),
            "trained_tokens": round(trained_tokens),
            "cost_usd_est": round(trained_tokens / 1e6 * RIVER_USD_PER_M_TRAIN_TOKENS, 2),
            "cost_note": f"Estimate: {trained_tokens/1e6:.1f}M tokens processed x an assumed ${RIVER_USD_PER_M_TRAIN_TOKENS:.2f}/M; the River console has the billed amount.",
            "artifact": "river:// LoRA adapter (r16), exported to GGUF Q4_K_M for laptops" if is_main else "river:// LoRA adapter",
            "log": str((d / "steps.jsonl").relative_to(ROOT)),
            "note": "LoRA on Qwen3.5-9B with the River renderer; validation samples 40 val prompts greedily every 30 steps." if is_main
                    else "5-step smoke test of the River training loop on 40 stub rows.",
        })
    return runs


# ----------------------------------------------------------------------------- mlx runs
# mlx-lm 0.32 prints a coloured table; after stripping ANSI codes the rows read
#   "   120    1.297 ▼       67     77.5k"   iter, train_loss (+ trend arrow), tok/s, cumulative tokens
#   "   200    val 1.168    36.49s"          iter, val loss, seconds the val pass took
# Older mlx-lm prints "Iter N: Train loss X, ... Tokens/sec Y" and "Iter N: Val loss X"; both are parsed.
ROW_VAL = re.compile(r"^\s*(\d+)\s+val\s+([\d.]+)(?:\s+([\d.]+)s)?\s*$")
ROW_TRAIN = re.compile(r"^\s*(\d+)\s+([\d.]+)\s*[▼▲=]?\s+(\d+)\s+([\d.]+[kKMG]?)\s*$")
STD_TRAIN = re.compile(r"Iter (\d+): Train loss ([\d.]+)(?:.*?It/sec ([\d.]+))?(?:.*?Tokens/sec ([\d.]+))?(?:.*?Trained Tokens (\d+))?")
STD_VAL = re.compile(r"Iter (\d+): Val loss ([\d.]+)")
FINISHED = re.compile(r"Saved final weights|100%\s*·?\s*\d+\s*/\s*\d+")
JOB_EVENT = re.compile(r"\[(?:queue|jobs) (\d\d:\d\d:\d\d)\] (start|train|trained|exported|FAILED train|FAILED export) (\S+)")
TRAIN_PROC = re.compile(r"train_mlx_launch\.py|mlx_lm[. ]lora|mlx_lm[. ]fuse|train_mlx\.sh|export_gguf(?:_std)?\.sh")
WHERE_MLX = "This Mac (Apple M1 Max, mlx-lm)"

# Runs that were cancelled before they trained: left off the page, kept in runs.json under "cancelled" with the reason.
CANCELLED = {
    "0.8B": "Cancelled: Qwen3.5's linear attention trains too slowly on Apple silicon, so the phone tiers moved to Qwen3.",
}
# Runs stopped on purpose that ship an earlier checkpoint than their last one (step -> the adapter fused into the GGUF).
SHIPPED = {"qwen3-0.6b": 300}
GGUF_NAME = {"qwen3-0.6b": "lokol-health-qwen3-0.6b-Q4_K_M.gguf", "0.8B": "lokol-health-0.8b-Q4_K_M.gguf",
             "qwen3-1.7b": "lokol-health-qwen3-1.7b-Q4_K_M.gguf"}


def tokens_num(s):
    mult = {"k": 1e3, "K": 1e3, "M": 1e6, "G": 1e9}.get(s[-1:], 1)
    return round(float(s.rstrip("kKMG")) * mult)


def parse_mlx_log(p):
    text = clean(p.read_text(errors="replace"))
    lines = text.splitlines()
    if lines and not text.endswith("\n"):
        lines = lines[:-1]  # the last line may still be half-written while training appends
    info = {"loss": [], "val_loss": [], "tok_s": [], "tokens": None}
    for line in lines:
        s = line.strip("│ ").strip()
        if m := re.match(r"model\s+(\S+)", s):
            info["model"] = m.group(1)
        elif m := re.match(r"type\s+lora\s*·\s*(\d+)\s*layers\s*·\s*rank\s*(\d+)", s):
            info["layers"], info["rank"] = int(m.group(1)), int(m.group(2))
        elif m := re.match(r"dataset\s+(\S+)", s):
            info["data"] = m.group(1)
        elif m := re.match(r"optimizer\s+\w+\s*·\s*lr\s*([\d.e+-]+)", s):
            info["lr"] = float(m.group(1))
        elif m := re.match(r"batch\s*·\s*iters\s+(\d+)\s*·\s*([\d,]+)", s):
            info["batch"], info["iters"] = int(m.group(1)), int(m.group(2).replace(",", ""))
        elif m := re.match(r"max seq\s+([\d,]+)", s):
            info["max_seq"] = int(m.group(1).replace(",", ""))
        elif m := re.match(r"Trainable parameters:\s*([\d.]+)%\s*\(([\d.]+)M/([\d.]+)M\)", s):
            info["trainable_pct"], info["trainable_m"], info["total_m"] = float(m.group(1)), float(m.group(2)), float(m.group(3))
        if m := ROW_VAL.match(line):
            info["val_loss"].append({"step": int(m.group(1)), "loss": float(m.group(2))})
        elif m := ROW_TRAIN.match(line):
            info["loss"].append({"step": int(m.group(1)), "loss": float(m.group(2))})
            info["tok_s"].append(float(m.group(3)))
            info["tokens"] = tokens_num(m.group(4))
        elif m := STD_VAL.search(line):
            info["val_loss"].append({"step": int(m.group(1)), "loss": float(m.group(2))})
        elif m := STD_TRAIN.search(line):
            info["loss"].append({"step": int(m.group(1)), "loss": float(m.group(2))})
            if m.group(4):
                info["tok_s"].append(float(m.group(4)))
            if m.group(5):
                info["tokens"] = int(m.group(5))
    last = info["loss"][-1]["step"] if info["loss"] else 0
    info["finished"] = bool(FINISHED.search(text)) or bool(info.get("iters") and last >= info["iters"])
    info["failed"] = "Traceback" in text or "RuntimeError" in text
    info["error"] = next((l.strip() for l in reversed(lines) if "Error" in l), None) if info["failed"] else None
    return info


def job_events():
    """Per tag, the queue/jobs events since that tag's latest start ('trained', 'FAILED train', 'exported <gguf stem>' ...)."""
    events = {}
    for name in ("queue.log", "local_jobs.log"):
        p = ROOT / "models" / "logs" / name
        if not p.exists():
            continue
        for m in JOB_EVENT.finditer(clean(p.read_text(errors="replace"))):
            kind, tag = m.group(2), m.group(3)
            if kind in ("start", "train"):
                events[tag] = []  # a new attempt; earlier outcomes belong to the earlier log
            events.setdefault(tag, []).append(kind)
    return events


def train_procs():
    """Command lines of live mlx training / fuse / export processes (ps is cheap; no psutil in the venv)."""
    try:
        out = subprocess.run(["ps", "-axo", "command="], capture_output=True, text=True, timeout=10).stdout
    except Exception:
        return []
    return [l for l in out.splitlines() if TRAIN_PROC.search(l) and "collect_runs" not in l]


def mlx_runs(procs=None):
    procs = train_procs() if procs is None else procs
    logs_dir = ROOT / "models" / "logs"
    events = job_events()
    by_tag = {}
    for p in logs_dir.glob("train_mlx_*.log"):
        if m := re.match(r"train_mlx_(.+)_(\d{6})\.log$", p.name):
            by_tag.setdefault(m.group(1), []).append(p)
    runs = []
    for tag, logs in sorted(by_tag.items()):
        if tag in CANCELLED:
            continue
        logs.sort(key=lambda p: p.stat().st_mtime)
        log, earlier = logs[-1], logs[:-1]  # the latest attempt is the run; earlier logs count as attempts
        smoke = tag.endswith("-verify") or tag not in CATALOG
        cat = CATALOG.get(tag)
        info = parse_mlx_log(log)
        mtime = log.stat().st_mtime
        hhmmss = re.search(r"_(\d{6})\.log$", log.name).group(1)
        day = datetime.fromtimestamp(mtime)
        start_ts = day.replace(hour=int(hhmmss[:2]), minute=int(hhmmss[2:4]), second=int(hhmmss[4:]), microsecond=0).timestamp()
        if start_ts > mtime:
            start_ts -= 86400
        ev = events.get(tag, [])
        iters = info.get("iters") or 0
        last = info["loss"][-1]["step"] if info["loss"] else 0
        fused = ROOT / "models" / "fused" / tag
        fused_ok = (fused / "config.json").exists() and any(fused.glob("*.safetensors")) and fused.stat().st_mtime >= start_ts
        alive = any(f"models/adapters/{tag} " in c + " " or f" {tag} " in c + " " for c in procs)
        shipped = SHIPPED.get(tag)
        if shipped:
            status = "done"
        elif info["failed"] or "FAILED train" in ev:
            status = "failed"
        elif info["finished"] and (smoke or fused_ok or "trained" in ev) and not alive:  # alive = fuse still writing
            status = "done"
        elif alive or NOW - mtime < 6 * 60:
            status = "running"
        else:
            status = "stopped"
        elapsed = round((NOW if status == "running" else mtime) - start_ts)
        eta = None
        if status == "running" and last and iters:
            per_iter = (mtime - start_ts) / last
            eta = max(0, round(per_iter * (iters - last) - (NOW - mtime)))
        adapter_dir = ROOT / "models" / "adapters" / tag
        ckpts = [{"step": int(c.name[:7]), "id": str(c.relative_to(ROOT)), "kind": "adapter"}
                 for c in sorted(adapter_dir.glob("*_adapters.safetensors"))] if adapter_dir.exists() else []
        gguf_name = GGUF_NAME.get(tag)
        gguf = ROOT / "models" / "gguf" / gguf_name if gguf_name else None
        gguf_ready = bool(gguf and gguf.exists() and (("exported" in events.get(gguf_name.replace("-Q4_K_M.gguf", ""), []))
                                                      or NOW - gguf.stat().st_mtime > 180))
        vals = {v["step"]: v["loss"] for v in info["val_loss"]}
        best = None
        if shipped:
            best = {"step": shipped, "loss": vals.get(shipped), "training": f"models/adapters/{tag}/{shipped:07d}_adapters.safetensors"}
            if gguf_ready:
                best["inference"] = f"models/gguf/{gguf_name}"
        elif status == "done" and not smoke and info["val_loss"]:
            final = vals.get(last)
            best = {"step": last, "loss": final, "training": f"models/adapters/{tag}/adapters.safetensors"} if final is not None else None
        runs.append({
            "id": f"mlx-{tag}",
            "name": cat[1] if cat else f"mlx smoke ({tag})",
            "catalog_id": cat[0] if cat else None,
            "tier": cat[2] if cat else None,
            "backend": "mlx",
            "where": WHERE_MLX,
            "base_model": info.get("model") or (cat[3] if cat else None),
            "smoke": smoke,
            "status": status,
            "started_at": iso(start_ts),
            "updated_at": iso(mtime),
            "config": {"steps": iters, "batch": info.get("batch"), "lr": info.get("lr"), "rank": info.get("rank"),
                       "layers": info.get("layers"), "max_seq": info.get("max_seq"), "data": info.get("data"),
                       "trainable_pct": info.get("trainable_pct"), "trainable_m": info.get("trainable_m"), "total_m": info.get("total_m")},
            "steps_done": last,
            # a run stopped on purpose is complete at the step it stopped; config.steps keeps the plan
            "steps_total": last if shipped else iters,
            "elapsed_s": elapsed,
            "eta_s": eta,
            "tokens_per_s": round(sum(info["tok_s"]) / len(info["tok_s"])) if info["tok_s"] else None,
            "loss": info["loss"],
            "val_loss": info["val_loss"],
            "val": [],
            "checkpoints": ckpts,
            "best": best,
            "trained_tokens": info["tokens"],
            "gguf": {"file": gguf.name, "size_mb": round(gguf.stat().st_size / 1e6, 1)} if (gguf_ready and status == "done" and not smoke) else None,
            "cost_usd_est": 0,
            "cost_note": "Local Apple silicon; no cloud cost.",
            "attempts": len(earlier),
            "error": info.get("error"),
            "log": str(log.relative_to(ROOT)),
            "note": run_note(tag, status, info, vals, last, iters, fused_ok) if not smoke
                    else "30-iteration smoke test of train, fuse and GGUF export on 40 stub rows.",
        })
    return runs


def lowest_val(vals):
    real = {s: v for s, v in vals.items() if s > 1}  # step 1 is the untrained baseline
    return min(real.items(), key=lambda kv: kv[1]) if real else None


def run_note(tag, status, info, vals, last, iters, fused_ok):
    low = lowest_val(vals)
    if tag in SHIPPED:
        s = SHIPPED[tag]
        v = vals.get(s)
        after = [(st, x) for st, x in sorted(vals.items()) if st > s]
        rose = f" once validation loss rose ({after[0][1]:.3f} at step {after[0][0]})" if after and v is not None and after[0][1] > v else ""
        ship = f"Shipped checkpoint: step {s} (val {v:.3f})" if v is not None else f"Shipped checkpoint: step {s}"
        if low and low[0] == s:
            ship += ", the lowest validation loss"
        return (f"{ship}. Planned {iters} iterations; stopped on purpose at {last}{rose}. "
                + base_note(tag))
    if status == "running" and info["finished"] and not fused_ok:
        return f"Training finished at step {last}; fusing the adapter into the base model, then GGUF export. " + base_note(tag)
    if status == "done" and last in vals:
        tail = f"Fused from the final adapter, step {last} (val {vals[last]:.3f})"
        if low and low[0] != last:
            tail += f"; lowest validation loss {low[1]:.3f} at step {low[0]}"
        return tail + ". " + base_note(tag)
    return base_note(tag)


def base_note(tag):
    if tag == "qwen3-0.6b":
        return "Standard attention, so all 28 layers get LoRA; the default phone-tier model because wllama runs Qwen3 in the browser."
    if tag == "qwen3-1.7b":
        return "Everyday-phone tier (3 to 5 GB RAM); same data and recipe as 0.6B, all 28 layers."
    return ""


# ----------------------------------------------------------------------------- dataset card
NOT_COVERED_HEAD = re.compile(r"^- \*\*(.+?)\*\*\s*(.*)$")


def not_covered():
    p = ROOT / "data" / "DATA_CARD.md"
    if not p.exists():
        return []
    text = p.read_text()
    m = re.search(r"## \d+\. What this dataset does not cover[^\n]*\n(.*?)(?:\n## |\Z)", text, re.S)
    if not m:
        return []
    items, cur = [], None
    for line in m.group(1).splitlines():
        if line.startswith("- "):
            if cur:
                items.append(cur)
            h = NOT_COVERED_HEAD.match(line)
            if h:
                cur = {"title": h.group(1).rstrip("."), "body": h.group(2).strip()}
            else:
                cur = {"title": line[2:].strip(), "body": ""}
        elif cur and line.strip():
            cur["body"] = (cur["body"] + " " + line.strip()).strip()
    if cur:
        items.append(cur)
    for it in items:
        it["body"] = re.sub(r"`([^`]*)`", r"\1", it["body"])
        if it["body"][:1].islower():  # "**Dialect and regional variation** across provinces..." reads as one sentence
            it["body"] = f"{it['title']} {it['body']}"
    return items


def count(rows, key):
    out = {}
    for r in rows:
        v = r.get(key)
        if isinstance(v, str):
            out[v] = out.get(v, 0) + 1
    return dict(sorted(out.items(), key=lambda kv: -kv[1]))


def action_of(r):
    m = re.match(r"ACTION:\s*(\S+)", r.get("assistant") or "")
    return m.group(1) if m else None


RED_FLAG_NAMES = [  # validate.py stores the matching regex; map it to the plain-language red flag (SPEC §2 list)
    ("young_infant_fever", "fever under 2 months"), ("fontanel", "bulging fontanelle"), ("burn", "burns of face or airway"),
    ("susu|dring|drink|feed|suck|breast", "unable to drink or breastfeed"), ("chest", "chest indrawing"),
    ("sek|fit|convuls|seizure", "convulsions"), ("slip tumas|letharg|floppy|wekap|drowsy|unconscious", "lethargic or unconscious"),
    ("tor(o)?aot|vomit", "vomits everything"), ("nek|neck", "stiff neck"), ("sunken|skin pinch", "severe dehydration"),
    ("legs|feet|fut|wasting", "severe malnutrition"), ("grunting|silent chest|cyanos", "breathing danger sign"),
    ("bleeding", "bleeding"), ("talk|speak", "cannot talk"),
]


def red_flag_name(pat):
    for key, name in RED_FLAG_NAMES:
        if any(k in pat for k in key.split("|")):
            return name
    return "danger sign"


def to_sample(r):
    a = r.get("assistant") or ""
    head, _, body = a.partition("\n---\n")
    stm = re.search(r"STM:\s*(.+)", head)
    note = None
    if r.get("task") == "note":
        try:
            note = json.loads(body)
        except Exception:
            note = None
    user = r.get("user") or ""
    lines = user.split("\n")
    message = "\n".join(lines[2:]).strip() if len(lines) > 2 else user
    gl = re.match(r"\[guideline:\s*(.+?)(?:\s+p(\d+))?\]\s*(.*)", lines[1] if len(lines) > 1 else "")
    excerpt = (gl.group(3) if gl else "").strip()
    return {
        "id": r.get("id"), "task": r.get("task"), "lang": r.get("lang"), "flags": r.get("flags"),
        "guideline_mode": r.get("guideline_mode"),
        "guideline": None if (not gl or gl.group(1).strip().lower() == "none") else
        {"section": gl.group(1).strip(), "page": int(gl.group(2)) if gl.group(2) else None,
         "excerpt": (excerpt[:260] + "...") if len(excerpt) > 260 else excerpt},
        "message": message, "action": action_of(r), "stm": stm.group(1).strip() if stm else None,
        "reply": body.strip(), "note": note, "red_flags": sorted({red_flag_name(p) for p in (r.get("red_flags_detected") or [])}),
        "teacher": (r.get("teacher") or "").split("/")[-1], "age_months": r.get("age_months"), "weight_kg": r.get("weight_kg"),
    }


def pick_samples(rows):
    """6 rows: 3 Pijin, 3 English; one red-flag referral, one abstain, one visit-note JSON (deterministic)."""
    def first(pred, taken):
        for r in rows:
            if r["id"] not in taken and pred(r):
                return r
        return None
    short = lambda r, n=420: len(r.get("user", "")) < 1400 and len(r.get("assistant", "")) < n
    pis_words = re.compile(r"\b(blong|hem|pikinini|mi|garem|bebi|sik|nao)\b", re.I)
    plain_en = lambda r: not pis_words.search((r.get("user") or "").split("\n", 2)[-1])
    common = lambda r: (r.get("section") or "") in ("MALARIA", "DIARRHOEA", "PNEUMONIA", "FEVER", "COUGH OR DIFFICULT BREATHING")
    picks, taken = [], set()
    wants = [
        lambda r: r["lang"] == "pis" and r["task"] == "referral" and r.get("red_flags_detected") and action_of(r) == "REFER_NOW" and short(r),
        lambda r: r["lang"] == "en" and r["task"] == "abstain" and action_of(r) == "ASK_PERSON" and short(r, 380) and plain_en(r),
        lambda r: r["lang"] == "en" and r["task"] == "note" and short(r, 900) and r.get("guideline_mode") == "match" and plain_en(r) and common(r),
        lambda r: r["lang"] == "pis" and r["task"] == "guidance" and action_of(r) == "ADVISE" and r.get("guideline_mode") == "match" and short(r, 420) and common(r),
        lambda r: r["lang"] == "pis" and r["task"] == "abstain" and r.get("guideline_mode") in ("none", "wrong") and short(r, 380),
        lambda r: r["lang"] == "en" and r["task"] == "referral" and action_of(r) == "REFER_NEXT_TRANSPORT" and short(r, 480) and plain_en(r),
    ]
    for w in wants:
        r = first(w, taken)
        if r is None and w is wants[2]:
            r = first(lambda x: x["lang"] == "en" and x["task"] == "note" and short(x, 900) and plain_en(x), taken)
        if r is None and w is wants[3]:
            r = first(lambda x: x["lang"] == "pis" and x["task"] == "guidance" and action_of(x) == "ADVISE" and short(x, 420), taken)
        if r is None and w is wants[5]:
            r = first(lambda x: x["lang"] == "en" and x["task"] == "referral" and action_of(x) in ("REFER_NEXT_TRANSPORT", "REFER_NOW") and short(x, 520) and plain_en(x), taken)
        if r:
            picks.append(r); taken.add(r["id"])
    return [to_sample(r) for r in picks]


def dataset_card():
    stats_p = ROOT / "data" / "synth" / "stats.json"
    stats = json.loads(stats_p.read_text()) if stats_p.exists() else {}
    train = read_jsonl(ROOT / "data" / "synth" / "train.jsonl")
    val = read_jsonl(ROOT / "data" / "synth" / "val.jsonl")
    test = read_jsonl(ROOT / "data" / "synth" / "test.jsonl")
    allrows = train + val + test
    chunks = read_jsonl(ROOT / "corpus" / "stm_children_chunks.jsonl")
    sections_p = ROOT / "corpus" / "sections.json"
    n_sections = len(json.loads(sections_p.read_text())) if sections_p.exists() else 56
    usage = stats.get("usage", {})
    teacher_cost = (usage.get("prompt_tokens", 0) / 1e6 * TEACHER_USD["prompt"] + usage.get("completion_tokens", 0) / 1e6 * TEACHER_USD["completion"])
    rejected = stats.get("rejected", {})
    lang_train = count(train, "lang")
    return {
        "generated_at": iso(NOW),
        "sample": False,
        "synthetic": True,
        "source": {"title": "Solomon Islands Standard Treatment Manual for Children", "edition": "4th edition, 2017",
                   "publisher": "Ministry of Health and Medical Services, Solomon Islands", "pages": 125,
                   "sections": n_sections, "chunks": len(chunks) or 183, "sections_covered": stats.get("sections_covered"),
                   "license": "No license statement; indexed and cited, not redistributed."},
        "teachers": [{"name": k, "rows": v, "access": "River inference API, open weights"} for k, v in (stats.get("counts", {}).get("train", {}).get("teacher") or {}).items()] or
                    [{"name": "DeepSeek-V4.1-Flash", "rows": 0, "access": "River"}, {"name": "Kimi-K2.6-NVFP4", "rows": 0, "access": "River"}],
        "judge": {"model": "Claude Sonnet (headless)", **{k: stats.get("judge", {}).get(k) for k in
                  ("n_sampled", "n_scored", "faithfulness_mean", "faithfulness_hist", "action_ok_rate", "pijin_mean", "faithfulness_by_lang")}},
        "pipeline": {"raw": stats.get("raw"), "valid": stats.get("valid"), "rejected_total": sum(rejected.values()),
                     "rejected": rejected, "rules": len(rejected) - 1 if "duplicate" in rejected else len(rejected),
                     "calls": usage.get("calls"), "prompt_tokens": usage.get("prompt_tokens"), "completion_tokens": usage.get("completion_tokens"),
                     "teacher_cost_usd_est": round(teacher_cost, 2),
                     "teacher_cost_note": f"Assumed ${TEACHER_USD['prompt']}/M prompt and ${TEACHER_USD['completion']}/M completion tokens (DATA_CARD.md §7)."},
        "splits": {"train": len(train), "val": len(val), "test": len(test)},
        "held_out_presentations": stats.get("presentations_held_out", []),
        "counts": {"task": count(train, "task"), "lang": lang_train, "action": count([{"a": action_of(r)} for r in train], "a"),
                   "guideline_mode": count(train, "guideline_mode")},
        "counts_all": {"task": count(allrows, "task"), "lang": count(allrows, "lang"),
                       "action": count([{"a": action_of(r)} for r in allrows], "a")},
        "red_flag_rows": sum(1 for r in train if r.get("red_flags_detected")),
        "samples": pick_samples(train),
        "not_covered": not_covered(),
    }


def write_json(path, obj):
    """Write via a temp file and rename, so the page polling runs.json never reads a half-written file."""
    tmp = path.with_name(f".{path.name}.tmp")
    tmp.write_text(json.dumps(obj, indent=1, ensure_ascii=False))
    os.replace(tmp, path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(OUT))
    ap.add_argument("--print", action="store_true")
    ap.add_argument("--watch", type=int, default=0, metavar="SECS",
                    help="re-collect runs.json every SECS seconds while mlx training runs; exits after --idle-exit seconds with none running")
    ap.add_argument("--idle-exit", type=int, default=300, metavar="SECS", help="with --watch: exit once no mlx training process has run for this long (default 300)")
    a = ap.parse_args()
    global NOW
    if not a.watch:
        collect(a)
        return
    # Watch mode: dataset.json once (it does not change while training; it reads the 11 MB train split), runs.json every tick.
    collect(a)
    last_seen = time.time()
    while True:
        time.sleep(a.watch)
        NOW = time.time()
        procs = train_procs()
        if procs:
            last_seen = NOW
        try:
            collect(a, dataset=False, procs=procs)
        except Exception:
            traceback.print_exc()
        sys.stdout.flush()
        if NOW - last_seen >= a.idle_exit:
            print(f"[watch {datetime.now():%H:%M:%S}] no mlx training process for {a.idle_exit}s; final collect done, exiting")
            return


def collect(a, dataset=True, procs=None):
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    runs = river_runs() + mlx_runs(procs)
    order = {"running": 0, "queued": 2, "done": 1, "stopped": 3, "failed": 4}
    runs.sort(key=lambda r: (r["smoke"], {"D": 0, "B": 1, "A": 2}.get(r.get("tier") or "", 3), order.get(r["status"], 5)))
    cancelled = [{"id": f"mlx-{t}", "name": CATALOG[t][1] if t in CATALOG else t, "base_model": CATALOG[t][3] if t in CATALOG else None,
                  "reason": why} for t, why in CANCELLED.items()]
    tr = {"generated_at": iso(NOW), "sample": False, "runs": runs, "cancelled": cancelled}
    write_json(out / "runs.json", tr)
    msg = f"[{datetime.now():%H:%M:%S}] wrote {out/'runs.json'} ({len(runs)} runs"
    live = [r for r in runs if r["status"] == "running"]
    msg += "".join(f"; {r['id']} {r['steps_done']}/{r['steps_total']}" for r in live) + ")"
    if dataset:
        card = dataset_card()
        write_json(out / "dataset.json", card)
        msg += f" and {out/'dataset.json'} ({card['splits']})"
    print(msg)
    if a.print:
        for r in runs:
            last = r["loss"][-1]["loss"] if r["loss"] else None
            print(f"  {r['id']:<28} {r['status']:<8} {r['steps_done']}/{r['steps_total']} loss={last} smoke={r['smoke']}")


if __name__ == "__main__":
    main()
