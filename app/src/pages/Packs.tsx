import { Suspense, lazy, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { PRESETS } from "../data/presets";
import { useStudio } from "../store";
import {
  BRIDGE_URL,
  LAPTOP_9B_COMMAND,
  SYSTEM_PROMPT,
  TWILIO_SANDBOX_NUMBER,
  buildManifest,
  deployTarget,
  fieldAppRoute,
  HOSTED_DEMO_URL,
  hfRepo,
  installerCommand,
  laptopCommands,
  ollamaCommand,
  packLlm,
  qrDataUrl,
  totalMb
} from "../pack";
import {
  Badge,
  Boundary,
  CodeBlock,
  CopyButton,
  Empty,
  Segmented,
  Spinner,
  StatusDot,
  Tabs,
  btnClass,
  mb
} from "../components/ui";
import type { Graph, Manifest, Sector } from "../types";

// The graph preview is lazy and fenced, so this page still works if the canvas bundle is slow or fails.
const GraphViewLazy = lazy(() => import("../components/GraphView").then((m) => ({ default: m.GraphView })));
function SafeGraph({ graph, height }: { graph: Graph; height: number }) {
  const box = <div className="grid place-items-center rounded-xl border border-line bg-white/60 text-[13px] text-ink-3" style={{ height }}>Graph preview unavailable. Open it in Studio.</div>;
  return (
    <Boundary fallback={box}>
      <Suspense fallback={<div className="animate-pulse rounded-xl border border-line bg-white/60" style={{ height }} />}>
        <GraphViewLazy graph={graph} height={height} />
      </Suspense>
    </Boundary>
  );
}

const SECTORS: Sector[] = ["health", "agriculture", "tourism"];
const ALIAS: Record<string, string> = { farm: "agriculture", host: "tourism" };

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
type Bridge = { state: "idle" } | { state: "checking" } | { state: "up"; health: BridgeHealth } | { state: "reachable" } | { state: "down" };

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
  // An opaque request first: one failed request when nothing is listening.
  try {
    await attempt({ mode: "no-cors" });
  } catch {
    return { state: "down" };
  }
  try {
    const r = await attempt({});
    if (r.ok) return { state: "up", health: (await r.json()) as BridgeHealth };
  } catch {
    /* listening, but the browser may not read it (CORS) */
  }
  return { state: "reachable" };
}

function useBridge() {
  // Probed only on a click: an automatic probe of localhost shows a red connection error in devtools for every visitor.
  const [bridge, setBridge] = useState<Bridge>({ state: "idle" });
  const check = useCallback(async () => {
    setBridge({ state: "checking" });
    setBridge(await probeBridge());
  }, []);
  return { bridge, check };
}

function BridgeStatus({ bridge, check }: { bridge: Bridge; check: () => void }) {
  const h = bridge.state === "up" ? bridge.health : null;
  return (
    <div className="rounded-xl border border-line bg-sand/70 p-3.5">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-[14px] font-semibold">
          {bridge.state === "idle" ? (
            <><StatusDot tone="slate" /> Bridge on this laptop: not checked</>
          ) : bridge.state === "checking" ? (
            <><Spinner className="h-3.5 w-3.5 text-ink-3" /> Checking the bridge on this laptop</>
          ) : bridge.state === "up" ? (
            <><StatusDot tone="palm" pulse /> Bridge running{h?.mock ? " (mock replies)" : ""}</>
          ) : bridge.state === "reachable" ? (
            <><StatusDot tone="frangipani" /> Something answers on port 8090</>
          ) : (
            <><StatusDot tone="slate" /> Bridge not running</>
          )}
        </p>
        <button type="button" className={btnClass(bridge.state === "idle" ? "ghost" : "quiet", "sm")} onClick={check} disabled={bridge.state === "checking"}>
          {bridge.state === "idle" ? "Check bridge" : "Check again"}
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
          : bridge.state === "idle"
            ? `Asks ${BRIDGE_URL}/health once you click. Start the bridge with the laptop installer first.`
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
  badges,
  children,
  className = ""
}: {
  icon: keyof typeof ICONS;
  title: string;
  pis?: string;
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
          </div>
        </div>
        {badges && <div className="flex flex-wrap gap-1.5">{badges}</div>}
      </header>
      <div className="mt-5 flex min-w-0 flex-1 flex-col">{children}</div>
    </article>
  );
}

function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol className="space-y-2.5">
      {items.map((c, i) => (
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

function OneLiner({ title, note, code }: { title: string; note?: string; code: string }) {
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-start gap-1.5 rounded-xl border border-canvas-line bg-canvas py-1.5 pl-3 pr-1.5">
        <span className="select-none pt-[3px] font-mono text-[12.5px] leading-relaxed text-canvas-muted">$</span>
        <code className="min-w-0 flex-1 break-all pt-[3px] font-mono text-[12.5px] leading-relaxed text-canvas-text">{code}</code>
        <CopyButton text={code} />
      </div>
      <p className="mt-1 px-1 text-[12.5px] text-ink-3"><b className="font-semibold text-ink-2">{title}.</b> {note}</p>
    </div>
  );
}


/* ------------------------------------------------------------------ targets */

function PhoneTarget({ m, qr, onLaunch }: { m: Manifest; qr: string; onLaunch: () => void }) {
  return (
    <Target
      icon="phone"
      title="Phone app (offline PWA)"
      badges={<><Badge tone="palm" dot>Works offline</Badge><Badge tone="white">{mb(totalMb(m))} once</Badge></>}
    >
      <div className="grid gap-5 sm:grid-cols-[160px_1fr]">
        <div className="text-center">
          <div className="mx-auto w-[160px] rounded-2xl border border-line bg-white p-2 shadow-card">
            {qr ? <img src={qr} alt="QR code that opens the Lokol field app on a phone" className="block w-full" width={160} height={160} /> : <div className="aspect-square w-full animate-pulse rounded-lg bg-sand" />}
          </div>
          <p className="mt-2 text-[12.5px] text-ink-3">Scan with the phone camera</p>
        </div>
        <div className="min-w-0">
          <button type="button" className={`${btnClass("ink")} w-full justify-center sm:w-auto`} onClick={onLaunch}>
            Launch field app
          </button>
          <p className="mt-1.5 text-[12.5px] text-ink-3">Opens {m.graph.name} on this device, exactly as set in Studio.</p>
          <div className="mt-4">
            <Steps
              items={[
                <>Scan the code, or open <a className="link" href={HOSTED_DEMO_URL} target="_blank" rel="noreferrer">{HOSTED_DEMO_URL.replace("https://", "")}</a> in Chrome on Android or Safari on iPhone.</>,
                <>Wait once, with signal, while {mb(totalMb(m))} of models download. They stay cached on the phone.</>,
                <>Add to Home Screen: Chrome menu <b className="font-semibold text-ink">Add to home screen</b>, or Safari <b className="font-semibold text-ink">Share, Add to Home Screen</b>. From then on it opens and answers in airplane mode.</>
              ]}
            />
          </div>
        </div>
      </div>
    </Target>
  );
}

function AndroidTarget({ m }: { m: Manifest }) {
  const llm = packLlm(m);
  const repo = llm ? hfRepo(llm.url) : null;
  return (
    <Target icon="android" title="Android, native" badges={<><Badge tone="palm" dot>Works offline</Badge>{llm && <Badge tone="white">{mb(llm.size_mb)}</Badge>}</>}>
      {llm ? (
        <>
          <Steps
            items={[
              <>Install <b className="font-semibold text-ink">PocketPal AI</b> from Google Play.</>,
              repo ? (
                <>
                  <b className="font-semibold text-ink">Models</b>, <b className="font-semibold text-ink">+</b>, <b className="font-semibold text-ink">Add from Hugging Face</b>, search <Inline copy>{repo}</Inline> and download <Inline>{llm.file}</Inline>. No signal later? Copy the file by USB and use <b className="font-semibold text-ink">Add local model</b>.
                </>
              ) : (
                <>Copy <Inline>{llm.file}</Inline> to the phone by USB or SD card, then <b className="font-semibold text-ink">Models</b>, <b className="font-semibold text-ink">Add local model</b>.</>
              ),
              <>Load it, open the model settings and paste the system prompt below.</>
            ]}
          />
          <div className="mt-4 overflow-hidden rounded-xl border border-line bg-sand/60">
            <div className="flex items-center justify-between border-b border-line-2 px-3 py-1">
              <span className="text-[12px] font-medium text-ink-3">System prompt</span>
              <CopyButton text={SYSTEM_PROMPT} dark={false} />
            </div>
            <p className="max-h-[96px] overflow-y-auto px-3 py-2 text-[12.5px] leading-relaxed text-ink-2">{SYSTEM_PROMPT}</p>
          </div>
          <p className="mt-3 text-[13px] leading-relaxed text-ink-3">PocketPal runs the tuned model only; the guideline lookup and safety gate live in the phone app.</p>
        </>
      ) : (
        <Empty title="No language model in this pack" body="Add a Language model node in Studio, then come back to deploy it to Android." />
      )}
    </Target>
  );
}

function LaptopTarget({ m }: { m: Manifest }) {
  const llm = packLlm(m);
  // Lokol Health packs run the 1.7B on a laptop (the phone default is 0.6B); other packs run their own model.
  const own = llm && !/^lokol-health/.test(llm.id) ? llm : undefined;
  return (
    <Target icon="laptop" title="Laptop or clinic PC" badges={<Badge tone="palm" dot>Works offline</Badge>}>
      <div className="space-y-3">
        <OneLiner title="Ollama, one line" note="Template, system prompt and settings come from the Hugging Face repo." code={ollamaCommand(own)} />
        <OneLiner title="Lokol installer: model server + WhatsApp/Messenger bridge" note="macOS or Linux. Add --voice for Pijin speech, --tunnel for a public URL, --dry-run to see the plan." code={installerCommand()} />
        <OneLiner title="Offline 9B on a 16 GB laptop" note="Qwen3.5-9B with the Lokol Health LoRA, served by llama.cpp." code={LAPTOP_9B_COMMAND} />
        <details className="group rounded-xl border border-line bg-white/60">
          <summary className="cursor-pointer select-none px-3 py-2 text-[13px] font-medium text-ink-2 hover:text-ink">By hand, step by step</summary>
          <div className="px-3 pb-3"><CodeBlock code={laptopCommands(llm)} title="From the Lokol repo folder" /></div>
        </details>
      </div>
    </Target>
  );
}

function ChatTarget({ bridge, check }: { bridge: Bridge; check: () => void }) {
  const [ch, setCh] = useState<"whatsapp" | "messenger">("whatsapp");
  return (
    <Target icon={ch} title="WhatsApp or Messenger" badges={<><Badge tone="reef" dot>Needs signal</Badge><Badge tone="white">Model stays on the laptop</Badge></>}>
      <OneLiner title="Start the bridge with a public tunnel" note="Same installer as the laptop; prints the webhook URLs to paste below." code={installerCommand("1.7b", { tunnel: true })} />
      <div className="mt-4 mb-3">
        <Segmented value={ch} onChange={setCh} label="Channel" options={[{ value: "whatsapp", label: "WhatsApp (Twilio)" }, { value: "messenger", label: "Messenger" }]} />
      </div>
      {ch === "whatsapp" ? <WhatsAppSteps bridge={bridge} /> : <MessengerSteps bridge={bridge} />}
      <p className="mt-3 text-[13px] leading-relaxed text-ink-3">SMS works on a Twilio free trial too: set the trial number's incoming-message webhook to <Inline copy>{"<PUBLIC_BASE_URL>/twilio/sms"}</Inline>.</p>
      <div className="mt-auto pt-4">
        <BridgeStatus bridge={bridge} check={check} />
      </div>
    </Target>
  );
}

function WhatsAppSteps({ bridge }: { bridge: Bridge }) {
  const base = bridge.state === "up" && bridge.health.public_base_url ? bridge.health.public_base_url.replace(/\/$/, "") : "<PUBLIC_BASE_URL>";
  return (
    <>
      <Steps
        items={[
          <>Start the bridge on the laptop, then a tunnel: <Inline copy>cloudflared tunnel --url http://localhost:8090</Inline>. Put the https address in <code className="font-mono text-[12.5px]">.env</code> as <code className="font-mono text-[12.5px]">PUBLIC_BASE_URL</code>.</>,
          <>In WhatsApp, send your sandbox join code (<Inline>join two-words</Inline>, shown in the Twilio console) to <b className="font-semibold text-ink">{TWILIO_SANDBOX_NUMBER}</b>.</>,
          <>Twilio console, Messaging, Try it out, Sandbox settings: set <b className="font-semibold text-ink">When a message comes in</b> to <Inline copy>{`${base}/twilio/whatsapp`}</Inline> with POST.</>,
          <>Send <Inline>/help</Inline>, then a nurse message. Voice notes are transcribed by the sidecar and answered with text and a Pijin voice note.</>
        ]}
      />
      <p className="mt-3 text-[13px] leading-relaxed text-ink-3">The sandbox only answers numbers that joined, and membership lapses after 72 hours. Messages go through the laptop's model, never a cloud LLM.</p>
    </>
  );
}

function MessengerSteps({ bridge }: { bridge: Bridge }) {
  const base = bridge.state === "up" && bridge.health.public_base_url ? bridge.health.public_base_url.replace(/\/$/, "") : "<PUBLIC_BASE_URL>";
  const ready = bridge.state === "up" && bridge.health.messenger?.send_configured;
  return (
    <>
      {bridge.state === "up" && <div className="mb-3"><Badge tone={ready ? "palm" : "white"}>{ready ? "Page token set" : "No page token"}</Badge></div>}
      <Steps
        items={[
          <>At developers.facebook.com create an app (type Business) and add the <b className="font-semibold text-ink">Messenger</b> product.</>,
          <>Messenger settings, Access tokens: add a Page you manage, generate a token, save it as <code className="font-mono text-[12.5px]">META_PAGE_TOKEN</code>.</>,
          <>Webhooks: callback URL <Inline copy>{`${base}/messenger/webhook`}</Inline>, verify token = your <code className="font-mono text-[12.5px]">META_VERIFY_TOKEN</code> (default <Inline>lokol-verify</Inline>). Subscribe the Page to <b className="font-semibold text-ink">messages</b>.</>,
          <>Message the Page from Messenger. In development mode only app admins and testers get replies.</>
        ]}
      />
      <p className="mt-3 text-[13px] leading-relaxed text-ink-3">Messaging in Solomon Islands leans towards Messenger, so the bridge treats it as a first-class channel next to WhatsApp.</p>
    </>
  );
}

/* ------------------------------------------------------------------ page */

type Launch = "phone" | "android" | "laptop" | "chat";
type Source = { graph: Graph; packKey: string; via: "studio" | "query" | "store" | "preset" };

/** The pack Deploy ships: the graph handed over by the Studio Deploy button, else ?pack=, else the Studio's saved canvas, else Lokol Health. */
function useDeploySource(): Source {
  const loc = useLocation();
  const st = loc.state as { graph?: Graph; packKey?: string } | null;
  const storeGraph = useStudio((s) => s.graph);
  const storeKey = useStudio((s) => s.packKey);
  const query = new URLSearchParams(loc.search).get("pack");
  const [queried, setQueried] = useState<Source | null>(null);
  useEffect(() => {
    if (!query || st?.graph) return;
    const q = ALIAS[query] ?? query;
    if (SECTORS.includes(q as Sector)) {
      setQueried({ graph: PRESETS[q as Sector], packKey: q, via: "query" });
      return;
    }
    if (!q.startsWith("idb:")) return;
    let alive = true;
    import("../runtime/corpus_builder")
      .then(({ getPack }) => getPack(q.slice(4)))
      .then((p) => {
        const g = (p?.manifest as unknown as Manifest | undefined)?.graph;
        if (alive && p && g) setQueried({ graph: { ...g, name: p.name }, packKey: q, via: "query" });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [query, st?.graph]);
  if (st?.graph) return { graph: st.graph, packKey: st.packKey ?? storeKey, via: "studio" };
  if (queried) return queried;
  if (storeGraph) return { graph: storeGraph, packKey: storeKey, via: "store" };
  return { graph: PRESETS.health, packKey: "health", via: "preset" };
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-ink-3">{label}</dt>
      <dd className="truncate text-[14px] font-semibold text-ink">{children}</dd>
    </div>
  );
}

export default function Packs() {
  const navigate = useNavigate();
  const source = useDeploySource();
  const target = useMemo(() => deployTarget(source.packKey, source.graph), [source.packKey, source.graph]);
  const current = useMemo(() => buildManifest(source.graph, undefined, target.pack_id), [source.graph, target.pack_id]);
  const [qr, setQr] = useState<string>("");
  const [launch, setLaunch] = useState<Launch>("phone");
  const { bridge, check } = useBridge();

  useEffect(() => {
    let alive = true;
    qrDataUrl(HOSTED_DEMO_URL).then((u) => alive && setQr(u)).catch(() => alive && setQr(""));
    return () => {
      alive = false;
    };
  }, []);

  const launchFieldApp = () => {
    // A saved custom pack opens by id (it carries its own guideline index); everything else runs this exact graph.
    if (target.idb) navigate(fieldAppRoute(target));
    else navigate("/demo", { state: { graph: current.graph } });
  };
  const editInStudio = () => navigate(source.via === "query" ? `/studio?pack=${encodeURIComponent(source.packKey)}` : "/studio");

  const g = current.graph;
  const rag = g.nodes.find((n) => n.type === "rag");
  const voiceIn = g.nodes.some((n) => n.type === "stt");
  const voiceOut = g.nodes.some((n) => n.type === "tts");
  const online = g.nodes.filter((n) => n.online).length;
  const kind = target.idb ? "Custom pack" : target.pack_id === "health" ? "Lokol Health" : SECTORS.includes(target.pack_id as Sector) ? "Sample pack" : "Studio pack";

  return (
    <div className="pb-16">
      <div className="page pt-6 sm:pt-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display text-d-lg font-bold" style={{ fontVariationSettings: '"wdth" 86' }}>Deploy</h1>
            <p className="lede mt-2">Ships the pack as set in Studio. Change anything there, then come back.</p>
          </div>
          <button type="button" className={btnClass("ghost")} onClick={editInStudio}>
            Edit in Studio
          </button>
        </div>

        {/* 1. What ships */}
        <section className="card mt-6 p-5 sm:p-6" aria-labelledby="dep-ships">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="dep-ships" className="font-display text-[22px] font-bold leading-tight">What ships</h2>
            <div className="flex flex-wrap gap-1.5">
              <Badge tone={target.idb || target.pack_id === "health" ? "reef" : "white"}>{kind}</Badge>
              <Badge tone={online ? "reef" : "palm"} dot>{online ? `Internet on, ${online} online steps` : "Internet off"}</Badge>
            </div>
          </div>
          <div className="mt-4 grid gap-5 lg:grid-cols-[1fr_minmax(0,420px)]">
            <div className="min-w-0">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                <Fact label="Pack">{g.name}</Fact>
                <Fact label="Device">{g.target.device} ({g.target.ram_gb} GB RAM)</Fact>
                <Fact label="Download, once">{mb(totalMb(current))}</Fact>
                <Fact label="Voice in">{voiceIn ? "On" : "Off, text only"}</Fact>
                <Fact label="Voice out">{voiceOut ? "On" : "Off, text only"}</Fact>
                <Fact label="Answers from">{rag ? rag.label : "No guideline lookup"}</Fact>
              </dl>
              <ul className="mt-4 divide-y divide-line-2 overflow-hidden rounded-xl border border-line bg-white/60">
                {current.models.map((x) => (
                  <li key={x.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="min-w-0">
                      <a className="block truncate text-[13.5px] font-medium text-reef hover:underline" href={x.url.startsWith("http") ? x.url : undefined} target="_blank" rel="noreferrer" title={x.url}>{x.id}</a>
                      <span className="text-[12px] text-ink-3">{x.license} · {x.runtime}</span>
                    </span>
                    <span className="shrink-0 text-[13px] font-semibold">{mb(x.size_mb)}</span>
                  </li>
                ))}
                {current.models.length === 0 && <li className="px-3 py-2 text-[13px] text-ink-3">No model files; this pack is rules only.</li>}
              </ul>
            </div>
            <div className="min-w-0">
              <SafeGraph graph={g} height={230} />
            </div>
          </div>
          <details className="group mt-4 overflow-hidden rounded-xl border border-canvas-line bg-canvas">
            <summary className="cursor-pointer select-none px-4 py-2 text-[13px] font-medium text-canvas-text">
              Finalized configuration (manifest.json, read-only)
            </summary>
            <div className="flex justify-end border-t border-canvas-line px-2 py-1">
              <CopyButton text={JSON.stringify(current, null, 2)} label="Copy JSON" />
            </div>
            <pre className="max-h-[420px] overflow-auto border-t border-canvas-line p-4 font-mono text-[12px] leading-relaxed text-canvas-text"><code>{JSON.stringify(current, null, 2)}</code></pre>
          </details>
        </section>

        {/* 2. Launch */}
        <section className="mt-8" aria-labelledby="dep-launch">
          <h2 id="dep-launch" className="font-display text-[22px] font-bold leading-tight">Launch</h2>
          <div className="mt-3">
            <Tabs
              value={launch}
              onChange={setLaunch}
              label="Launch target"
              tabs={[
                { value: "phone", label: "Phone app" },
                { value: "android", label: "Android native" },
                { value: "laptop", label: "Laptop / PC" },
                { value: "chat", label: "WhatsApp / Messenger" }
              ]}
            />
          </div>
          <div className="mt-4">
            {launch === "phone" && <PhoneTarget m={current} qr={qr} onLaunch={launchFieldApp} />}
            {launch === "android" && <AndroidTarget m={current} />}
            {launch === "laptop" && <LaptopTarget m={current} />}
            {launch === "chat" && <ChatTarget bridge={bridge} check={check} />}
          </div>
        </section>
      </div>
    </div>
  );
}
