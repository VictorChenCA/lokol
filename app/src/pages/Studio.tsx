import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  type Connection,
  type NodeChange,
  type EdgeChange
} from "@xyflow/react";
import { useStudio } from "../store";
import { nodeTypes, type LokolNode } from "../components/NodeCard";
import { edgeTypes, type FlowEdgeT } from "../components/studio/FlowEdge";
import { StageLanes } from "../components/studio/StageLanes";
import { DeviceBar } from "../components/studio/DeviceBar";
import { Inspector } from "../components/studio/Inspector";
import { TraceConsole } from "../components/studio/TraceConsole";
import { NodeIcon, Icon } from "../components/studio/icons";
import { computeBudget, internetOn, isComputer } from "../components/studio/budget";
import { edgeHandles, CARD_W } from "../components/studio/layout";
import { useTrace } from "../components/studio/trace";
import { NODE_META, getModel } from "../models";
import { recommend, type Recommendation } from "../recommend";
import { buildManifest, packZip, download, slug } from "../pack";
import type { Graph, NodeType, Sector } from "../types";
import "../components/studio/studio.css";

const NODE_ORDER: NodeType[] = ["channel", "stt", "rag", "llm", "gate", "tts", "note", "router"];
const FIT = { padding: { top: "92px", right: "48px", bottom: "40px", left: "48px" }, minZoom: 0.5, maxZoom: 1 } as const;

const SECTORS: { s: Sector; name: string; pis: string }[] = [
  { s: "health", name: "Lokol Health", pis: "Helt" },
  { s: "agriculture", name: "Lokol Farm", pis: "Fama" },
  { s: "tourism", name: "Lokol Host", pis: "Visita" }
];

/* ---------- Add-node menu ---------- */

function AddNodeMenu() {
  const addNode = useStudio((s) => s.addNode);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", h);
    document.addEventListener("keydown", k);
    return () => {
      document.removeEventListener("mousedown", h);
      document.removeEventListener("keydown", k);
    };
  }, [open]);
  return (
    <div className="lk-add" ref={ref}>
      <button type="button" className="lk-tool" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Icon.plus size={15} strokeWidth={2.2} /> Add node
      </button>
      {open && (
        <ul className="lk-add__menu" role="menu">
          {NODE_ORDER.map((t) => {
            const m = NODE_META[t];
            return (
              <li key={t} role="none">
                <button
                  type="button"
                  role="menuitem"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("application/lokol-node", t);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onClick={() => {
                    addNode(t);
                    setOpen(false);
                  }}
                  style={{ ["--c" as string]: m.color, ["--tint" as string]: m.tint }}
                >
                  <span className="lk-icon">
                    <NodeIcon type={t} size={15} />
                  </span>
                  <span className="min-w-0">
                    <span className="lk-add__name">
                      {m.name} <em>{m.pijin}</em>
                    </span>
                    <span className="lk-add__blurb">{m.blurb}</span>
                  </span>
                </button>
              </li>
            );
          })}
          <li className="lk-add__hint">Click to add, or drag onto the canvas.</li>
        </ul>
      )}
    </div>
  );
}

/* ---------- Recommendation summary card ---------- */

interface RecNotice {
  rec: Recommendation;
  changes: string[];
}

function diffGraphs(a: Graph, b: Graph): string[] {
  const out: string[] = [];
  const before = new Map(a.nodes.map((n) => [n.id, n]));
  const after = new Map(b.nodes.map((n) => [n.id, n]));
  const name = (id?: string) => getModel(id)?.name ?? id ?? "none";
  for (const n of b.nodes) {
    const o = before.get(n.id);
    if (!o || o.type !== n.type) out.push(`Added ${n.label}`);
    else if (o.model?.id !== n.model?.id) out.push(`${NODE_META[n.type]?.name}: ${name(o.model?.id)} to ${name(n.model?.id)}`);
    else if (o.online !== n.online) out.push(`${n.label}: internet ${n.online ? "on" : "off"}`);
  }
  for (const o of a.nodes) if (!after.has(o.id) || after.get(o.id)!.type !== o.type) out.push(`Removed ${o.label}`);
  return out;
}

function RecommendCard({ notice, onClose }: { notice: RecNotice; onClose: () => void }) {
  const { rec, changes } = notice;
  return (
    <div className="lk-rec" role="status">
      <div className="lk-rec__head">
        <Icon.wand size={16} />
        <div className="min-w-0 flex-1">
          <p className="lk-rec__title">Recommended for {rec.graph.target.device}</p>
          <p className="lk-rec__sub">{rec.tierLabel}</p>
        </div>
        <button type="button" className="lk-iconbtn" onClick={onClose} aria-label="Dismiss">
          <Icon.close size={14} />
        </button>
      </div>
      {changes.length ? (
        <ul className="lk-rec__changes">
          {changes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      ) : (
        <p className="lk-rec__same">Your graph already matches the recommendation.</p>
      )}
      <details className="lk-rec__why">
        <summary>Why, and what will not work</summary>
        <ul>
          {rec.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
          {rec.willNotWork.map((r) => (
            <li key={r} className="is-warn">
              {r}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

/* ---------- Canvas ---------- */

function Canvas({ onReady }: { onReady: () => void }) {
  const graph = useStudio((s) => s.graph);
  const selectedId = useStudio((s) => s.selectedId);
  const select = useStudio((s) => s.select);
  const moveNode = useStudio((s) => s.moveNode);
  const addEdge = useStudio((s) => s.addEdge);
  const removeEdge = useStudio((s) => s.removeEdge);
  const removeNode = useStudio((s) => s.removeNode);
  const addNode = useStudio((s) => s.addNode);
  const tidy = useStudio((s) => s.tidy);
  const openPreview = useTrace((s) => s.openPreview);
  const { screenToFlowPosition, fitView } = useReactFlow();
  const budget = useMemo(() => computeBudget(graph), [graph]);
  const net = internetOn(graph);

  const flowNodes = useMemo<LokolNode[]>(
    () =>
      graph.nodes.map((n) => ({
        id: n.id,
        type: "lokol",
        position: n.position,
        selected: n.id === selectedId,
        zIndex: openPreview === n.id ? 1000 : n.id === selectedId ? 10 : 1,
        data: { node: n, issue: budget.issues[n.id] ?? null, internet: net }
      })),
    [graph.nodes, selectedId, budget, net, openPreview]
  );
  const flowEdges = useMemo<FlowEdgeT[]>(() => {
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    return graph.edges.map((e) => {
      const s = byId.get(e.from);
      const t = byId.get(e.to);
      return { id: `${e.from}->${e.to}`, source: e.from, target: e.to, type: "flow", ...edgeHandles(s, t), data: { online: !!(s?.online && t?.online && net) } };
    });
  }, [graph.nodes, graph.edges, net]);

  const [nodes, setNodes, onNodesChangeBase] = useNodesState<LokolNode>(flowNodes);
  const [edges, setEdges, onEdgesChangeBase] = useEdgesState<FlowEdgeT>(flowEdges);

  useEffect(() => {
    // keep React Flow's measurements, or an unchanged card stays hidden until it resizes
    setNodes((prev) => {
      const byId = new Map(prev.map((p) => [p.id, p]));
      return flowNodes.map((n) => {
        const old = byId.get(n.id);
        return old ? { ...n, measured: old.measured, width: old.width, height: old.height } : n;
      });
    });
  }, [flowNodes, setNodes]);
  useEffect(() => setEdges(flowEdges), [flowEdges, setEdges]);

  useEffect(() => {
    const t1 = setTimeout(() => fitView(FIT), 60);
    const t2 = setTimeout(() => {
      fitView(FIT);
      onReady();
    }, 420);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [fitView, onReady]);

  const structure = graph.nodes.map((n) => n.id).join(",") + "|" + graph.name;
  const structRef = useRef(structure);
  useEffect(() => {
    if (structRef.current !== structure) {
      structRef.current = structure;
      const t = setTimeout(() => fitView({ ...FIT, duration: 450 }), 60);
      return () => clearTimeout(t);
    }
  }, [structure, fitView]);

  const onNodesChange = useCallback(
    (changes: NodeChange<LokolNode>[]) => {
      onNodesChangeBase(changes);
      for (const c of changes) {
        if (c.type === "remove") removeNode(c.id);
        if (c.type === "select" && c.selected) select(c.id);
      }
    },
    [onNodesChangeBase, removeNode, select]
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange<FlowEdgeT>[]) => {
      onEdgesChangeBase(changes);
      for (const c of changes) {
        if (c.type === "remove") {
          const [from, to] = c.id.split("->");
          removeEdge(from, to);
        }
      }
    },
    [onEdgesChangeBase, removeEdge]
  );
  const onConnect = useCallback((c: Connection) => c.source && c.target && addEdge(c.source, c.target), [addEdge]);
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const type = e.dataTransfer.getData("application/lokol-node") as NodeType;
      if (!type) return;
      const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      addNode(type, { x: p.x - CARD_W / 2, y: p.y - 40 });
    },
    [screenToFlowPosition, addNode]
  );

  return (
    <div
      className="lk-canvas"
      onDrop={onDrop}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onPaneClick={() => {
          select(null);
          useTrace.getState().set({ openPreview: null });
        }}
        onNodeDragStop={(_, n) => moveNode(n.id, n.position)}
        fitView
        fitViewOptions={FIT}
        deleteKeyCode={["Backspace", "Delete"]}
        proOptions={{ hideAttribution: true }}
        minZoom={0.3}
        maxZoom={1.6}
        colorMode="dark"
      >
        <StageLanes nodes={graph.nodes} />
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.3} color="rgba(178, 222, 222, 0.16)" />
        <Controls showInteractive={false} position="bottom-left" />
        <MiniMap
          pannable
          zoomable
          position="bottom-right"
          nodeColor={(n) => NODE_META[(n.data as { node?: { type?: string } })?.node?.type ?? "router"]?.color ?? "#7f97a3"}
          nodeStrokeWidth={0}
          nodeBorderRadius={6}
          maskColor="rgba(6, 22, 30, 0.72)"
          bgColor="#0B202A"
        />
      </ReactFlow>
      <div className="lk-tools">
        <AddNodeMenu />
        <button type="button" className="lk-tool" onClick={() => tidy()} title="Put every node back in its stage column">
          <Icon.grid size={14} /> Tidy
        </button>
        <button type="button" className="lk-tool" onClick={() => fitView({ ...FIT, duration: 300 })}>
          Fit
        </button>
      </div>
      {graph.nodes.length === 0 && (
        <div className="lk-empty">
          <p className="lk-empty__title">Empty canvas</p>
          <p>Add nodes with Add node, load a preset above, or press Recommend for this device to build a graph for the target phone.</p>
        </div>
      )}
    </div>
  );
}

/* ---------- Header ---------- */

function StudioHeader() {
  const graph = useStudio((s) => s.graph);
  const loadPreset = useStudio((s) => s.loadPreset);
  const setMeta = useStudio((s) => s.setMeta);
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const exportPack = async () => {
    setBusy(true);
    try {
      const manifest = buildManifest(graph);
      const blob = await packZip(manifest);
      download(blob, `${slug(graph.name)}.zip`);
      try {
        const saved = JSON.parse(localStorage.getItem("lokol.packs") ?? "[]");
        const next = [manifest, ...saved.filter((m: { pack_id?: string }) => m.pack_id !== manifest.pack_id)].slice(0, 20);
        localStorage.setItem("lokol.packs", JSON.stringify(next));
      } catch {
        /* storage blocked: the zip still downloaded */
      }
      setToast("Pack exported. It is also listed under Deploy.");
    } catch (e) {
      setToast(`Export failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
      setTimeout(() => setToast(null), 3500);
    }
  };

  return (
    <div className="lk-header">
      <input className="lk-header__name" value={graph.name} onChange={(e) => setMeta({ name: e.target.value })} aria-label="Pack name" />
      <div className="lk-presets" role="radiogroup" aria-label="Sector preset">
        {SECTORS.map((p) => (
          <button key={p.s} type="button" role="radio" aria-checked={graph.sector === p.s} onClick={() => graph.sector !== p.s && loadPreset(p.s)} title={`Load the ${p.name} preset`}>
            {p.name}
          </button>
        ))}
      </div>
      <div className="lk-header__actions">
        {toast && <span className="lk-header__toast">{toast}</span>}
        <button type="button" className="btn-ghost btn-sm" onClick={exportPack} disabled={busy}>
          <Icon.download size={14} /> {busy ? "Exporting…" : "Export pack"}
        </button>
        <button type="button" className="btn-ink btn-sm" onClick={() => navigate("/demo", { state: { graph } })}>
          Open in Demo
        </button>
      </div>
    </div>
  );
}

/* ---------- Page ---------- */

function StudioInner() {
  const graph = useStudio((s) => s.graph);
  const selectedId = useStudio((s) => s.selectedId);
  const select = useStudio((s) => s.select);
  const applyGraph = useStudio((s) => s.applyGraph);
  const [notice, setNotice] = useState<RecNotice | null>(null);
  const [ready, setReady] = useState(false);
  const onReady = useCallback(() => setReady(true), []);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        select(null);
        useTrace.getState().set({ openPreview: null });
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [select]);

  const onRecommend = () => {
    const t = graph.target;
    const rec = recommend({
      sector: graph.sector,
      languages: graph.language,
      voiceIn: graph.nodes.some((n) => n.type === "stt"),
      voiceOut: graph.nodes.some((n) => n.type === "tts"),
      connectivity: t.connectivity,
      deviceName: t.device,
      ram_gb: t.ram_gb,
      storage_gb: t.storage_gb,
      isLaptop: isComputer(t)
    });
    const next: Graph = { ...rec.graph, name: graph.name };
    const changes = diffGraphs(graph, next);
    applyGraph(next);
    setNotice({ rec, changes });
  };

  return (
    <div className={`lk-studio ${ready ? "is-ready" : ""}`}>
      <StudioHeader />
      <DeviceBar onRecommend={onRecommend} />
      <div className="lk-stagewrap">
        <Canvas onReady={onReady} />
        {selectedId && <Inspector onClose={() => select(null)} />}
        {notice && !selectedId && <RecommendCard notice={notice} onClose={() => setNotice(null)} />}
      </div>
      <TraceConsole />
    </div>
  );
}

export default function Studio() {
  const [params] = useSearchParams();
  const loadPreset = useStudio((s) => s.loadPreset);
  const preset = params.get("preset");
  useEffect(() => {
    if (preset === "health" || preset === "agriculture" || preset === "tourism") loadPreset(preset);
  }, [preset, loadPreset]);

  return (
    <ReactFlowProvider>
      <StudioInner />
    </ReactFlowProvider>
  );
}
