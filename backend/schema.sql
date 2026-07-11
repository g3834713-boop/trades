-- Users table mirrors Supabase auth users but allows app data
create table if not exists app_users (
  id uuid primary key,
  email text unique not null,
  full_name text,
  phone text,
  avatar_url text,
  verification_required boolean not null default false,
  verification_status text not null default 'none',
  verification_requested_at timestamptz,
  referral_code text,
  referred_by uuid,
  created_at timestamptz default now()
);

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
);

create index if not exists identity_verifications_status_idx on identity_verifications(status);

create table if not exists wallets (
  user_id uuid primary key references app_users(id) on delete cascade,
  balance numeric(12,2) not null default 0,
  bonus numeric(12,2) not null default 0,
  updated_at timestamptz default now()
);

create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  type text not null, -- deposit, withdrawal, bonus, task, adjustment
  amount numeric(12,2) not null,
  reason text,
  created_at timestamptz default now()
);

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  amount numeric(12,2) not null,
  commission numeric(5,2) not null default 0, -- percentage commission/interest
  status text not null default 'active',
  created_at timestamptz default now()
);

create table if not exists task_completions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  completed_at timestamptz default now()
);

create table if not exists task_assignments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  status text not null default 'pending', -- pending, completed, frozen
  assigned_at timestamptz default now(),
  completed_at timestamptz,
  unique(task_id, user_id)
);

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  price numeric(12,2) not null,
  commission numeric(5,2) not null default 0, -- percentage commission/interest
  image text,
  status text not null default 'active',
  created_at timestamptz default now()
);

create table if not exists product_assignments (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  status text not null default 'pending', -- pending, completed
  assigned_at timestamptz default now(),
  completed_at timestamptz,
  unique(product_id, user_id)
);

create table if not exists withdrawals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  amount numeric(12,2) not null,
  method text,
  account text,
  status text not null default 'pending',
  requested_at timestamptz default now(),
  processed_at timestamptz
);

create table if not exists deposits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  amount numeric(12,2) not null default 0,
  bonus numeric(12,2) not null default 0,
  reason text,
  created_at timestamptz default now()
);

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  amount numeric(12,2) not null,
  method text,
  phone text,
  payment_number text,
  transaction_id text,
  status text not null default 'pending', -- pending|submitted|completed|cancelled
  requested_at timestamptz default now(),
  completed_at timestamptz
);

create table if not exists app_settings (
  key text primary key,
  value text
);

create table if not exists daily_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  checkin_date date not null,
  created_at timestamptz default now(),
  unique(user_id, checkin_date)
);
