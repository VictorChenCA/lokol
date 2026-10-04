# models/ — TRAIN lane runbook

Weights are gitignored. This file holds the exact commands for the real runs and two environment gotchas found during the smoke test.

## Gotchas (read first)

1. **llama.cpp binaries may hang inside a sandboxed shell.** The builder saw `llama-server`, `llama-cli`, `llama-bench` (even `--version`) block in `ggml_metal_library_init` (MTLCompilerService XPC denied). The verifier could not reproduce it: `llama-server` came up in ~8 s inside the sandboxed shell ("using embedded metal library"). If it does hang for you, run it from a normal terminal; `llama-quantize` and the Python converter are CPU-only and run anywhere. `pipeline/eval.py` can reuse a running server via `--server-url http://127.0.0.1:8082`.

4. **Studio Eval page.** `pipeline/eval.py --report` writes three files: `eval/results.md`, `eval/results.json` (raw metrics) and `app/public/eval/results.json` in the `EvalResults` shape that `app/src/pages/Eval.tsx` fetches. Eval names must be `base-<size>` / `tuned-<size>[-suffix]` (e.g. `--name tuned-0.8b`) to land on that page; rows from a stub/smoke run are flagged in `notes`.
2. **mlx-lm 0.32 trains Qwen3.5 through a per-token Python recurrence** (`gated_delta_ops`) for every linear-attention block that needs a gradient (18 of 24 layers). At seq 1–2k that graph makes macOS 26 abort the Metal command buffer ("Impacting Interactivity") or crawl for minutes per step. `pipeline/train_mlx_launch.py` keeps every block below the lowest LoRA'd layer on the fused kernel; `train_mlx.sh` defaults to `LAYERS=8` (6 slow blocks, not yet proven to finish a step) and the smoke test passed with `LAYERS=1` (0 slow blocks: LoRA on the top full-attention layer only, ~0.3 s/iter). For the real runs try `LAYERS=4` (3 slow blocks: layers 20–22) first and fall back to `LAYERS=1` with a higher rank if a step takes more than ~30 s. Fallback per SPEC §4: transformers + PEFT on MPS for 0.8B (chunked gated-delta in torch, not implemented).

3. **Two export fixes are baked into `pipeline/export_gguf.sh`** (both found by value-diffing against `ggml-org/Qwen3.5-0.8B-GGUF`): (a) `convert_hf_to_gguf.py --no-mtp`, because `mlx_lm.fuse` drops the multi-token-prediction head while the config still declares it, so the GGUF otherwise claims 25 blocks and llama.cpp refuses to load it; (b) mlx folds the `+1` of Qwen3.5's `(1 + w)` RMSNorm into the stored norm weights and the converter adds it again, which produced pure gibberish, so the script subtracts 1.0 from every `*_layernorm`, `q_norm`, `k_norm` and final `norm` weight (not `linear_attn.norm`) in a scratch copy `models/fused/<size>-hf/` before converting.

## Smoke result (30 iters, LoRA on 1 layer, 40 stub rows; 20 held-out stub rows)

| model | format | ACTION acc | STM acc |
|---|---|---|---|
| base 0.8B Q4_K_M | 0.00 | 0.00 | 0.00 |
| tuned 0.8B Q4_K_M (smoke) | 0.90 | 0.60 | 0.90 |

## Real runs

```bash
cd ~/Documents/GitHub/Lokol
set -a; . ./.env; set +a

# 9B on River (~15 min, a few dollars)
.venv/bin/python pipeline/train_river.py --data data/synth/train.jsonl --val data/synth/val.jsonl \
  --base Qwen/Qwen3.5-9B --steps 180 --batch 32 --lr 2e-4 --rank 16 --save-every 30 --val-n 40 \
  --out models/river/lokol-health-9b
# -> models/river/lokol-health-9b/checkpoint.json (best river:// inference path), steps.jsonl, val_samples.jsonl

# 0.8B / 2B locally (data/mlx/<size>/{train,valid,test}.jsonl from the DATA lane; mlx chat format)
LAYERS=4 BATCH=4 MAXLEN=1024 pipeline/train_mlx.sh 0.8B           # 600 iters -> models/adapters/0.8B, models/fused/0.8B
LAYERS=4 BATCH=4 MAXLEN=1024 pipeline/train_mlx.sh 2B
SMOKE=0 pipeline/export_gguf.sh 0.8B                              # f16 + Q4_K_M GGUF (sandbox-safe)
SMOKE=0 pipeline/export_gguf.sh 2B
# outside the sandbox: bench + protocol smoke
/opt/homebrew/opt/llama.cpp/bin/llama-bench -m models/gguf/lokol-health-0.8b-Q4_K_M.gguf -p 256 -n 64 -r 3 | tee models/logs/bench_0.8B.txt
/opt/homebrew/opt/llama.cpp/bin/llama-server -m models/gguf/lokol-health-0.8b-Q4_K_M.gguf --port 8082 -c 8192 -np 4 --jinja -ngl 99 &

# eval (test set), tuned vs base; --judge 60 adds the headless-Claude faithfulness score
.venv/bin/python pipeline/eval.py --model models/gguf/qwen3.5-0.8b-base-Q4_K_M.gguf --server-url http://127.0.0.1:8082 --name base-0.8b --data data/synth/test.jsonl --out eval/base-0.8b.json --judge 60
.venv/bin/python pipeline/eval.py --model models/gguf/lokol-health-0.8b-Q4_K_M.gguf   --server-url http://127.0.0.1:8082 --name tuned-0.8b --data data/synth/test.jsonl --out eval/tuned-0.8b.json --judge 60
.venv/bin/python pipeline/eval.py --model base --base Qwen/Qwen3.5-9B --name base-9b --data data/synth/test.jsonl --out eval/base-9b.json --judge 60
.venv/bin/python pipeline/eval.py --model "$(jq -r .best.inference models/river/lokol-health-9b/checkpoint.json)" --base Qwen/Qwen3.5-9B --name tuned-9b --data data/synth/test.jsonl --out eval/tuned-9b.json --judge 60
.venv/bin/python pipeline/eval.py --report "eval/*.json" --out eval/results.md       # also writes eval/results.json for the Studio Eval page

# upload GGUFs (writes models/gguf/manifest-<size>.json with url/sha256/size_mb for the pack manifest)
.venv/bin/python pipeline/upload_hf.py --sizes 0.8B 2B --base --dry-run
.venv/bin/python pipeline/upload_hf.py --sizes 0.8B 2B --base
```

## Layout

- `gguf/` — `qwen3.5-0.8b-base-Q4_K_M.gguf` (baseline, quantized from ggml-org BF16), `lokol-health-<size>-{f16,Q4_K_M}.gguf`, `manifest-*.json`
- `adapters/<size>/` — mlx LoRA adapters; `fused/<size>/` — merged HF-layout bf16 model (input to the GGUF converter)
- `river/<run>/` — `checkpoint.json`, `steps.jsonl`, `val_samples.jsonl`
- `logs/` — training logs, `bench_<size>.txt`, `llama-server-8082.log`
