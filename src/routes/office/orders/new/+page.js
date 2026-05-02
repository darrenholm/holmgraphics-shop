// Office order entry page -- staff-only, fully client-side. The page
// reads the dtfCart from localStorage on mount and posts to
// /api/orders/office on submit; nothing is rendered server-side.
export const prerender = false;
export const ssr = false;
