import { notImplemented } from "@/lib/server/http";

// MongoDB (Task 3.3 / 3.6): per-room design configs — wall colour/finish, flooring, lighting — keyed by room_id.

export async function GET() {
  return notImplemented("GET /api/design?roomId=", "Read the room's design document from MongoDB.");
}

export async function PUT() {
  return notImplemented("PUT /api/design", "Upsert the room's design document in MongoDB.");
}
