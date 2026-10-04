import { useEffect, useRef, useState } from "react";
import type { Flags, Lang, Transport, YesNoUnknown } from "../../types";
import { useStudio } from "../../store";
import { NODE_META } from "../../models";
import { ActionBadge } from "../ui";
import { useTrace, runTrace, stopTrace, playBuffer, packExtras } from "./trace";
import { Icon, NodeIcon } from "./icons";
import { stageIndex, STAGES } from "./layout";
import { detectLang } from "../demo/settings";

interface Sample {
  label: string;
  text: string;
  flags: Partial<Flags> & { lang: Lang };
  expect: string;
}

const FARM_SAMPLES: Sample[] = [
  { label: "Yellow taro leaves", text: "My taro leaves are turning yellow and have holes in them. What should I do?", flags: { lang: "en", rdt: "unknown", act: "unknown", transport: "next_boat" }, expect: "Advise" },
  { label: "Safe spray for cabbage", text: "Which spray is safe for cabbage moth near the village well?", flags: { lang: "en", rdt: "unknown", act: "unknown", transport: "now" }, expect: "Ask a person" },
  { label: "Cyclone coming", text: "A cyclone is coming this week. How do I get my garden ready?", flags: { lang: "en", rdt: "unknown", act: "unknown", transport: "now" }, expect: "From the guide" }
];
const HOST_SAMPLES: Sample[] = [
  { label: "Boat to Gizo", text: "What time does the boat leave for Gizo on Friday?", flags: { lang: "en", rdt: "unknown", act: "unknown", transport: "now" }, expect: "Advise" },
  { label: "Room for two", text: "Do you have a room for two people this Friday, and how much is it?", flags: { lang: "en", rdt: "unknown", act: "unknown", transport: "now" }, expect: "Ask a person" },
  { label: "Snorkelling safety", text: "What should guests know before we go snorkelling on the reef?", flags: { lang: "en", rdt: "unknown", act: "unknown", transport: "now" }, expect: "From the guide" }
];

const SAMPLES: Sample[] = [
  { label: "Fever, RDT positive", text: "3-year-old, 14 kg, fever for 2 days, RDT positive, drinking well. What should I give?", flags: { lang: "en", rdt: "yes", act: "yes", transport: "now" }, expect: "Advise" },
  { label: "Baby had a fit", text: "8-month-old baby with fever had a fit this morning and is very sleepy.", flags: { lang: "en", rdt: "unknown", act: "yes", transport: "next_boat" }, expect: "Refer" },
  { label: "Adult chest pain", text: "Adult man, 45, chest pain since this morning. What dose of aspirin?", flags: { lang: "en", rdt: "unknown", act: "unknown", transport: "now" }, expect: "Ask a person" }
];

const SUPPLY_TIP = "Lokol uses this to pick advice the clinic can actually give.";

const YNU: { v: YesNoUnknown; l: string }[] = [
  { v: "yes", l: "Yes" },
  { v: "no", l: "No" },
  { v: "unknown", l: "Not sure" }
];

function Tri({ label, value, onChange }: { label: string; value: YesNoUnknown; onChange: (v: YesNoUnknown) => void }) {
  return (
    <div className="lk-tri" role="radiogroup" aria-label={label} title={`${label} ${SUPPLY_TIP}`}>
      <span className="lk-supply">{label}</span>
      {YNU.map((o) => (
        <button key={o.v} type="button" role="radio" aria-checked={value === o.v} onClick={() => onChange(o.v)}>
          {o.l}
        </button>
      ))}
    </div>
  );
}

/** A small popover anchored to a button in the test-run bar. */
function Popover({ label, icon, children, align = "right", className = "" }: { label: string; icon?: React.ReactNode; children: React.ReactNode; align?: "left" | "right"; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", h);
    document.addEventListener("keydown", k);
    return () => {
      document.removeEventListener("mousedown", h);
      document.removeEventListener("keydown", k);
    };
  }, [open]);
  return (
    <div className={`relative ${className}`} ref={ref}>
      <button type="button" className="lk-cbtn" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {icon}
        <span>{label}</span>
      </button>
      {open && (
        <div className={`lk-pop lk-pop--up ${align === "left" ? "is-left" : ""}`} role="dialog" aria-label={label}>
          {children}
        </div>
      )}
    </div>
  );
}

function HowItWorks({ runtime }: { runtime: string | null }) {
  return (
    <div className="lk-how">
      <p className="lk-pop__title">How a test run works</p>
      <ol>
        <li>
          <b>Hear.</b> Your message enters the pack. Typed text goes straight on; a voice note from the mic goes through the speech-to-text model first.
        </li>
        <li>
          <b>Look up.</b> The guideline search finds the best matching section of the manual and passes it to the model.
        </li>
        <li>
          <b>Think.</b> The language model drafts a reply in the app's format: an action, the manual section, then the reply. The safety check can override it: a danger sign forces a referral, and no matching section means “ask a person”.
        </li>
        <li>
          <b>Respond.</b> The reply appears below and is read aloud if Voice output is on.
        </li>
      </ol>
      <p className="lk-pop__foot">
        Each card on the canvas lights up while it runs and shows how long it took; press Output on a card to see exactly what it produced. Models download once and run in this browser, so with Internet off nothing leaves the device.
        {runtime === "shim" ? " This page is using the test runtime (?runtime=shim): replies are canned so the screen can be checked quickly." : runtime === "engine" ? " This run used the real engine on this device." : ""}
      </p>
    </div>
  );
}

const fmtMs = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

export function TraceConsole() {
  const graph = useStudio((s) => s.graph);
  const packKey = useStudio((s) => s.packKey);
  // A pack built from a guideline gets Try examples from its own section titles.
  const ownSections = ((packExtras(packKey)?.corpus_inline as { sections?: { title: string }[] } | undefined)?.sections ?? []).map((x) => x.title).filter((x) => x && x.length < 60);
  const samples: Sample[] = ownSections.length
    ? ownSections.slice(0, 3).map((title) => ({ label: title, text: `What does the guide say about ${title.toLowerCase()}?`, flags: { lang: "en" }, expect: "" }))
    : graph.sector === "agriculture"
      ? FARM_SAMPLES
      : graph.sector === "tourism"
        ? HOST_SAMPLES
        : SAMPLES;
  const t = useTrace();
  const [text, setText] = useState(SAMPLES[0].text);
  const [flags, setFlags] = useState<Flags>({ lang: "en", rdt: "yes", act: "yes", transport: "now" });
  const [open, setOpen] = useState(false);
  const [rec, setRec] = useState<MediaRecorder | null>(null);
  const [micErr, setMicErr] = useState<string | null>(null);
  const chunks = useRef<Blob[]>([]);

  useEffect(() => {
    if (t.status !== "idle") setOpen(true);
  }, [t.status]);

  // A new pack brings its own first sample, so a Farm test run never starts with a child-health question.
  const sector = graph.sector;
  const lastSector = useRef(sector);
  useEffect(() => {
    if (lastSector.current !== sector) {
      lastSector.current = sector;
      stopTrace();
    }
    const first = samples[0];
    setText(first.text);
    setFlags((f) => ({ ...f, ...first.flags }) as Flags);
  }, [sector, packKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const busy = t.status === "loading" || t.status === "running";
  // Auto: the reply follows the language typed (Pijin or English). A voice note uses English speech-in unless Pijin is picked.
  const [choice, setChoice] = useState<"auto" | Lang>("auto");
  const run = (msg = text, audio: Blob | null = null, f = flags) => {
    if (!msg.trim() && !audio) return;
    const lang: Lang = choice !== "auto" ? choice : msg.trim() ? detectLang(msg) : "en";
    const next = { ...f, lang };
    setFlags(next);
    void runTrace({ graph, text: msg, audio, flags: next, packKey });
  };

  const toggleMic = async () => {
    setMicErr(null);
    if (rec) {
      rec.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const r = new MediaRecorder(stream);
      chunks.current = [];
      r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      r.onstop = () => {
        stream.getTracks().forEach((tr) => tr.stop());
        setRec(null);
        const blob = new Blob(chunks.current, { type: r.mimeType || "audio/webm" });
        run("", blob);
      };
      r.start();
      setRec(r);
      setTimeout(() => r.state === "recording" && r.stop(), 10000);
    } catch {
      setMicErr("Microphone blocked. Allow it in the browser, or type the message.");
    }
  };

  const ordered = [...graph.nodes].sort((a, b) => stageIndex(a) - stageIndex(b) || a.position.y - b.position.y);
  const visited = ordered.filter((n) => t.steps[n.id] && t.steps[n.id].state !== "queued");
  const res = t.result;

  const stageSteps = STAGES.map((st, i) => {
    const members = visited.filter((n) => stageIndex(n) === i);
    const ms = members.reduce((a, n) => a + (t.steps[n.id]?.state === "done" ? t.steps[n.id]?.ms ?? 0 : 0), 0);
    const state = members.some((n) => t.steps[n.id]?.state === "active") ? "active" : members.some((n) => t.steps[n.id]?.state === "error") ? "error" : members.length && members.every((n) => t.steps[n.id]?.state === "skipped") ? "skipped" : members.length ? "done" : "empty";
    return { st, i, members, ms, state };
  });
  const voiceIn = graph.nodes.some((n) => n.type === "stt" && n.params?.enabled !== false);

  return (
    <div className={`lk-console ${open ? "is-open" : ""}`} role="region" aria-label="Test run">
      <div className="lk-console__bar">
        <div className="lk-console__title">
          <span>Test run</span>
        </div>
        <form
          className="lk-console__form"
          onSubmit={(e) => {
            e.preventDefault();
            run();
          }}
        >
          <input className="lk-console__input" value={text} onChange={(e) => setText(e.target.value)} placeholder={graph.sector === "health" ? "Type what the nurse aide would ask…" : "Type a question for this helper…"} aria-label="Message for the test run" />
          {voiceIn && (
            <button type="button" className={`lk-mic ${rec ? "is-rec" : ""}`} onClick={toggleMic} aria-label={rec ? "Stop recording" : "Record a voice note"} title={rec ? "Stop and run" : "Record up to 10 s"}>
              {rec ? <Icon.stop size={14} /> : <Icon.mic size={16} />}
            </button>
          )}
          {busy ? (
            <button type="button" className="lk-run is-stop" onClick={stopTrace}>
              <Icon.stop size={12} /> Stop
            </button>
          ) : (
            <button type="submit" className="lk-run" disabled={!text.trim()}>
              <Icon.play size={13} /> Run
            </button>
          )}
        </form>
        <div className="lk-console__tools">
          {graph.sector === "health" && (
            <Popover label="Clinic supplies">
              <p className="lk-pop__title">Clinic supplies</p>
              <p className="lk-pop__sub">{SUPPLY_TIP}</p>
              <div className="lk-supplies">
                <Tri label="Malaria test kit (RDT) in stock?" value={flags.rdt} onChange={(v) => setFlags({ ...flags, rdt: v })} />
                <Tri label="Malaria medicine (Coartem / ACT) in stock?" value={flags.act} onChange={(v) => setFlags({ ...flags, act: v })} />
                <label className="lk-tri">
                  <span className="lk-supply">Transport to hospital</span>
                  <select value={flags.transport} onChange={(e) => setFlags({ ...flags, transport: e.target.value as Transport })} aria-label="Transport to hospital">
                    <option value="now">Now</option>
                    <option value="next_boat">Next boat</option>
                    <option value="none">None</option>
                  </select>
                </label>
              </div>
            </Popover>
          )}
          <Popover label="How it works" icon={<Icon.info size={14} />}>
            <HowItWorks runtime={t.runtime} />
          </Popover>
          <button type="button" className="lk-iconbtn lk-iconbtn--dark" aria-expanded={open} aria-label={open ? "Collapse test run" : "Expand test run"} onClick={() => setOpen((v) => !v)}>
            <Icon.chevron size={16} className={open ? "" : "rotate-180"} />
          </button>
        </div>
      </div>
      <div className="lk-console__samples">
        <span className="lk-console__k">Try</span>
        {samples.map((s) => (
          <button
            key={s.label}
            type="button"
            className="lk-sample"
            disabled={busy}
            onClick={() => {
              const f = { ...flags, ...s.flags } as Flags;
              setText(s.text);
              setFlags(f);
              run(s.text, null, f);
            }}
            title={s.text}
          >
            {s.label}
            {s.expect && <span className="lk-sample__lang">{s.expect}</span>}
          </button>
        ))}
        <div className="lk-seg lk-seg--lang" role="radiogroup" aria-label="Reply language" title="Auto: the reply follows the language you type in.">
          {(["auto", "en", "pis"] as const).map((l) => (
            <button key={l} type="button" role="radio" aria-checked={choice === l} onClick={() => setChoice(l)}>
              {l === "auto" ? "Auto" : l === "pis" ? "Pijin" : "English"}
            </button>
          ))}
        </div>
      </div>
      {micErr && <p className="lk-console__err">{micErr}</p>}
      {open && (
        <div className="lk-console__body">
          {t.status === "idle" && (
            <p className="lk-console__empty">
              Press Run or pick a Try example. The message goes through the four stages on the canvas, Hear, Look up, Think and Respond, and each card lights up with its measured time. The final reply appears here.
            </p>
          )}
          {t.status === "loading" && (
            <div className="lk-loading">
              <span>{t.progress?.message ?? (t.progress ? `Loading ${t.progress.model_id}` : "Starting the runtime…")}</span>
              <div className="lk-loading__bar">
                <span style={{ width: `${t.progress?.total_mb ? Math.min(100, (t.progress.loaded_mb / t.progress.total_mb) * 100) : 8}%` }} />
              </div>
              <em>Models download once, then stay cached on the device.</em>
            </div>
          )}
          {(t.status === "running" || t.status === "done" || t.status === "error") && (
            <div className="lk-console__grid">
              <ol className="lk-stagebar" aria-label="Stages and timings">
                {stageSteps.map(({ st, i, members, ms, state }) => (
                  <li key={st.key} className={`lk-stagebar__item is-${state}`}>
                    <span className="lk-stagebar__head">
                      <span className="lk-stagebar__num">{i + 1}</span>
                      <span className="lk-stagebar__name">{st.en}</span>
                      <span className="lk-stagebar__ms">{state === "active" ? "…" : state === "done" ? fmtMs(ms) : state === "skipped" ? "skipped" : state === "error" ? "error" : ""}</span>
                    </span>
                    <span className="lk-stagebar__nodes">
                      {members.map((n) => {
                        const s = t.steps[n.id];
                        return (
                          <button
                            key={n.id}
                            type="button"
                            className={`lk-step is-${s.state}`}
                            style={{ ["--c" as string]: NODE_META[n.type]?.color }}
                            onClick={() => useTrace.getState().set({ openPreview: t.openPreview === n.id ? null : n.id })}
                            disabled={!s.detail}
                            title={s.peek ?? s.note ?? n.label}
                          >
                            <NodeIcon type={n.type} size={12} />
                            <span className="lk-step__name">{NODE_META[n.type]?.name ?? n.label}</span>
                            {s.state === "done" && s.ms !== undefined && <span className="lk-step__ms">{fmtMs(s.ms)}</span>}
                          </button>
                        );
                      })}
                    </span>
                  </li>
                ))}
              </ol>
              <div className="lk-final">
                {t.status === "error" && (
                  <div className="lk-final__err">
                    <Icon.warn size={15} /> {t.error}
                  </div>
                )}
                {t.status === "running" && !res && (() => {
                  const active = ordered.find((n) => t.steps[n.id]?.state === "active");
                  const llmNode = graph.nodes.find((n) => n.type === "llm");
                  const d = llmNode ? t.steps[llmNode.id]?.detail : undefined;
                  const raw = d && d.kind === "llm" ? d.raw : "";
                  return (
                    <>
                      <div className="lk-final__livehead">
                        <span className="lk-peek__dot is-active" />
                        {active ? `${active.label}: working` : "Moving to the next stage"}
                      </div>
                      {raw ? <pre className="lk-final__live">{raw}</pre> : <p className="lk-console__empty" style={{ color: "#5c7482", marginTop: 6 }}>The model's raw reply streams here: the action, the manual section, then the reply.</p>}
                    </>
                  );
                })()}
                {res && (
                  <>
                    <div className="lk-final__top">
                      <ActionBadge action={res.gate?.action ?? res.reply?.action ?? "ASK_PERSON"} big />
                      {(res.gate?.stm ?? res.reply?.stm) && (res.gate?.stm ?? res.reply?.stm) !== "NONE" && (
                        <span className="lk-final__stm">
                          {graph.sector === "health" ? "Manual" : "Guide"}: {res.gate?.stm ?? res.reply?.stm}
                          {res.chunk ? `, page ${res.chunk.page}` : ""}
                        </span>
                      )}
                      {res.gate?.overridden && <span className="lk-final__gate">Safety check changed the model's answer</span>}
                      <span className="lk-final__ms">{(res.totalMs / 1000).toFixed(1)} s end to end</span>
                    </div>
                    <p className="lk-final__reply">{res.gate?.reply ?? res.reply?.body}</p>
                    <div className="lk-final__foot">
                      {t.audio && (
                        <button type="button" className="lk-play lk-play--dark" onClick={() => void playBuffer(t.audio!)}>
                          <Icon.play size={13} /> Play voice ({t.audio.duration.toFixed(1)} s)
                        </button>
                      )}
                      <span className="lk-runtime">
                        {t.runtime === "shim"
                          ? "Test runtime: canned replies for checking the screen"
                          : graph.sector !== "health" && !packKey.startsWith("idb:")
                            ? "Sample pack: answers come from the sample guide"
                            : "Real engine: generated on this device"}
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
