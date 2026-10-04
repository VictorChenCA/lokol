import { Link } from "react-router-dom";
import type { Chunk } from "../../types";
import { ACTION_META } from "./copy";
import type { BotMsg } from "./ReplyCard";
import type { RichStatus } from "./useDemoEngine";

/** Desktop-only side panel: the pack's nodes, with what each one did for the latest question. */
export function PipelinePanel({ status, last, hits, shim, voiceLabel }: { status: RichStatus | null; last: BotMsg | null; hits: Chunk[]; shim: boolean; voiceLabel: string | null }) {
  const llm = status?.llm;
  const running = last && last.stage !== "done" && last.stage !== "error";
  const steps = [
    {
      key: "rag",
      en: "Guideline lookup",
      pis: "Lukim buk",
      color: "#E9A93A",
      active: running && last?.stage === "lookup",
      body: hits.length ? (
        <ul className="space-y-0.5">
          {hits.slice(0, 3).map((h, i) => (
            <li key={h.id} className={`flex justify-between gap-2 ${i === 0 ? "text-white" : "text-white/55"}`}>
              <span className="truncate"><span className="capitalize">{h.section.toLowerCase()}</span>, p.{h.page}</span>
              {h.score !== undefined && <span className="tabular-nums">{h.score.toFixed(1)}</span>}
            </li>
          ))}
        </ul>
      ) : last ? (
        <span>No section matched</span>
      ) : (
        <span>BM25 over 183 STM chunks, Pijin synonyms</span>
      )
    },
    {
      key: "llm",
      en: "Language model",
      pis: "Brain",
      color: "#0F7B88",
      active: running && (last?.stage === "prefill" || last?.stage === "writing"),
      body: shim ? (
        <span>Shim: canned replies</span>
      ) : llm ? (
        <span>
          {llm.label}
          {llm.tuned ? "" : ", untuned"} · {Math.round(llm.size_mb)} MB
          {llm.threads ? ` · ${llm.threads} threads` : ""}
          {last?.stats?.tps ? ` · ${last.stats.tps} tok/s` : ""}
        </span>
      ) : (
        <span>Loading</span>
      )
    },
    {
      key: "gate",
      en: "Safety gate",
      pis: "Sef-gate",
      color: "#C32F49",
      active: false,
      body:
        last?.stage === "done" && last.action ? (
          <span>
            {ACTION_META[last.action].en}
            {last.overridden ? ", changed by the gate" : ", model answer kept"}
          </span>
        ) : (
          <span>12 danger signs force a referral; no citation means ask a person</span>
        )
    },
    { key: "tts", en: "Speech out", pis: "Toktok", color: "#7A5CA8", active: false, body: <span>{voiceLabel ?? "MMS Pijin voice, Kokoro English"}</span> }
  ];
  return (
    <aside className="sticky top-[76px] hidden h-fit w-[300px] shrink-0 lg:block" aria-label="What runs on this device">
      <div className="rounded-2xl bg-ink p-4 text-white shadow-node">
        <p className="font-display text-[16px] font-semibold">Running on this device</p>
        <p className="mt-0.5 text-[12.5px] text-white/60">The Lokol Health pack, node by node.</p>
        <ol className="relative mt-4 space-y-3">
          <span className="absolute bottom-3 left-[7px] top-3 w-px bg-white/15" aria-hidden />
          {steps.map((s) => (
            <li key={s.key} className="relative flex gap-3">
              <span className={`relative z-10 mt-1 h-[15px] w-[15px] shrink-0 rounded-full border-2 border-ink ${s.active ? "animate-pulse" : ""}`} style={{ background: s.color }} aria-hidden />
              <div className="min-w-0 flex-1 rounded-xl bg-white/[0.06] px-3 py-2">
                <p className="text-[13px] font-semibold">
                  {s.en} <span className="font-normal text-white/50">{s.pis}</span>
                </p>
                <div className="mt-0.5 text-[12px] leading-snug text-white/70">{s.body}</div>
              </div>
            </li>
          ))}
        </ol>
        {status && !shim && (
          <p className="mt-4 text-[11.5px] leading-snug text-white/50">
            {status.cross_origin_isolated ? "Multi-threaded WebAssembly" : "Single-threaded (page not cross-origin isolated)"}
            {status.memory_mb ? `, ${status.memory_mb} MB JS heap` : ""}. No request leaves the device while you chat.
          </p>
        )}
        <Link to="/studio" className="mt-4 inline-flex rounded-full bg-white/10 px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-white/20">
          Open this pack in the Studio
        </Link>
      </div>
    </aside>
  );
}
