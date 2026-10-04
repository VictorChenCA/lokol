# Lokol: three 60-second videos

HackOS and the Google Form need three separate MP4/MOV files, each **60 seconds or less** (organizers said 59 or 60 is fine). Speak at about 140 words per minute, so each script is about 125 words. Record voice-over separately if that's easier; captions are fine.

The World Bank brief wants these points somewhere across the videos: the one-sentence problem statement, what the AI does and why SMS/search wouldn't do it, the guardrails, an end-to-end demo, where it sits in the user's day, the tech stack, and "what localizing AI development means to you". The mapping is below.

---

## 1. Product demo (screen recording + phone)

**Covers:** problem statement, user journey, offline, local language, guardrails, Studio.

| Time | Picture | Voice-over |
|---|---|---|
| 0–8 s | Phone in airplane mode, Lokol Health open | "In rural Solomon Islands, most children are seen by a nurse aide, not a doctor, often with no signal. This is Lokol Health, and this phone is in airplane mode." |
| 8–22 s | Type or speak a Pijin case: *"Pikinini 3 yia, hot bodi tu dei, no laek kaikai."* Reply streams in with the **Advise** badge and the **MALARIA p53** citation; tap play for the Pijin voice | "A nurse describes a sick child in Pijin. Lokol answers in Pijin, from the national treatment manual, and shows the page it used. It speaks it too." |
| 22–32 s | Danger-sign case: *"...hem sek-sek tude moning."* Big red **Refer now** badge with what to give before the boat | "If there's a danger sign, like a convulsion, it doesn't guess. It tells her to refer, and what to give while she waits for the boat." |
| 32–38 s | Adult chest-pain question gives the grey **Ask a person** badge | "Outside the manual, it says: mi no sua, askem dokta. A person always makes the call." |
| 38–55 s | Lokol Studio: the node graph; switch the device to a 2 GB Galaxy A02, the recommender swaps to the 0.6B model and shows the budget bars; trace mode lights up the nodes | "Lokol Studio is how we built it. Pick the sector, the language and the phone. It recommends small models that fit, and every node is a model we trained." |
| 55–60 s | WhatsApp reply on a phone, then the Deploy page QR | "Then deploy it offline, to Android, or to WhatsApp. Smol AI blong iumi." |

---

## 2. Technical walkthrough

**Covers:** tech stack, training, evidence it works, what was hard, limitations. About 140 words.

| Time | Picture | Voice-over |
|---|---|---|
| 0–12 s | Studio canvas, trace mode lighting up the nodes | "Lokol Studio runs every node in the browser, offline: llama.cpp in WebAssembly for the language model, transformers.js for Pijin speech, and a search index over the Solomon Islands children's treatment manual." |
| 12–28 s | Train page: pipeline graphic, River loss curve | "We trained the models ourselves. Open-weight teachers on River AI wrote thirty-eight hundred nurse cases from the manual, in Pijin and English. We fine-tuned Qwen 3.5 9B on River for under fifteen dollars, and 0.6 and 1.7 billion parameter models on a MacBook, then shrank them to 400 megabytes for phones." |
| 28–45 s | Eval page: base vs tuned bars | "On 300 held-out cases, stock models never follow the protocol. Tuned, the 9B picks the right action 87 percent of the time, and every model catches over 90 percent of danger signs." |
| 45–60 s | Eval dose audit, then README limitations | "Hardest part: models invent doses, even the teachers. So Lokol shows no dose that isn't printed in the cited page for that drug. Limits: synthetic data, the children's manual only, and Pijin voice input needs a laptop." |

## 3. Team introduction (you on camera)

**Covers:** who you are, why this, "what localizing AI means to me".

"Hi, I'm Victor Chen, a [year/program] at Stanford. I build small, practical AI tools. [One line of your own: past project, for example the River-trained classifier you built at YC's Own Your Intelligence hackathon last week.]

I built Lokol solo this weekend because the people who most need AI help are often the ones with the weakest signal and the smallest phones. The World Bank's Solomon Islands example made that concrete: nurse aides, seventy languages, a treatment manual on paper.

To me, localizing AI means three things. It's small enough to send over a one-day data bundle. It's trained on the country's own guidelines and speaks the language people actually use. And it's honest about what it doesn't know, so a person stays in charge.

Smol AI blong iumi: small AI that belongs to us."

*(about 135 words; record in good light, phone at eye level, quiet room)*

---

## Recording checklist

- Phone demo: turn on airplane mode first and show it on screen; open the installed PWA from the home screen.
- Screen recording at 1440×900 or 1920×1080; hide bookmarks and notifications.
- Export each video at 1080p MP4 and confirm it's 60 seconds or less: `ffprobe -v error -show_entries format=duration -of csv=p=0 file.mp4`
- Trim to 60 s if needed: `ffmpeg -i in.mp4 -t 60 -c copy out.mp4`
- Team photo: a JPG or PNG under 10 MB (HackOS requires it).
