import { notImplemented } from "@/lib/server/http";

// PostgreSQL (Task 3.6 / 4.4–4.5): list the signed-in user's projects, create a project with its rooms.

export async function GET() {
  return notImplemented("GET /api/projects", "List projects for the logged-in user from Postgres `projects`.");
}

export async function POST() {
  return notImplemented("POST /api/projects", "Insert into `projects` + `rooms` in one transaction, tied to the session user_id.");
}
