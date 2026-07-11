# Frontend and Backend Integration Summary

## Overview

DailyTrade uses Supabase Auth in the browser, a Railway-hosted Express API, and Supabase Postgres for persistent app data.

## Architecture

```text
Browser on Vercel
  -> Supabase Auth for login/register
  -> Railway API with Bearer JWT
  -> Supabase Postgres through Railway backend
```

## Current URLs

| Component | URL |
| --- | --- |
| Backend API | `https://trades-production-de19.up.railway.app` |
| Backend health | `https://trades-production-de19.up.railway.app/health` |
| Supabase project | `https://rogddhzsdfgvajyepnqp.supabase.co` |
| Frontend | Your Vercel production URL |

## Frontend Files

- `config.js` stores the API URL and Supabase public config.
- `auth.js` handles Supabase registration/login and authenticated API calls.
- `api.js` remains as an older API wrapper; new pages should prefer `auth.js`/`window.API`.
- HTML pages load Supabase SDK, `config.js`, and `auth.js`.

## Backend Files

- `backend/src/server.js` contains Express routes.
- `backend/src/db.js` configures PostgreSQL access and conservative pool limits.
- `backend/src/middleware/auth.js` verifies Supabase JWTs and admin email access.
- `backend/schema.sql` contains the base tables to run in Supabase SQL Editor.

## Required Railway Environment Variables

```text
DATABASE_URL=postgresql://...supabase-pooler-or-session-url...
SUPABASE_URL=https://rogddhzsdfgvajyepnqp.supabase.co
SUPABASE_ANON_KEY=your_supabase_anon_key
ADMIN_EMAILS=admin0@gmail.com
DB_POOL_MAX=3
```

Optional database tuning:

```text
DB_IDLE_TIMEOUT_MS=30000
DB_CONNECTION_TIMEOUT_MS=10000
DB_SLOW_QUERY_MS=1500
```

## Required Supabase Settings

After Vercel deploys:

```text
Authentication -> URL Configuration
Site URL: https://your-vercel-domain.vercel.app
Redirect URLs: https://your-vercel-domain.vercel.app/**
```

Run `backend/schema.sql` once if the core tables do not exist.

## API Flow

1. User registers or logs in with Supabase Auth.
2. Frontend receives a Supabase session token.
3. Frontend calls Railway with `Authorization: Bearer <token>`.
4. Railway verifies the token with Supabase.
5. Railway reads/writes Supabase Postgres.

## Important Runtime Notes

- Open frontend pages from Vercel, not Railway.
- Railway route `/health` is the backend readiness check.
- Railway `GET /register.html 404` means someone opened a frontend page on the backend service; it is not a backend failure.
- Use `VERCEL_DEPLOY.md` for current deployment steps.

Last updated: July 10, 2026.
