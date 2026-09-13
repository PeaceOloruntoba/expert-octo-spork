/**
 * Minimal, dependency-light migration runner.
 *
 * Migrations live in /migrations as paired files:
 *   0001_description.up.sql
 *   0001_description.down.sql
 *
 * Applied migrations are tracked in the `schema_migrations` table so re-running
 * `migrate up` is idempotent. Run with:
 *   npm run migrate            -> applies all pending "up" migrations
 *   npm run migrate:down       -> reverts the single most recent migration
 *   npm run migrate:status     -> lists applied / pending migrations
 */
import fs from 'fs';
import path from 'path';
import { pool } from './pool';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../migrations');

async function ensureMigrationsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

function listMigrationFiles(direction: 'up' | 'down'): { name: string; file: string }[] {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(`.${direction}.sql`))
    .sort()
    .map((f) => ({ name: f.replace(`.${direction}.sql`, ''), file: path.join(MIGRATIONS_DIR, f) }));
}

async function getAppliedMigrations(): Promise<Set<string>> {
  const result = await pool.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name');
  return new Set(result.rows.map((r) => r.name));
}

async function up(): Promise<void> {
  await ensureMigrationsTable();
  const applied = await getAppliedMigrations();
  const upFiles = listMigrationFiles('up');
  const pending = upFiles.filter((m) => !applied.has(m.name));

  if (pending.length === 0) {
    console.log('No pending migrations. Database is up to date.');
    return;
  }

  for (const migration of pending) {
    const sql = fs.readFileSync(migration.file, 'utf-8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [migration.name]);
      await client.query('COMMIT');
      console.log(`Applied: ${migration.name}`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`Failed to apply ${migration.name}`);
      throw err;
    } finally {
      client.release();
    }
  }
}

async function down(): Promise<void> {
  await ensureMigrationsTable();
  const applied = await getAppliedMigrations();
  if (applied.size === 0) {
    console.log('No migrations have been applied.');
    return;
  }
  const lastApplied = Array.from(applied).sort().pop()!;
  const downFiles = listMigrationFiles('down');
  const target = downFiles.find((m) => m.name === lastApplied);
  if (!target) {
    throw new Error(`No down migration found for "${lastApplied}"`);
  }
  const sql = fs.readFileSync(target.file, 'utf-8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('DELETE FROM schema_migrations WHERE name = $1', [lastApplied]);
    await client.query('COMMIT');
    console.log(`Reverted: ${lastApplied}`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function status(): Promise<void> {
  await ensureMigrationsTable();
  const applied = await getAppliedMigrations();
  const upFiles = listMigrationFiles('up');
  for (const m of upFiles) {
    console.log(`${applied.has(m.name) ? '[applied] ' : '[pending] '}${m.name}`);
  }
}

async function main() {
  const cmd = process.argv[2] ?? 'up';
  try {
    if (cmd === 'up') await up();
    else if (cmd === 'down') await down();
    else if (cmd === 'status') await status();
    else throw new Error(`Unknown command: ${cmd}. Use "up", "down", or "status".`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
