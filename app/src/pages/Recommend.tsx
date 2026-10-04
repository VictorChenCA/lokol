import { Suspense, lazy, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import devicesJson from "../data/devices.json";
import { recommend, searchDevices, tierFor, isComputerName, type RecommendInput, type Recommendation } from "../recommend";
import { useStudio } from "../store";
import { Badge, Boundary, Chip, Field, Kbd, Progress, Segmented, Toggle, btnClass, mb, toast } from "../components/ui";
import { buildManifest, packZip, download, slug } from "../pack";
import { SECTOR_COPY } from "../data/presets";
import type { Connectivity, Device, Sector } from "../types";


// The graph preview is lazy and fenced, so this page still works if the canvas bundle is slow or fails.
const GraphViewLazy = lazy(() => import("../components/GraphView").then((m) => ({ default: m.GraphView })));
function SafeGraph({ graph, height }: { graph: import("../types").Graph; height: number }) {
  const box = <div className="grid place-items-center rounded-xl border border-line bg-white/60 text-[13px] text-ink-3" style={{ height }}>Graph preview unavailable. Open it in Studio.</div>;
  return (
    <Boundary fallback={box}>
      <Suspense fallback={<div className="animate-pulse rounded-xl border border-line bg-white/60" style={{ height }} />}>
        <GraphViewLazy graph={graph} height={height} />
      </Suspense>
    </Boundary>
  );
}

const DEVICES = devicesJson.devices as Device[];

const STEPS = [{ t: "Sector" }, { t: "Languages" }, { t: "Voice" }, { t: "Signal" }, { t: "Device" }, { t: "Result" }] as const;

function Check({ on }: { on: boolean }) {
  return (
    <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 transition-colors ${on ? "border-reef bg-reef text-white" : "border-line bg-white"}`} aria-hidden>
      {on && (
        <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 8.5l3 3 6-7" /></svg>
      )}
    </span>
  );
}

function Option({ on, onClick, title, sub, body, role = "radio", children }: { on: boolean; onClick: () => void; title: ReactNode; sub?: ReactNode; body?: ReactNode; role?: "radio" | "checkbox"; children?: ReactNode }) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={on}
      onClick={onClick}
      className={`group flex h-full w-full flex-col rounded-2xl border p-4 text-left transition-[border-color,background-color,box-shadow] sm:p-5 ${
        on ? "border-reef bg-reef-pale shadow-[0_0_0_1px_var(--reef)]" : "border-line bg-white hover:border-ink-4"
      }`}
    >
      <span className="flex w-full items-start justify-between gap-3">
        <span>
          <span className="block font-display text-[18px] font-bold leading-tight">{title}</span>
          {sub && <span className="mt-0.5 block text-[13px] text-ink-3">{sub}</span>}
        </span>
        <Check on={on} />
      </span>
      {body && <span className="mt-3 block text-[14px] leading-relaxed text-ink-2">{body}</span>}
      {children}
    </button>
  );
}

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
    deviceName: manual ? (laptop ? "Custom laptop or PC" : "Custom phone") : device ? (device.brand === "Generic" ? device.model : `${device.brand} ${device.model}`) : "",
    ram_gb: manual ? ram : device?.ram_gb ?? 3,
    storage_gb: manual ? storage : device?.storage_gb ?? 32,
    isLaptop: manual ? laptop : !!device && isComputerName(`${device.brand} ${device.model}`),
    device
  };

  const canNext = step === 1 ? langs.length > 0 : step === 4 ? manual || !!device : true;
  const previewTier = step === 4 && (manual || device) ? tierFor(input.ram_gb, input.isLaptop) : null;

  const go = (n: number) => {
    if (n === 5) setResult(recommend(input));
    setStep(n);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
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
      const name = `${slug(result.graph.name)}.zip`;
      download(await packZip(m), name);
      try {
        const saved = JSON.parse(localStorage.getItem("lokol.packs") ?? "[]");
        localStorage.setItem("lokol.packs", JSON.stringify([m, ...saved.filter((x: any) => x.pack_id !== m.pack_id)].slice(0, 20)));
      } catch { /* ignore */ }
      toast("Pack exported", { body: `${name} downloaded. It is also listed on the Deploy page.`, tone: "palm" });
    } catch (e) {
      toast("Could not export the pack", { body: (e as Error).message, tone: "hibiscus" });
    } finally {
      setExporting(false);
    }
  };

  // Enter continues from anywhere on the step: the page itself, a text field, or a card that is
  // already selected. On an unselected card, Enter selects it first (a second Enter continues).
  const enterAdvances = (target: EventTarget | null) => {
    if (step >= 5 || !canNext) return false;
    const el = target as HTMLElement | null;
    if (!el || el === document.body) return true;
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return false;
    if (el instanceof HTMLInputElement) return el.type !== "number" && el.type !== "checkbox";
    if (el instanceof HTMLButtonElement) {
      const role = el.getAttribute("role");
      if (role === "radio") return el.getAttribute("aria-checked") === "true";
      if (el.hasAttribute("aria-pressed")) return el.getAttribute("aria-pressed") === "true";
      return false;
    }
    return true;
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && enterAdvances(e.target)) {
      e.preventDefault();
      go(step + 1);
    }
  };
  const keyRef = useRef({ enterAdvances, go, step });
  keyRef.current = { enterAdvances, go, step };
  useEffect(() => {
    const onDocKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.defaultPrevented || e.target !== document.body) return;
      const k = keyRef.current;
      if (k.enterAdvances(e.target)) {
        e.preventDefault();
        k.go(k.step + 1);
      }
    };
    window.addEventListener("keydown", onDocKey);
    return () => window.removeEventListener("keydown", onDocKey);
  }, []);

  return (
    <div className="page-narrow pb-24 pt-8 sm:pt-12" onKeyDown={onKey}>
      <h1 className="font-display text-d-lg font-bold" style={{ fontVariationSettings: '"wdth" 86' }}>Recommend</h1>
      <p className="lede mt-3">Five questions about the place and the phone. The answer is a pipeline you can edit for that exact device: what gets installed, the download size, the reasons, and what will not work on it.</p>

      {/* Stepper */}
      <nav aria-label="Steps" className="mt-8">
        <div className="sm:hidden">
          <p className="text-[13px] font-medium text-ink-2">
            Step {step + 1} of {STEPS.length}: <span className="text-ink">{STEPS[step].t}</span>
          </p>
          <Progress value={(step + 1) / STEPS.length} className="mt-2" label="Progress" />
        </div>
        <ol className="relative hidden grid-cols-6 sm:grid">
          <span className="absolute left-[calc(100%/12)] right-[calc(100%/12)] top-[15px] h-0.5 bg-line" aria-hidden />
          <span
            className="absolute left-[calc(100%/12)] top-[15px] h-0.5 bg-reef transition-[width] duration-300"
            style={{ width: `calc((100% - 100%/6) * ${step / 5})` }}
            aria-hidden
          />
          {STEPS.map((s, i) => {
            const done = i < step;
            const now = i === step;
            const reachable = i < step || (i === 5 && !!result);
            return (
              <li key={s.t} className="relative flex flex-col items-center text-center">
                <button
                  type="button"
                  onClick={() => reachable && go(i)}
                  disabled={!reachable && !now}
                  aria-current={now ? "step" : undefined}
                  className={`relative z-10 grid h-8 w-8 place-items-center rounded-full text-[13px] font-semibold ring-4 ring-paper transition-colors ${
                    now ? "bg-ink text-white" : done ? "bg-reef text-white hover:bg-reef-deep" : "border border-line bg-white text-ink-3"
                  }`}
                  aria-label={`${s.t}${done ? ", done" : ""}`}
                >
                  {done ? (
                    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3.5 8.5l3 3 6-7" /></svg>
                  ) : (
                    i + 1
                  )}
                </button>
                <span className={`mt-2 text-[13px] font-medium ${now ? "text-ink" : "text-ink-3"}`}>{s.t}</span>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="card mt-6 p-5 sm:p-8">
        {step === 0 && (
          <div>
            <h2 className="font-display text-d-sm font-bold">Which sector is this for?</h2>
            <p className="mt-1 text-[14px] text-ink-3">The sector picks the guideline corpus and the safety rules. The node graph is the same.</p>
            <div role="radiogroup" aria-label="Sector" className="mt-5 grid gap-3 sm:grid-cols-3">
              {(["health", "agriculture", "tourism"] as Sector[]).map((s) => (
                <Option
                  key={s}
                  on={sector === s}
                  onClick={() => setSector(s)}
                  title={SECTOR_COPY[s].title}
                  body={SECTOR_COPY[s].line}
                >
                  <span className="mt-auto pt-3">
                    {s === "health" ? <Badge tone="reef">Custom pack</Badge> : <Badge tone="white">Sample pack</Badge>}
                  </span>
                </Option>
              ))}
            </div>
          </div>
        )}

        {step === 1 && (
          <div>
            <h2 className="font-display text-d-sm font-bold">Which languages will people use?</h2>
            <p className="mt-1 text-[14px] text-ink-3">Pick one or both. Code-switching between them is normal and supported.</p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {[
                { code: "pis", name: "Solomon Islands Pijin", note: "Text and voice out on every phone. Voice in needs a laptop: the Pijin speech model is 1.3 GB." },
                { code: "en", name: "English", note: "Text and voice both ways on every device." }
              ].map((l) => (
                <Option key={l.code} role="checkbox" on={langs.includes(l.code)} onClick={() => toggleLang(l.code)} title={l.name} body={l.note} />
              ))}
            </div>
            {langs.length === 0 && <p className="mt-3 text-[13px] font-medium text-hibiscus" role="alert">Pick at least one language to continue.</p>}
          </div>
        )}

        {step === 2 && (
          <div>
            <h2 className="font-display text-d-sm font-bold">Voice in, voice out, or text only?</h2>
            <p className="mt-1 text-[14px] text-ink-3">Voice helps where reading is hard. Each adds a small speech model to the download. Not every clinic needs it: text only keeps the pack smallest.</p>
            <div className="mt-4">
              <Segmented
                value={voiceIn && voiceOut ? "both" : !voiceIn && !voiceOut ? "none" : "custom"}
                onChange={(v) => {
                  if (v === "both") { setVoiceIn(true); setVoiceOut(true); }
                  if (v === "none") { setVoiceIn(false); setVoiceOut(false); }
                }}
                options={[{ value: "both", label: "Voice both ways" }, { value: "none", label: "No voice (text only)" }, { value: "custom", label: "Mixed" }]}
                label="Voice"
              />
            </div>
            <div className="mt-5 divide-y divide-line-2 overflow-hidden rounded-2xl border border-line">
              <div className="flex items-center justify-between gap-4 bg-white p-4 sm:p-5">
                <div>
                  <div className="font-display text-[18px] font-bold">Speak to it {!voiceIn && <span className="text-[13px] font-normal text-ink-3">Off: the nurse types</span>}</div>
                  <div className="mt-0.5 text-[14px] text-ink-2">Adds a speech-in node: Moonshine tiny for English (about 50 MB). Pijin speech in runs on a laptop.</div>
                </div>
                <Toggle large checked={voiceIn} onChange={setVoiceIn} label="Voice in" />
              </div>
              <div className="flex items-center justify-between gap-4 bg-white p-4 sm:p-5">
                <div>
                  <div className="font-display text-[18px] font-bold">Hear the reply {!voiceOut && <span className="text-[13px] font-normal text-ink-3">Off: replies are text</span>}</div>
                  <div className="mt-0.5 text-[14px] text-ink-2">Adds a speech-out node: MMS Pijin (about 40 MB) or Kokoro English (about 90 MB).</div>
                </div>
                <Toggle large checked={voiceOut} onChange={setVoiceOut} label="Voice out" />
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <h2 className="font-display text-d-sm font-bold">What is the signal like where it will be used?</h2>
            <p className="mt-1 text-[14px] text-ink-3">Nodes only go online when there is signal to use. With none, everything runs on the device.</p>
            <div role="radiogroup" aria-label="Signal" className="mt-5 grid gap-3 sm:grid-cols-3">
              {[
                { v: "none", t: "None", b: "Nurse-aide post with no tower. Everything runs on the device.", bars: 0 },
                { v: "intermittent", t: "Comes and goes", b: "A bar or two some days. Works offline, sends notes when it can.", bars: 2 },
                { v: "online", t: "Online", b: "Town clinic. WhatsApp and the hosted 9B on River become options.", bars: 4 }
              ].map((o) => (
                <Option
                  key={o.v}
                  on={connectivity === o.v}
                  onClick={() => setConnectivity(o.v as Connectivity)}
                  title={
                    <span className="flex items-center gap-2">
                      <svg viewBox="0 0 16 14" className="h-3.5 w-4 text-reef" aria-hidden>
                        {[0, 1, 2, 3].map((i) => <rect key={i} x={i * 4} y={10 - i * 3} width="3" height={4 + i * 3} rx="1" fill="currentColor" opacity={i < o.bars ? 1 : 0.22} />)}
                      </svg>
                      {o.t}
                    </span>
                  }
                  body={o.b}
                />
              ))}
            </div>
          </div>
        )}

        {step === 4 && (
          <div>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-d-sm font-bold">Which device?</h2>
                <p className="mt-1 text-[14px] text-ink-3">{DEVICES.length} phones, laptops and clinic PCs common in the Pacific, with their RAM and storage. Not listed? Use Custom device.</p>
              </div>
              <Segmented value={manual ? "manual" : "search"} onChange={(v) => setManual(v === "manual")} options={[{ value: "search", label: "Search the list" }, { value: "manual", label: "Custom device" }]} label="Device entry" />
            </div>
            {!manual ? (
              <div className="mt-5">
                <div className="relative">
                  <svg viewBox="0 0 20 20" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><circle cx="9" cy="9" r="5.5" /><path d="M13.5 13.5L17 17" /></svg>
                  <input className="input pl-9" placeholder="Try galaxy a02, redmi 9a, tecno spark, iphone se" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search devices" autoFocus />
                </div>
                <ul className="mt-3 grid max-h-[420px] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                  {hits.map((d) => {
                    const sel = device === d;
                    return (
                      <li key={d.brand + d.model}>
                        <button type="button" onClick={() => setDevice(d)} aria-pressed={sel} className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${sel ? "border-reef bg-reef-pale shadow-[0_0_0_1px_var(--reef)]" : "border-line-2 bg-white hover:border-ink-4"}`}>
                          <span className="min-w-0">
                            <span className="block truncate text-[15px] font-medium">{d.brand === "Generic" ? d.model : `${d.brand} ${d.model}`}</span>
                            <span className="block truncate text-[12px] text-ink-3">{d.soc}, {d.os}, {d.year}</span>
                          </span>
                          <span className="shrink-0 text-right text-[13px]">
                            <span className="block font-semibold text-ink">{d.ram_gb} GB RAM</span>
                            <span className="block text-ink-3">{d.storage_gb} GB storage</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                  {hits.length === 0 && (
                    <li className="rounded-xl border border-dashed border-line p-4 text-[14px] text-ink-3 sm:col-span-2">
                      No phone matches "{query}". Switch to <button type="button" className="link" onClick={() => setManual(true)}>Custom device</button> and copy RAM and storage from the phone's About screen.
                    </li>
                  )}
                </ul>
              </div>
            ) : (
              <div className="mt-5 grid gap-4 sm:grid-cols-3">
                <Field label="RAM (GB)" hint="Settings, About phone">
                  <input className="input" type="number" min={1} max={64} value={ram} onChange={(e) => setRam(Number(e.target.value))} />
                </Field>
                <Field label="Storage (GB)" hint="Total, not free">
                  <input className="input" type="number" min={4} max={2048} value={storage} onChange={(e) => setStorage(Number(e.target.value))} />
                </Field>
                <div className="flex items-center gap-3 pt-6">
                  <Toggle checked={laptop} onChange={setLaptop} label="It is a laptop or clinic PC" />
                  <span className="text-[14px]">It is a laptop or clinic PC</span>
                </div>
              </div>
            )}
            {previewTier && (
              <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl bg-sand px-4 py-3 text-[14px]" aria-live="polite">
                <span className="font-medium text-ink">{input.deviceName}: {input.ram_gb} GB RAM, {input.storage_gb} GB storage.</span>
              </div>
            )}
          </div>
        )}

        {step === 5 && result && (
          <div>
            <h2 className="font-display text-d-sm font-bold">{result.fitLine}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-ink-3">
              <span>{result.graph.name}</span>
            </div>

            <div className="mt-5 rounded-xl border border-line bg-white p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-display text-[16px] font-bold">What gets installed on the {input.deviceName || "device"}</h3>
                <span className="text-[13px] text-ink-3">{mb(result.totalMb)} once, about {result.minutes3g < 1 ? "1 minute" : `${Math.round(result.minutes3g)} minutes`} on 3G</span>
              </div>
              <ul className="mt-2 divide-y divide-line-2 text-[14px]">
                {result.installs.map((m) => (
                  <li key={m.name} className="flex items-baseline justify-between gap-3 py-1.5">
                    <span><span className="font-medium text-ink">{m.name}</span> <span className="text-ink-3">{m.role}</span></span>
                    <span className="shrink-0 text-ink-2">{mb(m.mb)}</span>
                  </li>
                ))}
                {!voiceIn && !voiceOut && <li className="py-1.5 text-ink-3">No voice models: this pack is text only.</li>}
              </ul>
            </div>

            <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-4">
              <div className="bg-white p-3.5"><dt className="text-[12px] text-ink-3">Download once</dt><dd className="font-display text-[22px] font-bold">{mb(result.totalMb)}</dd></div>
              <div className="bg-white p-3.5"><dt className="text-[12px] text-ink-3">Free storage, est.</dt><dd className="font-display text-[22px] font-bold">{mb(result.freeStorageMb)}</dd></div>
              <div className="bg-white p-3.5"><dt className="text-[12px] text-ink-3">Steps</dt><dd className="font-display text-[22px] font-bold">{result.graph.nodes.length}</dd></div>
              <div className="bg-white p-3.5"><dt className="text-[12px] text-ink-3">Online steps</dt><dd className="font-display text-[22px] font-bold">{result.graph.nodes.filter((n) => n.online).length}</dd></div>
            </dl>

            {result.usableRamMb > 0 && (
              <div className="mt-4">
                <div className="flex items-baseline justify-between text-[13px]">
                  <span className="font-medium text-ink-2">Memory while running</span>
                  <span className="text-ink-3">{mb(result.ramMb)} of {mb(result.usableRamMb)} the phone can spare</span>
                </div>
                <Progress value={result.ramMb / result.usableRamMb} tone={result.ramMb > result.usableRamMb ? "hibiscus" : result.ramMb > result.usableRamMb * 0.8 ? "frangipani" : "palm"} className="mt-1.5 !h-2" label="Memory use" />
              </div>
            )}

            <div className="mt-5">
              <SafeGraph graph={result.graph} height={typeof window !== "undefined" && window.innerWidth < 640 ? 300 : 380} />
            </div>
            <div className="mt-6 grid gap-6 md:grid-cols-2">
              <div>
                <h3 className="font-display text-[18px] font-bold">Why this setup</h3>
                <ul className="mt-3 space-y-2.5 text-[14.5px] leading-relaxed text-ink-2">
                  {result.reasons.map((r, i) => (
                    <li key={i} className="flex gap-2.5"><span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-reef" aria-hidden />{r}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="font-display text-[18px] font-bold">What will not work</h3>
                {result.willNotWork.length === 0 ? (
                  <p className="mt-3 rounded-xl bg-palm-tint px-3.5 py-2.5 text-[14.5px] text-palm-deep">Everything you asked for fits on this device.</p>
                ) : (
                  <ul className="mt-3 space-y-2 text-[14.5px] leading-relaxed text-ink-2">
                    {result.willNotWork.map((r, i) => (
                      <li key={i} className="flex gap-2.5 rounded-xl border-l-4 border-frangipani bg-frangipani-tint/70 px-3.5 py-2.5">{r}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <div className="mt-6 flex flex-wrap gap-1.5">
              {result.graph.nodes.filter((n) => n.model).map((n) => (
                <Chip key={n.id} tone="white" title={n.model!.url}>{n.model!.id} <span className="text-ink-3">{mb(n.model!.size_mb)}</span></Chip>
              ))}
            </div>
            <div className="mt-7 flex flex-wrap gap-3 border-t border-line-2 pt-5">
              <button type="button" className={btnClass("ink")} onClick={openInStudio}>Open in Studio</button>
              <button type="button" className={btnClass("ghost")} onClick={exportPack} disabled={exporting}>{exporting ? "Exporting" : "Export pack"}</button>
              <button type="button" className={btnClass("ghost")} onClick={() => navigate("/demo", { state: { graph: result.graph } })}>Try in the field app</button>
              <button type="button" className={`${btnClass("quiet")} sm:ml-auto`} onClick={() => go(0)}>Start over</button>
            </div>
          </div>
        )}

        {step < 5 && (
          <div className="mt-8 flex items-center justify-between border-t border-line-2 pt-5">
            <button type="button" className={btnClass("ghost")} onClick={() => go(Math.max(0, step - 1))} disabled={step === 0}>Back</button>
            <div className="flex items-center gap-3">
              <span className="hidden text-[12px] text-ink-3 sm:inline">
                <Kbd>Enter</Kbd> to continue
              </span>
              <button type="button" className={btnClass(step === 4 ? "ink" : "primary")} onClick={() => go(step + 1)} disabled={!canNext}>
                {step === 4 ? "Recommend" : "Next"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
