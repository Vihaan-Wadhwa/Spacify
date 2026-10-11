import { NextResponse } from "next/server";
import { RoomDesignInput } from "@/lib/projects";
import { getCurrentUserId } from "@/lib/server/currentUser";
import { getDesigns, saveRoomDesign } from "@/lib/server/designs";
import { errorResponse } from "@/lib/server/errors";
import { parseId } from "@/lib/server/params";

// Room designs in MongoDB. The design page saves them with the rooms through PUT /api/projects/:id;
// these endpoints work on them directly (handy for scripts, tests and the report). Access is checked in PostgreSQL.

/** GET /api/design?projectId=1 — { designs: { [roomId]: design } } (needs view access). */
export async function GET(request: Request) {
  try {
    const projectId = parseId(new URL(request.url).searchParams.get("projectId"), "projectId");
    const userId = await getCurrentUserId();
    return NextResponse.json({ designs: await getDesigns(userId, projectId) });
  } catch (err) {
    return errorResponse(err, "GET /api/design");
  }
}

/** PUT /api/design — body: { projectId, roomId, design }; upserts that room's document (needs edit access). */
export async function PUT(request: Request) {
  try {
    const { projectId, roomId, design } = RoomDesignInput.parse(await request.json().catch(() => null));
    const userId = await getCurrentUserId();
    return NextResponse.json({ roomId, design: await saveRoomDesign(userId, projectId, roomId, design) });
  } catch (err) {
    return errorResponse(err, "PUT /api/design");
  }
}
