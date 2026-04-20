# Azure SQL → Railway Postgres migration

One-shot data-copy tooling for the `HolmGraphicsMain` migration. Related docs:

- [`../schema-design.md`](../schema-design.md) — rationale for every Azure→Railway reshape decision
- [`001-new-tables.sql`](001-new-tables.sql) — CREATE TABLE statements for the five deferred tables (`modules`, `client_preferences`, `qb_items`, `employee_tools`, `client_wifi`)
- [`migrate-from-azure.js`](migrate-from-azure.js) — the migration script itself

## Status (as of 2026-04-19)

Fully implemented end-to-end for all 20 tables we're migrating. The script runs in strict FK-dependency tier order:

- **Tier 0** (no FK parents): `clients`, `employees`, `status`, `project_type`, `qb_items`, `modules`
- **Tier 1** (children of tier-0): `client_addresses`, `client_phones`, `client_preferences`, `client_wifi`, `employee_tools`
- **Tier 2**: `projects`
- **Tier 3** (children of projects): `items`, `led_signs`, `measurements`, `notes`, `project_files`, `audit_log`
- **Tier 4**: `led_service`

Dry-runnable and cutover-ready. Still pending: the API rewrite (task #26) that swaps the `mssql` driver for `pg`.

## Usage

This is a throwaway subproject with its own dependencies — keeps the main app's `package.json` clean.

```sh
cd docs/db-migration
cp .env.example .env        # fill in Azure creds + Railway DATABASE_URL
npm install
npm run migrate:dry         # Azure reads only, no Railway writes
npm run migrate             # the real cutover run
```

Before the real run: **ensure `001-new-tables.sql` has been applied to Railway Postgres** (via the Railway web SQL editor or `psql $DATABASE_URL < 001-new-tables.sql`). The other 15 tables are already present in Railway.

## Environment variables

See `.env.example` for the full list. Two especially worth flagging:

- **`RAILWAY_DATABASE_URL`** — do NOT use the API's internal Railway URL (it only resolves from inside Railway's private network). Use the **public** URL from Railway dashboard → Postgres → Connect → "Postgres Connection URL". Ends with `.rlwy.net` or similar.
- **`STRICT_FK_RESOLUTION`** — controls behavior when a transform can't resolve an FK (e.g., `ToolSN.EmpName = "Corson"` but no matching employee). Default `false` (log warning, set `employee_id = NULL`, keep going). Set `true` to abort the run so you can fix the source data first.

## Per-table reshape notes

Each migration function follows the same pattern: SELECT Azure → TRUNCATE Railway → row-by-row INSERT with `OVERRIDING SYSTEM VALUE` (preserves PKs so FKs survive) → reset identity sequence → record row count. Non-obvious transforms:

- **`clients`** — Azure `client_files` (ntext) is prepended into `clients.notes` so nothing is lost. Azure `email` (ntext, unlimited) is truncated to `varchar(200)` with any truncations logged.
- **`employees`** — Drops Azure `DOB` and `Ext` (not referenced in Railway). Azure `[First]` and `[Last]` → Railway `first_name` and `last_name`.
- **`status`** — Railway requires `sort_order NOT NULL` but Azure has no equivalent; script uses `id` as a stable default.
- **`client_addresses`** — Azure `CAddress.AddressType` is an int FK to `dbo.AddressType`. Script pulls `AddressType` first, builds a map, and substitutes the text label in Railway's `address_type varchar`.
- **`client_phones`** — Same pattern: `ClPhone.Type` (int FK) → Railway `phone_type` text via `dbo.PhoneType` lookup.
- **`client_preferences`** — Azure `Preference` (ntext) is explicitly `CAST`-ed to `NVARCHAR(MAX)` so mssql doesn't stream it.
- **`employee_tools`** — Azure stored employee as text (`EmpName = "Corson"`). Script builds a name → id map from Railway `employees` indexed on last name, first name, and full name. Unresolved names get `employee_id = NULL` and are logged. If `STRICT_FK_RESOLUTION=true`, the first miss aborts the run.
- **`qb_items`** — Azure `active bit` → Railway `is_active boolean NOT NULL DEFAULT TRUE`. Null is treated as TRUE.
- **`projects`** — Drops Azure `Files` (legacy file-list text, superseded by `project_files`) and `FolderPath` (NAS path is algorithmic now). `ContactEmail` truncated to 200 chars with logging.
- **`items`** — Drops `qb_item_name` (QB linkage now lives on `projects.qb_ref`).
- **`led_signs`** — Railway has a `client_id` not in Azure; script derives it by looking up `projects.client_id` via `JobNo`. Drops the Azure `SavedFile` xml column. Password fields (`wifi_password_enc`, `cloud_password_enc`) store plaintext despite the `_enc` suffix — column rename is a separate DB migration, not mixed into this cutover.
- **`measurements`** — Azure column names with parens (`[Height(in)]`, `[Width(in)]`) and spaces handled via bracket-escaping. `Measurements2` confirmed empty and not migrated.
- **`notes`** — Azure stored date and time as two columns (`Date datetime2`, `Time time`); the script combines them into one `created_at timestamp with time zone`.
- **`project_files`** — Migrates from `dbo.Photos` only. `dbo.Pictures` (inline base64 image data) is **skipped entirely** since Railway `project_files` is filename-only; the row count is logged as a warning. Azure `Photos.URL` is stashed into Railway `project_files.description` so the original link is preserved.
- **`audit_log`** — Built from `dbo.StatusChange`. Every row gets `field_changed='status_id'`, `new_value = NewStatus` cast to text, `old_value = NULL`, `employee_id = NULL`.
- **`led_service`** — Azure joined service records to projects (`JobNo`), but Railway joins to specific signs (`led_sign_id`). Script derives: if the project has exactly one LED sign, use that sign; otherwise (multiple signs or zero signs) `led_sign_id = NULL` and the row is logged for manual review.

## Cutover playbook

1. Apply `001-new-tables.sql` to Railway Postgres so the five new tables exist.
2. On the API branch `migrate-to-postgres`, swap the `mssql` package for `pg`, rewrite `db/` and every route query. (Task #26.)
3. Deploy that branch to a Railway preview environment pointing at Railway Postgres.
4. Run `npm run migrate:dry` to validate the Azure side reads cleanly and counts look right.
5. Schedule a quiet window (nobody adding jobs).
6. Run `npm run migrate` for real. Verify the row-count report is all "ok", not "MISMATCH".
7. Read any warnings the script logged — particularly unresolvable `ToolSN.EmpName`, ambiguous `LEDService` project→sign mappings, and any Pictures rows that got skipped. Decide if any need manual reconciliation.
8. Exercise the preview deployment end-to-end.
9. Flip production: merge `migrate-to-postgres` to main, which triggers a Railway redeploy against the real `DATABASE_URL`. Remove the Azure `DB_*` env vars at the same time so the old path can't accidentally reactivate.
10. Monitor for 48 hours.
11. After two weeks of clean operation, delete `HolmGraphicsMain` from Azure (keep the server — `HolmdaleFarms`/`WalkertonTech` still live there).

## If something breaks mid-run

- Run is idempotent — `TRUNCATE` + re-insert on each run. Fix the issue, re-run.
- If a particular table blows up and you want to skip it temporarily, comment it out of `main()`'s call list. Respect the tier order — skipping a parent before its children would violate FK constraints on the next run.
- Azure is read-only from this script's perspective. You cannot break Azure by running the migration.
