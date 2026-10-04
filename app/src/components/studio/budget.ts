import type { Graph, GraphNode, GraphTarget, Tier } from "../../types";
import { getModel, NODE_META } from "../../models";
import { tierFor, freeStorageMb, reservedRamMb, appOverheadMb, isComputerName } from "../../recommend";

/** Download economics for the Solomon Islands (PLAN §4.3). */
export const SBD_PER_GB = 6;
export const BUNDLE_SOURCE = "Our Telekom Redhot Giga, 2026";
export const MBPS_3G = 2;

export type Verdict = "fits" | "tight" | "no";

export interface NodeCost {
  id: string;
  type: GraphNode["type"];
  label: string;
  ram_mb: number;
  disk_mb: number;
  /** Served from the internet (no local RAM or download). */
  hosted: boolean;
  issue: string | null;
}

export interface Budget {
  tier: Tier;
  computer: boolean;
  ram_total_mb: number;
  ram_reserved_mb: number;
  ram_usable_mb: number;
  app_overhead_mb: number;
  ram_used_mb: number;
  storage_free_mb: number;
  disk_mb: number;
  download_mb: number;
  minutes_3g: number;
  sbd: number;
  rows: NodeCost[];
  verdict: Verdict;
  reasons: string[];
  issues: Record<string, string>;
}

export function isComputer(t: GraphTarget): boolean {
  return isComputerName(t.device) || t.ram_gb > 8;
}

export function internetOn(g: Graph): boolean {
  return g.target.connectivity !== "none";
}

export function reservedMb(t: GraphTarget): number {
  return reservedRamMb(t.ram_gb, isComputer(t));
}

export function gb(mbv: number, digits = 1): string {
  return `${(mbv / 1024).toFixed(digits)} GB`;
}

export function nodeCost(n: GraphNode, g: Graph): NodeCost {
  const cat = getModel(n.model?.id);
  const net = internetOn(g);
  const tier = tierFor(g.target.ram_gb, isComputer(g.target));
  const hosted = !!(n.online && net && (cat?.online_runtime || n.model?.runtime === "river"));
  let ram = 0;
  let disk = 0;
  if (n.model && !hosted) {
    ram = cat?.ram_mb ?? Math.round(n.model.size_mb * 1.3 + 60);
    disk = n.model.size_mb;
  } else if (!n.model && (n.type === "gate" || n.type === "router" || n.type === "note")) {
    ram = 4;
  }
  let issue: string | null = null;
  const meta = NODE_META[n.type];
  if (cat && !hosted && !cat.tiers.includes(tier)) {
    issue = cat.runtime === "python" ? `${cat.name} runs in a Python service on a laptop, not on a phone.` : `${cat.name} needs ${cat.tiers.includes("C") ? "a 4 GB phone or better" : "a laptop or clinic PC"} (about ${gb(cat.ram_mb)} of RAM).`;
  } else if (n.model?.runtime === "river" && !net) {
    issue = `${meta?.name ?? n.type} is set to run on River, but the internet is off.`;
  } else if (n.online && !net) {
    issue = `Internet is off, so the online part of this node will not run.`;
  }
  return { id: n.id, type: n.type, label: n.label, ram_mb: ram, disk_mb: disk, hosted, issue };
}

export function computeBudget(g: Graph): Budget {
  const computer = isComputer(g.target);
  const tier = tierFor(g.target.ram_gb, computer);
  const ram_total_mb = Math.round(g.target.ram_gb * 1024);
  const ram_reserved_mb = reservedMb(g.target);
  const ram_usable_mb = Math.max(0, ram_total_mb - ram_reserved_mb);
  const app_overhead_mb = appOverheadMb(computer);
  const rows = g.nodes.map((n) => nodeCost(n, g));
  const ram_used_mb = rows.reduce((s, r) => s + r.ram_mb, 0) + app_overhead_mb;
  const seen = new Set<string>();
  let disk_mb = 0;
  for (const n of g.nodes) {
    const r = rows.find((x) => x.id === n.id)!;
    const key = n.model?.id ?? n.id;
    if (r.disk_mb && !seen.has(key)) {
      seen.add(key);
      disk_mb += r.disk_mb;
    }
  }
  const download_mb = disk_mb + 4; // + app shell
  const storage_free_mb = freeStorageMb(g.target.storage_gb);
  const minutes_3g = (download_mb * 8) / MBPS_3G / 60;
  const sbd = (download_mb / 1024) * SBD_PER_GB;

  const reasons: string[] = [];
  const issues: Record<string, string> = {};
  rows.forEach((r) => {
    if (r.issue) issues[r.id] = r.issue;
  });

  const ramRatio = ram_usable_mb ? ram_used_mb / ram_usable_mb : 9;
  const diskRatio = storage_free_mb ? disk_mb / storage_free_mb : 9;
  let verdict: Verdict = "fits";
  const worst = (v: Verdict) => {
    if (v === "no" || (v === "tight" && verdict === "fits")) verdict = v;
  };

  if (ramRatio > 1) {
    worst("no");
    reasons.push(`Needs about ${gb(ram_used_mb)} of memory; ${g.target.device} has about ${gb(ram_usable_mb)} free after the system.`);
  } else if (ramRatio > 0.85) {
    worst("tight");
    reasons.push(`Uses ${Math.round(ramRatio * 100)}% of the free memory (${gb(ram_used_mb)} of ${gb(ram_usable_mb)}). Close other apps first.`);
  } else {
    reasons.push(`Memory: ${gb(ram_used_mb)} of about ${gb(ram_usable_mb)} free.`);
  }
  if (diskRatio > 1) {
    worst("no");
    reasons.push(`The pack is ${gb(disk_mb)} but only about ${gb(storage_free_mb)} of storage is likely free.`);
  } else if (diskRatio > 0.8) {
    worst("tight");
    reasons.push(`Storage is tight: ${gb(disk_mb)} of about ${gb(storage_free_mb)} free.`);
  }
  const issueList = Object.values(issues);
  if (issueList.length) {
    const hard = rows.some((r) => r.issue && !/Internet is off/.test(r.issue));
    worst(hard ? "no" : "tight");
    reasons.push(...issueList);
  }
  return {
    tier,
    computer,
    ram_total_mb,
    ram_reserved_mb,
    ram_usable_mb,
    app_overhead_mb,
    ram_used_mb,
    storage_free_mb,
    disk_mb,
    download_mb,
    minutes_3g,
    sbd,
    rows,
    verdict,
    reasons,
    issues
  };
}

export function duration(min: number): string {
  if (min < 1) return "under a minute";
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

export const VERDICT_COPY: Record<Verdict, { en: string; pis: string }> = {
  fits: { en: "Fits", pis: "Hem fit" },
  tight: { en: "Tight", pis: "Klosap fulap" },
  no: { en: "Does not fit", pis: "No save fit" }
};
