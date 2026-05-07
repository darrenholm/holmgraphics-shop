# Phase 2 — Direct QBO TimeActivity Sync

> Spec drafted 2026-05-06, codified 2026-05-07. Replaces the manual CSV export step from Phase 1 with a direct push to QuickBooks Online's TimeActivity API. Pay-period concept from Phase 1.6 stays exactly the same; only the delivery mechanism changes.

## Background

Holm Graphics currently uses **OnTheClock** to ship time entries into QuickBooks Online for payroll. Phase 1 of the in-house time-tracking module produces a CSV that gets imported into QBO Time Tracking manually. Phase 1.6 wraps that in pay-period structure. Phase 2 lights up an in-house QBO connection so the shop talks directly to QBO — eliminating the CSV step and letting us retire OnTheClock.

## Decisions locked in

| Question | Decision |
|---|---|
| QBO tier | **Plus** — confirmed, supports TimeActivity API |
| Intuit Developer account | **None yet** — Claude/Darren creates a custom app at developer.intuit.com during build |
| OAuth connector | **Darren** clicks "Connect to QuickBooks" once in the shop admin |
| Employee mapping | **Confirm names match in QBO manually**; build a one-time mapping UI as a safety net |
| Time entry shape | **Plain hours** — `EmployeeRef + TxnDate + Hours/Minutes`, `BillableStatus: NotBillable`, no `CustomerRef`, no `ServiceItem`. Mirrors what OnTheClock does today. Job attribution is Phase 1.5 / future. |
| Service Item | **Leave blank** |
| CSV button | **Keep as fallback** for first month after Phase 2 ships, then remove |
| Edit-after-sync policy | **Allow edits, mark dirty, manual re-sync** sends only changed entries |
| OnTheClock cutover | **Parallel run for one pay period.** Phase 2 + OTC both push for one cycle, Darren manually crosschecks totals, then disconnects OTC. Both sources running = duplicate entries, accepted for one cycle only. |

## Architecture

- **Auth library:** `intuit-oauth` (official Intuit SDK) for OAuth dance; raw `fetch` for TimeActivity API calls.
- **Token storage:** plaintext in DB. DB is private; column-level encryption can come later.
- **Realm:** dev against Intuit sandbox first (free, instant), flip to production via `QBO_ENVIRONMENT` env var when ready.
- **Sync atomicity:** per-entry POSTs. Partial sync OK — each `time_entry` tracks its own state, errors don't poison the whole batch.

## DB migrations

### `018_qbo_connection.sql`

```sql
CREATE TABLE qbo_connection (
  id                       SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),  -- enforce singleton
  realm_id                 TEXT NOT NULL,
  access_token             TEXT NOT NULL,
  refresh_token            TEXT NOT NULL,
  access_token_expires_at  TIMESTAMPTZ NOT NULL,
  refresh_token_expires_at TIMESTAMPTZ NOT NULL,
  connected_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  connected_by_employee_id INTEGER REFERENCES employees(id),
  last_refreshed_at        TIMESTAMPTZ
);
```

### `019_qbo_employee_mapping.sql`

```sql
CREATE TABLE qbo_employee_mapping (
  employee_id        INTEGER PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
  qbo_employee_id    TEXT NOT NULL,
  qbo_employee_name  TEXT NOT NULL,  -- denormalized for display
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### `020_time_entries_qbo_sync.sql`

```sql
ALTER TABLE time_entries
  ADD COLUMN qbo_time_activity_id TEXT,
  ADD COLUMN qbo_synced_at        TIMESTAMPTZ,
  ADD COLUMN qbo_sync_dirty       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN qbo_last_sync_error  TEXT;

-- Trigger: any UPDATE to a synced entry flips dirty=true so admin re-syncs.
CREATE OR REPLACE FUNCTION time_entries_qbo_dirty_on_edit()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.qbo_time_activity_id IS NOT NULL
     AND (OLD.clock_in IS DISTINCT FROM NEW.clock_in
       OR OLD.clock_out IS DISTINCT FROM NEW.clock_out
       OR OLD.notes IS DISTINCT FROM NEW.notes
       OR OLD.employee_id IS DISTINCT FROM NEW.employee_id) THEN
    NEW.qbo_sync_dirty := TRUE;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER time_entries_qbo_dirty_trigger
  BEFORE UPDATE ON time_entries
  FOR EACH ROW
  EXECUTE FUNCTION time_entries_qbo_dirty_on_edit();

ALTER TABLE pay_periods ADD COLUMN qbo_synced_at TIMESTAMPTZ;
```

## API endpoints

```
GET    /api/qbo/connection                 connection status (connected? realm? user?)
POST   /api/qbo/auth/start                 returns Intuit OAuth URL with CSRF state
GET    /api/qbo/auth/callback              Intuit redirects here; swap code→tokens
POST   /api/qbo/disconnect                 revoke + drop the row

GET    /api/qbo/employees                  fetch QBO Employee list (for mapping UI)
GET    /api/qbo/employee-map               current shop→QBO mappings
POST   /api/qbo/employee-map               { employee_id, qbo_employee_id }
DELETE /api/qbo/employee-map/:id           remove a mapping

POST   /api/qbo/sync/pay-period/:id        bulk push entries for a period
POST   /api/qbo/sync/entry/:id             single-entry resync (for dirty entries)
```

All QBO-side endpoints route through a `withFreshToken()` helper that refreshes the access token if it's within 5 min of expiry. Admin-only auth on every endpoint.

## TimeActivity payload

```json
{
  "TxnDate": "2026-05-04",
  "NameOf": "Employee",
  "EmployeeRef": { "value": "<qbo_employee_id>" },
  "Hours": 7,
  "Minutes": 30,
  "Description": "<entry.notes or empty>",
  "BillableStatus": "NotBillable"
}
```

POST to `/v3/company/{realm_id}/timeactivity`. For dirty resync, POST to `/v3/company/{realm_id}/timeactivity?operation=update` with `Id` and `SyncToken`.

## UI changes

### New: `/admin/integrations/qbo`

- Connection status card: Connected/Disconnected, realm ID, connected at, by whom
- "Connect to QuickBooks" / "Disconnect" button
- Employee mapping table:
  - Left column: shop employees (from `employees` table)
  - Right column: dropdown of QBO employees (from `/api/qbo/employees`)
  - Save button per row, or save-all
  - Visual indicator when a shop employee has no mapping yet

Sidebar: new admin link **QBO Integration** under Pay Periods.

### Modified: `/admin/timesheets/export`

- Two buttons side-by-side: **"Sync to QBO"** (primary, replaces Download CSV as default action) and **"Download CSV"** (secondary, fallback)
- Status line under selected period:
  - `Synced 12/15 entries · Last sync 2:14 PM · 3 errors` (3 errors clickable to expand)
  - `Not synced yet` if no QBO sync has run
  - `2 dirty entries to resync` if some were edited post-sync
- Disabled with "Connect QuickBooks first" link if no connection
- After sync: show success/failure summary with per-entry error details

### Modified: `/admin/timesheets`

- Per-entry status badge in the right gutter:
  - `Synced` (green) — pushed to QBO, hover shows TimeActivity ID
  - `Pending` (gray) — eligible but not yet synced
  - `Dirty` (orange) — was synced, then edited, needs resync
  - `Failed` (red) — attempted sync but errored (hover shows the error)
- Edit-after-sync flips badge to `Dirty` automatically (DB trigger)

## Build order

1. **Migrations 018–020** in API repo, run on Railway dev branch first
2. **OAuth flow** + token refresh helper (`routes/qbo-auth.js`, `lib/qbo-client.js`)
3. **Employee mapping** endpoints + admin UI page
4. **Sync endpoints** + sandbox testing (the bulk of the work)
5. **Sync button** on export page
6. **Per-entry status badges** in timesheets
7. **Switch sandbox → production** via env var, do parallel-run pay period with OTC
8. **Disconnect OTC** after one matched pay period

## Effort estimate

~1.5 days of focused build, plus 1 pay period of parallel running for crosscheck.

- Build: week of May 11
- Parallel run: pay period **May 14–27**
- OTC disconnect: **May 28** (assuming no discrepancies)

## Pre-work for Darren (before coding starts)

1. **Verify QBO employee names match shop employee names.** Open QBO → Payroll → Employees, compare against shop employees table. If anything is off (e.g. nicknames vs. legal names), note them. The mapping UI will let us reconcile, but knowing in advance helps the smoke test.
2. **Sit tight on Intuit Developer Account.** Claude Code (or whoever builds) creates the app; Darren just needs to do the OAuth click-through once after the app is wired up.

## Open questions / decisions punted

- **Job attribution (Phase 1.5)** — separate concern. Once shop time entries have a `job_id` attribution, we'd extend Phase 2 to populate `CustomerRef` from a job→customer mapping. Out of scope for Phase 2.
- **Multiple QBO companies** — the singleton `qbo_connection` table assumes one QBO realm. If Holm ever has multiple QBO entities, this needs a small refactor.
- **Token encryption at rest** — plaintext for now. Worth adding pgcrypto later if security posture changes.
- **Webhook for QBO-side edits** — if someone edits a TimeActivity directly in QBO, we have no signal. Phase 2 is one-way (shop → QBO). Phase 3 (out of scope) could add Intuit webhook subscriptions for back-sync.

## Reference

- Intuit Developer docs: https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/timeactivity
- intuit-oauth library: https://github.com/intuit/oauth-jsclient
- TimeActivity entity ref: includes Hours, Minutes, EmployeeRef, BillableStatus, optional CustomerRef/ItemRef
- Sandbox setup: developer.intuit.com → Dashboard → Apps → New app → "QuickBooks Online and Payments"
