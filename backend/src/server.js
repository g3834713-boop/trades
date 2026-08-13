import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { pool, query } from './db.js';
import { requireAuth, requireAdmin } from './middleware/auth.js';
import { canWithdrawAmount } from './verificationLimits.js';


const app = express();

const VIDEO_WATCH_TASK_TITLE = 'Watch & Earn';
const LEGACY_VIDEO_WATCH_TASK_TITLE = 'Video Watch Task';
const LEGACY_SEEDED_TASK_TITLES = [
  'Follow + Like Campaign',
  'Share & Tag Friends',
  'Mobile App Signup',
  'Website Feedback Form',
  'Product Description',
  LEGACY_VIDEO_WATCH_TASK_TITLE,
  'Data Copying',
  'Data Copying (Small)',
  'Referral Signup'
];

async function deleteTaskRowsByIds(taskIds) {
  if (!taskIds.length) return 0;
  await query('delete from task_assignments where task_id = any($1::uuid[])', [taskIds]);
  await query('delete from order_processing where task_id = any($1::uuid[])', [taskIds]);
  await query('delete from easy_earn_submissions where task_id = any($1::uuid[])', [taskIds]);
  await query('delete from easy_earn_videos where task_id = any($1::uuid[])', [taskIds]);
  const { rowCount } = await query('delete from tasks where id = any($1::uuid[])', [taskIds]);
  return rowCount;
}

async function deleteBeginnerTaskRowsByIds(taskIds) {
  if (!taskIds.length) return 0;
  await query('delete from beginner_task_submissions where task_id = any($1::uuid[])', [taskIds]);
  const { rowCount } = await query('delete from beginner_tasks where id = any($1::uuid[])', [taskIds]);
  return rowCount;
}

const EASY_EARN_CATEGORIES = {
  VIDEO: 'video',
  QUIZ: 'quiz',
  POLL: 'poll',
  PHOTO_SURVEY: 'photo_survey'
};

const PHOTO_SURVEY_TOTAL = 10;
const PHOTO_SURVEY_INTERVAL_MS = 3 * 60 * 1000;
const TELLER_PROCESSING_MS = 10 * 1000;

function alreadyClaimedTodayError() {
  const err = new Error("You've already completed today's Easy Earn task. Come back tomorrow.");
  err.code = 'ALREADY_CLAIMED_TODAY';
  return err;
}

async function getTodaysEasyEarnClaim(userId) {
  const { rows } = await query(
    'select * from easy_earn_daily_claims where user_id = $1 and claim_date = current_date',
    [userId]
  );
  return rows[0] || null;
}

// Credits a user's ONE allowed Easy Earn reward for today. The unique (user_id, claim_date)
// constraint on easy_earn_daily_claims is what actually enforces the daily cap under race
// conditions (e.g. double-clicks); the upfront check just gives a clean error message.
async function creditEasyEarnReward({ userId, category, taskId, amount, details }) {
  const existing = await getTodaysEasyEarnClaim(userId);
  if (existing) throw alreadyClaimedTodayError();

  try {
    await query(
      `insert into easy_earn_daily_claims (user_id, claim_date, category, task_id, amount, details)
       values ($1, current_date, $2, $3, $4, $5)`,
      [userId, category, taskId, amount, details ? JSON.stringify(details) : null]
    );
  } catch (err) {
    if (err.code === '23505') throw alreadyClaimedTodayError();
    throw err;
  }

  await query('update wallets set bonus = bonus + $1, updated_at = now() where user_id = $2', [amount, userId]);
  await query(
    'insert into transactions (user_id, type, amount, reason) values ($1, $2, $3, $4)',
    [userId, 'easy_earn', amount, `Easy Earn reward (${category})`]
  );
}

async function cleanupSeededTasks() {
  const { rows: beginnerRows } = await query(
    'select id from beginner_tasks where title = any($1::text[])',
    [LEGACY_SEEDED_TASK_TITLES]
  );
  const beginnerTasksRemoved = await deleteBeginnerTaskRowsByIds(beginnerRows.map(row => row.id));

  const { rows: catalogRows } = await query(
    'select id from tasks where title = any($1::text[]) and coalesce(is_easy_earn, false) = false',
    [LEGACY_SEEDED_TASK_TITLES]
  );
  const catalogTasksRemoved = await deleteTaskRowsByIds(catalogRows.map(row => row.id));

  // Dedup: keep only the oldest Easy Earn task per category (video/quiz/poll/photo_survey),
  // remove any extras. Categories are independent now, so this no longer assumes a single task.
  const { rows: extraEasyEarnRows } = await query(`
    select t1.id from tasks t1
    where coalesce(t1.is_easy_earn, false) = true
      and exists (
        select 1 from tasks t2
        where coalesce(t2.is_easy_earn, false) = true
          and coalesce(t2.category, '') = coalesce(t1.category, '')
          and t2.created_at < t1.created_at
      )
  `);
  const extraEasyEarnsRemoved = await deleteTaskRowsByIds(extraEasyEarnRows.map(row => row.id));

  return {
    beginnerTasksRemoved,
    catalogTasksRemoved,
    extraEasyEarnsRemoved
  };
}

async function getAppSetting(key, defaultValue = null) {
  const { rows } = await query('select value from app_settings where key = $1', [key]);
  if (!rows.length) return defaultValue;
  return rows[0].value;
}

async function getAllAppSettings() {
  const { rows } = await query('select key, value from app_settings');
  const settings = {
    commissionRate: 20,
    minWithdrawal: 50,
    platformName: 'DailyTrade',
    support: {
      financeDepartmentName: 'Finance Department Customer Service',
      financeTelegram: '@DailyTrader',
      financeManagerTelegram: '@DailyTradee',
      cfoTelegram: '@DailyTrader',
      generalSupportTelegram: '@DailyTrader',
      supportEmail: 'support@dailytrade.com',
      supportPhone: '+233 XXX XXX XXX',
      supportLiveChat: 'Telegram: @DailyTrader'
    },
    dailyCheckinAmount: 5
  };

  for (const row of rows) {
    const key = row.key;
    const value = row.value;
    if (key === 'commission_rate') {
      const parsed = Number(value);
      if (!Number.isNaN(parsed)) settings.commissionRate = parsed;
    } else if (key === 'min_withdrawal') {
      const parsed = Number(value);
      if (!Number.isNaN(parsed)) settings.minWithdrawal = parsed;
    } else if (key === 'platform_name') {
      if (value != null && value !== '') settings.platformName = value;
    } else if (key === 'support_finance_department_name') {
      if (value != null && value !== '') settings.support.financeDepartmentName = value;
    } else if (key === 'support_finance_telegram') {
      if (value != null && value !== '') settings.support.financeTelegram = value;
    } else if (key === 'support_finance_manager_telegram') {
      if (value != null && value !== '') settings.support.financeManagerTelegram = value;
    } else if (key === 'support_cfo_telegram') {
      if (value != null && value !== '') settings.support.cfoTelegram = value;
    } else if (key === 'support_general_telegram') {
      if (value != null && value !== '') settings.support.generalSupportTelegram = value;
    } else if (key === 'support_email') {
      if (value != null && value !== '') settings.support.supportEmail = value;
    } else if (key === 'support_phone') {
      if (value != null && value !== '') settings.support.supportPhone = value;
    } else if (key === 'support_live_chat') {
      if (value != null && value !== '') settings.support.supportLiveChat = value;
    } else if (key === 'daily_checkin_amount') {
      const parsed = Number(value);
      if (!Number.isNaN(parsed)) settings.dailyCheckinAmount = parsed;
    }
  }

  return settings;
}

async function upsertAppSetting(key, value) {
  await query(
    `insert into app_settings (key, value)
     values ($1, $2)
     on conflict (key) do update set value = excluded.value`,
    [key, String(value)]
  );
}

// Prevent caching for all API responses
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.set('Surrogate-Control', 'no-store');
  next();
});

app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(morgan('dev'));

app.get('/health', (req, res) => res.json({ ok: true }));

// Generate a unique 8-char referral code
function generateReferralCode(userId) {
  return 'DT' + userId.replace(/-/g, '').substring(0, 6).toUpperCase();
}

// Sync user profile (called after Supabase auth)
app.post('/users/sync', requireAuth, async (req, res) => {
  const { fullName, phone, referralCode } = req.body;
  const { id, email } = req.user;
  const myReferralCode = generateReferralCode(id);

  // Check if user already exists (to avoid giving bonus on re-sync)
  const { rows: existing } = await query('select id, referred_by from app_users where id = $1', [id]);
  const isNewUser = existing.length === 0;

  await query(
    `insert into app_users (id, email, full_name, phone, referral_code)
     values ($1, $2, $3, $4, $5)
     on conflict (id) do update set
       email = excluded.email,
       full_name = coalesce(excluded.full_name, app_users.full_name),
       phone = coalesce(excluded.phone, app_users.phone),
       referral_code = coalesce(app_users.referral_code, excluded.referral_code)`,
    [id, email, fullName || null, phone || null, myReferralCode]
  );
  await query(
    `insert into wallets (user_id) values ($1)
     on conflict (user_id) do nothing`,
    [id]
  );
  await query(
    `insert into teller_wallets (user_id) values ($1)
     on conflict (user_id) do nothing`,
    [id]
  );

  // Process referral bonus for new users only
  if (isNewUser && referralCode && referralCode.trim()) {
    try {
      const code = referralCode.trim().toUpperCase();
      // Don't allow self-referral
      if (code !== myReferralCode) {
        const { rows: referrers } = await query(
          'select id from app_users where referral_code = $1',
          [code]
        );
        if (referrers.length > 0) {
          const referrerId = referrers[0].id;
          // Mark who referred this user
          await query('update app_users set referred_by = $1 where id = $2', [referrerId, id]);
          // Record referral
          await query(
            `insert into referrals (referrer_id, referred_id, bonus_amount)
             values ($1, $2, 2.00)
             on conflict (referred_id) do nothing`,
            [referrerId, id]
          );
          // Credit referrer 2 GHC bonus
          await query(
            'update wallets set bonus = bonus + 2.00, updated_at = now() where user_id = $1',
            [referrerId]
          );
          // Record transaction for referrer
          await query(
            `insert into transactions (user_id, type, amount, reason)
             values ($1, 'referral_bonus', 2.00, $2)`,
            [referrerId, `Referral bonus for inviting ${email}`]
          );
        }
      }
    } catch (refErr) {
      console.error('Referral processing error:', refErr);
      // Don't fail user sync if referral fails
    }
  }

  res.json({ ok: true });
});

// Get user profile
app.get('/users/me', requireAuth, async (req, res) => {
  const { rows } = await query(
    `select u.id, u.email, u.full_name, u.phone, u.created_at,
            u.avatar_url, u.verification_required, u.verification_status, u.verification_requested_at,
            u.referral_code, w.balance, w.bonus
     from app_users u
     left join wallets w on u.id = w.user_id
     where u.id = $1`,
    [req.user.id]
  );
  
  if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
  res.json(rows[0]);
});

// Update user profile
app.put('/users/me', requireAuth, async (req, res) => {
  const fullName = typeof req.body.fullName === 'string' ? req.body.fullName.trim() : '';
  const phone = typeof req.body.phone === 'string' ? req.body.phone.trim() : '';

  if (!fullName) return res.status(400).json({ error: 'Name is required' });

  await query(
    'update app_users set full_name = $1, phone = $2 where id = $3',
    [fullName, phone || null, req.user.id]
  );

  const { rows } = await query(
    `select u.id, u.email, u.full_name, u.phone, u.created_at,
            u.avatar_url, u.verification_required, u.verification_status, u.verification_requested_at,
            u.referral_code, w.balance, w.bonus
     from app_users u
     left join wallets w on u.id = w.user_id
     where u.id = $1`,
    [req.user.id]
  );

  res.json(rows[0]);
});

app.post('/users/me/avatar', requireAuth, async (req, res) => {
  const avatarUrl = typeof req.body.avatarUrl === 'string' ? req.body.avatarUrl.trim() : '';
  if (!avatarUrl) return res.status(400).json({ error: 'Avatar image is required' });

  await query('update app_users set avatar_url = $1 where id = $2', [avatarUrl, req.user.id]);

  const { rows } = await query(
    `select u.id, u.email, u.full_name, u.phone, u.created_at,
            u.avatar_url, u.verification_required, u.verification_status, u.verification_requested_at,
            u.referral_code, w.balance, w.bonus
     from app_users u
     left join wallets w on u.id = w.user_id
     where u.id = $1`,
    [req.user.id]
  );

  res.json(rows[0]);
});

app.post('/users/me/verification', requireAuth, async (req, res) => {
  const {
    firstName,
    lastName,
    middleName,
    dateOfBirth,
    ghanaCardId,
    cardFrontData,
    cardBackData
  } = req.body;

  if (!firstName || !lastName || !dateOfBirth || !ghanaCardId) {
    return res.status(400).json({ error: 'Missing required verification fields' });
  }

  await query(
    `insert into identity_verifications
      (user_id, first_name, last_name, middle_name, date_of_birth, ghana_card_id, card_front_data, card_back_data, status, submitted_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', now())
     on conflict (user_id) do update set
       first_name = excluded.first_name,
       last_name = excluded.last_name,
       middle_name = excluded.middle_name,
       date_of_birth = excluded.date_of_birth,
       ghana_card_id = excluded.ghana_card_id,
       card_front_data = excluded.card_front_data,
       card_back_data = excluded.card_back_data,
       status = 'pending',
       reviewed_at = null,
       reviewed_by = null,
       review_notes = null,
       submitted_at = now()`,
    [req.user.id, firstName.trim(), lastName.trim(), middleName?.trim() || null, dateOfBirth, ghanaCardId.trim(), cardFrontData || null, cardBackData || null]
  );

  await query(
    'update app_users set verification_status = $1, verification_requested_at = now() where id = $2',
    ['pending', req.user.id]
  );

  res.json({ ok: true });
});

app.get('/users/me/verification', requireAuth, async (req, res) => {
  const { rows } = await query(
    `select u.verification_required, u.verification_status, u.verification_requested_at,
            v.first_name, v.last_name, v.middle_name, v.date_of_birth, v.ghana_card_id,
            v.card_front_data, v.card_back_data, v.status as submission_status,
            v.submitted_at, v.reviewed_at, v.reviewed_by, v.review_notes
     from app_users u
     left join identity_verifications v on u.id = v.user_id
     where u.id = $1`,
    [req.user.id]
  );

  if (rows.length === 0) return res.status(404).json({ error: 'Verification data not found' });
  res.json(rows[0]);
});

// Get referral stats
app.get('/users/me/referral-stats', requireAuth, async (req, res) => {
  try {
    const { rows: countRows } = await query(
      'select count(*) as total from referrals where referrer_id = $1',
      [req.user.id]
    );
    const { rows: bonusRows } = await query(
      'select coalesce(sum(bonus_amount), 0) as total_bonus from referrals where referrer_id = $1',
      [req.user.id]
    );
    res.json({
      invited: parseInt(countRows[0].total),
      totalBonus: parseFloat(bonusRows[0].total_bonus)
    });
  } catch (err) {
    console.error('Referral stats error:', err);
    res.json({ invited: 0, totalBonus: 0 });
  }
});

// Admin: get all users
// ...existing code...
app.get('/admin/users', requireAuth, requireAdmin, async (req, res) => {
  const { rows } = await query(
    `select u.id, u.email, u.full_name, u.phone, u.created_at,
            u.avatar_url, u.verification_required, u.verification_status, u.verification_requested_at,
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

app.post('/admin/users/:userId/reset-data', requireAuth, requireAdmin, async (req, res) => {
  const { userId } = req.params;

  if (userId === req.user.id) {
    return res.status(400).json({ error: 'You cannot reset your own account.' });
  }

  const client = await pool.connect();

  try {
    const existingUser = await client.query('select id from app_users where id = $1', [userId]);
    if (existingUser.rowCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    await client.query('BEGIN');

    await client.query('delete from task_completions where user_id = $1', [userId]);
    await client.query('delete from task_assignments where user_id = $1', [userId]);
    await client.query('delete from product_assignments where user_id = $1', [userId]);
    await client.query('delete from daily_checkins where user_id = $1', [userId]);
    await client.query('delete from transactions where user_id = $1', [userId]);
    await client.query('delete from withdrawals where user_id = $1', [userId]);
    await client.query('delete from deposits where user_id = $1', [userId]);
    await client.query('delete from payments where user_id = $1', [userId]);
    await client.query('delete from identity_verifications where user_id = $1', [userId]);
    await client.query('delete from referrals where referrer_id = $1 or referred_id = $1', [userId]);
    await client.query('delete from user_payment_numbers where user_id = $1', [userId]);

    await client.query(
      `insert into wallets (user_id, balance, bonus, updated_at)
       values ($1, 0, 0, now())
       on conflict (user_id) do update set balance = 0, bonus = 0, updated_at = now()` ,
      [userId]
    );

    await client.query(
      `update app_users
       set avatar_url = null,
           verification_required = false,
           verification_status = 'none',
           verification_requested_at = null,
           referred_by = null
       where id = $1`,
      [userId]
    );

    await client.query('COMMIT');
    res.json({ ok: true, message: 'User data reset successfully' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Reset user data error:', error);
    res.status(500).json({ error: 'Failed to reset user data' });
  } finally {
    client.release();
  }
});

app.get('/admin/users/:userId/verification', requireAuth, requireAdmin, async (req, res) => {
  const { rows } = await query(
    `select u.id, u.email, u.full_name, u.phone, u.verification_required, u.verification_status,
            v.first_name, v.last_name, v.middle_name, v.date_of_birth, v.ghana_card_id,
            v.card_front_data, v.card_back_data, v.status as submission_status,
            v.submitted_at, v.reviewed_at, v.reviewed_by, v.review_notes
     from app_users u
     left join identity_verifications v on u.id = v.user_id
     where u.id = $1`,
    [req.params.userId]
  );

  if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
  res.json(rows[0]);
});

app.post('/admin/users/:userId/verification/require', requireAuth, requireAdmin, async (req, res) => {
  const required = !!req.body.required;
  const status = required ? 'pending' : 'none';

  await query(
    `update app_users set verification_required = $1, verification_status = $2, verification_requested_at = case when $1 then now() else null end where id = $3`,
    [required, status, req.params.userId]
  );

  res.json({ ok: true });
});

app.post('/admin/users/:userId/verification/approve', requireAuth, requireAdmin, async (req, res) => {
  const reviewer = req.user.email || req.user.id;
  const notes = typeof req.body.notes === 'string' ? req.body.notes.trim() : null;

  await query('update identity_verifications set status = $1, reviewed_at = now(), reviewed_by = $2, review_notes = $3 where user_id = $4',
    ['approved', reviewer, notes, req.params.userId]
  );
  await query('update app_users set verification_status = $1 where id = $2', ['approved', req.params.userId]);

  res.json({ ok: true });
});

app.post('/admin/users/:userId/verification/reject', requireAuth, requireAdmin, async (req, res) => {
  const reviewer = req.user.email || req.user.id;
  const notes = typeof req.body.notes === 'string' ? req.body.notes.trim() : null;

  await query('update identity_verifications set status = $1, reviewed_at = now(), reviewed_by = $2, review_notes = $3 where user_id = $4',
    ['rejected', reviewer, notes, req.params.userId]
  );
  await query('update app_users set verification_status = $1 where id = $2', ['rejected', req.params.userId]);

  res.json({ ok: true });
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

// Daily check-in: get status
app.get('/checkin', requireAuth, async (req, res) => {
  const { id } = req.user;
  try {
    const { rows } = await query('select checkin_date from daily_checkins where user_id = $1 order by checkin_date desc limit 1', [id]);
    const last = rows[0]?.checkin_date || null;
    const today = new Date().toISOString().slice(0, 10);
    const checkedIn = last ? (new Date(last).toISOString().slice(0, 10) === today) : false;
    const setting = await getAppSetting('daily_checkin_amount', 5);
    const amount = Number(setting) || 0;
    res.json({ checkedIn, lastCheckin: last, amount });
  } catch (err) {
    console.error('Failed to get checkin status:', err);
    res.status(500).json({ error: 'Failed to get checkin status' });
  }
});

// Daily check-in: perform check-in and credit bonus
app.post('/checkin', requireAuth, async (req, res) => {
  const { id } = req.user;
  try {
    // Ensure user hasn't checked in today
    const { rows: existing } = await query('select 1 from daily_checkins where user_id = $1 and checkin_date = current_date', [id]);
    if (existing.length > 0) {
      return res.status(400).json({ error: 'Already checked in today' });
    }

    const setting = await getAppSetting('daily_checkin_amount', 5);
    const amount = Number(setting) || 0;

    // Record check-in
    await query('insert into daily_checkins (user_id, checkin_date) values ($1, current_date)', [id]);

    if (amount > 0) {
      await query('update wallets set bonus = bonus + $1, updated_at = now() where user_id = $2', [amount, id]);
      await query('insert into transactions (user_id, type, amount, reason) values ($1, $2, $3, $4)', [id, 'daily_checkin', amount, 'Daily check-in bonus']);
    }

    const { rows } = await query('select balance, bonus from wallets where user_id = $1', [id]);
    res.json({ ok: true, amount, wallet: rows[0] });
  } catch (err) {
    console.error('Failed to perform checkin:', err);
    // Handle unique constraint race (user checked in in parallel)
    if (err && (err.code === '23505' || (err.message && err.message.includes('duplicate key')))) {
      return res.status(400).json({ error: 'Already checked in today' });
    }
    res.status(500).json({ error: 'Failed to perform checkin' });
  }
});

app.get('/settings', async (req, res) => {
  const settings = await getAllAppSettings();
  res.json(settings);
});

// --- WhatsApp bot schedule ---
// The bot decides the daily schedule and pushes it here; the site only reads it to know
// which task type ('product' | 'beginner' | 'teller') is currently allowed.

const VALID_SCHEDULE_TASK_TYPES = ['product', 'beginner', 'teller'];

function requireSchedulerKey(req, res, next) {
  const key = req.headers['x-scheduler-key'];
  if (!process.env.SCHEDULER_API_KEY || key !== process.env.SCHEDULER_API_KEY) {
    return res.status(401).json({ error: 'Invalid or missing scheduler key' });
  }
  next();
}

// Bot pushes a new slot here as it decides/announces one
app.post('/schedule/slots', requireSchedulerKey, async (req, res) => {
  try {
    const { task_type, starts_at, ends_at, details } = req.body || {};
    if (!VALID_SCHEDULE_TASK_TYPES.includes(task_type)) {
      return res.status(400).json({ error: `task_type must be one of ${VALID_SCHEDULE_TASK_TYPES.join(', ')}` });
    }
    if (!starts_at || !ends_at || isNaN(Date.parse(starts_at)) || isNaN(Date.parse(ends_at))) {
      return res.status(400).json({ error: 'Valid starts_at and ends_at are required' });
    }
    const { rows } = await query(
      `insert into schedule_slots (task_type, starts_at, ends_at, details) values ($1, $2, $3, $4) returning *`,
      [task_type, starts_at, ends_at, details ? JSON.stringify(details) : null]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('Push schedule slot error:', err);
    res.status(500).json({ error: 'Failed to save schedule slot' });
  }
});

// Site reads this to know what's live right now
app.get('/schedule/current', async (req, res) => {
  try {
    const { rows } = await query(
      `select * from schedule_slots where starts_at <= now() and ends_at > now() order by starts_at desc limit 1`
    );
    if (rows.length === 0) return res.json({ active: false });
    const slot = rows[0];
    res.json({ active: true, task_type: slot.task_type, starts_at: slot.starts_at, ends_at: slot.ends_at, details: slot.details });
  } catch (err) {
    console.error('Get current schedule error:', err);
    res.status(500).json({ error: 'Failed to load current schedule' });
  }
});

// Full day view, mainly for admin/debugging
app.get('/schedule/today', async (req, res) => {
  try {
    const { rows } = await query(
      `select id, task_type, starts_at, ends_at, details from schedule_slots
       where starts_at >= date_trunc('day', now()) and starts_at < date_trunc('day', now()) + interval '1 day'
       order by starts_at asc`
    );
    res.json(rows);
  } catch (err) {
    console.error('Get today schedule error:', err);
    res.status(500).json({ error: 'Failed to load today\'s schedule' });
  }
});

app.post('/admin/settings', requireAuth, requireAdmin, async (req, res) => {
  const {
    commissionRate,
    minWithdrawal,
    platformName,
    support = {},
    dailyCheckinAmount
  } = req.body;

  if (commissionRate !== undefined) {
    await upsertAppSetting('commission_rate', commissionRate);
  }
  if (minWithdrawal !== undefined) {
    await upsertAppSetting('min_withdrawal', minWithdrawal);
  }
  if (platformName !== undefined) {
    await upsertAppSetting('platform_name', platformName);
  }

  if (support.financeDepartmentName !== undefined) {
    await upsertAppSetting('support_finance_department_name', support.financeDepartmentName);
  }
  if (support.financeTelegram !== undefined) {
    await upsertAppSetting('support_finance_telegram', support.financeTelegram);
  }
  if (support.financeManagerTelegram !== undefined) {
    await upsertAppSetting('support_finance_manager_telegram', support.financeManagerTelegram);
  }
  if (support.cfoTelegram !== undefined) {
    await upsertAppSetting('support_cfo_telegram', support.cfoTelegram);
  }
  if (support.generalSupportTelegram !== undefined) {
    await upsertAppSetting('support_general_telegram', support.generalSupportTelegram);
  }
  if (support.supportEmail !== undefined) {
    await upsertAppSetting('support_email', support.supportEmail);
  }
  if (support.supportPhone !== undefined) {
    await upsertAppSetting('support_phone', support.supportPhone);
  }
  if (support.supportLiveChat !== undefined) {
    await upsertAppSetting('support_live_chat', support.supportLiveChat);
  }
  if (dailyCheckinAmount !== undefined) {
    await upsertAppSetting('daily_checkin_amount', dailyCheckinAmount);
  }

  res.json({ ok: true });
});

app.get('/users/me/checkin', requireAuth, async (req, res) => {
  const { id: userId } = req.user;
  const settings = await getAllAppSettings();
  const { rows } = await query(
    `select checkin_date from daily_checkins where user_id = $1 order by checkin_date desc limit 1`,
    [userId]
  );
  const today = new Date().toISOString().slice(0, 10);
  const lastCheckin = rows[0]?.checkin_date;
  const lastCheckinDate = lastCheckin ? new Date(lastCheckin).toISOString().slice(0, 10) : null;

  res.json({
    lastCheckin: lastCheckinDate,
    eligible: lastCheckinDate !== today,
    amount: Number(settings.dailyCheckinAmount) || 5
  });
});

app.post('/users/me/checkin', requireAuth, async (req, res) => {
  const { id: userId } = req.user;
  const settings = await getAllAppSettings();
  const amount = Number(settings.dailyCheckinAmount) || 5;
  const today = new Date().toISOString().slice(0, 10);

  const { rows } = await query(
    `select checkin_date from daily_checkins where user_id = $1 order by checkin_date desc limit 1`,
    [userId]
  );
  const lastCheckin = rows[0]?.checkin_date;
  const lastCheckinDate = lastCheckin ? new Date(lastCheckin).toISOString().slice(0, 10) : null;

  if (lastCheckinDate === today) {
    return res.status(400).json({ error: 'You have already claimed today\'s check-in reward.' });
  }

  await query(
    `insert into daily_checkins (user_id, checkin_date)
     values ($1, $2)`,
    [userId, today]
  );
  await query(
    'update wallets set bonus = bonus + $1, updated_at = now() where user_id = $2',
    [amount, userId]
  );
  await query(
    `insert into transactions (user_id, type, amount, reason)
     values ($1, 'daily_checkin', $2, $3)`,
    [userId, amount, 'Daily check-in reward']
  );

  res.json({ ok: true, amount, nextCheckin: today });
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

  const { rows: profileRows } = await query(
    'select verification_required, verification_status from app_users where id = $1',
    [id]
  );
  const verificationRule = canWithdrawAmount(profileRows[0] || {}, numericAmount);
  if (!verificationRule.allowed) {
    return res.status(403).json({
      error: verificationRule.reason || 'Verification is required before withdrawals above GHC 20.00.'
    });
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

  const { rows: paymentRows } = await query(
    `insert into payments (user_id, amount, method, phone, payment_number)
     values ($1, $2, $3, $4, $5)
     returning id`,
    [id, amount, method, phone, paymentNumber]
  );

  const { rows } = await query(
    `select p.*, upn.method as payment_number_method
     from payments p
     left join user_payment_numbers upn on upn.user_id = p.user_id
     where p.id = $1`,
    [paymentRows[0].id]
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

// Admin: delete payment request
app.delete('/admin/payments/:id', requireAuth, requireAdmin, async (req, res) => {
  const { id: paymentId } = req.params;

  const { rows } = await query(
    'delete from payments where id = $1 returning *',
    [paymentId]
  );

  if (rows.length === 0) return res.status(404).json({ error: 'Payment not found' });
  res.json({ ok: true });
});

// Admin: add deposit/bonus
app.post('/admin/deposits', requireAuth, requireAdmin, async (req, res) => {
  const { userId, amount = 0, bonus = 0, reason } = req.body;
  if (amount <= 0 && bonus <= 0) return res.status(400).json({ error: 'Amount or bonus required' });

  await query('update wallets set balance = balance + $1, bonus = bonus + $2, updated_at = now() where user_id = $3', [amount, bonus, userId]);
  await query('insert into deposits (user_id, amount, bonus, reason) values ($1, $2, $3, $4)', [userId, amount, bonus, reason || 'Account top-up']);
  if (amount > 0) {
    await query('insert into transactions (user_id, type, amount, reason) values ($1, $2, $3, $4)', [userId, 'deposit', amount, reason || 'Account top-up']);
  }
  if (bonus > 0) {
    await query('insert into transactions (user_id, type, amount, reason) values ($1, $2, $3, $4)', [userId, 'bonus', bonus, reason || 'Bonus credit']);
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
     where ta.user_id = $1 and coalesce(t.is_easy_earn, false) = false
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
  const { rows } = await query('select * from tasks where coalesce(is_easy_earn, false) = false order by created_at desc');
  res.json(rows);
});

// Admin: list/manage Easy Earns tasks
app.get('/admin/easy-earns', requireAuth, requireAdmin, async (req, res) => {
  const { rows } = await query('select * from tasks where is_easy_earn = true order by created_at desc');
  res.json(rows);
});

app.post('/admin/easy-earns', requireAuth, requireAdmin, async (req, res) => {
  const { title, description, amount, commission, videos } = req.body;
  if (!title || !amount) return res.status(400).json({ error: 'Title and amount required' });
  const { rows } = await query(`insert into tasks (title, description, amount, commission, status, is_easy_earn) values ($1,$2,$3,$4,$5,true) returning *`, [title, description || null, amount, commission || 0, 'active']);
  const task = rows[0];
  if (Array.isArray(videos) && videos.length) {
    for (let i = 0; i < videos.length; i++) {
      const v = videos[i];
      await query('insert into easy_earn_videos (task_id, video_index, title, url, duration_seconds) values ($1,$2,$3,$4,$5)', [task.id, i+1, v.title || null, v.url || null, v.duration_seconds || 0]);
    }
  }
  res.json(task);
});

app.put('/admin/easy-earns/:id', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { title, description, amount, commission, status } = req.body;
  const { rows } = await query(`update tasks set title = coalesce($1,title), description = coalesce($2,description), amount = coalesce($3,amount), commission = coalesce($4,commission), status = coalesce($5,status), is_easy_earn = true where id = $6 returning *`, [title || null, description || null, typeof amount === 'undefined' ? null : amount, typeof commission === 'undefined' ? null : commission, status || null, id]);
  if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

app.delete('/admin/easy-earns/:id', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  await query('delete from easy_earn_videos where task_id = $1', [id]);
  const { rowCount } = await query('delete from tasks where id = $1 and is_easy_earn = true', [id]);
  if (rowCount === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

// Admin: manage videos for an Easy Earns task
app.post('/admin/easy-earns/:id/videos', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params; // task id
    const { title, url, duration_seconds, video_index } = req.body || {};
    if (!url) return res.status(400).json({ error: 'Video url is required' });
    const { rows } = await query(
      `insert into easy_earn_videos (task_id, video_index, title, url, duration_seconds) values ($1,$2,$3,$4,$5) returning *`,
      [id, video_index || 0, title || null, url, duration_seconds || 0]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('Admin add video error:', err);
    res.status(500).json({ error: 'Failed to add video' });
  }
});

app.put('/admin/easy-earns/:id/videos/:videoId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id: taskId, videoId } = req.params;
    const { title, url, duration_seconds, video_index } = req.body || {};
    const { rows } = await query(
      `update easy_earn_videos set title = coalesce($1,title), url = coalesce($2,url), duration_seconds = coalesce($3,duration_seconds), video_index = coalesce($4,video_index) where id = $5 and task_id = $6 returning *`,
      [title || null, url || null, typeof duration_seconds === 'undefined' ? null : duration_seconds, typeof video_index === 'undefined' ? null : video_index, videoId, taskId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Video not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Admin update video error:', err);
    res.status(500).json({ error: 'Failed to update video' });
  }
});

app.delete('/admin/easy-earns/:id/videos/:videoId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id: taskId, videoId } = req.params;
    const { rowCount } = await query('delete from easy_earn_videos where id = $1 and task_id = $2', [videoId, taskId]);
    if (rowCount === 0) return res.status(404).json({ error: 'Video not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Admin delete video error:', err);
    res.status(500).json({ error: 'Failed to delete video' });
  }
});

// Admin cleanup: remove previously seeded task-ideas except the Video Watch Task
app.post('/admin/easy-earns/cleanup', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await cleanupSeededTasks();
    await ensureInitialTasks();
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('Cleanup error:', err);
    res.status(500).json({ error: 'Cleanup failed' });
  }
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

// Admin: list recent task assignments (with user + task info)
app.get('/admin/task-assignments', requireAuth, requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit || '100', 10), 1), 1000);
    const { rows } = await query(
      `select ta.id as assignment_id, ta.task_id, ta.user_id, ta.status as assignment_status, ta.assigned_at, ta.completed_at,
              t.title as task_title, t.amount as task_amount,
              u.full_name as user_name, u.email as user_email
       from task_assignments ta
       join tasks t on t.id = ta.task_id
       join app_users u on u.id = ta.user_id
       order by ta.assigned_at desc
       limit $1`,
      [limit]
    );
    res.json(rows);
  } catch (err) {
    console.error('Failed to list task assignments:', err);
    res.status(500).json({ error: 'Failed to list task assignments' });
  }
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

// Admin: Assign teller product tasks (level 100/200/300)
app.post('/admin/teller-assignments', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { productId, userIds, level, count } = req.body;
    const numericLevel = Number(level);
    const assignCount = Math.min(Math.max(Number(count || 1), 1), 3);

    if (!productId || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ error: 'Product ID and user IDs are required' });
    }

    if (![100, 200, 300].includes(numericLevel)) {
      return res.status(400).json({ error: 'Invalid level. Use 100, 200, or 300.' });
    }

    let assigned = 0;
    let skipped = 0;
    let reachedMax = 0;

    for (const userId of userIds) {
      try {
        const { rows } = await query(
          `select count(*)::int as total
           from teller_product_assignments
           where user_id = $1 and level = $2`,
          [userId, numericLevel]
        );
        const existingCount = Number(rows[0]?.total || 0);

        if (existingCount >= 3) {
          reachedMax++;
          continue;
        }

        const remaining = 3 - existingCount;
        const toAssign = Math.min(assignCount, remaining);

        for (let i = 0; i < toAssign; i++) {
          await query(
            `insert into teller_product_assignments (user_id, product_id, level, order_index)
             values ($1, $2, $3, $4)`,
            [userId, productId, numericLevel, existingCount + i + 1]
          );
          assigned++;
        }
      } catch (error) {
        skipped++;
      }
    }

    res.json({ assigned, skipped, reachedMax });
  } catch (error) {
    console.error('Error assigning teller tasks:', error);
    res.status(500).json({ error: 'Failed to assign teller tasks: ' + error.message });
  }
});

// Admin: Get teller assignments by level
app.get('/admin/teller-assignments', requireAuth, requireAdmin, async (req, res) => {
  const level = Number(req.query.level || 100);
  if (![100, 200, 300].includes(level)) {
    return res.status(400).json({ error: 'Invalid level. Use 100, 200, or 300.' });
  }

  const { rows } = await query(
    `select tpa.id, tpa.level, tpa.status, tpa.order_index, tpa.assigned_at, tpa.completed_at,
            u.id as user_id, u.email, u.full_name,
            p.id as product_id, p.name, p.price, p.commission
     from teller_product_assignments tpa
     join app_users u on u.id = tpa.user_id
     join products p on p.id = tpa.product_id
     where tpa.level = $1
     order by tpa.assigned_at desc`,
    [level]
  );
  res.json(rows);
});

// Teller: Get status and current level
app.get('/teller/status', requireAuth, async (req, res) => {
  const { id: userId } = req.user;
  await query(
    `insert into teller_wallets (user_id) values ($1)
     on conflict (user_id) do nothing`,
    [userId]
  );

  const levels = [100, 200, 300];
  const levelStats = {};

  for (const level of levels) {
    const { rows } = await query(
      `select count(*)::int as total,
              count(*) filter (where status = 'completed')::int as completed,
              count(*) filter (where status != 'completed')::int as pending
       from teller_product_assignments
       where user_id = $1 and level = $2`,
      [userId, level]
    );
    levelStats[level] = rows[0] || { total: 0, completed: 0, pending: 0 };
  }

  let currentLevel = null;
  for (const level of levels) {
    const stats = levelStats[level];
    if ((stats.total || 0) > 0 && (stats.completed || 0) < (stats.total || 0)) {
      currentLevel = level;
      break;
    }
  }

  const { rows: walletRows } = await query(
    `select balance, last_withdrawn_level from teller_wallets where user_id = $1`,
    [userId]
  );
  const tellerBalance = Number(walletRows[0]?.balance || 0);
  const lastWithdrawnLevel = Number(walletRows[0]?.last_withdrawn_level || 0);

  let highestCompletedLevel = 0;
  for (const level of levels) {
    const stats = levelStats[level];
    if ((stats.total || 0) > 0 && (stats.completed || 0) === (stats.total || 0)) {
      highestCompletedLevel = level;
    }
  }

  const canWithdraw = tellerBalance > 0 && highestCompletedLevel > lastWithdrawnLevel;

  res.json({
    currentLevel,
    levels: levelStats,
    tellerBalance,
    lastWithdrawnLevel,
    highestCompletedLevel,
    canWithdraw
  });
});

// Teller: Get current task for active level
app.get('/teller/task', requireAuth, async (req, res) => {
  const { id: userId } = req.user;
  const levels = [100, 200, 300];

  let currentLevel = null;
  for (const level of levels) {
    const { rows } = await query(
      `select count(*)::int as total,
              count(*) filter (where status = 'completed')::int as completed
       from teller_product_assignments
       where user_id = $1 and level = $2`,
      [userId, level]
    );
    const total = Number(rows[0]?.total || 0);
    const completed = Number(rows[0]?.completed || 0);
    if (total > 0 && completed < total) {
      currentLevel = level;
      break;
    }
  }

  if (!currentLevel) {
    return res.json({ level: null, task: null });
  }

  const { rows: taskRows } = await query(
    `select tpa.id as assignment_id, tpa.level, tpa.status, tpa.order_index,
            p.id as product_id, p.name, p.description, p.price, p.image, p.commission
     from teller_product_assignments tpa
     join products p on p.id = tpa.product_id
     where tpa.user_id = $1 and tpa.level = $2 and tpa.status in ('pending', 'in_progress')
     order by (case when tpa.status = 'in_progress' then 0 else 1 end), tpa.order_index asc, tpa.assigned_at asc
     limit 1`,
    [userId, currentLevel]
  );

  res.json({ level: currentLevel, task: taskRows[0] || null });
});

// Teller: Start task (deduct from main wallet)
app.post('/teller/assignments/:id/start', requireAuth, async (req, res) => {
  const { id: assignmentId } = req.params;
  const { id: userId } = req.user;

  const { rows } = await query(
    `select tpa.id, tpa.level, tpa.status, tpa.order_index,
            p.id as product_id, p.name, p.price, p.commission
     from teller_product_assignments tpa
     join products p on p.id = tpa.product_id
     where tpa.id = $1 and tpa.user_id = $2`,
    [assignmentId, userId]
  );

  if (rows.length === 0) {
    return res.status(404).json({ error: 'Teller task not found' });
  }

  const task = rows[0];
  if (task.status === 'completed') {
    return res.status(400).json({ error: 'Task already completed' });
  }
  if (task.status === 'in_progress') {
    return res.status(400).json({ error: 'Task already started' });
  }

  const levels = [100, 200, 300];
  let currentLevel = null;
  for (const level of levels) {
    const { rows: levelRows } = await query(
      `select count(*)::int as total,
              count(*) filter (where status = 'completed')::int as completed
       from teller_product_assignments
       where user_id = $1 and level = $2`,
      [userId, level]
    );
    const total = Number(levelRows[0]?.total || 0);
    const completed = Number(levelRows[0]?.completed || 0);
    if (total > 0 && completed < total) {
      currentLevel = level;
      break;
    }
  }

  if (!currentLevel || currentLevel !== Number(task.level)) {
    return res.status(400).json({ error: 'This level is not active yet' });
  }

  const { rows: inProgressRows } = await query(
    `select id from teller_product_assignments
     where user_id = $1 and level = $2 and status = 'in_progress'`,
    [userId, currentLevel]
  );
  if (inProgressRows.length > 0 && inProgressRows[0].id !== assignmentId) {
    return res.status(400).json({ error: 'Finish your current teller task before starting a new one' });
  }

  const { rows: walletRows } = await query('select balance from wallets where user_id = $1', [userId]);
  const balance = Number(walletRows[0]?.balance || 0);
  const price = Number(task.price || 0);

  if (price <= 0) {
    return res.status(400).json({ error: 'Invalid task price' });
  }

  if (balance < price) {
    return res.status(400).json({ error: 'Insufficient balance' });
  }

  const interestAmount = (price * Number(task.commission || 0)) / 100;
  const totalReturn = price + interestAmount;

  await query(
    'update wallets set balance = balance - $1, updated_at = now() where user_id = $2',
    [price, userId]
  );
  await query(
    'insert into transactions (user_id, type, amount, reason) values ($1, $2, $3, $4)',
    [userId, 'teller_task_cost', price, `Teller task started: ${task.name}`]
  );

  await query(
    `update teller_product_assignments
     set status = 'in_progress', started_at = now()
     where id = $1 and user_id = $2`,
    [assignmentId, userId]
  );

  res.json({
    ok: true,
    task: {
      assignmentId: task.id,
      name: task.name,
      price,
      commission: Number(task.commission || 0),
      interestAmount,
      totalReturn
    }
  });
});

// Teller: Complete task (credit teller wallet)
app.post('/teller/assignments/:id/complete', requireAuth, async (req, res) => {
  const { id: assignmentId } = req.params;
  const { id: userId } = req.user;

  const { rows } = await query(
    `select tpa.id, tpa.status, tpa.level, tpa.started_at,
            p.id as product_id, p.name, p.price, p.commission
     from teller_product_assignments tpa
     join products p on p.id = tpa.product_id
     where tpa.id = $1 and tpa.user_id = $2`,
    [assignmentId, userId]
  );

  if (rows.length === 0) {
    return res.status(404).json({ error: 'Teller task not found' });
  }

  const task = rows[0];
  if (task.status !== 'in_progress') {
    return res.status(400).json({ error: 'Task must be started first' });
  }

  const startedAt = task.started_at ? new Date(task.started_at) : null;
  const readyAt = startedAt ? new Date(startedAt.getTime() + TELLER_PROCESSING_MS) : null;
  if (readyAt && Date.now() < readyAt.getTime()) {
    const secondsLeft = Math.ceil((readyAt.getTime() - Date.now()) / 1000);
    return res.status(400).json({ error: `Task is still processing. Try again in ${secondsLeft}s.`, ready_at: readyAt });
  }

  const price = Number(task.price || 0);
  const interestAmount = (price * Number(task.commission || 0)) / 100;
  const totalReturn = price + interestAmount;

  await query(
    `update teller_product_assignments
     set status = 'completed', completed_at = now()
     where id = $1 and user_id = $2`,
    [assignmentId, userId]
  );

  await query(
    `insert into teller_wallets (user_id, balance)
     values ($1, $2)
     on conflict (user_id) do update set balance = teller_wallets.balance + excluded.balance, updated_at = now()`,
    [userId, totalReturn]
  );

  await query(
    'insert into transactions (user_id, type, amount, reason) values ($1, $2, $3, $4)',
    [userId, 'teller_task_reward', totalReturn, `Teller task completed: ${task.name}`]
  );

  const { rows: walletRows } = await query('select balance from teller_wallets where user_id = $1', [userId]);
  res.json({ ok: true, tellerBalance: Number(walletRows[0]?.balance || 0) });
});

// Teller: Withdraw teller balance to main balance
app.post('/teller/withdraw', requireAuth, async (req, res) => {
  const { id: userId } = req.user;
  const levels = [100, 200, 300];

  const levelStats = {};
  for (const level of levels) {
    const { rows } = await query(
      `select count(*)::int as total,
              count(*) filter (where status = 'completed')::int as completed
       from teller_product_assignments
       where user_id = $1 and level = $2`,
      [userId, level]
    );
    levelStats[level] = rows[0] || { total: 0, completed: 0 };
  }

  let highestCompletedLevel = 0;
  for (const level of levels) {
    const stats = levelStats[level];
    if ((stats.total || 0) > 0 && (stats.completed || 0) === (stats.total || 0)) {
      highestCompletedLevel = level;
    }
  }

  const { rows: walletRows } = await query(
    'select balance, last_withdrawn_level from teller_wallets where user_id = $1',
    [userId]
  );
  const tellerBalance = Number(walletRows[0]?.balance || 0);
  const lastWithdrawnLevel = Number(walletRows[0]?.last_withdrawn_level || 0);

  if (tellerBalance <= 0) {
    return res.status(400).json({ error: 'No teller balance available' });
  }

  if (highestCompletedLevel <= lastWithdrawnLevel) {
    return res.status(400).json({ error: 'Complete a level before withdrawing' });
  }

  await query(
    'update wallets set balance = balance + $1, updated_at = now() where user_id = $2',
    [tellerBalance, userId]
  );
  await query(
    'update teller_wallets set balance = 0, last_withdrawn_level = $1, updated_at = now() where user_id = $2',
    [highestCompletedLevel, userId]
  );
  await query(
    'insert into transactions (user_id, type, amount, reason) values ($1, $2, $3, $4)',
    [userId, 'teller_withdraw', tellerBalance, 'Teller balance withdrawn to main wallet']
  );

  const { rows: finalWallet } = await query('select balance from wallets where user_id = $1', [userId]);
  res.json({ ok: true, balance: Number(finalWallet[0]?.balance || 0) });
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

// User: claim a public task from the catalog (assign to self)
app.post('/tasks/:id/claim', requireAuth, async (req, res) => {
  try {
    const { id: taskId } = req.params;
    const { id: userId } = req.user;

    // Verify task exists and is active
    const { rows: taskRows } = await query('select id, status from tasks where id = $1', [taskId]);
    if (taskRows.length === 0) return res.status(404).json({ error: 'Task not found' });
    if (taskRows[0].status !== 'active') return res.status(400).json({ error: 'Task is not active' });

    // Try to assign to user (idempotent)
    const { rows } = await query(
      `insert into task_assignments (task_id, user_id, status, assigned_at)
       values ($1, $2, 'pending', now())
       on conflict (task_id, user_id) do nothing
       returning *`,
      [taskId, userId]
    );

    if (rows.length === 0) {
      // Already assigned - return current assignment row
      const { rows: existing } = await query('select * from task_assignments where task_id = $1 and user_id = $2', [taskId, userId]);
      return res.json({ ok: true, message: 'Already assigned', assignment: existing[0] });
    }

    res.json({ ok: true, message: 'Task assigned', assignment: rows[0] });
  } catch (error) {
    console.error('Error claiming task:', error);
    res.status(500).json({ error: 'Failed to claim task' });
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
async function getBeginnerTasksForUser(userId) {
  const { rows: tasks } = await query(
    `select * from beginner_tasks where status = 'active' order by created_at desc`
  );

  for (const task of tasks) {
    const { rows: lastSubmission } = await query(
      `select submitted_at from beginner_task_submissions
       where task_id = $1 and user_id = $2
       order by submitted_at desc limit 1`,
      [task.id, userId]
    );

    if (lastSubmission.length > 0) {
      task.last_submitted_at = lastSubmission[0].submitted_at;
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

  return tasks;
}

app.get('/beginner-tasks', requireAuth, async (req, res) => {
  try {
    const { id: userId } = req.user;
    res.json(await getBeginnerTasksForUser(userId));
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

// Order processing: Start an order (called after user deducts cost)
app.post('/orders/start', requireAuth, async (req, res) => {
  const { taskId, productId, cost, interest, totalReturn } = req.body;
  const { id: userId } = req.user;

  if (!taskId && !productId) {
    return res.status(400).json({ error: 'Task ID or Product ID required' });
  }

  try {
    const { rows } = await query(
      `insert into order_processing (user_id, task_id, product_id, cost, interest, total_return, current_step, total_steps)
       values ($1, $2, $3, $4, $5, $6, 0, 15)
       returning id, current_step, total_steps, status`,
      [userId, taskId || null, productId || null, cost || 0, interest || 0, totalReturn || 0]
    );

    if (rows.length === 0) {
      return res.status(500).json({ error: 'Failed to create order' });
    }

    const orderId = rows[0].id;

    // Start automatic background processing after 1 second
    setTimeout(() => {
      advanceOrderProcessing(orderId, userId).catch(err => {
        console.error('Error advancing order:', err);
      });
    }, 1000);

    res.json({ ok: true, orderId });
  } catch (error) {
    console.error('Error starting order:', error);
    res.status(500).json({ error: 'Failed to start order' });
  }
});

// Order processing: Get current status and progress
app.get('/orders/:orderId/status', requireAuth, async (req, res) => {
  const { orderId } = req.params;
  const { id: userId } = req.user;

  try {
    const { rows } = await query(
      `select * from order_processing where id = $1 and user_id = $2`,
      [orderId, userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const order = rows[0];
    const progress = Math.round((order.current_step / order.total_steps) * 100);

    res.json({
      orderId: order.id,
      status: order.status,
      currentStep: order.current_step,
      totalSteps: order.total_steps,
      progress,
      cost: order.cost,
      interest: order.interest,
      totalReturn: order.total_return,
      completedAt: order.completed_at
    });
  } catch (error) {
    console.error('Error getting order status:', error);
    res.status(500).json({ error: 'Failed to get order status' });
  }
});

// Background order processing function
async function advanceOrderProcessing(orderId, userId) {
  const maxSteps = 15;
  const stepDuration = 12000; // 12 seconds per step

  for (let step = 1; step <= maxSteps; step++) {
    // Update progress
    await query(
      `update order_processing set current_step = $1 where id = $2 and user_id = $3`,
      [step, orderId, userId]
    );

    // If last step, mark as completed and credit earnings
    if (step === maxSteps) {
      const { rows } = await query(
        `select * from order_processing where id = $1 and user_id = $2`,
        [orderId, userId]
      );

      if (rows.length > 0) {
        const order = rows[0];
        const totalReturn = parseFloat(order.total_return) || 0;

        // Credit the earnings to user's bonus wallet
        await query(
          `update wallets set bonus = bonus + $1, updated_at = now() where user_id = $2`,
          [totalReturn, userId]
        );

        // Record transaction
        const taskOrProduct = order.task_id ? 'task' : 'product';
        await query(
          `insert into transactions (user_id, type, amount, reason) values ($1, $2, $3, $4)`,
          [userId, 'order_reward', totalReturn, `Order completed - ${taskOrProduct} reward`]
        );

        // Mark task/product assignment as completed
        if (order.task_id) {
          await query(
            `update task_assignments set status = 'completed', completed_at = now() where task_id = $1 and user_id = $2`,
            [order.task_id, userId]
          );
        } else if (order.product_id) {
          await query(
            `update product_assignments set status = 'completed', completed_at = now() where product_id = $1 and user_id = $2`,
            [order.product_id, userId]
          );
        }

        // Mark order as completed
        await query(
          `update order_processing set status = 'completed', completed_at = now() where id = $1`,
          [orderId]
        );
      }
      break;
    }

    // Wait before next step
    await new Promise(resolve => setTimeout(resolve, stepDuration));
  }
}

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
  // Mark tasks that belong to the Easy Earns feature
  await query('alter table tasks add column if not exists is_easy_earn boolean not null default false');

  // Table to store video lists for video-watch easy-earn tasks
  await query(`
    create table if not exists easy_earn_videos (
      id uuid primary key default gen_random_uuid(),
      task_id uuid not null references tasks(id) on delete cascade,
      video_index int not null,
      title text,
      url text,
      duration_seconds int default 0,
      created_at timestamptz default now()
    )
  `);
  
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

  // Easy-earn submissions (separate from beginner tasks)
  await query(`
    create table if not exists easy_earn_submissions (
      id uuid primary key default gen_random_uuid(),
      task_id uuid not null references tasks(id) on delete cascade,
      user_id uuid not null references app_users(id) on delete cascade,
      url text,
      notes text,
      status text not null default 'submitted',
      awarded_amount numeric(12,2) default 0,
      submitted_at timestamptz default now(),
      reviewed_at timestamptz,
      reviewed_by text
    )
  `);

  // Easy Earns categories: video (existing), quiz, poll, photo_survey
  await query(`alter table tasks add column if not exists category text`);
  await query(`update tasks set category = 'video' where coalesce(is_easy_earn, false) = true and category is null`);
  // One-time rename of the old title. No-op once an admin has renamed it to anything else.
  await query(
    `update tasks set title = $1 where title = $2 and coalesce(is_easy_earn, false) = true`,
    [VIDEO_WATCH_TASK_TITLE, LEGACY_VIDEO_WATCH_TASK_TITLE]
  );

  // One claim per user per day across ALL Easy Earn categories - the daily-cap gate
  await query(`
    create table if not exists easy_earn_daily_claims (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references app_users(id) on delete cascade,
      claim_date date not null,
      category text not null,
      task_id uuid references tasks(id) on delete set null,
      amount numeric(12,2) not null default 0,
      details jsonb,
      created_at timestamptz default now(),
      unique (user_id, claim_date)
    )
  `);

  // Quiz: admin-configured questions per quiz task. Correct answers never sent to the client.
  await query(`
    create table if not exists easy_earn_quiz_questions (
      id uuid primary key default gen_random_uuid(),
      task_id uuid not null references tasks(id) on delete cascade,
      question_index int not null,
      question_text text not null,
      options jsonb not null,
      correct_option_index int not null,
      created_at timestamptz default now()
    )
  `);

  // Poll: admin-configured options per poll task. Any selection completes it.
  await query(`
    create table if not exists easy_earn_poll_options (
      id uuid primary key default gen_random_uuid(),
      task_id uuid not null references tasks(id) on delete cascade,
      option_index int not null,
      option_text text not null,
      created_at timestamptz default now()
    )
  `);

  // Photo Survey: admin-configured daily prompt pool (object/person/random)
  await query(`
    create table if not exists easy_earn_photo_prompts (
      id uuid primary key default gen_random_uuid(),
      task_id uuid not null references tasks(id) on delete cascade,
      prompt_index int not null,
      prompt_text text not null,
      prompt_category text not null default 'object',
      created_at timestamptz default now()
    )
  `);

  // Photo Survey: one row per submitted photo, enforces the 3-minute interval and daily 10-photo count
  await query(`
    create table if not exists easy_earn_photo_submissions (
      id uuid primary key default gen_random_uuid(),
      task_id uuid not null references tasks(id) on delete cascade,
      user_id uuid not null references app_users(id) on delete cascade,
      submit_date date not null,
      prompt_index int not null,
      photo_url text not null,
      caption text not null,
      submitted_at timestamptz default now(),
      unique (task_id, user_id, submit_date, prompt_index)
    )
  `);

  // Daily broadcast schedule - pushed by the WhatsApp bot, read by the site to know
  // which task type ('product' | 'beginner' | 'teller') is currently allowed.
  await query(`
    create table if not exists schedule_slots (
      id uuid primary key default gen_random_uuid(),
      task_type text not null,
      starts_at timestamptz not null,
      ends_at timestamptz not null,
      details jsonb,
      created_at timestamptz default now()
    )
  `);
  await query('create index if not exists schedule_slots_time_idx on schedule_slots(starts_at, ends_at)');

  await query(`
    create table if not exists teller_wallets (
      user_id uuid primary key references app_users(id) on delete cascade,
      balance numeric(12,2) not null default 0,
      last_withdrawn_level int not null default 0,
      updated_at timestamptz default now()
    )
  `);

  await query(`
    create table if not exists teller_product_assignments (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references app_users(id) on delete cascade,
      product_id uuid not null references products(id) on delete cascade,
      level int not null,
      status text not null default 'pending',
      order_index int not null default 1,
      assigned_at timestamptz default now(),
      started_at timestamptz,
      completed_at timestamptz
    )
  `);
  await query('alter table teller_product_assignments add column if not exists started_at timestamptz');
  await query('create index if not exists teller_assignments_user_level_idx on teller_product_assignments(user_id, level, status)');

  // Referral system columns and table
  await query('alter table app_users add column if not exists avatar_url text');
  await query('alter table app_users add column if not exists verification_required boolean not null default false');
  await query('alter table app_users add column if not exists verification_status text not null default \'none\'');
  await query('alter table app_users add column if not exists verification_requested_at timestamptz');
  await query(`
    create table if not exists identity_verifications (
      user_id uuid primary key references app_users(id) on delete cascade,
      first_name text not null,
      last_name text not null,
      middle_name text,
      date_of_birth date not null,
      ghana_card_id text not null,
      card_front_data text,
      card_back_data text,
      status text not null default 'pending',
      submitted_at timestamptz default now(),
      reviewed_at timestamptz,
      reviewed_by text,
      review_notes text
    )
  `);
  await query('create index if not exists identity_verifications_status_idx on identity_verifications(status)');
  await query('alter table app_users add column if not exists referral_code text');
  await query('alter table app_users add column if not exists referred_by uuid');
  await query('create unique index if not exists app_users_referral_code_idx on app_users(referral_code)');
  await query(`
    create table if not exists referrals (
      id uuid primary key default gen_random_uuid(),
      referrer_id uuid not null references app_users(id) on delete cascade,
      referred_id uuid not null references app_users(id) on delete cascade,
      bonus_amount numeric(12,2) not null default 2.00,
      created_at timestamptz default now(),
      unique(referred_id)
    )
  `);
  await query('create index if not exists referrals_referrer_idx on referrals(referrer_id)');

  await query(`
    create table if not exists app_settings (
      key text primary key,
      value text
    )
  `);

  await query(`
    create table if not exists daily_checkins (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references app_users(id) on delete cascade,
      checkin_date date not null,
      created_at timestamptz default now(),
      unique(user_id, checkin_date)
    )
  `);

  await query(`
    create table if not exists order_processing (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references app_users(id) on delete cascade,
      task_id uuid references tasks(id) on delete cascade,
      product_id uuid references products(id) on delete cascade,
      status text not null default 'processing',
      current_step integer not null default 0,
      total_steps integer not null default 15,
      cost numeric(12,2) not null default 0,
      interest numeric(12,2) not null default 0,
      total_return numeric(12,2) not null default 0,
      created_at timestamptz default now(),
      completed_at timestamptz
    )
  `);
  await query('create index if not exists order_processing_user_idx on order_processing(user_id)');
  await query('create index if not exists order_processing_status_idx on order_processing(status)');

  // Backfill referral codes for existing users who don't have one
  const { rows: usersWithoutCode } = await query("select id from app_users where referral_code is null or referral_code = ''");
  for (const u of usersWithoutCode) {
    const code = 'DT' + u.id.replace(/-/g, '').substring(0, 6).toUpperCase();
    await query('update app_users set referral_code = $1 where id = $2', [code, u.id]);
  }
}

// --- Task catalog endpoints ---
// Public: list active tasks (exclude Easy Earns special tasks)
app.get('/tasks', async (req, res) => {
  try {
    const { rows } = await query("select id, title, description, amount, commission, status, created_at from tasks where status = 'active' and (is_easy_earn is not true) order by created_at desc");
    res.json(rows);
  } catch (err) {
    console.error('List tasks error:', err);
    res.status(500).json({ error: 'Failed to list tasks' });
  }
});

// Public: list Easy Earns tasks (video-watch and related items)
app.get('/easy-earns', async (req, res) => {
  try {
    const { rows } = await query("select id, title, description, amount, commission, status, category, created_at from tasks where status = 'active' and is_easy_earn = true order by created_at desc");
    res.json(rows);
  } catch (err) {
    console.error('List easy earns error:', err);
    res.status(500).json({ error: 'Failed to list easy earns tasks' });
  }
});

// Public: get videos for an easy-earn video task
app.get('/easy-earns/:id/videos', async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await query('select id, video_index, title, url, duration_seconds from easy_earn_videos where task_id = $1 order by video_index asc', [id]);
    res.json(rows);
  } catch (err) {
    console.error('Get easy earn videos error:', err);
    res.status(500).json({ error: 'Failed to load videos' });
  }
});

// Public: get a single task
app.get('/tasks/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await query('select id, title, description, amount, commission, status, created_at from tasks where id = $1', [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Task not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Get task error:', err);
    res.status(500).json({ error: 'Failed to get task' });
  }
});

// Submit proof for an Easy Earns task
app.post('/easy-earns/:id/submit', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { url, notes } = req.body || {};
    if ((!url || String(url).trim() === '') && (!notes || String(notes).trim() === '')) return res.status(400).json({ error: 'Proof URL or notes required' });

    // Ensure task exists and is easy earn
    const { rows: taskRows } = await query('select id, title, amount from tasks where id = $1 and is_easy_earn = true and status = $2', [id, 'active']);
    if (taskRows.length === 0) return res.status(404).json({ error: 'Easy Earns task not found' });

    const userId = req.user.id;
    const { rows } = await query(
      `insert into easy_earn_submissions (task_id, user_id, url, notes)
       values ($1,$2,$3,$4) returning id, submitted_at`,
      [id, userId, url || null, notes || null]
    );

    res.json({ ok: true, message: 'Submission received', submissionId: rows[0].id });
  } catch (err) {
    console.error('Easy earns submit error:', err);
    res.status(500).json({ error: 'Failed to submit proof' });
  }
});

// Claim reward for a video-watch Easy Earn task, gated by the one-category-per-day cap
app.post('/easy-earns/:id/claim', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const { rows: taskRows } = await query(
      "select id, title, amount, category from tasks where id = $1 and is_easy_earn = true and status = 'active'",
      [id]
    );
    if (taskRows.length === 0) return res.status(404).json({ error: 'Task not available' });
    const task = taskRows[0];
    if (task.category && task.category !== EASY_EARN_CATEGORIES.VIDEO) {
      return res.status(400).json({ error: 'This task type is claimed differently' });
    }
    const amount = parseFloat(task.amount) || 0;

    const { rows: subs } = await query('select id, status from easy_earn_submissions where task_id = $1 and user_id = $2 order by submitted_at desc limit 1', [id, userId]);
    let sub = subs[0];
    if (!sub) {
      const insertRes = await query('insert into easy_earn_submissions (task_id, user_id, notes, status, submitted_at) values ($1,$2,$3,$4, now()) returning id', [id, userId, 'Auto-submission: watched videos in-app', 'submitted']);
      sub = { id: insertRes.rows[0].id, status: 'submitted' };
    }
    if (sub.status === 'claimed') return res.status(400).json({ error: 'Already claimed' });

    await creditEasyEarnReward({ userId, category: EASY_EARN_CATEGORIES.VIDEO, taskId: id, amount, details: { title: task.title } });
    await query('update easy_earn_submissions set status = $1, awarded_amount = $2, reviewed_at = now(), reviewed_by = $3 where id = $4', ['claimed', amount, req.user.email || req.user.id, sub.id]);

    res.json({ ok: true, earned: amount, message: 'Reward credited' });
  } catch (err) {
    if (err.code === 'ALREADY_CLAIMED_TODAY') return res.status(400).json({ error: err.message });
    console.error('Easy earns claim error:', err);
    res.status(500).json({ error: 'Failed to claim reward' });
  }
});

// Has the current user already used today's one Easy Earn slot, and on what?
app.get('/easy-earns/status/today', requireAuth, async (req, res) => {
  try {
    const claim = await getTodaysEasyEarnClaim(req.user.id);
    res.json({ claimed: !!claim, category: claim?.category || null, amount: claim ? parseFloat(claim.amount) : 0 });
  } catch (err) {
    console.error('Easy earns status error:', err);
    res.status(500).json({ error: 'Failed to load status' });
  }
});

// --- Quiz category ---

app.get('/easy-earns/quiz/:taskId/questions', requireAuth, async (req, res) => {
  try {
    const { taskId } = req.params;
    const { rows } = await query(
      'select id, question_index, question_text, options from easy_earn_quiz_questions where task_id = $1 order by question_index asc',
      [taskId]
    );
    res.json(rows);
  } catch (err) {
    console.error('Get quiz questions error:', err);
    res.status(500).json({ error: 'Failed to load quiz questions' });
  }
});

app.post('/easy-earns/quiz/:taskId/submit', requireAuth, async (req, res) => {
  try {
    const { taskId } = req.params;
    const userId = req.user.id;
    const { answers } = req.body || {};
    if (!Array.isArray(answers) || answers.length === 0) {
      return res.status(400).json({ error: 'Answers are required' });
    }

    const { rows: taskRows } = await query(
      "select id, title, amount, category from tasks where id = $1 and is_easy_earn = true and status = 'active'",
      [taskId]
    );
    if (taskRows.length === 0) return res.status(404).json({ error: 'Quiz not available' });
    const task = taskRows[0];
    if (task.category !== EASY_EARN_CATEGORIES.QUIZ) return res.status(400).json({ error: 'Not a quiz task' });

    const { rows: questions } = await query(
      'select id, correct_option_index from easy_earn_quiz_questions where task_id = $1',
      [taskId]
    );
    if (questions.length === 0) return res.status(400).json({ error: 'This quiz has no questions configured' });

    const answerMap = new Map(answers.map(a => [a.question_id, a.selected_option_index]));
    let correctCount = 0;
    for (const q of questions) {
      if (answerMap.get(q.id) === q.correct_option_index) correctCount++;
    }

    if (correctCount < questions.length) {
      return res.status(400).json({
        error: `You got ${correctCount}/${questions.length} correct. All answers must be correct to earn the reward - try again.`,
        correct: correctCount,
        total: questions.length
      });
    }

    const amount = parseFloat(task.amount) || 0;
    await creditEasyEarnReward({ userId, category: EASY_EARN_CATEGORIES.QUIZ, taskId, amount, details: { correct: correctCount, total: questions.length } });

    res.json({ ok: true, earned: amount, correct: correctCount, total: questions.length, message: 'Reward credited' });
  } catch (err) {
    if (err.code === 'ALREADY_CLAIMED_TODAY') return res.status(400).json({ error: err.message });
    console.error('Quiz submit error:', err);
    res.status(500).json({ error: 'Failed to submit quiz' });
  }
});

app.get('/admin/easy-earns/quiz/:taskId/questions', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { taskId } = req.params;
    const { rows } = await query('select * from easy_earn_quiz_questions where task_id = $1 order by question_index asc', [taskId]);
    res.json(rows);
  } catch (err) {
    console.error('Admin get quiz questions error:', err);
    res.status(500).json({ error: 'Failed to load quiz questions' });
  }
});

app.post('/admin/easy-earns/quiz/:taskId/questions', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { taskId } = req.params;
    const { question_text, options, correct_option_index, question_index } = req.body || {};
    if (!question_text || !Array.isArray(options) || options.length < 2) {
      return res.status(400).json({ error: 'Question text and at least 2 options are required' });
    }
    if (typeof correct_option_index !== 'number' || correct_option_index < 0 || correct_option_index >= options.length) {
      return res.status(400).json({ error: 'A valid correct_option_index is required' });
    }
    const { rows } = await query(
      `insert into easy_earn_quiz_questions (task_id, question_index, question_text, options, correct_option_index)
       values ($1,$2,$3,$4,$5) returning *`,
      [taskId, question_index || 0, question_text, JSON.stringify(options), correct_option_index]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('Admin add quiz question error:', err);
    res.status(500).json({ error: 'Failed to add quiz question' });
  }
});

app.put('/admin/easy-earns/quiz/questions/:questionId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { questionId } = req.params;
    const { question_text, options, correct_option_index, question_index } = req.body || {};
    const { rows } = await query(
      `update easy_earn_quiz_questions set
         question_text = coalesce($1, question_text),
         options = coalesce($2, options),
         correct_option_index = coalesce($3, correct_option_index),
         question_index = coalesce($4, question_index)
       where id = $5 returning *`,
      [question_text || null, options ? JSON.stringify(options) : null, typeof correct_option_index === 'number' ? correct_option_index : null, question_index || null, questionId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Question not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Admin update quiz question error:', err);
    res.status(500).json({ error: 'Failed to update quiz question' });
  }
});

app.delete('/admin/easy-earns/quiz/questions/:questionId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { questionId } = req.params;
    const { rowCount } = await query('delete from easy_earn_quiz_questions where id = $1', [questionId]);
    if (rowCount === 0) return res.status(404).json({ error: 'Question not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Admin delete quiz question error:', err);
    res.status(500).json({ error: 'Failed to delete quiz question' });
  }
});

// --- Poll category ---

app.get('/easy-earns/poll/:taskId/options', requireAuth, async (req, res) => {
  try {
    const { taskId } = req.params;
    const { rows } = await query(
      'select id, option_index, option_text from easy_earn_poll_options where task_id = $1 order by option_index asc',
      [taskId]
    );
    res.json(rows);
  } catch (err) {
    console.error('Get poll options error:', err);
    res.status(500).json({ error: 'Failed to load poll options' });
  }
});

app.post('/easy-earns/poll/:taskId/submit', requireAuth, async (req, res) => {
  try {
    const { taskId } = req.params;
    const userId = req.user.id;
    const { option_id } = req.body || {};
    if (!option_id) return res.status(400).json({ error: 'An option selection is required' });

    const { rows: taskRows } = await query(
      "select id, title, amount, category from tasks where id = $1 and is_easy_earn = true and status = 'active'",
      [taskId]
    );
    if (taskRows.length === 0) return res.status(404).json({ error: 'Poll not available' });
    const task = taskRows[0];
    if (task.category !== EASY_EARN_CATEGORIES.POLL) return res.status(400).json({ error: 'Not a poll task' });

    const { rows: optionRows } = await query(
      'select id, option_text from easy_earn_poll_options where id = $1 and task_id = $2',
      [option_id, taskId]
    );
    if (optionRows.length === 0) return res.status(400).json({ error: 'Invalid option selected' });

    const amount = parseFloat(task.amount) || 0;
    await creditEasyEarnReward({ userId, category: EASY_EARN_CATEGORIES.POLL, taskId, amount, details: { option_id, option_text: optionRows[0].option_text } });

    res.json({ ok: true, earned: amount, message: 'Reward credited' });
  } catch (err) {
    if (err.code === 'ALREADY_CLAIMED_TODAY') return res.status(400).json({ error: err.message });
    console.error('Poll submit error:', err);
    res.status(500).json({ error: 'Failed to submit poll' });
  }
});

app.get('/admin/easy-earns/poll/:taskId/options', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { taskId } = req.params;
    const { rows } = await query('select * from easy_earn_poll_options where task_id = $1 order by option_index asc', [taskId]);
    res.json(rows);
  } catch (err) {
    console.error('Admin get poll options error:', err);
    res.status(500).json({ error: 'Failed to load poll options' });
  }
});

app.post('/admin/easy-earns/poll/:taskId/options', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { taskId } = req.params;
    const { option_text, option_index } = req.body || {};
    if (!option_text) return res.status(400).json({ error: 'Option text is required' });
    const { rows } = await query(
      `insert into easy_earn_poll_options (task_id, option_index, option_text) values ($1,$2,$3) returning *`,
      [taskId, option_index || 0, option_text]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('Admin add poll option error:', err);
    res.status(500).json({ error: 'Failed to add poll option' });
  }
});

app.put('/admin/easy-earns/poll/options/:optionId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { optionId } = req.params;
    const { option_text, option_index } = req.body || {};
    const { rows } = await query(
      `update easy_earn_poll_options set option_text = coalesce($1, option_text), option_index = coalesce($2, option_index) where id = $3 returning *`,
      [option_text || null, option_index || null, optionId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Option not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Admin update poll option error:', err);
    res.status(500).json({ error: 'Failed to update poll option' });
  }
});

app.delete('/admin/easy-earns/poll/options/:optionId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { optionId } = req.params;
    const { rowCount } = await query('delete from easy_earn_poll_options where id = $1', [optionId]);
    if (rowCount === 0) return res.status(404).json({ error: 'Option not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Admin delete poll option error:', err);
    res.status(500).json({ error: 'Failed to delete poll option' });
  }
});

// --- Photo Survey category ---

app.get('/easy-earns/photo-survey/:taskId/today', requireAuth, async (req, res) => {
  try {
    const { taskId } = req.params;
    const userId = req.user.id;

    const { rows: prompts } = await query(
      'select id, prompt_index, prompt_text, prompt_category from easy_earn_photo_prompts where task_id = $1 order by prompt_index asc',
      [taskId]
    );

    const { rows: submissions } = await query(
      `select prompt_index, photo_url, caption, submitted_at from easy_earn_photo_submissions
       where task_id = $1 and user_id = $2 and submit_date = current_date
       order by prompt_index asc`,
      [taskId, userId]
    );

    const lastSubmittedAt = submissions.length
      ? submissions.reduce((latest, s) => (new Date(s.submitted_at) > latest ? new Date(s.submitted_at) : latest), new Date(0))
      : null;
    const nextAvailableAt = lastSubmittedAt ? new Date(lastSubmittedAt.getTime() + PHOTO_SURVEY_INTERVAL_MS) : null;

    res.json({
      prompts,
      submissions,
      completedCount: submissions.length,
      total: PHOTO_SURVEY_TOTAL,
      nextAvailableAt
    });
  } catch (err) {
    console.error('Get photo survey status error:', err);
    res.status(500).json({ error: 'Failed to load photo survey status' });
  }
});

app.post('/easy-earns/photo-survey/:taskId/photos', requireAuth, async (req, res) => {
  try {
    const { taskId } = req.params;
    const userId = req.user.id;
    const { prompt_index, photo_url, caption } = req.body || {};

    if (!prompt_index || !photo_url || !caption || !String(caption).trim()) {
      return res.status(400).json({ error: 'prompt_index, photo_url and caption are all required' });
    }

    const { rows: taskRows } = await query(
      "select id, amount, category from tasks where id = $1 and is_easy_earn = true and status = 'active'",
      [taskId]
    );
    if (taskRows.length === 0) return res.status(404).json({ error: 'Photo survey not available' });
    const task = taskRows[0];
    if (task.category !== EASY_EARN_CATEGORIES.PHOTO_SURVEY) return res.status(400).json({ error: 'Not a photo survey task' });

    const existingClaim = await getTodaysEasyEarnClaim(userId);
    if (existingClaim) throw alreadyClaimedTodayError();

    const { rows: promptRows } = await query(
      'select id from easy_earn_photo_prompts where task_id = $1 and prompt_index = $2',
      [taskId, prompt_index]
    );
    if (promptRows.length === 0) return res.status(400).json({ error: 'Invalid prompt' });

    const { rows: todays } = await query(
      `select prompt_index, submitted_at from easy_earn_photo_submissions
       where task_id = $1 and user_id = $2 and submit_date = current_date
       order by submitted_at desc`,
      [taskId, userId]
    );

    if (todays.some(s => s.prompt_index === prompt_index)) {
      return res.status(400).json({ error: 'You already submitted a photo for this prompt today' });
    }

    if (todays.length >= PHOTO_SURVEY_TOTAL) {
      return res.status(400).json({ error: `You've already submitted all ${PHOTO_SURVEY_TOTAL} photos for today` });
    }

    if (todays.length > 0) {
      const lastAt = new Date(todays[0].submitted_at);
      const nextAt = new Date(lastAt.getTime() + PHOTO_SURVEY_INTERVAL_MS);
      const now = new Date();
      if (now < nextAt) {
        const secondsLeft = Math.ceil((nextAt - now) / 1000);
        return res.status(400).json({ error: `Please wait ${secondsLeft}s before submitting your next photo`, next_available_at: nextAt });
      }
    }

    await query(
      `insert into easy_earn_photo_submissions (task_id, user_id, submit_date, prompt_index, photo_url, caption)
       values ($1, $2, current_date, $3, $4, $5)`,
      [taskId, userId, prompt_index, photo_url, String(caption).trim()]
    );

    const completedCount = todays.length + 1;
    let earned = 0;
    const rewardCredited = completedCount >= PHOTO_SURVEY_TOTAL;
    if (rewardCredited) {
      const amount = parseFloat(task.amount) || 0;
      await creditEasyEarnReward({ userId, category: EASY_EARN_CATEGORIES.PHOTO_SURVEY, taskId, amount, details: { photos: completedCount } });
      earned = amount;
    }

    res.json({
      ok: true,
      completedCount,
      total: PHOTO_SURVEY_TOTAL,
      rewardCredited,
      earned,
      next_available_at: new Date(Date.now() + PHOTO_SURVEY_INTERVAL_MS)
    });
  } catch (err) {
    if (err.code === 'ALREADY_CLAIMED_TODAY') return res.status(400).json({ error: err.message });
    if (err.code === '23505') return res.status(400).json({ error: 'You already submitted a photo for this prompt today' });
    console.error('Photo survey submit error:', err);
    res.status(500).json({ error: 'Failed to submit photo' });
  }
});

app.get('/admin/easy-earns/photo-survey/:taskId/prompts', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { taskId } = req.params;
    const { rows } = await query('select * from easy_earn_photo_prompts where task_id = $1 order by prompt_index asc', [taskId]);
    res.json(rows);
  } catch (err) {
    console.error('Admin get photo prompts error:', err);
    res.status(500).json({ error: 'Failed to load photo prompts' });
  }
});

app.post('/admin/easy-earns/photo-survey/:taskId/prompts', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { taskId } = req.params;
    const { prompt_text, prompt_category, prompt_index } = req.body || {};
    if (!prompt_text) return res.status(400).json({ error: 'Prompt text is required' });
    const { rows } = await query(
      `insert into easy_earn_photo_prompts (task_id, prompt_index, prompt_text, prompt_category) values ($1,$2,$3,$4) returning *`,
      [taskId, prompt_index || 0, prompt_text, prompt_category || 'object']
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('Admin add photo prompt error:', err);
    res.status(500).json({ error: 'Failed to add photo prompt' });
  }
});

app.put('/admin/easy-earns/photo-survey/prompts/:promptId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { promptId } = req.params;
    const { prompt_text, prompt_category, prompt_index } = req.body || {};
    const { rows } = await query(
      `update easy_earn_photo_prompts set
         prompt_text = coalesce($1, prompt_text),
         prompt_category = coalesce($2, prompt_category),
         prompt_index = coalesce($3, prompt_index)
       where id = $4 returning *`,
      [prompt_text || null, prompt_category || null, prompt_index || null, promptId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Prompt not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Admin update photo prompt error:', err);
    res.status(500).json({ error: 'Failed to update photo prompt' });
  }
});

app.delete('/admin/easy-earns/photo-survey/prompts/:promptId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { promptId } = req.params;
    const { rowCount } = await query('delete from easy_earn_photo_prompts where id = $1', [promptId]);
    if (rowCount === 0) return res.status(404).json({ error: 'Prompt not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Admin delete photo prompt error:', err);
    res.status(500).json({ error: 'Failed to delete photo prompt' });
  }
});

// Admin: update a task
app.put('/admin/tasks/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, amount, commission, status } = req.body;
    const { rows } = await query(
      `update tasks set title = coalesce($1, title), description = coalesce($2, description), amount = coalesce($3, amount), commission = coalesce($4, commission), status = coalesce($5, status)
       where id = $6 returning id, title, description, amount, commission, status, created_at`,
      [title || null, description || null, typeof amount === 'undefined' ? null : Number(amount), typeof commission === 'undefined' ? null : Number(commission), status || null, id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Task not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Update task error:', err);
    res.status(500).json({ error: 'Failed to update task' });
  }
});

// Admin: change task status (freeze/activate)
app.post('/admin/tasks/:id/status', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: 'Missing status' });
    await query('update tasks set status = $1 where id = $2', [status, id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Change task status error:', err);
    res.status(500).json({ error: 'Failed to change task status' });
  }
});

// Finds (or creates) the one task row for a given Easy Earn category. Only sets the title
// at creation time - never overwrites it afterwards, so admin renames stick across restarts.
async function ensureCategoryTask(category, { title, description, amount }) {
  const { rows: existing } = await query(
    'select id from tasks where category = $1 and coalesce(is_easy_earn, false) = true order by created_at asc',
    [category]
  );
  let taskId = existing[0]?.id;

  if (existing.length > 1) {
    const duplicateIds = existing.slice(1).map(row => row.id);
    const removed = await deleteTaskRowsByIds(duplicateIds);
    if (removed > 0) console.log(`Cleanup: removed ${removed} duplicate ${category} Easy Earn task(s)`);
  }

  if (!taskId) {
    const inserted = await query(
      `insert into tasks (title, description, amount, commission, status, is_easy_earn, category)
       values ($1, $2, $3, 0, 'active', true, $4)
       returning id`,
      [title, description, amount, category]
    );
    taskId = inserted.rows[0].id;
  } else {
    await query('update tasks set is_easy_earn = true, status = $1, category = $2 where id = $3', ['active', category, taskId]);
  }

  return taskId;
}

// Ensure one task per Easy Earn category exists, each seeded with starter content if empty.
async function ensureInitialTasks() {
  try {
    const videoTaskId = await ensureCategoryTask(EASY_EARN_CATEGORIES.VIDEO, {
      title: VIDEO_WATCH_TASK_TITLE,
      description: 'Watch a short set of videos to earn rewards.',
      amount: 1.50
    });
    const { rows: existingVideos } = await query('select count(*) as c from easy_earn_videos where task_id = $1', [videoTaskId]);
    if (parseInt(existingVideos[0].c || 0) === 0) {
      const placeholders = [
        ['Intro Video', 'https://example.com/video1.mp4', 120],
        ['How-to Video', 'https://example.com/video2.mp4', 150],
        ['Product Demo', 'https://example.com/video3.mp4', 95],
        ['Quick Tips', 'https://example.com/video4.mp4', 130],
        ['Wrap Up', 'https://example.com/video5.mp4', 110]
      ];
      for (let i = 0; i < placeholders.length; i++) {
        const [title, url, durationSeconds] = placeholders[i];
        await query(
          `insert into easy_earn_videos (task_id, video_index, title, url, duration_seconds)
           values ($1, $2, $3, $4, $5)`,
          [videoTaskId, i + 1, title, url, durationSeconds]
        );
      }
    }

    const quizTaskId = await ensureCategoryTask(EASY_EARN_CATEGORIES.QUIZ, {
      title: 'Quick Quiz',
      description: 'Answer a short quiz correctly to earn a reward.',
      amount: 2.00
    });
    const { rows: existingQuestions } = await query('select count(*) as c from easy_earn_quiz_questions where task_id = $1', [quizTaskId]);
    if (parseInt(existingQuestions[0].c || 0) === 0) {
      const sampleQuestions = [
        ['What currency does DailyTrade use for rewards?', ['GHC', 'USD', 'EUR', 'GBP'], 0],
        ['How many Easy Earn categories can you complete per day?', ['Only 1', '2', '5', 'Unlimited'], 0],
        ['If you forget your password, what should you do?', ['Use the Forgot Password link on the login page', 'Register a brand new account', 'Nothing, it cannot be recovered', 'Message a random user'], 0]
      ];
      for (let i = 0; i < sampleQuestions.length; i++) {
        const [questionText, options, correctIndex] = sampleQuestions[i];
        await query(
          `insert into easy_earn_quiz_questions (task_id, question_index, question_text, options, correct_option_index)
           values ($1, $2, $3, $4, $5)`,
          [quizTaskId, i + 1, questionText, JSON.stringify(options), correctIndex]
        );
      }
    }

    const pollTaskId = await ensureCategoryTask(EASY_EARN_CATEGORIES.POLL, {
      title: 'Quick Poll',
      description: 'Share your opinion in a short poll to earn a reward.',
      amount: 2.00
    });
    const { rows: existingOptions } = await query('select count(*) as c from easy_earn_poll_options where task_id = $1', [pollTaskId]);
    if (parseInt(existingOptions[0].c || 0) === 0) {
      const sampleOptions = ['Very satisfied', 'Satisfied', 'Neutral', 'Unsatisfied'];
      for (let i = 0; i < sampleOptions.length; i++) {
        await query(
          `insert into easy_earn_poll_options (task_id, option_index, option_text) values ($1, $2, $3)`,
          [pollTaskId, i + 1, sampleOptions[i]]
        );
      }
    }

    const photoTaskId = await ensureCategoryTask(EASY_EARN_CATEGORIES.PHOTO_SURVEY, {
      title: 'Photo Survey',
      description: 'Take 10 prompted photos with captions to earn a reward.',
      amount: 2.00
    });
    const { rows: existingPrompts } = await query('select count(*) as c from easy_earn_photo_prompts where task_id = $1', [photoTaskId]);
    if (parseInt(existingPrompts[0].c || 0) === 0) {
      const samplePrompts = [
        ['Take a photo of something on your desk or table right now', 'object'],
        ['Take a photo of the sky or the weather outside', 'random'],
        ['Take a selfie showing your current mood', 'person'],
        ['Take a photo of your favorite pair of shoes', 'object'],
        ['Take a photo of any plant or tree nearby', 'random'],
        ['Take a photo of a book or screen you are looking at', 'object'],
        ['Take a selfie doing a peace sign', 'person'],
        ['Take a photo of the floor beneath you', 'random'],
        ['Take a photo of a door or window near you', 'object'],
        ['Take a photo of the street or road outside', 'random']
      ];
      for (let i = 0; i < samplePrompts.length; i++) {
        const [promptText, promptCategory] = samplePrompts[i];
        await query(
          `insert into easy_earn_photo_prompts (task_id, prompt_index, prompt_text, prompt_category) values ($1, $2, $3, $4)`,
          [photoTaskId, i + 1, promptText, promptCategory]
        );
      }
    }

    console.log('Ensured all Easy Earn category tasks (video, quiz, poll, photo_survey)');
  } catch (err) {
    console.error('Initial tasks seed error:', err);
  }
}

ensureSchema()
  .then(() => cleanupSeededTasks())
  .then((result) => {
    const removed = result.beginnerTasksRemoved + result.catalogTasksRemoved + result.extraEasyEarnsRemoved;
    if (removed > 0) console.log(`Cleanup: removed ${removed} seeded task row(s)`);
  })
  .then(() => ensureInitialTasks())
  .catch((error) => {
    console.error('Schema init error:', error);
  })
  .finally(() => {
    app.listen(port, () => {
      console.log(`API running on :${port}`);
    });
  });
