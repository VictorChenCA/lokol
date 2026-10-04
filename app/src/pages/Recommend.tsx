import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import devicesJson from "../data/devices.json";
import { recommend, searchDevices, type RecommendInput, type Recommendation } from "../recommend";
import { useStudio } from "../store";
import { GraphView } from "../components/GraphView";
import { Chip, Field, Segmented, TierBadge, Toggle, mb } from "../components/ui";
import { buildManifest, packZip, download, slug } from "../pack";
import { SECTOR_COPY } from "../data/presets";
import type { Connectivity, Device, Sector } from "../types";

const DEVICES = devicesJson.devices as Device[];

const STEPS = ["Sector", "Languages", "Voice", "Signal", "Phone", "Result"] as const;

export default function Recommend() {
  const navigate = useNavigate();
  const setGraph = useStudio((s) => s.setGraph);
  const [step, setStep] = useState(0);
  const [sector, setSector] = useState<Sector>("health");
  const [langs, setLangs] = useState<string[]>(["pis", "en"]);
  const [voiceIn, setVoiceIn] = useState(true);
  const [voiceOut, setVoiceOut] = useState(true);
  const [connectivity, setConnectivity] = useState<Connectivity>("none");
  const [query, setQuery] = useState("");
  const [device, setDevice] = useState<Device | null>(null);
  const [manual, setManual] = useState(false);
  const [ram, setRam] = useState(3);
  const [storage, setStorage] = useState(32);
  const [laptop, setLaptop] = useState(false);
  const [result, setResult] = useState<Recommendation | null>(null);
  const [exporting, setExporting] = useState(false);

  const hits = useMemo(() => searchDevices(DEVICES, query), [query]);

  const toggleLang = (l: string) => setLangs((ls) => (ls.includes(l) ? ls.filter((x) => x !== l) : [...ls, l]));

  const input: RecommendInput = {
    sector,
    languages: langs,
    voiceIn,
    voiceOut,
    connectivity,
    deviceName: manual ? (laptop ? "Laptop or clinic PC" : "Phone (manual)") : device ? `${device.brand} ${device.model}` : "",
    ram_gb: manual ? ram : device?.ram_gb ?? 3,
    storage_gb: manual ? storage : device?.storage_gb ?? 32,
    isLaptop: manual ? laptop : device?.brand === "Laptop",
    device
  };

  const canNext = step === 1 ? langs.length > 0 : step === 4 ? manual || !!device : true;

  const go = (n: number) => {
    if (n === 5) setResult(recommend(input));
    setStep(n);
  };

  const openInStudio = () => {
    if (!result) return;
    setGraph(result.graph);
    navigate("/studio");
  };

  const exportPack = async () => {
    if (!result) return;
    setExporting(true);
    try {
      const m = buildManifest(result.graph);
      download(await packZip(m), `${slug(result.graph.name)}.zip`);
      try {
        const saved = JSON.parse(localStorage.getItem("lokol.packs") ?? "[]");
        localStorage.setItem("lokol.packs", JSON.stringify([m, ...saved.filter((x: any) => x.pack_id !== m.pack_id)].slice(0, 20)));
      } catch { /* ignore */ }
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1000px] px-4 pb-16 pt-8">
      <h1 className="font-display text-[32px] font-bold">Find the pack that fits</h1>
      <p className="mt-1 max-w-[60ch] text-[15px] text-ink-3">Five quick questions. The answer is a graph you can edit, with the reasons and the parts that will not work on this phone.</p>

      <ol className="mt-6 flex flex-wrap gap-1.5" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button
              type="button"
              onClick={() => (i < step || (i === 5 && result)) && go(i)}
              className={`rounded-md px-2.5 py-1 text-[13px] font-medium ${i === step ? "bg-ink text-white" : i < step ? "bg-white border border-line text-ink-2" : "text-ink-3"}`}
              aria-current={i === step ? "step" : undefined}
            >
              {i + 1}. {s}
            </button>
          </li>
        ))}
      </ol>

      <div className="mt-6 rounded-2xl border border-line bg-white p-5 shadow-card sm:p-7">
        {step === 0 && (
          <div>
            <h2 className="font-display text-[22px] font-bold">Which sector?</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {(["health", "agriculture", "tourism"] as Sector[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSector(s)}
                  className={`rounded-xl border p-4 text-left ${sector === s ? "border-reef bg-reef-pale" : "border-line hover:bg-sand"}`}
                  aria-pressed={sector === s}
                >
                  <div className="font-display text-[18px] font-bold">{SECTOR_COPY[s].title}</div>
                  <div className="text-[13px] text-ink-3">{SECTOR_COPY[s].pijin}</div>
                  <div className="mt-2 text-[13px] text-ink-2">{SECTOR_COPY[s].status}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 1 && (
          <div>
            <h2 className="font-display text-[22px] font-bold">Which languages will people use?</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {[
                { code: "pis", name: "Solomon Islands Pijin", note: "Text in, voice out on phones. Voice in needs a laptop tonight." },
                { code: "en", name: "English", note: "Text and voice both ways on every tier." }
              ].map((l) => (
                <label key={l.code} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 ${langs.includes(l.code) ? "border-reef bg-reef-pale" : "border-line"}`}>
                  <input type="checkbox" className="mt-1" checked={langs.includes(l.code)} onChange={() => toggleLang(l.code)} />
                  <span>
                    <span className="block font-display text-[17px] font-bold">{l.name}</span>
                    <span className="block text-[13px] text-ink-3">{l.note}</span>
                  </span>
                </label>
              ))}
            </div>
            {langs.length === 0 && <p className="mt-3 text-[13px] text-hibiscus">Pick at least one language.</p>}
          </div>
        )}

        {step === 2 && (
          <div>
            <h2 className="font-display text-[22px] font-bold">Voice in, voice out?</h2>
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between rounded-xl border border-line p-4">
                <div>
                  <div className="font-display text-[17px] font-bold">Speak to it</div>
                  <div className="text-[13px] text-ink-3">Adds a speech-in model (Moonshine, 75 MB for English).</div>
                </div>
                <Toggle checked={voiceIn} onChange={setVoiceIn} label="Voice in" />
              </div>
              <div className="flex items-center justify-between rounded-xl border border-line p-4">
                <div>
                  <div className="font-display text-[17px] font-bold">Hear the reply</div>
                  <div className="text-[13px] text-ink-3">Adds a speech-out model (MMS Pijin 70 MB, Kokoro English 90 MB).</div>
                </div>
                <Toggle checked={voiceOut} onChange={setVoiceOut} label="Voice out" />
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <h2 className="font-display text-[22px] font-bold">What is the signal like where it will be used?</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {[
                { v: "none", t: "None", b: "Nurse-aide post, no tower. Everything must run on the device." },
                { v: "intermittent", t: "Comes and goes", b: "A bar or two some days. Works offline, syncs notes when it can." },
                { v: "online", t: "Online", b: "Town clinic. WhatsApp and the hosted 9B model are available." }
              ].map((o) => (
                <button key={o.v} type="button" onClick={() => setConnectivity(o.v as Connectivity)} aria-pressed={connectivity === o.v} className={`rounded-xl border p-4 text-left ${connectivity === o.v ? "border-reef bg-reef-pale" : "border-line hover:bg-sand"}`}>
                  <div className="font-display text-[17px] font-bold">{o.t}</div>
                  <div className="mt-1 text-[13px] text-ink-2">{o.b}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 4 && (
          <div>
            <h2 className="font-display text-[22px] font-bold">Which phone?</h2>
            <p className="text-[13px] text-ink-3">About 80 phones sold in the Pacific, with approximate RAM and storage. Or enter the numbers yourself.</p>
            <div className="mt-4 flex items-center gap-3">
              <Segmented value={manual ? "manual" : "search"} onChange={(v) => setManual(v === "manual")} options={[{ value: "search", label: "Search the list" }, { value: "manual", label: "Enter numbers" }]} label="Device entry" />
            </div>
            {!manual ? (
              <div className="mt-4">
                <input className="input" placeholder="Try: galaxy a12, redmi 9a, tecno spark, iphone se" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search devices" />
                <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                  {hits.map((d) => {
                    const sel = device === d;
                    return (
                      <li key={d.brand + d.model}>
                        <button type="button" onClick={() => setDevice(d)} aria-pressed={sel} className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left ${sel ? "border-reef bg-reef-pale" : "border-line-2 hover:bg-sand"}`}>
                          <span>
                            <span className="block text-[15px] font-medium">{d.brand} {d.model}</span>
                            <span className="block text-[12px] text-ink-3">{d.soc}, {d.os}, {d.year}</span>
                          </span>
                          <span className="text-right text-[13px] text-ink-2">
                            {d.ram_gb} GB RAM<br />
                            <span className="text-ink-3">{d.storage_gb} GB</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                  {hits.length === 0 && <li className="text-[14px] text-ink-3">No match. Switch to "Enter numbers" and type the RAM and storage from the phone's About screen.</li>}
                </ul>
              </div>
            ) : (
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <Field label="RAM (GB)">
                  <input className="input" type="number" min={1} max={64} value={ram} onChange={(e) => setRam(Number(e.target.value))} />
                </Field>
                <Field label="Storage (GB)">
                  <input className="input" type="number" min={4} max={2048} value={storage} onChange={(e) => setStorage(Number(e.target.value))} />
                </Field>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 text-[14px]">
                    <input type="checkbox" checked={laptop} onChange={(e) => setLaptop(e.target.checked)} /> It is a laptop or clinic PC
                  </label>
                </div>
              </div>
            )}
          </div>
        )}

        {step === 5 && result && (
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <TierBadge tier={result.tier} />
              <h2 className="font-display text-[22px] font-bold">{result.graph.name}</h2>
            </div>
            <p className="mt-1 text-[14px] text-ink-3">{result.tierLabel}. Download {mb(result.totalMb)} of models; about {mb(result.freeStorageMb)} expected free.</p>
            <div className="mt-4">
              <GraphView graph={result.graph} height={300} />
            </div>
            <div className="mt-5 grid gap-5 md:grid-cols-2">
              <div>
                <h3 className="font-display text-[17px] font-bold">Why this setup</h3>
                <ul className="mt-2 space-y-2 text-[14px] leading-relaxed text-ink-2">
                  {result.reasons.map((r, i) => (
                    <li key={i} className="flex gap-2"><span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-reef" aria-hidden />{r}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="font-display text-[17px] font-bold">What will not work</h3>
                {result.willNotWork.length === 0 ? (
                  <p className="mt-2 text-[14px] text-ink-2">Everything you asked for fits on this device.</p>
                ) : (
                  <ul className="mt-2 space-y-2 text-[14px] leading-relaxed text-ink-2">
                    {result.willNotWork.map((r, i) => (
                      <li key={i} className="flex gap-2 rounded-lg bg-frangipani-tint px-3 py-2"><span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-frangipani" aria-hidden />{r}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              {result.graph.nodes.filter((n) => n.model).map((n) => (
                <Chip key={n.id} tone="sand" title={n.model!.url}>{n.model!.id} {mb(n.model!.size_mb)}</Chip>
              ))}
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <button type="button" className="btn-primary" onClick={openInStudio}>Open in Studio</button>
              <button type="button" className="btn-ghost" onClick={exportPack} disabled={exporting}>{exporting ? "Exporting" : "Export pack"}</button>
              <button type="button" className="btn-ghost" onClick={() => navigate("/demo", { state: { graph: result.graph } })}>Run demo</button>
            </div>
          </div>
        )}

        {step < 5 && (
          <div className="mt-6 flex items-center justify-between border-t border-line-2 pt-4">
            <button type="button" className="btn-ghost" onClick={() => go(Math.max(0, step - 1))} disabled={step === 0}>Back</button>
            <button type="button" className="btn-primary" onClick={() => go(step + 1)} disabled={!canNext}>{step === 4 ? "Recommend" : "Next"}</button>
          </div>
        )}
      </div>
    </div>
  );
}
