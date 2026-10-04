import type { LoadPack } from "./types";

export type RuntimeSource = "engine" | "shim";

/** `?runtime=shim` (canned replies, no downloads) or `?runtime=real` overrides VITE_RUNTIME for one visit. */
export function requestedRuntime(): "shim" | "real" {
  try {
    const q = new URLSearchParams(typeof location !== "undefined" ? location.search : "").get("runtime");
    if (q === "shim" || q === "real") return q;
  } catch {
    /* no location (tests) */
  }
  const env = ((import.meta.env.VITE_RUNTIME as string | undefined) ?? "real").toLowerCase();
  return env === "shim" ? "shim" : "real";
}

/**
 * Picks the real engine (app/src/runtime/engine.ts: wllama + transformers.js in the browser) unless
 * the shim is requested. import.meta.glob resolves to {} at build time when the file is missing,
 * so the Studio build never depends on the runtime having landed.
 */
export async function getRuntime(): Promise<{ loadPack: LoadPack; source: RuntimeSource }> {
  const mode = requestedRuntime();
  const mods = import.meta.glob("./runtime/engine.ts") as Record<string, () => Promise<any>>;
  const real = mods["./runtime/engine.ts"];
  if (mode !== "shim" && real) {
    try {
      const m = await real();
      if (typeof m.loadPack === "function") return { loadPack: m.loadPack as LoadPack, source: "engine" };
    } catch (e) {
      console.warn("[lokol] runtime/engine failed to load, falling back to shim", e);
    }
  }
  const shim = await import("./runtime-shim");
  return { loadPack: shim.loadPack, source: "shim" };
}
