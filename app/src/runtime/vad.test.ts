import { describe, it, expect } from "vitest";
import { EnergyVad, rms, downsample, pcmToWav, concat, VAD_DEFAULTS } from "./vad";

const FRAME_MS = 30;
const tone = (amp: number, n = 480) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * 220 * i) / 16000));
/** Feed a sequence of [level frame, count] and collect events with the frame index they fired on. */
function run(vad: EnergyVad, seq: [Float32Array, number][]) {
  const events: { ev: string; at: number }[] = [];
  let i = 0;
  for (const [buf, count] of seq) {
    for (let k = 0; k < count; k++, i++) {
      const ev = vad.push(rms(buf), FRAME_MS);
      if (ev) events.push({ ev, at: i });
    }
  }
  return events;
}

describe("rms", () => {
  it("is 0 for silence and amp/sqrt(2) for a sine", () => {
    expect(rms(new Float32Array(480))).toBe(0);
    expect(rms(tone(0.5, 16000))).toBeCloseTo(0.5 / Math.SQRT2, 2);
    expect(rms([])).toBe(0);
  });
});

describe("EnergyVad", () => {
  const silence = new Float32Array(480);
  const speech = tone(0.2);
  const noise = tone(0.01);

  it("uses the spec defaults: 200 ms start, 900 ms silence, 20 s cap", () => {
    expect(VAD_DEFAULTS.startMs).toBe(200);
    expect(VAD_DEFAULTS.silenceMs).toBe(900);
    expect(VAD_DEFAULTS.maxMs).toBe(20000);
  });

  it("ignores silence and quiet room noise", () => {
    const vad = new EnergyVad();
    expect(run(vad, [[silence, 100], [noise, 100]])).toEqual([]);
    expect(vad.state).toBe("idle");
  });

  it("does not start on a short click (under 200 ms)", () => {
    const vad = new EnergyVad();
    expect(run(vad, [[speech, 5], [silence, 20], [speech, 3], [silence, 20]])).toEqual([]);
  });

  it("starts after ~200 ms of speech and ends after ~900 ms of silence", () => {
    const vad = new EnergyVad();
    const ev = run(vad, [[silence, 10], [speech, 50], [silence, 40]]);
    expect(ev[0]).toEqual({ ev: "start", at: 10 + Math.ceil(200 / FRAME_MS) - 1 });
    expect(ev[1]).toEqual({ ev: "end", at: 60 + Math.ceil(900 / FRAME_MS) - 1 });
    expect(vad.state).toBe("done");
  });

  it("a short pause inside speech does not end the utterance", () => {
    const vad = new EnergyVad();
    const ev = run(vad, [[speech, 20], [silence, 20], [speech, 20], [silence, 40]]);
    expect(ev.map((e) => e.ev)).toEqual(["start", "end"]);
    expect(ev[1].at).toBeGreaterThan(60);
  });

  it("stops at the 20 s cap when the speaker never pauses", () => {
    const vad = new EnergyVad();
    const ev = run(vad, [[speech, 1000]]);
    expect(ev.map((e) => e.ev)).toEqual(["start", "timeout"]);
    expect(ev[1].at * FRAME_MS).toBeGreaterThanOrEqual(20000 - FRAME_MS * 2);
    expect(ev[1].at * FRAME_MS).toBeLessThanOrEqual(20000 + FRAME_MS);
  });

  it("emits nothing after done, and reset() listens again", () => {
    const vad = new EnergyVad();
    run(vad, [[speech, 20], [silence, 40]]);
    expect(run(vad, [[speech, 20]])).toEqual([]);
    vad.reset();
    expect(run(vad, [[speech, 10]]).map((e) => e.ev)).toEqual(["start"]);
  });

  it("respects a custom threshold", () => {
    const vad = new EnergyVad({ threshold: 0.5 });
    expect(run(vad, [[speech, 50]])).toEqual([]);
  });
});

describe("downsample / wav", () => {
  it("48 kHz to 16 kHz keeps duration and level", () => {
    const s = Float32Array.from({ length: 48000 }, (_, i) => 0.3 * Math.sin((2 * Math.PI * 200 * i) / 48000));
    const d = downsample(s, 48000, 16000);
    expect(d.length).toBe(16000);
    expect(rms(d)).toBeCloseTo(rms(s), 1);
  });

  it("passes 16 kHz through and upsamples 8 kHz", () => {
    expect(downsample(new Float32Array(160), 16000).length).toBe(160);
    expect(downsample(new Float32Array(80), 8000).length).toBe(160);
  });

  it("concat joins chunks in order", () => {
    expect(Array.from(concat([Float32Array.of(1, 2), Float32Array.of(3)]))).toEqual([1, 2, 3]);
  });

  it("writes a valid 16-bit mono WAV header", async () => {
    const b = pcmToWav(new Float32Array(16000), 16000);
    expect(b.size).toBe(44 + 32000);
    const v = new DataView(await b.arrayBuffer());
    expect(String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3))).toBe("RIFF");
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getUint16(34, true)).toBe(16);
  });
});
