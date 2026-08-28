// src/lib/pos/escpos.js
//
// ESC/POS receipt encoder for the counter thermal printer.
//
// Pure functions over a byte buffer — no Bluetooth, no Capacitor, no DOM.
// That keeps the receipt layout unit-testable and means a formatting bug can
// be reproduced without a printer on the desk.
//
// ─── The cash drawer ─────────────────────────────────────────────────────────
// The drawer is wired to the printer's RJ11 port, not to the tablet. It opens
// when the PRINTER receives ESC p — there is no separate drawer connection.
// It fires only for cash and cheque: a card sale has no cash to put away, and
// a drawer that pops on every transaction is a drawer that gets left open.

// ─── Command bytes ───────────────────────────────────────────────────────────
export const ESC = {
  INIT:          [0x1b, 0x40],
  ALIGN_LEFT:    [0x1b, 0x61, 0x00],
  ALIGN_CENTER:  [0x1b, 0x61, 0x01],
  ALIGN_RIGHT:   [0x1b, 0x61, 0x02],
  BOLD_ON:       [0x1b, 0x45, 0x01],
  BOLD_OFF:      [0x1b, 0x45, 0x00],
  // GS ! n — the low nibble is height, the high nibble is width.
  DOUBLE_ON:     [0x1d, 0x21, 0x11],
  DOUBLE_OFF:    [0x1d, 0x21, 0x00],
  FEED:          [0x0a],
  // ESC p m t1 t2 — pulse pin 2 for 25×2ms on, 250×2ms off. Pin 2 is the
  // near-universal wiring; a drawer that stays shut is almost always wired to
  // pin 5, which is 0x01 in place of the 0x00 below.
  KICK_DRAWER:   [0x1b, 0x70, 0x00, 0x19, 0xfa],
  CUT:           [0x1d, 0x56, 0x42, 0x00],
  // Codepage 0 (CP437). Everything below is transliterated to ASCII anyway;
  // this just stops a printer left on a Cyrillic page from rendering noise.
  CODEPAGE_ASCII: [0x1b, 0x74, 0x00],
};

// Characters that look fine on screen and print as garbage or nothing at all
// on a 203dpi thermal head. Mapped rather than stripped so "—" doesn't
// silently close up two words.
const TRANSLITERATE = [
  [/[‘’‛]/g, "'"],
  [/[“”]/g, '"'],
  [/[–—―]/g, '-'],
  [/[•●·]/g, '*'],
  [/…/g, '...'],
  [/ /g, ' '],
  [/[à-å]/g, 'a'], [/[è-ë]/g, 'e'],
  [/[ì-ï]/g, 'i'], [/[ò-ö]/g, 'o'],
  [/[ù-ü]/g, 'u'], [/ç/g, 'c'],
  [/[À-Å]/g, 'A'], [/[È-Ë]/g, 'E'],
  [/[Ì-Ï]/g, 'I'], [/[Ò-Ö]/g, 'O'],
  [/[Ù-Ü]/g, 'U'], [/Ç/g, 'C'],
];

export function asciify(s) {
  let out = String(s ?? '');
  for (const [re, to] of TRANSLITERATE) out = out.replace(re, to);
  // Anything still outside printable ASCII becomes a space rather than a
  // random CP437 glyph.
  return out.replace(/[^\x20-\x7e]/g, ' ');
}

// ─── Builder ─────────────────────────────────────────────────────────────────
export class Receipt {
  // `width` is the printer's character columns: 32 for a 58mm head, 48 for
  // 80mm. Wrong value means every right-aligned price lands in the wrong
  // place, so it's a setting rather than a constant.
  constructor(width = 32) {
    this.width = width;
    this.bytes = [];
    this.raw(ESC.INIT).raw(ESC.CODEPAGE_ASCII);
  }

  raw(arr) { this.bytes.push(...arr); return this; }

  text(s) {
    const clean = asciify(s);
    for (let i = 0; i < clean.length; i++) this.bytes.push(clean.charCodeAt(i));
    return this;
  }

  line(s = '') { return this.text(s).raw(ESC.FEED); }

  feed(n = 1) { for (let i = 0; i < n; i++) this.raw(ESC.FEED); return this; }

  center(s) { return this.raw(ESC.ALIGN_CENTER).line(s).raw(ESC.ALIGN_LEFT); }

  bold(s) { return this.raw(ESC.BOLD_ON).line(s).raw(ESC.BOLD_OFF); }

  big(s) {
    return this.raw(ESC.ALIGN_CENTER).raw(ESC.DOUBLE_ON)
      .line(s)
      .raw(ESC.DOUBLE_OFF).raw(ESC.ALIGN_LEFT);
  }

  rule(ch = '-') { return this.line(ch.repeat(this.width)); }

  // Label on the left, value flush right, on one line. Truncates the LABEL
  // when the pair won't fit — the number is the part nobody may misread.
  pair(label, value, { bold = false } = {}) {
    const v = asciify(value);
    const room = Math.max(0, this.width - v.length - 1);
    let l = asciify(label);
    if (l.length > room) l = l.slice(0, room);
    const gap = ' '.repeat(Math.max(1, this.width - l.length - v.length));
    if (bold) this.raw(ESC.BOLD_ON);
    this.line(`${l}${gap}${v}`);
    if (bold) this.raw(ESC.BOLD_OFF);
    return this;
  }

  // Long descriptions wrap on word boundaries rather than being cut off — a
  // job description is often the only thing telling a customer what they
  // just paid for.
  wrap(s, indent = 0) {
    const pad = ' '.repeat(indent);
    const room = this.width - indent;
    const words = asciify(s).split(/\s+/).filter(Boolean);
    let cur = '';
    for (const w of words) {
      if (!cur.length) { cur = w.length > room ? w.slice(0, room) : w; continue; }
      if (cur.length + 1 + w.length <= room) { cur += ` ${w}`; }
      else { this.line(pad + cur); cur = w.length > room ? w.slice(0, room) : w; }
    }
    if (cur.length) this.line(pad + cur);
    return this;
  }

  cut() { return this.feed(4).raw(ESC.CUT); }

  kickDrawer() { return this.raw(ESC.KICK_DRAWER); }

  toBytes() { return Uint8Array.from(this.bytes); }
}

// ─── Shop identity ───────────────────────────────────────────────────────────
// Overridable from the POS settings screen so a second counter, or a GST
// number change, doesn't need a redeploy.
export const DEFAULT_SHOP = {
  name:    'HOLM GRAPHICS INC.',
  address: ['130 Kincardine Hwy, Suite 1', 'Walkerton, ON  N0G 2V0'],
  phone:   '',
  gstNumber: '',
};

function money(cents) {
  const v = (Math.round(Number(cents) || 0) / 100).toFixed(2);
  return `$${v}`;
}

function stamp(date = new Date()) {
  // en-CA gives YYYY-MM-DD; pinning the zone keeps an evening sale on the
  // right day for the same reason the QBO write-back does.
  const d = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
  const t = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
  return `${d} ${t}`;
}

// How the payment gets named on the receipt. 'interac_present' covers ALL
// Canadian debit including co-branded cards, so it has to be checked before
// the brand — a Visa Debit tapped as Interac must not print "VISA".
export function methodLabel(payment) {
  if (payment?.payment_method_type === 'interac_present') return 'INTERAC DEBIT';
  const brand = (payment?.card_brand || '').toUpperCase().replace(/_/g, ' ');
  return brand || 'CARD';
}

// ─── Receipt layouts ─────────────────────────────────────────────────────────

/**
 * A card / debit sale receipt.
 *
 * `payment` is a terminal_payments row (plus whatever the reader handed back
 * locally). `emv` is charge.payment_method_details.*_present.receipt when the
 * webhook has landed — Stripe requires the EMV block on a card-present
 * receipt, but it arrives a second or two after the reader approves, so the
 * caller prints without it rather than making the customer wait.
 */
export function buildSaleReceipt({
  payment, shop = DEFAULT_SHOP, emv = null, width = 32,
  copy = 'customer', signatureRequired = false, jobDescription = '',
}) {
  const r = new Receipt(width);

  r.raw(ESC.ALIGN_CENTER).raw(ESC.BOLD_ON).line(shop.name).raw(ESC.BOLD_OFF);
  for (const l of shop.address || []) r.line(l);
  if (shop.phone) r.line(shop.phone);
  r.raw(ESC.ALIGN_LEFT).feed();

  r.pair('Date', stamp(payment?.created_at ? new Date(payment.created_at) : new Date()));
  if (payment?.project_id) r.pair('Job #', String(payment.project_id));
  if (payment?.client_name) r.pair('Customer', payment.client_name);
  if (payment?.taken_by)    r.pair('Served by', payment.taken_by);
  r.rule();

  const desc = jobDescription || payment?.description;
  if (desc) { r.wrap(desc); r.rule(); }

  // The counter charges a tax-inclusive total. Print the split when we have
  // it; when we don't, print the total alone rather than inventing a subtotal
  // that might not match the invoice.
  const total = payment?.amount_cents ?? 0;
  if (payment?.subtotal_cents != null && payment?.tax_cents != null) {
    r.pair('Subtotal', money(payment.subtotal_cents));
    r.pair(shop.gstNumber ? `HST (${shop.gstNumber})` : 'HST', money(payment.tax_cents));
  }
  r.feed();
  r.raw(ESC.ALIGN_CENTER).raw(ESC.DOUBLE_ON).line(`TOTAL ${money(total)}`)
   .raw(ESC.DOUBLE_OFF).raw(ESC.ALIGN_LEFT);
  r.feed();

  if (payment?.amount_refunded_cents > 0) {
    r.pair('Refunded', `-${money(payment.amount_refunded_cents)}`, { bold: true });
  }

  r.rule();
  r.pair('Method', methodLabel(payment));
  if (payment?.card_last4) r.pair('Card', `****${payment.card_last4}`);
  if (emv?.authorization_code)        r.pair('Auth', emv.authorization_code);
  if (emv?.application_preferred_name) r.pair('App', emv.application_preferred_name);
  if (emv?.dedicated_file_name)        r.pair('AID', emv.dedicated_file_name);
  if (emv?.account_type)               r.pair('Account', emv.account_type);
  if (emv?.cardholder_verification_method) r.pair('CVM', emv.cardholder_verification_method);
  r.pair('Approved', 'YES');
  r.rule();

  // The PaymentIntent id is how any question about this sale gets answered
  // later — it's the join key between the printed paper, Stripe, the
  // terminal_payments row and the QuickBooks document.
  if (payment?.payment_intent_id) {
    r.line('Ref:');
    r.wrap(payment.payment_intent_id);
  }

  if (shop.gstNumber && !(payment?.tax_cents != null)) {
    r.line(`GST/HST# ${shop.gstNumber}`);
  }

  if (signatureRequired && copy === 'merchant') {
    r.feed(2);
    r.line('X' + '_'.repeat(Math.max(0, width - 1)));
    r.center('CARDHOLDER SIGNATURE');
    r.feed();
    r.center('I AGREE TO PAY THE ABOVE');
  }

  r.feed();
  r.center(copy === 'merchant' ? '*** MERCHANT COPY ***' : 'CUSTOMER COPY');
  r.center('Thank you!');
  r.cut();
  return r.toBytes();
}

/**
 * Cash or cheque. Same layout, no card block — and this is the only receipt
 * that fires the drawer.
 */
export function buildCashReceipt({
  payment, shop = DEFAULT_SHOP, width = 32,
  tenderedCents = null, method = 'CASH', jobDescription = '',
}) {
  const r = new Receipt(width);
  r.raw(ESC.ALIGN_CENTER).raw(ESC.BOLD_ON).line(shop.name).raw(ESC.BOLD_OFF);
  for (const l of shop.address || []) r.line(l);
  r.raw(ESC.ALIGN_LEFT).feed();

  r.pair('Date', stamp());
  if (payment?.project_id) r.pair('Job #', String(payment.project_id));
  if (payment?.client_name) r.pair('Customer', payment.client_name);
  r.rule();

  const desc = jobDescription || payment?.description;
  if (desc) { r.wrap(desc); r.rule(); }

  const total = payment?.amount_cents ?? 0;
  if (payment?.subtotal_cents != null && payment?.tax_cents != null) {
    r.pair('Subtotal', money(payment.subtotal_cents));
    r.pair(shop.gstNumber ? `HST (${shop.gstNumber})` : 'HST', money(payment.tax_cents));
  }
  r.big(`TOTAL ${money(total)}`);
  r.feed();
  r.pair('Method', method);
  if (tenderedCents != null) {
    r.pair('Tendered', money(tenderedCents));
    r.pair('Change', money(Math.max(0, tenderedCents - total)), { bold: true });
  }
  if (shop.gstNumber) { r.rule(); r.line(`GST/HST# ${shop.gstNumber}`); }
  r.feed();
  r.center('Thank you!');
  // Drawer first, then cut — the pulse is queued in the same write so the
  // drawer opens as the paper comes out rather than a beat later.
  r.kickDrawer();
  r.cut();
  return r.toBytes();
}

// Standalone "no sale" drawer open, for making change. Prints nothing.
export function buildDrawerKick() {
  return Uint8Array.from([...ESC.INIT, ...ESC.KICK_DRAWER]);
}
