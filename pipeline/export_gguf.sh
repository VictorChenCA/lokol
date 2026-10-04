#!/usr/bin/env bash
# Fused HF model -> GGUF f16 -> Q4_K_M (SPEC §4), plus a smoke prompt through llama-server and a llama-bench line.
#
#   pipeline/export_gguf.sh <size> [fused_dir]            # default fused_dir models/fused/<size>
#   pipeline/export_gguf.sh 0.8B
#   SMOKE=0 pipeline/export_gguf.sh 2B                     # skip the server/bench check
#
# Needs: .venv with gguf+torch (uv pip install --python .venv/bin/python gguf torch), llama.cpp binaries in LLAMA_BIN,
# the converter in LLAMA_CPP (git main; supports Qwen3_5ForCausalLM / Qwen3_5ForConditionalGeneration).
# Outputs: models/gguf/lokol-health-<size>-f16.gguf, models/gguf/lokol-health-<size>-Q4_K_M.gguf, models/logs/bench_<size>.txt
set -euo pipefail
cd "$(dirname "$0")/.."
SIZE="${1:?size, e.g. 0.8B}"
FUSED="${2:-models/fused/$SIZE}"
LLAMA_BIN="${LLAMA_BIN:-/opt/homebrew/opt/llama.cpp/bin}"
LLAMA_CPP="${LLAMA_CPP:-/private/tmp/claude-501/-Users-victor/337b8ded-3ecd-4ec9-9077-6582ecbf0a2d/scratchpad/llama.cpp}"
PY=.venv/bin/python
NAME="lokol-health-$(echo "$SIZE" | tr 'A-Z' 'a-z')"
F16="models/gguf/$NAME-f16.gguf"
Q4="models/gguf/$NAME-Q4_K_M.gguf"
mkdir -p models/gguf models/logs

[ -f "$FUSED/config.json" ] || { echo "missing $FUSED/config.json (run pipeline/train_mlx.sh $SIZE first)" >&2; exit 2; }

# --no-mtp: mlx_lm.fuse drops the multi-token-prediction head but the config still declares it; without the flag the GGUF
# claims one extra block and llama.cpp refuses to load it (tensor blk.24.attn_norm.weight not found).
# mlx_lm.fuse keeps the VL wrapper config (Qwen3_5ForConditionalGeneration + text_config). The converter accepts it,
# but if it ever refuses, flatten to a text-only config in a scratch copy (SPEC §4 fallback) and convert that.
# mlx folds the "+1" of Qwen3.5's (1 + w) RMSNorm into the stored norm weights (input_layernorm, post_attention_layernorm,
# q_norm, k_norm, final norm; NOT linear_attn.norm). The converter adds it again, which yields gibberish. Un-fold it into a
# scratch HF-layout copy and convert that. Verified by value-diffing against ggml-org/Qwen3.5-0.8B-GGUF: only those tensors differ.
HF="models/fused/${SIZE}-hf"
echo "== un-fold mlx norm weights: $FUSED -> $HF"
rm -rf "$HF"; mkdir -p "$HF"
for f in "$FUSED"/*; do case "$(basename "$f")" in model.safetensors|model.safetensors.index.json|*.safetensors) ;; *) ln -sf "$(cd "$(dirname "$f")" && pwd)/$(basename "$f")" "$HF/";; esac; done
$PY - "$FUSED" "$HF" <<'EOF'
import glob, json, re, sys, torch
from safetensors.torch import load_file, save_file
src, dst = sys.argv[1], sys.argv[2]
NORM = re.compile(r"(input_layernorm|post_attention_layernorm|q_norm|k_norm|\.norm)\.weight$")
tensors, fixed = {}, 0
for f in sorted(glob.glob(f"{src}/*.safetensors")):
    for k, v in load_file(f).items():
        if NORM.search(k) and "linear_attn.norm" not in k:
            v = (v.float() - 1.0).to(v.dtype); fixed += 1
        tensors[k] = v.contiguous()
save_file(tensors, f"{dst}/model.safetensors", metadata={"format": "pt"})
json.dump({"metadata": {"total_size": sum(t.numel() * t.element_size() for t in tensors.values())},
           "weight_map": {k: "model.safetensors" for k in tensors}}, open(f"{dst}/model.safetensors.index.json", "w"), indent=1)
print(f"wrote {dst}/model.safetensors: {len(tensors)} tensors, {fixed} norm weights un-folded")
EOF

echo "== convert_hf_to_gguf.py $HF -> $F16"
if ! $PY "$LLAMA_CPP/convert_hf_to_gguf.py" "$HF" --no-mtp --outtype f16 --outfile "$F16" 2>&1 | tail -n 15; then
  echo "== converter failed on the VL-wrapped config; retrying with a flattened text-only config"
  FLAT="models/fused/${SIZE}-textonly"
  rm -rf "$FLAT"; mkdir -p "$FLAT"
  for f in "$HF"/*; do ln -sf "$(cd "$(dirname "$f")" && pwd)/$(basename "$f")" "$FLAT/"; done
  rm -f "$FLAT/config.json"
  $PY - "$HF/config.json" "$FLAT/config.json" <<'EOF'
import json, sys
c = json.load(open(sys.argv[1]))
t = c.get("text_config", c)
t = {**t, "architectures": ["Qwen3_5ForCausalLM"], "model_type": "qwen3_5"}
for k in ("tie_word_embeddings", "torch_dtype", "dtype", "bos_token_id", "eos_token_id", "pad_token_id"):
    if k in c and k not in t: t[k] = c[k]
json.dump(t, open(sys.argv[2], "w"), indent=2)
print("wrote", sys.argv[2], "arch", t["architectures"])
EOF
  $PY "$LLAMA_CPP/convert_hf_to_gguf.py" "$FLAT" --no-mtp --outtype f16 --outfile "$F16" 2>&1 | tail -n 15
fi
ls -la "$F16"

echo "== llama-quantize -> $Q4"
"$LLAMA_BIN/llama-quantize" "$F16" "$Q4" Q4_K_M 2>&1 | tail -n 3
ls -la "$Q4"

if [ "${SMOKE:-1}" = "1" ]; then
  echo "== llama-bench ($Q4)"
  "$LLAMA_BIN/llama-bench" -m "$Q4" -p 256 -n 64 -r 2 2>&1 | tee "models/logs/bench_${SIZE}.txt" | tail -n 6
  echo "== protocol smoke via pipeline/eval.py --smoke"
  $PY pipeline/eval.py --model "$Q4" --smoke
fi
echo "== done: $F16  $Q4"
