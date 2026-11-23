# TwoSide Group — AI Receptionist

A standalone, static, browser-based AI receptionist for TwoSide Group (TSG). It has no build step and no backend: open it in Chrome, call the receptionist by voice (or by typing), and every completed call is saved to a call and lead log stored in the browser's `localStorage`.

## How to open

- **Online (GitHub Pages):** https://twosidegroup-spec.github.io/tsg-receptionist/
- **Locally:** download or clone this folder and open `index.html` in Chrome — either by double-clicking the file (`file://`) or by serving the folder statically, for example:

  ```bash
  cd tsg-receptionist
  python3 -m http.server 8000
  # then open http://localhost:8000 in Chrome
  ```

  Note: browsers restrict some features on `file://`. Voice input in particular works best when the page is served over HTTPS (such as GitHub Pages) or from `localhost`.

## Features

- **Call Receptionist** — start a voice call from your laptop. A consent disclosure appears before the microphone opens, then a full-screen call screen with the receptionist's name, a call timer, an animated waveform / listening indicator, and a live transcript of both sides.
- **Receptionist calls you** — a phone-style incoming call screen, clearly labelled "INCOMING CALL · IN BROWSER", with a pulsing avatar, Accept and Decline. Accept connects to the same call screen; Decline returns to the main screen.
- **Voice in and out** — your speech is recognised with the browser's Speech Recognition API, and the receptionist replies out loud with speech synthesis (an en-US, on-device voice is preferred where available). Speech only starts after you click to start or accept a call. Mute and Speaker on/off controls are on the call screen, and a typed input is always available — it activates automatically if voice recognition is unavailable or microphone permission is denied.
- **Guided capture** — the receptionist opens with: "Hello, thank you for reaching out to TwoSide Group. How can I help you today?" If you ask for a meeting, a service, pricing, or to speak with the Chairman, she captures your full name, then your phone or WhatsApp number, then the exact reason and your preferred time — one at a time. Urgent wording marks the entry High Priority. She never invents prices, discounts, timelines, or policies; for pricing she says the Chairman will confirm on follow-up.
- **Call and Lead Log** — after a call ends, an entry is saved automatically and shown in the NEW RECEPTIONIST UPDATE format. The log below lists the date, name, number, summary, urgency, and status of every call, with search, status changes (New, Follow-up needed, Contacted, Booked, Closed), and delete per entry. The log starts empty and is stored only in this browser under the `localStorage` key `tsg-receptionist-log-v1`.
- **Playbook** — the greeting, capture steps, and safety rules are shown on the page: never promise discounts, sign agreements, send external emails, or share personal contact details without the Chairman's explicit permission.

## Important notes

- **Voice needs Chrome, microphone permission, and an internet connection.** Chrome's speech recognition is processed by Google's speech service, so it requires being online and allowing microphone access when prompted. No voice recording is kept by this page — only the text transcript of a call is saved, as part of its log entry.
- **"Receptionist calls you" is an in-browser call, not a carrier phone call.** It rings and connects inside this web page only; it does not dial or receive real phone numbers.
- **Your log lives in this browser.** Clearing the browser's site data will clear the log, and the log is not shared between browsers or devices.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page structure: header, consent, incoming call, call screen, log, and playbook |
| `styles.css` | All styling — dark-teal / white receptionist design, responsive for laptop and mobile |
| `app.js` | Call flow, voice recognition and synthesis, conversation logic, and the localStorage log |
| `README.md` | This file |
