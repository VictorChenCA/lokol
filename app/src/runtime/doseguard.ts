// Dose-grounding guard: every dose in a reply must come from the manual page the reply used.
// Mirrors bridge/doseguard.py line for line (same regexes, same tolerance, same safe lines).
//
// A dose expression is a number or range plus a unit (mg/kg, mg, mcg/kg, mcg, microgram, g/kg, g,
// ml/kg, ml, units/kg, IU). It is SUPPORTED when
// ("mg per kg", "mg/kilo" and Pijin "mg fo evri kilo" are all mg/kg.)
//   (a) the same number + unit appears in the excerpt (for a range, the TOP endpoint must appear: "15-150 mg/kg"
//       is not grounded by "15mg/kg", while "10-15 mg/kg" is, since a lower bottom only under-doses), or
//   (b) it is an absolute amount (mg, mcg, g, ml), the nurse message gives a weight, and every endpoint
//       is within 15% of an excerpt per-kg dose x weight (or inside an excerpt per-kg range x weight),
//       or appears in the excerpt as an absolute amount (weight-band tables).
// A reply line with any unsupported dose is replaced by one safe line. Route words (IV, IM, rectal)
// are not checked here.
//
// DRUG BINDING (v3, nearest-drug ownership). Drug names come from the CURATED medicine list in drug_lexicon.json
// ("drugs": groups of generic names, the manual's misspellings, Pijin spellings and brands, e.g. Augmentin = amoxicillin-
// clavulanate, Tylenol = paracetamol; built by pipeline/build_drug_lexicon.py). A word matches a name exactly, or one
// edit away (insert/delete/substitute) when the name has 7+ letters; multi-word names match as consecutive words. A word
// that is not a curated name but ends in a drug suffix (-cillin, -mycin, -azole, -olac, -profen, ...; 6+ letters) is an
// UNKNOWN DRUG, and so is a word one edit from two different medicines.
//   Excerpt: every dose on the page is OWNED by the nearest drug name before it (across line breaks), else by the first
//   drug name starting within 60 characters after it, else by nobody. Dense table rows and sub-rows under one drug
//   heading are handled by this: in 'Ampicillin 50mg/kg ... PLUS Gentamicin ... 3mg/kg ... 7.5mg/kg' 50 mg/kg is
//   ampicillin's and 7.5 mg/kg gentamicin's.
//   Reply: a dose's drug is the nearest drug name to its left in the same sentence (. ! ? ; end it), else the first one
//   to its right in the same sentence starting within 30 characters. A left drug already bound to an earlier dose on the
//   line gives way to a right drug starting within 8 characters ('paracetamol 15 mg/kg and 500 mg morphine').
//   With a drug, only excerpt doses OWNED by that drug (or a synonym) count for (a) and (b) above, so a weight-computed
//   amount must come from that drug's per-kg dose; an unknown drug, or a drug that owns no matching dose, is unsupported.
//   Without a drug, (a) and (b) apply to every excerpt dose, but the excerpt doses that support the value must be owned
//   by at most one drug: '0.3 mg/kg' on a page where both midazolam and diazepam own 0.3 mg/kg is ambiguous, unsupported.
// Distances are measured on text after NFKC, zero-width removal, whitespace runs collapsed to one space and astral
// characters counted as one, so the app and the bridge measure the same characters.
import LEX from './drug_lexicon.json';

export interface Dose {
  text: string; // as written in the reply
  lo: number;
  hi: number;
  unit: string; // normalised: mg, mcg, g, ml, iu, units, each optionally with "/kg"
}

// "1,000" is thousands; "12,5" is a decimal comma; ".5" is 0.5.
const THOUSANDS = '[0-9]{1,3}(?:,[0-9]{3})+(?:\\.[0-9]+)?';
const NUM = `${THOUSANDS}|[0-9]+(?:[.,][0-9]+)?|\\.[0-9]+`;
const DOSE_SRC =
  // "2x250mg": a digit + x/× before the number also starts a dose. Range dashes: - ‐ ‑ ‒ – — ― − and "to".
  `(^|[^A-Za-z0-9_.]|[0-9][xX×])(${NUM})(?:\\s*(?:[-\\u2010-\\u2015\\u2212]|to)\\s*(${NUM}))?\\s*` +
  '(mgs?|milligram(?:me)?s?|mcgs?|[µμ]g|microgram(?:me)?s?|g|gms?|gram(?:me)?s?|mls?|millilit(?:re|er)s?|iu|units?)' +
  // per-kg: "/kg", "per kg", Pijin "fo evri kilo" / "long wan kilo", "every kg"
  '(\\s*(?:/|per\\b|(?:fo|for|long|lo)\\s+(?:evri|every|each|wan|one|1)\\b|(?:evri|every|each)\\b)\\s*(?:kg|kilograms?|kilos?)(?![A-Za-z]))?(?![A-Za-z])';
const WEIGHT_SRC = `(^|[^A-Za-z0-9_.])(\\d+(?:\\.\\d+)?)\\s*(?:kgs?|kilos?|kilograms?)(?![A-Za-z])`;
const WEIGHT2_SRC = '\\bweigh(?:t|s|ing)?\\s*(?:is|of|=|:)?\\s*(\\d+(?:\\.\\d+)?)';

// NFKC (fullwidth digits, NBSP/thin spaces, Kelvin sign, micro sign) and drop zero-width characters, so a
// zero-width space inside "50 mg/kg" or fullwidth digits cannot hide a dose, and app and bridge read the same text.
// U+001C-001F and U+0085 are whitespace to Python's \s but not to JS's, so both sides turn them into a plain space.
const clean = (s: string) => (s ?? '').normalize('NFKC').replace(/[\u00ad\u200b-\u200d\u2060\ufeff]/g, '').replace(/[\x1c-\x1f\x85]/g, ' ');

const ABSOLUTE = new Set(['mg', 'mcg', 'g', 'ml']);
const TOL = 0.15;
const EPS = 1e-9;

function num(s: string): number {
  return new RegExp(`^(?:${THOUSANDS})$`).test(s) ? parseFloat(s.replace(/,/g, '')) : parseFloat(s.replace(',', '.'));
}

function normUnit(u: string, perKg: boolean): string {
  let b = u.toLowerCase();
  if (b === 'µg' || b === 'μg' || b === 'mcgs' || b.startsWith('microgram')) b = 'mcg';
  else if (b === 'mgs' || b.startsWith('milligram')) b = 'mg';
  else if (b === 'gm' || b === 'gms' || b.startsWith('gram')) b = 'g';
  else if (b === 'mls' || b.startsWith('millilit')) b = 'ml';
  else if (b === 'unit') b = 'units';
  return perKg ? `${b}/kg` : b;
}

export function extractDoses(text: string): Dose[] {
  const out: Dose[] = [];
  for (const m of clean(text).matchAll(new RegExp(DOSE_SRC, 'gi'))) {
    const unit = normUnit(m[4], !!m[5]);
    if (unit === 'units') continue; // bare "units" is not a dose unit here; units/kg is
    const a = num(m[2]);
    const b = m[3] !== undefined ? num(m[3]) : a;
    out.push({ text: m[0].slice(m[1].length).trim(), lo: Math.min(a, b), hi: Math.max(a, b), unit });
  }
  return out;
}

export function extractWeights(message: string): number[] {
  const ws: number[] = [];
  message = clean(message);
  for (const m of message.matchAll(new RegExp(WEIGHT_SRC, 'gi'))) ws.push(num(m[2]));
  for (const m of message.matchAll(new RegExp(WEIGHT2_SRC, 'gi'))) ws.push(num(m[1]));
  return ws.filter((w) => w > 0.5 && w < 150);
}

const same = (x: number, y: number) => Math.abs(x - y) < EPS;

function inExcerpt(v: number, unit: string, ex: Dose[]): boolean {
  return ex.some((e) => e.unit === unit && (same(e.lo, v) || same(e.hi, v)));
}

function byWeight(v: number, unit: string, ex: Dose[], weights: number[]): boolean {
  if (inExcerpt(v, unit, ex)) return true;
  for (const w of weights) {
    for (const e of ex) {
      if (e.unit !== `${unit}/kg`) continue;
      if (v >= e.lo * w * (1 - TOL) - EPS && v <= e.hi * w * (1 + TOL) + EPS) return true;
    }
  }
  return false;
}

// ---- drug binding (v3: nearest-drug ownership) --------------------------------------------------------------------
const TOK_SRC = '[A-Za-z]+|[0-9]+(?:[.,][0-9]+)*|[.!?;](?![0-9])';
const WIN_AFTER = 60; // an excerpt dose with no drug before it is owned by a drug starting at most this far after it
const REPLY_RIGHT = 30; // a reply dose with no drug on its left binds to a drug starting at most this far to its right
const CLAIMED_GAP = 8; // " of the " : how far right of a dose a drug may start when the left drug is another dose's
const FUZZY_MIN = 7; // names this long match a word one edit (insert/delete/substitute) away
const UNKNOWN_MIN = 6;
const SUFFIXES: string[] = (LEX as { unknown_suffixes?: string[] }).unknown_suffixes ?? [];
const NOT_DRUGS = new Set<string>((LEX as { not_drugs?: string[] }).not_drugs ?? []);

const words = (s: string) => (s.match(/[A-Za-z]+/g) ?? []).map((w) => w.toLowerCase());
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0); // code-point order, as Python's sorted()

const NAMES = new Map<string, string>(); // curated name (space-joined lowercase words) -> canonical name of its medicine
for (const g of ((LEX as { drugs?: string[][] }).drugs ?? [])) {
  const canon = words(g[0]).join(' ');
  for (const m of g) NAMES.set(words(m).join(' '), canon);
}
const PHRASES = [...new Set([...NAMES.keys()].filter((k) => k.includes(' ')))].sort(
  (a, b) => b.split(' ').length - a.split(' ').length || cmp(a, b),
); // longest first
const FUZZY = [...NAMES.keys()].filter((k) => !k.includes(' ') && k.length >= FUZZY_MIN).sort(cmp);

// True when a and b differ by exactly one insert, delete or substitute.
function edit1(a: string, b: string): boolean {
  let la = a.length;
  let lb = b.length;
  if (la === lb) {
    let n = 0;
    for (let i = 0; i < la; i++) if (a[i] !== b[i]) n++;
    return n === 1;
  }
  if (Math.abs(la - lb) !== 1) return false;
  if (la > lb) [a, b, la, lb] = [b, a, lb, la];
  let i = 0;
  while (i < la && a[i] === b[i]) i++;
  return a.slice(i) === b.slice(i + 1);
}

const IDENT = new Map<string, string | null>();

// Medicine identity of one lowercase word: its canonical name (exact, or one edit from a 7+ letter name), "?word" for
// an UNKNOWN DRUG (one edit from two different medicines, or a drug suffix and 6+ letters), else null.
function ident(w: string): string | null {
  const c = IDENT.get(w);
  if (c !== undefined) return c;
  let r: string | null = NAMES.get(w) ?? null;
  if (r === null && w.length >= FUZZY_MIN - 1) {
    const near = [...new Set(FUZZY.filter((n) => Math.abs(n.length - w.length) <= 1 && edit1(w, n)).map((n) => NAMES.get(n)!))].sort(cmp);
    r = near.length === 1 ? near[0] : near.length ? `?${w}` : null;
  }
  if (r === null && w.length >= UNKNOWN_MIN && !NOT_DRUGS.has(w) && SUFFIXES.some((x) => w.endsWith(x))) r = `?${w}`;
  IDENT.set(w, r);
  return r;
}

// Text distances are measured on: the guard's normalisation, whitespace runs -> one space, astral chars -> one char.
const bindText = (s: string) =>
  clean(s).replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '\ufffd').replace(/[ \t\n\r\f\v]+/g, ' ');

interface Tok {
  kind: 'w' | 'n' | 'b'; // word, number, sentence boundary
  low: string;
  start: number;
  end: number;
}

function tokens(s: string): Tok[] {
  const out: Tok[] = [];
  for (const m of s.matchAll(new RegExp(TOK_SRC, 'g'))) {
    const t = m[0];
    const kind = /[A-Za-z]/.test(t[0]) ? 'w' : /[0-9]/.test(t[0]) ? 'n' : 'b';
    out.push({ kind, low: t.toLowerCase(), start: m.index!, end: m.index! + t.length });
  }
  return out;
}

interface Drug {
  ident: string; // canonical name, or "?word" for an unknown drug
  start: number;
  end: number;
}

// Every drug name in a token list, left to right; a multi-word name (consecutive words) wins over its first word.
function drugsIn(toks: Tok[]): Drug[] {
  const out: Drug[] = [];
  let i = 0;
  while (i < toks.length) {
    const t = toks[i];
    if (t.kind !== 'w') {
      i++;
      continue;
    }
    let hit: Drug | null = null;
    for (const ph of PHRASES) {
      const parts = ph.split(' ');
      const k = parts.length;
      if (i + k <= toks.length && parts.every((p, j) => toks[i + j].kind === 'w' && toks[i + j].low === p)) {
        hit = { ident: NAMES.get(ph)!, start: t.start, end: toks[i + k - 1].end };
        i += k;
        break;
      }
    }
    if (hit === null) {
      const id = ident(t.low);
      i++;
      if (id === null) continue;
      hit = { ident: id, start: t.start, end: t.end };
    }
    out.push(hit);
  }
  return out;
}

interface Span {
  d: Dose;
  start: number; // number start
  end: number; // dose end
}

// Doses in already bind-normalised text with (number start, dose end).
function doseSpans(s: string): Span[] {
  const out: Span[] = [];
  for (const m of s.matchAll(new RegExp(DOSE_SRC, 'gi'))) {
    const unit = normUnit(m[4], !!m[5]);
    if (unit === 'units') continue;
    const a = num(m[2]);
    const b = m[3] !== undefined ? num(m[3]) : a;
    const d = { text: m[0].slice(m[1].length).trim(), lo: Math.min(a, b), hi: Math.max(a, b), unit };
    out.push({ d, start: m.index! + m[1].length, end: m.index! + m[0].length });
  }
  return out;
}

export type Owned = [Dose, string | null];

// Every dose in the excerpt with its OWNER: the nearest drug name before it (across line breaks; the nearest one is by
// definition not past another drug name), else the nearest drug starting within WIN_AFTER chars after it, else null.
export function excerptOwners(excerpt: string): Owned[] {
  const bex = bindText(excerpt);
  const drugs = drugsIn(tokens(bex));
  return doseSpans(bex).map(({ d, start: s, end: e }): Owned => {
    const before = drugs.filter((g) => g.end <= s);
    if (before.length) return [d, before[before.length - 1].ident];
    const after = drugs.find((g) => g.start >= e && g.start - e <= WIN_AFTER);
    return [d, after ? after.ident : null];
  });
}

// The drug of the reply dose at [start, end): the nearest drug name to its left in the same sentence, else the first one
// to its right in the same sentence starting within REPLY_RIGHT chars. A left drug already bound to an earlier dose on
// the line (start in `claimed`) gives way to a right drug starting within CLAIMED_GAP chars: "paracetamol 15 mg/kg and
// 500 mg morphine" binds 500 mg to morphine, "diazepam 0.3 mg/kg (max 10 mg)" keeps diazepam.
function bind(toks: Tok[], drugs: Drug[], start: number, end: number, claimed: ReadonlySet<number>): Drug | null {
  const stops = toks.filter((t) => t.kind === 'b').map((t) => t.start);
  let left: Drug | null = null;
  for (const g of drugs) if (g.end <= start && !stops.some((b) => g.end <= b && b < start)) left = g;
  let right: Drug | null = null;
  for (const g of drugs) {
    if (g.start >= end) {
      if (g.start - end <= REPLY_RIGHT && !stops.some((b) => end <= b && b < g.start)) right = g;
      break;
    }
  }
  if (left === null) return right;
  if (claimed.has(left.start) && right !== null && right.start - end <= CLAIMED_GAP) return right;
  return left;
}

// The drug identity for the dose at [start, end) of a bind-normalised reply line (null when there is none).
export function drugWord(line: string, start: number, end: number, claimed: ReadonlySet<number> = new Set()): string | null {
  const toks = tokens(line);
  const g = bind(toks, drugsIn(toks), start, end, claimed);
  return g ? g.ident : null;
}

// With a drug: only excerpt doses OWNED by that drug count (unknown drugs own nothing on a page they are not on).
// Without one: every excerpt dose counts, but the doses that support the value must be owned by at most one drug.
function supported(d: Dose, occ: Owned[], weights: number[], drug: string | null): boolean {
  const pool = drug !== null ? occ.filter((o) => o[1] === drug) : occ;
  const ok = (hits: Owned[]) => hits.length > 0 && (drug !== null || new Set(hits.map((h) => h[1]).filter((o) => o !== null)).size <= 1);
  const exact = (v: number, unit: string) => pool.filter((h) => h[0].unit === unit && (same(h[0].lo, v) || same(h[0].hi, v)));
  const absW = ABSOLUTE.has(d.unit) && weights.length > 0;
  const byW = (v: number) => {
    const hits = exact(v, d.unit);
    for (const w of weights) {
      for (const h of pool) {
        const e = h[0];
        if (e.unit === `${d.unit}/kg` && v >= e.lo * w * (1 - TOL) - EPS && v <= e.hi * w * (1 + TOL) + EPS) hits.push(h);
      }
    }
    return hits;
  };
  // The top of a range must be on the page. Without a drug, a per-kg dose x weight that also gives the top counts
  // toward ambiguity: '600 mg' for 10 kg is rifampicin's max AND benzylpenicillin 60 mg/kg x 10 kg.
  if (ok(exact(d.hi, d.unit)) && (drug !== null || !absW || ok(byW(d.hi)))) return true;
  if (absW) return [d.lo, d.hi].every((v) => ok(byW(v)));
  return false;
}

export function doseSupported(d: Dose, ex: Dose[], weights: number[]): boolean {
  if (inExcerpt(d.hi, d.unit, ex)) return true; // the top of a range must be on the page
  if (ABSOLUTE.has(d.unit) && weights.length) return [d.lo, d.hi].every((v) => byWeight(v, d.unit, ex, weights));
  return false;
}

export function safeDoseLine(lang: string, page: number | null | undefined, hasExcerpt: boolean): string {
  const pis = lang === 'pis';
  if (hasExcerpt && page !== null && page !== undefined) {
    return pis
      ? `Dos: lukim buk STM pej ${page} fastaem. Mi no faendem dos ya long pej mi iusim.`
      : `Dose: check the manual page ${page} before giving it. I could not find this dose in the page I used.`;
  }
  return pis ? 'Dos: askem nes long jaj o dokta.' : 'Dose: ask the nurse in charge or the doctor.';
}

export interface DoseGuardResult {
  body: string;
  unsupported: string[];
}

export function guardDoses(
  body: string,
  excerptText: string | null | undefined,
  nurseMessage: string,
  page: number | null | undefined,
  lang: string,
): DoseGuardResult {
  const excerpt = (excerptText ?? '').trim();
  const occ = excerpt ? excerptOwners(excerpt) : [];
  const weights = extractWeights(nurseMessage ?? '');
  const safe = safeDoseLine(lang, page, !!excerpt);
  const unsupported: string[] = [];
  const lines: string[] = [];
  let safeAdded = false;
  for (const line of (body ?? '').split('\n')) {
    const ds = extractDoses(line);
    const bl = bindText(line);
    const spans = doseSpans(bl);
    const toks = tokens(bl);
    const drugs = drugsIn(toks);
    const claimed = new Set<number>(); // start offsets of drug names already bound to an earlier dose on this line
    const bad = ds.filter((d, i) => {
      const g = spans.length === ds.length ? bind(toks, drugs, spans[i].start, spans[i].end, claimed) : null;
      if (g) claimed.add(g.start);
      return !supported(d, occ, weights, g ? g.ident : null);
    });
    if (!bad.length) {
      lines.push(line);
      continue;
    }
    unsupported.push(...bad.map((d) => d.text));
    if (!safeAdded) {
      lines.push(safe);
      safeAdded = true;
    }
  }
  return { body: unsupported.length ? lines.join('\n') : body, unsupported };
}
