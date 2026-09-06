#!/usr/bin/env node
//
// Redraw an election post.
//
// The first fifty images were made once and never committed with a way to
// remake them, which was fine right up until the copy on four of them turned
// out to be wrong. Correcting the caption is not enough — the claim is set in
// the artwork — so this exists to redraw a post from text.
//
//   node scripts/make-election-posts.mjs            # everything in the spec
//   node scripts/make-election-posts.mjs 2026-09-08 # just one
//
// It renders HTML in headless Chrome and screenshots it at 1080 square, which
// is how these have to be made: the layout is ordinary CSS and the fonts are
// the ones already on the machine.
//
// The measurements are taken off the originals, not invented — stripe period,
// card size and tilt, band height, the exact reds — so a redrawn post sits in
// the run without looking like a different hand made it. See MEASURED below.

import { readFileSync, writeFileSync, mkdtempSync, rmSync, copyFileSync } from 'node:fs';
import { basename, isAbsolute, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ART = JSON.parse(readFileSync(join(HERE, 'election-art.json'), 'utf8'));
const OUT = join(HERE, '..', 'static', 'election-posts');

// MEASURED off static/election-posts/2026-09-08_Tue.png and 2026-10-19_Mon.png
// by sampling pixels, so the redraws match rather than approximate.
const M = {
  bg: '#191919', stripe: '#202020', stripePeriod: 15, stripeWidth: 2,
  red: '#e03127',        // the band, the rule
  redLogo: '#ec3237',    // HOLM is a touch brighter than the band
  ink: '#1f1f1f', inkSoft: '#363435', body: '#4a4a4a',
  // STRAIGHT. The originals sat at -1.2 degrees, meant to read as a sign
  // leaning on a lawn. At a glance in a feed it reads as a crooked photograph
  // of a flat card, which is not the same thing and is not flattering.
  cardW: 880, cardH: 720, cardHBullets: 842, cardTilt: 0, bandH: 143,
  darkBg: '#191919', darkBody: '#c9c4bf', darkUrl: '#f0574a',
  redBg: '#d6342a',      // the countdown layout is a flat red field
};

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// The headline is the only thing that has to flex: two words sit large, a
// three-line sentence has to come down or it runs out of card.
const headlineSize = (lines) => (lines <= 1 ? 108 : lines === 2 ? 92 : lines === 3 ? 72 : 64);

function cardHtml(p) {
  const lines = p.headline.split('|');
  return `
  <div class="card">
    <div class="mark"><span class="holm">HOLM</span><span class="graphics">Graphics</span></div>
    <div class="eyebrow">${esc(p.eyebrow)}</div>
    <div class="headline" style="font-size:${headlineSize(lines.length)}px">${lines.map(esc).join('<br>')}</div>
    <div class="rule"></div>
    ${p.bullets
      ? `<ul class="bullets">${p.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`
      : `<div class="body">${esc(p.body)}</div>`}
    <div class="band"><div class="url">holmgraphics.ca/election</div><div class="sub">EVERY PRICE IS ON THE PAGE</div></div>
  </div>`;
}

function countHtml(p) {
  return `
  <div class="cbox"><span class="holm">HOLM</span><span class="graphics">Graphics</span></div>
  <div class="big">${esc(p.number)}</div>
  <div class="caption">${esc(p.caption)}</div>
  <div class="cbody">${esc(p.body)}</div>
  <div class="hair"></div>
  <div class="curl">holmgraphics.ca/election</div>`;
}

// THE PHOTO LAYOUT. Same red band and same wordmark as the drawn posts, so a
// photograph sits in the run rather than looking like a different campaign.
// The scrim is what makes the headline legible over a picture that was never
// composed for type: without it the words land on whatever happens to be
// behind them and half of them disappear.
function photoHtml(p) {
  const lines = p.headline.split('|');
  return `
  <div class="photo" style="background-image:url('${esc(p.file)}'); background-position:${esc(p.focus || '50% 50%')}"></div>
  <div class="scrim"></div>
  <div class="pmark"><span class="holm">HOLM</span><span class="graphics">Graphics</span></div>
  <div class="pcopy">
    <div class="peyebrow">${esc(p.eyebrow)}</div>
    <div class="pheadline" style="font-size:${lines.length >= 3 ? 68 : 84}px">${lines.map(esc).join('<br>')}</div>
  </div>
  <div class="band"><div class="url">holmgraphics.ca/election</div><div class="sub">EVERY PRICE IS ON THE PAGE</div></div>`;
}

// THE DARK LAYOUT: no card, no band. Used for the few posts that are not
// selling anything — the holiday note, the weekend one — where a price rail
// along the bottom would be the wrong register.
function darkHtml(p) {
  return `
  <div class="cbox"><span class="holm">HOLM</span><span class="graphics">Graphics</span></div>
  <div class="dhead">${p.headline.split('|').map(esc).join('<br>')}</div>
  <div class="dbody">${esc(p.body)}</div>
  <div class="durl">holmgraphics.ca/election</div>`;
}

const page = (p) => `<!doctype html><meta charset="utf-8"><style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body { width:1080px; height:1080px; overflow:hidden; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    ${p.layout === 'countdown'
      ? `background:${M.redBg}; text-align:center;`
      : p.layout === 'photo'
      ? `background:${M.bg};`
      : p.layout === 'dark'
      ? `background:${M.darkBg}; text-align:center;`
      : `background: repeating-linear-gradient(90deg, ${M.stripe} 0 ${M.stripeWidth}px, ${M.bg} ${M.stripeWidth}px ${M.stripePeriod}px);`}
  }
  .holm     { display:block; font-family:'Arial Black',Arial,sans-serif; color:${M.redLogo}; line-height:.95; }
  .graphics { display:block; font-family:'Arial Black',Arial,sans-serif; color:${M.inkSoft}; line-height:.95; }

  /* ---- the sign card ---- */
  .card {
    position:absolute; left:50%; top:50%;
    width:${M.cardW}px; height:${p.bullets ? M.cardHBullets : M.cardH}px;
    transform: translate(-50%,-50%) rotate(${M.cardTilt}deg);
    background:#fff; border-radius:14px; box-shadow:0 18px 50px rgba(0,0,0,.45);
    padding:42px 70px 0; overflow:hidden;
  }
  .card .holm     { font-size:74px; letter-spacing:.01em; }
  .card .graphics { font-size:64px; letter-spacing:-.005em; }
  .eyebrow  { margin-top:25px; font-size:21px; font-weight:700; color:${M.red}; letter-spacing:.32em; }
  .headline { margin-top:16px; font-weight:700; color:${M.ink}; line-height:.96; letter-spacing:-.015em; }
  .rule     { margin-top:24px; width:132px; height:6px; background:${M.red}; }
  .body     { margin-top:20px; font-size:27px; color:${M.body}; line-height:1.35; max-width:700px; }
  .band {
    position:absolute; left:0; right:0; bottom:0; height:${M.bandH}px; background:${M.red};
    display:flex; flex-direction:column; align-items:center; justify-content:center; gap:6px;
  }
  .url { font-size:46px; font-weight:700; color:#fff; }
  .sub { font-size:20px; color:rgba(255,255,255,.92); letter-spacing:.22em; }

  /* ---- the countdown ---- */
  .cbox {
    position:absolute; left:50%; top:188px; transform:translateX(-50%);
    width:262px; height:123px; background:#fff; border-radius:6px;
    display:flex; flex-direction:column; align-items:center; justify-content:center;
  }
  .cbox .holm     { font-size:52px; letter-spacing:.01em; }
  .cbox .graphics { font-size:50px; }
  .big     { position:absolute; top:364px; left:0; right:0; font-family:'Arial Black',Arial,sans-serif;
             font-size:384px; line-height:275px; color:#fff; }
  .caption { position:absolute; top:672px; left:0; right:0; font-size:28px; color:rgba(255,255,255,.92); letter-spacing:.25em; }
  .cbody   { position:absolute; top:738px; left:0; right:0; font-size:32px; font-weight:700; color:#fff; }
  .hair    { position:absolute; top:823px; left:50%; transform:translateX(-50%); width:408px; height:2px; background:rgba(255,255,255,.45); }
  .curl    { position:absolute; top:854px; left:0; right:0; font-size:32px; font-weight:700; color:#fff; }

  /* A list instead of a sentence, on the posts that are really a menu. */
  .bullets { margin-top:26px; list-style:none; }
  .bullets li { position:relative; padding-left:34px; margin-bottom:22px;
                font-size:27px; font-weight:700; color:${M.ink}; }
  .bullets li::before { content:''; position:absolute; left:0; top:3px;
                        width:10px; height:22px; background:${M.red}; }

  /* ---- no card, no band ---- */
  .dhead { position:absolute; top:432px; left:70px; right:70px; font-size:86px; font-weight:700;
           color:#fff; line-height:1.17; letter-spacing:-.015em; }
  .dbody { position:absolute; top:678px; left:90px; right:90px; font-size:30px; color:${M.darkBody}; line-height:1.3; }
  .durl  { position:absolute; top:776px; left:0; right:0; font-size:30px; font-weight:700; color:${M.darkUrl}; }

  /* ---- the photograph ---- */
  .photo  { position:absolute; inset:0; background-size:cover; background-repeat:no-repeat; }
  .scrim  { position:absolute; inset:0;
            background:linear-gradient(to bottom, rgba(0,0,0,.55) 0, rgba(0,0,0,.10) 26%,
                                                  rgba(0,0,0,.28) 52%, rgba(0,0,0,.86) 82%); }
  .pmark  { position:absolute; top:56px; left:64px; background:#fff; border-radius:8px; padding:16px 22px 18px; }
  .pmark .holm     { font-size:40px; letter-spacing:.01em; }
  .pmark .graphics { font-size:38px; }
  .pcopy  { position:absolute; left:64px; right:64px; bottom:205px; }
  .peyebrow  { font-size:22px; font-weight:700; color:#fff; letter-spacing:.32em; margin-bottom:16px;
               text-shadow:0 2px 10px rgba(0,0,0,.6); }
  .pheadline { font-weight:700; color:#fff; line-height:1.02; letter-spacing:-.015em;
               text-shadow:0 3px 18px rgba(0,0,0,.65); }
</style>${p.layout === 'countdown' ? countHtml(p) : p.layout === 'photo' ? photoHtml(p) : p.layout === 'dark' ? darkHtml(p) : cardHtml(p)}`;

const only = process.argv[2];
const jobs = Object.entries(ART).filter(([date]) => !only || date === only);
if (!jobs.length) { console.error(`nothing in the spec for ${only}`); process.exit(1); }

const tmp = mkdtempSync(join(tmpdir(), 'hgpost-'));
try {
  for (const [date, p] of jobs) {
    if (p.layout === 'photo') {
      const src = isAbsolute(p.source) ? p.source : resolve(HERE, '..', p.source);
      p.file = basename(src);
      copyFileSync(src, join(tmp, p.file));   // beside the page, so Chrome will load it
    }
    const html = join(tmp, `${date}.html`);
    const shot = join(tmp, `${date}.png`);
    writeFileSync(html, page(p), 'utf8');
    execFileSync(CHROME, [
      '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
      '--force-device-scale-factor=1', '--window-size=1080,1080',
      `--screenshot=${shot}`, pathToFileURL(html).href,
    ], { stdio: 'ignore' });
    copyFileSync(shot, join(OUT, p.image));
    console.log(`redrew  ${date}  ${p.image}`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
