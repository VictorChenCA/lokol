// Energy-based voice activity detection for hands-free "Talk" mode (speech-to-speech in the Demo).
// No model: an AnalyserNode gives the microphone level every ~30 ms; speech starts after ~200 ms above the
// threshold and ends after ~900 ms of silence (or at 20 s). The captured audio comes back as 16 kHz mono PCM,
// with a short pre-roll so the first syllable is not clipped. Pure parts (EnergyVad, rms, downsample, pcmToWav)
// are unit-tested in vad.test.ts with synthetic buffers.

export interface VadOptions {
  /** RMS level (0..1) that counts as speech. Calibrated upward from the room's noise floor at start. */
  threshold?: number;
  /** Time above threshold before speech counts as started. */
  startMs?: number;
  /** Time below threshold (after speech) before the utterance ends. */
  silenceMs?: number;
  /** Hard cap on one utterance. */
  maxMs?: number;
  /** Below threshold * hysteresis counts as silence once speech has started. */
  hysteresis?: number;
}

export type VadEvent = "start" | "end" | "timeout";
export type VadState = "idle" | "speech" | "done";

export const VAD_DEFAULTS: Required<VadOptions> = { threshold: 0.02, startMs: 200, silenceMs: 900, maxMs: 20000, hysteresis: 0.75 };

/** Root-mean-square level of one frame. */
export function rms(buf: ArrayLike<number>): number {
  if (!buf.length) return 0;
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / buf.length);
}

/** Frame-by-frame state machine. Feed it a level and the frame duration; it returns an event on transitions. */
export class EnergyVad {
  readonly opts: Required<VadOptions>;
  state: VadState = "idle";
  private aboveMs = 0;
  private silentMs = 0;
  private speechMs = 0;

  constructor(opts: VadOptions = {}) {
    this.opts = { ...VAD_DEFAULTS, ...opts };
  }

  /** Milliseconds since speech started (0 while idle). */
  get elapsedMs() {
    return this.speechMs;
  }

  push(level: number, dtMs: number): VadEvent | null {
    const o = this.opts;
    if (this.state === "done") return null;
    if (this.state === "idle") {
      if (level >= o.threshold) {
        this.aboveMs += dtMs;
        if (this.aboveMs >= o.startMs) {
          this.state = "speech";
          this.speechMs = this.aboveMs;
          this.silentMs = 0;
          return "start";
        }
      } else {
        this.aboveMs = 0;
      }
      return null;
    }
    // speech
    this.speechMs += dtMs;
    if (level < o.threshold * o.hysteresis) this.silentMs += dtMs;
    else this.silentMs = 0;
    if (this.silentMs >= o.silenceMs) {
      this.state = "done";
      return "end";
    }
    if (this.speechMs >= o.maxMs) {
      this.state = "done";
      return "timeout";
    }
    return null;
  }

  reset() {
    this.state = "idle";
    this.aboveMs = this.silentMs = this.speechMs = 0;
  }
}

/** Average-and-pick downsampler (any rate to 16 kHz by default). Good enough for speech recognition. */
export function downsample(input: Float32Array, fromRate: number, toRate = 16000): Float32Array {
  if (fromRate === toRate) return new Float32Array(input);
  if (fromRate < toRate) {
    // upsample linearly (rare: some browsers give 8 kHz Bluetooth mics)
    const n = Math.floor((input.length * toRate) / fromRate);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * fromRate) / toRate;
      const a = Math.floor(x);
      const b = Math.min(input.length - 1, a + 1);
      out[i] = input[a] + (input[b] - input[a]) * (x - a);
    }
    return out;
  }
  const ratio = fromRate / toRate;
  const n = Math.floor(input.length / ratio);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let s = 0;
    for (let j = start; j < end; j++) s += input[j];
    out[i] = end > start ? s / (end - start) : 0;
  }
  return out;
}

/** 16-bit PCM WAV, so captured audio can go through the engine's Blob-based transcribe(). */
export function pcmToWav(audio: Float32Array, sampleRate = 16000): Blob {
  const n = audio.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  w(0, "RIFF");
  v.setUint32(4, 36 + n * 2, true);
  w(8, "WAVE");
  w(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, "data");
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, audio[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: "audio/wav" });
}

export function concat(chunks: Float32Array[]): Float32Array {
  const n = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Float32Array(n);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

export interface Utterance {
  /** 16 kHz mono PCM. */
  pcm: Float32Array;
  seconds: number;
  /** "end" after silence, "timeout" at maxMs. */
  reason: "end" | "timeout";
}

export interface ListenHandle {
  /** Cancel listening; done resolves to null. */
  stop: () => void;
  /** End the utterance now (keeps what was heard). */
  finish: () => void;
  done: Promise<Utterance | null>;
}

/**
 * Opens the microphone and waits for one utterance. onLevel gets the level (0..1, about 30 times a second) for
 * a meter; onSpeech fires when speech starts. Resolves with the audio, or null when stopped before any speech.
 */
export function listenOnce(opts: VadOptions & { onLevel?: (level: number) => void; onSpeech?: () => void; preRollMs?: number; calibrateMs?: number } = {}): ListenHandle {
  let cancel = () => {};
  let finishNow = () => {};
  const done = new Promise<Utterance | null>((resolve, reject) => {
    let settled = false;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let timer: number | null = null;
    const cleanup = () => {
      if (timer !== null) window.clearInterval(timer);
      timer = null;
      stream?.getTracks().forEach((t) => t.stop());
      ctx?.close().catch(() => {});
    };
    const finish = (u: Utterance | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(u);
    };
    cancel = () => finish(null);
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        if (settled) return cleanup();
        const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
        ctx = new Ctx();
        if (ctx.state === "suspended") await ctx.resume().catch(() => {});
        const rate = ctx.sampleRate;
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        src.connect(analyser);
        // Capture raw samples. ScriptProcessor is deprecated but universally available and needs no worklet file;
        // it outputs silence (we never write its output buffer), routed through a zero gain.
        const proc = ctx.createScriptProcessor(4096, 1, 1);
        const sink = ctx.createGain();
        sink.gain.value = 0;
        src.connect(proc);
        proc.connect(sink);
        sink.connect(ctx.destination);
        const preRoll = ((opts.preRollMs ?? 400) / 1000) * rate;
        const pre: Float32Array[] = [];
        let preLen = 0;
        const heard: Float32Array[] = [];
        const vad = new EnergyVad(opts);
        proc.onaudioprocess = (e) => {
          const ch = new Float32Array(e.inputBuffer.getChannelData(0));
          if (vad.state === "speech") heard.push(ch);
          else if (vad.state === "idle") {
            pre.push(ch);
            preLen += ch.length;
            while (pre.length > 1 && preLen - pre[0].length >= preRoll) preLen -= pre.shift()!.length;
          }
        };
        const frame = new Float32Array(analyser.fftSize);
        const calibrateMs = opts.calibrateMs ?? 300;
        const noise: number[] = [];
        let t0 = performance.now();
        let last = t0;
        const end = (reason: "end" | "timeout") => {
          const pcm = downsample(concat([...pre, ...heard]), rate, 16000);
          finish({ pcm, seconds: pcm.length / 16000, reason });
        };
        finishNow = () => (vad.state === "speech" ? end("end") : finish(null));
        timer = window.setInterval(() => {
          const now = performance.now();
          const dt = now - last;
          last = now;
          analyser.getFloatTimeDomainData(frame);
          const level = rms(frame);
          opts.onLevel?.(level);
          // first ~300 ms: learn the room's noise floor and lift the threshold above it
          if (now - t0 < calibrateMs) {
            noise.push(level);
            return;
          }
          if (noise.length) {
            const floor = noise.sort((a, b) => a - b)[Math.floor(noise.length / 2)];
            (vad.opts as Required<VadOptions>).threshold = Math.max(vad.opts.threshold, floor * 3);
            noise.length = 0;
          }
          const ev = vad.push(level, dt);
          if (ev === "start") opts.onSpeech?.();
          else if (ev === "end" || ev === "timeout") end(ev);
        }, 30);
      } catch (e) {
        if (!settled) {
          settled = true;
          cleanup();
          reject(e);
        }
      }
    })();
  });
  return { stop: () => cancel(), finish: () => finishNow(), done };
}
