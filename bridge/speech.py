"""Voice notes: media download -> ffmpeg 16 kHz mono wav -> sidecar /asr; sidecar /tts -> ogg/mp3 in
bridge/static served behind PUBLIC_BASE_URL.

Sidecar contract assumed (SPEC §7, sidecar lane): ``POST /asr`` multipart with ``file`` (wav) and
``lang`` form field, JSON ``{"text": "..."}``; ``POST /tts`` JSON ``{"text", "lang"}`` returning
``audio/wav`` bytes (or JSON with ``audio_b64``). Both are tolerated here.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import subprocess
import time
import uuid

import httpx

from .config import settings


async def download_media(url: str, auth: tuple[str, str] | None = None) -> tuple[bytes, str]:
    async with httpx.AsyncClient(timeout=30, follow_redirects=True, auth=auth) as client:
        r = await client.get(url)
        r.raise_for_status()
        return r.content, r.headers.get("content-type", "application/octet-stream")


def _ffmpeg(args_in: list[str], data: bytes, args_out: list[str]) -> bytes:
    cmd = [settings.ffmpeg, "-hide_banner", "-loglevel", "error", *args_in, "-i", "pipe:0", *args_out, "pipe:1"]
    p = subprocess.run(cmd, input=data, capture_output=True, check=False)
    if p.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {p.stderr.decode(errors='replace')[:300]}")
    return p.stdout


def to_wav16k(data: bytes) -> bytes:
    return _ffmpeg([], data, ["-ar", "16000", "-ac", "1", "-f", "wav"])


def wav_to_ogg(data: bytes) -> bytes:
    """WhatsApp voice notes: Opus in Ogg (audio/ogg)."""
    return _ffmpeg([], data, ["-c:a", "libopus", "-b:a", "32k", "-f", "ogg"])


def wav_to_mp3(data: bytes) -> bytes:
    return _ffmpeg([], data, ["-c:a", "libmp3lame", "-b:a", "48k", "-f", "mp3"])


async def transcribe(audio: bytes, lang: str) -> str:
    """Convert any audio to 16 kHz wav and send it to the sidecar. Returns '' when unavailable."""
    try:
        wav = await asyncio.to_thread(to_wav16k, audio)
    except Exception:
        return ""
    try:
        async with httpx.AsyncClient(timeout=settings.sidecar_timeout) as client:
            r = await client.post(
                settings.sidecar_url + "/asr",
                files={"file": ("note.wav", wav, "audio/wav")},
                data={"lang": lang},
            )
            r.raise_for_status()
            data = r.json()
            return str(data.get("text") or data.get("transcript") or "").strip()
    except Exception:
        return ""


async def synthesize(text: str, lang: str, fmt: str = "ogg") -> str | None:
    """Return a public URL to an audio file for `text`, or None if the sidecar is unavailable."""
    try:
        async with httpx.AsyncClient(timeout=settings.sidecar_timeout) as client:
            r = await client.post(settings.sidecar_url + "/tts", json={"text": text, "lang": lang})
            r.raise_for_status()
            ctype = r.headers.get("content-type", "")
            if "json" in ctype:
                data = r.json()
                b64 = data.get("audio_b64") or data.get("wav_base64") or data.get("audio")
                if not b64:
                    return None
                wav = base64.b64decode(b64)
            else:
                wav = r.content
    except Exception:
        return None
    try:
        if fmt == "mp3":
            out = await asyncio.to_thread(wav_to_mp3, wav)
        elif fmt == "wav":
            out = wav
        else:
            fmt = "ogg"
            out = await asyncio.to_thread(wav_to_ogg, wav)
    except Exception:
        return None
    audio_dir = settings.static_dir / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)
    name = f"{int(time.time())}-{hashlib.sha1(text.encode()).hexdigest()[:8]}-{uuid.uuid4().hex[:6]}.{fmt}"
    (audio_dir / name).write_bytes(out)
    return f"{settings.public_base_url}/static/audio/{name}"


async def sidecar_ready() -> bool:
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            r = await client.get(settings.sidecar_url + "/health")
            return r.status_code == 200
    except Exception:
        return False
