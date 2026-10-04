# Lokol Health eval: base vs tuned

Held-out test rows per model in the `n` column. Protocol metrics are exact-match on the strict SPEC §2 format; the judge is headless Claude (sonnet) scoring guideline faithfulness 0–3 on the first N items. Generated 2026-10-03 22:10.

| Model | n | Format | ACTION acc | STM acc | Red-flag recall | Abstain P | Abstain R | Pijin ≥3 glossary | Note JSON | Over-refer | Judge 0–3 | gen tok/s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| base-0.8b-stub | 20 | 0.00 | 0.00 | 0.00 | 0.00 | – | 0.00 | 0.22 | 0.00 | 0.00 | – | 23.38 |
| tuned-0.8b-stub30 | 20 | 0.90 | 0.60 | 0.90 | 0.43 | – | 0.00 | 0.22 | 0.00 | 0.00 | – | 11.41 |

## On-device speed (llama-bench, M1 Max, Q4_K_M)

| model | pp256 tok/s | tg64 tok/s | file MB |
|---|---|---|---|
| base-0.8B | 493.23 | 45.94 | 542 |
| 0.8B | 1840.83 | 21.65 | 529 |

## Per-task ACTION accuracy

| Model | abstain | followup | guidance | note | referral |
|---|---|---|---|---|---|
| base-0.8b-stub | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| tuned-0.8b-stub30 | 0.00 | 1.00 | 1.00 | 0.50 | 0.17 |
