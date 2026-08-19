// src/lib/jobs/quoteEmail.test.js
//
// Run with:
//   node --test src/lib/jobs/quoteEmail.test.js
//
// Same pattern as src/lib/shop/pricing.test.js — node:test, no runner dep.
// The fixtures below are the three paste shapes that actually land in the
// inbox: the holmgraphics.ca quote form (as a tab-separated table paste
// and as a label-per-line paste), the /shop/quote cart email, and a
// customer typing a plain note.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseQuoteEmail, suggestJobName, clientSearchTerms,
  scoreClientMatch, formatPhone, splitName,
} from './quoteEmail.js';

// ─── Fixtures ───────────────────────────────────────────────────────────────

// Outlook paste of the quote-form table: columns become tabs.
const FORM_TABS = `New quote request from Todd & Karen Konecny
Holm Graphics <darren@holmgraphics.ca>

New quote request
Name\tTodd & Karen Konecny
Company\tNew Venture Swine
Email\tnvswine@gmail.com
Phone\t5198818085
Service\tVehicle Graphics / Wrap
Details\tLooking for a farm decal? For the door of our grain stake truck. We have pigs, beef cows, cash crop. Just something simple can say "New Venture Swine" plus need CVOR numbers. The truck cap is silver/grey black box

Sent from the holmgraphics.ca quote form.
Holm Graphics Inc. - 2-43 Eastridge Rd, Walkerton ON N0G 2V0
Questions? Call 519-507-3001 or reply to this email.`;

// Same email, pasted by a client that drops each cell on its own line.
const FORM_LINES = `New quote request

Name
Todd & Karen Konecny
Company
New Venture Swine
Email
nvswine@gmail.com
Phone
(519) 881-8085
Service
Vehicle Graphics / Wrap
Details
Farm decal for the grain stake truck door.
Needs CVOR numbers too.

Sent from the holmgraphics.ca quote form.`;

// The mailto: body built by /shop/quote.
const CART_EMAIL = `QUOTE REQUEST
==============

Name:     Jenna Lerch
Email:    jenna@blueriver.example.com
Phone:    519-555-0142
Company:  Blue River Mechanical

ITEMS
-----

1. Gildan — Heavy Blend Hoodie (#18500, SanMar)
   Decoration: Small — left chest
   • 12x Black / L  @ $24.00 = $288.00

NOTES
-----
Logo is attached, needs to be ready for the trade show.`;

const PLAIN_EMAIL = `From: bryce@hometownmech.example.com
Subject: Sign replacement

Hi Darren,

The sign out front took a hit in the storm and needs replacing.
Same size as before. Call me at 519-555-7788 when you get a chance.

Bryce`;

// ─── Quote-form parsing ─────────────────────────────────────────────────────

test('quote form (tab paste): every field lands in the right place', () => {
  const p = parseQuoteEmail(FORM_TABS);
  assert.equal(p.name, 'Todd & Karen Konecny');
  assert.equal(p.company, 'New Venture Swine');
  assert.equal(p.email, 'nvswine@gmail.com');
  assert.equal(p.phone, '519-881-8085');       // reformatted from 5198818085
  assert.equal(p.service, 'Vehicle Graphics / Wrap');
  assert.match(p.details, /^Looking for a farm decal\?/);
  assert.match(p.details, /CVOR numbers/);
});

test('quote form (tab paste): our own footer is not swallowed into details', () => {
  const p = parseQuoteEmail(FORM_TABS);
  assert.doesNotMatch(p.details, /holmgraphics\.ca quote form/);
  assert.doesNotMatch(p.details, /Eastridge/);
  assert.doesNotMatch(p.details, /519-507-3001/);
});

test('quote form (tab paste): our own address is never taken as the customer email', () => {
  const p = parseQuoteEmail(FORM_TABS);
  assert.notEqual(p.email, 'darren@holmgraphics.ca');
});

test('quote form (label-per-line paste): reads the value off the next line', () => {
  const p = parseQuoteEmail(FORM_LINES);
  assert.equal(p.name, 'Todd & Karen Konecny');
  assert.equal(p.company, 'New Venture Swine');
  assert.equal(p.email, 'nvswine@gmail.com');
  assert.equal(p.phone, '519-881-8085');
  assert.equal(p.service, 'Vehicle Graphics / Wrap');
  assert.equal(p.details, 'Farm decal for the grain stake truck door.\nNeeds CVOR numbers too.');
});

test('subject heading gives the name when the table is missing', () => {
  const p = parseQuoteEmail('New quote request from Todd & Karen Konecny\n\nnvswine@gmail.com');
  assert.equal(p.name, 'Todd & Karen Konecny');
  assert.equal(p.email, 'nvswine@gmail.com');
});

// ─── Cart + free-form emails ────────────────────────────────────────────────

test('shop cart quote email: contact block is parsed, items stay in the raw copy', () => {
  const p = parseQuoteEmail(CART_EMAIL);
  assert.equal(p.name, 'Jenna Lerch');
  assert.equal(p.email, 'jenna@blueriver.example.com');
  assert.equal(p.phone, '519-555-0142');
  assert.equal(p.company, 'Blue River Mechanical');
  assert.match(p.details, /trade show/);
  assert.match(p.raw, /Heavy Blend Hoodie/);
});

test('plain email: scrapes address + phone and keeps the body as details', () => {
  const p = parseQuoteEmail(PLAIN_EMAIL);
  assert.equal(p.email, 'bryce@hometownmech.example.com');
  assert.equal(p.phone, '519-555-7788');
  assert.match(p.details, /sign out front/);
  assert.doesNotMatch(p.details, /^From:/m);
});

test('empty input parses to empty fields instead of throwing', () => {
  const p = parseQuoteEmail('');
  assert.equal(p.name, '');
  assert.equal(p.email, '');
  assert.equal(p.details, '');
});

// ─── Job name suggestion ────────────────────────────────────────────────────

test('suggestJobName: prefers the Service field', () => {
  assert.equal(suggestJobName(parseQuoteEmail(FORM_TABS)), 'Vehicle Graphics / Wrap');
});

test('suggestJobName: falls back to the subject line when there is no Service', () => {
  const name = suggestJobName(parseQuoteEmail(PLAIN_EMAIL));
  assert.equal(name, 'Sign replacement');
});

test('suggestJobName: first words of the details when there is no subject either', () => {
  const name = suggestJobName({ details: 'Two banners for the fall fair, 3x8 feet.' });
  assert.equal(name, 'Two banners for the fall fair,');
});

test('suggestJobName: never returns empty', () => {
  assert.equal(suggestJobName({}), 'Quote request');
});

// ─── Client matching helpers ────────────────────────────────────────────────

test('clientSearchTerms: email first, then company, then surname', () => {
  const terms = clientSearchTerms(parseQuoteEmail(FORM_TABS));
  assert.deepEqual(terms.slice(0, 3), [
    'nvswine@gmail.com', 'New Venture Swine', 'Konecny',
  ]);
});

test('scoreClientMatch: an email hit outranks a company hit', () => {
  const parsed = parseQuoteEmail(FORM_TABS);
  const byEmail = scoreClientMatch({ email: 'NVSwine@gmail.com' }, parsed);
  const byCompany = scoreClientMatch({ company_name: 'new venture swine' }, parsed);
  assert.equal(byEmail.score, 3);
  assert.equal(byCompany.score, 2);
  assert.ok(byEmail.score > byCompany.score);
});

test('scoreClientMatch: unrelated client scores zero', () => {
  const parsed = parseQuoteEmail(FORM_TABS);
  const m = scoreClientMatch({ company_name: 'Hometown Mechanics', email: 'x@y.ca' }, parsed);
  assert.equal(m.score, 0);
});

test('scoreClientMatch: surname alone is only a weak match', () => {
  const parsed = parseQuoteEmail(FORM_TABS);
  const m = scoreClientMatch({ first_name: 'Dale', last_name: 'Konecny' }, parsed);
  assert.equal(m.score, 1);
});

// ─── Small helpers ──────────────────────────────────────────────────────────

test('formatPhone: 10 digits become dashed, extensions survive', () => {
  assert.equal(formatPhone('5198818085'), '519-881-8085');
  assert.equal(formatPhone('(519) 881-8085'), '519-881-8085');
  assert.equal(formatPhone('+1 519 881 8085'), '519-881-8085');
  assert.equal(formatPhone('519-881-8085 x204'), '519-881-8085 ext 204');
});

test('formatPhone: anything that is not a NA number is left alone', () => {
  assert.equal(formatPhone('call the shop'), 'call the shop');
  assert.equal(formatPhone(''), '');
});

test('splitName: last word is the surname', () => {
  assert.deepEqual(splitName('Todd & Karen Konecny'), { first: 'Todd & Karen', last: 'Konecny' });
  assert.deepEqual(splitName('Cher'), { first: '', last: 'Cher' });
  assert.deepEqual(splitName(''), { first: '', last: '' });
});
