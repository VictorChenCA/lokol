import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { EvalResults, EvalSample } from "../types";
import { useJson } from "../components/train/data";
import { HeadlineMetrics, SliceTable, TierMatrix } from "../components/eval/Metrics";
import { Gallery, SpeedPanel } from "../components/eval/Gallery";
import { BASE_COLOR, HEADLINE, TIER_NAME, TUNED_COLOR, familyOf, fmtMetric, groupRows } from "../components/eval/shared";

const TASK_NAMES: Record<string, string> = { guidance: "Guidance", referral: "Referral", note: "Visit note", followup: "Follow-up", abstain: "Abstain" };

function Block({ id, title, lede, children }: { id: string; title: string; pis?: string; lede?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="min-w-0 scroll-mt-24">
      <h2 id={`${id}-h`} className="font-display text-d-sm font-bold sm:text-[28px]">
        {title}
      </h2>
      {lede && <p className="mt-1.5 max-w-[66ch] text-[15px] leading-relaxed text-ink-2">{lede}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

type SamplesDoc = { sample?: boolean; note?: string; samples: EvalSample[] };

export default function Eval() {
  const forceSample = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("sample");
  const res = useJson<EvalResults>(forceSample ? ["/eval/results.sample.json"] : ["/eval/results.json", "/eval/results.sample.json"], {
    validate: (j) => Array.isArray((j as EvalResults)?.rows) && (j as EvalResults).rows.length > 0
  });
  const sampleDoc = useJson<SamplesDoc>(["/eval/samples.sample.json"], { validate: (j) => Array.isArray((j as SamplesDoc)?.samples) });
  const data = res.data;
  const groups = useMemo(() => (data ? groupRows(data) : []), [data]);
  const [size, setSize] = useState<string | null>(null);
  const [table, setTable] = useState(false);
  useEffect(() => {
    if (!size && groups.length) setSize((groups.find((g) => g.base && g.tuned && !g.smoke) ?? groups[0]).size);
  }, [groups, size]);
  const g = groups.find((x) => x.size === size) ?? groups[0];

  const isSample = res.isSample || !!data?.sample;
  const smokeOnly = groups.length > 0 && groups.every((x) => x.smoke);
  const realSamples = data?.samples?.length ? data.samples : null;
  const gallery = realSamples ?? sampleDoc.data?.samples ?? [];

  if (res.loading && !data) {
    return (
      <div className="page pt-14" aria-busy="true">
        <div className="h-10 w-2/3 max-w-[520px] animate-pulse2 rounded-lg bg-line-2" />
        <div className="mt-4 h-5 w-1/2 max-w-[420px] animate-pulse2 rounded bg-line-2" />
        <div className="mt-10 h-[420px] animate-pulse2 rounded-2xl bg-white/70" />
      </div>
    );
  }
  if (!data || !g) {
    return (
      <div className="page-narrow pt-14">
        <h1 className="font-display text-d-md font-bold">No results yet</h1>
        <p className="lede mt-3">
          Run <code className="rounded bg-sand px-1.5 py-0.5 font-mono text-[14px]">pipeline/eval.py --report</code>. It scores each model on the held-out test set and writes
          app/public/eval/results.json, which this page reads.
        </p>
      </div>
    );
  }

  const fam = familyOf(g.base) || familyOf(g.tuned);
  const headlineGain = (() => {
    const m = HEADLINE[0];
    const b = g.base?.metrics[m.key] as number | undefined;
    const t = g.tuned?.metrics[m.key] as number | undefined;
    return b !== undefined && t !== undefined ? { m, b, t } : null;
  })();

  return (
    <div className="pb-24">
      <header className="page pt-10 sm:pt-14">
        <p className="text-[14px] font-medium text-reef-deep">Evaluate</p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-[780px]">
            <h1 className="font-display text-d-lg font-bold">Same prompt, same manual page. Only the weights differ.</h1>
            <p className="lede mt-4">
              Each Lokol node is scored against the stock model it was trained from, on {data.test_set.n.toLocaleString()} test cases
              {data.test_set.n >= 300 ? ", half of them presentations the model never saw in training" : ""}. A nurse needs it to catch danger signs, to say when it is not
              sure, and to cite the page it used.
            </p>
          </div>
          <dl className="grid grid-cols-3 gap-5 rounded-2xl border border-line bg-white px-5 py-4 text-[12px] text-ink-3">
            <div>
              <dt>Test cases</dt>
              <dd className="font-display text-[24px] font-bold tabular-nums text-ink">{data.test_set.n}</dd>
            </div>
            <div>
              <dt>Models</dt>
              <dd className="font-display text-[24px] font-bold tabular-nums text-ink">{data.rows.length}</dd>
            </div>
            <div>
              <dt>Scored</dt>
              <dd className="font-display text-[24px] font-bold tabular-nums text-ink">
                {new Date(data.generated_at).toLocaleDateString([], { month: "short", day: "numeric" })}
              </dd>
            </div>
          </dl>
        </div>

        {(isSample || smokeOnly) && (
          <div className="mt-6 flex gap-3 rounded-xl border border-frangipani/40 bg-frangipani-tint px-4 py-3 text-[14px] text-frangipani-deep" role="note">
            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-frangipani" aria-hidden />
            <p>
              {isSample
                ? "Sample numbers: placeholders with the real file structure. pipeline/eval.py replaces them with measured values."
                : `Smoke-test numbers: ${data.test_set.n} rows from ${data.test_set.path}, before the full training runs. The held-out test-set results replace them when the runs finish.`}
            </p>
          </div>
        )}
      </header>

      <div className="page mt-10 space-y-16">
        {/* headline */}
        <section aria-labelledby="headline-h" className="card overflow-hidden">
          <div className="grid lg:grid-cols-[300px_1fr]">
            <div className="border-b border-line-2 bg-sand/70 p-5 sm:p-6 lg:border-b-0 lg:border-r">
              <h2 id="headline-h" className="text-[13px] font-medium text-ink-3">
                Pick a model size
              </h2>
              <div className="mt-2 flex flex-wrap gap-2 lg:flex-col">
                {groups.map((x) => (
                  <button
                    key={x.size}
                    type="button"
                    aria-pressed={x.size === g.size}
                    onClick={() => setSize(x.size)}
                    className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                      x.size === g.size ? "border-ink bg-ink text-white" : "border-line bg-white text-ink hover:border-ink-4"
                    }`}
                  >
                    <span className="font-display text-[22px] font-bold leading-none tabular-nums">{x.size}</span>
                    <span className="min-w-0">
                      <span className="block text-[12.5px] font-semibold leading-tight">{TIER_NAME[x.tier]}</span>
                      <span className={`block text-[11.5px] leading-tight ${x.size === g.size ? "text-white/70" : "text-ink-3"}`}>
                        {x.size} parameters
                        {x.smoke ? ", smoke run" : ""}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
              <div className="mt-6 space-y-2.5 text-[13px]">
                <p className="flex items-center gap-2.5">
                  <span className="h-3.5 w-3.5 rounded-full border-2 border-white" style={{ background: BASE_COLOR, boxShadow: "0 0 0 1px rgba(176,110,18,.35)" }} aria-hidden />
                  <span>
                    <b className="font-semibold">Base</b> <span className="text-ink-3">{g.base?.model ?? `stock ${fam} ${g.size}`}</span>
                  </span>
                </p>
                <p className="flex items-center gap-2.5">
                  <span className="h-[18px] w-[18px] rounded-full border-[3px] border-white" style={{ background: TUNED_COLOR, boxShadow: "0 0 0 1px rgba(15,123,136,.45)" }} aria-hidden />
                  <span>
                    <b className="font-semibold">Tuned</b> <span className="text-ink-3">{g.tuned?.model ?? "not evaluated yet"}</span>
                  </span>
                </p>
                <p className="pt-1 text-[12px] text-ink-3">{g.tuned?.runtime ?? g.base?.runtime}</p>
              </div>
              {headlineGain && (
                <p className="mt-6 border-t border-line-2 pt-4 text-[13.5px] leading-relaxed text-ink-2">
                  Danger signs caught: <b className="text-ink">{fmtMetric(headlineGain.m, headlineGain.b)}</b> before tuning,{" "}
                  <b className="text-ink">{fmtMetric(headlineGain.m, headlineGain.t)}</b> after. The safety gate adds a rule-based referral on top of either.
                </p>
              )}
            </div>
            <div className="px-5 py-2 sm:px-7">
              <HeadlineMetrics group={g} />
            </div>
          </div>
        </section>

        {groups.length > 1 && (
          <Block id="tiers" title="Every model size at a glance" pis="Evri saes" lede="Large number: tuned. Small amber number: the base model it started from. Tap a size to see it above.">
            <TierMatrix groups={groups} selected={g.size} onSelect={setSize} />
          </Block>
        )}

        <div className="grid gap-10 lg:grid-cols-2">
          <Block id="lang" title="By language" pis="Long langguis" lede="Pijin, English and code-switched messages scored separately, so a gain in one cannot hide a loss in another.">
            {g.tuned?.per_lang || g.base?.per_lang ? (
              <div className="card-flat p-4 sm:p-5">
                <SliceTable base={g.base} tuned={g.tuned} field="per_lang" />
                {(g.tuned?.per_task || g.base?.per_task) && (
                  <div className="mt-5 border-t border-line-2 pt-3">
                    <SliceTable base={g.base} tuned={g.tuned} field="per_task" names={TASK_NAMES} />
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-line bg-white/70 p-5 text-[14px] text-ink-3">
                No per-language numbers for this size yet. pipeline/eval.py already computes them; the report adds them to each row as <code className="font-mono text-[12.5px]">per_lang</code>{" "}
                (see app/public/eval/README.md).
              </div>
            )}
          </Block>
          <Block id="speed" title="Speed and memory" pis="Hariap an memori" lede="Small models: llama.cpp on an M1 Max laptop during the eval; phones run slower. 9B: the hosted River API, network time included. Memory is the Q4 weight file.">
            <div className="card-flat p-4 sm:p-5">
              <SpeedPanel rows={data.rows} />
            </div>
          </Block>
        </div>

        <Block
          id="gallery"
          title="Same prompt, base against tuned"
          pis="Sem kwestin"
          lede="What the numbers look like as replies. The base model writes a friendly essay; the app and the safety gate need a decision, a citation and six short lines."
        >
          {gallery.length ? (
            <Gallery samples={gallery} isSample={!realSamples} note={sampleDoc.data?.note} size={g.size} />
          ) : (
            <p className="text-[14px] text-ink-3">No example replies in results.json yet.</p>
          )}
        </Block>

        <section aria-labelledby="all-h">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="all-h" className="font-display text-[20px] font-bold">
              All numbers
            </h2>
            <button type="button" className="btn-ghost btn-sm" aria-expanded={table} onClick={() => setTable((v) => !v)}>
              {table ? "Hide the table" : "Show the table"}
            </button>
          </div>
          {table && (
            <div className="mt-4 overflow-x-auto rounded-2xl border border-line bg-white">
              <table className="w-full text-left text-[13px]">
                <thead className="bg-sand text-ink-2">
                  <tr>
                    <th className="px-3 py-2 font-medium">Model</th>
                    <th className="px-3 py-2 font-medium">Variant</th>
                    {HEADLINE.map((m) => (
                      <th key={m.key} className="px-3 py-2 font-medium">
                        {m.label}
                      </th>
                    ))}
                    <th className="px-3 py-2 font-medium">Abstains only when it should</th>
                    <th className="px-3 py-2 font-medium">tokens/s</th>
                    <th className="px-3 py-2 font-medium">RAM</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.model + r.variant} className="border-t border-line-2">
                      <td className="px-3 py-2 font-medium">{r.model}</td>
                      <td className="px-3 py-2">
                        <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: r.variant === "tuned" ? TUNED_COLOR : BASE_COLOR }} aria-hidden />
                        {r.variant}
                      </td>
                      {HEADLINE.map((m) => (
                        <td key={m.key} className="px-3 py-2 tabular-nums">
                          {fmtMetric(m, r.metrics[m.key] as number)}
                        </td>
                      ))}
                      <td className="px-3 py-2 tabular-nums">{Math.round(r.metrics.abstain_precision * 100)}%</td>
                      <td className="px-3 py-2 tabular-nums">{r.metrics.tokens_per_s ?? "n/a"}</td>
                      <td className="px-3 py-2 tabular-nums">{r.metrics.ram_mb ? `${(r.metrics.ram_mb / 1024).toFixed(1)} GB` : "n/a"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data.notes?.length ? (
            <ul className="mt-4 max-w-[80ch] list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-ink-3">
              {data.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          ) : null}
          <p className="mt-3 text-[12.5px] text-ink-3">
            Generated {new Date(data.generated_at).toLocaleString()}. How the data and models were made:{" "}
            <Link to="/train" className="link">
              Train
            </Link>
            .
          </p>
        </section>
      </div>
    </div>
  );
}
