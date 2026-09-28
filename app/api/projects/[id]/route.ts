import { notImplemented } from "@/lib/server/http";

// PostgreSQL (Task 4.5): load, update or delete one project. Check ownership / shared_projects permission first.

export async function GET(_request: Request, ctx: RouteContext<"/api/projects/[id]">) {
  const { id } = await ctx.params;
  return notImplemented(`GET /api/projects/${id}`, "Return the project with its rooms (and Mongo design docs).");
}

export async function PUT(_request: Request, ctx: RouteContext<"/api/projects/[id]">) {
  const { id } = await ctx.params;
  return notImplemented(`PUT /api/projects/${id}`, "Replace the project's rooms; used by Save and auto-save.");
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/projects/[id]">) {
  const { id } = await ctx.params;
  return notImplemented(`DELETE /api/projects/${id}`, "Delete the project (rooms, exports, suggestions cascade).");
}
