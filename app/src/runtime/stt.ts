// Speech to text (English) with Moonshine-tiny via transformers.js. Pijin voice-in is laptop-tier
// (Python sidecar); in the browser transcribe() returns "" and a reason for lang=pis.
import { pipeline } from '@huggingface/transformers';
import type { Lang } from './types';

export type ProgressCb = (loaded: number, total: number, file?: string) => void;

export interface TranscribeResult {
  text: string;
  reason?: string;
  ms: number;
  seconds: number;
}

/**
 * Approximate Pijin voice-in on a phone: multilingual Whisper base in the browser. Whisper has no Pijin, so with
 * language "en" and task "transcribe" it writes Pijin speech in English-like spelling. That is enough for Lokol:
 * the model was trained on Pijin text and the retrieval expands Pijin and English terms. Moonshine stays the
 * English default and STT_SUPPORT.pis stays false for the engine's own transcribe().
 */
export const PIS_APPROX = {
  catalog_id: 'whisper-base',
  model: 'onnx-community/whisper-base',
  size_mb: 136,
  language: 'en',
  task: 'transcribe' as const,
  label: 'Pijin, approximate (Whisper base)',
  note: 'Approximate for Pijin: transcribes Pijin speech in English-like spelling; the Lokol model was trained on Pijin text and the retrieval expands Pijin and English terms.',
};

export interface TranscribeOpts {
  /** Whisper only: spoken language hint. Leave unset for auto-detect. */
  language?: string;
  /** Whisper only: always "transcribe" here (never translate). */
  task?: 'transcribe' | 'translate';
}

export const STT_SUPPORT: Record<Lang, { ok: boolean; reason?: string }> = {
  en: { ok: true },
  pis: { ok: false, reason: 'Pijin voice-in runs on the laptop sidecar (Omnilingual ASR / MMS), not in the browser yet. Type the message in Pijin, or speak English.' },
};

export async function blobToPCM16k(blob: Blob): Promise<Float32Array> {
  const ab = await blob.arrayBuffer();
  const ac = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
  try {
    const decoded = await ac.decodeAudioData(ab.slice(0));
    const ch = decoded.getChannelData(0);
    if (decoded.sampleRate === 16000) return new Float32Array(ch);
    // resample with an OfflineAudioContext when the browser ignored the requested rate
    const frames = Math.ceil((decoded.length * 16000) / decoded.sampleRate);
    const off = new OfflineAudioContext(1, frames, 16000);
    const src = off.createBufferSource();
    src.buffer = decoded;
    src.connect(off.destination);
    src.start();
    const out = await off.startRendering();
    return new Float32Array(out.getChannelData(0));
  } finally {
    ac.close().catch(() => {});
  }
}

export class STT {
  private constructor(private asr: any, readonly modelId: string) {}

  static async load(modelId = 'onnx-community/moonshine-tiny-ONNX', opts: { onProgress?: ProgressCb; device?: 'wasm' | 'webgpu'; dtype?: any } = {}): Promise<STT> {
    const seen = new Map<string, { loaded: number; total: number }>();
    const progress_callback = (p: any) => {
      if (p?.status === 'progress' && p.file && opts.onProgress) {
        seen.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
        let l = 0, t = 0;
        for (const v of seen.values()) { l += v.loaded; t += v.total; }
        opts.onProgress(l, t, p.file);
      }
    };
    const asr = await pipeline('automatic-speech-recognition', modelId, {
      dtype: opts.dtype ?? { encoder_model: 'fp32', decoder_model_merged: 'q8' },
      device: opts.device ?? 'wasm',
      progress_callback,
    } as any);
    return new STT(asr, modelId);
  }

  get isWhisper(): boolean {
    return /whisper/i.test(this.modelId);
  }

  /**
   * lang is the conversation language. A multilingual Whisper also accepts lang "pis" (approximate, see
   * PIS_APPROX); English-only models refuse it with a reason.
   */
  async transcribe(audio: Blob | Float32Array, lang: Lang = 'en', opts: TranscribeOpts = {}): Promise<TranscribeResult> {
    const t0 = performance.now();
    const multilingual = this.isWhisper && !/\.en\b|whisper-[a-z]+\.en/i.test(this.modelId);
    if (!STT_SUPPORT[lang].ok && !multilingual) return { text: '', reason: STT_SUPPORT[lang].reason, ms: 0, seconds: 0 };
    const pcm = audio instanceof Float32Array ? audio : await blobToPCM16k(audio);
    const gen: Record<string, unknown> = {};
    if (multilingual) {
      gen.task = opts.task ?? 'transcribe';
      const language = opts.language ?? (lang === 'pis' ? PIS_APPROX.language : lang);
      if (language) gen.language = language;
    }
    // 30 s windows so a long voice note is not cut at Whisper's single-window limit
    if (this.isWhisper && pcm.length > 16000 * 30) { gen.chunk_length_s = 30; gen.stride_length_s = 5; }
    const out: any = await this.asr(pcm, gen);
    const text = (Array.isArray(out) ? out[0]?.text : out?.text) ?? '';
    return { text: text.trim(), ms: Math.round(performance.now() - t0), seconds: pcm.length / 16000 };
  }
}

// Record from the microphone for up to maxSeconds (or until stop() is called). Returns a webm/ogg Blob.
export function recordMic(maxSeconds = 10): { stop: () => void; done: Promise<Blob> } {
  let stopFn = () => {};
  const done = new Promise<Blob>(async (resolve, reject) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const parts: BlobPart[] = [];
      rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        resolve(new Blob(parts, { type: rec.mimeType }));
      };
      rec.start();
      const timer = setTimeout(() => rec.state !== 'inactive' && rec.stop(), maxSeconds * 1000);
      stopFn = () => { clearTimeout(timer); if (rec.state !== 'inactive') rec.stop(); };
    } catch (e) {
      reject(e);
    }
  });
  return { stop: () => stopFn(), done };
}
