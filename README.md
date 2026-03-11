# Fraud Watch SA

Public reporting website for fraud incidents involving South African banks.

## Architecture

- Frontend: static HTML/CSS/JS served by Node
- Backend: Node HTTP server (`server.js`)
- Storage: server-side JSON datastore at `data/reports.json`

All visitors see the same dashboard data because submissions are stored on the server, not in browser local storage.

## Features

- Public submission form with validation
- Private audit-contact capture (name + contact details, non-public)
- Private technical audit metadata capture (hashed IP + user-agent, non-public)
- Shared dashboard totals and breakdowns
- Public CSV export endpoint
- Recent reports feed

## Security controls in this version

- Input validation for all fields and constrained options
- Input sanitization for free text
- Rejection of likely sensitive data in summaries (emails, long number sequences)
- POPIA consent requirement before submission
- Personal audit fields excluded from public dashboard and public CSV outputs
- IP stored as HMAC hash (`IP_HASH_SECRET`) for audit and duplicate analysis
- Request body size limits
- Rate limiting on submission endpoint (`POST /api/reports`)
- Security response headers (CSP, frame denial, no-sniff, permissions policy)

## Run locally

```bash
cd "/Users/manojmaharaj/Documents/New project/Fraud Website"
npm start
```

Then open: `http://localhost:8080`

## API endpoints

- `GET /health`
- `GET /api/dashboard`
- `POST /api/reports`
- `GET /api/reports.csv`
- `GET /api/audit/reports` (requires `AUDIT_TOKEN`)
- `GET /api/audit/reports.csv` (requires `AUDIT_TOKEN`)

## Important deployment notes

- Run this behind HTTPS in production.
- Move from JSON file storage to a proper database before high traffic.
- Add moderation workflow and abuse monitoring if opened broadly to the public.

## Deploy On Render (Small Group Critique)

This repo includes `render.yaml`, so Render can auto-configure the service.

1. Push latest `main` to GitHub.
2. In Render: `New +` -> `Blueprint`.
3. Select repo: `Maharajms11/Fraud-website`.
4. Render will detect `render.yaml`; click `Apply`.
5. Wait for deploy and open the generated `https://...onrender.com` URL.

Render settings used:
- `Build Command`: `npm install`
- `Start Command`: `npm start`
- `Health Check`: `/health`
- `HOST=0.0.0.0` (required for cloud runtime)
- Optional for private audit export: `AUDIT_TOKEN=<strong-secret>`
- Recommended for private IP hashing: `IP_HASH_SECRET=<strong-separate-secret>`

Note: current storage is JSON file based and may reset on instance rebuild/restart. For reliable persistence, move to a managed database (SQLite on persistent disk, PostgreSQL, etc.).
