# DTF Online Store — Build Plan

**Status:** Revision 2, 2026-04-24. Single-phase scope (skipping the email-invoice stepping stone), required customer accounts with QBO existing-customer activation, hybrid online/quote pricing path, and full integration with the existing staff job board.

**Goal:** turn the existing Holm Graphics shop catalog into a self-serve online ordering system for DTF-decorated apparel, where customers pay at checkout, you proof and approve before printing, ShipTime handles fulfillment quotes and labels, and money flows through QuickBooks Payments and reconciles automatically into QBO. Online orders appear as jobs in the existing staff job board with no separate channel — they're just jobs that came from the website rather than over the phone.

---

## What's already built

The catalog browser, product detail pages, and quote builder already exist. Customers can browse SanMar Canada products by category and brand, view variants with size and colour, and add items to a localStorage cart with a decoration spec (location plus free-text notes). The cart store, quote-line construction, and the apparel markup pricing rules (`<$5 cost → 3×, ≥$5 cost → 2×`, both with floors) are all live in the SvelteKit frontend at `src/lib/shop/pricing.js` and `src/lib/stores/cart.js`. The backend exposes public catalog endpoints under `/api/catalog/*` on Railway. JWT auth exists for staff but not for customers.

The staff job board at `/dashboard` and `/jobs/[id]` is already running; jobs follow the convention `L:\ClientFiles[A-K|L-Z]\<ClientNameNoSpaces>\Job<num>\` on the network share, with the files-bridge resolving and serving folder contents. The bridge already has `POST /clients/:name/jobs/:jobNo/ensure` which idempotently creates the client + job folders. Online orders will plug into this existing structure — they become jobs, not a separate channel.

QuickBooks Online already holds the existing customer base. Online orders need to recognize those customers (no duplicates created in QBO), and existing customers need a way to activate an online account against their existing QBO record.

What does not exist is the actual sales mechanism: the cart submits via `mailto:` rather than persisting an order, decoration pricing is not calculated, there's no payment integration, no customer accounts, no customer-facing artwork upload, no shipping rate calculation, and no order state machine. This plan addresses all of those.

---

## Confirmed inputs

The pricing model is **standard sizes per location with quantity tiers, plus a custom-order path that prices per square inch on a sliding scale** with a setup fee. Standard locations vary by garment category — apparel (shirts, hoodies, polos), headwear, aprons, and bags each have their own location list and standard sizes.

The placeholder pricing scale (overridable by Darren via admin UI when built):

```
Quantity tiers:  1–11   /   12–23   /   24–47   /   48–95   /   96+

Standard locations (per garment category):
  apparel
    Left chest        4×4    $6 / $5 / $4   / $3.50 / $3.25
    Right chest       4×4    same as left chest
    Full chest       11×11   $14 / $12 / $10 / $9   / $8
    Full back        12×14   $14 / $12 / $10 / $9   / $8
    Yoke / Upper bk  12×3    $8  / $7  / $6   / $5.50 / $5
    Left sleeve       3×4    $5  / $4  / $3.50/ $3   / $2.75
    Right sleeve      3×4    same as left sleeve
  headwear
    Front             4×2    $7  / $6  / $5   / $4.50 / $4
    Left side       2.5×2    $5  / $4  / $3.50/ $3   / $2.75
    Right side      2.5×2    same as left side
    Back              4×1    $5  / $4  / $3.50/ $3   / $2.75
  aprons
    Center chest      8×8    $10 / $9  / $8   / $7   / $6.50
    Lower / pocket    8×4    $8  / $7  / $6   / $5.50 / $5
  bags
    Front           10×10    $10 / $9  / $8   / $7   / $6.50
    Back            10×10    same as front

Custom orders (per sq in, applied to width × height):
  1–11      $0.30/sq in    (min $8 per piece per design)
  12–23     $0.25/sq in
  24–47     $0.20/sq in
  48–95     $0.17/sq in
  96+       $0.14/sq in

Setup fee:  $15 per design on custom orders only, waived at 48+ pcs
            no setup fee on standard locations
```

**Per-design quantity, not per-order.** If a customer puts 30 shirts and 30 hoodies into the cart with the same logo on the left chest, the system aggregates them as 60 pieces for that design and applies the 48–95 tier. Two distinct designs in the same order each get tiered separately based on their own quantity.

**Approval workflow is option (c): full proof, customer must approve before production.** Combined with charge-at-checkout, this means customers pay in full at checkout, the order goes into "Awaiting proof" status, you generate and send a proof, and they hit Approve / Request Changes / Cancel & Refund buttons in the proof email. Cancellations issue a full refund via QB Payments minus credit card processing fees that you absorb (cost of doing business; rare on small orders).

**Customer accounts are required.** Every checkout must be tied to a customer account (no guest checkout). Existing customers in QBO get an activation flow to claim their existing record. New customers register during their first checkout. See "Customer accounts and QBO integration" below.

**Hybrid pricing path.** Online checkout uses standard pricing for the inline credit-card charge (no negotiated rates). B2B customers who need their negotiated rates click a "Request a Quote" button instead, which routes their cart into the existing staff quote/invoice workflow rather than charging them inline. Both paths are visible side-by-side in the cart.

**Online orders become jobs.** Each paid online order generates a job in the existing staff dashboard at `/dashboard` and `/jobs/[id]`, using the existing job number sequence. The order's artwork lands in the standard `L:\ClientFiles[A-K|L-Z]\<ClientNameNoSpaces>\Job<num>\` folder, identical in shape to phone-in or in-person jobs. Designers see no distinction between online and offline jobs.

**Ship-from address:** Holm Graphics Inc., 2-43 Eastridge Rd., Walkerton ON N0G 2V0.

**Package dimensions:** option 1 — per-product weight in the database, with a packaging rule like "N items → poly mailer of size X×Y×Z, weight = sum + 50g". Live ShipTime rates at checkout based on that estimate.

**No SanMar dropship.** Everything ships from Walkerton after decoration. One ship-from address, one outbound leg per order.

**Local pickup option.** At checkout, customers can choose **Ship to me** or **Pick up at shop**. Pickup is free (no shipping line on the invoice), no carrier or tracking, and the order skips ShipTime entirely. Pickup customers get a "Ready for pickup" email instead of a "Shipped" email when the order is finished. Shop pickup address is the Walkerton address; emails include hours and a Google Maps link.

**No scheduled carrier pickups.** ShipTime's `/pickups/` endpoint isn't used. Labels are generated and packages are dropped off / picked up by carriers via your existing routine.

**Payment processor:** QuickBooks Payments Canada, inline charge at checkout. Existing Chase merchant stays for in-shop debit and over-the-counter payments only.

---

## Architecture

The existing two-service split stays: SvelteKit frontend deployed to Cloudflare Pages, Express API on Railway with Postgres. The new pieces live in those existing services.

The frontend gets new routes for the public checkout flow (cart → checkout → confirmation → proof approval → order status), the existing admin job-board UI gets new screens for proof generation and order management. The backend gets a new `/api/orders/*` route family, the QB Payments integration, the ShipTime integration, the DTF pricing engine, and webhooks for QB Payments events (refunds, chargebacks).

The artwork-upload step writes files into the existing `L:\ClientFilesL-Z` (or `A-K`) structure via the files-bridge you just got back online — same path the staff job board already uses. This means uploaded customer art lands directly in the file structure your design team already works in, no separate storage to manage.

```
                                   shop.holmgraphics.ca
                                   (Cloudflare Pages, SvelteKit static)
                                            │
                                            │
                                            ▼
                              holmgraphics-shop-api on Railway
                                  (Express, Postgres, JWT)
                                            │
        ┌───────────────┬───────────────────┼───────────────┬────────────────┐
        │               │                   │               │                │
        ▼               ▼                   ▼               ▼                ▼
   QB Payments      ShipTime          files-bridge       SanMar           Postgres
   (API + webhooks) (rates + labels)  on DesignCentre4   PromoStandards   (orders, items,
                                       (existing)         (existing)       decorations,
                                                                           proofs, etc.)
```

---

## Pricing engine

A single function on the API computes the price of a cart. It takes the cart contents and returns line-by-line totals plus a grand total. Same function is called from the frontend (read-only, for live display as the customer edits the cart) and from the backend at checkout (authoritative, just before the QB Payments charge). Frontend never trusts itself for the actual charge amount — only the backend's calculation is used to bill.

The function lives at `suppliers/dtf/pricing.js` on the API. It reads three config tables: `print_locations`, `dtf_pricing_tiers`, and `dtf_setup_fees`. All three are admin-editable via a new staff page so Darren can adjust prices without code changes.

For a cart, the algorithm is:

1. For each line item (one product variant), calculate the garment subtotal: `quantity × variantRetail(variant)` using the existing apparel markup.
2. Group all decorations across all line items by `design_id` (the customer creates a design when they upload artwork; each design gets a uuid so multiple line items can reference the same logo).
3. For each design, sum the total piece count across all line items that use it. That's the quantity tier driver for that design.
4. For each decoration on each line item, compute the decoration cost:
   - If standard location: `quantity × tier_price[design_quantity_tier][location]`.
   - If custom: `quantity × max(width × height × per_sqin_rate[design_quantity_tier], min_custom_per_piece)` plus `setup_fee` once per design (waived if `design_quantity_tier ≥ 48`).
5. Sum garment subtotal + all decoration subtotals = items subtotal.
6. Add shipping (calculated separately via ShipTime, see below).
7. Add HST based on customer's shipping province (13% Ontario, 5% AB/BC/MB/SK/NT/NU/YT, 15% NB/NS/NL/PE, 14.975% QC). Stored in a small tax_rates table for easy update.
8. Return `{ items_subtotal, shipping, tax, grand_total, line_breakdown }`.

The frontend shows live updates as the customer changes quantities or adds locations. The backend recomputes from scratch at checkout and uses its own number for the charge — frontend numbers are display-only.

---

## Customer accounts and QBO integration

The customer base lives in QBO today. The new system needs to recognize existing QBO customers (no duplicates), let them activate an online account against their existing record, and let new customers register during their first online order. All checkouts require a logged-in customer.

**One-time import.** A migration script runs once before launch: it pulls all customers from QBO via `GET /v3/company/{realmId}/query?query=select * from Customer`, paginates through, and inserts each into `shop_customers` with their `qbo_customer_id`, email, name, and company. Customers without an email get imported with `email = NULL` (they can be activated later by staff manually if needed). After this import, every existing QBO customer has a `shop_customers` row with `account_status = 'unactivated'` and no password.

**Existing customer activation.** When you announce the online store to your customer base, send them an activation email with a one-time link: `https://shop.holmgraphics.ca/activate/<token>`. The token is a uuid stored on `shop_customers.activation_token`, scoped to that one customer. Clicking the link takes them to a "Set your password" page — they confirm their email, set a password, and the system marks `account_status = 'active'`. Now they can log in normally.

The same activation link can be triggered by the customer themselves: if a new customer tries to register with an email that matches an existing unactivated record, the system says "Looks like we already have you on file — we've sent an activation link to your email" and emails the same link rather than creating a duplicate. Prevents accidental duplicates from typos in self-registration.

**New customer registration.** First-time visitors register during checkout: name, company (optional), email, phone, password. The system creates a `shop_customers` row with `account_status = 'active'` and a matching QBO customer via the QBO API. From that moment, they're linked.

**Login.** Standard email + password against `shop_customers`. JWT issued, stored in browser. Separate auth realm from staff JWT — customers can never access staff routes, staff can never appear as customers.

**Password reset.** Forgot-password flow via emailed reset link with one-hour TTL.

**Account page.** Logged-in customers can see their order history, edit shipping addresses, save payment methods (QB Payments tokenized cards, retrieved via QB Payments API), and update their profile. Profile changes also update the linked QBO customer record.

**B2B private store path (optional, deferred).** A future enhancement is to give specific B2B customers a private store URL with their negotiated pricing baked in. Not in scope for the initial build but the data model leaves room for it (a `shop_customers.pricing_tier_id` column, defaulted to NULL = standard pricing).

---

## Database schema

New tables on the Railway Postgres. Existing tables (catalog, users, etc.) are not touched.

```sql
-- Garment categorization (links existing catalog to print location lists)
ALTER TABLE products ADD COLUMN garment_category TEXT NOT NULL DEFAULT 'apparel'
  CHECK (garment_category IN ('apparel', 'headwear', 'aprons', 'bags'));

-- Print locations config (admin-editable)
CREATE TABLE print_locations (
  id              SERIAL PRIMARY KEY,
  garment_category TEXT NOT NULL,
  name            TEXT NOT NULL,
  max_width_in    NUMERIC(5,2) NOT NULL,
  max_height_in   NUMERIC(5,2) NOT NULL,
  display_order   INT NOT NULL DEFAULT 0,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE print_location_prices (
  id                SERIAL PRIMARY KEY,
  print_location_id INT NOT NULL REFERENCES print_locations(id),
  min_quantity      INT NOT NULL,
  max_quantity      INT,                  -- NULL = unlimited
  price_per_piece   NUMERIC(8,2) NOT NULL
);

-- DTF custom-order pricing tiers (admin-editable)
CREATE TABLE dtf_custom_tiers (
  id                  SERIAL PRIMARY KEY,
  min_quantity        INT NOT NULL,
  max_quantity        INT,
  price_per_sqin      NUMERIC(8,4) NOT NULL,
  min_per_piece       NUMERIC(8,2) NOT NULL DEFAULT 0,
  setup_fee_per_design NUMERIC(8,2) NOT NULL DEFAULT 0
);

-- HST rates by province
CREATE TABLE tax_rates (
  province_code  CHAR(2) PRIMARY KEY,
  rate           NUMERIC(6,5) NOT NULL,
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE
);

-- Customer accounts (required login, no guest checkout)
CREATE TABLE shop_customers (
  id                SERIAL PRIMARY KEY,
  email             TEXT NOT NULL UNIQUE,
  phone             TEXT,
  name              TEXT NOT NULL,
  company           TEXT,
  qbo_customer_id   TEXT UNIQUE,                  -- linked QBO record
  password_hash     TEXT,                          -- NULL until activated
  account_status    TEXT NOT NULL DEFAULT 'unactivated'
                    CHECK (account_status IN ('unactivated','active','suspended')),
  activation_token  TEXT UNIQUE,                  -- for existing-customer claim flow
  activation_sent_at TIMESTAMPTZ,
  password_reset_token TEXT UNIQUE,
  password_reset_expires TIMESTAMPTZ,
  pricing_tier_id   INT,                          -- NULL = standard; future: tier overrides
  email_verified_at TIMESTAMPTZ,
  last_login_at     TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_shop_customers_email ON shop_customers(LOWER(email));
CREATE INDEX idx_shop_customers_qbo ON shop_customers(qbo_customer_id);

-- Saved shipping addresses per customer
CREATE TABLE shop_customer_addresses (
  id            SERIAL PRIMARY KEY,
  customer_id   INT NOT NULL REFERENCES shop_customers(id) ON DELETE CASCADE,
  label         TEXT,                       -- 'Home', 'Office', etc.
  name          TEXT NOT NULL,
  addr1         TEXT NOT NULL,
  addr2         TEXT,
  city          TEXT NOT NULL,
  province      CHAR(2) NOT NULL,
  postal_code   TEXT NOT NULL,
  country       CHAR(2) NOT NULL DEFAULT 'CA',
  is_default    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Saved payment method tokens (QB Payments tokenized cards)
CREATE TABLE shop_customer_payment_methods (
  id              SERIAL PRIMARY KEY,
  customer_id     INT NOT NULL REFERENCES shop_customers(id) ON DELETE CASCADE,
  qb_card_token   TEXT NOT NULL,
  card_brand      TEXT,                     -- Visa, Mastercard, etc.
  card_last4      CHAR(4),
  card_exp_month  INT,
  card_exp_year   INT,
  is_default      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Orders (links to existing job system via job_id)
CREATE TABLE orders (
  id              SERIAL PRIMARY KEY,
  order_number    TEXT NOT NULL UNIQUE,   -- mirrors job number, e.g. '9550'
  job_id          INT NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,  -- existing jobs table
  customer_id     INT NOT NULL REFERENCES shop_customers(id),
  source          TEXT NOT NULL DEFAULT 'online'
                  CHECK (source IN ('online','quote_request')),
                  -- 'online' = paid inline at checkout
                  -- 'quote_request' = customer hit "Request a Quote" button
  status          TEXT NOT NULL,          -- see state machine below
  items_subtotal  NUMERIC(10,2) NOT NULL,
  shipping_total  NUMERIC(10,2) NOT NULL,
  tax_total       NUMERIC(10,2) NOT NULL,
  grand_total     NUMERIC(10,2) NOT NULL,
  ship_to_name    TEXT NOT NULL,
  ship_to_addr1   TEXT NOT NULL,
  ship_to_addr2   TEXT,
  ship_to_city    TEXT NOT NULL,
  ship_to_province CHAR(2) NOT NULL,
  ship_to_postal  TEXT NOT NULL,
  ship_to_country CHAR(2) NOT NULL DEFAULT 'CA',
  fulfillment_method TEXT NOT NULL DEFAULT 'ship'
                  CHECK (fulfillment_method IN ('ship', 'pickup')),
  shipping_carrier TEXT,                  -- NULL for pickup; 'canadapost', 'purolator', etc.
  shipping_service TEXT,                  -- NULL for pickup; 'expedited', 'ground', etc.
  shipping_quote_id TEXT,                 -- ShipTime rate id, kept for label (NULL for pickup)
  shiptime_ship_id INT,                   -- after label is generated (NULL for pickup)
  tracking_number TEXT,                   -- NULL for pickup
  label_url TEXT,                         -- NULL for pickup
  ready_for_pickup_at TIMESTAMPTZ,        -- pickup orders only
  picked_up_at TIMESTAMPTZ,               -- pickup orders only
  qbo_invoice_id  TEXT,                   -- QBO invoice/sales receipt id
  qb_payment_id   TEXT,                   -- QB Payments charge id
  qb_refund_id    TEXT,                   -- if refunded
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at         TIMESTAMPTZ,
  proof_sent_at   TIMESTAMPTZ,
  approved_at     TIMESTAMPTZ,
  shipped_at      TIMESTAMPTZ,
  cancelled_at    TIMESTAMPTZ,
  refunded_at     TIMESTAMPTZ
);

-- Line items (one per product variant, with size/quantity matrix)
CREATE TABLE order_items (
  id            SERIAL PRIMARY KEY,
  order_id      INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  supplier      TEXT NOT NULL,            -- 'sanmar_ca', etc.
  style         TEXT NOT NULL,            -- e.g., 'PC54'
  variant_id    TEXT NOT NULL,            -- supplier variant id
  color_name    TEXT NOT NULL,
  color_hex     TEXT,
  size          TEXT NOT NULL,
  quantity      INT NOT NULL,
  unit_price    NUMERIC(8,2) NOT NULL,    -- garment retail per piece
  line_subtotal NUMERIC(10,2) NOT NULL    -- quantity × unit_price
);

-- Designs (one per uploaded logo; one design can have multiple decorations)
CREATE TABLE designs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,          -- customer-supplied: "Logo A"
  artwork_path    TEXT NOT NULL,          -- L:\ClientFiles…\order-1234\design-abc.png
  artwork_filename TEXT NOT NULL,
  artwork_mime    TEXT,
  artwork_size_bytes BIGINT,
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Decorations (one per location per item; references a design)
CREATE TABLE order_decorations (
  id                 SERIAL PRIMARY KEY,
  order_id           INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_item_id      INT NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  design_id          UUID NOT NULL REFERENCES designs(id) ON DELETE CASCADE,
  print_location_id  INT REFERENCES print_locations(id),  -- NULL = custom
  custom_location    TEXT,                 -- free text if custom
  width_in           NUMERIC(5,2),         -- for custom only
  height_in          NUMERIC(5,2),
  decoration_cost    NUMERIC(10,2) NOT NULL,
  setup_fee          NUMERIC(10,2) NOT NULL DEFAULT 0
);

-- Proofs (multiple per order if revisions)
CREATE TABLE proofs (
  id                SERIAL PRIMARY KEY,
  order_id          INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  proof_number      INT NOT NULL,         -- 1, 2, 3 for revisions
  proof_image_path  TEXT NOT NULL,        -- generated proof PDF/PNG
  approval_token    TEXT NOT NULL UNIQUE, -- random url-safe, used in approve link
  created_by        TEXT NOT NULL,        -- staff email
  sent_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at       TIMESTAMPTZ,
  changes_requested_at TIMESTAMPTZ,
  changes_request_text TEXT,
  cancelled_at      TIMESTAMPTZ
);

-- Webhook event log (for debugging and audit)
CREATE TABLE webhook_events (
  id            SERIAL PRIMARY KEY,
  source        TEXT NOT NULL,            -- 'qb_payments', 'shiptime', etc.
  event_type    TEXT NOT NULL,
  raw_payload   JSONB NOT NULL,
  processed_at  TIMESTAMPTZ,
  error         TEXT,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Indexes worth adding immediately: `orders(status)`, `orders(customer_id)`, `orders(created_at)`, `order_items(order_id)`, `order_decorations(order_id)`, `webhook_events(source, event_type)`.

---

## API endpoints

All new endpoints under `/api/customer/*`, `/api/orders/*`, `/api/designs/*`, `/api/admin/*`, plus webhook receivers.

```
# Customer auth (no auth required to call these)
POST   /api/customer/register             Create new customer + QBO customer + login
POST   /api/customer/login                Email + password → JWT
POST   /api/customer/logout               Invalidate JWT
POST   /api/customer/forgot-password      Send reset link
POST   /api/customer/reset-password       Submit new password with token
POST   /api/customer/activate/:token      Activate existing-customer account, set password
GET    /api/customer/check-email/:email   "Already on file" check during registration

# Customer self-service (customer JWT required)
GET    /api/customer/me                   Profile
PUT    /api/customer/me                   Update profile (also syncs to QBO)
GET    /api/customer/me/orders            Order history
GET    /api/customer/me/addresses         Saved shipping addresses
POST   /api/customer/me/addresses         Add address
PUT    /api/customer/me/addresses/:id     Edit address
DELETE /api/customer/me/addresses/:id     Remove address
GET    /api/customer/me/payment-methods   Saved cards (via QB Payments)
DELETE /api/customer/me/payment-methods/:id

# Pricing + ordering (customer JWT required)
POST   /api/orders/quote                  Compute prices for a cart, no charge
POST   /api/orders                        Create order, charge card, create job, return order
POST   /api/orders/quote-request          B2B "Request a Quote" path — no charge,
                                          creates a quote_request type order +
                                          notifies staff
GET    /api/orders/:orderNumber           Order status (must own the order)

# Proof actions (customer JWT or signed token from email)
POST   /api/proofs/:token/approve
POST   /api/proofs/:token/request-changes
POST   /api/proofs/:token/cancel          Triggers refund

# Shipping (customer JWT required)
POST   /api/shipping/rates                Quote rates for a cart + ship-to address
POST   /api/shipping/validate-address     Sanity check a postal code

# Designs / artwork upload (customer JWT required)
POST   /api/designs                       Upload artwork (multipart) →
                                          ensures job folder via files-bridge,
                                          writes file to it, returns design id + path
GET    /api/designs/:id                   Get design metadata

# Admin (staff JWT)
GET    /api/admin/orders                  List orders, filter by status, source, etc.
GET    /api/admin/orders/:id              Full detail
POST   /api/admin/orders/:id/proof        Upload proof image + send approval email
POST   /api/admin/orders/:id/ship         Generate ShipTime label, mark shipped
POST   /api/admin/orders/:id/refund       Initiate refund (full or partial)
GET    /api/admin/orders/:id/qbo-link     Deep link to QBO invoice

PUT    /api/admin/print-locations/:id     Edit pricing
POST   /api/admin/print-locations         Add new location
PUT    /api/admin/dtf-tiers/:id           Edit custom tier
PUT    /api/admin/customers/:id           Edit customer (also syncs QBO)
POST   /api/admin/customers/:id/send-activation  Re-send activation link

# Webhooks (no auth, signature-verified)
POST   /api/webhooks/qb-payments          QB Payments events (refund completed, dispute)
POST   /api/webhooks/shiptime             ShipTime events if available
POST   /api/webhooks/qbo                  QBO sync events if needed
```

---

## Frontend changes

Customer-facing routes (new):

`/shop/login/` and `/shop/register/` — standard login and registration forms. Registration page also has the "Already have an account? Activate it" link that takes you to a form to enter your email; if a matching unactivated record exists, an activation email is sent.

`/shop/activate/[token]/` — set-password page used by existing customers from the activation email.

`/shop/forgot-password/` and `/shop/reset-password/[token]/` — password recovery.

`/shop/cart/` — full cart page replacing the current quote-builder modal. Lists line items with edit/remove, shows decoration choices per item with the dropdown of locations from `/api/print-locations`, supports adding multiple decorations per item, has the artwork upload field that creates a design and references it from each decoration. Live price recalculation via `POST /api/orders/quote` debounced as the customer edits. Two action buttons at the bottom: **Pay Now** (proceeds to checkout) and **Request a Quote** (B2B path — submits as `quote_request`-type order without payment, notifies staff).

`/shop/checkout/` — requires customer login. If not logged in, redirects to `/shop/login?return=/shop/checkout`. Collects ship-to address (with saved-addresses dropdown), calls `POST /api/shipping/rates` to populate a carrier dropdown, embeds the QB Payments inline card form via Intuit's `intuit.ipp.payments` JS SDK, shows the final price, and a Submit & Pay button. Optionally "Save this card for future orders" checkbox. On submit, posts to `POST /api/orders` with a card token (or saved-card id). Backend handles pricing, charge, job creation, order persist atomically. On success, redirects to `/shop/order/<orderNumber>`. On decline, shows the reason inline.

`/shop/order/[orderNumber]/` — customer-facing order status page (auth-protected; customer must own the order, or staff). Shows current status (Awaiting Proof / Awaiting Your Approval / In Production / Shipped with tracking / Cancelled). If a proof is awaiting their action, embeds the proof image with Approve/Request-Changes/Cancel buttons.

`/shop/order/[orderNumber]/proof/[token]/` — public proof approval page used from email links. Signed token in URL allows action without requiring login (so email recipients can approve in one click).

`/shop/account/` — logged-in dashboard: order history, profile, addresses, saved cards.

Staff-facing additions to the existing job board at `/dashboard` and `/jobs/[id]`:

**Online orders appear as regular jobs in the existing job board.** Each paid online order creates a job in the `jobs` table with the same job_number sequence as phone-in jobs. The job detail page (`/jobs/[id]`) gets a small additions: a new "Online order" badge if `order.source = 'online'`, a panel showing the customer-paid status, total, payment ID, refund button, and an Approval Status panel showing proof state (Awaiting first proof / Sent on <date>, awaiting customer / Approved on <date> / Changes requested: "<text>"). The existing FILES section already shows the job folder contents — customer-uploaded artwork shows up there automatically because we wrote it directly to `Job<num>\` via the files-bridge.

A new staff action on the job page: **Generate Proof** (upload a proof PDF/PNG → backend creates a `proofs` row, copies the file into `Job<num>\proofs\`, sends email with approval link to the customer). Subsequent revisions just stack into `proofs\proof-2.pdf`, `proof-3.pdf`, etc.

Another staff action: **Print Shipping Label** — only enabled after the proof is approved. Calls ShipTime, returns the label PDF for download.

A staff filter on the dashboard: existing dashboard already has filters; add `Source: online | quote_request | offline` and `Customer payment: paid | unpaid | refunded`.

A new admin page at `/admin/pricing` for editing the DTF pricing tables. CRUD over `print_locations`, `print_location_prices`, and `dtf_custom_tiers`. Staff can adjust prices without touching code.

A new admin page at `/admin/customers` to search customers, view their order history, manually trigger activation emails for unactivated existing customers, and edit profile info (which syncs back to QBO).

---

## QuickBooks Payments integration

You already have QB Payments Canada with online card-not-present capability enabled. To wire it programmatically:

**One-time setup.** Create a developer app at `developer.intuit.com` requesting two scopes: `com.intuit.quickbooks.accounting` (to create invoices/sales receipts) and `com.intuit.quickbooks.payment` (to charge cards). Run the OAuth flow once to connect the app to your Holm Graphics QBO Canada company. Store the resulting `client_id`, `client_secret`, `realm_id`, and the long-lived `refresh_token` as Railway env vars on the API service. The refresh token rotates every 100 days; build a small cron job that hits `/oauth/refresh` weekly to keep it fresh and alert if it ever fails.

Map your shop products to a QBO Item. Cleanest is a single generic Item called "Decorated apparel — DTF" with a description override per invoice line. The line description carries the actual product info ("PC54 Port & Company Tee, Heather Navy, M, qty 12 with Left chest decoration"). Keeps your QBO Item list lean and simple.

**Charge flow at checkout.** The frontend uses Intuit's `intuit.ipp.payments` JS SDK to tokenize the card on the customer's browser (so the raw card number never reaches your server). The card token is sent to `POST /api/orders` along with the cart and ship-to address. The backend:

1. Recomputes the final price from the cart (does not trust the frontend).
2. Looks up or creates a `shop_customer` row by email; if new, also creates a QBO customer via the QBO API and stores the `qbo_customer_id`.
3. Calls QB Payments API `POST /quickbooks/v4/payments/charges` with the token and the final amount.
4. On `CAPTURED` response, creates a QBO Sales Receipt referencing the new customer, with one line per `order_item` and one line per `order_decoration`, plus shipping and tax lines. The Sales Receipt ties the payment to the books automatically — no separate invoice + payment-application step needed.
5. Persists the `orders` row with status `awaiting_proof`, links `qbo_invoice_id` and `qb_payment_id`.
6. Sends an order confirmation email to the customer.

If the charge declines, the order is never created. The frontend shows the decline reason from QB Payments and lets the customer try again or use a different card.

**Refund flow on cancellation.** When the customer hits Cancel on a proof (or staff issues a refund manually), the API calls QB Payments `POST /quickbooks/v4/payments/refunds` with the `qb_payment_id`. On `ISSUED`, it voids the QBO Sales Receipt (or creates a Refund Receipt — depends on QBO Canada's preferred pattern; need to confirm during implementation), updates the order status to `cancelled` or `refunded`, stores the `qb_refund_id`, and emails the customer.

**Webhooks.** Subscribe to QB Payments webhooks for `payment.refunded`, `payment.disputed`, and `payment.failed`. The webhook receiver verifies the signature, logs the event in `webhook_events`, and updates the order status. Disputes get an alert email to Darren so they can be addressed before a chargeback closes against you.

---

## ShipTime integration

ShipTime's REST API is at `https://restapi.shiptime.com/rest`. Authentication mechanism needs to be confirmed from the docs page (likely an API key in a header) — when you actually wire this up, paste the auth section and the `/rates` request/response examples and I'll fill in the exact field names.

**Rate quote at checkout.** When the customer enters a shipping address, the frontend posts the cart to `POST /api/shipping/rates`. The backend computes the package profile from the cart contents (per-product weight summed plus packaging weight, dimensions chosen from a small set of standard box/poly-mailer sizes based on item count), calls ShipTime `POST /rates/`, gets back a list of carrier-service-price options, and returns them. The frontend shows them in a dropdown sorted by price. Customer picks one. The chosen `quote_id` and `price` are remembered in the checkout state and become the shipping line on the order.

Package profile rules (initial; adjustable per real-world packing):

```
Order item count    Package
1–3 shirts          Poly mailer 10×13×1, packaging weight 50g
4–6 shirts          Poly mailer 14×17×2, packaging weight 80g
7–12 shirts         Box 12×10×6, packaging weight 200g
13–24 shirts        Box 16×12×10, packaging weight 350g
25–48 shirts        Box 20×14×12, packaging weight 600g
49+ shirts          Box 24×18×14, packaging weight 1000g (or split)
Hats x N            same matrix as shirts but doubled (hats take more volume)
Mixed orders        use largest applicable bucket
```

Per-product weight comes from a new `weight_grams` column on the products table. Default: 200g for tees, 350g for polos, 600g for hoodies, 70g for hats, 250g for aprons, 100g for tote bags. SanMar's PromoStandards data sometimes includes weight; backfill from there where possible, hand-curate the rest.

**Label generation at ship time.** When you mark an order ready to ship from the staff job board, the API calls `POST /orders/` (the ShipTime "create order" endpoint) using the same package profile and the `quote_id` from checkout, gets back a label PDF and tracking number, persists both on the order, and emails the customer with the tracking link. You print the label from the staff page.

**Cancellations** (rare — customer cancels after label is printed): ShipTime `DELETE /orders/{id}` voids the shipment if the carrier accepts (varies; some carriers can't void after a certain stage). Build the API call but expect occasional manual cleanup.

---

## Files-bridge integration for artwork

Customer-uploaded artwork lands in the exact same folder structure as regular jobs — no separate "online orders" path. The standard convention is already implemented in the bridge and is:

```
L:\ClientFiles[A-K|L-Z]\<ClientNameNoSpaces>\Job<num>\
```

For example, an online order for "Huron Bay Coop" given job number 9551 would land in:
`L:\ClientFilesL-Z\HuronBayCoop\Job9551\`

Within the job folder, the online-order-specific subfolders are kept small and lowercase to be distinguishable from staff-created ad-hoc subfolders:

```
L:\ClientFilesL-Z\HuronBayCoop\Job9551\
   designs\
     <design-uuid>-original.<ext>     # raw customer upload
   proofs\
     proof-1.pdf
     proof-2.pdf
     proof-1-approved.pdf             # archive of whichever revision won
   shipping\
     label.pdf                        # generated after approval, from ShipTime
```

The customer sees none of this structure; they just click "Upload artwork." The upload API flow is:

1. Customer clicks Upload in the cart. Frontend posts multipart to `POST /api/designs` along with the current order draft (to get the client name and job number).
2. Backend validates file type (PNG/JPG/PDF/SVG/AI/PSD) and size (50 MB cap).
3. Backend calls `POST /clients/:name/jobs/:jobNo/ensure` on the files-bridge to make sure the client folder + job folder + `designs\` subfolder exist (idempotent — no-op if they already do).
4. Backend streams the file via a new bridge endpoint `POST /clients/:name/jobs/:jobNo/upload?subfolder=designs` (to be added — this is the one upload endpoint the bridge needs that it doesn't already have).
5. Bridge writes the file to disk under the job folder, validates path containment against `FILES_ROOTS`, returns the saved filename and absolute path.
6. Backend persists the `designs` row with `artwork_path` = the returned path. Returns `design_id` to the frontend.

For orders placed before a job exists (i.e., during checkout before the job row is created), the upload flow defers: artwork is first written to a tempo location on the API server (filesystem or Postgres blob), and moved into the final `Job<num>\designs\` folder inside the `POST /api/orders` transaction once the job number is allocated. Frontend never sees the temp location.

**New endpoint to add to files-bridge:**

```
POST /clients/:name/jobs/:jobNo/upload?subfolder=<designs|proofs|shipping>
  Body: multipart/form-data with file field
  Auth: Bearer API key (same pattern as existing endpoints)
  Response: { saved: true, path: 'L:\\...\\file.ext', filename: 'file.ext' }
  Validates: subfolder is one of the allowed values, path is under FILES_ROOTS,
             filename is sanitized (no path chars, no hidden files)
```

This is a ~50-line addition to `files-bridge/server.js` using `multer` or `express-fileupload`.

The staff job board already reads the job folder contents via the bridge, so customer uploads appear in the FILES section of the job page immediately with no new code. Staff see artwork identically to how they see it on a phone-in job.

---

## Order state machine

```
Order placed (charge succeeded)
        │
        ▼
   awaiting_proof  ──────────────────────────────────┐
        │  (staff generates and sends proof)         │
        ▼                                            │
   awaiting_approval                                 │
        │       \                                    │
        │        \  customer clicks Cancel & Refund  │
        │         \                                  │
        │          ▼                                 │
        │      cancelled  ──────────────►   refunded
        │       (refund initiated)         (QB confirms refund)
        │
        │  customer clicks Approve
        ▼
   in_production
        │  (staff prints + decorates)
        ▼
   ready_to_ship
        │  (staff generates label)
        ▼
   shipped
        │  (carrier delivers)
        ▼
   delivered
        │
        ▼
   complete (after some grace period; auto-transition for reporting)
```

Branch: from `awaiting_approval`, customer can also click Request Changes, which leaves the status at `awaiting_approval` but creates a new proof revision. Loop until they approve or cancel.

Branch: refund can also be initiated by staff at any state up to `in_production`. After production starts, refunds become a manual policy decision (probably partial refund minus material costs, handled by you on a case-by-case basis).

---

## Phased implementation

Single primary build, then a polish phase. Skipping the email-invoice stepping stone per Darren's direction — we go straight to inline charge.

**Phase A — Full online store (estimated 5–7 weeks).** Everything needed for the described experience: customer accounts with QBO activation for existing customers, DTF pricing engine, catalog integration, cart + checkout with inline QB Payments charge, live ShipTime rates at checkout and label generation after approval, proof generation and customer approval workflow, online orders appearing as jobs in the existing staff job board, artwork upload into regular job folders via files-bridge, refund flow for cancellations, and the `Request a Quote` path for B2B customers.

Rough week-by-week breakdown (one developer working full-time; approximately — real dates depend on blockers):

1. **Week 1 — Foundations.** Database migration (all new tables, plus `jobs.origin` column if it doesn't exist). QBO OAuth app setup and token exchange. Sandbox environments for QB Payments + ShipTime. One-time QBO customer import script. Customer auth routes (register, login, activate, reset). Transactional email provider chosen and wired up.

2. **Week 2 — Pricing + cart.** DTF pricing engine on API with unit tests. Admin CRUD pages for pricing tables. Rewrite `/shop/cart/` with live quote calls, decoration location dropdowns, custom-size inputs, artwork upload field, Pay Now and Request a Quote buttons.

3. **Week 3 — Checkout + payment.** `/shop/checkout/` page with address form, ShipTime rate dropdown, QB Payments inline card widget. `POST /api/orders` endpoint that creates customer (or links existing), creates job via files-bridge `/ensure`, charges via QB Payments, creates QBO Sales Receipt, persists order, returns order number. Decline handling.

4. **Week 4 — Proofs + job-board integration.** `proofs` table + API. Staff Generate Proof action on job page (upload proof PDF, send approval email). Proof approval page for customers (both authenticated and token-link variants). Approve / Request Changes / Cancel actions. Refund flow with QB Payments API call. Order status page for customers.

5. **Week 5 — Shipping + fulfillment.** ShipTime label generation on approved orders. Tracking number saved to order, emailed to customer. Shipping-label staff action. Customer account pages: order history, addresses, saved cards. Admin customer search + activation-email trigger.

6. **Week 6 — Webhooks + production hardening.** QB Payments webhook receiver (refunds, disputes, failures) + signature verification. Logs, monitoring, error alerting. Comprehensive tests — especially the pricing engine and the charge/refund flow. Payment sandbox test suite with real test cards. PCI SAQ-A paperwork.

7. **Week 7 — Launch prep.** Customer activation emails sent to existing QBO base. Staff training on new job-board additions. Dry-run test orders end-to-end. Price sheet sign-off with Darren. Backup / disaster-recovery check. Cutover.

Buffer week is realistic — there will be at least one surprise (3DS edge case on a Canadian card, ShipTime rate quoting edge case, QBO Canada idiosyncrasy, customer import dataset quirk, or similar). Plan for 6 with a 1-week buffer, or 7 including buffer.

**Phase B — Polish and growth (later, estimated 2–3 weeks).** Abandoned-cart emails. Reorder-from-history. Product-recommendations widget. Google Analytics / Meta Pixel for marketing attribution. Admin sales dashboard. Optional B2B private stores with negotiated pricing tiers (if demand emerges post-launch).

---

## Open items / decisions still to make during build

A few things deferred to actual implementation rather than planning:

1. **QB Payments refund vs. void semantics in QBO Canada.** Cleanest accounting is "void the Sales Receipt" if same-day, "issue a Refund Receipt" if after the period. The integration code needs to handle both based on `paid_at` age. Confirm during Phase 2 build.

2. **3D Secure / Strong Customer Authentication.** Some Canadian issuers require 3DS for online card transactions. QB Payments handles 3DS challenges through their JS SDK with a callback. The checkout page needs to handle the case where the SDK requests user 3DS interaction (typically a popup or iframe). Test this against real cards in QB's sandbox during Phase 2.

3. **Shipping rate caching.** ShipTime rates can change; quotes likely have a TTL (probably 24 hours). Confirm from their docs and don't trust an old `quote_id` past expiry — re-quote at order time and use the new rate, rejecting if it's significantly different from what the customer agreed to (and emailing them about the change).

4. **Order number format and humans-vs-machines.** Recommend `HG-2026-0001` style (prefix + year + zero-padded sequence). Resets the sequence yearly. Easier to read out over the phone than UUIDs.

5. **Tax registration check.** Confirm your CRA HST registration and that the tax_rates table is correct for your specific situation. Quebec's QST is technically separate from HST and may need its own line on invoices for QC customers — confirm with your accountant.

6. **PCI scope.** Using QB Payments' tokenization SDK keeps you in PCI SAQ-A scope (the lowest tier — basically a self-attestation questionnaire). Confirm with QB Payments' compliance docs that their JS SDK satisfies SAQ-A requirements (they almost certainly do). No card data ever touches your server or your database.

7. **GDPR-ish data retention.** Decide a retention policy for cancelled orders, customer info from one-time guest checkouts, etc. Not legally required at your size but good hygiene. Probably 7 years for tax records, indefinite for active customers, anonymize after 2 years for guests.

8. **Webhook verification.** Confirm QB Payments' webhook signature scheme during Phase 2. Standard pattern is HMAC-SHA256 of the body using a webhook secret; ShipTime's mechanism (if they have webhooks) needs confirming from their docs.

9. **Email transactional sending.** Pick a transactional email provider for order confirmations, proof requests, shipping notifications, refund confirmations. Options: Postmark (recommended), SendGrid, Mailgun, AWS SES. Pick during Phase 1 since you'll need it for invoice emails too.

10. **Sandbox / staging.** Set up a parallel "dev" Railway environment connected to QB Payments sandbox and ShipTime test mode for development, so we're not test-charging real cards or generating real labels during the build. Pre-Phase-1 setup.

---

## Out of scope for this plan

These are intentionally not in any phase:

- A separate Shopify or third-party ecommerce platform integration. The whole point is to keep everything in the existing custom stack.
- Multi-currency / international sales. Canada-only, CAD-only initially. International is a separate plan.
- Wholesale / B2B pricing tiers. The current single-tier markup is sufficient for v1; tiered customer pricing is a Phase 3+ consideration.
- Subscription/recurring orders. Not relevant for one-off DTF apparel.
- Loyalty / rewards programs. Marketing layer; comes later.
- Mobile app. The existing Capacitor wrapper is for staff use; a customer mobile app is unnecessary since the responsive web works fine on phones.

---

## Next concrete actions

The first three things to do, in order, before any code:

1. **QBO Developer app and OAuth.** Create the app at `developer.intuit.com` requesting `com.intuit.quickbooks.accounting` and `com.intuit.quickbooks.payment` scopes. Run the OAuth flow once to get a refresh token. Capture `client_id`, `client_secret`, `realm_id`, and `refresh_token`. ~30 min, but requires Darren signed in to the QBO account.

2. **QB Payments sandbox setup.** Get sandbox credentials from QB so we can develop against test cards rather than charging real ones. ~15 min.

3. **ShipTime API key + paste of `/rates` and `/orders` request/response examples** from the docs page in your browser. The plan is designed but I need the concrete field shapes to write the integration code. ~10 min from your end.

Once those three are in hand, the code work starts with the database migration, then the pricing engine, then customer auth — that's about week 1's worth of work.

A practical decision point before week 1: **do you want me to write the code, or do you want to write it yourself with this plan as the spec, or do you want me to write the migrations and skeleton + you fill in the business logic?** Each of those is a valid working mode and I have no preference — just need to know which so I structure the next session accordingly.

Whichever way you want to work, the immediate next step is items 1–3 above. Tell me when each is done and we'll move on.
