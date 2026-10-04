import { create } from "zustand";
import type { Chunk, Engine, Flags, GateResult, Graph, GraphNode, Lang, LoadProgress, ParsedReply } from "../../types";
import { buildManifest } from "../../pack";
import { getRuntime, type RuntimeSource } from "../../runtime-loader";
import { ACTION_COPY } from "../ui";
import { presetEngine } from "./presetEngine";

export type StepState = "queued" | "active" | "done" | "skipped" | "error";

export type StepDetail =
  | { kind: "message"; text: string; via: "typed" | "voice" }
  | { kind: "stt"; text: string; reason?: string }
  | { kind: "rag"; chunks: Chunk[] }
  | { kind: "llm"; raw: string; reply?: ParsedReply }
  | { kind: "gate"; gate: GateResult }
  | { kind: "note"; record: Record<string, unknown> }
  | { kind: "tts"; seconds?: number; lang: Lang }
  | { kind: "out"; text: string };

export interface StepRun {
  state: StepState;
  ms?: number;
  peek?: string;
  detail?: StepDetail;
  note?: string;
}

export interface TraceResult {
  message: string;
  lang: Lang;
  gate?: GateResult;
  reply?: ParsedReply;
  chunk?: Chunk | null;
  totalMs: number;
}

interface TraceState {
  status: "idle" | "loading" | "running" | "done" | "error";
  runtime: RuntimeSource | null;
  progress: LoadProgress | null;
  steps: Record<string, StepRun>;
  /** Edge ids ("from->to") a particle is travelling along right now, and edges already traversed. */
  liveEdges: string[];
  doneEdges: string[];
  openPreview: string | null;
  result: TraceResult | null;
  error: string | null;
  audio: AudioBuffer | null;
  set: (p: Partial<TraceState>) => void;
  step: (id: string, p: Partial<StepRun>) => void;
  reset: () => void;
}

export const useTrace = create<TraceState>((set, get) => ({
  status: "idle",
  runtime: null,
  progress: null,
  steps: {},
  liveEdges: [],
  doneEdges: [],
  openPreview: null,
  result: null,
  error: null,
  audio: null,
  set: (p) => set(p),
  step: (id, p) => set({ steps: { ...get().steps, [id]: { ...(get().steps[id] ?? { state: "queued" }), ...p } } }),
  reset: () => set({ status: "idle", steps: {}, liveEdges: [], doneEdges: [], openPreview: null, result: null, error: null, audio: null, progress: null })
}));

/* ---------- engine cache ---------- */

let cached: { key: string; engine: Engine; source: RuntimeSource } | null = null;

function engineKey(g: Graph): string {
  return g.nodes
    .map((n) => n.model?.id)
    .filter(Boolean)
    .sort()
    .join("|");
}

async function getEngine(g: Graph): Promise<{ engine: Engine; source: RuntimeSource }> {
  const key = engineKey(g);
  if (cached && cached.key === key) return cached;
  const t = useTrace.getState();
  t.set({ status: "loading", progress: null });
  // ?runtime=shim forces the canned runtime (UI checks, a deterministic demo take)
  const forceShim = typeof location !== "undefined" && new URLSearchParams(location.search).get("runtime") === "shim";
  const rt = forceShim ? { loadPack: (await import("../../runtime-shim")).loadPack, source: "shim" as RuntimeSource } : await getRuntime();
  const manifest = buildManifest(g);
  const engine = await rt.loadPack(manifest, (p) => useTrace.getState().set({ progress: p }));
  cached = { key, engine, source: rt.source };
  return cached;
}

/* ---------- the run ---------- */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PARTICLE_MS = 520;
const MIN_DWELL = 380;

let runToken = 0;

function edgeId(a: string, b: string) {
  return `${a}->${b}`;
}

function langOf(n: GraphNode): Lang | null {
  const l = n.params?.lang ?? (n.model?.id.endsWith("-pis") || /pis/.test(n.model?.id ?? "") ? "pis" : n.model ? "en" : null);
  return l === "pis" || l === "en" ? l : null;
}

export interface RunInput {
  graph: Graph;
  text: string;
  audio?: Blob | null;
  flags: Flags;
}

/**
 * Runs one message through the graph stage by stage: channel → speech in → lookup → model → gate →
 * note / speech out → reply. Each node lights up while its runtime call is in flight; the badge shows
 * the measured time of that call, not the animation.
 */
export async function runTrace({ graph, text, audio, flags }: RunInput): Promise<void> {
  const my = ++runToken;
  const T = useTrace.getState();
  T.reset();
  const alive = () => my === runToken;
  const nodes = graph.nodes;
  const byType = (t: GraphNode["type"]) => nodes.filter((n) => n.type === t);
  const has = (a: string, b: string) => graph.edges.some((e) => e.from === a && e.to === b);

  const travel = async (from: string | undefined, to: string | undefined) => {
    if (!from || !to || !has(from, to)) return;
    const id = edgeId(from, to);
    useTrace.setState((s) => ({ liveEdges: [...s.liveEdges, id] }));
    await sleep(PARTICLE_MS);
    useTrace.setState((s) => ({ liveEdges: s.liveEdges.filter((e) => e !== id), doneEdges: [...s.doneEdges, id] }));
  };
  /** Light a node, run its work, keep it lit for at least MIN_DWELL so the eye can follow. */
  const visit = async <T,>(id: string, work: () => Promise<T>, done: (r: T, ms: number) => Partial<StepRun>): Promise<T> => {
    useTrace.getState().step(id, { state: "active" });
    const t0 = performance.now();
    const r = await work();
    const ms = Math.round(performance.now() - t0);
    if (ms < MIN_DWELL) await sleep(MIN_DWELL - ms);
    if (alive()) useTrace.getState().step(id, { state: "done", ms, ...done(r, ms) });
    return r;
  };
  const skip = (id: string, note: string) => useTrace.getState().step(id, { state: "skipped", peek: note, note });

  try {
    const loaded = await getEngine(graph);
    if (!alive()) return;
    const source = loaded.source;
    // Farm and Host have placeholder corpora: answer lookup, model and gate from their sample set.
    const engine = graph.sector === "health" ? loaded.engine : presetEngine(loaded.engine, graph.sector);
    const queued: Record<string, StepRun> = {};
    nodes.forEach((n) => (queued[n.id] = { state: "queued" }));
    useTrace.setState({ status: "running", runtime: source, progress: null, steps: queued });
    const t0 = performance.now();

    const chIn = byType("channel").find((n) => n.params?.direction !== "out") ?? byType("channel")[0];
    const chOut = byType("channel").find((n) => n.params?.direction === "out");
    const stts = byType("stt");
    const rag = byType("rag")[0];
    const llm = byType("llm")[0];
    const gate = byType("gate")[0];
    const notes = byType("note");
    const ttss = byType("tts");
    const routers = byType("router");

    // 1. Channel in
    let message = text.trim();
    if (chIn) {
      await visit(chIn.id, async () => null, () => ({ peek: audio ? "Voice note received" : "Message received", detail: { kind: "message", text: message || "(voice note)", via: audio ? "voice" : "typed" } }));
    }

    // 2. Speech in
    const sttNode = stts.find((n) => langOf(n) === flags.lang) ?? null;
    for (const s of stts) {
      if (!audio) skip(s.id, "Typed message, no audio");
      else if (s !== sttNode) skip(s.id, `Not used for ${flags.lang === "pis" ? "Pijin" : "English"}`);
    }
    let lastId = chIn?.id;
    if (audio) {
      if (sttNode) {
        await travel(lastId, sttNode.id);
        const said = await visit(sttNode.id, () => engine.transcribe(audio, flags.lang), (t) => ({
          peek: t ? `“${t.slice(0, 60)}${t.length > 60 ? "…" : ""}”` : "No words recognised",
          detail: { kind: "stt", text: t, reason: t ? undefined : flags.lang === "pis" ? "Pijin voice-in runs on the laptop tier (Omnilingual ASR in the Python sidecar)." : "Nothing recognised; try again closer to the mic." }
        }));
        if (!alive()) return;
        if (said) message = said;
        lastId = sttNode.id;
      } else {
        throw new Error(flags.lang === "pis" ? "This pack has no Pijin speech-in node. Type the message, or add Speech in (Pijin) on a laptop pack." : "This pack has no speech-in node. Type the message instead.");
      }
    }
    if (!message) throw new Error("Nothing to run: type a message or record a voice note.");

    // 3. Guideline lookup
    let chunk: Chunk | null = null;
    if (rag) {
      await travel(lastId, rag.id);
      const chunks = await visit(rag.id, () => engine.retrieve(message), (cs) => ({
        peek: cs[0] ? `${cs[0].section}, page ${cs[0].page}` : "No matching section",
        detail: { kind: "rag", chunks: cs.slice(0, 3) }
      }));
      if (!alive()) return;
      chunk = chunks[0] ?? null;
      lastId = rag.id;
    }

    // 4. Language model (streams raw protocol text into the preview)
    let reply: ParsedReply | undefined;
    if (llm) {
      await travel(lastId, llm.id);
      let raw = "";
      reply = await visit(
        llm.id,
        () =>
          engine.generate(flags, chunk, message, (tok: string) => {
            raw += tok;
            if (alive()) useTrace.getState().step(llm.id, { detail: { kind: "llm", raw } });
          }),
        (r) => ({ peek: `ACTION: ${r.action ?? "?"}${r.stm && r.stm !== "NONE" ? `, STM: ${r.stm}` : ""}`, detail: { kind: "llm", raw: r.raw || raw, reply: r } })
      );
      if (!alive()) return;
      lastId = llm.id;
    }

    // 5. Safety gate
    let g: GateResult | undefined;
    if (gate && reply) {
      await travel(lastId, gate.id);
      g = await visit(gate.id, async () => engine.gate(message, reply!), (r) => ({
        peek: r.overridden ? `Overrode the model: ${ACTION_COPY[r.action].label}` : r.red_flags.length ? `${ACTION_COPY[r.action].label}: ${(r.red_flag_labels ?? r.red_flags).join(", ")}` : `Passed: ${ACTION_COPY[r.action].label}`,
        detail: { kind: "gate", gate: r }
      }));
      if (!alive()) return;
      lastId = gate.id;
    }
    const finalText = g?.reply ?? reply?.body ?? "";
    const finalAction = g?.action ?? reply?.action ?? "ASK_PERSON";
    for (const r of routers) {
      await travel(lastId, r.id);
      await visit(r.id, async () => null, () => ({ peek: "Rule: offline advice path" }));
      lastId = r.id;
    }

    // 6. Visit note and speech out run side by side after the gate
    const branchFrom = lastId;
    const notePromise = (async () => {
      for (const n of notes) {
        await travel(branchFrom, n.id);
        await visit(n.id, async () => ({ time: new Date().toISOString(), action: finalAction, stm: g?.stm ?? reply?.stm ?? "NONE", lang: flags.lang, red_flags: g?.red_flags ?? [] }), (rec) => ({
          peek: "Logged on this device",
          detail: { kind: "note", record: rec }
        }));
      }
    })();
    let spokeFrom: string | undefined;
    const ttsNode = ttss.find((n) => langOf(n) === flags.lang) ?? null;
    for (const t of ttss) if (t !== ttsNode) skip(t.id, `No ${flags.lang === "pis" ? "Pijin" : "English"} voice on this node`);
    const ttsPromise = (async () => {
      if (!ttsNode || !finalText) return;
      await travel(branchFrom, ttsNode.id);
      try {
        const buf = await visit(ttsNode.id, () => engine.speak(finalText, flags.lang), (b) => ({
          peek: `${b.duration.toFixed(1)} s of audio`,
          detail: { kind: "tts", seconds: b.duration, lang: flags.lang }
        }));
        if (alive()) useTrace.setState({ audio: buf });
        spokeFrom = ttsNode.id;
      } catch (e) {
        useTrace.getState().step(ttsNode.id, { state: "error", peek: "Voice failed", note: (e as Error).message });
      }
    })();
    if (!ttsNode && ttss.length === 0) {
      /* no voice in this pack */
    }
    await Promise.all([notePromise, ttsPromise]);
    if (!alive()) return;

    // 7. Reply out
    if (chOut) {
      await Promise.all([travel(branchFrom, chOut.id), spokeFrom ? travel(spokeFrom, chOut.id) : Promise.resolve()]);
      await visit(chOut.id, async () => null, () => ({ peek: spokeFrom ? "Text and voice sent" : "Text reply shown", detail: { kind: "out", text: finalText } }));
    }
    useTrace.setState({
      status: "done",
      result: { message, lang: flags.lang, gate: g, reply, chunk, totalMs: Math.round(performance.now() - t0) }
    });
  } catch (e) {
    if (!alive()) return;
    const msg = (e as Error).message || String(e);
    const steps = { ...useTrace.getState().steps };
    for (const [id, s] of Object.entries(steps)) if (s.state === "active") steps[id] = { ...s, state: "error", note: msg };
    useTrace.setState({ status: "error", error: msg, steps, liveEdges: [] });
  }
}

export function stopTrace() {
  runToken++;
  useTrace.getState().reset();
}

export async function playBuffer(buf: AudioBuffer) {
  const Ctx = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext) as typeof AudioContext;
  const ctx = new Ctx();
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start();
  src.onended = () => void ctx.close();
}
