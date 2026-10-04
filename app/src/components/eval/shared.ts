import type { EvalMetrics, EvalResults, EvalRow, Tier } from "../../types";

export const BASE_COLOR = "#B06E12";
export const TUNED_COLOR = "#0F7B88";

export type MetricDef = { key: keyof EvalMetrics; label: string; pis: string; max: number; why: string };

/** The seven headline metrics, in the order a nurse would care about them. */
export const HEADLINE: MetricDef[] = [
  { key: "red_flag_recall", label: "Catches danger signs", pis: "Lukim saen blong denja", max: 1, why: "Share of danger-sign cases the model refers (now or next boat)." },
  { key: "abstain_recall", label: "Says “not sure, ask a person” when it should", pis: "Mi no sua, askem nes", max: 1, why: "Share of out-of-scope or no-guideline cases answered ASK_PERSON." },
  { key: "action_accuracy", label: "Right action", pis: "Stret samting fo duim", max: 1, why: "ADVISE, REFER_NOW, REFER_NEXT_TRANSPORT or ASK_PERSON matches the reference." },
  { key: "stm_accuracy", label: "Cites the right manual section", pis: "Stret pej long buk", max: 1, why: "The STM line names the same section as the reference." },
  { key: "format_compliance", label: "Follows the protocol format", pis: "Folom fomat", max: 1, why: "Reply parses as ACTION / STM / --- / reply, so the app and the safety gate can read it." },
  { key: "pijin_glossary_hit_rate", label: "Answers in Pijin when asked in Pijin", pis: "Toktok long Pijin", max: 1, why: "Pijin prompts whose reply uses at least 3 words from the Pijin glossary." },
  { key: "judge_faithfulness_0_3", label: "Faithful to the manual (judge, 0 to 3)", pis: "Folom buk", max: 3, why: "Headless Claude grades each reply against the guideline excerpt; 0 when the judge was not run." }
];

export const fmtMetric = (m: MetricDef, v: number | undefined | null) =>
  v === undefined || v === null || Number.isNaN(v) ? "n/a" : m.max === 1 ? `${Math.round(v * 100)}%` : v.toFixed(1);

const SIZE_TIER: Record<string, Tier> = { "0.6B": "A", "0.8B": "A", "1.7B": "B", "2B": "B", "4B": "C", "9B": "D" };
export const TIER_NAME: Record<Tier, string> = { A: "Small phone", B: "Everyday phone", C: "Better phone", D: "Laptop" };

export function tierOf(r: EvalRow | undefined, size: string): Tier {
  return r?.tier ?? SIZE_TIER[size.toUpperCase()] ?? (parseFloat(size) >= 7 ? "D" : parseFloat(size) >= 3 ? "C" : parseFloat(size) >= 1.2 ? "B" : "A");
}

export type Group = { size: string; tier: Tier; base?: EvalRow; tuned?: EvalRow; smoke: boolean };

export function groupRows(data: EvalResults): Group[] {
  const sizes = Array.from(new Set(data.rows.map((r) => r.size)));
  const notes = (data.notes ?? []).join("\n").toLowerCase();
  return sizes
    .map((size) => {
      const base = data.rows.find((r) => r.size === size && r.variant === "base");
      const tuned = data.rows.find((r) => r.size === size && r.variant === "tuned");
      const smoke = [base, tuned].some((r) => r && /stub|smoke/i.test(r.model)) || notes.includes(`-${size.toLowerCase()}-stub`);
      return { size, tier: tierOf(tuned ?? base, size), base, tuned, smoke };
    })
    .sort((a, b) => a.tier.localeCompare(b.tier) || parseFloat(a.size) - parseFloat(b.size));
}

export function familyOf(r: EvalRow | undefined): string {
  if (!r) return "";
  const m = r.model.match(/Qwen[\d.]+/i);
  return m ? m[0].replace(/^qwen/i, "Qwen") : "";
}
