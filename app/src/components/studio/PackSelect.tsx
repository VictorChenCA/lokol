import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Graph, Manifest, Sector } from "../../types";
import { useStudio } from "../../store";
import { getPack, listPacks } from "../../runtime/corpus_builder";
import { autoLayout } from "./layout";
import { registerPackExtras, packExtras } from "./trace";
import { Icon } from "./icons";

/** Packs the Studio can open: three built-in packs, packs built from a guideline (IndexedDB) and Studio exports. */
export interface PackOption {
  key: string;
  name: string;
  kind: string;
}

export const BUILT_IN: (PackOption & { sector: Sector })[] = [
  { key: "health", sector: "health", name: "Lokol Health", kind: "Custom pack" },
  { key: "agriculture", sector: "agriculture", name: "Lokol Farm", kind: "Sample pack" },
  { key: "tourism", sector: "tourism", name: "Lokol Host", kind: "Sample pack" }
];

const ALIAS: Record<string, Sector> = { health: "health", agriculture: "agriculture", farm: "agriculture", tourism: "tourism", host: "tourism" };

function loadExports(): Manifest[] {
  try {
    const v = JSON.parse(localStorage.getItem("lokol.packs") ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** The user's own packs: built from a guideline (IndexedDB), then Studio exports (localStorage). */
export function useUserPacks(): PackOption[] {
  const [packs, setPacks] = useState<PackOption[]>([]);
  useEffect(() => {
    let alive = true;
    const exports = loadExports()
      .filter((m) => m.pack_id && !ALIAS[m.pack_id])
      .map((m) => ({ key: `export:${m.pack_id}`, name: m.graph?.name ?? m.pack_id!, kind: "Your export" }));
    listPacks()
      .then((ps) => alive && setPacks([...ps.map((p) => ({ key: `idb:${p.id}`, name: p.name, kind: "From a guideline" })), ...exports]))
      .catch(() => alive && setPacks(exports));
    return () => {
      alive = false;
    };
  }, []);
  return packs;
}

function withDefaults(g: Graph): Graph {
  return autoLayout({ ...g, version: 1, nodes: g.nodes ?? [], edges: g.edges ?? [] });
}

/** Open a pack in the Studio by key. Returns false when the pack cannot be found. */
export function useOpenPack() {
  const loadPreset = useStudio((s) => s.loadPreset);
  const setGraph = useStudio((s) => s.setGraph);
  return useCallback(
    async (key: string): Promise<boolean> => {
      const sector = ALIAS[key];
      if (sector) {
        loadPreset(sector);
        return true;
      }
      if (key.startsWith("idb:")) {
        const p = await getPack(key.slice(4)).catch(() => null);
        const m = p?.manifest as (Manifest & Record<string, unknown>) | undefined;
        if (!m?.graph) return false;
        registerPackExtras(key, { corpus_inline: m.corpus_inline, red_flags: m.red_flags, fallback_message: m.fallback_message, pack_id: m.pack_id });
        setGraph(withDefaults({ ...m.graph, name: p!.name }), key);
        return true;
      }
      if (key.startsWith("export:")) {
        const m = loadExports().find((x) => x.pack_id === key.slice(7));
        if (!m?.graph) return false;
        setGraph(withDefaults(m.graph), key);
        return true;
      }
      return false;
    },
    [loadPreset, setGraph]
  );
}

/** After a reload, a pack built from a guideline needs its corpus registered again for test runs. */
export function useRestoreExtras(packKey: string) {
  useEffect(() => {
    if (!packKey.startsWith("idb:") || packExtras(packKey)) return;
    getPack(packKey.slice(4))
      .then((p) => {
        const m = p?.manifest as Record<string, unknown> | undefined;
        if (m) registerPackExtras(packKey, { corpus_inline: m.corpus_inline, red_flags: m.red_flags, fallback_message: m.fallback_message, pack_id: m.pack_id });
      })
      .catch(() => {});
  }, [packKey]);
}

export function PackSelect() {
  const graph = useStudio((s) => s.graph);
  const packKey = useStudio((s) => s.packKey);
  const user = useUserPacks();
  const openPack = useOpenPack();
  const navigate = useNavigate();
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

  const all = [...BUILT_IN, ...user];
  const cur = all.find((p) => p.key === packKey);
  const kind = cur?.kind ?? "Edited, not saved";
  const pick = async (key: string) => {
    setOpen(false);
    if (key !== packKey || !cur) await openPack(key);
    // keep the address in step, so a reload opens the same pack (other query params, like ?runtime, stay)
    const q = new URLSearchParams(location.search);
    q.set("pack", key);
    q.delete("preset");
    navigate(`/studio?${q.toString()}`, { replace: true });
  };

  return (
    <div className="lk-packsel" ref={ref}>
      <button type="button" className="lk-packsel__btn" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="min-w-0 text-left">
          <span className="lk-packsel__name">{cur && cur.key in ALIAS ? cur.name : graph.name}</span>
          <span className="lk-packsel__kind">{kind}</span>
        </span>
        <Icon.chevron size={15} className="opacity-70" />
      </button>
      {open && (
        <div className="lk-pop lk-pop--packs" role="listbox" aria-label="Packs">
          <p className="lk-packsel__group">Packs</p>
          {BUILT_IN.map((p) => (
            <button key={p.key} type="button" role="option" aria-selected={p.key === packKey} className={`lk-devopt ${p.key === packKey ? "is-sel" : ""}`} onClick={() => void pick(p.key)}>
              <span className="lk-devopt__name">{p.name}</span>
              <span className="lk-devopt__spec">{p.kind}</span>
            </button>
          ))}
          {user.length > 0 && <p className="lk-packsel__group">Your packs</p>}
          {user.map((p) => (
            <button key={p.key} type="button" role="option" aria-selected={p.key === packKey} className={`lk-devopt ${p.key === packKey ? "is-sel" : ""}`} onClick={() => void pick(p.key)}>
              <span className="lk-devopt__name truncate">{p.name}</span>
              <span className="lk-devopt__spec">{p.kind}</span>
            </button>
          ))}
          <div className="lk-packsel__new">
            <button type="button" className="lk-devopt" onClick={() => navigate("/packs/new")}>
              <span className="lk-devopt__name">
                <Icon.plus size={13} strokeWidth={2.4} /> New pack from a guideline
              </span>
              <span className="lk-devopt__spec">Upload a PDF</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** A compact on/off switch for the Studio header. */
export function HeaderSwitch({ on, onToggle, label, hint, icon, disabled }: { on: boolean; onToggle: () => void; label: string; hint: string; icon: React.ReactNode; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} className={`lk-hswitch ${on ? "is-on" : ""}`} onClick={onToggle} title={hint} disabled={disabled}>
      <span className="lk-hswitch__icon" aria-hidden>
        {icon}
      </span>
      <span className="lk-hswitch__label">
        {label} <b>{on ? "on" : "off"}</b>
      </span>
      <span className="lk-net-switch__track" aria-hidden>
        <span />
      </span>
    </button>
  );
}
