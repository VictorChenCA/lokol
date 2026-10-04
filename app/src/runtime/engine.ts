// Lokol runtime engine (SPEC section 5): loadPack -> transcribe / retrieve / generate / gate / speak / status.
import type { AskResult, Chunk, EngineStatus, Flags, GateResult, GenerateOptions, Graph, Lang, LiveModel, LoadProgress, Manifest, ModelRef, ModelStatus, ParsedReply } from './types';
import { DEFAULT_FLAGS } from './types';
import { BM25Index, excerpt, loadCorpus } from './rag';
import { SYSTEM_PROMPT, buildUserTurn, gate as runGate, parseReply, stripNegated } from './gate';
import { WllamaLLM, checkUrl, type ChatResult } from './llm';
import { PijinTTS, EnglishTTS, toAudioBuffer, type PCM } from './tts';
import { STT, STT_SUPPORT } from './stt';

export type Role = 'llm' | 'stt' | 'tts_pis' | 'tts_en';
export type ProgressCb = (p: LoadProgress) => void;

export interface LoadPackOptions {
  preload?: Role[]; // default ['llm']; others load lazily on first use
  corpusUrl?: string;
  baseUrl?: string; // prefix for relative corpus/model paths (default '')
  llm?: { n_ctx?: number; n_threads?: number; n_gpu_layers?: number; native_log?: boolean };
  tts?: { dtype?: 'fp32' | 'q8' };
  signal?: AbortSignal;
  excerpt_tokens?: number; // guideline excerpt length in the prompt (default 220: prefill dominates latency on phones)
}

const HF = 'https://huggingface.co';

// Known-good sources used when a pack lists a model without fallbacks (STUDIO's models.ts does).
// Order inside each list = preference. Hub first (works on any device), then /local-models (dev server,
// offline recording), then an untuned base model so the demo always runs.
const TUNED_06B_FILE = 'lokol-health-qwen3-0.6b-Q4_K_M.gguf';
const LLM_TUNED_06B: ModelRef[] = [
  { id: 'lokol-health-qwen3-0.6b', label: 'Lokol Health 0.6B', tuned: true, base_model: 'Qwen/Qwen3-0.6B', role: 'llm', file: TUNED_06B_FILE, url: `${HF}/VictorChenCA/lokol-health-qwen3-0.6b-gguf/resolve/main/${TUNED_06B_FILE}`, size_mb: 397, license: 'Apache-2.0', runtime: 'wllama' },
  { id: 'lokol-health-qwen3-0.6b', label: 'Lokol Health 0.6B', tuned: true, base_model: 'Qwen/Qwen3-0.6B', role: 'llm', file: TUNED_06B_FILE, url: `/local-models/${TUNED_06B_FILE}`, size_mb: 397, license: 'Apache-2.0', runtime: 'wllama', note: 'local copy (dev server)' },
];
const LLM_BASE_06B: ModelRef = { id: 'qwen3-0.6b-base', label: 'Qwen3 0.6B base (untuned)', tuned: false, base_model: 'Qwen/Qwen3-0.6B', role: 'llm', file: 'Qwen3-0.6B-Q4_0.gguf', url: `${HF}/ggml-org/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q4_0.gguf`, size_mb: 429, license: 'Apache-2.0', runtime: 'wllama', note: 'untuned base model: the tuned Lokol GGUF is not reachable' };
const LLM_TUNED_08B: ModelRef[] = [
  { id: 'lokol-health-qwen3.5-0.8b', label: 'Lokol Health 0.8B', tuned: true, base_model: 'Qwen/Qwen3.5-0.8B', role: 'llm', file: 'lokol-health-0.8b-Q4_K_M.gguf', url: `${HF}/VictorChenCA/lokol-health-0.8b-gguf/resolve/main/lokol-health-0.8b-Q4_K_M.gguf`, size_mb: 529, license: 'Apache-2.0', runtime: 'wllama' },
  { id: 'lokol-health-qwen3.5-0.8b', label: 'Lokol Health 0.8B', tuned: true, base_model: 'Qwen/Qwen3.5-0.8B', role: 'llm', file: 'lokol-health-0.8b-Q4_K_M.gguf', url: '/local-models/lokol-health-0.8b-Q4_K_M.gguf', size_mb: 529, license: 'Apache-2.0', runtime: 'wllama', note: 'local copy (dev server)' },
];
const LLM_BASE_08B: ModelRef = { id: 'qwen3.5-0.8b-base', label: 'Qwen3.5 0.8B base (untuned)', tuned: false, base_model: 'Qwen/Qwen3.5-0.8B', role: 'llm', file: 'Qwen3.5-0.8B-Q4_0.gguf', url: `${HF}/ggml-org/Qwen3.5-0.8B-GGUF/resolve/main/Qwen3.5-0.8B-Q4_0.gguf`, size_mb: 563, license: 'Apache-2.0', runtime: 'wllama', note: 'untuned base model' };
const LLM_BASE_17B: ModelRef = { id: 'qwen3-1.7b-base', label: 'Qwen3 1.7B base (untuned)', tuned: false, base_model: 'Qwen/Qwen3-1.7B', role: 'llm', file: 'Qwen3-1.7B-Q4_K_M.gguf', url: `${HF}/ggml-org/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q4_K_M.gguf`, size_mb: 1107, license: 'Apache-2.0', runtime: 'wllama', note: 'untuned base model' };
const TTS_PIS: ModelRef[] = [
  { id: 'mms-tts-pis', label: 'MMS Pijin voice', role: 'tts_pis', file: 'onnx/model_quantized.onnx', url: 'VictorChenCA/lokol-mms-tts-pis-onnx', size_mb: 38, license: 'CC-BY-NC-4.0', runtime: 'transformersjs', dtype: 'q8' },
  { id: 'mms-tts-pis', label: 'MMS Pijin voice', role: 'tts_pis', file: 'onnx/model_quantized.onnx', url: '/local-models/mms-tts-pis-onnx', size_mb: 38, license: 'CC-BY-NC-4.0', runtime: 'transformersjs', dtype: 'q8', note: 'local copy (dev server)' },
];

export const DEFAULT_FALLBACKS: Record<Role, ModelRef[]> = {
  llm: [LLM_BASE_06B, LLM_BASE_08B],
  stt: [{ id: 'moonshine-tiny-en', label: 'Moonshine tiny (English)', role: 'stt', file: 'onnx', url: 'onnx-community/moonshine-tiny-ONNX', size_mb: 52, license: 'MIT', runtime: 'transformersjs' }],
  tts_pis: TTS_PIS,
  tts_en: [{ id: 'kokoro-82m-en', label: 'Kokoro English voice', role: 'tts_en', file: 'onnx/model_quantized.onnx', url: 'onnx-community/Kokoro-82M-v1.0-ONNX', size_mb: 92, license: 'Apache-2.0', runtime: 'transformersjs', dtype: 'q8' }],
};

// Shared catalogue ids (app/src/models.ts) -> where the browser can actually get them. A graph from the
// Studio carries only one URL per node; this gives it the same Hub -> local -> base chain as the pack.
export const KNOWN_SOURCES: Record<string, ModelRef[]> = {
  // tuned 0.6B first; if it is not reachable, the tuned 0.8B beats an untuned base model
  'lokol-health-qwen3-0.6b': [...LLM_TUNED_06B, ...LLM_TUNED_08B, LLM_BASE_06B],
  'qwen3-0.6b-base': [LLM_BASE_06B],
  'lokol-health-qwen3.5-0.8b': [...LLM_TUNED_08B, LLM_BASE_08B],
  'qwen3.5-0.8b-base': [LLM_BASE_08B],
  'lokol-health-qwen3-1.7b': [LLM_BASE_17B],
  'qwen3-1.7b-base': [LLM_BASE_17B],
  'mms-tts-pis': TTS_PIS,
};

// Models the browser should not try to download (laptop / online tier): skip to the phone fallbacks.
function browserCannotRun(ref: ModelRef): string | null {
  if (ref.runtime === 'llama-server' || ref.runtime === 'river' || ref.runtime === 'python') return `${ref.id} runs on a laptop or online (${ref.runtime}); the browser uses the phone model`;
  if (/^river:/.test(ref.url)) return `${ref.id} is an online River model`;
  if ((ref.size_mb ?? 0) > 2600) return `${ref.id} (${ref.size_mb} MB) is too big for a browser tab`;
  return null;
}

// facebook/mms-tts-pis has no ONNX files; transformers.js needs the export.
const SUBSTITUTES: Record<string, ModelRef[]> = { 'facebook/mms-tts-pis': DEFAULT_FALLBACKS.tts_pis };

export function inferRole(m: ModelRef): Role | null {
  if (m.role) return m.role;
  const id = `${m.id} ${m.file}`.toLowerCase();
  if (/moonshine|whisper/.test(id)) return 'stt';
  if (/kokoro/.test(id)) return 'tts_en';
  if (/mms-tts|tts.*pis|pis.*tts/.test(id)) return 'tts_pis';
  if (m.runtime === 'wllama' && (/\.gguf$/.test(m.file) || /gguf/.test(m.url))) return 'llm';
  if (/corpus|bm25/.test(id)) return null;
  return null;
}

// transformers.js wants "owner/name" for Hub repos; wllama wants the resolve URL.
function normalizeUrl(role: Role, url: string): string {
  if (role === 'llm') return url;
  const m = /^https?:\/\/(?:huggingface\.co|hf\.co)\/([\w.-]+\/[\w.-]+)\/?$/.exec(url);
  return m ? m[1] : url;
}

function graphOf(manifest: Manifest): Graph | undefined {
  return manifest.graph ?? (manifest.nodes ? (manifest as Graph) : undefined);
}

function byRole(manifest: Manifest, role: Role): ModelRef | undefined {
  const m = manifest.models.find((x) => inferRole(x) === role);
  if (m) return m;
  const g = graphOf(manifest);
  if (role === 'llm') return g?.nodes.find((n) => n.type === 'llm')?.model;
  if (role === 'stt') return g?.nodes.find((n) => n.type === 'stt')?.model;
  if (role === 'tts_pis') return g?.nodes.find((n) => n.type === 'tts')?.model;
  return undefined;
}

export function candidates(role: Role, ref: ModelRef | undefined, notes?: string[]): ModelRef[] {
  const out: ModelRef[] = [];
  const push = (r: ModelRef) => {
    const skip = browserCannotRun(r);
    if (skip) { notes?.push(skip); return; }
    if (!out.some((x) => x.url === normalizeUrl(role, r.url))) out.push({ ...r, role, url: normalizeUrl(role, r.url) });
  };
  if (ref) {
    const key = normalizeUrl(role, ref.url);
    if (SUBSTITUTES[key]) SUBSTITUTES[key].forEach(push);
    else push(ref);
    (ref.fallbacks ?? []).forEach(push);
    (KNOWN_SOURCES[ref.id] ?? []).forEach(push);
  }
  DEFAULT_FALLBACKS[role].forEach(push);
  return out;
}

function sourceOf(url: string): LiveModel['source'] {
  if (url.startsWith('/local-models/')) return 'local';
  if (/^https?:/.test(url) || /^[\w.-]+\/[\w.-]+$/.test(url)) return 'hub';
  return 'pack';
}

function prettyLabel(ref: ModelRef): string {
  if (ref.label) return ref.label;
  return ref.id.replace(/-q4.*$/i, '').replace(/[-_]/g, ' ');
}

const PIS_VOICE_FALLBACK = 'tts_pis: Pijin voice unavailable; reading Pijin with the English voice (Kokoro)';

export class Engine {
  readonly manifest: Manifest;
  readonly index: BM25Index;
  readonly system_prompt: string;
  readonly llm: WllamaLLM;
  stt: STT | null = null;
  ttsPis: PijinTTS | null = null;
  ttsEn: EnglishTTS | null = null;
  readonly notes: string[] = [];
  private loading = new Set<Role>();
  private pending = new Map<Role, Promise<ModelRef | null>>();
  private errors = new Map<Role, string>();
  private active = new Map<Role, ModelRef>();
  llm_fallback_used = false;
  private audioCtx: AudioContext | null = null;
  private opts: LoadPackOptions;
  private lastFlags: Flags | null = null;
  private lastGuideline: Chunk | null | undefined = undefined;

  constructor(manifest: Manifest, index: BM25Index, opts: LoadPackOptions) {
    this.manifest = manifest;
    this.index = index;
    this.opts = opts;
    this.llm = new WllamaLLM({ suppressNativeLog: !opts.llm?.native_log });
    this.system_prompt = manifest.system_prompt ?? SYSTEM_PROMPT;
    void graphOf;
  }

  // ---------- model loading ----------

  // Concurrent callers (background preload + a tap on "play voice") share one load.
  loadModel(role: Role, onProgress?: ProgressCb): Promise<ModelRef | null> {
    const p = this.pending.get(role);
    if (p) {
      if (onProgress) this.listeners.get(role)?.add(onProgress);
      return p;
    }
    const set = new Set<ProgressCb>(onProgress ? [onProgress] : []);
    this.listeners.set(role, set);
    const fan: ProgressCb = (x) => set.forEach((cb) => cb(x));
    const run = this.loadModelOnce(role, fan).finally(() => {
      this.pending.delete(role);
      this.listeners.delete(role);
    });
    this.pending.set(role, run);
    return run;
  }

  private listeners = new Map<Role, Set<ProgressCb>>();

  private async loadModelOnce(role: Role, onProgress?: ProgressCb): Promise<ModelRef | null> {
    const list = candidates(role, byRole(this.manifest, role), this.notes);
    if (!list.length) {
      this.notes.push(`pack has no ${role} model`);
      return null;
    }
    this.loading.add(role);
    this.errors.delete(role);
    try {
      let lastErr = '';
      for (let i = 0; i < list.length; i++) {
        const ref = list[i];
        const mb = (b: number) => Math.round(b / 1e6);
        const progress = (loaded: number, total: number) => onProgress?.({ model_id: ref.id, role, stage: 'download', loaded_mb: mb(loaded), total_mb: mb(total) || ref.size_mb, pct: total ? Math.round((loaded / total) * 100) : undefined, message: `Downloading ${ref.id} (${mb(loaded)} / ${mb(total) || ref.size_mb} MB)` });
        try {
          onProgress?.({ model_id: ref.id, role, stage: 'init', loaded_mb: 0, total_mb: ref.size_mb, pct: 0, message: `Loading ${ref.id}` });
          if (role === 'llm') {
            const url = this.resolve(ref.url);
            // skip candidates the server says are missing; when offline ('unreachable') still try: wllama may have it in OPFS
            if (i < list.length - 1 && (await checkUrl(url, this.opts.signal)) === 'no') throw new Error(`not found: ${url}`);
            const info = await this.llm.load(url, { ...this.opts.llm, onProgress: progress, signal: this.opts.signal });
            onProgress?.({ model_id: ref.id, role, stage: 'init', loaded_mb: ref.size_mb, total_mb: ref.size_mb, pct: 100, message: `Warming up ${prettyLabel(ref)}` });
            // smoke + warm-up: a 1-token completion proves the architecture decodes, and leaves the system
            // prompt in the KV cache so the first real question only pays for its own tokens.
            await this.llm.chat(this.system_prompt, '[lang=pis] [rdt=yes] [act=yes] [transport=next_boat]', { max_tokens: 1, mode: this.llm.mode });
            this.notes.push(`LLM ${ref.id}: arch=${info.architecture} threads=${info.threads} multithread=${info.multithread} template=${info.has_chat_template ? 'gguf jinja' : 'manual qwen'} libllama=${info.libllama}`);
          } else if (role === 'stt') {
            this.stt = await STT.load(ref.url, { onProgress: progress });
          } else if (role === 'tts_pis') {
            this.ttsPis = await PijinTTS.load(this.resolve(ref.url), { dtype: (ref.dtype as any) ?? this.opts.tts?.dtype ?? 'q8', onProgress: progress });
          } else if (role === 'tts_en') {
            this.ttsEn = await EnglishTTS.load(ref.url, { dtype: (ref.dtype as any) ?? 'q8', onProgress: progress });
          }
          this.active.set(role, ref);
          if (i > 0) this.notes.push(`${role}: using ${ref.id} from ${ref.url} (${ref.note ?? 'primary unavailable'}) after: ${lastErr}`);
          if (role === 'llm') this.llm_fallback_used = ref.tuned === false;
          onProgress?.({ model_id: ref.id, role, stage: 'ready', loaded_mb: ref.size_mb, total_mb: ref.size_mb, pct: 100, message: `${ref.id} ready` });
          return ref;
        } catch (e: any) {
          lastErr = e?.message ?? String(e);
          this.notes.push(`${role}: ${ref.id} failed: ${lastErr}`);
          if (role === 'llm' && this.llm.loaded) await this.llm.unload().catch(() => {});
        }
      }
      this.errors.set(role, lastErr);
      onProgress?.({ model_id: list[0].id, role, stage: 'error', loaded_mb: 0, total_mb: list[0].size_mb, message: `${role}: all candidates failed (${lastErr})` });
      throw new Error(`${role}: all candidates failed: ${lastErr}`);
    } finally {
      this.loading.delete(role);
    }
  }

  private resolve(url: string): string {
    if (/^https?:\/\//.test(url) || url.startsWith('/')) return url;
    if (/^[\w.-]+\/[\w.-]+$/.test(url)) return url; // HF repo id
    return (this.opts.baseUrl ?? '') + url;
  }

  // ---------- SPEC API ----------

  async transcribe(audio: Blob, lang: Lang = 'en'): Promise<string> {
    const r = await this.transcribeDetailed(audio, lang);
    return r.text;
  }

  async transcribeDetailed(audio: Blob | Float32Array, lang: Lang = 'en', onProgress?: ProgressCb) {
    if (!STT_SUPPORT[lang].ok) {
      this.notes.push(`transcribe(${lang}): ${STT_SUPPORT[lang].reason}`);
      return { text: '', reason: STT_SUPPORT[lang].reason, ms: 0, seconds: 0 };
    }
    if (!this.stt) await this.loadModel('stt', onProgress);
    return this.stt!.transcribe(audio, lang);
  }

  // Negated signs ("no fit") are dropped before search so they do not pull in the CONVULSIONS section.
  async retrieve(query: string, k = 3): Promise<Chunk[]> {
    return this.index.searchDetailed(stripNegated(query), k).hits;
  }

  buildPrompt(flags: Flags, guideline: Chunk | null, message: string): { system: string; user: string } {
    const n = this.opts.excerpt_tokens ?? this.manifest.excerpt_tokens ?? 220;
    return { system: this.system_prompt, user: buildUserTurn(flags, guideline, message, guideline ? excerpt(guideline, n) : undefined) };
  }

  async generate(flags: Flags, guidelineChunk: Chunk | null, message: string, onTokenOrOpts?: GenerateOptions['onToken'] | GenerateOptions): Promise<ParsedReply> {
    const opts: GenerateOptions = typeof onTokenOrOpts === 'function' ? { onToken: onTokenOrOpts } : onTokenOrOpts ?? {};
    if (!this.llm.loaded) await this.loadModel('llm');
    // a weak top hit (low BM25 score / coverage) is not guideline support: the model sees "none"
    const guideline = guidelineChunk && (guidelineChunk.score === undefined || BM25Index.supports(guidelineChunk as any)) ? guidelineChunk : null;
    this.lastFlags = flags;
    this.lastGuideline = guideline;
    const { system, user } = this.buildPrompt(flags, guideline, message);
    const res: ChatResult = await this.llm.chat(system, user, { max_tokens: opts.max_tokens ?? (opts.task === 'note' ? 320 : 220), temperature: opts.temperature ?? 0, onToken: opts.onToken, onPrefill: opts.onPrefill, signal: opts.signal });
    const parsed = parseReply(res.text, { tokens: res.tokens, ms: res.ms, prompt_tokens: res.prompt_tokens, prompt_ms: res.prompt_ms });
    // decode rate from llama.cpp timings (prefill excluded); parseReply alone only knows total wall time
    const tokens_per_s = res.tokens_per_s || parsed.tokens_per_s;
    return { ...parsed, tokens_per_s, stm: parsed.stm ?? 'NONE', stats: { ms: parsed.ms, tokens: parsed.tokens, tps: tokens_per_s } };
  }

  // flags/guideline default to the ones used by the last generate() call (STUDIO calls gate(message, reply))
  gate(message: string, reply: ParsedReply, flags?: Flags, guideline?: Chunk | null): GateResult {
    return runGate(message, reply, { flags: flags ?? this.lastFlags ?? DEFAULT_FLAGS, guideline: guideline !== undefined ? guideline : this.lastGuideline, sectionTitles: this.index.sectionTitles() });
  }

  // Convenience for the Demo page: retrieve -> generate -> gate in one call.
  async ask(message: string, flags: Flags = DEFAULT_FLAGS, opts: GenerateOptions = {}): Promise<AskResult> {
    const chunks = this.index.searchDetailed(stripNegated(message), 3).hits;
    const top = chunks[0];
    const guideline = BM25Index.supports(top as any) ? top : null;
    const { user } = this.buildPrompt(flags, guideline, message);
    const reply = await this.generate(flags, guideline, message, opts);
    const g = this.gate(message, reply, flags, guideline);
    return { chunks, guideline, reply, gate: g, prompt: user };
  }

  async speak(text: string, lang: Lang = 'pis'): Promise<AudioBuffer> {
    const pcm = await this.speakPCM(text, lang);
    this.audioCtx ??= new AudioContext();
    return toAudioBuffer(pcm, this.audioCtx);
  }

  async speakPCM(text: string, lang: Lang = 'pis', onProgress?: ProgressCb): Promise<PCM> {
    if (lang === 'pis') {
      if (!this.ttsPis && !this.errors.has('tts_pis')) await this.loadModel('tts_pis', onProgress).catch(() => null);
      if (this.ttsPis) return this.ttsPis.speak(text);
      // Pijin voice unavailable (e.g. the ONNX export is not on the Hub yet): Pijin is English-lexified,
      // so the English voice reading the Pijin text is understandable. Said in status notes.
      if (!this.notes.includes(PIS_VOICE_FALLBACK)) this.notes.push(PIS_VOICE_FALLBACK);
    }
    if (!this.ttsEn) await this.loadModel('tts_en', onProgress);
    return this.ttsEn!.speak(text);
  }

  status(): EngineStatus {
    const roles: Role[] = ['llm', 'stt', 'tts_pis', 'tts_en'];
    const models: ModelStatus[] = roles.map((role) => {
      const ref = this.active.get(role) ?? byRole(this.manifest, role);
      const loaded = role === 'llm' ? this.llm.loaded : role === 'stt' ? !!this.stt : role === 'tts_pis' ? !!this.ttsPis : !!this.ttsEn;
      return { id: ref?.id ?? `(no ${role})`, role, loaded, loading: this.loading.has(role), size_mb: ref?.size_mb ?? 0, error: this.errors.get(role), note: ref?.note };
    });
    const mem = (performance as any).memory?.usedJSHeapSize;
    const live = (role: Role): LiveModel | null => {
      const ref = this.active.get(role);
      if (!ref) return null;
      const isLlm = role === 'llm';
      return {
        id: ref.id,
        label: prettyLabel(ref),
        tuned: ref.tuned ?? !/base|untuned/i.test(ref.id),
        size_mb: ref.size_mb,
        url: ref.url,
        source: sourceOf(ref.url),
        multithread: isLlm ? this.llm.info?.multithread : undefined,
        threads: isLlm ? this.llm.info?.threads ?? null : undefined,
        arch: isLlm ? this.llm.info?.architecture ?? null : undefined,
      };
    };
    return {
      models,
      offline: typeof navigator !== 'undefined' ? !navigator.onLine : false,
      memory_mb: typeof mem === 'number' ? Math.round(mem / 1e6) : 0,
      cross_origin_isolated: typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated,
      threads: this.llm.info?.threads ?? null,
      llm_arch: this.llm.info?.architecture ?? null,
      llm_fallback_used: this.llm_fallback_used,
      llm: live('llm'),
      tts: { pis: live('tts_pis'), en: live('tts_en') },
      notes: [...this.notes],
    };
  }

  async unload() {
    await this.llm.unload().catch(() => {});
    this.stt = null;
    this.ttsPis = null;
    this.ttsEn = null;
    this.active.clear();
  }
}

export async function loadPack(manifest: Manifest, onProgress?: ProgressCb, opts: LoadPackOptions = {}): Promise<Engine> {
  const base = opts.baseUrl ?? '';
  const ragModel = manifest.models.find((m) => /corpus|bm25/.test(`${m.id} ${m.file}`.toLowerCase()) && /corpus\.json/.test(m.url));
  const rel = manifest.corpus_url ?? ragModel?.url ?? `packs/${manifest.pack_id ?? 'health'}/corpus.json`;
  const corpusUrl = opts.corpusUrl ?? (/^(https?:)?\//.test(rel) ? rel : base + rel);
  onProgress?.({ model_id: 'corpus', role: 'corpus', stage: 'download', loaded_mb: 0, total_mb: 1, message: `Loading guideline index from ${corpusUrl}` });
  const corpus = await loadCorpus(corpusUrl);
  const index = new BM25Index(corpus);
  onProgress?.({ model_id: 'corpus', role: 'corpus', stage: 'ready', loaded_mb: 1, total_mb: 1, pct: 100, message: `Guideline index ready: ${index.size} chunks, ${index.sectionTitles().length} sections` });
  const engine = new Engine(manifest, index, opts);
  const preload = opts.preload ?? ['llm'];
  for (const role of preload) {
    await engine.loadModel(role, onProgress);
  }
  onProgress?.({ model_id: 'pack', stage: 'ready', loaded_mb: 0, total_mb: 0, pct: 100, message: 'Pack ready' });
  return engine;
}

export async function fetchManifest(url: string): Promise<Manifest> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`manifest fetch failed: ${r.status} ${url}`);
  return r.json();
}

export { SYSTEM_PROMPT, RED_FLAGS, detectRedFlags, parseReply, formatReply, buildUserTurn, gate } from './gate';
export { BM25Index, PIJIN_SYNONYMS, expandQuery, excerpt } from './rag';
export { buildQwenPrompt, WllamaLLM } from './llm';
export { toAudioBuffer, playAudioBuffer, toWav } from './tts';
export { recordMic, STT_SUPPORT } from './stt';
export * from './types';
