// Dynamic route — can't prerender (depends on supplier + style params
// that live in the database). Adapter-static fallback (index.html)
// serves the SPA shell and the component fetches the product client-side.
export const prerender = false;
export const ssr = false;
