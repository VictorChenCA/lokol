import { describe, it, expect } from "vitest";
import { CATALOG, MODELS, getModel, modelsFor, AVAILABILITY_LABEL } from "./models";

describe("model catalog integrity", () => {
  it("ids are unique", () => {
    const ids = CATALOG.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(CATALOG.map((m) => [m.id, m] as const))("%s has license, size, runtime, availability, tiers", (_id, m) => {
    expect(m.license.trim().length).toBeGreaterThan(1);
    expect(m.size_mb).toBeGreaterThan(0);
    expect(m.ram_mb).toBeGreaterThan(0);
    expect(m.size_label.length).toBeGreaterThan(0);
    expect(["wllama", "transformersjs", "llama-server", "river", "python", "js"]).toContain(m.runtime);
    expect(Object.keys(AVAILABILITY_LABEL)).toContain(m.availability);
    expect(m.tiers.length).toBeGreaterThan(0);
    expect(m.blurb.length).toBeGreaterThan(10);
    expect(m.url.length).toBeGreaterThan(0);
  });

  it("browser models run in a browser runtime; laptop runtimes are never marked browser", () => {
    for (const m of CATALOG) {
      if (m.availability === "browser") expect(["wllama", "transformersjs", "js"]).toContain(m.runtime);
      if (m.runtime === "llama-server" || m.runtime === "python") expect(m.availability).not.toBe("browser");
    }
  });

  it("approximate languages are also listed languages, and pis-approx entries say so in the blurb", () => {
    for (const m of CATALOG.filter((x) => x.approx_lang?.length)) {
      if (m.approx_lang!.includes("pis")) expect(m.blurb).toMatch(/approximate/i);
    }
    expect(getModel("whisper-base")?.approx_lang).toEqual(["pis"]);
    expect(getModel("whisper-base")?.availability).toBe("browser");
  });

  it("covers speech in, speech out and an audio LLM", () => {
    expect(modelsFor("stt").length).toBeGreaterThanOrEqual(6);
    expect(modelsFor("tts").length).toBeGreaterThanOrEqual(5);
    expect(CATALOG.some((m) => m.audio_llm)).toBe(true);
    expect(getModel("gemma-4-e2b-audio")?.availability).toBe("catalog only");
  });

  it("non-commercial licenses are visible (the Studio warns on /NC/)", () => {
    for (const id of ["mms-tts-pis", "mms-1b-all-pis", "piper-en-us-lessac"]) expect(getModel(id)?.license).toMatch(/NC/);
  });

  it("named handles resolve", () => {
    for (const r of Object.values(MODELS)) expect(getModel(r.id)).toBeTruthy();
    expect(MODELS.stt_pis_approx.id).toBe("whisper-base");
  });
});
