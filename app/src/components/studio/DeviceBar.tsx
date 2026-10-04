import { useEffect, useMemo, useRef, useState } from "react";
import devicesJson from "../../data/devices.json";
import type { Device, Graph } from "../../types";
import { NODE_META } from "../../models";
import { useStudio } from "../../store";
import { isComputerName } from "../../recommend";
import { computeBudget, duration, gb, isComputer, BUNDLE_SOURCE, SBD_PER_GB, VERDICT_COPY, type Budget } from "./budget";
import { Icon } from "./icons";

const ALL = (devicesJson as { devices: Device[] }).devices;

function deviceName(d: Device) {
  return d.brand === "Generic" ? d.model : `${d.brand} ${d.model}`;
}
const COMPUTERS = ALL.filter((d) => isComputerName(deviceName(d)));
const PHONES = ALL.filter((d) => !isComputerName(deviceName(d)));
const FLAGSHIPS = PHONES.filter((d) => d.price_band === "premium").sort((a, b) => b.year - a.year || a.brand.localeCompare(b.brand));
const BUDGET = PHONES.filter((d) => d.price_band !== "premium");

function matches(d: Device, q: string) {
  const parts = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hay = `${d.brand} ${d.model} ${d.soc}`.toLowerCase();
  return parts.every((p) => hay.includes(p));
}

function useClickAway(ref: React.RefObject<HTMLElement>, onAway: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onAway();
    };
    const k = (e: KeyboardEvent) => e.key === "Escape" && onAway();
    document.addEventListener("mousedown", h);
    document.addEventListener("keydown", k);
    return () => {
      document.removeEventListener("mousedown", h);
      document.removeEventListener("keydown", k);
    };
  }, [ref, onAway, active]);
}

function CustomDevice({ graph, onDone }: { graph: Graph; onDone: () => void }) {
  const setTarget = useStudio((s) => s.setTarget);
  const [ram, setRam] = useState(graph.target.ram_gb);
  const [storage, setStorage] = useState(graph.target.storage_gb);
  const [pc, setPc] = useState(isComputer(graph.target));
  return (
    <form
      className="lk-custom"
      onSubmit={(e) => {
        e.preventDefault();
        setTarget({ device: pc ? `Custom laptop or PC` : `Custom phone`, ram_gb: Math.max(1, ram), storage_gb: Math.max(4, storage) });
        onDone();
      }}
    >
      <label>
        <span>RAM (GB)</span>
        <input type="number" min={1} max={128} step={0.5} value={ram} onChange={(e) => setRam(Number(e.target.value))} />
      </label>
      <label>
        <span>Storage (GB)</span>
        <input type="number" min={4} max={4096} value={storage} onChange={(e) => setStorage(Number(e.target.value))} />
      </label>
      <label className="lk-custom__pc">
        <input type="checkbox" checked={pc} onChange={(e) => setPc(e.target.checked)} />
        <span>Laptop or clinic PC</span>
      </label>
      <button type="submit" className="lk-custom__go">
        Use these numbers
      </button>
    </form>
  );
}

function DevicePicker({ graph }: { graph: Graph }) {
  const setTarget = useStudio((s) => s.setTarget);
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useClickAway(ref, () => setOpen(false), open);
  const groups = useMemo(() => {
    const s = q.trim();
    const comps = s ? COMPUTERS.filter((d) => matches(d, s) || /laptop|computer|pc|clinic/i.test(s)) : COMPUTERS;
    if (s) {
      return [
        { title: "Phones", items: PHONES.filter((d) => matches(d, s)).slice(0, 30) },
        { title: "Laptops and clinic PCs", items: comps }
      ].filter((g) => g.items.length);
    }
    // No search: the whole list, flagships (recent iPhones, Galaxy S, Pixel) first, then budget and mid-range phones.
    return [
      { title: "Flagship phones", items: FLAGSHIPS },
      { title: "Budget and mid-range phones", items: BUDGET },
      { title: "Laptops and clinic PCs", items: comps }
    ].filter((g) => g.items.length);
  }, [q]);
  const computer = isComputer(graph.target);
  const close = () => {
    setOpen(false);
    setQ("");
    setCustom(false);
  };
  return (
    <div className="relative" ref={ref}>
      <button type="button" className="lk-dev" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="lk-dev__icon">{computer ? <Icon.laptop size={18} /> : <Icon.phone size={18} />}</span>
        <span className="min-w-0 text-left">
          <span className="lk-dev__name">{graph.target.device}</span>
          <span className="lk-dev__spec">
            {graph.target.ram_gb} GB RAM, {graph.target.storage_gb} GB storage
          </span>
        </span>
        <Icon.chevron size={14} className="opacity-60" />
      </button>
      {open && (
        <div className="lk-pop lk-pop--devices" role="dialog" aria-label="Pick a target device">
          <label className="lk-search">
            <Icon.search size={15} />
            <input autoFocus placeholder="Search: Galaxy A15, Redmi, MacBook…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search devices" />
          </label>
          <button type="button" className={`lk-devopt lk-devopt--custom ${custom ? "is-sel" : ""}`} aria-expanded={custom} onClick={() => setCustom((v) => !v)}>
            <span className="lk-devopt__name">Custom device</span>
            <span className="lk-devopt__spec">Type RAM and storage</span>
          </button>
          {custom && <CustomDevice graph={graph} onDone={close} />}
          <ul role="listbox" className="lk-devlist" style={{ maxHeight: "60vh" }}>
            {groups.map((g) => (
              <li key={g.title}>
                <p className="lk-packsel__group">{g.title}</p>
                <ul>
                  {g.items.map((d) => {
                    const name = deviceName(d);
                    const sel = name === graph.target.device;
                    return (
                      <li key={name}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={sel}
                          className={`lk-devopt ${sel ? "is-sel" : ""}`}
                          onClick={() => {
                            setTarget({ device: name, ram_gb: d.ram_gb, storage_gb: d.storage_gb });
                            close();
                          }}
                        >
                          <span className="lk-devopt__name">{name}</span>
                          <span className="lk-devopt__spec">
                            {d.ram_gb} GB, {d.storage_gb} GB{d.year ? `, ${d.year}` : ""}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
            {groups.length === 0 && (
              <li className="lk-devlist__empty">
                No device matches “{q}”. Use Custom device and copy RAM and storage from the phone's About screen.
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function RamBar({ b }: { b: Budget }) {
  const scale = Math.max(b.ram_total_mb, b.ram_reserved_mb + b.ram_used_mb);
  const pct = (v: number) => `${(v / scale) * 100}%`;
  const over = b.ram_reserved_mb + b.ram_used_mb > b.ram_total_mb;
  return (
    <div className="lk-meter" title={`System keeps about ${gb(b.ram_reserved_mb)}. Lokol needs about ${gb(b.ram_used_mb)} of the ${gb(b.ram_usable_mb)} left.`}>
      <div className="lk-meter__top">
        <span>Memory</span>
        <strong className={over ? "is-bad" : ""}>
          {gb(b.ram_used_mb)} <em>of {gb(b.ram_usable_mb)} free</em>
        </strong>
      </div>
      <div className="lk-bar">
        <span className="lk-bar__seg lk-bar__seg--sys" style={{ width: pct(b.ram_reserved_mb) }} />
        <span className="lk-bar__seg" style={{ width: pct(b.app_overhead_mb), background: "#8EA3AE" }} title={`App and browser, ${Math.round(b.app_overhead_mb)} MB`} />
        {b.rows
          .filter((r) => r.ram_mb > 8)
          .map((r) => (
            <span key={r.id} className="lk-bar__seg" style={{ width: pct(r.ram_mb), background: NODE_META[r.type]?.color }} title={`${r.label}: ${Math.round(r.ram_mb)} MB`} />
          ))}
        {over && <span className="lk-bar__cap" style={{ left: pct(b.ram_total_mb) }} />}
      </div>
    </div>
  );
}

function DiskBar({ b }: { b: Budget }) {
  const scale = Math.max(b.storage_free_mb, b.disk_mb);
  const over = b.disk_mb > b.storage_free_mb;
  return (
    <div className="lk-meter lk-meter--sm" title="We assume about 35% of the device's storage is free for the pack.">
      <div className="lk-meter__top">
        <span>Storage</span>
        <strong className={over ? "is-bad" : ""}>
          {gb(b.disk_mb)} <em>of {gb(b.storage_free_mb, 0)}</em>
        </strong>
      </div>
      <div className="lk-bar">
        <span className="lk-bar__seg" style={{ width: `${Math.max(1.5, (b.disk_mb / scale) * 100)}%`, background: over ? "#C32F49" : "#E9A93A" }} />
      </div>
    </div>
  );
}

export function DeviceBar({ onRecommend, busy }: { onRecommend: () => void; busy?: boolean }) {
  const graph = useStudio((s) => s.graph);
  const b = useMemo(() => computeBudget(graph), [graph]);
  const [why, setWhy] = useState(false);
  const whyRef = useRef<HTMLDivElement>(null);
  useClickAway(whyRef, () => setWhy(false), why);
  const v = VERDICT_COPY[b.verdict];

  return (
    <div className="lk-devicebar" role="region" aria-label="Target device and budget">
      <DevicePicker graph={graph} />
      <button type="button" className="lk-recommend" onClick={onRecommend} disabled={busy} title="Pick the models, voice and size that fit this device">
        <Icon.wand size={16} />
        Recommend for this device
      </button>
      <div className="lk-sep" />
      <RamBar b={b} />
      <DiskBar b={b} />
      <div className="lk-dl" title={`Mobile data at SBD ${SBD_PER_GB} per GB (${BUNDLE_SOURCE}); 3G at about 2 Mbps.`}>
        <span className="lk-dl__v">{gb(b.download_mb)} download, once</span>
        <span className="lk-dl__k">
          {duration(b.minutes_3g)} on 3G, SBD {b.sbd < 1 ? b.sbd.toFixed(2) : b.sbd.toFixed(1)} of data
        </span>
      </div>
      <div className="relative lk-verdictwrap" ref={whyRef}>
        <button type="button" className={`lk-verdict is-${b.verdict}`} aria-expanded={why} onClick={() => setWhy((x) => !x)}>
          {b.verdict === "fits" ? <Icon.check size={14} strokeWidth={2.4} /> : <Icon.warn size={14} strokeWidth={2.2} />}
          <span>{b.verdict === "fits" ? `Fits your ${graph.target.device}` : b.verdict === "tight" ? `Tight on your ${graph.target.device}` : `Too big for your ${graph.target.device}`}</span>
          <em>({graph.target.ram_gb} GB RAM)</em>
        </button>
        {why && (
          <div className="lk-pop lk-pop--why" role="dialog" aria-label="Why">
            <p className="lk-pop__title">
              {v.en} on {graph.target.device}
            </p>
            <ul>
              {b.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <p className="lk-pop__foot">Assumes every model stays loaded. Data price: SBD {SBD_PER_GB} per GB, {BUNDLE_SOURCE}.</p>
          </div>
        )}
      </div>
    </div>
  );
}
