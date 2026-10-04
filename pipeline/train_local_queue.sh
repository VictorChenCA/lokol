#!/usr/bin/env bash
# Phone-tier training queue on Apple Silicon (runs sequentially to avoid GPU contention).
#  1. Qwen3-0.6B   all 28 layers LoRA   (standard attention: fast to train with mlx)
#  2. Qwen3.5-0.8B top layer only       (hybrid linear attention: only LAYERS=1 is fast on mlx-lm 0.32, see models/README.md)
#  3. Qwen3-1.7B   all 28 layers LoRA
# Each: train -> fuse -> GGUF Q4_K_M, plus the untouched base model in Q4_K_M for the base-vs-tuned eval.
set -uo pipefail
cd "$(dirname "$0")/.."
LOG=models/logs/queue.log
mkdir -p models/logs
say(){ echo "[queue $(date +%H:%M:%S)] $*" | tee -a "$LOG"; }
snap(){ ls -d ~/.cache/huggingface/hub/models--mlx-community--$1/snapshots/*/ 2>/dev/null | head -1; }

run_std(){ # tag model layers iters batch lr
  local TAG=$1 MODEL=$2 LAYERS=$3 ITERS=$4 BATCH=$5 LR=$6
  say "start $TAG ($MODEL, layers=$LAYERS iters=$ITERS batch=$BATCH lr=$LR)"
  MODEL="$MODEL" LAYERS=$LAYERS BATCH=$BATCH LR=$LR MAXLEN=1280 pipeline/train_mlx.sh "$TAG" data/mlx/0.8B "$ITERS" >> "$LOG" 2>&1 \
    || { say "FAILED train $TAG"; return 1; }
  say "trained $TAG"
}

# 1. Qwen3-0.6B
.venv/bin/python -c "from huggingface_hub import snapshot_download as s; s('mlx-community/Qwen3-0.6B-bf16'); s('mlx-community/Qwen3-1.7B-bf16')" >> "$LOG" 2>&1
if run_std qwen3-0.6b mlx-community/Qwen3-0.6B-bf16 28 700 4 2e-4; then
  pipeline/export_gguf_std.sh lokol-health-qwen3-0.6b models/fused/qwen3-0.6b >> "$LOG" 2>&1 && say "exported lokol-health-qwen3-0.6b" || say "FAILED export qwen3-0.6b"
  pipeline/export_gguf_std.sh qwen3-0.6b-base "$(snap Qwen3-0.6B-bf16)" >> "$LOG" 2>&1 && say "exported qwen3-0.6b-base" || say "FAILED export qwen3-0.6b-base"
fi

# 2. Qwen3.5-0.8B, LoRA on the top (full-attention) layer only
if run_std 0.8B mlx-community/Qwen3.5-0.8B-MLX-bf16 1 700 4 2e-4; then
  SMOKE=0 pipeline/export_gguf.sh 0.8B >> "$LOG" 2>&1 && say "exported lokol-health-0.8b" || say "FAILED export 0.8B"
fi

# 3. Qwen3-1.7B
if run_std qwen3-1.7b mlx-community/Qwen3-1.7B-bf16 28 600 4 1.5e-4; then
  pipeline/export_gguf_std.sh lokol-health-qwen3-1.7b models/fused/qwen3-1.7b >> "$LOG" 2>&1 && say "exported lokol-health-qwen3-1.7b" || say "FAILED export qwen3-1.7b"
  pipeline/export_gguf_std.sh qwen3-1.7b-base "$(snap Qwen3-1.7B-bf16)" >> "$LOG" 2>&1 && say "exported qwen3-1.7b-base" || say "FAILED export qwen3-1.7b-base"
fi
say "QUEUE DONE"
