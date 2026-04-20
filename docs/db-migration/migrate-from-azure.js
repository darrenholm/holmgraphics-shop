#!/usr/bin/env node
//
// docs/db-migration/migrate-from-azure.js
//
// Azure SQL (HolmGraphicsMain) → Railway Postgres one-shot migration.
//
// What this script does, in order:
//   1. Connect to both databases (aborts if either fails).
//   2. For each table, in FK-dependency tier order:
//        a. TRUNCATE the Railway table so re-runs are clean.
//        b. SELECT from Azure (CAST ntext to NVARCHAR(MAX) for safe streaming).
//        c. Transform each row (rename, consolidate, resolve FKs).
//        d. INSERT into Railway preserving the original primary key.
//        e. Reset the Postgres identity sequence to MAX(id)+1.
//   3. Print a per-table row-count comparison for verification.
//
// Safety:
//   - TRUNCATE ... RESTART IDENTITY CASCADE is destructive. Never run this
//     against a Railway DB that holds data you want to keep.
//   - --dry-run does all Azure reads, skips all Railway writes, still prints
//     the report. Use this to validate the source side before committing.
//
// Dependency tiers (enforced by main()'s call order):
//   Tier 0 (no FK parents):
//     clients, employees, status, project_type, qb_items, modules
//   Tier 1 (children of tier-0 parents):
//     client_addresses, client_phones, client_preferences, client_wifi,
//     employee_tools
//   Tier 2:
//     projects (→ clients, status, project_type, employees)
//   Tier 3 (children of projects):
//     items, led_signs, measurements, notes, project_files, audit_log
//   Tier 4:
//     led_service (→ led_signs)
//
// Known reshape decisions (see docs/schema-design.md for rationale):
//   - Clients.client_files (ntext)     → prepended to clients.notes
//   - Clients.email (ntext)            → truncated to varchar(200); truncations logged
//   - Employee.DOB, Ext                → dropped
//   - CAddress.AddressType (int FK)    → resolved to text via AddressType lookup
//   - ClPhone.Type       (int FK)      → resolved to text via PhoneType lookup
//   - Status.sort_order                → filled with id (stable default)
//   - Projects.Files, FolderPath       → dropped
//   - Items.qb_item_name               → dropped
//   - StatusChange                     → audit_log with field_changed='status_id'
//   - Photos                           → project_files.filename, URL stashed in description
//   - Pictures                         → skipped entirely (inline image data doesn't fit)
//   - LEDSigns.SavedFile (xml)         → dropped
//   - LEDSigns.client_id (not in src)  → derived from projects via JobNo lookup
//   - LEDService.JobNo → led_sign_id   → one-sign projects auto-resolved;
//                                          multi-sign or zero-sign → NULL + logged
//   - Measurements2                    → dropped (empty)
//   - led_signs.*_enc columns          → plaintext stored despite misleading name

'use strict';
require('dotenv').config();

const sql = require('mssql');
const { Pool } = require('pg');

// ---------- Config ------------------------------------------------------

const AZURE_CONFIG = {
  server:   need('AZURE_DB_SERVER'),
  database: need('AZURE_DB_NAME'),
  user:     need('AZURE_DB_USER'),
  password: need('AZURE_DB_PASSWORD'),
  port:     Number(process.env.AZURE_DB_PORT || 1433),
  options:  { encrypt: true, trustServerCertificate: false }
};
const RAILWAY_DATABASE_URL  = need('RAILWAY_DATABASE_URL');
const STRICT_FK_RESOLUTION  = process.env.STRICT_FK_RESOLUTION === 'true';
const DRY_RUN               = process.argv.includes('--dry-run');

function need(name) {
  const v = process.env[name];
  if (!v) { console.error(`[migrate] missing env var: ${name}`); process.exit(1); }
  return v;
}

// ---------- Logging helpers --------------------------------------------

const chalk = { green: s => `\x1b[32m${s}\x1b[0m`, red: s => `\x1b[31m${s}\x1b[0m`, dim: s => `\x1b[2m${s}\x1b[0m` };
function log(...args) { console.log('[migrate]', ...args); }
function warn(...args) { console.warn('[migrate]', chalk.red('WARN'), ...args); }

// ---------- DB helpers -------------------------------------------------

// Exec a single statement against Postgres, honoring --dry-run.
async function pgExec(pg, sqlText, params = []) {
  if (DRY_RUN) return { rowCount: 0, rows: [] };
  return pg.query(sqlText, params);
}

// Reset the identity sequence backing `table.idColumn` so the next
// auto-generated ID is greater than anything we inserted.
async function resetSequence(pg, table, idColumn = 'id') {
  if (DRY_RUN) return;
  await pg.query(
    `SELECT setval(
       pg_get_serial_sequence($1, $2),
       COALESCE((SELECT MAX(${idColumn}) FROM ${table}), 0) + 1,
       false
     )`,
    [table, idColumn]
  );
}

// Truncate varchar(N) values that came from ntext/nvarchar(MAX), logging any
// trimming that happens. Returns the (possibly truncated) value. `context`
// labels the row for log messages (e.g., 'clients.email id=42').
function truncVarchar(value, max, context, log_collector) {
  if (value == null) return value;
  if (value.length <= max) return value;
  log_collector.push({ context, origLen: value.length, max });
  return value.slice(0, max);
}

// Build name → id map for FK resolution. Used by employee_tools migration:
// Azure stored employee as text (EmpName), Railway uses employee_id FK.
// We index on last name, first name, and "first last" so the migration can
// match whichever convention a given Azure row used.
async function buildEmployeeNameMap(pg) {
  if (DRY_RUN) return new Map();
  const { rows } = await pg.query('SELECT id, first_name, last_name FROM employees');
  const m = new Map();
  for (const r of rows) {
    if (r.last_name)  m.set(r.last_name.trim().toLowerCase(),  r.id);
    if (r.first_name) m.set(r.first_name.trim().toLowerCase(), r.id);
    if (r.first_name && r.last_name) {
      m.set(`${r.first_name} ${r.last_name}`.trim().toLowerCase(), r.id);
    }
  }
  return m;
}

// Normalize a SQL Server `bit` column (returned as true/false/1/0/null by
// the mssql driver) to a strict boolean. Treats null as `defaultValue`.
function bitToBool(v, defaultValue = true) {
  if (v === null || v === undefined) return defaultValue;
  return v === true || v === 1;
}

// Combine a date column and a time column (both returned as Date objects by
// the mssql driver) into one JS Date. Uses UTC throughout since the mssql
// driver's `useUTC` default is true.
function combineDateTime(dateVal, timeVal) {
  if (!dateVal) return null;
  const d = new Date(dateVal);
  if (timeVal instanceof Date) {
    d.setUTCHours(
      timeVal.getUTCHours(),
      timeVal.getUTCMinutes(),
      timeVal.getUTCSeconds(),
      timeVal.getUTCMilliseconds()
    );
  }
  return d;
}

// ---------- Row-count report ------------------------------------------

const report = []; // { table, azure, railway, mismatch }
function record(table, azure, railway) {
  report.push({ table, azure, railway, mismatch: azure !== railway });
}

async function countRailway(pg, table) {
  if (DRY_RUN) return null;
  const { rows } = await pg.query(`SELECT COUNT(*)::int AS n FROM ${table}`);
  return rows[0].n;
}

// =====================================================================
// Tier 0 — parents (no outgoing FKs)
// =====================================================================

async function migrateClients(azure, pg) {
  log('clients');
  const { recordset } = await azure.request().query(
    `SELECT id, company, fname, lname,
            CAST(email         AS NVARCHAR(MAX)) AS email,
            CAST(client_files  AS NVARCHAR(MAX)) AS client_files,
            qb_customer_id
       FROM dbo.Clients`
  );
  await pgExec(pg, 'TRUNCATE TABLE clients RESTART IDENTITY CASCADE');
  const truncations = [];
  for (const r of recordset) {
    // Per reshape decision: don't lose client_files; stash it in notes.
    const notes = r.client_files
      ? `Legacy client_files (migrated ${new Date().toISOString().slice(0,10)}):\n${r.client_files}`
      : null;
    const email = truncVarchar(r.email, 200, `clients.email id=${r.id}`, truncations);
    await pgExec(pg,
      `INSERT INTO clients (id, company, fname, lname, email, notes, qb_customer_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [r.id, r.company, r.fname, r.lname, email, notes, r.qb_customer_id]
    );
  }
  await resetSequence(pg, 'clients');
  if (truncations.length) {
    warn(`${truncations.length} values truncated:`);
    for (const t of truncations) console.warn(`  - ${t.context} origLen=${t.origLen} kept=${t.max}`);
  }
  record('clients', recordset.length, await countRailway(pg, 'clients'));
}

async function migrateEmployees(azure, pg) {
  log('employees');
  // Drop: DOB, Ext (per reshape decisions).
  const { recordset } = await azure.request().query(
    `SELECT EmpNo, [First] AS FirstName, [Last] AS LastName,
            Cell, Active, Email, PasswordHash, Role
       FROM dbo.Employee`
  );
  await pgExec(pg, 'TRUNCATE TABLE employees RESTART IDENTITY CASCADE');
  for (const r of recordset) {
    await pgExec(pg,
      `INSERT INTO employees (id, first_name, last_name, cell, active, email, password_hash, role)
       VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, 'staff'))`,
      [r.EmpNo, r.FirstName, r.LastName, r.Cell, bitToBool(r.Active, true),
       r.Email, r.PasswordHash, r.Role]
    );
  }
  await resetSequence(pg, 'employees');
  record('employees', recordset.length, await countRailway(pg, 'employees'));
}

async function migrateStatus(azure, pg) {
  log('status');
  // Railway.status.sort_order is NOT NULL with no Azure source; use id.
  const { recordset } = await azure.request().query(
    'SELECT ID, [Status] AS StatusName FROM dbo.Status ORDER BY ID'
  );
  await pgExec(pg, 'TRUNCATE TABLE status RESTART IDENTITY CASCADE');
  for (const r of recordset) {
    await pgExec(pg,
      `INSERT INTO status (id, name, sort_order)
       VALUES ($1, $2, $3)`,
      [r.ID, r.StatusName, r.ID]
    );
  }
  await resetSequence(pg, 'status');
  record('status', recordset.length, await countRailway(pg, 'status'));
}

async function migrateProjectType(azure, pg) {
  log('project_type');
  const { recordset } = await azure.request().query(
    'SELECT ID, ProjectType FROM dbo.ProjectType'
  );
  await pgExec(pg, 'TRUNCATE TABLE project_type RESTART IDENTITY CASCADE');
  for (const r of recordset) {
    await pgExec(pg,
      `INSERT INTO project_type (id, name)
       VALUES ($1, $2)`,
      [r.ID, r.ProjectType]
    );
  }
  await resetSequence(pg, 'project_type');
  record('project_type', recordset.length, await countRailway(pg, 'project_type'));
}

async function migrateQbItems(azure, pg) {
  log('qb_items');
  const { recordset } = await azure.request().query(
    'SELECT id, name, item_type, category, price, description, active FROM dbo.QBItems'
  );
  await pgExec(pg, 'TRUNCATE TABLE qb_items RESTART IDENTITY CASCADE');
  for (const r of recordset) {
    await pgExec(pg,
      `INSERT INTO qb_items (id, name, item_type, category, price, description, is_active)
       OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [r.id, r.name, r.item_type, r.category, r.price, r.description, bitToBool(r.active, true)]
    );
  }
  await resetSequence(pg, 'qb_items');
  record('qb_items', recordset.length, await countRailway(pg, 'qb_items'));
}

async function migrateModules(azure, pg) {
  log('modules');
  const { recordset } = await azure.request().query(
    'SELECT ID, ModuleIDNo, StartingInventory FROM dbo.Modules'
  );
  await pgExec(pg, 'TRUNCATE TABLE modules RESTART IDENTITY CASCADE');
  for (const r of recordset) {
    await pgExec(pg,
      `INSERT INTO modules (id, module_id_no, starting_inventory)
       OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3)`,
      [r.ID, r.ModuleIDNo, r.StartingInventory]
    );
  }
  await resetSequence(pg, 'modules');
  record('modules', recordset.length, await countRailway(pg, 'modules'));
}

// =====================================================================
// Tier 1 — children of tier-0 parents
// =====================================================================

async function migrateClientAddresses(azure, pg) {
  log('client_addresses (consolidates CAddress + AddressType)');
  // Pull AddressType lookup so we can substitute ID with text.
  const { recordset: atypes } = await azure.request().query(
    'SELECT ID, AddressType FROM dbo.AddressType'
  );
  const addressTypeMap = new Map(atypes.map(r => [r.ID, r.AddressType]));
  const { recordset } = await azure.request().query(
    `SELECT ID, ClientNo, AddressType AS AddressTypeId,
            Address1, Address2, Town, Province, PostalCode
       FROM dbo.CAddress`
  );
  await pgExec(pg, 'TRUNCATE TABLE client_addresses RESTART IDENTITY CASCADE');
  for (const r of recordset) {
    const addressType = r.AddressTypeId != null
      ? (addressTypeMap.get(r.AddressTypeId) ?? null)
      : null;
    await pgExec(pg,
      `INSERT INTO client_addresses
         (id, client_id, address_type, address1, address2, town, province, postal_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [r.ID, r.ClientNo, addressType, r.Address1, r.Address2, r.Town, r.Province, r.PostalCode]
    );
  }
  await resetSequence(pg, 'client_addresses');
  record('client_addresses', recordset.length, await countRailway(pg, 'client_addresses'));
}

async function migrateClientPhones(azure, pg) {
  log('client_phones (consolidates ClPhone + PhoneType)');
  const { recordset: ptypes } = await azure.request().query(
    'SELECT ID, [Type] AS PhoneTypeName FROM dbo.PhoneType'
  );
  const phoneTypeMap = new Map(ptypes.map(r => [r.ID, r.PhoneTypeName]));
  const { recordset } = await azure.request().query(
    'SELECT ID, ClNo, [Type] AS PhoneTypeId, Number, Ext FROM dbo.ClPhone'
  );
  await pgExec(pg, 'TRUNCATE TABLE client_phones RESTART IDENTITY CASCADE');
  for (const r of recordset) {
    const phoneType = r.PhoneTypeId != null
      ? (phoneTypeMap.get(r.PhoneTypeId) ?? null)
      : null;
    await pgExec(pg,
      `INSERT INTO client_phones (id, client_id, phone_type, number, ext)
       VALUES ($1, $2, $3, $4, $5)`,
      [r.ID, r.ClNo, phoneType, r.Number, r.Ext]
    );
  }
  await resetSequence(pg, 'client_phones');
  record('client_phones', recordset.length, await countRailway(pg, 'client_phones'));
}

async function migrateClientPreferences(azure, pg) {
  log('client_preferences');
  const { recordset } = await azure.request().query(
    `SELECT ID, ClientNo, CAST(Preference AS NVARCHAR(MAX)) AS Preference
       FROM dbo.Preferences`
  );
  await pgExec(pg, 'TRUNCATE TABLE client_preferences RESTART IDENTITY CASCADE');
  for (const r of recordset) {
    await pgExec(pg,
      `INSERT INTO client_preferences (id, client_id, preference)
       OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3)`,
      [r.ID, r.ClientNo, r.Preference]
    );
  }
  await resetSequence(pg, 'client_preferences');
  record('client_preferences', recordset.length, await countRailway(pg, 'client_preferences'));
}

async function migrateClientWifi(azure, pg) {
  log('client_wifi');
  const { recordset } = await azure.request().query(
    'SELECT ID, ClientNumber, Location, SSID, Password FROM dbo.Wifi3'
  );
  await pgExec(pg, 'TRUNCATE TABLE client_wifi RESTART IDENTITY CASCADE');
  for (const r of recordset) {
    await pgExec(pg,
      `INSERT INTO client_wifi (id, client_id, location, ssid, password)
       OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, $5)`,
      [r.ID, r.ClientNumber, r.Location, r.SSID, r.Password]
    );
  }
  await resetSequence(pg, 'client_wifi');
  record('client_wifi', recordset.length, await countRailway(pg, 'client_wifi'));
}

async function migrateEmployeeTools(azure, pg) {
  log('employee_tools');
  const empMap = await buildEmployeeNameMap(pg);
  const { recordset } = await azure.request().query(
    'SELECT ID, EmpName, SerialNo, ToolDesc FROM dbo.ToolSN'
  );
  await pgExec(pg, 'TRUNCATE TABLE employee_tools RESTART IDENTITY CASCADE');
  const unresolved = [];
  for (const r of recordset) {
    const key = (r.EmpName || '').trim().toLowerCase();
    const empId = empMap.get(key) ?? null;
    if (r.EmpName && !empId) unresolved.push({ toolId: r.ID, empName: r.EmpName });
    if (!empId && STRICT_FK_RESOLUTION) {
      throw new Error(`STRICT_FK_RESOLUTION: ToolSN row ${r.ID} EmpName="${r.EmpName}" has no employees match`);
    }
    await pgExec(pg,
      `INSERT INTO employee_tools (id, employee_id, serial_no, description)
       OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4)`,
      [r.ID, empId, r.SerialNo, r.ToolDesc]
    );
  }
  await resetSequence(pg, 'employee_tools');
  if (unresolved.length) {
    warn(`${unresolved.length} employee_tools rows had unresolvable EmpName:`);
    for (const u of unresolved) console.warn(`  - id=${u.toolId} EmpName="${u.empName}"`);
  }
  record('employee_tools', recordset.length, await countRailway(pg, 'employee_tools'));
}

// =====================================================================
// Tier 2 — projects (child of clients, status, project_type, employees)
// =====================================================================

async function migrateProjects(azure, pg) {
  log('projects');
  // Drop: Files (ntext — legacy file list text), FolderPath (NAS path is algorithmic now).
  const { recordset } = await azure.request().query(
    `SELECT JobNo, Client, [Date] AS CreatedDate,
            Contact, ContactPhone,
            CAST(ContactEmail AS NVARCHAR(MAX)) AS ContactEmail,
            CAST(Description  AS NVARCHAR(MAX)) AS Description,
            DueDate, [Status] AS StatusId, Sales, Production, ProjectType
       FROM dbo.Projects`
  );
  await pgExec(pg, 'TRUNCATE TABLE projects RESTART IDENTITY CASCADE');
  const truncations = [];
  for (const r of recordset) {
    const email = truncVarchar(r.ContactEmail, 200, `projects.contact_email id=${r.JobNo}`, truncations);
    await pgExec(pg,
      `INSERT INTO projects (
         id, client_id, project_type_id, status_id,
         contact_name, contact_phone, contact_email, description,
         created_date, due_date, sales_emp_id, production_emp_id
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
       )`,
      [r.JobNo, r.Client, r.ProjectType, r.StatusId,
       r.Contact, r.ContactPhone, email, r.Description,
       r.CreatedDate, r.DueDate, r.Sales, r.Production]
    );
  }
  await resetSequence(pg, 'projects');
  if (truncations.length) {
    warn(`${truncations.length} values truncated:`);
    for (const t of truncations) console.warn(`  - ${t.context} origLen=${t.origLen} kept=${t.max}`);
  }
  record('projects', recordset.length, await countRailway(pg, 'projects'));
}

// =====================================================================
// Tier 3 — children of projects
// =====================================================================

async function migrateItems(azure, pg) {
  log('items');
  // Drop: qb_item_name (QB link now lives on project.qb_ref).
  const { recordset } = await azure.request().query(
    `SELECT ID, ProjectNo, Qty,
            CAST(Description AS NVARCHAR(MAX)) AS Description,
            Price, ExtPrice
       FROM dbo.Items`
  );
  await pgExec(pg, 'TRUNCATE TABLE items RESTART IDENTITY CASCADE');
  for (const r of recordset) {
    await pgExec(pg,
      `INSERT INTO items (id, project_id, qty, description, price, ext_price)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [r.ID, r.ProjectNo, r.Qty, r.Description, r.Price, r.ExtPrice]
    );
  }
  await resetSequence(pg, 'items');
  record('items', recordset.length, await countRailway(pg, 'items'));
}

async function migrateLedSigns(azure, pg) {
  log('led_signs');
  // Derive client_id from projects.client_id via JobNo → project id.
  let projectClientMap = new Map();
  if (!DRY_RUN) {
    const { rows } = await pg.query('SELECT id, client_id FROM projects');
    projectClientMap = new Map(rows.map(r => [r.id, r.client_id]));
  }
  // Drop: SavedFile (xml).
  // NOTE: bracketed names handle column names with spaces.
  const { recordset } = await azure.request().query(
    `SELECT ID, JobNo,
            CAST([Sign Name]    AS NVARCHAR(MAX)) AS SignName,
            CAST([Location]     AS NVARCHAR(MAX)) AS Location,
            CAST(ControlSystem  AS NVARCHAR(MAX)) AS ControlSystem,
            Pitch, Widthmm, Heightmm, SerialNumber,
            CAST(InventoryNo    AS NVARCHAR(MAX)) AS InventoryNo,
            ModuleSize, PowerSupply, ESANo, Faces, Cabinets, InstallDate,
            Voltage, [Total Amp] AS TotalAmp,
            WifiSSID, WifiPassword, CloudUsername, CloudPassword,
            CellularPhoneNumber
       FROM dbo.LEDSigns`
  );
  await pgExec(pg, 'TRUNCATE TABLE led_signs RESTART IDENTITY CASCADE');
  for (const r of recordset) {
    const clientId = r.JobNo != null ? (projectClientMap.get(r.JobNo) ?? null) : null;
    const cellular = r.CellularPhoneNumber != null ? String(r.CellularPhoneNumber) : null;
    await pgExec(pg,
      `INSERT INTO led_signs (
         id, project_id, client_id, sign_name, location, control_system,
         pitch, width_mm, height_mm, serial_number, inventory_no,
         module_size, power_supply, esa_no, faces, cabinets, install_date,
         voltage, total_amp,
         wifi_ssid, wifi_password_enc, cloud_username, cloud_password_enc,
         cellular_number
       )
       VALUES (
         $1, $2, $3, $4, $5, $6,
         $7, $8, $9, $10, $11,
         $12, $13, $14, $15, $16, $17,
         $18, $19,
         $20, $21, $22, $23,
         $24
       )`,
      [r.ID, r.JobNo, clientId, r.SignName, r.Location, r.ControlSystem,
       r.Pitch, r.Widthmm, r.Heightmm, r.SerialNumber, r.InventoryNo,
       r.ModuleSize, r.PowerSupply, r.ESANo, r.Faces, r.Cabinets, r.InstallDate,
       r.Voltage, r.TotalAmp,
       r.WifiSSID, r.WifiPassword, r.CloudUsername, r.CloudPassword,
       cellular]
    );
  }
  await resetSequence(pg, 'led_signs');
  record('led_signs', recordset.length, await countRailway(pg, 'led_signs'));
}

async function migrateMeasurements(azure, pg) {
  log('measurements (Measurements only; Measurements2 confirmed empty)');
  const { recordset } = await azure.request().query(
    `SELECT ID, JobNo,
            CAST([Item]    AS NVARCHAR(MAX)) AS Item,
            [Height(in)]   AS HeightIn,
            [Width(in)]    AS WidthIn,
            CAST([Comment] AS NVARCHAR(MAX)) AS Comment
       FROM dbo.Measurements`
  );
  await pgExec(pg, 'TRUNCATE TABLE measurements RESTART IDENTITY CASCADE');
  for (const r of recordset) {
    await pgExec(pg,
      `INSERT INTO measurements (id, project_id, item, height_in, width_in, comment)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [r.ID, r.JobNo, r.Item, r.HeightIn, r.WidthIn, r.Comment]
    );
  }
  await resetSequence(pg, 'measurements');
  record('measurements', recordset.length, await countRailway(pg, 'measurements'));
}

async function migrateNotes(azure, pg) {
  log('notes');
  const { recordset } = await azure.request().query(
    `SELECT ID, ProjectNo, [Date] AS DateVal, [Time] AS TimeVal,
            CAST(Note AS NVARCHAR(MAX)) AS Note
       FROM dbo.Notes`
  );
  await pgExec(pg, 'TRUNCATE TABLE notes RESTART IDENTITY CASCADE');
  for (const r of recordset) {
    const createdAt = combineDateTime(r.DateVal, r.TimeVal);
    await pgExec(pg,
      `INSERT INTO notes (id, project_id, note, created_at)
       VALUES ($1, $2, $3, COALESCE($4, now()))`,
      [r.ID, r.ProjectNo, r.Note, createdAt]
    );
  }
  await resetSequence(pg, 'notes');
  record('notes', recordset.length, await countRailway(pg, 'notes'));
}

async function migrateProjectFiles(azure, pg) {
  log('project_files (Photos only; Pictures skipped per design)');
  const { recordset } = await azure.request().query(
    'SELECT ID, ProjectNo, Filename, URL, UploadedAt FROM dbo.Photos'
  );
  // Count Pictures so the report shows what we skipped — but don't INSERT.
  const { recordset: picRows } = await azure.request().query(
    'SELECT COUNT(*) AS n FROM dbo.Pictures'
  );
  const picturesCount = picRows[0].n;
  if (picturesCount > 0) {
    warn(`skipping ${picturesCount} rows from dbo.Pictures — inline image data doesn't fit project_files (filename-only).`);
  }
  await pgExec(pg, 'TRUNCATE TABLE project_files RESTART IDENTITY CASCADE');
  for (const r of recordset) {
    // Don't lose Photos.URL — stash it in description.
    const description = r.URL ? `Legacy URL: ${r.URL}` : null;
    await pgExec(pg,
      `INSERT INTO project_files (id, project_id, filename, description, uploaded_at)
       VALUES ($1, $2, $3, $4, COALESCE($5, now()))`,
      [r.ID, r.ProjectNo, r.Filename, description, r.UploadedAt]
    );
  }
  await resetSequence(pg, 'project_files');
  record('project_files', recordset.length, await countRailway(pg, 'project_files'));
}

async function migrateAuditLog(azure, pg) {
  log('audit_log (from StatusChange)');
  const { recordset } = await azure.request().query(
    'SELECT ID, ProjectNo, NewStatus, UpdateTime FROM dbo.StatusChange'
  );

  // Build a Set of valid project IDs so we can skip StatusChange rows that
  // reference projects that no longer exist (orphans in the Azure source).
  const validProjectIds = new Set();
  if (!DRY_RUN) {
    const { rows } = await pg.query('SELECT id FROM projects');
    for (const r of rows) validProjectIds.add(r.id);
  }

  await pgExec(pg, 'TRUNCATE TABLE audit_log RESTART IDENTITY CASCADE');
  const orphans = [];
  let inserted = 0;
  for (const r of recordset) {
    if (!DRY_RUN && !validProjectIds.has(r.ProjectNo)) {
      orphans.push({ id: r.ID, ProjectNo: r.ProjectNo });
      continue;
    }
    await pgExec(pg,
      `INSERT INTO audit_log
         (id, project_id, employee_id, field_changed, old_value, new_value, changed_at)
       VALUES
         ($1, $2, NULL, 'status_id', NULL, $3, COALESCE($4, now()))`,
      [r.ID, r.ProjectNo, r.NewStatus != null ? String(r.NewStatus) : null, r.UpdateTime]
    );
    inserted++;
  }
  if (orphans.length > 0) {
    warn(`${orphans.length} StatusChange rows skipped — ProjectNo not in projects table:`);
    for (const o of orphans) console.warn(`  - StatusChange.ID=${o.id} ProjectNo=${o.ProjectNo}`);
  }
  await resetSequence(pg, 'audit_log');
  record('audit_log', recordset.length, await countRailway(pg, 'audit_log'));
}

// =====================================================================
// Tier 4 — led_service (child of led_signs)
// =====================================================================

async function migrateLedService(azure, pg) {
  log('led_service');
  // Azure joined service to project (JobNo). Railway joins to a specific
  // led_sign_id. Resolve by project → signs; if exactly one sign on the
  // project, use it. Otherwise leave NULL and log.
  let projectSignMap = new Map();       // project_id → first sign id
  const projectSignCountMap = new Map(); // project_id → count of signs
  if (!DRY_RUN) {
    const { rows } = await pg.query(
      'SELECT id, project_id FROM led_signs WHERE project_id IS NOT NULL'
    );
    for (const row of rows) {
      const c = projectSignCountMap.get(row.project_id) ?? 0;
      projectSignCountMap.set(row.project_id, c + 1);
      if (c === 0) projectSignMap.set(row.project_id, row.id);
    }
  }
  const { recordset } = await azure.request().query(
    `SELECT Id_new AS IdNew, JobNo, [Date] AS ServiceDate,
            CAST(Issue    AS NVARCHAR(MAX)) AS Issue,
            CAST(Solution AS NVARCHAR(MAX)) AS Solution
       FROM dbo.LEDService`
  );
  await pgExec(pg, 'TRUNCATE TABLE led_service RESTART IDENTITY CASCADE');
  const ambiguous = [];
  for (const r of recordset) {
    let ledSignId = null;
    if (r.JobNo != null) {
      const count = projectSignCountMap.get(r.JobNo) ?? 0;
      if (count === 1) {
        ledSignId = projectSignMap.get(r.JobNo);
      } else {
        ambiguous.push({ serviceId: r.IdNew, jobNo: r.JobNo, signCount: count });
      }
    }
    await pgExec(pg,
      `INSERT INTO led_service (id, led_sign_id, service_date, issue, solution)
       VALUES ($1, $2, $3, $4, $5)`,
      [r.IdNew, ledSignId, r.ServiceDate, r.Issue, r.Solution]
    );
  }
  await resetSequence(pg, 'led_service');
  if (ambiguous.length) {
    warn(`${ambiguous.length} led_service rows got NULL led_sign_id (project has 0 or >1 signs):`);
    for (const a of ambiguous) {
      console.warn(`  - id=${a.serviceId} JobNo=${a.jobNo} signCount=${a.signCount}`);
    }
  }
  record('led_service', recordset.length, await countRailway(pg, 'led_service'));
}

// =====================================================================
// Runner
// =====================================================================

async function main() {
  if (DRY_RUN) log(chalk.dim('--- DRY RUN: no Railway writes ---'));

  log('connecting to Azure...');
  const azure = await sql.connect(AZURE_CONFIG);
  log('connecting to Railway Postgres...');
  const pg = new Pool({ connectionString: RAILWAY_DATABASE_URL });
  await pg.query('SELECT 1');

  try {
    // ----- Tier 0 (parents with no outgoing FKs) -----
    await migrateClients(azure, pg);
    await migrateEmployees(azure, pg);
    await migrateStatus(azure, pg);
    await migrateProjectType(azure, pg);
    await migrateQbItems(azure, pg);
    await migrateModules(azure, pg);

    // ----- Tier 1 (children of tier-0 parents) -----
    await migrateClientAddresses(azure, pg);
    await migrateClientPhones(azure, pg);
    await migrateClientPreferences(azure, pg);
    await migrateClientWifi(azure, pg);
    await migrateEmployeeTools(azure, pg);

    // ----- Tier 2 (projects) -----
    await migrateProjects(azure, pg);

    // ----- Tier 3 (children of projects) -----
    await migrateItems(azure, pg);
    await migrateLedSigns(azure, pg);
    await migrateMeasurements(azure, pg);
    await migrateNotes(azure, pg);
    await migrateProjectFiles(azure, pg);
    await migrateAuditLog(azure, pg);

    // ----- Tier 4 (children of led_signs) -----
    await migrateLedService(azure, pg);

  } finally {
    await pg.end();
    await sql.close();
  }

  // ----- Report -----
  console.log('\n[migrate] row-count report:');
  console.log('  ' + ['table', 'azure', 'railway', 'status'].map(s => s.padEnd(22)).join(''));
  console.log('  ' + '-'.repeat(88));
  let hasMismatch = false;
  for (const r of report) {
    const status = r.mismatch ? chalk.red('MISMATCH') : chalk.green('ok');
    if (r.mismatch) hasMismatch = true;
    console.log('  ' +
      r.table.padEnd(22) +
      String(r.azure).padEnd(22) +
      String(r.railway ?? '(dry-run)').padEnd(22) +
      status
    );
  }
  process.exit(hasMismatch ? 1 : 0);
}

main().catch(e => { console.error('[migrate] FATAL:', e); process.exit(1); });
