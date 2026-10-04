import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Badge, btnClass, mb } from "../components/ui";
import { PRESETS, SECTOR_COPY } from "../data/presets";
import { getModel } from "../models";
import { listPacks, type SavedPack } from "../runtime/corpus_builder";
import { useModelCard } from "../components/ModelCard";
import type { Manifest, Sector } from "../types";

/** Packs library: Lokol Health (a custom pack built from a guideline), two sample packs, and the user's own packs. */

interface CorpusCount {
  sections: number;
  chunks: number;
  words: number;
}

const BUILT_IN: { sector: Sector; kind: "Custom pack" | "Sample pack"; source: string; langs: string; count?: CorpusCount; models?: string[] }[] = [
  {
    sector: "health",
    kind: "Custom pack",
    source: "Built from: Solomon Islands Standard Treatment Manual for Children, 2017",
    langs: "English and Solomon Islands Pijin",
    count: { sections: 56, chunks: 183, words: 29236 },
    models: ["lokol-health-qwen3-0.6b", "lokol-health-qwen3-1.7b", "lokol-health-qwen3.5-9b"]
  },
  { sector: "agriculture", kind: "Sample pack", source: "Built from: a sample crop, pest and market guide", langs: "English" },
  { sector: "tourism", kind: "Sample pack", source: "Built from: a sample guesthouse and ferry guide", langs: "English" }
];

function useCorpusCount(sector: Sector, fixed?: CorpusCount): CorpusCount | null {
  const [c, setC] = useState<CorpusCount | null>(fixed ?? null);
  useEffect(() => {
    if (fixed) return;
    let alive = true;
    fetch(`/packs/${sector}/corpus.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d?.chunks) return;
        const words = (d.chunks as { text: string }[]).reduce((a, x) => a + x.text.split(/\s+/).length, 0);
        setC({ sections: d.sections?.length ?? d.chunks.length, chunks: d.chunks.length, words });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [sector, fixed]);
  return c;
}

function loadExports(): Manifest[] {
  try {
    const v = JSON.parse(localStorage.getItem("lokol.packs") ?? "[]");
    return Array.isArray(v) ? v.filter((m: Manifest) => m?.graph && m.pack_id && !["health", "agriculture", "tourism"].includes(m.pack_id)) : [];
  } catch {
    return [];
  }
}

function downloadMb(sector: Sector) {
  return PRESETS[sector].nodes.reduce((a, n) => a + (n.model?.size_mb ?? 0), 0);
}

function BuiltInCard({ p }: { p: (typeof BUILT_IN)[number] }) {
  const count = useCorpusCount(p.sector, p.count);
  const copy = SECTOR_COPY[p.sector];
  const openCard = useModelCard((s) => s.open);
  return (
    <article className={`flex flex-col rounded-2xl border bg-white p-5 ${p.kind === "Custom pack" ? "border-ink/80 shadow-lift" : "border-line"}`}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-[22px] font-bold leading-tight">{copy.title}</h2>
        <Badge tone={p.kind === "Custom pack" ? "reef" : "sand"}>{p.kind}</Badge>
      </div>
      <p className="mt-2 text-[14.5px] leading-relaxed text-ink-2">{copy.line}</p>
      <p className="mt-3 text-[13.5px] font-medium text-ink">{p.source}</p>
      <ul className="mt-2 flex flex-wrap gap-1.5 text-[12.5px]">
        {count && (
          <>
            <li><Badge tone="white">{count.sections} sections</Badge></li>
            <li><Badge tone="white">{count.chunks} passages</Badge></li>
            <li><Badge tone="white">{count.words.toLocaleString()} words</Badge></li>
          </>
        )}
        <li><Badge tone="white">{p.langs}</Badge></li>
        <li><Badge tone="white">{mb(downloadMb(p.sector))} download</Badge></li>
      </ul>
      {p.models ? (
        <div className="mt-4 border-t border-line-2 pt-3">
          <p className="text-[12.5px] font-medium text-ink-3">Fine-tuned models</p>
          <ul className="mt-2 grid grid-cols-3 gap-2">
            {p.models.map((id) => {
              const m = getModel(id);
              return (
                <li key={id} className="min-w-0">
                  <button type="button" onClick={() => openCard(id)} className="w-full rounded-xl border border-line bg-paper-2/60 px-2.5 py-2 text-left hover:border-ink-4" title="Training and evaluation results">
                    <span className="block font-display text-[16px] font-semibold text-ink">{m?.size_label ?? id}</span>
                    <span className="block text-[11.5px] text-ink-3">{m ? mb(m.size_mb) : ""}</span>
                    <span className="mt-0.5 block text-[11.5px] font-semibold text-reef-deep">Model card</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <p className="mt-4 border-t border-line-2 pt-3 text-[13px] text-ink-3">Uses the general Lokol model with the guide as its knowledge. Swap in your own manual with New pack.</p>
      )}
      <div className="mt-auto flex flex-wrap gap-2 pt-5">
        <Link to={`/studio?pack=${p.sector}`} className={btnClass("ink", "sm")}>Open in Studio</Link>
        <Link to={`/deploy?pack=${p.sector}`} className={btnClass("ghost", "sm")}>Deploy</Link>
      </div>
    </article>
  );
}

export default function PackLibrary() {
  const [saved, setSaved] = useState<SavedPack[] | null>(null);
  const [exports] = useState<Manifest[]>(loadExports);
  useEffect(() => {
    let alive = true;
    listPacks()
      .then((p) => alive && setSaved(p))
      .catch(() => alive && setSaved([]));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="pb-20">
      <div className="page pt-8 sm:pt-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-d-lg font-bold" style={{ fontVariationSettings: '"wdth" 86' }}>Packs</h1>
            <p className="lede mt-2 max-w-[62ch]">
              A pack is a small helper agent that runs offline: a guideline it can search, the models that read it, and the safety rules around them. Build one from your own manual, open it in Studio, then deploy it.
            </p>
          </div>
          <Link to="/packs/new" className={btnClass("ink")}>
            New pack from a guideline
          </Link>
        </div>

        <div className="mt-8 grid gap-5 lg:grid-cols-3">
          {BUILT_IN.map((p) => (
            <BuiltInCard key={p.sector} p={p} />
          ))}
        </div>

        <section aria-labelledby="yours" className="mt-12">
          <h2 id="yours" className="font-display text-d-sm font-bold">Your packs</h2>
          <p className="mt-1 text-[14px] text-ink-3">Packs you built from a guideline or exported from Studio. They are saved in this browser.</p>
          {saved === null ? (
            <p className="mt-4 text-[13.5px] text-ink-3">Looking for packs saved in this browser…</p>
          ) : saved.length === 0 && exports.length === 0 ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-line bg-paper-2/60 px-4 py-4">
              <p className="text-[14px] text-ink-2">No packs of your own yet. Upload any PDF guideline and Lokol turns it into a pack that cites its pages, offline.</p>
              <Link to="/packs/new" className={btnClass("ink", "sm")}>New pack from a guideline</Link>
            </div>
          ) : (
            <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {saved.map((p) => {
                const m = p.manifest as { corpus_inline?: { chunks?: unknown[]; sections?: unknown[]; source?: string }; pack_id?: string; description?: string };
                return (
                  <li key={p.id} className="flex flex-col rounded-2xl border border-line bg-white p-4">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 truncate font-display text-[18px] font-bold">{p.name}</p>
                      <Badge tone="reef">Custom pack</Badge>
                    </div>
                    <p className="mt-1 text-[13px] text-ink-2">Built from: {m.corpus_inline?.source || "your manual"}</p>
                    <p className="mt-1 text-[12.5px] text-ink-3">
                      {m.corpus_inline?.sections?.length ?? 0} sections, {m.corpus_inline?.chunks?.length ?? 0} passages. Saved {new Date(p.created_at).toLocaleDateString()}.
                    </p>
                    <div className="mt-auto flex flex-wrap gap-2 pt-4">
                      <Link to={`/studio?pack=${encodeURIComponent(`idb:${p.id}`)}`} className={btnClass("ink", "sm")}>Open in Studio</Link>
                      <Link to={`/deploy?pack=${encodeURIComponent(`idb:${p.id}`)}`} className={btnClass("ghost", "sm")}>Deploy</Link>
                    </div>
                  </li>
                );
              })}
              {exports.map((m) => (
                <li key={m.pack_id} className="flex flex-col rounded-2xl border border-line bg-white p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 truncate font-display text-[18px] font-bold">{m.graph.name}</p>
                    <Badge tone="sand">Studio export</Badge>
                  </div>
                  <p className="mt-1 text-[12.5px] text-ink-3">
                    {m.graph.nodes.length} steps, {m.models.length} models, built for {m.graph.target.device}.
                  </p>
                  <div className="mt-auto flex flex-wrap gap-2 pt-4">
                    <Link to={`/studio?pack=${encodeURIComponent(`export:${m.pack_id}`)}`} className={btnClass("ink", "sm")}>Open in Studio</Link>
                    <Link to={`/deploy?pack=${encodeURIComponent(m.pack_id!)}`} className={btnClass("ghost", "sm")}>Deploy</Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
