"""Lokol speech sidecar: Pijin + English ASR and TTS behind a tiny HTTP API (port 8091).

Endpoints
  GET  /health                -> which models are loaded, load times, RSS
  POST /tts  {text, lang}     -> audio/wav, 16 kHz mono PCM16   (lang: pis | en)
  POST /asr  multipart file + lang  -> {"text": ..., "model": ...}  (lang: pis | en | auto)

Models (all CPU; see LICENSES.md)
  pis TTS : facebook/mms-tts-pis            (transformers VitsModel, CC-BY-NC-4.0)
  en  TTS : hexgrad/Kokoro-82M via `kokoro` (Apache-2.0); fallback facebook/mms-tts-eng
  en  ASR : mlx-community/whisper-tiny via mlx-whisper (MIT)
  pis ASR : Meta Omnilingual ASR CTC-300M, int8 ONNX via sherpa-onnx (Apache-2.0)
            fallback: facebook/mms-1b-all + 'pis' adapter via transformers (CC-BY-NC-4.0), only if downloaded

Run:  .venv/bin/python sidecar/server.py            (or: uvicorn sidecar.server:app --port 8091)
Env:  SIDECAR_PORT (8091), SIDECAR_PRELOAD=1 (load every model at startup), SIDECAR_THREADS (4)
"""
from __future__ import annotations

import io
import os
import resource
import shutil
import subprocess
import tempfile
import threading
import time
from contextlib import asynccontextmanager
from typing import Optional

import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

SAMPLE_RATE = 16_000
THREADS = int(os.environ.get("SIDECAR_THREADS", "4"))

MMS_TTS_PIS = "facebook/mms-tts-pis"
MMS_TTS_ENG = "facebook/mms-tts-eng"
KOKORO_REPO = "hexgrad/Kokoro-82M"
KOKORO_VOICE = os.environ.get("SIDECAR_KOKORO_VOICE", "af_heart")
WHISPER_REPO = "mlx-community/whisper-tiny"
OMNI_REPO = "csukuangfj/sherpa-onnx-omnilingual-asr-1600-languages-300M-ctc-int8-2025-11-12"
MMS_ASR = "facebook/mms-1b-all"

PRELOAD_KEYS = ("tts_pis", "tts_en_kokoro", "asr_en_whisper", "asr_pis_omnilingual")


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    if os.environ.get("SIDECAR_PRELOAD", "0") not in ("", "0", "false"):
        t = time.time()
        for key in PRELOAD_KEYS:
            try:
                SLOTS[key].get()
            except Exception as e:  # noqa: BLE001
                print(f"[sidecar] preload {key} failed: {e}", flush=True)
        print(f"[sidecar] preload done in {time.time() - t:.1f}s, rss {rss_mb()} MB", flush=True)
    yield


app = FastAPI(title="Lokol speech sidecar", version="0.1.0", lifespan=_lifespan)

# --------------------------------------------------------------------------- helpers


def rss_mb() -> float:
    # ru_maxrss is bytes on macOS, kilobytes on Linux
    v = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return round(v / (1024 * 1024) if v > 1 << 32 or os.uname().sysname == "Darwin" else v / 1024, 1)


def wav_bytes(audio: np.ndarray, sr: int = SAMPLE_RATE) -> bytes:
    import soundfile as sf

    audio = np.asarray(audio, dtype=np.float32).reshape(-1)
    peak = float(np.max(np.abs(audio))) if audio.size else 0.0
    if peak > 1.0:
        audio = audio / peak
    buf = io.BytesIO()
    sf.write(buf, audio, sr, format="WAV", subtype="PCM_16")
    return buf.getvalue()


def to_16k_mono(audio: np.ndarray, sr: int) -> np.ndarray:
    from scipy.signal import resample_poly
    from math import gcd

    audio = np.asarray(audio, dtype=np.float32)
    if audio.ndim == 2:
        audio = audio.mean(axis=1)
    if sr != SAMPLE_RATE:
        g = gcd(sr, SAMPLE_RATE)
        audio = resample_poly(audio, SAMPLE_RATE // g, sr // g).astype(np.float32)
    return audio


def decode_audio(data: bytes, filename: str = "audio") -> np.ndarray:
    """Bytes of wav/flac/ogg/mp3/m4a -> float32 mono 16 kHz. Uses soundfile, then ffmpeg as a fallback."""
    import soundfile as sf

    try:
        audio, sr = sf.read(io.BytesIO(data), dtype="float32", always_2d=False)
        return to_16k_mono(audio, sr)
    except Exception as first:  # noqa: BLE001
        if not shutil.which("ffmpeg"):
            raise HTTPException(400, f"cannot decode {filename}: {first}; ffmpeg not found for fallback")
        with tempfile.TemporaryDirectory() as td:
            src = os.path.join(td, "in" + (os.path.splitext(filename)[1] or ".bin"))
            dst = os.path.join(td, "out.wav")
            open(src, "wb").write(data)
            r = subprocess.run(
                ["ffmpeg", "-y", "-loglevel", "error", "-i", src, "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "wav", dst],
                capture_output=True, text=True,
            )
            if r.returncode != 0:
                raise HTTPException(400, f"cannot decode {filename}: {r.stderr.strip()[:300]}")
            audio, sr = sf.read(dst, dtype="float32", always_2d=False)
            return to_16k_mono(audio, sr)


# --------------------------------------------------------------------------- model registry


class Slot:
    """A lazily loaded model with load timing and an error memo."""

    def __init__(self, name: str, loader):
        self.name = name
        self._loader = loader
        self._lock = threading.Lock()
        self.obj = None
        self.load_s: Optional[float] = None
        self.error: Optional[str] = None
        self.rss_after_mb: Optional[float] = None

    def get(self):
        if self.obj is not None:
            return self.obj
        with self._lock:
            if self.obj is not None:
                return self.obj
            if self.error:
                raise RuntimeError(self.error)
            t = time.time()
            try:
                self.obj = self._loader()
            except Exception as e:  # noqa: BLE001
                self.error = f"{type(e).__name__}: {e}"[:400]
                raise
            self.load_s = round(time.time() - t, 2)
            self.rss_after_mb = rss_mb()
            return self.obj

    def status(self):
        return {"loaded": self.obj is not None, "load_s": self.load_s, "rss_after_mb": self.rss_after_mb, "error": self.error}


def _load_mms_tts(repo: str):
    import torch
    from transformers import AutoTokenizer, VitsModel

    torch.set_num_threads(THREADS)
    tok = AutoTokenizer.from_pretrained(repo)
    model = VitsModel.from_pretrained(repo).eval()
    return tok, model


def _load_kokoro():
    from kokoro import KPipeline

    pipe = KPipeline(lang_code="a", repo_id=KOKORO_REPO)  # 'a' = American English
    # warm the voice so the first request does not pay for the download
    pipe.load_voice(KOKORO_VOICE)
    return pipe


def _load_whisper():
    import mlx_whisper
    from huggingface_hub import snapshot_download

    path = snapshot_download(WHISPER_REPO, allow_patterns=["config.json", "weights.npz"])
    # one dummy call compiles the graph and caches weights inside mlx_whisper
    mlx_whisper.transcribe(np.zeros(SAMPLE_RATE, dtype=np.float32), path_or_hf_repo=path, language="en", fp16=False)
    return path


def _load_omnilingual():
    import sherpa_onnx
    from huggingface_hub import hf_hub_download

    model = hf_hub_download(OMNI_REPO, "model.int8.onnx")
    tokens = hf_hub_download(OMNI_REPO, "tokens.txt")
    return sherpa_onnx.OfflineRecognizer.from_omnilingual_asr_ctc(model=model, tokens=tokens, num_threads=THREADS)


def _load_mms_asr():
    """Fallback Pijin ASR: facebook/mms-1b-all with the 'pis' adapter. Only works if fetch_models.sh --mms-asr ran."""
    import torch
    from huggingface_hub import try_to_load_from_cache
    from transformers import AutoProcessor, Wav2Vec2ForCTC

    if not isinstance(try_to_load_from_cache(MMS_ASR, "model.safetensors"), str):
        raise FileNotFoundError("facebook/mms-1b-all not downloaded; run sidecar/fetch_models.sh --mms-asr")
    torch.set_num_threads(THREADS)
    proc = AutoProcessor.from_pretrained(MMS_ASR)
    model = Wav2Vec2ForCTC.from_pretrained(MMS_ASR, ignore_mismatched_sizes=True).eval()
    proc.tokenizer.set_target_lang("pis")
    model.load_adapter("pis")
    return proc, model


SLOTS = {
    "tts_pis": Slot(MMS_TTS_PIS, lambda: _load_mms_tts(MMS_TTS_PIS)),
    "tts_en_kokoro": Slot(KOKORO_REPO, _load_kokoro),
    "tts_en_mms": Slot(MMS_TTS_ENG, lambda: _load_mms_tts(MMS_TTS_ENG)),
    "asr_en_whisper": Slot(WHISPER_REPO, _load_whisper),
    "asr_pis_omnilingual": Slot("facebook/omniASR-CTC-300M (sherpa-onnx int8)", _load_omnilingual),
    "asr_pis_mms": Slot(MMS_ASR + " +pis adapter", _load_mms_asr),
}


# --------------------------------------------------------------------------- TTS


def tts_mms(repo_slot: str, text: str) -> np.ndarray:
    import torch

    tok, model = SLOTS[repo_slot].get()
    inputs = tok(text, return_tensors="pt")
    if inputs["input_ids"].shape[-1] == 0:
        raise HTTPException(400, "text contains no characters the MMS tokenizer knows")
    with torch.no_grad():
        out = model(**inputs)
    wav = out.waveform[0].cpu().numpy()
    return to_16k_mono(wav, int(model.config.sampling_rate))


def tts_kokoro(text: str) -> np.ndarray:
    pipe = SLOTS["tts_en_kokoro"].get()
    chunks = []
    for _gs, _ps, audio in pipe(text, voice=KOKORO_VOICE, speed=1.0):
        if audio is not None:
            chunks.append(np.asarray(audio, dtype=np.float32).reshape(-1))
    if not chunks:
        raise HTTPException(400, "kokoro produced no audio")
    return to_16k_mono(np.concatenate(chunks), 24_000)


class TTSRequest(BaseModel):
    text: str
    lang: str = "pis"


async def _read_tts_request(request: Request) -> TTSRequest:
    ctype = request.headers.get("content-type", "")
    if "json" in ctype:
        return TTSRequest(**(await request.json()))
    form = await request.form()
    return TTSRequest(text=str(form.get("text", "")), lang=str(form.get("lang", "pis")))


@app.post("/tts")
async def tts(request: Request):
    """Body: JSON {"text": "...", "lang": "pis"|"en"} or form fields. Returns audio/wav 16 kHz mono."""
    req = await _read_tts_request(request)
    text = req.text.strip()
    lang = req.lang.lower().strip()
    if not text:
        raise HTTPException(400, "text is empty")
    if len(text) > 2000:
        raise HTTPException(413, "text longer than 2000 characters")
    t0 = time.time()
    if lang in ("pis", "pijin", "pis_latn"):
        audio, model = tts_mms("tts_pis", text), MMS_TTS_PIS
    elif lang in ("en", "eng", "english"):
        try:
            audio, model = tts_kokoro(text), KOKORO_REPO
        except HTTPException:
            raise
        except Exception as e:  # noqa: BLE001  kokoro unavailable -> MMS English VITS
            audio, model = tts_mms("tts_en_mms", text), f"{MMS_TTS_ENG} (kokoro failed: {type(e).__name__})"
    else:
        raise HTTPException(400, f"unsupported lang {lang!r}; use pis or en")
    data = wav_bytes(audio)
    return Response(
        content=data,
        media_type="audio/wav",
        headers={
            "X-Lokol-Model": model,
            "X-Lokol-Duration-S": f"{len(audio) / SAMPLE_RATE:.2f}",
            "X-Lokol-Elapsed-S": f"{time.time() - t0:.2f}",
        },
    )


# --------------------------------------------------------------------------- ASR


def asr_whisper(audio: np.ndarray) -> str:
    import mlx_whisper

    path = SLOTS["asr_en_whisper"].get()
    out = mlx_whisper.transcribe(audio, path_or_hf_repo=path, language="en", fp16=False)
    return (out.get("text") or "").strip()


def asr_omnilingual(audio: np.ndarray) -> str:
    rec = SLOTS["asr_pis_omnilingual"].get()
    s = rec.create_stream()
    s.accept_waveform(SAMPLE_RATE, audio)
    rec.decode_stream(s)
    return (s.result.text or "").strip()


def asr_mms(audio: np.ndarray) -> str:
    import torch

    proc, model = SLOTS["asr_pis_mms"].get()
    inputs = proc(audio, sampling_rate=SAMPLE_RATE, return_tensors="pt")
    with torch.no_grad():
        logits = model(**inputs).logits
    ids = torch.argmax(logits, dim=-1)[0]
    return proc.decode(ids).strip()


@app.post("/asr")
async def asr(
    file: UploadFile = File(..., description="wav/flac/ogg/mp3/m4a audio"),
    lang: str = Form("auto", description="pis | en | auto"),
):
    """Multipart: file=<audio>, lang=pis|en|auto. Returns {text, lang, model, audio_s, elapsed_s}."""
    data = await file.read()
    if not data:
        raise HTTPException(400, "empty upload")
    if len(data) > 25 * 1024 * 1024:
        raise HTTPException(413, "audio larger than 25 MB")
    audio = decode_audio(data, file.filename or "audio")
    if audio.size < SAMPLE_RATE // 10:
        raise HTTPException(400, "audio shorter than 0.1 s")
    lang = (lang or "auto").lower().strip()
    t0 = time.time()
    if lang in ("en", "eng", "english"):
        text, model = asr_whisper(audio), WHISPER_REPO
    elif lang in ("pis", "pijin", "pis_latn", "auto"):
        try:
            text, model = asr_omnilingual(audio), "facebook/omniASR-CTC-300M (sherpa-onnx int8)"
        except Exception as e_omni:  # noqa: BLE001
            try:
                text, model = asr_mms(audio), f"{MMS_ASR} +pis adapter"
            except Exception as e_mms:  # noqa: BLE001
                if lang == "auto":
                    text, model = asr_whisper(audio), f"{WHISPER_REPO} (pijin ASR unavailable)"
                else:
                    raise HTTPException(503, f"Pijin ASR unavailable. omnilingual: {e_omni}; mms: {e_mms}")
    else:
        raise HTTPException(400, f"unsupported lang {lang!r}; use pis, en or auto")
    return JSONResponse(
        {
            "text": text,
            "lang": lang,
            "model": model,
            "audio_s": round(len(audio) / SAMPLE_RATE, 2),
            "elapsed_s": round(time.time() - t0, 2),
        }
    )


# --------------------------------------------------------------------------- health


@app.get("/health")
def health():
    return {
        "status": "ok",
        "sample_rate": SAMPLE_RATE,
        "rss_mb": rss_mb(),
        "threads": THREADS,
        "models": {k: {"name": v.name, **v.status()} for k, v in SLOTS.items()},
        "routes": {
            "tts": {"pis": MMS_TTS_PIS, "en": f"{KOKORO_REPO} -> {MMS_TTS_ENG}"},
            "asr": {"en": WHISPER_REPO, "pis": "omnilingual CTC-300M (sherpa-onnx) -> mms-1b-all pis adapter"},
        },
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("SIDECAR_PORT", "8091")), log_level="info")
