import { describe, it, expect } from "vitest";
import { recommend, tierFor, searchDevices } from "./recommend";
import devicesJson from "./data/devices.json";
import type { Device } from "./types";

const devices = devicesJson.devices as Device[];

describe("tierFor", () => {
  it("maps RAM to tiers", () => {
    expect(tierFor(2)).toBe("A");
    expect(tierFor(3)).toBe("B");
    expect(tierFor(4)).toBe("B");
    expect(tierFor(6)).toBe("C");
    expect(tierFor(8)).toBe("C");
    expect(tierFor(16)).toBe("D");
    expect(tierFor(8, true)).toBe("D");
  });
});

describe("recommend", () => {
  it("2 GB phone, offline, Pijin + English, voice both ways", () => {
    const r = recommend({
      sector: "health",
      languages: ["pis", "en"],
      voiceIn: true,
      voiceOut: true,
      connectivity: "none",
      deviceName: "Samsung Galaxy A02",
      ram_gb: 2,
      storage_gb: 32
    });
    expect(r.tier).toBe("A");
    const llm = r.graph.nodes.find((n) => n.type === "llm")!;
    expect(llm.model?.id).toBe("lokol-health-qwen3-0.6b");
    expect(r.graph.nodes.every((n) => n.online === false)).toBe(true);
    expect(r.willNotWork.join(" ")).toMatch(/Pijin voice-in/);
    // a 2 GB phone keeps Pijin voice-out and drops the bigger English voices to fit memory
    expect(r.graph.nodes.filter((n) => n.type === "tts").map((n) => n.model?.id)).toEqual(["mms-tts-pis"]);
    expect(r.willNotWork.join(" ")).toMatch(/English voice-out/);
    expect(r.ramMb).toBeLessThanOrEqual(r.usableRamMb);
    expect(r.graph.edges.length).toBeGreaterThan(5);
  });

  it("8 GB phone, online, English only", () => {
    const r = recommend({
      sector: "health",
      languages: ["en"],
      voiceIn: true,
      voiceOut: true,
      connectivity: "online",
      deviceName: "Samsung Galaxy A54",
      ram_gb: 8,
      storage_gb: 128
    });
    expect(r.tier).toBe("C");
    const llm = r.graph.nodes.find((n) => n.type === "llm")!;
    expect(llm.model?.id).toBe("lokol-health-qwen3-1.7b");
    expect(llm.online).toBe(true);
    expect(r.graph.nodes.find((n) => n.type === "channel")?.online).toBe(true);
    expect(r.willNotWork.some((w) => /Pijin voice-in/.test(w))).toBe(false);
  });

  it("laptop gets 9B and Pijin speech-in", () => {
    const r = recommend({
      sector: "health",
      languages: ["pis"],
      voiceIn: true,
      voiceOut: false,
      connectivity: "intermittent",
      deviceName: "Clinic PC",
      ram_gb: 16,
      storage_gb: 512,
      isLaptop: true
    });
    expect(r.tier).toBe("D");
    expect(r.graph.nodes.find((n) => n.type === "llm")?.model?.id).toBe("lokol-health-qwen3.5-9b");
    expect(r.graph.nodes.some((n) => n.model?.id === "omnilingual-ctc-300m-pis")).toBe(true);
  });

  it("steps the model down when storage is tight", () => {
    const r = recommend({
      sector: "health",
      languages: ["en"],
      voiceIn: false,
      voiceOut: false,
      connectivity: "none",
      deviceName: "Itel A23 Pro",
      ram_gb: 6,
      storage_gb: 4
    });
    expect(r.graph.nodes.find((n) => n.type === "llm")?.model?.id).toBe("lokol-health-qwen3-0.6b");
    expect(r.reasons.join(" ")).toMatch(/steps down/);
  });

  it("non-health sectors get an honest note", () => {
    const r = recommend({
      sector: "agriculture",
      languages: ["en"],
      voiceIn: false,
      voiceOut: false,
      connectivity: "none",
      deviceName: "x",
      ram_gb: 4,
      storage_gb: 64
    });
    expect(r.willNotWork.join(" ")).toMatch(/no tuned model/);
    expect(r.graph.nodes.find((n) => n.type === "llm")?.model?.id).toMatch(/-base$/);
  });

  it("3 GB phone steps the 1.7B down to 0.6B to fit memory", () => {
    const r = recommend({
      sector: "health",
      languages: ["pis", "en"],
      voiceIn: true,
      voiceOut: true,
      connectivity: "none",
      deviceName: "Samsung Galaxy A12",
      ram_gb: 3,
      storage_gb: 32
    });
    expect(r.tier).toBe("B");
    expect(r.graph.nodes.find((n) => n.type === "llm")?.model?.id).toBe("lokol-health-qwen3-0.6b");
    expect(r.reasons.join(" ")).toMatch(/Memory is tight/);
  });

  it("6 GB+ phone with Pijin voice-in gets approximate Whisper base, labelled honestly", () => {
    const r = recommend({ sector: "health", languages: ["pis", "en"], voiceIn: true, voiceOut: true, connectivity: "none", deviceName: "Samsung Galaxy A54", ram_gb: 8, storage_gb: 128 });
    expect(r.tier).toBe("C");
    const pis = r.graph.nodes.find((n) => n.type === "stt" && n.params.lang === "pis");
    expect(pis?.model?.id).toBe("whisper-base");
    expect(pis?.label).toMatch(/approximate/);
    expect(r.reasons.join(" ")).toMatch(/approximate/);
    expect(r.willNotWork.some((w) => /^Pijin voice-in: the smallest/.test(w))).toBe(false);
  });

  it("lays nodes out in stage columns", () => {
    const r = recommend({ sector: "health", languages: ["en"], voiceIn: true, voiceOut: true, connectivity: "none", deviceName: "x", ram_gb: 8, storage_gb: 128 });
    const x = (t: string) => r.graph.nodes.find((n) => n.type === t)!.position.x;
    expect(x("stt")).toBeLessThan(x("rag"));
    expect(x("rag")).toBeLessThan(x("llm"));
    expect(x("llm")).toBeLessThan(x("gate"));
    expect(x("gate")).toBeLessThan(x("tts"));
  });
});

describe("searchDevices", () => {
  it("finds by brand and model fragments", () => {
    const hits = searchDevices(devices, "redmi 9a");
    expect(hits[0].model).toBe("Redmi 9A");
    expect(searchDevices(devices, "galaxy a0").length).toBeGreaterThan(3);
  });
});
