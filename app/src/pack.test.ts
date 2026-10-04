import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { buildManifest, packZip, readme, installUrl } from "./pack";
import { HEALTH_GRAPH } from "./data/presets";

describe("pack export", () => {
  it("builds a manifest with de-duplicated models and a zip with manifest, README and QR", async () => {
    const m = buildManifest(HEALTH_GRAPH, "https://lokol.vercel.app");
    expect(m.graph.nodes.length).toBe(HEALTH_GRAPH.nodes.length);
    expect(m.models.map((x) => x.id)).toEqual(["moonshine-tiny", "stm-children-2017-bm25", "lokol-health-2b", "mms-tts-pis"]);
    expect(installUrl(m)).toMatch(/^https:\/\/lokol\.vercel\.app\/demo\?pack=/);
    expect(readme(m)).toMatch(/Install on a phone/);
    const blob = await packZip(m);
    expect(blob.size).toBeGreaterThan(1000);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(Object.keys(zip.files).sort()).toEqual(["README.md", "install-url.txt", "manifest.json", "qr.png"]);
    const parsed = JSON.parse(await zip.file("manifest.json")!.async("string"));
    expect(parsed.pwa_url).toBe("https://lokol.vercel.app");
    expect(parsed.graph.version).toBe(1);
  });
});
