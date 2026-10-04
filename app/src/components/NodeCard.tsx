import { memo } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import type { GraphNode } from "../types";
import { NODE_META, RED_FLAG_LABELS, TRAINED_BY_LABEL, getModel, paramsLabel } from "../models";
import { useStudio } from "../store";
import { useTrace } from "./studio/trace";
import { NodeIcon, Icon } from "./studio/icons";
import { TracePreview } from "./studio/TracePreview";
import "./studio/studio.css";

export type LokolNodeData = {
  node: GraphNode;
  /** Why this node does not fit the target device (warning ring). */
  issue?: string | null;
  /** Internet switch for the whole pack (false = everything offline). */
  internet?: boolean;
  readOnly?: boolean;
  /** Legacy prop from the first Studio; ignored. */
  onToggleOnline?: (id: string, v: boolean) => void;
};
export type LokolNode = Node<LokolNodeData, "lokol">;

function mbShort(n: number): string {
  if (n >= 1024) return `${(n / 1024).toFixed(1)} GB`;
  if (n < 1) return `${n.toFixed(1)} MB`;
  return `${Math.round(n)} MB`;
}

const KIND_LABEL: Record<string, string> = { pwa: "App (PWA)", whatsapp: "WhatsApp", messenger: "Messenger", sms: "SMS" };

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="lk-stat">
      <dt>{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}

function Body({ node }: { node: GraphNode }) {
  const cat = getModel(node.model?.id);
  const hosted = node.model?.runtime === "river";
  if (node.model) {
    const isIndex = cat?.variant === "index";
    return (
      <>
        <div className="lk-model" title={node.model.file}>
          <span className="lk-model__name">{cat?.name ?? node.model.id}</span>
          <span className="lk-model__q">{hosted ? "River" : cat?.quant ?? node.model.runtime}</span>
        </div>
        <dl className="lk-stats">
          {isIndex ? (
            <>
              <Stat k="Method" v="BM25" />
              <Stat k="Top-k" v={String(node.params?.top_k ?? 1)} />
              <Stat k="File" v={mbShort(node.model.size_mb)} />
              <Stat k="RAM" v={mbShort(cat?.ram_mb ?? 10)} />
            </>
          ) : (
            <>
              <Stat k="Params" v={cat?.size_label ?? "?"} />
              <Stat k="Active" v={cat ? paramsLabel(cat.active_b) : "?"} />
              <Stat k="File" v={hosted ? "none" : mbShort(node.model.size_mb)} />
              <Stat k="RAM" v={hosted ? "hosted" : mbShort(cat?.ram_mb ?? node.model.size_mb * 1.3)} />
            </>
          )}
        </dl>
        <div className="lk-chips">
          <span className={`lk-chip ${/NC/.test(node.model.license) ? "lk-chip--warn" : ""}`} title="License">
            {node.model.license}
          </span>
          {cat?.trainedBy && (
            <span className="lk-chip lk-chip--trained" title={`Fine-tuned by Lokol on ${TRAINED_BY_LABEL[cat.trainedBy]}`}>
              <Icon.bolt size={11} strokeWidth={2.2} /> Trained by Lokol on {TRAINED_BY_LABEL[cat.trainedBy]}
            </span>
          )}
          {cat?.variant === "base" && <span className="lk-chip">Base, untuned</span>}
          {cat?.placeholder && <span className="lk-chip lk-chip--warn">Placeholder corpus</span>}
        </div>
      </>
    );
  }
  if (node.type === "gate") {
    const rules = Array.isArray(node.params?.rules) ? (node.params.rules as string[]) : null;
    return (
      <>
        <div className="lk-model">
          <span className="lk-model__name">{rules ? `${rules.length} rules` : `${RED_FLAG_LABELS.length} red flags`}</span>
          <span className="lk-model__q">rules, no model</span>
        </div>
        <ul className="lk-rules">
          {(rules ?? RED_FLAG_LABELS.slice(0, 3).map((r) => r.en)).slice(0, 3).map((r) => (
            <li key={r}>{r}</li>
          ))}
          {!rules && <li className="lk-rules__more">+{RED_FLAG_LABELS.length - 3} more, then “Mi no sua, askem nes”</li>}
        </ul>
      </>
    );
  }
  if (node.type === "channel") {
    const kinds = Array.isArray(node.params?.kinds) ? (node.params.kinds as string[]) : ["pwa"];
    return (
      <div className="lk-chips lk-chips--first">
        {kinds.map((k) => (
          <span key={k} className={`lk-chip ${k === "pwa" || k === "sms" ? "" : "lk-chip--net"}`}>
            {KIND_LABEL[k] ?? k}
          </span>
        ))}
        {node.params?.store_and_forward === true && <span className="lk-chip">Store and forward</span>}
      </div>
    );
  }
  if (node.type === "note") {
    return (
      <div className="lk-chips lk-chips--first">
        <span className="lk-chip">Stays on device</span>
        {node.params?.encrypted === "pin" && <span className="lk-chip">PIN-locked</span>}
        {typeof node.params?.export === "string" && <span className="lk-chip">{String(node.params.export).replace("dhis2-shaped-json", "DHIS2-shaped")}</span>}
      </div>
    );
  }
  if (node.type === "router") {
    return <p className="lk-rule-text">{String(node.params?.rule ?? "Rule not set")}</p>;
  }
  return <p className="lk-rule-text">No model yet. Pick one in the inspector.</p>;
}

function NodeCardInner({ data, selected }: NodeProps<LokolNode>) {
  const { node, readOnly, issue } = data;
  const meta = NODE_META[node.type] ?? NODE_META.router;
  const step = useTrace((s) => (readOnly ? undefined : s.steps[node.id]));
  const openPreview = useTrace((s) => (readOnly ? null : s.openPreview));
  const flashNonce = useStudio((s) => (!readOnly && s.flash.ids.includes(node.id) ? s.flash.nonce : 0));
  const hosted = node.model?.runtime === "river";
  const online = node.online && data.internet !== false;
  const state = step?.state;
  const cls = [
    "lk-card",
    selected ? "is-selected" : "",
    issue ? "has-issue" : "",
    state ? `is-${state}` : "",
    readOnly ? "is-readonly" : ""
  ].join(" ");

  return (
    <div className={cls} style={{ ["--c" as string]: meta.color, ["--tint" as string]: meta.tint }}>
      {flashNonce ? <span key={flashNonce} className="lk-flash" aria-hidden /> : null}
      <Handle id="tl" type="target" position={Position.Left} />
      <Handle id="tt" type="target" position={Position.Top} className="lk-h-v" />
      <Handle id="tb" type="target" position={Position.Bottom} className="lk-h-v" />
      <Handle id="sr" type="source" position={Position.Right} />
      <Handle id="sb" type="source" position={Position.Bottom} className="lk-h-v" />
      <Handle id="st" type="source" position={Position.Top} className="lk-h-v" />
      <div className="lk-card__bar" aria-hidden />
      {step?.ms !== undefined && step.state === "done" && <span className="lk-latency">{step.ms < 1000 ? `${step.ms} ms` : `${(step.ms / 1000).toFixed(1)} s`}</span>}
      <header className="lk-head">
        <span className="lk-icon">
          <NodeIcon type={node.type} size={17} />
        </span>
        <div className="lk-head__text">
          <div className="lk-type">
            {meta.name} <span>{meta.pijin}</span>
          </div>
          <div className="lk-title" title={node.label}>
            {node.label}
          </div>
        </div>
        <span className={`lk-net ${hosted ? "is-hosted" : online ? "is-online" : "is-offline"}`} title={hosted ? "Hosted on River: needs a signal" : online ? "May use the internet when there is a signal" : "Runs on the device"}>
          <span className="lk-net__dot" />
          {hosted ? "River" : online ? "Online" : "Offline"}
        </span>
      </header>
      <div className="lk-body">
        <Body node={node} />
      </div>
      {issue && (
        <div className="lk-issue" role="note">
          <Icon.warn size={13} strokeWidth={2} />
          <span>{issue}</span>
        </div>
      )}
      {step && step.state !== "queued" && (
        <div className="lk-peek nodrag nopan">
          <span className={`lk-peek__dot is-${step.state}`} />
          <span className="lk-peek__text">{step.state === "active" ? "Working…" : step.peek ?? step.note ?? ""}</span>
          {step.detail && (
            <button
              type="button"
              className="lk-peek__btn"
              aria-expanded={openPreview === node.id}
              onClick={(e) => {
                e.stopPropagation();
                useTrace.getState().set({ openPreview: openPreview === node.id ? null : node.id });
              }}
            >
              {openPreview === node.id ? "Hide" : "Output"}
            </button>
          )}
        </div>
      )}
      {openPreview === node.id && step?.detail && <TracePreview nodeId={node.id} />}
    </div>
  );
}

export const NodeCard = memo(NodeCardInner);
export const nodeTypes = { lokol: NodeCard };
