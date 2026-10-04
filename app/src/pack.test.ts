import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { buildManifest, packZip, readme, installUrl, manifestUrl, packLlm, laptopCommands, isHosted } from "./pack";
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
});
