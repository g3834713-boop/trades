# Quick Deployment Guide

DailyTrade is deployed as three separate pieces:

- **Vercel** hosts the static frontend pages.
- **Render** hosts the Node/Express backend API.
- **Supabase** hosts authentication and PostgreSQL.

## Current Production URLs

| Service | URL |
| --- | --- |
| Backend API | `https://dailytrade-backend.onrender.com` |
| Backend health check | `https://dailytrade-backend.onrender.com/health` |
| Supabase project | `https://rogddhzsdfgvajyepnqp.supabase.co` |
| GitHub repo | `https://github.com/g3834713-boop/trades` |
| Frontend | Your Vercel production URL |

## Deploy Frontend on Vercel

1. Go to `https://vercel.com`.
2. Import GitHub repo `g3834713-boop/trades`.
3. Use these settings:
   - Framework preset: `Other`
   - Root directory: repo root
   - Build command: leave empty
   - Output directory: `.`
4. Deploy.
5. Copy the Vercel production URL.

The frontend reads its backend/Supabase config from `config.js`.

## Configure Supabase

In Supabase Dashboard:

1. Go to **Authentication** -> **URL Configuration**.
2. Set **Site URL** to your Vercel URL.
3. Add redirect URL: `https://your-vercel-domain.vercel.app/**`.
4. Run `backend/schema.sql` once in the SQL Editor if the base tables are missing.

## Configure Render

Render should deploy only the backend:

- Root directory: `backend`
- Start command: `npm start`
- Health endpoint: `/health`

Required Render variables:

```text
DATABASE_URL=postgresql://...supabase-pooler-or-session-url...
SUPABASE_URL=https://rogddhzsdfgvajyepnqp.supabase.co
SUPABASE_ANON_KEY=your_supabase_anon_key
ADMIN_EMAILS=admin0@gmail.com
DB_POOL_MAX=3
```

Use the Supabase pooler/session connection string for `DATABASE_URL`, especially on IPv4-only hosts.

## Test Flow

1. Open the Vercel URL.
2. Register the admin email from `ADMIN_EMAILS`.
3. Login as admin at `admin-login.html`.
4. Register a normal user.
5. Create a recharge request.
6. Submit a transaction ID.
7. Approve the payment in admin.
8. Confirm the user balance updates.

## Troubleshooting

- If Render shows `GET /register.html 404`, that is expected. Frontend pages live on Vercel.
- If login/register fails, check Supabase Site URL and redirect URLs.
- If frontend API calls fail, confirm `config.js` points to the Render API URL.
- If database calls timeout, confirm Render uses the Supabase pooler/session connection string and `DB_POOL_MAX=3`.

Last updated: August 12, 2026.
