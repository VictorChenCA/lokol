// Dose-grounding guard: every dose in a reply must come from the manual page the reply used.
// Mirrors bridge/doseguard.py line for line (same regexes, same tolerance, same safe lines).
//
// A dose expression is a number or range plus a unit (mg/kg, mg, mcg/kg, mcg, microgram, g/kg, g,
// ml/kg, ml, units/kg, IU). It is SUPPORTED when
// ("mg per kg", "mg/kilo" and Pijin "mg fo evri kilo" are all mg/kg.)
//   (a) the same number + unit appears in the excerpt (a range matches if either endpoint does), or
//   (b) it is an absolute amount (mg, mcg, g, ml), the nurse message gives a weight, and every endpoint
//       is within 15% of an excerpt per-kg dose x weight (or inside an excerpt per-kg range x weight),
//       or appears in the excerpt as an absolute amount (weight-band tables).
// A reply line with any unsupported dose is replaced by one safe line. Route words (IV, IM, rectal)
// are not checked here.

export interface Dose {
  text: string; // as written in the reply
  lo: number;
  hi: number;
  unit: string; // normalised: mg, mcg, g, ml, iu, units, each optionally with "/kg"
}

const NUM = '\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?';
const DOSE_SRC =
  `(^|[^A-Za-z0-9_.])(${NUM})(?:\\s*(?:-|–|to)\\s*(${NUM}))?\\s*` +
  '(mg|milligrams?|mcg|µg|micrograms?|g|gm|grams?|mls?|millilit(?:re|er)s?|iu|units?)' +
  // per-kg: "/kg", "per kg", Pijin "fo evri kilo" / "long wan kilo", "every kg"
  '(\\s*(?:/|per\\b|(?:fo|for|long|lo)\\s+(?:evri|every|each|wan|one|1)\\b|(?:evri|every|each)\\b)\\s*(?:kg|kilograms?|kilos?)(?![A-Za-z]))?(?![A-Za-z])';
const WEIGHT_SRC = `(^|[^A-Za-z0-9_.])(\\d+(?:\\.\\d+)?)\\s*(?:kgs?|kilos?|kilograms?)(?![A-Za-z])`;
const WEIGHT2_SRC = '\\bweigh(?:t|s|ing)?\\s*(?:is|of|=|:)?\\s*(\\d+(?:\\.\\d+)?)';

const ABSOLUTE = new Set(['mg', 'mcg', 'g', 'ml']);
const TOL = 0.15;
const EPS = 1e-9;

function num(s: string): number {
  return parseFloat(s.replace(/,/g, ''));
}

function normUnit(u: string, perKg: boolean): string {
  let b = u.toLowerCase();
  if (b === 'µg' || b.startsWith('microgram')) b = 'mcg';
  else if (b.startsWith('milligram')) b = 'mg';
  else if (b === 'gm' || b.startsWith('gram')) b = 'g';
  else if (b === 'mls' || b.startsWith('millilit')) b = 'ml';
  else if (b === 'unit') b = 'units';
  return perKg ? `${b}/kg` : b;
}

export function extractDoses(text: string): Dose[] {
  const out: Dose[] = [];
  for (const m of text.matchAll(new RegExp(DOSE_SRC, 'gi'))) {
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

export function doseSupported(d: Dose, ex: Dose[], weights: number[]): boolean {
  if (inExcerpt(d.lo, d.unit, ex) || inExcerpt(d.hi, d.unit, ex)) return true;
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
  const ex = excerpt ? extractDoses(excerpt) : [];
  const weights = extractWeights(nurseMessage ?? '');
  const safe = safeDoseLine(lang, page, !!excerpt);
  const unsupported: string[] = [];
  const lines: string[] = [];
  let safeAdded = false;
  for (const line of body.split('\n')) {
    const bad = extractDoses(line).filter((d) => !doseSupported(d, ex, weights));
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
