import type { Graph, GraphNode } from "../../types";

/** Left-to-right stages of every Lokol pipeline. Numbered because they are a real sequence. */
export interface Stage {
  key: "hear" | "understand" | "think" | "check" | "speak";
  en: string;
  pis: string;
}

export const STAGES: Stage[] = [
  { key: "hear", en: "Hear", pis: "Harem" },
  { key: "understand", en: "Understand", pis: "Lukim buk" },
  { key: "think", en: "Think", pis: "Tingting" },
  { key: "check", en: "Check", pis: "Sekem" },
  { key: "speak", en: "Speak and send", pis: "Toktok an sendem" }
];

export const CARD_W = 256;
export const COL_W = 320; // column pitch: card + gutter for edges
export const ROW_H = 176; // row pitch: card + gap

export function direction(n: GraphNode): "in" | "out" | "both" {
  const d = n.params?.direction;
  return d === "in" || d === "out" ? d : "both";
}

export function stageIndex(n: GraphNode): number {
  switch (n.type) {
    case "channel":
      return direction(n) === "out" ? 4 : 0;
    case "stt":
      return 0;
    case "rag":
      return 1;
    case "llm":
      return 2;
    case "gate":
    case "router":
      return 3;
    case "tts":
    case "note":
      return 4;
    default:
      return 2;
  }
}

/** Row within the stage: 0 is the main spine (channel → lookup → model → gate → reply). */
function rowPlan(nodes: GraphNode[], stage: number): Map<string, number> {
  const rows = new Map<string, number>();
  const lang = (n: GraphNode) => String(n.params?.lang ?? "");
  const byLang = (a: GraphNode, b: GraphNode) => (lang(a) === "pis" ? -1 : 0) - (lang(b) === "pis" ? -1 : 0);
  let r = 0;
  if (stage === 0) {
    const chans = nodes.filter((n) => n.type === "channel");
    const stts = nodes.filter((n) => n.type === "stt").sort(byLang);
    // one speech-in node sits above the channel, a second below it, so every edge joins neighbours
    if (stts[0]) rows.set(stts[0].id, chans.length ? -1 : r++);
    chans.forEach((n) => rows.set(n.id, r++));
    stts.slice(1).forEach((n) => rows.set(n.id, r++));
  } else if (stage === 4) {
    const outs = nodes.filter((n) => n.type === "channel");
    const tts = nodes.filter((n) => n.type === "tts").sort(byLang);
    const notes = nodes.filter((n) => n.type === "note");
    if (tts[0]) rows.set(tts[0].id, outs.length ? -1 : r++);
    outs.forEach((n) => rows.set(n.id, r++));
    tts.slice(1).forEach((n) => rows.set(n.id, r++));
    notes.forEach((n) => rows.set(n.id, r++));
  } else {
    const order = [...nodes].sort((a, b) => (a.type === "router" ? 1 : 0) - (b.type === "router" ? 1 : 0));
    order.forEach((n, i) => rows.set(n.id, i));
  }
  return rows;
}

/** Lay a graph out as stage columns. Keeps ids, params and edges; only positions change. */
export function autoLayout(graph: Graph): Graph {
  const byStage = new Map<number, GraphNode[]>();
  for (const n of graph.nodes) {
    const s = stageIndex(n);
    byStage.set(s, [...(byStage.get(s) ?? []), n]);
  }
  const pos = new Map<string, { x: number; y: number }>();
  for (const [s, nodes] of byStage) {
    const rows = rowPlan(nodes, s);
    for (const n of nodes) pos.set(n.id, { x: s * COL_W, y: (rows.get(n.id) ?? 0) * ROW_H });
  }
  return { ...graph, nodes: graph.nodes.map((n) => ({ ...n, position: pos.get(n.id) ?? n.position })) };
}

/** Same-column edges run top-to-bottom through the card's top and bottom handles. */
export function edgeHandles(src: GraphNode | undefined, dst: GraphNode | undefined): { sourceHandle: string; targetHandle: string } {
  if (src && dst && Math.abs(src.position.x - dst.position.x) < CARD_W * 0.6) {
    return src.position.y < dst.position.y ? { sourceHandle: "sb", targetHandle: "tt" } : { sourceHandle: "st", targetHandle: "tb" };
  }
  return { sourceHandle: "sr", targetHandle: "tl" };
}
