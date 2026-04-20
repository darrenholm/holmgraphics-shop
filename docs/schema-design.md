# Schema design: Azure SQL → Railway Postgres

Notes on the reshape from the legacy Azure SQL database (`HolmGraphicsMain` on
`holmgraphics.database.windows.net`) to the current Railway Postgres. Written
during migration planning on 2026-04-19 so future sessions don't have to
rediscover the rationale.

## Background

The shop started on Azure SQL. When the SvelteKit web app + Node/Express API
were built, the API was wired to Azure SQL directly (discrete
`DB_SERVER/DB_NAME/DB_USER/DB_PASSWORD/DB_PORT` env vars pointing at
`holmgraphics.database.windows.net`). A Railway Postgres was provisioned
alongside the API service and the core table shapes were rebuilt there, but the
actual data copy and API driver swap were never completed. So at the time of
writing, the production app still reads and writes to Azure; Railway Postgres
holds an empty schema.

Azure SQL server also hosts `HolmdaleFarms`, `HolmdaleFarms_2025-05-06` (manual
backup snapshot), and `WalkertonTech` — separate projects that will be dealt
with later. The server itself stays up after this migration; only
`HolmGraphicsMain` gets decommissioned.

## Table-by-table reshape

Legacy Azure table names were `PascalCase`; Railway is `snake_case`. Several
Azure tables were consolidated or renamed during the redesign.

| Azure table        | Railway table          | Notes |
|---|---|---|
| `Clients`          | `clients`              | Straight rename. |
| `CAddress` + `AddressType` | `client_addresses` | Consolidated — address type becomes a column. |
| `ClPhone` + `PhoneType`    | `client_phones`    | Same pattern. |
| `Employee`         | `employees`            | Pluralized. |
| `Items`            | `items`                | Straight rename. |
| `LEDService`       | `led_service`          | snake_case. |
| `LEDSigns`         | `led_signs`            | snake_case. |
| `Measurements`     | `measurements`         | Merged with `Measurements2`. |
| `Measurements2`    | (dropped)              | Empty in Azure; safe to drop. |
| `Notes`            | `notes`                | Straight rename. |
| `Photos` + `Pictures` | `project_files`     | Consolidated into a generic "file attached to a project" table. |
| `Projects`         | `projects`             | Straight rename. |
| `ProjectType`      | `project_type`         | Straight rename. |
| `Status`           | `status`               | Straight rename. |
| `StatusChange`     | `audit_log`            | Generalized — not just status, meant to log any mutation. |
| `Modules`          | `modules`              | New to Railway as of 2026-04-19. |
| `Preferences`      | `client_preferences`   | Renamed to free up `preferences` for future user settings. |
| `QBItems`          | `qb_items`             | QuickBooks item catalog. |
| `ToolSN`           | `employee_tools`       | `EmpName` text → `employee_id` FK. |
| `Wifi3`            | `client_wifi`          | Dropped the "3" version suffix. |
| —                  | `alert_rules`          | New on Railway, no Azure equivalent. |

## Design decisions on deferred tables (added 2026-04-19)

These five Azure tables were left out of the initial Railway schema. Building
Postgres equivalents now so the migration is one clean cutover.

### modules (was `dbo.Modules`)

Inventory of module parts with a starting count. 13 rows in Azure.

- `ID` int identity → `id` integer identity PK.
- `ModuleIDNo` nvarchar(255) → `module_id_no` varchar(255). Keeps text even
  though observed values are numeric strings (`99999`, `7777`, `8888`) because
  we don't want to break on any non-numeric value hiding in production.
- `StartingInventory` int → `starting_inventory` integer.
- Added `created_at`, `updated_at`.

### client_preferences (was `dbo.Preferences`)

Per-client free-form notes like "Green is HP700 Kelly Green". 2 rows in Azure.

- Renamed from `preferences` to `client_preferences` to avoid future collision
  with user-settings table.
- `ClientNo` int → `client_id` integer FK to `clients(id)` with
  `ON DELETE CASCADE`.
- `Preference` ntext → `preference` text.
- Added `created_at`, `updated_at`, index on `client_id`.

### qb_items (was `dbo.QBItems`)

QuickBooks item catalog. 53 rows in Azure.

- `id` int identity → `id` integer identity PK.
- `name` nvarchar(200) → `name` varchar(200) NOT NULL.
- `item_type` nvarchar(100) → `item_type` varchar(100).
- `category` nvarchar(100) → `category` varchar(100).
- `price` float default 0 → `price` double precision NOT NULL default 0.
- `description` nvarchar(500) → `description` varchar(500).
- `active` bit default 1 → `is_active` boolean NOT NULL default true. Renamed
  to `is_active` per convention and promoted to NOT NULL (nullable bool makes
  no sense; Azure rows with NULL active get true on migration).
- Added `created_at`, `updated_at`.

### employee_tools (was `dbo.ToolSN`)

Serialized tools (drills, saws, etc.) assigned to employees. 19 rows in Azure.

- `ID` int identity → `id` integer identity PK.
- `EmpName` varchar(max) → **promoted to** `employee_id` integer FK to
  `employees(id)` with `ON DELETE SET NULL`. Migration does a name-lookup:
  Azure's "Corson" → `employees.id`. Rows that don't resolve get logged for
  manual fix (since the row count is only 19, we can eyeball any misses).
- `SerialNo` varchar(max) → `serial_no` varchar(100) NOT NULL UNIQUE.
- `ToolDesc` varchar(max) → `description` varchar(255).
- Added `created_at`, `updated_at`, index on `employee_id`.

### client_wifi (was `dbo.Wifi3`)

Client-premise wifi credentials for on-site device installs (LED signs,
cameras, etc.). 53 rows in Azure. FK on `ClientNumber → Clients.id` was
already declared in Azure.

- `ID` int identity → `id` integer identity PK.
- `ClientNumber` int → `client_id` integer FK to `clients(id)` with
  `ON DELETE CASCADE`. Nullable (matches Azure; some rows may not have a
  client association).
- `Location` varchar(max) → `location` varchar(100).
- `SSID` varchar(max) → `ssid` varchar(100).
- `Password` varchar(max) → `password` varchar(255).

**Password stored in plaintext by deliberate choice** (Darren, 2026-04-19).
Rationale: the field is consumed by staff during on-site installs, not
authenticated end users; encrypting adds a reversible operation that doesn't
defend against any realistic threat in our model (the threat being DB
exfiltration, which is already a red-alert event regardless of whether this
column is encrypted). Access must be gated at the API layer — never expose
`password` in any endpoint that isn't behind a staff auth check.

## Dropped / not migrating

- `Measurements2` — empty in Azure, confirmed disposable.

## Still-live non-HolmGraphics databases on the Azure server

Do NOT delete these during HolmGraphicsMain decommissioning:

- `HolmdaleFarms`
- `HolmdaleFarms_2025-05-06` (manual backup)
- `WalkertonTech`

Separate projects that will be handled in their own migration passes.
