import pg from 'pg';
import dns from 'dns';

const { Pool } = pg;

const numberFromEnv = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const lookup = (hostname, options, callback) => {
  if (typeof options === 'function') {
    return dns.lookup(hostname, { family: 4 }, options);
  }
  return dns.lookup(hostname, { ...options, family: 4 }, callback);
};

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  lookup,
  max: numberFromEnv('DB_POOL_MAX', 3),
  idleTimeoutMillis: numberFromEnv('DB_IDLE_TIMEOUT_MS', 30000),
  connectionTimeoutMillis: numberFromEnv('DB_CONNECTION_TIMEOUT_MS', 10000),
  keepAlive: true
});

pool.on('error', (error) => {
  console.error('Unexpected idle database client error:', error.message);
});

export async function query(text, params) {
  const startedAt = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - startedAt;
    const slowQueryMs = numberFromEnv('DB_SLOW_QUERY_MS', 1500);
    if (duration > slowQueryMs) {
      console.warn('Slow database query:', { duration, rows: res.rowCount });
    }
    return res;
  } catch (error) {
    console.error('Database query failed:', {
      duration: Date.now() - startedAt,
      code: error.code,
      message: error.message
    });
    throw error;
  }
}
