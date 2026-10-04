import type { Graph, GraphNode } from "../../types";
import { getModel } from "../../models";

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
  { key: "check", en: "Check and record", pis: "Sekem an raetem" },
  { key: "speak", en: "Speak and send", pis: "Toktok an sendem" }
];

export const CARD_W = 272;
export const COL_W = 344; // column pitch: card + gutter for edges
export const ROW_GAP = 44; // vertical air between stacked cards

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
    case "note":
      return 3;
    case "tts":
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
    if (tts[0]) rows.set(tts[0].id, outs.length ? -1 : r++);
    outs.forEach((n) => rows.set(n.id, r++));
    tts.slice(1).forEach((n) => rows.set(n.id, r++));
  } else {
    const rank = (n: GraphNode) => (n.type === "router" ? 1 : n.type === "note" ? 2 : 0);
    const order = [...nodes].sort((a, b) => rank(a) - rank(b));
    order.forEach((n, i) => rows.set(n.id, i));
  }
  return rows;
}

/** Rendered card height in flow px (measured in Chrome at 272 px wide). */
export function estimateHeight(n: GraphNode): number {
  if (n.model) {
    const cat = getModel(n.model.id);
    return cat?.trainedBy || cat?.placeholder ? 204 : 178;
  }
  if (n.type === "gate") return Array.isArray(n.params?.rules) ? 140 : 180;
  if (n.type === "channel") {
    const kinds = Array.isArray(n.params?.kinds) ? (n.params.kinds as unknown[]).length : 1;
    return kinds + (n.params?.store_and_forward === true ? 1 : 0) > 2 ? 126 : 102;
  }
  if (n.type === "note") return 126;
  if (n.type === "router") return 112;
  return 120;
}

/** Lay a graph out as stage columns. Row 0 (the spine) is centre-aligned so its edges run straight. */
export function autoLayout(graph: Graph): Graph {
  const byStage = new Map<number, GraphNode[]>();
  for (const n of graph.nodes) {
    const s = stageIndex(n);
    byStage.set(s, [...(byStage.get(s) ?? []), n]);
  }
  const pos = new Map<string, { x: number; y: number }>();
  for (const [s, nodes] of byStage) {
    const rows = rowPlan(nodes, s);
    const sorted = [...nodes].sort((a, b) => (rows.get(a.id) ?? 0) - (rows.get(b.id) ?? 0));
    const zero = sorted.find((n) => (rows.get(n.id) ?? 0) === 0) ?? sorted[0];
    const yOf = new Map<string, number>();
    yOf.set(zero.id, -estimateHeight(zero) / 2);
    const idx = sorted.indexOf(zero);
    for (let i = idx - 1; i >= 0; i--) yOf.set(sorted[i].id, yOf.get(sorted[i + 1].id)! - ROW_GAP - estimateHeight(sorted[i]));
    for (let i = idx + 1; i < sorted.length; i++) yOf.set(sorted[i].id, yOf.get(sorted[i - 1].id)! + estimateHeight(sorted[i - 1]) + ROW_GAP);
    for (const n of nodes) pos.set(n.id, { x: s * COL_W, y: Math.round(yOf.get(n.id) ?? 0) });
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
