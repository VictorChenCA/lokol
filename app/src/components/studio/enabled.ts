import type { Graph, GraphNode } from "../../types";

/** Speech in and speech out are optional stages: a node with params.enabled === false is switched off. */
export function isOptionalStage(n: GraphNode): boolean {
  return n.type === "stt" || n.type === "tts";
}

export function isEnabled(n: GraphNode): boolean {
  return n.params?.enabled !== false;
}

/**
 * The graph as it will run and ship: switched-off nodes are removed and their inputs are wired
 * straight to their outputs, so a pack with voice off downloads no speech model.
 */
export function activeGraph(g: Graph): Graph {
  const off = new Set(g.nodes.filter((n) => !isEnabled(n)).map((n) => n.id));
  if (!off.size) return g;
  let edges = g.edges.slice();
  for (const id of off) {
    const preds = edges.filter((e) => e.to === id).map((e) => e.from);
    const succs = edges.filter((e) => e.from === id).map((e) => e.to);
    edges = edges.filter((e) => e.from !== id && e.to !== id);
    for (const p of preds)
      for (const s of succs) if (p !== s && !edges.some((e) => e.from === p && e.to === s)) edges.push({ from: p, to: s });
  }
  return { ...g, nodes: g.nodes.filter((n) => !off.has(n.id)), edges };
}
