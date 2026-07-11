# DailyTrade Project Status

## Production Status

DailyTrade is production-ready on the current three-service stack:

- **Vercel**: static frontend
- **Railway**: backend API
- **Supabase**: Auth and PostgreSQL

## Live Backend

- URL: `https://trades-production-de19.up.railway.app`
- Health check: `https://trades-production-de19.up.railway.app/health`
- Expected response: `{"ok":true}`

## Frontend

- Platform: Vercel
- Source: GitHub repo `g3834713-boop/trades`
- Config source: `config.js`
- Required Vercel env vars: none for the current static build

## Backend

- Platform: Railway
- Root directory: `backend`
- Start command: `npm start`
- Main app: `backend/src/server.js`
- Auth middleware: `backend/src/middleware/auth.js`
- Database pool config: `backend/src/db.js`

## Supabase

- Project URL: `https://rogddhzsdfgvajyepnqp.supabase.co`
- Auth provider: Supabase email/password auth
- Database: Supabase Postgres
- Base schema: `backend/schema.sql`

## Implemented Features

- User registration/login with Supabase Auth.
- Authenticated backend API calls with JWT.
- User profile sync into PostgreSQL.
- Wallet balance and bonus tracking.
- Recharge/payment request flow.
- Transaction ID submission.
- Admin payment management.
- Withdrawal request support.
- Product/task assignment routes.
- Teller task routes and teller wallet flow.

## Deployment Docs

- `QUICK_START.md`: short current deployment checklist.
- `VERCEL_DEPLOY.md`: detailed Vercel/Railway/Supabase setup.
- `FINAL_STATUS.md`: current status and validation checklist.
- `INTEGRATION_SUMMARY.md`: architecture and runtime notes.
- `NETLIFY_DEPLOY.md`: legacy pointer only.

## Verification Checklist

- [x] Backend is live on Railway.
- [x] `/health` returns `{"ok":true}`.
- [x] Frontend config points to current Railway backend.
- [x] Docs updated for Vercel instead of Netlify.
- [ ] Vercel production URL added to Supabase Auth URL settings.
- [ ] Admin account registered with an `ADMIN_EMAILS` address.
- [ ] End-to-end user payment and admin approval tested in production.

## Troubleshooting

- Frontend pages returning 404 on Railway is expected; use Vercel for HTML pages.
- Auth redirect issues usually come from Supabase URL configuration.
- API fetch issues usually come from an outdated `config.js` API URL.
- DB timeout issues usually come from using the wrong Supabase connection string or too many connections.

Last updated: July 10, 2026.
