import { lazy, Suspense } from "react";
import { Routes, Route } from "react-router-dom";
import { Shell } from "./components/Shell";
import Home from "./pages/Home";
import { Spinner } from "./components/ui";

// Pages load on demand so Home paints fast on a 3G phone. Every chunk is precached by the PWA.
const Studio = lazy(() => import("./pages/Studio"));
const Recommend = lazy(() => import("./pages/Recommend"));
const Demo = lazy(() => import("./pages/Demo"));
const Deploy = lazy(() => import("./pages/Packs"));
const Eval = lazy(() => import("./pages/Eval"));

const Train = lazy(() => import("./pages/Train"));
const NewPack = lazy(() => import("./pages/NewPack"));

function PageLoading() {
  return (
    <div className="grid flex-1 place-items-center py-24 text-ink-3" role="status">
      <span className="inline-flex items-center gap-2 text-[14px]">
        <Spinner /> Loading
      </span>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route path="/" element={<Home />} />
        <Route path="/studio" element={<Suspense fallback={<PageLoading />}><Studio /></Suspense>} />
        <Route path="/recommend" element={<Suspense fallback={<PageLoading />}><Recommend /></Suspense>} />
        <Route path="/train" element={<Suspense fallback={<PageLoading />}><Train /></Suspense>} />
        <Route path="/eval" element={<Suspense fallback={<PageLoading />}><Eval /></Suspense>} />
        <Route path="/deploy" element={<Suspense fallback={<PageLoading />}><Deploy /></Suspense>} />
        <Route path="/packs" element={<Suspense fallback={<PageLoading />}><Deploy /></Suspense>} />
        <Route path="/new" element={<Suspense fallback={<PageLoading />}><NewPack /></Suspense>} />
        <Route path="/demo" element={<Suspense fallback={<PageLoading />}><Demo /></Suspense>} />
        <Route path="*" element={<Home />} />
      </Route>
    </Routes>
  );
}
