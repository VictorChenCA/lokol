import { NavLink, Outlet, Link, useLocation } from "react-router-dom";
import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from "react";
import { SignalBars, Toaster } from "./ui";

const NAV = [
  { to: "/recommend", label: "Recommend", pis: "Wanem nao fitim" },
  { to: "/studio", label: "Studio", pis: "Wokples" },
  { to: "/new", label: "New pack", pis: "Niu pak" },
  { to: "/train", label: "Train", pis: "Trenem" },
  { to: "/eval", label: "Eval", pis: "Testem" },
  { to: "/deploy", label: "Deploy", pis: "Putum long fon" },
  { to: "/demo", label: "Demo", pis: "Traem" }
];

/** The judge's path through the product; each paper page ends with a link to the next stop. */
const STORY: Record<string, { to: string; step: number; title: string; pis: string; blurb: string }> = {
  "/train": { to: "/eval", step: 4, title: "Check the evidence", pis: "Testem", blurb: "Base and tuned models on the same held-out cases: danger signs, refusals, citations." },
  "/eval": { to: "/deploy", step: 5, title: "Deploy the pack", pis: "Putum long fon", blurb: "A QR for the offline phone app, a GGUF for PocketPal, a clinic laptop, or WhatsApp." },
  "/deploy": { to: "/demo", step: 6, title: "Try Lokol Health", pis: "Traem", blurb: "Type or tap a case in Pijin or English and watch it answer with no signal." },
  "/packs": { to: "/demo", step: 6, title: "Try Lokol Health", pis: "Traem", blurb: "Type or tap a case in Pijin or English and watch it answer with no signal." }
};

function NextStop({ pathname }: { pathname: string }) {
  const next = STORY[pathname];
  if (!next) return null;
  return (
    <nav aria-label="Next step" className="border-t border-line/80 bg-paper-2/60">
      <div className="page flex flex-wrap items-center justify-between gap-4 py-8">
        <div className="min-w-0">
          <p className="text-[13px] text-ink-3">Next, step {next.step} of 6</p>
          <p className="mt-1 font-display text-[24px] font-bold leading-tight text-ink">
            {next.title} <span className="text-[16px] font-medium text-ink-3" lang="pis">{next.pis}</span>
          </p>
          <p className="mt-1 max-w-[60ch] text-[15px] text-ink-2">{next.blurb}</p>
        </div>
        <Link to={next.to} className="btn-ink">
          {next.title}
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M6 3.5 10.5 8 6 12.5" />
          </svg>
        </Link>
      </div>
    </nav>
  );
}

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

/** Catches a page that fails to load or render, so the shell and nav stay usable. */
class PageBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Lokol page error", error, info.componentStack);
  }
  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  render() {
    if (!this.state.error) return this.props.children;
    const chunk = /dynamically imported module|Importing a module script failed|Failed to fetch/i.test(this.state.error.message);
    return (
      <div className="page py-16">
        <div className="mx-auto max-w-[560px] rounded-2xl border border-line bg-white p-6 shadow-card">
          <h1 className="font-display text-[24px] font-bold">This page did not load</h1>
          <p className="mt-2 text-[15px] leading-relaxed text-ink-2">
            {chunk
              ? "Part of the app could not be fetched. If you are offline, open a page you visited before; with signal, reload to get the latest version."
              : "Something on this page failed. The rest of Lokol still works."}
          </p>
          <pre className="mt-3 max-h-24 overflow-auto rounded-lg bg-sand px-3 py-2 font-mono text-[12px] text-ink-3">{this.state.error.message}</pre>
          <div className="mt-4 flex gap-2">
            <button type="button" className="btn-ink btn-sm" onClick={() => location.reload()}>Reload</button>
            <a href="/" className="btn-ghost btn-sm">Go home</a>
          </div>
        </div>
      </div>
    );
  }
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
      data-align="end"
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
    const here = NAV.find((n) => pathname === n.to || (n.to === "/deploy" && pathname === "/packs"));
    document.title = here ? `${here.label} | Lokol Studio` : "Lokol Studio";
  }, [pathname]);
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  return (
    <div className={`flex min-h-screen flex-col ${dark ? "bg-canvas" : ""}`}>
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
                className={({ isActive: active }) => {
                  const isActive = active || (n.to === "/deploy" && pathname === "/packs");
                  return `relative rounded-lg px-3 py-1.5 text-[14px] font-medium transition-colors ${
                    isActive
                      ? dark
                        ? "bg-canvas-3 text-white"
                        : "bg-ink text-white"
                      : dark
                        ? "text-canvas-muted hover:bg-canvas-2 hover:text-white"
                        : "text-ink-2 hover:bg-ink/5 hover:text-ink"
                  }`;
                }}
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
        <PageBoundary resetKey={pathname}>
          <Outlet />
        </PageBoundary>
      </main>
      <NextStop pathname={pathname} />
      <Toaster />
    </div>
  );
}
