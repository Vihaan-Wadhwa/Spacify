// Creates the Spacify tables and sample data in PostgreSQL (DATABASE_URL), then the room_designs collection and sample
// designs in MongoDB (MONGODB_URI). Both are read from .env.local.
//
//   npm run db:setup    create tables + sample data (if they already exist, only adds anything newer: db/upgrade.sql)
//   npm run db:reset    DELETE EVERYTHING in both databases, then recreate tables + collection + sample data
//
// Add --no-seed to either to skip the sample data. MongoDB is optional: if it isn't set or isn't reachable,
// the PostgreSQL part still runs and the script says how to add MongoDB later.

import { readFile } from "node:fs/promises";
import path from "node:path";
import nextEnv from "@next/env";
import { MongoClient } from "mongodb";
import pg from "pg";

const root = process.cwd();
nextEnv.loadEnvConfig(root);

const reset = process.argv.includes("--reset");
const seed = !process.argv.includes("--no-seed");
const url = process.env.DATABASE_URL;

if (!url) {
  console.error("✗ DATABASE_URL isn't set. Copy .env.example to .env.local and fill it in (see README → Database).");
  process.exit(1);
}

const sql = (name) => readFile(path.join(root, "db", name), "utf8");
const client = new pg.Client({ connectionString: url });
let pgReady = false;

try {
  await client.connect();
} catch (err) {
  console.error(`✗ Can't connect to ${url.replace(/:[^:@/]+@/, ":****@")}\n  ${err.message}`);
  console.error("  Is PostgreSQL running, and do the user, password and database in DATABASE_URL exist? (README → Database)");
  process.exit(1);
}

try {
  const { rows } = await client.query("SELECT to_regclass('public.users') IS NOT NULL AS exists");
  if (rows[0].exists && !reset) {
    const { rows: upgrade } = await client.query("SELECT to_regclass('public.openings') IS NULL AS needed");
    if (upgrade[0].needed) {
      await client.query("BEGIN");
      await client.query(await sql("upgrade.sql"));
      await client.query("COMMIT");
      console.log("• Added the openings table (doors and windows) and gave existing rooms their door and window");
    }
    // Openings that are open walls (no door) came later; older databases only allow doors and windows.
    const { rows: kinds } = await client.query("SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'openings_kind_check'");
    const openNeeded = !kinds[0]?.def.includes("'open'");
    if (openNeeded) {
      await client.query(await sql("upgrade-open.sql"));
      console.log("• Openings can now be open walls (a gap with no door)");
    }
    // Rooms that aren't rectangles came later still.
    const { rows: shapes } = await client.query("SELECT NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'rooms' AND column_name = 'shape') AS needed");
    if (shapes[0].needed) {
      await client.query("BEGIN");
      await client.query(await sql("upgrade-shapes.sql"));
      await client.query("COMMIT");
      console.log("• Rooms can now be shapes other than rectangles");
    }
    const changed = upgrade[0].needed || openNeeded || shapes[0].needed;
    const { rows: counts } = await client.query("SELECT (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM projects) AS projects");
    console.log(`✓ PostgreSQL ${changed ? "up to date" : "already set up"} (${counts[0].users} users, ${counts[0].projects} projects).${changed ? "" : " Nothing to do."}`);
    console.log("  To wipe it and start again: npm run db:reset");
  } else {
    await client.query("BEGIN");
    if (reset) {
      await client.query(await sql("reset.sql"));
      console.log("• Dropped existing tables");
    }
    await client.query(await sql("schema.sql"));
    console.log("• Created 9 tables, 3 triggers, project_access() and project_summary");
    if (seed) {
      await client.query(await sql("seed.sql"));
      console.log("• Added sample data (log in as demo@spacify.in / spacify123 or rahul@example.com / rahul123)");
    }
    await client.query("COMMIT");
    console.log("✓ PostgreSQL ready");
  }
  pgReady = true;
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  console.error(`✗ Setup failed: ${err.message}`);
  process.exitCode = 1;
}

try {
  // The sample designs point at PostgreSQL room ids, so MongoDB is only set up once PostgreSQL is.
  if (pgReady) await setupMongo();
} finally {
  await client.end();
}

/**
 * Creates `room_designs` with its $jsonSchema validator (db/mongo-validator.json) and indexes, and seeds a design for
 * some of the sample rooms (db/mongo-seed.json), looking their ids up in PostgreSQL by project name + room type.
 * If the collection already exists, only refreshes the validator and indexes.
 */
async function setupMongo() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.log("! MONGODB_URI isn't set, so MongoDB (room designs) was skipped. Add it to .env.local (README → MongoDB) and run this again.");
    return;
  }
  const mongo = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 3000 });
  try {
    await mongo.connect();
  } catch (err) {
    console.error(`! Can't reach MongoDB at ${mongoUri.replace(/:[^:@/]+@/, ":****@")}, so room designs were skipped (PostgreSQL is done).`);
    console.error(`  ${err.message}`);
    console.error("  Start it (docker compose up -d, or see README → MongoDB) and run npm run db:setup again.");
    await mongo.close();
    return;
  }

  try {
    const db = mongo.db(process.env.MONGODB_DB || "spacify");
    const validator = JSON.parse(await readFile(path.join(root, "db", "mongo-validator.json"), "utf8"));
    const rules = { validator, validationLevel: "strict", validationAction: "error" };
    let exists = await db.listCollections({ name: "room_designs" }, { nameOnly: true }).hasNext();
    if (exists && reset) {
      await db.dropCollection("room_designs");
      console.log("• Dropped room_designs");
      exists = false;
    }
    if (exists) await db.command({ collMod: "room_designs", ...rules });
    else await db.createCollection("room_designs", rules);

    const designs = db.collection("room_designs");
    await designs.createIndexes([
      { key: { room_id: 1 }, name: "room_id_1", unique: true },
      { key: { project_id: 1 }, name: "project_id_1" },
    ]);

    if (exists) {
      console.log(`✓ MongoDB already set up (${await designs.countDocuments()} room designs). Validator and indexes refreshed.`);
      return;
    }
    console.log("• Created the room_designs collection ($jsonSchema validator, unique room_id index, project_id index)");
    if (seed) {
      const samples = JSON.parse(await readFile(path.join(root, "db", "mongo-seed.json"), "utf8"));
      const { rows } = await client.query(
        `SELECT r.id, r.room_type, p.id AS project_id, p.user_id, p.name AS project
           FROM rooms r JOIN projects p ON p.id = r.project_id
          WHERE p.name = ANY($1)
          ORDER BY r.id`,
        [[...new Set(samples.map((s) => s.project))]]
      );
      const ops = [];
      for (const { project, room_type, days_ago, ...design } of samples) {
        const room = rows.find((r) => r.project === project && r.room_type === room_type);
        if (!room) continue;
        const doc = {
          room_id: room.id,
          project_id: room.project_id,
          room_type,
          ...design,
          updated_by: room.user_id,
          updated_at: new Date(Date.now() - days_ago * 86_400_000),
        };
        ops.push({ replaceOne: { filter: { room_id: room.id }, replacement: doc, upsert: true } });
      }
      if (ops.length) await designs.bulkWrite(ops);
      console.log(`• Added ${ops.length} sample room designs`);
    }
    console.log("✓ MongoDB ready");
  } catch (err) {
    console.error(`✗ MongoDB setup failed: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await mongo.close();
  }
}
