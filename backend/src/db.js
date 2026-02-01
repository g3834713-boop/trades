import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  // Force IPv4 to avoid Railway IPv6 connectivity issues
  host: 'db.rogddhzsdfgvajyepnqp.supabase.co',
  port: 5432,
  database: 'postgres',
  user: 'postgres',
  password: 'wS2IkekALTBaThpr'
});

export async function query(text, params) {
  const res = await pool.query(text, params);
  return res;
}
