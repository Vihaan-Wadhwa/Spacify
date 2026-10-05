import { NextResponse } from "next/server";
import { RegisterInput } from "@/lib/auth";
import { register } from "@/lib/server/auth";
import { errorResponse } from "@/lib/server/errors";

/** POST /api/auth/register — body: { name, email, password, confirmPassword }. Creates the account and logs it in. */
export async function POST(request: Request) {
  try {
    const user = await register(RegisterInput.parse(await request.json().catch(() => null)));
    return NextResponse.json({ user }, { status: 201 });
  } catch (err) {
    return errorResponse(err, "POST /api/auth/register");
  }
}
