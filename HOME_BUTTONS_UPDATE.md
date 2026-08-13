# Home Buttons Update

## Status

The home page action buttons are wired into the production backend/API flow.

## Buttons

- **Recharge** opens the payment request modal.
- **Withdraw** opens the withdrawal request modal.
- **Account** loads profile information.
- **Start Working** routes users into task/work pages.

## Data Sources

- Authentication comes from Supabase Auth.
- Wallet data comes from the Render backend.
- Payment and withdrawal records are stored in Supabase Postgres.
- Frontend pages are deployed on Vercel.

## Current Backend

```text
https://dailytrade-backend.onrender.com
```

Health check:

```text
https://dailytrade-backend.onrender.com/health
```

## Test Checklist

- [ ] Open the Vercel frontend.
- [ ] Login with a real Supabase user.
- [ ] Confirm balance loads on `home.html`.
- [ ] Click Recharge and submit a payment request.
- [ ] Submit a transaction ID.
- [ ] Click Withdraw and submit a withdrawal request.
- [ ] Confirm admin panel sees the records.

Last updated: July 10, 2026.
