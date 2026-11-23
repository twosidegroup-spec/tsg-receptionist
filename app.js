"use strict";

/* TwoSide Group — AI Receptionist (static, client-side only)
   Log is stored in localStorage under the key below. No voice recording is kept. */

var STORAGE_KEY = "tsg-receptionist-log-v1";
var GREETING = "Hello, thank you for reaching out to TwoSide Group. How can I help you today?";
var NAME_QUESTION = "May I have your full name, please?";
var PHONE_QUESTION = "Thank you. What is the best phone number or WhatsApp number to reach you on?";
var REASON_QUESTION = "Thank you. What is the exact reason for reaching out, and what time would you prefer for the follow-up?";

var KNOWN_INFO_ANSWER =
  "TwoSide Group builds websites and apps for businesses, and a free sample homepage offer exists. " +
  "The Chairman will follow up personally with anything more specific.";
var PRICING_ANSWER =
  "I cannot confirm pricing here — the Chairman will confirm pricing on follow-up. " +
  "I can take your details so he can reach you directly.";

var URGENT_WORDS = ["urgent", "emergency", "asap", "as soon as possible", "immediately"];
var INTENT_WORDS = [
  "meeting", "book", "appointment", "service", "pricing", "price", "quote", "cost",
  "website", "web site", "app", "speak with", "speak to", "talk to", "chairman", "owner"
];
var STATUSES = ["New", "Follow-up needed", "Contacted", "Booked", "Closed"];

/* ---------- DOM ---------- */
function el(id) { return document.getElementById(id); }
var btnCall = el("btnCall"), btnIncoming = el("btnIncoming");
var consentScreen = el("consentScreen"), incomingScreen = el("incomingScreen"), callScreen = el("callScreen");
var transcriptEl = el("transcript"), typedForm = el("typedForm"), typedInput = el("typedInput");
var micNote = el("micNote"), callTimerEl = el("callTimer"), callStatusEl = el("callStatus");
var listeningEl = el("listeningIndicator");
var updateSection = el("updateSection"), updateText = el("updateText");

/* ---------- State ---------- */
var callActive = false;
var callStartedAt = null;
var timerInterval = null;
var muted = false;
var speakerOn = true;
var speaking = false;
var stage = "idle"; // idle | awaitingIntent | captureName | capturePhone | captureReason | done
var transcript = []; // {who: "Receptionist"|"Caller", text}
var captured = { name: "", phone: "", reason: "", preferredTime: "" };
var urgent = false;
var lastEntryId = null;

/* ---------- Speech: synthesis ---------- */
function pickVoice() {
  try {
    var voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
    if (!voices || !voices.length) return null;
    var i, v;
    for (i = 0; i < voices.length; i++) { v = voices[i]; if (v.lang === "en-US" && v.localService) return v; }
    for (i = 0; i < voices.length; i++) { v = voices[i]; if (v.lang === "en-US") return v; }
    for (i = 0; i < voices.length; i++) { v = voices[i]; if (v.localService && v.lang && v.lang.indexOf("en") === 0) return v; }
    for (i = 0; i < voices.length; i++) { v = voices[i]; if (v.lang && v.lang.indexOf("en") === 0) return v; }
    return voices[0];
  } catch (e) { return null; }
}
if ("speechSynthesis" in window) {
  try { window.speechSynthesis.onvoiceschanged = function () { pickVoice(); }; } catch (e) {}
}

function speak(text, after) {
  addBubble("Receptionist", text);
  transcript.push({ who: "Receptionist", text: text });
  if (!speakerOn || !("speechSynthesis" in window)) {
    if (after) setTimeout(after, 60);
    return;
  }
  stopListening();
  speaking = true;
  setListeningLabel("Receptionist is speaking…");
  var utter = new SpeechSynthesisUtterance(text);
  utter.lang = "en-US";
  var voice = pickVoice();
  if (voice) utter.voice = voice;
  var finished = false;
  function done() {
    if (finished) return;
    finished = true;
    speaking = false;
    if (after) after();
  }
  utter.onend = done;
  utter.onerror = done;
  try { window.speechSynthesis.speak(utter); } catch (e) { done(); }
  // Safety fallback in case onend never fires.
  setTimeout(done, Math.max(1800, text.length * 95));
}

/* ---------- Speech: recognition ---------- */
var SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition || null;
var recognition = null;
var recognitionRunning = false;

function showMicNote(msg) {
  micNote.textContent = msg;
  micNote.classList.remove("hidden");
  typedInput.focus();
}
function setListeningLabel(text) { listeningEl.textContent = text; }

function ensureRecognition() {
  if (!SpeechRecognitionCtor) return null;
  if (recognition) return recognition;
  recognition = new SpeechRecognitionCtor();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = "en-US";

  recognition.onresult = function (event) {
    var interim = "", finalText = "";
    for (var i = event.resultIndex; i < event.results.length; i++) {
      var res = event.results[i];
      if (res.isFinal) finalText += res[0].transcript;
      else interim += res[0].transcript;
    }
    if (interim) showInterim(interim);
    if (finalText && finalText.trim()) {
      clearInterim();
      handleCaller(finalText.trim());
    }
  };
  recognition.onend = function () {
    recognitionRunning = false;
    if (callActive && !muted && !speaking && stage !== "done") {
      setTimeout(startListening, 350);
    } else if (callActive && !speaking) {
      setListeningLabel(stage === "done" ? "You can end the call, or type a reply." : "Tap Mute off or type your reply.");
    }
  };
  recognition.onerror = function (event) {
    recognitionRunning = false;
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      showMicNote("Microphone access was not allowed, so the typed option is active. Type your reply below and press Send.");
    } else if (event.error === "audio-capture") {
      showMicNote("No microphone was found, so the typed option is active. Type your reply below and press Send.");
    }
  };
  return recognition;
}

function startListening() {
  if (!callActive || muted || speaking) return;
  if (!SpeechRecognitionCtor) {
    setListeningLabel("Voice input is not available in this browser — please type below.");
    return;
  }
  var rec = ensureRecognition();
  if (!rec || recognitionRunning) return;
  try {
    rec.start();
    recognitionRunning = true;
    setListeningLabel("Listening…");
  } catch (e) { /* already started */ }
}
function stopListening() {
  if (recognition && recognitionRunning) {
    try { recognition.stop(); } catch (e) {}
  }
  recognitionRunning = false;
}

/* ---------- Transcript UI ---------- */
var interimBubble = null;
function addBubble(who, text) {
  clearInterim();
  var div = document.createElement("div");
  div.className = "bubble " + (who === "Receptionist" ? "receptionist" : "caller");
  var label = document.createElement("span");
  label.className = "who";
  label.textContent = who;
  div.appendChild(label);
  div.appendChild(document.createTextNode(text));
  transcriptEl.appendChild(div);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
  return div;
}
function showInterim(text) {
  clearInterim();
  interimBubble = document.createElement("div");
  interimBubble.className = "bubble caller interim";
  var label = document.createElement("span");
  label.className = "who";
  label.textContent = "Caller";
  interimBubble.appendChild(label);
  interimBubble.appendChild(document.createTextNode(text));
  transcriptEl.appendChild(interimBubble);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}
function clearInterim() {
  if (interimBubble && interimBubble.parentNode) interimBubble.parentNode.removeChild(interimBubble);
  interimBubble = null;
}

/* ---------- Conversation state machine ---------- */
function containsAny(text, words) {
  for (var i = 0; i < words.length; i++) if (text.indexOf(words[i]) !== -1) return true;
  return false;
}
function checkUrgent(text) {
  if (containsAny(text.toLowerCase(), URGENT_WORDS)) urgent = true;
}
function cleanName(raw) {
  var t = raw.trim();
  t = t.replace(/^(my name is|this is|i am|i'm|its|it's)\s+/i, "");
  return t.replace(/[.\s]+$/, "").trim();
}
function cleanPhone(raw) {
  var match = raw.replace(/\s+/g, " ").match(/\+?[\d][\d\s\-()]{5,}\d/);
  return match ? match[0].trim() : raw.trim();
}
function extractPreferredTime(raw) {
  var timeMatch = raw.match(/\b(\d{1,2}(:\d{2})?\s*(am|pm))\b/i);
  if (timeMatch) return timeMatch[0];
  var dayMatch = raw.match(/\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|morning|afternoon|evening)\b[^.,]*/i);
  if (dayMatch) return dayMatch[0].trim();
  var afterMatch = raw.match(/(?:at|on|prefer(?:red)?(?: time)?(?: is)?|around)\s+(.+)$/i);
  if (afterMatch) return afterMatch[1].trim();
  return "";
}

function handleCaller(rawText) {
  if (!callActive) return;
  var text = rawText.trim();
  if (!text) { startListening(); return; }
  addBubble("Caller", text);
  transcript.push({ who: "Caller", text: text });
  checkUrgent(text);
  var lower = text.toLowerCase();

  if (stage === "captureName") {
    captured.name = cleanName(text);
    stage = "capturePhone";
    speak(PHONE_QUESTION, startListening);
    return;
  }
  if (stage === "capturePhone") {
    captured.phone = cleanPhone(text);
    stage = "captureReason";
    speak(REASON_QUESTION, startListening);
    return;
  }
  if (stage === "captureReason") {
    captured.reason = text;
    captured.preferredTime = extractPreferredTime(text);
    stage = "done";
    var closing =
      "Thank you, " + (captured.name ? captured.name.split(" ")[0] + ". " : "") +
      "I have noted your details, and the Chairman will follow up shortly" +
      (captured.preferredTime ? " around " + captured.preferredTime : "") + ".";
    if (urgent) closing += " I have marked this as High Priority.";
    speak(closing, function () {
      setListeningLabel("Details captured. You can end the call now.");
      callStatusEl.textContent = "Details captured";
    });
    return;
  }
  if (stage === "done") {
    speak("Your details are already noted, and the Chairman will follow up shortly. You can end the call whenever you are ready.", null);
    return;
  }

  // awaitingIntent
  if (containsAny(lower, ["price", "pricing", "cost", "quote", "how much"])) {
    stage = "captureName";
    speak(PRICING_ANSWER + " " + NAME_QUESTION, startListening);
    return;
  }
  if (containsAny(lower, INTENT_WORDS)) {
    stage = "captureName";
    speak("Of course, I can take your details for that. " + NAME_QUESTION, startListening);
    return;
  }
  if (containsAny(lower, ["what do you do", "what does", "services", "who are you", "about", "sample", "homepage", "follow up", "offer"])) {
    speak(KNOWN_INFO_ANSWER + " Would you like me to take your details for a follow-up?", startListening);
    return;
  }
  if (containsAny(lower, ["hello", "hi", "hey", "good morning", "good afternoon", "good evening"])) {
    speak("Hello. How can I help you today — would you like a meeting, a service, or general information?", startListening);
    return;
  }
  speak(
    "I can help with general information about TwoSide Group, or take your details for a meeting or a service. " +
    "Which would you like?",
    startListening
  );
}

/* ---------- Call lifecycle ---------- */
function formatTimer(ms) {
  var total = Math.floor(ms / 1000);
  var m = Math.floor(total / 60), s = total % 60;
  return m + ":" + (s < 10 ? "0" : "") + s;
}
function startTimer() {
  callStartedAt = Date.now();
  callTimerEl.textContent = "0:00";
  timerInterval = setInterval(function () {
    callTimerEl.textContent = formatTimer(Date.now() - callStartedAt);
  }, 500);
}
function stopTimer() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
}

function showOnly(screen) {
  consentScreen.classList.add("hidden");
  incomingScreen.classList.add("hidden");
  if (screen) screen.classList.remove("hidden");
}
function beginCall() {
  showOnly(callScreen);
  callScreen.classList.remove("hidden");
  callScreen.classList.add("live");
  transcriptEl.innerHTML = "";
  transcript = [];
  captured = { name: "", phone: "", reason: "", preferredTime: "" };
  urgent = false;
  muted = false;
  speaking = false;
  stage = "awaitingIntent";
  el("btnMute").textContent = "Mute";
  el("btnMute").setAttribute("aria-pressed", "false");
  el("btnSpeaker").textContent = speakerOn ? "Speaker on" : "Speaker off";
  el("btnSpeaker").setAttribute("aria-pressed", speakerOn ? "true" : "false");
  micNote.classList.add("hidden");
  micNote.textContent = "";
  callActive = true;
  callStatusEl.textContent = "Connected";
  startTimer();
  if (!SpeechRecognitionCtor) {
    showMicNote("Voice input is not available in this browser, so the typed option is active. Type your reply below and press Send.");
  }
  speak(GREETING, startListening);
}

function buildSummary() {
  var who = captured.name || "A caller";
  var first = who + " contacted TwoSide Group through a browser voice call.";
  var second = captured.reason
    ? "They wanted: " + captured.reason.replace(/\s+/g, " ").replace(/\.+$/, "") + "."
    : "No specific meeting, service, or pricing request was completed during the call.";
  return first + " " + second;
}
function formatUpdate(entry) {
  return (
    "📞 NEW RECEPTIONIST UPDATE\n" +
    "- Caller/Contact Name: " + (entry.name || "Not captured") + "\n" +
    "- Phone/Handle: " + (entry.phone || "Not captured") + "\n" +
    "- Urgency: " + entry.urgency + "\n" +
    "- What They Wanted: " + entry.summary + "\n" +
    "- Action Needed From Me: " + entry.actionNeeded + "\n" +
    "- Full Key Notes: " + entry.keyNotes
  );
}

function endCall() {
  if (!callActive) return;
  callActive = false;
  stopListening();
  if ("speechSynthesis" in window) { try { window.speechSynthesis.cancel(); } catch (e) {} }
  speaking = false;
  stopTimer();
  callScreen.classList.add("hidden");
  callScreen.classList.remove("live");
  showOnly(null);

  var complete = !!(captured.name && captured.phone && captured.reason);
  var transcriptText = transcript.map(function (t) { return t.who + ": " + t.text; }).join(" | ");
  var entry = {
    id: "entry-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
    dateISO: new Date().toISOString(),
    name: captured.name || "",
    phone: captured.phone || "",
    channel: "Voice call (browser)",
    urgency: urgent ? "High Priority" : "Normal",
    summary: buildSummary(),
    actionNeeded: complete
      ? "Chairman to follow up shortly" + (captured.preferredTime ? " — preferred time: " + captured.preferredTime : "") + "."
      : "Follow-up needed: details were incomplete — " +
        (!captured.name ? "name not captured. " : "") +
        (!captured.phone ? "phone/WhatsApp not captured. " : "") +
        (!captured.reason ? "reason/preferred time not captured." : ""),
    preferredTime: captured.preferredTime || "",
    keyNotes:
      (captured.reason ? "Reason: " + captured.reason + ". " : "") +
      (captured.preferredTime ? "Preferred time: " + captured.preferredTime + ". " : "") +
      (urgent ? "Caller used urgent wording — marked High Priority. " : "") +
      "Transcript: " + (transcriptText || "No transcript captured."),
    status: complete ? "New" : "Follow-up needed"
  };

  var entries = loadEntries();
  entries.unshift(entry);
  saveEntries(entries);
  lastEntryId = entry.id;
  renderLog();

  updateText.textContent = formatUpdate(entry);
  updateSection.classList.remove("hidden");
  updateSection.scrollIntoView({ behavior: "smooth", block: "start" });
  stage = "idle";
}

/* ---------- Log storage & rendering ---------- */
function loadEntries() {
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    var parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) { return []; }
}
function saveEntries(entries) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(entries)); } catch (e) {}
}
function formatDate(iso) {
  var d = new Date(iso);
  if (isNaN(d.getTime())) return iso || "";
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
function renderLog() {
  var query = (el("searchInput").value || "").toLowerCase().trim();
  var entries = loadEntries().filter(function (e) {
    if (!query) return true;
    return [e.name, e.phone, e.summary, e.urgency, e.status, e.channel]
      .join(" ").toLowerCase().indexOf(query) !== -1;
  });
  var body = el("logBody");
  body.innerHTML = "";
  el("logEmpty").classList.toggle("hidden", entries.length !== 0);
  el("logEmpty").textContent = loadEntries().length === 0
    ? "No conversations logged yet. Calls you handle here will appear in this log."
    : "No log entries match your search.";
  el("logTable").classList.toggle("hidden", entries.length === 0);

  entries.forEach(function (entry) {
    var tr = document.createElement("tr");

    function cell(text) {
      var td = document.createElement("td");
      td.textContent = text || "—";
      return td;
    }
    tr.appendChild(cell(formatDate(entry.dateISO)));
    tr.appendChild(cell(entry.name));
    tr.appendChild(cell(entry.phone));
    tr.appendChild(cell(entry.summary));

    var urgencyTd = document.createElement("td");
    var badge = document.createElement("span");
    badge.className = "badge " + (entry.urgency === "High Priority" ? "badge-high" : "badge-normal");
    badge.textContent = entry.urgency || "Normal";
    urgencyTd.appendChild(badge);
    tr.appendChild(urgencyTd);

    var statusTd = document.createElement("td");
    var select = document.createElement("select");
    select.className = "status-select";
    select.setAttribute("aria-label", "Status for " + (entry.name || "entry"));
    STATUSES.forEach(function (s) {
      var opt = document.createElement("option");
      opt.value = s; opt.textContent = s;
      if (entry.status === s) opt.selected = true;
      select.appendChild(opt);
    });
    select.addEventListener("change", function () {
      var all = loadEntries();
      for (var i = 0; i < all.length; i++) if (all[i].id === entry.id) all[i].status = select.value;
      saveEntries(all);
      renderLog();
    });
    statusTd.appendChild(select);
    tr.appendChild(statusTd);

    var actionsTd = document.createElement("td");
    var del = document.createElement("button");
    del.type = "button";
    del.className = "btn btn-small btn-delete";
    del.textContent = "Delete";
    del.addEventListener("click", function () {
      var all = loadEntries().filter(function (e) { return e.id !== entry.id; });
      saveEntries(all);
      renderLog();
    });
    actionsTd.appendChild(del);
    tr.appendChild(actionsTd);

    body.appendChild(tr);
  });
}

/* ---------- Wiring ---------- */
btnCall.addEventListener("click", function () {
  callScreen.classList.add("hidden");
  incomingScreen.classList.add("hidden");
  consentScreen.classList.remove("hidden");
  consentScreen.scrollIntoView({ behavior: "smooth", block: "start" });
});
el("btnConsentCancel").addEventListener("click", function () { showOnly(null); });
el("btnConsentStart").addEventListener("click", function () { beginCall(); });

btnIncoming.addEventListener("click", function () {
  consentScreen.classList.add("hidden");
  callScreen.classList.add("hidden");
  incomingScreen.classList.remove("hidden");
  incomingScreen.scrollIntoView({ behavior: "smooth", block: "start" });
});
el("btnDecline").addEventListener("click", function () { showOnly(null); });
el("btnAccept").addEventListener("click", function () { beginCall(); });

el("btnMute").addEventListener("click", function () {
  muted = !muted;
  this.textContent = muted ? "Unmute" : "Mute";
  this.setAttribute("aria-pressed", muted ? "true" : "false");
  if (muted) { stopListening(); setListeningLabel("Muted — you can type your reply below."); }
  else if (callActive && !speaking) startListening();
});
el("btnSpeaker").addEventListener("click", function () {
  speakerOn = !speakerOn;
  this.textContent = speakerOn ? "Speaker on" : "Speaker off";
  this.setAttribute("aria-pressed", speakerOn ? "true" : "false");
  if (!speakerOn && "speechSynthesis" in window) { try { window.speechSynthesis.cancel(); } catch (e) {} speaking = false; }
});
el("btnEndCall").addEventListener("click", endCall);

typedForm.addEventListener("submit", function (event) {
  event.preventDefault();
  var value = typedInput.value.trim();
  if (!value || !callActive) return;
  typedInput.value = "";
  stopListening();
  handleCaller(value);
});

el("btnCopyUpdate").addEventListener("click", function () {
  var text = updateText.textContent;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).catch(function () {});
  }
});
el("btnDismissUpdate").addEventListener("click", function () { updateSection.classList.add("hidden"); });
el("searchInput").addEventListener("input", renderLog);

renderLog();
