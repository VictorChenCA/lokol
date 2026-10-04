import type { EvalRow, EvalSlice } from "../../types";
import { BASE_COLOR, HEADLINE, TIER_NAME, TUNED_COLOR, fmtMetric, type Group, type MetricDef } from "./shared";

/** One metric as a dumbbell: base dot, tuned dot, the gap between them. */
function Dumbbell({ m, base, tuned }: { m: MetricDef; base?: number; tuned?: number }) {
  const notRun = m.key === "judge_faithfulness_0_3" && !base && !tuned;
  if (notRun) {
    base = undefined;
    tuned = undefined;
  }
  const has = (v?: number) => v !== undefined && v !== null && !Number.isNaN(v);
  const b = has(base) ? (base as number) / m.max : null;
  const t = has(tuned) ? (tuned as number) / m.max : null;
  const delta = b !== null && t !== null ? t - b : null;
  const up = delta !== null && delta >= 0;
  const lo = Math.min(b ?? t ?? 0, t ?? b ?? 0);
  const hi = Math.max(b ?? t ?? 0, t ?? b ?? 0);
  const pts = delta === null ? null : m.max === 1 ? Math.round(delta * 100) : Number((delta * m.max).toFixed(1));
  return (
    <li className="grid grid-cols-1 items-center gap-x-6 gap-y-2 border-t border-line-2 py-4 first:border-t-0 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_8.5rem]">
      <div className="min-w-0">
        <p className="text-[15px] font-semibold leading-snug text-ink" title={m.why}>
          {m.label}
        </p>
        <p className="text-[12.5px] leading-snug text-ink-3">{m.why}</p>
      </div>
      <div className="relative h-7" role="img" aria-label={`${m.label}: base ${fmtMetric(m, base)}, tuned ${fmtMetric(m, tuned)}`}>
        <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-line-2" />
        {[0.25, 0.5, 0.75].map((g) => (
          <div key={g} className="absolute top-1/2 h-2 w-px -translate-y-1/2 bg-line" style={{ left: `${g * 100}%` }} aria-hidden />
        ))}
        {delta !== null && (
          <div
            className="absolute top-1/2 h-[5px] -translate-y-1/2 rounded-full"
            style={{ left: `${lo * 100}%`, width: `${(hi - lo) * 100}%`, background: up ? "rgba(15,123,136,0.35)" : "rgba(195,47,73,0.35)" }}
          />
        )}
        {b !== null && (
          <span
            className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white"
            style={{ left: `${b * 100}%`, background: BASE_COLOR, boxShadow: "0 0 0 1px rgba(176,110,18,0.35)" }}
            title={`Base: ${fmtMetric(m, base)}`}
          />
        )}
        {t !== null && (
          <span
            className="absolute top-1/2 h-[18px] w-[18px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white"
            style={{ left: `${t * 100}%`, background: TUNED_COLOR, boxShadow: "0 0 0 1px rgba(15,123,136,0.45), 0 2px 8px -2px rgba(15,123,136,0.6)" }}
            title={`Tuned: ${fmtMetric(m, tuned)}`}
          />
        )}
      </div>
      <div className="flex items-baseline justify-start gap-2 sm:justify-end">
        {!notRun && (
          <>
            <span className="text-[13px] tabular-nums text-[#8A5A08]">{fmtMetric(m, base)}</span>
            <span className="text-ink-4" aria-hidden>
              to
            </span>
          </>
        )}
        <span className="font-display text-[26px] font-bold leading-none tabular-nums text-ink">{notRun ? <span className="text-[15px] font-semibold text-ink-3">judge not run</span> : fmtMetric(m, tuned)}</span>
        {pts !== null && (
          <span className={`ml-1 text-[12px] font-semibold tabular-nums ${up ? "text-reef-deep" : "text-hibiscus"}`}>
            {pts > 0 ? "+" : ""}
            {pts}
          </span>
        )}
      </div>
    </li>
  );
}

export function HeadlineMetrics({ group }: { group: Group }) {
  return (
    <ul className="divide-y-0">
      {HEADLINE.map((m) => (
        <Dumbbell key={m.key} m={m} base={group.base?.metrics[m.key] as number | undefined} tuned={group.tuned?.metrics[m.key] as number | undefined} />
      ))}
    </ul>
  );
}

/** Every tier at a glance: tuned value big, base value small, cell tinted by the gain. */
export function TierMatrix({ groups, selected, onSelect }: { groups: Group[]; selected: string; onSelect: (s: string) => void }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-white">
      <table className="w-full min-w-[640px] border-collapse text-left">
        <caption className="sr-only">Tuned against base for every model size</caption>
        <thead>
          <tr className="border-b border-line-2">
            <th scope="col" className="px-4 py-3 text-[12.5px] font-medium text-ink-3">
              Metric
            </th>
            {groups.map((g) => (
              <th key={g.size} scope="col" className="px-3 py-3">
                <button
                  type="button"
                  onClick={() => onSelect(g.size)}
                  aria-pressed={g.size === selected}
                  className={`rounded-lg px-2 py-1 text-left ${g.size === selected ? "bg-ink text-white" : "hover:bg-sand"}`}
                >
                  <span className="block font-display text-[16px] font-bold leading-tight">{g.size}</span>
                  <span className={`block text-[11.5px] ${g.size === selected ? "text-white/70" : "text-ink-3"}`}>{TIER_NAME[g.tier]}</span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {HEADLINE.map((m) => (
            <tr key={m.key} className="border-b border-line-2 last:border-b-0">
              <th scope="row" className="px-4 py-2.5 text-[13px] font-medium text-ink-2">
                {m.label}
              </th>
              {groups.map((g) => {
                const b = g.base?.metrics[m.key] as number | undefined;
                const t = g.tuned?.metrics[m.key] as number | undefined;
                const d = b !== undefined && t !== undefined ? (t - b) / m.max : 0;
                const bg = d > 0 ? `rgba(15,123,136,${Math.min(0.22, d * 0.3)})` : d < 0 ? `rgba(195,47,73,${Math.min(0.18, -d * 0.3)})` : "transparent";
                return (
                  <td key={g.size} className="px-3 py-2.5" style={{ background: bg }}>
                    <span className="font-display text-[17px] font-semibold tabular-nums text-ink">{fmtMetric(m, t)}</span>
                    <span className="ml-1.5 text-[11.5px] tabular-nums text-[#8A5A08]">{fmtMetric(m, b)}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const LANG_NAME: Record<string, string> = { pis: "Pijin", en: "English", mix: "Mixed" };
const SLICE_COLS: { key: keyof EvalSlice; label: string }[] = [
  { key: "format", label: "Format" },
  { key: "action_acc", label: "Right action" },
  { key: "stm_acc", label: "Right section" }
];

function MiniPair({ base, tuned }: { base?: number; tuned?: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-1.5 w-16 rounded-full bg-line-2" aria-hidden>
        {base !== undefined && <span className="absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ left: `${base * 100}%`, background: BASE_COLOR }} />}
        {tuned !== undefined && <span className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white" style={{ left: `${tuned * 100}%`, background: TUNED_COLOR }} />}
      </div>
      <span className="text-[13px] font-semibold tabular-nums text-ink">{tuned === undefined ? "n/a" : `${Math.round(tuned * 100)}%`}</span>
      <span className="text-[11.5px] tabular-nums text-[#8A5A08]">{base === undefined ? "" : `${Math.round(base * 100)}%`}</span>
    </div>
  );
}

export function SliceTable({ base, tuned, field, names }: { base?: EvalRow; tuned?: EvalRow; field: "per_lang" | "per_task"; names?: Record<string, string> }) {
  const keys = Array.from(new Set([...Object.keys(base?.[field] ?? {}), ...Object.keys(tuned?.[field] ?? {})]));
  if (!keys.length) return null;
  const nm = names ?? LANG_NAME;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[460px] text-left text-[13px]">
        <thead>
          <tr className="text-ink-3">
            <th className="py-2 pr-3 font-medium">{field === "per_lang" ? "Language" : "Task"}</th>
            <th className="py-2 pr-3 font-medium">n</th>
            {SLICE_COLS.map((c) => (
              <th key={c.key} className="py-2 pr-3 font-medium">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => (
            <tr key={k} className="border-t border-line-2">
              <th scope="row" className="py-2.5 pr-3 font-semibold text-ink">
                {nm[k] ?? k}
              </th>
              <td className="py-2.5 pr-3 tabular-nums text-ink-3">{tuned?.[field]?.[k]?.n ?? base?.[field]?.[k]?.n ?? ""}</td>
              {SLICE_COLS.map((c) => (
                <td key={c.key} className="py-2.5 pr-3">
                  <MiniPair base={base?.[field]?.[k]?.[c.key]} tuned={tuned?.[field]?.[k]?.[c.key]} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
