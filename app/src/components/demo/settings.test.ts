import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, SETTINGS_KEY, detectLang, loadSettings, normalizeSettings, replyLangFor, saveSettings, voiceFor } from "./settings";
import { SAMPLES } from "./copy";
import { detectRedFlags } from "../../runtime/gate";

function memStore(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

describe("field settings", () => {
  it("defaults: speech in and read aloud on, English voice-in, 0.6B", () => {
    const s = loadSettings(memStore());
    expect(s).toEqual(DEFAULT_SETTINGS);
    expect(s.speechIn && s.readAloud).toBe(true);
  });

  it("round-trips through storage", () => {
    const st = memStore();
    const next = { ...DEFAULT_SETTINGS, speechIn: false, readAloud: false, voice: "pis" as const, size: "1.7b" as const, rdt: "no" as const, transport: "none" as const };
    saveSettings(next, st);
    expect(JSON.parse(st.m.get(SETTINGS_KEY)!)).toEqual(next);
    expect(loadSettings(st)).toEqual(next);
  });

  it("repairs bad or partial stored values field by field", () => {
    const st = memStore({ [SETTINGS_KEY]: JSON.stringify({ speechIn: "yes", readAloud: false, size: "9b", rdt: "maybe" }) });
    const s = loadSettings(st);
    expect(s.speechIn).toBe(true);
    expect(s.readAloud).toBe(false);
    expect(s.size).toBe("0.6b");
    expect(s.rdt).toBe("yes");
  });

  it("survives broken JSON and blocked storage", () => {
    expect(loadSettings(memStore({ [SETTINGS_KEY]: "{oops" }))).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
    const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(loadSettings(throwing)).toEqual(DEFAULT_SETTINGS);
    expect(() => saveSettings(DEFAULT_SETTINGS, throwing)).not.toThrow();
  });

  it("keeps the old voice-input choice", () => {
    expect(loadSettings(memStore({ "lokol.voiceIn": "pis-approx" })).voiceIn).toBe("pis-approx");
    expect(normalizeSettings({ voiceIn: "en" }, "pis-approx").voiceIn).toBe("en");
  });
});

describe("reply language", () => {
  it("detects Pijin and English", () => {
    expect(detectLang("Pikinini 3 yia, hot bodi tu dei, no kaikai gud. No fit. Wanem mi duim?")).toBe("pis");
    expect(detectLang("Bebi 8 manis, hot bodi an hem sek-sek tude moning")).toBe("pis");
    expect(detectLang("Baby 8 months, fever and a fit this morning, now very sleepy.")).toBe("en");
    expect(detectLang("Adult man, 45, chest pain since this morning. What dose of aspirin should I give?")).toBe("en");
  });

  it("follows the setting when it is not auto", () => {
    expect(replyLangFor("Child 3 years, fever", "pis")).toBe("pis");
    expect(replyLangFor("Pikinini hem sik tumas", "auto")).toBe("pis");
    expect(voiceFor("pis", "auto")).toBe("pis");
    expect(voiceFor("pis", "en")).toBe("en");
  });

  it("sample prompts are English and hit the intended gate path", () => {
    expect(SAMPLES).toHaveLength(3);
    for (const s of SAMPLES) expect(detectLang(s.text)).toBe("en");
    const [fever, fit, adult] = SAMPLES;
    expect(detectRedFlags(fever.text)).toEqual([]);
    expect(detectRedFlags(fit.text).map((h) => h.id)).toContain("convulsions");
    expect(adult.tone).toBe("ASK_PERSON");
  });
});
