// Standalone Vite harness for the runtime lane. Run: cd app/src/runtime/dev && npm run dev
import { defineConfig, type Plugin } from 'vite';
import { resolve, dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReadStream, existsSync, statSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const appPublic = resolve(here, '../../../public');
const modelsDir = resolve(here, 'models');

const MIME: Record<string, string> = { '.onnx': 'application/octet-stream', '.json': 'application/json', '.bin': 'application/octet-stream', '.gguf': 'application/octet-stream', '.wav': 'audio/wav' };

// serves ./models/* (gitignored local model copies) at /models/* and /local-models/* (the app's dev path)
function localModels(): Plugin {
  return {
    name: 'lokol-local-models',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0];
        const prefix = url.startsWith('/local-models/') ? '/local-models/' : url.startsWith('/models/') ? '/models/' : null;
        if (!prefix) return next();
        const file = join(modelsDir, decodeURIComponent(url.slice(prefix.length)));
        if (!file.startsWith(modelsDir) || !existsSync(file) || !statSync(file).isFile()) {
          res.statusCode = 404;
          return res.end('not found');
        }
        res.setHeader('Content-Type', MIME[extname(file)] ?? 'application/octet-stream');
        res.setHeader('Content-Length', String(statSync(file).size));
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig({
  root: here,
  publicDir: appPublic,
  plugins: [localModels()],
  server: {
    port: 5177,
    strictPort: true,
    headers: {
      // crossOriginIsolated -> SharedArrayBuffer -> wllama multi-thread. credentialless keeps HF fetches working.
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
    fs: { allow: [resolve(here, '../../../..')] },
  },
  optimizeDeps: { exclude: ['@wllama/wllama', '@huggingface/transformers', 'kokoro-js'] },
  worker: { format: 'es' },
  build: { target: 'es2022' },
});
