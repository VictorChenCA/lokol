import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { Action, Chunk, Flags } from "../types";
import { ACTION_META, SAMPLES, guessTask, type Sample, type Task } from "../components/demo/copy";
import { loadSettings, replyLangFor, saveSettings, voiceFor, type FieldSettings } from "../components/demo/settings";
import { SettingsSheet, type MicTest, type SpeakTest } from "../components/demo/SettingsSheet";
import { devSoundMuted } from "../devMute";
import { FIELD_SETTINGS_EVENT } from "../components/Shell";
import { ReplyCard, UserBubble, type BotMsg, type Msg, type VoiceState } from "../components/demo/ReplyCard";
import { Composer, ConnectivityChip, LoadCard, ModelChip, RuntimeFooter, suppliesSummary } from "../components/demo/parts";
import { PipelinePanel } from "../components/demo/PipelinePanel";
import { useDemoEngine, useInstallPrompt, useOnline } from "../components/demo/useDemoEngine";
import { PIS_APPROX_NOTE, TalkBar, type TalkPhase, type VoiceIn } from "../components/demo/TalkPanel";
import { listenOnce, pcmToWav, type ListenHandle } from "../runtime/vad";

const ACTIONS: Action[] = ["ADVISE", "REFER_NOW", "REFER_NEXT_TRANSPORT", "ASK_PERSON"];
const NOTES_KEY = "lokol.health.notes";

function partial(raw: string): { action: Action | null; body: string } {
  const a = /ACTION\s*:\s*([A-Z_]+)\s*\n/i.exec(raw);
  const action = a && ACTIONS.includes(a[1].toUpperCase() as Action) ? (a[1].toUpperCase() as Action) : null;
  const i = raw.indexOf("---");
  // Before the separator arrives (or when an untuned model ignores the format) show what it writes, minus protocol lines.
  const body = i >= 0 ? raw.slice(i + 3).replace(/^-+/, "").trimStart() : raw.replace(/^\s*(ACTION|STM)\s*:[^\n]*\n?/gim, "").trimStart();
  return { action, body: body.startsWith("{") ? "Writing the visit record" : body };
}

function citeChunk(stm: string | null | undefined, chunks: Chunk[]): Chunk | null {
  if (!stm || /^none$/i.test(stm)) return null;
  const up = stm.toUpperCase();
  return chunks.find((c) => c.section.toUpperCase() === up) ?? chunks.find((c) => up.includes(c.section.toUpperCase()) || c.section.toUpperCase().includes(up)) ?? { id: `stm-${up}`, section: stm, page: 0, text: "" };
}

export default function Demo() {
  const online = useOnline();
  const { manifest, packNote, engine, source, progress, error, status, loadMs, refreshStatus, retry } = useDemoEngine();
  const [searchParams, setSearchParams] = useSearchParams();
  const customPack = Boolean(manifest && (manifest as { corpus_inline?: unknown }).corpus_inline);
  const install = useInstallPrompt();
  const shim = source === "shim";
  const [settings, setSettingsState] = useState<FieldSettings>(() => loadSettings());
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const updateSettings = (p: Partial<FieldSettings>) => {
    const next = { ...settingsRef.current, ...p };
    settingsRef.current = next;
    saveSettings(next);
    setSettingsState(next);
    if (p.size && searchParams.has("size")) {
      // the saved size applies once the URL no longer pins one
      const q = new URLSearchParams(searchParams);
      q.delete("size");
      setSearchParams(q, { replace: true });
    }
  };
  const voiceIn: VoiceIn = settings.voiceIn;
  const flagsFor = (text: string, extra: Partial<Flags> = {}): Flags => ({
    lang: replyLangFor(text, settingsRef.current.replyLang),
    rdt: settingsRef.current.rdt,
    act: settingsRef.current.act,
    transport: settingsRef.current.transport,
    ...extra
  });
  const [settingsOpen, setSettingsOpen] = useState(() => searchParams.get("settings") === "1");
  // The field app header (FieldShell) owns the gear; it asks this page to open the sheet.
  useEffect(() => {
    const h = (e: Event) => {
      e.preventDefault();
      setSettingsOpen(true);
    };
    window.addEventListener(FIELD_SETTINGS_EVENT, h);
    return () => window.removeEventListener(FIELD_SETTINGS_EVENT, h);
  }, []);
  useEffect(() => {
    if (searchParams.get("settings") !== "1") return;
    setSettingsOpen(true);
    const q = new URLSearchParams(searchParams);
    q.delete("settings");
    setSearchParams(q, { replace: true });
  }, [searchParams, setSearchParams]);
  const [soundBlocked, setSoundBlocked] = useState<BotMsg | null>(null);
  const [speakTest, setSpeakTest] = useState<SpeakTest>({ phase: "idle" });
  const [micTest, setMicTest] = useState<MicTest>({ phase: "idle", level: 0 });
  const micTestRef = useRef<ListenHandle | null>(null);
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
  const audioRef = useRef<{ ctx: AudioContext; srcs: AudioBufferSourceNode[]; gen: number } | null>(null);
  const [talkPhase, setTalkPhase] = useState<TalkPhase>("off");
  const [talkLevel, setTalkLevel] = useState(0);
  const [talkHeard, setTalkHeard] = useState<string | null>(null);
  const talkOnRef = useRef(false);
  const listenRef = useRef<ListenHandle | null>(null);
  const whisperRef = useRef<Promise<any> | null>(null);

  const ready = !!engine;
  const lastBot = useMemo(() => [...msgs].reverse().find((m): m is BotMsg => m.role === "bot") ?? null, [msgs]);
  const lastDone = useMemo(() => [...msgs].reverse().find((m): m is BotMsg => m.role === "bot" && m.stage === "done") ?? null, [msgs]);

  useEffect(() => {
    if (msgs.length) endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [msgs]);

  const patch = (id: number, p: Partial<BotMsg>) => setMsgs((all) => all.map((m) => (m.id === id && m.role === "bot" ? { ...m, ...p } : m)));

  const send = useCallback(
    async (textIn: string, opt: { task?: Task; flags?: Flags; via?: "voice" | "text" } = {}): Promise<BotMsg | null> => {
      const text = textIn.trim();
      if (!engine || !text || busy) return null;
      const f = opt.flags ?? flagsFor(text);
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
        const final: Partial<BotMsg> = {
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
        };
        patch(bid, final);
        refreshStatus();
        return { id: bid, role: "bot", lang: f.lang, task, ...final } as BotMsg;
      } catch (e) {
        patch(bid, { stage: "error", error: (e as Error).message });
        return null;
      } finally {
        setBusy(false);
      }
    },
    [engine, busy, shim, refreshStatus]
  );

  const runSample = (s: Sample) => {
    ensureAudio();
    if (s.flags) updateSettings(s.flags as Partial<FieldSettings>);
    void sendAndSpeak(s.text, { task: s.task, flags: flagsFor(s.text, s.flags) });
  };

  /** Send, then read the reply out loud when "Read replies aloud" is on. */
  const sendAndSpeak = async (text: string, opt: { task?: Task; flags?: Flags; via?: "voice" | "text" } = {}) => {
    const bot = await sendRef.current(text, opt);
    if (bot && bot.stage === "done" && !bot.note && settingsRef.current.readAloud) await speakRef.current(bot);
    return bot;
  };

  /* ---------- voice out ---------- */

  /**
   * Creates/resumes the AudioContext inside a user tap (and plays one silent sample) so that later automatic
   * playback, after the model answers, is allowed by iOS Safari and Chrome's autoplay rules.
   */
  const ensureAudio = (): AudioContext | null => {
    try {
      const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
      if (!audioRef.current || audioRef.current.ctx.state === "closed") audioRef.current = { ctx: new Ctx(), srcs: [], gen: 0 };
      const ctx = audioRef.current.ctx;
      if (ctx.state !== "running") {
        void ctx.resume().catch(() => {});
        const b = ctx.createBuffer(1, 1, 22050);
        const src = ctx.createBufferSource();
        src.buffer = b;
        src.connect(ctx.destination);
        src.start(0);
      }
      return ctx;
    } catch {
      return null;
    }
  };

  // Any first tap or key press on the page unlocks sound, so even a typed question is answered out loud.
  useEffect(() => {
    const unlock = () => {
      if (!audioRef.current || audioRef.current.ctx.state !== "running") ensureAudio();
    };
    window.addEventListener("pointerdown", unlock, true);
    window.addEventListener("keydown", unlock, true);
    return () => {
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("keydown", unlock, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopVoice = () => {
    const a = audioRef.current;
    if (a) {
      a.gen++;
      a.srcs.forEach((src) => {
        try {
          src.stop();
        } catch {
          /* already stopped */
        }
      });
      a.srcs = [];
    }
    setVoice({ id: null, phase: "idle" });
  };

  // Sentence by sentence: the first sentence plays while the next ones are synthesised, so the nurse
  // hears the action within a couple of seconds instead of waiting for the whole reply.
  const play = (m: BotMsg) => {
    if (voice.phase !== "idle") return;
    ensureAudio();
    setSoundBlocked(null);
    void speakMsg(m);
  };

  const speakMsg = async (m: BotMsg): Promise<void> => {
    if (!engine) return;
    const ctx0 = ensureAudio();
    if (!ctx0 || !audioRef.current) return;
    const a = audioRef.current;
    const ctx = a.ctx;
    if (ctx.state !== "running") {
      await Promise.race([ctx.resume().catch(() => {}), new Promise((r) => setTimeout(r, 400))]);
      if ((ctx.state as AudioContextState) !== "running") {
        // No tap has unlocked sound yet (autoplay rules): ask for one.
        setSoundBlocked(m);
        return;
      }
    }
    a.srcs.forEach((src) => {
      try {
        src.stop();
      } catch {
        /* already stopped */
      }
    });
    a.srcs = [];
    const gen = ++a.gen;
    const vlang = voiceFor(m.lang, settingsRef.current.voice);
    const meta = ACTION_META[m.action ?? "ASK_PERSON"];
    const say = `${vlang === "pis" ? meta.pis : meta.en}.\n${m.text}`;
    const parts = say
      .split(/\n+|(?<=[.!?])\s+/)
      .map((x) => x.trim())
      .filter((x) => /[a-z0-9]/i.test(x));
    setVoice({ id: m.id, phase: "speaking" });
    let at = 0;
    let last: AudioBufferSourceNode | null = null;
    try {
      for (const part of parts) {
        if (a.gen !== gen) return;
        let buf: AudioBuffer;
        if (engine.speakPCM) {
          const pcm = await engine.speakPCM(part, vlang, (p) => {
            if (p.stage === "download") setVoice({ id: m.id, phase: "loading", loaded_mb: p.loaded_mb, total_mb: p.total_mb });
          });
          buf = ctx.createBuffer(1, pcm.audio.length, pcm.sampling_rate);
          buf.copyToChannel(pcm.audio as any, 0);
        } else {
          buf = await engine.speak(part, vlang);
        }
        if (a.gen !== gen) return;
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(ctx.destination);
        at = Math.max(at, ctx.currentTime + 0.05);
        src.start(at);
        at += buf.duration + 0.18;
        a.srcs.push(src);
        last = src;
        setVoice({ id: m.id, phase: "playing" });
      }
      refreshStatus();
      if (last) {
        const src = last;
        await new Promise<void>((resolve) => {
          src.onended = () => resolve();
          // stopVoice() bumps gen and stops the sources; onended still fires, but guard against a context that never ends
          window.setTimeout(resolve, Math.max(0, (at - ctx.currentTime) * 1000) + 1500);
        });
        if (a.gen === gen) setVoice((v) => (v.id === m.id ? { id: null, phase: "idle" } : v));
      } else setVoice({ id: null, phase: "idle" });
    } catch (e) {
      setVoice({ id: null, phase: "idle" });
      setMicNote({ kind: "error", text: `Voice could not play: ${(e as Error).message}` });
    }
  };

  /* ---------- voice in ---------- */

  // English: the engine's own speech-in (Moonshine). Pijin, approximate: multilingual Whisper base, loaded on demand
  // straight from runtime/stt (dynamic import, so the page bundle does not carry transformers.js).
  const transcribeFor = async (audio: Blob, mode: VoiceIn = voiceIn): Promise<string> => {
    if (!engine) return "";
    if (mode === "en") return engine.transcribe(audio, "en");
    if (shim) {
      await new Promise((r) => setTimeout(r, 600));
      return "Pikinini tri yia, hot bodi tu dei, no kaikai gud, no fit.";
    }
    if (!whisperRef.current) {
      whisperRef.current = import("../runtime/stt").then(({ STT, PIS_APPROX }) =>
        STT.load(PIS_APPROX.model, {
          onProgress: (l, t) => t && setMicNote({ kind: "info", text: `Loading Whisper base for approximate Pijin: ${Math.round(l / 1e6)} of ${Math.round(t / 1e6)} MB, once.` })
        })
      );
      whisperRef.current.catch(() => (whisperRef.current = null));
    }
    const stt = await whisperRef.current;
    const r = await stt.transcribe(audio, "pis", { language: "en", task: "transcribe" });
    return r.text;
  };

  /* ---------- hands-free talk (speech to speech) ---------- */

  const sendRef = useRef(send);
  sendRef.current = send;
  const speakRef = useRef(speakMsg);
  speakRef.current = speakMsg;
  const transcribeRef = useRef(transcribeFor);
  transcribeRef.current = transcribeFor;

  const stopTalk = () => {
    talkOnRef.current = false;
    listenRef.current?.stop();
    listenRef.current = null;
    stopVoice();
    setTalkPhase("off");
    setTalkLevel(0);
  };

  const talkLoop = async () => {
    let misses = 0;
    while (talkOnRef.current) {
      setTalkPhase("starting");
      setTalkHeard(null);
      let lastLevel = 0;
      const h = listenOnce({
        onLevel: (l) => {
          // ~10 updates a second is plenty for the meter
          if (Math.abs(l - lastLevel) > 0.002) {
            lastLevel = l;
            setTalkLevel(l);
          }
        },
        onSpeech: () => setTalkPhase("hearing")
      });
      listenRef.current = h;
      window.setTimeout(() => talkOnRef.current && listenRef.current === h && setTalkPhase((p) => (p === "starting" ? "listening" : p)), 350);
      let u;
      try {
        u = await h.done;
      } catch {
        setMicNote({ kind: "error", text: "This browser did not give microphone access. Allow the microphone for this site, or type instead." });
        break;
      }
      listenRef.current = null;
      if (!talkOnRef.current || !u) break;
      setTalkPhase("transcribing");
      let text = "";
      try {
        text = (await transcribeRef.current(pcmToWav(u.pcm, 16000))).trim();
      } catch (e) {
        setMicNote({ kind: "error", text: `Speech-in failed: ${(e as Error).message}` });
        break;
      }
      if (!talkOnRef.current) break;
      if (!text) {
        if (++misses >= 3) {
          setMicNote({ kind: "error", text: "No words came through three times. Hold the phone closer, or type instead." });
          break;
        }
        continue;
      }
      misses = 0;
      setTalkHeard(text);
      setTalkPhase("thinking");
      const bot = await sendRef.current(text, { via: "voice" });
      if (!talkOnRef.current) break;
      if (bot && bot.stage === "done" && !bot.note && settingsRef.current.readAloud) {
        setTalkPhase("speaking");
        await speakRef.current(bot);
      }
    }
    talkOnRef.current = false;
    listenRef.current = null;
    setTalkPhase("off");
    setTalkLevel(0);
  };

  const toggleTalk = () => {
    if (talkOnRef.current || talkPhase !== "off") return stopTalk();
    if (!engine) return;
    if (recording) recRef.current?.stop();
    // Create/resume the AudioContext inside the tap so mobile browsers allow the spoken replies.
    ensureAudio();
    setSoundBlocked(null);
    talkOnRef.current = true;
    setMicNote(voiceIn === "pis-approx" ? { kind: "info", text: PIS_APPROX_NOTE } : null);
    void talkLoop();
  };

  useEffect(
    () => () => {
      talkOnRef.current = false;
      listenRef.current?.stop();
    },
    []
  );

  const startRecording = async (mode: VoiceIn = voiceIn) => {
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
        setMicNote({
          kind: "info",
          text: mode === "pis-approx" ? "Transcribing on this phone (approximate Pijin). The first time loads Whisper base, 136 MB." : "Transcribing on this phone. The first time loads a 52 MB English speech model."
        });
        try {
          const text = (await transcribeFor(blob, mode)).trim();
          if (text) {
            setMicNote(mode === "pis-approx" ? { kind: "info", text: PIS_APPROX_NOTE } : null);
            void sendAndSpeak(text, { via: "voice" });
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
    if (talkPhase !== "off") return;
    if (recording) {
      recRef.current?.stop();
      return;
    }
    ensureAudio();
    setSoundBlocked(null);
    void startRecording(voiceIn);
  };

  /* ---------- voice test (settings) ---------- */

  const TEST_LINES: { lang: "en" | "pis"; text: string }[] = [
    { lang: "en", text: "Hello. This is Lokol Health, running on this phone." },
    { lang: "pis", text: "Halo. Mi Lokol Health, mi stap long fon blong iu." }
  ];

  const runSpeakTest = async () => {
    if (!engine) return;
    if (speakTest.phase === "playing") {
      stopVoice();
      setSpeakTest({ phase: "idle" });
      return;
    }
    const ctx = ensureAudio();
    if (!ctx || !audioRef.current) return setSpeakTest({ phase: "error", detail: "This browser has no Web Audio." });
    const a = audioRef.current;
    const gen = ++a.gen;
    try {
      for (const line of TEST_LINES) {
        if (a.gen !== gen) return;
        setSpeakTest({ phase: "loading", line: line.text, detail: line.lang === "pis" ? "Pijin voice" : "English voice" });
        let buf: AudioBuffer;
        const t0 = performance.now();
        if (engine.speakPCM) {
          const pcm = await engine.speakPCM(line.text, line.lang, (p) => {
            if (p.stage === "download") setSpeakTest({ phase: "loading", line: line.text, detail: `Downloading the ${line.lang === "pis" ? "Pijin" : "English"} voice: ${p.loaded_mb} of ${p.total_mb} MB, once.` });
          });
          buf = ctx.createBuffer(1, pcm.audio.length, pcm.sampling_rate);
          buf.copyToChannel(pcm.audio as any, 0);
        } else buf = await engine.speak(line.text, line.lang);
        if (a.gen !== gen) return;
        if (ctx.state !== "running") await ctx.resume().catch(() => {});
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(ctx.destination);
        a.srcs.push(src);
        setSpeakTest({ phase: "playing", line: line.text, detail: `${line.lang === "pis" ? "Pijin" : "English"} voice, made in ${((performance.now() - t0) / 1000).toFixed(1)} s on this device` });
        await new Promise<void>((resolve) => {
          src.onended = () => resolve();
          window.setTimeout(resolve, buf.duration * 1000 + 1500);
          src.start();
        });
      }
      if (a.gen === gen) setSpeakTest({ phase: "done", line: undefined, detail: ctx.state === "running" ? "Both voices played. If you heard nothing, check the volume and the silent switch." : "Sound is blocked. Tap the button again." });
      refreshStatus();
    } catch (e) {
      setSpeakTest({ phase: "error", detail: `The voice could not play: ${(e as Error).message}` });
    }
  };

  const runMicTest = async () => {
    if (!engine) return;
    if (micTestRef.current) {
      micTestRef.current.stop();
      micTestRef.current = null;
      setMicTest({ phase: "idle", level: 0 });
      return;
    }
    ensureAudio();
    setMicTest({ phase: "listening", level: 0 });
    let last = 0;
    const h = listenOnce({
      maxMs: 8000,
      onLevel: (l) => {
        if (Math.abs(l - last) > 0.002) {
          last = l;
          setMicTest((t) => (t.phase === "listening" || t.phase === "hearing" ? { ...t, level: l } : t));
        }
      },
      onSpeech: () => setMicTest((t) => ({ ...t, phase: "hearing" }))
    });
    micTestRef.current = h;
    try {
      const u = await h.done;
      if (micTestRef.current !== h) return;
      micTestRef.current = null;
      if (!u) return setMicTest({ phase: "done", level: 0, text: "" });
      setMicTest({ phase: "transcribing", level: 0 });
      const text = (await transcribeRef.current(pcmToWav(u.pcm, 16000))).trim();
      setMicTest({ phase: "done", level: 0, text });
      refreshStatus();
    } catch (e) {
      micTestRef.current = null;
      const msg = (e as Error).name === "NotAllowedError" || /permission|denied/i.test((e as Error).message) ? "This browser did not give microphone access. Allow the microphone for this site." : `Microphone test failed: ${(e as Error).message}`;
      setMicTest({ phase: "error", level: 0, error: msg });
    }
  };

  useEffect(() => {
    if (!settingsOpen && micTestRef.current) {
      micTestRef.current.stop();
      micTestRef.current = null;
      setMicTest({ phase: "idle", level: 0 });
    }
  }, [settingsOpen]);

  // Warm the stages this clinic uses, after the language model is ready, so the first spoken reply is quick.
  useEffect(() => {
    if (!engine?.loadModel || shim) return;
    const roles: ("stt" | "tts_en")[] = [];
    if (settings.speechIn && settings.voiceIn === "en") roles.push("stt");
    if (settings.readAloud && (settings.voice === "en" || (settings.voice === "auto" && settings.replyLang !== "pis"))) roles.push("tts_en");
    let alive = true;
    (async () => {
      for (const r of roles) {
        if (!alive) return;
        const st = engine.status() as any;
        if (st.models?.find((x: any) => x.role === r)?.loaded) continue;
        await engine.loadModel!(r).catch(() => null);
        if (alive) refreshStatus();
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, shim, settings.speechIn, settings.voiceIn, settings.readAloud, settings.voice, settings.replyLang]);

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
  const talkOn = talkPhase !== "off";

  return (
    <div className="mx-auto flex w-full max-w-[1060px] flex-1 justify-center gap-10 px-4 pt-3 sm:pt-5 lg:pt-6">
      <section className="flex w-full max-w-[480px] flex-1 flex-col" aria-label="Lokol Health">
        <header>
          {customPack ? (
            <h1 className="font-display text-[24px] font-bold leading-tight tracking-tight">{manifest?.graph.name}</h1>
          ) : (
            <h1 className="sr-only">Lokol Health</h1>
          )}
          <p className="text-[13.5px] leading-snug text-ink-2">
            {customPack ? "Answers from your own manual, offline. Each reply cites the section and page it used." : "Child care from the Solomon Islands Standard Treatment Manual, on this phone."}
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <ConnectivityChip online={online} />
            <ModelChip llm={status?.llm} shim={shim} loading={!ready && !error} />
          </div>
          {!customPack && <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            title="Clinic supplies the answers take into account. Tap to change."
            className="mt-2 flex w-full items-center gap-2 rounded-xl border border-line-2 bg-white/70 px-3 py-1.5 text-left text-[12.5px] text-ink-2 hover:border-line"
          >
            <span className="font-medium text-ink">Clinic supplies</span>
            <span className="min-w-0 flex-1 truncate">{suppliesSummary(settings)}</span>
            <span className="shrink-0 text-reef-deep">Change</span>
          </button>}
        </header>

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
              <p className="font-display text-[21px] font-semibold leading-snug">{customPack ? "Ask about your manual." : "Tell me about a sick child."}</p>
              <p className="mt-1 text-[14px] text-ink-2">
                {settings.speechIn ? "Tap Talk and speak, or type. " : ""}
                {customPack
                  ? "Lokol finds the matching section, cites it, and says when to ask a person."
                  : "Age, signs, how long. Lokol follows the manual, cites the page, and says when to refer or ask a person. Write in Pijin and it answers in Pijin."}
              </p>
              {!customPack && <p className="mt-4 text-[12px] font-semibold uppercase tracking-wide text-ink-3">Try</p>}
              <ul className="mt-1.5 grid gap-2">
                {(customPack ? [] : SAMPLES).map((s) => {
                  const meta = ACTION_META[s.tone];
                  return (
                    <li key={s.text}>
                      <button
                        type="button"
                        disabled={!ready || busy || talkOn}
                        onClick={() => runSample(s)}
                        className="flex h-full w-full flex-col gap-1 rounded-xl border border-line bg-white px-3 py-2.5 text-left transition-colors hover:border-ink-3 disabled:opacity-50"
                      >
                        <span className="flex items-center gap-1.5 text-[12px]">
                          <span className={`h-2 w-2 rounded-full ${meta.band}`} aria-hidden />
                          <span className="font-semibold text-ink">{s.label}</span>
                        </span>
                        <span className="line-clamp-2 text-[13.5px] leading-snug text-ink-2">{s.text}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-4 text-[12.5px] text-ink-3">{customPack ? "Everything stays on this phone. A person decides." : "Everything stays on this phone. Lokol does not diagnose; the nurse decides."}</p>
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
          {soundBlocked && (
            <button
              type="button"
              onClick={() => {
                const m = soundBlocked;
                ensureAudio();
                setSoundBlocked(null);
                void speakMsg(m);
              }}
              className="mb-2 flex w-full items-center justify-center gap-2 rounded-full bg-[#5B3F86] py-2.5 text-[14px] font-semibold text-white"
            >
              Tap to enable sound and hear the answer
            </button>
          )}
          {micNote && (
            <div
              className={`mb-2 flex items-start gap-2 rounded-xl px-3 py-2 text-[13px] leading-snug ${micNote.kind === "error" ? "bg-hibiscus-tint text-hibiscus" : "bg-white text-ink-2 ring-1 ring-line-2"}`}
              role="status"
            >
              <p className="min-w-0 flex-1">{micNote.text}</p>
              <button type="button" onClick={() => setMicNote(null)} aria-label="Dismiss" className="shrink-0 text-ink-3 hover:text-ink">
                ×
              </button>
            </div>
          )}
          {settings.speechIn && (
            <TalkBar
              phase={talkPhase}
              level={talkLevel}
              onToggle={toggleTalk}
              onFinish={() => listenRef.current?.finish()}
              disabled={!ready || (busy && talkPhase === "off")}
              voiceIn={voiceIn}
              heard={talkHeard}
              speaks={settings.readAloud}
            />
          )}
          <Composer
            value={input}
            onChange={setInput}
            onSend={() => {
              ensureAudio();
              void sendAndSpeak(input);
            }}
            onMic={onMic}
            onTalk={toggleTalk}
            recording={recording}
            recSeconds={recSeconds}
            ready={ready}
            busy={busy}
            speechIn={settings.speechIn}
            talkOn={talkOn}
          />
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <RuntimeFooter status={status} last={lastDone?.stats} shim={shim} loadMs={loadMs} />
            <span className="shrink-0 text-[11.5px] text-ink-3">{settings.readAloud ? "Reads replies aloud" : "Read aloud off"}</span>
          </div>
        </div>
      </section>

      <PipelinePanel status={status} last={lastBot} hits={hits} shim={shim} voiceLabel={voiceLabel} speechIn={settings.speechIn} readAloud={settings.readAloud} sttLabel={voiceIn === "pis-approx" ? "Whisper base, Pijin (approximate), 136 MB" : undefined} packName={customPack ? manifest?.graph.name : undefined} corpusLabel={customPack ? "BM25 over the sections of your manual" : undefined} />

      <SettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onChange={(p) => {
          if (p.speechIn === false && talkOnRef.current) stopTalk();
          updateSettings(p);
        }}
        busy={busy}
        install={install}
        speakTest={speakTest}
        onSpeakTest={() => void runSpeakTest()}
        micTest={micTest}
        onMicTest={() => void runMicTest()}
        devMuted={devSoundMuted()}
      />
    </div>
  );
}
