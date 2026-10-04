"""LoRA SFT of Qwen3.5-9B on River for the Lokol Health protocol. SPEC §4. Streams one JSON line per step.

    set -a; . ./.env; set +a
    .venv/bin/python pipeline/train_river.py --data data/synth/train.jsonl --val data/synth/val.jsonl \
        --base Qwen/Qwen3.5-9B --steps 180 --batch 32 --lr 2e-4 --rank 16 --out models/river/lokol-health-9b
    .venv/bin/python pipeline/train_river.py --data data/stub/train.jsonl --val data/stub/val.jsonl --steps 5 --batch 8 \
        --val-n 10 --out models/river/smoke                       # 5-step smoke (cents)
    .venv/bin/python pipeline/train_river.py --data ... --dry-run  # render examples, print token stats, no River calls

Rows: SPEC §2 protocol rows (see train_common.py; `messages` or the explicit fields). Writes <out>/steps.jsonl (per-step loss),
<out>/checkpoint.json (river:// inference+training paths, val metrics, best by ACTION+STM exact match) and
<out>/val_samples.jsonl (the last validation generations). Resume with --init river://<training checkpoint>.
"""
import argparse, json, os, random, statistics, sys, time
from contextlib import closing
from datetime import timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
from train_common import build_messages, parse_reply, prompt_messages, read_jsonl, row_labels  # noqa: E402

def emit(obj, fh=None):
    line = json.dumps(obj, ensure_ascii=False)
    print(line, flush=True)
    if fh:
        fh.write(line + "\n"); fh.flush()

def render_examples(rows, R, max_length):
    from river_client.renderers import TrainOnWhat
    exs, dropped = [], 0
    for r in rows:
        try:
            ex = R.build_training_example(build_messages(r), train_on=TrainOnWhat.LAST_ASSISTANT, train_on_eos=True, max_length=max_length)
            exs.append(ex.to_dict())
        except Exception as e:
            dropped += 1
            if dropped <= 3:
                print(f"[warn] dropped row {r.get('id')}: {type(e).__name__}: {e}", file=sys.stderr)
    return exs, dropped

def n_tokens(ex):
    return sum(len(c.get("tokens", [])) for c in ex["model_input"] if isinstance(c, dict))

def validate(model, R, val_rows, max_tokens=220):
    """sample the val prompts greedily; -> (metrics, samples)"""
    prompts = [R.build_sample_prompt(prompt_messages(r)).to_kwargs()["prompt"] for r in val_rows]
    t0 = time.time()
    outs = model.sample(prompts, max_tokens=max_tokens, temperature=0.0, poll_interval=0.05)
    texts = [(o[0].text if o else "") or "" for o in outs]
    labs = [row_labels(r) for r in val_rows]
    parsed = [parse_reply(t) for t in texts]
    n = len(val_rows)
    fmt = sum(p["ok"] for p in parsed) / n
    act = sum(p["action"] == l["action"] for p, l in zip(parsed, labs)) / n
    stm = sum((p["stm"] or "").upper() == (l["stm"] or "").upper() for p, l in zip(parsed, labs)) / n
    both = sum(p["action"] == l["action"] and (p["stm"] or "").upper() == (l["stm"] or "").upper() for p, l in zip(parsed, labs)) / n
    m = {"n": n, "format": round(fmt, 3), "action_acc": round(act, 3), "stm_acc": round(stm, 3), "exact": round(both, 3), "secs": round(time.time() - t0, 1)}
    samples = [{"id": r.get("id"), "gold": l, "pred": {"action": p["action"], "stm": p["stm"], "ok": p["ok"]}, "text": t}
               for r, l, p, t in zip(val_rows, labs, parsed, texts)]
    return m, samples

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=str(ROOT / "data/synth/train.jsonl"), help="jsonl path(s), comma-separated")
    ap.add_argument("--val", default=str(ROOT / "data/synth/val.jsonl"))
    ap.add_argument("--base", default="Qwen/Qwen3.5-9B")
    ap.add_argument("--steps", type=int, default=180)
    ap.add_argument("--batch", type=int, default=32)
    ap.add_argument("--lr", type=float, default=2e-4)
    ap.add_argument("--rank", type=int, default=16)
    ap.add_argument("--save-every", type=int, default=30)
    ap.add_argument("--val-n", type=int, default=40, help="val prompts sampled at each checkpoint")
    ap.add_argument("--max-length", type=int, default=2048)
    ap.add_argument("--name", default=f"lokol-health-9b-{time.strftime('%m%d-%H%M%S')}")
    ap.add_argument("--init", default=None, help="river:// training checkpoint to continue from")
    ap.add_argument("--out", default=str(ROOT / "models/river/lokol-health-9b"))
    ap.add_argument("--experiment", default="lokol-health")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    rows = read_jsonl(a.data)
    val = read_jsonl(a.val)
    if not rows:
        raise SystemExit(f"no training rows in {a.data}")
    rng = random.Random(a.seed)
    rng.shuffle(val)
    val = val[:a.val_n]

    from river_client.renderers import get_renderer
    R = get_renderer(a.base, thinking=False)
    exs, dropped = render_examples(rows, R, a.max_length)
    rng.shuffle(exs)
    toks = [n_tokens(e) for e in exs]
    emit({"event": "start", "base": a.base, "rows": len(rows), "examples": len(exs), "dropped": dropped, "val_rows": len(val),
          "tokens_mean": round(statistics.mean(toks), 1), "tokens_max": max(toks), "steps": a.steps, "batch": a.batch, "lr": a.lr,
          "rank": a.rank, "name": a.name, "epochs": round(a.steps * a.batch / max(1, len(exs)), 2)})
    if a.dry_run:
        print(json.dumps({"first_example_tokens": toks[0], "weights_nonzero": sum(1 for w in exs[0]["weights"] if w)}, indent=1))
        return

    import river_client as river
    steps_fh = open(out / "steps.jsonl", "w")
    ckpts, best = [], None
    t0 = time.time()
    with closing(river.Client(api_key=os.environ["RIVER_API_KEY"])) as client:
        with client.session(experiment=a.experiment) as session:
            model = session.create_model(base_model=a.base, lora=river.LoraConfig(rank=a.rank, seed=a.seed))
            if a.init:
                model.load_weights(a.init, load_optimizer=True)
                emit({"event": "init", "checkpoint": a.init})
            cur = 0
            for step in range(1, a.steps + 1):
                if cur + a.batch > len(exs):
                    rng.shuffle(exs); cur = 0
                batch = exs[cur:cur + a.batch]; cur += a.batch
                fb, opt = model.train_step(batch, lr=a.lr, loss_fn="cross_entropy")
                loss = fb.metrics.get("loss_mean", fb.metrics.get("loss"))
                rec = {"step": step, "loss": loss, "elapsed_s": round(time.time() - t0, 1)}
                if step % a.save_every == 0 or step == a.steps:
                    inf = model.save_weights(f"{a.name}-s{step:03d}-inf", mode="inference")
                    trn = model.save_weights(f"{a.name}-s{step:03d}-train", mode="training", ttl=timedelta(days=30))
                    vm, samples = validate(model, R, val) if val else ({}, [])
                    c = {"step": step, "inference": inf.path, "training": trn.path, "val": vm, "loss": loss}
                    ckpts.append(c)
                    key = vm.get("exact", -1) + 0.5 * vm.get("format", 0) if vm else -1
                    if best is None or key >= best.get("_key", -1):
                        best = {**c, "_key": key}
                    rec.update(checkpoint=inf.path, val=vm)
                    (out / "checkpoint.json").write_text(json.dumps(
                        {"base": a.base, "name": a.name, "best": {k: v for k, v in best.items() if k != "_key"}, "checkpoints": ckpts,
                         "data": a.data, "examples": len(exs), "lr": a.lr, "rank": a.rank, "batch": a.batch, "steps": a.steps}, indent=2))
                    if samples:
                        (out / "val_samples.jsonl").write_text("".join(json.dumps(s, ensure_ascii=False) + "\n" for s in samples))
                emit(rec, steps_fh)
    emit({"event": "done", "best": {k: v for k, v in (best or {}).items() if k != "_key"}, "elapsed_s": round(time.time() - t0, 1),
          "checkpoint_json": str(out / "checkpoint.json")})

if __name__ == "__main__":
    main()
