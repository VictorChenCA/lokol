import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
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
import { edgeHandles, CARD_W, estimateHeight } from "../components/studio/layout";
import { useTrace } from "../components/studio/trace";
import { activeGraph, isEnabled, isOptionalStage } from "../components/studio/enabled";
import { NODE_META, getModel } from "../models";
import { recommend, type Recommendation } from "../recommend";
import { buildManifest, packZip, download, slug } from "../pack";
import type { Graph, NodeType } from "../types";
import { PackSelect, HeaderSwitch, useOpenPack, useRestoreExtras } from "../components/studio/PackSelect";
import "../components/studio/studio.css";

const NODE_ORDER: NodeType[] = ["channel", "stt", "rag", "llm", "gate", "tts", "router"];
const FIT_DESK = { padding: { top: "84px", right: "36px", bottom: "64px", left: "36px" }, minZoom: 0.5, maxZoom: 1 } as const;
const FIT_PHONE = { padding: { top: "40px", right: "12px", bottom: "56px", left: "12px" }, minZoom: 0.15, maxZoom: 1 } as const;
const fitOpts = () => (typeof window !== "undefined" && window.innerWidth < 768 ? FIT_PHONE : FIT_DESK);

/**
 * Fit the stage lanes (not just the cards) into the canvas. On a desktop the zoom never drops below
 * 0.62 so card text stays readable; if the canvas is short (trace console open) the stage names stay
 * in view and the lowest rows may run past the bottom edge. A phone always shows the whole pipeline.
 */
function useSmartFit(box: React.RefObject<HTMLDivElement>) {
  const { setViewport } = useReactFlow();
  return useCallback(
    (duration = 0) => {
      const el = box.current;
      const nodes = useStudio.getState().graph.nodes;
      if (!el || !nodes.length) return;
      const W = el.clientWidth;
      const H = el.clientHeight;
      const phone = window.innerWidth < 768;
      const pad = phone ? { t: 10, r: 10, b: 54, l: 10 } : { t: 14, r: 28, b: 58, l: 28 };
      const x0 = Math.min(...nodes.map((n) => n.position.x)) - 22;
      const x1 = Math.max(...nodes.map((n) => n.position.x)) + CARD_W + 22;
      const y0 = Math.min(...nodes.map((n) => n.position.y)) - 74;
      const y1 = Math.max(...nodes.map((n) => n.position.y + estimateHeight(n))) + 30;
      const bw = x1 - x0;
      const bh = y1 - y0;
      const aw = Math.max(50, W - pad.l - pad.r);
      const ah = Math.max(50, H - pad.t - pad.b);
      const zoom = Math.max(phone ? 0.15 : 0.62, Math.min(1, aw / bw, ah / bh));
      const x = pad.l + (aw - bw * zoom) / 2 - x0 * zoom;
      // When the graph is taller than the canvas, keep the top (the stage names) in view.
      const y = bh * zoom <= ah ? pad.t + (ah - bh * zoom) / 2 - y0 * zoom : pad.t - y0 * zoom;
      void setViewport({ x, y, zoom }, duration ? { duration } : undefined);
    },
    [box, setViewport]
  );
}

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
                      {m.name}
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
          <p className="lk-rec__title">{rec.fitLine}</p>
          <p className="lk-rec__sub">
            Installs {rec.installs.map((m) => m.name).join(", ")}; about {rec.minutes3g < 1 ? "1 minute" : `${Math.round(rec.minutes3g)} minutes`} on 3G.
          </p>
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
  const { screenToFlowPosition, zoomIn, zoomOut } = useReactFlow();
  const boxRef = useRef<HTMLDivElement>(null);
  const smartFit = useSmartFit(boxRef);
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
      const off = !!((s && !isEnabled(s)) || (t && !isEnabled(t)));
      return { id: `${e.from}->${e.to}`, source: e.from, target: e.to, type: "flow", ...edgeHandles(s, t), data: { online: !!(s?.online && t?.online && net), off } };
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
    const t1 = setTimeout(() => smartFit(), 60);
    const t2 = setTimeout(() => {
      smartFit();
      onReady();
    }, 420);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [smartFit, onReady]);

  // Refit when the canvas changes size (trace console opens, inspector on mobile, window resize).
  const [tall, setTall] = useState(true);
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let last = { w: el.clientWidth, h: el.clientHeight };
    let t: ReturnType<typeof setTimeout> | undefined;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      setTall(h > 520);
      if (Math.abs(w - last.w) > 40 || Math.abs(h - last.h) > 40) {
        last = { w, h };
        clearTimeout(t);
        t = setTimeout(() => smartFit(280), 80);
      }
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      clearTimeout(t);
    };
  }, [smartFit]);

  const structure = graph.nodes.map((n) => n.id).join(",") + "|" + graph.name;
  const structRef = useRef(structure);
  useEffect(() => {
    if (structRef.current !== structure) {
      structRef.current = structure;
      const t = setTimeout(() => smartFit(450), 60);
      return () => clearTimeout(t);
    }
  }, [structure, smartFit]);

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
      ref={boxRef}
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
        fitViewOptions={fitOpts()}
        onInit={() => smartFit()}
        deleteKeyCode={["Backspace", "Delete"]}
        proOptions={{ hideAttribution: true }}
        minZoom={0.3}
        maxZoom={1.6}
        colorMode="dark"
      >
        <StageLanes nodes={graph.nodes} />
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.3} color="rgba(178, 222, 222, 0.16)" />
        {tall && <MiniMap
          pannable
          zoomable
          position="bottom-right"
          nodeColor={(n) => NODE_META[(n.data as { node?: { type?: string } })?.node?.type ?? "router"]?.color ?? "#7f97a3"}
          nodeStrokeWidth={0}
          nodeBorderRadius={6}
          maskColor="rgba(6, 22, 30, 0.72)"
          bgColor="#0B202A"
          style={{ width: 150, height: 92 }}
        />}
      </ReactFlow>
      <div className="lk-tools">
        <AddNodeMenu />
        <button type="button" className="lk-tool" onClick={() => tidy()} title="Put every node back in its stage column">
          <Icon.grid size={14} /> Tidy
        </button>
        <span className="lk-tools__group">
          <button type="button" className="lk-tool lk-tool--icon" onClick={() => zoomOut({ duration: 200 })} aria-label="Zoom out">
            <Icon.minus size={14} />
          </button>
          <button type="button" className="lk-tool lk-tool--icon" onClick={() => zoomIn({ duration: 200 })} aria-label="Zoom in">
            <Icon.plus size={14} />
          </button>
          <button type="button" className="lk-tool" onClick={() => smartFit(300)}>
            Fit
          </button>
        </span>
      </div>
      {graph.nodes.length === 0 && (
        <div className="lk-empty">
          <p className="lk-empty__title">Empty canvas</p>
          <p>Add steps with Add node, pick a pack above, or press Recommend for this device to build a helper for the target phone.</p>
        </div>
      )}
    </div>
  );
}

/* ---------- Header ---------- */

function StudioHeader() {
  const graph = useStudio((s) => s.graph);
  const setInternet = useStudio((s) => s.setInternet);
  const setVoice = useStudio((s) => s.setVoice);
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const net = internetOn(graph);
  const voiceIn = graph.nodes.some((n) => n.type === "stt" && isEnabled(n));
  const voiceOut = graph.nodes.some((n) => n.type === "tts" && isEnabled(n));

  const exportPack = async () => {
    setBusy(true);
    try {
      // Switched-off voice stages are left out, so their models are not in the pack.
      const manifest = buildManifest(activeGraph(graph));
      const blob = await packZip(manifest);
      download(blob, `${slug(graph.name)}.zip`);
      try {
        const saved = JSON.parse(localStorage.getItem("lokol.packs") ?? "[]");
        const next = [manifest, ...saved.filter((m: { pack_id?: string }) => m.pack_id !== manifest.pack_id)].slice(0, 20);
        localStorage.setItem("lokol.packs", JSON.stringify(next));
      } catch {
        /* storage blocked: the zip still downloaded */
      }
      setToast("Pack exported. It is also listed under Packs and Deploy.");
    } catch (e) {
      setToast(`Export failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
      setTimeout(() => setToast(null), 3500);
    }
  };

  return (
    <div className="lk-header">
      <PackSelect />
      <div className="lk-header__switches" role="group" aria-label="Pack settings">
        <HeaderSwitch
          on={net}
          onToggle={() => setInternet(!net)}
          label="Internet"
          icon={net ? <Icon.wifi size={15} /> : <Icon.wifiOff size={15} />}
          hint={net ? "Online steps may use the internet when there is a signal (River 9B, WhatsApp, Messenger)." : "Everything runs on the device. Nothing is sent anywhere."}
        />
        <HeaderSwitch
          on={voiceIn}
          onToggle={() => setVoice("stt", !voiceIn)}
          label="Voice input"
          icon={<Icon.mic size={15} />}
          hint={voiceIn ? "Speech in is on: the worker can speak a question. Turn off for a text-only pack with no speech model to download." : "Text input only. Turn on to add speech in (a speech-to-text model)."}
        />
        <HeaderSwitch
          on={voiceOut}
          onToggle={() => setVoice("tts", !voiceOut)}
          label="Voice output"
          icon={<Icon.speaker size={15} />}
          hint={voiceOut ? "Replies are read aloud. Turn off to skip the voice model and save memory and storage." : "Text replies only. Turn on to read replies aloud."}
        />
      </div>
      <div className="lk-header__actions">
        {toast && <span className="lk-header__toast">{toast}</span>}
        <button type="button" className="btn-on-dark btn-sm" onClick={exportPack} disabled={busy}>
          <Icon.download size={14} /> {busy ? "Exporting…" : "Export pack"}
        </button>
        <button type="button" className="btn-glow btn-sm" onClick={() => navigate("/demo", { state: { graph: activeGraph(graph) } })}>
          Open in field app
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
      voiceIn: graph.nodes.some((n) => n.type === "stt" && isEnabled(n)),
      voiceOut: graph.nodes.some((n) => n.type === "tts" && isEnabled(n)),
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
  const openPack = useOpenPack();
  const packKey = useStudio((s) => s.packKey);
  useRestoreExtras(packKey);
  // ?pack=health|agriculture|tourism|farm|host|idb:<id>|export:<pack_id> (or the older ?preset=)
  const want = params.get("pack") ?? params.get("preset");
  useEffect(() => {
    if (want) void openPack(want);
  }, [want, openPack]);

  return (
    <ReactFlowProvider>
      <StudioInner />
    </ReactFlowProvider>
  );
}
