# Lokol — plan for Hack-Nation #7, World Bank Challenge 04a (Small AI for Development, Health)

*Written 2026-10-03 ~20:25 PDT. Deadline: **Sun Oct 4, 06:00 AM PDT** on HackOS (uploads stay open to 06:15). That is about 9.5 hours from now.*

"Lokol" is Solomon Islands Pijin for *local*. Lokol is a node-based builder for small, offline AI assistants, and its first deployed pack is **Lokol Health**: a Pijin + English assistant for nurse aides and community health workers in rural Solomon Islands clinics.

---

## 0. Where things stand (done tonight)

| Item | Status |
|---|---|
| HackOS account | Signed in in Chrome as Victor Chen (victor36@stanford.edu), admission accepted, Stanford Hub confirmed |
| Team | **"Lokol"** created, solo (1 of 4). Can be deleted/recreated; project name is set separately on the submission form |
| Challenge chosen on HackOS | Not yet (dropdown on the Team & Submission page; I will set 04a when you say go) |
| Credits claimed on HackOS | **Anthropic $25**: offer link (on HackOS) (organizers announced all Claude credits are redeemed). **BrightData $300**: event code (on HackOS) (people on Discord report "maximum activations reached"). **ElevenLabs Creator 1 mo**: must join ElevenLabs' redemption Discord with your Luma email (bot reported broken this afternoon). **Lovable Pro 1 mo**: individual code (on HackOS) (redeem in your Lovable account). The three "PDF guide" links are on the Credits page. |
| River AI | Balance **$1,009.18**. Key in `.env` (`RIVER_API_KEY`) verified working; 15 base models; smallest is **Qwen/Qwen3.5-9B**. Trained LoRA adapters are downloadable from Console → Checkpoints (PEFT format). |
| Local machine | M1 Max, 64 GB RAM, 49 GB free disk. Installed tonight: `llama.cpp` (brew), project venv at `~/Documents/GitHub/Lokol/.venv` with river-client 0.12.0, mlx-lm, transformers 5.18, datasets, openai, anthropic, fastapi. Also present: mlx-whisper, faster-whisper, ffmpeg, ngrok, cloudflared, gh (logged in as VictorChenCA), Vercel MCP. |
| Discord | You are already in the Hack-Nation server. I read #announcements, #project-submission, #faq, #q-and-a, #api-credits, #challenge-04-worldbank, #stanford. |
| Challenge brief | Full World Bank concept note (20 pages) downloaded from the public Drive folder and read in full (`docs/WorldBank_Small_AI_for_Development_brief.pdf`). |
| HackOS draft | Project name "Lokol", challenge **04a Health** selected and saved as draft (status: draft, revision 1, 0/3 videos). |
| Guideline corpus | **Solomon Islands Standard Treatment Manual for Children, 4th ed. 2017** (MHMS, "a manual for health workers", 124 pp, UNICEF-Pacific-hosted PDF) downloaded and text-extracted to `data/raw/`. This is the RAG corpus and the seed for the training data. |

---

## 0.1 Decisions from Victor (Oct 3, ~21:00)

- **Lokol Studio is the product**; Lokol Health is the applied instance shown in the demo video. Studio gets real UI/UX investment (design pass, six pages, mobile-first demo).
- **Track: 04a Health**, with Studio demonstrably sector-agnostic (health, agriculture, tourism packs are config).
- **Online channel: WhatsApp via Twilio Sandbox** (free on a trial account), adapter kept channel-agnostic so Messenger works too.
- **Teacher**: open-weight via River (DeepSeek-V4.1-Flash primary, Kimi-K2.6 secondary) for training data; Claude Opus 5.5 (headless, subscription) as judge and for the gold eval set only. Dataset is designed so stock models fail (strict protocol, Pijin output, abstain policy) and tuned models pass.
- **Credits**: River's $1,009 covers the whole night several times over (expected spend under $100). OpenAI credits are not needed by this plan; only useful as a second judge.
- Build spec for parallel agents: `docs/SPEC.md`.

## 1. Hackathon facts you need

- **Event**: Hack-Nation 7th Global AI Hackathon (MIT Sloan AI Club initiative), Oct 3–4 2026, 16 hubs, 3,000+ builders. Stanford hub at Nordic Innovation House, Palo Alto.
- **Deadline**: Oct 4, 06:00 AM PDT (= 9:00 AM ET). HackOS grace until 06:15. "Late submissions can't win prizes."
- **Two submissions required**: (1) HackOS "Team & Submission" page, (2) Google Form backup: https://forms.gle/VS65tsovASMuBwEn9 (must be signed in as victor36@stanford.edu; it asks solo/team, names, emails, affiliation, challenge, three video uploads, repo link, hosted demo link, team picture, MIT-license agreement).
- **What HackOS needs**: project name, challenge, **public GitHub repo** (required to submit), live project URL, **team photo** (JPG/PNG), and **three videos, each MP4/MOV ≤ 60 s, ≤ 1 GB**: team introduction, product demo, technical walkthrough.
- **Video length conflict resolved**: the World Bank note says 2–5 min; Hack-Nation (Linn Bieske, 8:05 PM in #challenge-04-worldbank) said "Please keep each video below 60 sec". Three × 60 s it is. Organizers posted two winner examples from hack #6 in #project-submission (Drive links) and recommend investing in video quality.
- **Hosted demo**: organizers said hosting platform is up to you, "a public Hugging Face Spaces link should be fine (no localhost)". For the World Bank track, support said an APK is acceptable for offline phone apps. We will give a Vercel URL (web app with in-browser inference) plus downloadable deploy packs.
- **One project, one challenge** per team (Aun, 4:53 PM). All AI tools allowed (Momin, 9:38 AM).
- **Organizers ask you to say in Discord which challenge you're tackling** (Zeeshan's checklist). Draft message for you to post in #challenge-04-worldbank: *"Team Lokol (solo, Stanford hub) is building for 04a Health: an offline Pijin/English assistant for nurse aides in Solomon Islands clinics, with a node-based builder for small on-device models."*
- **Hack-Nation rubric** (for the overall prizes): Technical depth 33%, Communication 33%, Innovation 33%. Shortlist notified Thu Oct 8; finalists pitch Sat Oct 10 (1–2 slides + demo, 3 min). Overall winner: Venture Lab fast track + $2,000 Anthropic credits. Side awards: Creativity $500, Best Quote $500, Go Viral $500 (tag Hack-Nation on LinkedIn by 9 AM ET Sun).
- **World Bank prize (04a/b/c)**: one winner per sector; a trip for one person to Seoul for the Global AI & Digital Summit / Youth Summit, Oct 19–22 (worth ~$2,000, visa and passport required), with an Ignite Talk on Oct 21. World Bank shortlist selection Oct 5–6.
- **Eligibility**: ages 18–35.

---

## 2. The World Bank brief, distilled (what judges will check)

**Scenario**: "Noor", a 38-year-old farmer in the fictional Ondera highlands. Speaks a local language at home, the national language when needed. Two phones in the household: her own basic phone (calls, SMS, mobile money) and her daughter's smartphone (used on weekends). No Wi-Fi, 3G bundles. The constraints are drawn from World Bank work on **primary health care access in Solomon Islands**, farm advisory in Côte d'Ivoire, tourism in The Gambia.

**Health scenario (Annex A)**: nearby clinic is overcrowded, quality uneven, doctors "not always up to date with the latest medical guidance", heavy patient load and "burdensome record-keeping". Challenge: *"improve one meaningful part of Noor's access to primary care or a frontline worker's ability to serve her; for example screening support, documentation, referral, follow-up or continuity of care."*

**Hard limits**:
- Runs on a device the user already has; **core feature works offline**; model files small enough to side-load or send over a weak connection.
- **At least one interaction in a local language, by voice or text; name the language** and expect "how would it fare in a less-supported one?"
- **Human-in-the-loop**: a person makes the final call; the tool flags what it is unsure of; agentic flows must check in.
- **Avoid hallucinations**; fail-safe = "not sure — ask a person"; a confident wrong answer "is worse than no output".
- **Health annex deliberately lists no imaging or diagnosis datasets "because interpreting them is out of bounds."** So: no diagnosis, no image reading.
- Health entries must state **where patient data sits, who can read it, what happens if the phone is lost or shared**.
- **Cite every data source** (source, year, country) and **state what your data does not cover (this is scored)**. Synthetic data allowed if labeled.

**Judging weights**: built solution / Small AI fidelity 25%; development relevance & impact 20%; data grounding 15%; evidence it works 15%; clarity, design, inclusivity, value proposition vs a simpler tool (SMS/spreadsheet/search) 15%; scalability & replicability 10%; responsible AI pass/fail.

**Video content the WB wants** (fold into the 3 × 60 s): one-sentence problem statement in their template ("Because of this tool, [user] will [action] by [when] that they would otherwise [not do / do late / do worse]; we know because [evidence]"); the AI capability and why SMS/spreadsheet/search wouldn't do; guardrails; end-to-end demo; where the tool sits in the user's day; tech stack; "what localizing AI development means to you".

Suggested common datasets they name: Common Voice, FLEURS, **MMS (Meta)**, FLORES-200/NLLB, OPUS, MASSIVE, GSMA Mobile Gender Gap, OpenCelliD, WorldPop, OSM, WDI/Data360. Health-specific: Service Delivery Indicators, healthsites.io, DHS/SPA, Malaria Atlas travel-time, AccessMod, **DHIS2** (the record system "institutional fit"), WHO GHO, IHME GHDx.

---

## 3. Track decision: 04a Health, designed to be sector-portable

- Health is your priority and it is where the Solomon Islands example lives. **Meta MMS has speech recognition and synthesis for Solomon Islands Pijin (ISO 639-3 `pis`)**: `facebook/mms-tts-pis` exists and `pis` is in the MMS ASR coverage list. That makes a real, named local-language voice interaction feasible tonight.
- Competition read from Discord: the WB channel is active (a dozen distinct people asking about 04 tonight; several are building offline phone apps with APKs). I could not get a per-track split (one informal poll in #q-and-a had 5 options with 1/1/1/3/2 reactions, mapping unknown). Expect Health to be the most crowded of the three WB tracks, Tourism the least. Judging is per sector and the prize is identical, so the honest trade-off is: Health = stronger story and your domain interest, Tourism = thinner field. **Recommendation: stay on Health**, but build the system so the second pack (Agriculture or Tourism) is a config swap. That directly scores the 10% "scalability, replicability" criterion and lets you pivot the submission to 04c in the last hours if Health looks saturated.
- What will stand out vs the crowd of "offline chatbot APKs": (1) a **builder** (nodes + device-aware recommender + one-click deploy packs), not just one app; (2) **actually trained models with a base-vs-tuned eval** (River + local LoRA), not a prompt on a stock model; (3) a **named local language by voice** (Pijin TTS/ASR), with an honest coverage statement; (4) guardrails as code (abstain gate, referral list, guideline citations) rather than a sentence in the pitch.

---

## 4. What we build

### 4.1 Pitch (WB template)
*Because of Lokol Health, a nurse aide at a rural Solomon Islands clinic will get Standard-Treatment-Manual-grounded guidance and a dictated visit note, in Pijin or English, within a minute and without a signal, that she would otherwise look up late, skip, or write up at the end of the day from memory; we know because Solomon Islands has ~0.2 physicians per 1,000 people, most rural care is delivered by nurse aides at area health centres and nurse-aide posts, and only a minority of the population is online (figures to be cited from WHO GHO / WDI in the data card).*

### 4.2 Two layers
1. **Lokol Studio** (web app): a node graph editor where each node is a small model or a rule block. You answer a few questions (voice in? voice out? languages? connectivity? which phone?), it looks the device up, recommends a configuration (which model sizes, which nodes, what will and won't work), and exports a **deploy pack**: the model files, a config JSON, a QR code, and runtime instructions for phone (PWA or PocketPal/llama.cpp Android), laptop (Ollama/llama-server), and an optional WhatsApp/Telegram bridge. Internet access is a toggle per node.
2. **Lokol Health (Solomon Islands pack)**: the first pack built on Lokol Studio, shown end to end: nurse aide speaks or types in Pijin or English about a sick child → guidance grounded in the Solomon Islands Standard Treatment Manual for Children with the section cited → abstain/refer when unsure → spoken reply in Pijin → optional structured visit note / referral note saved on device (store-and-forward to DHIS2-shaped record later).

### 4.3 Node catalogue (what ships tonight)

| Node | Model | Params / file | Runtime | Tier | License |
|---|---|---|---|---|---|
| Speech in (English) | Moonshine-tiny or whisper-tiny | 27M / ~30–75 MB | ONNX / transformers.js / mlx-whisper | phone + laptop | MIT |
| Speech in (Pijin) | **Omnilingual ASR CTC-300M** (Meta, `pis_Latn`, 25 h of Pijin training data); fallback MMS-1b-all `pis` adapter | 300M / ~1.3 GB fp32 (int8 smaller) | Python sidecar on laptop / clinic PC; phone export is an open question | laptop | Apache 2.0 (MMS fallback is CC-BY-NC) |
| Speech in (Pijin, phone option) | Gemma 4 E2B, audio input, ≤30 s clips, Pijin quality untested | 2.6 GB on LiteRT-LM | LiteRT-LM | 6–8 GB phone | Apache 2.0 |
| Language model (Pijin+English health) | Qwen3.5-0.8B / 2B / 4B LoRA-tuned (ours) | 0.8B ≈ 0.6 GB Q4; 2B ≈ 1.3 GB; 4B ≈ 2.5 GB | llama.cpp GGUF (PocketPal, llama-server), wllama in browser, MLX | 2 GB phone / 4 GB phone / 8 GB phone or laptop | Apache 2.0 |
| Language model (clinic PC / laptop tier) | Qwen3.5-9B LoRA-tuned on **River** (ours) | 9B ≈ 5.5 GB Q4 | llama.cpp / Ollama / MLX; also River-hosted for the online toggle | laptop | Apache 2.0 |
| Retrieval (guideline grounding) | BM25 + small embeddings over STM chunks | few MB | pure JS/Python, offline | all | our code |
| Safety / abstain gate | rule list (red-flag symptoms → refer) + model confidence on a fixed answer set | KB | our code | all | our code |
| Speech out (Pijin) | `facebook/mms-tts-pis` (VITS) | ~36M / ~70 MB | transformers.js (VITS supported) or Python | phone + laptop | CC-BY-NC 4.0 |
| Speech out (English) | Kokoro-82M | 82M / ~90 MB | kokoro-js / ONNX | phone + laptop | Apache 2.0 |
| Channel | PWA (offline after first load), WhatsApp/Telegram bridge (online), SMS stub | | | | |

Honest coverage statement to include: Pijin voice **in** is laptop-tier only tonight (the 300M Omnilingual model is still too big for a 2 GB phone); phone tier gets Pijin text in and Pijin voice out. Pijin training text is synthetic, teacher-generated, not validated by a native speaker; Pijin has no official orthography, so spelling varies (blong/bilong, fas/first). The adult treatment manual is not public, so v1 covers child care only. That statement is scored, so we say it plainly.

Context numbers for the data card (from the research briefing, `docs/RESEARCH.md` §3, each with source): 73% rural; 70+ languages, Pijin the lingua franca; 2019 census literacy in Pijin 68% (functional literacy far lower, so voice matters); 524 nurse aides vs 153 doctors in 2010 and 126 of 157 doctors in the capital in 2017; 44.7% of people 12+ own a phone (Malaita 35%); grid electricity in 3.5% of rural households, 81% light with solar; 1 GB of data costs SBD 6; Android ~85%; malaria incidence the highest in Asia-Pacific with RDT/ACT stockouts, so fever logic must have "no test kit / no drug available" branches and referral must distinguish "refer now" from "refer on the next boat".

### 4.4 Guardrails (as code, demoed)
- **Scope**: frontline-worker guidance, documentation, referral and follow-up. Never a diagnosis, never an image.
- **Red-flag list** (fixed): danger signs (e.g., severe dehydration, convulsions, chest indrawing in a child, heavy bleeding in pregnancy) → the model's answer is replaced by "Refer now" + the STM referral step; the nurse decides.
- **Abstain**: if retrieval finds no STM support or the model's self-rated confidence is low → "Mi no sua — askem dokta / nurse in charge" (not sure, ask a person), logged.
- **Citations**: every guidance answer shows the STM section it came from.
- **Data**: everything stays on the device; notes are stored locally, encrypted with a PIN; nothing leaves unless the nurse taps "send" with a signal; lost/shared phone = PIN + wipe instructions. Stated in README and the video.

---

## 5. Models, data and training

### 5.1 Why this split
River's smallest base is Qwen3.5-9B, but the **Qwen3.5 family (0.8B, 2B, 4B, 9B) shares a tokenizer and chat template**, so one dataset trains all tiers. River trains the 9B (clinic-PC tier and the strongest model), and your M1 Max trains the 0.8B/2B (and 4B if time) with mlx-lm LoRA. The River 9B is also the **distillation teacher** for the small tiers on extra unlabeled prompts, which is a clean "custom model trained on River" story.

### 5.2 Dataset (synthetic, labeled as such) — target ~3,000 train / 300 val / 300 held-out test
- **Seed corpus**: the Solomon Islands **Standard Treatment Manual for Children** (2017) chunked by section; the chunks are also the RAG index. Optional additions if time: the O&G STM 3rd ed. 2024 (CC BY-NC-SA, 271 pp) and the MHMS NCD primary-care booklet (WHO PEN, 28 pp); the Health NZ Pijin measles toolkit is a licensed few-shot and eval source for Pijin. Scope of Lokol Health v1 is therefore **child (under-5 and older child) primary care at nurse-aide posts and area health centres**: fever and malaria, cough and pneumonia, diarrhoea and dehydration, malnutrition, skin and ear infections, wounds, danger signs and referral, immunization, drug doses by weight as printed in the manual. (The adult STM is not public; stated as a coverage gap.)
- **Scenario templates**: nurse aide roles, ~30 common child presentations taken from the manual's chapters, 4 task types: *guidance Q&A*, *dictated visit note → structured record*, *referral decision*, *follow-up message to patient*. Plus 300 **out-of-scope / unsafe probes** (diagnosis requests, drug doses outside STM, non-health) whose correct answer is abstain/refer.
- **Languages**: English, Solomon Islands Pijin, and mixed (code-switching, which is how Pijin is actually used). Pijin generation prompt carries a short Pijin style guide and glossary (sik = sick, dokta, nes, meresin = medicine, hospitol, bebi, pikinini = child, kaikai = food, wata = water, hot bodi = fever, etc.).
- **Teacher**: an **open-weight model via River inference**. Tested tonight on a Pijin nurse-aide prompt: **DeepSeek-V4.1-Flash** gave the most authentic Pijin (55 s per call, fine when parallelized), **Kimi-K2.6** was good and faster (20 s), Qwen3.5-397B was fastest (7 s) but leaked Bislama/Tok Pisin forms ("mo", "wara"). Decision: DeepSeek-V4.1-Flash primary, Kimi-K2.6 as second teacher for diversity, Qwen excluded. Cost ≈ $5–20. Claude (headless `claude -p` on your subscription, as in the last hackathon) is used as the **judge** for evals, not as training data. OpenAI only if you hand me a key and want it (see blockers; policy note below).
- **Data card** in the repo: sources, license, counts, what it does not cover (no real patient data, no native-speaker validation, no Solomon Islands dialect variation, English-biased teacher).

### 5.3 Training runs
| Run | Where | Recipe | Time | Cost |
|---|---|---|---|---|
| Lokol-Health-9B | River, `Qwen/Qwen3.5-9B`, LoRA r=16, ~150–200 steps, batch 32, lr 2e-4 | same pipeline as the Sentinel last week (`train.py` pattern) | ~15 min | ~$3–10 |
| Lokol-Health-2B | local mlx-lm LoRA on `Qwen/Qwen3.5-2B`, ~600 iters | fuse → convert → `llama-quantize` Q4_K_M | ~20–40 min | $0 |
| Lokol-Health-0.8B | same on `Qwen/Qwen3.5-0.8B` | same | ~10–20 min | $0 |
| Lokol-Health-4B (if time) | same on 4B | same | ~45–60 min | $0 |
| General multilingual variant | the same data without the Pijin-only filter → "general" adapter; English-only and Pijin-heavy adapters as the two language-specific nodes | | | |

Export: River adapter download (PEFT) → merge into the 9B → GGUF Q4 for the laptop pack. Small models: mlx fuse → HF → GGUF.

### 5.4 Evaluation (base vs tuned, held-out, reported in README and the tech video)
- Guideline-grounded correctness (LLM judge with the STM passage in hand), per language.
- Abstain/refer accuracy on the 300 probes (precision and recall of "refer now" and "not sure").
- Pijin fluency (judge) and a 10-item human spot check by you.
- On-device numbers: tokens/s and RAM on the M1 Max (llama-bench), and in-browser on your phone.
- Report as a table: base 0.8B / 2B / 9B vs tuned, and the fast-rule-only baseline, so the "why AI, not SMS" and "evidence it works" criteria have numbers.

---

## 6. App and deployment

- **Stack**: Vite + React + React Flow (node editor), Tailwind; deployed on **Vercel** (public URL for the form). Models load from Hugging Face on first visit and are cached by a service worker → installable PWA that works offline afterwards (this is the "runs on a device the user already has" demo on your phone).
- **In-browser inference**: `wllama` (llama.cpp WASM) for GGUF text generation (0.8B Q4 on phones, 2B on better ones); `transformers.js` for Moonshine ASR and MMS VITS TTS; WebGPU not required.
- **Laptop/clinic pack**: `llama-server` or Ollama Modelfile + a 40-line local web UI; Python sidecar for MMS Pijin ASR.
- **Device lookup**: a bundled table of ~60 common Android models sold in the Pacific (RAM, storage, SoC, Android version) + free-text model name; the recommender is a rule table (RAM → tier, storage → which packs fit, connectivity → online toggle) with a short model-written explanation.
- **Online channel**: the adapter is channel-agnostic (Messenger dominates Solomon Islands messaging; there are no WhatsApp statistics for the country). Twilio WhatsApp Sandbox is the fastest WhatsApp path (join code, ~15–30 min, 100 trial messages) but needs a Twilio account; Meta Cloud API needs a Meta developer app (~1 h). Telegram Bot API is a 2-minute fallback. The bridge runs on your laptop behind cloudflared and talks to the same node graph. This is a nice-to-have; the offline PWA is the core deliverable, and a Discord question about whether any cloud path is allowed was unanswered, so the demo runs with connectivity off.
- **Repo**: new public repo `VictorChenCA/lokol` (MIT, as the form requires), with README (setup + description), data card, model cards, eval tables, three video links. **Non-MIT assets stay out of the repo** and are fetched by a script at setup: the Children's STM PDF (no license statement, government copyright: index locally, cite, do not redistribute), MMS models (CC-BY-NC), O&G STM 2024 (CC BY-NC-SA), WHO texts.

---

## 7. Timeline (PDT, tonight)

| Time | Lane A: data + training (me, agents) | Lane B: app + packs (me, agents) | You |
|---|---|---|---|
| 20:45–21:15 | Approve plan; STM corpus chunked; teacher picked (Pijin test); synthesis starts on River | Repo scaffold, React Flow editor, PWA runtime stub | Post Discord notice; redeem Lovable/ElevenLabs if you want them; decide on OpenAI key |
| 21:15–22:15 | 3.6K examples generated and validated; River 9B SFT launched; mlx 0.8B/2B LoRA launched | Recommender + device table; wllama text node working with stock Qwen3.5-0.8B | Record raw footage for team video (phone, 60 s, who you are) |
| 22:15–00:00 | Checkpoints; GGUF exports; evals (base vs tuned); MMS Pijin TTS + Moonshine wired | Deploy pack export (zip + QR); laptop pack; Vercel deploy | Spot-check 10 Pijin outputs; try the PWA on your phone |
| 00:00–02:00 | Distill 9B → 0.8B on extra prompts (if time); final eval table; model cards | Polish UI, guardrail demo path, WhatsApp/Telegram bridge if an account exists | Review README |
| 02:00–03:30 | Data card, README, eval write-up | Demo-video screen recording, tech-video screen recording | Voice-over the demo and tech videos (I script them) |
| 03:30–05:00 | Buffer | Buffer | Cut three videos to ≤60 s (ffmpeg scripts ready), team photo |
| 05:00–05:45 | Submit on HackOS + Google Form; LinkedIn post tagging Hack-Nation | | Final clicks on both forms (uploads are yours) |

---

## 8. Submission checklist
1. HackOS: project name "Lokol", challenge 04a, repo URL, live URL, team photo, three videos → **Submit project**.
2. Google Form: solo, team name "N/A"? (form says write N/A if solo; we will write "Lokol (solo)"), your name/email/Stanford, challenge "4. A: WorldBank (Track Health)", three video uploads, repo, demo link, team picture, agree to MIT publication.
3. Discord: one line in #challenge-04-worldbank naming the challenge (draft above).
4. LinkedIn post tagging Hack-Nation before 9 AM ET (Go Viral award).
5. Repo public, videos open without login.

## 9. Video outlines (60 s each; I will write full scripts)
- **Team**: who you are (Stanford, prior builds, why local AI), one line on why Solomon Islands health, "what localizing AI development means to me".
- **Demo**: phone in airplane mode → open Lokol Health → nurse aide asks in Pijin by voice → cited STM guidance, spoken back in Pijin → red-flag case triggers "Refer now" → dictated note becomes a structured record → Lokol Studio shows the node graph and the recommended pack for a 2 GB phone.
- **Tech**: the node system, the four model tiers and sizes, River 9B training + local LoRA, base-vs-tuned numbers, abstain accuracy, what was hard (Pijin data, browser memory), what's not covered.

---

## 10. Blockers and decisions (most severe first)

1. **Time.** ~9 hours total including your video recording. The plan above is cut to fit; anything marked "if time" is dropped first. Say go now and I start Lane A and B in parallel.
2. **Your videos and photo.** The team video needs you on camera; demo and tech videos need your voice-over (or captions, which the form allows). Budget 60–90 minutes between 02:00 and 04:30.
3. **Teacher model / API keys.** No `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` is set on this machine (only `claude` CLI on your subscription; your Codex auth file has no API key). Default: open-weight teacher via River (DeepSeek-V4.1-Flash, verified on Pijin tonight) for training data, Claude headless as judge. If you want OpenAI as teacher, paste a key into `~/Documents/GitHub/Lokol/.env`. Note: OpenAI's terms prohibit using outputs to develop models that compete with OpenAI, and Anthropic's policy has a similar clause; a Pijin nurse-aide model is a stretch to call competing, but the open-weight route is unambiguous and is what I recommend. (Naming check from the briefing: OpenAI's current API flagships are `gpt-6-astra`, `gpt-6.1-sol` and `gpt-6-luna`; there is no "Terra". Anthropic's current IDs are `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-4-5`, `claude-fable-5-1`; `claude-sonnet-5` is the previous generation.)
4. **Guideline text: resolved.** The Solomon Islands Standard Treatment Manual for Children (2017) is public and extracted (`data/raw/`). The adult manual is not public; v1 scope is child primary care, stated as a limit.
5. **Pijin quality.** No native speaker; the teacher's Pijin may be shaky. Mitigation: style guide + glossary in the prompt, judge filtering, your 10-item spot check, and a plain coverage statement in the data card (which is scored).
6. **WhatsApp.** Needs a Twilio or Meta developer account you create and a phone number; I cannot create accounts. Decide: Twilio sandbox (you sign up, I wire it), Telegram fallback (you create a bot with BotFather, 2 minutes), or skip (show the bridge in the node graph as "online channel" with code present). Recommendation: Telegram tonight, WhatsApp as documented path.
7. **Credits you must click yourself**: Lovable code redemption, ElevenLabs Discord bot, BrightData activation. None are needed for the build.
8. **Eligibility and travel**: WB entrants must be 18–35; the Seoul trip (Oct 19–22) needs a passport/visa.
9. **Hosted demo memory limits**: mobile browsers can refuse ~1 GB model loads; the PWA will default to the 0.8B Q4 (~600 MB) on phones and fall back to text-only if TTS fails to load. The APK path (PocketPal with our GGUF) is documented as the alternative.
10. **Licensing collisions with the MIT repo**: MMS TTS/ASR are CC-BY-NC 4.0 (fallback only; Omnilingual ASR is Apache), the Children's STM has no license statement, the O&G STM is CC BY-NC-SA. All are fetched at runtime and cited, never committed. Qwen3.5, Gemma 4, Omnilingual ASR, Whisper, Moonshine (English), Kokoro are permissive.
11. **River adapter download** must be verified early (Console → Checkpoints → download) before the laptop pack depends on it; River cannot train below 9B and a personal key cannot create deployments, so small tiers are local-only (as planned).
12. **Open questions nobody has answered on Discord**: whether an APK counts where HackOS asks for a live URL (we give a Vercel URL anyway), and whether the WB panel works from Hack-Nation's Oct 8 shortlist or its own Oct 5–6 date.

*The full fact-checked research briefing (19 agents, every claim checked against a primary source, refuted claims flagged) is in `docs/RESEARCH.md`; raw findings in `docs/research_raw.json`.*
