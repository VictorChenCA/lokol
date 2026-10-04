import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

/**
 * Sample sign-in. Nothing is authenticated: the Studio pretends a user is signed in so the demo
 * reads like a real product. Signing out only flips a flag in localStorage and returns to "/".
 */
export const SAMPLE_USER = {
  name: "Victor Chen",
  initials: "VC",
  email: "victor@example.org",
  workspace: "Solomon Islands health pilot (sample)"
};

const KEY = "lokol:signed-out";

export function isSignedOut(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setSignedOut(out: boolean) {
  try {
    if (out) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    /* storage blocked: the sample session simply is not remembered */
  }
}

export function Avatar({ size = 32, className = "" }: { size?: number; className?: string }) {
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-reef to-reef-deep font-display font-bold text-white ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
      aria-hidden
    >
      {SAMPLE_USER.initials}
    </span>
  );
}

/** Top-right avatar menu in the Studio app: who is "signed in", the sample workspace, sign out. */
export function ProfileMenu({ dark = false }: { dark?: boolean }) {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const signOut = () => {
    setSignedOut(true);
    setOpen(false);
    navigate("/");
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className={`flex items-center gap-2 rounded-full p-0.5 pr-1 transition-colors sm:pr-2 ${dark ? "hover:bg-canvas-2" : "hover:bg-ink/5"}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account: ${SAMPLE_USER.name}`}
        onClick={() => setOpen((o) => !o)}
      >
        <Avatar />
        <svg viewBox="0 0 12 12" className="hidden h-3 w-3 opacity-60 sm:block" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
          <path d="M3 4.5 6 7.5 9 4.5" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          className="animate-fade-in absolute right-0 top-11 z-50 w-[272px] overflow-hidden rounded-2xl border border-line bg-white text-ink shadow-lift"
        >
          <div className="flex items-center gap-3 border-b border-line-2 px-4 py-3.5">
            <Avatar size={40} />
            <div className="min-w-0">
              <p className="truncate text-[15px] font-semibold">{SAMPLE_USER.name}</p>
              <p className="truncate text-[12.5px] text-ink-3">{SAMPLE_USER.email}</p>
            </div>
          </div>
          <div className="border-b border-line-2 px-4 py-3">
            <p className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-3">Workspace</p>
            <p className="mt-0.5 text-[14px] leading-snug">{SAMPLE_USER.workspace}</p>
            <p className="mt-1 text-[12px] leading-snug text-ink-3">Sample account for the demo. Nothing is signed in for real; packs you build stay in this browser.</p>
          </div>
          <div className="p-1.5">
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[14px] hover:bg-sand"
              onClick={() => {
                setSettings(true);
                setOpen(false);
              }}
            >
              <svg viewBox="0 0 20 20" className="h-4 w-4 text-ink-3" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
                <circle cx="10" cy="10" r="2.6" />
                <path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" strokeLinecap="round" />
              </svg>
              Settings
            </button>
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[14px] hover:bg-sand"
              onClick={signOut}
            >
              <svg viewBox="0 0 20 20" className="h-4 w-4 text-ink-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M8 4H4.5v12H8M12.5 6.5 16 10l-3.5 3.5M16 10H8" />
              </svg>
              Sign out
            </button>
          </div>
        </div>
      )}
      {settings && <SettingsModal onClose={() => setSettings(false)} />}
    </div>
  );
}

function SettingsModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[120] grid place-items-center bg-ink/40 px-4" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={onClose}>
      <div className="w-full max-w-[420px] rounded-2xl border border-line bg-white p-6 text-ink shadow-lift" onClick={(e) => e.stopPropagation()}>
        <h2 id="settings-title" className="font-display text-[22px] font-bold">Workspace settings</h2>
        <dl className="mt-4 grid gap-3 text-[14px]">
          <div>
            <dt className="text-[12px] text-ink-3">Signed in as</dt>
            <dd>{SAMPLE_USER.name} (sample)</dd>
          </div>
          <div>
            <dt className="text-[12px] text-ink-3">Workspace</dt>
            <dd>{SAMPLE_USER.workspace}</dd>
          </div>
          <div>
            <dt className="text-[12px] text-ink-3">Where your work is stored</dt>
            <dd>Only in this browser. Custom packs live in IndexedDB; nothing is uploaded.</dd>
          </div>
        </dl>
        <p className="mt-4 text-[13px] leading-snug text-ink-3">Voice on or off for the field app is set in the field app itself (gear icon), per phone.</p>
        <div className="mt-5 flex justify-end">
          <button type="button" className="btn-ink btn-sm" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
