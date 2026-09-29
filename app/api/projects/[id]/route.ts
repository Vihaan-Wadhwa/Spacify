import { NextResponse } from "next/server";
import { ProjectInput } from "@/lib/projects";
import { getCurrentUserId } from "@/lib/server/currentUser";
import { errorResponse } from "@/lib/server/errors";
import { parseId } from "@/lib/server/params";
import { deleteProject, getProject, saveProject } from "@/lib/server/projects";

/** GET /api/projects/:id — the project with its rooms (needs at least view access). */
export async function GET(_request: Request, ctx: RouteContext<"/api/projects/[id]">) {
  try {
    const projectId = parseId((await ctx.params).id, "project id");
    const userId = await getCurrentUserId();
    return NextResponse.json({ project: await getProject(userId, projectId) });
  } catch (err) {
    return errorResponse(err, "GET /api/projects/:id");
  }
}

/** PUT /api/projects/:id — save name, floors and rooms (needs edit access). Returns the stored project and an id map. */
export async function PUT(request: Request, ctx: RouteContext<"/api/projects/[id]">) {
  try {
    const projectId = parseId((await ctx.params).id, "project id");
    const input = ProjectInput.parse(await request.json().catch(() => null));
    const userId = await getCurrentUserId();
    return NextResponse.json(await saveProject(userId, projectId, input));
  } catch (err) {
    return errorResponse(err, "PUT /api/projects/:id");
  }
}

/** DELETE /api/projects/:id — owner only; rooms, furniture, exports, suggestions and shares cascade. */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/projects/[id]">) {
  try {
    const projectId = parseId((await ctx.params).id, "project id");
    const userId = await getCurrentUserId();
    await deleteProject(userId, projectId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err, "DELETE /api/projects/:id");
  }
}
