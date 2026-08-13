import 'dotenv/config';
import pg from 'pg';

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export async function query(text, params) {
  return pool.query(text, params);
}

// One table, holds the WhatsApp login (creds + signal keys) as JSON rows instead of
// local files - so a Render restart (redeploy, idle-sleep wake, etc.) can reload the
// session and reconnect without forcing a fresh QR scan.
export async function ensureBotSchema() {
  await query(`
    create table if not exists bot_whatsapp_session (
      key text primary key,
      value jsonb not null,
      updated_at timestamptz default now()
    )
  `);
}
