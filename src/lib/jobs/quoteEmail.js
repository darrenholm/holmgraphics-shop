// src/lib/jobs/quoteEmail.js
//
// Parses a pasted quote-request email into the fields the New Job form
// needs. Staff copy the whole email out of Outlook (Ctrl+A, Ctrl+C) and
// paste it into /jobs/from-email — no mail-server integration required.
//
// Three shapes show up in the inbox and all three are handled:
//
//   1. holmgraphics.ca quote form  — "New quote request from <name>",
//      then a two-column table (Name / Company / Email / Phone / Service /
//      Details). Pasting an HTML table as text turns the columns into
//      tabs, runs of spaces, or a label line followed by a value line,
//      depending on the mail client — so all three separators are read.
//   2. Shop cart quote request     — the mailto: body built by
//      /shop/quote (`Name:` / `Email:` / ... plus ITEMS + NOTES blocks).
//   3. Anything else               — a customer typing a plain email. We
//      fall back to scraping the first address / phone number out of the
//      body and treat the rest as the job details.
//
// Nothing here touches the network: parse → staff review → create.

// Labels we understand, mapped onto the field they fill. Order matters
// only for the multi-line capture below (see BLOCK_FIELDS).
const LABELS = [
  [/^name$/i,                       'name'],
  [/^(?:full\s*)?name$/i,           'name'],
  [/^contact(?:\s*name)?$/i,        'name'],
  [/^company(?:\s*name)?$/i,        'company'],
  [/^business(?:\s*name)?$/i,       'company'],
  [/^organization$/i,               'company'],
  [/^e-?mail(?:\s*address)?$/i,     'email'],
  [/^phone(?:\s*(?:number|#))?$/i,  'phone'],
  [/^telephone$/i,                  'phone'],
  [/^cell(?:\s*phone)?$/i,          'phone'],
  [/^mobile$/i,                     'phone'],
  [/^service(?:\s*(?:needed|type|required))?$/i, 'service'],
  [/^job\s*type$/i,                 'service'],
  [/^interested\s*in$/i,            'service'],
  [/^need(?:ed)?\s*by$/i,           'needBy'],
  [/^due(?:\s*date)?$/i,            'needBy'],
  [/^deadline$/i,                   'needBy'],
  [/^details?$/i,                   'details'],
  [/^message$/i,                    'details'],
  [/^notes?$/i,                     'details'],
  [/^comments?$/i,                  'details'],
  [/^description$/i,                'details'],
];

// Fields whose value can run over several lines — keep swallowing lines
// until the next label or a footer marker.
const BLOCK_FIELDS = new Set(['details']);

// Lines that mean "the customer's content has ended" — our own email
// signature, the quote-form footer, Outlook's reply separator.
const FOOTER = [
  /^sent from the/i,
  /^holm graphics inc/i,
  /^questions\?/i,
  /^--\s*$/,                 // conventional signature separator
  /^_{3,}\s*$/,
  /^from:\s/i,               // start of a quoted/forwarded message
  /^on .*wrote:$/i,
  /^this (?:e-?mail|message)/i,
  /^unsubscribe\b/i,
];

// Mail headers at the top of a pasted message — never content, but they
// also don't mean the content has ended.
const HEADER_RE = /^(?:subject|from|to|cc|bcc|sent|date|reply-to)\s*:/i;

// "-----" / "=====" underlines the cart email draws under its section
// titles. Noise, but they must not break a details block in half.
const RULE_RE = /^[-=_*~]{3,}$/;

// Addresses that are never the customer's — they're ours, or the mailer's.
const OUR_DOMAINS = /@(?:holmgraphics\.ca|holmdalerodeo\.ca|walkertonlive\.ca)$/i;

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
// North-American numbers as customers type them: 5198818085, 519-881-8085,
// (519) 881-8085, +1 519 881 8085, with an optional extension.
const PHONE_RE =
  /(?:\+?1[\s.-]?)?\(?\b[2-9]\d{2}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b(?:\s*(?:x|ext\.?|extension)\s*\d{1,6})?/i;

function normalize(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')                    // NBSP — very common in HTML paste
    .replace(/[\u200b-\u200d\ufeff]/g, '');    // zero-width junk
}

function isFooter(line) {
  return FOOTER.some((re) => re.test(line.trim()));
}

// "Name<tab>Todd", "Name:  Todd", "Name     Todd" (pasted table column) all
// split into ['Name', 'Todd']. A bare "Name" line returns ['Name', ''] so
// the caller can pull the value off the following line.
function splitLabel(line) {
  const m = line.match(/^\s*([A-Za-z][A-Za-z /#'-]{1,28})\s*(?::|\t|\s{2,})\s*(.*)$/);
  if (m) return [m[1].trim(), m[2].trim()];
  const bare = line.match(/^\s*([A-Za-z][A-Za-z /#'-]{1,28})\s*:?\s*$/);
  if (bare) return [bare[1].trim(), ''];
  return null;
}

function fieldFor(label) {
  for (const [re, field] of LABELS) if (re.test(label)) return field;
  return null;
}

// Digits-only 10-digit numbers come out of web forms unformatted; make them
// readable so the job's contact card doesn't show "5198818085".
export function formatPhone(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  const extMatch = raw.match(/(?:x|ext\.?|extension)\s*(\d{1,6})/i);
  let digits = raw.replace(/\D/g, '');
  if (extMatch) digits = digits.slice(0, digits.length - extMatch[1].length);
  if (digits.length === 11 && digits[0] === '1') digits = digits.slice(1);
  if (digits.length !== 10) return raw;
  const pretty = `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  return extMatch ? `${pretty} ext ${extMatch[1]}` : pretty;
}

// "Todd & Karen Konecny" → { first: 'Todd & Karen', last: 'Konecny' }.
// Last word wins as the surname; a single word becomes the last name so
// the client record is searchable the way staff look people up.
export function splitName(input) {
  const parts = String(input || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: '', last: '' };
  if (parts.length === 1) return { first: '', last: parts[0] };
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
}

export function parseQuoteEmail(text) {
  const body = normalize(text);
  const lines = body.split('\n');
  const out = {
    name: '', company: '', email: '', phone: '',
    service: '', needBy: '', details: '', subject: '',
    raw: body.trim(),
  };

  // Subject line — either a real "Subject:" header or the quote form's
  // "New quote request from <name>" heading, which also gives us a name.
  for (const line of lines.slice(0, 12)) {
    const s = line.trim();
    let m = s.match(/^subject:\s*(.+)$/i);
    if (m) { out.subject = m[1].trim(); continue; }
    m = s.match(/^new quote request(?:\s+from\s+(.+))?$/i);
    if (m) {
      out.subject = out.subject || s;
      if (m[1] && !out.name) out.name = m[1].trim();
    }
  }
  if (!out.subject) {
    const m = out.raw.match(/^new quote request from\s+(.+)$/im);
    if (m) out.subject = m[0].trim();
  }

  const detailLines = [];
  let block = null;   // the block field currently swallowing lines

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (isFooter(trimmed)) { block = null; continue; }
    if (RULE_RE.test(trimmed)) continue;
    if (!trimmed) { if (block) detailLines.push(''); continue; }

    const split = splitLabel(line);
    const field = split ? fieldFor(split[0]) : null;

    if (field) {
      let value = split[1];
      // Label on its own line (table paste): the value is the next
      // non-empty line, as long as that line isn't another label.
      if (!value) {
        const next = lines.slice(i + 1).find((l) => l.trim() && !RULE_RE.test(l.trim()));
        const nextSplit = next != null ? splitLabel(next) : null;
        if (next && !isFooter(next) && !(nextSplit && fieldFor(nextSplit[0]))) {
          value = next.trim();
          i = lines.indexOf(next, i + 1);
        }
      }
      if (BLOCK_FIELDS.has(field)) {
        block = field;
        if (value) detailLines.push(value);
      } else {
        block = null;
        if (value && !out[field]) out[field] = value;
      }
      continue;
    }

    if (block === 'details') detailLines.push(trimmed);
  }

  out.details = detailLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();

  // ── Fallbacks for free-form emails ──────────────────────────────────
  if (!out.email) {
    const hits = out.raw.match(new RegExp(EMAIL_RE.source, 'g')) || [];
    out.email = hits.find((e) => !OUR_DOMAINS.test(e)) || '';
  }
  if (!out.phone) {
    const m = out.raw.match(PHONE_RE);
    if (m) out.phone = m[0];
  }
  if (!out.details) {
    // No labelled details block — treat the body (minus header-ish lines
    // and our footer) as the description so nothing the customer wrote
    // is lost.
    const kept = [];
    for (const line of lines) {
      const t = line.trim();
      // A footer only ends the message once real content has started —
      // otherwise the "From:" header at the top of a pasted email would
      // stop us before the first word.
      if (isFooter(t)) { if (kept.length) break; continue; }
      if (!t || HEADER_RE.test(t) || RULE_RE.test(t)) continue;
      const split = splitLabel(line);
      if (split && fieldFor(split[0])) continue;
      if (/^new quote request/i.test(t)) continue;
      kept.push(t);
    }
    out.details = kept.join('\n').trim();
  }

  out.phone = formatPhone(out.phone);
  out.email = out.email.trim().replace(/^mailto:/i, '');
  return out;
}

// Job Description (and therefore the L: folder suffix) suggestion. Short
// on purpose — "Job3921 - Vehicle Graphics / Wrap" has to stay readable in
// Explorer. Staff can edit it before the job is created.
export function suggestJobName(parsed, maxWords = 6) {
  const service = (parsed?.service || '').trim();
  if (service) return service.replace(/\s+/g, ' ');
  // A real subject line ("Sign replacement") describes the job better than
  // the opening words of the body — but the quote form's own subject
  // ("New quote request from ...") says nothing, so it's dropped.
  const subject = (parsed?.subject || '')
    .replace(/^subject:\s*/i, '')
    .replace(/^new quote request(?:\s+from\s+.+)?$/i, '')
    .trim();
  if (subject) return subject;
  const details = (parsed?.details || '').trim();
  if (details) {
    const firstSentence = details.split(/[.\n!?]/)[0].trim();
    const words = firstSentence.split(/\s+/).filter(Boolean).slice(0, maxWords);
    if (words.length) return words.join(' ');
  }
  return 'Quote request';
}

// Search strings to look the customer up with, most-specific first. The
// clients endpoint matches company, name and email, so one term per shot.
export function clientSearchTerms(parsed) {
  const terms = [];
  if (parsed?.email)   terms.push(parsed.email.trim());
  if (parsed?.company) terms.push(parsed.company.trim());
  if (parsed?.name) {
    const { last } = splitName(parsed.name);
    if (last) terms.push(last);
    if (parsed.name.trim() !== last) terms.push(parsed.name.trim());
  }
  return [...new Set(terms.filter((t) => t.length >= 2))];
}

// How well an existing client row matches the pasted email. Drives the
// "Existing client" banner so staff don't create a second Konecny.
export function scoreClientMatch(client, parsed) {
  const norm = (s) => String(s || '').trim().toLowerCase();
  const company = norm(client?.company_name);
  const full = norm(`${client?.first_name || ''} ${client?.last_name || ''}`);
  const email = norm(client?.email);

  if (email && email === norm(parsed?.email)) return { score: 3, why: 'Email matches' };
  if (company && company === norm(parsed?.company)) return { score: 2, why: 'Company matches' };
  if (full && full === norm(parsed?.name)) return { score: 2, why: 'Name matches' };
  const last = norm(splitName(parsed?.name).last);
  if (last && (full.includes(last) || company.includes(last))) return { score: 1, why: 'Similar name' };
  if (company && norm(parsed?.company) && (company.includes(norm(parsed.company)) || norm(parsed.company).includes(company))) {
    return { score: 1, why: 'Similar company' };
  }
  return { score: 0, why: '' };
}
