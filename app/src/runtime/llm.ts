// wllama (llama.cpp WASM) wrapper: loads a GGUF by URL with progress, builds the Qwen3 / Qwen3.5
// ChatML prompt with thinking disabled, streams tokens, reports tokens/s and the GGUF architecture.
import { Wllama, LoggerWithoutDebug, WllamaError } from '@wllama/wllama';
import wllamaWasmUrl from '@wllama/wllama/esm/wasm/wllama.wasm?url';

export type PromptMode = 'template' | 'manual';

export interface LLMLoadOptions {
  n_ctx?: number;
  n_threads?: number; // default: min(hardwareConcurrency, 4) when crossOriginIsolated, else 1
  n_gpu_layers?: number; // default 0 (CPU wasm). WebGPU is experimental for hybrid Qwen3.5 layers.
  useCache?: boolean;
  allowOffline?: boolean;
  onProgress?: (loaded: number, total: number) => void;
  signal?: AbortSignal;
}

export interface ChatOptions {
  max_tokens?: number;
  temperature?: number;
  top_k?: number;
  top_p?: number;
  stop?: string[];
  onToken?: (token: string, text: string) => void;
  signal?: AbortSignal;
  mode?: PromptMode;
  onPrefill?: (p: { processed: number; total: number }) => void;
}

export interface ChatResult {
  text: string;
  tokens: number;
  ms: number;
  tokens_per_s: number;
  prompt_tokens: number;
  prompt_ms: number;
  finish_reason: string;
  mode: PromptMode;
}

export interface LLMInfo {
  url: string;
  architecture: string | null;
  name: string | null;
  n_ctx: number;
  n_ctx_train: number;
  n_layer: number;
  threads: number;
  multithread: boolean;
  has_chat_template: boolean;
  libllama: string;
}

export const QWEN_STOP = ['<|im_end|>', '<|im_start|>', '<|endoftext|>'];

// Qwen3 / Qwen3.5 chat template with enable_thinking=false: the template pre-fills an empty think block.
// This is byte-identical to what tokenizer.apply_chat_template(..., enable_thinking=False) renders for
// the last assistant turn, i.e. what the tuned models saw in training (mlx-lm and River renderers).
export function buildQwenPrompt(system: string, user: string, assistantPrefix = ''): string {
  return `<|im_start|>system\n${system}<|im_end|>\n<|im_start|>user\n${user}<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n${assistantPrefix}`;
}

// Remove any reasoning the model emits anyway (closed or still-open think block) and chat control tokens.
export function stripThink(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>\s*/g, '')
    .replace(/<think>[\s\S]*$/, '')
    .replace(/<\|im_end\|>[\s\S]*$/, '')
    .replace(/<\|(im_start|endoftext)\|>/g, '')
    .replace(/^\s+/, '');
}

const QWEN_ARCH = /^qwen/i;

export function defaultThreads(): number {
  if (typeof navigator === 'undefined') return 1;
  const iso = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated;
  if (!iso) return 1;
  const hc = navigator.hardwareConcurrency || 2;
  return Math.max(1, Math.min(hc - 1, 6));
}

export class WllamaLLM {
  private wllama: Wllama;
  private _info: LLMInfo | null = null;
  private _loading = false;
  mode: PromptMode = 'template';

  constructor(opts: { allowOffline?: boolean; wasmUrl?: string; suppressNativeLog?: boolean } = {}) {
    this.wllama = new Wllama(
      { default: opts.wasmUrl ?? wllamaWasmUrl },
      { logger: LoggerWithoutDebug, suppressNativeLog: opts.suppressNativeLog ?? true, allowOffline: opts.allowOffline ?? true, parallelDownloads: 3 },
    );
  }

  get loaded() {
    return this.wllama.isModelLoaded();
  }
  get loading() {
    return this._loading;
  }
  get info() {
    return this._info;
  }

  async load(url: string, opts: LLMLoadOptions = {}): Promise<LLMInfo> {
    if (this.loaded) await this.unload();
    this._loading = true;
    try {
      const n_threads = opts.n_threads ?? defaultThreads();
      await this.wllama.loadModelFromUrl(url, {
        n_ctx: opts.n_ctx ?? 2048,
        n_batch: 512,
        n_threads,
        n_gpu_layers: opts.n_gpu_layers ?? 0,
        useCache: opts.useCache ?? true,
        allowOffline: opts.allowOffline ?? true,
        reasoning_format: 'none',
        default_template_kwargs: { enable_thinking: false },
        progressCallback: ({ loaded, total }: { loaded: number; total: number }) => opts.onProgress?.(loaded, total),
        abortSignal: opts.signal,
      } as any);
      const meta = this.wllama.getModelMetadata();
      const ctx = this.wllama.getLoadedContextInfo();
      const tpl = this.wllama.getChatTemplate();
      this._info = {
        url,
        architecture: meta.meta['general.architecture'] ?? null,
        name: meta.meta['general.name'] ?? null,
        n_ctx: ctx.n_ctx,
        n_ctx_train: ctx.n_ctx_train,
        n_layer: ctx.n_layer,
        threads: this.wllama.getNumThreads(),
        multithread: this.wllama.isMultithread(),
        has_chat_template: !!tpl,
        libllama: Wllama.getLibllamaVersion(),
      };
      // Qwen-family: always our own ChatML string (exact training format, thinking off, no reliance on
      // the GGUF jinja honouring enable_thinking). Other architectures: the GGUF's own template.
      this.mode = !tpl || QWEN_ARCH.test(this._info.architecture ?? '') ? 'manual' : 'template';
      return this._info;
    } finally {
      this._loading = false;
    }
  }

  async unload() {
    await this.wllama.exit();
    this._info = null;
  }

  async chat(system: string, user: string, opts: ChatOptions = {}): Promise<ChatResult> {
    if (!this.loaded) throw new WllamaError('model not loaded', 'model_not_loaded');
    const mode = opts.mode ?? this.mode;
    const max_tokens = opts.max_tokens ?? 220;
    const temperature = opts.temperature ?? 0;
    const t0 = performance.now();
    let rawText = '';
    let text = '';
    let chunks = 0;
    let timings: any = null;
    let finish = 'stop';
    const onData = (chunk: any) => {
      if (chunk.prompt_progress && opts.onPrefill) {
        const p = chunk.prompt_progress;
        opts.onPrefill({ processed: (p.processed ?? 0) - (p.cache ?? 0), total: (p.total ?? 0) - (p.cache ?? 0) });
      }
      const ch = chunk.choices?.[0];
      const delta: string = ch?.delta?.content ?? ch?.text ?? '';
      if (delta) {
        rawText += delta;
        chunks++;
        const clean = stripThink(rawText);
        if (clean.length > text.length && clean.startsWith(text)) {
          const d = clean.slice(text.length);
          text = clean;
          opts.onToken?.(d, text);
        } else if (clean !== text) {
          text = clean;
        }
      }
      if (ch?.finish_reason) finish = ch.finish_reason;
      if (chunk.timings) timings = chunk.timings;
    };
    const sampling = { temperature, top_k: opts.top_k ?? 20, top_p: opts.top_p ?? 0.9, stop: opts.stop ?? QWEN_STOP, max_tokens, abortSignal: opts.signal, seed: 42, return_progress: !!opts.onPrefill };
    if (mode === 'template') {
      await this.wllama.createChatCompletion({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        chat_template_kwargs: { enable_thinking: false },
        ...sampling,
        stream: true,
        onData,
      } as any);
    } else {
      await this.wllama.createCompletion({ prompt: buildQwenPrompt(system, user), ...sampling, stream: true, onData } as any);
    }
    const ms = performance.now() - t0;
    const tokens = timings?.predicted_n ?? chunks;
    const genMs = timings?.predicted_ms ?? Math.max(1, ms - (timings?.prompt_ms ?? 0)); // decode wall time when llama.cpp gives no timings
    return {
      text: stripThink(rawText).trim(),
      tokens,
      ms: Math.round(ms),
      tokens_per_s: Number(((tokens * 1000) / Math.max(1, genMs)).toFixed(1)),
      prompt_tokens: timings?.prompt_n ?? 0,
      prompt_ms: Math.round(timings?.prompt_ms ?? 0),
      finish_reason: finish,
      mode,
    };
  }
}

// Quick existence check so the engine can skip to a fallback without a wllama download attempt.
//   'yes'         the server has the file
//   'no'          4xx/5xx, or an SPA fallback page (text/html) instead of a model file
//   'unreachable' network error (offline): the caller should still try, wllama may have it in OPFS
export type Exists = 'yes' | 'no' | 'unreachable';
export async function checkUrl(url: string, signal?: AbortSignal): Promise<Exists> {
  try {
    const r = await fetch(url, { method: 'HEAD', redirect: 'follow', signal, cache: 'no-store' });
    if (!r.ok) return 'no';
    if (/text\/html/i.test(r.headers.get('content-type') ?? '')) return 'no';
    return 'yes';
  } catch {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    return 'unreachable';
  }
}

export async function urlExists(url: string, signal?: AbortSignal): Promise<boolean> {
  return (await checkUrl(url, signal)) === 'yes';
}
