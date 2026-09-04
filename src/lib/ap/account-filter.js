// src/lib/ap/account-filter.js
//
// Ranked substring search over the QuickBooks chart of accounts, for the
// per-line account picker on the bill review screen.
//
// A native <select> cannot do this: its type-ahead only matches from the
// first character, and accounts carry their fully-qualified name, so
// "Cost of Goods Sold:Shipping" never matched someone typing "shipping" —
// the one word they actually know the account by.
//
// Ranking exists because a plain substring match buries the obvious answer.
// Searching "shipping" in a real chart of accounts hits Shipping, Shipping
// Supplies Expense, and Freight & Shipping; the account whose own name IS
// the word is nearly always the one meant, so it sorts first.

export const MAX_SHOWN = 40;

// The account's own name, without its parents: the leaf of
// "Cost of Goods Sold:Shipping" is "shipping".
export function leafOf(name) {
  const parts = String(name || '').split(':');
  return parts[parts.length - 1].trim().toLowerCase();
}

// Lower is better. -1 means no match at all.
export function scoreAccount(name, needle) {
  const full = String(name || '').toLowerCase();
  const leaf = leafOf(name);
  if (leaf === needle)            return 0;   // "Shipping"
  if (leaf.startsWith(needle))    return 1;   // "Shipping Supplies Expense"
  if (leaf.includes(needle))      return 2;   // "Freight & Shipping"
  if (full.includes(needle))      return 3;   // matched only a parent segment
  return -1;
}

export function filterAccounts(accounts, query) {
  const list = accounts || [];
  const s = String(query || '').trim().toLowerCase();
  if (!s) return list.slice(0, MAX_SHOWN);

  const scored = [];
  for (const a of list) {
    const score = scoreAccount(a.name, s);
    if (score >= 0) scored.push({ a, score });
  }

  // Alphabetical within a rank, so the order is stable and predictable
  // rather than however QuickBooks happened to return them.
  scored.sort((x, y) => (x.score - y.score) || String(x.a.name).localeCompare(String(y.a.name)));
  return scored.slice(0, MAX_SHOWN).map((x) => x.a);
}
