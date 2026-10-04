import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { buildManifest, packZip, readme, installUrl, manifestUrl, packLlm, laptopCommands, isHosted, ollamaCommand, installerCommand, modelSize } from "./pack";
import { HEALTH_GRAPH } from "./data/presets";

describe("pack export", () => {
  it("builds a manifest with de-duplicated models and a zip with manifest, README and QR", async () => {
    const m = buildManifest(HEALTH_GRAPH, "https://lokol.vercel.app");
    expect(m.graph.nodes.length).toBe(HEALTH_GRAPH.nodes.length);
    const expected = [...new Set(HEALTH_GRAPH.nodes.filter((n) => n.model).map((n) => n.model!.id))];
    expect(m.models.map((x) => x.id)).toEqual(expected);
    expect(new Set(m.models.map((x) => x.id)).size).toBe(m.models.length);
    expect(installUrl(m)).toMatch(/^https:\/\/lokol\.vercel\.app\/demo\?pack=/);
    expect(readme(m)).toMatch(/Install on a phone/);
    expect(readme(m)).toMatch(/llama-server -m models\/gguf\//);
    const blob = await packZip(m);
    expect(blob.size).toBeGreaterThan(1000);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(Object.keys(zip.files).sort()).toEqual(["README.md", "install-url.txt", "manifest.json", "qr.png"]);
    const parsed = JSON.parse(await zip.file("manifest.json")!.async("string"));
    expect(parsed.pwa_url).toBe("https://lokol.vercel.app");
    expect(parsed.graph.version).toBe(1);
  });

  it("points the health preset at the manifest published with the app", () => {
    const m = buildManifest(HEALTH_GRAPH, "https://lokol.vercel.app", "health");
    expect(isHosted(m)).toBe(true);
    expect(manifestUrl(m)).toBe("https://lokol.vercel.app/packs/health/manifest.json");
    expect(decodeURIComponent(installUrl(m))).toBe("https://lokol.vercel.app/demo?pack=https://lokol.vercel.app/packs/health/manifest.json");
  });

  it("writes laptop commands for the pack's language model", () => {
    const m = buildManifest(HEALTH_GRAPH, "https://lokol.vercel.app");
    const llm = packLlm(m);
    expect(llm?.file).toMatch(/\.gguf$/);
    const cmds = laptopCommands(llm);
    expect(cmds).toContain(`llama-server -m models/gguf/${llm!.file} --port 8080`);
    expect(cmds).toContain(".venv/bin/python -m bridge.server --port 8090");
    expect(cmds).toContain(".venv/bin/python sidecar/server.py");
  });

  it("writes the one-line deploy commands (Ollama from Hugging Face, laptop installer)", () => {
    const m = buildManifest(HEALTH_GRAPH, "https://lokol.vercel.app");
    const llm = packLlm(m);
    expect(ollamaCommand(llm)).toMatch(/^ollama run hf\.co\/VictorChenCA\/lokol-health-qwen3-[\d.]+b-gguf$/);
    expect(ollamaCommand({ url: "https://huggingface.co/VictorChenCA/lokol-health-qwen3-1.7b-gguf/resolve/main/x.gguf" })).toBe("ollama run hf.co/VictorChenCA/lokol-health-qwen3-1.7b-gguf");
    expect(modelSize({ file: "lokol-health-qwen3-0.6b-Q4_K_M.gguf" })).toBe("0.6b");
    expect(modelSize({ file: "lokol-health-qwen3-1.7b-Q4_K_M.gguf" })).toBe("1.7b");
    expect(installerCommand("0.6b", { voice: true, tunnel: true })).toBe(
      "curl -fsSL https://raw.githubusercontent.com/VictorChenCA/lokol/main/deploy/lokol-laptop.sh | bash -s -- --model 0.6b --voice --tunnel"
    );
    expect(readme(m)).toContain(ollamaCommand(llm));
    expect(readme(m)).toContain("deploy/lokol-laptop.sh | bash -s -- --model");
  });
});

describe("buildManifest with voice switched off", () => {
  it("drops disabled speech nodes and their models", () => {
    const g = { ...HEALTH_GRAPH, nodes: HEALTH_GRAPH.nodes.map((n) => (n.type === "stt" || n.type === "tts" ? { ...n, params: { ...n.params, enabled: false } } : n)) };
    const m = buildManifest(g, "https://lokol.vercel.app");
    expect(m.graph.nodes.some((n) => n.type === "stt" || n.type === "tts")).toBe(false);
    const speechIds = new Set(HEALTH_GRAPH.nodes.filter((n) => (n.type === "stt" || n.type === "tts") && n.model).map((n) => n.model!.id));
    const kept = new Set(m.graph.nodes.filter((n) => n.model).map((n) => n.model!.id));
    expect(m.models.every((x) => kept.has(x.id))).toBe(true);
    for (const id of speechIds) if (!kept.has(id)) expect(m.models.some((x) => x.id === id)).toBe(false);
  });
});
