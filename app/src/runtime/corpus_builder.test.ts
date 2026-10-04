import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { chunkPages, chunkText, headingOf, mergeWithNext, splitPages, toCorpus, savePack, getPack, listPacks } from "./corpus_builder";
import { BM25Index } from "./rag";
import { COFFEE_SAMPLE } from "../components/newpack/samples";

const STM = resolve(__dirname, "../../../data/raw/SI_Standard_Treatment_Manual_for_Children_2017.txt");

describe("headingOf", () => {
  it("detects markdown, numbered and ALL-CAPS headings", () => {
    expect(headingOf("## Treatment and spraying")).toBe("Treatment and spraying");
    expect(headingOf("3.2 Fever in young infants")).toBe("3.2 Fever in young infants");
    expect(headingOf("   MALARIA   ")).toBe("MALARIA");
    expect(headingOf("BURNS AND SCALDS")).toBe("BURNS AND SCALDS");
  });
  it("ignores body text, short acronyms and sentences", () => {
    expect(headingOf("Give ORS 75 ml per kg over 4 hours.")).toBeNull();
    expect(headingOf("ORS")).toBeNull();
    expect(headingOf("NOTE: GIVE THE FIRST DOSE IN THE CLINIC AND WATCH THE CHILD FOR THIRTY MINUTES.")).toBeNull();
    expect(headingOf("1. Give paracetamol.")).toBeNull();
  });
});

describe("chunking a markdown leaflet", () => {
  const chunks = chunkText(COFFEE_SAMPLE, { idPrefix: "coffee" });
  it("keeps the section titles", () => {
    const titles = chunks.map((c) => c.title).join(" | ");
    expect(titles).toMatch(/Recognising leaf rust/);
    expect(titles).toMatch(/Treatment and spraying/);
    expect(chunks.every((c) => c.words <= 400)).toBe(true);
    expect(chunks[0].id).toBe("coffee-001");
  });
  it("indexes with the existing BM25 and retrieves the uploaded text", () => {
    const corpus = toCorpus(chunks, "coffee-sample");
    const idx = new BM25Index(corpus);
    const hit = idx.searchDetailed("how much copper fungicide do I spray on the leaves", 3).hits[0];
    expect(hit.text).toMatch(/copper oxychloride/);
    expect(corpus.sections.length).toBeGreaterThan(1);
  });
  it("merge with next joins text and page range", () => {
    const m = mergeWithNext(chunks, 0);
    expect(m.length).toBe(chunks.length - 1);
    expect(m[0].text).toContain(chunks[1].text.slice(0, 20));
  });
});

describe.skipIf(!existsSync(STM))("chunking the Solomon Islands STM for Children (local, gitignored)", () => {
  const text = readFileSync(STM, "utf8");
  const pages = splitPages(text);
  const sample = pages.filter((p) => p.page >= 40 && p.page <= 70);
  const chunks = chunkPages(sample, { idPrefix: "stm" });
  it("splits pages on form feeds", () => {
    expect(pages.length).toBeGreaterThan(100);
  });
  it("produces heading-titled chunks of 150-400 words with page numbers", () => {
    expect(chunks.length).toBeGreaterThan(10);
    expect(chunks.every((c) => c.words <= 400)).toBe(true);
    const inRange = chunks.filter((c) => c.words >= 150).length / chunks.length;
    expect(inRange).toBeGreaterThan(0.6);
    expect(chunks.every((c) => c.page >= 40 && c.page_end <= 70 && c.page <= c.page_end)).toBe(true);
    expect(chunks.every((c) => c.title.length > 0)).toBe(true);
  });
  it("the whole manual chunks and retrieves malaria guidance", () => {
    const all = toCorpus(chunkPages(pages, { idPrefix: "stm" }), "stm");
    const idx = new BM25Index(all);
    const hit = idx.searchDetailed("child fever RDT positive artemether lumefantrine dose", 3).hits[0];
    expect(`${hit.section} ${hit.text}`.toLowerCase()).toMatch(/malaria|artemether/);
  });
});

describe("saved packs", () => {
  it("round-trips through the store (memory fallback in node)", async () => {
    await savePack({ id: "t1", name: "Test", created_at: "2026-10-04T00:00:00Z", manifest: { pack_id: "t1" } });
    expect((await getPack("t1"))?.name).toBe("Test");
    expect((await listPacks()).some((p) => p.id === "t1")).toBe(true);
  });
});
