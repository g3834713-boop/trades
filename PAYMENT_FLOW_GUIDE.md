# Payment Flow Guide

## Stack

- Frontend: Vercel
- Backend API: Railway (`https://trades-production-de19.up.railway.app`)
- Auth/database: Supabase

## User Recharge Flow

1. User opens the Vercel frontend and logs in.
2. User clicks **Recharge** on `home.html` or `mine.html`.
3. Frontend validates amount, method, and phone number.
4. Frontend calls `window.API.createPayment(...)`.
5. Railway creates a payment request in Supabase Postgres.
6. User sees the assigned payment number.
7. User makes the manual transfer.
8. User submits the transaction ID.
9. Frontend calls `window.API.submitTransaction(...)`.
10. Admin reviews and completes the payment.
11. Backend credits the user wallet.

## Admin Payment Flow

1. Admin logs in through `admin-login.html`.
2. Admin opens payment requests in `admin.html`.
3. Admin checks the submitted transaction ID.
4. Admin clicks complete after verifying payment.
5. Railway updates payment status, deposits, transactions, and wallet balance.

## Withdrawal Flow

1. User opens withdraw modal from `home.html` or `mine.html`.
2. Frontend checks amount and current wallet balance.
3. User submits withdrawal request.
4. Railway stores the request in Supabase Postgres.
5. Admin reviews/processes the withdrawal from the admin panel.

## Backend Endpoints

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/payments` | `POST` | Create payment request |
| `/payments/:id/transaction` | `POST` | Submit transaction ID |
| `/admin/payments` | `GET` | List payment requests |
| `/admin/payments/:id/complete` | `POST` | Complete verified payment |
| `/withdrawals` | `POST` | Create withdrawal request |
| `/admin/withdrawals` | `GET` | List withdrawal requests |
| `/admin/withdrawals/:id/approve` | `POST` | Approve withdrawal |
| `/admin/withdrawals/:id/reject` | `POST` | Reject withdrawal |

## Testing Checklist

- [ ] User can register/login from Vercel.
- [ ] Wallet balance loads from Railway.
- [ ] Recharge works on `home.html`.
- [ ] Recharge works on `mine.html`.
- [ ] Payment number displays after request.
- [ ] Transaction ID submission works.
- [ ] Admin can see payment request.
- [ ] Admin can complete payment.
- [ ] User balance updates after completion.
- [ ] Withdrawal request saves correctly.

## Deployment Status

- Backend: live on Railway at `https://trades-production-de19.up.railway.app`
- Health check: `https://trades-production-de19.up.railway.app/health`
- Database: Supabase Postgres
- Frontend: Vercel

Last updated: July 10, 2026.
