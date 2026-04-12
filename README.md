# Holm Graphics Shop — SvelteKit Frontend

Internal job management portal for Holm Graphics Inc.
Connects to the HolmGraphicsMain Azure SQL backend.

## Screens

| Route | Description |
|---|---|
| `/login` | Staff & client login (JWT) |
| `/dashboard` | Job board — kanban columns by status, overdue alerts |
| `/jobs/[id]` | Job detail — overview, notes, items, audit log |
| `/jobs/new` | New job form — linked to client, all fields |

## Local Development

```bash
# Install
npm install

# Copy env file and set your backend URL
cp .env.example .env

# Run dev server
npm run dev
# → http://localhost:5173
```

## Build for Production (WHC Hosting)

```bash
npm run build
# Outputs to /build folder
```

Then upload the contents of `/build` to your WHC `public_html` folder.

Your `.env` should have:
```
VITE_API_URL=https://your-backend.up.railway.app/api
```

## Backend API Endpoints Expected

The frontend calls these endpoints on your backend:

```
POST   /api/auth/login
GET    /api/projects
GET    /api/projects/:id
POST   /api/projects
PUT    /api/projects/:id
GET    /api/projects/:id/notes
POST   /api/projects/:id/notes
POST   /api/projects/:id/status
GET    /api/projects/:id/items
GET    /api/clients?search=
GET    /api/employees
GET    /api/statuses
GET    /api/project-types
```

## Database Tables Used

From HolmGraphicsMain Azure SQL:
- `Projects` → jobs/orders
- `Clients`, `CAddress`, `ClPhone` → client info
- `Employee` → staff
- `Status`, `StatusChange` → job status tracking
- `Notes` → project notes
- `Items` → line items
- `Measurements` → sign dimensions
- `ProjectType` → job categories

## Tech Stack

- **Framework:** SvelteKit 2
- **Adapter:** `@sveltejs/adapter-static` (for WHC shared hosting)
- **Auth:** JWT stored in localStorage
- **Fonts:** Barlow Condensed + Barlow (Google Fonts)
- **Theme:** Black/red — matches holmgraphics.ca website
