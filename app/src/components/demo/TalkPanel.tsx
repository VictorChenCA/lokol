import { IconMic, IconStop } from "./icons";

export type VoiceIn = "en" | "pis-approx";
export type TalkPhase = "off" | "starting" | "listening" | "hearing" | "transcribing" | "thinking" | "speaking";

export const VOICE_IN_KEY = "lokol.voiceIn";

export const VOICE_IN_OPTIONS: { v: VoiceIn; en: string; sub: string }[] = [
  { v: "en", en: "English", sub: "Moonshine, 52 MB" },
  { v: "pis-approx", en: "Pijin, approximate", sub: "Whisper base, 136 MB" }
];

export const PIS_APPROX_NOTE =
  "Approximate for Pijin: Whisper writes Pijin speech in English-like spelling. The Lokol model was trained on Pijin text and the lookup expands Pijin and English terms, so check the words before you rely on them.";

/** "Voice input" setting: English (Moonshine) or Pijin, approximate (Whisper base). */
export function VoiceInPicker({ value, onChange, disabled }: { value: VoiceIn; onChange: (v: VoiceIn) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[12px] font-medium text-ink-3">Voice input</span>
      <div role="radiogroup" aria-label="Voice input" className="inline-flex rounded-full border border-line bg-white p-0.5">
        {VOICE_IN_OPTIONS.map((o) => (
          <button
            key={o.v}
            type="button"
            role="radio"
            aria-checked={value === o.v}
            disabled={disabled}
            onClick={() => onChange(o.v)}
            title={o.v === "pis-approx" ? PIS_APPROX_NOTE : "English voice notes, transcribed on this phone"}
            className={`rounded-full px-3 py-1 text-left leading-tight transition-colors disabled:opacity-50 ${value === o.v ? "bg-ink text-white" : "text-ink-2 hover:bg-sand"}`}
          >
            <span className="block text-[12.5px] font-semibold">{o.en}</span>
            <span className={`block text-[10.5px] ${value === o.v ? "text-white/70" : "text-ink-3"}`}>{o.sub}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

const PHASE: Record<Exclude<TalkPhase, "off">, { en: string; pis: string; tone: string }> = {
  starting: { en: "Opening the microphone", pis: "Openem maek", tone: "bg-sand text-ink-2" },
  listening: { en: "Listening", pis: "Mi herem yu", tone: "bg-palm-tint text-[#24603A]" },
  hearing: { en: "Hearing you", pis: "Toktok nao", tone: "bg-palm text-white" },
  transcribing: { en: "Writing down what you said", pis: "Raetem toktok", tone: "bg-reef-pale text-reef-deep" },
  thinking: { en: "Thinking", pis: "Tingting", tone: "bg-reef-pale text-reef-deep" },
  speaking: { en: "Speaking", pis: "Toktok bak", tone: "bg-[#EBE4F4] text-[#5B3F86]" }
};

/** Big hands-free toggle plus a clear state line (listening / thinking / speaking) and a stop button. */
export function TalkBar({
  phase,
  level,
  onToggle,
  onFinish,
  disabled,
  voiceIn,
  heard
}: {
  phase: TalkPhase;
  level: number;
  onToggle: () => void;
  onFinish: () => void;
  disabled?: boolean;
  voiceIn: VoiceIn;
  heard?: string | null;
}) {
  if (phase === "off") {
    return (
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        aria-pressed={false}
        className="mb-2 flex w-full items-center justify-center gap-2 rounded-full border border-line bg-white py-2.5 text-[14.5px] font-semibold text-ink transition-colors hover:border-ink-3 hover:bg-sand disabled:opacity-40"
      >
        <IconMic size={18} />
        Talk hands-free
        <span className="font-normal text-ink-3">{voiceIn === "pis-approx" ? "Pijin, approx." : "English"} in, voice out</span>
      </button>
    );
  }
  const p = PHASE[phase];
  const ear = phase === "listening" || phase === "hearing";
  // a log curve so quiet speech still moves the meter
  const pct = Math.max(4, Math.min(100, Math.round((Math.log10(Math.max(level, 1e-4)) + 4) * 30)));
  return (
    <div className="mb-2 rounded-2xl border border-line bg-white p-2.5" role="status" aria-live="polite">
      <div className="flex items-center gap-2.5">
        <span className={`relative grid h-11 w-11 shrink-0 place-items-center rounded-full ${p.tone}`}>
          {ear && <span className={`absolute inset-0 rounded-full ${phase === "hearing" ? "animate-ping bg-palm/40" : ""}`} aria-hidden />}
          {phase === "thinking" || phase === "transcribing" || phase === "starting" ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-current/30 border-t-current" />
          ) : (
            <IconMic size={19} className="relative" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold leading-tight">
            {p.en} <span className="font-normal text-ink-3">{p.pis}</span>
          </p>
          {ear ? (
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line-2" aria-hidden>
              <div className={`h-full rounded-full transition-[width] duration-75 ${phase === "hearing" ? "bg-palm" : "bg-ink-3/50"}`} style={{ width: `${pct}%` }} />
            </div>
          ) : (
            <p className="truncate text-[12.5px] text-ink-3">{heard ? `"${heard}"` : phase === "speaking" ? "Then I listen again" : ""}</p>
          )}
        </div>
        {phase === "hearing" && (
          <button type="button" onClick={onFinish} className="shrink-0 rounded-full border border-line px-3 py-1.5 text-[12.5px] font-medium hover:bg-sand">
            Done
          </button>
        )}
        <button
          type="button"
          onClick={onToggle}
          aria-label="Stop hands-free talk"
          className="grid h-10 shrink-0 grid-flow-col place-items-center gap-1.5 rounded-full bg-hibiscus px-3.5 text-[13px] font-semibold text-white"
        >
          <IconStop size={14} /> Stop
        </button>
      </div>
      {ear && <p className="mt-1.5 text-[11.5px] text-ink-3">Speak, then pause. Lokol answers out loud and listens again.</p>}
    </div>
  );
}
