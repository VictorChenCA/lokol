import { useTrace, playBuffer } from "./trace";
import { ACTION_COPY } from "../ui";
import { Icon } from "./icons";

/** Expanded output of one node after a trace run. Rendered under the card, above the canvas. */
export function TracePreview({ nodeId, side = "right" }: { nodeId: string; side?: "left" | "right" }) {
  const step = useTrace((s) => s.steps[nodeId]);
  const audio = useTrace((s) => s.audio);
  const d = step?.detail;
  if (!d) return null;
  return (
    <div className={`lk-preview lk-preview--${side} nodrag nopan nowheel`} onClick={(e) => e.stopPropagation()}>
      {d.kind === "message" && (
        <>
          <h4>{d.via === "voice" ? "Voice note" : "Typed message"}</h4>
          <p className="lk-preview__quote">{d.text}</p>
        </>
      )}
      {d.kind === "stt" && (
        <>
          <h4>Transcript</h4>
          {d.text ? <p className="lk-preview__quote">{d.text}</p> : <p className="lk-preview__muted">{d.reason}</p>}
        </>
      )}
      {d.kind === "rag" && (
        <>
          <h4>Retrieved from the Standard Treatment Manual</h4>
          {d.chunks.length === 0 && <p className="lk-preview__muted">No section matched well enough. The model sees “guideline: none” and should say “Mi no sua”.</p>}
          {d.chunks.map((c, i) => (
            <div key={c.id} className={`lk-chunk ${i === 0 ? "is-top" : ""}`}>
              <div className="lk-chunk__head">
                <strong>{c.section}</strong>
                <span>page {c.page}{c.score !== undefined ? `, score ${c.score.toFixed(1)}` : ""}</span>
              </div>
              {c.subsection && <div className="lk-chunk__sub">{c.subsection}</div>}
              {i === 0 && <p>{c.text.length > 260 ? `${c.text.slice(0, 260)}…` : c.text}</p>}
            </div>
          ))}
        </>
      )}
      {d.kind === "llm" && (
        <>
          <h4>Raw model output (Lokol protocol)</h4>
          <pre className="lk-raw">{d.raw || "…"}</pre>
          {d.reply?.stats && (
            <p className="lk-preview__muted">
              {d.reply.stats.tokens ?? "?"} tokens{d.reply.stats.tps ? `, ${d.reply.stats.tps} tokens/s` : ""}
            </p>
          )}
        </>
      )}
      {d.kind === "gate" && (
        <>
          <h4>Gate decision</h4>
          <div className={`lk-decision tone-${ACTION_COPY[d.gate.action].tone}`}>
            <strong>{ACTION_COPY[d.gate.action].label}</strong>
            <span>{ACTION_COPY[d.gate.action].pijin}</span>
          </div>
          {d.gate.red_flags.length > 0 && (
            <p>
              Red flags: <strong>{(d.gate.red_flag_labels ?? d.gate.red_flags).join(", ")}</strong>
            </p>
          )}
          <p className="lk-preview__muted">{d.gate.overridden ? `Overrode the model: ${d.gate.reason ?? "rule match"}.` : "The model's answer passed the rules unchanged."}</p>
          <p className="lk-preview__quote">{d.gate.reply}</p>
        </>
      )}
      {d.kind === "note" && (
        <>
          <h4>Log entry kept on this device</h4>
          <pre className="lk-raw">{JSON.stringify(d.record, null, 2)}</pre>
        </>
      )}
      {d.kind === "tts" && (
        <>
          <h4>{d.lang === "pis" ? "Spoken reply in Pijin" : "Spoken reply in English"}</h4>
          <button type="button" className="lk-play" disabled={!audio} onClick={() => audio && void playBuffer(audio)}>
            <Icon.play size={14} /> Play {d.seconds ? `${d.seconds.toFixed(1)} s` : ""}
          </button>
        </>
      )}
      {d.kind === "out" && (
        <>
          <h4>Reply the nurse sees</h4>
          <p className="lk-preview__quote">{d.text}</p>
        </>
      )}
    </div>
  );
}
