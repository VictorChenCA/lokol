import { useMemo } from "react";
import devicesJson from "../../data/devices.json";
import type { Device, Graph, GraphTarget } from "../../types";
import { getModel, modelsFor, ref } from "../../models";
import { isComputerName } from "../../recommend";
import { computeBudget, duration, gb } from "../studio/budget";
import { isEnabled } from "../studio/enabled";
import { Badge, Switch, mb } from "../ui";

/** Step 2 of Deploy: the settings a pack ships with (device, voice, internet, model size). */

export interface DeployCfg {
  device: string;
  ram_gb: number;
  storage_gb: number;
  custom: boolean;
  voiceIn: boolean;
  voiceOut: boolean;
  internet: boolean;
  llm: string | null;
}

const DEVICES = (devicesJson as { devices: Device[] }).devices;
const nameOf = (d: Device) => (d.brand === "Generic" ? d.model : `${d.brand} ${d.model}`);
const PHONES = DEVICES.filter((d) => !isComputerName(nameOf(d)));
const COMPUTERS = DEVICES.filter((d) => isComputerName(nameOf(d)));
const ONLINE_KINDS = ["whatsapp", "messenger"];

export function cfgFrom(g: Graph): DeployCfg {
  const known = DEVICES.some((d) => nameOf(d) === g.target.device);
  return {
    device: g.target.device,
    ram_gb: g.target.ram_gb,
    storage_gb: g.target.storage_gb,
    custom: !known,
    voiceIn: g.nodes.some((n) => n.type === "stt" && isEnabled(n)),
    voiceOut: g.nodes.some((n) => n.type === "tts" && isEnabled(n)),
    internet: g.target.connectivity !== "none",
    llm: g.nodes.find((n) => n.type === "llm")?.model?.id ?? null
  };
}

export function applyCfg(g: Graph, c: DeployCfg): Graph {
  const connectivity: GraphTarget["connectivity"] = c.internet ? (g.target.connectivity === "none" ? "intermittent" : g.target.connectivity) : "none";
  const nodes = g.nodes.map((n) => {
    let out = n;
    if (n.type === "stt") out = { ...out, params: { ...out.params, enabled: c.voiceIn } };
    if (n.type === "tts") out = { ...out, params: { ...out.params, enabled: c.voiceOut } };
    if (n.type === "llm" && c.llm && n.model?.id !== c.llm && getModel(c.llm)) {
      const next = getModel(c.llm)!;
      out = { ...out, model: ref(next.id), label: next.trainedBy ? next.name : out.label, params: { ...out.params, quant: next.quant } };
    }
    if (!c.internet) {
      out = { ...out, online: false };
      if (out.model?.runtime === "river" && out.model.id) out = { ...out, model: ref(out.model.id) };
      if (out.type === "channel" && Array.isArray(out.params.kinds)) {
        const kinds = (out.params.kinds as string[]).filter((k) => !ONLINE_KINDS.includes(k));
        out = { ...out, params: { ...out.params, kinds: kinds.length ? kinds : ["pwa"] } };
      }
    }
    return out;
  });
  return { ...g, target: { device: c.device, ram_gb: c.ram_gb, storage_gb: c.storage_gb, connectivity }, nodes };
}

export function DeployConfig({ base, cfg, onChange }: { base: Graph; cfg: DeployCfg; onChange: (c: DeployCfg) => void }) {
  const graph = useMemo(() => applyCfg(base, cfg), [base, cfg]);
  const b = useMemo(() => computeBudget(graph), [graph]);
  const hasStt = base.nodes.some((n) => n.type === "stt");
  const hasTts = base.nodes.some((n) => n.type === "tts");
  const cur = getModel(cfg.llm);
  const llmOptions = useMemo(() => {
    if (!cur) return [];
    return modelsFor("llm").filter((m) => m.variant === cur.variant && m.availability !== "catalog only" && (!cur.trainedBy || m.trainedBy));
  }, [cur]);
  const set = (p: Partial<DeployCfg>) => onChange({ ...cfg, ...p });

  return (
    <div className="grid gap-5 lg:grid-cols-[1.15fr_1fr]">
      <div className="card min-w-0 space-y-4 p-5">
        <div>
          <label className="block text-[13px] font-medium text-ink-2" htmlFor="dep-device">
            Device it will run on
          </label>
          <select
            id="dep-device"
            className="input mt-1.5"
            value={cfg.custom ? "__custom" : cfg.device}
            onChange={(e) => {
              if (e.target.value === "__custom") return set({ custom: true, device: "Custom device" });
              const d = DEVICES.find((x) => nameOf(x) === e.target.value);
              if (d) set({ custom: false, device: nameOf(d), ram_gb: d.ram_gb, storage_gb: d.storage_gb });
            }}
          >
            <option value="__custom">Custom device (type RAM and storage)</option>
            <optgroup label="Phones">
              {PHONES.map((d) => (
                <option key={nameOf(d)} value={nameOf(d)}>
                  {nameOf(d)}, {d.ram_gb} GB RAM, {d.storage_gb} GB
                </option>
              ))}
            </optgroup>
            <optgroup label="Laptops and clinic PCs">
              {COMPUTERS.map((d) => (
                <option key={nameOf(d)} value={nameOf(d)}>
                  {nameOf(d)}, {d.ram_gb} GB RAM, {d.storage_gb} GB
                </option>
              ))}
            </optgroup>
          </select>
          {cfg.custom && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="text-[13px] text-ink-2">
                RAM (GB)
                <input className="input mt-1" type="number" min={1} max={128} step={0.5} value={cfg.ram_gb} onChange={(e) => set({ ram_gb: Math.max(1, Number(e.target.value) || 1) })} />
              </label>
              <label className="text-[13px] text-ink-2">
                Storage (GB)
                <input className="input mt-1" type="number" min={4} max={4096} value={cfg.storage_gb} onChange={(e) => set({ storage_gb: Math.max(4, Number(e.target.value) || 4) })} />
              </label>
            </div>
          )}
        </div>
        {llmOptions.length > 1 && (
          <div>
            <p className="text-[13px] font-medium text-ink-2">Language model</p>
            <div className="mt-1.5 flex flex-wrap gap-2" role="radiogroup" aria-label="Language model">
              {llmOptions.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={cfg.llm === m.id}
                  onClick={() => set({ llm: m.id })}
                  className={`rounded-xl border px-3 py-2 text-left transition-colors ${cfg.llm === m.id ? "border-ink bg-ink text-white" : "border-line bg-white hover:border-ink-4"}`}
                >
                  <span className="block font-display text-[15px] font-semibold">{m.size_label}</span>
                  <span className={`block text-[12px] ${cfg.llm === m.id ? "text-white/70" : "text-ink-3"}`}>{mb(m.size_mb)}{m.trainedBy ? ", custom model" : ""}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="space-y-3 border-t border-line-2 pt-4">
          <Switch checked={cfg.internet} onChange={(v) => set({ internet: v })} label="Internet" hint={cfg.internet ? "Online steps (WhatsApp, River 9B) may run when there is a signal." : "Everything runs on the device; nothing is sent anywhere."} />
          <Switch checked={cfg.voiceIn && hasStt} disabled={!hasStt} onChange={(v) => set({ voiceIn: v })} label="Voice input" hint={hasStt ? "Speak a question; adds the speech-to-text model." : "This pack has no speech-in step. Add one in Studio."} />
          <Switch checked={cfg.voiceOut && hasTts} disabled={!hasTts} onChange={(v) => set({ voiceOut: v })} label="Voice output" hint={hasTts ? "Replies are read aloud; adds the voice model." : "This pack has no speech-out step. Add one in Studio."} />
        </div>
      </div>
      <div className={`card min-w-0 p-5 ${b.verdict === "no" ? "ring-1 ring-hibiscus" : ""}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-display text-[18px] font-bold">What ships</h3>
          <Badge tone={b.verdict === "fits" ? "palm" : b.verdict === "tight" ? "frangipani" : "hibiscus"} solid>
            {b.verdict === "fits" ? `Fits the ${cfg.device}` : b.verdict === "tight" ? `Tight on the ${cfg.device}` : `Too big for the ${cfg.device}`}
          </Badge>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-[14px]">
          <div>
            <dt className="text-[12.5px] text-ink-3">Download, once</dt>
            <dd className="font-semibold">{gb(b.download_mb)}</dd>
          </div>
          <div>
            <dt className="text-[12.5px] text-ink-3">On 3G</dt>
            <dd className="font-semibold">{duration(b.minutes_3g)}</dd>
          </div>
          <div>
            <dt className="text-[12.5px] text-ink-3">Memory while running</dt>
            <dd className="font-semibold">
              {gb(b.ram_used_mb)} <span className="font-normal text-ink-3">of {gb(b.ram_usable_mb)} free</span>
            </dd>
          </div>
          <div>
            <dt className="text-[12.5px] text-ink-3">Storage</dt>
            <dd className="font-semibold">
              {gb(b.disk_mb)} <span className="font-normal text-ink-3">of {gb(b.storage_free_mb, 0)} free</span>
            </dd>
          </div>
        </dl>
        <ul className="mt-4 space-y-1.5 border-t border-line-2 pt-3 text-[13px] text-ink-2">
          {b.rows
            .filter((r) => r.ram_mb > 8 || r.disk_mb > 0)
            .map((r) => (
              <li key={r.id} className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate">{r.label}</span>
                <span className="shrink-0 text-ink-3">{r.hosted ? "hosted" : mb(r.disk_mb)}</span>
              </li>
            ))}
        </ul>
        {b.verdict !== "fits" && <p className="mt-3 text-[13px] text-hibiscus">{b.reasons.find((r) => /Needs|tight|Tight|only about|needs/.test(r)) ?? b.reasons[0]}</p>}
      </div>
    </div>
  );
}
