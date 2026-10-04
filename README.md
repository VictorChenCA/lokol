# Lokol Studio

**Build small AI that runs where the signal doesn't.** *Smol AI blong iumi.*

Lokol Studio is a node-based builder for small, offline AI assistants. You pick a sector and a language, tell it which phone people actually carry, and it recommends a graph of small models (speech in, guideline lookup, a language model, a safety gate, speech out, a channel) that fits that phone. Each node is its own model that you can swap, resize, train on your own data, and run with the internet on or off. Studio then exports a deploy pack: an offline web app (PWA), a GGUF for Android, a laptop/clinic-PC bundle, or a WhatsApp/Messenger bot.

**Lokol Health** is the first pack built with it: an assistant for nurse aides in rural Solomon Islands clinics, in **Solomon Islands Pijin** and English, grounded in the Ministry of Health's *Standard Treatment Manual for Children* (2017). It never diagnoses. It helps the nurse apply the manual, says when to refer (now, or on the next boat), cites the manual section it used, and says *"Mi no sua, askem nes o dokta"* ("I'm not sure, ask a nurse or doctor") when the manual doesn't cover the question.

Built for Hack-Nation 7 × World Bank **Small AI for Development**, Track A: Health.

| | |
|---|---|
| Live demo | **https://lokol-studio.vercel.app** (works offline after the first visit; add `?runtime=shim` for canned replies without downloading models) |
| Videos | Demo · Tech · Team (links added at submission) |
| Models | [Lokol Health 0.6B GGUF](https://huggingface.co/VictorChenCA/lokol-health-qwen3-0.6b-gguf) · [Lokol Health 1.7B GGUF](https://huggingface.co/VictorChenCA/lokol-health-qwen3-1.7b-gguf) · [Lokol Health 9B LoRA for llama.cpp](https://huggingface.co/VictorChenCA/lokol-health-qwen3.5-9b-lora-gguf) (trained on River; also hosted on River) · [Pijin TTS ONNX](https://huggingface.co/VictorChenCA/lokol-mms-tts-pis-onnx) |

---

## The problem, in Noor's words

*Because of Lokol Health, a nurse aide at a rural Solomon Islands clinic will get guidance from the national treatment manual, with the page cited, in Pijin or English, within a minute and without a signal, that she would otherwise look up late, skip, or write up from memory at the end of the day; we know because most of the country is rural and served by nurse aides, not doctors, and connectivity and power are scarce.*

| Fact | Source |
|---|---|
| 73% of Solomon Islanders live in rural areas | DataReportal, *Digital 2026: Solomon Islands* |
| 524 nurse aides vs 153 doctors and dentists in the health workforce (2010); 126 of 157 doctors were in the capital (2017) | Rural and Remote Health 2096; WHO, *Health closer to home* (2017) |
| 44.7% of people aged 12+ own a mobile phone (Malaita 34.6%) | Solomon Islands 2019 Census, Vol. 2 |
| Grid electricity reaches 3.5% of rural households; 81% light with solar | Solomon Islands 2019 Census, table H17 |
| 1 GB of mobile data costs SBD 6 (one-day bundle) | Our Telekom "Redhot Giga" plans, 2026 |
| Malaria incidence is the highest in the Asia-Pacific, with test-kit and drug stock-outs | WHO malaria country profile 2024; APLMA |

Full sources: [`docs/RESEARCH.md`](docs/RESEARCH.md) §3.

## Why AI, and not SMS or a search box

A static SMS tree or a PDF search can't read a nurse's free-text or spoken Pijin description of a sick child, decide which manual section applies, notice a danger sign buried in the description, and answer in Pijin with the next step. Lokol does those four things in about a second on a laptop and a few seconds on a phone, with no signal. The parts that must be exact are not left to the model: danger signs are a fixed list that forces referral, the citation must be a real manual section, and anything off-script becomes "ask a person".

## How it works

```
 Hear            Understand             Think                 Check                 Speak / Send
 ─────────       ──────────────────     ──────────────────    ──────────────────    ───────────────────
 Moonshine  ──▶  Guideline lookup  ──▶  Lokol Health LM   ──▶ Safety gate      ──▶  MMS Pijin TTS
 (English)       BM25 over 183 STM      (0.6B phone /         12 danger signs       Kokoro (English)
 Omnilingual     chunks, 56 sections    1.7B / 9B laptop)     force REFER;          PWA · WhatsApp ·
 (Pijin,                                trained by Lokol      no source ⇒ ASK       Messenger
 laptop)                                                      A PERSON
```

Every node runs offline. The internet toggle only adds optional online nodes (the River-hosted 9B, the WhatsApp channel).

### Model tiers (what the recommender picks)

| Tier | Device | Language model | Speech | Download |
|---|---|---|---|---|
| A | 2–3 GB Android (e.g. Galaxy A02, A12) | Lokol Health **Qwen3-0.6B** Q4_K_M | Pijin voice out; English voice in | 0.4 GB model, about 0.5 GB with voice |
| B | 4–8 GB Android | Lokol Health **Qwen3-1.7B** Q4_K_M | same | about 1.1 GB model |
| D | Laptop / clinic PC, or online | Lokol Health **Qwen3.5-9B**: the River-trained LoRA runs offline in llama.cpp on a Q4 base (`--lora`), or hosted on River when online | + Pijin voice in (Omnilingual ASR) | 5.7 GB base + 80 MB adapter |

## Training: custom nodes, not prompts

1. **Corpus.** The *Standard Treatment Manual for Children* (MHMS, 2017) split into 183 chunks across 56 sections.
2. **Synthetic cases.** Open-weight teachers on River AI (DeepSeek-V4.1-Flash and Kimi-K2.6) wrote 3,829 nurse cases from the manual chunks: guidance, referral, visit notes, follow-up messages, and out-of-scope questions, in Pijin (45%), English (42%) and mixed (14%).
3. **Validation.** 11 automatic rules (protocol, real citations, danger signs force referral, no Tok Pisin/Bislama leakage, Pijin glossary coverage) plus a Claude judge on a 10% sample left 3,602 rows: 2,704 train, 300 validation, 300 test. 150 test rows cover 14 presentations never seen in training.
4. **LoRA fine-tuning.** Qwen3.5-9B on **River AI** (180 steps, batch 32, rank 16, about 37 minutes); Qwen3-0.6B and Qwen3-1.7B on a MacBook with mlx-lm (Qwen3.5's small models train too slowly on Apple silicon, so the phone tiers use Qwen3). Exported to GGUF Q4_K_M for llama.cpp, the browser (wllama) and Android.
5. **Cost.** The whole River bill for data generation, training and evaluation was under $15.

Data card with every count and every gap: [`data/DATA_CARD.md`](data/DATA_CARD.md).

## Evidence it works

Held-out test set: 300 synthetic cases, 150 of them with 14 presentations never seen in training (Pijin 122, English 126, mixed 52). Base and tuned models get the same prompt and the same retrieved manual excerpt; only the weights differ. **With gate** is what a nurse actually sees: the reply after Lokol's rule-based safety gate.

| Model | Follows the protocol | Right action: model / with gate | Danger signs referred, with gate | Advice cases answered, with gate | Doses not on the cited page: model / with gate |
|---|---|---|---|---|---|
| Qwen3.5-9B (base) | 0% | 0% / 45% | 75% | 0% | 52% / **0%** |
| **Lokol Health 9B** (River LoRA) | **97%** | **87% / 84%** | **88%** | **78%** | 63% / **0%** |
| Qwen3-0.6B (base) | 0% | 0% / 45% | 75% | 0% | 25% / **0%** |
| **Lokol Health 0.6B** (on-device, 397 MB) | **98%** | **64% / 62%** | **93%** | 29% | 88% / **0%** |
| Qwen3-1.7B (base) | 0% | 0% / 45% | 75% | 0% | 33% / **0%** |
| **Lokol Health 1.7B** (on-device, 1.1 GB) | **99%** | **64% / 62%** | **95%** | 17% | 82% / **0%** |

- **Is the 0% baseline fair?** It measures the clinic answer format, which stock models never produce unprompted. Given two worked examples in the prompt, stock models still fall far short: Qwen3-0.6B reaches 21% format, 8% right action and 0% danger-sign referrals; Qwen3.5-9B reaches 24% format, 38% right action and 46% danger-sign referrals. The fine-tuned 0.6B reaches 98%, 64% and 95%.
- Stock models never follow the protocol, so with the gate they can only refer or say "ask a person": safe, but they never help (0% of advice cases answered). The tuned 9B answers 78% of them correctly.
- The tuned models reply in Pijin when the nurse writes Pijin 97–100% of the time (base: 45–69%).
- The phone models are cautious: the 0.6B and 1.7B catch 93–95% of danger signs and never advised on a case that needed referral (1.7B: 0%), but they over-refer and rarely abstain. The 1.7B cites the right manual section more often (72% vs 57%). The recommender puts the largest model each device can hold.
- Models invent doses. Even the teacher's reference answers give a dose that the retrieved page does not give for that drug 58% of the time. So Lokol checks every dose: it must be printed on the cited page **for the same drug** (each dose on the page belongs to the nearest medicine name before it, from a curated list of 99 medicines), or be that drug's per-kg dose times the child's weight. Anything else becomes "check the dose on page N".

Full tables, per-language and per-task scores, judge scores and limitations: [`eval/results.md`](eval/results.md).

## Guardrails (human in the loop)

- **No diagnosis, no images.** Lokol helps a nurse apply the manual; the nurse decides.
- **Danger signs are rules, not predictions.** Convulsions, unable to drink, lethargy, chest indrawing, stiff neck, severe dehydration, severe malnutrition, bleeding, cyanosis, a febrile baby under 2 months, and facial burns force *Refer now* (or *Refer on the next boat* with what to give while waiting, when the manual allows it).
- **No source, no answer.** If retrieval finds no matching manual section, or the question is about an adult, a dose the manual doesn't give, or anything non-clinical, the answer is *Ask a person*.
- **Every answer cites the manual section and page.**
- **No dose that isn't in the manual.** A dose appears only if it is printed on the cited page next to the same drug, or is that page's per-kg dose times the child's weight. Anything else becomes "check the dose on page N" or "ask the nurse in charge".
- **Data stays on the phone.** Messages and visit notes are stored only on the device; nothing is sent unless the nurse sends it. The WhatsApp bridge runs on the clinic's own laptop; with it, messages pass through Meta and Twilio, which is stated to the user. A lost phone exposes local notes, so the pack should be installed behind the phone's screen lock.

## Run it

1. **Hosted demo, nothing to install:** https://lokol-studio.vercel.app/demo (phone or laptop; Add to Home screen and it works offline). Add `?runtime=shim` for canned replies without downloading models.
2. **One line with Ollama** (template, system prompt and settings come from the Hugging Face repo):
   ```bash
   ollama run hf.co/VictorChenCA/lokol-health-qwen3-1.7b-gguf
   ```
   Each message is the Lokol protocol: a flags line, a guideline line, the nurse's question (example on the [model card](https://huggingface.co/VictorChenCA/lokol-health-qwen3-1.7b-gguf)).
3. **Laptop or clinic PC, model server + bridge in one command** (macOS/Linux; needs `brew install llama.cpp` and Python 3.10+):
   ```bash
   curl -fsSL https://raw.githubusercontent.com/VictorChenCA/lokol/main/deploy/lokol-laptop.sh | bash -s -- --model 1.7b
   ```
   `--voice` adds Pijin speech, `--tunnel` a public URL, `--dry-run` prints the plan. Details: [`deploy/README.md`](deploy/README.md).
4. **WhatsApp or Messenger:** run the installer with `--tunnel`, then paste the printed webhook URL into the Twilio Sandbox (WhatsApp) or your Meta app (Messenger). Step by step: [`bridge/README.md`](bridge/README.md) and the Deploy page in the app.

Android with PocketPal: [`deploy/ANDROID.md`](deploy/ANDROID.md). Develop Studio locally:

```bash
git clone https://github.com/VictorChenCA/lokol && cd lokol
cd app && npm install && npm run dev            # http://localhost:5173
```

## Repo map

| Path | What |
|---|---|
| `app/` | Lokol Studio (Vite + React + React Flow) and the in-browser engine (`app/src/runtime/`: wllama, transformers.js, BM25, safety gate) |
| `pipeline/` | corpus chunking, synthetic data, validation, River and mlx training, GGUF export, eval |
| `bridge/` | WhatsApp (Twilio) and Messenger adapter in front of a local llama-server |
| `sidecar/` | laptop speech service: Pijin ASR (Omnilingual), Pijin TTS (MMS), English ASR/TTS |
| `data/`, `corpus/` | synthetic dataset, data card, guideline chunks |
| `docs/` | plan, build spec, research briefing, World Bank brief |

## What this does not cover

- **Adults, pregnancy and childbirth.** v1 is grounded only in the children's manual; the adult manual is not public.
- **Real patients and native speakers.** All training text is synthetic and was not reviewed by a Pijin-speaking clinician. Pijin has no official spelling, so variants (blong/bilong) appear.
- **Pijin voice input on phones.** The Pijin speech model (300M) needs the laptop tier; phones get Pijin text in and Pijin voice out.
- **The other 70 languages of Solomon Islands.** A vernacular speaker falls back to Pijin. Pijin, Tok Pisin and Bislama are close creoles, so the same pipeline can pool data across them.
- **Dose checking is a safety net, not a guarantee.** The manual's PDF tables lose their column layout when extracted, so on a few pages (malaria p53, drug tables p118) a dose can be attributed to the neighbouring drug, and the guard can let a wrong pairing through or block a right one. A nurse must still check every dose against the printed manual.
- **Clinical validation.** This is a prototype. It must be reviewed by MHMS and tested with nurse aides before any use with patients.

## What localizing AI means to us

Small enough to send over a one-day data bundle. Trained on the country's own manual. Speaking the language nurses use with patients. Honest about what it doesn't know. And built so the next team can swap the manual, the language and the phone without starting over.

## Licenses

Code: MIT. Model weights inherit their base licenses (Qwen: Apache-2.0). Speech: Omnilingual ASR (Apache-2.0), Kokoro (Apache-2.0), MMS Pijin TTS (**CC-BY-NC-4.0**, non-commercial). **Guideline text:** excerpts of the *Standard Treatment Manual for Children* (© Ministry of Health and Medical Services, Solomon Islands, 2017) appear in `corpus/`, the app's retrieval index and the synthetic dataset for non-commercial demonstration with citation. They are not covered by the MIT license and will be removed on request.
