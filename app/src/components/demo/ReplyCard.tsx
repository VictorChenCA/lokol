import { useState } from "react";
import type { Action, Chunk, Lang } from "../../types";
import { ACTION_META, type Task } from "./copy";
import { ActionGlyph, IconBook, IconChevron, IconCopy, IconPlay, IconSave, IconShield, IconStop } from "./icons";
import { NoteRecord } from "./NoteRecord";

export interface UserMsg {
  id: number;
  role: "user";
  text: string;
  lang: Lang;
  via?: "voice" | "text";
}

export interface BotMsg {
  id: number;
  role: "bot";
  lang: Lang;
  stage: "lookup" | "prefill" | "writing" | "done" | "error";
  prefill?: { processed: number; total: number };
  text: string;
  provisional?: Action | null;
  action?: Action;
  stm?: string | null;
  chunk?: Chunk | null;
  overridden?: boolean;
  reason?: string | null;
  redFlags?: string[];
  stats?: { ms?: number; tokens?: number; tps?: number };
  note?: Record<string, unknown> | null;
  task?: Task;
  error?: string;
  valid?: boolean;
}

export type Msg = UserMsg | BotMsg;

export interface VoiceState {
  id: number | null;
  phase: "idle" | "loading" | "speaking" | "playing";
  loaded_mb?: number;
  total_mb?: number;
}

export function UserBubble({ m }: { m: UserMsg }) {
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="max-w-[86%] whitespace-pre-wrap rounded-[20px] rounded-br-md bg-ink px-4 py-2.5 text-[15.5px] leading-snug text-white shadow-[0_6px_18px_-12px_rgba(16,44,60,0.6)]">{m.text}</div>
      <span className="pr-1 text-[11px] text-ink-3">{m.via === "voice" ? "Spoken, transcribed on this phone" : m.lang === "pis" ? "Pijin" : "English"}</span>
    </div>
  );
}

function WorkingSteps({ m }: { m: BotMsg }) {
  const steps: { key: BotMsg["stage"]; en: string }[] = [
    { key: "lookup", en: "Finding the section in the manual" },
    { key: "prefill", en: "Reading the guideline excerpt" },
    { key: "writing", en: "Writing the answer" }
  ];
  const order = ["lookup", "prefill", "writing", "done"];
  const at = order.indexOf(m.stage);
  const pct = m.prefill && m.prefill.total > 0 ? Math.min(100, Math.round((m.prefill.processed / m.prefill.total) * 100)) : null;
  return (
    <ol className="space-y-2" aria-live="polite">
      {steps.map((s, i) => {
        const state = i < at ? "done" : i === at ? "now" : "next";
        return (
          <li key={s.key} className={`flex items-center gap-2.5 text-[14px] ${state === "next" ? "text-ink-3/70" : "text-ink"}`}>
            <span
              className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border ${
                state === "done" ? "border-palm bg-palm text-white" : state === "now" ? "border-reef" : "border-line"
              }`}
              aria-hidden
            >
              {state === "done" ? (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round"><path d="M5 12.5l4.2 4.2L19 7" /></svg>
              ) : state === "now" ? (
                <span className="h-2 w-2 animate-pulse rounded-full bg-reef" />
              ) : null}
            </span>
            <span className="font-medium">{s.en}</span>
            {s.key === "prefill" && state === "now" && pct !== null && <span className="ml-auto tabular-nums text-ink-3">{pct}%</span>}
          </li>
        );
      })}
    </ol>
  );
}

function Citation({ chunk, stm }: { chunk: Chunk; stm: string }) {
  const [open, setOpen] = useState(false);
  const pages = chunk.page ? `page ${chunk.page}` : "";
  const expandable = !!chunk.text;
  return (
    <div className="rounded-xl border border-line-2 bg-sand">
      <button
        type="button"
        onClick={() => expandable && setOpen((v) => !v)}
        aria-expanded={expandable ? open : undefined}
        disabled={!expandable}
        className="flex w-full items-start gap-2.5 rounded-xl px-3 py-2.5 text-left"
      >
        <IconBook size={18} className="mt-0.5 shrink-0 text-[#9A6A12]" />
        <span className="min-w-0 flex-1">
          <span className="block text-[12px] text-ink-3">Standard Treatment Manual for Children 2017</span>
          <span className="block font-display text-[15px] font-semibold capitalize leading-tight text-ink">
            {stm.toLowerCase()}
            <span className="font-sans text-[13px] font-normal normal-case text-ink-2">{pages ? `, ${pages}` : ""}</span>
          </span>
          {chunk.subsection && <span className="mt-0.5 block truncate text-[12.5px] text-ink-2">{chunk.subsection}</span>}
        </span>
        {expandable && <IconChevron size={18} className={`mt-1 shrink-0 text-ink-3 transition-transform ${open ? "rotate-180" : ""}`} />}
      </button>
      {open && (
        <blockquote className="mx-3 mb-3 max-h-64 overflow-y-auto border-l-2 border-frangipani pl-3 text-[13.5px] leading-relaxed text-ink-2">
          {chunk.text.replace(/\s+/g, " ").trim()}
        </blockquote>
      )}
    </div>
  );
}

export function ReplyCard({
  m,
  voice,
  onPlay,
  onStop,
  onCopy,
  onSave,
  copiedId,
  savedIds
}: {
  m: BotMsg;
  voice: VoiceState;
  onPlay: (m: BotMsg) => void;
  onStop: () => void;
  onCopy: (m: BotMsg) => void;
  onSave: (m: BotMsg) => void;
  copiedId: number | null;
  savedIds: Set<number>;
}) {
  if (m.stage === "error") {
    return (
      <div className="max-w-[94%] rounded-2xl border border-hibiscus/30 bg-white p-4 text-[14px]">
        <p className="font-medium text-hibiscus">The model stopped before it answered.</p>
        <p className="mt-1 text-ink-2">{m.error}</p>
        <p className="mt-2 text-ink-3">Send the message again. If it keeps failing, reload the page; the models stay cached.</p>
      </div>
    );
  }
  if (m.stage !== "done") {
    const meta = m.provisional ? ACTION_META[m.provisional] : null;
    return (
      <div className="w-full max-w-[94%] overflow-hidden rounded-2xl border border-line-2 bg-white shadow-card">
        {meta && (
          <div className={`flex items-center gap-2 px-4 py-2 text-[13px] font-semibold ${meta.soft}`}>
            <ActionGlyph glyph={meta.glyph} size={16} /> {meta.en}
            {m.lang === "pis" && <span className="font-normal opacity-80">{meta.pis}</span>}
          </div>
        )}
        <div className="p-4">
          {m.stage === "writing" && m.text ? (
            <p className="whitespace-pre-wrap text-[15.5px] leading-relaxed text-ink">
              {m.text}
              <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-reef" aria-hidden />
            </p>
          ) : (
            <WorkingSteps m={m} />
          )}
        </div>
      </div>
    );
  }

  const action = m.action ?? "ASK_PERSON";
  const meta = ACTION_META[action];
  const isNote = !!m.note;
  const showCitation = !!m.chunk && !!m.stm && m.stm !== "NONE";
  const thisVoice = voice.id === m.id ? voice.phase : "idle";
  const secs = m.stats?.ms !== undefined ? (m.stats.ms / 1000).toFixed(1) : null;

  return (
    <article className={`w-full max-w-[94%] overflow-hidden rounded-2xl bg-white shadow-card ring-1 ${meta.ring}`} aria-label={`${meta.en}. ${m.text}`}>
      <header className={`${meta.band} ${meta.ink} px-4 pb-3 pt-3.5`}>
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/20">
            <ActionGlyph glyph={meta.glyph} size={20} />
          </span>
          <div className="min-w-0">
            <p className="font-display text-[21px] font-bold leading-tight tracking-tight">{meta.en}</p>
            {m.lang === "pis" && <p className="text-[14px] leading-snug opacity-90">{meta.pis}</p>}
          </div>
        </div>
        {(m.overridden || (m.redFlags && m.redFlags.length > 0)) && m.reason && (
          <p className="mt-2.5 flex items-start gap-1.5 rounded-lg bg-black/10 px-2.5 py-1.5 text-[12.5px] leading-snug">
            <IconShield size={14} className="mt-[2px] shrink-0" />
            <span>
              {m.overridden ? "Safety gate changed the model's answer: " : "Safety gate agrees: "}
              {m.reason.replace(/^red flag( confirmed by model)?:\s*/i, "danger sign, ")}
            </span>
          </p>
        )}
      </header>

      <div className="space-y-3 px-4 py-3.5">
        {isNote ? (
          <NoteRecord note={m.note!} />
        ) : (
          <p className="whitespace-pre-wrap text-[16px] leading-relaxed text-ink">{m.text}</p>
        )}

        {showCitation ? (
          <Citation chunk={m.chunk!} stm={m.stm!} />
        ) : action === "ASK_PERSON" ? (
          <p className="rounded-xl bg-slate-tint px-3 py-2 text-[13px] leading-snug text-ink-2">
            No section of the children's manual covers this, so the safe answer is to ask a person.
          </p>
        ) : null}
      </div>

      <footer className="flex flex-wrap items-center gap-2 border-t border-line-2 px-3 py-2.5">
        {!isNote && (
          <button
            type="button"
            onClick={() => (thisVoice === "playing" ? onStop() : onPlay(m))}
            disabled={voice.phase !== "idle" && voice.id !== m.id}
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-ink px-3.5 text-[13.5px] font-medium text-white transition-colors hover:bg-ink-2 disabled:opacity-40"
          >
            {thisVoice === "playing" ? <IconStop size={14} /> : <IconPlay size={14} />}
            {thisVoice === "loading"
              ? `Loading voice${voice.total_mb ? ` ${voice.loaded_mb ?? 0}/${voice.total_mb} MB` : ""}`
              : thisVoice === "speaking"
                ? "Making voice"
                : thisVoice === "playing"
                  ? "Stop"
                  : "Play voice"}
          </button>
        )}
        {!isNote && (
          <button
            type="button"
            onClick={() => onCopy(m)}
            className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[13.5px] font-medium transition-colors ${
              m.task === "followup" ? "border-reef bg-reef-tint text-reef-deep hover:bg-reef-pale" : "border-line bg-white text-ink hover:bg-sand"
            }`}
          >
            <IconCopy size={14} />
            {copiedId === m.id ? "Copied" : "Copy as SMS"}
          </button>
        )}
        {isNote && (
          <button
            type="button"
            onClick={() => onSave(m)}
            disabled={savedIds.has(m.id)}
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-ink px-3.5 text-[13.5px] font-medium text-white hover:bg-ink-2 disabled:bg-palm disabled:opacity-100"
          >
            <IconSave size={14} />
            {savedIds.has(m.id) ? "Saved on this phone" : "Save note on this phone"}
          </button>
        )}
        {secs && (
          <span className="ml-auto text-[12px] tabular-nums text-ink-3">
            {secs} s{m.stats?.tps ? `, ${m.stats.tps} tok/s` : ""}
          </span>
        )}
      </footer>
    </article>
  );
}
