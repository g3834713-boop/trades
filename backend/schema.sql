-- Users table mirrors Supabase auth users but allows app data
create table if not exists app_users (
  id uuid primary key,
  email text unique not null,
  full_name text,
  phone text,
  created_at timestamptz default now()
);

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
  status text not null default 'active',
  created_at timestamptz default now()
);

create table if not exists task_completions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  completed_at timestamptz default now()
);

create table if not exists withdrawals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  amount numeric(12,2) not null,
  method text,
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
