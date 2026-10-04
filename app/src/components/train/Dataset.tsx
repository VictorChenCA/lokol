import { useState } from "react";
import type { DatasetCard, DatasetSample } from "../../types";
import { ActionBadge } from "../ui";
import { ACTION_COLOR, LANG_LABEL, TASK_LABEL, int } from "./data";

const ACTION_LABEL: Record<string, string> = {
  ADVISE: "Advise",
  REFER_NOW: "Refer now",
  REFER_NEXT_TRANSPORT: "Refer on next boat",
  ASK_PERSON: "Ask a person"
};

function Composition({
  title,
  pis,
  counts,
  color,
  label,
  hint
}: {
  title: string;
  pis: string;
  counts: Record<string, number>;
  color: (k: string) => string;
  label: (k: string) => string;
  hint?: (k: string) => string | undefined;
}) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-[14px] font-semibold text-ink">
          {title} <span className="font-normal text-ink-3">{pis}</span>
        </h4>
        <span className="text-[12px] tabular-nums text-ink-3">{int(total)} rows</span>
      </div>
      <div className="mt-2 flex h-3 overflow-hidden rounded-full bg-line-2" role="img" aria-label={`${title}: ${entries.map(([k, v]) => `${label(k)} ${Math.round((v / total) * 100)}%`).join(", ")}`}>
        {entries.map(([k, v]) => (
          <div key={k} className="h-full border-r-2 border-white last:border-r-0" style={{ width: `${(v / total) * 100}%`, background: color(k) }} title={`${label(k)}: ${v}`} />
        ))}
      </div>
      <ul className="mt-2.5 grid grid-cols-2 gap-x-5 gap-y-1.5">
        {entries.map(([k, v]) => (
          <li key={k} className="flex min-w-0 items-baseline gap-1.5 text-[13px]" title={hint?.(k)}>
            <span className="h-2 w-2 shrink-0 translate-y-[-1px] rounded-sm" style={{ background: color(k) }} aria-hidden />
            <span className="truncate text-ink-2">{label(k)}</span>
            <span className="ml-auto font-semibold tabular-nums text-ink">{Math.round((v / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Flag({ k, v }: { k: string; v?: string }) {
  if (!v) return null;
  return (
    <span className="inline-flex items-center rounded border border-white/15 bg-white/10 px-1.5 py-px font-mono text-[11px] text-white/85">
      {k}={v}
    </span>
  );
}

function NoteRecord({ note }: { note: Record<string, unknown> }) {
  const drugs = Array.isArray(note.drugs) ? (note.drugs as Record<string, string>[]) : [];
  const rows: [string, string][] = [
    ["Age", note.age_months !== undefined ? `${note.age_months} months` : ""],
    ["Weight", note.weight_kg !== undefined ? `${note.weight_kg} kg` : ""],
    ["Symptoms", Array.isArray(note.symptoms) ? (note.symptoms as string[]).join(", ") : ""],
    ["Danger signs", Array.isArray(note.danger_signs) ? ((note.danger_signs as string[]).join(", ") || "none") : ""],
    ["Assessment", String(note.assessment_per_stm ?? "")],
    ["Follow-up", String(note.follow_up ?? "")],
    ["Referral", note.referral ? String(note.referral) : "none"]
  ];
  return (
    <div className="overflow-hidden rounded-xl border border-line-2 bg-white">
      <div className="flex items-center justify-between border-b border-line-2 bg-sand px-3 py-1.5 text-[12px] font-medium text-ink-2">
        <span>Visit record (JSON, saved on the phone)</span>
        <span className="font-mono text-[11px] text-ink-3">9 keys</span>
      </div>
      <dl className="divide-y divide-line-2 text-[13px]">
        {rows
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} className="grid grid-cols-[96px_1fr] gap-2 px-3 py-1.5">
              <dt className="text-ink-3">{k}</dt>
              <dd className="text-ink">{v}</dd>
            </div>
          ))}
        {drugs.length > 0 && (
          <div className="grid grid-cols-[96px_1fr] gap-2 px-3 py-1.5">
            <dt className="text-ink-3">Drugs</dt>
            <dd className="text-ink">
              {drugs.map((d, i) => (
                <div key={i}>
                  <b className="font-semibold">{d.name}</b> {d.dose}, {d.route}, {d.frequency}
                </div>
              ))}
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}

export function SampleThread({ s }: { s: DatasetSample }) {
  const t = TASK_LABEL[s.task];
  return (
    <div className="flex flex-col gap-3">
      {/* nurse turn */}
      <div className="max-w-[92%] self-end rounded-2xl rounded-br-md bg-ink px-4 py-3 text-white sm:max-w-[80%]">
        <div className="flex flex-wrap gap-1">
          <Flag k="lang" v={s.flags.lang} />
          <Flag k="rdt" v={s.flags.rdt} />
          <Flag k="act" v={s.flags.act} />
          <Flag k="transport" v={s.flags.transport} />
        </div>
        <div className="mt-2 rounded-lg bg-white/[0.07] px-2.5 py-1.5 text-[12px] leading-snug text-white/75">
          <span className="font-mono text-white/90">[guideline: {s.guideline ? `${s.guideline.section}${s.guideline.page ? ` p${s.guideline.page}` : ""}` : "none"}]</span>
          {s.guideline?.excerpt ? <span className="ml-1">{s.guideline.excerpt}</span> : null}
          {s.guideline_mode === "wrong" && <span className="ml-1 font-medium text-frangipani-bright">(deliberately wrong chunk: the model must notice)</span>}
          {s.guideline_mode === "none" && <span className="ml-1 font-medium text-frangipani-bright">(retrieval found nothing)</span>}
        </div>
        <p className="mt-2 whitespace-pre-wrap text-[15px] leading-snug">{s.message}</p>
      </div>
      {/* assistant turn */}
      <div className="max-w-[96%] self-start sm:max-w-[86%]">
        <div className="rounded-2xl rounded-bl-md border border-line-2 bg-white px-4 py-3 shadow-card">
          <div className="flex flex-wrap items-center gap-2">
            {s.action && (s.action in ACTION_COLOR) ? <ActionBadge action={s.action} /> : null}
            {s.stm && s.stm !== "NONE" ? (
              <span className="chip bg-frangipani-tint text-frangipani-deep">STM: {s.stm}</span>
            ) : (
              <span className="chip bg-slate-tint text-slate">STM: NONE</span>
            )}
          </div>
          <pre className="mt-2.5 whitespace-pre-wrap rounded-lg bg-sand px-2.5 py-1.5 font-mono text-[11.5px] leading-relaxed text-ink-2">
            {`ACTION: ${s.action}\nSTM: ${s.stm}\n---`}
          </pre>
          {s.note ? (
            <div className="mt-2.5">
              <NoteRecord note={s.note} />
            </div>
          ) : (
            <p className="mt-2.5 whitespace-pre-wrap text-[15px] leading-relaxed text-ink">{s.reply}</p>
          )}
        </div>
        <p className="mt-1.5 pl-1 text-[12px] text-ink-3">
          {t ? `${t.en} (${t.pis}). ` : ""}
          {s.red_flags.length ? `Danger sign in the message: ${s.red_flags.join(", ")}. ` : ""}
          Written by {s.teacher}, passed all checks. Row {s.id}.
        </p>
      </div>
    </div>
  );
}

function sampleTab(s: DatasetSample) {
  const lang = LANG_LABEL[s.lang]?.en ?? s.lang;
  if (s.task === "note") return { title: "Visit note", sub: lang };
  if (s.task === "abstain") return { title: s.lang === "pis" ? "Mi no sua" : "Not sure", sub: `${lang}, abstain` };
  if (s.red_flags.length) return { title: "Danger sign", sub: `${lang}, ${ACTION_LABEL[s.action ?? ""]?.toLowerCase() ?? "refer"}` };
  if (s.task === "referral") return { title: "Referral", sub: `${lang}, ${ACTION_LABEL[s.action ?? ""]?.toLowerCase() ?? ""}` };
  return { title: TASK_LABEL[s.task]?.en ?? s.task, sub: lang };
}

export function DatasetSection({ card, isSample }: { card: DatasetCard; isSample: boolean }) {
  const [sel, setSel] = useState(0);
  const s = card.samples[sel];
  const j = card.judge;
  return (
    <div>
      {isSample && (
        <p className="mb-4 rounded-lg bg-frangipani-tint px-3 py-2 text-[13px] text-frangipani-deep">
          Sample dataset card. Run <code className="font-mono">pipeline/collect_runs.py</code> to load the real counts.
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* left: what is in it */}
        <div className="card-flat p-5 sm:p-6">
          <dl className="grid grid-cols-3 gap-3 border-b border-line-2 pb-5">
            {(["train", "val", "test"] as const).map((k) => (
              <div key={k}>
                <dt className="text-[12px] capitalize text-ink-3">{k === "val" ? "Validation" : k === "train" ? "Train" : "Test"}</dt>
                <dd className="font-display text-[28px] font-bold tabular-nums tracking-tight">{int(card.splits[k])}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-5 space-y-6">
            <Composition
              title="Language"
              pis="Langguis"
              counts={card.counts.lang}
              color={(k) => LANG_LABEL[k]?.color ?? "#8A9EA8"}
              label={(k) => LANG_LABEL[k]?.en ?? k}
            />
            <Composition
              title="Task"
              pis="Wok"
              counts={card.counts.task}
              color={(k) => TASK_LABEL[k]?.color ?? "#8A9EA8"}
              label={(k) => TASK_LABEL[k]?.en ?? k}
              hint={(k) => TASK_LABEL[k]?.blurb}
            />
            <Composition
              title="Action"
              pis="Wanem fo duim"
              counts={card.counts.action}
              color={(k) => ACTION_COLOR[k] ?? "#8A9EA8"}
              label={(k) => ACTION_LABEL[k] ?? k}
            />
          </div>
          <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-line-2 pt-5 text-[13px]">
            <div>
              <dt className="text-ink-3">Rows with a danger sign</dt>
              <dd className="font-display text-[20px] font-semibold tabular-nums">{int(card.red_flag_rows)}</dd>
            </div>
            <div>
              <dt className="text-ink-3">STM sections covered</dt>
              <dd className="font-display text-[20px] font-semibold tabular-nums">
                {card.source.sections_covered ?? "n/a"} <span className="text-[14px] font-normal text-ink-3">of {card.source.sections}</span>
              </dd>
            </div>
            <div>
              <dt className="text-ink-3">Judge: faithful to the manual</dt>
              <dd className="font-display text-[20px] font-semibold tabular-nums">
                {j.faithfulness_mean?.toFixed(2) ?? "n/a"} <span className="text-[14px] font-normal text-ink-3">of 3, n={j.n_scored}</span>
              </dd>
            </div>
            <div>
              <dt className="text-ink-3">Judge: Pijin reads naturally</dt>
              <dd className="font-display text-[20px] font-semibold tabular-nums">
                {j.pijin_mean?.toFixed(2) ?? "n/a"} <span className="text-[14px] font-normal text-ink-3">of 3</span>
              </dd>
            </div>
          </dl>
          <p className="mt-4 text-[12.5px] leading-relaxed text-ink-3">
            All rows are synthetic: written by {card.teachers.map((t) => t.name).join(" and ")} on River ({int(card.pipeline.calls)} calls, about $
            {card.pipeline.teacher_cost_usd_est?.toFixed(2)}), checked by the validation rules and a dedupe pass ({int(card.pipeline.rejected_total)} of {int(card.pipeline.raw)} dropped). The judge is {j.model}, not a clinician.
          </p>
        </div>

        {/* right: sample rows */}
        <div className="card-flat flex min-w-0 flex-col overflow-hidden">
          <div className="border-b border-line-2 px-4 pt-4 sm:px-5">
            <div className="flex items-baseline justify-between gap-3">
              <h4 className="text-[14px] font-semibold">Six rows from the training set</h4>
              <span className="text-[12px] text-ink-3">exactly as the model sees them</span>
            </div>
            <div className="no-scrollbar -mx-1 mt-2 flex gap-1 overflow-x-auto pb-px" role="tablist" aria-label="Sample rows">
              {card.samples.map((x, i) => {
                const tb = sampleTab(x);
                return (
                  <button
                    key={x.id}
                    type="button"
                    role="tab"
                    id={`sample-tab-${i}`}
                    aria-selected={i === sel}
                    aria-controls="sample-panel"
                    onClick={() => setSel(i)}
                    className={`-mb-px shrink-0 border-b-2 px-2.5 pb-2.5 pt-1 text-left transition-colors ${
                      i === sel ? "border-ink text-ink" : "border-transparent text-ink-3 hover:text-ink"
                    }`}
                  >
                    <span className="block text-[13.5px] font-semibold leading-tight">{tb.title}</span>
                    <span className="block text-[11.5px] leading-tight">{tb.sub}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div id="sample-panel" role="tabpanel" aria-labelledby={`sample-tab-${sel}`} className="paper-grid flex-1 bg-paper/60 p-4 sm:p-5">
            {s ? <SampleThread s={s} /> : <p className="text-[14px] text-ink-3">No sample rows in dataset.json.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

/** "What this data does not cover": scored by the World Bank, so it gets its own full-width block. */
export function NotCovered({ card }: { card: DatasetCard }) {
  const items = card.not_covered;
  if (!items.length) return null;
  return (
    <section aria-labelledby="gaps-h" className="relative overflow-hidden rounded-[28px] border-2 border-ink bg-white">
      <div className="grid gap-0 lg:grid-cols-[340px_1fr]">
        <div className="bg-ink p-6 text-white sm:p-8">
          <p className="text-[13px] font-medium text-frangipani-bright">Read before you trust it</p>
          <h2 id="gaps-h" className="mt-2 font-display text-d-md font-bold leading-[1.02]">
            What this data does not cover
          </h2>
          <p className="mt-3 text-[15px] leading-relaxed text-white/75">
            Every row is synthetic. No real patients, no real nurse messages, and no native Pijin speaker has checked it yet.
            The safety gate, not the model, is the control.
          </p>
          <p className="mt-4 font-display text-[17px] italic text-white/90">"Mi no sua" is a feature: when the manual does not cover it, the model says so and names who to ask.</p>
        </div>
        <ol className="grid gap-px bg-line-2 sm:grid-cols-2">
          {items.map((it) => (
            <li key={it.title} className="bg-white p-5">
              <div className="flex items-baseline gap-2.5">
                <span className="h-2.5 w-2.5 shrink-0 translate-y-[1px] rounded-[3px] bg-hibiscus" aria-hidden />
                <h3 className="font-sans text-[15px] font-semibold leading-snug text-ink">{it.title}</h3>
              </div>
              <p className="mt-1.5 pl-5 text-[13.5px] leading-relaxed text-ink-2">{it.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
