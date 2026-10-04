# Lokol speech sidecar

A small Python HTTP service (FastAPI, port **8091**) that gives the WhatsApp/Messenger bridge and the laptop pack
**Pijin and English speech in and out**. Everything runs on CPU on a laptop; nothing leaves the machine.

| Direction | Language | Model | Backend | License |
|---|---|---|---|---|
| Text → speech | Pijin (`pis`) | Meta MMS TTS `facebook/mms-tts-pis` (VITS, 36M) | transformers + torch | CC-BY-NC-4.0 |
| Text → speech | English (`en`) | Kokoro-82M (`hexgrad/Kokoro-82M`) | `kokoro` pip package | Apache-2.0 |
| Text → speech | English fallback | `facebook/mms-tts-eng` | transformers + torch | CC-BY-NC-4.0 |
| Speech → text | English (`en`) | Whisper tiny (`mlx-community/whisper-tiny`) | mlx-whisper (Apple Silicon) | MIT |
| Speech → text | Pijin (`pis`) and 1,600 languages | Meta **Omnilingual ASR CTC-300M**, int8 ONNX | sherpa-onnx (CPU) | Apache-2.0 |
| Speech → text | Pijin fallback | `facebook/mms-1b-all` + `pis` adapter | transformers + torch | CC-BY-NC-4.0 |

Full license notes and what they mean for a deployment: [`LICENSES.md`](LICENSES.md).

## Setup (once)

```bash
# from the repo root; the venv already exists
uv pip install --python .venv/bin/python -r sidecar/requirements.txt
sidecar/fetch_models.sh            # ~1.1 GB into ~/.cache/huggingface/hub
# optional non-commercial fallback for Pijin ASR (3.9 GB):
# sidecar/fetch_models.sh --mms-asr
```

Needs `ffmpeg` on PATH only for non-wav uploads (ogg/opus voice notes from WhatsApp); wav/flac decode without it.

## Run

```bash
.venv/bin/python sidecar/server.py                  # http://127.0.0.1:8091, models load lazily on first use
SIDECAR_PRELOAD=1 .venv/bin/python sidecar/server.py # load all four main models at startup (16–33 s; 16 s with a warm OS file cache, 33 s first time)
```

Env: `SIDECAR_PORT` (8091), `SIDECAR_THREADS` (4), `SIDECAR_KOKORO_VOICE` (`af_heart`), `SIDECAR_PRELOAD` (0).

## API

```bash
# health: which models are loaded, how long each took, resident memory
curl -s localhost:8091/health | jq

# text -> 16 kHz mono PCM16 wav. lang = pis | en
curl -s localhost:8091/tts -H 'content-type: application/json' \
  -d '{"text":"Mi no sua, askem nes o dokta","lang":"pis"}' -o pijin.wav
# response headers: X-Lokol-Model, X-Lokol-Duration-S (audio length), X-Lokol-Elapsed-S (synthesis time)

# audio -> text. lang = pis | en | auto   (wav/flac/ogg/mp3/m4a; any sample rate, resampled to 16 kHz)
curl -s localhost:8091/asr -F file=@pijin.wav -F lang=pis
# {"text":"...","lang":"pis","model":"facebook/omniASR-CTC-300M (sherpa-onnx int8)","audio_s":2.4,"elapsed_s":0.3}
```

`/tts` also accepts form fields (`text`, `lang`). `auto` on `/asr` runs the Omnilingual model (it is language-agnostic)
and falls back to Whisper if Pijin ASR is unavailable; the `model` field always says which model answered.

Smoke test (server must be running): `.venv/bin/python sidecar/smoke.py` writes `samples/pijin.wav` and
`samples/en.wav`, round-trips both through `/asr`, and prints load times and RSS.

## Measured on an Apple M1 Max (64 GB), CPU only, 4 threads, 2026-10-03

Load = first request in a fresh process (includes the torch/transformers import for the first torch model).
RSS = resident memory of the sidecar process after that model was added, all models kept resident.

| Model | Load (cold) | Added RSS | Warm inference | Input / output |
|---|---|---|---|---|
| MMS TTS Pijin (VITS, 36M) | 24.7 s (of which ~20 s is the first torch + transformers import) | ~510 MB (process baseline incl. torch) | **0.42 s** | "Mi no sua, askem nes o dokta" → 2.4 s of audio |
| Kokoro-82M English TTS | 5.0 s | +1,190 MB (spacy/misaki G2P + model) | **1.20 s** | 19-word sentence → 6.2 s of audio |
| Whisper tiny (mlx-whisper) | 2.7 s | +520 MB | **0.14 s** | 6.2 s of audio → text |
| Omnilingual ASR CTC-300M (sherpa-onnx int8) | 0.9 s | +390 MB | **0.21 s** | 2.4 s of audio → text |
| **All four resident** | 33 s first time, 16 s with a warm OS file cache | **2.1 GB resident, 2.6–2.7 GB peak after inference** | | |

Round-trip results from `smoke.py` (synthetic voice in, same machine, no noise), three runs:

- English: Kokoro → Whisper tiny gave *"Give Periset a Mal now and bring the child back in two days, or sooner if the fever is worse."* every time (4 of 5 keywords; the drug name is the miss, as expected from the tiny model; use `whisper-base` or `small` if the laptop has RAM to spare).
- Pijin: MMS TTS → Omnilingual CTC for "Mi no sua, askem nes o dokta" gave *"mi no soa askem nesfa dokta"*, *"mi no sua haskem neiso dob ta"* and *"mi no soa askem na i sodog ta"* (VITS output is stochastic, so each run synthesises slightly different audio). The model is phonetic and un-normalised; the bridge's Pijin glossary matcher should be tolerant of spelling, and the LLM sees the raw transcript.

## Decisions and fallbacks

- **Pijin ASR = Omnilingual ASR CTC-300M via sherpa-onnx.** Meta ships the 300M CTC model as a fairseq2 checkpoint;
  the `omnilingual-asr` pip package pulls in fairseq2 and pins torch 2.8, which would downgrade the shared venv. The
  k2-fsa/sherpa-onnx project publishes the same weights as an int8 ONNX file (365 MB, Apache-2.0), which loads in
  seconds on CPU with no torch at all. The CTC model is not language-conditioned, so `lang=pis` and `lang=auto` are the
  same call; `lang` is kept for routing and logging.
- **If the ONNX model is missing**, `/asr lang=pis` falls back to `facebook/mms-1b-all` with the `pis` adapter
  (transformers `Wav2Vec2ForCTC.load_adapter("pis")`), which is CC-BY-NC and 3.9 GB, so it is opt-in
  (`fetch_models.sh --mms-asr`). If neither is available the endpoint returns 503 with both error messages.
- **English TTS = Kokoro**, with `facebook/mms-tts-eng` as the automatic fallback if the `kokoro` package cannot
  import or run (it pulls spacy and misaki; the first import is slow).
- **English ASR = mlx-whisper tiny**, Apple Silicon only. On Linux swap `asr_whisper()` for `faster-whisper` or the
  Omnilingual model, which also transcribes English.
- **Output is always 16 kHz mono PCM16 wav** so the bridge can hand it to ffmpeg/Twilio unchanged; Kokoro's 24 kHz
  output is resampled.
- **Pijin voice quality**: MMS TTS Pijin is a single synthetic voice trained on read Bible text; it is intelligible but
  flat. Spelling matters (it reads letters, not words), so the LLM's output should use the style-guide spellings.
  Omnilingual ASR saw ~25 h of Pijin; expect usable but imperfect transcripts, and expect it to spell phonetically.

## Laptop-tier requirements (for the Studio recommender)

- Disk: ~1.1 GB of weights for the four main models (+3.9 GB if the MMS ASR fallback is fetched).
- RAM: see the table above; budget **3 GB** for the sidecar process with all four models resident (2.7 GB measured peak), **1 GB** for a Pijin-only voice-out + ASR configuration (MMS TTS + Omnilingual, no Kokoro, no Whisper), plus whatever `llama-server` needs for the LLM tier.
- CPU: any Apple Silicon or x86-64 laptop; no GPU needed. Whisper via MLX is Apple-only (see fallback above).
- These models do not fit the phone tier tonight: the Studio marks Pijin voice-in as laptop-only and ships Pijin
  voice-out in the browser via transformers.js (`facebook/mms-tts-pis`), which is the same model as here.
