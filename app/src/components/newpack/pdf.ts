// PDF -> text in the browser with pdfjs-dist (no server). Pages are joined with form feeds so
// corpus_builder.splitPages keeps page numbers. Lines are rebuilt from text-item y positions.
export async function pdfToText(file: File, onPage?: (n: number, total: number) => void): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const lines: string[] = [];
    let y: number | null = null;
    let line = "";
    for (const it of content.items as { str: string; transform: number[]; hasEOL?: boolean }[]) {
      const iy = Math.round(it.transform?.[5] ?? 0);
      if (y !== null && Math.abs(iy - y) > 2) {
        lines.push(line.trim());
        line = "";
      }
      y = iy;
      line += (line && !line.endsWith(" ") ? " " : "") + it.str;
      if (it.hasEOL) {
        lines.push(line.trim());
        line = "";
        y = null;
      }
    }
    if (line.trim()) lines.push(line.trim());
    pages.push(lines.filter(Boolean).join("\n"));
    onPage?.(i, doc.numPages);
    page.cleanup();
  }
  await doc.destroy();
  return pages.join("\f");
}

/** The Solomon Islands STM for Children, rebuilt as text (headings + form-feed pages) from the hosted corpus. */
export async function stmSampleText(): Promise<string> {
  const r = await fetch("/packs/health/corpus.json");
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const corpus = (await r.json()) as { chunks: { section: string; subsection?: string; page: number; text: string }[] };
  const byPage = new Map<number, string[]>();
  let last = "";
  for (const c of corpus.chunks) {
    const arr = byPage.get(c.page) ?? [];
    if (c.section !== last) arr.push(c.section.toUpperCase());
    last = c.section;
    arr.push(c.text);
    byPage.set(c.page, arr);
  }
  const max = Math.max(...byPage.keys());
  const pages: string[] = [];
  for (let p = 1; p <= max; p++) pages.push((byPage.get(p) ?? [" "]).join("\n"));
  return pages.join("\f");
}
