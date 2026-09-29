// Creates the Spacify tables and sample data in the database at DATABASE_URL (read from .env.local).
//
//   npm run db:setup    create tables + sample data (skips if the tables already exist)
//   npm run db:reset    DELETE EVERYTHING, then recreate tables + sample data
//
// Add --no-seed to either to skip the sample data.

import { readFile } from "node:fs/promises";
import path from "node:path";
import nextEnv from "@next/env";
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
    const { rows: counts } = await client.query("SELECT (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM projects) AS projects");
    console.log(`✓ Already set up (${counts[0].users} users, ${counts[0].projects} projects). Nothing to do.`);
    console.log("  To wipe it and start again: npm run db:reset");
  } else {
    await client.query("BEGIN");
    if (reset) {
      await client.query(await sql("reset.sql"));
      console.log("• Dropped existing tables");
    }
    await client.query(await sql("schema.sql"));
    console.log("• Created 8 tables, 3 triggers, project_access() and project_summary");
    if (seed) {
      await client.query(await sql("seed.sql"));
      console.log("• Added sample data (log-in for later: demo@spacify.in / spacify123)");
    }
    await client.query("COMMIT");
    console.log("✓ Database ready");
  }
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  console.error(`✗ Setup failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
