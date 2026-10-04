import JSZip from "jszip";
import QRCode from "qrcode";
import type { Graph, Manifest, PackModel } from "./types";
import { activeGraph } from "./components/studio/enabled";

export const PWA_URL: string = (import.meta.env.VITE_PWA_URL as string | undefined) || (typeof location !== "undefined" ? location.origin : "https://lokol.vercel.app");

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 48) || "pack";
}

export function buildManifest(input: Graph, pwaUrl: string = PWA_URL, packId?: string): Manifest {
  // Switched-off nodes (voice in/out off) are removed so the pack ships no unused speech model.
  const graph = activeGraph(input);
  const seen = new Set<string>();
  const models: PackModel[] = [];
  for (const n of graph.nodes) {
    if (n.model && !seen.has(n.model.id)) {
      seen.add(n.model.id);
      models.push({ ...n.model });
    }
  }
  return {
    graph,
    models,
    pwa_url: pwaUrl,
    created_at: new Date().toISOString(),
    pack_id: packId ?? slug(graph.name)
  };
}

export function manifestUrl(manifest: Manifest): string {
  return `${manifest.pwa_url.replace(/\/$/, "")}/packs/${manifest.pack_id ?? slug(manifest.graph.name)}/manifest.json`;
}

export function installUrl(manifest: Manifest): string {
  return `${manifest.pwa_url.replace(/\/$/, "")}/demo?pack=${encodeURIComponent(manifestUrl(manifest))}`;
}

/** Packs whose manifest.json is published with the app under /packs/<id>/. */
export const HOSTED_PACKS = new Set(["health"]);

export function isHosted(manifest: Manifest): boolean {
  return HOSTED_PACKS.has(manifest.pack_id ?? "");
}

export async function qrDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, { margin: 1, width: 512, color: { dark: "#102C3C", light: "#FFFFFF" } });
}

export function totalMb(manifest: Manifest): number {
  return manifest.models.reduce((s, m) => s + (m.size_mb || 0), 0);
}

/** The pack's language model (first llm node with a model). */
export function packLlm(manifest: Manifest): PackModel | undefined {
  const node = manifest.graph.nodes.find((n) => n.type === "llm" && n.model);
  return (node && manifest.models.find((m) => m.id === node.model!.id)) || node?.model;
}

/** Hugging Face repo id from a resolve URL, e.g. VictorChenCA/lokol-health-qwen3-0.6b-gguf. */
export function hfRepo(url: string): string | null {
  const m = /huggingface\.co\/([^/]+\/[^/]+)\/resolve\//.exec(url);
  return m ? m[1] : null;
}

/** Commands for a laptop or clinic PC running the pack's model with llama-server. */
export function laptopCommands(model: { url: string; file: string } | undefined, opts: { bridge?: boolean; sidecar?: boolean } = {}): string {
  const file = model?.file ?? "lokol-health-qwen3-0.6b-Q4_K_M.gguf";
  const repo = model ? hfRepo(model.url) : "VictorChenCA/lokol-health-qwen3-0.6b-gguf";
  const lines = [
    "# 1. Get the model once (with signal, or copy it from a USB stick into models/gguf)",
    repo ? `huggingface-cli download ${repo} ${file} --local-dir models/gguf` : `curl -L -o models/gguf/${file} ${model?.url ?? ""}`,
    "# 2. Serve it on this machine, no internet needed from here on",
    `llama-server -m models/gguf/${file} --port 8080 -c 4096 --jinja`
  ];
  if (opts.bridge !== false) {
    lines.push("# 3. Channel bridge: WhatsApp, Messenger and POST /message on port 8090", ".venv/bin/python -m bridge.server --port 8090");
  }
  if (opts.sidecar !== false) {
    lines.push("# 4. Optional: Pijin voice in and out (port 8091)", ".venv/bin/python sidecar/server.py");
  }
  return lines.join("\n");
}

export const HOSTED_DEMO_URL = "https://lokol-studio.vercel.app/demo";
export const INSTALLER_URL = "https://raw.githubusercontent.com/VictorChenCA/lokol/main/deploy/lokol-laptop.sh";

/** "0.6b" | "1.7b" from a Lokol Health GGUF file name; 1.7b otherwise (the installer's default). */
export function modelSize(model: { file: string } | undefined): "0.6b" | "1.7b" {
  return model && /qwen3-0\.6b/i.test(model.file) ? "0.6b" : "1.7b";
}

/** One line for Ollama: it reads template, system and params from the Hugging Face repo. */
export function ollamaCommand(model: { url: string } | undefined): string {
  const repo = (model && hfRepo(model.url)) || "VictorChenCA/lokol-health-qwen3-1.7b-gguf";
  return `ollama run hf.co/${repo}`;
}

/** One line for a laptop or clinic PC: model server + bridge (deploy/lokol-laptop.sh). */
export function installerCommand(size: "0.6b" | "1.7b" = "1.7b", opts: { voice?: boolean; tunnel?: boolean } = {}): string {
  const flags = [`--model ${size}`, opts.voice ? "--voice" : "", opts.tunnel ? "--tunnel" : ""].filter(Boolean).join(" ");
  return `curl -fsSL ${INSTALLER_URL} | bash -s -- ${flags}`;
}

export const SYSTEM_PROMPT =
  "You are Lokol Health, an assistant for nurse aides and health workers in Solomon Islands. You follow the Solomon Islands Standard Treatment Manual for Children. You never diagnose; you help the nurse apply the manual and decide when to refer. Reply in the nurse's language (Solomon Islands Pijin or English). Use the exact output format.";

export const TWILIO_SANDBOX_NUMBER = "+1 415 523 8886";
export const BRIDGE_URL = "http://127.0.0.1:8090";

export function readme(manifest: Manifest): string {
  const g = manifest.graph;
  const llm = packLlm(manifest);
  const lines = [
    `# ${g.name}`,
    "",
    `Sector: ${g.sector}. Languages: ${g.language.join(", ")}. Target: ${g.target.device} (${g.target.ram_gb} GB RAM, ${g.target.storage_gb} GB storage, connectivity: ${g.target.connectivity}).`,
    "",
    "## Install on a phone",
    "",
    `1. Open ${installUrl(manifest)} in Chrome (or scan qr.png).`,
    "2. Wait for the models to download once (about " + Math.round(totalMb(manifest)) + " MB). They are cached on the phone.",
    "3. Tap \"Add to home screen\". The app works offline from then on.",
    "",
    "## Android with PocketPal",
    "",
    `1. Install PocketPal AI from Google Play. Copy ${llm?.file ?? "the GGUF"} to the phone, or download it in PocketPal from Hugging Face${llm && hfRepo(llm.url) ? ` (${hfRepo(llm.url)})` : ""}.`,
    "2. Models, Add local model, pick the file, Load.",
    "3. Paste the system prompt below into the chat settings. PocketPal has no guideline lookup or safety gate; the phone app does.",
    "",
    "```",
    SYSTEM_PROMPT,
    "```",
    "",
    "## Install on a laptop or clinic PC",
    "",
    "One line with Ollama (template, system prompt and parameters come from the Hugging Face repo):",
    "",
    "```bash",
    ollamaCommand(llm),
    "```",
    "",
    "Model server and WhatsApp/Messenger bridge in one command (macOS/Linux, needs llama.cpp and Python 3.10+):",
    "",
    "```bash",
    installerCommand(modelSize(llm), { tunnel: true }),
    "```",
    "",
    "Or by hand:",
    "",
    "```bash",
    laptopCommands(llm),
    "```",
    "",
    "## WhatsApp (Twilio Sandbox) and Messenger",
    "",
    `1. Start the bridge (above) and a tunnel: \`cloudflared tunnel --url ${BRIDGE_URL.replace("127.0.0.1", "localhost")}\`. Put the https URL in .env as PUBLIC_BASE_URL.`,
    `2. WhatsApp: send \`join <code>\` to ${TWILIO_SANDBOX_NUMBER}; in the Twilio sandbox settings set "When a message comes in" to <PUBLIC_BASE_URL>/twilio/whatsapp (POST).`,
    "3. Messenger: Meta app with Messenger, callback URL <PUBLIC_BASE_URL>/messenger/webhook, verify token = META_VERIFY_TOKEN, subscribe to messages.",
    "",
    "## Models",
    "",
    ...manifest.models.map((m) => `- ${m.id}: ${m.file} (${m.size_mb} MB, ${m.license}, ${m.runtime})${m.sha256 ? `, sha256 ${m.sha256}` : ""}\n  ${m.url}`),
    "",
    "## Nodes",
    "",
    ...g.nodes.map((n) => `- ${n.id} (${n.type}): ${n.label}${n.online ? " [online]" : " [offline]"}`),
    "",
    "## What stays on the device",
    "",
    "Everything. Notes are stored locally behind a PIN; nothing is sent unless a node is marked online and the nurse taps send.",
    "",
    `Built with Lokol Studio, ${manifest.created_at ?? ""}.`
  ];
  return lines.join("\n");
}

export async function packZip(manifest: Manifest): Promise<Blob> {
  const zip = new JSZip();
  const url = installUrl(manifest);
  const qr = await qrDataUrl(url);
  const png = qr.split(",")[1];
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  zip.file("README.md", readme(manifest));
  zip.file("qr.png", png, { base64: true });
  zip.file("install-url.txt", url);
  return zip.generateAsync({ type: "blob" });
}

export function download(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

/** The offline 9B on a 16 GB laptop: base Qwen3.5-9B with the Lokol Health LoRA. */
export const LAPTOP_9B_COMMAND = "llama-server -m Qwen3.5-9B-Q4_K_M.gguf --lora lokol-health-9b-lora-f16.gguf --jinja -c 4096";

const SECTOR_KEYS = new Set(["health", "agriculture", "tourism"]);

/**
 * Which pack Deploy launches, from the Studio's pack key: a saved pack ("idb:<id>") keeps its id so
 * the field app opens that exact pack (with its guideline index); a sector preset keeps its sector id;
 * an export keeps its pack_id; anything else is named after the graph.
 */
export function deployTarget(packKey: string | null | undefined, graph: Graph): { pack_id: string; idb: boolean } {
  const k = packKey ?? "";
  if (k.startsWith("idb:") && k.length > 4) return { pack_id: k.slice(4), idb: true };
  if (k.startsWith("export:") && k.length > 7) return { pack_id: k.slice(7), idb: false };
  if (SECTOR_KEYS.has(k)) return { pack_id: k, idb: false };
  return { pack_id: slug(graph.name), idb: false };
}

/** Field-app route for a deploy target: a saved pack opens by id, everything else runs the graph itself. */
export function fieldAppRoute(target: { pack_id: string; idb: boolean }): string {
  return target.idb ? `/demo?pack=${encodeURIComponent(`idb:${target.pack_id}`)}` : "/demo";
}
