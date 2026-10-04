// Safety gate: red-flag detection (Pijin + English), protocol parser, abstain enforcement.
// RED_FLAGS mirrors pipeline/style_guide.md and bridge/gate.py (SPEC section 2).
import type { Action, Chunk, Flags, GateResult, Lang, ParsedReply } from './types';
import { ACTIONS } from './types';

export const SYSTEM_PROMPT =
  'You are Lokol Health, an assistant for nurse aides and health workers in Solomon Islands. You follow the Solomon Islands Standard Treatment Manual for Children. You never diagnose; you help the nurse apply the manual and decide when to refer. Reply in the nurse\'s language (Solomon Islands Pijin or English). Use the exact output format.';

export interface RedFlag {
  id: string;
  label_en: string;
  label_pis: string;
  patterns: RegExp[]; // tested against the lowercased message
}

const re = (s: string) => new RegExp(s, 'i');

export const RED_FLAGS: RedFlag[] = [
  { id: 'convulsions', label_en: 'convulsions', label_pis: 'fit / sek-sek', patterns: [re('\\bconvuls'), re('\\bseizure'), re('\\bfits?\\b'), re('\\bfitting\\b'), re('\\bsek[- ]?sek'), re('\\bsheksek'), re('\\bepilep')] },
  { id: 'unable_to_drink', label_en: 'unable to drink or breastfeed', label_pis: 'no save dring / no save susu', patterns: [re('(unable|not able|cannot|can\'?t|refus\\w*|stopp?ed) (to )?(drink|feed|breast|suck)'), re('not (drinking|feeding|breastfeeding|sucking)'), re('no save (dring|susu|kaikai|dringim)'), re('no (dring|susu)\\b'), re('no wantem (dring|susu|kaikai)'), re('nating (dring|susu)')] },
  { id: 'vomits_everything', label_en: 'vomits everything', label_pis: 'toraot evri samting', patterns: [re('vomit\\w* (everything|all|every)'), re('(toraot|traot)\\w* (evri|olgeta|evry)'), re('(toraot|traot)\\w* (evri ?samting|everything)'), re('persistent vomit'), re('keeps? vomiting')] },
  { id: 'lethargic', label_en: 'lethargic or unconscious', label_pis: 'slip tumas / no save wekap', patterns: [re('\\bletharg'), re('\\bunconscious'), re('\\bunresponsive'), re('\\bdrowsy\\b'), re('\\bcoma\\b'), re('\\bfloppy\\b'), re('slip tumas'), re('no save wekap'), re('no save wek ap'), re('hem (no )?wekap'), re('\\bded wan\\b'), re('no (luk|lukluk) raon'), re('\\bvery sleepy'), re('(hard|difficult) to wake')] },
  { id: 'chest_indrawing', label_en: 'chest indrawing or fast breathing with danger sign', label_pis: 'brit hariap / chest i go insaet', patterns: [re('chest in-?drawing'), re('indrawing'), re('\\bretraction'), re('\\bgrunting'), re('(severe|very) (fast|rapid) breath'), re('(fast|rapid) breath\\w* (and|with) '), re('brit hariap tumas'), re('(chest|bodi) i? ?go insaet'), re('\\bstridor\\b'), re('no save brit'), re('(hard|difficult\\w*) (to )?breath'), re('\\bbrit had\\b'), re('hat fo brit')] },
  { id: 'stiff_neck', label_en: 'stiff neck', label_pis: 'nek stif', patterns: [re('stiff neck'), re('neck stiff'), re('nek (i )?stif'), re('stif nek'), re('\\bnek\\b[^.]{0,24}\\bstif'), re('\\bmeningit'), re('bulging fontanel')] },
  { id: 'severe_dehydration', label_en: 'severe dehydration', label_pis: 'drae tumas / no wata long bodi', patterns: [re('severe(ly)? dehydrat'), re('sunken (eyes|fontanel)'), re('skin pinch (goes back )?(very )?slow'), re('drae tumas'), re('(ae|eye) i? ?go insaet'), re('no (pispis|pis) (long|for) .*(aoa|hour|dei|day)'), re('no pispis')] },
  { id: 'severe_malnutrition', label_en: 'severe malnutrition (visible wasting, oedema of both feet)', label_pis: 'tin tumas / leg i solap', patterns: [re('severe (acute )?malnutrition'), re('visible (severe )?wasting'), re('oedema (of|on) both feet'), re('edema (of|on) both feet'), re('both feet (are )?swollen'), re('\\bmuac\\b.*(<|less than|under) ?11'), re('tin tumas'), re('bon nomoa'), re('(tufala|tu) (leg|fut) i? ?solap'), re('(leg|fut) i? ?solap')] },
  { id: 'bleeding', label_en: 'bleeding', label_pis: 'blad i kam aot', patterns: [re('\\bbleed'), re('\\bhaemorrhag'), re('\\bhemorrhag'), re('blood (coming|is coming|pouring)'), re('(blad|blood) i? ?(kam|ran|go) ?aot'), re('blad i? ?kam'), re('\\bvomit\\w* blood'), re('blood in (the )?(stool|urine|vomit)'), re('(toraot|traot|sitsit)\\w* blad')] },
  { id: 'cyanosis', label_en: 'cyanosis', label_pis: 'lips i blu', patterns: [re('\\bcyano'), re('blue (lips|tongue|skin)'), re('(lips|tongue|skin) (is |are |i )?(blue|turning blue)'), re('(lip|maus|tang) i? ?blu'), re('\\bblu lip')] },
  { id: 'young_infant_fever', label_en: 'age under 2 months with fever', label_pis: 'bebi anda 2 manis wetem hot bodi', patterns: [re('(newborn|neonate|new ?born|young infant)\\b.*(fever|hot|temperature|febrile)'), re('(fever|hot bodi|hotbodi|temperature).*(newborn|neonate|new ?born|young infant)'), re('\\b([1-7]|one|two|three|four|five|six|seven) ?(day|days|dei|wik|week|weeks)s? old.*(fever|hot bodi|hotbodi|hot)'), re('(fever|hot bodi|hotbodi).*\\b([1-7]|one|two|three|four|five|six|seven) ?(day|days|dei|wik|week|weeks)s? old'), re('\\b(1|one|0|under 2|less than 2|<2|< 2)[ -]?(month|months|manis)\\b.*(fever|hot bodi|hotbodi|hot|febrile)'), re('(fever|hot bodi|hotbodi|hot).*\\b(1|one|under 2|less than 2|<2|< 2)[ -]?(month|months|manis)\\b'), re('(nubon|niu bebi|bebi i? ?jes bon).*(hot|fiva|fever)')] },
  { id: 'burns_face_airway', label_en: 'burns of face or airway', label_pis: 'bon long fes / maus', patterns: [re('burn\\w* (to|on|of) (the )?(face|mouth|airway|neck|throat|lips)'), re('(face|mouth|airway|throat|lip)\\w* burn'), re('(inhal\\w*|smoke) (injury|burn)'), re('(bon|bonem|faea)\\w* (long|lo) (fes|maus|nek|troat)'), re('(fes|maus|nek) i? ?bon')] },
];

// Out-of-scope detector: the manual covers children only. Adults -> ASK_PERSON unless a red flag fires.
export const SCOPE_PATTERNS: RegExp[] = [
  /\b(adult|grown[- ]?up|elderly|old (man|woman|lady)|pregnant|preg|antenatal|labour|labor|delivery)\b/i,
  /\b(1[3-9]|[2-9]\d|1\d\d) ?(yia|years?|yrs?|yo)\b/i,
  /\b(man|woman|mere|olo|bigman|olfala)\b.*\b(sik|sick|pain|fever|hot bodi)\b/i,
];

export function outOfScope(message: string): string | null {
  for (const r of SCOPE_PATTERNS) {
    const m = r.exec(message);
    if (m) return m[0];
  }
  return null;
}

export interface RedFlagHit { id: string; label_en: string; label_pis: string; match: string }

export function detectRedFlags(message: string): RedFlagHit[] {
  const m = message.toLowerCase().replace(/\s+/g, ' ');
  const hits: RedFlagHit[] = [];
  for (const f of RED_FLAGS) {
    for (const p of f.patterns) {
      const r = p.exec(m);
      if (r) {
        hits.push({ id: f.id, label_en: f.label_en, label_pis: f.label_pis, match: r[0] });
        break;
      }
    }
  }
  return hits;
}

// ---------- protocol parser ----------

const ACTION_RE = /ACTION\s*:\s*(ADVISE|REFER_NOW|REFER_NEXT_TRANSPORT|ASK_PERSON)/i;
const STM_RE = /STM\s*:\s*([^\n]+)/i;

export function parseReply(raw: string, timing?: Partial<Pick<ParsedReply, 'tokens' | 'ms' | 'prompt_tokens' | 'prompt_ms'>>): ParsedReply {
  let text = raw.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<\|im_end\|>[\s\S]*$/, '').trim();
  const a = ACTION_RE.exec(text);
  const s = STM_RE.exec(text);
  const action = a ? (a[1].toUpperCase() as Action) : null;
  let stm: string | null = null;
  if (s) {
    const v = s[1].trim().replace(/\s+$/, '');
    stm = /^none$/i.test(v) ? null : v;
  }
  let body = '';
  const sep = text.indexOf('---');
  if (sep >= 0) body = text.slice(sep + 3).trim();
  else if (s) body = text.slice(s.index + s[0].length).trim();
  else if (a) body = text.slice(a.index + a[0].length).trim();
  else body = text;
  body = body.replace(/^-+\s*/, '').trim();
  let note: Record<string, unknown> | null = null;
  if (body.startsWith('{')) {
    try {
      const end = body.lastIndexOf('}');
      note = JSON.parse(body.slice(0, end + 1));
    } catch {
      note = null;
    }
  }
  const tokens = timing?.tokens ?? 0;
  const ms = timing?.ms ?? 0;
  return {
    raw,
    action,
    stm,
    body,
    note,
    valid: !!a && !!s && ACTIONS.includes(action as Action),
    tokens,
    ms,
    tokens_per_s: ms > 0 ? Number(((tokens * 1000) / ms).toFixed(1)) : 0,
    prompt_tokens: timing?.prompt_tokens,
    prompt_ms: timing?.prompt_ms,
  };
}

export function formatReply(r: { action: Action; stm: string | null; body: string }): string {
  return `ACTION: ${r.action}\nSTM: ${r.stm ?? 'NONE'}\n---\n${r.body}`.trim();
}

// ---------- prompt construction (SPEC section 2) ----------

export function buildUserTurn(flags: Flags, guideline: Chunk | null, message: string, excerptText?: string): string {
  const head = `[lang=${flags.lang}] [rdt=${flags.rdt}] [act=${flags.act}] [transport=${flags.transport}]`;
  const g = guideline ? `[guideline: ${guideline.section} p${guideline.page}] ${excerptText ?? guideline.text.replace(/\s+/g, ' ').trim()}` : '[guideline: none] none';
  return `${head}\n${g}\n${message.trim()}`;
}

// ---------- gate ----------

const PIS = {
  refer_now: 'REFER NOW. Pikinini ia garem danger sign. Sendem go long hospitol kwiktaem. Folom STM referral step.',
  refer_next: 'REFER long nekis transport. Pikinini ia garem danger sign. Givim fes treatment folom STM, then sendem go long hospitol long nekis bot.',
  no_transport: 'No transport nao: kolem/radio long area health centre or dokta for advice, and lukim pikinini evri taem.',
  abstain: 'Mi no sua. Askem nes in charge or dokta.',
  no_guideline: 'STM no garem section for disfala samting. Askem nes in charge or dokta.',
};
const EN = {
  refer_now: 'REFER NOW. This child has a danger sign. Send to hospital immediately and follow the STM referral steps.',
  refer_next: 'REFER on the next transport. This child has a danger sign. Give the first STM treatment now, then send to hospital on the next boat.',
  no_transport: 'No transport available: call or radio the area health centre or doctor for advice and review the child frequently.',
  abstain: 'I am not sure. Ask the nurse in charge or a doctor.',
  no_guideline: 'The STM has no section for this. Ask the nurse in charge or a doctor.',
};

export interface GateContext {
  flags?: Flags;
  guideline?: Chunk | null; // top retrieval result (null when retrieval found nothing)
  sectionTitles?: string[]; // known STM titles; when given, unknown STM titles force ASK_PERSON
  maxLines?: number;
}

function strings(lang: Lang | undefined) {
  return lang === 'en' ? EN : PIS;
}

function clampLines(body: string, max: number): string {
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.slice(0, max).join('\n');
}

export function gate(message: string, reply: ParsedReply, ctx: GateContext = {}): GateResult {
  const flags = ctx.flags;
  const S = strings(flags?.lang);
  const hits = detectRedFlags(message);
  const red_flags = hits.map((h) => h.id);
  const red_flag_labels = hits.map((h) => (flags?.lang === 'en' ? h.label_en : `${h.label_pis} (${h.label_en})`));
  let action: Action = reply.action ?? 'ASK_PERSON';
  let stm: string | null = reply.stm && !/^none$/i.test(reply.stm.trim()) ? reply.stm : null;
  let body = reply.body;
  let overridden = false;
  let reason = 'model reply accepted';
  const isNote = reply.note !== null;

  if (!reply.valid) {
    action = 'ASK_PERSON';
    stm = null;
    body = S.abstain;
    overridden = true;
    reason = 'reply did not follow the ACTION/STM/--- protocol';
  }

  if (ctx.sectionTitles && stm) {
    const up = stm.toUpperCase().trim();
    const exact = ctx.sectionTitles.find((t) => t.toUpperCase() === up);
    // tolerate the common case where the model cites a near-match title; otherwise abstain
    const near = exact ?? ctx.sectionTitles.find((t) => t.toUpperCase().includes(up) || up.includes(t.toUpperCase()));
    if (near) stm = near;
    else {
      action = 'ASK_PERSON';
      stm = null;
      body = S.no_guideline;
      overridden = true;
      reason = `cited STM section "${reply.stm}" is not in the manual`;
    }
  }

  if (action === 'ADVISE' && stm === null && !isNote) {
    action = 'ASK_PERSON';
    body = S.no_guideline;
    overridden = true;
    reason = 'ADVISE without an STM citation';
  }

  if (ctx.guideline === null && action === 'ADVISE') {
    action = 'ASK_PERSON';
    stm = null;
    body = S.no_guideline;
    overridden = true;
    reason = 'retrieval found no supporting STM chunk';
  }

  const scope = outOfScope(message);
  if (scope && !hits.length && action !== 'ASK_PERSON') {
    action = 'ASK_PERSON';
    stm = null;
    body = (flags?.lang === 'en' ? 'The STM for Children does not cover this patient. ' : 'STM for Children no kavarem disfala pesen. ') + S.abstain;
    overridden = true;
    reason = `out of scope for the children's manual: "${scope}"`;
  }

  if (hits.length) {
    const wantsNext = flags?.transport === 'next_boat' && reply.action === 'REFER_NEXT_TRANSPORT';
    const forced: Action = wantsNext ? 'REFER_NEXT_TRANSPORT' : 'REFER_NOW';
    if (action !== forced || !reply.valid) {
      const lead = forced === 'REFER_NOW' ? S.refer_now : S.refer_next;
      const extra = flags?.transport === 'none' ? `\n${S.no_transport}` : '';
      const keep = reply.valid && !isNote && (reply.action === 'REFER_NOW' || reply.action === 'REFER_NEXT_TRANSPORT') ? `\n${reply.body}` : '';
      action = forced;
      body = `${lead}${extra}${keep}`.trim();
      if (!stm && reply.stm) stm = reply.stm;
      overridden = true;
      reason = `red flag: ${hits.map((h) => h.label_en).join(', ')}`;
    } else {
      reason = `red flag confirmed by model: ${hits.map((h) => h.label_en).join(', ')}`;
    }
  }

  if (!isNote) body = clampLines(body, ctx.maxLines ?? 6);
  return { action, stm, body, reply: body, red_flags, red_flag_labels, overridden, reason: overridden || hits.length ? reason : null, original: reply };
}
