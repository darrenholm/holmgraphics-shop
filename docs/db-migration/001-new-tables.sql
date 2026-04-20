-- docs/db-migration/001-new-tables.sql
--
-- Postgres CREATE TABLE statements for the five deferred tables being added
-- to Railway as part of the Azure SQL → Railway Postgres migration.
--
-- Run against Railway Postgres BEFORE the data-copy step. Safe to run
-- multiple times thanks to IF NOT EXISTS. Run via Railway web SQL editor
-- (Postgres service → Data tab → New query), or psql with DATABASE_URL.
--
-- See ../schema-design.md for the rationale behind each design choice.


-- modules — inventory of module parts with starting counts.
-- Was: dbo.Modules (13 rows).
CREATE TABLE IF NOT EXISTS modules (
  id                 INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  module_id_no       VARCHAR(255),
  starting_inventory INTEGER,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- client_preferences — per-client free-form notes.
-- Was: dbo.Preferences (2 rows).  Renamed from "preferences" to avoid
-- collision with a future user-settings table.
CREATE TABLE IF NOT EXISTS client_preferences (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id  INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  preference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_client_preferences_client_id
  ON client_preferences(client_id);


-- qb_items — QuickBooks item catalog.
-- Was: dbo.QBItems (53 rows). active bit → is_active boolean NOT NULL.
CREATE TABLE IF NOT EXISTS qb_items (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        VARCHAR(200) NOT NULL,
  item_type   VARCHAR(100),
  category    VARCHAR(100),
  price       DOUBLE PRECISION NOT NULL DEFAULT 0,
  description VARCHAR(500),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- employee_tools — serialized tools assigned to employees.
-- Was: dbo.ToolSN (19 rows). EmpName text promoted to employee_id FK.
-- Migration does a name → id lookup; rows that don't resolve get NULL
-- employee_id and are logged for manual fix.
CREATE TABLE IF NOT EXISTS employee_tools (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  serial_no   VARCHAR(100) NOT NULL UNIQUE,
  description VARCHAR(255),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_employee_tools_employee_id
  ON employee_tools(employee_id);


-- client_wifi — client-premise wifi credentials for on-site device installs.
-- Was: dbo.Wifi3 (53 rows).
--
-- IMPORTANT: Password is stored IN PLAINTEXT by deliberate choice
-- (Darren, 2026-04-19). Do NOT "helpfully" encrypt this column in a future
-- migration. See ../schema-design.md for rationale. Access must be gated
-- at the API layer — never expose `password` to unauthenticated endpoints.
CREATE TABLE IF NOT EXISTS client_wifi (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id  INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  location   VARCHAR(100),
  ssid       VARCHAR(100),
  password   VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_client_wifi_client_id
  ON client_wifi(client_id);
