#!/usr/bin/env bash
# Lokol bridge, one command: cloudflared quick tunnel + bridge (+ speech sidecar when WITH_VOICE=1).
#
#   bridge/run_local.sh                          # LLM_BACKEND from env or .env, default llama
#   LLM_BACKEND=river bridge/run_local.sh        # River-hosted tuned 9B (needs RIVER_API_KEY in .env)
#   WITH_VOICE=1 LLM_BACKEND=river bridge/run_local.sh
#   TWILIO_MODE=poll LLM_BACKEND=river bridge/run_local.sh   # Twilio free trial: poll, no webhook to set
#
# Env: LLM_BACKEND (llama|river), WITH_VOICE (1 = start sidecar/server.py), BRIDGE_PORT (8090),
#      SIDECAR_PORT (8091), BRIDGE_HOST (127.0.0.1), NO_TUNNEL (1 = skip cloudflared),
#      TWILIO_ASYNC (default 1 here: empty TwiML at once, reply via the Twilio REST API),
#      TWILIO_MODE (webhook, default | poll = the bridge polls the Twilio Messages list every 3 s).
# The tunnel URL goes to bridge/.state/public_url (gitignored; removed on exit), never into .env.
# Secrets stay in .env, which the bridge reads itself; this script never prints them.
# Works with macOS /bin/bash 3.2.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PY="${PYTHON:-$ROOT/.venv/bin/python}"
PORT="${BRIDGE_PORT:-8090}"
HOST="${BRIDGE_HOST:-127.0.0.1}"
SIDECAR_PORT="${SIDECAR_PORT:-8091}"
STATE_DIR="$ROOT/bridge/.state"
URL_FILE="$STATE_DIR/public_url"
CF_LOG="$STATE_DIR/cloudflared.log"
SIDECAR_LOG="$STATE_DIR/sidecar.log"
mkdir -p "$STATE_DIR"

# Value of KEY from .env without sourcing or echoing the file (only non-secret switches are read).
env_get() {
  [ -f "$ROOT/.env" ] || return 0
  { grep -E "^[[:space:]]*$1[[:space:]]*=" "$ROOT/.env" || true; } | tail -n 1 | cut -d= -f2- |
    sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e "s/^[\"']//" -e "s/[\"']\$//"
}
env_has() { [ -n "${!1:-}" ] || [ -n "$(env_get "$1")" ]; }

LLM_BACKEND="${LLM_BACKEND:-$(env_get LLM_BACKEND)}"
LLM_BACKEND="${LLM_BACKEND:-llama}"
TWILIO_ASYNC="${TWILIO_ASYNC:-$(env_get TWILIO_ASYNC)}"
TWILIO_ASYNC="${TWILIO_ASYNC:-1}"
TWILIO_MODE="${TWILIO_MODE:-$(env_get TWILIO_MODE)}"
TWILIO_MODE="${TWILIO_MODE:-webhook}"
export LLM_BACKEND TWILIO_ASYNC TWILIO_MODE
export SIDECAR_URL="${SIDECAR_URL:-http://127.0.0.1:$SIDECAR_PORT}"

case "$LLM_BACKEND" in
  llama|river) ;;
  *) echo "LLM_BACKEND must be llama or river (got '$LLM_BACKEND')" >&2; exit 2 ;;
esac
if [ "$LLM_BACKEND" = river ] && ! env_has RIVER_API_KEY; then
  echo "LLM_BACKEND=river needs RIVER_API_KEY in .env" >&2; exit 2
fi
[ -x "$PY" ] || { echo "python not found at $PY (create .venv first)" >&2; exit 2; }

PIDS=()
cleanup() {
  trap - EXIT INT TERM
  for pid in "${PIDS[@]:-}"; do
    [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
  done
  rm -f "$URL_FILE"
  wait 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT TERM

port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
if port_busy "$PORT"; then
  echo "port $PORT is already in use (another bridge?). Stop it or set BRIDGE_PORT." >&2; exit 1
fi

# 1. tunnel first, so the bridge starts with the right PUBLIC_BASE_URL (Twilio signatures, voice links)
PUBLIC_URL=""
rm -f "$URL_FILE"
if [ "${NO_TUNNEL:-0}" = 1 ]; then
  echo "NO_TUNNEL=1: local only"
elif ! command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared not installed (brew install cloudflared); running local only" >&2
else
  : >"$CF_LOG"
  # 127.0.0.1, not localhost: the bridge binds IPv4 only and localhost may resolve to ::1 first.
  cloudflared tunnel --no-autoupdate --url "http://127.0.0.1:$PORT" >"$CF_LOG" 2>&1 &
  CF_PID=$!
  PIDS+=("$CF_PID")
  echo "waiting for cloudflared ..."
  for _ in $(seq 1 60); do
    # Skip cloudflared's own service hosts: a failed request logs 'Post "https://api.trycloudflare.com/tunnel"'.
    PUBLIC_URL="$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "$CF_LOG" |
      grep -Ev '^https://(api|login|www)\.trycloudflare\.com$' | head -n 1 || true)"
    [ -n "$PUBLIC_URL" ] && break
    kill -0 "$CF_PID" 2>/dev/null || { echo "cloudflared exited; see $CF_LOG" >&2; break; }
    sleep 1
  done
  if [ -n "$PUBLIC_URL" ]; then
    printf '%s\n' "$PUBLIC_URL" >"$URL_FILE"
    export PUBLIC_BASE_URL="$PUBLIC_URL"
  else
    echo "no trycloudflare URL; continuing local only (see $CF_LOG)" >&2
  fi
fi

# 2. speech sidecar (optional)
if [ "${WITH_VOICE:-0}" = 1 ]; then
  if port_busy "$SIDECAR_PORT"; then
    echo "sidecar port $SIDECAR_PORT already answers; reusing it"
  else
    SIDECAR_PORT="$SIDECAR_PORT" "$PY" "$ROOT/sidecar/server.py" >"$SIDECAR_LOG" 2>&1 &
    PIDS+=("$!")
    echo "sidecar starting on :$SIDECAR_PORT (log: $SIDECAR_LOG)"
  fi
fi

# 3. the bridge
"$PY" -m bridge.server --host "$HOST" --port "$PORT" &
BRIDGE_PID=$!
PIDS+=("$BRIDGE_PID")
for _ in $(seq 1 60); do
  curl -fs "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break
  kill -0 "$BRIDGE_PID" 2>/dev/null || { echo "bridge exited during startup" >&2; exit 1; }
  sleep 1
done

echo
echo "=================================================================="
echo " Lokol bridge   http://127.0.0.1:$PORT   (LLM_BACKEND=$LLM_BACKEND, TWILIO_MODE=$TWILIO_MODE, TWILIO_ASYNC=$TWILIO_ASYNC)"
if [ "$TWILIO_MODE" = poll ]; then
  echo " Twilio         polling the Messages list every ${TWILIO_POLL_INTERVAL:-3} s (free trial: no webhook to set)."
  echo "                Message the sandbox number from the verified phone; replies go out via the REST API."
fi
if [ -n "$PUBLIC_URL" ]; then
  echo " Public URL     $PUBLIC_URL      (saved to bridge/.state/public_url)"
  if [ "$TWILIO_MODE" != poll ]; then
    echo " Twilio webhook $PUBLIC_URL/twilio/whatsapp"
    echo "                (Twilio console > Messaging > Try it out > WhatsApp > Sandbox settings,"
    echo "                 'When a message comes in', method POST)"
  fi
  echo " Messenger      $PUBLIC_URL/messenger/webhook"
fi
env_has TWILIO_AUTH_TOKEN || echo " note: TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN not in .env yet (no signature check, no async REST replies)"
echo " Health         curl -s 127.0.0.1:$PORT/health"
echo " Stop           Ctrl-C (stops bridge, tunnel and sidecar)"
echo "=================================================================="

wait "$BRIDGE_PID"
