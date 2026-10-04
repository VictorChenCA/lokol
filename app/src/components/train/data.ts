import { useCallback, useEffect, useRef, useState } from "react";

/** Fetch the first JSON file that loads from `paths`. `isSample` is true when a fallback (path containing "sample") was used. */
export function useJson<T>(paths: string[], opts: { validate?: (j: unknown) => boolean; pollMs?: number | ((d: T) => number | null) } = {}) {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean; source: string | null }>({
    data: null,
    error: null,
    loading: true,
    source: null
  });
  const key = paths.join("|");
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const load = useCallback(async () => {
    for (const p of key.split("|")) {
      try {
        const r = await fetch(p, { cache: "no-store" });
        if (!r.ok) continue;
        const ct = r.headers.get("content-type") || "";
        if (!ct.includes("json")) continue; // the dev server answers unknown paths with index.html
        const j = (await r.json()) as T;
        if (optsRef.current.validate && !optsRef.current.validate(j)) continue;
        setState({ data: j, error: null, loading: false, source: p });
        return j;
      } catch {
        /* try next */
      }
    }
    setState((s) => ({ ...s, loading: false, error: `Nothing found at ${key.split("|")[0]}` }));
    return null;
  }, [key]);

  useEffect(() => {
    let timer: number | undefined;
    let alive = true;
    const tick = async () => {
      const d = await load();
      if (!alive) return;
      const p = optsRef.current.pollMs;
      const ms = typeof p === "function" ? (d ? p(d) : null) : p;
      if (ms) timer = window.setTimeout(tick, ms);
    };
    tick();
    return () => {
      alive = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [load]);

  return { ...state, isSample: !!state.source?.includes("sample"), reload: load };
}

export const pct = (v: number | null | undefined, digits = 0) =>
  v === null || v === undefined || Number.isNaN(v) ? "n/a" : `${(v * 100).toFixed(digits)}%`;

export const int = (n: number | null | undefined) => (n === null || n === undefined ? "n/a" : n.toLocaleString("en-US"));

export function duration(s: number | null | undefined): string {
  if (s === null || s === undefined || !Number.isFinite(s)) return "n/a";
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h} h ${m.toString().padStart(2, "0")} min`;
  if (m) return `${m} min`;
  return `${s} s`;
}

export function ago(iso: string | null | undefined): string {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export const LANG_LABEL: Record<string, { en: string; pis: string; color: string }> = {
  pis: { en: "Pijin", pis: "Pijin", color: "#0F7B88" },
  en: { en: "English", pis: "Inglis", color: "#102C3C" },
  mix: { en: "Mixed", pis: "Miksim", color: "#8A9EA8" }
};

export const TASK_LABEL: Record<string, { en: string; pis: string; color: string; blurb: string }> = {
  guidance: { en: "Guidance", pis: "Advaes", color: "#0F7B88", blurb: "Nurse asks what to do; answer per the manual." },
  referral: { en: "Referral", pis: "Sendem", color: "#C32F49", blurb: "Danger signs or failed treatment: refer now or on the next boat." },
  note: { en: "Visit note", pis: "Raetem", color: "#8A6D3B", blurb: "Dictated visit becomes a JSON record." },
  followup: { en: "Follow-up", pis: "Kam bak", color: "#7A5CA8", blurb: "Short message for the caregiver." },
  abstain: { en: "Abstain", pis: "Mi no sua", color: "#5C6B75", blurb: "Out of scope: say so and name whom to ask." }
};

export const ACTION_COLOR: Record<string, string> = {
  ADVISE: "#0F7B88",
  REFER_NOW: "#C32F49",
  REFER_NEXT_TRANSPORT: "#E9A93A",
  ASK_PERSON: "#5C6B75"
};
