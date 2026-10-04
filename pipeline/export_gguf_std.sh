#!/usr/bin/env bash
# Standard-architecture (Qwen3 dense) HF/mlx model dir -> GGUF f16 -> Q4_K_M. No Qwen3.5 norm/MTP fixes needed.
#
#   pipeline/export_gguf_std.sh <out_name> <model_dir>
#   pipeline/export_gguf_std.sh lokol-health-qwen3-0.6b models/fused/qwen3-0.6b
#   pipeline/export_gguf_std.sh qwen3-0.6b-base ~/.cache/huggingface/hub/models--mlx-community--Qwen3-0.6B-bf16/snapshots/<rev>
set -euo pipefail
cd "$(dirname "$0")/.."
NAME="${1:?out name}"; SRC="${2:?model dir}"
LLAMA_BIN="${LLAMA_BIN:-/opt/homebrew/opt/llama.cpp/bin}"
LLAMA_CPP="${LLAMA_CPP:-/private/tmp/claude-501/-Users-victor/337b8ded-3ecd-4ec9-9077-6582ecbf0a2d/scratchpad/llama.cpp}"
PY=.venv/bin/python
mkdir -p models/gguf
F16="models/gguf/$NAME-f16.gguf"; Q4="models/gguf/$NAME-Q4_K_M.gguf"
echo "== convert $SRC -> $F16"
$PY "$LLAMA_CPP/convert_hf_to_gguf.py" "$SRC" --outtype f16 --outfile "$F16" 2>&1 | tail -n 4
echo "== quantize -> $Q4"
"$LLAMA_BIN/llama-quantize" "$F16" "$Q4" Q4_K_M 2>&1 | tail -n 2
rm -f "$F16"
ls -la "$Q4"
