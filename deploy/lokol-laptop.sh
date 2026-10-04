#!/usr/bin/env bash
# Lokol Health on a laptop or clinic PC, one command: the tuned model (llama-server, port 8080) and the
# WhatsApp/Messenger bridge (port 8090), optionally the Pijin voice sidecar (8091) and a public tunnel.
#
#   curl -fsSL https://raw.githubusercontent.com/VictorChenCA/lokol/main/deploy/lokol-laptop.sh | bash -s -- --model 1.7b
#   deploy/lokol-laptop.sh --model 0.6b                 # from a Lokol checkout
#   deploy/lokol-laptop.sh --model 1.7b --voice --tunnel
#   deploy/lokol-laptop.sh --dry-run                    # print the plan; downloads, installs and starts nothing
#
# Flags:
#   --model 0.6b|1.7b  which Lokol Health GGUF (default 1.7b, ~1.1 GB; 0.6b is ~0.4 GB for 4 GB machines)
#   --voice            also start the speech sidecar (Omnilingual ASR in, MMS-TTS Pijin out; ~1 GB more, Apple Silicon)
#   --tunnel           cloudflared quick tunnel, so WhatsApp (Twilio) and Messenger can reach the bridge
#   --dir DIR          where Lokol lives when this script runs outside a checkout (default ~/lokol)
#   --no-start         download and install only
#   --dry-run          show what would happen
# Needs: llama.cpp (brew install llama.cpp), Python 3.10+, curl. Optional: cloudflared (brew install cloudflared).
# After the first run everything is on disk: it starts with no internet (the tunnel is the only online part).
# Secrets (Twilio, Meta) stay in .env at the repo root; this script never reads or prints them.
# macOS /bin/bash 3.2 compatible. The whole script sits in main() so `curl | bash` reads it fully before running.

main() {
set -euo pipefail

REPO_SLUG="VictorChenCA/lokol"
HF_OWNER="VictorChenCA"
LLAMA_PORT="${LLAMA_PORT:-8080}"
BRIDGE_PORT="${BRIDGE_PORT:-8090}"
SIDECAR_PORT="${SIDECAR_PORT:-8091}"
STUDIO_URL="https://lokol-studio.vercel.app"

MODEL="1.7b"
VOICE=0
TUNNEL=0
DRY=0
START=1
DIR="${LOKOL_DIR:-$HOME/lokol}"

usage() { sed -n '2,20p' "${BASH_SOURCE[0]:-$0}" 2>/dev/null | sed 's/^# \{0,1\}//' || true; }

while [ $# -gt 0 ]; do
  case "$1" in
    --model) MODEL="${2:-}"; shift 2 ;;
    --model=*) MODEL="${1#*=}"; shift ;;
    --voice) VOICE=1; shift ;;
    --tunnel) TUNNEL=1; shift ;;
    --dir) DIR="${2:-}"; shift 2 ;;
    --dir=*) DIR="${1#*=}"; shift ;;
    --no-start) START=0; shift ;;
    --dry-run|-n) DRY=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown flag: $1 (try --help)" >&2; exit 2 ;;
  esac
done

case "$MODEL" in
  0.6b|0.6B) MODEL="0.6b" ;;
  1.7b|1.7B) MODEL="1.7b" ;;
  *) echo "--model must be 0.6b or 1.7b (got '$MODEL')" >&2; exit 2 ;;
esac
GGUF="lokol-health-qwen3-$MODEL-Q4_K_M.gguf"
HF_REPO="$HF_OWNER/lokol-health-qwen3-$MODEL-gguf"
GGUF_URL="https://huggingface.co/$HF_REPO/resolve/main/$GGUF"

say()  { printf '%s\n' "$*"; }
step() { printf '\n==> %s\n' "$*"; }
plan() { printf '    + %s\n' "$*"; }
warn() { printf 'warning: %s\n' "$*" >&2; }
die()  { printf 'error: %s\n' "$*" >&2; exit 1; }
has()  { command -v "$1" >/dev/null 2>&1; }
port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

OS="$(uname -s)"
ARCH="$(uname -m)"
if [ "$DRY" = 1 ]; then say "Lokol laptop installer, DRY RUN (nothing is downloaded, installed or started)"; else say "Lokol laptop installer"; fi
say "model $MODEL ($HF_REPO), voice=$VOICE, tunnel=$TUNNEL, $OS $ARCH"

# ------------------------------------------------------------------ 1. where Lokol lives
step "1. Lokol code"
ROOT=""
SELF="${BASH_SOURCE[0]:-}"
if [ -n "$SELF" ] && [ -f "$SELF" ]; then
  CAND="$(cd "$(dirname "$SELF")/.." && pwd)"
  [ -f "$CAND/bridge/server.py" ] && ROOT="$CAND"
fi
[ -z "$ROOT" ] && [ -f "$PWD/bridge/server.py" ] && ROOT="$PWD"
if [ -n "$ROOT" ]; then
  say "    using the checkout at $ROOT"
else
  ROOT="$DIR"
  if [ -f "$ROOT/bridge/server.py" ]; then
    say "    using $ROOT"
  else
    TARBALL="https://codeload.github.com/$REPO_SLUG/tar.gz/refs/heads/main"
    if [ "$DRY" = 1 ]; then
      plan "mkdir -p $ROOT && curl -fsSL $TARBALL | tar -xz --strip-components=1 -C $ROOT"
    else
      has curl || die "curl is needed to fetch Lokol"
      mkdir -p "$ROOT"
      say "    fetching github.com/$REPO_SLUG into $ROOT"
      curl -fsSL "$TARBALL" | tar -xz --strip-components=1 -C "$ROOT"
      [ -f "$ROOT/bridge/server.py" ] || die "download did not contain bridge/server.py"
    fi
  fi
fi

# ------------------------------------------------------------------ 2. prerequisites
step "2. Prerequisites"
MISSING=0
if has llama-server; then
  say "    llama-server: $(command -v llama-server)"
else
  MISSING=1
  if [ "$OS" = Darwin ]; then
    say "    llama-server: MISSING. Install llama.cpp:  brew install llama.cpp"
  else
    say "    llama-server: MISSING. Install llama.cpp:  brew install llama.cpp  (Linuxbrew), or a release build from"
    say "                  https://github.com/ggml-org/llama.cpp/releases (put llama-server on PATH)"
  fi
fi

PY=""
for cand in python3.13 python3.12 python3.11 python3.10 python3; do
  if has "$cand" && "$cand" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; then
    PY="$(command -v "$cand")"; break
  fi
done
if [ -n "$PY" ]; then
  say "    python: $PY ($("$PY" -c 'import platform; print(platform.python_version())'))"
else
  MISSING=1
  if has python3; then say "    python: $(python3 -V 2>&1) is too old, Lokol needs 3.10+"; else say "    python3: MISSING"; fi
  if [ "$OS" = Darwin ]; then say "            brew install python@3.12"; else say "            sudo apt install python3 python3-venv  (3.10+)"; fi
fi

has curl || { MISSING=1; say "    curl: MISSING"; }

if [ "$TUNNEL" = 1 ]; then
  if has cloudflared; then
    say "    cloudflared: $(command -v cloudflared)"
  else
    say "    cloudflared: missing, the bridge will run local only (brew install cloudflared)"
  fi
fi
if [ "$VOICE" = 1 ] && [ "$OS" != Darwin ]; then
  warn "the voice sidecar is verified on macOS (Apple Silicon); on Linux swap mlx-whisper in sidecar/requirements.txt"
fi
if [ "$MISSING" = 1 ]; then
  [ "$DRY" = 1 ] || die "install the missing tools above, then run this again"
  say "    (dry run: continuing the plan anyway)"
fi

# ------------------------------------------------------------------ 3. the model
step "3. Model: $GGUF"
MODEL_DIR="$ROOT/models/gguf"
MODEL_PATH="$MODEL_DIR/$GGUF"
if [ -s "$MODEL_PATH" ]; then
  say "    already on disk: $MODEL_PATH"
elif [ "$DRY" = 1 ]; then
  plan "mkdir -p $MODEL_DIR"
  plan "curl -fL --retry 3 -C - -o $MODEL_PATH.part $GGUF_URL && mv $MODEL_PATH.part $MODEL_PATH"
else
  mkdir -p "$MODEL_DIR"
  say "    downloading from https://huggingface.co/$HF_REPO (resumes if interrupted)"
  curl -fL --retry 3 -C - -o "$MODEL_PATH.part" "$GGUF_URL"
  mv "$MODEL_PATH.part" "$MODEL_PATH"
fi

# ------------------------------------------------------------------ 4. Python venv
step "4. Python environment ($ROOT/.venv)"
VPY="$ROOT/.venv/bin/python"
if [ "$DRY" = 1 ]; then
  [ -x "$VPY" ] && say "    venv exists" || plan "${PY:-python3} -m venv $ROOT/.venv"
  plan "$VPY -m pip install -r $ROOT/bridge/requirements.txt   (skipped when already installed)"
  if [ "$VOICE" = 1 ]; then
    plan "$VPY -m pip install -r $ROOT/sidecar/requirements.txt   (torch, transformers, sherpa-onnx; once)"
    plan "$ROOT/sidecar/fetch_models.sh   (speech models into the Hugging Face cache, ~1.1 GB, once)"
  fi
else
  [ -x "$VPY" ] || "$PY" -m venv "$ROOT/.venv"
  if "$VPY" -c 'import fastapi, uvicorn, httpx, multipart, pydantic' 2>/dev/null; then
    say "    bridge packages already installed"
  else
    "$VPY" -m pip install -q --upgrade pip
    "$VPY" -m pip install -q -r "$ROOT/bridge/requirements.txt"
  fi
  if [ "$VOICE" = 1 ]; then
    if "$VPY" -c 'import torch, transformers, sherpa_onnx, soundfile' 2>/dev/null; then
      say "    sidecar packages already installed"
    else
      "$VPY" -m pip install -q -r "$ROOT/sidecar/requirements.txt"
    fi
    PY="$VPY" "$ROOT/sidecar/fetch_models.sh"
  fi
fi

if [ "$START" = 0 ]; then
  step "Installed. Start later with: $ROOT/deploy/lokol-laptop.sh --model $MODEL"
  return 0
fi

# ------------------------------------------------------------------ 5. llama-server
step "5. Model server on port $LLAMA_PORT"
LLAMA_CMD="llama-server -m $MODEL_PATH --host 127.0.0.1 --port $LLAMA_PORT -c 4096 --jinja"
STATE_DIR="$ROOT/bridge/.state"
LLAMA_PID=""
if [ "$DRY" = 1 ]; then
  plan "$LLAMA_CMD > $STATE_DIR/llama-server.log 2>&1 &"
  plan "wait for http://127.0.0.1:$LLAMA_PORT/health"
elif port_busy "$LLAMA_PORT"; then
  say "    something already listens on $LLAMA_PORT; using it (stop it first to switch models)"
else
  mkdir -p "$STATE_DIR"
  llama-server -m "$MODEL_PATH" --host 127.0.0.1 --port "$LLAMA_PORT" -c 4096 --jinja >"$STATE_DIR/llama-server.log" 2>&1 </dev/null &
  LLAMA_PID=$!
  trap '[ -n "$LLAMA_PID" ] && kill "$LLAMA_PID" 2>/dev/null || true' EXIT
  trap 'exit 130' INT TERM
  printf '    loading'
  i=0
  until curl -fs "http://127.0.0.1:$LLAMA_PORT/health" >/dev/null 2>&1; do
    kill -0 "$LLAMA_PID" 2>/dev/null || { printf '\n'; die "llama-server exited; see $STATE_DIR/llama-server.log"; }
    i=$((i + 1)); [ "$i" -gt 180 ] && { printf '\n'; die "llama-server did not get ready in 3 minutes"; }
    printf '.'; sleep 1
  done
  printf ' ready\n'
fi

# ------------------------------------------------------------------ 6. URLs, then the bridge
step "6. Running"
say "    Model API      http://127.0.0.1:$LLAMA_PORT/v1/chat/completions   (chat UI: http://127.0.0.1:$LLAMA_PORT)"
say "    Bridge         http://127.0.0.1:$BRIDGE_PORT/health"
say "    Try it         curl -s 127.0.0.1:$BRIDGE_PORT/message -H 'content-type: application/json' \\"
say "                     -d '{\"text\":\"Pikinini 3 yia, 13 kilo, hot bodi fo tufala dei. Wanem mi mas duim?\"}'"
[ "$VOICE" = 1 ] && say "    Voice sidecar  http://127.0.0.1:$SIDECAR_PORT"
say "    Studio         $STUDIO_URL/packs  (open it from this laptop; the Deploy page can check the bridge)"
[ "$TUNNEL" = 1 ] && say "    WhatsApp and Messenger webhook URLs print below once the tunnel is up."
NO_TUNNEL=1; [ "$TUNNEL" = 1 ] && NO_TUNNEL=0
WITH_VOICE="$VOICE"
if [ "$DRY" = 1 ]; then
  plan "LLM_BACKEND=llama LLM_URL=http://127.0.0.1:$LLAMA_PORT/v1/chat/completions NO_TUNNEL=$NO_TUNNEL WITH_VOICE=$WITH_VOICE $ROOT/bridge/run_local.sh"
  say ""
  say "Dry run done. Run again without --dry-run to install and start."
  return 0
fi
LLM_BACKEND=llama LLM_URL="http://127.0.0.1:$LLAMA_PORT/v1/chat/completions" \
  NO_TUNNEL="$NO_TUNNEL" WITH_VOICE="$WITH_VOICE" BRIDGE_PORT="$BRIDGE_PORT" SIDECAR_PORT="$SIDECAR_PORT" \
  PYTHON="$VPY" bash "$ROOT/bridge/run_local.sh" </dev/null
}

main "$@"
