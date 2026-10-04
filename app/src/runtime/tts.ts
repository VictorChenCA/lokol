// Text to speech: Pijin via MMS VITS (transformers.js, ONNX export of facebook/mms-tts-pis),
// English via Kokoro-82M (kokoro-js). Both return Float32Array PCM + sampling rate; helpers
// convert to AudioBuffer and play.
import { env, AutoTokenizer, VitsModel } from '@huggingface/transformers';

// Speech models are small; keep onnxruntime-web single-threaded so it never competes with (or waits on)
// the wllama thread pool on a phone. Multi-threaded ORT next to a busy wllama pool stalled in testing.
try {
  const wasm = (env as any).backends?.onnx?.wasm;
  if (wasm) wasm.numThreads = 1;
} catch {
  /* older transformers.js */
}

export interface PCM {
  audio: Float32Array;
  sampling_rate: number;
  seconds: number;
  ms: number; // synthesis time
}

export type ProgressCb = (loaded: number, total: number, file?: string) => void;

function progressAdapter(cb?: ProgressCb) {
  const seen = new Map<string, { loaded: number; total: number }>();
  return (p: any) => {
    if (!cb || !p || typeof p !== 'object') return;
    if (p.status === 'progress' && p.file) {
      seen.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
      let l = 0, t = 0;
      for (const v of seen.values()) { l += v.loaded; t += v.total; }
      cb(l, t, p.file);
    }
  };
}

// A model source is either a Hugging Face repo id ("owner/name") or a URL/path to a folder served
// over HTTP that contains config.json, tokenizer.json and onnx/model*.onnx (same layout).
function splitSource(source: string): { id: string; local: boolean; base?: string } {
  if (/^https?:\/\//.test(source) || source.startsWith('/') || source.startsWith('.')) {
    const clean = source.replace(/\/$/, '');
    const i = clean.lastIndexOf('/');
    return { id: clean.slice(i + 1), local: true, base: clean.slice(0, i + 1) };
  }
  return { id: source, local: false };
}

async function withSource<T>(source: string, fn: (id: string) => Promise<T>): Promise<T> {
  const s = splitSource(source);
  if (!s.local) return fn(s.id);
  const prev = { allowLocal: env.allowLocalModels, allowRemote: env.allowRemoteModels, localPath: env.localModelPath };
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  env.localModelPath = s.base!;
  try {
    return await fn(s.id);
  } finally {
    env.allowLocalModels = prev.allowLocal;
    env.allowRemoteModels = prev.allowRemote;
    env.localModelPath = prev.localPath;
  }
}

export class PijinTTS {
  private constructor(private tokenizer: any, private model: any, readonly sampling_rate: number, readonly source: string) {}

  static async load(source: string, opts: { dtype?: 'fp32' | 'q8'; onProgress?: ProgressCb; device?: 'wasm' | 'webgpu' } = {}): Promise<PijinTTS> {
    return withSource(source, async (id) => {
      const progress_callback = progressAdapter(opts.onProgress);
      const tokenizer = await AutoTokenizer.from_pretrained(id, { progress_callback });
      const model: any = await VitsModel.from_pretrained(id, { dtype: opts.dtype ?? 'q8', device: opts.device ?? 'wasm', progress_callback } as any);
      const sr = model.config?.sampling_rate ?? 16000;
      return new PijinTTS(tokenizer, model, sr, source);
    });
  }

  async speak(text: string): Promise<PCM> {
    const t0 = performance.now();
    const clean = text.replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
    const inputs = this.tokenizer(clean);
    const { waveform } = await this.model(inputs);
    const audio = waveform.data as Float32Array;
    return { audio, sampling_rate: this.sampling_rate, seconds: audio.length / this.sampling_rate, ms: Math.round(performance.now() - t0) };
  }
}

export class EnglishTTS {
  private constructor(private tts: any, readonly voice: string) {}

  static async load(modelId = 'onnx-community/Kokoro-82M-v1.0-ONNX', opts: { dtype?: 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16'; onProgress?: ProgressCb; voice?: string; device?: 'wasm' | 'webgpu' } = {}): Promise<EnglishTTS> {
    const { KokoroTTS } = await import('kokoro-js');
    const tts = await KokoroTTS.from_pretrained(modelId, { dtype: opts.dtype ?? 'q8', device: opts.device ?? 'wasm', progress_callback: progressAdapter(opts.onProgress) } as any);
    return new EnglishTTS(tts, opts.voice ?? 'af_heart');
  }

  async speak(text: string): Promise<PCM> {
    const t0 = performance.now();
    const out: any = await this.tts.generate(text, { voice: this.voice });
    const audio: Float32Array = out.audio;
    return { audio, sampling_rate: out.sampling_rate, seconds: audio.length / out.sampling_rate, ms: Math.round(performance.now() - t0) };
  }
}

export function toAudioBuffer(pcm: PCM, ctx?: AudioContext): AudioBuffer {
  const ac = ctx ?? new AudioContext();
  const buf = ac.createBuffer(1, pcm.audio.length, pcm.sampling_rate);
  buf.copyToChannel(pcm.audio as any, 0);
  return buf;
}

export async function playAudioBuffer(buf: AudioBuffer, ctx?: AudioContext): Promise<void> {
  const ac = ctx ?? new AudioContext();
  if (ac.state === 'suspended') await ac.resume();
  const src = ac.createBufferSource();
  src.buffer = buf;
  src.connect(ac.destination);
  return new Promise((resolve) => {
    src.onended = () => resolve();
    src.start();
  });
}

// 16-bit PCM WAV bytes (for download or for sending through a bridge).
export function toWav(pcm: PCM): Blob {
  const n = pcm.audio.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, pcm.sampling_rate, true); v.setUint32(28, pcm.sampling_rate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, pcm.audio[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}
