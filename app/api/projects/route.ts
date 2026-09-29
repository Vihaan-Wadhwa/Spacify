import { NextResponse } from "next/server";
import { ProjectInput } from "@/lib/projects";
import { getCurrentUserId } from "@/lib/server/currentUser";
import { errorResponse } from "@/lib/server/errors";
import { createProject, listProjects } from "@/lib/server/projects";

/** GET /api/projects — projects the user owns or has been shared. */
export async function GET() {
  try {
    const userId = await getCurrentUserId();
    return NextResponse.json({ projects: await listProjects(userId) });
  } catch (err) {
    return errorResponse(err, "GET /api/projects");
  }
}

/** POST /api/projects — create a project with its rooms, in one transaction. Body: { name, floors, rooms }. */
export async function POST(request: Request) {
  try {
    const input = ProjectInput.parse(await request.json().catch(() => null));
    const userId = await getCurrentUserId();
    return NextResponse.json(await createProject(userId, input), { status: 201 });
  } catch (err) {
    return errorResponse(err, "POST /api/projects");
  }
}
