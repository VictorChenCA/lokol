# Runtime lane: npm packages the Studio app must add

`app/package.json` (STUDIO lane) does not yet list the in-browser inference packages that
`app/src/runtime/**` imports. Add these exact versions (all three are MIT/Apache, pure npm, no native deps):

```bash
cd app && npm install @wllama/wllama@3.8.1 @huggingface/transformers@4.3.0 kokoro-js@1.2.1
```

| Package | Version | Used by | Why |
|---|---|---|---|
| `@wllama/wllama` | 3.8.1 | `runtime/llm.ts` | llama.cpp WASM; loads GGUF by URL, OAI-style chat/completion, auto single/multi-thread |
| `@huggingface/transformers` | 4.3.0 | `runtime/tts.ts`, `runtime/stt.ts` | VITS (MMS Pijin TTS) + Moonshine ASR via ONNX Runtime Web |
| `kokoro-js` | 1.2.1 | `runtime/tts.ts` (dynamic import) | Kokoro-82M English TTS (bundles its own transformers 3.8.1; loaded lazily) |

Vite settings the Studio `vite.config.ts` should carry (already in `runtime/dev/vite.config.ts`):

```ts
server: { headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' } }, // crossOriginIsolated -> multi-thread wllama
optimizeDeps: { exclude: ['@wllama/wllama', '@huggingface/transformers', 'kokoro-js'] },
worker: { format: 'es' },
```

For the Vercel deploy add the same two headers in `vercel.json` (`headers` for `/(.*)`), otherwise wllama runs single-threaded (works, ~3x slower).

`runtime/llm.ts` imports the wasm with `import wasmUrl from '@wllama/wllama/esm/wasm/wllama.wasm?url'` (Vite resolves it; no copy step needed).

Local-only files: `runtime/dev/models/` (gitignored) holds the ONNX export of `facebook/mms-tts-pis` until it is uploaded to
`VictorChenCA/lokol-mms-tts-pis-onnx` (see `runtime/tools/export_mms_tts_onnx.py`). The engine tries the Hub repo first and
falls back to `/models/mms-tts-pis-onnx` (served by the dev harness).
