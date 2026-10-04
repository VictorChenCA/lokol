import { loadPack, fetchManifest, playAudioBuffer, recordMic, type Engine, type Flags, type LoadProgress } from '../engine';
import { BM25Index } from '../rag';

const $ = (id: string) => document.getElementById(id)!;
const logEl = $('log') as HTMLPreElement;
const resEl = $('result') as HTMLPreElement;
const log = (...a: unknown[]) => {
  const line = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
  logEl.textContent += line + '\n';
  logEl.scrollTop = logEl.scrollHeight;
  console.log('[lokol]', ...a);
};
const setResult = (obj: unknown) => (resEl.textContent = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2));
const results: Record<string, unknown> = {};
(window as any).lokolResults = results;

$('iso').textContent = `isolation: ${crossOriginIsolated ? 'yes (multi-thread)' : 'no (single-thread)'}`;
const net = () => ($('net').textContent = navigator.onLine ? 'online' : 'offline');
addEventListener('online', net); addEventListener('offline', net); net();

let engine: Engine | null = null;
const qp = new URLSearchParams(location.search);
const MAXTOK = Number(qp.get('maxtok') ?? 220);
const flags = (): Flags => ({ lang: ($('lang') as HTMLSelectElement).value as any, rdt: ($('rdt') as HTMLSelectElement).value as any, act: ($('act') as HTMLSelectElement).value as any, transport: ($('transport') as HTMLSelectElement).value as any });

let lastPct = -1;
const onProgress = (p: LoadProgress) => {
  if (p.pct !== undefined) ($('prog') as HTMLProgressElement).value = p.pct;
  $('prog-text').textContent = p.message;
  const decile = p.pct === undefined ? -1 : Math.floor(p.pct / 10);
  if (p.stage !== 'download' || decile !== lastPct) log(`[${p.role ?? p.stage}] ${p.message}`);
  lastPct = decile;
};

async function load() {
  if (engine) return engine;
  const t0 = performance.now();
  const manifest = await fetchManifest('/packs/health/manifest.json');
  const llmOverride = qp.get('llm');
  if (llmOverride) {
    const llm = manifest.models.find((m) => m.role === 'llm')!;
    llm.url = llmOverride; llm.id = llmOverride.split('/').pop() ?? llmOverride; llm.fallbacks = [];
    log('LLM override', llmOverride);
  }
  log('manifest', manifest.graph?.name ?? manifest.name, 'models:', manifest.models.map((m) => m.id).join(', '));
  engine = await loadPack(manifest, onProgress, { preload: ['llm'], llm: { native_log: qp.get('log') === '1', n_ctx: Number(qp.get('nctx') ?? 2048), n_threads: qp.get('threads') ? Number(qp.get('threads')) : undefined } });
  (window as any).lokol = engine;
  const st = engine.status();
  results.load = { ms: Math.round(performance.now() - t0), status: st, llm: engine.llm.info };
  log('loaded in', Math.round(performance.now() - t0), 'ms', 'arch', st.llm_arch, 'fallback', st.llm_fallback_used);
  setResult(results.load);
  return engine;
}

async function retrieve() {
  const e = await load();
  const q = ($('msg') as HTMLTextAreaElement).value;
  const t0 = performance.now();
  const hits = await e.retrieve(q, 5);
  const fixed = await e.retrieve('hot bodi pikinini', 3);
  results.retrieve = { query: q, ms: Math.round(performance.now() - t0), hits: hits.map((h) => ({ id: h.id, section: h.section, page: h.page, score: h.score })), hot_bodi_pikinini: fixed.map((h) => ({ id: h.id, section: h.section, score: h.score })) };
  setResult(results.retrieve);
}

async function ask() {
  const e = await load();
  e.llm.mode = ($('mode') as HTMLSelectElement).value as any;
  const q = ($('msg') as HTMLTextAreaElement).value;
  let streamed = '';
  const t0 = performance.now();
  const onToken = (_t: string, text: string) => { streamed = text; $('prog-text').textContent = `generating ${text.length} chars`; };
  let r;
  if (qp.get('short') === '1') {
    // short prompt: no guideline excerpt (~80 prompt tokens) to separate "long prefill hangs" from "model broken"
    const reply = await e.generate(flags(), null, q, { onToken, max_tokens: MAXTOK });
    r = { chunks: [], guideline: null, reply, gate: e.gate(q, reply, flags(), null), prompt: e.buildPrompt(flags(), null, q).user };
  } else {
    r = await e.ask(q, flags(), { onToken, max_tokens: MAXTOK });
  }
  results.ask = {
    message: q, flags: flags(), mode: e.llm.mode, ms_total: Math.round(performance.now() - t0),
    guideline: r.guideline ? { id: r.guideline.id, section: r.guideline.section, page: r.guideline.page, score: r.guideline.score } : null,
    reply: { action: r.reply.action, stm: r.reply.stm, valid: r.reply.valid, tokens: r.reply.tokens, ms: r.reply.ms, tokens_per_s: r.reply.tokens_per_s, prompt_tokens: r.reply.prompt_tokens, prompt_ms: r.reply.prompt_ms, body: r.reply.body, raw: r.reply.raw },
    gate: { action: r.gate.action, stm: r.gate.stm, overridden: r.gate.overridden, reason: r.gate.reason, red_flags: r.gate.red_flags, body: r.gate.body },
    prompt: r.prompt, streamed_chars: streamed.length,
  };
  setResult(results.ask);
  log('ask done', r.reply.tokens, 'tokens', r.reply.tokens_per_s, 'tok/s', 'gate', r.gate.action);
}

async function tts(lang: 'pis' | 'en') {
  const e = await load();
  const text = lang === 'pis' ? 'Mi no sua, askem nes.' : 'Refer now. This child has a danger sign.';
  const t0 = performance.now();
  const pcm = await e.speakPCM(text, lang, onProgress);
  let peak = 0, sum = 0;
  for (let i = 0; i < pcm.audio.length; i++) { const v = Math.abs(pcm.audio[i]); peak = Math.max(peak, v); sum += v * v; }
  results[`tts_${lang}`] = { text, samples: pcm.audio.length, sampling_rate: pcm.sampling_rate, seconds: Number(pcm.seconds.toFixed(2)), synth_ms: pcm.ms, total_ms: Math.round(performance.now() - t0), peak: Number(peak.toFixed(3)), rms: Number(Math.sqrt(sum / pcm.audio.length).toFixed(4)), model: e.status().models.find((m) => m.role === `tts_${lang}`)?.id };
  setResult(results[`tts_${lang}`]);
  try { await playAudioBuffer(await e.speak(text, lang)); } catch (err) { log('playback blocked (needs a user gesture)', String(err)); }
}

async function stt() {
  const e = await load();
  log('recording 5 s... speak English');
  const rec = recordMic(5);
  const blob = await rec.done;
  const r = await e.transcribeDetailed(blob, 'en', onProgress);
  results.stt = { blob_bytes: blob.size, ...r };
  setResult(results.stt);
}

function status() {
  setResult(engine ? engine.status() : 'not loaded');
}

async function auto() {
  try {
    await load(); await retrieve(); await ask(); await tts('pis');
    results.auto_done = true;
    setResult(results);
    log('AUTO DONE');
  } catch (err: any) {
    results.auto_error = String(err?.stack ?? err);
    setResult(results);
    log('AUTO ERROR', String(err?.stack ?? err));
  }
}

const guard = (fn: () => Promise<unknown> | unknown) => async () => {
  try { await fn(); } catch (err: any) { log('ERROR', String(err?.stack ?? err)); setResult({ error: String(err?.message ?? err) }); }
};
$('btn-load').onclick = guard(load);
$('btn-retrieve').onclick = guard(retrieve);
$('btn-ask').onclick = guard(ask);
$('btn-tts-pis').onclick = guard(() => tts('pis'));
$('btn-tts-en').onclick = guard(() => tts('en'));
$('btn-stt').onclick = guard(stt);
$('btn-status').onclick = guard(status);
$('btn-auto').onclick = guard(auto);

// retrieval needs no model: run it immediately as a sanity check
(async () => {
  const corpus = await (await fetch('/packs/health/corpus.json')).json();
  const idx = new BM25Index(corpus);
  const hits = idx.search('hot bodi pikinini', 3);
  results.retrieve_boot = hits.map((h) => ({ id: h.id, section: h.section, score: h.score }));
  log('corpus', idx.size, 'chunks; hot bodi pikinini ->', hits.map((h) => `${h.section} (${h.score})`).join(' | '));
})();

if (new URLSearchParams(location.search).get('auto') === '1') auto();
