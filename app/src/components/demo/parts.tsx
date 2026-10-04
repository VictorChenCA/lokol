import { useEffect, useRef } from "react";
import type { Flags } from "../../types";
import { FLAG_OPTIONS, ROLE_LABEL } from "./copy";
import { IconChip, IconDownload, IconMic, IconPlane, IconSend, IconSignal } from "./icons";
import type { LiveModel, Progress, RichStatus } from "./useDemoEngine";

/* ---------- header chips ---------- */

export function ConnectivityChip({ online }: { online: boolean }) {
  return online ? (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-2.5 py-1 text-[12px] font-medium text-ink-2" title="Nothing is sent: every model runs on this device">
      <IconSignal size={13} className="text-ink-3" />
      Signal, not needed
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-palm px-2.5 py-1 text-[12px] font-semibold text-white" title="No network. Lokol keeps working.">
      <IconPlane size={13} />
      Offline, airplane mode OK
    </span>
  );
}

export function ModelChip({ llm, shim, loading }: { llm?: LiveModel | null; shim: boolean; loading: boolean }) {
  if (shim)
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-sand px-2.5 py-1 text-[12px] font-medium text-ink-2 ring-1 ring-line" title="Canned replies for demos without model files (?runtime=shim)">
        <IconChip size={13} /> Canned replies, no model
      </span>
    );
  if (!llm)
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[12px] font-medium text-ink-3 ring-1 ring-line">
        <IconChip size={13} /> {loading ? "Loading model" : "No model"}
      </span>
    );
  const where = llm.source === "local" ? "on device, local file" : "on device";
  return llm.tuned ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-reef px-2.5 py-1 text-[12px] font-semibold text-white" title={`${llm.id} from ${llm.url}${llm.threads ? `, ${llm.threads} threads` : ""}`}>
      <IconChip size={13} /> {llm.label} · offline
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-frangipani-tint px-2.5 py-1 text-[12px] font-semibold text-[#7A4E05] ring-1 ring-frangipani/50" title={`The tuned Lokol GGUF is not reachable, so this is the untuned base model (${llm.url}). Answers will often fail the protocol and the safety gate will say "ask a person".`}>
      <IconChip size={13} /> {llm.label} · {where}
    </span>
  );
}

/* ---------- clinic supplies ---------- */

/** The three clinic-supply switches, each with a plain-words tooltip. */
export function Supplies({ flags, onChange, disabled }: { flags: Pick<Flags, "rdt" | "act" | "transport">; onChange: (f: Partial<Flags>) => void; disabled?: boolean }) {
  const on = { good: "bg-palm text-white", bad: "bg-hibiscus text-white", unknown: "bg-slate text-white" } as const;
  return (
    <div className="space-y-3">
      {FLAG_OPTIONS.map((f) => (
        <div key={f.key}>
          <p className="flex items-center gap-1.5 text-[13.5px] font-semibold text-ink" title={f.tip}>
            {f.label}
            <span className="grid h-4 w-4 place-items-center rounded-full border border-line text-[10px] font-bold text-ink-3" aria-hidden>?</span>
          </p>
          <p className="text-[12px] leading-snug text-ink-3">{f.tip}</p>
          <div role="radiogroup" aria-label={f.label} className="mt-1.5 inline-flex rounded-full border border-line bg-white p-0.5">
            {f.values.map((v) => {
              const sel = flags[f.key] === v.v;
              return (
                <button
                  key={v.v}
                  type="button"
                  role="radio"
                  aria-checked={sel}
                  disabled={disabled}
                  onClick={() => onChange({ [f.key]: v.v } as Partial<Flags>)}
                  className={`rounded-full px-3 py-1 text-[13px] font-medium transition-colors disabled:opacity-50 ${sel ? on[v.tone] : "text-ink-2 hover:bg-sand"}`}
                >
                  {v.en}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/** One-line summary of the supplies for the header ("Test kit in stock, Coartem out, boat: next"). */
export function suppliesSummary(flags: Pick<Flags, "rdt" | "act" | "transport">): string {
  const yn = (v: string) => (v === "yes" ? "in stock" : v === "no" ? "out" : "not sure");
  const t = flags.transport === "now" ? "now" : flags.transport === "none" ? "none" : "next boat";
  return `Test kit ${yn(flags.rdt)} · Coartem ${yn(flags.act)} · Transport ${t}`;
}

/* ---------- composer ---------- */

export function Composer({
  value,
  onChange,
  onSend,
  onMic,
  onTalk,
  recording,
  recSeconds,
  ready,
  busy,
  speechIn,
  talkOn
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onMic: () => void;
  onTalk: () => void;
  recording: boolean;
  recSeconds: number;
  ready: boolean;
  busy: boolean;
  speechIn: boolean;
  talkOn: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!value) {
      el.style.height = "48px";
      return;
    }
    el.style.height = "0px";
    el.style.height = `${Math.min(140, Math.max(48, el.scrollHeight))}px`;
  }, [value]);
  const typed = !!value.trim();
  const showVoice = speechIn && !typed && !recording;
  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSend();
      }}
    >
      <div className="relative min-w-0 flex-1">
        <textarea
          ref={ref}
          rows={1}
          value={recording ? "" : value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          disabled={!ready || recording || talkOn}
          placeholder={recording ? "" : !ready ? "Loading the pack" : "Type a case"}
          aria-label="Message"
          className="block w-full resize-none rounded-[24px] border border-line bg-white px-4 py-[12px] text-[16px] leading-snug text-ink placeholder:text-ink-3 focus:border-reef focus:outline-none focus:ring-2 focus:ring-reef/20 disabled:bg-white/70"
        />
        {recording && (
          <span className="pointer-events-none absolute inset-0 flex items-center gap-2 px-4 text-[15px] text-hibiscus">
            <span className="h-2 w-2 animate-pulse rounded-full bg-hibiscus" />
            Recording {Math.floor(recSeconds / 60)}:{String(recSeconds % 60).padStart(2, "0")}
            <span className="truncate text-ink-3">tap to stop</span>
          </span>
        )}
      </div>
      {speechIn && (typed ? null : (
        <button
          type="button"
          onClick={onMic}
          disabled={!ready || busy || talkOn}
          aria-pressed={recording}
          aria-label={recording ? "Stop recording and send" : "Record one voice message"}
          title={recording ? "Stop and send" : "Record one message, then Lokol answers out loud"}
          className={`relative grid h-12 w-12 shrink-0 place-items-center rounded-full transition-colors disabled:opacity-40 ${
            recording ? "bg-hibiscus text-white" : "border border-line bg-white text-ink hover:bg-sand"
          }`}
        >
          {recording && <span className="absolute inset-0 animate-ping rounded-full bg-hibiscus/40" aria-hidden />}
          {recording ? <span className="relative h-3.5 w-3.5 rounded-[3px] bg-white" /> : <IconMic size={21} className="relative" />}
        </button>
      ))}
      {showVoice ? (
        <button
          type="button"
          onClick={onTalk}
          disabled={!ready || (busy && !talkOn)}
          aria-pressed={talkOn}
          title="Hands-free: speak, pause, hear the answer, speak again"
          className={`inline-flex h-12 shrink-0 items-center gap-1.5 rounded-full px-4 text-[15px] font-semibold text-white shadow-[0_8px_20px_-12px_rgba(16,44,60,0.8)] transition-colors disabled:opacity-40 ${
            talkOn ? "bg-hibiscus" : "bg-reef hover:bg-reef-deep"
          }`}
        >
          <IconMic size={18} />
          {talkOn ? "Stop" : "Talk"}
        </button>
      ) : (
        !recording && (
          <button
            type="submit"
            disabled={!ready || busy || !typed}
            aria-label="Send"
            className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-reef text-white transition-colors hover:bg-reef-deep disabled:bg-line disabled:text-ink-3"
          >
            {busy ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : <IconSend size={19} />}
          </button>
        )
      )}
    </form>
  );
}

/* ---------- first-run download ---------- */

const ORDER = ["corpus", "llm", "tts_pis", "tts_en", "stt"];

export function LoadCard({ progress, error, onRetry, shim, sizes }: { progress: Record<string, Progress>; error: string | null; onRetry: () => void; shim: boolean; sizes: Record<string, number> }) {
  const rows = Object.entries(progress).sort((a, b) => ORDER.indexOf(a[0]) - ORDER.indexOf(b[0]));
  // prefer what is actually downloading (a fallback model can differ from the pack's first choice)
  const live = ["llm", "tts_pis"].map((k) => progress[k]?.total_mb || sizes[k] || 0);
  const totalMb = live.reduce((s, n) => s + n, 0);
  return (
    <section className="rounded-2xl border border-line bg-white p-4 shadow-card" aria-live="polite">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-reef-tint text-reef-deep">
          <IconDownload size={20} />
        </span>
        <div>
          <h2 className="font-display text-[18px] font-semibold leading-tight">{shim ? "Opening the demo pack" : "Setting up Lokol Health on this phone"}</h2>
          <p className="mt-0.5 text-[13.5px] leading-snug text-ink-2">
            {shim
              ? "Canned replies, no downloads."
              : `One download${totalMb ? ` of about ${Math.round(totalMb)} MB` : ""}, then it works with no signal.`}
          </p>
        </div>
      </div>
      <ul className="mt-4 space-y-3">
        {rows.length === 0 && !error && <li className="text-[13px] text-ink-3">Starting the on-device runtime</li>}
        {rows.map(([key, p]) => {
          const lbl = ROLE_LABEL[key] ?? { en: p.model_id, pis: "" };
          const pct = p.stage === "ready" ? 100 : p.pct ?? (p.total_mb ? Math.round((p.loaded_mb / Math.max(1, p.total_mb)) * 100) : 0);
          const failed = p.stage === "error";
          const state =
            p.stage === "ready" ? "Ready" : failed ? "Failed" : p.stage === "init" ? (pct >= 100 ? "Starting" : "Opening") : key === "corpus" ? "Loading" : `${p.loaded_mb} of ${p.total_mb} MB`;
          return (
            <li key={key}>
              <div className="flex items-baseline justify-between gap-2 text-[13.5px]">
                <span className="min-w-0 truncate">
                  <span className="font-semibold">{lbl.en}</span>
                  <span className="text-ink-3"> {key === "corpus" ? "STM Children 2017" : p.model_id}</span>
                </span>
                <span className={`shrink-0 tabular-nums ${failed ? "text-hibiscus" : p.stage === "ready" ? "text-[#24603A]" : "text-ink-3"}`}>{state}</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line-2">
                <div className={`h-full rounded-full transition-[width] duration-300 ${failed ? "bg-hibiscus" : p.stage === "ready" ? "bg-palm" : "bg-reef"}`} style={{ width: `${Math.max(3, pct)}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
      {error && (
        <div className="mt-4 rounded-xl bg-hibiscus-tint p-3 text-[13.5px]">
          <p className="font-semibold text-hibiscus">The model could not load.</p>
          <p className="mt-1 break-words text-ink-2">{error}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={onRetry} className="rounded-full bg-ink px-3.5 py-1.5 text-[13px] font-medium text-white">
              Try again
            </button>
            <a href="?runtime=shim" className="rounded-full border border-line bg-white px-3.5 py-1.5 text-[13px] font-medium">
              Open with canned replies
            </a>
          </div>
        </div>
      )}
    </section>
  );
}

/* ---------- footer ---------- */

export function RuntimeFooter({ status, last, shim, loadMs }: { status: RichStatus | null; last?: { ms?: number; tps?: number; tokens?: number }; shim: boolean; loadMs: number | null }) {
  const threads = status?.threads ?? status?.llm?.threads ?? null;
  const parts: string[] = [];
  if (shim) parts.push("Shim runtime, canned replies");
  else if (status) {
    parts.push(threads && threads > 1 ? `${threads} threads` : "1 thread");
    if (status.cross_origin_isolated === false) parts.push("not isolated");
  }
  if (last?.ms !== undefined) parts.push(`last reply ${(last.ms / 1000).toFixed(1)} s`);
  if (last?.tps) parts.push(`${last.tps} tok/s`);
  if (loadMs && !shim) parts.push(`loaded in ${(loadMs / 1000).toFixed(0)} s`);
  return <p className="text-center text-[11.5px] tabular-nums text-ink-3">{parts.join(", ")}</p>;
}
