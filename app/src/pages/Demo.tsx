import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { Action, Chunk, Flags } from "../types";
import { ACTION_META, SAMPLES, guessTask, type Sample, type Task } from "../components/demo/copy";
import { ReplyCard, UserBubble, type BotMsg, type Msg, type VoiceState } from "../components/demo/ReplyCard";
import { Composer, ConnectivityChip, FlagChips, LoadCard, ModelChip, RuntimeFooter } from "../components/demo/parts";
import { PipelinePanel } from "../components/demo/PipelinePanel";
import { useDemoEngine, useInstallPrompt, useOnline } from "../components/demo/useDemoEngine";

const ACTIONS: Action[] = ["ADVISE", "REFER_NOW", "REFER_NEXT_TRANSPORT", "ASK_PERSON"];
const NOTES_KEY = "lokol.health.notes";

function partial(raw: string): { action: Action | null; body: string } {
  const a = /ACTION\s*:\s*([A-Z_]+)\s*\n/i.exec(raw);
  const action = a && ACTIONS.includes(a[1].toUpperCase() as Action) ? (a[1].toUpperCase() as Action) : null;
  const i = raw.indexOf("---");
  const body = i >= 0 ? raw.slice(i + 3).replace(/^-+/, "").trimStart() : "";
  return { action, body: body.startsWith("{") ? "" : body };
}

function citeChunk(stm: string | null | undefined, chunks: Chunk[]): Chunk | null {
  if (!stm || /^none$/i.test(stm)) return null;
  const up = stm.toUpperCase();
  return chunks.find((c) => c.section.toUpperCase() === up) ?? chunks.find((c) => up.includes(c.section.toUpperCase()) || c.section.toUpperCase().includes(up)) ?? { id: `stm-${up}`, section: stm, page: 0, text: "" };
}

export default function Demo() {
  const online = useOnline();
  const { manifest, packNote, engine, source, progress, error, status, loadMs, refreshStatus, retry } = useDemoEngine();
  const install = useInstallPrompt();
  const shim = source === "shim";
  const [flags, setFlags] = useState<Flags>({ lang: "pis", rdt: "yes", act: "yes", transport: "next_boat" });
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [hits, setHits] = useState<Chunk[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const [micNote, setMicNote] = useState<null | { kind: "pis" | "info" | "error"; text: string }>(null);
  const [voice, setVoice] = useState<VoiceState>({ id: null, phase: "idle" });
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [savedIds, setSavedIds] = useState<Set<number>>(new Set());
  const [installDismissed, setInstallDismissed] = useState(false);
  const idRef = useRef(1);
  const endRef = useRef<HTMLDivElement>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<number | null>(null);
  const audioRef = useRef<{ ctx: AudioContext; src: AudioBufferSourceNode | null } | null>(null);

  const ready = !!engine;
  const pis = flags.lang === "pis";
  const lastBot = useMemo(() => [...msgs].reverse().find((m): m is BotMsg => m.role === "bot") ?? null, [msgs]);
  const lastDone = useMemo(() => [...msgs].reverse().find((m): m is BotMsg => m.role === "bot" && m.stage === "done") ?? null, [msgs]);

  useEffect(() => {
    if (msgs.length) endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [msgs]);

  const patch = (id: number, p: Partial<BotMsg>) => setMsgs((all) => all.map((m) => (m.id === id && m.role === "bot" ? { ...m, ...p } : m)));

  const send = useCallback(
    async (textIn: string, opt: { task?: Task; flags?: Flags; via?: "voice" | "text" } = {}) => {
      const text = textIn.trim();
      if (!engine || !text || busy) return;
      const f = opt.flags ?? flags;
      const task = opt.task ?? guessTask(text);
      setBusy(true);
      setInput("");
      setMicNote(null);
      const uid = idRef.current++;
      const bid = idRef.current++;
      setMsgs((all) => [...all, { id: uid, role: "user", text, lang: f.lang, via: opt.via }, { id: bid, role: "bot", lang: f.lang, stage: "lookup", text: "", task }]);
      try {
        const chunks = await engine.retrieve(text);
        setHits(chunks);
        const top = chunks[0] ?? null;
        patch(bid, { stage: "prefill" });
        let raw = "";
        let lastAction: Action | null = null;
        let lastBody = "";
        const onToken = (delta: string, full?: string) => {
          raw = typeof full === "string" ? full : raw + delta;
          const p = partial(raw);
          if (p.action !== lastAction || p.body !== lastBody) {
            lastAction = p.action;
            lastBody = p.body;
            patch(bid, { provisional: p.action, text: p.body, stage: p.body ? "writing" : "prefill" });
          }
        };
        let lastPct = -1;
        const onPrefill = (p: { processed: number; total: number }) => {
          const pct = p.total ? Math.floor((p.processed / p.total) * 20) : 0;
          if (pct !== lastPct) {
            lastPct = pct;
            patch(bid, { prefill: p });
          }
        };
        const parsed: any = shim ? await engine.generate(f, top, text, onToken) : await engine.generate(f, top, text, { onToken, onPrefill, task });
        const g: any = engine.gate(text, parsed);
        const stm: string | null =
          g.stm !== undefined ? g.stm : g.overridden && g.red_flags?.length ? "DANGER SIGNS AND REFERRAL" : parsed.stm && parsed.stm !== "NONE" ? parsed.stm : null;
        const note = parsed.note && typeof parsed.note === "object" && g.action !== "ASK_PERSON" ? (parsed.note as Record<string, unknown>) : null;
        patch(bid, {
          stage: "done",
          action: g.action,
          stm,
          chunk: citeChunk(stm, chunks),
          text: g.reply ?? g.body ?? parsed.body,
          overridden: g.overridden,
          reason: g.reason,
          redFlags: g.red_flag_labels ?? g.red_flags,
          stats: parsed.stats ?? { ms: parsed.ms, tokens: parsed.tokens, tps: parsed.tokens_per_s },
          note,
          valid: parsed.valid
        });
        refreshStatus();
      } catch (e) {
        patch(bid, { stage: "error", error: (e as Error).message });
      } finally {
        setBusy(false);
      }
    },
    [engine, flags, busy, shim, refreshStatus]
  );

  const runSample = (s: Sample) => {
    const f = { ...flags, ...s.flags, lang: s.lang };
    setFlags(f);
    void send(s.text, { task: s.task, flags: f });
  };

  /* ---------- voice out ---------- */

  const stopVoice = () => {
    try {
      audioRef.current?.src?.stop();
    } catch {
      /* already stopped */
    }
    setVoice({ id: null, phase: "idle" });
  };

  const play = async (m: BotMsg) => {
    if (!engine || voice.phase !== "idle") return;
    // Create the AudioContext inside the tap so mobile browsers allow playback.
    const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    if (!audioRef.current) audioRef.current = { ctx: new Ctx(), src: null };
    const ctx = audioRef.current.ctx;
    void ctx.resume();
    const meta = ACTION_META[m.action ?? "ASK_PERSON"];
    const say = `${m.lang === "pis" ? meta.pis : meta.en}. ${m.text}`.replace(/\n+/g, ". ").replace(/\.\s*\./g, ".");
    setVoice({ id: m.id, phase: "speaking" });
    try {
      let buf: AudioBuffer;
      if (engine.speakPCM) {
        const pcm = await engine.speakPCM(say, m.lang, (p) => {
          if (p.stage === "download") setVoice({ id: m.id, phase: "loading", loaded_mb: p.loaded_mb, total_mb: p.total_mb });
          else if (p.stage === "ready") setVoice({ id: m.id, phase: "speaking" });
        });
        buf = ctx.createBuffer(1, pcm.audio.length, pcm.sampling_rate);
        buf.copyToChannel(pcm.audio as any, 0);
      } else {
        buf = await engine.speak(say, m.lang);
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.onended = () => setVoice((v) => (v.id === m.id ? { id: null, phase: "idle" } : v));
      audioRef.current.src = src;
      src.start();
      setVoice({ id: m.id, phase: "playing" });
      refreshStatus();
    } catch (e) {
      setVoice({ id: null, phase: "idle" });
      setMicNote({ kind: "error", text: `Voice could not play: ${(e as Error).message}` });
    }
  };

  /* ---------- voice in ---------- */

  const startRecording = async (lang = flags.lang) => {
    if (!engine) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const parts: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (timerRef.current) window.clearInterval(timerRef.current);
        setRecording(false);
        const blob = new Blob(parts, { type: rec.mimeType || "audio/webm" });
        setMicNote({ kind: "info", text: "Transcribing on this phone. The first time loads a 52 MB English speech model." });
        try {
          const text = await engine.transcribe(blob, lang);
          if (text) {
            setInput(text);
            setMicNote({ kind: "info", text: "Check the words, fix anything wrong, then send." });
          } else {
            setMicNote({ kind: "error", text: "No words came through. Hold the phone closer and try again." });
          }
        } catch (e) {
          setMicNote({ kind: "error", text: `Speech-in failed: ${(e as Error).message}` });
        }
        refreshStatus();
      };
      rec.start();
      recRef.current = rec;
      setRecSeconds(0);
      timerRef.current = window.setInterval(() => setRecSeconds((s) => (s >= 29 ? (rec.state !== "inactive" && rec.stop(), s) : s + 1)), 1000);
      setRecording(true);
      setMicNote(null);
    } catch {
      setMicNote({ kind: "error", text: "This browser did not give microphone access. Allow the microphone for this site, or type instead." });
    }
  };

  const onMic = () => {
    if (recording) {
      recRef.current?.stop();
      return;
    }
    if (flags.lang === "pis") {
      setMicNote({
        kind: "pis",
        text: "Pijin voice-in needs the laptop pack (Omnilingual ASR, 300M, too big for a phone tonight). On this phone: type in Pijin, or speak English."
      });
      return;
    }
    void startRecording("en");
  };

  /* ---------- copy / save ---------- */

  const copy = async (m: BotMsg) => {
    const text = m.text.replace(/\n+/g, " ").trim();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopiedId(m.id);
    window.setTimeout(() => setCopiedId((c) => (c === m.id ? null : c)), 1800);
  };

  const save = (m: BotMsg) => {
    try {
      const prev = JSON.parse(localStorage.getItem(NOTES_KEY) ?? "[]");
      prev.push({ saved_at: new Date().toISOString(), record: m.note, action: m.action, stm: m.stm });
      localStorage.setItem(NOTES_KEY, JSON.stringify(prev));
    } catch {
      /* storage blocked: still mark it so the nurse is not stuck; the record stays on screen */
    }
    setSavedIds((s) => new Set(s).add(m.id));
  };

  const sizes = useMemo(() => {
    const out: Record<string, number> = {};
    for (const m of manifest?.models ?? []) {
      const role = (m as any).role as string | undefined;
      if (role === "llm" || role === "tts_pis") out[role] = m.size_mb;
    }
    return out;
  }, [manifest]);

  const showInstall = ready && !install.installed && !installDismissed && (install.canPrompt || install.ios) && msgs.length > 0;
  const voiceLabel = status?.tts?.pis ? `${status.tts.pis.label}${status.tts.en ? `, ${status.tts.en.label}` : ""}` : null;

  return (
    <div className="mx-auto flex w-full max-w-[1060px] flex-1 justify-center gap-10 px-4 pt-4 sm:pt-6 lg:pt-8">
      <section className="flex w-full max-w-[480px] flex-1 flex-col" aria-label="Lokol Health chat">
        <header>
          <div className="flex items-end justify-between gap-3">
            <div>
              <h1 className="font-display text-[30px] font-bold leading-none tracking-tight">Lokol Health</h1>
              <p className="mt-1.5 text-[14px] leading-snug text-ink-2">Helpem nes long klinik. Child care from the Solomon Islands Standard Treatment Manual.</p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <ConnectivityChip online={online} />
            <ModelChip llm={status?.llm} shim={shim} loading={!ready && !error} />
          </div>
        </header>

        <div className="mt-4">
          <FlagChips flags={flags} onChange={setFlags} disabled={busy} />
        </div>

        {packNote && <p className="mt-3 rounded-xl bg-frangipani-tint px-3 py-2 text-[13px] text-[#7A4E05]">{packNote}</p>}
        {ready && status?.llm && !status.llm.tuned && (
          <p className="mt-3 rounded-xl border border-frangipani/50 bg-frangipani-tint/60 px-3 py-2 text-[13px] leading-snug text-[#6A4405]">
            The tuned Lokol model is not on this device yet, so the untuned base model is answering. Expect it to miss the format; the safety gate then answers "ask a person".
          </p>
        )}

        {(!ready || error) && (
          <div className="mt-4">
            <LoadCard progress={progress} error={error} onRetry={retry} shim={shim} sizes={sizes} />
          </div>
        )}

        <div className="mt-5 flex flex-1 flex-col gap-4 pb-4">
          {msgs.length === 0 && (
            <div className="flex flex-col">
              <p className="font-display text-[21px] font-semibold leading-snug">{pis ? "Tok abaot wanfala pikinini wea sik." : "Tell me about a sick child."}</p>
              <p className="mt-1 text-[14px] text-ink-2">
                {pis ? "Hao old, wanem saen, hao long. " : ""}Age, signs, how long. Lokol follows the manual, cites the page, and says when to refer or ask a person.
              </p>
              <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                {SAMPLES.map((s) => {
                  const meta = ACTION_META[s.tone];
                  return (
                    <li key={s.text}>
                      <button
                        type="button"
                        disabled={!ready || busy}
                        onClick={() => runSample(s)}
                        className="flex h-full w-full flex-col gap-1 rounded-xl border border-line bg-white px-3 py-2.5 text-left transition-colors hover:border-ink-3 disabled:opacity-50"
                      >
                        <span className="flex items-center gap-1.5 text-[12px]">
                          <span className={`h-2 w-2 rounded-full ${meta.band}`} aria-hidden />
                          <span className="font-semibold text-ink">{s.kind.en}</span>
                          <span className="text-ink-3">{s.kind.pis}</span>
                          <span className="ml-auto text-[11px] text-ink-3">{s.lang === "pis" ? "Pijin" : "English"}</span>
                        </span>
                        <span className="line-clamp-2 text-[13.5px] leading-snug text-ink-2">{s.text}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-4 text-[12.5px] text-ink-3">Everything stays on this phone. Lokol does not diagnose; the nurse decides.</p>
            </div>
          )}

          {msgs.map((m) =>
            m.role === "user" ? (
              <UserBubble key={m.id} m={m} />
            ) : (
              <ReplyCard key={m.id} m={m} voice={voice} onPlay={play} onStop={stopVoice} onCopy={copy} onSave={save} copiedId={copiedId} savedIds={savedIds} />
            )
          )}

          {showInstall && (
            <div className="flex items-center gap-3 rounded-2xl border border-reef/30 bg-reef-pale px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold">Put Lokol Health on your home screen</p>
                <p className="text-[12.5px] text-ink-2">{install.canPrompt ? "It opens like an app, with no signal." : "In Safari, tap Share, then Add to Home Screen."}</p>
              </div>
              {install.canPrompt && (
                <button type="button" onClick={install.prompt} className="rounded-full bg-reef px-3.5 py-1.5 text-[13px] font-semibold text-white">
                  Install app
                </button>
              )}
              <button type="button" onClick={() => setInstallDismissed(true)} className="text-[12.5px] text-ink-3 underline-offset-2 hover:underline">
                Not now
              </button>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <div className="sticky bottom-0 -mx-4 mt-auto border-t border-line-2 bg-paper/95 px-4 pb-[max(10px,env(safe-area-inset-bottom))] pt-2.5 backdrop-blur">
          {micNote && (
            <div
              className={`mb-2 rounded-xl px-3 py-2 text-[13px] leading-snug ${
                micNote.kind === "error" ? "bg-hibiscus-tint text-hibiscus" : micNote.kind === "pis" ? "bg-slate-tint text-ink-2" : "bg-white text-ink-2 ring-1 ring-line-2"
              }`}
              role="status"
            >
              {micNote.kind === "pis" && <p className="font-semibold text-ink">Voes long Pijin i no redi long fon yet.</p>}
              <p>{micNote.text}</p>
              {micNote.kind === "pis" && (
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    className="rounded-full bg-ink px-3 py-1 text-[12.5px] font-medium text-white"
                    onClick={() => {
                      setFlags((f) => ({ ...f, lang: "en" }));
                      void startRecording("en");
                    }}
                  >
                    Speak English instead
                  </button>
                  <button type="button" className="rounded-full border border-line bg-white px-3 py-1 text-[12.5px] font-medium" onClick={() => setMicNote(null)}>
                    Type in Pijin
                  </button>
                </div>
              )}
            </div>
          )}
          <Composer
            value={input}
            onChange={setInput}
            onSend={() => void send(input)}
            onMic={onMic}
            recording={recording}
            recSeconds={recSeconds}
            ready={ready}
            busy={busy}
            lang={flags.lang}
          />
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <RuntimeFooter status={status} last={lastDone?.stats} shim={shim} loadMs={loadMs} />
            <Link to="/studio" className="shrink-0 text-[11.5px] text-ink-3 underline-offset-2 hover:underline lg:hidden">
              Edit in Studio
            </Link>
          </div>
        </div>
      </section>

      <PipelinePanel status={status} last={lastBot} hits={hits} shim={shim} voiceLabel={voiceLabel} />
    </div>
  );
}
