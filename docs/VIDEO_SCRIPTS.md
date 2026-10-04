# Lokol: three 60-second videos

HackOS and the Google Form need three separate MP4/MOV files, each **60 seconds or less** (organizers said 59 or 60 is fine). Speak at about 140 words per minute, so each script is about 125 words. Record voice-over separately if that's easier; captions are fine.

The World Bank brief wants these points somewhere across the videos: the one-sentence problem statement, what the AI does and why SMS/search wouldn't do it, the guardrails, an end-to-end demo, where it sits in the user's day, the tech stack, and "what localizing AI development means to you". The mapping is below.

---

## 1. Product demo (phone + screen recording)

**Covers:** problem statement, user journey, offline, local language by voice, guardrails, the Studio. About 135 words.

| Time | Picture | Voice-over |
|---|---|---|
| 0–8 s | Phone, airplane mode on, the installed **Lokol Health** app (home-screen icon) | "In rural Solomon Islands, most sick children are seen by a nurse aide, not a doctor, often with no signal. This phone is in airplane mode." |
| 8–24 s | Tap **Talk**, say in Pijin: *"Pikinini blong mi hem tri yia, hot bodi tu dei."* The reply appears with the **Advise** badge and the **MALARIA p53** citation and is read aloud in Pijin | "The nurse just talks. Lokol answers in Pijin, from the national treatment manual, shows the page it used, and reads it out loud." |
| 24–34 s | Sample: baby with fever who had a fit. Big red **Refer now** badge | "A danger sign is never a judgment call for the model: Lokol refers, and says what to do while waiting for the boat." |
| 34–40 s | Adult chest pain sample: grey **Ask a person** | "Outside the manual, it says: mi no sua, askem dokta." |
| 40–48 s | Basic phone: SMS to the clinic number, reply arrives | "No smartphone? The same model answers by SMS from a laptop in the clinic." |
| 48–60 s | Laptop: landing, **Launch Lokol Studio**, Studio canvas for a Galaxy A12, a Test run lighting each step, then New pack from a farming leaflet | "Lokol Studio builds these: pick the phone, it picks models that fit, every node is a model we trained, and any manual becomes a new pack. Smol AI blong iumi." |

Tips: open https://lokol-studio.vercel.app/demo once on Wi-Fi so the model downloads, add it to the home screen, then switch on airplane mode. If the Pijin speech recognition mishears, type the Pijin line instead; the point is the spoken reply.

## 2. Technical walkthrough

**Covers:** tech stack, training, evidence it works, what was hard, limitations. About 140 words.

| Time | Picture | Voice-over |
|---|---|---|
| 0–12 s | Studio canvas, trace mode lighting up the nodes | "Lokol Studio runs every node in the browser, offline: llama.cpp in WebAssembly for the language model, transformers.js for Pijin speech, and a search index over the Solomon Islands children's treatment manual." |
| 12–28 s | Train page: pipeline graphic, River loss curve | "We trained the models ourselves. Open-weight teachers on River AI wrote thirty-eight hundred nurse cases from the manual, in Pijin and English. We fine-tuned Qwen 3.5 9B on River for under fifteen dollars, and 0.6 and 1.7 billion parameter models on a MacBook, then shrank them to 400 megabytes for phones." |
| 28–45 s | Eval page: base vs tuned bars | "On 300 held-out cases, stock models never follow the protocol. Tuned, the 9B picks the right action 87 percent of the time, and every model catches over 90 percent of danger signs." |
| 45–60 s | Eval dose audit, then README limitations | "Hardest part: models invent doses, even the teachers. So Lokol shows no dose that isn't printed in the cited page for that drug. Limits: synthetic data, the children's manual only, and Pijin voice input needs a laptop." |

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
