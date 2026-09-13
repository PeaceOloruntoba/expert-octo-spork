import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { env } from '../config/env';

// A single pooled connection, reused across invocations in long-running processes
// and re-created per cold-start in serverless environments (Vercel functions).
// Use a pooled/transaction-mode connection string in serverless deployments.
export const pool = new Pool({
  connectionString: env.databaseUrl,
  max: env.databasePoolMax,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  ssl: env.databaseSsl ? { rejectUnauthorized: false } : undefined,
});

pool.on('error', (err) => {
  // Prevents an idle client error from crashing the process.
  // eslint-disable-next-line no-console
  console.error('Unexpected error on idle Postgres client', err);
});

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params as any[]);
}

/**
 * Runs `fn` inside a single transaction. Commits on success, rolls back on throw.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
