// The Demo page's sample prompts must route to the right STM section and the right gate outcome.
import { describe, expect, it } from "vitest";
import corpus from "../../public/packs/health/corpus.json";
import { BM25Index } from "./rag";
import { detectRedFlags, gate, parseReply, stripNegated } from "./gate";
import { buildQwenPrompt, stripThink } from "./llm";
import { candidates } from "./engine";

const idx = new BM25Index(corpus as any);
const top = (q: string) => idx.searchDetailed(stripNegated(q), 3).hits[0];

describe("demo samples", () => {
  it("negated danger signs are not red flags", () => {
    expect(detectRedFlags("Pikinini 3 yia, hot bodi tu dei, no kaikai gud. No fit.")).toEqual([]);
    expect(detectRedFlags("Visit note: no danger signs, RDT positive").length).toBe(0);
    expect(detectRedFlags("Bebi 8 manis, hot bodi an hem sek-sek tude moning, slip tumas nao.").map((h) => h.id)).toEqual(["convulsions", "lethargic"]);
  });

  it("Pijin fever routes to FEVER or MALARIA with support", () => {
    const h = top("Pikinini 3 yia, hot bodi tu dei, no kaikai gud. No fit. Wanem mi duim?");
    expect(["FEVER", "MALARIA"]).toContain(h.section);
    expect(BM25Index.supports(h)).toBe(true);
  });

  it("English fever without test kits routes to MALARIA or FEVER with support", () => {
    const h = top("Girl 4 years, fever since yesterday, weight 15 kg. We have no malaria test kits left.");
    expect(["FEVER", "MALARIA"]).toContain(h.section);
    expect(BM25Index.supports(h)).toBe(true);
  });

  it("diarrhoea routes to DIARRHOEA", () => {
    expect(top("Child 18 months, watery diarrhoea for 3 days, still drinking and playing.").section).toBe("DIARRHOEA");
  });

  it("adult case abstains even if the model says ADVISE", () => {
    const reply = parseReply("ACTION: ADVISE\nSTM: DRUG DOSING TABLE\n---\nGive aspirin 300 mg.");
    const g = gate("Adult man, 45, chest pain since this morning. What dose of aspirin should I give?", reply, { flags: { lang: "en", rdt: "yes", act: "yes", transport: "now" }, guideline: top("adult chest pain aspirin") });
    expect(g.action).toBe("ASK_PERSON");
  });
});

describe("prompt + model chain", () => {
  it("builds the Qwen3 ChatML prompt with thinking disabled", () => {
    expect(buildQwenPrompt("S", "U")).toBe("<|im_start|>system\nS<|im_end|>\n<|im_start|>user\nU<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n");
  });

  it("strips think blocks, open or closed", () => {
    expect(stripThink("<think>hmm</think>\n\nACTION: ADVISE")).toBe("ACTION: ADVISE");
    expect(stripThink("ACTION: ADVISE\n<think>still going")).toBe("ACTION: ADVISE\n");
    expect(stripThink("ACTION: ADVISE<|im_end|>junk")).toBe("ACTION: ADVISE");
  });

  it("tuned 0.6B chain: Hub, local dev copy, tuned 0.8B, then the untuned base", () => {
    const list = candidates("llm", { id: "lokol-health-qwen3-0.6b", file: "x.gguf", url: "https://huggingface.co/VictorChenCA/lokol-health-qwen3-0.6b-gguf/resolve/main/lokol-health-qwen3-0.6b-Q4_K_M.gguf", size_mb: 397, license: "Apache-2.0", runtime: "wllama" });
    expect(list.map((m) => m.url).slice(0, 5)).toEqual([
      "https://huggingface.co/VictorChenCA/lokol-health-qwen3-0.6b-gguf/resolve/main/lokol-health-qwen3-0.6b-Q4_K_M.gguf",
      "/local-models/lokol-health-qwen3-0.6b-Q4_K_M.gguf",
      "https://huggingface.co/VictorChenCA/lokol-health-0.8b-gguf/resolve/main/lokol-health-0.8b-Q4_K_M.gguf",
      "/local-models/lokol-health-0.8b-Q4_K_M.gguf",
      "https://huggingface.co/ggml-org/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q4_0.gguf"
    ]);
    expect(list[4].tuned).toBe(false);
  });

  it("laptop-only models are skipped in the browser", () => {
    const notes: string[] = [];
    const list = candidates("llm", { id: "lokol-health-qwen3.5-9b", file: "9b.gguf", url: "https://example/9b.gguf", size_mb: 5500, license: "Apache-2.0", runtime: "llama-server" }, notes);
    expect(list[0].id).toBe("qwen3-0.6b-base");
    expect(notes[0]).toMatch(/laptop/);
  });
});
