#!/usr/bin/env node
//
// Hand the whole election run to Facebook in one go.
//
// Facebook will schedule a post itself — ten minutes to six months ahead — so
// there is nothing to keep running afterwards. This pushes all fifty at once
// and Facebook publishes them on their dates whether or not anybody is at a
// desk. Run it once.
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

const MIN_AHEAD = 10 * 60;      // Facebook's own floor
const MAX_AHEAD = 180 * 86400;  // and its ceiling, six months

function check() {
  const now = Math.floor(Date.now() / 1000);
  const problems = [];
  for (const p of POSTS) {
    const t = when(p);
    if (Number.isNaN(t)) problems.push(`${p.date}: cannot read the date or time`);
    else if (t - now < MIN_AHEAD) problems.push(`${p.date} ${p.time}: in the past, or too soon — Facebook needs ten minutes' notice`);
    else if (t - now > MAX_AHEAD) problems.push(`${p.date}: more than six months out`);
    if (!p.message?.trim()) problems.push(`${p.date}: no text`);
  }
  return problems;
}

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

const problems = check();
if (problems.length) {
  console.error('Not sending. Fix these first:\n  ' + problems.join('\n  '));
  process.exit(1);
}

if (!LIVE) {
  console.log(`${POSTS.length} posts ready. This is a rehearsal — nothing will be sent.\n`);
  for (const p of POSTS) {
    console.log(`${p.date} ${p.time}  ${IMAGE_BASE}/${p.image}`);
    console.log(`  ${p.message.split('\n')[0].slice(0, 78)}…\n`);
  }
  console.log('Add --live (with FB_PAGE_ID and FB_PAGE_TOKEN set) to schedule them for real.');
  process.exit(0);
}

if (!PAGE_ID || !TOKEN) {
  console.error('FB_PAGE_ID and FB_PAGE_TOKEN have to be set to send anything.');
  process.exit(1);
}

let done = 0;
for (const p of POSTS) {
  try {
    const id = await schedule(p);
    done++;
    console.log(`scheduled  ${p.date} ${p.time}  ${id}`);
  } catch (e) {
    // Keep going: one rejected post should not strand the other forty-nine,
    // and the ones already scheduled stay scheduled.
    console.error(`FAILED     ${p.date} ${p.time}  ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 400)); // stay well under the rate limit
}
console.log(`\n${done} of ${POSTS.length} scheduled. Check them in Meta Business Suite → Planner.`);
