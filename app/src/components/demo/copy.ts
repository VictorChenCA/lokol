import type { Action, Flags, Lang, Transport, YesNoUnknown } from "../../types";

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
  kind: { en: string; pis: string };
  lang: Lang;
  text: string;
  flags?: Partial<Flags>;
  task?: Task;
  tone: Action;
}

/** Sample prompts: real presentations from the STM for Children 2017 scope, plus one adult case for the fail-safe. */
export const SAMPLES: Sample[] = [
  { kind: { en: "Fever", pis: "Hot bodi" }, lang: "pis", text: "Pikinini 3 yia, hot bodi tu dei, no kaikai gud. No fit. Wanem mi duim?", flags: { rdt: "yes", act: "yes" }, tone: "ADVISE" },
  { kind: { en: "Danger sign", pis: "Denja saen" }, lang: "pis", text: "Bebi 8 manis, hot bodi an hem sek-sek tude moning, slip tumas nao.", flags: { transport: "next_boat" }, tone: "REFER_NOW" },
  { kind: { en: "No test kit", pis: "No RDT" }, lang: "en", text: "Girl 4 years, fever since yesterday, weight 15 kg. We have no malaria test kits left.", flags: { rdt: "no", act: "yes" }, tone: "ADVISE" },
  { kind: { en: "Diarrhoea", pis: "Sitsit wata" }, lang: "en", text: "Child 18 months, watery diarrhoea for 3 days, still drinking and playing. Weight 10 kg. What do I give?", tone: "ADVISE" },
  { kind: { en: "Visit note", pis: "Raetem not" }, lang: "en", text: "Visit note: boy 3 years, 13 kg, fever 2 days, not eating well, no danger signs, RDT positive. Gave Coartem 1 tablet and paracetamol. Review in 2 days.", task: "note", tone: "ADVISE" },
  { kind: { en: "SMS to mother", pis: "Mesej long mami" }, lang: "pis", text: "Raetem smol mesej long mami: pikinini mas dring ORS evri taem hem sitsit, an kam bak long klinik long 2 dei.", task: "followup", tone: "ADVISE" },
  { kind: { en: "Adult, out of scope", pis: "Bigman" }, lang: "en", text: "Adult man, 45, chest pain since this morning. What dose of aspirin should I give?", tone: "ASK_PERSON" }
];

export function guessTask(text: string): Task | undefined {
  if (/\b(visit note|note:|record|raetem not|raetem daon)\b/i.test(text)) return "note";
  if (/\b(sms|mesej|message|text (the|her|his)|follow.?up)\b/i.test(text)) return "followup";
  return undefined;
}

export const FLAG_OPTIONS: {
  key: "rdt" | "act" | "transport";
  en: string;
  pis: string;
  values: { v: YesNoUnknown | Transport; en: string; pis: string; tone: "good" | "bad" | "unknown" }[];
}[] = [
  {
    key: "rdt",
    en: "Malaria test kit",
    pis: "RDT",
    values: [
      { v: "yes", en: "in stock", pis: "garem", tone: "good" },
      { v: "no", en: "out", pis: "nomoa", tone: "bad" },
      { v: "unknown", en: "not sure", pis: "no sua", tone: "unknown" }
    ]
  },
  {
    key: "act",
    en: "Coartem",
    pis: "ACT",
    values: [
      { v: "yes", en: "in stock", pis: "garem", tone: "good" },
      { v: "no", en: "out", pis: "nomoa", tone: "bad" },
      { v: "unknown", en: "not sure", pis: "no sua", tone: "unknown" }
    ]
  },
  {
    key: "transport",
    en: "Transport",
    pis: "Bot",
    values: [
      { v: "next_boat", en: "next boat", pis: "nekis bot", tone: "unknown" },
      { v: "now", en: "now", pis: "nao", tone: "good" },
      { v: "none", en: "none", pis: "nomoa", tone: "bad" }
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
