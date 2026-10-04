import { create } from "zustand";
import type { Graph, GraphNode, GraphTarget, NodeType, Sector } from "./types";
import { PRESETS } from "./data/presets";
import { NODE_META, getModel, ref } from "./models";
import { autoLayout, COL_W, stageIndex } from "./components/studio/layout";

// v4: four stage columns (Hear, Look up, Think, Respond); the visit-note node left the default graphs.
const KEY = "lokol.studio.graph.v4";

function load(): Graph {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const g = JSON.parse(raw) as Graph;
      if (g && g.version === 1 && Array.isArray(g.nodes) && Array.isArray(g.edges)) return g;
    }
  } catch {
    /* private mode or corrupt: fall back to the preset */
  }
  return structuredClone(PRESETS.health);
}

function persist(g: Graph) {
  try {
    localStorage.setItem(KEY, JSON.stringify(g));
  } catch {
    /* ignore */
  }
}

/** Which pack the canvas holds: a sector preset ("health"), a saved pack ("idb:<id>"), an export ("export:<pack_id>") or "custom". */
const PACK_KEY = `${KEY}.pack`;
function loadPackKey(): string {
  try {
    return localStorage.getItem(PACK_KEY) ?? "health";
  } catch {
    return "health";
  }
}
function persistPackKey(k: string) {
  try {
    localStorage.setItem(PACK_KEY, k);
  } catch {
    /* ignore */
  }
}

const ONLINE_KINDS = ["whatsapp", "messenger"];

interface StudioState {
  graph: Graph;
  /** Which pack is open (see PACK_KEY). */
  packKey: string;
  selectedId: string | null;
  dirty: boolean;
  /** Node ids that just changed model (Recommend or a swap); cards flash once. */
  flash: { ids: string[]; nonce: number };
  setGraph: (g: Graph, packKey?: string) => void;
  loadPreset: (s: Sector) => void;
  /** Turn every speech-in (stt) or speech-out (tts) node on or off; turning on a pack with none adds one. */
  setVoice: (kind: "stt" | "tts", on: boolean) => void;
  select: (id: string | null) => void;
  updateNode: (id: string, patch: Partial<GraphNode>) => void;
  updateParam: (id: string, key: string, value: unknown) => void;
  moveNode: (id: string, position: { x: number; y: number }) => void;
  addNode: (type: NodeType, position?: { x: number; y: number }) => string;
  removeNode: (id: string) => void;
  addEdge: (from: string, to: string) => void;
  removeEdge: (from: string, to: string) => void;
  setMeta: (patch: Partial<Pick<Graph, "name" | "sector" | "language" | "target">>) => void;
  setTarget: (patch: Partial<GraphTarget>) => void;
  setInternet: (on: boolean) => void;
  setNodeOnline: (id: string, on: boolean) => void;
  swapModel: (id: string, modelId: string | null) => void;
  /** Replace the graph and flash the nodes whose model changed (Recommend). */
  applyGraph: (g: Graph) => string[];
  tidy: () => void;
}

function withNode(g: Graph, id: string, f: (n: GraphNode) => GraphNode): Graph {
  return { ...g, nodes: g.nodes.map((n) => (n.id === id ? f(n) : n)) };
}

/** When a node's internet toggle changes, a model that can be hosted moves between local and hosted refs. */
function placeModel(n: GraphNode, online: boolean, internet: boolean): GraphNode {
  if (!n.model) return n;
  const cat = getModel(n.model.id);
  if (!cat?.online_runtime) return n;
  return { ...n, model: ref(cat.id, { online: online && internet }) };
}

export const useStudio = create<StudioState>((set, get) => {
  const commit = (graph: Graph, extra: Partial<StudioState> = {}) => {
    persist(graph);
    set({ graph, dirty: true, ...extra });
  };
  return {
    graph: load(),
    packKey: loadPackKey(),
    selectedId: null,
    dirty: false,
    flash: { ids: [], nonce: 0 },
    setGraph: (graph, packKey = "custom") => {
      persist(graph);
      persistPackKey(packKey);
      set({ graph, packKey, selectedId: null, dirty: false });
    },
    loadPreset: (s) => {
      const graph = structuredClone(PRESETS[s]);
      persist(graph);
      persistPackKey(s);
      set({ graph, packKey: s, selectedId: null, dirty: false });
    },
    setVoice: (kind, on) => {
      const g = get().graph;
      if (g.nodes.some((n) => n.type === kind)) {
        commit({ ...g, nodes: g.nodes.map((n) => (n.type === kind ? { ...n, params: { ...n.params, enabled: on } } : n)) });
        return;
      }
      if (!on) return;
      const id = get().addNode(kind);
      if (kind === "tts" && g.language[0] === "en") get().swapModel(id, "kokoro-82m-en");
      const g2 = get().graph;
      const find = (f: (n: GraphNode) => boolean) => g2.nodes.find(f);
      const chIn = find((n) => n.type === "channel" && n.params?.direction !== "out");
      const chOut = find((n) => n.type === "channel" && n.params?.direction === "out");
      const edges = [...g2.edges];
      if (kind === "stt") {
        const next = find((n) => n.type === "rag") ?? find((n) => n.type === "llm");
        if (chIn) edges.push({ from: chIn.id, to: id });
        if (next) edges.push({ from: id, to: next.id });
      } else {
        const prev = find((n) => n.type === "router") ?? find((n) => n.type === "gate") ?? find((n) => n.type === "llm");
        if (prev) edges.push({ from: prev.id, to: id });
        if (chOut) edges.push({ from: id, to: chOut.id });
      }
      commit(autoLayout({ ...g2, edges }), { selectedId: null });
    },
    select: (selectedId) => set({ selectedId }),
    updateNode: (id, patch) => commit(withNode(get().graph, id, (n) => ({ ...n, ...patch }))),
    updateParam: (id, key, value) => commit(withNode(get().graph, id, (n) => ({ ...n, params: { ...n.params, [key]: value } }))),
    moveNode: (id, position) => {
      const graph = withNode(get().graph, id, (n) => ({ ...n, position }));
      persist(graph);
      set({ graph });
    },
    addNode: (type, position) => {
      const g = get().graph;
      const n = g.nodes.filter((x) => x.type === type).length + 1;
      let id = `${type}-${n}`;
      while (g.nodes.some((x) => x.id === id)) id = `${type}-${Math.floor(Math.random() * 1e4)}`;
      const stage = stageIndex({ id, type, label: "", params: {}, online: false, position: { x: 0, y: 0 } });
      const inCol = g.nodes.filter((x) => Math.abs(x.position.x - stage * COL_W) < 60);
      const maxY = inCol.reduce((m, x) => Math.max(m, x.position.y), -Infinity);
      const defaults: Partial<Record<NodeType, string>> = {
        stt: "moonshine-tiny-en",
        tts: "mms-tts-pis",
        llm: "lokol-health-qwen3-0.6b",
        rag: g.sector === "health" ? "stm-children-2017-bm25" : g.sector === "agriculture" ? "farm-guide-bm25" : "host-listings-bm25"
      };
      const modelId = defaults[type];
      const cat = modelId ? getModel(modelId) : undefined;
      const node: GraphNode = {
        id,
        type,
        label: cat && type !== "rag" ? cat.name : NODE_META[type]?.name ?? type,
        model: modelId ? ref(modelId) : undefined,
        params:
          type === "stt" || type === "tts"
            ? { lang: cat?.lang?.[0] ?? "en" }
            : type === "llm"
              ? { quant: cat?.quant, max_tokens: 220, temperature: 0, escalate_to: null }
              : type === "rag"
                ? { method: "bm25", top_k: 1 }
                : type === "gate"
                  ? { red_flags: "RED_FLAGS", abstain_when_no_guideline: true }
                  : type === "channel"
                    ? { kinds: ["pwa"], direction: "out" }
                    : {},
        online: false,
        position: position ?? { x: stage * COL_W, y: Number.isFinite(maxY) ? maxY + 230 : 0 }
      };
      commit({ ...g, nodes: [...g.nodes, node] }, { selectedId: id, flash: { ids: [id], nonce: Date.now() } });
      return id;
    },
    removeNode: (id) => {
      const g = get().graph;
      const graph = { ...g, nodes: g.nodes.filter((n) => n.id !== id), edges: g.edges.filter((e) => e.from !== id && e.to !== id) };
      commit(graph, { selectedId: get().selectedId === id ? null : get().selectedId });
    },
    addEdge: (from, to) => {
      const g = get().graph;
      if (from === to || g.edges.some((e) => e.from === from && e.to === to)) return;
      commit({ ...g, edges: [...g.edges, { from, to }] });
    },
    removeEdge: (from, to) => {
      const g = get().graph;
      commit({ ...g, edges: g.edges.filter((e) => !(e.from === from && e.to === to)) });
    },
    setMeta: (patch) => commit({ ...get().graph, ...patch }),
    setTarget: (patch) => {
      const g = get().graph;
      commit({ ...g, target: { ...g.target, ...patch } });
    },
    setInternet: (on) => {
      const g = get().graph;
      const target = { ...g.target, connectivity: on ? (g.target.connectivity === "none" ? "online" : g.target.connectivity) : "none" } as GraphTarget;
      let nodes = g.nodes;
      if (!on) {
        nodes = g.nodes.map((n) => {
          const off = placeModel({ ...n, online: false }, false, false);
          if (n.type === "channel" && Array.isArray(n.params.kinds)) {
            const kinds = (n.params.kinds as string[]).filter((k) => !ONLINE_KINDS.includes(k));
            return { ...off, params: { ...off.params, kinds: kinds.length ? kinds : ["pwa"] } };
          }
          return off;
        });
      }
      commit({ ...g, target, nodes });
    },
    setNodeOnline: (id, on) => {
      const g = get().graph;
      const internet = g.target.connectivity !== "none";
      if (on && !internet) return;
      commit(withNode(g, id, (n) => placeModel({ ...n, online: on }, on, internet)), { flash: { ids: [id], nonce: Date.now() } });
    },
    swapModel: (id, modelId) => {
      const g = get().graph;
      const internet = g.target.connectivity !== "none";
      commit(
        withNode(g, id, (n) => {
          if (!modelId) return { ...n, model: undefined };
          const prev = getModel(n.model?.id);
          const next = getModel(modelId);
          if (!next) return n;
          const autoLabel = !n.label || n.label === prev?.name || n.label === NODE_META[n.type]?.name || /^Lokol (Health|Farm|Host) /.test(n.label);
          const label = autoLabel && n.type === "llm" ? (g.sector === "health" || next.variant !== "base" ? next.name : `${n.label.split(" ").slice(0, 2).join(" ")} ${next.size_label} (base model)`) : n.label;
          const params = n.type === "llm" ? { ...n.params, quant: next.quant } : n.type === "stt" || n.type === "tts" ? { ...n.params, lang: next.lang?.[0] ?? n.params.lang } : n.params;
          return placeModel({ ...n, label, params, model: ref(next.id) }, n.online, internet);
        }),
        { flash: { ids: [id], nonce: Date.now() } }
      );
    },
    applyGraph: (next) => {
      const prev = get().graph;
      const before = new Map(prev.nodes.map((n) => [n.id, n]));
      const changed = next.nodes
        .filter((n) => {
          const b = before.get(n.id);
          return !b || b.type !== n.type || b.model?.id !== n.model?.id || b.online !== n.online;
        })
        .map((n) => n.id);
      persist(next);
      set({ graph: next, selectedId: null, dirty: true, flash: { ids: changed, nonce: Date.now() } });
      return changed;
    },
    tidy: () => commit(autoLayout(get().graph))
  };
});
