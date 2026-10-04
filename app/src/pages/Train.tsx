import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import type { DatasetCard, TrainRuns } from "../types";
import { useJson } from "../components/train/data";
import { PipelineGraphic } from "../components/train/PipelineGraphic";
import { RunsSection } from "../components/train/Runs";
import { DatasetSection, NotCovered } from "../components/train/Dataset";
import { TrainYourOwn } from "../components/train/TrainYourOwn";

function Section({ id, title, lede, aside, children }: { id: string; title: string; pis?: string; lede?: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-24">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <h2 id={`${id}-h`} className="font-display text-d-sm font-bold sm:text-[30px]">
            {title}
          </h2>
          {lede && <p className="mt-1.5 max-w-[66ch] text-[15px] leading-relaxed text-ink-2">{lede}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Skeleton({ h = 280 }: { h?: number }) {
  return (
    <div className="card-flat relative overflow-hidden" style={{ height: h }} aria-busy="true" aria-label="Loading">
      <div className="absolute inset-y-0 left-0 w-1/3 animate-progress-indeterminate bg-gradient-to-r from-transparent via-sand to-transparent" />
    </div>
  );
}

function Missing({ what, cmd }: { what: string; cmd: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-white/70 p-6">
      <p className="font-display text-[18px] font-semibold">No {what} yet</p>
      <p className="mt-1 max-w-[60ch] text-[14px] text-ink-3">
        Run <code className="rounded bg-sand px-1 py-0.5 font-mono text-[12.5px] text-ink">{cmd}</code> from the repo root. It reads the training logs and writes the file this page loads.
      </p>
    </div>
  );
}

const JUMP = [
  ["runs", "Runs"],
  ["dataset", "Dataset"],
  ["gaps", "Gaps"],
  ["your-own", "Train your own"]
] as const;

export default function Train() {
  const runs = useJson<TrainRuns>(["/train/runs.json", "/train/runs.sample.json"], {
    validate: (j) => Array.isArray((j as TrainRuns)?.runs),
    pollMs: (d) => (d.runs.some((r) => r.status === "running") ? 20000 : null)
  });
  const card = useJson<DatasetCard>(["/train/dataset.json", "/train/dataset.sample.json"], {
    validate: (j) => !!(j as DatasetCard)?.splits
  });
  const live = runs.data?.runs.find((r) => r.status === "running" && !r.smoke);

  return (
    <div className="pb-24">
      <header className="page pt-10 sm:pt-14">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-[760px]">
            <p className="text-[14px] font-medium text-reef-deep">Train</p>
            <h1 className="mt-2 font-display text-d-lg font-bold">Every node is a model you can retrain</h1>
            <p className="lede mt-4">
              The language model in Lokol Health was trained for one job: apply the Solomon Islands child treatment manual, in Pijin or English, and say
              when to refer or ask a person. Here is the data it learned from, the runs that made it, and the commands to make your own.
            </p>
          </div>
          {live && (
            <a href="#runs" className="group flex items-center gap-3 rounded-2xl border border-reef/30 bg-white px-4 py-3 shadow-card hover:border-reef">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-reef opacity-50" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-reef" />
              </span>
              <span>
                <span className="block text-[13px] font-semibold text-ink">{live.name} is training</span>
                <span className="block text-[12px] tabular-nums text-ink-3">
                  step {live.steps_done} of {live.steps_total}, loss {live.loss.at(-1)?.loss.toFixed(2)}
                </span>
              </span>
            </a>
          )}
        </div>
        <nav aria-label="On this page" className="no-scrollbar mt-7 flex gap-1 overflow-x-auto">
          {JUMP.map(([id, l]) => (
            <a key={id} href={`#${id}`} className="whitespace-nowrap rounded-full border border-line bg-white px-3 py-1 text-[13px] font-medium text-ink-2 hover:border-ink-4 hover:text-ink">
              {l}
            </a>
          ))}
        </nav>
      </header>

      <div className="page mt-8">
        <PipelineGraphic card={card.data} />
      </div>

      <div className="page mt-16 space-y-20">
        <Section
          id="runs"
          title="Training runs"
          pis="Olketa ran"
          lede="Four sizes from one dataset. The 9B trains on River's GPUs; the phone tiers train one after another on an M1 Max laptop."
        >
          {runs.loading && !runs.data ? <Skeleton h={360} /> : runs.data ? <RunsSection data={runs.data} isSample={runs.isSample || !!runs.data.sample} /> : <Missing what="training runs" cmd=".venv/bin/python pipeline/collect_runs.py" />}
        </Section>

        <Section
          id="dataset"
          title="Dataset card"
          pis="Buk blong data"
          lede="What the model actually saw: the mix of languages, tasks and decisions, and six real rows with the protocol left visible."
        >
          {card.loading && !card.data ? <Skeleton h={520} /> : card.data ? <DatasetSection card={card.data} isSample={card.isSample || !!card.data.sample} /> : <Missing what="dataset card" cmd=".venv/bin/python pipeline/collect_runs.py" />}
        </Section>

        <div id="gaps" className="scroll-mt-24">
          {card.data ? <NotCovered card={card.data} /> : null}
        </div>

        <Section
          id="your-own"
          title="Train your own node"
          pis="Trenem nara wan"
          lede="Pick a base model, your data and where it trains. You get the exact commands; the result is a GGUF file any language-model node in Studio can load."
          aside={
            <Link to="/eval" className="btn-ghost btn-sm">
              See base against tuned
            </Link>
          }
        >
          <TrainYourOwn />
        </Section>
      </div>
    </div>
  );
}
