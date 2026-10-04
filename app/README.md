# Lokol Studio (app/)

Vite + React 18 + TypeScript + Tailwind + React Flow (`@xyflow/react`) + React Router + vite-plugin-pwa.

## Commands

```bash
cd app
bun install            # or npm install
npm run dev            # http://localhost:5173
npm run build          # tsc -b && vite build  -> dist/ (PWA service worker included)
npm run test           # vitest: recommend.ts rules, pack export
npm run preview        # serve dist/
```

Environment (`app/.env`, see `.env.example`):

- `VITE_RUNTIME=shim` uses `src/runtime-shim.ts` (canned replies, no model download). Leave it unset to use `src/runtime/engine.ts` (RUNTIME lane). The loader (`src/runtime-loader.ts`) falls back to the shim if the engine file is missing or throws on import.
- `VITE_PWA_URL` is the public URL written into pack manifests and QR codes.

## Routes

| Route | What it does |
|---|---|
| `/` | Home: what Lokol is, the three sector packs, coverage statement |
| `/studio` | Node graph editor: palette (click or drag), canvas, inspector, online toggle per node, Load preset, Recommend, Export pack (zip), Run demo. `?preset=health|agriculture|tourism` loads a preset. Graph persists in `localStorage` |
| `/recommend` | Wizard: sector → languages → voice → signal → phone (search `devices.json` or manual) → result with tier badge, graph, reasons, "what will not work", Open in Studio / Export / Run demo |
| `/demo` | Lokol Health chat: flags panel (language, RDT, ACT, transport), mic, ACTION badge, STM citation card, play voice, offline indicator, PWA install. Takes a graph from router state (Studio/Recommend) or `?pack=<manifest url>`; defaults to the health preset |
| `/packs` | Your exports (localStorage) + the three presets: graph, model table, manifest JSON, QR, zip download |
| `/eval` | Renders `public/eval/results.json`; falls back to `results.sample.json` (marked SAMPLE) |

## Files owned by STUDIO

- `src/types.ts`: Graph/Node/ModelRef/Manifest types and the runtime `Engine` interface (SPEC §5). RUNTIME imports from here.
- `src/recommend.ts`: tier rules (A < 3 GB, B 3–5, C 6–8, D laptop), model ladder with storage step-down, voice rules, online rules, reasons and will-not-work notes.
- `src/data/devices.json`: 82 phones common in Pacific markets (approximate specs).
- `src/data/presets.ts`: health, agriculture, tourism graphs.
- `src/models.ts`: model catalogue (ids, HF URLs, sizes, licenses).
- `src/pack.ts`: manifest build, README, QR (qrcode), zip (JSZip).
- `src/store.ts`: zustand store for the Studio graph.
- `public/schema/graph.json`: JSON schema for `Graph` (copy to `docs/schema/graph.json`).
- `public/eval/results.sample.json`: placeholder eval structure.

## What the Demo page needs from RUNTIME (`src/runtime/engine.ts`)

`export async function loadPack(manifest: Manifest, onProgress?: (p: LoadProgress) => void): Promise<Engine>` where `Engine` is the interface in `src/types.ts`:

- `retrieve(query)` returns `Chunk[]` (top-1 is passed to `generate`).
- `generate(flags, chunk | null, message, onToken)` streams raw protocol text through `onToken` and resolves a `ParsedReply` (`action`, `stm`, `body`, `raw`, optional `note`, optional `stats {ms,tokens,tps}`). The Demo renders text after the `---` line while streaming.
- `gate(message, reply)` returns `GateResult` (`action`, `reason`, `red_flags`, `reply`, `overridden`). Beware negations ("no fit", "nomoa sek-sek"); the shim strips them before matching.
- `speak(text, lang)` returns an `AudioBuffer` the page plays with WebAudio.
- `transcribe(blob, lang)` returns `""` for unsupported languages (the page then shows the laptop-tier note).
- `status()` returns loaded models, `offline`, `memory_mb`, optional `notes[]` (shown in the footer).
- Progress callbacks keyed by `model_id` drive the per-model loading bars.
