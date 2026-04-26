/**
 * Postgres client + tenancy fence.
 *
 * Every read/write that should be tenant-scoped MUST go through `withWorkspace(...)`,
 * which opens a transaction and runs `SET LOCAL app.workspace_id = $1`. RLS policies
 * (see migrations/0002_rls.sql) reject rows whose workspace_id doesn't match.
 *
 * For unscoped queries (signup, internal admin), use `db` directly — no RLS context
 * is set, so RLS will reject anything keyed by workspace_id. That's intentional:
 * mistakes fail loudly instead of leaking data.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool, type PoolClient } from 'pg';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required. Copy .env.example to .env and fill it in.');
}

export const pool = new Pool({
  connectionString,
  // Generous pool: every request opens its own short transaction, so 30 is plenty
  // even at hundreds of concurrent calls. Bump if you observe wait_count > 0.
  max: 30,
  idleTimeoutMillis: 30_000,
  // Keep TCP fast — we open/close a transaction per request.
  keepAlive: true,
});

export const db = drizzle(pool, { schema });

/**
 * Run a callback inside a transaction with the workspace_id GUC set.
 * Drizzle's transaction() runs all queries on the same connection — perfect for SET LOCAL.
 */
/** Transaction handle as exposed by drizzle's `db.transaction(...)` callback. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function withWorkspace<T>(
  workspaceId: number,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    // SET LOCAL is scoped to this transaction only — no leak if the connection is reused.
    // We pass via parameterized ad-hoc query because SET LOCAL doesn't accept bind params directly,
    // so we hard-cast to a number first to prevent injection.
    const id = Number(workspaceId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error(`Invalid workspaceId: ${workspaceId}`);
    }
    await tx.execute(`SET LOCAL app.workspace_id = ${id}` as any);
    return fn(tx);
  });
}

/** Low-level escape hatch when you need a raw pg client (e.g., LISTEN/NOTIFY). */
export async function withRawClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}
