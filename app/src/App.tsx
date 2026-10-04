import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Routes, Route, useLocation } from "react-router-dom";
import { AppShell, FieldShell, MarketingShell } from "./components/Shell";
import Home from "./pages/Home";
import { Spinner } from "./components/ui";

// Pages load on demand so the landing paints fast on a 3G phone. Every chunk is precached by the PWA.
const AppHome = lazy(() => import("./pages/AppHome"));
const Studio = lazy(() => import("./pages/Studio"));
const Recommend = lazy(() => import("./pages/Recommend"));
const Demo = lazy(() => import("./pages/Demo"));
const Deploy = lazy(() => import("./pages/Packs"));
const Eval = lazy(() => import("./pages/Eval"));
const Train = lazy(() => import("./pages/Train"));
const NewPack = lazy(() => import("./pages/NewPack"));
const PackLibrary = lazy(() => import("./pages/PackLibrary"));

function PageLoading() {
  return (
    <div className="grid flex-1 place-items-center py-24 text-ink-3" role="status">
      <span className="inline-flex items-center gap-2 text-[14px]">
        <Spinner /> Loading
      </span>
    </div>
  );
}

const lazyPage = (el: ReactNode) => <Suspense fallback={<PageLoading />}>{el}</Suspense>;

/** Old links: /new is now /packs/new (query string kept). */
function NewRedirect() {
  const { search } = useLocation();
  return <Navigate to={`/packs/new${search}`} replace />;
}

export default function App() {
  return (
    <Routes>
      {/* Public site */}
      <Route element={<MarketingShell />}>
        <Route path="/" element={<Home />} />
      </Route>

      {/* Lokol Studio web app (sample user signed in) */}
      <Route element={<AppShell />}>
        <Route path="/app" element={lazyPage(<AppHome />)} />
        <Route path="/recommend" element={lazyPage(<Recommend />)} />
        <Route path="/studio" element={lazyPage(<Studio />)} />
        <Route path="/packs" element={lazyPage(<PackLibrary />)} />
        <Route path="/packs/new" element={lazyPage(<NewPack />)} />
        <Route path="/new" element={<NewRedirect />} />
        <Route path="/train" element={lazyPage(<Train />)} />
        <Route path="/eval" element={lazyPage(<Eval />)} />
        <Route path="/deploy" element={lazyPage(<Deploy />)} />
      </Route>

      {/* Field app: the installable phone app a nurse aide uses */}
      <Route element={<FieldShell />}>
        <Route path="/demo" element={lazyPage(<Demo />)} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
