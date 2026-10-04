// Build a Lokol guideline corpus from any manual: pages of text -> heading-aware sections ->
// 150-400 word chunks -> CorpusFile (the same shape packs/health/corpus.json uses), so the
// existing BM25Index in rag.ts indexes it unchanged. Pure functions; no DOM, no network.
import type { Chunk, CorpusFile, SectionInfo } from './types';

export interface PageText { page: number; text: string }
export interface DraftChunk { id: string; title: string; page: number; page_end: number; text: string; words: number }
export interface ChunkOptions { min?: number; max?: number; idPrefix?: string }

/** Split extracted text into pages on form feeds (pdftotext and our PDF extractor both emit them). */
export function splitPages(text: string): PageText[] {
  const parts = text.replace(/\r\n?/g, '\n').split('\f');
  return parts.map((t, i) => ({ page: i + 1, text: t })).filter((p) => p.text.trim().length > 0);
}

const MD_HEADING = /^#{1,6}\s+(.{2,100})$/;
const NUMBERED = /^(\d{1,2}(?:\.\d{1,2}){0,3})\.?\s+([A-Z][A-Za-z0-9 ,'()/&-]{2,80})$/;

/** Heading title for a line, or null. ALL-CAPS lines, numbered headings ("3.2 Fever"), markdown "#". */
export function headingOf(raw: string): string | null {
  const line = raw.replace(/\s+/g, ' ').trim();
  if (!line || line.length > 90) return null;
  const md = line.match(MD_HEADING);
  if (md) return md[1].replace(/#+\s*$/, '').trim();
  const num = line.match(NUMBERED);
  if (num && num[2].split(' ').length <= 9 && !/[.:;]$/.test(line)) return `${num[1]} ${num[2].trim()}`;
  const letters = line.replace(/[^A-Za-z]/g, '');
  if (letters.length < 4) return null;
  const upper = letters.replace(/[^A-Z]/g, '').length;
  const words = line.split(' ').length;
  if (upper / letters.length >= 0.9 && words <= 8 && !/[.,;:]$/.test(line) && !/^\d/.test(line)) return line;
  return null;
}

interface Word { w: string; page: number }
interface Section { title: string; words: Word[] }

function toSections(pages: PageText[]): Section[] {
  const sections: Section[] = [];
  let cur: Section = { title: 'Introduction', words: [] };
  let lastHeadingPage = -1;
  for (const p of pages) {
    for (const line of p.text.split('\n')) {
      const h = headingOf(line);
      if (h) {
        // consecutive heading lines (wrapped titles) join into one title
        if (cur.words.length === 0 && cur.title !== 'Introduction' && lastHeadingPage === p.page && cur.title.length + h.length < 80) {
          cur.title = `${cur.title} ${h}`;
          continue;
        }
        if (cur.words.length) sections.push(cur);
        cur = { title: h, words: [] };
        lastHeadingPage = p.page;
        continue;
      }
      for (const w of line.split(/\s+/)) if (w) cur.words.push({ w, page: p.page });
    }
  }
  if (cur.words.length) sections.push(cur);
  return sections;
}

/** Merge runs of short sections so every chunk carries enough text to retrieve on. */
function mergeShort(sections: Section[], min: number, max: number): Section[] {
  const out: Section[] = [];
  for (const s of sections) {
    const prev = out[out.length - 1];
    if (prev && (prev.words.length < min || s.words.length < min / 3) && prev.words.length + s.words.length <= max) {
      // keep the title of the bigger part; the other title stays readable inside the text
      const title = prev.words.length >= s.words.length ? prev.title : s.title;
      const inner: Word[] = prev.words.length >= s.words.length ? [{ w: `${s.title}:`, page: s.words[0]?.page ?? 1 }, ...s.words] : s.words;
      out[out.length - 1] = prev.words.length >= s.words.length
        ? { title, words: [...prev.words, ...inner] }
        : { title, words: [{ w: `${prev.title}:`, page: prev.words[0]?.page ?? 1 }, ...prev.words, ...s.words] };
    } else out.push({ title: s.title, words: [...s.words] });
  }
  return out;
}

/** Heading-aware chunking: sections by headings, each split evenly into pieces of at most `max` words. */
export function chunkPages(pages: PageText[], opts: ChunkOptions = {}): DraftChunk[] {
  const min = opts.min ?? 150;
  const max = opts.max ?? 400;
  const prefix = opts.idPrefix ?? 'pack';
  const raw = toSections(pages);
  // a short leaflet keeps one chunk per heading: the 150-word floor only applies to long manuals
  const total = raw.reduce((n, s) => n + s.words.length, 0);
  const sections = mergeShort(raw, Math.min(min, Math.max(30, Math.floor(total / 6))), max);
  const out: DraftChunk[] = [];
  for (const s of sections) {
    const n = Math.max(1, Math.ceil(s.words.length / max));
    const size = Math.ceil(s.words.length / n);
    for (let i = 0; i < n; i++) {
      const part = s.words.slice(i * size, (i + 1) * size);
      if (!part.length) continue;
      out.push({
        id: `${prefix}-${String(out.length + 1).padStart(3, '0')}`,
        title: n > 1 ? `${s.title}` : s.title,
        page: part[0].page,
        page_end: part[part.length - 1].page,
        text: part.map((x) => x.w).join(' '),
        words: part.length,
      });
    }
  }
  return out;
}

export function chunkText(text: string, opts: ChunkOptions = {}): DraftChunk[] {
  return chunkPages(splitPages(text), opts);
}

/** Merge chunk i with chunk i+1 (wizard "merge with next"). */
export function mergeWithNext(chunks: DraftChunk[], i: number): DraftChunk[] {
  if (i < 0 || i >= chunks.length - 1) return chunks;
  const a = chunks[i];
  const b = chunks[i + 1];
  const merged: DraftChunk = { ...a, page_end: Math.max(a.page_end, b.page_end), text: `${a.text} ${b.text}`, words: a.words + b.words };
  return [...chunks.slice(0, i), merged, ...chunks.slice(i + 2)];
}

export function toCorpus(chunks: DraftChunk[], source: string): CorpusFile {
  const out: Chunk[] = chunks.map((c, i) => ({
    id: c.id || `chunk-${i + 1}`,
    section: c.title.trim() || `Section ${i + 1}`,
    subsection: '',
    page: c.page,
    page_end: c.page_end,
    text: c.text,
    tokens: Math.round(c.words / 0.75),
  }));
  const secs = new Map<string, SectionInfo>();
  for (const c of out) {
    const s = secs.get(c.section);
    if (s) {
      s.chunks += 1;
      s.page_end = Math.max(s.page_end, c.page_end ?? c.page);
    } else secs.set(c.section, { title: c.section, page_start: c.page, page_end: c.page_end ?? c.page, chunks: 1 });
  }
  return { version: 1, source, generated_at: new Date().toISOString(), sections: [...secs.values()], chunks: out };
}

/* ---------- Saved packs (IndexedDB, with an in-memory fallback for tests / private windows) ---------- */

export interface SavedPack {
  id: string;
  name: string;
  created_at: string;
  manifest: Record<string, unknown>; // app Manifest + corpus_inline + pack config
}

const DB = 'lokol-packs';
const STORE = 'packs';
const memory = new Map<string, SavedPack>();

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T | null> {
  return openDb().then((db) => new Promise<T | null>((resolve) => {
    if (!db) return resolve(null);
    try {
      const r = fn(db.transaction(STORE, mode).objectStore(STORE));
      r.onsuccess = () => resolve(r.result as T);
      r.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  }));
}

export async function savePack(p: SavedPack): Promise<void> {
  memory.set(p.id, p);
  await tx('readwrite', (s) => s.put(p));
}

export async function listPacks(): Promise<SavedPack[]> {
  const rows = (await tx<SavedPack[]>('readonly', (s) => s.getAll())) ?? [...memory.values()];
  return rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function getPack(id: string): Promise<SavedPack | null> {
  return (await tx<SavedPack>('readonly', (s) => s.get(id))) ?? memory.get(id) ?? null;
}

export async function deletePack(id: string): Promise<void> {
  memory.delete(id);
  await tx('readwrite', (s) => s.delete(id));
}
