import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PRESETS, SECTOR_COPY } from "../data/presets";
import { NODE_META } from "../models";
import { ActionBadge, Badge, NODE_GLOW, SignalBars, btnClass, mb } from "../components/ui";
import type { Graph, NodeType, Sector } from "../types";
import { isSignedOut, setSignedOut } from "../components/Profile";
import { GITHUB_URL } from "../components/Shell";

const SECTORS: Sector[] = ["health", "agriculture", "tourism"];

function useReducedMotion() {
  const [r, setR] = useState(false);
  useEffect(() => {
    const m = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!m) return;
    setR(m.matches);
    const on = () => setR(m.matches);
    m.addEventListener?.("change", on);
    return () => m.removeEventListener?.("change", on);
  }, []);
  return r;
}

/* ------------------------------------------------------------------ hero graph */

type HeroNode = { type: NodeType; title: string; sub: string };

const HERO_NODES: HeroNode[] = [
  { type: "channel", title: "Nurse aide types", sub: "Types or speaks, no signal" },
  { type: "rag", title: "STM lookup", sub: "Malaria, p.53" },
  { type: "llm", title: "Lokol Health 0.6B", sub: "0.4 GB, on the phone" },
  { type: "gate", title: "Safety gate", sub: "red flag: no fit dring" },
  { type: "tts", title: "Speech out", sub: "Reads the reply aloud" }
];

function HeroGraph({ vertical }: { vertical: boolean }) {
  const reduced = useReducedMotion();
  const uid = vertical ? "hv" : "hh";
  const W = vertical ? 214 : 184;
  const H = 70;
  const pos = vertical
    ? HERO_NODES.map((_, i) => ({ x: i % 2 === 0 ? 14 : 112, y: 12 + i * 104 }))
    : HERO_NODES.map((_, i) => ({ x: 20 + i * 218, y: i % 2 === 0 ? 92 : 22 }));
  const vbW = vertical ? 340 : 20 + 4 * 218 + W + 20;
  const vbH = vertical ? 12 + 4 * 104 + H + 14 : 190;

  const edge = (a: number, b: number) => {
    const A = pos[a], B = pos[b];
    if (vertical) {
      const x1 = A.x + W / 2, y1 = A.y + H, x2 = B.x + W / 2, y2 = B.y;
      const c = (y2 - y1) / 2;
      return `M${x1},${y1} C${x1},${y1 + c} ${x2},${y2 - c} ${x2},${y2}`;
    }
    const x1 = A.x + W, y1 = A.y + H / 2, x2 = B.x, y2 = B.y + H / 2;
    const c = (x2 - x1) / 2;
    return `M${x1},${y1} C${x1 + c},${y1} ${x2 - c},${y2} ${x2},${y2}`;
  };
  // One path the message travels: through each card and along each edge.
  const travel = HERO_NODES.map((_, i) => {
    const P = pos[i];
    const into = vertical ? `${P.x + W / 2},${P.y}` : `${P.x},${P.y + H / 2}`;
    const out = vertical ? `${P.x + W / 2},${P.y + H}` : `${P.x + W},${P.y + H / 2}`;
    const seg = i === 0 ? `M${into} L${out}` : `${edge(i - 1, i).replace(/^M[^C]+/, "")} L${out}`;
    return seg;
  }).join(" ");

  return (
    <svg viewBox={`0 0 ${vbW} ${vbH}`} className="h-auto w-full" role="img" aria-label="A nurse aide's Pijin message passes through guideline lookup, a 0.6B model, the safety gate and Pijin voice, all on the phone with no signal">
      <defs>
        {HERO_NODES.map((n) => (
          <filter key={n.type} id={`${uid}-glow-${n.type}`} x="-30%" y="-40%" width="160%" height="180%">
            <feDropShadow dx="0" dy="0" stdDeviation="9" floodColor={NODE_GLOW[n.type]} floodOpacity="0.45" />
          </filter>
        ))}
        <radialGradient id={`${uid}-pulse`} r="0.5">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="0.45" stopColor="#2EC4D3" />
          <stop offset="1" stopColor="#2EC4D3" stopOpacity="0" />
        </radialGradient>
      </defs>
      {HERO_NODES.slice(1).map((n, i) => (
        <g key={n.type}>
          <path d={edge(i, i + 1)} fill="none" stroke="#24465A" strokeWidth="6" strokeLinecap="round" />
          <path d={edge(i, i + 1)} fill="none" stroke={NODE_GLOW[HERO_NODES[i].type]} strokeOpacity="0.85" strokeWidth="2" className="edge-dash" />
        </g>
      ))}
      {!reduced && (
        <circle r="9" fill={`url(#${uid}-pulse)`}>
          <animateMotion dur="5.5s" repeatCount="indefinite" path={travel} keyPoints="0;1" keyTimes="0;1" calcMode="linear" />
        </circle>
      )}
      {HERO_NODES.map((n, i) => {
        const P = pos[i];
        const c = NODE_GLOW[n.type];
        return (
          <g key={n.type} transform={`translate(${P.x},${P.y})`}>
            <rect width={W} height={H} rx="13" fill="#F8FBFA" filter={`url(#${uid}-glow-${n.type})`} />
            <rect x="0.5" y="0.5" width={W - 1} height={H - 1} rx="12.5" fill="none" stroke="#FFFFFF" strokeOpacity="0.7" />
            <rect x="0" y="12" width="5" height={H - 24} rx="2.5" fill={c} />
            <text x="18" y="21" fontFamily="'Instrument Sans', system-ui, sans-serif" fontSize="11.5" fontWeight="600" fill="#5C7482">
              {NODE_META[n.type]?.name ?? n.type}
            </text>
            <text x="18" y="41" fontFamily="'Bricolage Grotesque', system-ui, sans-serif" fontWeight="700" fontSize="16" fill="#102C3C">{n.title}</text>
            <text x="18" y="58" fontFamily="'Instrument Sans', system-ui, sans-serif" fontSize="12" fill="#5C7482">{n.sub}</text>
            {n.type === "gate" && <circle cx={W - 16} cy="16" r="4.5" fill="#F2647E"><title>Red flag matched</title></circle>}
          </g>
        );
      })}
    </svg>
  );
}

function HeroPanel() {
  return (
    <div className="canvas-dots relative overflow-hidden rounded-[22px] border border-canvas-line text-canvas-text shadow-lift">
      <div className="canvas-vignette pointer-events-none absolute inset-0" aria-hidden />
      <div className="relative flex flex-wrap items-center justify-between gap-3 border-b border-canvas-line/80 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="font-display text-[15px] font-semibold text-white">Lokol Health</span>
          <span className="hidden text-[13px] text-canvas-muted sm:inline">Samsung Galaxy A02, 2 GB RAM</span>
        </div>
        <div className="flex items-center gap-2 text-[12px] font-semibold">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-palm/20 px-2.5 py-1 text-glow-stt">
            <SignalBars bars={0} /> No signal
          </span>
          <span className="rounded-full bg-canvas-3 px-2.5 py-1 text-canvas-muted">0.5 GB on the phone</span>
        </div>
      </div>
      <div className="relative px-3 pb-2 pt-4 sm:px-6">
        <div className="hidden sm:block"><HeroGraph vertical={false} /></div>
        <div className="mx-auto max-w-[360px] sm:hidden"><HeroGraph vertical /></div>
      </div>
      <div className="relative grid gap-3 border-t border-canvas-line/80 bg-canvas/60 px-4 py-4 sm:grid-cols-[1fr_1.25fr] sm:gap-6 sm:px-6">
        <figure className="min-w-0">
          <figcaption className="text-[12px] font-medium text-canvas-muted">Nurse aide, Pijin</figcaption>
          <p className="mt-1.5 rounded-2xl rounded-bl-md bg-canvas-3 px-3.5 py-2.5 text-[14.5px] leading-snug text-white" lang="pis">
            Pikinini 24 manis, 12.7 kilo. Hem hot bodi 3 dei an hem toraot evri samting. No fit dring. Bot go long Auki tumoro moning nomoa.
          </p>
        </figure>
        <figure className="min-w-0">
          <figcaption className="flex flex-wrap items-center gap-2 text-[12px] font-medium text-canvas-muted">
            Lokol replies, offline
            <span className="rounded-md bg-canvas-3 px-1.5 py-0.5 text-[11px] text-glow-rag">STM: Malaria, p.53</span>
          </figcaption>
          <div className="mt-1.5 rounded-2xl rounded-bl-md bg-[#F8FBFA] px-3.5 py-3 text-ink">
            <ActionBadge action="REFER_NEXT_TRANSPORT" size="md" pijin />
            <p className="mt-2 text-[14.5px] leading-snug" lang="pis">
              Diswan hem saen blong denja. Pikinini mas go long hospital long bot tumoro moning. Taem yu wet: givim artesunate, an lukim blood sugar.
            </p>
          </div>
        </figure>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ mini graph (pack previews) */

function MiniGraph({ graph }: { graph: Graph }) {
  const xs = graph.nodes.map((n) => n.position.x);
  const ys = graph.nodes.map((n) => n.position.y);
  const W = 190, H = 64, pad = 18;
  const minX = Math.min(...xs) - pad, minY = Math.min(...ys) - pad;
  const vbW = Math.max(...xs) + W + pad - minX;
  const vbH = Math.max(...ys) + H + pad - minY;
  const byId = Object.fromEntries(graph.nodes.map((n) => [n.id, n]));
  return (
    <svg viewBox={`${minX} ${minY} ${vbW} ${vbH}`} className="h-full w-full" aria-hidden preserveAspectRatio="xMidYMid meet">
      {graph.edges.map((e) => {
        const A = byId[e.from], B = byId[e.to];
        if (!A || !B) return null;
        const x1 = A.position.x + W, y1 = A.position.y + H / 2, x2 = B.position.x, y2 = B.position.y + H / 2;
        const c = Math.max(30, (x2 - x1) / 2);
        return <path key={e.from + e.to} d={`M${x1},${y1} C${x1 + c},${y1} ${x2 - c},${y2} ${x2},${y2}`} fill="none" stroke={B.online || A.online ? "#B394F0" : "#3D6276"} strokeWidth="5" strokeDasharray={B.online || A.online ? "4 10" : undefined} strokeLinecap="round" />;
      })}
      {graph.nodes.map((n) => (
        <g key={n.id} transform={`translate(${n.position.x},${n.position.y})`}>
          <rect width={W} height={H} rx="14" fill="#F8FBFA" />
          <rect x="0" y="10" width="9" height={H - 20} rx="4" fill={NODE_GLOW[n.type]} />
          <rect x="26" y="20" width={Math.min(140, 40 + n.label.length * 4)} height="9" rx="4.5" fill="#102C3C" opacity="0.75" />
          <rect x="26" y="37" width="70" height="7" rx="3.5" fill="#8A9EA8" opacity="0.6" />
          {n.online && <circle cx={W - 18} cy="18" r="7" fill="#B394F0" />}
        </g>
      ))}
    </svg>
  );
}

/* ------------------------------------------------------------------ content */

const FACTS = [
  {
    figure: "73%",
    what: "of Solomon Islanders live in rural areas, spread over hundreds of islands.",
    so: "So the answer has to come from the phone, not a server in Honiara.",
    source: "DataReportal, Digital 2026: Solomon Islands",
    href: "https://datareportal.com/reports/digital-2026-solomon-islands"
  },
  {
    figure: "524 : 153",
    what: "nurse aides to doctors and dentists in the national health workforce (2010).",
    so: "So nurse aides make most first calls, often alone at a post.",
    source: "Rural and Remote Health 2096, workforce counts for 2010",
    href: "https://www.rrh.org.au/journal/article/2096"
  },
  {
    figure: "3.5%",
    what: "of rural households have grid electricity; 81% light their homes with solar.",
    so: "So models stay small and replies short, for phones charged by a panel.",
    source: "Solomon Islands 2019 Population and Housing Census, Vol. 2, table H17",
    href: "https://solomons.gov.sb/wp-content/uploads/2023/09/Solomon-Islands-2019-Census-Report-Vol-2_Basic-Tables_Operations.pdf"
  }
];

const STEPS = [
  { to: "/recommend", t: "Check the device", cta: "Check a device", b: "Name the phone or laptop and the signal. Lokol picks a model size for every step and says what will not fit." },
  { to: "/packs", t: "Build a pack from a guideline", cta: "See packs", b: "Upload the manual your workers already use. Lokol Health was built this way from the Solomon Islands children's treatment manual, with fine-tuned models." },
  { to: "/studio?pack=health", t: "Shape it in Studio", cta: "Open Studio", b: "Four stages: hear, look up, think, respond. Swap model sizes, turn voice and internet on or off, open a model card for its training and test results, and do a test run." },
  { to: "/deploy", t: "Deploy offline or to WhatsApp", cta: "Deploy a pack", b: "A QR for the offline phone app, a GGUF for PocketPal, commands for a clinic laptop, or a WhatsApp and Messenger bridge." },
  { to: "/demo", t: "Try it with no signal", cta: "Try the field app", b: "Speak or type a case and hear the answer read aloud, every step running on this device, with the safety check before the reply." }
];

/** One tone per step, following the node colours along the pipeline. */
const STEP_TONES = ["#7FB3C8", "#2EC4D3", "#F2B84B", "#5CC48A", "#B394F0", "#0F7B88"];

const WILL_NOT = [
  { t: "No diagnosis", b: "It applies the Standard Treatment Manual and cites the page it used. It never reads images and never names a disease on its own authority." },
  { t: "A person decides", b: "Every reply is advice to the nurse aide. Referral, treatment and what to tell the family stay her call." },
  { t: "Not sure, ask a person", b: "No matching section, an adult patient, a dose outside the manual: it says so and names who to ask, instead of guessing." },
  { t: "Data stays on the phone", b: "Notes live on the device behind a PIN. Nothing leaves unless a node is switched online and the nurse taps send." }
];

/* ------------------------------------------------------------------ launch + evidence */

/** Primary CTA: "signs in" to the sample workspace and opens the Studio app. */
function LaunchButton({ variant = "ink", size = "lg", label = "Launch Lokol Studio" }: { variant?: "ink" | "ghost" | "on-dark" | "glow"; size?: "sm" | "md" | "lg"; label?: string }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      className={btnClass(variant, size)}
      onClick={() => {
        setSignedOut(false);
        navigate("/app");
      }}
    >
      {label}
    </button>
  );
}

type EvRow = { size: string; where: string; base: { act: number; flag: number }; tuned: { act: number; flag: number } };
/* From public/eval/results.json (300 held-out cases); refreshed from the file when it loads. */
const EV_FALLBACK: EvRow[] = [
  { size: "0.6B", where: "2 GB phones, 0.4 GB", base: { act: 0, flag: 0 }, tuned: { act: 0.637, flag: 0.948 } },
  { size: "1.7B", where: "4 GB phones, 1.1 GB", base: { act: 0, flag: 0 }, tuned: { act: 0.643, flag: 0.965 } },
  { size: "9B", where: "clinic laptop or River", base: { act: 0, flag: 0 }, tuned: { act: 0.87, flag: 0.837 } }
];

function useEvidence() {
  const [rows, setRows] = useState<EvRow[]>(EV_FALLBACK);
  const [n, setN] = useState(300);
  useEffect(() => {
    let alive = true;
    fetch("/eval/results.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d?.rows) return;
        const next = EV_FALLBACK.map((row) => {
          const m = (v: string) => d.rows.find((x: any) => x.size === row.size && x.variant === v)?.metrics;
          const b = m("base"), t = m("tuned");
          return b && t ? { ...row, base: { act: b.action_accuracy, flag: b.red_flag_recall }, tuned: { act: t.action_accuracy, flag: t.red_flag_recall } } : row;
        });
        setRows(next);
        if (d.test_set?.n) setN(d.test_set.n);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return { rows, n };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

function Evidence() {
  const { rows, n } = useEvidence();
  return (
    <section className="page mt-20 sm:mt-28" aria-labelledby="evidence">
      <div className="grid gap-4 lg:grid-cols-12">
        <h2 id="evidence" className="scroll-mt-20 font-display text-d-md font-bold lg:col-span-5">Evidence, not a promise</h2>
        <p className="lede lg:col-span-6 lg:col-start-7 lg:self-end">
          {n} held-out test cases, never seen in training. The same models before and after fine-tuning on the treatment manual. Stock models are never shown the reply format the app reads, so the app cannot use any of their answers and they score zero. Given two worked examples in the prompt, they still miss the format about four times in five.
        </p>
      </div>
      <div className="mt-8 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-3">
        {rows.map((r) => (
          <div key={r.size} className="bg-paper p-6">
            <p className="font-display text-[22px] font-bold">Lokol Health {r.size}</p>
            <p className="text-[13px] text-ink-3">{r.where}</p>
            <dl className="mt-4 grid grid-cols-2 gap-4">
              <div>
                <dt className="text-[13px] text-ink-2">Catches danger signs</dt>
                <dd className="font-display text-[40px] font-bold leading-none tabular-nums">{pct(r.tuned.flag)}</dd>
                <dd className="mt-1 text-[12.5px] text-frangipani-deep">stock model {pct(r.base.flag)}</dd>
              </div>
              <div>
                <dt className="text-[13px] text-ink-2">Right action</dt>
                <dd className="font-display text-[40px] font-bold leading-none tabular-nums">{pct(r.tuned.act)}</dd>
                <dd className="mt-1 text-[12.5px] text-frangipani-deep">stock model {pct(r.base.act)}</dd>
              </div>
            </dl>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[13px] text-ink-3">
        The safety gate adds a second check on top of the model: it refers any message with a danger sign, even when the model misses it. Full results and every metric are in Lokol Studio under Evaluate.
      </p>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="page my-20 sm:my-28" aria-labelledby="cta">
      <div className="canvas-dots relative overflow-hidden rounded-[22px] border border-canvas-line px-6 py-10 text-canvas-text sm:px-10 sm:py-14">
        <div className="canvas-vignette pointer-events-none absolute inset-0" aria-hidden />
        <div className="relative max-w-[60ch]">
          <h2 id="cta" className="font-display text-d-md font-bold text-white">Build a pack for your phones</h2>
          <p className="mt-3 text-[16px] leading-relaxed text-canvas-muted">
            Check a device, compose the pack, test it, and deploy it to a phone that never sees a signal. Or open the field app and talk to Lokol Health now.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <LaunchButton variant="glow" />
            <Link to="/demo" className={btnClass("on-dark", "lg")}>Try the field app</Link>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer" className={btnClass("on-dark", "lg")}>GitHub</a>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ page */

export default function Home() {
  const [signedOut] = useState(isSignedOut);
  return (
    <div className="pb-0">
      {signedOut && (
        <div className="border-b border-line/70 bg-paper-2/70">
          <p className="page py-2 text-[13.5px] text-ink-2" role="status">
            You signed out of the sample workspace. Launch Lokol Studio to sign back in.
          </p>
        </div>
      )}
      {/* Hero */}
      <section className="page pt-10 sm:pt-16">
        <h1
          className="max-w-[16ch] font-display text-d-xl font-bold text-ink [text-wrap:balance]"
          style={{ fontVariationSettings: '"wdth" 82, "opsz" 96' }}
        >
          Build small AI helpers that run where the signal does not.
        </h1>
        <div className="mt-8 grid gap-6 lg:grid-cols-12 lg:gap-10">
          <div className="lg:col-span-4">
            <p className="font-display text-[26px] font-semibold leading-tight text-reef-deep sm:text-[30px]" lang="pis" style={{ fontVariationSettings: '"wdth" 90' }}>
              Smol AI blong iumi.
            </p>
            <p className="mt-1 text-[14px] text-ink-3">Pijin for "our own small AI". Lokol means local.</p>
          </div>
          <div className="lg:col-span-8">
            <p className="lede">
              Lokol Studio builds small agentic helper bots that run offline. Each one hears a question, looks it up in your guideline, thinks with a small fine-tuned model behind a safety check, and responds by text or voice. Studio picks what fits a given phone, shows how each model was trained and tested, and deploys the helper as a pack that works with no signal.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <LaunchButton />
              <Link to="/demo" className={btnClass("ghost", "lg")}>Try the field app</Link>
            </div>
          </div>
        </div>
        <div className="mt-10 sm:mt-12">
          <HeroPanel />
        </div>
      </section>

      {/* Problem in three numbers */}
      <section className="page mt-20 sm:mt-28" aria-labelledby="why">
        <div className="grid gap-4 lg:grid-cols-12">
          <h2 id="why" className="font-display text-d-lg font-bold lg:col-span-5" style={{ fontVariationSettings: '"wdth" 86' }}>
            Most care happens far from a tower.
          </h2>
          <p className="lede lg:col-span-6 lg:col-start-7 lg:self-end">
            Lokol Health is built for nurse aides at Solomon Islands nurse-aide posts and rural clinics. Three numbers set the constraints for every design choice.
          </p>
        </div>
        <ol className="mt-10 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-3">
          {FACTS.map((f) => (
            <li key={f.figure} className="flex flex-col bg-paper p-6 sm:p-7">
              <p className="font-display text-[56px] font-bold leading-none tracking-tight text-ink sm:text-[64px]" style={{ fontVariationSettings: '"wdth" 78, "opsz" 96' }}>
                {f.figure}
              </p>
              <p className="mt-4 text-[16px] leading-relaxed text-ink">{f.what}</p>
              <p className="mt-3 text-[15px] leading-relaxed text-reef-deep">{f.so}</p>
              <a href={f.href} target="_blank" rel="noreferrer" className="mt-auto pt-5 text-[12.5px] text-ink-3 underline decoration-line underline-offset-[3px] hover:text-ink hover:decoration-ink-3">
                {f.source}
              </a>
            </li>
          ))}
        </ol>
      </section>

      {/* How it works */}
      <section className="page mt-20 sm:mt-28" aria-labelledby="how">
        <h2 id="how" className="scroll-mt-20 font-display text-d-md font-bold">How it works</h2>
        <ol className="mt-8 grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.t} className="relative border-t-2 pt-5" style={{ borderColor: STEP_TONES[i] }}>
              <span className="grid h-9 w-9 place-items-center rounded-full bg-ink font-display text-[15px] font-bold text-white">{i + 1}</span>
              <h3 className="mt-4 font-display text-[20px] font-bold leading-tight">{s.t}</h3>
              <p className="mt-2 max-w-[44ch] text-[15px] leading-relaxed text-ink-2">{s.b}</p>
              <Link to={s.to} className="link mt-3 inline-block text-[14px]">
                {s.cta}
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <Evidence />

      {/* Sector packs */}
      <section className="page mt-20 sm:mt-28" aria-labelledby="packs">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="packs" className="font-display text-d-md font-bold">One Studio, three sectors</h2>
            <p className="mt-2 max-w-[58ch] text-[15px] text-ink-3">Health is a custom pack built from a guideline, with fine-tuned models and evaluations. Farm and Host are sample packs: the same four stages with another guide and other safety rules.</p>
          </div>
          <LaunchButton variant="ghost" size="sm" />
        </div>
        <div className="mt-8 grid gap-5 md:grid-cols-3">
          {SECTORS.map((s) => {
            const c = SECTOR_COPY[s];
            const g = PRESETS[s];
            const size = g.nodes.reduce((a, n) => a + (n.model?.size_mb ?? 0), 0);
            const live = s === "health";
            const onlineNodes = g.nodes.filter((n) => n.online).length;
            return (
              <article key={s} className={`flex flex-col overflow-hidden rounded-2xl border bg-white ${live ? "border-ink/80 shadow-lift" : "border-line"}`}>
                <div className="canvas-dots relative h-[168px] border-b border-canvas-line px-3 py-2">
                  <MiniGraph graph={g} />
                  <span className="absolute left-3 top-3">
                    {live ? <Badge tone="palm" solid dot>Custom pack</Badge> : <Badge tone="dark">Sample pack</Badge>}
                  </span>
                </div>
                <div className="flex flex-1 flex-col p-5">
                  <h3 className="font-display text-[22px] font-bold leading-tight">{c.title}</h3>
                  <p className="mt-3 flex-1 text-[15px] leading-relaxed text-ink-2">{c.line}</p>
                  <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-line-2 pt-3 text-[12px] text-ink-3">
                    <div><dt>Nodes</dt><dd className="font-display text-[17px] font-semibold text-ink">{g.nodes.length}</dd></div>
                    <div><dt>Download</dt><dd className="font-display text-[17px] font-semibold text-ink">{mb(size)}</dd></div>
                    <div><dt>Online nodes</dt><dd className="font-display text-[17px] font-semibold text-ink">{onlineNodes}</dd></div>
                  </dl>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Link to={`/studio?pack=${s}`} className={btnClass(live ? "ink" : "ghost", "sm")}>Open in Studio</Link>
                    {live && <Link to="/demo" className={btnClass("ghost", "sm")}>Try the field app</Link>}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* Guardrails */}
      <section className="mt-20 bg-ink text-white sm:mt-28" aria-labelledby="guard">
        <div className="page grid gap-10 py-14 sm:py-20 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <h2 id="guard" className="font-display text-d-md font-bold">What Lokol will not do</h2>
            <p className="mt-3 max-w-[44ch] text-[16px] leading-relaxed text-white/75">
              The guardrails are code, not a promise in a pitch. Every reply from Lokol Health ends in one of four actions, checked by the safety gate before the nurse sees it.
            </p>
            <ul className="mt-6 flex flex-col items-start gap-2.5">
              {(["ADVISE", "REFER_NOW", "REFER_NEXT_TRANSPORT", "ASK_PERSON"] as const).map((a) => (
                <li key={a}><ActionBadge action={a} size="md" /></li>
              ))}
            </ul>
          </div>
          <ul className="grid gap-px self-start overflow-hidden rounded-2xl bg-white/10 sm:grid-cols-2 lg:col-span-7">
            {WILL_NOT.map((w) => (
              <li key={w.t} className="bg-ink p-6">
                <h3 className="font-display text-[20px] font-bold">{w.t}</h3>
                <p className="mt-3 text-[15px] leading-relaxed text-white/80">{w.b}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <FinalCta />

      {/* Footer: sources and licenses */}
      <footer className="border-t border-line bg-paper-2/60">
        <div className="page grid gap-8 py-12 text-[13px] leading-relaxed text-ink-2 md:grid-cols-4">
          <div>
            <h3 className="font-display text-[15px] font-bold text-ink">Guideline</h3>
            <p className="mt-2">Solomon Islands Standard Treatment Manual for Children, 4th edition, 2017 (Ministry of Health and Medical Services). 183 chunks across 56 sections. No license statement, so it is indexed and cited, never redistributed.</p>
          </div>
          <div>
            <h3 className="font-display text-[15px] font-bold text-ink">Training data</h3>
            <p className="mt-2">2,704 train, 300 validation and 300 test examples, all synthetic and labelled as such, written by open-weight teachers on River (DeepSeek-V4.1-Flash, Kimi-K2.6). Not yet checked by a native Pijin speaker.</p>
          </div>
          <div>
            <h3 className="font-display text-[15px] font-bold text-ink">Models and licenses</h3>
            <p className="mt-2">Qwen3 and Qwen3.5 (Apache-2.0), Moonshine tiny and Whisper tiny (MIT), Omnilingual ASR CTC-300M (Apache-2.0), Kokoro-82M (Apache-2.0), MMS-TTS Pijin (CC-BY-NC-4.0, demo use only).</p>
          </div>
          <div>
            <h3 className="font-display text-[15px] font-bold text-ink">What it does not cover</h3>
            <p className="mt-2">Child care only: the adult manual is not public. Pijin voice in needs a laptop; phones get Pijin text in and Pijin voice out. Pijin has no official spelling, so forms vary.</p>
          </div>
        </div>
        <div className="page flex flex-wrap items-center justify-between gap-3 border-t border-line/70 py-5 text-[12.5px] text-ink-3">
          <p>Code under MIT. Built for Hack-Nation 7 with the World Bank, Small AI for Development, Health track.</p>
          <p>Context figures: DataReportal 2026, Rural and Remote Health 2096, SI 2019 Census.</p>
        </div>
      </footer>
    </div>
  );
}
