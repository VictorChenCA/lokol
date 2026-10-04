import { NavLink, Outlet, Link, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { SignalBars, Toaster } from "./ui";

const NAV = [
  { to: "/studio", label: "Studio", pis: "Wokples" },
  { to: "/recommend", label: "Recommend", pis: "Wanem nao fitim" },
  { to: "/train", label: "Train", pis: "Trenem" },
  { to: "/eval", label: "Eval", pis: "Testem" },
  { to: "/deploy", label: "Deploy", pis: "Putum long fon" },
  { to: "/demo", label: "Demo", pis: "Traem" }
];

export function useOnline() {
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

/** Lokol mark: three nodes on a lagoon tile (channel, guideline lookup, model). */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <rect width="64" height="64" rx="15" fill="#102C3C" />
      <path d="M21 23 L31.5 42 M43 23 L32.5 42 M21 22 H43" stroke="#4A7A8C" strokeWidth="3" strokeLinecap="round" />
      <circle cx="20" cy="22" r="7" fill="#F2B84B" />
      <circle cx="44" cy="22" r="7" fill="#2EC4D3" />
      <circle cx="32" cy="44" r="7" fill="#EEF4F2" />
    </svg>
  );
}

function Connectivity({ online, dark }: { online: boolean; dark: boolean }) {
  return (
    <span
      className={`tip inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[12px] font-semibold ${
        online
          ? dark
            ? "border-canvas-line bg-canvas-2 text-canvas-text"
            : "border-line bg-white text-ink-2"
          : "border-palm/40 bg-palm-tint text-palm-deep"
      }`}
      tabIndex={0}
      data-side="bottom"
      aria-label={online ? "Online. Online nodes can reach WhatsApp and River." : "Offline. Everything marked offline keeps working on this device."}
    >
      <span className={online ? (dark ? "text-reef-bright" : "text-reef") : "text-palm"}>
        <SignalBars bars={online ? 4 : 0} />
      </span>
      <span className="hidden sm:inline">{online ? "Online" : "Offline"}</span>
      <span className={`hidden font-normal md:inline ${dark ? "text-canvas-muted" : "text-ink-3"} ${online ? "" : "!text-palm-deep/80"}`}>{online ? "Gat signal" : "No signal, hem oraet"}</span>
      <span role="tooltip">{online ? "Online nodes (WhatsApp, River 9B) can run. Offline nodes never need it." : "No signal. Every offline node keeps working on this device."}</span>
    </span>
  );
}

export function Shell() {
  const online = useOnline();
  const { pathname } = useLocation();
  const dark = pathname.startsWith("/studio");
  const [menu, setMenu] = useState(false);

  useEffect(() => setMenu(false), [pathname]);
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  return (
    <div className={`flex h-full min-h-screen flex-col ${dark ? "bg-canvas" : ""}`}>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[200] focus:rounded-lg focus:bg-ink focus:px-3 focus:py-2 focus:text-white">
        Skip to content
      </a>
      <header
        className={`sticky top-0 z-40 border-b backdrop-blur ${
          dark ? "on-dark border-canvas-line bg-canvas/90 text-canvas-text" : "border-line/80 bg-paper/85 text-ink"
        }`}
      >
        <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-2 px-4 sm:px-6">
          <Link to="/" className="mr-2 flex items-center gap-2.5 rounded-lg" aria-label="Lokol Studio home">
            <Logo />
            <span className="font-display text-[18px] font-bold tracking-tight" style={{ fontVariationSettings: '"wdth" 88, "opsz" 24' }}>
              Lokol Studio
            </span>
          </Link>
          <nav className="hidden items-center gap-0.5 md:flex" aria-label="Main">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                title={n.pis}
                className={({ isActive }) =>
                  `relative rounded-lg px-3 py-1.5 text-[14px] font-medium transition-colors ${
                    isActive
                      ? dark
                        ? "bg-canvas-3 text-white"
                        : "bg-ink text-white"
                      : dark
                        ? "text-canvas-muted hover:bg-canvas-2 hover:text-white"
                        : "text-ink-2 hover:bg-ink/5 hover:text-ink"
                  }`
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Connectivity online={online} dark={dark} />
            <button
              type="button"
              className={`grid h-9 w-9 place-items-center rounded-lg md:hidden ${dark ? "hover:bg-canvas-2" : "hover:bg-ink/5"}`}
              aria-expanded={menu}
              aria-controls="mobile-nav"
              aria-label={menu ? "Close menu" : "Open menu"}
              onClick={() => setMenu((m) => !m)}
            >
              <svg viewBox="0 0 20 20" className="h-5 w-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
                {menu ? <path d="M5 5l10 10M15 5L5 15" /> : <path d="M3.5 6h13M3.5 10h13M3.5 14h13" />}
              </svg>
            </button>
          </div>
        </div>
        {menu && (
          <nav
            id="mobile-nav"
            aria-label="Main (mobile)"
            className={`animate-fade-in border-t px-3 pb-3 pt-2 md:hidden ${dark ? "border-canvas-line" : "border-line/70"}`}
          >
            <ul className="grid grid-cols-2 gap-1.5">
              {NAV.map((n) => (
                <li key={n.to}>
                  <NavLink
                    to={n.to}
                    className={({ isActive }) =>
                      `block rounded-xl px-3 py-2.5 ${
                        isActive
                          ? dark
                            ? "bg-reef-bright text-canvas"
                            : "bg-ink text-white"
                          : dark
                            ? "bg-canvas-2 text-canvas-text"
                            : "border border-line bg-white text-ink"
                      }`
                    }
                  >
                    <span className="block text-[15px] font-semibold">{n.label}</span>
                    <span className="block text-[12px] opacity-70" lang="pis">{n.pis}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </header>
      <main id="main" className="flex min-h-0 flex-1 flex-col">
        <Outlet />
      </main>
      <Toaster />
    </div>
  );
}
