import type { NodeType } from "../../types";

type P = { size?: number; className?: string; strokeWidth?: number };

function Svg({ size = 16, className, strokeWidth = 1.8, children }: P & { children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {children}
    </svg>
  );
}

const PATHS: Record<NodeType, React.ReactNode> = {
  channel: (
    <>
      <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
      <path d="M10 6.5h4M9.5 11.5h5M9.5 14.5h3" />
    </>
  ),
  stt: (
    <>
      <rect x="9" y="2.5" width="6" height="11.5" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5v4M8.5 21.5h7" />
    </>
  ),
  rag: (
    <>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H12v16H6.5A2.5 2.5 0 0 0 4 21.5z" />
      <path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H12v16h5.5a2.5 2.5 0 0 1 2.5 2.5z" />
      <path d="M7 8h2.5M14.5 8H17" />
    </>
  ),
  llm: (
    <>
      <path d="M12 3.5l1.7 4.6 4.8 1.7-4.8 1.7L12 16.1l-1.7-4.6L5.5 9.8l4.8-1.7z" />
      <path d="M18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" />
    </>
  ),
  gate: (
    <>
      <path d="M12 2.8l7.5 3v5.6c0 4.6-3.2 8.3-7.5 9.8-4.3-1.5-7.5-5.2-7.5-9.8V5.8z" />
      <path d="M8.8 12.2l2.2 2.2 4.4-4.6" />
    </>
  ),
  tts: (
    <>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
      <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
    </>
  ),
  router: (
    <>
      <circle cx="6" cy="12" r="2.2" />
      <circle cx="18" cy="6" r="2.2" />
      <circle cx="18" cy="18" r="2.2" />
      <path d="M8.2 12h3.3c1.6 0 2-6 4.3-6M11.5 12c1.6 0 2 6 4.3 6" />
    </>
  ),
  note: (
    <>
      <rect x="5" y="4" width="14" height="17.5" rx="2" />
      <path d="M9 2.5h6v3H9zM8.5 10.5h7M8.5 14h7M8.5 17.5h4" />
    </>
  )
};

export function NodeIcon({ type, ...p }: P & { type: NodeType }) {
  return <Svg {...p}>{PATHS[type] ?? PATHS.router}</Svg>;
}

export const Icon = {
  wifi: (p: P) => (
    <Svg {...p}>
      <path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.8 16a4.8 4.8 0 0 1 6.4 0" />
      <circle cx="12" cy="19.3" r="1" fill="currentColor" stroke="none" />
    </Svg>
  ),
  wifiOff: (p: P) => (
    <Svg {...p}>
      <path d="M3 3l18 18M8.8 16a4.8 4.8 0 0 1 6.4 0M5.5 12.5a9.4 9.4 0 0 1 4-2.3M2.5 9a14 14 0 0 1 5-3M14.5 10.3a9.5 9.5 0 0 1 4 2.2M12 4.8a14 14 0 0 1 9.5 4.2" />
      <circle cx="12" cy="19.3" r="1" fill="currentColor" stroke="none" />
    </Svg>
  ),
  phone: (p: P) => (
    <Svg {...p}>
      <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
      <path d="M11 18.5h2" />
    </Svg>
  ),
  laptop: (p: P) => (
    <Svg {...p}>
      <rect x="4.5" y="4.5" width="15" height="10.5" rx="1.5" />
      <path d="M2.5 19h19l-1.5-4h-16z" />
    </Svg>
  ),
  search: (p: P) => (
    <Svg {...p}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4.2-4.2" />
    </Svg>
  ),
  mic: (p: P) => (
    <Svg {...p}>
      <rect x="9" y="2.5" width="6" height="11.5" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5v4" />
    </Svg>
  ),
  speaker: (p: P) => (
    <Svg {...p}>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
      <path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.6 7.6 0 0 1 0 11" />
    </Svg>
  ),
  info: (p: P) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5M12 7.6v.1" />
    </Svg>
  ),
  play: (p: P) => (
    <Svg {...p}>
      <path d="M7 4.5v15l12.5-7.5z" fill="currentColor" />
    </Svg>
  ),
  stop: (p: P) => (
    <Svg {...p}>
      <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
    </Svg>
  ),
  plus: (p: P) => (
    <Svg {...p}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  ),
  minus: (p: P) => (
    <Svg {...p}>
      <path d="M5 12h14" />
    </Svg>
  ),
  close: (p: P) => (
    <Svg {...p}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  ),
  chevron: (p: P) => (
    <Svg {...p}>
      <path d="M6 9l6 6 6-6" />
    </Svg>
  ),
  check: (p: P) => (
    <Svg {...p}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </Svg>
  ),
  warn: (p: P) => (
    <Svg {...p}>
      <path d="M12 3.5l9.5 16.5h-19z" />
      <path d="M12 10v4.5M12 17.3v.2" />
    </Svg>
  ),
  wand: (p: P) => (
    <Svg {...p}>
      <path d="M4 20L15.5 8.5M14 4.5l1 2 2 1-2 1-1 2-1-2-2-1 2-1zM19.5 10.5l.7 1.3 1.3.7-1.3.7-.7 1.3-.7-1.3-1.3-.7 1.3-.7z" />
    </Svg>
  ),
  grid: (p: P) => (
    <Svg {...p}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </Svg>
  ),
  bolt: (p: P) => (
    <Svg {...p}>
      <path d="M13 2.5L4.5 13.5H12l-1 8 8.5-11H12z" />
    </Svg>
  ),
  download: (p: P) => (
    <Svg {...p}>
      <path d="M12 3.5v12M7 11l5 5 5-5M4.5 20.5h15" />
    </Svg>
  )
};
