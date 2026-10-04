import { useState } from "react";
import type { EvalRow, EvalSample, EvalSampleOutput } from "../../types";
import { ActionBadge } from "../ui";
import { BASE_COLOR, TIER_NAME, TUNED_COLOR, tierOf } from "./shared";

const ACTIONS = ["ADVISE", "REFER_NOW", "REFER_NEXT_TRANSPORT", "ASK_PERSON"] as const;
type A = (typeof ACTIONS)[number];
const isAction = (a: unknown): a is A => typeof a === "string" && (ACTIONS as readonly string[]).includes(a);

/** tokens/s and resident memory for every model that reports them. */
export function SpeedPanel({ rows }: { rows: EvalRow[] }) {
  const list = rows.filter((r) => r.metrics.tokens_per_s || r.metrics.ram_mb);
  if (!list.length) return <p className="text-[14px] text-ink-3">No speed or memory numbers in results.json yet. eval.py fills them from llama-bench.</p>;
  const maxT = Math.max(...list.map((r) => r.metrics.tokens_per_s ?? 0), 1);
  const maxR = Math.max(...list.map((r) => r.metrics.ram_mb ?? 0), 1);
  return (
    <ul className="space-y-3.5">
      {list.map((r) => {
        const tier = tierOf(r, r.size);
        const ram = r.metrics.ram_mb ?? 0;
        const fit = ram ? (ram < 1000 ? "fits a 2 GB phone" : ram < 2000 ? "4 GB phone and up" : ram < 4500 ? "6 to 8 GB phone" : "laptop or clinic PC") : "";
        return (
          <li key={r.model + r.variant} className="grid grid-cols-2 gap-x-5 gap-y-2 border-t border-line-2 pt-3 first:border-t-0 first:pt-0">
            <div className="col-span-2 min-w-0">
              <p className="truncate text-[14px] font-semibold text-ink">{r.model}</p>
              <p className="text-[12px] text-ink-3">
                {r.variant === "tuned" ? "Tuned" : "Base"}, {TIER_NAME[tier].toLowerCase()}, {r.runtime}
              </p>
            </div>
            <div>
              <div className="flex items-baseline justify-between text-[12px] text-ink-3">
                <span>Speed</span>
                <span className="font-semibold tabular-nums text-ink">{r.metrics.tokens_per_s ? `${r.metrics.tokens_per_s} tokens/s` : "n/a"}</span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-line-2">
                <div className="h-full rounded-full" style={{ width: `${((r.metrics.tokens_per_s ?? 0) / maxT) * 100}%`, background: r.variant === "tuned" ? TUNED_COLOR : BASE_COLOR }} />
              </div>
            </div>
            <div>
              <div className="flex items-baseline justify-between text-[12px] text-ink-3">
                <span>Memory</span>
                <span className="font-semibold tabular-nums text-ink">{ram ? (ram >= 1024 ? `${(ram / 1024).toFixed(1)} GB` : `${Math.round(ram)} MB`) : "n/a"}</span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-line-2">
                <div className="h-full rounded-full bg-ink-3" style={{ width: `${(ram / maxR) * 100}%` }} />
              </div>
              {fit && <p className="mt-1 text-[11.5px] text-ink-3">{fit}</p>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function OutputCard({ o, gold }: { o?: EvalSampleOutput; gold: EvalSample["gold"] }) {
  const [open, setOpen] = useState(false);
  if (!o)
    return (
      <div className="grid min-h-[160px] place-items-center rounded-2xl border border-dashed border-line bg-white/60 p-5 text-center text-[13.5px] text-ink-3">
        The tuned reply appears here once pipeline/eval.py writes samples.
      </div>
    );
  const right = o.action === gold.action;
  const label = o.variant === "base" ? "Base model" : o.variant === "tuned" ? "Tuned for Lokol Health" : "Reference answer";
  const color = o.variant === "base" ? BASE_COLOR : o.variant === "tuned" ? TUNED_COLOR : "#2B4A5A";
  const long = o.text.length > 420;
  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-line-2 px-4 py-2.5" style={{ boxShadow: `inset 3px 0 0 ${color}` }}>
        <div className="min-w-0">
          <p className="text-[13px] font-semibold" style={{ color }}>
            {label}
          </p>
          <p className="truncate text-[12px] text-ink-3">{o.model}</p>
        </div>
        <span className={`badge shrink-0 ${o.format_ok ? "bg-palm-tint text-palm-deep" : "bg-hibiscus-tint text-hibiscus"}`}>
          {o.format_ok ? "Protocol OK" : "Protocol broken"}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
        {isAction(o.action) ? <ActionBadge action={o.action} /> : <span className="chip bg-slate-tint text-slate">No ACTION line</span>}
        {o.action && o.variant !== "reference" ? (
          <span className={`text-[12px] font-semibold ${right ? "text-palm-deep" : "text-hibiscus"}`}>{right ? "matches the reference" : "wrong action"}</span>
        ) : null}
      </div>
      <div className="relative px-4 pb-3 pt-2.5">
        <pre className={`whitespace-pre-wrap break-words font-sans text-[13.5px] leading-relaxed text-ink-2 ${!open && long ? "max-h-[220px] overflow-hidden" : ""}`}>{o.text}</pre>
        {!open && long && <div className="pointer-events-none absolute inset-x-0 bottom-3 h-16 bg-gradient-to-t from-white to-transparent" />}
      </div>
      {long && (
        <button type="button" className="mx-4 mb-3 self-start text-[12.5px] font-medium text-reef hover:underline" onClick={() => setOpen((v) => !v)}>
          {open ? "Show less" : "Show the whole reply"}
        </button>
      )}
    </div>
  );
}

function sampleTitle(s: EvalSample) {
  if (s.task === "abstain") return "Out of scope";
  if (s.task === "note") return "Visit note";
  if (s.task === "referral") return "Danger sign";
  if (s.task === "followup") return "Follow-up";
  return "Guidance";
}

export function Gallery({ samples, isSample, note, size }: { samples: EvalSample[]; isSample: boolean; note?: string; size?: string }) {
  const [i, setI] = useState(0);
  const s = samples[Math.min(i, samples.length - 1)];
  if (!s) return null;
  const pick = (v: EvalSampleOutput["variant"]) =>
    s.outputs.find((o) => o.variant === v && (!size || !o.size || o.size.toUpperCase() === size.toUpperCase())) ?? s.outputs.find((o) => o.variant === v);
  const base = pick("base");
  const tuned = pick("tuned") ?? pick("reference");
  return (
    <div>
      {isSample && note && <p className="mb-4 rounded-lg bg-frangipani-tint px-3 py-2 text-[13px] leading-relaxed text-frangipani-deep">{note}</p>}
      <div className="no-scrollbar flex gap-1 overflow-x-auto border-b border-line" role="tablist" aria-label="Examples">
        {samples.map((x, k) => (
          <button
            key={x.id}
            type="button"
            role="tab"
            aria-selected={k === i}
            onClick={() => setI(k)}
            className={`-mb-px shrink-0 border-b-2 px-3 pb-2.5 pt-1 text-left ${k === i ? "border-ink text-ink" : "border-transparent text-ink-3 hover:text-ink"}`}
          >
            <span className="block text-[14px] font-semibold leading-tight">{sampleTitle(x)}</span>
            <span className="block text-[11.5px]">{x.lang === "pis" ? "Pijin" : x.lang === "en" ? "English" : x.lang}</span>
          </button>
        ))}
      </div>
      <div className="mt-5" role="tabpanel">
        <div className="rounded-2xl bg-ink px-4 py-3.5 text-white sm:px-5">
          <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-white/80">
            <span className="rounded border border-white/15 bg-white/10 px-1.5 py-px">lang={s.lang === "en" ? "en" : "pis"}</span>
            {s.flags?.rdt && <span className="rounded border border-white/15 bg-white/10 px-1.5 py-px">rdt={s.flags.rdt}</span>}
            {s.flags?.act && <span className="rounded border border-white/15 bg-white/10 px-1.5 py-px">act={s.flags.act}</span>}
            {s.flags?.transport && <span className="rounded border border-white/15 bg-white/10 px-1.5 py-px">transport={s.flags.transport}</span>}
            <span className="rounded border border-white/15 bg-white/10 px-1.5 py-px">
              guideline: {s.guideline ? `${s.guideline.section}${s.guideline.page ? ` p${s.guideline.page}` : ""}` : "none"}
            </span>
          </div>
          <p className="mt-2.5 text-[16px] leading-snug">{s.message}</p>
          <p className="mt-2 text-[12px] text-white/60">
            Reference: {s.gold.action}, STM {s.gold.stm}
          </p>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <OutputCard o={base} gold={s.gold} />
          <OutputCard o={tuned} gold={s.gold} />
        </div>
      </div>
    </div>
  );
}
