# Lokol runtime (in-browser engine)

`engine.ts` implements SPEC §5: `loadPack(manifest, onProgress)` -> `Engine` with `transcribe`, `retrieve`, `generate`, `gate`, `speak`, `status`, plus `ask()` (retrieve -> generate -> gate in one call). STUDIO's `runtime-loader.ts` imports it directly; shapes are a superset of `app/src/types.ts` (both the nested `{graph, models}` manifest and a flat Graph are accepted; `ParsedReply.stats`, `GateResult.reply`, `LoadProgress.loaded_mb/total_mb` are filled).

| File | What |
|---|---|
| `llm.ts` | wllama 3.8.1 (llama.cpp WASM). GGUF by URL with progress, OPFS cache, GGUF jinja template with `enable_thinking:false` (manual Qwen `<|im_start|>` prompt as fallback), streaming, tokens/s |
| `rag.ts` | BM25 over `app/public/packs/health/corpus.json` with a Pijin -> English synonym layer and concept coverage (`BM25Index.supports`) |
| `gate.ts` | 12 red flags (Pijin + English regex), adult-scope guard, protocol parser (`ACTION/STM/---`, note JSON), abstain enforcement, `SYSTEM_PROMPT`, `buildUserTurn` |
| `tts.ts` | Pijin: MMS VITS ONNX via transformers.js 4.3.0; English: Kokoro-82M via kokoro-js (lazy import) |
| `stt.ts` | Moonshine-tiny (en) via transformers.js; Pijin returns "" + reason (laptop-tier sidecar) |
| `tools/build_corpus.ts` | `corpus/stm_children_chunks.jsonl` -> `app/public/packs/health/corpus.json` (`bun app/src/runtime/tools/build_corpus.ts`) |
| `tools/export_mms_tts_onnx.py` | ONNX export + int8 quant of `facebook/mms-tts-pis` (local copy in `dev/models/`, gitignored) |
| `tests/run.ts` | 44 unit tests for rag + gate (`bun app/src/runtime/tests/run.ts`) |
| `dev/` | standalone Vite harness (`cd app/src/runtime/dev && npm install && npm run dev`, port 5177; `?auto=1` runs load/retrieve/ask/tts, `&short=1` skips the guideline excerpt, `&llm=<gguf url>` overrides the model, `&log=1` shows native llama.cpp logs) |

Packages the Studio app must add: see `package.deps.md` (`@wllama/wllama@3.8.1`, `@huggingface/transformers@4.3.0`, `kokoro-js@1.2.1`). `app/src/runtime/node_modules` is a gitignored symlink to `dev/node_modules` so the lane resolves them before STUDIO installs.

## Measured (Oct 3, M1 Max, Claude desktop browser pane, crossOriginIsolated, 6 threads, CPU WASM, no WebGPU)

- `ggml-org/Qwen3.5-0.8B-GGUF` Q4_0 (563 MB): **wllama 3.8.1 (libllama b11364) loads and runs the Qwen3.5 hybrid architecture** (`general.architecture = qwen35`, GGUF chat template detected). Cold download 40 s, OPFS-cached load 31 s.
- Generation (verifier re-measured Oct 3 21:45 with load average 14, other lanes and a game running): decode **6-10 tok/s** (llama.cpp `predicted_ms`; an earlier "2.8 tok/s" figure divided by total time including prefill), prefill 5-18 tok/s depending on how much of the prompt prefix is already in the KV cache. Short 148-token prompt cold: 30 s prefill, then 64 tokens in 7.9 s. **Full guideline prompt** (318 tokens, MALARIA p53 excerpt, system prefix cached): first token at 17.4 s, 32 tokens in 3.3 s, 20.7 s total. Budget ~20-40 s to first token for a full prompt on an idle M1 Max; keep the guideline excerpt at 350 tokens (SPEC) and show a progress state while prefill runs.
- Base Qwen3.5-0.8B ignores the protocol (it translated the nurse's message instead of answering) and the gate returned `ASK_PERSON` with reason "reply did not follow the ACTION/STM/--- protocol": the expected base-vs-tuned contrast.
- Retrieval in-browser: `hot bodi pikinini` -> FEVER (7.32) | SKIN DISEASES | CONVULSIONS; the realistic Pijin fever message -> MALARIA p53 (19.8). 4 ms per query over 183 chunks.
- Pijin TTS in-browser (transformers.js, int8 ONNX, local copy): "Mi no sua, askem nes." -> 1.94 s of 16 kHz audio, peak 0.20, rms 0.035; 5.0 s synth on first call. `VictorChenCA/lokol-mms-tts-pis-onnx` returned 401 (not uploaded yet; upload needs a human: `.venv/bin/python app/src/runtime/tools/export_mms_tts_onnx.py --upload VictorChenCA/lokol-mms-tts-pis-onnx`), the engine fell back to `/models/mms-tts-pis-onnx` as designed.
- English voice round trip in-browser (verifier, Oct 3): Kokoro-82M q8 via kokoro-js said "Refer now. This child has a danger sign." (3.33 s at 24 kHz, peak 0.43, 4.5 s synth, 18 s incl. 92 MB download); resampled to 16 kHz and fed to Moonshine-tiny, which transcribed "Refer now, this child has a danger sign." in 3.2 s. `transcribe(..., 'pis')` returns "" with the sidecar reason as designed. Only the live-mic path (button 6) still needs a human.
