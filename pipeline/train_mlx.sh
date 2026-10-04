#!/usr/bin/env bash
# Local LoRA fine-tune of Qwen3.5-<size> with mlx-lm, then fuse. SPEC §4.
#
#   pipeline/train_mlx.sh <size> [data_dir] [iters]
#   pipeline/train_mlx.sh 0.8B data/stub/mlx 30      # smoke test (~2 min)
#   pipeline/train_mlx.sh 0.8B                        # real run: data/mlx/0.8B, 600 iters
#   pipeline/train_mlx.sh 2B
#
# Env overrides: BATCH (4), LAYERS (16), LR (1e-4), MAXLEN (2048), MODEL (mlx-community/Qwen3.5-<size>-MLX-bf16), SKIP_FUSE=1
# Outputs: models/adapters/<size>/adapters.safetensors (+ adapter_config.json), models/fused/<size>/ (HF layout, bf16)
set -euo pipefail
cd "$(dirname "$0")/.."
SIZE="${1:?size, e.g. 0.8B | 2B | 4B}"
DATA="${2:-data/mlx/$SIZE}"
ITERS="${3:-600}"
MODEL="${MODEL:-mlx-community/Qwen3.5-${SIZE}-MLX-bf16}"
BATCH="${BATCH:-4}"; LAYERS="${LAYERS:-8}"; LR="${LR:-1e-4}"; MAXLEN="${MAXLEN:-2048}"; GC="${GC---grad-checkpoint}"
PY=.venv/bin/python
ADAPTER="models/adapters/$SIZE"
FUSED="models/fused/$SIZE"

[ -f "$DATA/train.jsonl" ] || { echo "missing $DATA/train.jsonl (mlx chat jsonl: {\"messages\":[...]})" >&2; exit 2; }
[ -f "$DATA/valid.jsonl" ] || { echo "missing $DATA/valid.jsonl" >&2; exit 2; }
mkdir -p "$ADAPTER" models/fused models/logs
LOG="models/logs/train_mlx_${SIZE}_$(date +%H%M%S).log"
echo "== mlx_lm.lora $MODEL data=$DATA iters=$ITERS batch=$BATCH layers=$LAYERS lr=$LR -> $ADAPTER (log $LOG)"

# steps-per-eval: 10 for smoke runs, 100 for real runs
if [ "$ITERS" -le 50 ]; then SPE=10; else SPE=100; fi
$PY pipeline/train_mlx_launch.py \
  --model "$MODEL" --train --data "$DATA" \
  --fine-tune-type lora --mask-prompt \
  --iters "$ITERS" --batch-size "$BATCH" --num-layers "$LAYERS" --learning-rate "$LR" \
  --max-seq-length "$MAXLEN" --steps-per-report 10 --steps-per-eval "$SPE" --val-batches 10 \
  --save-every "$SPE" --adapter-path "$ADAPTER" $GC --seed 0 2>&1 | tee "$LOG"

if [ "${SKIP_FUSE:-0}" = "1" ]; then echo "== SKIP_FUSE=1, adapter at $ADAPTER"; exit 0; fi
echo "== mlx_lm.fuse -> $FUSED"
rm -rf "$FUSED"
$PY -m mlx_lm fuse --model "$MODEL" --adapter-path "$ADAPTER" --save-path "$FUSED" 2>&1 | tee -a "$LOG"
ls -la "$FUSED"
echo "== done. next: pipeline/export_gguf.sh $SIZE"
