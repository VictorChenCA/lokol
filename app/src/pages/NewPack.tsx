import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import JSZip from "jszip";
import { Button, Callout, Field, Spinner, btnClass, toast } from "../components/ui";
import { PRESETS } from "../data/presets";
import { buildManifest, download, installUrl, qrDataUrl, readme, slug, PWA_URL } from "../pack";
import type { Manifest } from "../types";
import { chunkText, deletePack, listPacks, mergeWithNext, savePack, toCorpus, type DraftChunk, type SavedPack } from "../runtime/corpus_builder";
import { BM25Index } from "../runtime/rag";
import type { CorpusFile } from "../runtime/types";
import { COFFEE_SAMPLE, COFFEE_SAMPLE_NAME } from "../components/newpack/samples";

type Sector = "health" | "agriculture" | "tourism" | "other";
type Step = 1 | 2 | 3 | 4;

const RED_FLAGS: Record<Sector, string> = {
  health: ["fit", "sek-sek", "convulsion", "no save dring", "unable to drink", "toraot evri samting", "vomits everything", "slip tumas", "lethargic", "nek stif", "stiff neck", "brit hariap", "chest indrawing", "blad kam aot", "bleeding"].join("\n"),
  agriculture: ["whole trees lose their leaves", "seedlings die", "black rot", "poison", "spray in my eyes"].join("\n"),
  tourism: ["injured", "missing", "lost at sea", "fire"].join("\n"),
  other: ""
};
const FALLBACK: Record<Sector, string> = {
  health: "Mi no sua. Askem nes in charge o dokta long hospitol. (I am not sure. Ask the nurse in charge or the hospital doctor.)",
  agriculture: "I am not sure. Ask your agriculture extension officer before you spray.",
  tourism: "I am not sure. Ask the guesthouse owner or the tour leader.",
  other: "I am not sure. Ask a person who knows."
};
const DEVICES = [
  { id: "basic", label: "Basic Android, 2 GB RAM", ram: 2 },
  { id: "mid", label: "Mid Android, 4 GB RAM", ram: 4 },
  { id: "good", label: "Good Android, 6 to 8 GB RAM", ram: 8 },
  { id: "laptop", label: "Laptop or clinic PC, 16 GB RAM", ram: 16 }
];
const STEPS: { n: Step; label: string; pis: string }[] = [
  { n: 1, label: "Manual", pis: "Buk" },
  { n: 2, label: "Sections", pis: "Olketa pat" },
  { n: 3, label: "Configure", pis: "Setem" },
  { n: 4, label: "Build", pis: "Mekem" }
];

function withRuntime(path: string): string {
  const rt = new URLSearchParams(location.search).get("runtime");
  return rt ? `${path}${path.includes("?") ? "&" : "?"}runtime=${rt}` : path;
}

function Stepper({ step, maxStep, onPick }: { step: Step; maxStep: Step; onPick: (s: Step) => void }) {
  return (
    <ol className="flex flex-wrap gap-2" aria-label="Steps">
      {STEPS.map((s) => {
        const on = s.n === step;
        const reachable = s.n <= maxStep;
        return (
          <li key={s.n}>
            <button
              type="button"
              disabled={!reachable}
              onClick={() => onPick(s.n)}
              aria-current={on ? "step" : undefined}
              className={`flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[13.5px] transition-colors ${on ? "border-reef bg-reef text-white" : reachable ? "border-line bg-white text-ink hover:border-ink-4" : "border-line-2 bg-sand text-ink-4"}`}
            >
              <span className={`grid h-5 w-5 place-items-center rounded-full text-[12px] font-semibold ${on ? "bg-white/20" : "bg-ink/5"}`}>{s.n}</span>
              {s.label}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function Panel({ title, lede, children }: { title: string; lede?: ReactNode; children: ReactNode }) {
  return (
    <section className="card mt-6 p-5 sm:p-7">
      <h2 className="font-display text-[22px] font-bold">{title}</h2>
      {lede && <p className="mt-1 max-w-[70ch] text-[14.5px] leading-relaxed text-ink-2">{lede}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

function blobManifestUrl(manifest: object): string {
  return URL.createObjectURL(new Blob([JSON.stringify(manifest)], { type: "application/json" }));
}

async function exportZip(manifest: Manifest & { corpus_inline?: CorpusFile }) {
  const { corpus_inline, ...rest } = manifest;
  const shipped = { ...rest, corpus_url: "corpus.json" } as Manifest;
  const zip = new JSZip();
  const url = installUrl(shipped);
  zip.file("manifest.json", JSON.stringify(shipped, null, 2));
  zip.file("corpus.json", JSON.stringify(corpus_inline ?? {}, null, 2));
  zip.file(
    "README.md",
    `${readme(shipped)}\n\n## Built from your own manual\n\nThis pack was built in Lokol's New pack wizard. corpus.json holds ${corpus_inline?.chunks.length ?? 0} chunks of your manual; the app retrieves from it with BM25 and cites the section and page. The language model is the general Lokol model fine-tuned on the Solomon Islands STM protocol: for a new manual it relies on retrieval. To fine-tune on this manual, see /train.\n`
  );
  zip.file("qr.png", (await qrDataUrl(url)).split(",")[1], { base64: true });
  zip.file("install-url.txt", url);
  download(await zip.generateAsync({ type: "blob" }), `lokol-${shipped.pack_id}.zip`);
  toast("Pack exported", { body: `lokol-${shipped.pack_id}.zip`, tone: "palm" });
}

export default function NewPack() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(1);
  const [maxStep, setMaxStep] = useState<Step>(1);
  const [source, setSource] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chunks, setChunks] = useState<DraftChunk[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [name, setName] = useState("");
  const [sector, setSector] = useState<Sector>("health");
  const [langs, setLangs] = useState("pis, en");
  const [redFlags, setRedFlags] = useState(RED_FLAGS.health);
  const [fallback, setFallback] = useState(FALLBACK.health);
  const [device, setDevice] = useState("mid");
  const [built, setBuilt] = useState<{ manifest: Manifest & { corpus_inline: CorpusFile }; index: BM25Index } | null>(null);
  const [probe, setProbe] = useState("");
  const [saved, setSaved] = useState<SavedPack[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listPacks().then(setSaved);
  }, [built]);

  const go = (s: Step) => {
    setStep(s);
    if (s > maxStep) setMaxStep(s);
  };

  function ingest(t: string, src: string, packName?: string) {
    setText(t);
    setSource(src);
    const c = chunkText(t, { idPrefix: slug(packName || src).slice(0, 24) || "pack" });
    setChunks(c);
    if (!name) setName(packName ?? src.replace(/\.(pdf|txt|md)$/i, "").replace(/[-_]+/g, " "));
    setBuilt(null);
    go(2);
  }

  async function onFile(f: File) {
    setError(null);
    try {
      if (/\.pdf$/i.test(f.name) || f.type === "application/pdf") {
        setBusy("Reading PDF");
        const { pdfToText } = await import("../components/newpack/pdf");
        const t = await pdfToText(f, (n, total) => setBusy(`Reading PDF, page ${n} of ${total}`));
        ingest(t, f.name);
      } else ingest(await f.text(), f.name);
    } catch (e) {
      setError(`Could not read ${f.name}: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  async function useStm() {
    setError(null);
    setBusy("Loading the STM sample");
    try {
      const { stmSampleText } = await import("../components/newpack/pdf");
      setSector("health");
      setRedFlags(RED_FLAGS.health);
      setFallback(FALLBACK.health);
      ingest(await stmSampleText(), "SI Standard Treatment Manual for Children 2017", "STM Children (rebuilt)");
    } catch (e) {
      setError(`Could not load the sample: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  function pickSector(s: Sector) {
    if (redFlags === RED_FLAGS[sector]) setRedFlags(RED_FLAGS[s]);
    if (fallback === FALLBACK[sector]) setFallback(FALLBACK[s]);
    setSector(s);
  }

  async function build() {
    setBusy("Building the index");
    await new Promise((r) => setTimeout(r, 30));
    const packId = `custom-${slug(name || "pack").slice(0, 32)}-${Date.now().toString(36).slice(-4)}`;
    const corpus = toCorpus(chunks, source || name);
    const index = new BM25Index(corpus);
    const preset = PRESETS[sector === "other" ? "health" : sector];
    const dev = DEVICES.find((d) => d.id === device) ?? DEVICES[1];
    const graph = { ...preset, name: name || "My pack", language: langs.split(/[,\s]+/).filter(Boolean), target: { ...preset.target, device: dev.label, ram_gb: dev.ram } };
    const base = buildManifest(graph, PWA_URL, packId);
    const manifest = {
      ...base,
      description: `Built from ${source || "your manual"} in the Lokol New pack wizard.`,
      sector,
      languages: graph.language,
      red_flags: redFlags.split("\n").map((s) => s.trim()).filter(Boolean),
      fallback_message: fallback,
      corpus_inline: corpus
    };
    await savePack({ id: packId, name: graph.name, created_at: new Date().toISOString(), manifest });
    setBuilt({ manifest, index });
    setBusy(null);
    toast("Pack saved on this device", { body: `${corpus.chunks.length} chunks, ${corpus.sections.length} sections`, tone: "palm" });
  }

  function tryIt(manifest: object, id?: string) {
    const pack = id ? `idb:${id}` : blobManifestUrl(manifest);
    navigate(withRuntime(`/demo?pack=${encodeURIComponent(pack)}`));
  }

  const probeHits = useMemo(() => (built && probe.trim() ? built.index.searchDetailed(probe, 3).hits : []), [built, probe]);
  const words = useMemo(() => chunks.reduce((a, c) => a + c.words, 0), [chunks]);
  const visible = showAll ? chunks : chunks.slice(0, 40);

  return (
    <div className="pb-24">
      <header className="page pt-10 sm:pt-14">
        <div className="max-w-[760px]">
          <p className="text-[14px] font-medium text-reef-deep">New pack</p>
          <h1 className="mt-2 font-display text-d-lg font-bold">Build a pack from your own manual</h1>
          <p className="lede mt-4">
            Upload the guideline your workers already use. Lokol splits it into sections, indexes it on this device, and runs it offline with the same red-flag gate and
            "ask a person" fallback. Nothing leaves the browser.
          </p>
        </div>
        <div className="mt-6">
          <Stepper step={step} maxStep={maxStep} onPick={setStep} />
        </div>
      </header>

      <div className="page">
        {busy && (
          <p className="mt-6 inline-flex items-center gap-2 text-[14px] text-ink-2" role="status">
            <Spinner /> {busy}
          </p>
        )}
        {error && (
          <div className="mt-6">
            <Callout tone="hibiscus" title="Could not read that file">{error}</Callout>
          </div>
        )}

        {step === 1 && (
          <Panel title="1. Your manual" lede="A PDF, a .txt or .md file, or pasted text. PDFs are read in the browser with pdf.js; nothing is uploaded to a server.">
            <div className="grid gap-4 md:grid-cols-3">
              <button type="button" onClick={() => fileRef.current?.click()} className="card-flat card-hover flex flex-col items-start gap-1 p-5 text-left">
                <span className="font-display text-[17px] font-semibold">Upload a file</span>
                <span className="text-[13.5px] text-ink-3">PDF, .txt or .md</span>
              </button>
              <button type="button" onClick={useStm} className="card-flat card-hover flex flex-col items-start gap-1 p-5 text-left">
                <span className="font-display text-[17px] font-semibold">Use the STM sample</span>
                <span className="text-[13.5px] text-ink-3">Solomon Islands Standard Treatment Manual for Children (2017)</span>
              </button>
              <button type="button" onClick={() => ingest(COFFEE_SAMPLE, COFFEE_SAMPLE_NAME, "Coffee leaf rust (sample)")} className="card-flat card-hover flex flex-col items-start gap-1 p-5 text-left">
                <span className="font-display text-[17px] font-semibold">Use a farming sample</span>
                <span className="text-[13.5px] text-ink-3">Coffee leaf rust leaflet, written for this demo</span>
              </button>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
              className="sr-only"
              data-testid="newpack-file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFile(f);
                e.target.value = "";
              }}
            />
            <div className="mt-5">
              <Field label="Or paste the text" hint="Headings can be ALL CAPS lines, numbered (3.2 Fever) or markdown (# Fever).">
                <textarea className="input min-h-[160px] font-mono text-[13px]" value={text} onChange={(e) => setText(e.target.value)} placeholder="# Section title&#10;Guideline text..." />
              </Field>
              <div className="mt-3">
                <Button disabled={text.trim().length < 40} onClick={() => ingest(text, source || "pasted-text")}>
                  Split into sections
                </Button>
              </div>
            </div>
          </Panel>
        )}

        {step === 2 && (
          <Panel
            title="2. Sections"
            lede={`${chunks.length} chunks, ${words.toLocaleString()} words from ${source}. Chunks follow the headings and hold 150 to 400 words. Rename, merge or delete before you build.`}
          >
            <ul className="divide-y divide-line-2 rounded-xl border border-line">
              {visible.map((c, i) => (
                <li key={c.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        aria-label={`Title of chunk ${i + 1}`}
                        className="input max-w-[420px] py-1 text-[14px] font-medium"
                        value={c.title}
                        onChange={(e) => setChunks((cs) => cs.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                      />
                      <span className="text-[12.5px] text-ink-3">
                        p. {c.page}
                        {c.page_end !== c.page ? `-${c.page_end}` : ""} · {c.words} words
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[13px] text-ink-3">{c.text.slice(0, 220)}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button variant="quiet" size="sm" disabled={i >= chunks.length - 1} onClick={() => setChunks((cs) => mergeWithNext(cs, i))}>
                      Merge with next
                    </Button>
                    <Button variant="quiet" size="sm" onClick={() => setChunks((cs) => cs.filter((_, j) => j !== i))}>
                      Delete
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
            {chunks.length > 40 && (
              <button type="button" className="mt-2 text-[13.5px] font-medium text-reef-deep" onClick={() => setShowAll((v) => !v)}>
                {showAll ? "Show the first 40" : `Show all ${chunks.length}`}
              </button>
            )}
            <div className="mt-5 flex gap-2">
              <Button variant="ghost" onClick={() => setStep(1)}>Back</Button>
              <Button disabled={!chunks.length} onClick={() => go(3)}>Configure</Button>
            </div>
          </Panel>
        )}

        {step === 3 && (
          <Panel title="3. Configure" lede="Who the pack is for, what must always go to a person, and what it says when the manual has no answer.">
            <div className="grid gap-5 md:grid-cols-2">
              <Field label="Pack name">
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Sector">
                <select className="input" value={sector} onChange={(e) => pickSector(e.target.value as Sector)}>
                  <option value="health">Health</option>
                  <option value="agriculture">Agriculture</option>
                  <option value="tourism">Tourism</option>
                  <option value="other">Other</option>
                </select>
              </Field>
              <Field label="Languages" hint="Codes, comma separated: pis = Pijin, en = English.">
                <input className="input" value={langs} onChange={(e) => setLangs(e.target.value)} />
              </Field>
              <Field label="Target device" hint="Sets the RAM budget the Studio checks the models against.">
                <select className="input" value={device} onChange={(e) => setDevice(e.target.value)}>
                  {DEVICES.map((d) => (
                    <option key={d.id} value={d.id}>{d.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Red-flag phrases, one per line" hint="Any of these in a message skips the model and sends the person on. Pijin and English both count.">
                <textarea className="input min-h-[180px] font-mono text-[13px]" value={redFlags} onChange={(e) => setRedFlags(e.target.value)} />
              </Field>
              <Field label="'Ask a person' message" hint="Shown when the manual has nothing on the question.">
                <textarea className="input min-h-[180px] text-[14px]" value={fallback} onChange={(e) => setFallback(e.target.value)} />
              </Field>
            </div>
            <div className="mt-5 flex gap-2">
              <Button variant="ghost" onClick={() => setStep(2)}>Back</Button>
              <Button disabled={!name.trim()} onClick={() => go(4)}>Review and build</Button>
            </div>
          </Panel>
        )}

        {step === 4 && (
          <Panel title="4. Build" lede={`${chunks.length} chunks from ${source} for ${name}. The index is built here, in your browser, and saved on this device.`}>
            {!built ? (
              <Button size="lg" onClick={build} disabled={!!busy}>Build the pack</Button>
            ) : (
              <div className="space-y-5">
                <div className="flex flex-wrap gap-2">
                  <Button size="lg" onClick={() => tryIt(built.manifest, built.manifest.pack_id)}>Try it</Button>
                  <Button size="lg" variant="ghost" onClick={() => exportZip(built.manifest)}>Export pack</Button>
                </div>
                <p className="text-[14px] text-ink-2">
                  Saved as <code className="rounded bg-sand px-1 font-mono text-[12.5px]">{built.manifest.pack_id}</code>: {built.index.size} chunks, {built.index.sectionTitles().length} sections.
                </p>
                <Field label="Check retrieval" hint="Type a question; the top chunks of your manual appear with their section and page.">
                  <input className="input" value={probe} onChange={(e) => setProbe(e.target.value)} placeholder="How much copper do I mix for spraying?" />
                </Field>
                {probeHits.length > 0 && (
                  <ol className="space-y-2">
                    {probeHits.map((h) => (
                      <li key={h.id} className="card-flat p-3 text-[13.5px]">
                        <span className="font-semibold">{h.section}</span> <span className="text-ink-3">p. {h.page} · score {h.score?.toFixed(1)} · matched {h.matched.join(", ") || "none"}</span>
                        <p className="mt-1 line-clamp-3 text-ink-2">{h.text}</p>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}
            <div className="mt-6">
              <Callout tone="frangipani" title="What the model knows">
                The language model is the general Lokol model fine-tuned on the Solomon Islands STM protocol. For a new manual it relies on retrieval: it reads the
                matching section of your manual and cites it. Fine-tuning on your manual is the Train step, see the command on{" "}
                <Link to="/train#your-own" className="font-medium text-reef-deep underline">Train</Link>.
              </Callout>
            </div>
          </Panel>
        )}

        {saved.length > 0 && (
          <section className="mt-10">
            <h2 className="font-display text-[18px] font-semibold">Packs on this device</h2>
            <ul className="mt-3 divide-y divide-line-2 rounded-xl border border-line bg-white">
              {saved.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-3 p-3 text-[14px]">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-ink-3">{((p.manifest as { corpus_inline?: CorpusFile }).corpus_inline?.chunks.length ?? 0)} chunks · {new Date(p.created_at).toLocaleString()}</span>
                  <span className="ml-auto flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => tryIt(p.manifest, p.id)}>Try it</Button>
                    <Button size="sm" variant="quiet" onClick={() => exportZip(p.manifest as unknown as Manifest & { corpus_inline?: CorpusFile })}>Export</Button>
                    <Button size="sm" variant="quiet" onClick={() => deletePack(p.id).then(() => listPacks().then(setSaved))}>Delete</Button>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
        <p className="mt-8 text-[13px] text-ink-3">
          Prefer the command line? The same chunker runs in <code className="font-mono">app/src/runtime/corpus_builder.ts</code>. <Link className={btnClass("quiet", "sm")} to="/studio">Open the Studio</Link>
        </p>
      </div>
    </div>
  );
}
