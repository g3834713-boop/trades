# DailyTrade Frontend Deployment to Vercel

Use this guide for the current production setup.

## Stack

- **Vercel**: static frontend hosting
- **Render**: backend API
- **Supabase**: authentication and PostgreSQL

## Prerequisites

- GitHub repo: `g3834713-boop/trades`
- Backend live at `https://dailytrade-backend.onrender.com`
- Supabase project live at `https://rogddhzsdfgvajyepnqp.supabase.co`
- Frontend config in `config.js`

## Vercel Settings

When importing the GitHub repo into Vercel:

```text
Framework preset: Other
Root directory: .
Build command:
Output directory: .
Install command:
```

Leave build and install commands blank because this is a static HTML/CSS/JS frontend.

## Frontend Configuration

`config.js` must point at the live Render backend:

```javascript
const CONFIG = {
  API_URL: 'https://dailytrade-backend.onrender.com',
  SUPABASE_URL: 'https://rogddhzsdfgvajyepnqp.supabase.co',
  SUPABASE_ANON_KEY: 'your anon key'
};
```

No Vercel environment variables are required for the current static frontend.

## Supabase URL Settings

After Vercel deploys, copy the Vercel production URL and set:

```text
Site URL: https://your-vercel-domain.vercel.app
Redirect URLs: https://your-vercel-domain.vercel.app/**
```

Path in Supabase:

```text
Authentication -> URL Configuration
```

## Render Backend Settings

Render should deploy from the backend folder:

```text
Root directory: backend
Start command: npm start
```

Required variables:

```text
DATABASE_URL=postgresql://...supabase-pooler-or-session-url...
SUPABASE_URL=https://rogddhzsdfgvajyepnqp.supabase.co
SUPABASE_ANON_KEY=your_supabase_anon_key
ADMIN_EMAILS=admin0@gmail.com
DB_POOL_MAX=3
```

Optional variables:

```text
DB_IDLE_TIMEOUT_MS=30000
DB_CONNECTION_TIMEOUT_MS=10000
DB_SLOW_QUERY_MS=1500
```

## Validation

Check the backend:

```text
https://dailytrade-backend.onrender.com/health
```

Expected response:

```json
{"ok":true}
```

Check the frontend:

1. Open the Vercel URL.
2. Register/login with Supabase Auth.
3. Confirm dashboard pages load.
4. Create a recharge request.
5. Complete the request from `admin-login.html`.

## Common Issues

- `GET /register.html 404` in Render logs is normal. Those pages must be opened from Vercel.
- `Failed to fetch` usually means `config.js` has the wrong `API_URL`, or the Render deployment is asleep.
- Login redirect issues usually mean Supabase Site URL/Redirect URLs still point to an old domain.
- Database timeout logs usually mean Render is using the wrong Supabase connection string or too many DB connections.
