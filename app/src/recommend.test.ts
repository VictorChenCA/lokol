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
    expect(llm.model?.id).toBe("lokol-health-0.8b");
    expect(r.graph.nodes.every((n) => n.online === false)).toBe(true);
    expect(r.willNotWork.join(" ")).toMatch(/Pijin voice-in/);
    expect(r.graph.nodes.filter((n) => n.type === "stt").map((n) => n.model?.id)).toEqual(["moonshine-tiny"]);
    expect(r.graph.nodes.filter((n) => n.type === "tts").length).toBe(2);
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
    expect(llm.model?.id).toBe("lokol-health-4b");
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
    expect(r.graph.nodes.find((n) => n.type === "llm")?.model?.id).toBe("lokol-health-9b");
    expect(r.graph.nodes.some((n) => n.model?.id === "omnilingual-asr-ctc-300m")).toBe(true);
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
    expect(r.graph.nodes.find((n) => n.type === "llm")?.model?.id).toBe("lokol-health-0.8b");
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
  });
});

describe("searchDevices", () => {
  it("finds by brand and model fragments", () => {
    const hits = searchDevices(devices, "redmi 9a");
    expect(hits[0].model).toBe("Redmi 9A");
    expect(searchDevices(devices, "galaxy a0").length).toBeGreaterThan(3);
  });
});
