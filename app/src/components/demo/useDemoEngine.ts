import { useEffect, useRef, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { HEALTH_GRAPH } from "../../data/presets";
import { buildManifest } from "../../pack";
import { getRuntime, type RuntimeSource } from "../../runtime-loader";
import type { Engine, EngineStatus, Graph, Lang, LoadProgress, Manifest } from "../../types";

/** Fields the real engine adds on top of the shared Engine contract (all optional so the shim fits). */
export interface LiveModel {
  id: string;
  label: string;
  tuned: boolean;
  size_mb: number;
  url: string;
  source: "hub" | "local" | "pack";
  multithread?: boolean;
  threads?: number | null;
  arch?: string | null;
}
export type RichStatus = EngineStatus & {
  llm?: LiveModel | null;
  tts?: { pis: LiveModel | null; en: LiveModel | null };
  cross_origin_isolated?: boolean;
  threads?: number | null;
  llm_fallback_used?: boolean;
};
export type RichEngine = Engine & {
  status(): RichStatus;
  loadModel?: (role: "llm" | "stt" | "tts_pis" | "tts_en", onProgress?: (p: LoadProgress) => void) => Promise<unknown>;
  speakPCM?: (text: string, lang: Lang, onProgress?: (p: LoadProgress) => void) => Promise<{ audio: Float32Array; sampling_rate: number; seconds: number; ms: number }>;
  generate(flags: any, chunk: any, message: string, opts?: any): Promise<any>;
  gate(message: string, reply: any): any;
};

export type Progress = LoadProgress & { role?: string; pct?: number };

export const PACK_URL = "/packs/health/manifest.json";

export function useOnline() {
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

/** Resolves which pack to run, loads the runtime, reports per-role download progress, then warms the voice in the background. */
// ?size=1.7b swaps the pack's language model for the tuned 1.7B (4-8 GB phones, laptops). The engine resolves it
// Hub -> /local-models -> tuned 0.6B -> base, so the demo still runs if the bigger file is not reachable.
export const LLM_SIZES = [
  { key: "0.6b", label: "0.6B", detail: "400 MB, 2-3 GB phones" },
  { key: "1.7b", label: "1.7B", detail: "1.1 GB, 4-8 GB phones" },
] as const;
function withLlmSize(m: Manifest, size: string | null): Manifest {
  if (size !== "1.7b") return m;
  const file = "lokol-health-qwen3-1.7b-Q4_K_M.gguf";
  const llm = { id: "lokol-health-qwen3-1.7b", label: "Lokol Health 1.7B", role: "llm", tuned: true, base_model: "Qwen/Qwen3-1.7B", file,
    url: `https://huggingface.co/VictorChenCA/lokol-health-qwen3-1.7b-gguf/resolve/main/${file}`, size_mb: 1107, license: "Apache-2.0", runtime: "wllama" };
  const isLlm = (x: any) => x?.role === "llm" || /\.gguf$/.test(x?.file ?? "");
  const models = [...(m.models ?? []).filter((x: any) => !isLlm(x)), llm] as any;
  const graph = m.graph ? { ...m.graph, nodes: m.graph.nodes.map((n: any) => (n.type === "llm" ? { ...n, model: llm } : n)) } : m.graph;
  return { ...m, models, graph } as Manifest;
}

export function useDemoEngine() {
  const location = useLocation();
  const [params] = useSearchParams();
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [packNote, setPackNote] = useState<string | null>(null);
  const [engine, setEngine] = useState<RichEngine | null>(null);
  const [source, setSource] = useState<RuntimeSource | null>(null);
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<RichStatus | null>(null);
  const [attempt, setAttempt] = useState(0);
  const startedAt = useRef(0);
  const [loadMs, setLoadMs] = useState<number | null>(null);

  const graph = (location.state as { graph?: Graph } | null)?.graph;
  const packParam = params.get("pack");
  const sizeParam = params.get("size");

  useEffect(() => {
    let alive = true;
    (async () => {
      if (graph) {
        setPackNote("Running the graph you opened from the Studio.");
        return alive && setManifest(withLlmSize(buildManifest(graph), sizeParam));
      }
      const url = packParam || PACK_URL;
      try {
        if (url.startsWith("idb:")) {
          const { getPack } = await import("../../runtime/corpus_builder");
          const saved = await getPack(url.slice(4));
          if (!saved) throw new Error("not saved on this device");
          if (alive) setManifest(withLlmSize(saved.manifest as unknown as Manifest, sizeParam));
          return;
        }
        const r = await fetch(url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const m = (await r.json()) as Manifest;
        if (alive) setManifest(withLlmSize(m, sizeParam));
      } catch (e) {
        if (!alive) return;
        setPackNote(`Could not open the pack at ${url} (${(e as Error).message}). Running the built-in Lokol Health pack.`);
        setManifest(withLlmSize(buildManifest(HEALTH_GRAPH), sizeParam));
      }
    })();
    return () => {
      alive = false;
    };
  }, [graph, packParam, sizeParam]);

  useEffect(() => {
    if (!manifest) return;
    let alive = true;
    setEngine(null);
    setError(null);
    setProgress({});
    startedAt.current = performance.now();
    const onProgress = (p: Progress) => {
      if (!alive) return;
      const key = p.role ?? p.model_id;
      if (key === "pack") return;
      setProgress((prev) => ({ ...prev, [key]: p }));
    };
    (async () => {
      try {
        const rt = await getRuntime();
        if (!alive) return;
        setSource(rt.source);
        // ?threads=N pins the wllama thread count (default: cores - 1, max 6; fewer is faster on a busy machine)
        const threads = Number(new URLSearchParams(location.search).get("threads")) || undefined;
        const eng = (await (rt.loadPack as any)(manifest, onProgress, { excerpt_tokens: 220, llm: threads ? { n_threads: threads } : undefined })) as RichEngine;
        if (!alive) return;
        setLoadMs(Math.round(performance.now() - startedAt.current));
        (window as any).__lokolEngine = eng; // debugging hook: inspect status() / notes from the console
        setEngine(eng);
        setStatus(eng.status());
        // Warm the Pijin voice in the background so it is cached for offline use and the first tap plays fast.
        if (eng.loadModel) {
          eng
            .loadModel("tts_pis", onProgress)
            .then(() => alive && setStatus(eng.status()))
            .catch(() => alive && setStatus(eng.status()));
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [manifest, attempt]);

  return {
    manifest,
    packNote,
    engine,
    source,
    progress,
    error,
    status,
    loadMs,
    refreshStatus: () => engine && setStatus(engine.status()),
    retry: () => setAttempt((n) => n + 1),
    onProgressFor: (cb: (p: Progress) => void) => cb
  };
}

/** Captures the browser's install prompt; also knows when we are already installed or on iOS (manual add). */
export function useInstallPrompt() {
  const [evt, setEvt] = useState<any>(null);
  const [installed, setInstalled] = useState(false);
  useEffect(() => {
    const standalone = window.matchMedia?.("(display-mode: standalone)").matches || (navigator as any).standalone === true;
    setInstalled(!!standalone);
    const h = (e: Event) => {
      e.preventDefault();
      setEvt(e);
    };
    const done = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", h);
    window.addEventListener("appinstalled", done);
    return () => {
      window.removeEventListener("beforeinstallprompt", h);
      window.removeEventListener("appinstalled", done);
    };
  }, []);
  const ios = typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);
  return {
    canPrompt: !!evt,
    installed,
    ios,
    prompt: async () => {
      if (!evt) return;
      evt.prompt();
      const choice = await evt.userChoice.catch(() => null);
      if (choice?.outcome === "accepted") setInstalled(true);
      setEvt(null);
    }
  };
}
