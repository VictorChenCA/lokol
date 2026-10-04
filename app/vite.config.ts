import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { createReadStream, existsSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * crossOriginIsolated -> SharedArrayBuffer -> multi-threaded wllama.
 * `credentialless` (not `require-corp`) keeps no-cors loads working: Google Fonts CSS, and
 * Hugging Face model downloads (CORS with ACAO:*) need no CORP header from the third party.
 */
const ISOLATION_HEADERS = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "credentialless"
};

/**
 * Dev-only: serves /local-models/* from the repo's own model folders so the demo can run, and be
 * recorded, with no network at all. Range requests are supported (wllama and transformers.js both
 * may use them). Directories are searched in order; the first hit wins.
 *   ../models/gguf               tuned + base GGUFs written by the TRAIN lane (gitignored)
 *   src/runtime/dev/models       ONNX exports, e.g. mms-tts-pis-onnx/ (gitignored)
 */
const LOCAL_MODEL_DIRS = [resolve(here, "../models/gguf"), resolve(here, "src/runtime/dev/models")];
const MIME: Record<string, string> = {
  ".gguf": "application/octet-stream",
  ".onnx": "application/octet-stream",
  ".bin": "application/octet-stream",
  ".json": "application/json",
  ".txt": "text/plain",
  ".wav": "audio/wav"
};

function localModels(): Plugin {
  return {
    name: "lokol-local-models",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? "").split("?")[0];
        if (!path.startsWith("/local-models/")) return next();
        const rel = decodeURIComponent(path.slice("/local-models/".length));
        let file: string | null = null;
        for (const dir of LOCAL_MODEL_DIRS) {
          const f = join(dir, rel);
          if (f.startsWith(dir) && existsSync(f) && statSync(f).isFile()) {
            file = f;
            break;
          }
        }
        for (const [k, v] of Object.entries(ISOLATION_HEADERS)) res.setHeader(k, v);
        res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");
        res.setHeader("Cache-Control", "no-cache");
        if (!file) {
          res.statusCode = 404;
          res.setHeader("Content-Type", "text/plain");
          return res.end(`not found: ${rel}`);
        }
        const size = statSync(file).size;
        res.setHeader("Content-Type", MIME[extname(file)] ?? "application/octet-stream");
        res.setHeader("Accept-Ranges", "bytes");
        const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ""));
        let start = 0;
        let end = size - 1;
        if (range && (range[1] || range[2])) {
          if (range[1]) {
            start = Number(range[1]);
            end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
          } else {
            start = Math.max(0, size - Number(range[2]));
          }
          if (start > end || start >= size) {
            res.statusCode = 416;
            res.setHeader("Content-Range", `bytes */${size}`);
            return res.end();
          }
          res.statusCode = 206;
          res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
        }
        res.setHeader("Content-Length", String(end - start + 1));
        if (req.method === "HEAD") return res.end();
        createReadStream(file, { start, end }).pipe(res);
      });
    }
  };
}

export default defineConfig({
  plugins: [
    react(),
    localModels(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/lokol.svg", "eval/results.sample.json"],
      manifest: {
        // Installs the field app (Add to Home Screen); the Studio stays a website.
        id: "/demo",
        name: "Lokol Health",
        short_name: "Lokol",
        description: "Offline helper for nurse aides: child care from the Solomon Islands Standard Treatment Manual. Talk or type; it answers out loud.",
        lang: "en",
        theme_color: "#102C3C",
        background_color: "#EEF4F2",
        display: "standalone",
        orientation: "portrait",
        start_url: "/demo",
        scope: "/",
        icons: [
          { src: "icons/lokol.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "icons/lokol-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icons/lokol-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "icons/lokol-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
          { src: "icons/lokol-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,json,woff2,wasm}"],
        // onnxruntime-web wasm (21-27 MB each, pulled in by transformers.js / kokoro-js) is too big to
        // precache on a phone; the runtime "lokol-models" rule below caches it on first voice use instead.
        globIgnores: ["**/ort-wasm-*.wasm"],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        navigateFallbackDenylist: [/^\/local-models\//],
        runtimeCaching: [
          {
            // Model files (GGUF / ONNX) loaded by URL: cache once, serve offline afterwards.
            // wllama also keeps its own OPFS copy of the GGUF, so the phone works in airplane mode.
            urlPattern: ({ url }) =>
              /huggingface\.co|hf\.co|xethub|cdn\.jsdelivr\.net|\.gguf$|\.onnx$|\.wasm$|\/packs\//.test(url.href) && !/\/local-models\//.test(url.pathname),
            handler: "CacheFirst",
            options: {
              cacheName: "lokol-models",
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 90 },
              cacheableResponse: { statuses: [0, 200] },
              rangeRequests: true
            }
          },
          {
            urlPattern: ({ url }) => /fonts\.(googleapis|gstatic)\.com/.test(url.host),
            handler: "StaleWhileRevalidate",
            options: { cacheName: "lokol-fonts", cacheableResponse: { statuses: [0, 200] } }
          }
        ]
      }
    })
  ],
  server: { port: 5173, strictPort: false, headers: ISOLATION_HEADERS },
  preview: { headers: ISOLATION_HEADERS },
  // wllama ships its own wasm + worker; transformers.js / kokoro-js load onnxruntime-web dynamically.
  // Pre-bundling breaks their relative asset URLs, so leave them as native ESM.
  optimizeDeps: { exclude: ["@wllama/wllama", "@huggingface/transformers", "kokoro-js"] },
  worker: { format: "es" },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          flow: ["@xyflow/react"],
          vendor: ["react", "react-dom", "react-router-dom", "zustand"],
          pack: ["jszip", "qrcode"]
        }
      }
    }
  },
  test: { environment: "node", include: ["src/**/*.test.ts"] }
} as any);
