import { NextResponse } from "next/server";
import { ProjectInput } from "@/lib/projects";
import { getCurrentUserId } from "@/lib/server/currentUser";
import { deleteProjectDesigns, saveDesignsAfterRooms } from "@/lib/server/designs";
import { describeError, errorResponse } from "@/lib/server/errors";
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

/**
 * PUT /api/projects/:id — save name, floors and rooms (needs edit access), then the rooms' designs.
 * Two databases, two steps: (a) the PostgreSQL transaction commits and gives the id map, (b) the designs are
 * upserted in MongoDB under the database room ids. If (b) fails the rooms stay saved and the result carries a `warning`.
 */
export async function PUT(request: Request, ctx: RouteContext<"/api/projects/[id]">) {
  try {
    const projectId = parseId((await ctx.params).id, "project id");
    const input = ProjectInput.parse(await request.json().catch(() => null));
    const userId = await getCurrentUserId();
    const result = await saveProject(userId, projectId, input);
    const warning = await saveDesignsAfterRooms(userId, projectId, result.idMap, input.designs);
    return NextResponse.json({ ...result, ...(warning && { warning }) });
  } catch (err) {
    return errorResponse(err, "PUT /api/projects/:id");
  }
}

/**
 * DELETE /api/projects/:id — owner only; rooms, furniture, exports, suggestions and shares cascade in PostgreSQL.
 * Its MongoDB designs are deleted after that commits; if that fails they're orphans until npm run db:check -- --fix.
 */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/projects/[id]">) {
  try {
    const projectId = parseId((await ctx.params).id, "project id");
    const userId = await getCurrentUserId();
    await deleteProject(userId, projectId);
    try {
      await deleteProjectDesigns(projectId);
    } catch (err) {
      const reason = describeError(err, "DELETE /api/projects/:id designs").message;
      return NextResponse.json({ ok: true, warning: `Project deleted, but its finishes couldn't be removed: ${reason}` });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err, "DELETE /api/projects/:id");
  }
}
