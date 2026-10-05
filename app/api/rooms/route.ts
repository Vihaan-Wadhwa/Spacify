import { NextResponse } from "next/server";
import { z } from "zod";
import { MAX_FLOORS } from "@/lib/rooms";
import { getCurrentUserId } from "@/lib/server/currentUser";
import { errorResponse } from "@/lib/server/errors";
import { parseId } from "@/lib/server/params";
import { addRoom, listRooms } from "@/lib/server/projects";

// The design page saves all rooms at once through PUT /api/projects/:id.
// These endpoints work on single rooms (handy for scripts, tests and the report).

/** GET /api/rooms?projectId=1 */
export async function GET(request: Request) {
  try {
    const projectId = parseId(new URL(request.url).searchParams.get("projectId"), "projectId");
    const userId = await getCurrentUserId();
    return NextResponse.json({ rooms: await listRooms(userId, projectId) });
  } catch (err) {
    return errorResponse(err, "GET /api/rooms");
  }
}

const NewRoom = z.object({
  projectId: z.number().int().positive(),
  name: z.string().trim().min(1).max(50),
  w: z.number().positive().max(100),
  l: z.number().positive().max(100),
  h: z.number().min(7).max(20).default(10),
  floor: z.number().int().min(1).max(MAX_FLOORS).default(1),
  x: z.number().min(-1000).max(1000).default(0),
  z: z.number().min(-1000).max(1000).default(0),
});

/** POST /api/rooms — body: { projectId, name, w, l, h?, floor?, x?, z? } (x/z: position on the plan in feet) */
export async function POST(request: Request) {
  try {
    const { projectId, ...room } = NewRoom.parse(await request.json().catch(() => null));
    const userId = await getCurrentUserId();
    return NextResponse.json({ room: await addRoom(userId, projectId, room) }, { status: 201 });
  } catch (err) {
    return errorResponse(err, "POST /api/rooms");
  }
}
