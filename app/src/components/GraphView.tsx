import { useMemo } from "react";
import { ReactFlow, Background, BackgroundVariant } from "@xyflow/react";
import type { Graph } from "../types";
import { nodeTypes, type LokolNode } from "./NodeCard";
import { edgeTypes, type FlowEdgeT } from "./studio/FlowEdge";
import { edgeHandles } from "./studio/layout";
import { computeBudget, internetOn } from "./studio/budget";
import "./studio/studio.css";

/** Read-only, auto-fitted rendering of a graph (Recommend result, Deploy viewer, Home). Same dark canvas as the Studio. */
export function GraphView({ graph, height = 320 }: { graph: Graph; height?: number }) {
  const net = internetOn(graph);
  const issues = useMemo(() => computeBudget(graph).issues, [graph]);
  const nodes = useMemo<LokolNode[]>(
    () =>
      graph.nodes.map((n) => ({
        id: n.id,
        type: "lokol",
        position: n.position,
        data: { node: n, readOnly: true, issue: issues[n.id] ?? null, internet: net },
        draggable: false,
        selectable: false
      })),
    [graph, issues, net]
  );
  const edges = useMemo<FlowEdgeT[]>(() => {
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    return graph.edges.map((e) => ({
      id: `${e.from}->${e.to}`,
      source: e.from,
      target: e.to,
      type: "flow",
      ...edgeHandles(byId.get(e.from), byId.get(e.to)),
      data: { readOnly: true }
    }));
  }, [graph]);
  return (
    <div className="lk-mini" style={{ height }}>
      <ReactFlow
        key={graph.nodes.map((n) => n.id + (n.model?.id ?? "")).join(",")}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.08, maxZoom: 0.9 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnScroll={false}
        panOnScroll
        minZoom={0.15}
        colorMode="dark"
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="rgba(178, 222, 222, 0.14)" />
      </ReactFlow>
    </div>
  );
}
