import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { getModel, paramsLabel } from "../models";
import { mb } from "./ui";

/**
 * Model card: how a custom model was trained (public/train/runs.json) and how it scored on the
 * held-out test set (public/eval/results.json). Opened from the Think node, the inspector and Packs.
 */

export const useModelCard = create<{ id: string | null; open: (id: string) => void; close: () => void }>((set) => ({
  id: null,
  open: (id) => set({ id }),
  close: () => set({ id: null })
}));

type LossPoint = { step: number; loss: number };
interface Run {
  id: string;
  name: string;
  catalog_id?: string | null;
  backend?: string;
  where?: string;
  base_model?: string;
  status?: string;
  config?: { steps?: number; batch?: number; lr?: number; rank?: number; examples?: number; epochs?: number; max_seq?: number };
  steps_done?: number;
  steps_total?: number;
  elapsed_s?: number;
  loss?: LossPoint[];
  best?: { step?: number; loss?: number; val?: { format?: number; action_acc?: number } };
  trained_tokens?: number;
  cost_usd_est?: number;
}
interface Row {
  model: string;
  model_id?: string;
  size: string;
  variant: string;
  runtime: string;
  fewshot?: number;
  metrics: Record<string, number | undefined>;
}
interface Data {
  runs: Run[];
  rows: Row[];
  n: number;
  limits: string[];
}

let cache: Promise<Data> | null = null;
function loadData(): Promise<Data> {
  if (!cache) {
    const get = (u: string) => fetch(u).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    cache = Promise.all([get("/train/runs.json"), get("/eval/results.json")]).then(([t, e]) => ({
      runs: (t?.runs ?? []) as Run[],
      rows: [...((e?.rows ?? []) as Row[]), ...((e?.prompted_baselines ?? []) as Row[])],
      n: e?.test_set?.n ?? 300,
      limits: (e?.meta?.limitations ?? []) as string[]
    }));
  }
  return cache;
}

const pct = (x: number | undefined) => (typeof x === "number" ? `${Math.round(x * 100)}%` : "–");

function mins(s?: number) {
  if (!s) return "–";
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

function Sparkline({ points }: { points: LossPoint[] }) {
  if (points.length < 2) return null;
  const W = 260;
  const H = 56;
  const xs = points.map((p) => p.step);
  const ys = points.map((p) => p.loss);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const px = (v: number) => ((v - x0) / Math.max(1, x1 - x0)) * (W - 4) + 2;
  const py = (v: number) => H - 4 - ((v - y0) / Math.max(1e-6, y1 - y0)) * (H - 8);
  const d = points.map((p, i) => `${i ? "L" : "M"}${px(p.step).toFixed(1)},${py(p.loss).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-14 w-full max-w-[260px]" role="img" aria-label={`Training loss from ${ys[0].toFixed(2)} to ${ys[ys.length - 1].toFixed(2)}`}>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-ink-3">{k}</dt>
      <dd className="break-words text-[14px] font-semibold leading-snug text-ink">{v}</dd>
    </div>
  );
}

const METRICS: { key: string; label: string; system?: string }[] = [
  { key: "format_compliance", label: "Writes the format the app reads" },
  { key: "action_accuracy", label: "Picks the right action", system: "system_action_accuracy" },
  { key: "stm_accuracy", label: "Cites the right manual section" },
  { key: "red_flag_recall", label: "Catches danger signs", system: "system_red_flag_recall" },
  { key: "abstain_recall", label: "Says “ask a person” when unsure" }
];

export function ModelCardModal() {
  const id = useModelCard((s) => s.id);
  const close = useModelCard((s) => s.close);
  const [data, setData] = useState<Data | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    loadData().then((d) => alive && setData(d));
    const k = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", k);
    const t = setTimeout(() => panel.current?.focus(), 20);
    return () => {
      alive = false;
      window.removeEventListener("keydown", k);
      clearTimeout(t);
    };
  }, [id, close]);

  if (!id) return null;
  const m = getModel(id);
  const run = data?.runs.find((r) => r.catalog_id === id && r.status === "done");
  const tuned = data?.rows.find((r) => r.model_id === id) ?? data?.rows.find((r) => r.variant === "tuned" && r.size === m?.size_label);
  const size = tuned?.size ?? m?.size_label;
  const stock = data?.rows.find((r) => r.variant === "base" && r.size === size);
  const fewshot = data?.rows.find((r) => (r.variant === "fewshot" || typeof r.fewshot === "number") && r.size === size);
  const tuneWhere =
    run?.backend === "river" ? "River (hosted GPUs)" : run?.where ? run.where.replace(/^This Mac \(([^,)]+).*$/, "A MacBook ($1)") : m?.trainedBy === "river" ? "River (hosted GPUs)" : "A laptop (Apple silicon)";
  const baseName = (run?.base_model ?? "").split("/").pop()?.replace(/-(4bit|8bit|bf16)$/i, "") || "–";

  return (
    <div className="fixed inset-0 z-[120] grid place-items-center bg-ink/55 p-3 sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mc-title"
        className="max-h-[92vh] w-full max-w-[720px] overflow-y-auto rounded-2xl bg-paper text-ink shadow-lift outline-none"
      >
        <header className="sticky top-0 flex items-start gap-3 border-b border-line bg-paper/95 px-5 py-4 backdrop-blur">
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] font-medium text-reef-deep">Model card</p>
            <h2 id="mc-title" className="font-display text-[22px] font-bold leading-tight">
              {m?.name ?? id}
            </h2>
            <p className="mt-1 text-[13.5px] text-ink-3">
              {m?.trainedBy ? "Custom model, fine-tuned on the Solomon Islands Standard Treatment Manual for Children" : m?.variant === "base" ? "Stock model, not fine-tuned" : "Model"}
              {m ? `. ${m.size_label} parameters${m.active_b ? `, ${paramsLabel(m.active_b)} active` : ""}, ${m.quant}, ${mb(m.size_mb)} file, ${m.license}.` : ""}
            </p>
          </div>
          <button type="button" onClick={close} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-ink-3 hover:bg-ink/5 hover:text-ink" aria-label="Close model card">
            <svg viewBox="0 0 20 20" className="h-5 w-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
              <path d="M5 5l10 10M15 5L5 15" />
            </svg>
          </button>
        </header>

        <div className="space-y-6 px-5 py-5">
          {!data && <p className="text-[14px] text-ink-3">Loading training and evaluation results…</p>}

          {data && (
            <section aria-labelledby="mc-train">
              <h3 id="mc-train" className="font-display text-[17px] font-bold">
                Training
              </h3>
              {run ? (
                <div className="mt-3 grid gap-4 sm:grid-cols-[1fr_260px] sm:items-center">
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                    <Fact k="Base model" v={baseName} />
                    <Fact k="Trained on" v={tuneWhere} />
                    <Fact k="Method" v={`LoRA, rank ${run.config?.rank ?? "?"}`} />
                    <Fact k="Steps" v={`${run.steps_done ?? "?"}${run.steps_total && run.steps_total !== run.steps_done ? ` of ${run.steps_total}` : ""}`} />
                    <Fact k={run.config?.examples ? "Examples" : "Tokens trained"} v={run.config?.examples ? run.config.examples.toLocaleString() : run.trained_tokens ? run.trained_tokens.toLocaleString() : "–"} />
                    <Fact k="Time" v={mins(run.elapsed_s)} />
                    <Fact k="Learning rate" v={run.config?.lr ? String(run.config.lr) : "–"} />
                    <Fact k="Shipped checkpoint" v={run.best?.step ? `step ${run.best.step}` : "final"} />
                    <Fact k="Compute cost" v={run.cost_usd_est ? `about $${run.cost_usd_est.toFixed(2)}` : "none (own laptop)"} />
                  </dl>
                  <div className="rounded-xl border border-line bg-white p-3 text-reef">
                    <Sparkline points={run.loss ?? []} />
                    <p className="mt-1 text-[12px] text-ink-3">
                      Training loss {run.loss?.[0]?.loss.toFixed(2)} to {run.loss?.[run.loss.length - 1]?.loss.toFixed(2)}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="mt-2 text-[14px] text-ink-3">{m?.trainedBy ? "No training log for this model in this build." : "Stock weights from the model's publisher. Lokol did not fine-tune this one."}</p>
              )}
            </section>
          )}

          {data && tuned && stock && (
            <section aria-labelledby="mc-eval">
              <h3 id="mc-eval" className="font-display text-[17px] font-bold">
                Evaluation, {data.n} held-out cases
              </h3>
              <p className="mt-1 text-[13.5px] text-ink-3">Cases the model never saw in training, in English, Pijin and a mix. Same prompt for every column.</p>
              <div className="mt-3 overflow-x-auto rounded-xl border border-line bg-white">
                <table className="w-full min-w-[480px] text-[13.5px]">
                  <thead>
                    <tr className="border-b border-line-2 text-left text-[12px] text-ink-3">
                      <th className="px-3 py-2 font-medium">Check</th>
                      <th className="px-3 py-2 text-right font-medium">Stock {size}</th>
                      {fewshot && <th className="px-3 py-2 text-right font-medium">Stock + 2 examples</th>}
                      <th className="px-3 py-2 text-right font-medium text-ink">Custom model</th>
                      <th className="px-3 py-2 text-right font-medium">With safety check</th>
                    </tr>
                  </thead>
                  <tbody>
                    {METRICS.map((x) => (
                      <tr key={x.key} className="border-b border-line-2 last:border-0">
                        <td className="px-3 py-2">{x.label}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-ink-3">{pct(stock.metrics[x.key])}</td>
                        {fewshot && <td className="px-3 py-2 text-right tabular-nums text-ink-3">{pct(fewshot.metrics[x.key])}</td>}
                        <td className="px-3 py-2 text-right font-semibold tabular-nums">{pct(tuned.metrics[x.key])}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-ink-2">{x.system ? pct(tuned.metrics[x.system]) : "–"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-[13px] leading-relaxed text-ink-3">
                Why the stock model scores 0%: it is never shown the reply format (an action line, the manual section, then the reply), so the app cannot read any of its answers and every check counts them as wrong.
                {fewshot
                  ? ` The fairer baseline gives the same stock model two worked examples in the prompt: it copies the format ${pct(fewshot.metrics.format_compliance)} of the time and catches ${pct(fewshot.metrics.red_flag_recall)} of danger signs, against ${pct(tuned.metrics.format_compliance)} and ${pct(tuned.metrics.red_flag_recall)} after fine-tuning.`
                  : " A fairer baseline, the stock model with two worked examples in the prompt, has been measured for the 0.6B and 9B."}
                {typeof tuned.metrics.tokens_per_s === "number" ? ` Speed on the eval machine: ${tuned.metrics.tokens_per_s.toFixed(0)} tokens per second.` : ""}
              </p>
              {data.limits[0] && <p className="mt-2 text-[13px] leading-relaxed text-ink-3">Limits: {data.limits[0]}</p>}
            </section>
          )}
          {data && !(tuned && stock) && <p className="text-[14px] text-ink-3">No evaluation rows for this model yet.</p>}
        </div>
      </div>
    </div>
  );
}
