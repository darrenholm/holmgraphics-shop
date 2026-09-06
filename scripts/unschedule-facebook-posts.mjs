#!/usr/bin/env node
//
// Clear the scheduled election posts off the Page.
//
//   node scripts/unschedule-facebook-posts.mjs          # rehearsal, deletes nothing
//   node scripts/unschedule-facebook-posts.mjs --live   # actually deletes
//
// Needed because Facebook copies the image when it accepts a post. Correcting
// a picture on the site does not reach a post already scheduled — the only way
// to change one is to delete it and send it again.
//
// IT ONLY EVER TOUCHES SCHEDULED, UNPUBLISHED POSTS. The /scheduled_posts edge
// returns nothing that has gone out, so there is no path from here to deleting
// something the public has already seen. It still rehearses by default, and
// still makes you type --live, because "delete everything on the Page" is not
// a command that should work by accident.

const GRAPH = `https://graph.facebook.com/${process.env.FB_GRAPH_VERSION || 'v21.0'}`;
const LIVE = process.argv.includes('--live');
const PAGE_ID = process.env.FB_PAGE_ID;
const TOKEN = process.env.FB_PAGE_TOKEN;

if (!PAGE_ID || !TOKEN) {
  console.error('FB_PAGE_ID and FB_PAGE_TOKEN have to be set.');
  process.exit(1);
}

const stamp = (t) => new Date(t * 1000).toLocaleString('en-CA', {
  timeZone: 'America/Toronto', dateStyle: 'medium', timeStyle: 'short',
});

async function scheduled() {
  const out = [];
  let url = `${GRAPH}/${PAGE_ID}/scheduled_posts?fields=id,scheduled_publish_time&limit=100&access_token=${encodeURIComponent(TOKEN)}`;
  while (url) {
    const res = await fetch(url);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const e = data?.error;
      throw new Error(e?.message || `HTTP ${res.status}`);
    }
    out.push(...(data?.data ?? []));
    url = data?.paging?.next ?? null;
  }
  return out.sort((a, b) => a.scheduled_publish_time - b.scheduled_publish_time);
}

const posts = await scheduled();
if (!posts.length) { console.log('Nothing scheduled on the Page.'); process.exit(0); }

console.log(`${posts.length} scheduled post${posts.length === 1 ? '' : 's'} on the Page:\n`);
for (const p of posts) console.log(`  ${stamp(p.scheduled_publish_time)}   ${p.id}`);

if (!LIVE) {
  console.log(`\nThis is a rehearsal — nothing was deleted.`);
  console.log('Add --live to delete all of the above.');
  process.exit(0);
}

let gone = 0;
for (const p of posts) {
  const res = await fetch(`${GRAPH}/${p.id}?access_token=${encodeURIComponent(TOKEN)}`, { method: 'DELETE' });
  const data = await res.json().catch(() => null);
  if (res.ok) { gone++; console.log(`deleted  ${stamp(p.scheduled_publish_time)}`); }
  else console.error(`FAILED   ${stamp(p.scheduled_publish_time)}  ${data?.error?.message || `HTTP ${res.status}`}`);
  await new Promise((r) => setTimeout(r, 300));
}
console.log(`\n${gone} of ${posts.length} deleted. Now re-run schedule-facebook-posts.mjs --live.`);
