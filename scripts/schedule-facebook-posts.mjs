#!/usr/bin/env node
//
// Hand the whole election run to Facebook in one go.
//
// Facebook will schedule a post itself — ten minutes to THIRTY DAYS ahead —
// so there is nothing to keep running afterwards, and it publishes on the date
// whether or not anybody is at a desk.
//
// THIRTY DAYS IS THE CEILING, and it is why this cannot be run once. Asked for
// anything further out, the Graph API answers
//
//   (#100) The specified scheduled publish time was invalid.
//
// which is what fifty-in-one-go actually got: everything inside a month went
// through, everything past it was refused. So the run is a rolling one. Each
// time it goes, it sends what has come inside the window since last time and
// says when to come back for the rest.
//
//   FB_PAGE_ID=... FB_PAGE_TOKEN=... node scripts/schedule-facebook-posts.mjs --live
//
// Without --live it prints what it would send and touches nothing. Do that
// first — a mistake here is fifty posts on a business page.
//
// THE TOKEN IS A PAGE ACCESS TOKEN, not a user one, and it never belongs in a
// file or a chat window. Export it in the shell that runs this, and close the
// shell afterwards.
//
// Where the token comes from:
//   developers.facebook.com → your app → Tools → Graph API Explorer
//   → pick the Holm Graphics page → permissions: pages_manage_posts,
//     pages_read_engagement → Generate Access Token.
//   No App Review is needed to post to a Page you administer.
//
// The images are served from the shop's own site, because Facebook fetches
// them by URL rather than accepting an upload here.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const POSTS = JSON.parse(readFileSync(join(HERE, 'election-posts.json'), 'utf8'));

const IMAGE_BASE = process.env.FB_IMAGE_BASE || 'https://shop.holmgraphics.ca/election-posts';
const GRAPH = `https://graph.facebook.com/${process.env.FB_GRAPH_VERSION || 'v21.0'}`;
const LIVE = process.argv.includes('--live');
const PAGE_ID = process.env.FB_PAGE_ID;
const TOKEN = process.env.FB_PAGE_TOKEN;

// Eastern time, which is what the shop and the election run on. Ontario is on
// daylight time (-04:00) through the whole of this campaign — it does not end
// until 1 November — so one offset covers every post.
const OFFSET = '-04:00';
const when = (p) => Math.floor(new Date(`${p.date}T${p.time}:00${OFFSET}`).getTime() / 1000);

const MIN_AHEAD = 10 * 60;     // Facebook's own floor
const MAX_AHEAD = 30 * 86400;  // and its ceiling — thirty days, measured, not
                               // guessed: 5 Oct went through at 29 days out and
                               // 6 Oct was refused at 30 days and an hour.

// SORT THE RUN INTO THREE PILES rather than refusing the lot.
//
// The first version treated a single out-of-range date as a reason to send
// nothing. With a ceiling of thirty days and a campaign of fifty, that is
// every run after the first — the posts already gone by are "in the past" and
// the far end is still "too far out", so a script that insists on all fifty
// being sendable would never send anything again.
function partition(now, alreadyScheduled) {
  const gone = [], ready = [], waiting = [], broken = [];
  for (const p of POSTS) {
    const t = when(p);
    if (Number.isNaN(t) || !p.message?.trim()) { broken.push([p, 'no date, or no text']); continue; }
    if (alreadyScheduled.has(t)) continue;              // already on the Page
    if (t - now < MIN_AHEAD) gone.push(p);              // past, or inside the ten-minute floor
    else if (t - now > MAX_AHEAD) waiting.push([p, t]); // beyond the thirty-day ceiling
    else ready.push(p);
  }
  return { gone, ready, waiting, broken };
}

// WHAT IS ALREADY UP THERE, asked of Facebook rather than remembered here.
//
// This is what stops a second run posting a second copy of everything the
// first run got through. A note kept on this machine would do it until the day
// it was run from a different one; the Page itself cannot drift. Posts are
// matched on their scheduled second, which is exactly what was sent.
//
// If the lookup itself fails we stop, rather than assume the Page is empty:
// assuming empty is how fifty duplicates happen.
async function alreadyScheduledTimes() {
  const seen = new Set();
  let url = `${GRAPH}/${PAGE_ID}/scheduled_posts?fields=scheduled_publish_time&limit=100&access_token=${encodeURIComponent(TOKEN)}`;
  while (url) {
    const res = await fetch(url);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const e = data?.error;
      throw new Error(`could not read what is already scheduled: ${e?.message || `HTTP ${res.status}`}`);
    }
    for (const post of data?.data ?? []) {
      if (post.scheduled_publish_time) seen.add(Number(post.scheduled_publish_time));
    }
    url = data?.paging?.next ?? null;
  }
  return seen;
}

const stamp = (t) => new Date(t * 1000).toLocaleString('en-CA', {
  timeZone: 'America/Toronto', dateStyle: 'medium', timeStyle: 'short',
});

async function schedule(p) {
  const body = new URLSearchParams({
    url: `${IMAGE_BASE}/${p.image}`,
    caption: p.message,
    published: 'false',
    scheduled_publish_time: String(when(p)),
    access_token: TOKEN,
  });
  const res = await fetch(`${GRAPH}/${PAGE_ID}/photos`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = data?.error;
    throw new Error(e ? `${e.message}${e.error_user_msg ? ` — ${e.error_user_msg}` : ''}` : `HTTP ${res.status}`);
  }
  return data?.id || data?.post_id || '(no id returned)';
}

const now = Math.floor(Date.now() / 1000);

// Rehearsal asks Facebook nothing, so it has no token and no idea what is
// already up there. It reports the shape of the run, which is what it is for.
const known = LIVE ? await alreadyScheduledTimes() : new Set();
const { gone, ready, waiting, broken } = partition(now, known);

if (broken.length) {
  console.error('Not sending. Fix these first:');
  for (const [p, why] of broken) console.error(`  ${p.date}: ${why}`);
  process.exit(1);
}

if (known.size) console.log(`${known.size} already scheduled on the Page — those are left alone.\n`);
if (gone.length) console.log(`${gone.length} already in the past, skipped.\n`);

function comeBack(what) {
  const soonest = Math.min(...waiting.map(([, t]) => t)) - MAX_AHEAD;
  const last    = Math.max(...waiting.map(([, t]) => t)) - MAX_AHEAD;
  console.log(`\n${waiting.length} ${what} — they are past Facebook's thirty-day ceiling.`);
  console.log(`Run this again on or after ${stamp(soonest)}; the last one can go on ${stamp(last)}.`);
  console.log('Re-running is safe: anything already on the Page is skipped.');
}

if (!LIVE) {
  console.log(`${ready.length} ready to send now. This is a rehearsal — nothing will be sent.\n`);
  for (const p of ready) {
    console.log(`${p.date} ${p.time}  ${IMAGE_BASE}/${p.image}`);
    console.log(`  ${p.message.split('\n')[0].slice(0, 78)}…\n`);
  }
  if (waiting.length) comeBack('cannot be scheduled yet');
  console.log('\nAdd --live (with FB_PAGE_ID and FB_PAGE_TOKEN set) to schedule them for real.');
  process.exit(0);
}

if (!PAGE_ID || !TOKEN) {
  console.error('FB_PAGE_ID and FB_PAGE_TOKEN have to be set to send anything.');
  process.exit(1);
}

let done = 0;
for (const p of ready) {
  try {
    const id = await schedule(p);
    done++;
    console.log(`scheduled  ${p.date} ${p.time}  ${id}`);
  } catch (e) {
    // Keep going: one rejected post should not strand the others, and the ones
    // already scheduled stay scheduled.
    console.error(`FAILED     ${p.date} ${p.time}  ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 400)); // stay well under the rate limit
}

console.log(`\n${done} of ${ready.length} scheduled. Check them in Meta Business Suite → Planner.`);
if (waiting.length) comeBack('still to go');
