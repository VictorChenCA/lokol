import type { Lang, Transport, YesNoUnknown } from "../../types";

/** Field app settings (gear sheet). Persisted per phone in localStorage; nothing leaves the device. */
export type VoiceIn = "en" | "pis-approx";
export type Choice = "auto" | Lang;

export interface FieldSettings {
  /** Speech to text on/off. Off hides the mic and Talk. */
  speechIn: boolean;
  voiceIn: VoiceIn;
  /** Text to speech: read each reply out loud as soon as it is ready. Off keeps a play button per reply. */
  readAloud: boolean;
  /** Which voice reads replies. "auto" follows the reply language. */
  voice: Choice;
  /** Reply language. "auto" answers in the language of the message. */
  replyLang: Choice;
  /** Language model size (same keys as LLM_SIZES / ?size). */
  size: "0.6b" | "1.7b";
  /** Clinic supplies the model is told about. */
  rdt: YesNoUnknown;
  act: YesNoUnknown;
  transport: Transport;
}

export const SETTINGS_KEY = "lokol.field.settings";
const LEGACY_VOICE_IN_KEY = "lokol.voiceIn";

export const DEFAULT_SETTINGS: FieldSettings = {
  speechIn: true,
  voiceIn: "en",
  readAloud: true,
  voice: "auto",
  replyLang: "auto",
  size: "0.6b",
  rdt: "yes",
  act: "yes",
  transport: "next_boat"
};

type Store = Pick<Storage, "getItem" | "setItem">;

function store(s?: Store | null): Store | null {
  if (s !== undefined) return s;
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);

/** Validates whatever is stored (old versions, hand edits) field by field, so a bad value never breaks the page. */
export function normalizeSettings(raw: unknown, legacyVoiceIn?: string | null): FieldSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  return {
    speechIn: bool(r.speechIn, d.speechIn),
    voiceIn: oneOf(r.voiceIn ?? legacyVoiceIn, ["en", "pis-approx"] as const, d.voiceIn),
    readAloud: bool(r.readAloud, d.readAloud),
    voice: oneOf(r.voice, ["auto", "pis", "en"] as const, d.voice),
    replyLang: oneOf(r.replyLang, ["auto", "pis", "en"] as const, d.replyLang),
    size: oneOf(r.size, ["0.6b", "1.7b"] as const, d.size),
    rdt: oneOf(r.rdt, ["yes", "no", "unknown"] as const, d.rdt),
    act: oneOf(r.act, ["yes", "no", "unknown"] as const, d.act),
    transport: oneOf(r.transport, ["now", "next_boat", "none"] as const, d.transport)
  };
}

export function loadSettings(s?: Store | null): FieldSettings {
  const st = store(s);
  if (!st) return { ...DEFAULT_SETTINGS };
  try {
    const text = st.getItem(SETTINGS_KEY);
    return normalizeSettings(text ? JSON.parse(text) : null, st.getItem(LEGACY_VOICE_IN_KEY));
  } catch {
    return normalizeSettings(null);
  }
}

export function saveSettings(v: FieldSettings, s?: Store | null): void {
  const st = store(s);
  try {
    st?.setItem(SETTINGS_KEY, JSON.stringify(normalizeSettings(v)));
  } catch {
    /* storage blocked: the settings last for this visit */
  }
}

// Words that are Pijin and not English. Two or more distinct hits means the message is Pijin.
const PIJIN = /\b(pikinini|bebi|blong|wanem|olsem|garem|nomoa|nogat|kaikai|tumas|disfala|olketa|savve|save|duim|tude|yia|manis|hem|mi|iu|nao|sapos|bae|wea|dei|sek-?sek|sitsit|lelebet|bodi|gud|tok|lukim|mekem|givim|kasem|haomas|hao)\b/gi;

/** Guesses the language of a typed or transcribed message: Solomon Islands Pijin or English. */
export function detectLang(text: string): Lang {
  const hits = new Set((text.match(PIJIN) ?? []).map((w) => w.toLowerCase()));
  return hits.size >= 2 ? "pis" : "en";
}

/** The language the reply should use for this message. */
export function replyLangFor(text: string, choice: Choice): Lang {
  return choice === "auto" ? detectLang(text) : choice;
}

/** The voice that reads a reply. */
export function voiceFor(replyLang: Lang, choice: Choice): Lang {
  return choice === "auto" ? replyLang : choice;
}
