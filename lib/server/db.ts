import "server-only";
import { Pool, types, type PoolClient } from "pg";

// Postgres returns NUMERIC and BIGINT (e.g. COUNT) as strings to avoid precision loss.
// Our values (feet, square feet, row counts) are small, so plain JS numbers are safe.
types.setTypeParser(types.builtins.NUMERIC, (v) => parseFloat(v));
types.setTypeParser(types.builtins.INT8, (v) => parseInt(v, 10));

/** DATABASE_URL isn't set. */
export class DbNotConfiguredError extends Error {
  constructor() {
    super("The database isn't configured. Set DATABASE_URL in .env.local and run npm run db:setup.");
  }
}

// Reuse one pool across hot reloads in development instead of opening a new one per file change.
const globalForDb = globalThis as unknown as { spacifyPool?: Pool };

export function getPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new DbNotConfiguredError();
  if (!globalForDb.spacifyPool) {
    globalForDb.spacifyPool = new Pool({ connectionString, max: 10, connectionTimeoutMillis: 5000 });
    globalForDb.spacifyPool.on("error", (err) => console.error("[db] idle client error:", err));
  }
  return globalForDb.spacifyPool;
}

/** Runs a parameterised query. Always pass values as params — never build SQL with string concatenation. */
export async function query<T extends object>(text: string, params: unknown[] = []): Promise<T[]> {
  const result = await getPool().query<T>(text, params);
  return result.rows;
}

/** Runs `fn` inside BEGIN … COMMIT, rolling back if it throws. */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** True for errors meaning "Postgres isn't reachable" (not running, wrong host/port, bad password). */
export function isConnectionError(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  return (
    ["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "28P01", "3D000", "28000"].includes(e.code ?? "") ||
    /connect|timeout/i.test(e.message ?? "")
  );
}
