#!/usr/bin/env bash
# Sequential local jobs, ONE model at a time (Victor, 23:00): eval 0.6B base vs tuned -> train 1.7B -> export -> eval 1.7B base vs tuned.
# llama.cpp needs Metal shader compilation, so run this outside the sandbox.
set -uo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
LOG=models/logs/local_jobs.log
say(){ echo "[jobs $(date +%H:%M:%S)] $*" | tee -a "$LOG"; }
snap(){ ls -d ~/.cache/huggingface/hub/models--mlx-community--$1/snapshots/*/ 2>/dev/null | head -1; }
evalg(){ # name gguf
  say "eval $1"
  nice -n 10 .venv/bin/python pipeline/eval.py --model "$2" --name "$1" --data data/synth/test.jsonl --out "eval/$1.json" --judge 60 --workers 4 --port 8095 >> "$LOG" 2>&1 \
    && say "evaluated $1: $(python3 -c "import json;m=json.load(open('eval/$1.json'))['metrics'];print({k:m.get(k) for k in ('format_compliance','action_acc','stm_acc','red_flag_recall','abstain_recall','gen_tok_s')})")" \
    || say "FAILED eval $1"
}

# 0. wait for the base 0.6B export started at 22:59
true
[ -f models/gguf/qwen3-0.6b-base-Q4_K_M.gguf ] || say "WARN base 0.6B Q4 missing"

# 1. 0.6B base vs tuned
evalg base-qwen3-0.6b  models/gguf/qwen3-0.6b-base-Q4_K_M.gguf
evalg tuned-qwen3-0.6b models/gguf/lokol-health-qwen3-0.6b-Q4_K_M.gguf

# 2. train 1.7B (350 iters, all layers), fuse, export
say "train qwen3-1.7b"
if MODEL=mlx-community/Qwen3-1.7B-bf16 LAYERS=28 BATCH=4 LR=1.5e-4 MAXLEN=1280 nice -n 5 pipeline/train_mlx.sh qwen3-1.7b data/mlx/0.8B 350 >> "$LOG" 2>&1; then
  say "trained qwen3-1.7b"
  nice -n 10 pipeline/export_gguf_std.sh lokol-health-qwen3-1.7b models/fused/qwen3-1.7b >> "$LOG" 2>&1 && say "exported lokol-health-qwen3-1.7b" || say "FAILED export 1.7b"
  nice -n 10 pipeline/export_gguf_std.sh qwen3-1.7b-base "$(snap Qwen3-1.7B-bf16)" >> "$LOG" 2>&1 && say "exported qwen3-1.7b-base" || say "FAILED export 1.7b base"
  evalg base-qwen3-1.7b  models/gguf/qwen3-1.7b-base-Q4_K_M.gguf
  evalg tuned-qwen3-1.7b models/gguf/lokol-health-qwen3-1.7b-Q4_K_M.gguf
else
  say "FAILED train qwen3-1.7b"
fi
# 3. llama-bench for the phone tiers (tokens/s, memory)
for g in lokol-health-qwen3-0.6b lokol-health-qwen3-1.7b; do
  [ -f "models/gguf/$g-Q4_K_M.gguf" ] && /opt/homebrew/opt/llama.cpp/bin/llama-bench -m "models/gguf/$g-Q4_K_M.gguf" -p 256 -n 64 -r 2 > "models/logs/bench_$g.txt" 2>&1 && say "bench $g done"
done
say "JOBS DONE"
