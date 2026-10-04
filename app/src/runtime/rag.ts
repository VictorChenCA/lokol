// BM25 retrieval over the STM chunks, with a small Pijin -> English synonym layer so a
// nurse's Pijin message ("hot bodi pikinini") still hits the English guideline text.
import type { Chunk, CorpusFile, SectionInfo } from './types';

// Pijin glossary tokens -> English query expansions (lowercase). Multi-word Pijin phrases are
// matched on the raw query before tokenization. Spelling variants are listed where common.
export const PIJIN_SYNONYMS: Record<string, string[]> = {
  'hot bodi': ['fever', 'temperature', 'malaria'],
  'hotbodi': ['fever', 'temperature'],
  'hot': ['fever'],
  'bodi': ['body'],
  'pikinini': ['child', 'children'],
  'pikinin': ['child', 'children'],
  'bebi': ['baby', 'infant'],
  'nubon': ['newborn', 'neonate'],
  'sik': ['sick', 'ill'],
  'siki': ['sick', 'ill'],
  'meresin': ['medicine', 'drug', 'dose'],
  'dokta': ['doctor'],
  'nes': ['nurse'],
  'klinik': ['clinic'],
  'hospitol': ['hospital', 'refer', 'referral'],
  'wata': ['water', 'fluids', 'ors'],
  'kaikai': ['food', 'feeding', 'eat', 'nutrition'],
  'susu': ['breast', 'breastfeeding', 'breastfeed', 'milk'],
  'toraot': ['vomit', 'vomiting'],
  'traot': ['vomit', 'vomiting'],
  'sitsit wata': ['diarrhoea', 'diarrhea', 'dehydration'],
  'sitsit': ['diarrhoea', 'diarrhea', 'stool'],
  'sit sit': ['diarrhoea', 'diarrhea'],
  'brit': ['breathe', 'breathing', 'respiratory', 'pneumonia'],
  'brit hariap': ['fast breathing', 'pneumonia', 'respiratory'],
  'win': ['breath', 'breathing', 'pneumonia', 'wheeze'],
  'fit': ['convulsion', 'convulsions', 'seizure', 'fits'],
  'sek-sek': ['convulsion', 'convulsions', 'seizure'],
  'seksek': ['convulsion', 'convulsions', 'seizure'],
  'sek sek': ['convulsion', 'convulsions', 'seizure'],
  'slip tumas': ['lethargic', 'lethargy', 'drowsy', 'unconscious'],
  'slip': ['lethargic', 'sleepy', 'drowsy'],
  'nek stif': ['stiff neck', 'meningitis'],
  'stif': ['stiff', 'meningitis'],
  'blad': ['blood', 'bleeding'],
  'hariap': ['fast', 'rapid'],
  'kwiktaem': ['quickly', 'urgent', 'emergency'],
  'bot': ['boat', 'transport', 'transfer'],
  'sendem': ['refer', 'referral', 'transfer'],
  'lukim': ['check', 'examine', 'look'],
  'givim': ['give', 'dose'],
  'kof': ['cough', 'pneumonia'],
  'kus': ['cough'],
  'skin': ['skin', 'rash', 'scabies', 'impetigo'],
  'sua': ['sore', 'wound', 'ulcer', 'abscess'],
  'soa': ['sore', 'wound', 'ulcer'],
  'bel': ['abdomen', 'abdominal', 'stomach'],
  'bele': ['abdomen', 'abdominal', 'stomach'],
  'hed': ['head', 'headache'],
  'ia': ['ear', 'otitis'],
  'ai': ['eye', 'conjunctivitis'],
  'tut': ['tooth', 'dental', 'mouth'],
  'maus': ['mouth', 'oral'],
  'bun': ['bone', 'fracture'],
  'dae': ['dead', 'death', 'dying', 'emergency'],
  'bikfala': ['big', 'severe', 'large'],
  'smol': ['small', 'young', 'infant'],
  'smolfala': ['small', 'young', 'infant'],
  'bon': ['burn', 'burns', 'bone'],
  'faea': ['fire', 'burn', 'burns'],
  'bonem': ['burn', 'burns'],
  'poisin': ['poison', 'poisoning'],
  'snek': ['snake', 'bite', 'snakebite'],
  'dog': ['dog', 'bite', 'rabies'],
  'wik': ['weak', 'weakness'],
  'tin': ['thin', 'malnutrition', 'wasting'],
  'malnutrishon': ['malnutrition', 'wasting', 'oedema'],
  'solap': ['swelling', 'swollen', 'oedema'],
  'solapim': ['swelling', 'swollen', 'oedema'],
  'yelo': ['yellow', 'jaundice'],
  'pel': ['pale', 'pallor', 'anaemia'],
  'pale': ['pale', 'pallor', 'anaemia'],
  'mosquito': ['malaria', 'mosquito'],
  'moskito': ['malaria', 'mosquito'],
  'rdt': ['rdt', 'malaria', 'test'],
  'tes': ['test', 'rdt'],
  'nidol': ['injection', 'needle', 'immunisation', 'vaccine'],
  'injeksen': ['injection'],
  'pispis': ['urine', 'urinary'],
  'kol': ['cold', 'hypothermia'],
  'kros': ['irritable', 'cross'],
  'krae': ['cry', 'crying', 'irritable'],
  'no kaikai': ['not eating', 'not feeding', 'unable to drink'],
  'no save dring': ['unable to drink', 'cannot drink', 'danger sign'],
  'no save susu': ['unable to breastfeed', 'cannot breastfeed', 'danger sign'],
  'wet': ['weight', 'kg'],
  'hevi': ['weight', 'heavy'],
  'manis': ['month', 'months'],
  'yia': ['year', 'years'],
  'dei': ['day', 'days'],
};

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'are', 'be', 'with', 'at', 'by', 'it', 'as', 'this', 'that', 'from', 'has', 'have', 'had', 'was', 'were', 'if', 'not', 'no', 'mi', 'iu', 'hem', 'long', 'blong', 'olketa', 'nao', 'wanfala', 'tufala', 'ya', 'wea', 'wat', 'hao', 'bae', 'go', 'kam', 'stap', 'olsem', 'tumas', 'but', 'bat', 'so', 'then', 'do', 'does', 'what', 'should', 'i', 'we', 'you', 'he', 'she', 'his', 'her', 'their', 'can', 'may', 'will', 'please', 'plis', 'help', 'helpem', 'me', 'gud', 'nao', 'wat', 'wanem', 'duim', 'mekem', 'save', 'savve', 'taem', 'disfala', 'datfala', 'hemi', 'nomoa', 'tu', 'bikos', 'sapos', 'tru', 'yes', 'nomata', 'evri', 'samting', 'fala', 'lo', 'blo', 'bilong', 'ol', 'dis', 'dat', 'insaet', 'aotsaet', 'kasem', 'kolsap', 'wetem', 'witim', 'garem', 'got', 'nating', 'stil', 'yet', 'moa', 'mo', 'nomo', 'lelebet', 'lelbet', 'smol lelebet', 'about', 'with', 'now', 'today', 'tude', 'yestede', 'ago', 'since', 'still', 'also', 'very', 'get', 'got', 'any', 'some', 'him', 'she', 'they', 'them', 'who', 'when', 'where', 'how', 'why', 'which', 'there', 'here', 'into', 'out', 'up', 'down', 'over', 'under', 'again', 'after', 'before', 'because', 'than', 'too', 'just', 'only', 'much', 'many', 'more', 'most', 'other', 'such', 'own', 'same', 'all', 'both', 'each', 'few', 'off', 'once']);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9À-ɏ]+/g, ' ')
    .split(' ')
    .filter((t) => t.length > 1 && !STOP.has(t))
    .map(stem);
}

// very light stemmer: plural s, -ing, -ed; keeps medical terms readable enough for BM25
function stem(t: string): string {
  if (t.length > 5 && t.endsWith('ing')) return t.slice(0, -3);
  if (t.length > 4 && t.endsWith('ies')) return t.slice(0, -3) + 'y';
  if (t.length > 4 && t.endsWith('ed')) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
  return t;
}

// Expand a query with English synonyms for Pijin glossary tokens. Returns the full token list
// (original + expansions, stemmed) and the Pijin words that fired (for explanations in the UI).
export const EXPANSION_WEIGHT = 0.7;

// A concept is one word or Pijin phrase from the nurse's message plus its English expansions.
export interface Concept { label: string; tokens: string[] }

export function expandQuery(query: string): { tokens: string[]; expansions: Record<string, string[]>; weights: Map<string, number>; concepts: Concept[] } {
  const q = query.toLowerCase();
  const expansions: Record<string, string[]> = {};
  const concepts: Concept[] = [];
  const phrases = Object.keys(PIJIN_SYNONYMS).filter((k) => k.includes(' ')).sort((a, b) => b.length - a.length);
  let rest = q;
  for (const p of phrases) {
    if (rest.includes(p)) {
      expansions[p] = PIJIN_SYNONYMS[p];
      concepts.push({ label: p, tokens: [...new Set([...tokenize(p), ...PIJIN_SYNONYMS[p].flatMap(tokenize)])] });
      rest = rest.split(p).join(' ');
    }
  }
  for (const w of rest.replace(/[^a-z0-9\u00c0-\u024f-]+/g, ' ').split(' ').filter(Boolean)) {
    const syn = PIJIN_SYNONYMS[w] ?? PIJIN_SYNONYMS[w.replace(/-/g, '')];
    const own = tokenize(w);
    if (syn && !expansions[w]) expansions[w] = syn;
    const toks = [...new Set([...own, ...(syn ?? []).flatMap(tokenize)])];
    if (toks.length) concepts.push({ label: w, tokens: toks });
  }
  const original = tokenize(query);
  const extra = Object.values(expansions).flatMap((syns) => syns.flatMap(tokenize));
  const weights = new Map<string, number>();
  for (const t of extra) weights.set(t, EXPANSION_WEIGHT);
  for (const t of original) weights.set(t, 1);
  return { tokens: [...original, ...extra], expansions, weights, concepts };
}

interface Posting { df: number; tf: Map<number, number> }

// Chief-complaint priors: a nurse's message names one main problem; the manual has one section for it.
// When the message names it, chunks of that section get a fixed boost, and a hit from it counts as
// guideline support even when a long message dilutes concept coverage. Order = priority.
export const SECTION_PRIORS: { re: RegExp; sections: string[]; boost: number }[] = [
  { re: /\b(convuls\w*|seizures?|fits?|fitting|sek[- ]?sek)\b/i, sections: ['CONVULSIONS'], boost: 4 },
  { re: /\b(diarrh\w*|sitsit|sit sit|loose stools?|watery stools?)\b/i, sections: ['DIARRHOEA'], boost: 5 },
  { re: /\b(cough\w*|kof|kofkof|pneumonia|fast breath\w*|brit hariap)\b/i, sections: ['PNEUMONIA', 'COLDS/ URTI'], boost: 4 },
  { re: /\b(fever|febrile|hot ?bodi|temperature|malaria|rdt|coartem|artemether|act)\b/i, sections: ['MALARIA', 'FEVER'], boost: 5 },
  { re: /\b(burns?|scald\w*|bon long)\b/i, sections: ['BURNS AND SCALDS'], boost: 4 },
  { re: /\b(ear|ia)\s+(pain|discharge|sore|soa|wata)\b/i, sections: ['OTITIS MEDIA - ACUTE & CHRONIC'], boost: 4 },
  { re: /\b(sores?|rash|scabies|boils?|skin|soa)\b/i, sections: ['SKIN DISEASES'], boost: 3 },
  { re: /\b(wasting|malnutrition|underweight|tin tumas|muac)\b/i, sections: ['MALNUTRITION'], boost: 4 },
  { re: /\b(vaccin\w*|immunis\w*|immuniz\w*|injection schedule|nila)\b/i, sections: ['IMMUNISATION', 'SOLOMON ISLANDS IMMUNISATION SCHEDULE'], boost: 4 },
];

export function priorSections(query: string): Set<string> {
  const out = new Set<string>();
  for (const p of SECTION_PRIORS) if (p.re.test(query)) p.sections.forEach((s) => out.add(s));
  return out;
}

export class BM25Index {
  readonly chunks: Chunk[];
  readonly sections: SectionInfo[];
  private readonly k1 = 1.2;
  private readonly b = 0.75;
  private readonly titleBoost = 2; // section + subsection tokens are counted this many extra times
  private postings = new Map<string, Posting>();
  private docLen: number[] = [];
  private avgLen = 1;

  // Below these the engine treats retrieval as "no guideline support" (-> ASK_PERSON).
  static MIN_SCORE = 3.0;
  static MIN_COVERAGE = 0.4;

  constructor(corpus: CorpusFile | Chunk[]) {
    if (Array.isArray(corpus)) {
      this.chunks = corpus;
      this.sections = [];
    } else {
      this.chunks = corpus.chunks;
      this.sections = corpus.sections ?? [];
    }
    this.build();
  }

  private build() {
    this.chunks.forEach((c, i) => {
      const toks = tokenize(c.text);
      const title = tokenize(`${c.section} ${c.subsection ?? ''}`);
      for (let r = 0; r < this.titleBoost; r++) toks.push(...title);
      this.docLen[i] = toks.length;
      const counts = new Map<string, number>();
      for (const t of toks) counts.set(t, (counts.get(t) ?? 0) + 1);
      for (const [t, n] of counts) {
        let p = this.postings.get(t);
        if (!p) {
          p = { df: 0, tf: new Map() };
          this.postings.set(t, p);
        }
        p.df++;
        p.tf.set(i, n);
      }
    });
    this.avgLen = this.docLen.reduce((a, b) => a + b, 0) / Math.max(1, this.docLen.length);
  }

  get size() {
    return this.chunks.length;
  }

  search(query: string, k = 5): Chunk[] {
    return this.searchDetailed(query, k).hits;
  }

  // hits carry score; coverage = share of the message's concepts (word or Pijin phrase, or one of its
  // English expansions) that occur in the hit, so a Pijin query against the English manual still counts
  searchDetailed(query: string, k = 5): { hits: (Chunk & { matched: string[]; coverage: number; prior: boolean })[]; terms: string[] } {
    const { tokens, weights, concepts } = expandQuery(query);
    if (!tokens.length) return { hits: [], terms: [] };
    const N = this.chunks.length;
    const scores = new Float64Array(N);
    const seen = new Set<string>();
    for (const t of tokens) {
      if (seen.has(t)) continue; // each query term counted once so synonym fan-out does not dominate
      seen.add(t);
      const p = this.postings.get(t);
      if (!p) continue;
      const w = weights.get(t) ?? 1;
      const idf = Math.log(1 + (N - p.df + 0.5) / (p.df + 0.5));
      for (const [doc, tf] of p.tf) {
        const dl = this.docLen[doc];
        scores[doc] += w * idf * ((tf * (this.k1 + 1)) / (tf + this.k1 * (1 - this.b + (this.b * dl) / this.avgLen)));
      }
    }
    const priors = new Map<string, number>();
    for (const p of SECTION_PRIORS) if (p.re.test(query)) for (const sec of p.sections) priors.set(sec, Math.max(priors.get(sec) ?? 0, p.boost));
    if (priors.size) for (let i = 0; i < N; i++) {
      const b = priors.get(this.chunks[i].section.toUpperCase());
      if (b && scores[i] > 0) scores[i] += b;
    }
    const order: number[] = [];
    for (let i = 0; i < N; i++) if (scores[i] > 0) order.push(i);
    order.sort((a, b) => scores[b] - scores[a]);
    const hits = order.slice(0, k).map((i) => {
      const matched = concepts.filter((c) => c.tokens.some((t) => this.postings.get(t)?.tf.has(i))).map((c) => c.label);
      return { ...this.chunks[i], score: Number(scores[i].toFixed(4)), matched, coverage: concepts.length ? Number((matched.length / concepts.length).toFixed(2)) : 0, prior: priors.has(this.chunks[i].section.toUpperCase()) };
    });
    return { hits, terms: [...seen] };
  }

  // "Is the top hit real guideline support?" Used by the engine before it cites a chunk.
  static supports(hit: { score?: number; coverage?: number; prior?: boolean } | undefined): boolean {
    if (!hit) return false;
    if (hit.prior && (hit.score ?? 0) >= BM25Index.MIN_SCORE + 5) return true; // the section the complaint names
    return (hit.score ?? 0) >= BM25Index.MIN_SCORE && (hit.coverage ?? 1) >= BM25Index.MIN_COVERAGE;
  }

  sectionTitles(): string[] {
    const s = new Set<string>(this.sections.map((x) => x.title));
    for (const c of this.chunks) s.add(c.section);
    return [...s];
  }
}

// Trim a chunk to roughly maxTokens tokens (~0.75 words per token) for the guideline line.
export function excerpt(chunk: Chunk, maxTokens = 350): string {
  const words = chunk.text.replace(/\s+/g, ' ').trim().split(' ');
  const maxWords = Math.floor(maxTokens * 0.75);
  return words.length <= maxWords ? words.join(' ') : words.slice(0, maxWords).join(' ') + ' ...';
}

export async function loadCorpus(url: string, fetchImpl: typeof fetch = fetch): Promise<CorpusFile> {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`corpus fetch failed: ${res.status} ${url}`);
  const data = await res.json();
  if (Array.isArray(data)) return { version: 1, source: url, generated_at: '', sections: [], chunks: data };
  return data as CorpusFile;
}
