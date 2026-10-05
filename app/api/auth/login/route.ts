import { NextResponse } from "next/server";
import { LoginInput } from "@/lib/auth";
import { login } from "@/lib/server/auth";
import { errorResponse } from "@/lib/server/errors";

/** POST /api/auth/login — body: { email, password }. Sets the session cookie. */
export async function POST(request: Request) {
  try {
    const user = await login(LoginInput.parse(await request.json().catch(() => null)));
    return NextResponse.json({ user });
  } catch (err) {
    return errorResponse(err, "POST /api/auth/login");
  }
}
