/**
 * Canned runtime used when VITE_RUNTIME=shim or app/src/runtime/engine.ts is absent.
 * Same API as the real engine (SPEC §5). Replies are plausible, not generated.
 */
import type { Chunk, Engine, EngineStatus, Flags, GateResult, Lang, LoadProgress, Manifest, ParsedReply } from "./types";
import { BM25Index } from "./runtime/rag";

/** A pack built in the New pack wizard: its own corpus, red-flag phrases and fallback message. */
interface CustomPack { index: BM25Index; redFlags: string[]; fallback: string; name: string }

function customPack(manifest: Manifest): CustomPack | null {
  const m = manifest as Manifest & { corpus_inline?: any; red_flags?: string[]; fallback_message?: string };
  if (!m.corpus_inline) return null;
  return {
    index: new BM25Index(m.corpus_inline),
    redFlags: (m.red_flags ?? []).map((r) => r.trim().toLowerCase()).filter(Boolean),
    fallback: m.fallback_message || "I am not sure. Ask a person who knows.",
    name: m.graph?.name ?? "Your pack"
  };
}

function customFlags(c: CustomPack, text: string): string[] {
  const t = text.toLowerCase();
  return c.redFlags.filter((r) => t.includes(r));
}

/** Canned reply for a custom pack: cites the retrieved chunk of the user's own manual. */
function customCanned(c: CustomPack, chunk: Chunk | null, message: string): ParsedReply {
  const flags = customFlags(c, message);
  if (flags.length) {
    const body = `Red flag: ${flags.join(", ")}.\n${c.fallback}`;
    return { action: "REFER_NOW", stm: chunk?.section ?? "NONE", body, raw: `ACTION: REFER_NOW\nSTM: ${chunk?.section ?? "NONE"}\n---\n${body}` };
  }
  if (!chunk) return { action: "ASK_PERSON", stm: "NONE", body: c.fallback, raw: `ACTION: ASK_PERSON\nSTM: NONE\n---\n${c.fallback}` };
  const sentences = chunk.text.replace(/\s+/g, " ").match(/[^.!?]+[.!?]/g) ?? [chunk.text];
  const body = [`From "${chunk.section}" (page ${chunk.page}):`, ...sentences.slice(0, 4).map((x) => x.trim())].join("\n");
  return { action: "ADVISE", stm: chunk.section, body, raw: `ACTION: ADVISE\nSTM: ${chunk.section}\n---\n${body}` };
}

const RED_FLAGS: { re: RegExp; label: string }[] = [
  { re: /\b(convuls|fit|fits|sek-?sek|seizure)/i, label: "convulsions" },
  { re: /\b(unable to drink|cannot drink|no save dring|no dring|no susu|cannot breastfeed|unable to breastfeed)/i, label: "unable to drink or breastfeed" },
  { re: /\b(vomits? everything|toraot evri|toraot olketa|vomits? all)/i, label: "vomits everything" },
  { re: /\b(lethargic|unconscious|slip tumas|no wekap|not waking)/i, label: "lethargic or unconscious" },
  { re: /\b(chest indrawing|indrawing|fast breathing|brit hariap|hariap brit)/i, label: "chest indrawing or fast breathing" },
  { re: /\b(stiff neck|nek stif|neck stiff)/i, label: "stiff neck" },
  { re: /\b(severe dehydration|sunken eyes|skin pinch)/i, label: "severe dehydration" },
  { re: /\b(wasting|oedema|edema|swollen feet|both feet)/i, label: "severe malnutrition" },
  { re: /\b(bleeding|blad kam aot|blood coming)/i, label: "bleeding" },
  { re: /\b(blue lips|cyanos)/i, label: "cyanosis" },
  { re: /\b(burn).*(face|airway|mouth)|(face|airway|mouth).*(burn)/i, label: "burns of face or airway" }
];

const CHUNKS: Chunk[] = [
  {
    id: "stm-c-053-malaria-01",
    section: "MALARIA",
    subsection: "Treatment of uncomplicated malaria",
    page: 53,
    text:
      "Any child with fever should be tested for malaria with an RDT. If the RDT is positive and there are no danger signs, treat with artemether-lumefantrine (Coartem) by weight: 5–14 kg 1 tablet, 15–24 kg 2 tablets, 25–34 kg 3 tablets, twice daily for 3 days. Give the first dose in the clinic and watch for vomiting. If the child vomits within 30 minutes, repeat the dose. Give paracetamol for fever. Review in 2 days or sooner if worse. If no RDT is available, refer to the nearest facility that can test, or treat presumptively only if referral is impossible.",
    tokens: 118
  },
  {
    id: "stm-c-071-diarrhoea-02",
    section: "DIARRHOEA",
    subsection: "Treatment of some dehydration (Plan B)",
    page: 71,
    text:
      "For a child with some dehydration (restless or irritable, sunken eyes, drinks eagerly, skin pinch goes back slowly), give ORS 75 ml/kg over 4 hours in the clinic. Continue breastfeeding. Give zinc: 10 mg daily for 14 days under 6 months, 20 mg daily for 14 days over 6 months. Reassess after 4 hours. If the child cannot drink, vomits everything, or becomes lethargic, this is severe dehydration: start IV fluids if possible and refer urgently.",
    tokens: 102
  },
  {
    id: "stm-c-061-pneumonia-01",
    section: "COUGH AND DIFFICULTY BREATHING",
    subsection: "Pneumonia",
    page: 61,
    text:
      "Count breaths for one full minute. Fast breathing is 50 or more per minute for 2–11 months and 40 or more for 1–5 years. Fast breathing without chest indrawing is pneumonia: give amoxicillin 40 mg/kg twice daily for 5 days and review in 2 days. Chest indrawing, stridor at rest, or any danger sign is severe pneumonia: give the first dose of amoxicillin (or IM ampicillin and gentamicin if available), keep the child warm, and refer now.",
    tokens: 104
  },
  {
    id: "stm-c-027-danger-signs-01",
    section: "DANGER SIGNS AND REFERRAL",
    subsection: "General danger signs",
    page: 27,
    text:
      "Refer immediately any child who has convulsions, is unable to drink or breastfeed, vomits everything, is lethargic or unconscious, has a stiff neck, or is under 2 months with fever. Before transport: keep the child warm, continue breastfeeding or small sips of ORS if able, treat for low blood sugar if the child cannot feed, give the first dose of antibiotic and antimalarial as per the section, and write a referral note with the time and what was given.",
    tokens: 99
  }
];

/** Drop negated danger signs ("no fit", "nomoa sek-sek", "not vomiting") before matching. */
function stripNegations(text: string): string {
  return text.replace(/\b(no|nomoa|not|never|without|neva)\s+(fit|fits|fitting|convulsions?|sek-?sek|seizures?|vomiting|bleeding|blad|stiff neck|nek stif)\b/gi, " ");
}

function pick(query: string): Chunk | null {
  const q = stripNegations(query.toLowerCase());
  if (RED_FLAGS.some((r) => r.re.test(q))) return CHUNKS[3];
  if (/(fever|hot bodi|malaria|rdt|hot)/.test(q)) return CHUNKS[0];
  if (/(diarr|sitsit|dehydrat|ors|loose)/.test(q)) return CHUNKS[1];
  if (/(cough|breath|brit|pneumon|kof)/.test(q)) return CHUNKS[2];
  return null;
}

function detectRedFlags(text: string): string[] {
  const t = stripNegations(text);
  return RED_FLAGS.filter((r) => r.re.test(t)).map((r) => r.label);
}

function isOutOfScope(q: string): boolean {
  return /(adult|man|woman|pregnan|x-?ray|ultrasound|scan|loan|football|weather|price|dose of .* (for|long) (mi|me)|bebi i (hao|how) old|years old man)/i.test(q) && !/(pikinini|child|bebi|baby|months|month|yia)/i.test(q);
}

function canned(flags: Flags, chunk: Chunk | null, message: string): ParsedReply {
  const pis = flags.lang === "pis";
  const flagsFound = detectRedFlags(message);
  if (flagsFound.length) {
    const next = flags.transport === "next_boat";
    const action = next ? "REFER_NEXT_TRANSPORT" : "REFER_NOW";
    const body = pis
      ? [
          `Pikinini ia garem denja saen: ${flagsFound.join(", ")}.`,
          next ? "Sendem long hospitol long nekis bot." : "Sendem long hospitol kwiktaem nao.",
          "Kipim pikinini wom, givim smol wata o susu sapos hem save dring.",
          flags.act === "yes" ? "Givim fes dos Coartem bifo bot i go." : "Sapos no Coartem, raetem long referral note.",
          "Raetem taem an wanem iu givim long note."
        ].join("\n")
      : [
          `This child has a danger sign: ${flagsFound.join(", ")}.`,
          next ? "Refer on the next boat." : "Refer now.",
          "Keep the child warm; small sips of ORS or breast milk if able to drink.",
          flags.act === "yes" ? "Give the first dose of Coartem before transport." : "No Coartem available: write that on the referral note.",
          "Write the time and what was given on the referral note."
        ].join("\n");
    return { action, stm: "DANGER SIGNS AND REFERRAL", body, raw: `ACTION: ${action}\nSTM: DANGER SIGNS AND REFERRAL\n---\n${body}` };
  }
  if (!chunk || isOutOfScope(message)) {
    const body = pis
      ? "Mi no sua. Disfala kwestin hem no stap long buk blong pikinini.\nAskem nes in charge o dokta long hospitol.\nSapos hem adult, iusim adult manual."
      : "I am not sure. This question is not in the children's manual.\nAsk the nurse in charge or the doctor at the hospital.\nIf the patient is an adult, use the adult manual.";
    return { action: "ASK_PERSON", stm: "NONE", body, raw: `ACTION: ASK_PERSON\nSTM: NONE\n---\n${body}` };
  }
  let body: string;
  if (chunk.section === "MALARIA") {
    if (flags.rdt === "no") {
      body = pis
        ? "No RDT long klinik. Hot bodi tu dei long pikinini i nidim test.\nSendem long nekis klinik wea garem RDT.\nGivim paracetamol folom weit blong hem.\nSapos no save sendem, treatem olsem malaria an raetem daon.\nLukim pikinini bak long 2 dei o kwiktaem sapos hem wos."
        : "No RDT at the clinic. Two days of fever in a child needs a test.\nSend to the nearest clinic that has an RDT.\nGive paracetamol by weight.\nIf referral is impossible, treat as malaria and record it.\nReview in 2 days or sooner if worse.";
    } else {
      body = pis
        ? "Duim RDT fastaem.\nSapos RDT positiv an no denja saen: givim Coartem folom weit, 2 taem evri dei fo 3 dei.\nGivim fes dos long klinik an lukim sapos hem toraot long 30 minit, givim bak.\nGivim paracetamol fo hot bodi.\nLukim pikinini bak long 2 dei o kwiktaem sapos hem wos."
        : "Do an RDT first.\nIf positive and no danger signs: give Coartem by weight, twice a day for 3 days.\nGive the first dose in the clinic; if the child vomits within 30 minutes, repeat it.\nGive paracetamol for the fever.\nReview in 2 days or sooner if worse.";
    }
  } else if (chunk.section === "DIARRHOEA") {
    body = pis
      ? "Lukim: ae i sunk, skin pinch slou, pikinini i dring hariap? Hem some dehydration.\nGivim ORS 75 ml long evri kg, slou, fo 4 aoa long klinik.\nGohed fo givim susu.\nGivim zinc fo 14 dei.\nLukim bak afta 4 aoa. Sapos hem no save dring o toraot evri samting, sendem nao."
      : "Check: sunken eyes, slow skin pinch, drinks eagerly? That is some dehydration.\nGive ORS 75 ml per kg slowly over 4 hours in the clinic.\nKeep breastfeeding.\nGive zinc for 14 days.\nReassess after 4 hours. If the child cannot drink or vomits everything, refer now.";
  } else {
    body = pis
      ? "Kaontem brit fo wan ful minit.\n2–11 manis: 50 o moa hem hariap. 1–5 yia: 40 o moa.\nHariap brit nomoa, no chest indrawing: givim amoxicillin 40 mg/kg tu taem evri dei fo 5 dei.\nLukim bak long 2 dei.\nSapos chest indrawing o eni denja saen: givim fes dos an sendem nao."
      : "Count breaths for one full minute.\n2–11 months: 50 or more is fast. 1–5 years: 40 or more.\nFast breathing only, no chest indrawing: amoxicillin 40 mg/kg twice daily for 5 days.\nReview in 2 days.\nChest indrawing or any danger sign: give the first dose and refer now.";
  }
  return { action: "ADVISE", stm: chunk.section, body, raw: `ACTION: ADVISE\nSTM: ${chunk.section}\n---\n${body}` };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class ShimEngine implements Engine {
  constructor(private manifest: Manifest, private custom: CustomPack | null = null) {}

  async transcribe(_audio: Blob, lang: Lang): Promise<string> {
    await sleep(600);
    if (lang === "pis") return ""; // unsupported on phone tier; UI shows the reason
    return "Child three years old, fever for two days, not eating much, no fits.";
  }

  async retrieve(query: string): Promise<Chunk[]> {
    await sleep(120);
    if (this.custom) {
      // real BM25 over the user's corpus; a small manual has low IDF, so the bar is coverage, not score
      const hits = this.custom.index.searchDetailed(stripNegations(query), 3).hits;
      return (hits[0] && hits[0].coverage >= 0.3 ? hits : []) as Chunk[];
    }
    const c = pick(query);
    return c ? [{ ...c, score: 7.4 }] : [];
  }

  async generate(flags: Flags, guidelineChunk: Chunk | null, message: string, onToken?: (t: string) => void): Promise<ParsedReply> {
    const reply = this.custom ? customCanned(this.custom, guidelineChunk, message) : canned(flags, guidelineChunk, message);
    const t0 = performance.now();
    const words = reply.raw.split(/(\s+)/);
    let n = 0;
    for (const w of words) {
      if (onToken) onToken(w);
      n += 1;
      await sleep(w.trim() ? 18 : 2);
    }
    const ms = performance.now() - t0;
    return { ...reply, stats: { ms: Math.round(ms), tokens: n, tps: Math.round((n / ms) * 1000) } };
  }

  gate(message: string, reply: ParsedReply): GateResult {
    if (this.custom) {
      const found = customFlags(this.custom, message);
      if (found.length && !/^REFER/.test(reply.action)) return { action: "REFER_NOW", reason: "Red flag in the message; model reply replaced.", red_flags: found, reply: this.custom.fallback, overridden: true };
      return { action: reply.action, reason: null, red_flags: found, reply: reply.body, overridden: false };
    }
    const flags = detectRedFlags(message);
    if (flags.length && !/^REFER/.test(reply.action)) {
      const body = `Danger sign: ${flags.join(", ")}. Refer now. Keep the child warm, give the first dose per the manual, write a referral note.`;
      return { action: "REFER_NOW", reason: "Red flag in the message; model reply replaced.", red_flags: flags, reply: body, overridden: true };
    }
    if (reply.stm === "NONE" && reply.action !== "ASK_PERSON") {
      return { action: "ASK_PERSON", reason: "No guideline support; abstaining.", red_flags: [], reply: "Mi no sua. Askem nes in charge.", overridden: true };
    }
    return { action: reply.action, reason: null, red_flags: flags, reply: reply.body, overridden: false };
  }

  async speak(text: string, _lang: Lang): Promise<AudioBuffer> {
    const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    const ctx = new Ctx();
    const seconds = Math.min(6, 0.6 + text.length / 40);
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buf.getChannelData(0);
    // A soft two-tone "speech-like" placeholder so the play button does something audible.
    for (let i = 0; i < data.length; i++) {
      const t = i / ctx.sampleRate;
      const env = Math.min(1, t * 8) * Math.min(1, (seconds - t) * 8) * (0.5 + 0.5 * Math.sin(t * 9));
      data[i] = 0.08 * env * (Math.sin(2 * Math.PI * 220 * t) + 0.5 * Math.sin(2 * Math.PI * 330 * t));
    }
    await ctx.close();
    return buf;
  }

  status(): EngineStatus {
    return {
      models: this.manifest.models.map((m) => ({ id: m.id, loaded: true, size_mb: m.size_mb })),
      offline: typeof navigator !== "undefined" ? !navigator.onLine : false,
      memory_mb: 412,
      notes: ["Shim runtime: replies are canned examples, not generated. Set VITE_RUNTIME unset to use the real engine."]
    };
  }
}

export async function loadPack(manifest: Manifest, onProgress?: (p: LoadProgress) => void): Promise<Engine> {
  for (const m of manifest.models) {
    const steps = 4;
    for (let i = 1; i <= steps; i++) {
      onProgress?.({ model_id: m.id, loaded_mb: Math.round((m.size_mb * i) / steps), total_mb: m.size_mb, stage: i < steps ? "download" : "init" });
      await sleep(90);
    }
    onProgress?.({ model_id: m.id, loaded_mb: m.size_mb, total_mb: m.size_mb, stage: "ready" });
  }
  return new ShimEngine(manifest, customPack(manifest));
}
