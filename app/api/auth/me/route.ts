import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/server/currentUser";
import { HttpError, errorResponse } from "@/lib/server/errors";

/** GET /api/auth/me — the signed-in user ({ id, name, email }), or 401. */
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) throw new HttpError(401, "Please log in.");
    return NextResponse.json({ user });
  } catch (err) {
    return errorResponse(err, "GET /api/auth/me");
  }
}
