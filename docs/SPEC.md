# Lokol — build spec (shared contract for all build agents)

Read `PLAN.md` first (what and why), then this file (how the pieces fit). Deadline: Oct 4 06:00 PDT. Speed over polish everywhere except Lokol Studio's UI, which must look and feel like a real product.

Repo: `~/Documents/GitHub/Lokol` (git initialized, MIT). Python: `.venv/bin/python` (river-client 0.12.0, mlx-lm 0.32, transformers 5.18, datasets, openai, anthropic, fastapi, httpx, huggingface_hub). Node: bun or node 24 available. llama.cpp binaries in `/opt/homebrew/opt/llama.cpp/bin` (`llama-server`, `llama-quantize`, `llama-bench`, `llama-cli`); conversion scripts in `/private/tmp/claude-501/-Users-victor/337b8ded-3ecd-4ec9-9077-6582ecbf0a2d/scratchpad/llama.cpp/` (`convert_hf_to_gguf.py`, `convert_lora_to_gguf.py`; `pip install gguf` into the venv if needed). Secrets: `.env` at repo root (gitignored) holds `RIVER_API_KEY`; load with `set -a; . ./.env; set +a`. Never commit `.env`, model weights, or the guideline PDFs/text (`data/raw/` is gitignored on purpose: no license statement).

Ownership (so parallel agents never touch the same files):

| Lane | Owns | Produces |
|---|---|---|
| DATA | `pipeline/corpus.py`, `pipeline/synth.py`, `pipeline/style_guide.md`, `pipeline/validate.py`, `data/` | `corpus/stm_children_chunks.jsonl`, `data/synth/{train,val,test}.jsonl`, `data/DATA_CARD.md` |
| TRAIN | `pipeline/train_river.py`, `pipeline/train_mlx.sh`, `pipeline/export_gguf.sh`, `pipeline/eval.py`, `models/` | adapters, GGUFs, `eval/results.md` |
| STUDIO | `app/**` except `app/src/runtime/**` | the web app (Vite + React + TS + React Flow + Tailwind) |
| RUNTIME | `app/src/runtime/**`, `app/public/packs/**` | in-browser engine: wllama LLM, transformers.js STT/TTS, BM25 RAG, safety gate |
| BRIDGE | `bridge/**` | FastAPI channel adapter: Twilio WhatsApp + Messenger webhooks → local llama-server |
| SIDECAR | `sidecar/**` | Python speech service: Pijin ASR (Omnilingual ASR / MMS) + MMS Pijin TTS + Kokoro English TTS |

## 1. Corpus

Source: `data/raw/SI_Standard_Treatment_Manual_for_Children_2017.txt` (pdftotext -layout of the MHMS Solomon Islands Standard Treatment Manual for Children, 4th ed. 2017; pages separated by form feeds, 125 pages). Table of contents (page → section) is on pages 4–6; the parser in `pipeline/corpus.py` must split by section heading, keep `page_start`, `page_end`, strip running headers ("Standard Treatment Manual for Children", page numbers), and keep drug-dose tables as text.

`corpus/stm_children_chunks.jsonl`, one object per chunk (target 150–400 words, split long sections by sub-heading):
```json
{"id":"stm-c-053-malaria-01","section":"MALARIA","subsection":"Treatment of uncomplicated malaria","page":53,"text":"...","tokens":312}
```
Also write `corpus/sections.json` (ordered list of section titles with pages) for the UI and the eval.

## 2. Task protocol (what every model is trained and evaluated on)

Chat format = Qwen3.5 chat template (same for 0.8B/2B/4B/9B), thinking disabled.

**System prompt (fixed string, keep it short, in `pipeline/style_guide.md` as `SYSTEM_PROMPT`):**
```
You are Lokol Health, an assistant for nurse aides and health workers in Solomon Islands. You follow the Solomon Islands Standard Treatment Manual for Children. You never diagnose; you help the nurse apply the manual and decide when to refer. Reply in the nurse's language (Solomon Islands Pijin or English). Use the exact output format.
```

**User turn:**
```
[lang=pis] [rdt=yes] [act=yes] [transport=next_boat]
[guideline: MALARIA p53] <≤ 350-token excerpt from the matching chunk, or "none">
<nurse's message>
```
Flags: `lang` ∈ {pis,en}; `rdt` (malaria test kit available) ∈ {yes,no,unknown}; `act` (artemether-lumefantrine available) ∈ {yes,no,unknown}; `transport` ∈ {now,next_boat,none}. The guideline line is produced by retrieval at inference (top-1 chunk) and by construction in training; 25% of training examples use `none` or a deliberately wrong chunk so the model learns `ASK_PERSON`.

**Assistant turn (strict):**
```
ACTION: ADVISE | REFER_NOW | REFER_NEXT_TRANSPORT | ASK_PERSON
STM: <section title exactly as in corpus/sections.json> | NONE
---
<reply in the nurse's language, at most 6 short lines, plain words, no markdown>
```
For task type `note` (dictated visit note → record), the part after `---` is a single JSON object:
```json
{"age_months":36,"weight_kg":13,"symptoms":["fever 2 days","not eating"],"danger_signs":[],"assessment_per_stm":"fever, malaria test needed","action":"ADVISE","drugs":[{"name":"paracetamol","dose":"195 mg","route":"oral","frequency":"every 6 h"}],"follow_up":"return in 2 days or sooner if worse","referral":null}
```

**Task types and mix** (train 3,000 / val 300 / test 300; language split 45% pis, 40% en, 15% code-switched; each task type balanced; test set uses presentations and phrasings held out from train where possible):
- `guidance` (40%): nurse asks what to do; answer per STM.
- `referral` (20%): danger signs or failed treatment; ACTION must be REFER_NOW or REFER_NEXT_TRANSPORT depending on the transport flag and severity.
- `note` (20%): dictated note → JSON record.
- `followup` (10%): a short message for the caregiver (SMS length, Pijin or English).
- `abstain` (10%): out of scope (adult patient, imaging, dosing not in the manual, non-health, missing guideline) → ACTION: ASK_PERSON, STM: NONE, reply says what to ask whom.

**Red-flag list** (`pipeline/style_guide.md` → `RED_FLAGS`, mirrored in `app/src/runtime/gate.ts` and `bridge/gate.py`): convulsions; unable to drink or breastfeed; vomits everything; lethargic or unconscious; chest indrawing or fast breathing with danger sign; stiff neck; severe dehydration; severe malnutrition (visible wasting, oedema of both feet); bleeding; cyanosis; age under 2 months with fever; burns of face/airway. Any match forces REFER_NOW (or REFER_NEXT_TRANSPORT when `transport=next_boat` and the manual allows pre-referral treatment, in which case the reply must state what to give while waiting).

## 3. Teacher and synthesis (DATA lane)

Teacher: `deepseek-ai/DeepSeek-V4.1-Flash` via River `client.chat_complete(messages, base_model=..., max_tokens=..., temperature=0.7, chat_template_kwargs={"enable_thinking": False})`; `result.response_json` is a **JSON string**, parse with `json.loads` then `["choices"][0]["message"]["content"]`. Secondary teacher for 30% of items: `nvidia/Kimi-K2.6-NVFP4`. Calls take 20–60 s; use a thread pool of 24 and ask for **5 examples per call** as a JSON array to amortize latency. Pilot 40 examples first, print 10, continue only if format compliance ≥ 90%.

Pijin style guide (`pipeline/style_guide.md`): short plain sentences; glossary (pikinini child, bebi baby, hot bodi fever, sik sick, meresin medicine, dokta doctor, nes nurse, klinik clinic, hospitol hospital, wata water, kaikai food, susu breast milk, toraot vomit, sitsit wata diarrhoea, brit breathe, fit/sek-sek convulsion, slip tumas lethargic, nek stif stiff neck, blad blood, hariap fast, kwiktaem quickly, bot boat, sendem refer/send, lukim check, givim give, folom follow, askem ask, mi no sua I am not sure); prefer Pijin spellings over Bislama/Tok Pisin ("an" not "mo", "wata" not "wara", "blong" ok, "long" for in/at/to); numbers and drug names stay in English. Every teacher prompt includes the guideline chunk, the flags, the task type, the required output format, and 3 exemplars (write 12 gold exemplars by hand in the style guide, 2 per task type, half in Pijin).

Validation (`pipeline/validate.py`): format regex; ACTION consistent with red flags and flags; STM title exists; Pijin examples contain ≥ 3 glossary tokens; drop duplicates; judge pass with headless Claude (`claude -p --model sonnet ...`, run with `env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT`, prompt on stdin, `--output-format json`) on a 10% sample for guideline faithfulness, and record the judge score in `data/DATA_CARD.md`. The data card lists: sources (STM Children 2017, license status), teacher models, counts per type/language, what is not covered (adults, imaging, real patient data, native-speaker validation, dialects, obstetric care), and that all text is synthetic.

## 4. Training and export (TRAIN lane)

- River: `pipeline/train_river.py --data data/synth/train.jsonl --val data/synth/val.jsonl --base Qwen/Qwen3.5-9B --steps 180 --batch 32 --lr 2e-4 --rank 16 --out models/river/lokol-health-9b`. Use the renderer API (`from river_client.renderers import get_renderer, TrainOnWhat`; `get_renderer(base, thinking=False).build_training_example(msgs, train_on=..., train_on_eos=True)`), `model.train_step(batch, lr=..., loss_fn="cross_entropy")`, val every 30 steps by sampling 40 val prompts with `max_tokens=220, temperature=0` and scoring ACTION/STM exact match, `save_weights(name, mode="inference")` and `mode="training"`; write `checkpoint.json` with the `river://` paths and per-step loss to `steps.jsonl`. Reference implementation from last week: `~/Documents/GitHub/OYIHack/app/river/train.py` and `sentinel.py` (copy patterns, not the task).
- Local: `pipeline/train_mlx.sh <size>` → `mlx_lm.lora --model mlx-community/Qwen3.5-<size>-MLX-bf16 --train --data data/mlx/<size> --iters 600 --batch-size 4 --num-layers 16 --learning-rate 1e-4 --adapter-path models/adapters/<size>` (data must be in mlx-lm chat jsonl: `{"messages":[...]}`), then `mlx_lm.fuse --model ... --adapter-path ... --save-path models/fused/<size>`, then `convert_hf_to_gguf.py models/fused/<size> --outtype f16 --outfile models/gguf/lokol-health-<size>-f16.gguf` and `llama-quantize ... Q4_K_M`. Smoke-test the whole chain on 0.8B with 30 iters before the real run. If mlx-lm cannot load the Qwen3.5 VL config, strip to text config (`text_config` → top level, `architectures: ["Qwen3_5ForCausalLM"]`) in a local copy and retry; last resort: transformers + PEFT on MPS for 0.8B only.
- Eval: `pipeline/eval.py --model <gguf|river://|hf> --data data/synth/test.jsonl --out eval/<name>.json` reports: format compliance, ACTION accuracy, STM accuracy, red-flag recall, abstain precision/recall, Pijin glossary hit-rate, and an LLM-judge faithfulness score (headless Claude, 0–3) on 60 items; GGUF models are served with `llama-server -m <gguf> --port 8081` and called through the OpenAI-compatible endpoint; River checkpoints via `session.sample(..., checkpoint=...)`. Produce `eval/results.md` with base vs tuned for 0.8B, 2B, 9B (and 4B if trained), plus tokens/s and RAM from `llama-bench`.

## 5. Node graph and packs (STUDIO + RUNTIME)

`docs/schema/graph.json` (JSON schema) and TypeScript types in `app/src/types.ts`:
```ts
type NodeType = "channel" | "stt" | "llm" | "rag" | "gate" | "tts" | "router" | "note";
interface ModelRef { id: string; file: string; url: string; size_mb: number; license: string; runtime: "wllama"|"transformersjs"|"llama-server"|"river"|"python" }
interface GraphNode { id: string; type: NodeType; label: string; model?: ModelRef; params: Record<string, unknown>; online: boolean; position: {x:number;y:number} }
interface Graph { version: 1; name: string; sector: "health"|"agriculture"|"tourism"; language: string[]; target: { device: string; ram_gb: number; storage_gb: number; connectivity: "none"|"intermittent"|"online" }; nodes: GraphNode[]; edges: {from:string;to:string}[] }
```
Device table `app/src/data/devices.json`: ~60 common Android/iPhone models in the Pacific (brand, model, RAM GB, storage GB, SoC, Android version, year, price band). Recommender (`app/src/recommend.ts`): rules → tier (A: <3 GB RAM, B: 3–5, C: 6–8, D: laptop), picks model sizes per node, disables voice-in for Pijin on phones, sets `online` only when connectivity ≠ none, and emits plain-language reasons and "what will not work" notes.

Pack = `packs/<name>/manifest.json` (`Graph` + `models[]` with `url`, `sha256`, `size_mb`, `license` + `pwa_url`) and a zip with the manifest, README and QR (PNG) pointing to `<pwa_url>?pack=<manifest_url>`. Model files are hosted on Hugging Face under `VictorChenCA/lokol-*` (upload script in TRAIN lane) and loaded by URL; never bundled in the repo.

Runtime API (`app/src/runtime/engine.ts`, consumed by STUDIO):
```ts
loadPack(manifest: Manifest, onProgress): Promise<Engine>
engine.transcribe(audio: Blob, lang): Promise<string>        // Moonshine (en) via transformers.js; returns "" with reason if unsupported
engine.retrieve(query: string): Promise<Chunk[]>               // BM25 over corpus/stm_children_chunks.jsonl (shipped as app/public/packs/health/corpus.json)
engine.generate(flags, guidelineChunk, message, onToken): Promise<ParsedReply>  // wllama + protocol parser
engine.gate(message, reply): GateResult                        // red flags + abstain enforcement
engine.speak(text, lang): Promise<AudioBuffer>                  // MMS VITS pis via transformers.js, Kokoro en
engine.status(): { models: {id, loaded, size_mb}[], offline: boolean, memory_mb }
```
Default health pack models: LLM `lokol-health-0.8b-Q4_K_M.gguf` (fallback until ours exists: `ggml-org/Qwen3.5-0.8B-GGUF` Q4_K_M, and if wllama cannot run the Qwen3.5 hybrid architecture, fall back to `Qwen/Qwen3-0.6B` GGUF and say so in status), STT `onnx-community/moonshine-tiny-ONNX`, TTS `facebook/mms-tts-pis` (transformers.js VITS) and Kokoro-82M ONNX for English.

## 6. Studio UX (STUDIO lane)

Pages (React Router): **Home** (what Lokol is, three sector packs, "Open Studio"), **Studio** (React Flow canvas with custom node cards showing model, size, license, offline badge, online toggle; left palette of node types; right inspector; top bar: Recommend, Export pack, Run demo), **Recommend** (wizard: sector → languages → voice in/out → connectivity → device lookup with search over devices.json or manual RAM/storage → result page with the proposed graph, tier badges, "will not work" notes, one-click "Open in Studio"), **Demo** (Lokol Health chat: text or mic, flags panel (RDT/ACT/transport), shows ACTION badge, STM citation card with the chunk, reply, play voice; "offline" indicator from `navigator.onLine`; PWA install prompt), **Packs** (list, manifest viewer, download zip, QR), **Eval** (reads `eval/results.json` and renders base vs tuned tables and bars). Design: a confident, warm, non-generic look (follow the `frontend-design` skill), Pijin and English strings side by side where it matters, mobile-first for Demo. Service worker (vite-plugin-pwa) caches app shell and model files once loaded.

## 7. Bridge and sidecar

`bridge/server.py` (FastAPI, port 8090): `POST /twilio/whatsapp` (form-encoded Twilio webhook; verify signature when `TWILIO_AUTH_TOKEN` set), `GET/POST /messenger/webhook` (Meta verify + messages), `POST /message` (generic JSON for tests). Pipeline: detect language (Pijin glossary heuristic) → flags from a per-user state (`rdt`, `act`, `transport` set via commands like `/rdt no`) → BM25 retrieve (Python port of the same chunks) → call `http://127.0.0.1:8080/v1/chat/completions` (llama-server serving the 9B or 2B GGUF) → gate → reply; voice notes: download media with Twilio auth → ffmpeg to 16 kHz wav → `POST sidecar/asr` → same path → reply text plus a voice note from `POST sidecar/tts` served from `bridge/static/` behind the public cloudflared URL. `.env` keys: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` (sandbox number), `META_VERIFY_TOKEN`, `META_PAGE_TOKEN`, `PUBLIC_BASE_URL`. README with the exact Twilio sandbox steps (join code to +1 415 523 8886, webhook URL `<PUBLIC_BASE_URL>/twilio/whatsapp`).

`sidecar/server.py` (FastAPI, port 8091): `POST /asr` (wav → text; Pijin via `facebook/omnilingual-asr` CTC-300M if loadable, else `facebook/mms-1b-all` with `pis` adapter; English via mlx-whisper tiny), `POST /tts` (text, lang → wav; `facebook/mms-tts-pis` for pis, Kokoro for en), `GET /health`. Download script `sidecar/fetch_models.sh`, license notes in `sidecar/LICENSES.md` (MMS CC-BY-NC-4.0, Omnilingual Apache-2.0, Kokoro Apache-2.0).

## 8. Definition of done per lane (what the verifier checks)

- DATA: `corpus/stm_children_chunks.jsonl` ≥ 120 chunks with correct sections; `data/synth/train.jsonl` ≥ 2,500 valid rows, val/test ≥ 250 each; `data/DATA_CARD.md` written; a printed sample of 6 rows (3 Pijin) reads correctly.
- TRAIN: smoke chain on 0.8B passes (30 iters → fuse → GGUF Q4 → `llama-cli` answers in protocol format); River training script runs 5 steps on a sample without error; `pipeline/eval.py` runs on 20 test rows against base 0.8B GGUF and prints the metrics.
- STUDIO: `cd app && npm run build` passes; all six pages render; Recommend wizard produces a graph for a 2 GB and an 8 GB phone; Studio canvas edits a node and exports a manifest.
- RUNTIME: `engine.retrieve` unit test passes on the corpus; `engine.generate` runs in the browser with the fallback GGUF (verified via `npm run dev` + a Playwright or manual check that reports tokens); gate unit tests pass; TTS produces audio for a Pijin string.
- BRIDGE: `POST /message` returns a protocol-compliant reply using a local llama-server with the fallback GGUF; Twilio and Messenger handlers covered by unit tests with sample payloads.
- SIDECAR: `/tts` returns a wav for "Mi no sua, askem nes" and `/asr` transcribes a wav generated by `/tts` (round trip) in English; Pijin ASR loads or the README states the fallback.

Report back as structured data: files written, commands to run, what passed, what did not, open issues. Do not commit; the orchestrator commits.
