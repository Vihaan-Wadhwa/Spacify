import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { SESSION_COOKIE, loginPath, type CurrentUser } from "@/lib/auth";
import { hashToken } from "./auth";
import { query } from "./db";
import { HttpError } from "./errors";

/**
 * The signed-in user, or null: looks up the hash of the session cookie's token in `sessions`.
 * A missing, forged or expired cookie all come out as null. Cached for the rest of the request.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const rows = await query<CurrentUser>(
    `SELECT u.id, u.name, u.email
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = $1 AND s.expires_at > now()`,
    [hashToken(token)]
  );
  return rows[0] ?? null;
});

/** The signed-in user's id, for API routes and server code. Throws a 401 if there's no valid session. */
export async function getCurrentUserId(): Promise<number> {
  const user = await getCurrentUser();
  if (!user) throw new HttpError(401, "Please log in.");
  return user.id;
}

/** For pages: the signed-in user, or a redirect to the login page that comes back to `currentPath` afterwards. */
export async function requireUser(currentPath: string): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect(loginPath(currentPath));
  return user;
}
