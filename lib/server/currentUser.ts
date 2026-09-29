import "server-only";
import { connection } from "next/server";
import { query } from "./db";
import { HttpError } from "./errors";

/**
 * The signed-in user's id.
 *
 * Login doesn't exist yet (Task 4), so for now everyone acts as the seeded demo account
 * (DEMO_USER_EMAIL, default demo@spacify.in). Task 4 replaces this body with a lookup of the
 * session cookie in the `sessions` table — every caller already goes through this function.
 */
export async function getCurrentUserId(): Promise<number> {
  // Who the user is depends on the request, so anything that calls this must render per request,
  // never at build time. (Task 4's cookie lookup makes this implicit; until then, say so explicitly.)
  await connection();
  const email = (process.env.DEMO_USER_EMAIL || "demo@spacify.in").toLowerCase();
  const rows = await query<{ id: number }>("SELECT id FROM users WHERE email = $1", [email]);
  if (!rows.length) {
    throw new HttpError(503, `No user ${email} in the database. Run: npm run db:setup (it adds the demo account).`);
  }
  return rows[0].id;
}
