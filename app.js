"use strict";

/* TwoSide Group — AI Receptionist (static, client-side only)
   Natural-voice, free-conversation receptionist with call sounds and voice chat.
   Log is stored in localStorage under STORAGE_KEY. No voice recording is kept. */

var STORAGE_KEY = "tsg-receptionist-log-v1";
var SOUND_KEY = "tsg-receptionist-sound-v1";
var GREETING = "Hello, thank you for reaching out to TwoSide Group. How can I help you today?";

var URGENT_WORDS = ["urgent", "emergency", "asap", "as soon as possible", "immediately", "right now", "critical"];
var STATUSES = ["New", "Follow-up needed", "Contacted", "Booked", "Closed"];

/* ---------- DOM ---------- */
function el(id) { return document.getElementById(id); }
function setUse(id, href) { var u = el(id); if (u) u.setAttribute("href", href); }
var consentScreen = el("consentScreen"), incomingScreen = el("incomingScreen"),
    callScreen = el("callScreen"), chatScreen = el("chatScreen");
var transcriptEl = el("transcript"), typedForm = el("typedForm"), typedInput = el("typedInput");
var micNote = el("micNote"), callTimerEl = el("callTimer"), callStatusEl = el("callStatus");
var listeningEl = el("listeningIndicator");
var chatMessagesEl = el("chatMessages"), chatForm = el("chatForm"), chatInput = el("chatInput");
var chatMicNote = el("chatMicNote"), chatListeningEl = el("chatListening");
var updateSection = el("updateSection"), updateText = el("updateText");

function containsAny(text, words) {
  for (var i = 0; i < words.length; i++) if (text.indexOf(words[i]) !== -1) return true;
  return false;
}
function firstName(name) { return name ? name.split(" ")[0] : ""; }

/* ================================================================
   SOUND MODULE — all sounds generated with WebAudio, no audio files.
   The AudioContext is created/resumed only after a user gesture.
   ================================================================ */
var Sound = (function () {
  var ctx = null, master = null;
  var ringTimer = null, ringNodes = [];
  var enabled = true;
  try { enabled = localStorage.getItem(SOUND_KEY) !== "off"; } catch (e) {}

  function ac() {
    if (!enabled) return null;
    try {
      if (!ctx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.6;
        master.connect(ctx.destination);
      }
      if (ctx.state === "suspended") ctx.resume();
      return ctx;
    } catch (e) { return null; }
  }
  function tone(freq, delay, dur, vol, type) {
    var c = ac(); if (!c) return null;
    var t0 = c.currentTime + (delay || 0);
    var osc = c.createOscillator(), g = c.createGain();
    osc.type = type || "sine";
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.04, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(master);
    osc.start(t0); osc.stop(t0 + dur + 0.05);
    return osc;
  }
  function dualTone(f1, f2, dur, vol) {
    var a = tone(f1, 0, dur, vol), b = tone(f2, 0, dur, vol);
    if (a) ringNodes.push(a);
    if (b) ringNodes.push(b);
  }
  function stopRing() {
    if (ringTimer) { clearInterval(ringTimer); ringTimer = null; }
    for (var i = 0; i < ringNodes.length; i++) { try { ringNodes[i].stop(); } catch (e) {} }
    ringNodes = [];
  }
  return {
    get enabled() { return enabled; },
    unlock: function () { ac(); },
    click: function () { tone(620, 0, 0.05, 0.012); },
    pop: function () { tone(740, 0, 0.045, 0.016); },
    connectBeep: function () { tone(880, 0, 0.14, 0.045); },
    endTone: function () { tone(660, 0, 0.13, 0.04); tone(494, 0.15, 0.2, 0.04); },
    /* US-style ringback: 440+480 Hz, 2 s on / 4 s off */
    ringback: function () {
      stopRing();
      if (!ac()) return;
      var cycle = function () { dualTone(440, 480, 2.0, 0.032); };
      cycle();
      ringTimer = setInterval(cycle, 6000);
    },
    /* Incoming ringtone: alternating two-tone pattern, looping */
    ringtone: function () {
      stopRing();
      if (!ac()) return;
      var cycle = function () {
        var a = tone(1046, 0, 0.32, 0.035), b = tone(784, 0.38, 0.32, 0.035);
        if (a) ringNodes.push(a);
        if (b) ringNodes.push(b);
      };
      cycle();
      ringTimer = setInterval(cycle, 1700);
    },
    stopRing: stopRing,
    stopAll: function () { stopRing(); },
    setEnabled: function (on) {
      enabled = !!on;
      try { localStorage.setItem(SOUND_KEY, enabled ? "on" : "off"); } catch (e) {}
      if (!enabled) stopRing();
    }
  };
})();

/* ================================================================
   NATURAL VOICE — best-voice scoring + sentence-by-sentence speech
   with slight deterministic rate/pitch variation (never flat).
   ================================================================ */
var FEMALE_NAMES = ["aria", "jenny", "samantha", "zira", "female", "eva", "ava", "emma", "joanna", "salli", "kimberly", "ivy", "allison", "serena", "kate", "susan", "hazel", "catherine"];
function scoreVoice(v) {
  var name = (v.name || "").toLowerCase();
  var lang = (v.lang || "").toLowerCase();
  var s = 0;
  if (name.indexOf("natural") !== -1) s += 60;
  if (name.indexOf("neural") !== -1) s += 55;
  if (name.indexOf("google us english") !== -1) s += 50;
  if (name.indexOf("premium") !== -1) s += 45;
  if (name.indexOf("enhanced") !== -1) s += 40;
  if (name.indexOf("online") !== -1) s += 35; /* e.g. Microsoft Aria Online (Natural) */
  for (var i = 0; i < FEMALE_NAMES.length; i++) if (name.indexOf(FEMALE_NAMES[i]) !== -1) { s += 28; break; }
  if (lang === "en-us") s += 22;
  else if (lang.indexOf("en-") === 0) s += 10;
  else if (lang.indexOf("en") === 0) s += 6;
  if (v.localService) s += 10;
  if (v.default) s += 2;
  return s;
}
var cachedVoice = null;
function pickVoice() {
  try {
    var voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
    if (!voices || !voices.length) return cachedVoice;
    var best = null, bestScore = -1;
    for (var i = 0; i < voices.length; i++) {
      var sc = scoreVoice(voices[i]);
      if (sc > bestScore) { bestScore = sc; best = voices[i]; }
    }
    cachedVoice = best;
    return best;
  } catch (e) { return cachedVoice; }
}
if ("speechSynthesis" in window) {
  try { window.speechSynthesis.onvoiceschanged = function () { pickVoice(); }; } catch (e) {}
  pickVoice();
}

var speechToken = 0; /* increments to cancel in-flight speech */
function cancelSpeech() {
  speechToken++;
  if ("speechSynthesis" in window) { try { window.speechSynthesis.cancel(); } catch (e) {} }
}
function splitSentences(text) {
  var parts = String(text).match(/[^.!?]+[.!?]+["']?|[^.!?]+$/g) || [text];
  return parts.map(function (p) { return p.trim(); }).filter(function (p) { return p.length; });
}
/* Speak text sentence-by-sentence; each sentence gets a slightly different
   rate (0.97–1.03) and pitch (1.00–1.08) so it never sounds monotone. */
function speakText(text, onDone) {
  var myToken = ++speechToken;
  if (!("speechSynthesis" in window)) { if (onDone) setTimeout(onDone, 60); return; }
  var sentences = splitSentences(text);
  var idx = 0;
  function next() {
    if (myToken !== speechToken) return; /* cancelled */
    if (idx >= sentences.length) { if (onDone) onDone(); return; }
    var i = idx++;
    var utter = new SpeechSynthesisUtterance(sentences[i]);
    utter.lang = "en-US";
    var voice = pickVoice();
    if (voice) utter.voice = voice;
    utter.rate = 0.97 + ((i * 37) % 7) * 0.01;
    utter.pitch = 1.0 + ((i * 53) % 9) * 0.01;
    var advanced = false;
    function adv() { if (advanced) return; advanced = true; next(); }
    utter.onend = adv;
    utter.onerror = adv;
    try { window.speechSynthesis.speak(utter); } catch (e) { adv(); return; }
    setTimeout(adv, Math.max(1600, sentences[i].length * 110)); /* safety */
  }
  next();
}

/* ================================================================
   FREE-CONVERSATION ENGINE (client-side, shared by call & chat)
   Not a fixed script: every utterance is analysed for entities and
   intent in ANY order, and the reply is composed dynamically —
   acknowledge what was understood, answer what was asked, and only
   then ask for the single most important missing detail.
   ================================================================ */
function newContext() {
  return {
    name: "", phone: "", reason: "", preferredTime: "",
    topic: "", captureActive: false, complete: false, closed: false,
    greeted: false, expecting: "", highPriority: false,
    lastVar: {}, openerUsed: false
  };
}
var convo = newContext(); /* shared context for this page session */

/* ---------- variant picker: never repeats the same line back-to-back ---------- */
function variant(ctx, key, arr) {
  if (arr.length === 1) return arr[0];
  var i, guard = 0;
  do { i = Math.floor(Math.random() * arr.length); guard++; }
  while (ctx.lastVar[key] === i && guard < 8);
  ctx.lastVar[key] = i;
  return arr[i];
}
function opener(ctx) {
  if (ctx.openerUsed || Math.random() < 0.5) return "";
  ctx.openerUsed = true;
  return variant(ctx, "opener", ["Sure, ", "Of course, ", "Got it — ", "Certainly, ", "Absolutely, "]);
}

/* ---------- entity extraction ---------- */
var NAME_STOPWORDS = ["calling", "looking", "interested", "here", "not", "just", "from", "the", "a", "an", "trying", "hoping", "wondering", "going", "asking", "checking", "fine", "good", "well", "happy", "sorry"];
function titleCase(s) {
  return s.replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); });
}
function extractName(text) {
  var m = text.match(/(?:my name is|this is|name is)\s+([A-Za-z][A-Za-z'\-]+(?:\s+[A-Za-z][A-Za-z'\-]+){0,2})/i);
  if (m) {
    var words = m[1].trim().split(/\s+/);
    while (words.length && NAME_STOPWORDS.indexOf(words[0].toLowerCase()) !== -1) words.shift();
    if (words.length) return titleCase(words.join(" ").replace(/[.,]+$/, ""));
  }
  m = text.match(/^(?:i am|i'm)\s+([A-Z][a-z'\-]+(?:\s+[A-Z][a-z'\-]+){0,2})/);
  if (m && NAME_STOPWORDS.indexOf(m[1].split(" ")[0].toLowerCase()) === -1) {
    return m[1].replace(/[.,]+$/, "");
  }
  return "";
}
function extractPhone(text) {
  var m = text.replace(/[()]/g, " ").match(/\+?\d[\d\s\-]{6,}\d/);
  if (!m) return "";
  var digits = m[0].replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return "";
  return m[0].replace(/\s+/g, " ").trim();
}
var DAY_WORDS = "monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow";
function extractTime(text) {
  var m = text.match(new RegExp("\\b(?:" + DAY_WORDS + ")\\b(?:\\s+(?:morning|afternoon|evening))?(?:\\s+at\\s+\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)?)?", "i"));
  if (m) return m[0].trim();
  m = text.match(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i);
  if (m) return m[0].trim();
  m = text.match(/\b\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?\b/);
  if (m) return m[0].trim();
  m = text.match(/\bnext week\b|\bthis (?:morning|afternoon|evening)\b|\bin the (?:morning|afternoon|evening)\b/i);
  if (m) return m[0].trim();
  return "";
}
function extractReason(text, timeText) {
  var t = " " + text.trim() + " ";
  var m = t.match(/(?:for|about|regarding|to discuss|to talk about)\s+(.+?)(?:[.!?]|$)/i);
  if (!m) m = t.match(/(?:i (?:need|want|would like|'d like|am looking for|require))\s+(.+?)(?:[.!?]|$)/i);
  if (!m) return "";
  var r = m[1].trim().replace(/\s+/g, " ");
  if (timeText) {
    var idx = r.toLowerCase().indexOf(timeText.toLowerCase());
    if (idx !== -1) r = (r.slice(0, idx) + r.slice(idx + timeText.length)).replace(/\s+(at|on)\s*$/, "").trim();
  }
  r = r.replace(/^(a|an|the)\s+/i, function (a) { return a; }).replace(/[.,\s]+$/, "");
  if (r.length < 3) return "";
  return r.charAt(0).toUpperCase() + r.slice(1);
}

/* ---------- intent detection ---------- */
function detectIntent(lower, ctx) {
  if (/\b(bye|goodbye|good bye|that's all|that is all|see you)\b/.test(lower)) return "goodbye";
  if (/\b(thank|thanks|thank you|great|perfect|awesome)\b/.test(lower)) return "thanks";
  if (containsAny(lower, ["price", "pricing", "cost", "quote", "how much", "charge", "fee"])) return "pricing";
  if (containsAny(lower, ["chairman", "owner", "boss", "speak with", "speak to", "talk to", "talk with"])) return "chairman";
  if (containsAny(lower, ["meeting", "appointment", "book", "schedule", "call back", "callback"])) return "meeting";
  if (containsAny(lower, ["website", "web site", "web design", "app", "application", "service", "homepage", "online store", "ecommerce", "e-commerce", "development", "develop"])) return "service";
  if (containsAny(lower, ["what time", "when are you open", "open", "hours", "available", "availability"])) return "hours";
  if (containsAny(lower, ["where", "located", "location", "address"])) return "location";
  if (containsAny(lower, ["who are you", "your name", "are you a robot", "are you human", "are you ai"])) return "who";
  if (containsAny(lower, ["what do you do", "what does twoside", "what does two side", "what is twoside", "what is two side", "about your company", "about twoside", "services do you", "offer"])) return "whatdo";
  if (containsAny(lower, ["how are you", "how is it going", "how's it going", "how do you feel"])) return "smalltalk";
  if (/^(hello|hi|hey|good morning|good afternoon|good evening)\b/.test(lower)) return "greeting";
  if (/^(yes|yeah|yep|sure|ok|okay|please|go ahead)\b/.test(lower)) return "yes";
  if (/^(no|nope|not now|not really)\b/.test(lower)) return "no";
  return "unknown";
}

/* ---------- question variants for the next missing detail ---------- */
function nextMissing(ctx) {
  if (!ctx.name) return "name";
  if (!ctx.phone) return "phone";
  if (!ctx.reason) return "reason";
  if (!ctx.preferredTime) return "time";
  return "";
}
function askFor(ctx, field) {
  var fn = firstName(ctx.name);
  if (field === "name") return variant(ctx, "askName", [
    "May I have your full name, please?",
    "Could I take your full name, please?",
    "What's your full name, please?"
  ]);
  if (field === "phone") return variant(ctx, "askPhone", [
    (fn ? "Thanks, " + fn + ". " : "") + "What's the best phone or WhatsApp number to reach you on?",
    "And the best phone or WhatsApp number for the follow-up?",
    "Could I note down your phone or WhatsApp number, please?"
  ]);
  if (field === "reason") return variant(ctx, "askReason", [
    "What would you like to discuss, in a few words?",
    "What's the exact reason for reaching out, so I can pass it on clearly?",
    "What is this regarding, so the Chairman has the full picture?"
  ]);
  if (field === "time") return variant(ctx, "askTime", [
    "What time suits you best for the follow-up?",
    "When would you prefer the Chairman to reach you?",
    "Is there a time that works best for you?"
  ]);
  return "";
}

/* ---------- answer variants (known TSG info only — never invented) ---------- */
function answerFor(ctx, intent) {
  var fn = firstName(ctx.name);
  switch (intent) {
    case "pricing": return variant(ctx, "ansPricing", [
      "I can't confirm exact pricing here — the Chairman confirms pricing personally when he follows up.",
      "Pricing is confirmed by the Chairman himself on follow-up, so I never quote figures that might not hold.",
      "I don't want to guess at a price — the Chairman will confirm the exact pricing when he speaks with you."
    ]);
    case "whatdo": return variant(ctx, "ansWhatdo", [
      "TwoSide Group builds websites and apps for businesses, and there's a free sample homepage offer to help you get started.",
      "We design and build websites and mobile apps for businesses — and the Chairman personally follows up on every request.",
      "TwoSide Group creates websites and apps that help businesses sell and book online, including a free sample homepage to start with."
    ]);
    case "who": return variant(ctx, "ansWho", [
      "I'm the receptionist for TwoSide Group — I answer questions and pass meeting and service requests straight to the Chairman.",
      "I look after the front desk here at TwoSide Group, helping callers and making sure every request reaches the Chairman."
    ]);
    case "hours": return variant(ctx, "ansHours", [
      "I don't have confirmed hours to share, but the Chairman can confirm his availability when he follows up with you.",
      "Availability is best confirmed by the Chairman directly — I can take your details and a preferred time."
    ]);
    case "location": return variant(ctx, "ansLocation", [
      "TwoSide Group works with businesses online, and the Chairman can share full details when he follows up.",
      "Most of our work is handled online for businesses — the Chairman can confirm anything location-specific on follow-up."
    ]);
    case "smalltalk": return variant(ctx, "ansSmall", [
      "I'm doing well, thank you for asking" + (fn ? ", " + fn : "") + " — how can I help you today?",
      "Very well, thanks — it's a pleasure to help. What can I do for you today?"
    ]);
    case "greeting": return variant(ctx, "ansGreet", [
      "Hello" + (fn ? ", " + fn : "") + " — how can I help you today?",
      "Hi there — what can I do for you today?"
    ]);
  }
  return "";
}

function closingLine(ctx) {
  var fn = firstName(ctx.name);
  var line = variant(ctx, "closing", [
    "That's everything I need" + (fn ? ", " + fn : "") + ". Your details are noted, and the Chairman will follow up shortly" + (ctx.preferredTime ? " — around " + ctx.preferredTime : "") + ".",
    "Perfect, I have everything noted" + (fn ? ", " + fn : "") + ". The Chairman will follow up shortly" + (ctx.preferredTime ? ", around " + ctx.preferredTime : "") + ".",
    "Wonderful — all noted. The Chairman will be in touch shortly" + (ctx.preferredTime ? ", around " + ctx.preferredTime : "") + "."
  ]);
  if (ctx.highPriority) line += " I've marked this as High Priority.";
  return line;
}

/* ---------- the brain: one caller utterance -> one composed reply ---------- */
function processTurn(ctx, rawText) {
  var text = String(rawText || "").trim();
  var lower = text.toLowerCase();
  ctx.openerUsed = false;
  if (containsAny(lower, URGENT_WORDS)) ctx.highPriority = true;

  var found = {};
  var time = extractTime(text);
  if (time && time !== ctx.preferredTime) { ctx.preferredTime = time; found.time = true; }
  var phone = extractPhone(text);
  if (phone && phone !== ctx.phone) { ctx.phone = phone; found.phone = true; }
  var name = extractName(text);
  if (name && !ctx.name) { ctx.name = name; found.name = true; }

  /* Direct answers to a pending capture question */
  if (!ctx.name && ctx.expecting === "name" && text.split(/\s+/).length <= 4 && !/\d/.test(text) && !detectIntentIsQuestion(lower)) {
    ctx.name = titleCase(text.replace(/^(i am|i'm|this is|my name is)\s+/i, "").replace(/[.,]+$/, "").trim());
    if (ctx.name) found.name = true;
  }
  if (!ctx.reason && ctx.expecting === "reason" && text.length > 2) {
    var r0 = extractReason(text, time) || text.replace(/[.!?]+$/, "");
    ctx.reason = r0.charAt(0).toUpperCase() + r0.slice(1);
    found.reason = true;
  }

  var intent = detectIntent(lower, ctx);
  if (!ctx.reason) {
    var r = extractReason(text, time);
    if (r && (intent === "service" || intent === "meeting" || intent === "pricing" || ctx.captureActive)) {
      ctx.reason = r; found.reason = true;
    }
  }
  if (intent === "meeting" || intent === "service" || intent === "pricing" || intent === "chairman") {
    ctx.captureActive = true;
    ctx.topic = intent;
    if (intent === "chairman" && !ctx.reason) { ctx.reason = "Wants to speak with the Chairman"; found.reason = true; }
    if (intent === "meeting" && !ctx.reason && containsAny(lower, ["meeting", "appointment"])) { ctx.reason = "Meeting request"; found.reason = true; }
  }
  if (intent === "yes" && !ctx.captureActive && ctx.askedFollowUp) ctx.captureActive = true;

  ctx.complete = !!(ctx.captureActive && ctx.name && ctx.phone && ctx.reason);

  /* ---- compose the reply: ack -> answer -> next step (max 3 sentences) ---- */
  var parts = [];

  if (found.name) parts.push(variant(ctx, "ackName", [
    "Thanks, " + firstName(ctx.name) + " — lovely to meet you.",
    "Great, thank you, " + firstName(ctx.name) + ".",
    "Nice to meet you, " + firstName(ctx.name) + "."
  ]));
  else if (found.phone) parts.push(variant(ctx, "ackPhone", [
    "Thanks — I've got your number noted as " + ctx.phone + ".",
    "Got it — " + ctx.phone + ", noted down.",
    "Perfect, I've noted your number."
  ]));
  else if (found.time && ctx.captureActive) parts.push(variant(ctx, "ackTime", [
    "Noted — " + ctx.preferredTime + " it is.",
    "Got it, " + ctx.preferredTime + " — noted."
  ]));
  else if (found.reason && ctx.captureActive) parts.push(variant(ctx, "ackReason", [
    "Understood — I've noted that down.",
    "Got it, that's clear — noted."
  ]));

  if (intent === "goodbye" || intent === "thanks") {
    if (ctx.complete) {
      parts = [closingLine(ctx)];
      ctx.closed = true;
    } else if (intent === "thanks") {
      parts.push(variant(ctx, "thanksReply", [
        "You're very welcome. Is there anything else I can help with?",
        "Happy to help. Anything else you'd like me to note down?"
      ]));
    } else {
      parts.push(variant(ctx, "byeReply", [
        "Thank you for reaching out to TwoSide Group — take care.",
        "Thanks for your time — we're here whenever you need us."
      ]));
      ctx.closed = true;
    }
    return finishReply(ctx, parts);
  }

  var answer = answerFor(ctx, intent);
  if (answer && !(intent === "pricing" && parts.length && found.name)) parts.push(opener(ctx) + answer);
  else if (intent === "chairman" && !answer) parts.push(opener(ctx) + variant(ctx, "ansChairman", [
    "Of course — the Chairman follows up personally on every request, and I'll pass yours straight to him.",
    "Certainly — I'll note your details and the Chairman will reach out to you himself."
  ]));
  else if (intent === "meeting" || intent === "service") parts.push(opener(ctx) + variant(ctx, "ansCaptureStart", [
    "I'd be happy to arrange that — let me take a few details so the Chairman can follow up.",
    "Happy to help with that — I'll note your details for the Chairman's follow-up.",
    "That sounds great — let me take your details so we can set it up properly."
  ]));

  if (ctx.complete && !ctx.closed) {
    parts.push(closingLine(ctx));
    ctx.closed = true;
    return finishReply(ctx, parts);
  }

  if (ctx.captureActive) {
    var missing = nextMissing(ctx);
    if (missing) { ctx.expecting = missing; parts.push(askFor(ctx, missing)); }
  } else if (intent === "unknown" || intent === "no") {
    ctx.askedFollowUp = true;
    parts.push(variant(ctx, "steer", [
      "I can answer general questions about TwoSide Group, or take your details for a meeting or a service — what would help most?",
      "Happy to help either way — would you like some information first, or shall I take your details for a follow-up?",
      "Just let me know — I can share more about what we do, or note your details for the Chairman."
    ]));
  }
  return finishReply(ctx, parts);
}
function detectIntentIsQuestion(lower) {
  return containsAny(lower, ["what", "how", "when", "where", "who", "price", "cost"]);
}
function finishReply(ctx, parts) {
  parts = parts.filter(function (p) { return p && p.trim(); });
  if (!parts.length) parts = ["How can I help you today?"];
  /* keep to at most 3 sentences */
  var reply = parts.join(" ");
  var sentences = splitSentences(reply);
  if (sentences.length > 3) reply = sentences.slice(0, 3).join(" ");
  return reply;
}

/* ================================================================
   SPEECH RECOGNITION — one factory, used by both call and chat.
   ================================================================ */
var SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition || null;
function createRecognizer(handlers) {
  if (!SpeechRecognitionCtor) return null;
  var rec = new SpeechRecognitionCtor();
  rec.continuous = false;
  rec.interimResults = true;
  rec.lang = "en-US";
  var running = false;
  rec.onresult = function (event) {
    var interim = "", finalText = "";
    for (var i = event.resultIndex; i < event.results.length; i++) {
      var res = event.results[i];
      if (res.isFinal) finalText += res[0].transcript;
      else interim += res[0].transcript;
    }
    if (interim && handlers.onInterim) handlers.onInterim(interim);
    if (finalText && finalText.trim() && handlers.onFinal) handlers.onFinal(finalText.trim());
  };
  rec.onend = function () { running = false; if (handlers.onEnd) handlers.onEnd(); };
  rec.onerror = function (event) { running = false; if (handlers.onError) handlers.onError(event.error || ""); };
  return {
    start: function () { if (running) return; try { rec.start(); running = true; } catch (e) {} },
    stop: function () { if (!running) return; try { rec.stop(); } catch (e) {} running = false; },
    isRunning: function () { return running; }
  };
}

/* ---------- message bubbles ---------- */
function addBubble(container, who, text) {
  var div = document.createElement("div");
  div.className = "bubble " + (who === "Receptionist" ? "receptionist" : "caller");
  var label = document.createElement("span");
  label.className = "who";
  label.textContent = who;
  div.appendChild(label);
  div.appendChild(document.createTextNode(text));
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  Sound.pop();
  return div;
}
function makeInterimBubble(container, text, existing) {
  if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
  var div = document.createElement("div");
  div.className = "bubble caller interim";
  var label = document.createElement("span");
  label.className = "who";
  label.textContent = "Caller";
  div.appendChild(label);
  div.appendChild(document.createTextNode(text));
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
}

/* ================================================================
   LOG — storage, NEW RECEPTIONIST UPDATE format, rendering
   ================================================================ */
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
function showUpdate(entry) {
  updateText.textContent = formatUpdate(entry);
  updateSection.classList.remove("hidden");
  updateSection.scrollIntoView({ behavior: "smooth", block: "start" });
}
function saveSession(channel, transcriptArr) {
  var complete = !!(convo.name && convo.phone && convo.reason);
  var transcriptText = transcriptArr.map(function (t) { return t.who + ": " + t.text; }).join(" | ");
  var who = convo.name || "A caller";
  var summary = who + " contacted TwoSide Group through a " + (channel === "Voice chat" ? "browser voice chat" : "browser voice call") + ". " +
    (convo.reason
      ? "They wanted: " + convo.reason.replace(/\s+/g, " ").replace(/\.+$/, "") + "."
      : "No specific meeting, service, or pricing request was completed during the conversation.");
  var entry = {
    id: "entry-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
    dateISO: new Date().toISOString(),
    name: convo.name || "",
    phone: convo.phone || "",
    channel: channel,
    urgency: convo.highPriority ? "High Priority" : "Normal",
    summary: summary,
    actionNeeded: complete
      ? "Chairman to follow up shortly" + (convo.preferredTime ? " — preferred time: " + convo.preferredTime : "") + "."
      : "Follow-up needed: details were incomplete — " +
        (!convo.name ? "name not captured. " : "") +
        (!convo.phone ? "phone/WhatsApp not captured. " : "") +
        (!convo.reason ? "reason/preferred time not captured." : ""),
    preferredTime: convo.preferredTime || "",
    keyNotes:
      (convo.reason ? "Reason: " + convo.reason + ". " : "") +
      (convo.preferredTime ? "Preferred time: " + convo.preferredTime + ". " : "") +
      (convo.highPriority ? "Caller used urgent wording — marked High Priority. " : "") +
      "Transcript: " + (transcriptText || "No transcript captured."),
    status: complete ? "New" : "Follow-up needed"
  };
  var entries = loadEntries();
  entries.unshift(entry);
  saveEntries(entries);
  renderLog();
  showUpdate(entry);
  convo = newContext(); /* fresh context for the next session */
  return entry;
}
function renderLog() {
  var query = (el("searchInput").value || "").toLowerCase().trim();
  var all = loadEntries();
  var entries = all.filter(function (e) {
    if (!query) return true;
    return [e.name, e.phone, e.summary, e.urgency, e.status, e.channel]
      .join(" ").toLowerCase().indexOf(query) !== -1;
  });
  var body = el("logBody");
  body.innerHTML = "";
  el("logEmpty").classList.toggle("hidden", entries.length !== 0);
  el("logEmpty").textContent = all.length === 0
    ? "No conversations logged yet. Calls and voice chats you handle here will appear in this log."
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
      var list = loadEntries();
      for (var i = 0; i < list.length; i++) if (list[i].id === entry.id) list[i].status = select.value;
      saveEntries(list);
      renderLog();
    });
    statusTd.appendChild(select);
    tr.appendChild(statusTd);

    var actionsTd = document.createElement("td");
    var del = document.createElement("button");
    del.type = "button";
    del.className = "btn-delete";
    del.setAttribute("aria-label", "Delete entry for " + (entry.name || "caller"));
    del.innerHTML = '<svg class="icon"><use href="#icon-trash"/></svg>';
    del.addEventListener("click", function () {
      saveEntries(loadEntries().filter(function (e) { return e.id !== entry.id; }));
      renderLog();
    });
    actionsTd.appendChild(del);
    tr.appendChild(actionsTd);

    body.appendChild(tr);
  });
}

/* ================================================================
   VOICE CALL
   ================================================================ */
var callPhase = "idle"; /* idle | calling | connected */
var callTranscript = [];
var callInterim = null;
var muted = false, speakerOn = true, speaking = false;
var callStartedAt = null, timerInterval = null, connectTimeout = null;
var callRecognizer = null;

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
function stopTimer() { if (timerInterval) clearInterval(timerInterval); timerInterval = null; }
function setListeningLabel(t) { listeningEl.textContent = t; }

function ensureCallRecognizer() {
  if (callRecognizer) return callRecognizer;
  callRecognizer = createRecognizer({
    onInterim: function (text) {
      callInterim = makeInterimBubble(transcriptEl, text, callInterim);
    },
    onFinal: function (text) {
      if (callInterim && callInterim.parentNode) callInterim.parentNode.removeChild(callInterim);
      callInterim = null;
      handleCallerUtterance(text);
    },
    onError: function (err) {
      if (err === "not-allowed" || err === "service-not-allowed") {
        showCallMicNote("Microphone access was not allowed, so the typed option is active. Type your reply below and press Send.");
      } else if (err === "audio-capture") {
        showCallMicNote("No microphone was found, so the typed option is active. Type your reply below and press Send.");
      }
    },
    onEnd: function () {
      if (callPhase === "connected" && !muted && !speaking) setTimeout(startCallListening, 350);
      else if (callPhase === "connected" && !speaking) setListeningLabel("Tap Unmute or type your reply below.");
    }
  });
  return callRecognizer;
}
function startCallListening() {
  if (callPhase !== "connected" || muted || speaking) return;
  if (!SpeechRecognitionCtor) { setListeningLabel("Voice input is not available in this browser — please type below."); return; }
  var rec = ensureCallRecognizer();
  if (rec) { rec.start(); setListeningLabel("Listening…"); }
}
function stopCallListening() { if (callRecognizer) callRecognizer.stop(); }
function showCallMicNote(msg) {
  micNote.textContent = msg;
  micNote.classList.remove("hidden");
  typedInput.focus();
}

function receptionistSay(text, after) {
  addBubble(transcriptEl, "Receptionist", text);
  callTranscript.push({ who: "Receptionist", text: text });
  if (!speakerOn) { if (after) setTimeout(after, 350); return; }
  stopCallListening();
  speaking = true;
  setListeningLabel("Receptionist is speaking…");
  speakText(text, function () {
    speaking = false;
    if (after) after();
  });
}
function handleCallerUtterance(text) {
  if (callPhase !== "connected") return;
  addBubble(transcriptEl, "Caller", text);
  callTranscript.push({ who: "Caller", text: text });
  var reply = processTurn(convo, text);
  receptionistSay(reply, function () {
    if (convo.closed) setListeningLabel("All details captured. You can end the call now.");
    startCallListening();
  });
}

function hideCallScreens() {
  consentScreen.classList.add("hidden");
  incomingScreen.classList.add("hidden");
  callScreen.classList.add("hidden");
}
function prepareCallScreen() {
  hideCallScreens();
  chatScreen.classList.add("hidden");
  callScreen.classList.remove("hidden");
  callScreen.classList.add("live");
  transcriptEl.innerHTML = "";
  callTranscript = [];
  callInterim = null;
  muted = false; speaking = false;
  el("btnMute").setAttribute("aria-pressed", "false");
  setUse("muteUse", "#icon-mic");
  el("muteLabel").textContent = "Mute";
  el("btnSpeaker").setAttribute("aria-pressed", speakerOn ? "true" : "false");
  setUse("speakerUse", speakerOn ? "#icon-volume" : "#icon-volume-off");
  micNote.classList.add("hidden");
  micNote.textContent = "";
  callTimerEl.textContent = "0:00";
}
function connectCall() {
  if (callPhase !== "calling") return;
  callPhase = "connected";
  Sound.stopRing();
  Sound.connectBeep();
  callStatusEl.textContent = "Connected";
  startTimer();
  if (!SpeechRecognitionCtor) {
    showCallMicNote("Voice input is not available in this browser, so the typed option is active. Type your reply below and press Send.");
  }
  receptionistSay(GREETING, startCallListening);
}
function startOutgoingCall() {
  prepareCallScreen();
  callPhase = "calling";
  callStatusEl.textContent = "Calling…";
  setListeningLabel("Calling…");
  Sound.ringback(); /* US-style ringback while the call connects */
  var delay = 2500 + Math.random() * 1500; /* ~2.5–4 s connecting */
  connectTimeout = setTimeout(connectCall, delay);
}
function acceptIncomingCall() {
  Sound.stopRing();
  prepareCallScreen();
  callPhase = "calling";
  callStatusEl.textContent = "Connecting…";
  setListeningLabel("Connecting…");
  connectTimeout = setTimeout(connectCall, 450);
}
function endCall(playTone) {
  if (callPhase === "idle") { hideCallScreens(); return; }
  var wasActive = callPhase === "connected" || callTranscript.length > 0;
  callPhase = "idle";
  if (connectTimeout) { clearTimeout(connectTimeout); connectTimeout = null; }
  stopCallListening();
  cancelSpeech();
  speaking = false;
  Sound.stopAll();
  if (playTone) Sound.endTone();
  stopTimer();
  callScreen.classList.remove("live");
  hideCallScreens();
  if (wasActive) saveSession("Voice call (browser)", callTranscript);
  callTranscript = [];
}

/* ================================================================
   VOICE CHAT — same engine, same shared context, spoken replies
   ================================================================ */
var chatTranscript = [];
var chatInterim = null;
var chatSpeakerOn = true;
var chatRecognizer = null;
var chatListening = false;
var chatStarted = false;

function chatSay(text, speakIt) {
  addBubble(chatMessagesEl, "Receptionist", text);
  chatTranscript.push({ who: "Receptionist", text: text });
  if (speakIt && chatSpeakerOn) speakText(text, null);
}
function handleChatUtterance(text) {
  addBubble(chatMessagesEl, "Caller", text);
  chatTranscript.push({ who: "Caller", text: text });
  var reply = processTurn(convo, text);
  chatSay(reply, true);
}
function ensureChatRecognizer() {
  if (chatRecognizer) return chatRecognizer;
  chatRecognizer = createRecognizer({
    onInterim: function (text) {
      chatInterim = makeInterimBubble(chatMessagesEl, text, chatInterim);
    },
    onFinal: function (text) {
      if (chatInterim && chatInterim.parentNode) chatInterim.parentNode.removeChild(chatInterim);
      chatInterim = null;
      handleChatUtterance(text);
    },
    onError: function (err) {
      if (err === "not-allowed" || err === "service-not-allowed") {
        chatMicNote.textContent = "Microphone access was not allowed, so typing is active instead. Type your message below and press Send.";
        chatMicNote.classList.remove("hidden");
      } else if (err === "audio-capture") {
        chatMicNote.textContent = "No microphone was found, so typing is active instead.";
        chatMicNote.classList.remove("hidden");
      }
    },
    onEnd: function () {
      chatListening = false;
      el("chatMicBtn").setAttribute("aria-pressed", "false");
      chatListeningEl.classList.add("hidden");
    }
  });
  return chatRecognizer;
}
function openChat() {
  hideCallScreens();
  chatScreen.classList.remove("hidden");
  chatScreen.scrollIntoView({ behavior: "smooth", block: "start" });
  if (!chatStarted) {
    chatStarted = true;
    chatSay(GREETING, false); /* shown as text; speech starts with her replies after you interact */
  }
  chatInput.focus();
}
function endChat() {
  if (chatRecognizer) chatRecognizer.stop();
  chatListening = false;
  el("chatMicBtn").setAttribute("aria-pressed", "false");
  chatListeningEl.classList.add("hidden");
  cancelSpeech();
  var hadCaller = chatTranscript.some(function (t) { return t.who === "Caller"; });
  if (hadCaller) {
    saveSession("Voice chat", chatTranscript);
    Sound.endTone();
  }
  chatTranscript = [];
  chatMessagesEl.innerHTML = "";
  chatStarted = false;
  chatSay(GREETING, false);
  chatStarted = true;
}

/* ================================================================
   WIRING
   ================================================================ */
function syncSoundToggle() {
  el("btnSoundToggle").setAttribute("aria-pressed", Sound.enabled ? "true" : "false");
  setUse("soundToggleUse", Sound.enabled ? "#icon-volume" : "#icon-volume-off");
}
el("btnSoundToggle").addEventListener("click", function () {
  Sound.unlock();
  Sound.setEnabled(!Sound.enabled);
  syncSoundToggle();
  if (Sound.enabled) Sound.click();
});
syncSoundToggle();

el("btnCall").addEventListener("click", function () {
  Sound.unlock(); Sound.click();
  hideCallScreens();
  chatScreen.classList.add("hidden");
  consentScreen.classList.remove("hidden");
  consentScreen.scrollIntoView({ behavior: "smooth", block: "start" });
});
el("btnConsentCancel").addEventListener("click", function () { Sound.click(); hideCallScreens(); });
el("btnConsentStart").addEventListener("click", function () { Sound.unlock(); startOutgoingCall(); });

el("btnIncoming").addEventListener("click", function () {
  Sound.unlock(); Sound.click();
  hideCallScreens();
  chatScreen.classList.add("hidden");
  incomingScreen.classList.remove("hidden");
  incomingScreen.scrollIntoView({ behavior: "smooth", block: "start" });
  Sound.ringtone(); /* rings until Accept or Decline */
});
el("btnDecline").addEventListener("click", function () {
  Sound.stopAll();
  Sound.endTone();
  hideCallScreens();
});
el("btnAccept").addEventListener("click", function () { Sound.unlock(); acceptIncomingCall(); });

el("btnVoiceChat").addEventListener("click", function () { Sound.unlock(); Sound.click(); openChat(); });

el("btnMute").addEventListener("click", function () {
  muted = !muted;
  this.setAttribute("aria-pressed", muted ? "true" : "false");
  setUse("muteUse", muted ? "#icon-mic-off" : "#icon-mic");
  el("muteLabel").textContent = muted ? "Unmute" : "Mute";
  if (muted) { stopCallListening(); setListeningLabel("Muted — you can type your reply below."); }
  else if (callPhase === "connected" && !speaking) startCallListening();
});
el("btnSpeaker").addEventListener("click", function () {
  speakerOn = !speakerOn;
  this.setAttribute("aria-pressed", speakerOn ? "true" : "false");
  setUse("speakerUse", speakerOn ? "#icon-volume" : "#icon-volume-off");
  if (!speakerOn) { cancelSpeech(); speaking = false; if (callPhase === "connected") startCallListening(); }
});
el("btnEndCall").addEventListener("click", function () { endCall(true); });

typedForm.addEventListener("submit", function (event) {
  event.preventDefault();
  var value = typedInput.value.trim();
  if (!value || callPhase !== "connected") return;
  typedInput.value = "";
  stopCallListening();
  handleCallerUtterance(value);
});

chatForm.addEventListener("submit", function (event) {
  event.preventDefault();
  var value = chatInput.value.trim();
  if (!value) return;
  chatInput.value = "";
  Sound.unlock();
  handleChatUtterance(value);
});
el("chatMicBtn").addEventListener("click", function () {
  Sound.unlock();
  if (!SpeechRecognitionCtor) {
    chatMicNote.textContent = "Voice input is not available in this browser, so typing is active instead. Type your message below and press Send.";
    chatMicNote.classList.remove("hidden");
    chatInput.focus();
    return;
  }
  var rec = ensureChatRecognizer();
  if (chatListening) { rec.stop(); return; }
  cancelSpeech();
  chatListening = true;
  this.setAttribute("aria-pressed", "true");
  chatListeningEl.classList.remove("hidden");
  rec.start();
});
el("chatSpeakerBtn").addEventListener("click", function () {
  chatSpeakerOn = !chatSpeakerOn;
  this.setAttribute("aria-pressed", chatSpeakerOn ? "true" : "false");
  setUse("chatSpeakerUse", chatSpeakerOn ? "#icon-volume" : "#icon-volume-off");
  if (!chatSpeakerOn) cancelSpeech();
});
el("btnEndChat").addEventListener("click", function () { Sound.click(); endChat(); });

el("btnCopyUpdate").addEventListener("click", function () {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(updateText.textContent).catch(function () {});
  }
});
el("btnDismissUpdate").addEventListener("click", function () { updateSection.classList.add("hidden"); });
el("searchInput").addEventListener("input", renderLog);

renderLog();
