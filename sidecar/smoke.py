"""Smoke test for the Lokol speech sidecar. Starts nothing; expects the server on $SIDECAR_URL (default http://127.0.0.1:8091).

  .venv/bin/python sidecar/smoke.py

Writes sidecar/samples/pijin.wav and sidecar/samples/en.wav, round-trips en.wav through /asr (lang=en)
and pijin.wav through /asr (lang=pis), and prints model load times and RSS from /health.
"""
from __future__ import annotations

import io
import json
import os
import sys
import time

import httpx
import soundfile as sf

BASE = os.environ.get("SIDECAR_URL", "http://127.0.0.1:8091")
HERE = os.path.dirname(os.path.abspath(__file__))
SAMPLES = os.path.join(HERE, "samples")
os.makedirs(SAMPLES, exist_ok=True)

PIJIN = "Mi no sua, askem nes o dokta"
ENGLISH = "Give paracetamol now and bring the child back in two days, or sooner if the fever is worse."


def wait_ready(timeout_s: float = 600) -> None:
    t0 = time.time()
    while True:
        try:
            r = httpx.get(f"{BASE}/health", timeout=5)
            if r.status_code == 200:
                return
        except Exception:  # noqa: BLE001
            pass
        if time.time() - t0 > timeout_s:
            sys.exit(f"server at {BASE} not ready after {timeout_s}s")
        time.sleep(1)


def tts(text: str, lang: str, out: str) -> float:
    t = time.time()
    r = httpx.post(f"{BASE}/tts", json={"text": text, "lang": lang}, timeout=900)
    r.raise_for_status()
    open(out, "wb").write(r.content)
    audio, sr = sf.read(io.BytesIO(r.content))
    dur = len(audio) / sr
    print(f"/tts lang={lang:3} -> {os.path.relpath(out)}  {dur:.2f}s audio @ {sr} Hz, "
          f"{len(r.content)/1024:.0f} KB, model={r.headers.get('x-lokol-model')}, "
          f"synth={r.headers.get('x-lokol-elapsed-s')}s, wall={time.time()-t:.1f}s")
    return dur


def asr(path: str, lang: str) -> dict:
    t = time.time()
    with open(path, "rb") as f:
        r = httpx.post(f"{BASE}/asr", files={"file": (os.path.basename(path), f, "audio/wav")}, data={"lang": lang}, timeout=900)
    r.raise_for_status()
    j = r.json()
    print(f"/asr lang={lang:4} {os.path.relpath(path)} -> {j['text']!r}  model={j['model']}  "
          f"infer={j['elapsed_s']}s wall={time.time()-t:.1f}s")
    return j


def main() -> int:
    wait_ready()
    ok = True

    pij = os.path.join(SAMPLES, "pijin.wav")
    en = os.path.join(SAMPLES, "en.wav")
    tts(PIJIN, "pis", pij)
    tts(ENGLISH, "en", en)

    en_asr = asr(en, "en")
    words = {w.strip(".,").lower() for w in en_asr["text"].split()}
    hits = [w for w in ("paracetamol", "child", "two", "days", "fever") if w in words]
    print(f"   English round trip keyword hits: {hits}")
    if len(hits) < 3:
        ok = False
        print("   FAIL: English round trip lost the content")

    pis_asr = asr(pij, "pis")
    if not pis_asr["text"]:
        ok = False
        print("   FAIL: Pijin ASR returned empty text")

    h = httpx.get(f"{BASE}/health", timeout=10).json()
    print(f"\n/health rss_mb={h['rss_mb']} threads={h['threads']}")
    for k, m in h["models"].items():
        if m["loaded"] or m["error"]:
            print(f"   {k:22} loaded={m['loaded']} load_s={m['load_s']} rss_after_mb={m['rss_after_mb']} error={m['error']}")
    print("\nRESULT:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
