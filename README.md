# TwoSide Group — AI Receptionist

A standalone, static, browser-based AI receptionist for TwoSide Group (TSG). It has no build step and no backend: open it in Chrome, call the receptionist by voice (or by typing), chat with her by voice or text, and every finished conversation is saved to a call and lead log stored in the browser's `localStorage`.

## How to open

- **Online (GitHub Pages):** https://twosidegroup-spec.github.io/tsg-receptionist/
- **Locally:** download or clone this folder and open `index.html` in Chrome — either by double-clicking the file (`file://`) or by serving the folder statically, for example:

  ```bash
  cd tsg-receptionist
  python3 -m http.server 8000
  # then open http://localhost:8000 in Chrome
  ```

  Note: browsers restrict some features on `file://`. Voice input in particular works best when the page is served over HTTPS (such as GitHub Pages) or from `localhost`.

## What's new in this version

- **Natural, real-type voice** — the receptionist no longer uses whatever default voice the browser offers first. A scoring function ranks every available voice and prefers natural/neural/premium/enhanced voices (for example "Google US English", Microsoft "… Online (Natural)" voices such as Aria or Jenny, Samantha, Zira), then en-US on-device voices. She speaks **sentence by sentence**, with a slight, natural variation in rate (0.97–1.03) and pitch (1.00–1.08) from sentence to sentence, so she doesn't sound flat or monotone.
- **Independent, free conversation — not a fixed script** — she doesn't march through a rigid list of questions. She listens to everything you say, in any order: if you give your name, number, a time, and your reason all in one sentence, she picks out each piece, acknowledges what she understood ("Thanks, Rahim — I've got your number noted."), answers the question you actually asked, and only then asks for the single most important detail still missing. If you change topic, she follows you. Common replies have several natural wordings that rotate, so the same line never repeats back-to-back.
- **Super clean UI with proper icons** — a minimal white/light design with a dark-teal accent, soft shadows, rounded cards, and a consistent inline SVG icon set (call, incoming call, mic, mic-off, speaker, end call, chat, send, search, copy, close, check, delete) used across the header, call controls, chat, and log. No emoji buttons.
- **Call sounds** — all generated live with WebAudio (no audio files): a US-style **ringback** (440+480 Hz, 2 s on / 4 s off) while your outgoing call connects, a looping **ringtone** on the incoming-call screen, a soft **connect beep**, a gentle **end-call tone**, and subtle pops/clicks for messages and buttons. A speaker toggle in the header turns all sounds on or off (remembered in the browser).
- **Voice Chat** — a third way to talk to her, alongside calls: a clean chat panel where you can type **or tap the microphone and speak**. Your words appear as a chat message, she replies in text and speaks the reply aloud (speaker toggle in the chat header). Voice chat uses the same conversation engine and the same shared details as calls, and ending a chat saves it to the same log with the channel "Voice chat".

## Features

- **Call Receptionist** — start a voice call from your laptop. A consent disclosure appears before the microphone opens, you hear the ringback while the call connects (a few seconds), then a full-screen call screen with the receptionist's name, a call timer, an animated waveform / listening indicator, a live transcript of both sides, and round icon controls for mute, speaker, and end call.
- **Receptionist calls you** — a phone-style incoming call screen, clearly labelled "INCOMING CALL · IN BROWSER", with a ringing tone, pulsing avatar, and round Accept / Decline buttons. Accept connects to the same call screen; Decline ends the ring with a soft tone.
- **Voice Chat** — type or speak in the chat panel; replies appear as text and are spoken aloud when the chat speaker is on. A consent note about the browser speech service is shown in the panel before the first microphone use.
- **Voice in and out** — your speech is recognised with the browser's Speech Recognition API, and the receptionist replies out loud with speech synthesis using the best natural voice available (see above). Speech only starts after you click to start or accept a call, or interact with the chat. Mute and Speaker controls are on the call screen, and a typed input is always available — it activates automatically if voice recognition is unavailable or microphone permission is denied.
- **Free-flowing capture** — the receptionist opens with: "Hello, thank you for reaching out to TwoSide Group. How can I help you today?" If you ask for a meeting, a service, pricing, or to speak with the Chairman, she captures your full name, phone or WhatsApp number, exact reason, and preferred time — in whatever order you give them, asking only for what's still missing, one thing at a time. Urgent wording marks the entry High Priority. She never invents prices, discounts, timelines, or policies; for pricing she says the Chairman will confirm on follow-up.
- **Call and Lead Log** — after a call or voice chat ends, an entry is saved automatically and shown in the NEW RECEPTIONIST UPDATE format. The log below lists the date, name, number, summary, urgency, and status of every conversation, with search, status changes (New, Follow-up needed, Contacted, Booked, Closed), and delete per entry. The log starts empty and is stored only in this browser under the `localStorage` key `tsg-receptionist-log-v1`.
- **Playbook** — the greeting, capture steps, and safety rules are shown on the page: never promise discounts, sign agreements, send external emails, or share personal contact details without the Chairman's explicit permission.

## Honest note about the conversation engine

This static version's conversation is a **smart on-device rule engine** — there is no server and no AI model behind it. It understands natural phrasing flexibly (details in any order, topic changes, small talk, questions about services, pricing, hours, location), answers only from TwoSide Group information it actually knows, and never invents prices or policies. It is **not** an open-ended large language model, so truly unexpected questions will get a polite steer back to what she can help with, or an offer to take details for the Chairman's follow-up.

## Important notes

- **Voice needs Chrome, microphone permission, and an internet connection.** Chrome's speech recognition is processed by Google's speech service, so it requires being online and allowing microphone access when prompted. No voice recording is kept by this page — only the text transcript of a conversation is saved, as part of its log entry.
- **"Receptionist calls you" is an in-browser call, not a carrier phone call.** It rings and connects inside this web page only; it does not dial or receive real phone numbers.
- **Your log lives in this browser.** Clearing the browser's site data will clear the log, and the log is not shared between browsers or devices.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page structure: SVG icon set, header, consent, incoming call, call screen, voice chat, log, and playbook |
| `styles.css` | All styling — clean white/light design with dark-teal accent, responsive for laptop and mobile |
| `app.js` | Natural-voice speech, free-conversation engine, WebAudio call sounds, call + voice chat flow, and the localStorage log |
| `README.md` | This file |
