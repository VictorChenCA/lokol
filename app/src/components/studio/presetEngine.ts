import type { Action, Chunk, Engine, Flags, GateResult, ParsedReply, Sector } from "../../types";

/**
 * Farm and Host are preset packs: same nodes as Lokol Health, but their guide corpus is a placeholder
 * and no tuned model exists yet. A trace on them must not answer with the child treatment manual, so
 * guideline lookup, the language model and the safety gate are answered from this small sample set.
 * Speech in and speech out still use the loaded engine.
 */

interface Case {
  match: RegExp;
  chunk: Chunk | null;
  action: Action;
  lang: "pis" | "en";
  body: string;
  /** The same reply in English, for a question asked in English. */
  en?: string;
  flags?: string[];
  reason?: string;
}

const FARM: Case[] = [
  {
    match: /taro|lif|leaf|yelo|yellow|hol\b/i,
    chunk: {
      id: "farm-taro-blight",
      section: "TARO LEAF BLIGHT",
      subsection: "Sample farm guide (placeholder corpus)",
      page: 14,
      score: 7.2,
      text: "Brown, water-soaked spots that grow and join, then holes and yellowing. Spreads in wet weather. Remove and burn sick leaves, space plants for air, replant with a tolerant variety. Ask the extension officer if more than half the garden is affected."
    },
    action: "ADVISE",
    lang: "pis",
    body: "Diswan luk olsem taro lif blait.\nKatem an bonem olketa lif wea garem sik, no torowem long gaden.\nNo plantem taro kolosap tumas, mekem win save go thru.\nSapos sik hem kasem haf gaden, askem extension officer.",
    en: "This looks like taro leaf blight.\nCut off and burn the sick leaves; do not leave them in the garden.\nDo not plant taro too close together, so air can move through.\nIf more than half the garden is affected, ask the extension officer."
  },
  {
    match: /spray|chemical|poison|pesticide|cabbage|moth/i,
    chunk: {
      id: "farm-pesticide-safety",
      section: "PESTICIDE SAFETY",
      subsection: "Sample farm guide (placeholder corpus)",
      page: 31,
      score: 6.4,
      text: "Never mix or spray within 30 m of a drinking-water source. Only use products on the approved list, at the label rate. If unsure which product is allowed, ask the extension officer before buying."
    },
    action: "ASK_PERSON",
    lang: "en",
    body: "I can't recommend a spray to use near the village well.\nAsk your extension officer which product is allowed, and keep any spraying at least 30 m from drinking water.\nUntil then, pick the moth caterpillars off by hand in the early morning.",
    flags: ["Chemical near drinking water"],
    reason: "Rule: refer to the extension officer when a chemical is involved near water."
  }
];

const HOST: Case[] = [
  {
    match: /bot|boat|ferry|gizo|sip|ship/i,
    chunk: {
      id: "host-ferry",
      section: "GETTING HERE",
      subsection: "Sample guesthouse listing (placeholder corpus)",
      page: 2,
      score: 6.9,
      text: "Sample timetable: the Gizo boat leaves Honiara on Friday evening and arrives Saturday morning. Times change with weather; guests should confirm with the shipping office the day before."
    },
    action: "ADVISE",
    lang: "pis",
    body: "Long sample taem tebol, bot i go long Gizo long Fraede long ivining, an hem kasem Gizo long Sarere moning.\nPlis sekem wetem shipping ofis long Tosde, from taem save sens long weta.",
    en: "In the sample timetable, the Gizo boat leaves on Friday evening and arrives in Gizo on Saturday morning.\nPlease check with the shipping office on Thursday, because times change with the weather."
  },
  {
    match: /room|book|price|how much|night|stay/i,
    chunk: {
      id: "host-rooms",
      section: "ROOMS AND RATES",
      subsection: "Sample guesthouse listing (placeholder corpus)",
      page: 1,
      score: 5.8,
      text: "Two twin rooms and one double room with a sea view. Rates and availability are confirmed by the owner; Lokol never takes a booking or quotes a price on its own."
    },
    action: "ASK_PERSON",
    lang: "en",
    body: "I can't confirm a booking or a price myself.\nI've passed your request for a room for two this Friday to the owner, who will reply when they have signal.",
    flags: ["Booking or price request"],
    reason: "Rule: bookings and prices always go to the owner."
  }
];

const FALLBACK: Record<"pis" | "en", string> = {
  pis: "Mi no sua long diswan. Gaed hem no garem ansa.\nPlis askem wanfala man wea save.",
  en: "I'm not sure about this one; the guide has no matching section.\nPlease ask a person who knows."
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function presetEngine(base: Engine, sector: Sector): Engine {
  const cases = sector === "agriculture" ? FARM : HOST;
  const pick = (q: string) => cases.find((c) => c.match.test(q)) ?? null;

  return {
    transcribe: (audio, lang) => base.transcribe(audio, lang),
    speak: (text, lang) => base.speak(text, lang),
    status: () => base.status(),
    async retrieve(query: string): Promise<Chunk[]> {
      await sleep(120);
      const c = pick(query);
      return c?.chunk ? [c.chunk] : [];
    },
    async generate(flags: Flags, chunk: Chunk | null, message: string, onToken?: (t: string) => void): Promise<ParsedReply> {
      const c = pick(message);
      const action: Action = c?.action ?? "ASK_PERSON";
      const stm = chunk?.section ?? "NONE";
      const body = c ? (flags.lang === "en" && c.en ? c.en : c.body) : FALLBACK[flags.lang === "pis" ? "pis" : "en"];
      const raw = `ACTION: ${action}\nSTM: ${stm}\n---\n${body}`;
      const t0 = performance.now();
      const parts = raw.split(/(\s+)/);
      for (const p of parts) {
        onToken?.(p);
        if (p.trim()) await sleep(28);
      }
      const ms = Math.round(performance.now() - t0);
      const tokens = parts.filter((p) => p.trim()).length;
      return { action, stm, body, raw, stats: { ms, tokens, tps: tokens / Math.max(0.001, ms / 1000) } };
    },
    gate(message: string, reply: ParsedReply): GateResult {
      const c = pick(message);
      return {
        action: reply.action,
        reason: c?.reason ?? null,
        red_flags: c?.flags ?? [],
        red_flag_labels: c?.flags ?? [],
        reply: reply.body,
        overridden: false,
        stm: reply.stm === "NONE" ? null : reply.stm
      };
    }
  };
}
