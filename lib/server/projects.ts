import "server-only";
import type { Pool, PoolClient } from "pg";
import type { Access, ProjectInput, ProjectListItem, SaveResult, SavedProject } from "@/lib/projects";
import { roomArea, type Opening, type Room } from "@/lib/rooms";
import { getPool, query, withTransaction } from "./db";
import { HttpError } from "./errors";

// ─── Row shapes ──────────────────────────────────────────────────────

type ProjectRow = {
  id: number;
  name: string;
  floors: number;
  total_area: number;
  owner_name: string;
  updated_at: Date;
  room_count: number;
  access: Access;
};

type RoomRow = {
  id: number;
  room_type: string;
  width: number;
  length: number;
  height: number;
  floor: number;
  position_x: number;
  position_z: number;
  shape: [number, number][] | null;
};

type OpeningRow = { id: number; room_id: number; kind: Opening["kind"]; wall: Opening["wall"]; wall_offset: number; width: number };

const ROOM_COLUMNS = "id, room_type, width, length, height, floor, position_x, position_z, shape";

const toRoom = (r: RoomRow, openings: Opening[] = []): Room => ({
  id: r.id,
  name: r.room_type,
  w: r.width,
  l: r.length,
  h: r.height,
  floor: r.floor,
  x: r.position_x,
  z: r.position_z,
  ...(r.shape && { shape: r.shape }),
  openings,
});

const toOpening = (o: OpeningRow): Opening => ({ id: o.id, kind: o.kind, wall: o.wall, offset: o.wall_offset, width: o.width });

const toListItem = (p: ProjectRow): ProjectListItem => ({
  id: p.id,
  name: p.name,
  floors: p.floors,
  totalArea: p.total_area,
  access: p.access,
  ownerName: p.owner_name,
  updatedAt: p.updated_at.toISOString(),
  roomCount: p.room_count,
});

/** Either the shared pool (single statements) or a client inside a transaction. */
type Db = Pool | PoolClient;

// ─── Access control ──────────────────────────────────────────────────

/** Checks the user's access through the project_access() SQL function; throws 404/403 if it's not enough. */
export async function requireAccess(db: Db, userId: number, projectId: number, need: "view" | "edit" | "owner"): Promise<Access> {
  const { rows } = await db.query<{ access: Access | null }>("SELECT project_access($1, $2) AS access", [userId, projectId]);
  const access = rows[0]?.access ?? null;
  // Same 404 whether the project doesn't exist or isn't yours, so ids of other people's projects don't leak.
  if (!access) throw new HttpError(404, "Project not found.");
  const rank = { view: 1, edit: 2, owner: 3 };
  if (rank[access] < rank[need]) {
    throw new HttpError(403, need === "owner" ? "Only the project's owner can do that." : "You have view-only access to this project.");
  }
  return access;
}

// ─── Reads ───────────────────────────────────────────────────────────

const SUMMARY_COLUMNS = `ps.id, ps.name, ps.floors, ps.total_area, ps.owner_name, ps.updated_at, ps.room_count`;

/** Every project the user owns or has been shared, most recently changed first. */
export async function listProjects(userId: number): Promise<ProjectListItem[]> {
  const rows = await query<ProjectRow>(
    `SELECT ${SUMMARY_COLUMNS}, project_access($1, ps.id) AS access
       FROM project_summary ps
      WHERE project_access($1, ps.id) IS NOT NULL
      ORDER BY ps.updated_at DESC`,
    [userId]
  );
  return rows.map(toListItem);
}

async function loadProject(db: Db, userId: number, projectId: number): Promise<SavedProject> {
  const access = await requireAccess(db, userId, projectId, "view");
  const [{ rows: projects }, { rows: rooms }, { rows: openings }] = await Promise.all([
    db.query<ProjectRow>(`SELECT ${SUMMARY_COLUMNS} FROM project_summary ps WHERE ps.id = $1`, [projectId]),
    db.query<RoomRow>(`SELECT ${ROOM_COLUMNS} FROM rooms WHERE project_id = $1 ORDER BY id`, [projectId]),
    db.query<OpeningRow>(
      `SELECT o.id, o.room_id, o.kind, o.wall, o.wall_offset, o.width
         FROM openings o JOIN rooms r ON r.id = o.room_id
        WHERE r.project_id = $1
        ORDER BY o.id`,
      [projectId]
    ),
  ]);
  const byRoom = Map.groupBy(openings, (o) => o.room_id);
  const project: Partial<ProjectListItem> = toListItem({ ...projects[0], access });
  delete project.roomCount;
  return {
    ...(project as Omit<ProjectListItem, "roomCount">),
    rooms: rooms.map((r) => toRoom(r, (byRoom.get(r.id) ?? []).map(toOpening))),
  };
}

export async function getProject(userId: number, projectId: number): Promise<SavedProject> {
  return loadProject(getPool(), userId, projectId);
}

export async function listRooms(userId: number, projectId: number): Promise<Room[]> {
  return (await getProject(userId, projectId)).rooms;
}

// ─── Writes ──────────────────────────────────────────────────────────

/**
 * Makes the project's rooms match `rooms` exactly: updates rooms whose id already belongs to the project,
 * inserts the rest, deletes the ones that are gone, and replaces every room's doors and windows.
 * Runs inside the caller's transaction.
 * Returns browser id → database id for every room.
 */
async function syncRooms(client: PoolClient, projectId: number, rooms: ProjectInput["rooms"]): Promise<Record<number, number>> {
  const { rows: existing } = await client.query<{ id: number }>("SELECT id FROM rooms WHERE project_id = $1 FOR UPDATE", [projectId]);
  const existingIds = new Set(existing.map((r) => r.id));
  const keptIds = rooms.map((r) => r.id).filter((id) => existingIds.has(id));

  await client.query("DELETE FROM rooms WHERE project_id = $1 AND NOT (id = ANY($2::int[]))", [projectId, keptIds]);

  const idMap: Record<number, number> = {};
  for (const r of rooms) {
    // A shaped room also stores its outline and real floor area (the trigger sums areas into projects.total_area).
    const shaped = r.shape ? { shape: JSON.stringify(r.shape), area: Math.round(roomArea({ ...r, x: 0, z: 0 }) * 100) / 100 } : { shape: null, area: null };
    const values = [r.name, r.w, r.l, r.h, r.floor, r.x, r.z, shaped.shape, shaped.area];
    if (existingIds.has(r.id)) {
      await client.query(
        `UPDATE rooms SET room_type = $1, width = $2, length = $3, height = $4, floor = $5, position_x = $6, position_z = $7,
                          shape = $8, area = $9
          WHERE id = $10 AND project_id = $11`,
        [...values, r.id, projectId]
      );
      idMap[r.id] = r.id;
    } else {
      const { rows } = await client.query<{ id: number }>(
        `INSERT INTO rooms (room_type, width, length, height, floor, position_x, position_z, shape, area, project_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [...values, projectId]
      );
      idMap[r.id] = rows[0].id;
    }
  }

  // Openings have no identity worth keeping, so they're simply rewritten.
  await client.query("DELETE FROM openings o USING rooms r WHERE o.room_id = r.id AND r.project_id = $1", [projectId]);
  for (const r of rooms) {
    for (const o of r.openings) {
      await client.query("INSERT INTO openings (room_id, kind, wall, wall_offset, width) VALUES ($1, $2, $3, $4, $5)", [
        idMap[r.id],
        o.kind,
        o.wall,
        o.offset,
        o.width,
      ]);
    }
  }
  return idMap;
}

export async function createProject(userId: number, input: ProjectInput): Promise<SaveResult> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<{ id: number }>(
      "INSERT INTO projects (user_id, name, floors) VALUES ($1, $2, $3) RETURNING id",
      [userId, input.name, input.floors]
    );
    const projectId = rows[0].id;
    const idMap = await syncRooms(client, projectId, input.rooms);
    return { project: await loadProject(client, userId, projectId), idMap };
  });
}

export async function saveProject(userId: number, projectId: number, input: ProjectInput): Promise<SaveResult> {
  return withTransaction(async (client) => {
    await requireAccess(client, userId, projectId, "edit");
    await client.query("UPDATE projects SET name = $1, floors = $2 WHERE id = $3", [input.name, input.floors, projectId]);
    const idMap = await syncRooms(client, projectId, input.rooms);
    return { project: await loadProject(client, userId, projectId), idMap };
  });
}

export async function deleteProject(userId: number, projectId: number): Promise<void> {
  await withTransaction(async (client) => {
    await requireAccess(client, userId, projectId, "owner");
    // ON DELETE CASCADE removes its rooms, furniture, exports, AI suggestions and share records.
    await client.query("DELETE FROM projects WHERE id = $1", [projectId]);
  });
}

export async function addRoom(userId: number, projectId: number, room: Omit<Room, "id" | "openings">): Promise<Room> {
  return withTransaction(async (client) => {
    await requireAccess(client, userId, projectId, "edit");
    const { rows } = await client.query<RoomRow>(
      `INSERT INTO rooms (project_id, room_type, width, length, height, floor, position_x, position_z)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${ROOM_COLUMNS}`,
      [projectId, room.name, room.w, room.l, room.h, room.floor, room.x, room.z]
    );
    return toRoom(rows[0]);
  });
}

// ─── Activity logs ───────────────────────────────────────────────────

export async function logExport(userId: number, projectId: number, type: "2d" | "3d"): Promise<void> {
  await withTransaction(async (client) => {
    await requireAccess(client, userId, projectId, "view");
    await client.query("INSERT INTO exports (project_id, user_id, type) VALUES ($1, $2, $3)", [projectId, userId, type]);
  });
}

export async function logAiSuggestion(userId: number, projectId: number, prompt: string, response: string): Promise<void> {
  await withTransaction(async (client) => {
    await requireAccess(client, userId, projectId, "view");
    await client.query("INSERT INTO ai_suggestions (project_id, user_id, user_prompt, ai_response) VALUES ($1, $2, $3, $4)", [
      projectId,
      userId,
      prompt,
      response,
    ]);
  });
}
