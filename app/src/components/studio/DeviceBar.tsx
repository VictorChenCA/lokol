import { useEffect, useMemo, useRef, useState } from "react";
import devicesJson from "../../data/devices.json";
import type { Device, Graph } from "../../types";
import { NODE_META } from "../../models";
import { useStudio } from "../../store";
import { searchDevices, TIER_HINT } from "../../recommend";
import { computeBudget, duration, gb, internetOn, BUNDLE_SOURCE, SBD_PER_GB, VERDICT_COPY, type Budget } from "./budget";
import { Icon } from "./icons";

const COMPUTERS: Device[] = [
  { brand: "Laptop", model: "16 GB", ram_gb: 16, storage_gb: 512, soc: "Apple M1 or Intel i5", os: "macOS / Windows", year: 2021, price_band: "upper", approximate: true },
  { brand: "Clinic PC", model: "8 GB", ram_gb: 8, storage_gb: 256, soc: "Intel Core i3", os: "Windows 10", year: 2019, price_band: "mid", approximate: true }
];
const PHONES = (devicesJson as { devices: Device[] }).devices;

function deviceName(d: Device) {
  return `${d.brand} ${d.model}`;
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

function DevicePicker({ graph }: { graph: Graph }) {
  const setTarget = useStudio((s) => s.setTarget);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useClickAway(ref, () => setOpen(false), open);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    const comps = COMPUTERS.filter((d) => !s || deviceName(d).toLowerCase().includes(s) || "laptop computer pc clinic".includes(s));
    return [...comps, ...searchDevices(PHONES, q)];
  }, [q]);
  const computer = /laptop|pc/i.test(graph.target.device);
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
            <input autoFocus placeholder="Search phones: Redmi 9A, Galaxy A0…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search devices" />
          </label>
          <ul role="listbox" className="lk-devlist">
            {list.map((d) => {
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
                      setOpen(false);
                      setQ("");
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
            {list.length === 0 && <li className="lk-devlist__empty">No phone matches “{q}”. Try the brand and model number, like “A12”.</li>}
          </ul>
          <p className="lk-pop__foot">Specs are approximate: the most common variant sold in the Pacific.</p>
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
    <div className="lk-meter lk-meter--sm" title="We assume about 35% of the phone's storage is free.">
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
  const setInternet = useStudio((s) => s.setInternet);
  const b = useMemo(() => computeBudget(graph), [graph]);
  const net = internetOn(graph);
  const [why, setWhy] = useState(false);
  const whyRef = useRef<HTMLDivElement>(null);
  useClickAway(whyRef, () => setWhy(false), why);
  const v = VERDICT_COPY[b.verdict];

  return (
    <div className="lk-devicebar" role="region" aria-label="Target device and budget">
      <DevicePicker graph={graph} />
      <span className="lk-tier" title={TIER_HINT}>
        Tier {b.tier}
      </span>
      <div className="lk-sep" />
      <RamBar b={b} />
      <DiskBar b={b} />
      <div className="lk-dl" title={`Mobile data at SBD ${SBD_PER_GB} per GB (${BUNDLE_SOURCE}); 3G at about 2 Mbps.`}>
        <span className="lk-dl__v">{gb(b.download_mb)} download, once</span>
        <span className="lk-dl__k">
          {duration(b.minutes_3g)} on 3G, SBD {b.sbd < 1 ? b.sbd.toFixed(2) : b.sbd.toFixed(1)} of data
        </span>
      </div>
      <div className="lk-sep" />
      <button type="button" role="switch" aria-checked={net} className={`lk-net-switch ${net ? "is-on" : ""}`} onClick={() => setInternet(!net)} title={net ? "Online nodes may use the internet (River 9B, WhatsApp, Messenger)." : "Everything runs on the device. Nothing is sent anywhere."}>
        {net ? <Icon.wifi size={16} /> : <Icon.wifiOff size={16} />}
        <span className="lk-net-switch__text">
          <span>Internet {net ? "on" : "off"}</span>
          <em>{net ? "Online steps allowed" : "All on this device"}</em>
        </span>
        <span className="lk-net-switch__track">
          <span />
        </span>
      </button>
      <div className="relative" ref={whyRef}>
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
      <button type="button" className="lk-recommend" onClick={onRecommend} disabled={busy}>
        <Icon.wand size={16} />
        Recommend for this device
      </button>
    </div>
  );
}
