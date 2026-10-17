// The plan test bench: runs a fixed set of briefs through the planner (and, with --ai, the local model) and
// reports how many hard rule breaks reach the visitor, which wishes were met, and how long the model took.
//
//   node scripts/plan-eval.mjs                 # rule templates only, instant
//   node scripts/plan-eval.mjs --ai            # with the local model (Ollama must be running)
//   node scripts/plan-eval.mjs --ai --only 3,7 # just these cases
//   node scripts/plan-eval.mjs --verbose       # every option's faults, not just the top one
//
// Exits non-zero if any case's top option has a hard fault or the geometry is broken, so it can gate changes.

import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

// Resolve the app's "@/…" imports and extensionless .ts paths, and stand in for "server-only".
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,", shortCircuit: true };
    let target = null;
    if (specifier.startsWith("@/")) target = path.join(root, specifier.slice(2));
    else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.endsWith(".ts")) target = path.join(path.dirname(new URL(context.parentURL).pathname), specifier);
    if (target) {
      for (const f of [target, `${target}.ts`, path.join(target, "index.ts")]) if (existsSync(f) && !f.endsWith("/")) return { url: pathToFileURL(f).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
});

// Plain process env for the model settings (the app reads .env.local through Next).
const { default: nextEnv } = await import("@next/env");
const { loadEnvConfig } = nextEnv;
loadEnvConfig(root);

const { PlanBrief, bestOptions, floorRooms, applyPrefs, ruleConcepts, realize, briefProblem } = await import("@/lib/planner");
const { readNotes, PREF_TEXT } = await import("@/lib/planNotes");

const args = process.argv.slice(2);
const useAi = args.includes("--ai");
const verbose = args.includes("--verbose");
const dump = args.includes("--dump");
const showAll = args.includes("--all");
const showRaw = args.includes("--raw");
const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",").map(Number) : null;
// --draw DIR writes each case's options as drawing sheets (SVG) there, to look at.
const drawDir = args.includes("--draw") ? path.resolve(args[args.indexOf("--draw") + 1]) : null;
const { planSheetSvg } = drawDir ? await import("@/lib/planSheet") : {};
if (drawDir) (await import("node:fs")).mkdirSync(drawDir, { recursive: true });
const ai = useAi ? await import("@/lib/server/planAi") : null;

const SB = { front: 5, rear: 3, left: 2, right: 2 };
const NO_SB = { front: 0, rear: 0, left: 0, right: 0 };
const flat = (o) => ({ homeType: "apartment", floors: 1, setbacks: NO_SB, vastu: false, extras: {}, ...o });
const house = (o) => ({ homeType: "house", floors: 1, setbacks: SB, vastu: true, extras: { "Pooja Room": 1, Store: 1 }, ...o });

/** [name, brief, prefs the notes should be read as] */
let CASES = [
  ["2BHK apartment, the screenshot", flat({ bhk: 2, width: 30, depth: 36, facing: "east", extras: { Balcony: 1 } })],
  ["1BHK apartment, small", flat({ bhk: 1, width: 22, depth: 28, facing: "north", extras: { Balcony: 1 } })],
  ["Studio-size 1BHK", flat({ bhk: 1, width: 18, depth: 25, facing: "west" })],
  ["3BHK apartment with pooja", flat({ bhk: 3, width: 40, depth: 45, facing: "south", extras: { "Pooja Room": 1, Balcony: 1 } })],
  ["4BHK apartment, Vastu", flat({ bhk: 4, width: 50, depth: 55, facing: "west", vastu: true, extras: { "Dining Room": 1, Study: 1, Balcony: 2 } })],
  ["2BHK house, G, 30×40 north", house({ bhk: 2, width: 30, depth: 40, facing: "north" })],
  ["3BHK house, G+1, 30×40 east", house({ bhk: 3, width: 30, depth: 40, facing: "east", floors: 2 })],
  ["3BHK house, G+1, 40×60 west, study", house({ bhk: 3, width: 40, depth: 60, facing: "west", floors: 2, extras: { "Pooja Room": 1, Store: 1, Study: 1, "Dining Room": 1 } })],
  ["4BHK house, G+2, 50×80 south", house({ bhk: 4, width: 50, depth: 80, facing: "south", floors: 3 })],
  ["4BHK villa, G+1, 60×90, every extra", house({ homeType: "villa", bhk: 4, width: 60, depth: 90, facing: "north", floors: 2, extras: { "Pooja Room": 1, "Dining Room": 1, Balcony: 1, Study: 1, "Walk-in Closet": 1, Store: 1, Bathroom: 1 } })],
  ["Narrow 20×60, 2BHK G+1", house({ bhk: 2, width: 20, depth: 60, facing: "north", floors: 2, setbacks: { front: 5, rear: 3, left: 0, right: 0 } })],
  ["Very narrow 15×50, 1BHK G+1", house({ bhk: 1, width: 15, depth: 50, facing: "east", floors: 2, setbacks: { front: 3, rear: 2, left: 0, right: 0 }, extras: {} })],
  ["Wide and shallow 60×25, 2BHK", house({ bhk: 2, width: 60, depth: 25, facing: "south", setbacks: { front: 3, rear: 2, left: 3, right: 3 } })],
  ["Tiny 20×20 1BHK", house({ bhk: 1, width: 20, depth: 20, facing: "north", setbacks: NO_SB, extras: {} })],
  ["Many bathrooms: 3BHK + 3", flat({ bhk: 3, width: 40, depth: 50, facing: "north", extras: { Bathroom: 3 } })],
  ["Large setbacks 40×60", house({ bhk: 3, width: 40, depth: 60, facing: "north", setbacks: { front: 10, rear: 10, left: 8, right: 8 } })],
  ["G+2 3BHK 25×50", house({ bhk: 3, width: 25, depth: 50, facing: "north", floors: 3, setbacks: { front: 4, rear: 2, left: 1, right: 1 } })],
  ["Notes: parents can't climb stairs", house({ bhk: 3, width: 30, depth: 50, facing: "east", floors: 2, notes: "My parents stay with us and my father can't climb stairs." }), ["elderGround"]],
  ["Notes: parking and open kitchen", house({ bhk: 2, width: 30, depth: 50, facing: "east", floors: 2, notes: "We have a car, need parking. I like an open kitchen." }), ["parking", "openKitchen"]],
  ["Notes: work from home, quiet", flat({ bhk: 2, width: 32, depth: 40, facing: "north", notes: "Both of us work from home. The road is noisy so keep bedrooms quiet." }), ["homeOffice", "quietBedrooms"]],
  ["Notes: big hall, no Vastu", house({ bhk: 3, width: 40, depth: 50, facing: "south", notes: "We host big family gatherings, want a spacious hall. Don't care about vastu." }), ["bigLiving", "noVastu"]],
  ["Notes: attached baths, laundry", house({ bhk: 3, width: 35, depth: 55, facing: "west", floors: 2, notes: "Attached bathroom for every bedroom please, and space for the washing machine." }), ["attachedBaths", "utility"]],
  ["Notes: Hinglish", house({ bhk: 3, width: 30, depth: 50, facing: "north", floors: 2, notes: "Amma ke liye neeche kamra chahiye, bada hall, aur gaadi ke liye parking." }), ["elderGround", "bigLiving", "parking"]],
  ["Notes: pool and lift (can't do)", house({ bhk: 4, width: 50, depth: 70, facing: "north", floors: 2, notes: "Would love a swimming pool and a lift for my grandmother." }), ["elderGround"]],
  ["Notes: kitchen near the door", flat({ bhk: 2, width: 30, depth: 40, facing: "south", notes: "Keep the kitchen near the entrance, close to the main door." }), ["kitchenFront"]],
];

// --random N [--seed S]: N generated briefs instead of the fixed list, to find cases nobody thought to write.
if (args.includes("--random")) {
  const n = Number(args[args.indexOf("--random") + 1]) || 100;
  let seed = args.includes("--seed") ? Number(args[args.indexOf("--seed") + 1]) : 1;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pickOne = (xs) => xs[Math.floor(rnd() * xs.length)];
  const NOTES = [
    undefined, undefined, undefined,
    "My parents live with us and can't climb stairs.",
    "We have two cars.",
    "I work from home and need a quiet study.",
    "Open kitchen please, we love cooking together.",
    "Big hall for family functions.",
    "The road is very noisy.",
    "Every bedroom should have an attached bathroom.",
    "Need a utility area for the washing machine.",
    "Kitchen near the entrance.",
    "No vastu needed.",
    "Swimming pool if possible.",
  ];
  CASES.length = 0;
  for (let i = 0; i < n; i++) {
    const homeType = pickOne(["apartment", "house", "house", "house", "villa"]);
    const bhk = pickOne([1, 2, 2, 3, 3, 4]);
    const width = Math.round(15 + rnd() * (homeType === "villa" ? 70 : 45));
    const depth = Math.round(Math.max(18, width * (0.6 + rnd() * 1.8)));
    const floors = homeType === "apartment" ? 1 : pickOne([1, 1, 2, 2, 3]);
    const extras = {};
    for (const r of ["Bathroom", "Dining Room", "Pooja Room", "Study", "Balcony", "Walk-in Closet", "Store"]) if (rnd() < 0.3) extras[r] = rnd() < 0.85 ? 1 : 2;
    const sb = homeType === "apartment" ? { front: 0, rear: 0, left: 0, right: 0 } : { front: Math.round(rnd() * 8), rear: Math.round(rnd() * 5), left: Math.round(rnd() * 4), right: Math.round(rnd() * 4) };
    const brief = { homeType, bhk, floors, extras, width: Math.min(150, width), depth: Math.min(250, depth), facing: pickOne(["north", "east", "south", "west"]), setbacks: sb, vastu: rnd() < 0.6, notes: pickOne(NOTES) };
    if (!brief.notes) delete brief.notes;
    const area = (brief.width - sb.left - sb.right) * (brief.depth - sb.front - sb.rear);
    CASES.push([`random ${i + 1}: ${homeType} ${bhk}BHK ${floors > 1 ? `G+${floors - 1} ` : ""}${brief.width}×${brief.depth} ${brief.facing} (${Math.round(area)} sq ft buildable)${brief.notes ? " + notes" : ""}`, brief]);
  }
}

const overlaps = (a, b) => a.floor === b.floor && Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0.06 && Math.min(a.z + a.l, b.z + b.l) - Math.max(a.z, b.z) > 0.06;

/** Geometry that must hold whoever arranged the plan: inside the plot, no overlaps, every room present. */
function geometryFaults(brief, prefs, o) {
  const out = [];
  const b = o.buildable;
  for (const r of o.rooms) if (r.x < b.x - 0.06 || r.z < b.z - 0.06 || r.x + r.w > b.x + b.w + 0.06 || r.z + r.l > b.z + b.l + 0.06) out.push(`${r.name} outside the buildable area`);
  for (let i = 0; i < o.rooms.length; i++) for (let j = i + 1; j < o.rooms.length; j++) if (overlaps(o.rooms[i], o.rooms[j])) out.push(`${o.rooms[i].name} overlaps ${o.rooms[j].name}`);
  const want = floorRooms(applyPrefs(brief, prefs), prefs).flat().map((n) => n.replace(/ \d+$/, "").replace(/^Bedroom$/, "Bedroom"));
  const have = o.rooms.map((r) => r.name);
  for (const n of new Set(want)) {
    const need = want.filter((x) => x === n).length;
    const got = have.filter((x) => x === n || (n === "Bedroom" && /^Bedroom \d$/.test(x))).length;
    if (got < need && !/^Bedroom/.test(n)) out.push(`${n}: ${got} of ${need}`);
  }
  return out;
}

const pad = (s, n) => String(s).padEnd(n);
let failed = 0;
const totals = { cases: 0, topHard: 0, anyClean: 0, geometry: 0, prefsWanted: 0, prefsMet: 0, aiUsed: 0, aiCleanTop: 0, aiTime: 0, aiInTop: 0, aiHardBefore: 0, aiHardAfter: 0 };

for (const [i, [name, raw, expect = []]] of CASES.entries()) {
  if (only && !only.includes(i + 1)) continue;
  const brief = PlanBrief.parse(raw);
  const problem = briefProblem(brief, readNotes(brief.notes).prefs);
  if (problem) {
    totals.refused = (totals.refused ?? 0) + 1;
    if (verbose) console.log(`\n· ${i + 1}. ${name}\n   refused: ${problem}`);
    continue;
  }
  totals.cases++;
  let prefs = readNotes(brief.notes).prefs;
  let unmet = readNotes(brief.notes).unmet;
  let extra = [];
  let aiLine = "";
  if (ai) {
    const t0 = Date.now();
    const res = await ai.planWithAi(brief, prefs);
    const ms = Date.now() - t0;
    prefs = res.prefs;
    unmet = res.unmet;
    extra = res.concepts;
    totals.aiTime += ms;
    if (res.status === "used") totals.aiUsed++;
    totals.aiHardBefore += res.diag?.hardBefore ?? 0;
    totals.aiHardAfter += res.diag?.hardAfter ?? 0;
    const d = res.diag;
    const sec = (v) => (v / 1000).toFixed(1);
    aiLine = `ai ${res.status} ${sec(ms)}s (notes ${sec(d?.ms.notes ?? 0)}, ideas ${(d?.ms.ideas ?? []).map(sec).join("+")}, review ${(d?.ms.review ?? []).map(sec).join("+") || "-"}), hard faults ${d?.hardBefore ?? "-"} → ${d?.hardAfter ?? "-"}${res.note ? ` (${res.note})` : ""}`;
    if (d) {
      totals.aiIdeas = (totals.aiIdeas ?? 0) + d.ideas.length;
      totals.aiCleanFirst = (totals.aiCleanFirst ?? 0) + d.ideas.filter((x) => !x.before.length).length;
      totals.aiCleanCode = (totals.aiCleanCode ?? 0) + d.ideas.filter((x) => !x.before.length || (x.afterCode && !x.afterCode.length)).length;
      totals.aiCleanIdeas = (totals.aiCleanIdeas ?? 0) + extra.filter((c) => !realize(brief, c, prefs).violations.some((v) => v.severity === "hard")).length;
      const rules = totals.aiRules ?? (totals.aiRules = {});
      for (const x of d.ideas) for (const r of x.before) rules[r] = (rules[r] ?? 0) + 1;
      if (showRaw) for (const r of d.raw) console.log(`      RAW ${r.replace(/\s+/g, " ")}`);
      if (verbose) {
        for (const x of d.ideas) {
          const show = (v) => (v === null ? "-" : v.join(",") || "clean");
          console.log(`      [${x.direction}] ${x.drawn}: model ${show(x.before)} → code fix ${show(x.afterCode)} → review ${show(x.after)}`);
          for (const st of x.think) console.log(`        › ${st}`);
        }
      }
    }
  }
  const options = bestOptions(brief, extra, 5, prefs);
  const top = options[0];
  const hard = (o) => o.violations.filter((v) => v.severity === "hard");
  const geo = options.flatMap((o) => geometryFaults(brief, prefs, o).map((g) => `${o.id}: ${g}`));
  const clean = options.filter((o) => !hard(o).length).length;
  totals.topHard += hard(top).length ? 1 : 0;
  totals.anyClean += clean ? 1 : 0;
  totals.geometry += geo.length ? 1 : 0;
  const wanted = expect.filter((k) => k !== "noVastu" && k !== "vastu");
  totals.prefsWanted += wanted.length;
  totals.prefsMet += wanted.filter((k) => top.prefsMet.includes(k)).length;
  const missedRead = expect.filter((k) => !prefs[k]);
  if (ai && options.some((o) => o.source === "ai")) totals.aiInTop++;
  if (ai && top.source === "ai" && !hard(top).length) totals.aiCleanTop++;
  if (hard(top).length || geo.length) failed++;

  const mark = hard(top).length || geo.length ? "✗" : "✓";
  console.log(`\n${mark} ${i + 1}. ${name}`);
  console.log(`   top: ${pad(top.name, 44)} ${top.source} score ${top.score}  · ${clean}/${options.length} options with no hard fault`);
  if (aiLine) console.log(`   ${aiLine}`);
  if (brief.notes) console.log(`   read: ${Object.keys(prefs).filter((k) => prefs[k]).join(", ") || "nothing"}${missedRead.length ? `  · MISSED ${missedRead.join(", ")}` : ""}${unmet.length ? `  · can't do: ${unmet.join("; ")}` : ""}`);
  if (top.prefsMissed.length) console.log(`   wishes not met: ${top.prefsMissed.map((k) => PREF_TEXT[k]).join("; ")}`);
  for (const v of top.violations.filter((v) => v.severity === "hard")) console.log(`   HARD ${v.rule}: ${v.message}`);
  if (verbose) {
    for (const v of top.violations.filter((v) => v.severity === "soft")) console.log(`   soft ${v.rule}: ${v.message}`);
    for (const o of options.slice(1)) console.log(`   · ${pad(o.name, 44)} ${o.source} ${o.score}  ${hard(o).map((v) => v.rule).join(", ")}`);
  }
  for (const g of geo.slice(0, 5)) console.log(`   GEOMETRY ${g}`);
  if (showAll) {
    const all = [...extra, ...ruleConcepts(brief, prefs)].map((c) => realize(brief, c, prefs)).sort((a, b) => b.score - a.score);
    for (const o of all) console.log(`     ${pad(o.id, 26)} ${pad(o.score, 4)} ${o.violations.filter((v) => v.severity === "hard").map((v) => v.message).join("; ")}`);
  }
  if (dump) for (const r of top.rooms) console.log(`     F${r.floor} ${pad(r.name, 16)} x ${pad(r.x, 5)} z ${pad(r.z, 5)} ${r.w} × ${r.l}`);
  if (drawDir) {
    const { writeFileSync } = await import("node:fs");
    options.forEach((o, k) => {
      const faults = o.violations.filter((v) => v.severity === "hard").map((v) => v.message).join("; ");
      const { svg } = planSheetSvg(o, { title: `${i + 1}.${k + 1} ${o.name} (${o.source}, ${o.score})`, subtitle: faults || "no hard faults" });
      writeFileSync(path.join(drawDir, `${String(i + 1).padStart(2, "0")}-${k + 1}.svg`), svg);
    });
  }
}

const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : "-");
console.log(`\n── ${totals.cases} cases${totals.refused ? ` (and ${totals.refused} refused as impossible)` : ""} ──`);
console.log(`top option with a hard fault: ${totals.topHard}   cases with at least one clean option: ${totals.anyClean}/${totals.cases}   broken geometry: ${totals.geometry}`);
console.log(`wishes met by the top option: ${totals.prefsMet}/${totals.prefsWanted} (${pct(totals.prefsMet, totals.prefsWanted)})`);
if (ai) {
  console.log(`model answered: ${totals.aiUsed}/${totals.cases}   an AI idea in the shortlist: ${totals.aiInTop}/${totals.cases}   AI idea on top and clean: ${totals.aiCleanTop}`);
  console.log(`AI ideas clean on first answer: ${totals.aiCleanFirst ?? 0}/${totals.aiIdeas ?? 0}, after code fixes: ${totals.aiCleanCode ?? 0}, after review: ${totals.aiCleanIdeas ?? 0}/${totals.aiIdeas ?? 0}   hard faults ${totals.aiHardBefore} → ${totals.aiHardAfter}   average time ${(totals.aiTime / Math.max(1, totals.cases) / 1000).toFixed(1)}s`);
  console.log(`rules the model broke first time: ${Object.entries(totals.aiRules ?? {}).sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r} ${n}`).join(", ") || "none"}`);
}
process.exit(failed ? 1 : 0);
