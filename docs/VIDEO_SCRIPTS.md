# Lokol: three 60-second videos

HackOS and the Google Form need three separate MP4/MOV files, each **60 seconds or less** (organizers said 59 or 60 is fine). Speak at about 140 words per minute, so each script is about 125 words. Record voice-over separately if that's easier; captions are fine.

The World Bank brief wants these points somewhere across the videos: the one-sentence problem statement, what the AI does and why SMS/search wouldn't do it, the guardrails, an end-to-end demo, where it sits in the user's day, the tech stack, and "what localizing AI development means to you". The mapping is below.

---

## 1. Product demo (screen recording, 58 s, captions burned in)

**Covers:** problem, user journey, device fit, Studio, guardrails, scalability, deployment, offline field use in Pijin. The captions double as the voice-over script if you record one (about 130 words).

| Time | Picture | Caption / voice-over |
|---|---|---|
| 0–5 s | Landing page | Lokol Studio builds small AI helpers that run where the signal does not. |
| 5–9 s | Overview | One workspace: pick a device, build a pack, wire the models, deploy. |
| 9–16 s | Recommend: Health, Galaxy A15 | Start from the phone a health worker already owns. Lokol picks models that fit its memory. |
| 16–25 s | Studio: four stages, voice switches, device dropdown | Lokol Health in Studio: speech in, manual lookup, fine-tuned model, safety gate, speech out. Every node can be swapped. |
| 25–33 s | Test run: baby with a fit, nodes light up, Refer now | Test run: watch a case flow through each step, with the manual page it used. |
| 33–41 s | New pack from the farming sample leaflet | Any guideline becomes a new pack: health, farming, tourism, or your own sector. |
| 41–48 s | Deploy: Phone app, Android, Laptop, WhatsApp/SMS tabs | Deploy what you built: phone app, Android, laptop, or SMS and WhatsApp. |
| 48–58 s | Field app: Pijin case, Refer now with the manual page | Field app, no signal: the nurse asks in Pijin. Lokol answers from the manual, cites the page, and refers danger signs. |

Optional phone inserts: the installed app in airplane mode answering by voice, and an SMS reply on a basic phone.

## 2. Technical walkthrough (screen recording, 58 s, captions burned in)

**Covers:** stack, training data, fine-tuning, evidence against base and few-shot models, guardrails, deployment. About 140 words.

| Time | Picture | Caption / voice-over |
|---|---|---|
| 0–13 s | Studio, model card | Every node is a model we trained or exported: Qwen3 0.6B and 1.7B tuned on a MacBook, Qwen3.5 9B tuned on River AI, Pijin speech as ONNX. |
| 13–25 s | Test run with the trace | All in the browser, offline: llama.cpp in WebAssembly, transformers.js speech, search over the children's treatment manual, a rule-based safety gate. |
| 25–36 s | Train page | Data: open-weight teachers on River wrote 2,700 training cases from the manual in Pijin and English. LoRA, then 4-bit GGUF. |
| 36–51 s | Evaluate page | 300 held-out cases. Stock models: 0% on the protocol, 38% right action even with examples. Tuned 9B: 87% right action, 87% right page. No dose shown unless the cited page gives it. |
| 51–58 s | Deploy, Laptop and WhatsApp/SMS tabs | Ships as a phone app, on Android, or on a clinic laptop that answers SMS. Models are public on Hugging Face. |

## 3. Team introduction (you on camera, about 115 words, 55 s)

Modelled on the winning team video from Hack-Nation #6: product in the first line, a name lower-third, burned-in captions with a few highlighted words, short B-roll cutaways, a mission line to close. Music low under the voice.

| Time | Picture | You say |
|---|---|---|
| 0–5 s | B-roll: laptop at night with the Studio canvas lighting up (Test run), then you | "Hi, I'm Victor Chen, and this weekend I built **Lokol**: small AI that runs where the signal doesn't." |
| 5–15 s | You on camera. Lower-third: **Victor Chen · Founder, OurLife Labs · Stanford** | "I'm a [year / major] at Stanford, and I founded **OurLife Labs**, where we build memory support on AI glasses for older adults. We were selected for Meta's AI Glasses Impact Grant." |
| 15–30 s | Cut to the field app on a phone in airplane mode, Pijin on screen | "That work taught me one thing: AI only helps if it works **where the person actually is**. For a nurse aide in rural Solomon Islands, that's a cheap phone, no signal, and Pijin." |
| 30–40 s | B-roll: agents' terminals, the River training curve | "So I built Lokol solo, with a **team of AI agents**, and trained the models myself on River." |
| 40–52 s | You on camera | "To me, localizing AI means three things: **small** enough to send over a one-day data bundle, **trained on the country's own guidelines**, and **honest** enough to say 'ask a person' when it doesn't know." |
| 52–58 s | End card: Lokol logo, lokol-studio.vercel.app | "Smol AI blong iumi: small AI that belongs to us. Thank you." |

What to include and what to skip:
- **Your startup: yes, in one sentence**, because it proves you ship health AI for real users. Say "selected for Meta's AI Glasses Impact Grant"; do not say the funds were received.
- **Social entrepreneurship: show it, don't say it.** OurLife plus this project is the evidence. Skip the word "passionate".
- **Why this track: yes**, it is the core (the "where the person actually is" line).
- **Gratitude: one short "thank you" at the end.** Judges score substance.
- **Seoul (optional):** you can swap the last line for "I'd love to bring this to Seoul." Skip Korean.

Recording: landscape 1080p, camera at eye level, window light in front of you, quiet room, 3 takes. Also grab 5–10 s B-roll clips: the Studio Test run, the phone in airplane mode, your terminal with agents, the River loss curve. Captions and the lower-third get added in editing.

## Recording checklist

- Phone demo: turn on airplane mode first and show it on screen; open the installed PWA from the home screen.
- Screen recording at 1440×900 or 1920×1080; hide bookmarks and notifications.
- Export each video at 1080p MP4 and confirm it's 60 seconds or less: `ffprobe -v error -show_entries format=duration -of csv=p=0 file.mp4`
- Trim to 60 s if needed: `ffmpeg -i in.mp4 -t 60 -c copy out.mp4`
- Team photo: a JPG or PNG under 10 MB (HackOS requires it).
