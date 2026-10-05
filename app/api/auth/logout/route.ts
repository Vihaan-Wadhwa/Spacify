import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth";
import { logout } from "@/lib/server/auth";

/** POST /api/auth/logout — a plain form post. Deletes the session and goes back to the landing page. */
export async function POST(request: Request) {
  try {
    await logout();
  } catch (err) {
    // Even if the database is unreachable, the browser should end up logged out.
    console.error("[POST /api/auth/logout]", err);
    (await cookies()).delete(SESSION_COOKIE);
  }
  // 303 so the browser follows with a GET.
  return NextResponse.redirect(new URL("/", request.url), 303);
}
