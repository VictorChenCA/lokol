import type { Graph } from "../types";
import { MODELS, ref } from "../models";
import { autoLayout } from "../components/studio/layout";

/** Three packs. Health is the custom pack built from the STM; Farm and Host are sample packs that reuse the same runtime with sample guides. */

export const HEALTH_GRAPH: Graph = autoLayout({
  version: 1,
  name: "Lokol Health (Solomon Islands)",
  sector: "health",
  language: ["pis", "en"],
  target: { device: "Samsung Galaxy A12", ram_gb: 3, storage_gb: 32, connectivity: "none" },
  nodes: [
    { id: "channel-1", type: "channel", label: "App (offline PWA)", params: { kinds: ["pwa"], direction: "in" }, online: false, position: { x: 0, y: 140 } },
    { id: "stt-1", type: "stt", label: "Speech in (English)", model: MODELS.stt_en, params: { lang: "en" }, online: false, position: { x: 260, y: 20 } },
    { id: "rag-1", type: "rag", label: "STM Children 2017 lookup", model: MODELS.rag_health, params: { method: "bm25", top_k: 1, corpus: "stm_children_2017" }, online: false, position: { x: 520, y: 140 } },
    { id: "llm-1", type: "llm", label: "Lokol Health 0.6B", model: MODELS.llm_0_6b, params: { quant: "Q4_K_M", max_tokens: 220, temperature: 0, escalate_to: null }, online: false, position: { x: 780, y: 140 } },
    { id: "gate-1", type: "gate", label: "Red flags and abstain", params: { red_flags: "RED_FLAGS", abstain_when_no_guideline: true }, online: false, position: { x: 1040, y: 140 } },
    { id: "tts-1", type: "tts", label: "Speech out (Pijin)", model: MODELS.tts_pis, params: { lang: "pis", voice: "mms-vits" }, online: false, position: { x: 1300, y: 20 } },
    { id: "channel-2", type: "channel", label: "Reply (app)", params: { kinds: ["pwa"], direction: "out", store_and_forward: false }, online: false, position: { x: 1560, y: 140 } }
  ],
  edges: [
    { from: "channel-1", to: "stt-1" },
    { from: "channel-1", to: "rag-1" },
    { from: "stt-1", to: "rag-1" },
    { from: "rag-1", to: "llm-1" },
    { from: "llm-1", to: "gate-1" },
    { from: "gate-1", to: "tts-1" },
    { from: "tts-1", to: "channel-2" },
    { from: "gate-1", to: "channel-2" }
  ]
});

export const AGRICULTURE_GRAPH: Graph = autoLayout({
  version: 1,
  name: "Lokol Farm",
  sector: "agriculture",
  language: ["pis", "en"],
  target: { device: "Xiaomi Redmi 12", ram_gb: 4, storage_gb: 128, connectivity: "intermittent" },
  nodes: [
    { id: "channel-1", type: "channel", label: "App + WhatsApp", params: { kinds: ["pwa", "whatsapp"], direction: "in" }, online: true, position: { x: 0, y: 140 } },
    { id: "stt-1", type: "stt", label: "Speech in (English)", model: MODELS.stt_en, params: { lang: "en" }, online: false, position: { x: 260, y: 20 } },
    { id: "rag-1", type: "rag", label: "Crop and pest guide lookup", model: MODELS.rag_farm, params: { method: "bm25", top_k: 1, corpus: "farm_sample_guide", note: "Sample data: a 14-section crop and pest guide written for the demo, not an official extension manual." }, online: false, position: { x: 520, y: 140 } },
    { id: "llm-1", type: "llm", label: "Lokol Farm 1.7B (base model)", model: ref("qwen3-1.7b-base"), params: { quant: "Q4_K_M", max_tokens: 220, temperature: 0, escalate_to: null }, online: false, position: { x: 780, y: 140 } },
    { id: "gate-1", type: "gate", label: "Pesticide safety gate", params: { rules: ["never recommend banned chemicals", "refer to extension officer when unsure"], abstain_when_no_guideline: true }, online: false, position: { x: 1040, y: 140 } },
    { id: "router-1", type: "router", label: "Price query or advice?", params: { rule: "if message mentions price or market -> online lookup" }, online: true, position: { x: 1300, y: 140 } },
    { id: "tts-1", type: "tts", label: "Speech out (Pijin)", model: MODELS.tts_pis, params: { lang: "pis" }, online: false, position: { x: 1560, y: 20 } },
    { id: "channel-2", type: "channel", label: "Reply (app, WhatsApp)", params: { kinds: ["pwa", "whatsapp"], direction: "out", store_and_forward: true }, online: true, position: { x: 1820, y: 140 } }
  ],
  edges: [
    { from: "channel-1", to: "stt-1" },
    { from: "channel-1", to: "rag-1" },
    { from: "stt-1", to: "rag-1" },
    { from: "rag-1", to: "llm-1" },
    { from: "llm-1", to: "gate-1" },
    { from: "gate-1", to: "router-1" },
    { from: "router-1", to: "tts-1" },
    { from: "router-1", to: "channel-2" },
    { from: "tts-1", to: "channel-2" }
  ]
});

export const TOURISM_GRAPH: Graph = autoLayout({
  version: 1,
  name: "Lokol Host",
  sector: "tourism",
  language: ["en", "pis"],
  target: { device: "Oppo A58", ram_gb: 6, storage_gb: 128, connectivity: "online" },
  nodes: [
    { id: "channel-1", type: "channel", label: "Messenger + app", params: { kinds: ["messenger", "pwa"], direction: "in" }, online: true, position: { x: 0, y: 140 } },
    { id: "rag-1", type: "rag", label: "Guesthouse and ferry info", model: MODELS.rag_host, params: { method: "bm25", top_k: 2, corpus: "host_sample_guide", note: "Sample data: a 14-section guesthouse guide written for the demo. A host replaces it with their own listings and timetables." }, online: false, position: { x: 260, y: 140 } },
    { id: "llm-1", type: "llm", label: "Lokol Host 1.7B (base model)", model: ref("qwen3-1.7b-base"), params: { quant: "Q4_K_M", max_tokens: 260, temperature: 0.3, escalate_to: null }, online: false, position: { x: 520, y: 140 } },
    { id: "gate-1", type: "gate", label: "Booking and payment gate", params: { rules: ["never confirm a booking without the host", "never quote a price not in the listing"], abstain_when_no_guideline: true }, online: false, position: { x: 780, y: 140 } },
    { id: "tts-1", type: "tts", label: "Speech out (English)", model: MODELS.tts_en, params: { lang: "en" }, online: false, position: { x: 1040, y: 20 } },
    { id: "channel-2", type: "channel", label: "Reply (Messenger, app)", params: { kinds: ["messenger", "pwa"], direction: "out", store_and_forward: false }, online: true, position: { x: 1300, y: 140 } }
  ],
  edges: [
    { from: "channel-1", to: "rag-1" },
    { from: "rag-1", to: "llm-1" },
    { from: "llm-1", to: "gate-1" },
    { from: "gate-1", to: "tts-1" },
    { from: "gate-1", to: "channel-2" },
    { from: "tts-1", to: "channel-2" }
  ]
});

export const PRESETS: Record<"health" | "agriculture" | "tourism", Graph> = {
  health: HEALTH_GRAPH,
  agriculture: AGRICULTURE_GRAPH,
  tourism: TOURISM_GRAPH
};

export const SECTOR_COPY = {
  health: {
    title: "Lokol Health",
    pijin: "Helpem nes long klinik",
    line: "An offline helper for nurse aides, grounded in the Solomon Islands Standard Treatment Manual for Children.",
    status: "Custom pack: fine-tuned models, the full manual as a corpus, and evaluations."
  },
  agriculture: {
    title: "Lokol Farm",
    pijin: "Helpem fama long gaden",
    line: "An offline helper for farmers and extension officers: crop, pest and market questions, with a safety check for chemicals.",
    status: "Sample pack: the general model and a sample crop guide."
  },
  tourism: {
    title: "Lokol Host",
    pijin: "Helpem haos blong visita",
    line: "An offline helper for guesthouses and tour operators: enquiries answered from their own listings and ferry times.",
    status: "Sample pack: the general model and a sample guesthouse guide."
  }
} as const;
