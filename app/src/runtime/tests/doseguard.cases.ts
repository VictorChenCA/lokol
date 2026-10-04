// Dose-guard tests. The cases in doseguard_cases.json are shared with bridge/tests/test_doseguard.py,
// so the app and the bridge are checked against the same expectations.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractDoses, guardDoses } from '../doseguard';
import { gate, parseReply, detectRedFlags } from '../gate';
import type { Chunk, Flags } from '../types';

type T = (name: string, ok: boolean, info?: unknown) => void;

interface Case {
  name: string;
  body: string;
  excerpt: string | null;
  message: string;
  page: number | null;
  lang: string;
  expect_body: string | null; // null = body unchanged
  expect_unsupported: string[];
}

const here = dirname(fileURLToPath(import.meta.url));

export function runDoseGuardTests(t: T) {
  const cases: Case[] = JSON.parse(readFileSync(resolve(here, 'doseguard_cases.json'), 'utf8'));
  for (const c of cases) {
    const r = guardDoses(c.body, c.excerpt, c.message, c.page, c.lang);
    const want = c.expect_body ?? c.body;
    const ok = r.body === want && JSON.stringify(r.unsupported) === JSON.stringify(c.expect_unsupported);
    t(`doseguard: ${c.name}`, ok, ok ? undefined : { got: r, want: { body: want, unsupported: c.expect_unsupported } });
  }

  const units = (s: string) => extractDoses(s).map((d) => `${d.lo}-${d.hi} ${d.unit}`);
  t('doseguard: non-doses are not extracted', units('3 days, 2 years, 38.5 C, p53, 12 kg, 13 kilo, 5 good, 2 units').length === 0, units('3 days, 2 years, 38.5 C, p53, 12 kg, 13 kilo, 5 good, 2 units'));
  t('doseguard: units normalised', JSON.stringify(units('10 mcg/kg, 2.5mL, 1,000 mg, 50 units/kg, 2 IU, 1 g/kg')) === JSON.stringify(['10-10 mcg/kg', '2.5-2.5 ml', '1000-1000 mg', '50-50 units/kg', '2-2 iu', '1-1 g/kg']), units('10 mcg/kg, 2.5mL, 1,000 mg, 50 units/kg, 2 IU, 1 g/kg'));

  // gate integration: the guard runs after the action/red-flag logic; ACTION does not change.
  const conv: Chunk = { id: 'stm-c-034-convulsions-03', section: 'CONVULSIONS', subsection: '', page: 34, text: cases[0].excerpt ?? '' };
  const fever: Chunk = { id: 'stm-c-040-fever-01', section: 'FEVER', subsection: '', page: 40, text: cases[1].excerpt ?? '' };
  const en: Flags = { lang: 'en', rdt: 'yes', act: 'yes', transport: 'now' };
  const pis: Flags = { lang: 'pis', rdt: 'yes', act: 'yes', transport: 'next_boat' };
  const titles = ['CONVULSIONS', 'FEVER', 'MALARIA'];

  const pMid = parseReply('ACTION: REFER_NOW\nSTM: CONVULSIONS\n---\nGive midazolam 20 mg/kg rectally.\nRefer to hospital now.');
  const g1 = gate('child fitting for 10 minutes, 12 kg', pMid, { flags: en, guideline: conv, sectionTitles: titles });
  t('gate: midazolam 20 mg/kg replaced, REFER_NOW kept', g1.action === 'REFER_NOW' && g1.overridden && !/20 mg\/kg/.test(g1.body) && /manual page 34/.test(g1.body) && /unsupported_dose: 20 mg\/kg/.test(g1.reason ?? '') && g1.unsupported_doses?.[0] === '20 mg/kg', g1);

  const pPara = parseReply('ACTION: ADVISE\nSTM: FEVER\n---\nGivim paracetamol 195 mg evri 6 aoa.\nKambak long 2 dei.');
  const g2 = gate('Pikinini 3 yia, 13 kg, hot bodi 2 dei', pPara, { flags: pis, guideline: fever, sectionTitles: titles });
  t('gate: grounded 195 mg (13 kg x 15mg/kg) kept, not overridden', g2.action === 'ADVISE' && !g2.overridden && /195 mg/.test(g2.body) && g2.reason === null, g2);

  const pIv = parseReply('ACTION: ADVISE\nSTM: FEVER\n---\nGivim paracetamol 30 mg/kg IV.\nKambak long 2 dei.');
  const g3 = gate('Pikinini 3 yia, hot bodi 2 dei', pIv, { flags: pis, guideline: fever, sectionTitles: titles });
  t('gate: Pijin unsupported dose -> Pijin page line, ADVISE kept', g3.action === 'ADVISE' && g3.overridden && g3.body.startsWith('Dos: lukim buk STM pej 40') && /Kambak/.test(g3.body), g3);

  const g4 = gate('child fitting now', pMid, { flags: en, sectionTitles: titles });
  t('gate: no guideline in context -> ask-person dose line', g4.action === 'REFER_NOW' && g4.body.includes('Dose: ask the nurse in charge or the doctor.') && !/20 mg\/kg/.test(g4.body), g4.body);

  const pRed = parseReply('ACTION: REFER_NOW\nSTM: FEVER\n---\nGive paracetamol 40 mg/kg.\nRefer now.');
  const g5 = gate('child with fever and a convulsion', pRed, { flags: en, guideline: fever, sectionTitles: titles });
  t('gate: red-flag reason kept and dose reason appended', g5.action === 'REFER_NOW' && g5.overridden && g5.reason === 'red flag confirmed by model: convulsions; unsupported_dose: 40 mg/kg' && !/40 mg/.test(g5.body), g5);

  // negation parity with bridge/gate.py (same phrases in bridge/tests/test_gate.py)
  for (const m of ['Pikinini 3 yia, hot bodi tu dei, no kaikai gud. No fit.', 'Visit note: no danger signs, RDT positive', 'pikinini hot bodi, nogat fit, hem dring gud', 'pikinini kof, nomoa sek-sek', 'fever 2 days, neva fit, no stiff neck']) {
    t(`negated sign is not a red flag: ${m}`, detectRedFlags(m).length === 0, detectRedFlags(m));
  }
  t('negation does not mask a later real sign', detectRedFlags('nogat kof, hem sek-sek tude').some((h) => h.id === 'convulsions'));
}
