// Runtime-local types. Mirrors the shapes in SPEC.md section 5 so the runtime compiles
// even before app/src/types.ts (STUDIO lane) exists. STUDIO may re-export these.

export type Lang = 'pis' | 'en';
export type YesNoUnknown = 'yes' | 'no' | 'unknown';
export type Transport = 'now' | 'next_boat' | 'none';

export interface Flags {
  lang: Lang;
  rdt: YesNoUnknown;
  act: YesNoUnknown;
  transport: Transport;
}

export const DEFAULT_FLAGS: Flags = { lang: 'pis', rdt: 'unknown', act: 'unknown', transport: 'next_boat' };

export interface Chunk {
  id: string;
  section: string;
  subsection: string;
  page: number;
  page_end?: number;
  text: string;
  tokens?: number;
  score?: number;
}

export interface SectionInfo {
  title: string;
  page_start: number;
  page_end: number;
  chunks: number;
}

export interface CorpusFile {
  version: 1;
  source: string;
  generated_at: string;
  sections: SectionInfo[];
  chunks: Chunk[];
}

export type Action = 'ADVISE' | 'REFER_NOW' | 'REFER_NEXT_TRANSPORT' | 'ASK_PERSON';
export const ACTIONS: Action[] = ['ADVISE', 'REFER_NOW', 'REFER_NEXT_TRANSPORT', 'ASK_PERSON'];

export interface ParsedReply {
  raw: string;
  action: Action | null;
  stm: string | null; // section title; null (or the string "NONE") when none
  body: string; // text after ---
  note: Record<string, unknown> | null; // parsed JSON when the body is a visit note
  valid: boolean; // ACTION and STM lines present and well formed
  tokens: number;
  ms: number;
  tokens_per_s: number;
  prompt_tokens?: number;
  prompt_ms?: number;
  stats?: { ms: number; tokens: number; tps: number }; // STUDIO Demo reads this
}

export interface GateResult {
  action: Action;
  stm: string | null;
  body: string;
  reply: string; // same as body (STUDIO Demo reads `reply`)
  red_flags: string[]; // ids of matched red flags
  red_flag_labels: string[];
  overridden: boolean;
  reason: string | null;
  original: ParsedReply;
  unsupported_doses?: string[]; // doses the dose guard removed (not found in the cited manual page)
}

export type Runtime = 'wllama' | 'transformersjs' | 'llama-server' | 'river' | 'python';

export interface ModelRef {
  id: string;
  file: string;
  url: string;
  size_mb: number;
  license: string;
  runtime: Runtime;
  // runtime extensions (optional, ignored by the graph editor)
  role?: 'llm' | 'stt' | 'tts_pis' | 'tts_en';
  fallbacks?: ModelRef[];
  sha256?: string;
  dtype?: string;
  note?: string;
  label?: string; // human name for the model chip, e.g. "Lokol Health 0.6B"
  tuned?: boolean; // true = our LoRA-tuned model; false = untuned base fallback
  base_model?: string;
}

export type NodeType = 'channel' | 'stt' | 'llm' | 'rag' | 'gate' | 'tts' | 'router' | 'note';

export interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
  model?: ModelRef;
  params: Record<string, unknown>;
  online: boolean;
  position: { x: number; y: number };
}

export interface Graph {
  version: 1;
  name: string;
  sector: 'health' | 'agriculture' | 'tourism';
  language: string[];
  target: { device: string; ram_gb: number; storage_gb: number; connectivity: 'none' | 'intermittent' | 'online' };
  nodes: GraphNode[];
  edges: { from: string; to: string }[];
}

// Pack manifest. STUDIO builds `{ graph, models, pwa_url, pack_id }`; the shipped packs/health/manifest.json
// uses the same nested shape. The engine also accepts a flat Graph + models (legacy).
export interface Manifest extends Partial<Graph> {
  pack_id?: string;
  graph?: Graph;
  models: ModelRef[];
  pwa_url?: string;
  created_at?: string;
  description?: string;
  corpus_url?: string; // defaults to packs/<pack_id>/corpus.json
  excerpt_tokens?: number; // guideline excerpt length in the prompt
  system_prompt?: string;
}

export interface LoadProgress {
  model_id: string; // "corpus" for the guideline index
  stage: 'download' | 'init' | 'ready' | 'error';
  loaded_mb: number;
  total_mb: number;
  role?: 'corpus' | 'llm' | 'stt' | 'tts_pis' | 'tts_en';
  pct?: number; // 0..100
  message: string;
}

export interface ModelStatus {
  id: string;
  role: string;
  loaded: boolean;
  loading: boolean;
  size_mb: number;
  error?: string;
  note?: string;
}

export interface EngineStatus {
  models: ModelStatus[];
  offline: boolean;
  memory_mb: number; // JS heap when the browser exposes it, else 0
  cross_origin_isolated: boolean;
  threads: number | null;
  llm_arch: string | null;
  llm_fallback_used: boolean;
  llm?: LiveModel | null; // the LLM actually running (after fallbacks)
  tts?: { pis: LiveModel | null; en: LiveModel | null };
  notes: string[];
}

export interface LiveModel {
  id: string;
  label: string;
  tuned: boolean;
  size_mb: number;
  url: string;
  source: 'hub' | 'local' | 'pack';
  multithread?: boolean;
  threads?: number | null;
  arch?: string | null;
}

export interface GenerateOptions {
  onToken?: (token: string, text: string) => void;
  max_tokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  task?: 'guidance' | 'referral' | 'note' | 'followup' | 'abstain';
  onPrefill?: (p: { processed: number; total: number }) => void; // prompt processing progress
}

export interface AskResult {
  chunks: Chunk[];
  guideline: Chunk | null;
  reply: ParsedReply;
  gate: GateResult;
  prompt: string;
}
