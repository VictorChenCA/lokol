import { IconMic, IconStop } from "./icons";

import type { VoiceIn } from "./settings";
export type { VoiceIn };
export type TalkPhase = "off" | "starting" | "listening" | "hearing" | "transcribing" | "thinking" | "speaking";

export const VOICE_IN_KEY = "lokol.voiceIn";

export const VOICE_IN_OPTIONS: { v: VoiceIn; en: string; sub: string }[] = [
  { v: "en", en: "English", sub: "Moonshine, 52 MB" },
  { v: "pis-approx", en: "Pijin, approximate", sub: "Whisper base, 136 MB" }
];

export const PIS_APPROX_NOTE =
  "Approximate for Pijin: Whisper writes Pijin speech in English-like spelling. The Lokol model was trained on Pijin text and the lookup expands Pijin and English terms, so check the words before you rely on them.";

const PHASE: Record<Exclude<TalkPhase, "off">, { en: string; tone: string }> = {
  starting: { en: "Opening the microphone", tone: "bg-sand text-ink-2" },
  listening: { en: "Listening", tone: "bg-palm-tint text-[#24603A]" },
  hearing: { en: "Hearing you", tone: "bg-palm text-white" },
  transcribing: { en: "Writing down what you said", tone: "bg-reef-pale text-reef-deep" },
  thinking: { en: "Thinking", tone: "bg-reef-pale text-reef-deep" },
  speaking: { en: "Speaking the answer", tone: "bg-[#EBE4F4] text-[#5B3F86]" }
};

/** Big hands-free toggle plus a clear state line (listening / thinking / speaking) and a stop button. */
export function TalkBar({
  phase,
  level,
  onToggle,
  onFinish,
  disabled,
  voiceIn,
  heard,
  speaks = true
}: {
  phase: TalkPhase;
  level: number;
  onToggle: () => void;
  onFinish: () => void;
  disabled?: boolean;
  voiceIn: VoiceIn;
  heard?: string | null;
  speaks?: boolean;
}) {
  if (phase === "off") return null;
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
            {p.en}
            <span className="ml-1.5 text-[12px] font-normal text-ink-3">{voiceIn === "pis-approx" ? "Pijin (approximate) in" : "English in"}</span>
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
      {ear && <p className="mt-1.5 text-[11.5px] text-ink-3">{speaks ? "Speak, then pause. Lokol answers out loud and listens again." : "Speak, then pause. Lokol answers on screen and listens again."}</p>}
    </div>
  );
}
