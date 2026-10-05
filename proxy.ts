import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, loginPath } from "@/lib/auth";

/**
 * Optimistic check only: sends visitors with no session cookie at all to the login page.
 * Whether the session is real and unexpired is checked on the server (getCurrentUserId / requireUser).
 */
export function proxy(request: NextRequest) {
  const { pathname, search, searchParams } = request.nextUrl;
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();
  // The demo design page is open to everyone (it just can't save).
  if (pathname === "/design" && searchParams.get("demo") === "1") return NextResponse.next();
  return NextResponse.redirect(new URL(loginPath(pathname + search), request.url));
}

export const config = {
  matcher: ["/projects/:path*", "/design/:path*"],
};
