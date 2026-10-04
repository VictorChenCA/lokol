import { useState } from "react";
import type { RunStatus, TrainRun, TrainRuns } from "../../types";
import { LossChart } from "./LossChart";
import { ago, copyText, duration, int } from "./data";

const STATUS: Record<RunStatus, { label: string; pis: string; cls: string; dot: string }> = {
  running: { label: "Training now", pis: "Hem trenem nao", cls: "bg-reef-tint text-reef-deep", dot: "bg-reef animate-pulse2" },
  done: { label: "Finished", pis: "Finis", cls: "bg-palm-tint text-palm-deep", dot: "bg-palm" },
  queued: { label: "Queued", pis: "Weitim", cls: "bg-sand text-ink-2 border border-line-2", dot: "bg-ink-4" },
  stopped: { label: "Stopped", pis: "Stop", cls: "bg-frangipani-tint text-frangipani-deep", dot: "bg-frangipani" },
  failed: { label: "Failed", pis: "No wok", cls: "bg-hibiscus-tint text-hibiscus", dot: "bg-hibiscus" }
};

const TIER_NAME: Record<string, string> = { A: "Small phone", B: "Everyday phone", C: "Better phone", D: "Laptop or clinic PC" };

export function StatusPill({ status }: { status: RunStatus }) {
  const s = STATUS[status];
  return (
    <span className={`badge ${s.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} aria-hidden />
      {s.label}
    </span>
  );
}

function shortCkpt(id: string) {
  if (id.startsWith("river://")) {
    const parts = id.split("/");
    return parts.at(-1) ?? id;
  }
  return id.split("/").slice(-2).join("/");
}

function Progress({ run }: { run: TrainRun }) {
  const p = run.steps_total ? Math.min(1, run.steps_done / run.steps_total) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between text-[12.5px] text-ink-3">
        <span className="tabular-nums">
          Step <b className="font-semibold text-ink">{int(run.steps_done)}</b> of {int(run.steps_total)}
        </span>
        <span className="tabular-nums">{Math.round(p * 100)}%</span>
      </div>
      <div
        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line-2"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={run.steps_total}
        aria-valuenow={run.steps_done}
        aria-label={`${run.name} progress`}
      >
        <div className="h-full rounded-full bg-reef transition-[width] duration-700" style={{ width: `${p * 100}%` }} />
      </div>
    </div>
  );
}

function Fact({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-ink-3">{k}</dt>
      <dd className="mt-0.5 truncate font-display text-[19px] font-semibold tabular-nums tracking-tight text-ink" title={sub ?? v}>
        {v}
      </dd>
      {sub && <dd className="text-[11.5px] leading-snug text-ink-3">{sub}</dd>}
    </div>
  );
}

function Checkpoints({ run }: { run: TrainRun }) {
  const bestId = run.best?.inference;
  const [copied, setCopied] = useState<string | null>(null);
  const list = run.checkpoints.filter((c) => c.kind !== "training");
  if (!list.length) return <p className="text-[12.5px] text-ink-3">No checkpoint saved yet. {run.backend === "river" ? "River saves one every 30 steps." : "mlx saves adapters every 100 iterations."}</p>;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {list.map((c) => (
        <li key={c.id}>
          <button
            type="button"
            className={`group inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-1 font-mono text-[11.5px] text-ink-2 hover:border-ink-4 ${
              c.id === bestId ? "border-reef bg-reef-pale" : "border-line-2 bg-white"
            }`}
            title={`Copy ${c.id}`}
            onClick={async () => {
              if (await copyText(c.id)) {
                setCopied(c.id);
                window.setTimeout(() => setCopied(null), 1400);
              }
            }}
          >
            <span className="font-sans font-semibold text-ink">{c.step}</span>
            <span className="truncate">{shortCkpt(c.id)}</span>
            {c.id === bestId && <span className="font-sans text-[11px] font-semibold text-reef-deep">best</span>}
            <span className="font-sans text-[11px] text-reef">{copied === c.id ? "Copied" : "Copy"}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The live 9B run: big chart, live facts. */
export function FeaturedRun({ run }: { run: TrainRun }) {
  const first = run.loss[0]?.loss;
  const last = run.loss.at(-1)?.loss;
  const lastVal = run.val.at(-1);
  return (
    <article className="card overflow-hidden" aria-labelledby={`run-${run.id}`}>
      <div className="grid gap-0 lg:grid-cols-[1fr_340px]">
        <div className="p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={run.status} />
            <span className="badge bg-ink text-white">Tier {run.tier}: {TIER_NAME[run.tier ?? "D"]}</span>
            <span className="text-[12.5px] text-ink-3">updated {ago(run.updated_at)}</span>
          </div>
          <h3 id={`run-${run.id}`} className="mt-3 font-display text-d-sm font-bold">
            {run.name} <span className="font-normal text-ink-3">on River</span>
          </h3>
          <p className="mt-1 max-w-[62ch] text-[14px] text-ink-2">
            LoRA rank {run.config.rank} on {run.base_model}, {int(run.config.examples)} training rows, batch {run.config.batch},{" "}
            {run.config.epochs} epochs. Also callable online through River when a node's internet toggle is on.
          </p>
          <div className="mt-5">
            <LossChart loss={run.loss} val={run.val} total={run.steps_total} running={run.status === "running"} height={210} best={run.best?.step} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-[12.5px] text-ink-3">
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-4 rounded bg-reef" aria-hidden /> training loss (cross-entropy per token)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-0 border-l border-dashed border-frangipani" aria-hidden /> checkpoint + validation on 40 val prompts
            </span>
          </div>
        </div>
        <aside className="border-t border-line-2 bg-sand/60 p-5 sm:p-6 lg:border-l lg:border-t-0">
          <Progress run={run} />
          <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4">
            <Fact k="Loss" v={last !== undefined ? last.toFixed(2) : "n/a"} sub={first !== undefined ? `from ${first.toFixed(2)} at step 1` : undefined} />
            <Fact k="Elapsed" v={duration(run.elapsed_s)} sub={run.started_at ? `started ${new Date(run.started_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : undefined} />
            <Fact k={run.status === "running" ? "Time left, est." : "Status"} v={run.status === "running" ? duration(run.eta_s) : STATUS[run.status].label} sub={STATUS[run.status].pis} />
            <Fact k="Cost, est." v={run.cost_usd_est !== undefined ? `$${run.cost_usd_est.toFixed(2)}` : "n/a"} sub={run.trained_tokens ? `${(run.trained_tokens / 1e6).toFixed(1)}M tokens${run.status === "running" ? " so far" : ""}` : undefined} />
            {run.best?.val ? (
              <Fact
                k={`Best checkpoint, step ${run.best.step}`}
                v={`${Math.round((run.best.val.exact ?? 0) * 100)}%`}
                sub={`ACTION+STM both right on ${run.best.val.n ?? 40} val prompts; action ${Math.round((run.best.val.action_acc ?? 0) * 100)}%, format ${Math.round((run.best.val.format ?? 0) * 100)}%`}
              />
            ) : lastVal ? (
              <Fact
                k={`Val at step ${lastVal.step}`}
                v={`${Math.round((lastVal.exact ?? 0) * 100)}%`}
                sub={`ACTION+STM exact; format ${Math.round((lastVal.format ?? 0) * 100)}%`}
              />
            ) : null}
          </dl>
          <div className="mt-5">
            <h4 className="text-[12px] font-medium text-ink-3">Checkpoints</h4>
            <div className="mt-1.5">
              <Checkpoints run={run} />
            </div>
          </div>
          {run.cost_note && <p className="mt-4 text-[11.5px] leading-snug text-ink-3">{run.cost_note}</p>}
        </aside>
      </div>
    </article>
  );
}

export function RunCard({ run }: { run: TrainRun }) {
  const last = run.loss.at(-1)?.loss;
  return (
    <article className="card-flat flex flex-col p-5" aria-labelledby={`run-${run.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill status={run.status} />
        {run.tier && <span className="badge border border-line-2 bg-sand text-ink-2">Tier {run.tier}: {TIER_NAME[run.tier]}</span>}
      </div>
      <h3 id={`run-${run.id}`} className="mt-3 font-display text-[20px] font-bold leading-tight">
        {run.name}
      </h3>
      <p className="mt-0.5 text-[13px] text-ink-3">
        {run.base_model?.replace("mlx-community/", "").replace(/-MLX-bf16|-bf16/, "").replace("-", " ")} on {run.where.replace(/ \(.*\)/, "").replace("This Mac", "this Mac")}
        {run.config.layers ? `, LoRA on ${run.config.layers} layer${run.config.layers === 1 ? "" : "s"}` : ""}
      </p>
      <div className="mt-4 min-h-[120px]">
        {run.loss.length ? (
          <LossChart loss={run.loss} valLoss={run.val_loss} total={run.steps_total} running={run.status === "running"} height={130} compact color="#0F7B88" />
        ) : (
          <div className="grid h-[120px] place-items-center rounded-xl border border-dashed border-line bg-sand/50 text-center text-[13px] text-ink-3">
            {run.status === "queued" ? "Starts when the run ahead of it finishes" : "No loss logged"}
          </div>
        )}
      </div>
      <div className="mt-4">
        <Progress run={run} />
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-3">
        <Fact k="Loss" v={last !== undefined ? last.toFixed(2) : "n/a"} />
        <Fact k={run.status === "running" ? "Est. left" : "Elapsed"} v={run.status === "running" ? duration(run.eta_s) : run.status === "queued" ? "n/a" : duration(run.elapsed_s)} />
        <Fact k="Cost" v="$0" sub="local" />
      </dl>
      {run.note && <p className="mt-4 border-t border-line-2 pt-3 text-[12.5px] leading-relaxed text-ink-3">{run.note}</p>}
    </article>
  );
}

export function RunsSection({ data, isSample }: { data: TrainRuns; isSample: boolean }) {
  const main = data.runs.filter((r) => !r.smoke);
  const smoke = data.runs.filter((r) => r.smoke);
  const featured = main.find((r) => r.backend === "river") ?? main[0];
  const rank: Record<string, number> = { running: 0, done: 1, queued: 2, stopped: 3, failed: 4 };
  const rest = main.filter((r) => r !== featured).sort((a, b) => rank[a.status] - rank[b.status] || (a.tier ?? "Z").localeCompare(b.tier ?? "Z"));
  const live = main.some((r) => r.status === "running");
  return (
    <div>
      {isSample && (
        <p className="mb-4 rounded-lg bg-frangipani-tint px-3 py-2 text-[13px] text-frangipani-deep">
          Sample runs. Run <code className="font-mono">pipeline/collect_runs.py</code> to load the real logs.
        </p>
      )}
      {featured ? <FeaturedRun run={featured} /> : null}
      {rest.length > 0 && (
        <div className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {rest.map((r) => (
            <RunCard key={r.id} run={r} />
          ))}
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-[12.5px] text-ink-3">
        <span>
          {live ? "Live: this page re-reads the run logs every 20 seconds. " : ""}
          Snapshot from {new Date(data.generated_at).toLocaleString([], { hour: "numeric", minute: "2-digit", month: "short", day: "numeric" })}.
        </span>
        {smoke.length > 0 && (
          <details className="group">
            <summary className="cursor-pointer list-none rounded-md px-2 py-1 font-medium text-ink-2 hover:bg-sand">
              {smoke.length} smoke tests passed before the real runs
            </summary>
            <ul className="mt-2 space-y-1.5 rounded-xl border border-line-2 bg-white p-3">
              {smoke.map((r) => (
                <li key={r.id} className="flex flex-wrap items-baseline gap-x-2">
                  <StatusPill status={r.status} />
                  <span className="font-medium text-ink">{r.name}</span>
                  <span>
                    {r.steps_done}/{r.steps_total} steps, loss {r.loss[0]?.loss.toFixed(2)} to {r.loss.at(-1)?.loss.toFixed(2)}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}
