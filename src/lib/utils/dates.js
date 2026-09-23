// Postgres DATE columns (due_date, created_date) come back from the API as
// "YYYY-MM-DDT00:00:00.000Z" — UTC midnight. new Date() on that renders the
// evening before in Ontario, so every date shows a day early. Treat a
// midnight-UTC value (or a bare YYYY-MM-DD) as a calendar date and build it
// at local noon instead. Real timestamps pass through untouched.
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})(T00:00:00(\.0+)?Z)?$/;

export function toLocalDate(d) {
  if (d == null || d === '') return null;
  if (typeof d === 'string') {
    const m = d.match(DATE_ONLY);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], 12);
  }
  return new Date(d);
}
