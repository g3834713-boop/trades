import pg from 'pg';
import dns from 'dns';

const { Pool } = pg;

const lookup = (hostname, options, callback) => {
  dns.lookup(hostname, { family: 4 }, callback);
};

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  lookup
});

export async function query(text, params) {
  const res = await pool.query(text, params);
  return res;
}
