import { useEffect, useRef, useState } from "react";
import type { Flags, Lang, Transport, YesNoUnknown } from "../../types";
import { useStudio } from "../../store";
import { NODE_META } from "../../models";
import { ActionBadge } from "../ui";
import { useTrace, runTrace, stopTrace, playBuffer } from "./trace";
import { Icon, NodeIcon } from "./icons";
import { stageIndex } from "./layout";

interface Sample {
  label: string;
  text: string;
  flags: Partial<Flags> & { lang: Lang };
  expect: string;
}

const SAMPLES: Sample[] = [
  { label: "Hot bodi, no RDT", text: "Pikinini blong mi hem hot bodi tu dei, no RDT long klinik.", flags: { lang: "pis", rdt: "no", act: "yes", transport: "next_boat" }, expect: "Advise" },
  { label: "Sek-sek, no save dring", text: "Bebi hem sek-sek an no save dring susu.", flags: { lang: "pis", rdt: "unknown", act: "yes", transport: "next_boat" }, expect: "Refer" },
  { label: "Fever, RDT positive", text: "Child 3 years, fever two days, RDT positive, no danger signs.", flags: { lang: "en", rdt: "yes", act: "yes", transport: "now" }, expect: "Advise" },
  { label: "Adult chest pain", text: "Adult man with chest pain, what dose of medicine should I give?", flags: { lang: "en", rdt: "unknown", act: "unknown", transport: "now" }, expect: "Ask a person" }
];

const YNU: { v: YesNoUnknown; l: string }[] = [
  { v: "yes", l: "yes" },
  { v: "no", l: "no" },
  { v: "unknown", l: "?" }
];

function Tri({ label, value, onChange }: { label: string; value: YesNoUnknown; onChange: (v: YesNoUnknown) => void }) {
  return (
    <div className="lk-tri" role="radiogroup" aria-label={label}>
      <span>{label}</span>
      {YNU.map((o) => (
        <button key={o.v} type="button" role="radio" aria-checked={value === o.v} onClick={() => onChange(o.v)}>
          {o.l}
        </button>
      ))}
    </div>
  );
}

export function TraceConsole() {
  const graph = useStudio((s) => s.graph);
  const t = useTrace();
  const [text, setText] = useState(SAMPLES[0].text);
  const [flags, setFlags] = useState<Flags>({ lang: "pis", rdt: "no", act: "yes", transport: "next_boat" });
  const [open, setOpen] = useState(false);
  const [rec, setRec] = useState<MediaRecorder | null>(null);
  const [micErr, setMicErr] = useState<string | null>(null);
  const chunks = useRef<Blob[]>([]);

  useEffect(() => {
    if (t.status !== "idle") setOpen(true);
  }, [t.status]);

  const busy = t.status === "loading" || t.status === "running";
  const run = (msg = text, audio: Blob | null = null, f = flags) => {
    if (!msg.trim() && !audio) return;
    void runTrace({ graph, text: msg, audio, flags: f });
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

  return (
    <div className={`lk-console ${open ? "is-open" : ""}`} role="region" aria-label="Trace console">
      <div className="lk-console__bar">
        <div className="lk-console__title">
          <span>Trace</span>
          <em>Traem</em>
        </div>
        <div className="lk-seg" role="radiogroup" aria-label="Language">
          {(["pis", "en"] as Lang[]).map((l) => (
            <button key={l} type="button" role="radio" aria-checked={flags.lang === l} onClick={() => setFlags({ ...flags, lang: l })}>
              {l === "pis" ? "Pijin" : "English"}
            </button>
          ))}
        </div>
        <form
          className="lk-console__form"
          onSubmit={(e) => {
            e.preventDefault();
            run();
          }}
        >
          <input className="lk-console__input" value={text} onChange={(e) => setText(e.target.value)} placeholder={flags.lang === "pis" ? "Raetem kwestin blong iu…" : "Type what the nurse would ask…"} aria-label="Message to trace" />
          <button type="button" className={`lk-mic ${rec ? "is-rec" : ""}`} onClick={toggleMic} aria-label={rec ? "Stop recording" : "Record a voice note"} title={rec ? "Stop and run" : "Record up to 10 s"}>
            {rec ? <Icon.stop size={14} /> : <Icon.mic size={16} />}
          </button>
          {busy ? (
            <button type="button" className="lk-run is-stop" onClick={stopTrace}>
              <Icon.stop size={12} /> Stop
            </button>
          ) : (
            <button type="submit" className="lk-run" disabled={!text.trim()}>
              <Icon.play size={13} /> Run trace
            </button>
          )}
        </form>
        <button type="button" className="lk-iconbtn lk-iconbtn--dark" aria-expanded={open} aria-label={open ? "Collapse trace console" : "Expand trace console"} onClick={() => setOpen((v) => !v)}>
          <Icon.chevron size={16} className={open ? "" : "rotate-180"} />
        </button>
      </div>
      <div className="lk-console__samples">
        <span className="lk-console__k">Try</span>
        {SAMPLES.map((s) => (
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
            <span className="lk-sample__lang">{s.flags.lang === "pis" ? "PIS" : "EN"}</span>
            {s.label}
          </button>
        ))}
        <span className="lk-console__flags">
          <Tri label="RDT kit" value={flags.rdt} onChange={(v) => setFlags({ ...flags, rdt: v })} />
          <Tri label="Coartem" value={flags.act} onChange={(v) => setFlags({ ...flags, act: v })} />
          <label className="lk-tri">
            <span>Transport</span>
            <select value={flags.transport} onChange={(e) => setFlags({ ...flags, transport: e.target.value as Transport })} aria-label="Transport">
              <option value="now">now</option>
              <option value="next_boat">next boat</option>
              <option value="none">none</option>
            </select>
          </label>
        </span>
      </div>
      {micErr && <p className="lk-console__err">{micErr}</p>}
      {open && (
        <div className="lk-console__body">
          {t.status === "idle" && (
            <p className="lk-console__empty">
              Run a message through the pack to watch it move stage by stage: hear, look up the manual, think, check, speak. Each node lights up while it works and shows how long it took.
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
              <ol className="lk-steps" aria-label="Steps">
                {visited.map((n) => {
                  const s = t.steps[n.id];
                  return (
                    <li key={n.id} className={`lk-step is-${s.state}`} style={{ ["--c" as string]: NODE_META[n.type]?.color }}>
                      <button type="button" onClick={() => useTrace.getState().set({ openPreview: t.openPreview === n.id ? null : n.id })} disabled={!s.detail}>
                        <NodeIcon type={n.type} size={14} />
                        <span className="lk-step__name">{n.label}</span>
                        <span className="lk-step__ms">{s.state === "done" && s.ms !== undefined ? (s.ms < 1000 ? `${s.ms} ms` : `${(s.ms / 1000).toFixed(1)} s`) : s.state === "active" ? "…" : s.state === "skipped" ? "skipped" : s.state === "error" ? "error" : ""}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
              <div className="lk-final">
                {t.status === "error" && (
                  <div className="lk-final__err">
                    <Icon.warn size={15} /> {t.error}
                  </div>
                )}
                {t.status === "running" && !res && <p className="lk-console__empty">Working through the graph…</p>}
                {res && (
                  <>
                    <div className="lk-final__top">
                      <ActionBadge action={res.gate?.action ?? res.reply?.action ?? "ASK_PERSON"} big />
                      {(res.gate?.stm ?? res.reply?.stm) && (res.gate?.stm ?? res.reply?.stm) !== "NONE" && (
                        <span className="lk-final__stm">
                          STM: {res.gate?.stm ?? res.reply?.stm}
                          {res.chunk ? `, page ${res.chunk.page}` : ""}
                        </span>
                      )}
                      <span className="lk-final__ms">{(res.totalMs / 1000).toFixed(1)} s end to end</span>
                    </div>
                    <p className="lk-final__reply">{res.gate?.reply ?? res.reply?.body}</p>
                    <div className="lk-final__foot">
                      {t.audio && (
                        <button type="button" className="lk-play lk-play--dark" onClick={() => void playBuffer(t.audio!)}>
                          <Icon.play size={13} /> Play voice ({t.audio.duration.toFixed(1)} s)
                        </button>
                      )}
                      <span className="lk-runtime">{t.runtime === "shim" ? "Shim runtime: canned replies for UI testing" : "Real engine: generated on this device"}</span>
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
