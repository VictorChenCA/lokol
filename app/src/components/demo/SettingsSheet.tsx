import { useEffect, useRef, type ReactNode } from "react";
import type { Choice, FieldSettings, VoiceIn } from "./settings";
import { Supplies } from "./parts";
import { LLM_SIZES } from "./useDemoEngine";
import { PIS_APPROX_NOTE, VOICE_IN_OPTIONS } from "./TalkPanel";
import { IconMic, IconPlay, IconStop } from "./icons";

export interface MicTest {
  phase: "idle" | "listening" | "hearing" | "transcribing" | "done" | "error";
  level: number;
  text?: string;
  error?: string;
}
export interface SpeakTest {
  phase: "idle" | "loading" | "playing" | "done" | "error";
  line?: string;
  detail?: string;
}

function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50 ${on ? "bg-reef" : "bg-line"}`}
    >
      <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-[left] ${on ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

function Seg<T extends string>({ value, options, onChange, label, disabled }: { value: T; options: { v: T; label: string; title?: string }[]; onChange: (v: T) => void; label: string; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap rounded-full border border-line bg-white p-0.5">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          role="radio"
          aria-checked={value === o.v}
          title={o.title}
          disabled={disabled}
          onClick={() => onChange(o.v)}
          className={`rounded-full px-3 py-1 text-[13px] font-medium transition-colors disabled:opacity-50 ${value === o.v ? "bg-ink text-white" : "text-ink-2 hover:bg-sand"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Section({ title, hint, right, children }: { title: string; hint?: string; right?: ReactNode; children?: ReactNode }) {
  return (
    <section className="border-t border-line-2 py-4 first:border-t-0 first:pt-1">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
          {hint && <p className="mt-0.5 text-[12.5px] leading-snug text-ink-3">{hint}</p>}
        </div>
        {right}
      </div>
      {children && <div className="mt-2.5">{children}</div>}
    </section>
  );
}

const LANG_CHOICES: { v: Choice; label: string }[] = [
  { v: "auto", label: "Same as the message" },
  { v: "pis", label: "Pijin" },
  { v: "en", label: "English" }
];

export function SettingsSheet({
  open,
  onClose,
  settings,
  onChange,
  busy,
  install,
  speakTest,
  onSpeakTest,
  micTest,
  onMicTest,
  devMuted
}: {
  open: boolean;
  onClose: () => void;
  settings: FieldSettings;
  onChange: (p: Partial<FieldSettings>) => void;
  busy: boolean;
  install: { canPrompt: boolean; installed: boolean; ios: boolean; prompt: () => void };
  speakTest: SpeakTest;
  onSpeakTest: () => void;
  micTest: MicTest;
  onMicTest: () => void;
  devMuted: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    panel.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;

  const micBusy = micTest.phase === "listening" || micTest.phase === "hearing" || micTest.phase === "transcribing";
  const pct = Math.max(3, Math.min(100, Math.round((Math.log10(Math.max(micTest.level, 1e-4)) + 4) * 30)));

  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label="Settings">
      <button type="button" aria-label="Close settings" className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]" onClick={onClose} />
      <div
        ref={panel}
        tabIndex={-1}
        className="relative max-h-[90vh] w-full max-w-[480px] overflow-y-auto rounded-t-3xl bg-paper px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-3 shadow-card outline-none sm:rounded-3xl"
      >
        <div className="sticky top-0 z-10 -mx-5 flex items-center justify-between bg-paper px-5 pb-2 pt-1">
          <h2 className="font-display text-[22px] font-bold">Settings</h2>
          <button type="button" onClick={onClose} className="rounded-full border border-line bg-white px-3.5 py-1.5 text-[13.5px] font-medium hover:bg-sand">
            Done
          </button>
        </div>
        <p className="mb-2 text-[12.5px] text-ink-3">Saved on this phone. Every stage runs on the device; switch off the ones this clinic does not need.</p>

        <Section title="Speech input" hint="Talk to Lokol instead of typing. Off hides the microphone and Talk." right={<Switch on={settings.speechIn} onChange={(v) => onChange({ speechIn: v })} label="Speech input" />}>
          {settings.speechIn && (
            <>
              <Seg<VoiceIn>
                label="Speech input language"
                value={settings.voiceIn}
                onChange={(v) => onChange({ voiceIn: v })}
                options={VOICE_IN_OPTIONS.map((o) => ({ v: o.v, label: o.v === "en" ? "English" : "Pijin (approximate)", title: o.sub }))}
              />
              <p className="mt-1.5 text-[12px] leading-snug text-ink-3">
                {settings.voiceIn === "en" ? "Moonshine tiny, 52 MB, downloaded once." : `Whisper base, 136 MB, downloaded once. ${PIS_APPROX_NOTE}`}
              </p>
            </>
          )}
        </Section>

        <Section title="Read replies aloud" hint="Speak each answer as soon as it is ready. Off keeps a play button on every reply." right={<Switch on={settings.readAloud} onChange={(v) => onChange({ readAloud: v })} label="Read replies aloud" />}>
          <p className="mb-1.5 text-[12.5px] font-medium text-ink-2">Voice</p>
          <Seg<Choice> label="Voice" value={settings.voice} onChange={(v) => onChange({ voice: v })} options={[{ v: "auto", label: "Follow the reply" }, { v: "pis", label: "Pijin" }, { v: "en", label: "English" }]} />
          <p className="mt-1.5 text-[12px] leading-snug text-ink-3">Pijin: MMS voice. English: Kokoro. Each voice downloads once, then works offline.</p>
          <p className="mb-1.5 mt-3 text-[12.5px] font-medium text-ink-2">Reply language</p>
          <Seg<Choice> label="Reply language" value={settings.replyLang} onChange={(v) => onChange({ replyLang: v })} options={LANG_CHOICES} />
        </Section>

        <Section title="Voice test" hint="Check the speaker and the microphone before a visit.">
          {devMuted && (
            <p className="mb-2 rounded-lg bg-frangipani-tint px-2.5 py-1.5 text-[12px] text-[#7A4E05]">Developer build: sound is muted. Add ?sound=on to the address to hear it.</p>
          )}
          <div className="grid gap-2">
            <div className="rounded-2xl border border-line bg-white p-3">
              <button
                type="button"
                onClick={onSpeakTest}
                disabled={busy || speakTest.phase === "loading"}
                className="inline-flex h-10 items-center gap-2 rounded-full bg-ink px-4 text-[14px] font-semibold text-white disabled:opacity-50"
              >
                {speakTest.phase === "playing" ? <IconStop size={14} /> : <IconPlay size={14} />}
                {speakTest.phase === "loading" ? "Loading the voice" : speakTest.phase === "playing" ? "Stop" : "Play a test sentence"}
              </button>
              <p className="mt-2 text-[12.5px] leading-snug text-ink-2" aria-live="polite">
                {speakTest.line ? `"${speakTest.line}"` : "Plays one English line, then one Pijin line."}
                {speakTest.detail && <span className={`block ${speakTest.phase === "error" ? "text-hibiscus" : "text-ink-3"}`}>{speakTest.detail}</span>}
              </p>
            </div>
            <div className="rounded-2xl border border-line bg-white p-3">
              <button
                type="button"
                onClick={onMicTest}
                disabled={busy || micTest.phase === "transcribing"}
                className={`inline-flex h-10 items-center gap-2 rounded-full px-4 text-[14px] font-semibold text-white disabled:opacity-50 ${micBusy ? "bg-hibiscus" : "bg-reef"}`}
              >
                {micBusy ? <IconStop size={14} /> : <IconMic size={16} />}
                {micTest.phase === "transcribing" ? "Writing it down" : micBusy ? "Stop" : "Test the microphone"}
              </button>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-line-2" aria-label="Microphone level">
                <div
                  className={`h-full rounded-full transition-[width] duration-75 ${micTest.phase === "hearing" ? "bg-palm" : "bg-ink-3/50"}`}
                  style={{ width: micTest.phase === "listening" || micTest.phase === "hearing" ? `${pct}%` : "0%" }}
                />
              </div>
              <p className="mt-2 text-[12.5px] leading-snug text-ink-2" aria-live="polite">
                {micTest.phase === "idle" && "Say a short sentence, then pause. The bar moves while it hears you."}
                {micTest.phase === "listening" && "Listening. Say a short sentence."}
                {micTest.phase === "hearing" && "Hearing you. Pause when you are done."}
                {micTest.phase === "transcribing" && "Transcribing on this phone."}
                {micTest.phase === "done" && (micTest.text ? <>It heard: <span className="font-semibold text-ink">"{micTest.text}"</span></> : "No words came through. Try again closer to the phone.")}
                {micTest.phase === "error" && <span className="text-hibiscus">{micTest.error}</span>}
              </p>
            </div>
          </div>
        </Section>

        <Section title="Model size" hint="The bigger model writes better answers but needs a phone with more memory.">
          <Seg
            label="Model size"
            value={settings.size}
            disabled={busy}
            onChange={(v) => onChange({ size: v })}
            options={LLM_SIZES.map((s) => ({ v: s.key, label: `${s.label}, ${s.detail.split(",")[0]}`, title: s.detail }))}
          />
          <p className="mt-1.5 text-[12px] text-ink-3">{LLM_SIZES.find((s) => s.key === settings.size)?.detail}. Changing it reloads the model.</p>
        </Section>

        <Section title="Clinic supplies" hint="What this clinic has today. Lokol follows the manual for what is in stock.">
          <Supplies flags={settings} onChange={(p) => onChange(p as Partial<FieldSettings>)} disabled={busy} />
        </Section>

        <Section
          title="Install app"
          hint={
            install.installed
              ? "Lokol Health is installed on this phone."
              : install.canPrompt
                ? "Adds Lokol Health to the home screen. It opens like an app and works with no signal."
                : install.ios
                  ? "In Safari, tap Share, then Add to Home Screen."
                  : "In Chrome, open the menu and choose Add to Home screen or Install app."
          }
          right={
            install.canPrompt && !install.installed ? (
              <button type="button" onClick={install.prompt} className="shrink-0 rounded-full bg-reef px-3.5 py-1.5 text-[13.5px] font-semibold text-white">
                Install
              </button>
            ) : undefined
          }
        />
      </div>
    </div>
  );
}
