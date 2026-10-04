/**
 * Lokol design system primitives. Owned by the HOME/DESIGN lane.
 * Stable exports (do not rename): Chip, ACTION_COPY, ActionBadge, TierBadge, Toggle, OnlineChip,
 * Segmented, Field, Empty, mb. Newer primitives: Button, Card, Badge, Tabs, Switch, Progress,
 * Toaster/toast, Kbd, Tooltip, Spinner, SignalBars, StatusDot, CopyButton, CodeBlock, Pair,
 * Callout, NODE_GLOW, ACTION_COLOR.
 */
import { useEffect, useId, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from "react";
import { create } from "zustand";
import type { Action, NodeType, Tier } from "../types";

/* ------------------------------------------------------------------ tones */

export type Tone = "ink" | "reef" | "hibiscus" | "frangipani" | "palm" | "slate" | "sand" | "white" | "dark";

const TONES: Record<Tone, string> = {
  ink: "bg-ink text-white",
  reef: "bg-reef-tint text-reef-deep",
  hibiscus: "bg-hibiscus-tint text-hibiscus-deep",
  frangipani: "bg-frangipani-tint text-frangipani-deep",
  palm: "bg-palm-tint text-palm-deep",
  slate: "bg-slate-tint text-slate-deep",
  sand: "bg-sand text-ink-2 border border-line-2",
  white: "bg-white text-ink-2 border border-line",
  dark: "bg-canvas-3 text-canvas-text border border-canvas-line"
};

const SOLID: Record<Tone, string> = {
  ink: "bg-ink text-white",
  reef: "bg-reef text-white",
  hibiscus: "bg-hibiscus text-white",
  frangipani: "bg-frangipani text-ink",
  palm: "bg-palm text-white",
  slate: "bg-slate text-white",
  sand: "bg-sand-deep text-ink",
  white: "bg-white text-ink",
  dark: "bg-canvas text-canvas-text"
};

/** Luminous accent per node type (dark canvas). Mirrors tailwind `glow.*` and CSS `--glow-*`. */
export const NODE_GLOW: Record<NodeType, string> = {
  channel: "#7FB3C8",
  stt: "#5CC48A",
  rag: "#F2B84B",
  llm: "#2EC4D3",
  gate: "#F2647E",
  tts: "#B394F0",
  router: "#A3B4BE",
  note: "#D6B07A"
};

/* ------------------------------------------------------------------ chips and badges */

export function Chip({ tone = "sand", children, title, className = "" }: { tone?: Tone; children: ReactNode; title?: string; className?: string }) {
  return (
    <span className={`chip ${TONES[tone]} ${className}`} title={title}>
      {children}
    </span>
  );
}

/** Rounded status badge. `solid` for strong emphasis, otherwise soft tint. Optional leading dot. */
export function Badge({ tone = "sand", solid = false, dot = false, children, title, className = "" }: { tone?: Tone; solid?: boolean; dot?: boolean; children: ReactNode; title?: string; className?: string }) {
  return (
    <span className={`badge ${solid ? SOLID[tone] : TONES[tone]} ${className}`} title={title}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" aria-hidden />}
      {children}
    </span>
  );
}

export const ACTION_COPY: Record<Action, { label: string; pijin: string; tone: Tone }> = {
  ADVISE: { label: "Advise", pijin: "Givim advaes", tone: "reef" },
  REFER_NOW: { label: "Refer now", pijin: "Sendem nao", tone: "hibiscus" },
  REFER_NEXT_TRANSPORT: { label: "Refer on next transport", pijin: "Sendem long nekis bot", tone: "frangipani" },
  ASK_PERSON: { label: "Not sure, ask a person", pijin: "Mi no sua, askem nes", tone: "slate" }
};

/** Hex per ACTION for charts and borders. */
export const ACTION_COLOR: Record<Action, string> = {
  ADVISE: "#0F7B88",
  REFER_NOW: "#C32F49",
  REFER_NEXT_TRANSPORT: "#E9A93A",
  ASK_PERSON: "#5C6B75"
};

const ACTION_GLYPH: Record<Action, ReactNode> = {
  ADVISE: <path d="M3.5 8.5l3 3 6-7" />,
  REFER_NOW: <path d="M8 3v6M8 12.2v.3" />,
  REFER_NEXT_TRANSPORT: <path d="M2.5 10.5c1.8 1.2 3.6 1.2 5.5 0s3.7-1.2 5.5 0M5 8.5V5h6v3.5M8 5V3" />,
  ASK_PERSON: <path d="M6 6.2a2 2 0 1 1 2.6 1.9c-.4.2-.6.5-.6 1v.4M8 12v.3" />
};

export function ActionIcon({ action, className = "h-3.5 w-3.5" }: { action: Action; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {ACTION_GLYPH[action]}
    </svg>
  );
}

/**
 * The four answers Lokol Health can give. `big` kept for older call sites (= size "lg").
 * variant: soft (tint), solid (filled), outline (white with coloured border).
 */
export function ActionBadge({
  action,
  big = false,
  size,
  variant = "soft",
  pijin = true
}: {
  action: Action;
  big?: boolean;
  size?: "sm" | "md" | "lg";
  variant?: "soft" | "solid" | "outline";
  pijin?: boolean;
}) {
  const c = ACTION_COPY[action];
  const s = size ?? (big ? "lg" : "sm");
  const sz = s === "lg" ? "px-3.5 py-2 text-[16px] gap-2.5 rounded-xl" : s === "md" ? "px-3 py-1.5 text-[14px] gap-2 rounded-lg" : "px-2 py-0.5 text-[13px] gap-1.5 rounded-md";
  const look =
    variant === "solid" ? SOLID[c.tone] : variant === "outline" ? "bg-white text-ink border-2" : TONES[c.tone];
  return (
    <span
      className={`inline-flex items-center font-display font-semibold ${sz} ${look}`}
      style={variant === "outline" ? { borderColor: ACTION_COLOR[action] } : undefined}
      data-action={action}
    >
      <span
        className={`grid shrink-0 place-items-center rounded-full ${s === "lg" ? "h-6 w-6" : s === "md" ? "h-5 w-5" : "h-4 w-4"} ${variant === "solid" ? "bg-white/20" : "bg-white/70"}`}
        style={variant === "solid" ? undefined : { color: ACTION_COLOR[action] }}
        aria-hidden
      >
        <ActionIcon action={action} className={s === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"} />
      </span>
      {c.label}
      {pijin && <span className={`font-sans font-normal ${variant === "solid" ? "opacity-85" : "opacity-75"}`}>{c.pijin}</span>}
    </span>
  );
}

const TIER_TONE: Record<Tier, Tone> = { A: "frangipani", B: "reef", C: "palm", D: "ink" };
const TIER_SHORT: Record<Tier, string> = { A: "Small phone", B: "Everyday phone", C: "Better phone", D: "Laptop" };

export function TierBadge({ tier, label }: { tier: Tier; label?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 rounded-lg px-2.5 py-1 font-display text-[14px] font-semibold ${TONES[TIER_TONE[tier]]}`}>
      <span className="grid h-5 w-5 place-items-center rounded-md bg-white/75 text-[12px] text-ink">{tier}</span>
      {label ?? TIER_SHORT[tier]}
    </span>
  );
}

export function OnlineChip({ online }: { online: boolean }) {
  return online ? (
    <Chip tone="reef" title="Needs a signal">
      <Dot className="bg-reef" /> online
    </Chip>
  ) : (
    <Chip tone="palm" title="Runs on the device">
      <Dot className="bg-palm" /> offline
    </Chip>
  );
}

function Dot({ className }: { className: string }) {
  return <span className={`inline-block h-1.5 w-1.5 rounded-full ${className}`} aria-hidden />;
}

export function StatusDot({ tone = "palm", pulse = false, className = "" }: { tone?: "palm" | "reef" | "hibiscus" | "frangipani" | "slate"; pulse?: boolean; className?: string }) {
  const c = { palm: "bg-palm", reef: "bg-reef", hibiscus: "bg-hibiscus", frangipani: "bg-frangipani", slate: "bg-slate" }[tone];
  return (
    <span className={`relative inline-flex h-2 w-2 ${className}`} aria-hidden>
      {pulse && <span className={`absolute inset-0 animate-ping rounded-full ${c} opacity-50`} />}
      <span className={`relative inline-flex h-2 w-2 rounded-full ${c}`} />
    </span>
  );
}

/** Phone-style signal bars; `bars` 0..4. */
export function SignalBars({ bars, className = "h-3.5 w-4" }: { bars: number; className?: string }) {
  return (
    <svg viewBox="0 0 16 14" className={className} aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x={i * 4} y={10 - i * 3} width="3" height={4 + i * 3} rx="1" fill="currentColor" opacity={i < bars ? 1 : 0.22} />
      ))}
    </svg>
  );
}

/* ------------------------------------------------------------------ buttons */

type BtnVariant = "primary" | "ink" | "ghost" | "quiet" | "danger" | "on-dark" | "glow";

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: "sm" | "md" | "lg" }) {
  return (
    <button type="button" className={`btn-${variant} ${size === "sm" ? "btn-sm" : size === "lg" ? "btn-lg" : ""} ${className}`} {...rest}>
      {children}
    </button>
  );
}

/** Same look as Button, for anchors and router links: `className={btnClass("ghost","sm")}`. */
export function btnClass(variant: BtnVariant = "primary", size: "sm" | "md" | "lg" = "md"): string {
  return `btn-${variant} ${size === "sm" ? "btn-sm" : size === "lg" ? "btn-lg" : ""}`;
}

/* ------------------------------------------------------------------ cards and layout */

export function Card({ children, className = "", as: As = "div", muted = false, dark = false }: { children: ReactNode; className?: string; as?: "div" | "section" | "article" | "aside"; muted?: boolean; dark?: boolean }) {
  return <As className={`${dark ? "card-dark" : muted ? "card-muted" : "card"} ${className}`}>{children}</As>;
}

/** English label with its Pijin pair underneath or beside: "Safety gate / Sef-gate". */
export function Pair({ en, pis, inline = false, className = "" }: { en: ReactNode; pis: ReactNode; inline?: boolean; className?: string }) {
  return inline ? (
    <span className={className}>
      {en} <span className="font-normal text-ink-3">{pis}</span>
    </span>
  ) : (
    <span className={`block ${className}`}>
      <span className="block">{en}</span>
      <span className="block text-[0.82em] font-normal text-ink-3" lang="pis">{pis}</span>
    </span>
  );
}

export function Callout({ tone = "reef", title, children, icon }: { tone?: "reef" | "hibiscus" | "frangipani" | "palm" | "slate"; title?: ReactNode; children: ReactNode; icon?: ReactNode }) {
  const bar = { reef: "border-reef", hibiscus: "border-hibiscus", frangipani: "border-frangipani", palm: "border-palm", slate: "border-slate" }[tone];
  const bg = { reef: "bg-reef-pale", hibiscus: "bg-hibiscus-tint/60", frangipani: "bg-frangipani-tint/70", palm: "bg-palm-tint/70", slate: "bg-slate-tint/70" }[tone];
  return (
    <div className={`flex gap-3 rounded-xl border-l-4 ${bar} ${bg} px-4 py-3 text-[14px] leading-relaxed text-ink-2`}>
      {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
      <div className="min-w-0">
        {title && <p className="font-display text-[15px] font-semibold text-ink">{title}</p>}
        <div className={title ? "mt-0.5" : ""}>{children}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ controls */

export function Toggle({ checked, onChange, label, small = false, large = false, disabled = false }: { checked: boolean; onChange: (v: boolean) => void; label?: string; small?: boolean; large?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`switch ${small ? "scale-90" : ""} ${large ? "switch-lg" : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
    >
      <span />
    </button>
  );
}

/** Switch with a visible label and optional hint, for settings rows. */
export function Switch({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <span id={id} className="block text-[14px] font-medium text-ink">{label}</span>
        {hint && <span className="mt-0.5 block text-[13px] text-ink-3">{hint}</span>}
      </div>
      <span aria-labelledby={id} className="pt-0.5">
        <Toggle checked={checked} onChange={onChange} disabled={disabled} label={typeof label === "string" ? label : undefined} />
      </span>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  size = "sm",
  dark = false
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; hint?: string }[];
  label?: string;
  size?: "sm" | "md";
  dark?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={`inline-flex rounded-lg border p-0.5 ${dark ? "border-canvas-line bg-canvas-2" : "border-line bg-white"}`}>
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            title={o.hint}
            onClick={() => onChange(o.value)}
            className={`rounded-md font-medium transition-colors ${size === "md" ? "px-3.5 py-1.5 text-[14px]" : "px-2.5 py-1 text-[13px]"} ${
              on ? (dark ? "bg-reef-bright text-canvas" : "bg-ink text-white") : dark ? "text-canvas-muted hover:bg-canvas-3 hover:text-canvas-text" : "text-ink-2 hover:bg-sand"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Accessible underline tabs. Render panels yourself keyed on `value`. */
export function Tabs<T extends string>({ value, onChange, tabs, label, className = "" }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: ReactNode; count?: number }[]; label?: string; className?: string }) {
  return (
    <div role="tablist" aria-label={label} className={`tabs no-scrollbar overflow-x-auto ${className}`}>
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={value === t.value}
          tabIndex={value === t.value ? 0 : -1}
          className="tab"
          onClick={() => onChange(t.value)}
          onKeyDown={(e) => {
            if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
            const i = tabs.findIndex((x) => x.value === value);
            const n = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
            onChange(n.value);
            (e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[tabs.indexOf(n)])?.focus();
          }}
        >
          {t.label}
          {t.count != null && <span className="rounded-full bg-ink/5 px-1.5 text-[11px] text-ink-3">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[13px] font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[12px] text-ink-3">{hint}</span>}
    </label>
  );
}

/* ------------------------------------------------------------------ feedback */

/** value 0..1, or undefined for indeterminate. */
export function Progress({ value, tone = "reef", label, className = "", dark = false }: { value?: number; tone?: "reef" | "palm" | "frangipani" | "hibiscus" | "ink"; label?: string; className?: string; dark?: boolean }) {
  const bar = { reef: "bg-reef", palm: "bg-palm", frangipani: "bg-frangipani", hibiscus: "bg-hibiscus", ink: "bg-ink" }[tone];
  const pct = value == null ? undefined : Math.max(0, Math.min(1, value)) * 100;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct == null ? undefined : Math.round(pct)}
      className={`relative h-1.5 w-full overflow-hidden rounded-full ${dark ? "bg-canvas-4" : "bg-ink/10"} ${className}`}
    >
      {pct == null ? (
        <span className={`absolute inset-y-0 left-0 w-2/5 rounded-full ${dark ? "bg-reef-bright" : bar} animate-progress-indeterminate`} />
      ) : (
        <span className={`absolute inset-y-0 left-0 rounded-full ${dark ? "bg-reef-bright" : bar} transition-[width] duration-300`} style={{ width: `${pct}%` }} />
      )}
    </div>
  );
}

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`animate-spin ${className}`} fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Kbd({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  return <kbd className={`kbd ${dark ? "kbd-dark" : ""}`}>{children}</kbd>;
}

/** CSS tooltip on hover and keyboard focus. Wrap a focusable child. */
export function Tooltip({ content, children, side = "top" }: { content: ReactNode; children: ReactNode; side?: "top" | "bottom" }) {
  const id = useId();
  return (
    <span className="tip" data-side={side} aria-describedby={id}>
      {children}
      <span role="tooltip" id={id}>{content}</span>
    </span>
  );
}

export function Empty({ title, body, action, dark = false }: { title: string; body: string; action?: ReactNode; dark?: boolean }) {
  return (
    <div className={`rounded-2xl border border-dashed p-8 text-center ${dark ? "border-canvas-line bg-canvas-2/60 text-canvas-text" : "border-line bg-white/60"}`}>
      <p className="font-display text-[18px] font-semibold">{title}</p>
      <p className={`mx-auto mt-1 max-w-sm text-[14px] ${dark ? "text-canvas-muted" : "text-ink-3"}`}>{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ toast */

type ToastItem = { id: number; title: string; body?: string; tone: "reef" | "palm" | "hibiscus" | "frangipani" | "ink" };

const useToasts = create<{ items: ToastItem[]; push: (t: Omit<ToastItem, "id">) => void; dismiss: (id: number) => void }>((set) => ({
  items: [],
  push: (t) => {
    const id = Date.now() + Math.random();
    set((s) => ({ items: [...s.items.slice(-2), { ...t, id }] }));
    setTimeout(() => set((s) => ({ items: s.items.filter((x) => x.id !== id) })), 4200);
  },
  dismiss: (id) => set((s) => ({ items: s.items.filter((x) => x.id !== id) }))
}));

/** Fire a toast from anywhere: toast("Pack exported", { body: "lokol-health.zip", tone: "palm" }). */
export function toast(title: string, opts: { body?: string; tone?: ToastItem["tone"] } = {}) {
  useToasts.getState().push({ title, body: opts.body, tone: opts.tone ?? "ink" });
}

/** Mounted once in Shell. */
export function Toaster() {
  const { items, dismiss } = useToasts();
  const bar = { reef: "bg-reef", palm: "bg-palm", hibiscus: "bg-hibiscus", frangipani: "bg-frangipani", ink: "bg-reef-bright" };
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:right-6 sm:left-auto sm:items-end">
      {items.map((t) => (
        <div key={t.id} role="status" className="pointer-events-auto flex w-full max-w-[380px] animate-toast-in items-stretch overflow-hidden rounded-xl bg-ink text-white shadow-lift">
          <span className={`w-1 shrink-0 ${bar[t.tone]}`} aria-hidden />
          <div className="min-w-0 flex-1 px-4 py-3">
            <p className="text-[14px] font-semibold">{t.title}</p>
            {t.body && <p className="mt-0.5 break-words text-[13px] text-white/70">{t.body}</p>}
          </div>
          <button type="button" className="px-3 text-white/60 hover:text-white" onClick={() => dismiss(t.id)} aria-label="Dismiss">
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M4 4l8 8M12 4l-8 8" /></svg>
          </button>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ code */

export function CopyButton({ text, label = "Copy", dark = true, className = "" }: { text: string; label?: string; dark?: boolean; className?: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1600);
    return () => clearTimeout(t);
  }, [done]);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
        } catch {
          toast("Copy failed", { body: "Select the text and copy it by hand.", tone: "hibiscus" });
        }
      }}
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium transition-colors ${
        dark ? "text-canvas-muted hover:bg-canvas-3 hover:text-white" : "text-ink-3 hover:bg-sand hover:text-ink"
      } ${className}`}
      aria-label={done ? "Copied" : `${label}: ${text.slice(0, 60)}`}
    >
      {done ? (
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3.5 8.5l3 3 6-7" /></svg>
      ) : (
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" /><path d="M10.5 5.5V3.8c0-.7-.6-1.3-1.3-1.3H3.8c-.7 0-1.3.6-1.3 1.3v5.4c0 .7.6 1.3 1.3 1.3h1.7" /></svg>
      )}
      {done ? "Copied" : label}
    </button>
  );
}

/** Dark code block with a copy button. `lines` render one command per line; comments start with #. */
export function CodeBlock({ code, title, className = "" }: { code: string; title?: ReactNode; className?: string }) {
  return (
    <div className={`overflow-hidden rounded-xl border border-canvas-line bg-canvas ${className}`}>
      <div className="flex items-center justify-between gap-2 border-b border-canvas-line/70 px-3 py-1.5">
        <span className="truncate text-[12px] font-medium text-canvas-muted">{title ?? "Terminal"}</span>
        <CopyButton text={code.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n").trim()} />
      </div>
      <pre className="overflow-x-auto px-4 py-3 font-mono text-[12.5px] leading-[1.7] text-canvas-text">
        <code>
          {code.split("\n").map((l, i) => (
            <span key={i} className={`block ${l.trim().startsWith("#") ? "text-canvas-muted" : ""}`}>
              {l.trim().startsWith("#") ? l : l ? <><span className="select-none text-reef-bright/70">$ </span>{l}</> : " "}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}

/* ------------------------------------------------------------------ misc */

/** A coloured type swatch for a node type. */
export function NodeSwatch({ type, size = 10, style }: { type: NodeType; size?: number; style?: CSSProperties }) {
  return <span className="inline-block shrink-0 rounded-[3px]" style={{ width: size, height: size, background: NODE_GLOW[type], ...style }} aria-hidden />;
}

export function mb(n: number): string {
  if (n >= 1024) return `${(n / 1024).toFixed(1)} GB`;
  return `${Math.round(n)} MB`;
}
