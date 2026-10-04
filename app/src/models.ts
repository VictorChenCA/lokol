import type { Lang, ModelRef, NodeType, Runtime, Tier } from "./types";

/**
 * Lokol model catalogue. Every node in the Studio picks its model from here.
 * Sizes are the download (file) size in MB; ram_mb is our estimate of resident memory once loaded
 * (weights + KV cache at 2k context + runtime overhead), rounded and conservative.
 * Ids are a shared contract with the TRAIN, RUNTIME and DEPLOY lanes: do not rename them.
 */
const HF = "https://huggingface.co";

export type TrainedBy = "river" | "mlx";

export interface CatalogModel extends ModelRef {
  /** Display name. */
  name: string;
  /** Node type this model serves. */
  node: NodeType;
  family: string;
  /** Total parameters, billions. */
  params_b: number;
  /** Parameters active per token, billions (equal to params_b for dense models). */
  active_b: number;
  /** Size-tier label shown on chips: "0.6B", "27M". */
  size_label: string;
  quant: string;
  ram_mb: number;
  /** Device tiers this model suits. A: <3 GB phone, B: 3–5 GB, C: 6–8 GB, D: laptop / clinic PC. */
  tiers: Tier[];
  lang?: Lang[];
  trainedBy?: TrainedBy;
  /** Id of the untuned base model this one was trained from (or the tuned model a base one pairs with). */
  pair?: string;
  variant: "tuned" | "base" | "speech" | "index";
  hf_repo?: string;
  /** Repo-relative path of the local artefact, when one exists. */
  local_file?: string;
  /** Can also run hosted when the node's internet toggle is on. */
  online_runtime?: { runtime: Runtime; url: string; label: string };
  placeholder?: boolean;
  blurb: string;
}

export const TRAINED_BY_LABEL: Record<TrainedBy, string> = {
  river: "River",
  mlx: "Apple silicon"
};

export const CATALOG: CatalogModel[] = [
  /* ---------- Language models: tuned by Lokol ---------- */
  {
    id: "lokol-health-qwen3-0.6b",
    name: "Lokol Health 0.6B",
    node: "llm",
    family: "Qwen3",
    params_b: 0.6,
    active_b: 0.6,
    size_label: "0.6B",
    quant: "Q4_K_M",
    file: "lokol-health-qwen3-0.6b-Q4_K_M.gguf",
    url: `${HF}/VictorChenCA/lokol-health-qwen3-0.6b-gguf/resolve/main/lokol-health-qwen3-0.6b-Q4_K_M.gguf`,
    hf_repo: "VictorChenCA/lokol-health-qwen3-0.6b-gguf",
    local_file: "models/gguf/lokol-health-qwen3-0.6b-Q4_K_M.gguf",
    size_mb: 400,
    ram_mb: 600,
    license: "Apache-2.0",
    runtime: "wllama",
    tiers: ["A", "B", "C", "D"],
    lang: ["pis", "en"],
    trainedBy: "mlx",
    pair: "qwen3-0.6b-base",
    variant: "tuned",
    blurb: "Phone default. LoRA-tuned on Apple silicon; runs inside the browser on a 2–3 GB phone."
  },
  {
    id: "lokol-health-qwen3.5-0.8b",
    name: "Lokol Health 0.8B",
    node: "llm",
    family: "Qwen3.5",
    params_b: 0.8,
    active_b: 0.8,
    size_label: "0.8B",
    quant: "Q4_K_M",
    file: "lokol-health-0.8b-Q4_K_M.gguf",
    url: `${HF}/VictorChenCA/lokol-health-0.8b-gguf/resolve/main/lokol-health-0.8b-Q4_K_M.gguf`,
    hf_repo: "VictorChenCA/lokol-health-0.8b-gguf",
    local_file: "models/gguf/lokol-health-0.8b-Q4_K_M.gguf",
    size_mb: 529,
    ram_mb: 680,
    license: "Apache-2.0",
    runtime: "wllama",
    tiers: ["A", "B", "C", "D"],
    lang: ["pis", "en"],
    trainedBy: "mlx",
    pair: "qwen3.5-0.8b-base",
    variant: "tuned",
    blurb: "Hybrid-attention Qwen3.5, tuned on Apple silicon. Best in PocketPal or llama.cpp on Android; browser support is newer."
  },
  {
    id: "lokol-health-qwen3-1.7b",
    name: "Lokol Health 1.7B",
    node: "llm",
    family: "Qwen3",
    params_b: 1.7,
    active_b: 1.7,
    size_label: "1.7B",
    quant: "Q4_K_M",
    file: "lokol-health-qwen3-1.7b-Q4_K_M.gguf",
    url: `${HF}/VictorChenCA/lokol-health-qwen3-1.7b-gguf/resolve/main/lokol-health-qwen3-1.7b-Q4_K_M.gguf`,
    hf_repo: "VictorChenCA/lokol-health-qwen3-1.7b-gguf",
    local_file: "models/gguf/lokol-health-qwen3-1.7b-Q4_K_M.gguf",
    size_mb: 1110,
    ram_mb: 1500,
    license: "Apache-2.0",
    runtime: "wllama",
    tiers: ["B", "C", "D"],
    lang: ["pis", "en"],
    trainedBy: "mlx",
    pair: "qwen3-1.7b-base",
    variant: "tuned",
    blurb: "Better Pijin and reasoning for 4 GB phones and up. Tuned on Apple silicon."
  },
  {
    id: "lokol-health-qwen3.5-9b",
    name: "Lokol Health 9B",
    node: "llm",
    family: "Qwen3.5",
    params_b: 9,
    active_b: 9,
    size_label: "9B",
    quant: "Q4_K_M",
    file: "lokol-health-qwen3.5-9b-Q4_K_M.gguf",
    url: `${HF}/VictorChenCA/lokol-health-qwen3.5-9b-gguf/resolve/main/lokol-health-qwen3.5-9b-Q4_K_M.gguf`,
    hf_repo: "VictorChenCA/lokol-health-qwen3.5-9b-gguf",
    size_mb: 5500,
    ram_mb: 6100,
    license: "Apache-2.0",
    runtime: "llama-server",
    tiers: ["D"],
    lang: ["pis", "en"],
    trainedBy: "river",
    pair: "qwen3.5-9b-base",
    variant: "tuned",
    online_runtime: { runtime: "river", url: "river://lokol-health-qwen3.5-9b", label: "Hosted on River" },
    blurb: "The strongest tier: a River LoRA on Qwen3.5-9B. Runs on a laptop or clinic PC with llama-server, or hosted on River when there is signal."
  },

  /* ---------- Language models: untuned base counterparts ---------- */
  {
    id: "qwen3-0.6b-base",
    name: "Qwen3 0.6B (base)",
    node: "llm",
    family: "Qwen3",
    params_b: 0.6,
    active_b: 0.6,
    size_label: "0.6B",
    quant: "Q4_0",
    file: "Qwen3-0.6B-Q4_0.gguf",
    url: `${HF}/ggml-org/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q4_0.gguf`,
    size_mb: 429,
    ram_mb: 630,
    license: "Apache-2.0",
    runtime: "wllama",
    tiers: ["A", "B", "C", "D"],
    pair: "lokol-health-qwen3-0.6b",
    variant: "base",
    blurb: "Untuned base model. Use it to compare against the tuned one, or for a sector with no tuned model yet."
  },
  {
    id: "qwen3.5-0.8b-base",
    name: "Qwen3.5 0.8B (base)",
    node: "llm",
    family: "Qwen3.5",
    params_b: 0.8,
    active_b: 0.8,
    size_label: "0.8B",
    quant: "Q4_0",
    file: "Qwen3.5-0.8B-Q4_0.gguf",
    url: `${HF}/ggml-org/Qwen3.5-0.8B-GGUF/resolve/main/Qwen3.5-0.8B-Q4_0.gguf`,
    size_mb: 563,
    ram_mb: 710,
    license: "Apache-2.0",
    runtime: "wllama",
    tiers: ["A", "B", "C", "D"],
    pair: "lokol-health-qwen3.5-0.8b",
    variant: "base",
    blurb: "Untuned base model, the baseline in our evals."
  },
  {
    id: "qwen3-1.7b-base",
    name: "Qwen3 1.7B (base)",
    node: "llm",
    family: "Qwen3",
    params_b: 1.7,
    active_b: 1.7,
    size_label: "1.7B",
    quant: "Q4_K_M",
    file: "Qwen3-1.7B-Q4_K_M.gguf",
    url: `${HF}/unsloth/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q4_K_M.gguf`,
    size_mb: 1110,
    ram_mb: 1500,
    license: "Apache-2.0",
    runtime: "wllama",
    tiers: ["B", "C", "D"],
    pair: "lokol-health-qwen3-1.7b",
    variant: "base",
    blurb: "Untuned base model for 4 GB phones and up."
  },
  {
    id: "qwen3.5-9b-base",
    name: "Qwen3.5 9B (base)",
    node: "llm",
    family: "Qwen3.5",
    params_b: 9,
    active_b: 9,
    size_label: "9B",
    quant: "Q4_K_M",
    file: "Qwen3.5-9B-Q4_K_M.gguf",
    url: `${HF}/ggml-org/Qwen3.5-9B-GGUF/resolve/main/Qwen3.5-9B-Q4_K_M.gguf`,
    size_mb: 5600,
    ram_mb: 6200,
    license: "Apache-2.0",
    runtime: "llama-server",
    tiers: ["D"],
    pair: "lokol-health-qwen3.5-9b",
    variant: "base",
    blurb: "Untuned 9B base model for laptops."
  },

  /* ---------- Speech in ---------- */
  {
    id: "moonshine-tiny-en",
    name: "Moonshine Tiny",
    node: "stt",
    family: "Moonshine",
    params_b: 0.027,
    active_b: 0.027,
    size_label: "27M",
    quant: "ONNX",
    file: "onnx",
    url: `${HF}/onnx-community/moonshine-tiny-ONNX`,
    size_mb: 52,
    ram_mb: 150,
    license: "MIT",
    runtime: "transformersjs",
    tiers: ["A", "B", "C", "D"],
    lang: ["en"],
    variant: "speech",
    blurb: "English voice notes to text, inside the browser on any phone."
  },
  {
    id: "whisper-tiny-en",
    name: "Whisper tiny.en",
    node: "stt",
    family: "Whisper",
    params_b: 0.039,
    active_b: 0.039,
    size_label: "39M",
    quant: "ONNX q8",
    file: "onnx",
    url: `${HF}/onnx-community/whisper-tiny.en`,
    size_mb: 41,
    ram_mb: 200,
    license: "MIT",
    runtime: "transformersjs",
    tiers: ["A", "B", "C", "D"],
    lang: ["en"],
    variant: "speech",
    blurb: "English speech recognition; a little slower than Moonshine, more robust to accents."
  },
  {
    id: "omnilingual-ctc-300m-pis",
    name: "Omnilingual ASR 300M",
    node: "stt",
    family: "Omnilingual ASR",
    params_b: 0.3,
    active_b: 0.3,
    size_label: "300M",
    quant: "fp32",
    file: "omniASR_CTC_300M",
    url: `${HF}/facebook/omnilingual-asr`,
    size_mb: 1300,
    ram_mb: 1800,
    license: "Apache-2.0",
    runtime: "python",
    tiers: ["D"],
    lang: ["pis"],
    variant: "speech",
    blurb: "Pijin voice in (pis_Latn, about 25 h of Pijin training audio). Laptop only: it runs in the Python sidecar."
  },

  /* ---------- Speech out ---------- */
  {
    id: "mms-tts-pis",
    name: "MMS-TTS Pijin",
    node: "tts",
    family: "MMS VITS",
    params_b: 0.036,
    active_b: 0.036,
    size_label: "36M",
    quant: "ONNX q8",
    file: "onnx/model_quantized.onnx",
    url: `${HF}/facebook/mms-tts-pis`,
    size_mb: 38,
    ram_mb: 120,
    license: "CC-BY-NC-4.0",
    runtime: "transformersjs",
    tiers: ["A", "B", "C", "D"],
    lang: ["pis"],
    variant: "speech",
    blurb: "Reads replies aloud in Pijin. Non-commercial license: fine for a clinic, not for resale."
  },
  {
    id: "kokoro-82m-en",
    name: "Kokoro 82M",
    node: "tts",
    family: "Kokoro",
    params_b: 0.082,
    active_b: 0.082,
    size_label: "82M",
    quant: "ONNX q8",
    file: "onnx/model_quantized.onnx",
    url: `${HF}/onnx-community/Kokoro-82M-v1.0-ONNX`,
    size_mb: 92,
    ram_mb: 300,
    license: "Apache-2.0",
    runtime: "transformersjs",
    tiers: ["A", "B", "C", "D"],
    lang: ["en"],
    variant: "speech",
    blurb: "Natural English voice. Takes a few seconds per reply on a small phone."
  },

  /* ---------- Guideline indexes ---------- */
  {
    id: "stm-children-2017-bm25",
    name: "STM Children 2017 index",
    node: "rag",
    family: "BM25",
    params_b: 0,
    active_b: 0,
    size_label: "index",
    quant: "BM25",
    file: "corpus.json",
    url: "/packs/health/corpus.json",
    size_mb: 0.3,
    ram_mb: 15,
    license: "Index only; manual not redistributed",
    runtime: "js",
    tiers: ["A", "B", "C", "D"],
    variant: "index",
    blurb: "Solomon Islands Standard Treatment Manual for Children (2017), chunked by section with page numbers."
  },
  {
    id: "farm-guide-bm25",
    name: "Crop and pest guide index",
    node: "rag",
    family: "BM25",
    params_b: 0,
    active_b: 0,
    size_label: "index",
    quant: "BM25",
    file: "corpus.json",
    url: "/packs/farm/corpus.json",
    size_mb: 0.2,
    ram_mb: 10,
    license: "Bring your own guide",
    runtime: "js",
    tiers: ["A", "B", "C", "D"],
    variant: "index",
    placeholder: true,
    blurb: "Placeholder: the extension service adds its own crop and pest guide."
  },
  {
    id: "host-listings-bm25",
    name: "Listings and ferry times index",
    node: "rag",
    family: "BM25",
    params_b: 0,
    active_b: 0,
    size_label: "index",
    quant: "BM25",
    file: "corpus.json",
    url: "/packs/host/corpus.json",
    size_mb: 0.1,
    ram_mb: 10,
    license: "Owner's own listings",
    runtime: "js",
    tiers: ["A", "B", "C", "D"],
    variant: "index",
    placeholder: true,
    blurb: "Placeholder: the guesthouse adds its own rooms, prices and ferry timetable."
  }
];

const BY_ID = new Map(CATALOG.map((m) => [m.id, m]));

/** Older ids that may still sit in a saved graph or an exported pack. */
const LEGACY: Record<string, string> = {
  "lokol-health-0.8b": "lokol-health-qwen3.5-0.8b",
  "lokol-health-2b": "lokol-health-qwen3-1.7b",
  "lokol-health-4b": "lokol-health-qwen3-1.7b",
  "lokol-health-9b": "lokol-health-qwen3.5-9b",
  "lokol-health-9b-river": "lokol-health-qwen3.5-9b",
  "moonshine-tiny": "moonshine-tiny-en",
  "omnilingual-asr-ctc-300m": "omnilingual-ctc-300m-pis",
  "kokoro-82m": "kokoro-82m-en"
};

export function getModel(id: string | undefined | null): CatalogModel | undefined {
  if (!id) return undefined;
  return BY_ID.get(id) ?? BY_ID.get(LEGACY[id] ?? "");
}

/** Plain ModelRef for a graph node (what goes into a pack manifest). */
export function ref(id: string, opts: { online?: boolean } = {}): ModelRef {
  const m = getModel(id);
  if (!m) throw new Error(`Unknown model id: ${id}`);
  if (opts.online && m.online_runtime) {
    return { id: m.id, file: m.online_runtime.url, url: m.online_runtime.url, size_mb: 0, license: m.license, runtime: m.online_runtime.runtime };
  }
  return { id: m.id, file: m.file, url: m.url, size_mb: m.size_mb, license: m.license, runtime: m.runtime };
}

export function modelsFor(type: NodeType, lang?: Lang): CatalogModel[] {
  return CATALOG.filter((m) => m.node === type && (!lang || !m.lang || m.lang.includes(lang)));
}

/** Compact parameter count: 0.6B, 27M. */
export function paramsLabel(b: number): string {
  if (b <= 0) return "no weights";
  if (b < 1) return b < 0.1 ? `${Math.round(b * 1000)}M` : `${+(b).toFixed(1)}B`;
  return `${+b.toFixed(1)}B`;
}

/** Back-compat named handles (presets, recommender, older pages). */
export const MODELS = {
  llm_0_6b: ref("lokol-health-qwen3-0.6b"),
  llm_0_8b: ref("lokol-health-qwen3.5-0.8b"),
  llm_1_7b: ref("lokol-health-qwen3-1.7b"),
  llm_9b: ref("lokol-health-qwen3.5-9b"),
  llm_9b_river: ref("lokol-health-qwen3.5-9b", { online: true }),
  stt_en: ref("moonshine-tiny-en"),
  stt_en_whisper: ref("whisper-tiny-en"),
  stt_pis: ref("omnilingual-ctc-300m-pis"),
  tts_pis: ref("mms-tts-pis"),
  tts_en: ref("kokoro-82m-en"),
  rag_health: ref("stm-children-2017-bm25"),
  rag_farm: ref("farm-guide-bm25"),
  rag_host: ref("host-listings-bm25")
} as const satisfies Record<string, ModelRef>;

export type ModelKey = keyof typeof MODELS;

/** Default language model per device tier, before the RAM and storage checks step it down. */
export const LLM_BY_TIER: Record<Tier, ModelRef> = {
  A: MODELS.llm_0_6b,
  B: MODELS.llm_1_7b,
  C: MODELS.llm_1_7b,
  D: MODELS.llm_9b
};

export const NODE_META: Record<
  string,
  { name: string; pijin: string; color: string; tint: string; blurb: string }
> = {
  channel: { name: "Channel", pijin: "Rod blong tok", color: "#3B6E8F", tint: "#E0EAF1", blurb: "Where messages come in and go out: the app itself, WhatsApp, Messenger, SMS." },
  stt: { name: "Speech in", pijin: "Harem voes", color: "#3C8A4F", tint: "#E1F0E4", blurb: "Turns a voice note into text." },
  rag: { name: "Guideline lookup", pijin: "Lukim buk", color: "#D9952A", tint: "#FBEFD6", blurb: "Finds the matching section of the manual so every answer has a citation." },
  llm: { name: "Language model", pijin: "Brain", color: "#0F7B88", tint: "#D7ECEE", blurb: "The small tuned model that writes the reply in the nurse's language." },
  gate: { name: "Safety gate", pijin: "Sef-gate", color: "#C32F49", tint: "#F8E1E5", blurb: "Red-flag rules that force a referral and make the model say when it is not sure." },
  tts: { name: "Speech out", pijin: "Toktok", color: "#7A5CA8", tint: "#EBE4F4", blurb: "Reads the reply aloud." },
  router: { name: "Router", pijin: "Rod", color: "#5C6B75", tint: "#E6EAED", blurb: "Sends a message down one path or another based on a rule." },
  note: { name: "Visit note", pijin: "Raetem", color: "#8A6D3B", tint: "#F1E9DC", blurb: "Turns a dictated visit into a structured record kept on the phone." }
};

/** Red-flag list (SPEC §2), mirrored from app/src/runtime/gate.ts for display in the Studio. */
export const RED_FLAG_LABELS: { en: string; pis: string }[] = [
  { en: "Convulsions", pis: "fit / sek-sek" },
  { en: "Unable to drink or breastfeed", pis: "no save dring / no save susu" },
  { en: "Vomits everything", pis: "toraot evri samting" },
  { en: "Lethargic or unconscious", pis: "slip tumas / no save wekap" },
  { en: "Chest indrawing or fast breathing with a danger sign", pis: "brit hariap / chest i go insaet" },
  { en: "Stiff neck", pis: "nek stif" },
  { en: "Severe dehydration", pis: "drae tumas" },
  { en: "Severe malnutrition", pis: "tin tumas / leg i solap" },
  { en: "Bleeding", pis: "blad i kam aot" },
  { en: "Cyanosis", pis: "lips i blu" },
  { en: "Under 2 months with fever", pis: "bebi anda 2 manis wetem hot bodi" },
  { en: "Burns of face or airway", pis: "bon long fes / maus" }
];
