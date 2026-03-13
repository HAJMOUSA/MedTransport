import { Pool } from 'pg';
import { logger } from '../lib/logger';

export const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

db.on('error', (err) => {
  logger.error('Unexpected database pool error', { error: err.message });
});

db.on('connect', () => {
  logger.debug('New database connection established');
});

export async function query<T = Record<string, unknown>>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  const start = Date.now();
  try {
    const result = await db.query(text, params);
    const duration = Date.now() - start;
    if (duration > 1000) {
      logger.warn('Slow query detected', { text: text.slice(0, 100), duration });
    }
    return result.rows as T[];
  } catch (err) {
    logger.error('Database query error', { text: text.slice(0, 100), error: (err as Error).message });
    throw err;
  }
}

export async function queryOne<T = Record<string, unknown>>(
  text: string,
  params?: unknown[]
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}
