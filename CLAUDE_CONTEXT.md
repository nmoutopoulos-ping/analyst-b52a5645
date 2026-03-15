# Ping Analyst — Claude Session Context

Pick this up and you're fully up to speed. Read this before touching any code.

---

## What This Project Is

**Ping Analyst** is a multifamily real estate underwriting automation tool built for Niko ("Ping" is his alias — not Paxos-related). When a user submits a property (address, price, unit mix), the pipeline fetches live rental comps from the RentCast API, populates a pre-built Excel pro forma, and generates a Word investment summary. Results are delivered via the CRM web app.

Two frontend clients, one Flask backend deployed on Railway:
- **Chrome Extension** (`Extension/ping-analyst_v1/`) — side panel, submits via POST /trigger
- **CRM Web App** (`Pipeline/crm.html`) — served at `/app`, submission form + Deals tab + Settings

---

## Infrastructure

| Service | Details |
|---------|---------|
| **Backend** | Python/Flask, deployed on Railway (`analyst-production-32d6.up.railway.app`) |
| **Database** | Supabase Postgres (`https://knimxvcbrtktuhsuovasu.supabase.co`) |
| **File Storage** | Supabase Storage bucket: `deal-files` |
| **Repo** | `https://github.com/nmoutopoulos-ping/analyst` (private) |
| **Local repo path** | `~/Documents/Analyst/analyst` |

### Railway Environment Variables (currently set)
- `RENTCAST_API_KEY` — RentCast API for comp data
- `OUTPUT_DIR` — temp working dir (`/tmp/ping_output`)
- `SUPABASE_URL` — `https://knimxvcbrtktuhsuovasu.supabase.co`
- `SUPABASE_SERVICE_KEY` — service role key (set in Railway)
- `SECRET_KEY` — Flask session signing
- `ADMIN_PASSWORD` — protects `/admin` panel

`EMAIL_ENABLED`, `EMAIL_SENDER`, and `RESEND_API_KEY` were deleted — email is gone.

### Supabase Tables
```sql
-- deals
create table deals (
  id             uuid default gen_random_uuid() primary key,
  search_id      text unique not null,
  address        text not null,
  short_address  text,
  email          text not null,
  api_key        text,
  price          text,
  cost           text,
  sqft           text,
  total_units    text,
  radius         text,
  deal_stage     text default 'New',
  combos         jsonb,
  comp_summary   jsonb,
  excel_path     text,
  docx_path      text,
  status         text default 'complete',
  created_at     timestamptz default now()
);

-- users
create table users (
  id         uuid default gen_random_uuid() primary key,
  api_key    text unique not null,
  email      text not null,
  name       text not null,
  created_at timestamptz default now()
);
```

---

## What Was Done This Session

### 1. Supabase Integration (deal storage)
- Replaced Railway's ephemeral filesystem (`meta.json` + local files) with Supabase
- Created `Pipeline/supabase_client.py` — all Supabase interactions via raw REST API using `requests` (NOT the supabase-py package, which caused `[Errno -2] DNS` failures on Railway)
- Pipeline now uploads Excel + Word files to the `deal-files` Storage bucket and inserts a deal row into the `deals` table
- `/deals` endpoint queries Supabase instead of scanning the filesystem
- `/deals/<id>/download/excel` and `/deals/<id>/download/docx` generate signed Storage URLs and redirect
- New `PATCH /deals/<id>/stage` endpoint — deal stage is now server-side in Postgres (was `localStorage`)

### 2. Email Delivery Removed
- Email was already broken (`EMAIL_ENABLED=false`) due to Resend DNS verification failure
- Entire email step removed from `Pipeline/main.py` — pipeline no longer calls emailer
- CRM copy updated: "Results will be emailed when ready" → "Check the Deals tab for results"
- Success banner updated similarly
- `EMAIL_ENABLED`, `EMAIL_SENDER`, `RESEND_API_KEY` deleted from Railway

### 3. User Auth Migrated to Supabase
**Root cause of login weirdness:** `USERS` was loaded from `users.json` once at server startup as a module-level dict. Admin add/delete updated in-memory + wrote to Railway's ephemeral filesystem. On every redeploy, the file reset to the git version — so deleted users reappeared and added users vanished.

**Fix:** Users now live in Supabase `users` table permanently.
- `server.py` loads `USERS` from Supabase at startup (still in-memory for fast auth lookups)
- Admin add/delete write to Supabase first, then update in-memory dict
- Falls back to `users.json` if Supabase unreachable (local dev safety net)
- `users.json` in the repo is now just a legacy fallback, not the source of truth

### 4. CRM Deals Tab Field Name Fix
The CRM was built against old `meta.json` field names. Updated all JS to use Supabase field names:
- `searchId` → `search_id`
- `shortAddress` → `short_address`
- `dealStage` → `deal_stage`
- `compSummary` → `comp_summary`
- `totalUnits` → `total_units`
- `timestamp` → `created_at`
- `files.excel` / `files.docx` → `excel_path` / `docx_path`
- Download URLs: `/deals/<id>/download/<filename>` → `/deals/<id>/download/excel|docx`
- `updateDealStage()` now PATCHes the server instead of only writing to `localStorage`

---

## Current State / Known Issues

### ⚠️ Pending: Seed users into Supabase
After the user auth migration, the `users` table needs to be seeded or Railway will load 0 users and all logins will fail. Run this in Supabase SQL Editor if not done:

```sql
insert into users (api_key, email, name) values
  ('PING-NKO1-GM4X', 'nikomoutop10@gmail.com',        'Niko'),
  ('PING-NKO2-PP9R', 'nmoutopoulos@pingpayments.org', 'Niko (work)');
```

### ⚠️ Pending: Verify end-to-end after last deploy
The last 3 commits (Supabase for users, Deals tab field names, copy changes) haven't been verified end-to-end yet. A test analysis submission should confirm:
1. Deal appears in Deals tab after pipeline completes
2. Excel and Word download links work
3. Deal stage changes persist
4. Login works with both user accounts

### Pipeline Status Feedback (TODO)
After submitting from the CRM, there's no "processing" indicator — user has to manually refresh the Deals tab. The plan: poll `GET /health` after submission, show a "Processing…" banner, auto-refresh when status returns to `idle`.

### Extension → CRM Handoff (TODO)
Extension users submit and have no way to see results without navigating to the CRM manually. Post-submission, the extension should show a link: "View results in Analyst →"

---

## Key Files

```
Pipeline/
  server.py           — Flask server, all routes
  main.py             — Pipeline orchestrator (RentCast → Excel → Word → Supabase)
  supabase_client.py  — All Supabase REST API calls (storage + DB + users)
  crm.html            — CRM web app (single-file, vanilla JS)
  config.py           — Config loader (env vars > config.json > defaults)
  config.json         — Local dev credentials (gitignored)
  users.json          — Legacy fallback only (source of truth is now Supabase)
  fetcher.py          — RentCast API integration
  excel_writer.py     — Populates Excel template
  docx_writer.py      — Generates Word summary
  assumptions.py      — Per-user underwriting assumption overrides
  emailer.py          — Still exists but generate_summary() is the only function used
  templates/
    Multifamily Underwriting Template V1.xlsx

Extension/ping-analyst_v1/
  manifest.json / sidepanel.html / sidepanel.js / background.js
```

---

## How to Work With the Repo

Git is configured and authenticated. The repo is cloned at `~/Documents/Analyst/analyst`.

```bash
cd ~/Documents/Analyst/analyst

# Pull latest
git pull origin main

# Push changes
git add <files>
git commit -m "your message"
git push origin main
# Railway auto-deploys on push
```

Local dev:
```bash
cd Pipeline
pip install -r requirements.txt
# Ensure config.json has SUPABASE_URL, SUPABASE_SERVICE_KEY, rentcast_api_key
python3 server.py
# Server at http://localhost:5001, CRM at http://localhost:5001/app
```

---

## Architecture Diagram

```
Chrome Extension  ──┐
                    ├──▶  POST /trigger  ──▶  Pipeline  ──▶  Supabase Storage (files)
CRM Web App (/app) ─┘         │                    │
                               ▼                    └──▶  Supabase DB (deals row)
                         API Key Auth
                      (Supabase users table)

CRM Deals Tab  ──▶  GET /deals  ──▶  Supabase DB
CRM Downloads  ──▶  GET /deals/<id>/download/excel|docx  ──▶  Supabase signed URL  ──▶  redirect
```
