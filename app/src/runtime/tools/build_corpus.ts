// Builds app/public/packs/health/corpus.json for the in-browser BM25 index.
// Prefers the DATA lane's corpus/stm_children_chunks.jsonl (+ corpus/sections.json);
// falls back to a quick page-based chunking of the raw STM text when they do not exist yet.
//
// Run from the repo root:  bun app/src/runtime/tools/build_corpus.ts
//                     or:  npx tsx app/src/runtime/tools/build_corpus.ts
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../..');
const CHUNKS = resolve(ROOT, 'corpus/stm_children_chunks.jsonl');
const SECTIONS = resolve(ROOT, 'corpus/sections.json');
const RAW = resolve(ROOT, 'data/raw/SI_Standard_Treatment_Manual_for_Children_2017.txt');
const OUT = resolve(ROOT, 'app/public/packs/health/corpus.json');

interface Chunk { id: string; section: string; subsection: string; page: number; page_end?: number; text: string; tokens?: number }
interface SectionInfo { title: string; page_start: number; page_end: number; chunks: number }

function fromDataLane(): { chunks: Chunk[]; sections: SectionInfo[]; source: string } {
  const lines = readFileSync(CHUNKS, 'utf8').split('\n').filter((l) => l.trim());
  const chunks: Chunk[] = lines.map((l) => JSON.parse(l));
  let sections: SectionInfo[];
  if (existsSync(SECTIONS)) {
    sections = JSON.parse(readFileSync(SECTIONS, 'utf8'));
  } else {
    sections = deriveSections(chunks);
  }
  return { chunks, sections, source: 'corpus/stm_children_chunks.jsonl' };
}

function deriveSections(chunks: Chunk[]): SectionInfo[] {
  const map = new Map<string, SectionInfo>();
  for (const c of chunks) {
    const s = map.get(c.section);
    if (!s) map.set(c.section, { title: c.section, page_start: c.page, page_end: c.page_end ?? c.page, chunks: 1 });
    else {
      s.page_start = Math.min(s.page_start, c.page);
      s.page_end = Math.max(s.page_end, c.page_end ?? c.page);
      s.chunks++;
    }
  }
  return [...map.values()];
}

// Fallback: one chunk per page (split long pages in two), section = first ALL-CAPS centered line on the page.
function fromRawText(): { chunks: Chunk[]; sections: SectionInfo[]; source: string } {
  const text = readFileSync(RAW, 'utf8');
  const pages = text.split('\f');
  const chunks: Chunk[] = [];
  let section = 'FRONT MATTER';
  const headerRe = /Standard Treatment Manual for Children|4th Edition 2017/;
  for (let i = 0; i < pages.length; i++) {
    const pdfPage = i + 1;
    if (pdfPage < 8) continue; // front matter / contents
    const rawLines = pages[i].split('\n');
    const lines = rawLines
      .map((l) => l.replace(/\s+$/, ''))
      .filter((l) => !headerRe.test(l))
      .filter((l) => !/^\s*\d{1,3}\s*$/.test(l));
    // heading: an all-caps line with >= 4 letters near the top, leading whitespace (centered)
    for (const l of lines.slice(0, 6)) {
      const t = l.trim();
      if (t.length >= 4 && t.length <= 60 && /^[A-Z][A-Z0-9 ,&'()\/-]+$/.test(t) && /[A-Z]{3}/.test(t) && !/^(SIGNS|MANAGEMENT|INVESTIGATION|TREATMENT|CAUSES|NOTE)/.test(t)) {
        section = t.replace(/\s+/g, ' ');
        break;
      }
    }
    const body = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (body.split(/\s+/).length < 30) continue;
    const words = body.split(/\s+/);
    const parts = words.length > 450 ? [words.slice(0, Math.ceil(words.length / 2)).join(' '), words.slice(Math.ceil(words.length / 2)).join(' ')] : [body];
    parts.forEach((p, k) => {
      const slug = section.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      chunks.push({ id: `stm-c-${String(pdfPage - 2).padStart(3, '0')}-${slug}-${String(k + 1).padStart(2, '0')}`, section, subsection: '', page: pdfPage - 2, page_end: pdfPage - 2, text: p, tokens: Math.round(p.split(/\s+/).length * 1.4) });
    });
  }
  return { chunks, sections: deriveSections(chunks), source: 'data/raw (page-based fallback chunking)' };
}

const useData = existsSync(CHUNKS);
const { chunks, sections, source } = useData ? fromDataLane() : fromRawText();
const out = { version: 1, source, generated_at: new Date().toISOString(), sections, chunks };
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out));
const bytes = Buffer.byteLength(JSON.stringify(out));
console.log(`wrote ${OUT}: ${chunks.length} chunks, ${sections.length} sections, ${(bytes / 1024).toFixed(0)} KB, source=${source}`);
