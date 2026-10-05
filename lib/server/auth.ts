import "server-only";
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import type { PoolClient } from "pg";
import { SESSION_COOKIE, type CurrentUser, type LoginInput, type RegisterInput } from "@/lib/auth";
import { query, withTransaction } from "./db";
import { HttpError } from "./errors";

const SESSION_DAYS = 30;
const BCRYPT_COST = 10;
const BAD_LOGIN = "Email or password is incorrect.";
// Compared against when the email doesn't exist, so a login takes as long whether or not the account exists.
const DUMMY_HASH = "$2b$10$uGYF6r6LM2deY/XKCegRkeGEe0hZxVjK/GbloIFYEKrWBGd3XWTlW";

/**
 * sessions.token holds the SHA-256 of the cookie's token, never the token itself,
 * so someone who can read the table can't use what's in it to log in.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

type NewSession = { token: string; expiresAt: Date };

/** Adds a sessions row for `userId` inside the caller's transaction. Returns the raw token for the cookie. */
async function createSession(client: PoolClient, userId: number): Promise<NewSession> {
  const token = randomBytes(32).toString("base64url");
  const { rows } = await client.query<{ expires_at: Date }>(
    `INSERT INTO sessions (user_id, token, expires_at)
     VALUES ($1, $2, now() + make_interval(days => $3))
     RETURNING expires_at`,
    [userId, hashToken(token), SESSION_DAYS]
  );
  return { token, expiresAt: rows[0].expires_at };
}

/** Sets the session cookie; call it only after the session's transaction has committed. The cookie expires with the row. */
async function setSessionCookie({ token, expiresAt }: NewSession): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    expires: expiresAt,
  });
}

/** Creates the account and logs it in. A taken email is a 409. */
export async function register(input: RegisterInput): Promise<CurrentUser> {
  const hash = await bcrypt.hash(input.password, BCRYPT_COST);
  let created: { user: CurrentUser; session: NewSession };
  try {
    created = await withTransaction(async (client) => {
      const { rows } = await client.query<CurrentUser>(
        "INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING id, name, email",
        [input.name, input.email, hash]
      );
      return { user: rows[0], session: await createSession(client, rows[0].id) };
    });
  } catch (err) {
    if ((err as { code?: string }).code === "23505") throw new HttpError(409, "An account with this email already exists.");
    throw err;
  }
  await setSessionCookie(created.session);
  return created.user;
}

/** Checks the password and logs in, clearing the user's expired sessions on the way. */
export async function login({ email, password }: LoginInput): Promise<CurrentUser> {
  const rows = await query<CurrentUser & { password: string }>("SELECT id, name, email, password FROM users WHERE email = $1", [email]);
  const user = rows[0];
  const ok = await bcrypt.compare(password, user?.password ?? DUMMY_HASH);
  if (!user || !ok) throw new HttpError(401, BAD_LOGIN);
  const session = await withTransaction(async (client) => {
    await client.query("DELETE FROM sessions WHERE user_id = $1 AND expires_at <= now()", [user.id]);
    return createSession(client, user.id);
  });
  await setSessionCookie(session);
  return { id: user.id, name: user.name, email: user.email };
}

/** Ends the current session: deletes its row and clears the cookie. */
export async function logout(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await query("DELETE FROM sessions WHERE token = $1", [hashToken(token)]);
  store.delete(SESSION_COOKIE);
}
