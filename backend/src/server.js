import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { query } from './db.js';
import { requireAuth, requireAdmin } from './middleware/auth.js';

const app = express();

app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(morgan('dev'));

app.get('/health', (req, res) => res.json({ ok: true }));

// Sync user profile (called after Supabase auth)
app.post('/users/sync', requireAuth, async (req, res) => {
  const { fullName, phone } = req.body;
  const { id, email } = req.user;
  await query(
    `insert into app_users (id, email, full_name, phone)
     values ($1, $2, $3, $4)
     on conflict (id) do update set full_name = excluded.full_name, phone = excluded.phone`,
    [id, email, fullName || null, phone || null]
  );
  await query(
    `insert into wallets (user_id) values ($1)
     on conflict (user_id) do nothing`,
    [id]
  );
  res.json({ ok: true });
});

// Get user profile
app.get('/users/me', requireAuth, async (req, res) => {
  const { rows } = await query(
    `select u.id, u.email, u.full_name, u.phone, u.created_at,
            w.balance, w.bonus
     from app_users u
     left join wallets w on u.id = w.user_id
     where u.id = $1`,
    [req.user.id]
  );
  
  if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
  res.json(rows[0]);
});

// Admin: get all users
app.get('/admin/users', requireAuth, requireAdmin, async (req, res) => {
  const { rows } = await query(
    `select u.id, u.email, u.full_name, u.phone, u.created_at,
            w.balance, w.bonus,
            (select count(*) from payments where user_id = u.id) as payment_count,
            (select count(*) from transactions where user_id = u.id) as transaction_count
     from app_users u
     left join wallets w on u.id = w.user_id
     order by u.created_at desc`
  );
  
  res.json(rows);
});

// Wallet
app.get('/wallet', requireAuth, async (req, res) => {
  const { id } = req.user;
  const { rows } = await query('select balance, bonus from wallets where user_id = $1', [id]);
  res.json(rows[0] || { balance: 0, bonus: 0 });
});

// Transactions
app.get('/transactions', requireAuth, async (req, res) => {
  const { id } = req.user;
  const { rows } = await query(
    'select * from transactions where user_id = $1 order by created_at desc',
    [id]
  );
  res.json(rows);
});

// Create withdrawal request
app.post('/withdrawals', requireAuth, async (req, res) => {
  const { amount, method, account } = req.body;
  const { id } = req.user;

  const numericAmount = Number(amount || 0);
  if (!numericAmount || numericAmount <= 0) {
    return res.status(400).json({ error: 'Invalid withdrawal amount' });
  }

  const { rows: walletRows } = await query('select balance from wallets where user_id = $1', [id]);
  const balance = Number(walletRows[0]?.balance || 0);
  if (numericAmount > balance) {
    return res.status(400).json({ error: 'Insufficient balance' });
  }

  const { rows } = await query(
    `insert into withdrawals (user_id, amount, method)
     values ($1, $2, $3)
     returning *`,
    [id, numericAmount, method || null]
  );

  const reason = `Withdrawal request${method ? ` via ${method}` : ''}${account ? ` - ${account}` : ''}`;
  await query(
    'insert into transactions (user_id, type, amount, reason) values ($1, $2, $3, $4)',
    [id, 'withdrawal_request', numericAmount, reason]
  );

  res.json(rows[0]);
});

// Create payment request (manual transfer)
app.post('/payments', requireAuth, async (req, res) => {
  const { amount, method, phone } = req.body;
  const { id } = req.user;
  const { rows } = await query(
    `insert into payments (user_id, amount, method, phone)
     values ($1, $2, $3, $4)
     returning *`,
    [id, amount, method, phone]
  );
  res.json(rows[0]);
});

// Submit transaction ID
app.post('/payments/:id/transaction', requireAuth, async (req, res) => {
  const { id: paymentId } = req.params;
  const { transactionId } = req.body;
  const { id: userId } = req.user;

  const { rows } = await query(
    `update payments set transaction_id = $1, status = 'submitted'
     where id = $2 and user_id = $3
     returning *`,
    [transactionId, paymentId, userId]
  );

  if (rows.length === 0) return res.status(404).json({ error: 'Payment not found' });
  res.json(rows[0]);
});

// Admin: list payments
app.get('/admin/payments', requireAuth, requireAdmin, async (req, res) => {
  const { rows } = await query(
    `select p.*, u.email, u.full_name
     from payments p join app_users u on u.id = p.user_id
     order by p.requested_at desc`
  );
  res.json(rows);
});

// Admin: list withdrawals
app.get('/admin/withdrawals', requireAuth, requireAdmin, async (req, res) => {
  const { rows } = await query(
    `select w.*, u.email, u.full_name
     from withdrawals w join app_users u on u.id = w.user_id
     order by w.requested_at desc`
  );
  res.json(rows);
});

// Admin: approve withdrawal
app.post('/admin/withdrawals/:id/approve', requireAuth, requireAdmin, async (req, res) => {
  const { id: withdrawalId } = req.params;
  const { rows } = await query('select * from withdrawals where id = $1', [withdrawalId]);
  if (rows.length === 0) return res.status(404).json({ error: 'Withdrawal not found' });

  const withdrawal = rows[0];
  if (withdrawal.status !== 'pending') {
    return res.status(400).json({ error: 'Withdrawal already processed' });
  }

  const { rows: walletRows } = await query('select balance from wallets where user_id = $1', [withdrawal.user_id]);
  const balance = Number(walletRows[0]?.balance || 0);
  if (balance < Number(withdrawal.amount)) {
    return res.status(400).json({ error: 'Insufficient user balance' });
  }

  const { rows: updatedRows } = await query(
    `update withdrawals set status = 'approved', processed_at = now()
     where id = $1 returning *`,
    [withdrawalId]
  );

  await query('update wallets set balance = balance - $1, updated_at = now() where user_id = $2', [withdrawal.amount, withdrawal.user_id]);
  await query('insert into transactions (user_id, type, amount, reason) values ($1, $2, $3, $4)', [withdrawal.user_id, 'withdrawal', withdrawal.amount, 'Withdrawal approved']);

  res.json(updatedRows[0]);
});

// Admin: reject withdrawal
app.post('/admin/withdrawals/:id/reject', requireAuth, requireAdmin, async (req, res) => {
  const { id: withdrawalId } = req.params;
  const { reason } = req.body || {};

  const { rows } = await query('select * from withdrawals where id = $1', [withdrawalId]);
  if (rows.length === 0) return res.status(404).json({ error: 'Withdrawal not found' });

  const withdrawal = rows[0];
  if (withdrawal.status !== 'pending') {
    return res.status(400).json({ error: 'Withdrawal already processed' });
  }

  const { rows: updatedRows } = await query(
    `update withdrawals set status = 'rejected', processed_at = now()
     where id = $1 returning *`,
    [withdrawalId]
  );

  if (reason) {
    await query('insert into transactions (user_id, type, amount, reason) values ($1, $2, $3, $4)', [withdrawal.user_id, 'withdrawal_rejected', withdrawal.amount, reason]);
  }

  res.json(updatedRows[0]);
});

// Admin: complete payment and credit balance
app.post('/admin/payments/:id/complete', requireAuth, requireAdmin, async (req, res) => {
  const { id: paymentId } = req.params;

  const { rows } = await query(
    `update payments set status = 'completed', completed_at = now()
     where id = $1 and transaction_id is not null
     returning *`,
    [paymentId]
  );

  if (rows.length === 0) return res.status(400).json({ error: 'Missing transaction ID or invalid payment' });
  const payment = rows[0];

  await query('update wallets set balance = balance + $1, updated_at = now() where user_id = $2', [payment.amount, payment.user_id]);
  await query('insert into deposits (user_id, amount, bonus, reason) values ($1, $2, 0, $3)', [payment.user_id, payment.amount, 'Payment confirmed']);
  await query('insert into transactions (user_id, type, amount, reason) values ($1, $2, $3, $4)', [payment.user_id, 'deposit', payment.amount, 'Payment confirmed']);

  res.json({ ok: true });
});

// Admin: add deposit/bonus
app.post('/admin/deposits', requireAuth, requireAdmin, async (req, res) => {
  const { userId, amount = 0, bonus = 0, reason } = req.body;
  if (amount <= 0 && bonus <= 0) return res.status(400).json({ error: 'Amount or bonus required' });

  await query('update wallets set balance = balance + $1, bonus = bonus + $2, updated_at = now() where user_id = $3', [amount, bonus, userId]);
  await query('insert into deposits (user_id, amount, bonus, reason) values ($1, $2, $3, $4)', [userId, amount, bonus, reason || 'Admin deposit']);
  if (amount > 0) {
    await query('insert into transactions (user_id, type, amount, reason) values ($1, $2, $3, $4)', [userId, 'deposit', amount, reason || 'Admin deposit']);
  }
  if (bonus > 0) {
    await query('insert into transactions (user_id, type, amount, reason) values ($1, $2, $3, $4)', [userId, 'bonus', bonus, reason || 'Admin bonus']);
  }

  res.json({ ok: true });
});

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`API running on :${port}`);
});
