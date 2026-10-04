# app/public/eval: what the Studio Eval page reads

`app/src/pages/Eval.tsx` fetches `/eval/results.json` (falls back to `results.sample.json`) and, for the
"same prompt, base against tuned" gallery, uses `samples` from that file or else `/eval/samples.sample.json`.
TypeScript types: `EvalResults`, `EvalRow`, `EvalMetrics` and the merged extensions `EvalSlice`, `EvalSample`,
`EvalSampleOutput` in `app/src/types.ts`. Everything marked optional can be left out; the page shows an empty
state for it.

```jsonc
{
  "sample": false,                         // true = placeholder numbers (page shows a banner)
  "generated_at": "2026-10-04T01:30:00-0700",
  "test_set": { "n": 300, "path": "data/synth/test.jsonl" },
  "rows": [
    {
      "model": "Lokol-Health-0.6B",        // display name; "(stub)" / "(smoke)" in the name marks a smoke row
      "size": "0.6B",                      // groups base + tuned; one of 0.6B 0.8B 1.7B 9B (others work too)
      "variant": "tuned",                  // "base" | "tuned"
      "runtime": "llama.cpp Q4_K_M",       // or "River LoRA r16", "River (hosted)"
      "model_id": "lokol-health-qwen3-0.6b", // OPTIONAL catalog id (app/src/models.ts)
      "tier": "A",                         // OPTIONAL; derived from size when absent (0.6/0.8 A, 1.7/2 B, 4 C, 9 D)
      "metrics": {
        "format_compliance": 0.97,         // 0..1  "Follows the protocol format"
        "action_accuracy": 0.84,           // 0..1  "Right action"
        "stm_accuracy": 0.86,              // 0..1  "Cites the right manual section"
        "red_flag_recall": 0.95,           // 0..1  "Catches danger signs"
        "abstain_precision": 0.82,         // 0..1  (table only)
        "abstain_recall": 0.78,            // 0..1  "Says not sure, ask a person"
        "pijin_glossary_hit_rate": 0.81,   // 0..1  "Answers in Pijin" (Pijin rows with >= 3 glossary words)
        "judge_faithfulness_0_3": 2.3,     // 0..3; 0 on both base and tuned = "judge not run"
        "tokens_per_s": 95,                // OPTIONAL, llama-bench tg64 or generation rate
        "ram_mb": 780                      // OPTIONAL, resident memory or Q4 file size in MB
      },
      // OPTIONAL: exactly what pipeline/eval.py score() already returns as metrics.per_lang / metrics.per_task
      "per_lang": { "pis": { "n": 122, "format": 0.98, "action_acc": 0.85, "stm_acc": 0.87 },
                    "en":  { "n": 126, "format": 0.97, "action_acc": 0.84, "stm_acc": 0.86 },
                    "mix": { "n": 52,  "format": 0.96, "action_acc": 0.80, "stm_acc": 0.83 } },
      "per_task": { "guidance": { "n": 121, "format": 0.99, "action_acc": 0.9, "stm_acc": 0.9 } }
    }
  ],
  // OPTIONAL: 4 test prompts, same prompt for base and tuned. Pick one each of: Pijin red-flag referral,
  // abstain, Pijin guidance, visit note. Keep "text" as the raw model reply (the page clips long ones).
  "samples": [
    {
      "id": "t-00123-2",
      "task": "referral",                  // guidance | referral | note | followup | abstain
      "lang": "pis",                       // pis | en | mix
      "flags": { "rdt": "yes", "act": "yes", "transport": "now" },
      "guideline": { "section": "CONVULSIONS", "page": 36 },   // or null
      "message": "Pikinini 2 yia hem fit nao ...",
      "gold": { "action": "REFER_NOW", "stm": "CONVULSIONS" },
      "outputs": [
        { "variant": "base",  "model": "Qwen3-0.6B (stock, Q4_K_M)", "size": "0.6B", "text": "<raw reply>",
          "action": null, "stm": null, "format_ok": false },
        { "variant": "tuned", "model": "Lokol Health 0.6B (Q4_K_M)", "size": "0.6B", "text": "ACTION: REFER_NOW\nSTM: CONVULSIONS\n---\n...",
          "action": "REFER_NOW", "stm": "CONVULSIONS", "format_ok": true }
        // a third { "variant": "reference", ... } is allowed; it is shown only when there is no tuned output
      ]
    }
  ],
  "notes": ["Free-text lines shown under the table."]
}
```

## Mapping from `pipeline/eval.py`

`write_studio_results()` already emits `rows[].metrics`. To fill the rest:

- `per_lang` / `per_task`: copy `e["metrics"]["per_lang"]` and `e["metrics"]["per_task"]` onto each row (same keys).
- `samples`: for 4 test ids present in both a `base-*` and a `tuned-*` eval file of the same size, take
  `predictions[i].text`, `.pred.action`, `.pred.stm`, `.pred.format_ok` for each variant; `message`, `flags`,
  `guideline` and `gold` come from the test row (`row_labels()` gives `action`/`stm`).
- Name rows `base-<size>` / `tuned-<size>` as today; sizes `0.6b`, `0.8b`, `1.7b`, `9b` all group correctly.

`samples.sample.json` is the clearly marked SAMPLE gallery: real outputs of stock Qwen3.5-0.8B on the 20-row smoke
set next to the validated reference answer (not a tuned model). It is ignored as soon as `results.json` has `samples`.

## Generator: `pipeline/report_studio.py` (current)

`.venv/bin/python pipeline/report_studio.py` (also what `pipeline/eval.py --report` now calls) rebuilds `results.json`,
`eval/results.md` and `eval/results.json` from `eval/*.json`. Re-run it after each new eval; it picks up
`base-qwen3-1.7b.json` / `tuned-qwen3-1.7b.json` when they appear and first runs `pipeline/system_metrics.py` and
`pipeline/dose_audit.py` on any eval file missing `system` / `dose_audit`.

Extra fields it writes, all ignored by the page today (the page reads only the keys above, so they are safe to keep):

- `rows[].metrics` extra keys: `system_action_accuracy`, `system_red_flag_recall`, `system_abstain_recall` (after the
  rule-based gate, `bridge/gate.py` = `app/src/runtime/gate.ts`), `unsafe_advise_rate` (with gate: ADVISE on a referral
  case), `advise_kept` (with gate: ADVISE cases still ADVISE), `unsupported_dose_rate` (model only: replies with a dose
  not on the manual page, `pipeline/dose_audit.py`), `system_unsupported_dose_rate`, `red_flag_recall_strict` (model
  only, the red-flag-list cases that `system_red_flag_recall` also uses), `note_json_valid`, `over_refer_rate`,
  `judge_scored`. Note `red_flag_recall` (n=172, any referral case) and `system_red_flag_recall` (n=61, red-flag-list
  cases) use different denominators; compare `red_flag_recall_strict` with `system_red_flag_recall`.
- `rows[]`: `runtime` is `"river"` (9B, hosted) or `"llama.cpp"` (Q4_K_M GGUF); `runtime_detail` has the long form;
  `eval` is the source file stem; `shipped: true` marks the checkpoint the app ships. `ram_mb` is the Q4_K_M file size
  in MiB and is left out for River rows.
- `alt_checkpoints[]`: rows with the same shape for checkpoints that are scored but not shipped (9B step 90,
  `variant: "tuned-alt"`). They are kept out of `rows` because `EvalRow.variant` is only `"base" | "tuned"`.
- `samples[].unseen_presentation`, `test_set.held_out_presentations`, `test_set.rows_with_unseen_presentation`,
  `test_set.langs`, and `meta` (`test_set`, `date`, `limitations[]`, `sources[]`). The limitations are also in `notes`.
