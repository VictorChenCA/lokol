type P = { className?: string; size?: number };

const base = (size = 18) => ({ width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true });

export const IconCheck = ({ className, size }: P) => (
  <svg {...base(size)} className={className}><path d="M5 12.5l4.2 4.2L19 7" /></svg>
);
export const IconAlert = ({ className, size }: P) => (
  <svg {...base(size)} className={className}><path d="M12 3.5L2.8 19.5h18.4L12 3.5z" /><path d="M12 10v4.5M12 17.2v.1" /></svg>
);
export const IconBoat = ({ className, size }: P) => (
  <svg {...base(size)} className={className}><path d="M3 15.5h18l-2.4 4H5.4L3 15.5z" /><path d="M12 4v11.5M12 5l6 8h-6" /></svg>
);
export const IconAsk = ({ className, size }: P) => (
  <svg {...base(size)} className={className}><circle cx="12" cy="8" r="3.4" /><path d="M5 20c.8-3.6 3.6-5.6 7-5.6s6.2 2 7 5.6" /></svg>
);
export const IconMic = ({ className, size }: P) => (
  <svg {...base(size)} className={className}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></svg>
);
export const IconSend = ({ className, size }: P) => (
  <svg {...base(size)} className={className}><path d="M4 12l16-8-6 16-2.5-6.5L4 12z" /></svg>
);
export const IconPlay = ({ className, size }: P) => (
  <svg {...base(size)} className={className}><path d="M7 5v14l12-7L7 5z" fill="currentColor" stroke="none" /></svg>
);
export const IconStop = ({ className, size }: P) => (
  <svg {...base(size)} className={className}><rect x="6.5" y="6.5" width="11" height="11" rx="1.5" fill="currentColor" stroke="none" /></svg>
);
export const IconCopy = ({ className, size }: P) => (
  <svg {...base(size)} className={className}><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" /></svg>
);
export const IconBook = ({ className, size }: P) => (
  <svg {...base(size)} className={className}><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5v-13zM20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5v-13z" /></svg>
);
export const IconPlane = ({ className, size }: P) => (
  <svg {...base(size)} className={className}><path d="M10.5 3.5c0-.8.7-1.5 1.5-1.5s1.5.7 1.5 1.5V9l7 4v2l-7-2v4.5l2.5 2V21L12 20l-4 1v-1.5l2.5-2V13l-7 2v-2l7-4V3.5z" fill="currentColor" stroke="none" /></svg>
);
export const IconSignal = ({ className, size }: P) => (
  <svg {...base(size)} className={className}><path d="M4 19v-3M9 19v-6M14 19v-9M19 19V6" /></svg>
);
export const IconChip = ({ className, size }: P) => (
  <svg {...base(size)} className={className}><rect x="6" y="6" width="12" height="12" rx="2" /><path d="M9 2.5V6M15 2.5V6M9 18v3.5M15 18v3.5M2.5 9H6M2.5 15H6M18 9h3.5M18 15h3.5" /></svg>
);
export const IconShield = ({ className, size }: P) => (
  <svg {...base(size)} className={className}><path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.4-7.5 9.5-4.3-1.1-7.5-4.9-7.5-9.5V6L12 3z" /></svg>
);
export const IconDownload = ({ className, size }: P) => (
  <svg {...base(size)} className={className}><path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" /></svg>
);
export const IconSave = ({ className, size }: P) => (
  <svg {...base(size)} className={className}><path d="M5 4h11l3 3v13H5V4z" /><path d="M8 4v5h7V4M8 20v-6h8v6" /></svg>
);
export const IconChevron = ({ className, size }: P) => (
  <svg {...base(size)} className={className}><path d="M8 10l4 4 4-4" /></svg>
);

export function ActionGlyph({ glyph, size = 22, className }: { glyph: "check" | "alert" | "boat" | "ask"; size?: number; className?: string }) {
  if (glyph === "alert") return <IconAlert size={size} className={className} />;
  if (glyph === "boat") return <IconBoat size={size} className={className} />;
  if (glyph === "ask") return <IconAsk size={size} className={className} />;
  return <IconCheck size={size} className={className} />;
}
