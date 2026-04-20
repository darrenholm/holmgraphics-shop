import { c as create_ssr_component, a as subscribe, e as escape, d as add_attribute } from "../../../chunks/ssr.js";
import { a as auth, i as isStaff } from "../../../chunks/auth.js";
const _page_svelte_svelte_type_style_lang = "";
const css = {
  code: ".page.svelte-hcqs9.svelte-hcqs9{padding:28px 32px;min-height:100vh}.top-bar.svelte-hcqs9.svelte-hcqs9{display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;gap:16px;flex-wrap:wrap}.top-bar-left.svelte-hcqs9.svelte-hcqs9{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.top-bar-right.svelte-hcqs9.svelte-hcqs9{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.page-title.svelte-hcqs9.svelte-hcqs9{font-family:var(--font-display);font-size:1.8rem;font-weight:900;letter-spacing:0.04em;text-transform:uppercase;color:var(--text)}.overdue-pill.svelte-hcqs9.svelte-hcqs9{background:rgba(192,57,43,0.15);border:1px solid rgba(192,57,43,0.4);color:#dc2626;font-family:var(--font-display);font-size:0.78rem;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;padding:4px 10px;border-radius:20px;cursor:pointer;animation:svelte-hcqs9-pulse 2s ease-in-out infinite}@keyframes svelte-hcqs9-pulse{0%,100%{opacity:1}50%{opacity:0.65}}.toggle-group.svelte-hcqs9.svelte-hcqs9{display:flex;background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden}.toggle-btn.svelte-hcqs9.svelte-hcqs9{padding:7px 16px;background:none;border:none;cursor:pointer;font-family:var(--font-display);font-size:0.85rem;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:var(--text-muted);transition:all 0.15s}.toggle-btn.active.svelte-hcqs9.svelte-hcqs9{background:var(--red);color:#fff}.search-wrap.svelte-hcqs9.svelte-hcqs9{position:relative}.search-icon.svelte-hcqs9.svelte-hcqs9{position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--text-dim);pointer-events:none}.search-input.svelte-hcqs9.svelte-hcqs9{width:220px;padding:8px 12px 8px 32px;background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius);color:var(--text);font-size:0.88rem}.search-input-client.svelte-hcqs9.svelte-hcqs9{width:200px}.btn-sm.svelte-hcqs9.svelte-hcqs9{padding:7px 12px;font-size:0.82rem}.client-search-inline.svelte-hcqs9.svelte-hcqs9{display:flex;align-items:center;gap:6px}.client-results-bar.svelte-hcqs9.svelte-hcqs9{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);padding:16px 20px;margin-bottom:20px}.client-results-header.svelte-hcqs9.svelte-hcqs9{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}.results-count.svelte-hcqs9.svelte-hcqs9{font-size:0.85rem;color:var(--text-muted);font-family:var(--font-display);letter-spacing:0.04em}.board.svelte-hcqs9.svelte-hcqs9{display:grid;grid-template-columns:repeat(4, 1fr);gap:16px;align-items:start}.column.svelte-hcqs9.svelte-hcqs9{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);overflow:hidden}.column-header.svelte-hcqs9.svelte-hcqs9{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid var(--border);background:var(--surface-2)}.col-count.svelte-hcqs9.svelte-hcqs9{font-family:var(--font-display);font-size:0.85rem;color:var(--text-muted);font-weight:700}.job-list.svelte-hcqs9.svelte-hcqs9{padding:10px;display:flex;flex-direction:column;gap:8px;min-height:60px}.job-card.svelte-hcqs9.svelte-hcqs9{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:12px 14px;cursor:pointer;text-align:left;width:100%;transition:all 0.15s;display:flex;flex-direction:column;gap:4px;position:relative;overflow:hidden}.job-card.svelte-hcqs9.svelte-hcqs9::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--border-mid);transition:background 0.15s}.job-card.svelte-hcqs9.svelte-hcqs9:hover{border-color:var(--red);transform:translateY(-1px);box-shadow:var(--shadow)}.job-card.svelte-hcqs9.svelte-hcqs9:hover::before{background:var(--red)}.job-card.is-overdue.svelte-hcqs9.svelte-hcqs9{border-color:rgba(192,57,43,0.4)}.job-card.is-overdue.svelte-hcqs9.svelte-hcqs9::before{background:var(--red)}.job-card-top.svelte-hcqs9.svelte-hcqs9{display:flex;justify-content:space-between;align-items:center}.job-id.svelte-hcqs9.svelte-hcqs9{font-family:var(--font-display);font-size:0.72rem;color:var(--text-dim);letter-spacing:0.05em}.job-name.svelte-hcqs9.svelte-hcqs9{font-family:var(--font-display);font-weight:700;font-size:0.95rem;color:var(--text);line-height:1.2}.job-client.svelte-hcqs9.svelte-hcqs9{font-size:0.8rem;color:var(--text-muted)}.job-footer.svelte-hcqs9.svelte-hcqs9{display:flex;justify-content:space-between;align-items:center;margin-top:2px}.job-type.svelte-hcqs9.svelte-hcqs9{font-size:0.72rem;color:var(--text-dim);font-style:italic}.job-assigned.svelte-hcqs9.svelte-hcqs9{font-size:0.72rem;color:var(--text-muted)}.job-due.svelte-hcqs9.svelte-hcqs9{font-family:var(--font-display);font-size:0.72rem;color:var(--text-dim)}.job-due.due-hot.svelte-hcqs9.svelte-hcqs9{color:#dc2626;font-weight:700}.empty-col.svelte-hcqs9.svelte-hcqs9{text-align:center;padding:24px 0;color:var(--text-dim);font-size:0.82rem;font-style:italic}.results-table.svelte-hcqs9.svelte-hcqs9{width:100%;border-collapse:collapse}.results-table.svelte-hcqs9 th.svelte-hcqs9{text-align:left;padding:8px 12px;font-family:var(--font-display);font-size:0.75rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);border-bottom:2px solid var(--border);background:var(--surface-2)}.results-table.svelte-hcqs9 td.svelte-hcqs9{padding:10px 12px;border-bottom:1px solid var(--border);font-size:0.9rem;color:var(--text)}.result-row.svelte-hcqs9.svelte-hcqs9{cursor:pointer;transition:background 0.12s}.result-row.svelte-hcqs9:hover td.svelte-hcqs9{background:var(--surface-2)}.job-id-cell.svelte-hcqs9.svelte-hcqs9{font-family:var(--font-display);font-size:0.8rem;color:var(--text-dim)}.job-name-cell.svelte-hcqs9.svelte-hcqs9{font-weight:600}.text-muted.svelte-hcqs9.svelte-hcqs9{color:var(--text-muted) !important}.due-hot.svelte-hcqs9.svelte-hcqs9{color:#dc2626 !important;font-weight:600}.empty-msg.svelte-hcqs9.svelte-hcqs9{color:var(--text-dim);font-style:italic;padding:16px 0}.loading-state.svelte-hcqs9.svelte-hcqs9,.error-state.svelte-hcqs9.svelte-hcqs9{display:flex;align-items:center;gap:12px;padding:48px;color:var(--text-muted);font-size:0.9rem}.loading-spinner.svelte-hcqs9.svelte-hcqs9{width:20px;height:20px;border:2px solid var(--border);border-top-color:var(--red);border-radius:50%;animation:svelte-hcqs9-spin 0.8s linear infinite}@keyframes svelte-hcqs9-spin{to{transform:rotate(360deg)}}@media(max-width: 900px){.board.svelte-hcqs9.svelte-hcqs9{grid-template-columns:repeat(2, 1fr)}}@media(max-width: 600px){.page.svelte-hcqs9.svelte-hcqs9{padding:12px}.board.svelte-hcqs9.svelte-hcqs9{grid-template-columns:1fr}.search-input.svelte-hcqs9.svelte-hcqs9{width:160px}.search-input-client.svelte-hcqs9.svelte-hcqs9{width:150px}.job-card.svelte-hcqs9.svelte-hcqs9{padding:14px 16px}.job-id.svelte-hcqs9.svelte-hcqs9{font-size:0.85rem}.job-name.svelte-hcqs9.svelte-hcqs9{font-size:1.1rem}.job-client.svelte-hcqs9.svelte-hcqs9{font-size:0.95rem}.job-type.svelte-hcqs9.svelte-hcqs9{font-size:0.85rem}.job-assigned.svelte-hcqs9.svelte-hcqs9{font-size:0.85rem}.job-due.svelte-hcqs9.svelte-hcqs9{font-size:0.85rem}.badge.svelte-hcqs9.svelte-hcqs9{font-size:0.8rem !important;padding:3px 9px !important}.page-title.svelte-hcqs9.svelte-hcqs9{font-size:1.4rem}}",
  map: null
};
function isOverdue(p) {
  if (!p.due_date)
    return false;
  const s = (p.status_name || "").toLowerCase();
  if (s.includes("complete") || s.includes("pickup") || s.includes("delivery") || s.includes("billing"))
    return false;
  return new Date(p.due_date) < /* @__PURE__ */ new Date();
}
function columnFor(p) {
  const s = (p.status_name || "").toLowerCase();
  if (s === "quote")
    return null;
  if (s.includes("complete") || s.includes("done"))
    return null;
  if (isOverdue(p))
    return "active";
  if (s.includes("pickup") || s.includes("delivery") || s.includes("billing"))
    return "pickup";
  if (s.includes("awaiting production") || s.includes("production") || s.includes("finish"))
    return "pending";
  if (s.includes("design") || s.includes("proof") || s.includes("order material"))
    return "active";
  if (s.includes("order") || s.includes("service"))
    return "new";
  return null;
}
const Page = create_ssr_component(($$result, $$props, $$bindings, slots) => {
  let filtered;
  let overdueCount;
  let $$unsubscribe_auth;
  let $isStaff, $$unsubscribe_isStaff;
  $$unsubscribe_auth = subscribe(auth, (value) => value);
  $$unsubscribe_isStaff = subscribe(isStaff, (value) => $isStaff = value);
  let projects = [];
  let searchQuery = "";
  const STATUS_COLUMNS = [
    {
      key: "new",
      label: "New",
      cls: "badge-new"
    },
    {
      key: "active",
      label: "Prepress",
      cls: "badge-active"
    },
    {
      key: "pending",
      label: "Production",
      cls: "badge-pending"
    },
    {
      key: "pickup",
      label: "Complete",
      cls: "badge-complete"
    }
  ];
  $$result.css.add(css);
  filtered = projects.filter((p) => {
    const q = searchQuery.toLowerCase();
    if (q && !p.project_name?.toLowerCase().includes(q) && !p.client_name?.toLowerCase().includes(q))
      return false;
    return true;
  });
  STATUS_COLUMNS.map((col) => ({
    ...col,
    jobs: filtered.filter((p) => columnFor(p) === col.key)
  }));
  overdueCount = projects.filter(isOverdue).length;
  $$unsubscribe_auth();
  $$unsubscribe_isStaff();
  return `  ${$$result.head += `<!-- HEAD_svelte-almsov_START -->${$$result.title = `<title>Job Board — Holm Graphics</title>`, ""}<!-- HEAD_svelte-almsov_END -->`, ""} <div class="page svelte-hcqs9"><header class="top-bar svelte-hcqs9"><div class="top-bar-left svelte-hcqs9"><h1 class="page-title svelte-hcqs9" data-svelte-h="svelte-i4cns0">Job Board</h1> ${overdueCount > 0 ? `<button class="overdue-pill svelte-hcqs9">⚠ ${escape(overdueCount)} overdue</button>` : ``} <div class="toggle-group svelte-hcqs9"><button class="${["toggle-btn svelte-hcqs9", "active"].join(" ").trim()}" data-svelte-h="svelte-1wpikql">All Jobs</button> <button class="${["toggle-btn svelte-hcqs9", ""].join(" ").trim()}" data-svelte-h="svelte-172gjl4">My Jobs</button></div></div> <div class="top-bar-right svelte-hcqs9"> ${`<button class="btn btn-ghost btn-sm svelte-hcqs9" title="Search all jobs by client" data-svelte-h="svelte-1ae35dy"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          Client Search</button>`} <div class="search-wrap svelte-hcqs9"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="search-icon svelte-hcqs9"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg> <input class="search-input svelte-hcqs9" placeholder="Search active jobs…"${add_attribute("value", searchQuery, 0)}></div> ${$isStaff ? `<a href="/jobs/new" class="btn btn-primary" data-svelte-h="svelte-zc9e4k">+ New Job</a>` : ``}</div></header>  ${``} ${`<div class="loading-state svelte-hcqs9" data-svelte-h="svelte-wrwg2k"><div class="loading-spinner svelte-hcqs9"></div><span>Loading jobs…</span></div>`} </div>`;
});
export {
  Page as default
};
