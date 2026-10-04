import type { Connectivity, Device, Graph, GraphNode, Sector, Tier, ModelRef } from "./types";
import { MODELS, LLM_BY_TIER, getModel, ref } from "./models";
import { autoLayout } from "./components/studio/layout";

export interface RecommendInput {
  sector: Sector;
  languages: string[]; // ISO-ish codes: "pis", "en"
  voiceIn: boolean;
  voiceOut: boolean;
  connectivity: Connectivity;
  deviceName: string;
  ram_gb: number;
  storage_gb: number;
  isLaptop?: boolean;
  device?: Device | null;
}

export interface Recommendation {
  tier: Tier;
  tierLabel: string;
  graph: Graph;
  reasons: string[];
  willNotWork: string[];
  totalMb: number;
  freeStorageMb: number;
  /** Estimated resident memory of the whole pack, and what the device leaves free for it. */
  ramMb: number;
  usableRamMb: number;
}

export const TIER_LABEL: Record<Tier, string> = {
  A: "Tier A: small phone (under 3 GB)",
  B: "Tier B: everyday phone (3–5 GB)",
  C: "Tier C: better phone (6–8 GB)",
  D: "Tier D: laptop or clinic PC"
};

export function tierFor(ram_gb: number, isLaptop = false): Tier {
  if (isLaptop || ram_gb > 8) return "D";
  if (ram_gb < 3) return "A";
  if (ram_gb <= 5) return "B";
  return "C";
}

/** We assume roughly 35% of the phone's storage is free for a pack. Plain, conservative. */
export function freeStorageMb(storage_gb: number): number {
  return Math.round(storage_gb * 1024 * 0.35);
}

/** Memory the system and other apps keep: phones about 40% (at least 1 GB), computers about 30% (at least 2 GB). */
export function reservedRamMb(ram_gb: number, computer: boolean): number {
  const total = ram_gb * 1024;
  return Math.round(computer ? Math.max(2048, total * 0.3) : Math.max(1000, total * 0.4));
}

/** Browser tab and app shell on a phone; llama-server and the local page on a computer. */
export function appOverheadMb(computer: boolean): number {
  return computer ? 160 : 260;
}

export function isComputerName(name: string): boolean {
  return /laptop|clinic pc|desktop|macbook|\bpc\b|computer/i.test(name);
}

const SECTOR_NAME: Record<Sector, string> = {
  health: "Lokol Health",
  agriculture: "Lokol Farm",
  tourism: "Lokol Host"
};

const LADDER = ["lokol-health-qwen3.5-9b", "lokol-health-qwen3-1.7b", "lokol-health-qwen3-0.6b"];

function nodeId(type: string, n: number) {
  return `${type}-${n}`;
}

function ram(m: ModelRef | undefined): number {
  if (!m) return 0;
  return getModel(m.id)?.ram_mb ?? Math.round(m.size_mb * 1.3);
}

export function recommend(input: RecommendInput): Recommendation {
  const reasons: string[] = [];
  const willNotWork: string[] = [];
  const langs = input.languages.length ? input.languages : ["en"];
  const hasPijin = langs.includes("pis");
  const hasEnglish = langs.includes("en");
  const computer = !!input.isLaptop || isComputerName(input.deviceName);
  const tier = tierFor(input.ram_gb, computer);
  const free = freeStorageMb(input.storage_gb);
  const usable = Math.max(0, Math.round(input.ram_gb * 1024) - reservedRamMb(input.ram_gb, computer));
  const overhead = appOverheadMb(computer);
  const online = input.connectivity !== "none";
  const health = input.sector === "health";

  reasons.push(`${input.deviceName || "This device"} has about ${input.ram_gb} GB of RAM: ${TIER_LABEL[tier]}. About ${(usable / 1024).toFixed(1)} GB is free for Lokol after the system.`);

  // Speech and lookup first: they are small and decide how much room the language model has.
  type Optional = { key: string; model: ModelRef; type: "stt" | "tts"; lang: "en" | "pis"; drop: string };
  const optional: Optional[] = [];
  if (input.voiceIn) {
    if (hasEnglish) optional.push({ key: "stt-en", model: MODELS.stt_en, type: "stt", lang: "en", drop: "English voice-in is off to leave memory for the language model. The nurse types instead." });
    if (hasPijin) {
      if (tier === "D") optional.push({ key: "stt-pis", model: MODELS.stt_pis, type: "stt", lang: "pis", drop: "Pijin voice-in is off: not enough memory beside the language model." });
      else willNotWork.push("Pijin voice-in: the smallest Pijin speech model is 1.3 GB and runs in a Python service on a laptop. On this phone the nurse types Pijin, or speaks English.");
    }
  }
  if (input.voiceOut) {
    if (hasPijin) optional.push({ key: "tts-pis", model: MODELS.tts_pis, type: "tts", lang: "pis", drop: "Pijin voice-out is off: not enough memory beside the language model." });
    if (hasEnglish) optional.push({ key: "tts-en", model: MODELS.tts_en, type: "tts", lang: "en", drop: "English voice-out (Kokoro, about 300 MB in memory) is off on this phone; replies are read in Pijin or shown as text." });
  }
  const ragModel = health ? MODELS.rag_health : input.sector === "agriculture" ? MODELS.rag_farm : MODELS.rag_host;

  // Language model: start from the tier default, step down until it fits memory and storage.
  const fixedRam = ram(ragModel) + overhead;
  const optRam = () => optional.reduce((s, o) => s + ram(o.model), 0);
  const optDisk = () => optional.reduce((s, o) => s + o.model.size_mb, 0);
  const startId = LLM_BY_TIER[tier].id;
  let idx = LADDER.indexOf(startId);
  const fitsAt = (i: number) => {
    const m = getModel(LADDER[i])!;
    return m.ram_mb + fixedRam + optRam() <= usable && m.size_mb <= free - 400;
  };
  while (idx < LADDER.length - 1 && !fitsAt(idx)) idx += 1;
  const chosen = getModel(LADDER[idx])!;
  if (chosen.id !== startId) {
    const from = getModel(startId)!;
    const storageBound = from.size_mb > free - 400;
    reasons.push(
      storageBound
        ? `Storage is tight (about ${(free / 1024).toFixed(1)} GB free), so the model steps down from ${from.name} to ${chosen.name}.`
        : `Memory is tight, so the model steps down from ${from.name} (${(from.ram_mb / 1024).toFixed(1)} GB in memory) to ${chosen.name}.`
    );
  }
  // Still too big? Drop optional voices, largest first, and say so.
  const over = () => chosen.ram_mb + fixedRam + optRam() > usable;
  const dropOrder = ["tts-en", "stt-en", "stt-pis", "tts-pis"];
  for (const key of dropOrder) {
    if (!over()) break;
    const i = optional.findIndex((o) => o.key === key);
    if (i >= 0) {
      willNotWork.push(optional[i].drop);
      optional.splice(i, 1);
    }
  }

  const llmRef: ModelRef = health ? ref(chosen.id) : ref(chosen.pair ?? chosen.id);
  const llmCat = getModel(llmRef.id)!;
  if (tier === "A") reasons.push(`${llmCat.name} keeps the model under 700 MB of memory so the phone can still run the keyboard and the browser.`);
  else if (tier === "B" || tier === "C") reasons.push(llmCat.params_b > 1 ? `${llmCat.name} gives better Pijin and reasoning and still fits beside the system.` : `${llmCat.name} is the safe choice for this phone's free memory.`);
  else reasons.push(`A computer can run ${llmCat.name}${llmCat.trainedBy === "river" ? ", tuned on River," : ""} and host the Pijin speech-in service.`);

  const nodes: GraphNode[] = [];
  const edges: { from: string; to: string }[] = [];
  const P = { x: 0, y: 0 };

  const chIn = nodeId("channel", 1);
  nodes.push({
    id: chIn,
    type: "channel",
    label: online ? "App + WhatsApp" : "App (offline PWA)",
    params: { kinds: online ? ["pwa", "whatsapp", "messenger"] : ["pwa"], direction: "in" },
    online,
    position: P
  });

  const stts = optional.filter((o) => o.type === "stt");
  stts.forEach((o, i) => {
    const id = nodeId("stt", i + 1);
    nodes.push({ id, type: "stt", label: o.lang === "pis" ? "Speech in (Pijin)" : "Speech in (English)", model: o.model, params: o.lang === "pis" ? { lang: "pis", service: "sidecar" } : { lang: "en" }, online: false, position: P });
    edges.push({ from: chIn, to: id });
    reasons.push(o.lang === "pis" ? "Pijin voice-in runs on the laptop with Omnilingual ASR (300M, 1.3 GB), trained on about 25 hours of Pijin." : "English voice-in uses Moonshine Tiny (52 MB) inside the browser.");
  });
  if (!input.voiceIn) reasons.push("Voice-in is off, so no speech model is downloaded. Text works in both languages.");

  const rag = nodeId("rag", 1);
  nodes.push({
    id: rag,
    type: "rag",
    label: health ? "STM Children 2017 lookup" : input.sector === "agriculture" ? "Crop and pest guide lookup" : "Listings and ferry times",
    model: ragModel,
    params: { method: "bm25", top_k: health ? 1 : 2, corpus: health ? "stm_children_2017" : "sector-corpus-todo" },
    online: false,
    position: P
  });
  stts.forEach((_, i) => edges.push({ from: nodeId("stt", i + 1), to: rag }));
  edges.push({ from: chIn, to: rag });

  const llmId = nodeId("llm", 1);
  const escalate = online && tier !== "D";
  nodes.push({
    id: llmId,
    type: "llm",
    label: health ? llmCat.name : `${SECTOR_NAME[input.sector]} ${llmCat.size_label} (base model)`,
    model: llmRef,
    params: { quant: llmCat.quant, max_tokens: 220, temperature: 0, escalate_to: escalate ? "lokol-health-qwen3.5-9b" : null },
    online: escalate,
    position: P
  });
  edges.push({ from: rag, to: llmId });
  if (escalate) reasons.push("With a signal, hard questions can go to Lokol Health 9B on River; without one, the small model answers alone.");

  const gate = nodeId("gate", 1);
  nodes.push({
    id: gate,
    type: "gate",
    label: health ? "Red flags and abstain" : input.sector === "agriculture" ? "Pesticide safety gate" : "Booking and payment gate",
    params: health ? { red_flags: "RED_FLAGS", abstain_when_no_guideline: true } : { rules: input.sector === "agriculture" ? ["never recommend banned chemicals", "refer to extension officer when unsure"] : ["never confirm a booking without the host", "never quote a price not in the listing"], abstain_when_no_guideline: true },
    online: false,
    position: P
  });
  edges.push({ from: llmId, to: gate });

  if (health) {
    nodes.push({ id: nodeId("note", 1), type: "note", label: "Visit note (on device)", params: { storage: "indexeddb", encrypted: "pin", export: "dhis2-shaped-json" }, online: false, position: P });
    edges.push({ from: gate, to: nodeId("note", 1) });
  }

  const ttss = optional.filter((o) => o.type === "tts");
  const chOut = nodeId("channel", 2);
  ttss.forEach((o, i) => {
    const id = nodeId("tts", i + 1);
    nodes.push({ id, type: "tts", label: o.lang === "pis" ? "Speech out (Pijin)" : "Speech out (English)", model: o.model, params: o.lang === "pis" ? { lang: "pis", voice: "mms-vits" } : { lang: "en", voice: "af_heart" }, online: false, position: P });
    edges.push({ from: gate, to: id });
    edges.push({ from: id, to: chOut });
    if (o.lang === "pis") reasons.push("Pijin voice-out uses MMS-TTS (38 MB). It is licensed CC-BY-NC: fine for a clinic, not for resale.");
  });

  nodes.push({
    id: chOut,
    type: "channel",
    label: online ? "Reply (app, WhatsApp)" : "Reply (app)",
    params: { kinds: online ? ["pwa", "whatsapp", "messenger"] : ["pwa"], direction: "out", store_and_forward: input.connectivity === "intermittent" },
    online,
    position: P
  });
  edges.push({ from: gate, to: chOut });

  if (input.connectivity === "none") {
    reasons.push("No signal, so every node runs on the device and nothing is sent anywhere. Notes stay on the phone.");
    willNotWork.push("WhatsApp or Messenger: there is no signal to send messages through. The app itself still works.");
  } else if (input.connectivity === "intermittent") {
    reasons.push("Signal comes and goes, so the app works offline and sends notes or WhatsApp replies when it reconnects.");
  } else {
    reasons.push("Online, so the WhatsApp or Messenger bridge is on and the phone can use the stronger hosted model.");
  }

  if (!health) {
    willNotWork.push(`${SECTOR_NAME[input.sector]}: no tuned model or guideline corpus ships tonight. The graph uses the base model and a placeholder corpus; Lokol Health is the worked example.`);
  }

  const seen = new Set<string>();
  let totalMb = 0;
  for (const n of nodes) {
    if (n.model && !seen.has(n.model.id)) {
      seen.add(n.model.id);
      totalMb += n.model.size_mb;
    }
  }
  const ramMb = nodes.reduce((s, n) => s + ram(n.model), 0) + overhead;
  if (ramMb > usable) {
    willNotWork.push(`Even the smallest setup needs about ${(ramMb / 1024).toFixed(1)} GB of memory and ${input.deviceName || "this device"} has about ${(usable / 1024).toFixed(1)} GB free. Expect slow replies, or use a bigger phone.`);
  }
  if (totalMb > free) {
    willNotWork.push(`The full pack (${(totalMb / 1024).toFixed(1)} GB) will not fit in the ${(free / 1024).toFixed(1)} GB we expect to be free. Turn off voice or clear space.`);
  }

  const graph: Graph = autoLayout({
    version: 1,
    name: `${SECTOR_NAME[input.sector]} for ${input.deviceName || "device"}`,
    sector: input.sector,
    language: langs,
    target: {
      device: input.deviceName || "unknown",
      ram_gb: input.ram_gb,
      storage_gb: input.storage_gb,
      connectivity: input.connectivity
    },
    nodes,
    edges
  });

  return { tier, tierLabel: TIER_LABEL[tier], graph, reasons, willNotWork, totalMb, freeStorageMb: free, ramMb, usableRamMb: usable };
}

export function searchDevices(devices: Device[], q: string): Device[] {
  const s = q.trim().toLowerCase();
  if (!s) return devices.slice(0, 12);
  const parts = s.split(/\s+/);
  return devices
    .filter((d) => {
      const hay = `${d.brand} ${d.model}`.toLowerCase();
      return parts.every((p) => hay.includes(p));
    })
    .slice(0, 12);
}
