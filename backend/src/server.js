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
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
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
            upn.payment_number, upn.method as payment_method,
            (select count(*) from payments where user_id = u.id) as payment_count,
            (select count(*) from transactions where user_id = u.id) as transaction_count
     from app_users u
     left join wallets w on u.id = w.user_id
     left join user_payment_numbers upn on u.id = upn.user_id
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

// Transfer bonus to balance
app.post('/wallet/transfer-bonus', requireAuth, async (req, res) => {
  const { amount } = req.body;
  const { id } = req.user;
  
  const numericAmount = Number(amount || 0);
  if (!numericAmount || numericAmount <= 0) {
    return res.status(400).json({ error: 'Invalid transfer amount' });
  }
  
  const { rows: walletRows } = await query('select balance, bonus from wallets where user_id = $1', [id]);
  const currentBonus = Number(walletRows[0]?.bonus || 0);
  
  if (numericAmount > currentBonus) {
    return res.status(400).json({ error: 'Insufficient bonus' });
  }
  
  await query(
    'update wallets set balance = balance + $1, bonus = bonus - $1, updated_at = now() where user_id = $2',
    [numericAmount, id]
  );
  
  await query(
    'insert into transactions (user_id, type, amount, reason) values ($1, $2, $3, $4)',
    [id, 'bonus_transfer', numericAmount, 'Bonus transferred to balance']
  );
  
  const { rows } = await query('select balance, bonus from wallets where user_id = $1', [id]);
  res.json(rows[0]);
});

// Deduct balance (for task cost)
app.post('/wallet/deduct', requireAuth, async (req, res) => {
  const { id } = req.user;
  const { amount, reason } = req.body;
  const numericAmount = Number(amount) || 0;

  if (numericAmount <= 0) {
    return res.status(400).json({ error: 'Invalid amount' });
  }

  const { rows: walletRows } = await query('select balance from wallets where user_id = $1', [id]);
  if (!walletRows[0]) {
    return res.status(404).json({ error: 'Wallet not found' });
  }

  const currentBalance = Number(walletRows[0]?.balance || 0);
  
  if (numericAmount > currentBalance) {
    return res.status(400).json({ error: 'Insufficient balance' });
  }
  
  await query(
    'update wallets set balance = balance - $1, updated_at = now() where user_id = $2',
    [numericAmount, id]
  );
  
  await query(
    'insert into transactions (user_id, type, amount, reason) values ($1, $2, $3, $4)',
    [id, 'task_cost', numericAmount, reason || 'Task cost']
  );
  
  const { rows } = await query('select balance, bonus from wallets where user_id = $1', [id]);
  res.json(rows[0]);
});

// Add bonus (for task completion with interest)
app.post('/wallet/add-bonus', requireAuth, async (req, res) => {
  const { id } = req.user;
  const { amount, reason } = req.body;
  const numericAmount = Number(amount) || 0;

  if (numericAmount <= 0) {
    return res.status(400).json({ error: 'Invalid amount' });
  }

  await query(
    'update wallets set bonus = bonus + $1, updated_at = now() where user_id = $2',
    [numericAmount, id]
  );
  
  await query(
    'insert into transactions (user_id, type, amount, reason) values ($1, $2, $3, $4)',
    [id, 'bonus', numericAmount, reason || 'Task completion bonus']
  );
  
  const { rows } = await query('select balance, bonus from wallets where user_id = $1', [id]);
  res.json(rows[0]);
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
    `insert into withdrawals (user_id, amount, method, account)
     values ($1, $2, $3, $4)
     returning *`,
    [id, numericAmount, method || null, account || null]
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

  const { rows: paymentNumberRows } = await query(
    'select payment_number from user_payment_numbers where user_id = $1',
    [id]
  );

  if (paymentNumberRows.length === 0) {
    return res.status(400).json({ error: 'No payment number assigned. Please contact support.' });
  }

  const paymentNumber = paymentNumberRows[0].payment_number;

  const { rows } = await query(
    `insert into payments (user_id, amount, method, phone, payment_number)
     values ($1, $2, $3, $4, $5)
     returning *`,
    [id, amount, method, phone, paymentNumber]
  );
  res.json(rows[0]);
});

// Admin: list payment numbers
app.get('/admin/payment-numbers', requireAuth, requireAdmin, async (req, res) => {
  const { rows } = await query(
    `select upn.user_id, upn.payment_number, upn.method, upn.updated_at,
            u.email, u.full_name
     from user_payment_numbers upn
     join app_users u on u.id = upn.user_id
     order by upn.updated_at desc`
  );
  res.json(rows);
});

// Admin: create/update payment number
app.post('/admin/payment-numbers', requireAuth, requireAdmin, async (req, res) => {
  const { userId, paymentNumber, method } = req.body;

  if (!userId || !paymentNumber) {
    return res.status(400).json({ error: 'User and payment number are required' });
  }

  const { rows } = await query(
    `insert into user_payment_numbers (user_id, payment_number, method)
     values ($1, $2, $3)
     on conflict (user_id) do update set
       payment_number = excluded.payment_number,
       method = excluded.method,
       updated_at = now()
     returning *`,
    [userId, paymentNumber, method || null]
  );

  res.json(rows[0]);
});

// Admin: delete payment number
app.delete('/admin/payment-numbers/:userId', requireAuth, requireAdmin, async (req, res) => {
  const { userId } = req.params;
  const { rows } = await query(
    'delete from user_payment_numbers where user_id = $1 returning *',
    [userId]
  );

  if (rows.length === 0) return res.status(404).json({ error: 'Payment number not found' });
  res.json({ ok: true });
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

// Tasks - Get user's assigned tasks
app.get('/tasks/my', requireAuth, async (req, res) => {
  const { id } = req.user;
  const { rows } = await query(
    `select t.*, ta.status as assignment_status, ta.assigned_at, ta.completed_at
     from task_assignments ta
     join tasks t on t.id = ta.task_id
     where ta.user_id = $1
     order by ta.assigned_at desc`,
    [id]
  );
  res.json(rows);
});

// Products - Get user's assigned products
app.get('/products/my', requireAuth, async (req, res) => {
  const { id } = req.user;
  const { rows } = await query(
    `select p.*, pa.status as assignment_status, pa.assigned_at, pa.completed_at
     from product_assignments pa
     join products p on p.id = pa.product_id
     where pa.user_id = $1
     order by pa.assigned_at desc`,
    [id]
  );
  res.json(rows);
});

// Admin: Create task
app.post('/admin/tasks', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { title, description, amount, commission } = req.body;
    
    if (!title || !amount) {
      return res.status(400).json({ error: 'Title and amount are required' });
    }
    
    const { rows } = await query(
      `insert into tasks (title, description, amount, commission)
       values ($1, $2, $3, $4)
       returning *`,
      [title, description, amount, commission || 0]
    );
    res.json(rows[0]);
  } catch (error) {
    console.error('Error creating task:', error);
    res.status(500).json({ error: 'Failed to create task: ' + error.message });
  }
});
// Admin: Get all tasks
app.get('/admin/tasks', requireAuth, requireAdmin, async (req, res) => {
  const { rows } = await query('select * from tasks order by created_at desc');
  res.json(rows);
});

// Admin: Delete task
app.delete('/admin/tasks/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id: taskId } = req.params;
    
    // Delete task assignments first (due to foreign key constraint)
    await query('delete from task_assignments where task_id = $1', [taskId]);
    
    // Delete the task
    const { rowCount } = await query('delete from tasks where id = $1', [taskId]);
    
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    res.json({ ok: true, message: 'Task deleted successfully' });
  } catch (error) {
    console.error('Error deleting task:', error);
    res.status(500).json({ error: 'Failed to delete task: ' + error.message });
  }
});

// Admin: Assign task to users
app.post('/admin/tasks/:id/assign', requireAuth, requireAdmin, async (req, res) => {
  const { id: taskId } = req.params;
  const { userIds } = req.body;
  
  if (!Array.isArray(userIds) || userIds.length === 0) {
    return res.status(400).json({ error: 'User IDs required' });
  }

  let assigned = 0;
  let skipped = 0;

  for (const userId of userIds) {
    try {
      const result = await query(
        `insert into task_assignments (task_id, user_id)
         values ($1, $2)
         on conflict (task_id, user_id) do nothing`,
        [taskId, userId]
      );
      if (result.rowCount > 0) {
        assigned++;
      } else {
        skipped++;
      }
    } catch (error) {
      skipped++;
    }
  }

  res.json({ assigned, skipped });
});

// Admin: Create product
app.post('/admin/products', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { name, description, price, image, commission } = req.body;
    
    if (!name || !price) {
      return res.status(400).json({ error: 'Name and price are required' });
    }
    
    const { rows } = await query(
      `insert into products (name, description, price, image, commission)
       values ($1, $2, $3, $4, $5)
       returning *`,
      [name, description, price, image, commission || 0]
    );
    res.json(rows[0]);
  } catch (error) {
    console.error('Error creating product:', error);
    res.status(500).json({ error: 'Failed to create product: ' + error.message });
  }
});

// Admin: Get all products
app.get('/admin/products', requireAuth, requireAdmin, async (req, res) => {
  const { rows } = await query('select * from products order by created_at desc');
  res.json(rows);
});

// Admin: Delete product
app.delete('/admin/products/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id: productId } = req.params;
    
    // Delete product assignments first (due to foreign key constraint)
    await query('delete from product_assignments where product_id = $1', [productId]);
    
    // Delete the product
    const { rowCount } = await query('delete from products where id = $1', [productId]);
    
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    res.json({ ok: true, message: 'Product deleted successfully' });
  } catch (error) {
    console.error('Error deleting product:', error);
    res.status(500).json({ error: 'Failed to delete product: ' + error.message });
  }
});

// Admin: Assign product to users
app.post('/admin/products/:id/assign', requireAuth, requireAdmin, async (req, res) => {
  const { id: productId } = req.params;
  const { userIds } = req.body;
  
  if (!Array.isArray(userIds) || userIds.length === 0) {
    return res.status(400).json({ error: 'User IDs required' });
  }

  let assigned = 0;
  let skipped = 0;

  for (const userId of userIds) {
    try {
      const result = await query(
        `insert into product_assignments (product_id, user_id)
         values ($1, $2)
         on conflict (product_id, user_id) do nothing`,
        [productId, userId]
      );
      if (result.rowCount > 0) {
        assigned++;
      } else {
        skipped++;
      }
    } catch (error) {
      skipped++;
    }
  }

  res.json({ assigned, skipped });
});

// Mark task as completed
app.post('/tasks/:id/complete', requireAuth, async (req, res) => {
  try {
    const { id: taskId } = req.params;
    const { id: userId } = req.user;

    const { rowCount } = await query(
      `update task_assignments 
       set status = 'completed', completed_at = now()
       where task_id = $1 and user_id = $2`,
      [taskId, userId]
    );

    if (rowCount === 0) {
      return res.status(404).json({ error: 'Task assignment not found' });
    }

    res.json({ ok: true, message: 'Task marked as completed' });
  } catch (error) {
    console.error('Error completing task:', error);
    res.status(500).json({ error: 'Failed to complete task: ' + error.message });
  }
});

// Mark product as completed
app.post('/products/:id/complete', requireAuth, async (req, res) => {
  try {
    const { id: productId } = req.params;
    const { id: userId } = req.user;

    const { rowCount } = await query(
      `update product_assignments 
       set status = 'completed', completed_at = now()
       where product_id = $1 and user_id = $2`,
      [productId, userId]
    );

    if (rowCount === 0) {
      return res.status(404).json({ error: 'Product assignment not found' });
    }

    res.json({ ok: true, message: 'Product marked as completed' });
  } catch (error) {
    console.error('Error completing product:', error);
    res.status(500).json({ error: 'Failed to complete product: ' + error.message });
  }
});

// Admin: Create beginner task
app.post('/admin/beginner-tasks', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { title, description, amount, commission } = req.body;
    const { rows } = await query(
      `insert into beginner_tasks (title, description, amount, commission, status)
       values ($1, $2, $3, $4, 'inactive')
       returning *`,
      [title, description, amount, commission || 0]
    );
    res.json(rows[0]);
  } catch (error) {
    console.error('Error creating beginner task:', error);
    res.status(500).json({ error: 'Failed to create beginner task: ' + error.message });
  }
});

// Admin: Get all beginner tasks
app.get('/admin/beginner-tasks', requireAuth, requireAdmin, async (req, res) => {
  const { rows } = await query('select * from beginner_tasks order by created_at desc');
  res.json(rows);
});

// Admin: Delete beginner task
app.delete('/admin/beginner-tasks/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { rowCount } = await query('delete from beginner_tasks where id = $1', [id]);
    
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Beginner task not found' });
    }
    
    res.json({ ok: true, message: 'Beginner task deleted successfully' });
  } catch (error) {
    console.error('Error deleting beginner task:', error);
    res.status(500).json({ error: 'Failed to delete beginner task: ' + error.message });
  }
});

// Admin: Start beginner task
app.patch('/admin/beginner-tasks/:id/start', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { rowCount } = await query(
      `update beginner_tasks set status = 'active' where id = $1`,
      [id]
    );
    
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Beginner task not found' });
    }
    
    res.json({ ok: true, message: 'Beginner task started' });
  } catch (error) {
    console.error('Error starting beginner task:', error);
    res.status(500).json({ error: 'Failed to start beginner task: ' + error.message });
  }
});

// Admin: Stop beginner task
app.patch('/admin/beginner-tasks/:id/stop', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { rowCount } = await query(
      `update beginner_tasks set status = 'inactive' where id = $1`,
      [id]
    );
    
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Beginner task not found' });
    }
    
    res.json({ ok: true, message: 'Beginner task stopped' });
  } catch (error) {
    console.error('Error stopping beginner task:', error);
    res.status(500).json({ error: 'Failed to stop beginner task: ' + error.message });
  }
});

// Admin: Get submissions for a beginner task
app.get('/admin/beginner-tasks/:id/submissions', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await query(
      `select s.*, u.email as user_email
       from beginner_task_submissions s
       join app_users u on u.id = s.user_id
       where s.task_id = $1
       order by s.submitted_at desc`,
      [id]
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching submissions:', error);
    res.status(500).json({ error: 'Failed to fetch submissions: ' + error.message });
  }
});

// Admin: Delete a submission
app.delete('/admin/beginner-tasks/submissions/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { rowCount } = await query('delete from beginner_task_submissions where id = $1', [id]);
    
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Submission not found' });
    }
    
    res.json({ ok: true, message: 'Submission deleted successfully' });
  } catch (error) {
    console.error('Error deleting submission:', error);
    res.status(500).json({ error: 'Failed to delete submission: ' + error.message });
  }
});

// User: Get active beginner tasks with cooldown info
app.get('/beginner-tasks', requireAuth, async (req, res) => {
  try {
    const { id: userId } = req.user;
    
    // Get all active tasks
    const { rows: tasks } = await query(
      `select * from beginner_tasks where status = 'active' order by created_at desc`
    );
    
    // For each task, get user's last submission time
    for (const task of tasks) {
      const { rows: lastSubmission } = await query(
        `select submitted_at from beginner_task_submissions
         where task_id = $1 and user_id = $2
         order by submitted_at desc limit 1`,
        [task.id, userId]
      );
      
      if (lastSubmission.length > 0) {
        task.last_submitted_at = lastSubmission[0].submitted_at;
        
        // Calculate next available time (30 mins from last submission)
        const lastTime = new Date(lastSubmission[0].submitted_at);
        const nextTime = new Date(lastTime.getTime() + 30 * 60 * 1000);
        task.next_available_at = nextTime;
        task.can_submit = new Date() >= nextTime;
      } else {
        task.can_submit = true;
        task.last_submitted_at = null;
        task.next_available_at = null;
      }
    }
    
    res.json(tasks);
  } catch (error) {
    console.error('Error fetching beginner tasks:', error);
    res.status(500).json({ error: 'Failed to fetch beginner tasks: ' + error.message });
  }
});

// User: Submit URL for beginner task
app.post('/beginner-tasks/:id/submit', requireAuth, async (req, res) => {
  try {
    const { id: taskId } = req.params;
    const { id: userId } = req.user;
    const { url } = req.body;
    
    if (!url || !url.trim()) {
      return res.status(400).json({ error: 'URL is required' });
    }
    
    // Check if task exists and is active
    const { rows: taskRows } = await query(
      `select * from beginner_tasks where id = $1`,
      [taskId]
    );
    
    if (taskRows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    const task = taskRows[0];
    
    if (task.status !== 'active') {
      return res.status(400).json({ error: 'This task is not currently active' });
    }
    
    // Check last submission time (30-minute cooldown)
    const { rows: lastSubmission } = await query(
      `select submitted_at from beginner_task_submissions
       where task_id = $1 and user_id = $2
       order by submitted_at desc limit 1`,
      [taskId, userId]
    );
    
    if (lastSubmission.length > 0) {
      const lastTime = new Date(lastSubmission[0].submitted_at);
      const nextTime = new Date(lastTime.getTime() + 30 * 60 * 1000);
      const now = new Date();
      
      if (now < nextTime) {
        const minutesLeft = Math.ceil((nextTime - now) / 1000 / 60);
        return res.status(400).json({ 
          error: `Please wait ${minutesLeft} more minutes before submitting again`,
          next_available_at: nextTime
        });
      }
    }

    // Save submission (no balance deduction - task is FREE)
    await query(
      `insert into beginner_task_submissions (task_id, user_id, url)
       values ($1, $2, $3)`,
      [taskId, userId, url.trim()]
    );
    
    res.json({ 
      ok: true, 
      message: 'Submission successful',
      task_title: task.title,
      next_available_at: new Date(Date.now() + 30 * 60 * 1000)
    });
  } catch (error) {
    console.error('Error submitting beginner task:', error);
    res.status(500).json({ error: 'Failed to submit task: ' + error.message });
  }
});

// User: Claim beginner task reward
app.post('/beginner-tasks/:id/claim', requireAuth, async (req, res) => {
  try {
    const { id: taskId } = req.params;
    const { id: userId } = req.user;
    
    // Get task to find reward amount
    const { rows: taskRows } = await query(
      `select * from beginner_tasks where id = $1`,
      [taskId]
    );
    
    if (taskRows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    const task = taskRows[0];
    const rewardAmount = parseFloat(task.amount);
    
    // Check if submission exists
    const { rows: submissionRows } = await query(
      `select * from beginner_task_submissions
       where task_id = $1 and user_id = $2
       order by submitted_at desc limit 1`,
      [taskId, userId]
    );
    
    if (submissionRows.length === 0) {
      return res.status(404).json({ error: 'No submission found' });
    }
    
    // Add reward to balance
    await query(
      `update wallets set balance = balance + $1 where user_id = $2`,
      [rewardAmount, userId]
    );
    
    await query(
      `insert into transactions (user_id, type, amount, reason)
       values ($1, 'credit', $2, $3)`,
      [userId, rewardAmount, `Beginner task reward: ${task.title}`]
    );
    
    res.json({ 
      ok: true, 
      message: 'Reward claimed successfully',
      earned: rewardAmount
    });
  } catch (error) {
    console.error('Error claiming beginner task reward:', error);
    res.status(500).json({ error: 'Failed to claim reward: ' + error.message });
  }
});

const port = process.env.PORT || 8080;

async function ensureSchema() {
  await query(`
    create table if not exists withdrawals (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references app_users(id) on delete cascade,
      amount numeric(12,2) not null,
      method text,
      account text,
      status text not null default 'pending',
      requested_at timestamptz default now(),
      processed_at timestamptz
    )
  `);
  await query('alter table withdrawals add column if not exists account text');

  await query(`
    create table if not exists user_payment_numbers (
      user_id uuid primary key references app_users(id) on delete cascade,
      payment_number text not null,
      method text,
      created_at timestamptz default now(),
      updated_at timestamptz default now()
    )
  `);
  await query('create index if not exists user_payment_numbers_updated_idx on user_payment_numbers(updated_at desc)');
  await query(`
    create table if not exists payments (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references app_users(id) on delete cascade,
      amount numeric(12,2) not null,
      method text,
      phone text,
      payment_number text,
      status text not null default 'pending',
      transaction_id text,
      requested_at timestamptz default now(),
      completed_at timestamptz
    )
  `);
  await query('alter table payments add column if not exists payment_number text');
  
  // Beginner tasks tables
  await query(`
    create table if not exists beginner_tasks (
      id uuid primary key default gen_random_uuid(),
      title text not null,
      description text,
      amount numeric(12,2) not null,
      commission numeric(5,2) default 0,
      status text not null default 'inactive',
      created_at timestamptz default now()
    )
  `);

  await query(`
    create table if not exists beginner_task_submissions (
      id uuid primary key default gen_random_uuid(),
      task_id uuid not null references beginner_tasks(id) on delete cascade,
      user_id uuid not null references app_users(id) on delete cascade,
      url text not null,
      submitted_at timestamptz default now()
    )
  `);
  await query('create index if not exists beginner_submissions_task_user_idx on beginner_task_submissions(task_id, user_id, submitted_at desc)');
  
  await query(`
    create table if not exists task_assignments (
      id uuid primary key default gen_random_uuid(),
      task_id uuid not null references tasks(id) on delete cascade,
      user_id uuid not null references app_users(id) on delete cascade,
      status text not null default 'pending',
      assigned_at timestamptz default now(),
      completed_at timestamptz
    )
  `);
  await query('create unique index if not exists task_assignments_unique on task_assignments(task_id, user_id)');
  
  // Add commission column to tasks if it doesn't exist
  await query('alter table tasks add column if not exists commission numeric(5,2) not null default 0');
  
  await query(`
    create table if not exists products (
      id uuid primary key default gen_random_uuid(),
      name text not null,
      description text,
      price numeric(12,2) not null,
      image text,
      status text not null default 'active',
      created_at timestamptz default now()
    )
  `);
  
  // Add commission column to products if it doesn't exist
  await query('alter table products add column if not exists commission numeric(5,2) not null default 0');
  
  await query(`
    create table if not exists product_assignments (
      id uuid primary key default gen_random_uuid(),
      product_id uuid not null references products(id) on delete cascade,
      user_id uuid not null references app_users(id) on delete cascade,
      status text not null default 'pending',
      assigned_at timestamptz default now(),
      completed_at timestamptz
    )
  `);
  await query('create unique index if not exists product_assignments_unique on product_assignments(product_id, user_id)');
}

ensureSchema()
  .catch((error) => {
    console.error('Schema init error:', error);
  })
  .finally(() => {
    app.listen(port, () => {
      console.log(`API running on :${port}`);
    });
  });
