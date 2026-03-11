# Fraud Watch SA

Simple static site for collecting and exposing fraud experiences reported by consumers across South African banks.

## What this first version does

- Captures fraud reports via a browser form
- Stores reports in browser local storage (no backend yet)
- Shows summary metrics (total reports, loss, recovery, net harm)
- Shows breakdown by bank and fraud type
- Lists recent reports in a table
- Allows CSV export for external analysis

## Run locally

Open `index.html` in a browser, or serve the folder with a simple static server.

## Notes

This version is intentionally lightweight so we can iterate quickly. A next step can add a backend (database + moderation + public aggregate API).
