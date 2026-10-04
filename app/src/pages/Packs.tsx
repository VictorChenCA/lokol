import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { PRESETS, SECTOR_COPY } from "../data/presets";
import { getModel } from "../models";
import {
  BRIDGE_URL,
  SYSTEM_PROMPT,
  TWILIO_SANDBOX_NUMBER,
  buildManifest,
  download,
  hfRepo,
  installUrl,
  isHosted,
  laptopCommands,
  manifestUrl,
  packLlm,
  packZip,
  qrDataUrl,
  slug,
  totalMb
} from "../pack";
import { GraphView } from "../components/GraphView";
import {
  Badge,
  Callout,
  Chip,
  CodeBlock,
  CopyButton,
  Empty,
  Segmented,
  Spinner,
  StatusDot,
  Tabs,
  btnClass,
  mb,
  toast
} from "../components/ui";
import type { Manifest, Sector } from "../types";

const SECTORS: Sector[] = ["health", "agriculture", "tourism"];

function loadSaved(): Manifest[] {
  try {
    const v = JSON.parse(localStorage.getItem("lokol.packs") ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ bridge status */

type BridgeHealth = {
  ok?: boolean;
  mock?: boolean;
  version?: string;
  corpus?: { chunks?: number };
  llm?: { url?: string; ready?: boolean };
  sidecar?: { url?: string; ready?: boolean };
  public_base_url?: string | null;
  twilio?: { signature_check?: boolean; from?: string };
  messenger?: { send_configured?: boolean };
  users?: number;
};
type Bridge = { state: "checking" } | { state: "up"; health: BridgeHealth } | { state: "reachable" } | { state: "down" };

async function probeBridge(): Promise<Bridge> {
  const url = `${BRIDGE_URL}/health`;
  const attempt = async (init: RequestInit) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 1800);
    try {
      return await fetch(url, { ...init, signal: ctl.signal, cache: "no-store" });
    } finally {
      clearTimeout(t);
    }
  };
  try {
    const r = await attempt({});
    if (r.ok) return { state: "up", health: (await r.json()) as BridgeHealth };
  } catch {
    /* CORS or not running: try an opaque request to tell the two apart */
  }
  try {
    await attempt({ mode: "no-cors" });
    return { state: "reachable" };
  } catch {
    return { state: "down" };
  }
}

function useBridge() {
  const [bridge, setBridge] = useState<Bridge>({ state: "checking" });
  const check = useCallback(async () => {
    setBridge({ state: "checking" });
    setBridge(await probeBridge());
  }, []);
  useEffect(() => {
    check();
  }, [check]);
  return { bridge, check };
}

function BridgeStatus({ bridge, check }: { bridge: Bridge; check: () => void }) {
  const h = bridge.state === "up" ? bridge.health : null;
  return (
    <div className="rounded-xl border border-line bg-sand/70 p-3.5">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-[14px] font-semibold">
          {bridge.state === "checking" ? (
            <><Spinner className="h-3.5 w-3.5 text-ink-3" /> Checking the bridge on this laptop</>
          ) : bridge.state === "up" ? (
            <><StatusDot tone="palm" pulse /> Bridge running{h?.mock ? " (mock replies)" : ""}</>
          ) : bridge.state === "reachable" ? (
            <><StatusDot tone="frangipani" /> Something answers on port 8090</>
          ) : (
            <><StatusDot tone="slate" /> Bridge not running</>
          )}
        </p>
        <button type="button" className={btnClass("quiet", "sm")} onClick={check} disabled={bridge.state === "checking"}>
          Check again
        </button>
      </div>
      {h && (
        <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1 text-[12.5px] sm:grid-cols-4">
          <div><dt className="text-ink-3">Model</dt><dd className="font-medium">{h.llm?.ready ? "ready" : "not loaded"}</dd></div>
          <div><dt className="text-ink-3">Voice sidecar</dt><dd className="font-medium">{h.sidecar?.ready ? "ready" : "off"}</dd></div>
          <div><dt className="text-ink-3">Guideline chunks</dt><dd className="font-medium">{h.corpus?.chunks ?? "?"}</dd></div>
          <div><dt className="text-ink-3">Users</dt><dd className="font-medium">{h.users ?? 0}</dd></div>
        </dl>
      )}
      <p className="mt-2 text-[12.5px] leading-relaxed text-ink-3">
        {bridge.state === "up"
          ? h?.public_base_url
            ? `Public URL: ${h.public_base_url}`
            : "No PUBLIC_BASE_URL yet. Start cloudflared and put its https URL in .env."
          : bridge.state === "reachable"
            ? "The bridge answers but this page cannot read its status (browser CORS). Run curl localhost:8090/health to see it."
            : `Polled ${BRIDGE_URL}/health. Start it with the laptop commands; open this page from localhost to see live status.`}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ building blocks */

const ICONS: Record<string, ReactNode> = {
  phone: <><rect x="6.5" y="2.5" width="11" height="19" rx="2.5" /><path d="M10.5 18.5h3" /></>,
  android: <><path d="M6 10a6 6 0 0 1 12 0v7.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 17.5z" /><path d="M8 4.5l1.3 2M16 4.5l-1.3 2" /><circle cx="9.5" cy="10.5" r=".6" fill="currentColor" /><circle cx="14.5" cy="10.5" r=".6" fill="currentColor" /></>,
  laptop: <><rect x="4.5" y="5" width="15" height="10" rx="1.5" /><path d="M2.5 18.5h19" /></>,
  whatsapp: <><path d="M4.5 19.5l1.1-3.6A7.5 7.5 0 1 1 8.4 18.6z" /><path d="M9.3 9.3c.2 2.2 2 4 4.4 4.6l.9-1.1 1.6.7-.4 1.4c-3.6.2-6.9-3.1-6.8-6.8l1.4-.4.7 1.6z" /></>,
  messenger: <><path d="M12 3.5c-4.7 0-8.5 3.4-8.5 7.7 0 2.4 1.2 4.6 3.1 6v3.3l2.9-1.6c.8.2 1.6.3 2.5.3 4.7 0 8.5-3.4 8.5-7.7S16.7 3.5 12 3.5z" /><path d="M7.5 13.5l3-3.2 2 2 3-2.3-3 3.3-2-2z" /></>
};

function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {ICONS[name]}
    </svg>
  );
}

function Target({
  icon,
  title,
  pis,
  badges,
  children,
  className = ""
}: {
  icon: keyof typeof ICONS;
  title: string;
  pis: string;
  badges?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <article className={`card flex min-w-0 flex-col p-5 sm:p-6 ${className}`}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ink text-white">
            <Icon name={icon} />
          </span>
          <div>
            <h3 className="font-display text-[20px] font-bold leading-tight">{title}</h3>
            <p className="text-[13px] text-ink-3" lang="pis">{pis}</p>
          </div>
        </div>
        {badges && <div className="flex flex-wrap gap-1.5">{badges}</div>}
      </header>
      <div className="mt-5 flex min-w-0 flex-1 flex-col">{children}</div>
    </article>
  );
}

function Steps({ children }: { children: ReactNode[] }) {
  return (
    <ol className="space-y-2.5">
      {children.map((c, i) => (
        <li key={i} className="flex gap-3 text-[14.5px] leading-relaxed text-ink-2">
          <span className="mt-[1px] grid h-6 w-6 shrink-0 place-items-center rounded-full border border-line bg-white text-[12px] font-semibold text-ink">{i + 1}</span>
          <span className="min-w-0">{c}</span>
        </li>
      ))}
    </ol>
  );
}

function Inline({ children, copy }: { children: string; copy?: boolean }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-md bg-ink/[0.06] py-0.5 pl-1.5 pr-0.5 align-middle font-mono text-[12.5px] text-ink">
      <span className="truncate">{children}</span>
      {copy && <CopyButton text={children} label="" dark={false} className="!px-1 !py-0.5" />}
    </span>
  );
}

/* ------------------------------------------------------------------ targets */

function PhoneTarget({ m, qr }: { m: Manifest; qr: string }) {
  const url = installUrl(m);
  const hosted = isHosted(m);
  return (
    <Target
      icon="phone"
      title="Phone app (offline PWA)"
      pis="Long fon, no nid signal"
      badges={<><Badge tone="palm" dot>Works offline</Badge><Badge tone="white">{mb(totalMb(m))} once</Badge></>}
      className="lg:col-span-2"
    >
      <div className="grid gap-6 md:grid-cols-[220px_1fr]">
        <div className="text-center">
          <div className="mx-auto w-[200px] rounded-2xl border border-line bg-white p-2.5 shadow-card">
            {qr ? <img src={qr} alt={`QR code that opens ${m.graph.name} on a phone`} className="block w-full" width={180} height={180} /> : <div className="aspect-square w-full animate-pulse rounded-lg bg-sand" />}
          </div>
          <p className="mt-2 text-[12.5px] text-ink-3">Scan with the phone camera</p>
        </div>
        <div className="min-w-0">
          <Steps>
            {[
              <>Scan the code, or open the link in Chrome on Android or Safari on iPhone.</>,
              <>Wait once, with signal, while {mb(totalMb(m))} of models download. They stay cached on the phone.</>,
              <>Tap <b className="font-semibold text-ink">Add to home screen</b>. From then on it opens and answers in airplane mode.</>
            ]}
          </Steps>
          <div className="mt-4 flex min-w-0 items-center gap-1 rounded-lg border border-line bg-white py-1 pl-3 pr-1">
            <a href={url} className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-reef" title={url}>{url}</a>
            <CopyButton text={url} dark={false} />
          </div>
          {!hosted && (
            <p className="mt-3 text-[13px] leading-relaxed text-ink-3">
              This pack's manifest is not published with the app yet. Download the zip and host <code className="font-mono text-[12px]">manifest.json</code> at the address in the link; the code then works as is.
            </p>
          )}
        </div>
      </div>
    </Target>
  );
}

function AndroidTarget({ m }: { m: Manifest }) {
  const llm = packLlm(m);
  const repo = llm ? hfRepo(llm.url) : null;
  return (
    <Target icon="android" title="Android, native" pis="GGUF long PocketPal" badges={<><Badge tone="palm" dot>Works offline</Badge>{llm && <Badge tone="white">{mb(llm.size_mb)}</Badge>}</>}>
      {llm ? (
        <>
          <Steps>
            {[
              <>Install <b className="font-semibold text-ink">PocketPal AI</b> from Google Play.</>,
              <>
                Copy <Inline>{llm.file}</Inline> to the phone by USB or SD card, or download it inside PocketPal{repo ? <> from <a className="link" href={`https://huggingface.co/${repo}`} target="_blank" rel="noreferrer">{repo}</a></> : null}.
              </>,
              <>In <b className="font-semibold text-ink">Models</b>, add the local file and load it. Paste the system prompt below into the chat settings.</>
            ]}
          </Steps>
          <div className="mt-4 overflow-hidden rounded-xl border border-line bg-sand/60">
            <div className="flex items-center justify-between border-b border-line-2 px-3 py-1">
              <span className="text-[12px] font-medium text-ink-3">System prompt</span>
              <CopyButton text={SYSTEM_PROMPT} dark={false} />
            </div>
            <p className="max-h-[96px] overflow-y-auto px-3 py-2 text-[12.5px] leading-relaxed text-ink-2">{SYSTEM_PROMPT}</p>
          </div>
          <p className="mt-3 text-[13px] leading-relaxed text-ink-3">
            PocketPal runs the tuned model only; the guideline lookup and safety gate live in the phone app. No Lokol APK is built yet: the phone app installs from the browser instead.
          </p>
          <a className={`${btnClass("ghost", "sm")} mt-4 self-start`} href={llm.url} target="_blank" rel="noreferrer">Download {llm.file.length > 34 ? "the GGUF" : llm.file}</a>
        </>
      ) : (
        <Empty title="No language model in this pack" body="Add a Language model node in Studio, then come back to deploy it to Android." />
      )}
    </Target>
  );
}

function LaptopTarget({ m, bridge, check }: { m: Manifest; bridge: Bridge; check: () => void }) {
  const packModel = packLlm(m);
  const big = getModel("lokol-health-qwen3.5-9b");
  const [which, setWhich] = useState<"pack" | "9b">("pack");
  const model = which === "9b" && big ? big : packModel;
  return (
    <Target
      icon="laptop"
      title="Laptop or clinic PC"
      pis="Long laptop blong klinik"
      badges={<><Badge tone="palm" dot>Works offline</Badge>{model && <Badge tone="white">{mb(model.size_mb)}</Badge>}</>}
    >
      {big && packModel && big.id !== packModel.id && (
        <div className="mb-3">
          <Segmented
            value={which}
            onChange={setWhich}
            label="Model for the laptop"
            options={[
              { value: "pack", label: packModel.id.replace("lokol-health-", "") },
              { value: "9b", label: "9B, River-tuned" }
            ]}
          />
        </div>
      )}
      <CodeBlock code={laptopCommands(model)} title="From the Lokol repo folder" />
      <p className="mt-3 text-[13px] leading-relaxed text-ink-3">
        llama-server answers on port 8080; the bridge reads it for WhatsApp and Messenger, and the sidecar adds Pijin speech (Omnilingual ASR, MMS-TTS). A 16 GB laptop runs the 9B.
      </p>
      <div className="mt-4">
        <BridgeStatus bridge={bridge} check={check} />
      </div>
    </Target>
  );
}

function WhatsAppTarget({ bridge, check }: { bridge: Bridge; check: () => void }) {
  const base = bridge.state === "up" && bridge.health.public_base_url ? bridge.health.public_base_url.replace(/\/$/, "") : "<PUBLIC_BASE_URL>";
  return (
    <Target icon="whatsapp" title="WhatsApp" pis="Tok long WhatsApp" badges={<><Badge tone="reef" dot>Needs signal</Badge><Badge tone="white">Twilio Sandbox</Badge></>}>
      <Steps>
        {[
          <>Start the bridge on the laptop, then a tunnel: <Inline copy>cloudflared tunnel --url http://localhost:8090</Inline>. Put the https address in <code className="font-mono text-[12.5px]">.env</code> as <code className="font-mono text-[12.5px]">PUBLIC_BASE_URL</code>.</>,
          <>In WhatsApp, send your sandbox join code (<Inline>join two-words</Inline>, shown in the Twilio console) to <b className="font-semibold text-ink">{TWILIO_SANDBOX_NUMBER}</b>.</>,
          <>Twilio console, Messaging, Try it out, Sandbox settings: set <b className="font-semibold text-ink">When a message comes in</b> to <Inline copy>{`${base}/twilio/whatsapp`}</Inline> with POST.</>,
          <>Send <Inline>/help</Inline>, then a nurse message. Voice notes are transcribed by the sidecar and answered with text and a Pijin voice note.</>
        ]}
      </Steps>
      <p className="mt-3 text-[13px] leading-relaxed text-ink-3">The sandbox only answers numbers that joined, and membership lapses after 72 hours. Messages go through the laptop's model, never a cloud LLM.</p>
      <div className="mt-auto pt-4">
        <BridgeStatus bridge={bridge} check={check} />
      </div>
    </Target>
  );
}

function MessengerTarget({ bridge }: { bridge: Bridge }) {
  const base = bridge.state === "up" && bridge.health.public_base_url ? bridge.health.public_base_url.replace(/\/$/, "") : "<PUBLIC_BASE_URL>";
  const ready = bridge.state === "up" && bridge.health.messenger?.send_configured;
  return (
    <Target
      icon="messenger"
      title="Facebook Messenger"
      pis="Tok long Messenger"
      badges={<><Badge tone="reef" dot>Needs signal</Badge>{bridge.state === "up" && <Badge tone={ready ? "palm" : "white"}>{ready ? "Page token set" : "No page token"}</Badge>}</>}
    >
      <Steps>
        {[
          <>At developers.facebook.com create an app (type Business) and add the <b className="font-semibold text-ink">Messenger</b> product.</>,
          <>Messenger settings, Access tokens: add a Page you manage, generate a token, save it as <code className="font-mono text-[12.5px]">META_PAGE_TOKEN</code>.</>,
          <>Webhooks: callback URL <Inline copy>{`${base}/messenger/webhook`}</Inline>, verify token = your <code className="font-mono text-[12.5px]">META_VERIFY_TOKEN</code> (default <Inline>lokol-verify</Inline>). Subscribe the Page to <b className="font-semibold text-ink">messages</b>.</>,
          <>Message the Page from Messenger. In development mode only app admins and testers get replies.</>
        ]}
      </Steps>
      <p className="mt-3 text-[13px] leading-relaxed text-ink-3">Messaging in Solomon Islands leans towards Messenger, so the bridge treats it as a first-class channel next to WhatsApp.</p>
    </Target>
  );
}

/* ------------------------------------------------------------------ page */

type View = "targets" | "graph" | "manifest";

export default function Packs() {
  const presets = useMemo(() => SECTORS.map((s) => buildManifest(PRESETS[s], undefined, s)), []);
  const [saved, setSaved] = useState<Manifest[]>(loadSaved);
  const all = [...presets, ...saved];
  const [sel, setSel] = useState<string>(() => {
    const q = typeof location !== "undefined" ? new URLSearchParams(location.search).get("pack") : null;
    return q && all.some((m) => m.pack_id === q) ? q : "health";
  });
  const current = all.find((m) => m.pack_id === sel) ?? all[0];
  const [qr, setQr] = useState<string>("");
  const [view, setView] = useState<View>("targets");
  const [busy, setBusy] = useState(false);
  const { bridge, check } = useBridge();

  useEffect(() => {
    if (!current) return;
    let alive = true;
    setQr("");
    qrDataUrl(installUrl(current)).then((u) => alive && setQr(u)).catch(() => alive && setQr(""));
    return () => {
      alive = false;
    };
  }, [current?.pack_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const remove = (id: string) => {
    const next = saved.filter((m) => m.pack_id !== id);
    setSaved(next);
    try {
      localStorage.setItem("lokol.packs", JSON.stringify(next));
    } catch {
      /* ignore */
    }
    if (sel === id) setSel("health");
    toast("Export removed", { body: "It is gone from this browser only." });
  };

  const exportZip = async () => {
    if (!current) return;
    setBusy(true);
    try {
      const name = `${slug(current.graph.name)}.zip`;
      download(await packZip(current), name);
      toast("Pack downloaded", { body: `${name}: manifest, README with every deploy target, QR code.`, tone: "palm" });
    } catch (e) {
      toast("Could not build the zip", { body: (e as Error).message, tone: "hibiscus" });
    } finally {
      setBusy(false);
    }
  };

  if (!current) return <div className="page py-16"><Empty title="No packs yet" body="Export one from Studio or Recommend." /></div>;

  const onlineNodes = current.graph.nodes.filter((n) => n.online).length;
  const sector = current.graph.sector;

  return (
    <div className="pb-20">
      <div className="page pt-8 sm:pt-12">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-d-lg font-bold" style={{ fontVariationSettings: '"wdth" 86' }}>Deploy</h1>
            <p className="mt-1 text-[14px] text-ink-3" lang="pis">Putum long fon, long laptop, o long WhatsApp</p>
            <p className="lede mt-3">Pick a pack, then where it runs. Every target uses the same graph and the same model files, so a clinic can start on a laptop and move to phones without retraining.</p>
          </div>
        </div>

        {/* Pack picker */}
        <div className="mt-8" role="radiogroup" aria-label="Pack">
          <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:px-0 lg:grid-cols-4">
            {all.map((m) => {
              const on = m.pack_id === current.pack_id;
              const isPreset = SECTORS.includes(m.pack_id as Sector);
              const copy = isPreset ? SECTOR_COPY[m.pack_id as Sector] : null;
              return (
                <div key={m.pack_id} className="relative min-w-[230px] sm:min-w-0">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setSel(m.pack_id!)}
                    className={`h-full w-full rounded-2xl border p-4 text-left transition-[border-color,box-shadow,background-color] ${
                      on ? "border-ink bg-white shadow-lift ring-1 ring-ink" : "border-line bg-white/60 hover:border-ink-4 hover:bg-white"
                    }`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-display text-[17px] font-bold leading-tight">{copy?.title ?? m.graph.name}</span>
                      {m.pack_id === "health" ? <Badge tone="palm" solid>Live</Badge> : isPreset ? <Badge tone="white">Preset</Badge> : <Badge tone="reef">Your export</Badge>}
                    </span>
                    <span className="mt-1 block text-[13px] text-ink-3">
                      {m.models.length} models, {mb(totalMb(m))}, {m.graph.language.join(" + ")}
                    </span>
                  </button>
                  {!isPreset && (
                    <button type="button" onClick={() => remove(m.pack_id!)} className="absolute bottom-2 right-2 rounded-md px-2 py-1 text-[12px] text-ink-3 hover:bg-hibiscus-tint hover:text-hibiscus" aria-label={`Remove ${m.graph.name}`}>
                      Remove
                    </button>
                  )}
                </div>
              );
            })}
            {saved.length === 0 && (
              <Link to="/studio" className="hidden min-w-[230px] flex-col justify-center rounded-2xl border border-dashed border-line p-4 text-[13px] text-ink-3 hover:border-ink-4 hover:text-ink lg:flex">
                <span className="font-display text-[15px] font-semibold text-ink">Your exports land here</span>
                Build a graph in Studio and click Export pack.
              </Link>
            )}
          </div>
        </div>

        {/* Pack summary */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-0">
          <Tabs
            value={view}
            onChange={setView}
            label="Pack details"
            className="border-b-0"
            tabs={[
              { value: "targets", label: "Deploy targets", count: 5 },
              { value: "graph", label: "Graph and models", count: current.models.length },
              { value: "manifest", label: "Manifest" }
            ]}
          />
          <div className="flex flex-wrap gap-2 pb-2">
            <Link to={`/studio?preset=${SECTORS.includes(current.pack_id as Sector) ? current.pack_id : sector}`} className={btnClass("ghost", "sm")}>Open in Studio</Link>
            <button type="button" className={btnClass("ink", "sm")} onClick={exportZip} disabled={busy}>
              {busy ? <><Spinner className="h-3.5 w-3.5" /> Building zip</> : "Download pack zip"}
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5 text-[12px]">
          <Chip tone="white">{current.graph.nodes.length} nodes</Chip>
          <Chip tone={onlineNodes ? "reef" : "palm"}>{onlineNodes ? `${onlineNodes} online nodes` : "all nodes offline"}</Chip>
          <Chip tone="white">Built for {current.graph.target.device}, {current.graph.target.ram_gb} GB RAM</Chip>
          {current.pack_id !== "health" && SECTORS.includes(current.pack_id as Sector) && <Chip tone="frangipani">Base model and placeholder corpus</Chip>}
        </div>
      </div>

      <div className="page mt-6">
        {view === "targets" && (
          <div className="space-y-10">
            <section aria-labelledby="t-offline">
              <h2 id="t-offline" className="flex items-baseline gap-3 font-display text-[22px] font-bold">
                Runs with no signal <span className="text-[14px] font-normal text-ink-3" lang="pis">No nid signal</span>
              </h2>
              <div className="mt-4 grid gap-5 lg:grid-cols-2">
                <PhoneTarget m={current} qr={qr} />
                <AndroidTarget m={current} />
                <LaptopTarget m={current} bridge={bridge} check={check} />
              </div>
            </section>
            <section aria-labelledby="t-online">
              <h2 id="t-online" className="flex items-baseline gap-3 font-display text-[22px] font-bold">
                Chat channels <span className="text-[14px] font-normal text-ink-3">need a signal, model stays on the laptop</span>
              </h2>
              <div className="mt-4 grid gap-5 lg:grid-cols-2">
                <WhatsAppTarget bridge={bridge} check={check} />
                <MessengerTarget bridge={bridge} />
              </div>
              <div className="mt-5">
                <Callout tone="slate" title="Where the data sits">
                  On the phone app, notes stay on the device behind a PIN. On WhatsApp and Messenger, messages pass through Meta and Twilio to the clinic laptop; per-user settings live in <code className="font-mono text-[12.5px]">bridge/.state/users.json</code> on that laptop and nowhere else.
                </Callout>
              </div>
            </section>
          </div>
        )}

        {view === "graph" && (
          <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
            <div className="min-w-0">
              <GraphView graph={current.graph} height={360} />
            </div>
            <div className="card min-w-0 overflow-hidden">
              <h3 className="border-b border-line-2 px-4 py-3 font-display text-[16px] font-bold">Model files</h3>
              <ul className="divide-y divide-line-2">
                {current.models.map((x) => (
                  <li key={x.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <a className="min-w-0 truncate text-[14px] font-medium text-reef hover:underline" href={x.url.startsWith("http") ? x.url : undefined} target="_blank" rel="noreferrer" title={x.url}>{x.id}</a>
                      <span className="shrink-0 text-[13px] font-semibold">{mb(x.size_mb)}</span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 text-[12px] text-ink-3">
                      <span>{x.license}</span>
                      <span>{x.runtime}</span>
                    </div>
                  </li>
                ))}
                {current.models.length === 0 && <li className="px-4 py-3 text-[13px] text-ink-3">No model files; this pack is rules only.</li>}
              </ul>
              <div className="flex items-center justify-between border-t border-line-2 bg-sand/60 px-4 py-2.5 text-[13px]">
                <span className="text-ink-3">Total download</span>
                <span className="font-semibold">{mb(totalMb(current))}</span>
              </div>
            </div>
          </div>
        )}

        {view === "manifest" && (
          <div className="overflow-hidden rounded-2xl border border-canvas-line bg-canvas">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-canvas-line px-4 py-2">
              <span className="min-w-0 truncate font-mono text-[12px] text-canvas-muted" title={manifestUrl(current)}>{manifestUrl(current)}</span>
              <div className="flex items-center gap-1">
                <CopyButton text={JSON.stringify(current, null, 2)} label="Copy JSON" />
                <button
                  type="button"
                  className="rounded-md px-2 py-1 text-[12px] font-medium text-canvas-muted hover:bg-canvas-3 hover:text-white"
                  onClick={() => download(new Blob([JSON.stringify(current, null, 2)], { type: "application/json" }), "manifest.json")}
                >
                  Download manifest.json
                </button>
              </div>
            </div>
            <pre className="max-h-[620px] overflow-auto p-4 font-mono text-[12px] leading-relaxed text-canvas-text"><code>{JSON.stringify(current, null, 2)}</code></pre>
          </div>
        )}
      </div>
    </div>
  );
}
