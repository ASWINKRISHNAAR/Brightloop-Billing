import pg from 'pg';
import { config } from '../common/config.js';
import { logger } from '../common/logger.js';

const { Pool } = pg;

export type DbClient = pg.Pool | pg.PoolClient;

let poolInstance: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!poolInstance) {
    poolInstance = new Pool({
      connectionString: config.DATABASE_URL,
      min: config.DB_POOL_MIN,
      max: config.DB_POOL_MAX,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    poolInstance.on('error', (err) => {
      logger.error({ err }, 'Unexpected error on idle PostgreSQL client');
    });
  }
  return poolInstance;
}

export function setPool(customPool: pg.Pool): void {
  poolInstance = customPool;
}

export async function closePool(): Promise<void> {
  if (poolInstance) {
    await poolInstance.end();
    poolInstance = null;
  }
}

/**
 * Execute an arbitrary SQL query using the primary pool or supplied client
 */
export async function query<T extends pg.QueryResultRow = any>(
  text: string,
  params?: any[],
  client?: DbClient
): Promise<pg.QueryResult<T>> {
  const db = client || getPool();
  const sql = (db as any).__isPgMem ? text.replace(/SKIP LOCKED/gi, '') : text;
  return db.query<T>(sql, params);
}

/**
 * Execute a unit of work within a PostgreSQL transaction boundary.
 * Automatically performs BEGIN, COMMIT, or ROLLBACK on failure.
 */
export async function withTransaction<T>(
  callback: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
