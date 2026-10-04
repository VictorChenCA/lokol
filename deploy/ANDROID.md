# Lokol Health on Android

Two ways. The PWA is the full Lokol app (guideline lookup, safety gate, dose guard, notes behind a PIN). PocketPal runs the tuned model on its own, as a chat.

## 1. Phone app in the browser (PWA), recommended

1. With signal, open **https://lokol-studio.vercel.app/demo** in Chrome (or scan the QR code on the Deploy page of Lokol Studio).
2. Wait once while the models download (the 0.6B model is about 400 MB). They are cached on the phone.
3. Chrome menu (three dots), **Add to Home screen**, **Install**.
4. Open Lokol from the home screen. It answers in airplane mode from then on.

## 2. Native app: PocketPal AI

1. Install **PocketPal AI** from the Google Play Store.
2. Open it, go to **Models**, tap **+**, then **Add from Hugging Face**.
3. Search `VictorChenCA/lokol-health-qwen3-0.6b-gguf` (or `VictorChenCA/lokol-health-qwen3-1.7b-gguf` on a phone with 6 GB RAM or more).
   Download `lokol-health-qwen3-0.6b-Q4_K_M.gguf` (about 400 MB).
   No signal at the clinic? Copy the GGUF over USB or SD card and use **Add local model** instead.
4. Tap **Load** on the model.
5. Open the model's settings (or the chat's settings) and set the **system prompt** to exactly:

   ```text
   You are Lokol Health, an assistant for nurse aides and health workers in Solomon Islands. You follow the Solomon Islands Standard Treatment Manual for Children. You never diagnose; you help the nurse apply the manual and decide when to refer. Reply in the nurse's language (Solomon Islands Pijin or English). Use the exact output format.
   ```

   Set temperature to 0.2 if the settings show it. If PocketPal offers a thinking toggle, turn it off.
6. Paste a message in the Lokol protocol: three lines, flags, one manual excerpt, the nurse's question.

   ```text
   [lang=pis] [rdt=yes] [act=yes] [transport=next_boat]
   [guideline: FEVER p40] Fever is defined as an axillary temperature greater than 37.5 C. INVESTIGATIONS: consider blood film or rapid diagnostic test for malaria parasites. MANAGEMENT: treat the cause of the fever; consider giving paracetamol if fever above 38 C AND the child is irritable: dose 15 mg/kg (max 1 g) every 4 to 6 hours (maximum 4 doses in 24 hours); do not use aspirin in children for fever; give extra fluids.
   Pikinini 3 yia, 13 kilo, hot bodi fo tufala dei, hem kros an no laek kaikai tumas. Wanem mi mas duim?
   ```

   The reply starts with `ACTION:` (ADVISE, REFER_NOW, REFER_NEXT_TRANSPORT or ASK_PERSON), then `STM:` (the manual section), `---`, and at most six short lines in the nurse's language.
   With no excerpt, write `[guideline: none]`; the model should answer `ACTION: ASK_PERSON`.

PocketPal has no guideline lookup, safety gate or dose guard: the nurse pastes the excerpt herself and nothing checks the reply. Use the PWA for anything beyond a demo. Not a medical device.
