#!/usr/bin/env bash
# Reordered queue (22:25): wait for the running Qwen3-0.6B job, export it, then Qwen3-1.7B (350 iters), then Qwen3.5-0.8B (top layer).
set -uo pipefail
cd "$(dirname "$0")/.."
LOG=models/logs/queue.log
say(){ echo "[queue $(date +%H:%M:%S)] $*" | tee -a "$LOG"; }
snap(){ ls -d ~/.cache/huggingface/hub/models--mlx-community--$1/snapshots/*/ 2>/dev/null | head -1; }
WAIT_PID="${1:-}"
if [ -n "$WAIT_PID" ]; then say "waiting for qwen3-0.6b job (pid $WAIT_PID)"; while kill -0 "$WAIT_PID" 2>/dev/null; do sleep 5; done; fi
if [ -f models/fused/qwen3-0.6b/config.json ]; then
  say "trained qwen3-0.6b"
  pipeline/export_gguf_std.sh lokol-health-qwen3-0.6b models/fused/qwen3-0.6b >> "$LOG" 2>&1 && say "exported lokol-health-qwen3-0.6b" || say "FAILED export qwen3-0.6b"
  pipeline/export_gguf_std.sh qwen3-0.6b-base "$(snap Qwen3-0.6B-bf16)" >> "$LOG" 2>&1 && say "exported qwen3-0.6b-base" || say "FAILED export qwen3-0.6b-base"
else
  say "FAILED qwen3-0.6b: no fused model"
fi
say "start qwen3-1.7b (350 iters)"
if MODEL=mlx-community/Qwen3-1.7B-bf16 LAYERS=28 BATCH=4 LR=1.5e-4 MAXLEN=1280 pipeline/train_mlx.sh qwen3-1.7b data/mlx/0.8B 350 >> "$LOG" 2>&1; then
  say "trained qwen3-1.7b"
  pipeline/export_gguf_std.sh lokol-health-qwen3-1.7b models/fused/qwen3-1.7b >> "$LOG" 2>&1 && say "exported lokol-health-qwen3-1.7b" || say "FAILED export qwen3-1.7b"
  pipeline/export_gguf_std.sh qwen3-1.7b-base "$(snap Qwen3-1.7B-bf16)" >> "$LOG" 2>&1 && say "exported qwen3-1.7b-base" || say "FAILED export qwen3-1.7b-base"
else say "FAILED train qwen3-1.7b"; fi
say "start 0.8B (Qwen3.5, top layer, 500 iters)"
if MODEL=mlx-community/Qwen3.5-0.8B-MLX-bf16 LAYERS=1 BATCH=4 LR=2e-4 MAXLEN=1280 pipeline/train_mlx.sh 0.8B data/mlx/0.8B 500 >> "$LOG" 2>&1; then
  say "trained 0.8B"; SMOKE=0 pipeline/export_gguf.sh 0.8B >> "$LOG" 2>&1 && say "exported lokol-health-0.8b" || say "FAILED export 0.8B"
else say "FAILED train 0.8B"; fi
say "QUEUE DONE"
