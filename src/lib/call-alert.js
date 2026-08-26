// src/lib/call-alert.js
// Getting a ringing phone's attention when nobody is looking at the tab.
//
// The card itself is useless if the shop app is minimized behind CorelDRAW,
// which is the normal state of a workstation here. Three escalating nudges,
// none of which require the tab to be on screen:
//
//   1. a short tone            — audible across the room
//   2. an OS notification      — draws over whatever app is in front
//   3. the tab title           — the taskbar entry reads out the caller
//
// "Away" deliberately means `document.hidden || !document.hasFocus()`.
// visibilityState alone is not enough: on Windows a browser window sitting
// behind another application is still "visible", and that is precisely the
// case we are trying to catch.

const TITLE_FLASH_MS = 1200;

// ─── Audio ───────────────────────────────────────────────────────────────────
// Synthesised rather than an mp3: no asset to ship, no cache to bust, and it
// keeps the bundle honest. Browsers won't let a page make noise until the user
// has interacted with it at least once, so the context is created lazily and
// resumed on the first click or keypress anywhere in the app.

let audioCtx = null;

function audio() {
  if (audioCtx) return audioCtx;
  const Ctx = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!Ctx) return null;
  try { audioCtx = new Ctx(); } catch { return null; }
  return audioCtx;
}

// Call once from the app shell. Cheap, and without it the first call of the
// day is silent on a tab nobody has clicked yet.
export function primeAudio() {
  if (typeof document === 'undefined') return;
  const resume = () => {
    const ctx = audio();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  };
  document.addEventListener('pointerdown', resume, { once: true, passive: true });
  document.addEventListener('keydown', resume, { once: true });
}

// Two short rising blips — recognisable as "the computer wants you" without
// being a fire alarm. Kept quiet; the desk phone is already ringing.
export function playRing() {
  const ctx = audio();
  if (!ctx) return;
  if (ctx.state === 'suspended') { ctx.resume().catch(() => {}); }
  try {
    const now = ctx.currentTime;
    for (const [at, freq] of [[0, 660], [0.18, 880]]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      // Ramp rather than a hard start/stop: a square-edged gate clicks.
      gain.gain.setValueAtTime(0.0001, now + at);
      gain.gain.exponentialRampToValueAtTime(0.12, now + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.15);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + at);
      osc.stop(now + at + 0.16);
    }
  } catch { /* audio is a nicety, never let it throw into the caller */ }
}

// ─── OS notification ─────────────────────────────────────────────────────────

export function notificationState() {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission; // 'granted' | 'denied' | 'default'
}

// Ask once on mount. If the browser declines to prompt without a user gesture
// (Safari always, Chrome sometimes), retry on the first click — by which point
// the staffer has interacted and the prompt is allowed.
export function requestNotificationPermission() {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission !== 'default') return;
  const ask = () => { try { Notification.requestPermission(); } catch {} };
  try {
    const r = Notification.requestPermission();
    if (r && typeof r.then === 'function') {
      r.then((state) => {
        if (state === 'default') document.addEventListener('pointerdown', ask, { once: true });
      }).catch(() => document.addEventListener('pointerdown', ask, { once: true }));
      return;
    }
  } catch {}
  document.addEventListener('pointerdown', ask, { once: true });
}

function notify({ title, body, tag }) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return null;
  try {
    const n = new Notification(title, {
      body,
      tag,                 // same tag replaces rather than stacks
      // NOT /favicon.png — app.html references it but the file has never
      // existed (it's the "Not found: /favicon.png" line in every build).
      icon: '/icon-192.png',
      requireInteraction: false,
      silent: true,        // we play our own tone; don't double up
    });
    n.onclick = () => {
      try { window.focus(); } catch {}
      n.close();
    };
    return n;
  } catch {
    return null;
  }
}

// ─── Title flash ─────────────────────────────────────────────────────────────
// The one channel that needs no permission at all. Alternates the tab title so
// the taskbar button reads the caller even with notifications denied.

let flashTimer = null;
let savedTitle = null;

export function startTitleFlash(text) {
  if (typeof document === 'undefined') return;
  if (flashTimer) return;                    // a flash is already running
  savedTitle = document.title;
  let on = true;
  document.title = text;
  flashTimer = setInterval(() => {
    on = !on;
    document.title = on ? text : savedTitle;
  }, TITLE_FLASH_MS);
}

export function stopTitleFlash() {
  if (!flashTimer) return;
  clearInterval(flashTimer);
  flashTimer = null;
  if (savedTitle !== null) document.title = savedTitle;
  savedTitle = null;
}

// ─── Multi-tab claim ─────────────────────────────────────────────────────────
// Every open staff tab receives every event, so three tabs would mean three
// notifications and three tones for one call. First tab to write the claim
// wins; the others stay quiet. localStorage is synchronous and same-origin,
// which is all the atomicity this needs.

const CLAIM_KEY = 'hg_call_alert_claim';
const CLAIM_TTL_MS = 30_000;

function claim(key) {
  if (typeof localStorage === 'undefined') return true;
  try {
    const raw = localStorage.getItem(CLAIM_KEY);
    const now = Date.now();
    if (raw) {
      const prev = JSON.parse(raw);
      if (prev.key === key && now - prev.at < CLAIM_TTL_MS) return false;
    }
    localStorage.setItem(CLAIM_KEY, JSON.stringify({ key, at: now }));
    return true;
  } catch {
    return true;   // private mode or full quota — better noisy than silent
  }
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export function isAway() {
  if (typeof document === 'undefined') return false;
  // hasFocus() is the half that catches "browser is behind CorelDRAW".
  return document.hidden || !document.hasFocus();
}

// Called for each new incoming call.
export function alertIncoming({ key, title, body }) {
  if (!claim(key)) return;

  playRing();

  if (!isAway()) return;   // they're looking at it; the card is enough

  notify({ title, body, tag: `call-${key}` });
  startTitleFlash(`📞 ${title}`);
}
