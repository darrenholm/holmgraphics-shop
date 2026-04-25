// functions/_middleware.js
//
// Cloudflare Pages Function that runs on every request to this project.
// We deploy ONE Pages project that serves two hostnames:
//
//   • holmgraphics.ca (apex)         → public marketing + customer DTF shop
//   • shop.holmgraphics.ca (subdomain) → staff app (jobs, dashboard, admin, …)
//
// Both build outputs are identical (same SvelteKit SPA + same static
// marketing pages). This middleware enforces a clean URL split:
//
//   - Staff paths hit on the apex   → 301 to the subdomain
//   - Marketing paths hit on subdomain → 301 to the apex
//   - www.holmgraphics.ca           → 301 to apex (canonical)
//
// Static asset requests (`/_app/*`, images, CSS, the SvelteKit shell)
// pass straight through, because they're needed on both hostnames.

const APEX_HOST     = 'holmgraphics.ca';
const APEX_WWW_HOST = 'www.holmgraphics.ca';
const STAFF_HOST    = 'shop.holmgraphics.ca';

// Paths that should ONLY ever be served from the staff subdomain.
// Matched as exact OR with trailing path segment (e.g. `/jobs/42`).
// `/admin-legacy` covers the static HTML utilities we moved off the
// public marketing site.
const STAFF_PATH_PREFIXES = [
  '/dashboard',
  '/jobs',
  '/clients',
  '/admin',
  '/admin-legacy',
  '/upload',
  '/profile',
  '/login',
];

// Marketing pages that should ONLY live at the apex. Listed as both
// the clean URL (Cloudflare's auto-extension matching) and the explicit
// `.html` form so deep links keep working.
const MARKETING_PATHS = new Set([
  '/home',       '/home.html',
  '/about',      '/about.html',
  '/signs',      '/signs.html',
  '/vehicles',   '/vehicles.html',
  '/apparel',    '/apparel.html',
  '/printing',   '/printing.html',
  '/gallery',    '/gallery.html',
  '/facilities', '/facilities.html',
  '/privacy',    '/privacy.html',
  '/terms',      '/terms.html',
]);

function matchesStaffPath(pathname) {
  return STAFF_PATH_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + '/')
  );
}

function isMarketingPath(pathname) {
  return MARKETING_PATHS.has(pathname);
}

export async function onRequest(context) {
  const url  = new URL(context.request.url);
  const host = url.hostname;
  const path = url.pathname;

  // 1. Canonicalize www → apex.
  if (host === APEX_WWW_HOST) {
    return Response.redirect(
      `https://${APEX_HOST}${path}${url.search}`,
      301
    );
  }

  // 2. Apex domain: bounce staff paths to the subdomain.
  if (host === APEX_HOST && matchesStaffPath(path)) {
    return Response.redirect(
      `https://${STAFF_HOST}${path}${url.search}`,
      301
    );
  }

  // 3. Staff subdomain: bounce marketing pages to the apex.
  if (host === STAFF_HOST && isMarketingPath(path)) {
    return Response.redirect(
      `https://${APEX_HOST}${path}${url.search}`,
      301
    );
  }

  // 4. Everything else (SvelteKit SPA, /shop/*, /_app/*, images, etc.)
  //    falls through to the static asset handler.
  return context.next();
}
