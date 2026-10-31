import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getPool, closePool } from './pool.js';
import { logger } from '../common/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations(): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    // 1. Ensure migrations tracking table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Discover migration files
    const migrationsDir = path.resolve(__dirname, '../../../database/migrations');
    if (!fs.existsSync(migrationsDir)) {
      logger.warn({ migrationsDir }, 'Migrations directory not found');
      return;
    }

    const files = fs
      .readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    // 3. Query applied migrations
    const res = await client.query('SELECT version FROM schema_migrations');
    const applied = new Set(res.rows.map((r: { version: string }) => r.version));

    // 4. Run pending migrations
    for (const file of files) {
      if (!applied.has(file)) {
        logger.info({ file }, `Applying migration: ${file}`);
        const filePath = path.join(migrationsDir, file);
        const sql = fs.readFileSync(filePath, 'utf-8');

        await client.query('BEGIN');
        try {
          await client.query(sql);
          await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
          await client.query('COMMIT');
          logger.info({ file }, `Successfully applied migration: ${file}`);
        } catch (err) {
          await client.query('ROLLBACK');
          logger.error({ file, err }, `Migration failed: ${file}`);
          throw err;
        }
      }
    }

    logger.info('All database migrations are up to date.');
  } finally {
    client.release();
  }
}

// Allow standalone execution via `tsx src/db/migrate.ts`
if (process.argv[1] && process.argv[1].endsWith('migrate.ts')) {
  runMigrations()
    .then(async () => {
      await closePool();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('Migration failed:', err);
      await closePool();
      process.exit(1);
    });
}
