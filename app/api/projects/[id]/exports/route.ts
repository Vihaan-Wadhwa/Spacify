import { NextResponse } from "next/server";
import { ExportInput } from "@/lib/projects";
import { getCurrentUserId } from "@/lib/server/currentUser";
import { errorResponse } from "@/lib/server/errors";
import { parseId } from "@/lib/server/params";
import { logExport } from "@/lib/server/projects";

/** POST /api/projects/:id/exports — records a 2D or 3D PNG export in the `exports` table. Body: { type: "2d" | "3d" }. */
export async function POST(request: Request, ctx: RouteContext<"/api/projects/[id]/exports">) {
  try {
    const projectId = parseId((await ctx.params).id, "project id");
    const { type } = ExportInput.parse(await request.json().catch(() => null));
    const userId = await getCurrentUserId();
    await logExport(userId, projectId, type);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    return errorResponse(err, "POST /api/projects/:id/exports");
  }
}
