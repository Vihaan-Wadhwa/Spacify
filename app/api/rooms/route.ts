import { notImplemented } from "@/lib/server/http";

// PostgreSQL (Task 3.6): room records for a project — room_type, width, length, height, floor, position.

export async function GET() {
  return notImplemented("GET /api/rooms?projectId=", "List rooms for a project from Postgres `rooms`.");
}

export async function POST() {
  return notImplemented("POST /api/rooms", "Insert a room into Postgres `rooms`.");
}
