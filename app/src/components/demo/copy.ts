import type { Action, Flags, Transport, YesNoUnknown } from "../../types";

/** Action meta for the reply card. English headline, Pijin subtitle (what the nurse reads first). */
export const ACTION_META: Record<
  Action,
  { en: string; pis: string; band: string; ink: string; soft: string; ring: string; glyph: "check" | "alert" | "boat" | "ask" }
> = {
  ADVISE: { en: "Advise", pis: "Givim advaes folom buk", band: "bg-palm", ink: "text-white", soft: "bg-palm-tint text-[#24603A]", ring: "ring-palm/30", glyph: "check" },
  REFER_NOW: { en: "Refer now", pis: "Sendem go long hospitol nao", band: "bg-hibiscus", ink: "text-white", soft: "bg-hibiscus-tint text-hibiscus", ring: "ring-hibiscus/30", glyph: "alert" },
  REFER_NEXT_TRANSPORT: { en: "Refer on the next boat", pis: "Sendem long nekis bot", band: "bg-frangipani", ink: "text-ink", soft: "bg-frangipani-tint text-[#7A4E05]", ring: "ring-frangipani/40", glyph: "boat" },
  ASK_PERSON: { en: "Not sure. Ask a person", pis: "Mi no sua. Askem nes in charge", band: "bg-slate", ink: "text-white", soft: "bg-slate-tint text-slate", ring: "ring-slate/30", glyph: "ask" }
};

export type Task = "guidance" | "referral" | "note" | "followup" | "abstain";

export interface Sample {
  label: string;
  text: string;
  flags?: Partial<Flags>;
  task?: Task;
  tone: Action;
}

/** Try-it prompts, all in English (typing Pijin still works; the reply follows the message's language). */
export const SAMPLES: Sample[] = [
  { label: "Fever, RDT positive", text: "Child 3 years, 14 kg, fever for two days, RDT positive, no danger signs. What do I give?", flags: { rdt: "yes", act: "yes" }, tone: "ADVISE" },
  { label: "Baby with fever and a fit", text: "Baby 8 months, fever and a fit this morning, now very sleepy.", flags: { transport: "next_boat" }, tone: "REFER_NOW" },
  { label: "Adult chest pain", text: "Adult man, 45, chest pain since this morning. What dose of aspirin should I give?", tone: "ASK_PERSON" }
];

export function guessTask(text: string): Task | undefined {
  if (/\b(visit note|note:|record|raetem not|raetem daon)\b/i.test(text)) return "note";
  if (/\b(sms|mesej|message|text (the|her|his)|follow.?up)\b/i.test(text)) return "followup";
  return undefined;
}

/** Clinic supplies the model is told about, in plain words. */
export const FLAG_OPTIONS: {
  key: "rdt" | "act" | "transport";
  label: string;
  tip: string;
  values: { v: YesNoUnknown | Transport; en: string; tone: "good" | "bad" | "unknown" }[];
}[] = [
  {
    key: "rdt",
    label: "Malaria test kit (RDT)",
    tip: "Malaria test kit (RDT) in stock? With no kits the manual says to treat fever as malaria where it is common.",
    values: [
      { v: "yes", en: "In stock", tone: "good" },
      { v: "no", en: "Out", tone: "bad" },
      { v: "unknown", en: "Not sure", tone: "unknown" }
    ]
  },
  {
    key: "act",
    label: "Malaria medicine (Coartem / ACT)",
    tip: "Malaria medicine (Coartem / ACT) in stock? If it is out, a positive test means referral.",
    values: [
      { v: "yes", en: "In stock", tone: "good" },
      { v: "no", en: "Out", tone: "bad" },
      { v: "unknown", en: "Not sure", tone: "unknown" }
    ]
  },
  {
    key: "transport",
    label: "Transport to hospital",
    tip: "Transport to hospital: now / next boat / none. Decides between refer now and refer on the next boat.",
    values: [
      { v: "now", en: "Now", tone: "good" },
      { v: "next_boat", en: "Next boat", tone: "unknown" },
      { v: "none", en: "None", tone: "bad" }
    ]
  }
];

export const ROLE_LABEL: Record<string, { en: string; pis: string }> = {
  corpus: { en: "Guideline index", pis: "Lukim buk" },
  llm: { en: "Language model", pis: "Brain" },
  stt: { en: "Speech in", pis: "Harem voes" },
  tts_pis: { en: "Pijin voice", pis: "Toktok" },
  tts_en: { en: "English voice", pis: "Toktok" },
  pack: { en: "Pack", pis: "Pack" }
};
