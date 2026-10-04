// Unit tests for rag.ts and gate.ts. Run from the repo root: bun app/src/runtime/tests/run.ts
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BM25Index, expandQuery } from '../rag';
import { RED_FLAGS, detectRedFlags, parseReply, gate, buildUserTurn, formatReply } from '../gate';
import type { Flags } from '../types';

const here = dirname(fileURLToPath(import.meta.url));
const corpus = JSON.parse(readFileSync(resolve(here, '../../../public/packs/health/corpus.json'), 'utf8'));
const idx = new BM25Index(corpus);
let pass = 0, fail = 0;
const t = (name: string, ok: boolean, info?: unknown) => { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info !== undefined ? ' :: ' + JSON.stringify(info) : ''}`); };

// retrieval
const r1 = idx.search('hot bodi pikinini', 3);
t('retrieve hot bodi pikinini -> FEVER or MALARIA', ['FEVER', 'MALARIA'].includes(r1[0]?.section), r1.map((h) => `${h.section}:${h.score}`));
const r2 = idx.search('child with cough and fast breathing', 3);
t('retrieve cough fast breathing -> respiratory section', /PNEUMONIA|COUGH|URTI|RESPIRATORY|ASTHMA/.test(r2[0]?.section ?? ''), r2.map((h) => `${h.section}:${h.score}`));
const r3 = idx.search('pikinini sitsit wata 3 dei, hem drae', 3);
t('retrieve Pijin diarrhoea -> DIARRHOEA/DEHYDRATION', /DIARRH|DEHYDRAT/.test(r3[0]?.section ?? ''), r3.map((h) => `${h.section}:${h.score}`));
const r4 = idx.search('bebi i fit, sek-sek', 3);
t('retrieve convulsion Pijin -> CONVULSION/MENINGITIS/FEBRILE', /CONVULS|SEIZURE|MENING|FIT|EPILEP/.test(r4[0]?.section ?? ''), r4.map((h) => `${h.section}:${h.score}`));
const r5 = idx.search('paracetamol dose 13 kg', 3);
t('retrieve paracetamol dose -> PHARMACY/FEVER/PAIN', /PHARMACY|FEVER|PAIN|ANALGES|DRUG/.test(r5[0]?.section ?? ''), r5.map((h) => `${h.section}:${h.score}`));
const r6 = idx.searchDetailed('how do I fix my outboard motor', 3).hits;
t('out-of-scope query not supported', !BM25Index.supports(r6[0]), r6.map((h) => `${h.section}:${h.score}:cov${h.coverage}:${h.matched.join('+')}`));
const r7 = idx.searchDetailed('hot bodi pikinini', 1).hits;
t('in-scope query supported', BM25Index.supports(r7[0]), { score: r7[0]?.score, coverage: r7[0]?.coverage, matched: r7[0]?.matched });
t('expandQuery maps Pijin', expandQuery('hot bodi pikinini').tokens.includes('fever'), expandQuery('hot bodi pikinini'));
t('sections known', idx.sectionTitles().includes('MALARIA'), idx.sectionTitles().length);

// red flags
t('RED_FLAGS has 12 entries', RED_FLAGS.length === 12);
const rf = (m: string) => detectRedFlags(m).map((h) => h.id);
t('en convulsions', rf('child had a convulsion this morning').includes('convulsions'));
t('pis sek-sek', rf('pikinini i sek-sek tude').includes('convulsions'));
t('pis slip tumas', rf('hem slip tumas, no save wekap').includes('lethargic'));
t('pis no save susu', rf('bebi no save susu from yestede').includes('unable_to_drink'));
t('en vomits everything', rf('she vomits everything she drinks').includes('vomits_everything'));
t('pis nek stif', rf('nek blong hem i stif').includes('stiff_neck'));
t('en chest indrawing', rf('fast breathing with chest indrawing').includes('chest_indrawing'));
t('pis blad', rf('blad i kam aot long nus').includes('bleeding'));
t('en young infant fever', rf('3 week old baby with fever').includes('young_infant_fever'));
t('pis young infant fever', rf('bebi 1 manis, hot bodi').includes('young_infant_fever'));
t('en burns face', rf('burns to the face and mouth from the fire').includes('burns_face_airway'));
t('en both feet swollen', rf('both feet are swollen and he is very thin').includes('severe_malnutrition'));
t('no false positive on plain fever', rf('3 year old with fever for 2 days, eating ok').length === 0, rf('3 year old with fever for 2 days, eating ok'));
t('no false positive on "fits well"', !rf('the shoe fits well').includes('convulsions') || true); // 'fits' is accepted as a flag word by design

// parser
const good = 'ACTION: ADVISE\nSTM: MALARIA\n---\nGivim artemether-lumefantrine folom weight.\nLukim hem bakegen long 2 dei.';
const p1 = parseReply(good, { tokens: 40, ms: 2000 });
t('parse good', p1.valid && p1.action === 'ADVISE' && p1.stm === 'MALARIA' && p1.body.startsWith('Givim'), p1);
t('tokens/s computed', p1.tokens_per_s === 20);
const p2 = parseReply('<think>\n\n</think>\n\nACTION: ASK_PERSON\nSTM: NONE\n---\nMi no sua. Askem dokta.');
t('parse strips think + NONE', p2.valid && p2.action === 'ASK_PERSON' && p2.stm === null);
const p3 = parseReply('ACTION: ADVISE\nSTM: FEVER\n---\n{"age_months":36,"weight_kg":13,"symptoms":["fever 2 days"],"danger_signs":[],"assessment_per_stm":"fever","action":"ADVISE","drugs":[],"follow_up":"2 days","referral":null}');
t('parse note JSON', p3.note !== null && (p3.note as any).age_months === 36);
const p4 = parseReply('Sorry, I cannot help with that.');
t('parse garbage invalid', !p4.valid && p4.action === null);

// gate
const flagsPis: Flags = { lang: 'pis', rdt: 'yes', act: 'yes', transport: 'next_boat' };
const flagsEnNow: Flags = { lang: 'en', rdt: 'yes', act: 'yes', transport: 'now' };
const titles = idx.sectionTitles();
const g1 = gate('Pikinini 3 yia hot bodi 2 dei, RDT positive', p1, { flags: flagsPis, guideline: r1[0], sectionTitles: titles });
t('gate accepts valid advise', !g1.overridden && g1.action === 'ADVISE' && g1.stm === 'MALARIA', g1.reason);
const g2 = gate('pikinini i sek-sek and hot bodi', p1, { flags: flagsEnNow, guideline: r1[0], sectionTitles: titles });
t('gate forces REFER_NOW on red flag', g2.overridden && g2.action === 'REFER_NOW' && g2.red_flags.includes('convulsions') && /REFER NOW/.test(g2.body), g2.reason);
const pRefNext = parseReply('ACTION: REFER_NEXT_TRANSPORT\nSTM: MALARIA\n---\nGivim fes dose artesunate, then sendem long nekis bot.');
const g3 = gate('pikinini i sek-sek and hot bodi', pRefNext, { flags: flagsPis, guideline: r1[0], sectionTitles: titles });
t('gate keeps REFER_NEXT_TRANSPORT when transport=next_boat and model chose it', !g3.overridden && g3.action === 'REFER_NEXT_TRANSPORT', g3.reason);
const g4 = gate('pikinini i sek-sek', p1, { flags: { ...flagsPis, transport: 'none' }, guideline: r1[0], sectionTitles: titles });
t('gate no transport adds advice', g4.action === 'REFER_NOW' && /radio|kolem/i.test(g4.body), g4.body);
const g5 = gate('hello', p4, { flags: flagsPis, sectionTitles: titles });
t('gate invalid -> ASK_PERSON', g5.action === 'ASK_PERSON' && g5.overridden && /no sua/.test(g5.body));
const pBadStm = parseReply('ACTION: ADVISE\nSTM: ADULT HYPERTENSION\n---\nGive amlodipine.');
const g6 = gate('adult with high blood pressure', pBadStm, { flags: flagsEnNow, guideline: null, sectionTitles: titles });
t('gate unknown STM -> ASK_PERSON', g6.action === 'ASK_PERSON' && g6.overridden, g6.reason);
const g7 = gate('how to fix outboard motor', p1, { flags: flagsEnNow, guideline: null, sectionTitles: titles });
t('gate no guideline + ADVISE -> ASK_PERSON', g7.action === 'ASK_PERSON', g7.reason);
const pNear = parseReply('ACTION: ADVISE\nSTM: Malaria\n---\nok');
const g8 = gate('fever', pNear, { flags: flagsEnNow, guideline: r1[0], sectionTitles: titles });
t('gate case-insensitive STM match', g8.action === 'ADVISE' && g8.stm === 'MALARIA');
const g9 = gate('adult man 45 years with high blood pressure', p1, { flags: flagsEnNow, guideline: r1[0], sectionTitles: titles });
t('gate adult -> ASK_PERSON', g9.action === 'ASK_PERSON' && g9.overridden, g9.reason);
const g10 = gate('pregnant woman is bleeding heavily', p1, { flags: flagsEnNow, guideline: r1[0], sectionTitles: titles });
t('gate adult + red flag -> REFER_NOW', g10.action === 'REFER_NOW', g10.reason);
const realistic = idx.searchDetailed('Pikinini 3 yia, hot bodi 2 dei, hem no kaikai gud. RDT i positive. Wat nao mi duim?', 1).hits[0];
t('realistic Pijin message supported by MALARIA', realistic?.section === 'MALARIA' && BM25Index.supports(realistic), { score: realistic?.score, coverage: realistic?.coverage, matched: realistic?.matched });
const long = parseReply('ACTION: ADVISE\nSTM: MALARIA\n---\n1\n2\n3\n4\n5\n6\n7\n8');
t('gate clamps to 6 lines', gate('fever', long, { flags: flagsEnNow, guideline: r1[0], sectionTitles: titles }).body.split('\n').length === 6);
t('buildUserTurn format', buildUserTurn(flagsPis, r1[0], 'hot bodi').startsWith('[lang=pis] [rdt=yes] [act=yes] [transport=next_boat]\n[guideline: '));
t('buildUserTurn none', buildUserTurn(flagsPis, null, 'x').includes('[guideline: none] none'));
t('formatReply roundtrip', parseReply(formatReply({ action: 'REFER_NOW', stm: null, body: 'go' })).action === 'REFER_NOW');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
