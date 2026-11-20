import dotenv from 'dotenv';
import { Pool, PoolClient } from 'pg';

dotenv.config();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.warn('[PostgreSQL] Advertencia: DATABASE_URL no está definido en el entorno.');
}

export const pool = new Pool({
  connectionString,
  max: 15,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

pool.on('error', (err) => {
  console.error('[PostgreSQL Pool Error]', err.message);
});

export async function checkDatabaseConnection(): Promise<boolean> {
  const res = await pool.query('SELECT 1 AS ok');
  return res.rows[0]?.ok === 1;
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {}
    throw err;
  } finally {
    client.release();
  }
}
