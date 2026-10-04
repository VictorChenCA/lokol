import { useMemo, useState } from "react";
import { CATALOG } from "../../models";
import { copyText, int } from "./data";

type Backend = "river" | "mac";
type DataSrc = "lokol" | "upload" | "pdf";

const RECIPES: Record<string, { mlx?: string; layers?: number; iters?: number; lr?: string; exporter?: "std" | "qwen35"; tag: string; river?: string }> = {
  "qwen3-0.6b-base": { mlx: "mlx-community/Qwen3-0.6B-bf16", layers: 28, iters: 700, lr: "2e-4", exporter: "std", tag: "qwen3-0.6b" },
  "qwen3.5-0.8b-base": { mlx: "mlx-community/Qwen3.5-0.8B-MLX-bf16", layers: 1, iters: 700, lr: "2e-4", exporter: "qwen35", tag: "0.8B" },
  "qwen3-1.7b-base": { mlx: "mlx-community/Qwen3-1.7B-bf16", layers: 28, iters: 600, lr: "1.5e-4", exporter: "std", tag: "qwen3-1.7b" },
  "qwen3.5-9b-base": { river: "Qwen/Qwen3.5-9B", tag: "9b" }
};

type UploadCheck = { name: string; rows: number; ok: number; langs: Record<string, number>; firstError?: string };

async function checkJsonl(file: File): Promise<UploadCheck> {
  const text = await file.text();
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  let ok = 0;
  let firstError: string | undefined;
  const langs: Record<string, number> = {};
  lines.forEach((l, i) => {
    try {
      const j = JSON.parse(l);
      const msgs = j.messages as { role: string; content: string }[] | undefined;
      const a = msgs?.find((m) => m.role === "assistant")?.content ?? j.assistant ?? "";
      const u = msgs?.find((m) => m.role === "user")?.content ?? j.user ?? "";
      const lang = (u.match(/\[lang=(\w+)\]/) || [])[1];
      if (lang) langs[lang] = (langs[lang] ?? 0) + 1;
      if (/^ACTION:\s*(ADVISE|REFER_NOW|REFER_NEXT_TRANSPORT|ASK_PERSON)\s*\nSTM:\s*.+\n---\n/m.test(a)) ok++;
      else if (!firstError) firstError = `Line ${i + 1}: the assistant turn must start with ACTION:, STM: and ---`;
    } catch {
      if (!firstError) firstError = `Line ${i + 1} is not valid JSON`;
    }
  });
  return { name: file.name, rows: lines.length, ok, langs, firstError };
}

function Radio<T extends string>({ name, value, current, onChange, title, sub, disabled }: { name: string; value: T; current: T; onChange: (v: T) => void; title: string; sub: string; disabled?: boolean }) {
  const on = value === current;
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 transition-colors ${
        disabled ? "cursor-not-allowed opacity-50" : on ? "border-ink bg-white shadow-card" : "border-line bg-white/70 hover:border-ink-4"
      }`}
    >
      <input type="radio" name={name} value={value} checked={on} disabled={disabled} onChange={() => onChange(value)} className="mt-1 accent-[#0F7B88]" />
      <span className="min-w-0">
        <span className="block text-[14px] font-semibold text-ink">{title}</span>
        <span className="block text-[12.5px] leading-snug text-ink-3">{sub}</span>
      </span>
    </label>
  );
}

export function TrainYourOwn() {
  const bases = useMemo(() => CATALOG.filter((m) => m.node === "llm" && m.variant === "base"), []);
  const [baseId, setBaseId] = useState(bases[0]?.id ?? "qwen3-0.6b-base");
  const [src, setSrc] = useState<DataSrc>("lokol");
  const [langs, setLangs] = useState<{ pis: boolean; en: boolean }>({ pis: true, en: true });
  const [name, setName] = useState("lokol-health-custom");
  const [upload, setUpload] = useState<UploadCheck | null>(null);
  const [copied, setCopied] = useState(false);
  const recipe = RECIPES[baseId] ?? RECIPES["qwen3-0.6b-base"];
  const riverOnly = !!recipe.river;
  const [backendPick, setBackend] = useState<Backend>("mac");
  const backend: Backend = riverOnly ? "river" : backendPick === "river" ? "mac" : backendPick;
  const base = bases.find((b) => b.id === baseId);
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9.-]+/g, "-").replace(/^-+|-+$/g, "") || "lokol-custom";

  const command = useMemo(() => {
    const L: string[] = [];
    const langFilter = langs.pis && langs.en ? null : langs.pis ? "pis" : langs.en ? "en" : null;
    let train = "data/synth/train.jsonl";
    let val = "data/synth/val.jsonl";
    if (src === "pdf") {
      L.push("# Guideline PDF -> text -> section chunks (the lookup node uses the same chunks)");
      L.push(`pdftotext -layout my-guideline.pdf data/raw/${slug}.txt`);
      L.push(".venv/bin/python pipeline/corpus.py            # set SRC at the top to data/raw/" + slug + ".txt");
      L.push("");
      L.push("# Teacher models on River write ~3,600 protocol cases, then 11 checks + judge");
      L.push("set -a; . ./.env; set +a");
      L.push(".venv/bin/python pipeline/synth.py --target 3600 --workers 24 --kimi-share 0.5");
      L.push(".venv/bin/python pipeline/validate.py --val 300 --test 300");
      L.push("");
    } else if (src === "upload") {
      train = `data/custom/${slug}/train.jsonl`;
      val = `data/custom/${slug}/val.jsonl`;
      L.push(`# Your file (${upload ? `${upload.name}, ${upload.ok}/${upload.rows} rows in protocol` : "jsonl in the Lokol protocol"}): hold out 10% for validation`);
      L.push(`mkdir -p data/custom/${slug}`);
      L.push(`.venv/bin/python -c "import random; L=open('${upload?.name ?? "my-data.jsonl"}').readlines(); random.Random(0).shuffle(L); n=len(L)//10; open('${val}','w').writelines(L[:n]); open('${train}','w').writelines(L[n:])"`);
      L.push("");
    }
    if (langFilter) {
      L.push(`# Keep ${langFilter === "pis" ? "Pijin" : "English"} rows only`);
      L.push(`jq -c 'select(.messages[1].content | test("\\\\[lang=${langFilter}\\\\]"))' ${train} > ${train.replace(".jsonl", `.${langFilter}.jsonl`)}`);
      train = train.replace(".jsonl", `.${langFilter}.jsonl`);
      L.push("");
    }
    if (backend === "river") {
      L.push(`# LoRA on River: ${recipe.river}, rank 16, 180 steps (about 45 min, a few dollars)`);
      if (src !== "pdf") L.push("set -a; . ./.env; set +a");
      L.push(".venv/bin/python pipeline/train_river.py \\");
      L.push(`  --data ${train} --val ${val} \\`);
      L.push(`  --base ${recipe.river} --steps 180 --batch 32 --lr 2e-4 --rank 16 \\`);
      L.push(`  --name ${slug} --out models/river/${slug}`);
      L.push("");
      L.push("# Best checkpoint (river:// path) for the node's online toggle");
      L.push(`jq -r .best.inference models/river/${slug}/checkpoint.json`);
    } else {
      const mlxData = src === "lokol" && !langFilter ? "data/mlx/0.8B" : `data/mlx/${slug}`;
      if (mlxData !== "data/mlx/0.8B") {
        L.push("# mlx-lm wants {messages:[...]} rows in train/valid files");
        L.push(`mkdir -p ${mlxData} && jq -c '{messages}' ${train} > ${mlxData}/train.jsonl && jq -c '{messages}' ${val} > ${mlxData}/valid.jsonl`);
        L.push("");
      }
      L.push(`# LoRA on this Mac (Apple silicon, mlx-lm): ${recipe.layers} layer${recipe.layers === 1 ? "" : "s"}, ${recipe.iters} iterations, $0`);
      L.push(`MODEL=${recipe.mlx} LAYERS=${recipe.layers} BATCH=4 LR=${recipe.lr} MAXLEN=1280 \\`);
      L.push(`  pipeline/train_mlx.sh ${slug} ${mlxData} ${recipe.iters}`);
      L.push("");
      L.push("# Merge + quantize to a 4-bit GGUF for phones (wllama, PocketPal) and laptops (llama-server)");
      L.push(recipe.exporter === "std" ? `pipeline/export_gguf_std.sh ${slug} models/fused/${slug}` : `SMOKE=0 pipeline/export_gguf.sh ${slug}`);
    }
    L.push("");
    L.push("# Base vs tuned on the held-out test set -> Eval page");
    L.push(`.venv/bin/python pipeline/eval.py --model ${backend === "river" ? `"$(jq -r .best.inference models/river/${slug}/checkpoint.json)" --base ${recipe.river}` : `models/gguf/${slug}-Q4_K_M.gguf`} --name tuned-${base?.size_label.toLowerCase() ?? "custom"}-${slug} --data data/synth/test.jsonl --out eval/${slug}.json --judge 60`);
    return L.join("\n");
  }, [src, slug, langs, backend, recipe, upload, base]);

  const copy = async () => {
    if (await copyText(command)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <form className="space-y-6" onSubmit={(e) => e.preventDefault()} aria-label="Train your own node">
        <fieldset>
          <legend className="text-[14px] font-semibold">
            Base model <span className="font-normal text-ink-3">Stat model</span>
          </legend>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {bases.map((b) => (
              <Radio
                key={b.id}
                name="base"
                value={b.id}
                current={baseId}
                onChange={setBaseId}
                title={`${b.family} ${b.size_label}`}
                sub={b.tiers.includes("A") ? "2 GB phone and up" : b.tiers.includes("B") ? "4 GB phone and up" : "Laptop or clinic PC"}
              />
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-[14px] font-semibold">
            Training data <span className="font-normal text-ink-3">Data fo trenem</span>
          </legend>
          <div className="mt-2 space-y-2">
            <Radio name="src" value="lokol" current={src} onChange={setSrc} title="Lokol Health set" sub="2,704 synthetic rows from the Solomon Islands child STM, Pijin and English" />
            <Radio name="src" value="upload" current={src} onChange={setSrc} title="Upload a JSONL file" sub="Rows in the Lokol protocol: flags, guideline line, ACTION / STM / reply" />
            <Radio name="src" value="pdf" current={src} onChange={setSrc} title="Generate from a guideline PDF" sub="Chunk your manual, then teacher models on River write the cases" />
          </div>
          {src === "upload" && (
            <div className="mt-3 rounded-xl border border-dashed border-line bg-white p-3">
              <label className="block text-[13px] font-medium text-ink-2" htmlFor="jsonl-file">
                Choose a .jsonl file (checked here in the browser; nothing is uploaded)
              </label>
              <input
                id="jsonl-file"
                type="file"
                accept=".jsonl,.json,application/json"
                className="mt-2 block w-full text-[13px] file:mr-3 file:rounded-md file:border-0 file:bg-ink file:px-3 file:py-1.5 file:text-[13px] file:font-medium file:text-white"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  setUpload(f ? await checkJsonl(f) : null);
                }}
              />
              {upload && (
                <p className={`mt-2 text-[12.5px] ${upload.ok === upload.rows && upload.rows ? "text-palm-deep" : "text-frangipani-deep"}`} role="status">
                  {int(upload.ok)} of {int(upload.rows)} rows follow the protocol
                  {Object.keys(upload.langs).length ? ` (${Object.entries(upload.langs).map(([k, v]) => `${k} ${v}`).join(", ")})` : ""}.
                  {upload.firstError ? ` ${upload.firstError}.` : ""}
                </p>
              )}
            </div>
          )}
        </fieldset>

        <div className="grid gap-6 sm:grid-cols-2">
          <fieldset>
            <legend className="text-[14px] font-semibold">
              Languages <span className="font-normal text-ink-3">Langguis</span>
            </legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {(
                [
                  ["pis", "Pijin"],
                  ["en", "English"]
                ] as const
              ).map(([k, l]) => (
                <label key={k} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-[14px] ${langs[k] ? "border-ink bg-white" : "border-line bg-white/70"}`}>
                  <input
                    type="checkbox"
                    checked={langs[k]}
                    onChange={(e) => setLangs((s) => ({ ...s, [k]: e.target.checked }))}
                    className="accent-[#0F7B88]"
                  />
                  {l}
                </label>
              ))}
            </div>
            {!langs.pis && !langs.en && <p className="mt-1.5 text-[12px] text-frangipani-deep">Pick at least one; with none, all rows are kept.</p>}
          </fieldset>
          <fieldset>
            <legend className="text-[14px] font-semibold">
              Where it trains <span className="font-normal text-ink-3">Wea nao</span>
            </legend>
            <div className="mt-2 inline-flex rounded-lg border border-line bg-white p-0.5" role="radiogroup" aria-label="Backend">
              {(
                [
                  ["river", "River"],
                  ["mac", "This Mac"]
                ] as const
              ).map(([k, l]) => {
                const disabled = (k === "mac" && riverOnly) || (k === "river" && !riverOnly);
                return (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={backend === k}
                    disabled={disabled}
                    onClick={() => setBackend(k)}
                    title={disabled ? (k === "river" ? "River's smallest base is Qwen3.5-9B" : "9B is too large to fine-tune on a laptop GPU") : undefined}
                    className={`rounded-md px-3 py-1.5 text-[13px] font-medium disabled:cursor-not-allowed disabled:opacity-40 ${backend === k ? "bg-ink text-white" : "text-ink-2 hover:bg-sand"}`}
                  >
                    {l}
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-[12px] text-ink-3">{riverOnly ? "River trains the 9B on hosted GPUs." : "Phone tiers train locally with mlx-lm."}</p>
          </fieldset>
        </div>

        <div>
          <label htmlFor="node-name" className="text-[14px] font-semibold">
            Node name
          </label>
          <input id="node-name" className="input mt-2 font-mono text-[14px]" value={name} onChange={(e) => setName(e.target.value)} spellCheck={false} />
        </div>
      </form>

      <div className="min-w-0">
        <div className="on-dark overflow-hidden rounded-2xl border border-canvas-line bg-canvas shadow-lift">
          <div className="flex items-center justify-between gap-3 border-b border-canvas-line px-4 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold text-canvas-text">
                {slug} <span className="font-normal text-canvas-muted">from {base?.name.replace(" (base)", "")} on {backend === "river" ? "River" : "this Mac"}</span>
              </p>
            </div>
            <button type="button" onClick={copy} className="btn-on-dark btn-sm shrink-0" aria-live="polite">
              {copied ? "Copied" : "Copy commands"}
            </button>
          </div>
          <pre className="max-h-[520px] overflow-auto p-4 font-mono text-[12.5px] leading-relaxed text-canvas-text">
            {command.split("\n").map((line, i) => (
              <div key={i} className={line.startsWith("#") ? "text-canvas-muted" : ""}>
                {line || " "}
              </div>
            ))}
          </pre>
        </div>
        <p className="mt-3 text-[12.5px] leading-relaxed text-ink-3">
          Studio writes the commands; it does not run them. They are the same scripts that trained the Lokol Health nodes above, run from the repo root.
          The finished GGUF drops into any language-model node in Studio.
        </p>
      </div>
    </div>
  );
}
