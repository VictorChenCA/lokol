#!/usr/bin/env bash
# Lokol sidecar: download speech models into the Hugging Face cache (~/.cache/huggingface/hub).
# Nothing is written into the repo. Re-running is a no-op for files already present.
#
# Usage:
#   sidecar/fetch_models.sh            # core set (~1.1 GB): Pijin TTS, English TTS, English ASR, Pijin ASR (Omnilingual, ONNX int8)
#   sidecar/fetch_models.sh --mms-asr  # also fetch facebook/mms-1b-all + the 'pis' adapter (~3.9 GB, CC-BY-NC-4.0) as the ASR fallback
#
# Licenses: see sidecar/LICENSES.md (MMS models are CC-BY-NC-4.0; Omnilingual ASR, Kokoro are Apache-2.0; Whisper is MIT).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
PY="${PY:-$ROOT/.venv/bin/python}"
HF="$ROOT/.venv/bin/hf"
[ -x "$HF" ] || HF="hf"
export HF_HUB_DISABLE_TELEMETRY=1

dl() { # dl <repo> [file ...]   (bare filenames after the repo id; `hf download` ignores --include when filenames are given)
  echo "==> $1"
  "$HF" download "$@" >/dev/null
}

# 1. Pijin text-to-speech (VITS), used for lang=pis.  ~145 MB, CC-BY-NC-4.0
dl facebook/mms-tts-pis config.json model.safetensors vocab.json tokenizer_config.json special_tokens_map.json

# 2. English text-to-speech, primary: Kokoro-82M (Apache-2.0, ~330 MB incl. two voices).
#    The 'kokoro' pip package downloads these itself on first use; we prefetch so first /tts is fast and works offline.
dl hexgrad/Kokoro-82M kokoro-v1_0.pth config.json voices/af_heart.pt voices/bm_george.pt

# 3. English text-to-speech, fallback if the kokoro package cannot import: MMS English VITS. ~145 MB, CC-BY-NC-4.0
dl facebook/mms-tts-eng config.json model.safetensors vocab.json tokenizer_config.json special_tokens_map.json

# 4. English speech-to-text: whisper tiny for mlx-whisper (MIT). ~75 MB
dl mlx-community/whisper-tiny config.json weights.npz

# 5. Pijin (and 1,600 other languages) speech-to-text: Meta Omnilingual ASR CTC-300M, int8 ONNX export for sherpa-onnx.
#    Apache-2.0. ~365 MB. Runs on CPU, no fairseq2 needed.
dl csukuangfj/sherpa-onnx-omnilingual-asr-1600-languages-300M-ctc-int8-2025-11-12 model.int8.onnx tokens.txt

if [ "${1:-}" = "--mms-asr" ]; then
  # 6. Optional fallback Pijin ASR: facebook/mms-1b-all with the 'pis' adapter. ~3.9 GB, CC-BY-NC-4.0 (non-commercial).
  dl facebook/mms-1b-all config.json preprocessor_config.json model.safetensors vocab.json tokenizer_config.json special_tokens_map.json adapter.pis.safetensors adapter.eng.safetensors
fi

echo "done. models are in ${HF_HOME:-$HOME/.cache/huggingface}/hub"
