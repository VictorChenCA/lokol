import { useEffect, useMemo, useState } from "react";
import type { GraphNode } from "../../types";
import { AVAILABILITY_LABEL, NODE_META, RED_FLAG_LABELS, TRAINED_BY_LABEL, getModel, modelsFor, paramsLabel, type CatalogModel } from "../../models";
import { useStudio } from "../../store";
import { tierFor } from "../../recommend";
import { computeBudget, gb, internetOn, isComputer } from "./budget";
import { NodeIcon, Icon } from "./icons";
import { isEnabled, isOptionalStage } from "./enabled";

function mbShort(n: number) {
  return n >= 1024 ? `${(n / 1024).toFixed(1)} GB` : n < 1 ? `${n.toFixed(1)} MB` : `${Math.round(n)} MB`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="lk-insp__sec">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function ModelPicker({ node }: { node: GraphNode }) {
  const graph = useStudio((s) => s.graph);
  const swapModel = useStudio((s) => s.swapModel);
  const net = internetOn(graph);
  const tier = tierFor(graph.target.ram_gb, isComputer(graph.target));
  const options = useMemo(() => modelsFor(node.type), [node.type]);
  const current = getModel(node.model?.id);
  if (!options.length) {
    return <p className="lk-insp__muted">This node runs rules, not a model. Nothing to download.</p>;
  }
  const groups: { title: string; items: CatalogModel[] }[] =
    node.type === "llm"
      ? [
          { title: "Trained by Lokol", items: options.filter((m) => m.variant === "tuned") },
          { title: "Untuned base models", items: options.filter((m) => m.variant === "base") }
        ]
      : [{ title: "", items: options }];
  return (
    <div className="lk-models" role="radiogroup" aria-label="Model">
      {groups.map((g) => (
        <div key={g.title || "all"}>
          {g.title && <div className="lk-models__group">{g.title}</div>}
          {g.items.map((m) => {
            const sel = current?.id === m.id;
            const fitsTier = m.tiers.includes(tier);
            const hostedOk = m.online_runtime && net;
            const warn = !fitsTier && !hostedOk;
            return (
              <button key={m.id} type="button" role="radio" aria-checked={sel} className={`lk-mopt ${sel ? "is-sel" : ""} ${warn ? "is-warn" : ""}`} onClick={() => swapModel(node.id, m.id)}>
                <span className="lk-mopt__size">{m.size_label}</span>
                <span className="lk-mopt__main">
                  <span className="lk-mopt__name">
                    {m.name}
                    {m.lang && (node.type === "stt" || node.type === "tts") && (
                      <em>{m.approx_lang?.includes("pis") ? "English + Pijin (approx.)" : m.lang.includes("pis") ? "Pijin" : "English"}</em>
                    )}
                  </span>
                  <span className="lk-mopt__meta">
                    {m.variant === "index" ? `BM25 index, ${mbShort(m.size_mb)}` : `${paramsLabel(m.active_b)} active, ${m.quant}, ${mbShort(m.size_mb)} file, ${mbShort(m.ram_mb)} RAM`}
                  </span>
                  <span className="lk-mopt__tags">
                    {m.trainedBy && <span className="lk-tag lk-tag--trained">Lokol, {TRAINED_BY_LABEL[m.trainedBy]}</span>}
                    <span className={`lk-tag ${/NC/.test(m.license) ? "lk-tag--warn" : ""}`}>{m.license}</span>
                    {warn ? <span className="lk-tag lk-tag--bad" title={`Tier ${tier}`}>Too big for {graph.target.device}</span> : <span className="lk-tag lk-tag--ok" title={`Tier ${tier}`}>Fits {graph.target.device}</span>}
                    {m.online_runtime && <span className="lk-tag">{net ? "Can run on River" : "River needs internet"}</span>}
                    {m.availability !== "browser" && <span className={`lk-tag ${m.availability === "catalog only" ? "lk-tag--warn" : ""}`}>{AVAILABILITY_LABEL[m.availability]}</span>}
                    {m.audio_llm && <span className="lk-tag">Audio LLM</span>}
                  </span>
                </span>
                <span className="lk-mopt__radio" aria-hidden>
                  {sel && <Icon.check size={13} strokeWidth={2.6} />}
                </span>
              </button>
            );
          })}
        </div>
      ))}
      {current && <p className="lk-insp__muted">{current.blurb}</p>}
      {!current && node.model && <p className="lk-insp__muted">Custom model {node.model.id} ({mbShort(node.model.size_mb)}). Pick one above to swap.</p>}
    </div>
  );
}

function Slider({ label, value, min, max, step, onChange, fmt }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt?: (v: number) => string }) {
  return (
    <label className="lk-slider">
      <span className="lk-slider__top">
        <span>{label}</span>
        <strong>{fmt ? fmt(value) : value}</strong>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function Params({ node }: { node: GraphNode }) {
  const updateParam = useStudio((s) => s.updateParam);
  const graph = useStudio((s) => s.graph);
  const net = internetOn(graph);
  const p = node.params ?? {};
  const num = (k: string, d: number) => (typeof p[k] === "number" ? (p[k] as number) : d);
  if (node.type === "llm") {
    return (
      <div className="space-y-3">
        <Slider label="Max reply length (tokens)" value={num("max_tokens", 220)} min={64} max={512} step={16} onChange={(v) => updateParam(node.id, "max_tokens", v)} />
        <Slider label="Temperature" value={num("temperature", 0)} min={0} max={1} step={0.1} onChange={(v) => updateParam(node.id, "temperature", v)} fmt={(v) => (v === 0 ? "0 (same answer every time)" : v.toFixed(1))} />
        <p className="lk-insp__muted">Health replies use temperature 0 so the same question gets the same, checkable answer.</p>
      </div>
    );
  }
  if (node.type === "rag") {
    return (
      <div className="space-y-3">
        <Slider label="Sections passed to the model (top-k)" value={num("top_k", 1)} min={1} max={5} step={1} onChange={(v) => updateParam(node.id, "top_k", v)} />
        <p className="lk-insp__muted">BM25 keyword search with a Pijin synonym list (hot bodi, fever; sitsit, diarrhoea). A weak match counts as no guideline, so the gate abstains.</p>
      </div>
    );
  }
  if (node.type === "gate") {
    const rules = Array.isArray(p.rules) ? (p.rules as string[]) : null;
    return (
      <div className="space-y-3">
        <label className="lk-check">
          <input type="checkbox" checked={p.abstain_when_no_guideline !== false} onChange={(e) => updateParam(node.id, "abstain_when_no_guideline", e.target.checked)} />
          <span>
            Say “not sure, ask a person” when no guideline matches
          </span>
        </label>
        <div>
          <div className="lk-insp__label">{rules ? "Rules" : "Red flags that force a referral"}</div>
          <ul className="lk-flags">
            {(rules ?? []).map((r) => (
              <li key={r}>{r}</li>
            ))}
            {!rules &&
              RED_FLAG_LABELS.map((r) => (
                <li key={r.en}>{r.en}</li>
              ))}
          </ul>
          {!rules && <p className="lk-insp__muted">Any match replaces the model's answer with Refer now, or Refer on the next boat when transport is the next boat. The nurse decides.</p>}
        </div>
      </div>
    );
  }
  if (node.type === "channel") {
    const kinds = Array.isArray(p.kinds) ? (p.kinds as string[]) : ["pwa"];
    const opts = [
      { k: "pwa", label: "App on the phone (offline PWA)", net: false },
      { k: "sms", label: "SMS", net: false },
      { k: "whatsapp", label: "WhatsApp", net: true },
      { k: "messenger", label: "Messenger", net: true }
    ];
    return (
      <div className="space-y-2">
        {opts.map((o) => (
          <label key={o.k} className={`lk-check ${o.net && !net ? "is-disabled" : ""}`}>
            <input
              type="checkbox"
              disabled={o.net && !net}
              checked={kinds.includes(o.k)}
              onChange={(e) => updateParam(node.id, "kinds", e.target.checked ? [...kinds, o.k] : kinds.filter((x) => x !== o.k))}
            />
            <span>
              {o.label} {o.net && <em>{net ? "needs a signal" : "turn on Internet first"}</em>}
            </span>
          </label>
        ))}
      </div>
    );
  }
  if (node.type === "note") {
    return <p className="lk-insp__muted">Notes are saved in the browser's storage on this phone, locked with a PIN, and exported as a DHIS2-shaped record only when the nurse taps send.</p>;
  }
  if (node.type === "router") {
    return (
      <label className="block">
        <span className="lk-insp__label">Rule</span>
        <input className="lk-input" value={String(p.rule ?? "")} onChange={(e) => updateParam(node.id, "rule", e.target.value)} />
      </label>
    );
  }
  return null;
}

function JsonEditor({ node }: { node: GraphNode }) {
  const updateNode = useStudio((s) => s.updateNode);
  const [raw, setRaw] = useState(JSON.stringify(node.params, null, 2));
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setRaw(JSON.stringify(node.params, null, 2));
    setErr(null);
  }, [node.id, node.params]);
  return (
    <details className="lk-json">
      <summary>All settings as JSON</summary>
      <textarea
        value={raw}
        spellCheck={false}
        onChange={(e) => setRaw(e.target.value)}
        onBlur={() => {
          try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              updateNode(node.id, { params: parsed });
              setErr(null);
            } else setErr("Settings must be a JSON object.");
          } catch {
            setErr("Not valid JSON yet. Fix it and click away to save.");
          }
        }}
      />
      {err && <p className="lk-json__err">{err}</p>}
    </details>
  );
}

function onlineCopy(node: GraphNode): { on: string; off: string } {
  const cat = getModel(node.model?.id);
  if (cat?.online_runtime) return { on: "Runs on River instead of this device: nothing to download, needs a signal.", off: "Runs on this device with llama-server. Nothing leaves it." };
  if (node.type === "llm") return { on: "Hard questions go to Lokol Health 9B on River when there is a signal. Easy ones stay on the phone.", off: "Only the model on the phone answers. Nothing leaves it." };
  if (node.type === "channel") return { on: "WhatsApp and Messenger can carry messages when there is a signal.", off: "Only the app on the phone. Works with no signal." };
  return { on: "This node may call a hosted service when there is a signal.", off: "Runs on the device. Nothing leaves it." };
}

export function Inspector({ onClose }: { onClose: () => void }) {
  const graph = useStudio((s) => s.graph);
  const selectedId = useStudio((s) => s.selectedId);
  const updateNode = useStudio((s) => s.updateNode);
  const removeNode = useStudio((s) => s.removeNode);
  const setNodeOnline = useStudio((s) => s.setNodeOnline);
  const updateParam = useStudio((s) => s.updateParam);
  const node = graph.nodes.find((n) => n.id === selectedId) ?? null;
  const budget = useMemo(() => computeBudget(graph), [graph]);
  if (!node) return null;
  const meta = NODE_META[node.type] ?? NODE_META.router;
  const net = internetOn(graph);
  const copy = onlineCopy(node);
  const cost = budget.rows.find((r) => r.id === node.id);
  const issue = budget.issues[node.id];

  return (
    <aside className="lk-insp" aria-label={`${meta.name} settings`} style={{ ["--c" as string]: meta.color, ["--tint" as string]: meta.tint }}>
      <header className="lk-insp__head">
        <span className="lk-icon lk-icon--lg">
          <NodeIcon type={node.type} size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="lk-insp__type">{meta.name}</div>
          <input className="lk-insp__title" value={node.label} onChange={(e) => updateNode(node.id, { label: e.target.value })} aria-label="Node label" />
        </div>
        <button type="button" className="lk-iconbtn" onClick={onClose} aria-label="Close inspector">
          <Icon.close size={16} />
        </button>
      </header>
      <div className="lk-insp__scroll">
        <p className="lk-insp__blurb">{meta.blurb}</p>
        {issue && (
          <div className="lk-insp__issue">
            <Icon.warn size={14} strokeWidth={2} /> {issue}
          </div>
        )}
        {cost && (cost.ram_mb > 8 || cost.disk_mb > 0) && (
          <div className="lk-insp__cost">
            <div>
              <span>Memory</span>
              <strong>{mbShort(cost.ram_mb)}</strong>
            </div>
            <div>
              <span>Download</span>
              <strong>{cost.hosted ? "none" : mbShort(cost.disk_mb)}</strong>
            </div>
            <div>
              <span>Share of free RAM</span>
              <strong>{budget.ram_usable_mb ? `${Math.round((cost.ram_mb / budget.ram_usable_mb) * 100)}%` : "?"}</strong>
            </div>
          </div>
        )}

        {isOptionalStage(node) && (
          <Section title="Use this step">
            <div className="lk-online">
              <div className="min-w-0">
                <div className="lk-online__state">{isEnabled(node) ? "On" : "Off"}</div>
                <div className="lk-insp__muted">
                  {isEnabled(node)
                    ? node.type === "stt"
                      ? "The nurse can speak a question. Turn off for a text-only pack: no speech model is downloaded."
                      : "Replies are read aloud. Turn off for a text-only pack: no voice model is downloaded."
                    : "Off. Messages skip this step, the test run ignores it and the exported pack leaves its model out."}
                </div>
              </div>
              <button type="button" role="switch" aria-checked={isEnabled(node)} aria-label={`Use ${meta.name}`} className="lk-switch" onClick={() => updateParam(node.id, "enabled", !isEnabled(node))}>
                <span />
              </button>
            </div>
          </Section>
        )}

        <Section title="Internet">
          <div className={`lk-online ${!net ? "is-locked" : ""}`}>
            <div className="min-w-0">
              <div className="lk-online__state">{node.online && net ? "May use the internet" : "Offline only"}</div>
              <div className="lk-insp__muted">{!net ? "Internet is off for the whole pack. Turn it on in the bar above to allow this." : node.online ? copy.on : copy.off}</div>
            </div>
            <button type="button" role="switch" aria-checked={node.online && net} aria-label="Internet for this node" disabled={!net} className="lk-switch" onClick={() => setNodeOnline(node.id, !node.online)}>
              <span />
            </button>
          </div>
        </Section>

        {node.type !== "gate" && node.type !== "channel" && node.type !== "note" && node.type !== "router" && (
          <Section title="Model">
            <ModelPicker node={node} />
          </Section>
        )}

        <Section title="Settings">
          <Params node={node} />
          <JsonEditor node={node} />
        </Section>

        <div className="lk-insp__foot">
          <code>{node.id}</code>
          <button type="button" className="lk-danger" onClick={() => removeNode(node.id)}>
            Delete node
          </button>
        </div>
        {budget.ram_usable_mb > 0 && <p className="lk-insp__muted">Target: {graph.target.device}, about {gb(budget.ram_usable_mb)} free for Lokol.</p>}
      </div>
    </aside>
  );
}
