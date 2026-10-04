import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { PRESETS, SECTOR_COPY } from "../data/presets";
import { getModel } from "../models";
import { Badge, btnClass, mb } from "../components/ui";
import { SAMPLE_USER } from "../components/Profile";
import { listPacks, type SavedPack } from "../runtime/corpus_builder";

/* Headline from public/eval/results.json (300 held-out cases); used until the file loads. */
type Headline = { size: string; base: { act: number; flag: number; fmt: number }; tuned: { act: number; flag: number; fmt: number } };
const FALLBACK: Headline = { size: "0.6B", base: { act: 0, flag: 0, fmt: 0 }, tuned: { act: 0.637, flag: 0.948, fmt: 0.98 } };

function useHeadline(): { h: Headline; n: number } {
  const [state, setState] = useState<{ h: Headline; n: number }>({ h: FALLBACK, n: 300 });
  useEffect(() => {
    let alive = true;
    fetch("/eval/results.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d?.rows) return;
        const pick = (variant: string) => d.rows.find((r: any) => r.size === "0.6B" && r.variant === variant)?.metrics;
        const b = pick("base"), t = pick("tuned");
        if (!b || !t) return;
        setState({
          n: d.test_set?.n ?? 300,
          h: {
            size: "0.6B",
            base: { act: b.action_accuracy, flag: b.red_flag_recall, fmt: b.format_compliance },
            tuned: { act: t.action_accuracy, flag: t.red_flag_recall, fmt: t.format_compliance }
          }
        });
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
  const [saved, setSaved] = useState<SavedPack[] | null>(null);
  useEffect(() => {
    let alive = true;
    listPacks()
      .then((p) => alive && setSaved(p))
      .catch(() => alive && setSaved([]));
    return () => {
      alive = false;
    };
  }, []);
  const first = SAMPLE_USER.name.split(" ")[0];

  return (
    <div className="pb-20">
      <div className="page pt-8 sm:pt-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-2.5 py-1 text-[12.5px] font-medium text-ink-2">
              <span className="h-2 w-2 rounded-full bg-palm" aria-hidden />
              {SAMPLE_USER.workspace}
            </span>
            <h1 className="mt-3 font-display text-d-lg font-bold" style={{ fontVariationSettings: '"wdth" 86' }}>
              Welcome back, {first}
            </h1>
            <p className="lede mt-2">Your packs, and the shortest path to change one: check a device, edit the graph, build from a manual, or try it as a nurse aide would.</p>
          </div>
        </div>

        {/* Quick actions */}
        <section aria-labelledby="qa" className="mt-8">
          <h2 id="qa" className="sr-only">Quick actions</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <QuickAction to="/recommend" title="Check a device" body="Name the phone; see which model sizes fit it and what will not." icon={I.phone} />
            <QuickAction to="/studio?preset=health" title="Open Studio" body="Edit the pack as a graph of small models. Switch voice in or out per node." icon={I.graph} />
            <QuickAction to="/new" title="Build from a manual" body="Drop in a PDF guideline; get a pack that cites its pages, offline." icon={I.book} />
            <QuickAction to="/demo" title="Try the field app" body="Talk to Lokol Health and hear it answer, with no signal." icon={I.mic} />
          </div>
        </section>

        {/* Packs */}
        <section aria-labelledby="packs" className="mt-12">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 id="packs" className="font-display text-d-sm font-bold">Your packs</h2>
            <Link to="/new" className={btnClass("ghost", "sm")}>New pack</Link>
          </div>
          <div className="mt-5 grid gap-5 lg:grid-cols-3">
            {/* Lokol Health: the live, tuned pack */}
            <article className="flex flex-col rounded-2xl border border-ink/80 bg-white p-5 shadow-lift lg:col-span-1">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-display text-[22px] font-bold leading-tight">{SECTOR_COPY.health.title}</h3>
                <Badge tone="palm" solid dot>Live</Badge>
              </div>
              <p className="mt-2 text-[14.5px] leading-relaxed text-ink-2">{SECTOR_COPY.health.line}</p>
              <ul className="mt-4 grid grid-cols-3 gap-2 border-t border-line-2 pt-3">
                {HEALTH_SIZES.map((s) => {
                  const m = getModel(s.id);
                  return (
                    <li key={s.id} className="min-w-0">
                      <p className="font-display text-[17px] font-semibold text-ink">{s.label}</p>
                      <p className="text-[12px] text-ink-3">{m ? mb(m.size_mb) : ""}</p>
                      <p className="text-[12px] text-ink-3">{s.where}</p>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-auto flex flex-wrap gap-2 pt-5">
                <Link to="/studio?preset=health" className={btnClass("ink", "sm")}>Open in Studio</Link>
                <Link to="/deploy?pack=health" className={btnClass("ghost", "sm")}>Deploy</Link>
                <Link to="/demo" className={btnClass("ghost", "sm")}>Field app</Link>
              </div>
            </article>

            {(["agriculture", "tourism"] as const).map((s) => (
              <article key={s} className="flex flex-col rounded-2xl border border-line bg-white p-5">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-display text-[22px] font-bold leading-tight">{SECTOR_COPY[s].title}</h3>
                  <Badge tone="sand">Preset</Badge>
                </div>
                <p className="mt-2 text-[14.5px] leading-relaxed text-ink-2">{SECTOR_COPY[s].line}</p>
                <p className="mt-3 text-[13px] text-ink-3">
                  {PRESETS[s].nodes.length} nodes, {mb(packSize(s))} download. Base model and a placeholder corpus.
                </p>
                <div className="mt-auto flex flex-wrap gap-2 pt-5">
                  <Link to={`/studio?preset=${s}`} className={btnClass("ghost", "sm")}>Open in Studio</Link>
                  <Link to={`/deploy?pack=${s}`} className={btnClass("quiet", "sm")}>Deploy</Link>
                </div>
              </article>
            ))}
          </div>

          <div className="mt-6">
            <h3 className="text-[14px] font-semibold text-ink">Built from your manuals</h3>
            {saved === null ? (
              <p className="mt-2 text-[13.5px] text-ink-3">Looking for packs saved in this browser...</p>
            ) : saved.length === 0 ? (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-line bg-paper-2/60 px-4 py-4">
                <p className="text-[14px] text-ink-2">No custom packs yet. Build one from any PDF guideline; it stays in this browser.</p>
                <Link to="/new" className={btnClass("ink", "sm")}>Build from a manual</Link>
              </div>
            ) : (
              <ul className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {saved.map((p) => {
                  const chunks = (p.manifest as any)?.corpus_inline?.chunks?.length as number | undefined;
                  const packId = (p.manifest as any)?.pack_id as string | undefined;
                  return (
                    <li key={p.id} className="flex flex-col rounded-2xl border border-line bg-white p-4">
                      <div className="flex items-start justify-between gap-2">
                        <p className="min-w-0 truncate font-display text-[17px] font-bold">{p.name}</p>
                        <Badge tone="reef">Custom</Badge>
                      </div>
                      <p className="mt-1 text-[12.5px] text-ink-3">
                        Saved {new Date(p.created_at).toLocaleDateString()}
                        {chunks ? `, ${chunks} sections of text` : ""}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Link to={`/demo?pack=${encodeURIComponent(`idb:${p.id}`)}`} className={btnClass("ink", "sm")}>Field app</Link>
                        <Link to={packId ? `/deploy?pack=${encodeURIComponent(packId)}` : "/deploy"} className={btnClass("ghost", "sm")}>Deploy</Link>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        {/* Evidence strip */}
        <section aria-labelledby="ev" className="mt-12 overflow-hidden rounded-2xl bg-ink text-white">
          <div className="grid gap-6 p-6 sm:p-8 lg:grid-cols-[1.1fr_2fr] lg:items-center">
            <div>
              <h2 id="ev" className="font-display text-[22px] font-bold">Evidence: base vs tuned, {h.size}</h2>
              <p className="mt-2 text-[14px] leading-relaxed text-white/70">
                {n} held-out cases the model never saw in training. Same small model before and after fine-tuning on the treatment manual.
              </p>
              <Link to="/eval" className="mt-4 inline-flex text-[14px] font-semibold text-reef-bright underline decoration-reef-bright/40 underline-offset-[3px] hover:decoration-reef-bright">
                See every metric
              </Link>
            </div>
            <dl className="grid grid-cols-3 gap-4">
              {[
                { k: "Catches danger signs", b: h.base.flag, t: h.tuned.flag },
                { k: "Right action", b: h.base.act, t: h.tuned.act },
                { k: "Readable by the app", b: h.base.fmt, t: h.tuned.fmt }
              ].map((x) => (
                <div key={x.k} className="min-w-0">
                  <dt className="text-[12.5px] leading-snug text-white/70">{x.k}</dt>
                  <dd className="mt-1 font-display text-[34px] font-bold leading-none tabular-nums sm:text-[40px]">{pct(x.t)}</dd>
                  <dd className="mt-1 text-[12.5px] text-glow-rag">base {pct(x.b)}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      </div>
    </div>
  );
}
