# Lokol bridge

Channel adapter for Lokol Health: Twilio WhatsApp and Facebook Messenger webhooks (plus a generic `POST /message`) in front of a Lokol model. Same pipeline as the Studio runtime, in Python:

```
message -> /command? -> detect language (Pijin glossary) -> per-user flags (rdt/act/transport)
        -> BM25 over the STM chunks -> [guideline: SECTION pNN] line -> LLM backend (SPEC §2 prompt)
        -> protocol parse -> red-flag gate -> reply text (+ optional voice note from the sidecar)
```

Two LLM backends (`LLM_BACKEND`):

| Backend | What answers | When |
|---|---|---|
| `llama` (default) | a local `llama-server` at `LLM_URL` running a Lokol GGUF | offline / on-device demo |
| `river` | the River-hosted tuned 9B (`lokol-health-9b`, step-180 inference checkpoint, best on the full held-out test) | WhatsApp / Messenger are online channels anyway, so the bridge can use the biggest tuned model |

`river` samples exactly like `pipeline/eval.py` (Qwen3.5 renderer, thinking off, temperature 0, `max_tokens` 260) over one long-lived River client + session (created at startup in the background, reused, rebuilt after an error), in a worker thread so the event loop stays free. A River turn that fails or takes longer than `RIVER_TIMEOUT` (25 s) falls back to `LLM_URL` if that answers, else to a canned `ASK_PERSON` reply ("ask the nurse in charge"). The `/message` JSON says which one answered in `backend` (`river` | `llama` | `canned` | `mock`), with `model`, `error`, `llm_secs` and `latency_ms`; the bridge log and `bridge/.state/messages.jsonl` record it too.

Everything else runs on the laptop; the only public piece is a `cloudflared` tunnel so Twilio / Meta can reach the webhook.

## Run (one command)

```bash
cd ~/Documents/GitHub/Lokol
LLM_BACKEND=river bridge/run_local.sh               # River 9B + tunnel
WITH_VOICE=1 LLM_BACKEND=river bridge/run_local.sh  # + speech sidecar on :8091 for voice notes
LLM_BACKEND=llama bridge/run_local.sh               # local llama-server on :8080 (start it first, below)
```

`run_local.sh` starts `cloudflared tunnel --url http://127.0.0.1:8090`, waits for the `https://<random>.trycloudflare.com` URL, writes it to `bridge/.state/public_url` (gitignored, deleted on exit; `.env` is never edited), then starts the bridge with that `PUBLIC_BASE_URL` (and the sidecar when `WITH_VOICE=1`) and prints:

```
 Public URL     https://<random>.trycloudflare.com
 Twilio webhook https://<random>.trycloudflare.com/twilio/whatsapp
 Messenger      https://<random>.trycloudflare.com/messenger/webhook
```

It defaults `TWILIO_ASYNC=1`. Ctrl-C stops all three. Other switches: `BRIDGE_PORT` (8090), `SIDECAR_PORT` (8091), `BRIDGE_HOST` (127.0.0.1), `NO_TUNNEL=1`. The quick-tunnel URL changes on every start, so paste the new webhook URL into Twilio each time. A bridge started by hand without `PUBLIC_BASE_URL` also picks the URL up from `bridge/.state/public_url`.

## Run (step by step)

```bash
cd ~/Documents/GitHub/Lokol
set -a; . ./.env; set +a

# 1. the model (any Lokol GGUF; fallback base model shown)
llama-server -m models/base/Qwen3.5-0.8B-Q8_0.gguf --port 8080 -c 4096 --jinja
#   tuned:  llama-server -m models/gguf/lokol-health-9b-Q4_K_M.gguf --port 8080 -c 4096 --jinja

# 2. (optional) the speech sidecar for voice notes, port 8091 — see ../sidecar/README.md

# 3. the bridge
.venv/bin/python -m bridge.server --port 8090                  # llama-server on :8080
.venv/bin/python -m bridge.server --port 8090 --backend river  # River-hosted tuned 9B (RIVER_API_KEY in .env)
.venv/bin/python -m bridge.server --port 8090 --mock           # canned protocol replies, no model needed

# 4. a public URL for the webhooks
cloudflared tunnel --url http://localhost:8090
#   prints https://<random>.trycloudflare.com  -> put it in .env as PUBLIC_BASE_URL and restart the bridge
```

Smoke test without any channel:

```bash
curl -s localhost:8090/health | jq
curl -s localhost:8090/message -H 'content-type: application/json' \
  -d '{"text":"pikinini blong mi hem hot bodi tu dei, RDT positive, 13 kg, wanem meresin?","user_id":"demo"}' | jq
curl -s localhost:8090/message -H 'content-type: application/json' -d '{"text":"/rdt no","user_id":"demo"}' | jq .reply_text
```

`POST /message` body: `{"text", "user_id", "channel", "lang": "pis|en"|null, "flags": {"rdt","act","transport"}|null, "voice": false, "audio_b64": null}`. The response carries `reply_text` (what a channel user sees), `action`, `stm`, `body`, `red_flags`, `overridden`, `reasons`, `chunk`, `hits`, `raw` (model output), `backend`, `model`, `error`, `llm_secs`, `latency_ms`.

`GET /health` (polled by the Studio Deploy page):

```json
{"ok": true, "mode": "river", "llm": {"backend": "river", "model": "river:lokol-health-9b-s180-inf", "reachable": true,
 "fallback": {"url": "...", "reachable": false}}, "sidecar": {"reachable": false}, "twilio": {"configured": true, "async": true},
 "messenger": {"configured": false}, "public_base_url": "https://<random>.trycloudflare.com", "corpus": {...}, "users": 3}
```

`configured` flags are booleans; no credential value is ever returned. `public_base_url` is `null` until a public https URL is set. River `reachable` means the key is set and the last call did not fail (health never spends a model call).

**Browser access (CORS + Private Network Access).** The bridge sends `Access-Control-Allow-Origin: *` (GET/POST/OPTIONS, any header) and answers Chrome's Private Network Access preflight with `Access-Control-Allow-Private-Network: true`, so the Studio served from `https://<vercel>` can read `http://127.0.0.1:8090/health` and call `/message`.

Measured (2026-10-03, `--backend river`, warm session): Pijin fever case 6.4 s end to end (ADVISE, STM MALARIA p53); English convulsion case 6.8 s (REFER_NOW, STM CONVULSIONS p34). The first turn after start waits for the background warm-up (about 10 s: River client import + Qwen3.5 tokenizer).

## `.env` keys

| Key | Used for |
|---|---|
| `PUBLIC_BASE_URL` | the cloudflared URL; Twilio signature check and voice-note links |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | signature check (on when the token is set), media download, REST send |
| `TWILIO_WHATSAPP_FROM` | sandbox sender, default `whatsapp:+14155238886` |
| `TWILIO_ASYNC` | **`1` recommended** (default in `run_local.sh`): answer the webhook with empty TwiML at once and send the reply through the Twilio REST API (`POST /2010-04-01/Accounts/{SID}/Messages.json`, Basic auth SID:token, `From` = `TWILIO_WHATSAPP_FROM`) from a background task. Twilio times a webhook out at 15 s; a River turn is 4-12 s plus retrieval, and a River timeout plus fallback can take longer. Needs SID + token; without them the bridge stays synchronous. `0` = reply inside the webhook response (TwiML), used by the tests |
| `META_VERIFY_TOKEN` | the string you type into the Meta webhook form (default `lokol-verify`) |
| `META_PAGE_TOKEN` | Page access token for the Send API |
| `META_APP_SECRET` | optional; enables `X-Hub-Signature-256` verification |
| `LLM_BACKEND` | `llama` (default) or `river` |
| `LLM_URL` | default `http://127.0.0.1:8080/v1/chat/completions` (the `llama` backend, and River's fallback) |
| `RIVER_API_KEY` | River key (`river` backend) |
| `RIVER_CHECKPOINT` | default: the step-180 `inference` entry of `models/river/lokol-health-9b/checkpoint.json` (`river://a1fa006b-60ca-4457-b809-5fcbd9d63264/sampler_weights/lokol-health-9b-s180-inf`), else that file's `best` |
| `RIVER_BASE` | default `Qwen/Qwen3.5-9B` |
| `RIVER_TIMEOUT` / `RIVER_MAX_TOKENS` | default 25 s / 260 |
| `SIDECAR_URL` | default `http://127.0.0.1:8091` |
| `LOKOL_MOCK` | `1` = canned replies (same as `--mock`) |
| `LOKOL_MIN_SCORE` | BM25 score under which the top hit is treated as "no guideline" (default 8.0) |

## Twilio WhatsApp Sandbox (exact steps)

1. Sign in at <https://console.twilio.com>. Copy **Account SID** and **Auth Token** from the home page into `.env` (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`).
2. Left menu: **Messaging → Try it out → Send a WhatsApp message**. The page shows the sandbox number **+1 415 523 8886** and a join code like `join <two-words>`.
3. On your phone, in WhatsApp, send `join <two-words>` to **+1 415 523 8886**. Twilio replies that you are connected (sandbox membership expires after 72 h, send the join code again if replies stop).
4. Same page, tab **Sandbox settings**: set **When a message comes in** to `<PUBLIC_BASE_URL>/twilio/whatsapp`, method **POST**. Leave the status callback empty. Save.
5. Start the bridge and the tunnel (above). Send `/help`, then a nurse message such as `pikinini hem hot bodi tu dei, RDT positive, 13 kg`.
6. Voice notes: send one; the bridge downloads it with Basic auth (SID:token), converts with ffmpeg, transcribes through the sidecar, and answers with text plus an Ogg/Opus voice note (`<Media>` URL under `PUBLIC_BASE_URL/static/audio/`).

Notes: the sandbox only talks to numbers that joined; free trial accounts can send to joined numbers without a template inside the 24 h session window; the sandbox is free (standard WhatsApp conversation pricing applies only on upgraded accounts). Use `TWILIO_ASYNC=1` (the `run_local.sh` default): the webhook returns an empty `<Response></Response>` at once and the reply (text, plus the voice note as `MediaUrl`) goes out through the REST API, so River latency never hits Twilio's 15 s webhook limit. A failed REST send is logged (`twilio REST send failed: status=...`). With `TWILIO_ASYNC=0` the webhook response itself is the TwiML reply (`<Response><Message><Body>…</Body><Media>…</Media></Message></Response>`), fine for the fast mock or a small local model.

## Facebook Messenger (Meta Cloud)

1. <https://developers.facebook.com> → **My Apps → Create App → Other → Business**. Add the **Messenger** product.
2. Messenger settings → **Access tokens → Add or remove Pages**, pick a Page you admin, **Generate token** → `.env` `META_PAGE_TOKEN`.
3. **Webhooks → Add callback URL**: `<PUBLIC_BASE_URL>/messenger/webhook`, verify token = your `META_VERIFY_TOKEN`. Meta sends `GET ?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…` and the bridge echoes the challenge. Subscribe the Page to the `messages` field.
4. App settings → Basic → **App secret** → `.env` `META_APP_SECRET` (optional, turns on payload signature checks).
5. In development mode only app admins/testers can message the Page. Send the Page a message from Messenger; the bridge answers through `POST graph.facebook.com/v21.0/me/messages`. Voice clips come as `audio` attachments and go through the same ASR path; replies attach an MP3.

## Commands (per user, persisted in `bridge/.state/users.json`)

`/rdt yes|no|unknown` · `/act yes|no|unknown` · `/now` · `/boat` · `/notransport` · `/transport now|next_boat|none` · `/lang pis|en|auto` · `/voice on|off` · `/status` · `/reset` · `/help`

Flags default to `rdt=unknown act=unknown transport=now lang=auto` (auto = Pijin/English detection on each message).

## Safety gate

`bridge/gate.py` mirrors `pipeline/style_guide.md` RED_FLAGS and `app/src/runtime/gate.ts` (English and Pijin patterns). Any match forces `REFER_NOW`, or `REFER_NEXT_TRANSPORT` when `transport=next_boat` with a "while waiting" line prepended. A non-protocol reply, or no STM chunk above the retrieval threshold, becomes `ASK_PERSON` ("Mi no sua, askem nes"). STM titles are canonicalised against `corpus/sections.json`. Every turn is logged (hashed user id, action, STM, red flags, latency) to `bridge/.state/messages.jsonl`.

## Corpus

Uses `corpus/stm_children_chunks.jsonl` + `corpus/sections.json` from the DATA lane when present; otherwise `bridge/corpus.py` chunks `data/raw/SI_Standard_Treatment_Manual_for_Children_2017.txt` per page (section carried forward from the centred ALL-CAPS heading). The STM text itself is never served or committed.

## Sidecar contract (voice)

`POST {SIDECAR_URL}/asr` multipart `file` (16 kHz mono wav) + `lang` → `{"text": "..."}`; `POST {SIDECAR_URL}/tts` JSON `{"text","lang"}` → `audio/wav` (or JSON `{"audio_b64"}`). The bridge transcodes TTS output to Ogg/Opus (WhatsApp) or MP3 (Messenger) with ffmpeg. If the sidecar is down, voice notes get a "please type" reply and text replies carry no audio.

## Tests

```bash
.venv/bin/python -m pytest bridge/tests -q
```

Covers the gate (red flags in both languages, parser, overrides), BM25 (tiny corpus and the real one), commands/state, `POST /message`, the Twilio webhook (signed text, bad signature → 403, voice note → `<Media>`, XML escaping), the Messenger webhook (verify handshake, text event → Send API, audio event, echo/non-page events, app-secret signature), and `test_upgrades.py`: CORS + PNA preflight, the `/health` shape (no secret values), the River backend with a mocked client (prompt is SYSTEM_PROMPT only, red-flag gate still applies, timeout → canned ASK_PERSON, error → llama fallback, session rebuilt after an error, checkpoint default = step 180, `response_json` string parsing) and `TWILIO_ASYNC=1` end to end (empty TwiML, then one REST call to `Messages.json` with Basic auth and the reply, through an `httpx.MockTransport`; a 401 from Twilio is logged, not raised). No test touches the network.
