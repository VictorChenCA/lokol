import { NavLink, Outlet, Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from "react";
import { SignalBars, Toaster } from "./ui";
import { ProfileMenu, isSignedOut, setSignedOut } from "./Profile";
import { ModelCardModal } from "./ModelCard";

/** Studio app navigation. The field app (/demo) and the public site ("/") have their own bars. */
const NAV: { to: string; label: string; title: string; end?: boolean }[] = [
  { to: "/app", label: "Overview", title: "Overview", end: true },
  { to: "/recommend", label: "Recommend", title: "Recommend" },
  { to: "/packs", label: "Packs", title: "Packs" },
  { to: "/studio", label: "Studio", title: "Studio" }
];

export const GITHUB_URL = "https://github.com/VictorChenCA/lokol";

/** Pages that end with a link to the next stop. Train and Evaluate now live in the model card, so only Deploy has one. */
const STORY: Record<string, { to: string; title: string; blurb: string }> = {
  "/deploy": { to: "/demo", title: "Try the field app", blurb: "Type, tap or speak a case and hear it answer with no signal." }
};

function NextStop({ pathname }: { pathname: string }) {
  const next = STORY[pathname];
  if (!next) return null;
  return (
    <nav aria-label="Next step" className="border-t border-line/80 bg-paper-2/60">
      <div className="page flex flex-wrap items-center justify-between gap-4 py-8">
        <div className="min-w-0">
          <p className="text-[13px] text-ink-3">Next</p>
          <p className="mt-1 font-display text-[24px] font-bold leading-tight text-ink">
            {next.title}
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
            <a href="/app" className="btn-ghost btn-sm">Go to overview</a>
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
      <span role="tooltip">{online ? "Online nodes (WhatsApp, River 9B) can run. Offline nodes never need it." : "No signal. Every offline node keeps working on this device."}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ document titles */

const TITLES: Record<string, string> = {
  "/": "Lokol: small AI that runs where the signal does not",
  "/app": "Overview | Lokol Studio",
  "/recommend": "Recommend | Lokol Studio",
  "/studio": "Studio | Lokol Studio",
  "/new": "New pack | Lokol Studio",
  "/train": "Training runs | Lokol Studio",
  "/eval": "Evaluation | Lokol Studio",
  "/deploy": "Deploy | Lokol Studio",
  "/packs": "Packs | Lokol Studio",
  "/packs/new": "New pack | Lokol Studio",
  "/demo": "Lokol Health"
};

function useDocTitle(pathname: string) {
  useEffect(() => {
    document.title = TITLES[pathname] ?? "Lokol Studio";
  }, [pathname]);
}

function SkipLink() {
  return (
    <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[200] focus:rounded-lg focus:bg-ink focus:px-3 focus:py-2 focus:text-white">
      Skip to content
    </a>
  );
}

function Wordmark({ text }: { text: string }) {
  return (
    <span className="font-display text-[18px] font-bold tracking-tight" style={{ fontVariationSettings: '"wdth" 88, "opsz" 24' }}>
      {text}
    </span>
  );
}

/* ------------------------------------------------------------------ public site */

const MARKETING_LINKS = [
  { href: "/#how", label: "How it works" },
  { href: "/#evidence", label: "Evidence" }
];

/** Public landing at "/": its own minimal bar, no app navigation. */
export function MarketingShell() {
  const { pathname, hash } = useLocation();
  const navigate = useNavigate();
  useDocTitle("/");
  useEffect(() => {
    if (!hash) return;
    const el = document.getElementById(hash.slice(1));
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [hash]);
  const launch = () => {
    setSignedOut(false);
    navigate("/app");
  };
  return (
    <div className="flex min-h-screen flex-col">
      <SkipLink />
      <header className="sticky top-0 z-40 border-b border-line/80 bg-paper/85 text-ink backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1200px] items-center gap-2 px-4 sm:px-6">
          <Link to="/" className="mr-3 flex items-center gap-2.5 rounded-lg" aria-label="Lokol home">
            <Logo />
            <Wordmark text="Lokol" />
          </Link>
          <nav className="hidden items-center gap-0.5 md:flex" aria-label="Site">
            {MARKETING_LINKS.map((l) => (
              <a key={l.href} href={l.href} className="rounded-lg px-3 py-1.5 text-[14px] font-medium text-ink-2 hover:bg-ink/5 hover:text-ink">
                {l.label}
              </a>
            ))}
            <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="rounded-lg px-3 py-1.5 text-[14px] font-medium text-ink-2 hover:bg-ink/5 hover:text-ink">
              GitHub
            </a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Link to="/demo" className="hidden rounded-lg px-3 py-1.5 text-[14px] font-medium text-ink-2 hover:bg-ink/5 hover:text-ink sm:inline-flex">
              Try the field app
            </Link>
            <button type="button" className="btn-ink btn-sm" onClick={launch}>
              Launch Lokol Studio
            </button>
          </div>
        </div>
      </header>
      <main id="main" className="flex min-h-0 flex-1 flex-col">
        <PageBoundary resetKey={pathname}>
          <Outlet />
        </PageBoundary>
      </main>
      <Toaster />
    </div>
  );
}

/* ------------------------------------------------------------------ Studio app */

function isActivePath(to: string, pathname: string, end?: boolean) {
  return end ? pathname === to : pathname === to || pathname.startsWith(to + "/");
}

/** The Studio web app: a sample user is "signed in"; nav for the build pipeline; Field app button. */
export function AppShell() {
  const online = useOnline();
  const { pathname } = useLocation();
  const dark = pathname.startsWith("/studio");
  const [menu, setMenu] = useState(false);
  useDocTitle(pathname);

  // Opening any Studio page is "signing in" to the sample workspace.
  useEffect(() => {
    if (isSignedOut()) setSignedOut(false);
  }, []);
  useEffect(() => setMenu(false), [pathname]);
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  return (
    <div className={`flex min-h-screen flex-col ${dark ? "bg-canvas" : ""}`}>
      <SkipLink />
      <header
        className={`sticky top-0 z-40 border-b backdrop-blur ${
          dark ? "on-dark border-canvas-line bg-canvas/90 text-canvas-text" : "border-line/80 bg-paper/85 text-ink"
        }`}
      >
        <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-2 px-4 sm:px-6">
          <Link to="/app" className="mr-2 flex shrink-0 items-center gap-2.5 rounded-lg" aria-label="Lokol Studio overview">
            <Logo />
            <Wordmark text="Lokol Studio" />
          </Link>
          <nav className="hidden items-center gap-0.5 lg:flex" aria-label="Studio">
            {NAV.map((n) => {
              const active = isActivePath(n.to, pathname, n.end);
              return (
                <NavLink
                  key={n.to}
                  to={n.to}
                  end={n.end}
                  aria-current={active ? "page" : undefined}
                  className={`relative rounded-lg px-3 py-1.5 text-[14px] font-medium transition-colors ${
                    active
                      ? dark
                        ? "bg-canvas-3 text-white"
                        : "bg-ink text-white"
                      : dark
                        ? "text-canvas-muted hover:bg-canvas-2 hover:text-white"
                        : "text-ink-2 hover:bg-ink/5 hover:text-ink"
                  }`}
                >
                  {n.label}
                </NavLink>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden xl:inline-flex">
              <Connectivity online={online} dark={dark} />
            </span>
            <Link
              to="/demo"
              className={`hidden items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13.5px] font-semibold transition-colors sm:inline-flex ${
                dark ? "border-canvas-line text-canvas-text hover:bg-canvas-2" : "border-line bg-white text-ink hover:border-ink-4"
              }`}
              title="Open the offline phone app that a nurse aide uses"
            >
              <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                <rect x="4" y="1.5" width="8" height="13" rx="1.8" />
                <path d="M7 12.2h2" strokeLinecap="round" />
              </svg>
              Field app
            </Link>
            <Link
              to="/deploy"
              aria-current={pathname === "/deploy" ? "page" : undefined}
              className={`!px-3 !py-1.5 text-[13.5px] ${dark ? "btn-glow btn-sm" : "btn-ink"}`}
              title="Pick a pack, finalize settings, and launch it on a phone, laptop or WhatsApp"
            >
              Deploy
            </Link>
            <ProfileMenu dark={dark} />
            <button
              type="button"
              className={`grid h-9 w-9 place-items-center rounded-lg lg:hidden ${dark ? "hover:bg-canvas-2" : "hover:bg-ink/5"}`}
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
          <nav id="mobile-nav" aria-label="Studio (mobile)" className={`animate-fade-in border-t px-3 pb-3 pt-2 lg:hidden ${dark ? "border-canvas-line" : "border-line/70"}`}>
            <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {[...NAV, { to: "/deploy", label: "Deploy", title: "Deploy", end: true }, { to: "/demo", label: "Field app", title: "Field app", end: true }].map((n) => {
                const active = isActivePath(n.to, pathname, n.end);
                return (
                  <li key={n.to}>
                    <Link
                      to={n.to}
                      aria-current={active ? "page" : undefined}
                      className={`block rounded-xl px-3 py-2.5 text-[15px] font-semibold ${
                        active
                          ? dark
                            ? "bg-reef-bright text-canvas"
                            : "bg-ink text-white"
                          : dark
                            ? "bg-canvas-2 text-canvas-text"
                            : "border border-line bg-white text-ink"
                      }`}
                    >
                      {n.label}
                    </Link>
                  </li>
                );
              })}
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
      <ModelCardModal />
      <Toaster />
    </div>
  );
}

/** Kept for older imports: the Studio app shell. */
export const Shell = AppShell;

/* ------------------------------------------------------------------ field app */

/**
 * Fired when the gear in the field app's header is tapped. The field page listens and opens its
 * settings (speech-to-text and read-aloud switches, voice test). If nothing handles it
 * (event not cancelled), the shell falls back to adding ?settings=1 to the URL.
 */
export const FIELD_SETTINGS_EVENT = "lokol:field-settings";

/** The installable phone app at /demo: brand bar, settings gear, a small link back to Studio. */
export function FieldShell() {
  const { pathname } = useLocation();
  const [params, setParams] = useSearchParams();
  useDocTitle("/demo");
  const openSettings = () => {
    const handled = !window.dispatchEvent(new CustomEvent(FIELD_SETTINGS_EVENT, { cancelable: true }));
    if (!handled) {
      const next = new URLSearchParams(params);
      next.set("settings", "1");
      setParams(next, { replace: true });
    }
  };
  return (
    <div className="flex min-h-screen flex-col">
      <SkipLink />
      <header className="sticky top-0 z-40 border-b border-line/80 bg-paper/90 text-ink backdrop-blur" style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <div className="mx-auto flex h-12 max-w-[1060px] items-center gap-2 px-4">
          <Link to="/demo" className="flex items-center gap-2 rounded-lg" aria-label="Lokol Health">
            <Logo size={24} />
            <span className="font-display text-[17px] font-bold tracking-tight">Lokol Health</span>
          </Link>
          <div className="ml-auto flex items-center gap-1">
            <Link to="/app" className="rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-ink-3 hover:bg-ink/5 hover:text-ink" title="Back to Lokol Studio">
              Studio
            </Link>
            <button type="button" className="grid h-9 w-9 place-items-center rounded-lg text-ink-2 hover:bg-ink/5 hover:text-ink" aria-label="Settings: voice in and out" title="Settings" onClick={openSettings}>
              <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M8.6 2.5h2.8l.4 2.1 1.4.8 2-.8 1.4 2.4-1.6 1.4v1.6l1.6 1.4-1.4 2.4-2-.8-1.4.8-.4 2.1H8.6l-.4-2.1-1.4-.8-2 .8-1.4-2.4 1.6-1.4V9.2L3.4 7.8 4.8 5.4l2 .8 1.4-.8z" />
                <circle cx="10" cy="10" r="2.3" />
              </svg>
            </button>
          </div>
        </div>
      </header>
      <main id="main" className="flex min-h-0 flex-1 flex-col">
        <PageBoundary resetKey={pathname}>
          <Outlet />
        </PageBoundary>
      </main>
      <Toaster />
    </div>
  );
}
