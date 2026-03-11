# Fraud Watch SA

Public reporting website for fraud incidents involving South African banks.

## Architecture

- Frontend: static HTML/CSS/JS served by Node
- Backend: Node HTTP server (`server.js`)
- Storage: server-side JSON datastore at `data/reports.json`

All visitors see the same dashboard data because submissions are stored on the server, not in browser local storage.

## Features

- Public submission form with validation
- Shared dashboard totals and breakdowns
- Public CSV export endpoint
- Recent reports feed

## Security controls in this version

- Input validation for all fields and constrained options
- Input sanitization for free text
- Rejection of likely sensitive data in summaries (emails, long number sequences)
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

## Important deployment notes

- Run this behind HTTPS in production.
- Move from JSON file storage to a proper database before high traffic.
- Add moderation workflow and abuse monitoring if opened broadly to the public.
