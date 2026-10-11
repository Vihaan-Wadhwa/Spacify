// ════════════════════════════════════════════════════════════════════
//  Spacify — MongoDB queries on room_designs, for the DBMS report
//  Run (docker):  docker compose exec -T mongo mongosh --quiet spacify --file /dev/stdin < db/mongo-queries.js
//  Run (local):   mongosh --quiet "mongodb://localhost:27017/spacify" db/mongo-queries.js
//  room_id / project_id / updated_by are PostgreSQL ids (rooms.id, projects.id, users.id).
// ════════════════════════════════════════════════════════════════════

const heading = (title) => print(`\n── ${title} ${"─".repeat(Math.max(0, 60 - title.length))}`);

// ─── 1. Rooms per flooring material ($group) ────────────────────────
heading("1. Rooms per flooring material");
printjson(
  db.room_designs
    .aggregate([
      { $group: { _id: "$flooring.material", rooms: { $sum: 1 }, finishes: { $addToSet: "$flooring.name" } } },
      { $sort: { rooms: -1, _id: 1 } },
    ])
    .toArray()
);

// ─── 2. Most common wall finish per room type ───────────────────────
// Count each (room_type, finish) pair, sort by count, then keep the first finish per room type.
heading("2. Most common wall finish per room type");
printjson(
  db.room_designs
    .aggregate([
      { $group: { _id: { room_type: "$room_type", finish: "$walls.finish" }, rooms: { $sum: 1 } } },
      { $sort: { rooms: -1, "_id.finish": 1 } },
      { $group: { _id: "$_id.room_type", finish: { $first: "$_id.finish" }, rooms: { $first: "$rooms" } } },
      { $sort: { _id: 1 } },
    ])
    .toArray()
);

// ─── 3. Kitchens by layout ──────────────────────────────────────────
// Only kitchens have a `kitchen` block — the room-type-specific part that fixed SQL columns would leave NULL elsewhere.
heading("3. Kitchens by layout");
printjson(
  db.room_designs
    .aggregate([
      { $match: { kitchen: { $exists: true } } },
      { $group: { _id: "$kitchen.layout", kitchens: { $sum: 1 }, countertops: { $addToSet: "$kitchen.countertop" }, room_ids: { $push: "$room_id" } } },
      { $sort: { kitchens: -1, _id: 1 } },
    ])
    .toArray()
);

// ─── 4. Designs updated in the last 7 days ──────────────────────────
heading("4. Designs updated in the last 7 days");
const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
printjson(
  db.room_designs
    .find({ updated_at: { $gte: weekAgo } }, { _id: 0, room_id: 1, project_id: 1, room_type: 1, updated_by: 1, updated_at: 1 })
    .sort({ updated_at: -1 })
    .toArray()
);

// ─── 5. Looking up one room's design uses the unique room_id index ──
// This is how the app links a PostgreSQL room to its document. explain() shows an IXSCAN on room_id_1
// that examines exactly one document, instead of a COLLSCAN over the whole collection.
heading("5. find({ room_id }) with explain()");
const sample = db.room_designs.findOne({}, { room_id: 1 });
if (sample) {
  const plan = db.room_designs.find({ room_id: sample.room_id }).explain("executionStats");
  const stages = [];
  for (let s = plan.queryPlanner.winningPlan; s; s = s.inputStage) stages.push(s.indexName ? `${s.stage} (${s.indexName})` : s.stage);
  printjson({
    query: { room_id: sample.room_id },
    plan: stages.join(" ← "),
    docsReturned: plan.executionStats.nReturned,
    docsExamined: plan.executionStats.totalDocsExamined,
    keysExamined: plan.executionStats.totalKeysExamined,
  });
} else {
  print("No designs yet — run npm run db:setup first.");
}
