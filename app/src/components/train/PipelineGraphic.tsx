import type { DatasetCard } from "../../types";
import { int } from "./data";

type Stage = {
  key: string;
  figure: string;
  unit: string;
  title: string;
  body: string;
  glow: string;
  chips?: string[];
};

/** "How a Lokol node is trained": the data and training pipeline as one dark lagoon band. */
export function PipelineGraphic({ card }: { card: DatasetCard | null }) {
  const raw = card?.pipeline.raw ?? 3829;
  const valid = card?.pipeline.valid ?? 3602;
  const dropped = card?.pipeline.rejected_total ?? 227;
  const s = card?.splits ?? { train: 2704, val: 300, test: 300 };
  const chunks = card?.source.chunks ?? 183;
  const sections = card?.source.sections ?? 56;
  const heldOut = 150;

  const stages: Stage[] = [
    {
      key: "corpus",
      figure: int(chunks),
      unit: "chunks",
      title: "Guideline corpus",
      body: `The Standard Treatment Manual for Children (2017), split into ${sections} sections. The same chunks feed the lookup node at run time.`,
      glow: "var(--glow-rag)"
    },
    {
      key: "teacher",
      figure: int(raw),
      unit: "synthetic cases",
      title: "Teacher models on River",
      body: "Open-weight teachers write nurse messages and protocol answers from each chunk, in Pijin, English and mixed.",
      glow: "var(--glow-tts)",
      chips: ["DeepSeek-V4.1-Flash", "Kimi-K2.6"]
    },
    {
      key: "checks",
      figure: "11",
      unit: "validation rules",
      title: "Checks and judge",
      body: `Format, red flags, abstain, Pijin glossary, no Tok Pisin leaks. ${int(dropped)} dropped, ${int(valid)} kept; Claude grades a sample for faithfulness.`,
      glow: "var(--glow-gate)"
    },
    {
      key: "split",
      figure: int(s.train),
      unit: "train rows",
      title: "Split, with held-out cases",
      body: `${int(s.val)} validation and ${int(s.test)} test rows. ${heldOut} test rows use presentations the model never sees in training.`,
      glow: "var(--glow-channel)"
    },
    {
      key: "lora",
      figure: "LoRA",
      unit: "fine-tune",
      title: "Train each tier",
      body: "Same data, four sizes. The 9B trains on River; the phone tiers train on this Mac.",
      glow: "var(--glow-llm)",
      chips: ["River: Qwen3.5 9B", "Mac: Qwen3 0.6B, 1.7B", "Mac: Qwen3.5 0.8B"]
    },
    {
      key: "gguf",
      figure: "Q4",
      unit: "GGUF",
      title: "Quantize for devices",
      body: "Merged and quantized to 4-bit: 0.4 GB for a 2 GB phone, 5.5 GB for a clinic laptop.",
      glow: "var(--glow-stt)"
    },
    {
      key: "eval",
      figure: int(s.test),
      unit: "test cases",
      title: "Evaluate base against tuned",
      body: "Same prompt, same guideline chunk, only the weights differ. Results on the Eval page.",
      glow: "var(--glow-note)"
    }
  ];

  return (
    <section aria-labelledby="pipeline-h" className="on-dark relative overflow-hidden rounded-[28px] bg-canvas text-canvas-text">
      <div className="canvas-dots pointer-events-none absolute inset-0 opacity-60" aria-hidden />
      <div
        className="pointer-events-none absolute -right-24 -top-32 h-80 w-80 rounded-full opacity-40 blur-3xl"
        style={{ background: "radial-gradient(circle, rgba(46,196,211,0.35), transparent 70%)" }}
        aria-hidden
      />
      <div className="relative px-5 pb-6 pt-7 sm:px-8 sm:pt-9">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[13px] font-medium text-canvas-muted">Lokol Health, language model node</p>
            <h2 id="pipeline-h" className="mt-1 font-display text-d-md font-bold text-white">
              How a Lokol node is trained
            </h2>
          </div>
          <p className="max-w-[46ch] text-[14px] leading-relaxed text-canvas-muted">
            One guideline in, one small model per device tier out. Every number below comes from the run that built the
            Lokol Health pack.
          </p>
        </div>

        <ol className="relative mt-8 grid gap-0 lg:grid-cols-7 lg:gap-3">
          {/* connector rail (desktop) */}
          <svg className="pointer-events-none absolute left-0 right-0 top-[18px] hidden h-2 w-full lg:block" preserveAspectRatio="none" viewBox="0 0 100 2" aria-hidden>
            <line x1="2" y1="1" x2="98" y2="1" stroke="var(--canvas-line)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
            <line x1="2" y1="1" x2="98" y2="1" stroke="var(--reef-bright)" strokeOpacity="0.7" strokeWidth="2" vectorEffect="non-scaling-stroke" className="edge-dash" />
          </svg>
          {stages.map((st, i) => (
            <li key={st.key} className="relative flex gap-4 pb-6 lg:block lg:pb-0">
              {/* connector rail (mobile) */}
              {i < stages.length - 1 && (
                <span className="absolute bottom-0 left-[17px] top-9 w-[2px] bg-canvas-line lg:hidden" aria-hidden />
              )}
              <span
                className="relative z-10 grid h-9 w-9 shrink-0 place-items-center rounded-full border-2 bg-canvas font-display text-[14px] font-bold"
                style={{ borderColor: st.glow, color: st.glow, boxShadow: `0 0 18px -4px ${st.glow}` }}
              >
                {i + 1}
              </span>
              <div className="min-w-0 lg:mt-4">
                <div className="flex items-baseline gap-1.5 lg:block">
                  <div className="font-display text-[30px] font-bold leading-none tracking-tight text-white tabular-nums lg:text-[34px]">{st.figure}</div>
                  <div className="text-[12.5px] font-medium lg:mt-1" style={{ color: st.glow }}>
                    {st.unit}
                  </div>
                </div>
                <h3 className="mt-2 text-[15px] font-semibold leading-snug text-white">{st.title}</h3>
                <p className="mt-1 text-[13px] leading-relaxed text-canvas-muted">{st.body}</p>
                {st.chips && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {st.chips.map((c) => (
                      <span key={c} className="rounded-md border border-canvas-line bg-canvas-2 px-1.5 py-0.5 text-[11.5px] font-medium text-canvas-text">
                        {c}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
