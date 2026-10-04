import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { PRESETS, SECTOR_COPY } from "../data/presets";
import { getModel } from "../models";
import { Badge, btnClass, mb } from "../components/ui";
import { SAMPLE_USER } from "../components/Profile";
import { useModelCard } from "../components/ModelCard";

/* Headline from public/eval/results.json (300 held-out cases); used until the file loads. */
type Score = { act: number; flag: number; fmt: number };
type Headline = { size: string; base: Score; tuned: Score; fewshot?: Score };
const FALLBACK: Headline = { size: "0.6B", base: { act: 0, flag: 0, fmt: 0 }, tuned: { act: 0.637, flag: 0.948, fmt: 0.98 } };

function useHeadline(): { h: Headline; n: number } {
  const [state, setState] = useState<{ h: Headline; n: number }>({ h: FALLBACK, n: 300 });
  useEffect(() => {
    let alive = true;
    fetch("/eval/results.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d?.rows) return;
        const all = [...d.rows, ...(d.prompted_baselines ?? [])];
        const pick = (variant: string) => all.find((r: any) => r.size === "0.6B" && r.variant === variant)?.metrics;
        const b = pick("base"), t = pick("tuned"), f = pick("fewshot");
        if (!b || !t) return;
        const score = (m: any): Score => ({ act: m.action_accuracy, flag: m.red_flag_recall, fmt: m.format_compliance });
        setState({ n: d.test_set?.n ?? 300, h: { size: "0.6B", base: score(b), tuned: score(t), fewshot: f ? score(f) : undefined } });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return state;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

function QuickAction({ to, title, body, icon }: { to: string; title: string; body: string; icon: ReactNode }) {
  return (
    <Link to={to} className="group flex items-start gap-3 rounded-2xl border border-line bg-white p-4 transition-colors hover:border-ink-4">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ink text-white">{icon}</span>
      <span className="min-w-0">
        <span className="flex items-center gap-1 font-display text-[17px] font-bold leading-tight text-ink">
          {title}
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-70" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
            <path d="M6 3.5 10.5 8 6 12.5" />
          </svg>
        </span>
        <span className="mt-1 block text-[13.5px] leading-snug text-ink-3">{body}</span>
      </span>
    </Link>
  );
}

const I = {
  phone: (
    <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <rect x="5.5" y="2" width="9" height="16" rx="2" />
      <path d="M8.5 15h3" strokeLinecap="round" />
    </svg>
  ),
  graph: (
    <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <circle cx="5" cy="6" r="2.2" />
      <circle cx="15" cy="6" r="2.2" />
      <circle cx="10" cy="15" r="2.2" />
      <path d="M6.3 7.8 9 13.2M13.7 7.8 11 13.2M7.2 6h5.6" />
    </svg>
  ),
  book: (
    <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden>
      <path d="M3 4.5c2.5-1 5-1 7 .5 2-1.5 4.5-1.5 7-.5v11c-2.5-1-5-1-7 .5-2-1.5-4.5-1.5-7-.5z" />
      <path d="M10 5v11" />
    </svg>
  ),
  mic: (
    <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
      <rect x="7.5" y="2.5" width="5" height="9" rx="2.5" />
      <path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5" />
    </svg>
  )
};

const HEALTH_SIZES = [
  { id: "lokol-health-qwen3-0.6b", label: "0.6B", where: "2 GB phones" },
  { id: "lokol-health-qwen3-1.7b", label: "1.7B", where: "4 GB phones" },
  { id: "lokol-health-qwen3.5-9b", label: "9B", where: "clinic laptop" }
];

function packSize(sector: "health" | "agriculture" | "tourism") {
  return PRESETS[sector].nodes.reduce((a, n) => a + (n.model?.size_mb ?? 0), 0);
}

export default function AppHome() {
  const { h, n } = useHeadline();
  const first = SAMPLE_USER.name.split(" ")[0];
  const openCard = useModelCard((s) => s.open);

  return (
    <div className="pb-8">
      <div className="page pt-6 sm:pt-7">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-d-md font-bold" style={{ fontVariationSettings: '"wdth" 86' }}>
              Welcome back, {first}
            </h1>
            <p className="mt-1.5 text-[15.5px] leading-snug text-ink-2">Lokol Studio builds small helper agents that run offline. Check a device, build a pack from a guideline, shape it in Studio, then deploy it.</p>
          </div>
        </div>

        {/* Quick actions */}
        <section aria-labelledby="qa" className="mt-5">
          <h2 id="qa" className="sr-only">Quick actions</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <QuickAction to="/recommend" title="Check a device" body="Name the phone; see which model sizes fit it and what will not." icon={I.phone} />
            <QuickAction to="/studio?pack=health" title="Open Studio" body="Hear, look up, think, respond: swap models, switch voice and internet, do a test run." icon={I.graph} />
            <QuickAction to="/packs/new" title="Build from a manual" body="Drop in a PDF guideline; get a pack that cites its pages, offline." icon={I.book} />
            <QuickAction to="/demo" title="Try the field app" body="Talk to Lokol Health and hear it answer, with no signal." icon={I.mic} />
          </div>
        </section>

        {/* Packs */}
        <section aria-labelledby="packs" className="mt-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 id="packs" className="font-display text-[22px] font-bold">Packs</h2>
            <Link to="/packs" className={btnClass("quiet", "sm")}>All packs</Link>
          </div>
          <div className="mt-3 grid gap-4 lg:grid-cols-3">
            {/* Lokol Health: the live, tuned pack */}
            <article className="flex flex-col rounded-2xl border border-ink/80 bg-white p-4 shadow-lift lg:col-span-1">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-display text-[22px] font-bold leading-tight">{SECTOR_COPY.health.title}</h3>
                <Badge tone="reef">Custom pack</Badge>
              </div>
              <p className="mt-1.5 text-[14px] leading-snug text-ink-2">{SECTOR_COPY.health.line}</p>
              <p className="mt-1.5 text-[12.5px] font-medium text-ink">Built in Lokol Studio from the Solomon Islands Standard Treatment Manual for Children, 2017</p>
              <ul className="mt-3 grid grid-cols-3 gap-2 border-t border-line-2 pt-2.5">
                {HEALTH_SIZES.map((s) => {
                  const m = getModel(s.id);
                  return (
                    <li key={s.id} className="min-w-0">
                      <button type="button" onClick={() => openCard(s.id)} className="w-full rounded-lg text-left hover:bg-sand/60" title="Model card: training and evaluation">
                        <p className="font-display text-[17px] font-semibold text-ink">{s.label}</p>
                        <p className="text-[12px] text-ink-3">{m ? mb(m.size_mb) : ""}, {s.where}</p>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-auto flex flex-wrap gap-2 pt-3">
                <Link to="/studio?pack=health" className={btnClass("ink", "sm")}>Open in Studio</Link>
                <Link to="/deploy?pack=health" className={btnClass("ghost", "sm")}>Deploy</Link>
                <Link to="/demo" className={btnClass("ghost", "sm")}>Field app</Link>
              </div>
            </article>

            {(["agriculture", "tourism"] as const).map((s) => (
              <article key={s} className="flex flex-col rounded-2xl border border-line bg-white p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-display text-[22px] font-bold leading-tight">{SECTOR_COPY[s].title}</h3>
                  <Badge tone="sand">Sample pack</Badge>
                </div>
                <p className="mt-1.5 text-[14px] leading-snug text-ink-2">{SECTOR_COPY[s].line}</p>
                <p className="mt-2 text-[13px] text-ink-3">
                  {PRESETS[s].nodes.length} steps, {mb(packSize(s))} download.
                </p>
                <div className="mt-auto flex flex-wrap gap-2 pt-3">
                  <Link to={`/studio?pack=${s}`} className={btnClass("ghost", "sm")}>Open in Studio</Link>
                  <Link to={`/deploy?pack=${s}`} className={btnClass("quiet", "sm")}>Deploy</Link>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* Evidence strip */}
        <section aria-labelledby="ev" className="mt-6 overflow-hidden rounded-2xl bg-ink text-white">
          <div className="grid gap-5 p-5 sm:px-6 sm:py-5 lg:grid-cols-[1.1fr_2fr] lg:items-center">
            <div>
              <h2 id="ev" className="font-display text-[20px] font-bold">Evidence: stock vs custom model, {h.size}</h2>
              <p className="mt-1.5 text-[13.5px] leading-snug text-white/70">
                {n} held-out cases the model never saw in training. Same small model before and after fine-tuning on the treatment manual.
              </p>
              <button type="button" onClick={() => openCard("lokol-health-qwen3-0.6b")} className="mt-2 inline-flex text-[14px] font-semibold text-reef-bright underline decoration-reef-bright/40 underline-offset-[3px] hover:decoration-reef-bright">
                Open the model card
              </button>
            </div>
            <dl className="grid grid-cols-3 gap-4">
              {[
                { k: "Catches danger signs", b: h.base.flag, t: h.tuned.flag, f: h.fewshot?.flag },
                { k: "Right action", b: h.base.act, t: h.tuned.act, f: h.fewshot?.act },
                { k: "Readable by the app", b: h.base.fmt, t: h.tuned.fmt, f: h.fewshot?.fmt }
              ].map((x) => (
                <div key={x.k} className="min-w-0">
                  <dt className="text-[12.5px] leading-snug text-white/70">{x.k}</dt>
                  <dd className="mt-1 font-display text-[30px] font-bold leading-none tabular-nums sm:text-[34px]">{pct(x.t)}</dd>
                  <dd className="mt-1 text-[12.5px] text-glow-rag" title="The stock model is never shown the reply format the app reads, so the app cannot use any of its answers and every check counts them as wrong.">Stock model, same prompt: {pct(x.b)}</dd>
                  {h.fewshot && <dd className="text-[12.5px] text-white/60">Stock + 2 examples: {pct(x.f ?? 0)}</dd>}
                </div>
              ))}
            </dl>
          </div>
        </section>
      </div>
    </div>
  );
}
