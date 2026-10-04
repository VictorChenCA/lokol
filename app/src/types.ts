/**
 * Lokol shared types. Owned by the STUDIO lane; imported by RUNTIME (app/src/runtime/**).
 * Mirrors docs/schema/graph.json (copy at app/public/schema/graph.json) and SPEC.md §5.
 */

export type NodeType = "channel" | "stt" | "llm" | "rag" | "gate" | "tts" | "router" | "note";

export type Runtime = "wllama" | "transformersjs" | "llama-server" | "river" | "python" | "js";

export interface ModelRef {
  id: string;
  file: string;
  url: string;
  size_mb: number;
  license: string;
  runtime: Runtime;
  /** Runtime extensions (optional; see app/src/runtime/types.ts). */
  role?: "llm" | "stt" | "tts_pis" | "tts_en";
  fallbacks?: ModelRef[];
  sha256?: string;
  dtype?: string;
  note?: string;
}

export interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
  model?: ModelRef;
  params: Record<string, unknown>;
  online: boolean;
  position: { x: number; y: number };
}

export type Sector = "health" | "agriculture" | "tourism";
export type Connectivity = "none" | "intermittent" | "online";

export interface GraphTarget {
  device: string;
  ram_gb: number;
  storage_gb: number;
  connectivity: Connectivity;
}

export interface GraphEdge {
  from: string;
  to: string;
}

export interface Graph {
  version: 1;
  name: string;
  sector: Sector;
  language: string[];
  target: GraphTarget;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** Device tier from the recommender. A: < 3 GB RAM, B: 3–5 GB, C: 6–8 GB, D: laptop / clinic PC. */
export type Tier = "A" | "B" | "C" | "D";

export interface Device {
  brand: string;
  model: string;
  ram_gb: number;
  storage_gb: number;
  soc: string;
  os: string;
  year: number;
  price_band: "entry" | "budget" | "mid" | "upper" | "premium";
  approximate: true;
}

/* ---------- Packs ---------- */

export interface PackModel extends ModelRef {
  sha256?: string;
}

export interface Manifest {
  graph: Graph;
  models: PackModel[];
  pwa_url: string;
  created_at?: string;
  pack_id?: string;
}

/* ---------- Runtime API (app/src/runtime/engine.ts implements this) ---------- */

export type Lang = "pis" | "en";
export type YesNoUnknown = "yes" | "no" | "unknown";
export type Transport = "now" | "next_boat" | "none";

export interface Flags {
  lang: Lang;
  rdt: YesNoUnknown;
  act: YesNoUnknown;
  transport: Transport;
}

export type Action = "ADVISE" | "REFER_NOW" | "REFER_NEXT_TRANSPORT" | "ASK_PERSON";

export interface Chunk {
  id: string;
  section: string;
  subsection?: string;
  page: number;
  text: string;
  tokens?: number;
  score?: number;
}

export interface ParsedReply {
  action: Action;
  stm: string | "NONE";
  body: string;
  raw: string;
  /** Present for task type "note". */
  note?: Record<string, unknown>;
  /** Milliseconds, tokens generated, tokens/s if the engine reports them. */
  stats?: { ms?: number; tokens?: number; tps?: number };
}

export interface GateResult {
  action: Action;
  reason: string | null;
  red_flags: string[];
  /** Reply after the gate (may be replaced when a red flag forces referral). */
  reply: string;
  overridden: boolean;
  /** Real engine extras: human labels for matched red flags, cited section. */
  red_flag_labels?: string[];
  stm?: string | null;
}

export interface EngineStatus {
  models: { id: string; loaded: boolean; size_mb: number }[];
  offline: boolean;
  memory_mb: number;
  /** Free-text notes, e.g. "wllama cannot run Qwen3.5; using Qwen3-0.6B". */
  notes?: string[];
}

export interface LoadProgress {
  model_id: string;
  loaded_mb: number;
  total_mb: number;
  stage: "download" | "init" | "ready" | "error";
  message?: string;
}

export interface Engine {
  transcribe(audio: Blob, lang: Lang): Promise<string>;
  retrieve(query: string): Promise<Chunk[]>;
  generate(
    flags: Flags,
    guidelineChunk: Chunk | null,
    message: string,
    onToken?: (token: string) => void
  ): Promise<ParsedReply>;
  gate(message: string, reply: ParsedReply): GateResult;
  speak(text: string, lang: Lang): Promise<AudioBuffer>;
  status(): EngineStatus;
}

export type LoadPack = (manifest: Manifest, onProgress?: (p: LoadProgress) => void) => Promise<Engine>;

/* ---------- Eval results (app/public/eval/results.json) ---------- */

export interface EvalMetrics {
  format_compliance: number;
  action_accuracy: number;
  stm_accuracy: number;
  red_flag_recall: number;
  abstain_precision: number;
  abstain_recall: number;
  pijin_glossary_hit_rate: number;
  judge_faithfulness_0_3: number;
  tokens_per_s?: number;
  ram_mb?: number;
}

export interface EvalRow {
  model: string;
  size: string;
  variant: "base" | "tuned";
  runtime: string;
  metrics: EvalMetrics;
}

export interface EvalResults {
  sample?: boolean;
  generated_at: string;
  test_set: { n: number; path: string };
  rows: EvalRow[];
  notes?: string[];
}

// TRAIN-EVAL types below
/* ---------- Training runs (app/public/train/runs.json, written by pipeline/collect_runs.py) ---------- */

export type RunStatus = "running" | "done" | "queued" | "stopped" | "failed";

export interface LossPoint {
  step: number;
  loss: number;
}

export interface RunVal {
  step: number;
  n?: number;
  format?: number;
  action_acc?: number;
  stm_acc?: number;
  exact?: number;
  secs?: number;
}

export interface RunCheckpoint {
  step: number;
  /** river://… path or a local adapter file. */
  id: string;
  kind: "inference" | "training" | "adapter";
}

export interface TrainRun {
  id: string;
  name: string;
  /** Catalog id from app/src/models.ts, e.g. "lokol-health-qwen3.5-9b". */
  catalog_id: string | null;
  tier: Tier | null;
  backend: "river" | "mlx";
  where: string;
  base_model: string | null;
  smoke: boolean;
  status: RunStatus;
  started_at: string | null;
  updated_at: string | null;
  config: {
    steps?: number;
    batch?: number | null;
    lr?: number | null;
    rank?: number | null;
    layers?: number | null;
    max_seq?: number | null;
    examples?: number;
    epochs?: number | null;
    data?: string | null;
    trainable_pct?: number | null;
    trainable_m?: number | null;
    total_m?: number | null;
  };
  steps_done: number;
  steps_total: number;
  elapsed_s: number;
  eta_s: number | null;
  tokens_per_s?: number | null;
  loss: LossPoint[];
  val_loss: LossPoint[];
  val: RunVal[];
  checkpoints: RunCheckpoint[];
  best?: { step: number; inference?: string; training?: string; val?: RunVal; loss?: number } | null;
  trained_tokens?: number;
  cost_usd_est?: number;
  cost_note?: string;
  gguf?: { file: string; size_mb: number } | null;
  artifact?: string;
  attempts?: number;
  error?: string | null;
  log?: string | null;
  note?: string;
}

export interface TrainRuns {
  generated_at: string;
  sample?: boolean;
  runs: TrainRun[];
}

/* ---------- Dataset card (app/public/train/dataset.json, written by pipeline/collect_runs.py) ---------- */

export interface DatasetSample {
  id: string;
  task: "guidance" | "referral" | "note" | "followup" | "abstain" | string;
  lang: "pis" | "en" | "mix" | string;
  flags: { lang?: string; rdt?: string; act?: string; transport?: string };
  guideline_mode?: "match" | "wrong" | "none" | string;
  guideline: { section: string; page: number | null; excerpt?: string } | null;
  message: string;
  action: Action | null;
  stm: string | null;
  reply: string;
  note?: Record<string, unknown> | null;
  red_flags: string[];
  teacher?: string;
  age_months?: number | null;
  weight_kg?: number | null;
}

export interface DatasetCard {
  generated_at: string;
  sample?: boolean;
  synthetic: boolean;
  source: {
    title: string;
    edition: string;
    publisher?: string;
    pages: number;
    sections: number;
    chunks: number;
    sections_covered?: number | null;
    license?: string;
  };
  teachers: { name: string; rows: number; access?: string }[];
  judge: {
    model: string;
    n_sampled?: number | null;
    n_scored?: number | null;
    faithfulness_mean?: number | null;
    faithfulness_hist?: Record<string, number> | null;
    action_ok_rate?: number | null;
    pijin_mean?: number | null;
    faithfulness_by_lang?: Record<string, number> | null;
  };
  pipeline: {
    raw: number | null;
    valid: number | null;
    rejected_total: number;
    rejected: Record<string, number>;
    rules: number;
    calls?: number | null;
    prompt_tokens?: number | null;
    completion_tokens?: number | null;
    teacher_cost_usd_est?: number;
    teacher_cost_note?: string;
  };
  splits: { train: number; val: number; test: number };
  held_out_presentations: string[];
  /** Train split. */
  counts: { task: Record<string, number>; lang: Record<string, number>; action: Record<string, number>; guideline_mode?: Record<string, number> };
  /** Train + val + test. */
  counts_all?: { task: Record<string, number>; lang: Record<string, number>; action: Record<string, number> };
  red_flag_rows?: number;
  samples: DatasetSample[];
  not_covered: { title: string; body: string }[];
}

/* ---------- Eval extensions (merged into EvalRow / EvalResults above; all optional) ---------- */

export interface EvalSlice {
  n: number;
  format: number;
  action_acc: number;
  stm_acc: number;
}

export interface EvalSampleOutput {
  /** "base" | "tuned" | "reference" (the validated target answer from the test set). */
  variant: "base" | "tuned" | "reference";
  model: string;
  size?: string;
  text: string;
  action?: Action | string | null;
  stm?: string | null;
  format_ok?: boolean;
}

export interface EvalSample {
  id: string;
  task?: string;
  lang?: string;
  flags?: { rdt?: string; act?: string; transport?: string };
  guideline?: { section: string; page?: number | null } | null;
  message: string;
  gold: { action: Action | string; stm: string };
  outputs: EvalSampleOutput[];
}

export interface EvalRow {
  /** Catalog id (app/src/models.ts), e.g. "lokol-health-qwen3-0.6b" or "qwen3-0.6b-base". */
  model_id?: string;
  tier?: Tier;
  per_lang?: Record<string, EvalSlice>;
  per_task?: Record<string, EvalSlice>;
}

export interface EvalResults {
  samples?: EvalSample[];
}
