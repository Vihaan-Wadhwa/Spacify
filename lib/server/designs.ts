import "server-only";
import type { AnyBulkWriteOperation, Collection } from "mongodb";
import { isKitchen, type RoomDesign } from "@/lib/rooms";
import { getPool, query } from "./db";
import { HttpError, describeError } from "./errors";
import { MongoNotSetUpError, getDb } from "./mongo";
import { requireAccess } from "./projects";

// Room designs live in MongoDB (one document per room); which rooms exist and who may see them stays in PostgreSQL.
// So every function here checks access through PostgreSQL's project_access() first, and MongoDB never decides access.

/** A document in `room_designs`. room_id / project_id / updated_by are PostgreSQL ids. */
type DesignDoc = RoomDesign & {
  room_id: number;
  project_id: number;
  /** Copy of rooms.room_type, so aggregations don't need PostgreSQL. */
  room_type: string;
  updated_by: number;
  updated_at: Date;
};

const COLLECTION = "room_designs";

const globalForDesigns = globalThis as unknown as { spacifyDesignsReady?: boolean };

/**
 * The collection, once db:setup has created it. Writing to a missing collection would quietly create one
 * without the $jsonSchema validator and unique index, so that's refused instead (checked once per server process).
 */
async function designs(): Promise<Collection<DesignDoc>> {
  const db = getDb();
  if (!globalForDesigns.spacifyDesignsReady) {
    if (!(await db.listCollections({ name: COLLECTION }, { nameOnly: true }).hasNext())) throw new MongoNotSetUpError();
    globalForDesigns.spacifyDesignsReady = true;
  }
  return db.collection<DesignDoc>(COLLECTION);
}

/** The design part of a document, with keys in a fixed order (the design page compares designs as JSON). */
function toDesign(d: RoomDesign): RoomDesign {
  return {
    walls: { finish: d.walls.finish, color: d.walls.color, ...(d.walls.name && { name: d.walls.name }) },
    flooring: { material: d.flooring.material, name: d.flooring.name, color: d.flooring.color },
    ...(d.windows && { windows: { type: d.windows.type, frame: d.windows.frame, color: d.windows.color, polish: d.windows.polish } }),
    ...(d.doors && { doors: { style: d.doors.style, color: d.doors.color, polish: d.doors.polish } }),
    ...(d.furniture && { furniture: d.furniture.map((f) => ({ id: f.id, type: f.type, x: f.x, z: f.z, rot: f.rot })) }),
    ...(d.ceiling && { ceiling: { type: d.ceiling.type } }),
    ...(d.lighting && { lighting: d.lighting.map((l) => ({ type: l.type, count: l.count })) }),
    ...(d.kitchen && { kitchen: { layout: d.kitchen.layout, countertop: d.kitchen.countertop } }),
  };
}

function toDoc(room: { id: number; room_type: string }, projectId: number, userId: number, design: RoomDesign): DesignDoc {
  const { kitchen, ...rest } = toDesign(design);
  return {
    room_id: room.id,
    project_id: projectId,
    room_type: room.room_type,
    ...rest,
    // A kitchen layout only makes sense for a kitchen (e.g. the room's type was changed since it was chosen).
    ...(kitchen && isKitchen(room.room_type) && { kitchen }),
    updated_by: userId,
    updated_at: new Date(),
  };
}

const projectRooms = (projectId: number) =>
  query<{ id: number; room_type: string }>("SELECT id, room_type FROM rooms WHERE project_id = $1", [projectId]);

/** Designs of the project's rooms, keyed by room id (needs view access). Rooms without a document are left out. */
export async function getDesigns(userId: number, projectId: number): Promise<Record<number, RoomDesign>> {
  await requireAccess(getPool(), userId, projectId, "view");
  const roomIds = (await projectRooms(projectId)).map((r) => r.id);
  if (!roomIds.length) return {};
  // Only rooms PostgreSQL still has: an orphaned document (see npm run db:check) is never shown.
  const docs = await (await designs())
    .find({ project_id: projectId, room_id: { $in: roomIds } }, { projection: { _id: 0 } })
    .toArray();
  return Object.fromEntries(docs.map((d) => [d.room_id, toDesign(d)]));
}

/**
 * Step 2 of saving a project, after its PostgreSQL transaction has committed (needs edit access).
 * `designs` is keyed by browser room id; `idMap` (from the save) turns those into database room ids.
 * One ordered bulkWrite: an upsert per designed room, then removal of documents whose room no longer exists.
 * Upserts make it safe to simply run again if it failed half-way.
 */
export async function saveDesigns(
  userId: number,
  projectId: number,
  idMap: Record<number, number>,
  input: Record<string, RoomDesign>
): Promise<{ saved: number; removed: number }> {
  await requireAccess(getPool(), userId, projectId, "edit");
  const rooms = new Map((await projectRooms(projectId)).map((r) => [r.id, r]));

  const ops: AnyBulkWriteOperation<DesignDoc>[] = [];
  for (const [browserId, design] of Object.entries(input)) {
    const room = rooms.get(idMap[Number(browserId)]);
    if (!room) continue; // not a room of this project: never write a document PostgreSQL doesn't know about
    ops.push({ replaceOne: { filter: { room_id: room.id }, replacement: toDoc(room, projectId, userId, design), upsert: true } });
  }
  ops.push({ deleteMany: { filter: { project_id: projectId, room_id: { $nin: [...rooms.keys()] } } } });

  const result = await (await designs()).bulkWrite(ops, { ordered: true });
  return { saved: ops.length - 1, removed: result.deletedCount };
}

/**
 * saveDesigns() for the project routes: a MongoDB failure doesn't undo the rooms that were just saved, so it becomes
 * a warning for the user instead of an error. There's no transaction spanning both databases; the page stays unsaved
 * and the next Save retries.
 */
export async function saveDesignsAfterRooms(
  userId: number,
  projectId: number,
  idMap: Record<number, number>,
  input: Record<string, RoomDesign> | undefined
): Promise<string | undefined> {
  if (!input) return undefined; // a client that only sends rooms
  try {
    await saveDesigns(userId, projectId, idMap, input);
    return undefined;
  } catch (err) {
    return `Rooms saved, but finishes couldn't be saved: ${describeError(err, "save designs").message}`;
  }
}

/** Upserts one room's design (needs edit access; the room must belong to the project). Used by PUT /api/design. */
export async function saveRoomDesign(userId: number, projectId: number, roomId: number, design: RoomDesign): Promise<RoomDesign> {
  await requireAccess(getPool(), userId, projectId, "edit");
  const room = (await projectRooms(projectId)).find((r) => r.id === roomId);
  if (!room) throw new HttpError(404, "Room not found in this project.");
  const doc = toDoc(room, projectId, userId, design);
  await (await designs()).replaceOne({ room_id: roomId }, doc, { upsert: true });
  return toDesign(doc);
}

/**
 * Removes every design of a deleted project. Call only after deleteProject() has committed: that's where the owner
 * check happened, and once the project is gone from PostgreSQL there's nothing left to check access against.
 */
export async function deleteProjectDesigns(projectId: number): Promise<number> {
  return (await (await designs()).deleteMany({ project_id: projectId })).deletedCount;
}
