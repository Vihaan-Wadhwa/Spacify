// Compares MongoDB room_designs with PostgreSQL rooms (the source of truth for which rooms exist).
//
//   npm run db:check             list orphans (designs whose room_id is no longer in PostgreSQL) and rooms with no design
//   npm run db:check -- --fix    also delete the orphans
//
// Orphans can appear because a save or delete writes to the two databases one after the other, with no transaction
// spanning both: if MongoDB was down when a room or project was deleted, its design documents are left behind.
// The app never shows them (it only reads designs of rooms PostgreSQL still has), so this is cleanup, not repair.
// Exits with code 1 if orphans are found and not fixed.

import nextEnv from "@next/env";
import { MongoClient } from "mongodb";
import pg from "pg";

nextEnv.loadEnvConfig(process.cwd());

const fix = process.argv.includes("--fix");
const { DATABASE_URL, MONGODB_URI } = process.env;
if (!DATABASE_URL || !MONGODB_URI) {
  console.error("✗ DATABASE_URL and MONGODB_URI must both be set in .env.local (README → Database, MongoDB).");
  process.exit(1);
}

const pgClient = new pg.Client({ connectionString: DATABASE_URL });
const mongo = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 3000 });

try {
  await pgClient.connect();
  await mongo.connect();
  const designs = mongo.db(process.env.MONGODB_DB || "spacify").collection("room_designs");

  const { rows: rooms } = await pgClient.query(
    `SELECT r.id, r.project_id, r.room_type, p.name AS project
       FROM rooms r JOIN projects p ON p.id = r.project_id
      ORDER BY r.project_id, r.id`
  );
  const roomsById = new Map(rooms.map((r) => [r.id, r]));
  const docs = await designs.find({}, { projection: { _id: 1, room_id: 1, project_id: 1, room_type: 1 } }).toArray();
  const designed = new Set(docs.map((d) => d.room_id));

  // A design is an orphan if its room is gone, or if it claims a different project than the room has.
  const orphans = docs.filter((d) => roomsById.get(d.room_id)?.project_id !== d.project_id);
  const undesigned = rooms.filter((r) => !designed.has(r.id));

  console.log(`PostgreSQL rooms: ${rooms.length}   MongoDB designs: ${docs.length}\n`);

  if (orphans.length) {
    console.log(`✗ ${orphans.length} orphaned design${orphans.length === 1 ? "" : "s"} (room_id not in PostgreSQL):`);
    for (const d of orphans) {
      const room = roomsById.get(d.room_id);
      const why = room ? `room is in project ${room.project_id}, document says ${d.project_id}` : "room no longer exists";
      console.log(`    _id ${d._id}  room_id ${d.room_id}  project_id ${d.project_id}  ${d.room_type}  (${why})`);
    }
  } else {
    console.log("✓ No orphaned designs");
  }

  if (undesigned.length) {
    console.log(`\n• ${undesigned.length} room${undesigned.length === 1 ? "" : "s"} with no design yet (fine: finishes are optional):`);
    for (const r of undesigned) console.log(`    room ${r.id}  ${r.room_type}  in "${r.project}" (project ${r.project_id})`);
  }

  if (orphans.length && fix) {
    const { deletedCount } = await designs.deleteMany({ _id: { $in: orphans.map((d) => d._id) } });
    console.log(`\n✓ Deleted ${deletedCount} orphaned design${deletedCount === 1 ? "" : "s"}`);
  } else if (orphans.length) {
    console.log("\n  To delete them: npm run db:check -- --fix");
    process.exitCode = 1;
  }
} catch (err) {
  console.error(`✗ Check failed: ${err.message}`);
  console.error("  Are PostgreSQL and MongoDB both running? (docker compose up -d)");
  process.exitCode = 1;
} finally {
  await Promise.allSettled([pgClient.end(), mongo.close()]);
}
