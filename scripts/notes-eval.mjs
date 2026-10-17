// The notes test bench: how well people's own words are read as wishes, by the keyword reader alone and, with
// --ai, by the local model and by the two merged (what the app uses).
//
//   node scripts/notes-eval.mjs          # keyword reader only, instant
//   node scripts/notes-eval.mjs --ai     # also the local model (Ollama must be running)
//   node scripts/notes-eval.mjs --held-out [--ai]   # sentences never used for tuning

import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,", shortCircuit: true };
    let target = null;
    if (specifier.startsWith("@/")) target = path.join(root, specifier.slice(2));
    else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.endsWith(".ts")) target = path.join(path.dirname(new URL(context.parentURL).pathname), specifier);
    if (target) for (const f of [target, `${target}.ts`]) if (existsSync(f)) return { url: pathToFileURL(f).href, shortCircuit: true };
    return next(specifier, context);
  },
});

const { readNotes, mergePrefs, PREF_KEYS } = await import("@/lib/planNotes");
const useAi = process.argv.includes("--ai");
const ai = useAi ? await import("@/lib/server/planAi") : null;

/** [what someone wrote, the wishes it expresses, whether it asks for something we can't draw] */
let CASES = [
  ["My parents stay with us and my father can't climb stairs.", ["elderGround"]],
  ["We have a car, need parking. I like an open kitchen.", ["parking", "openKitchen"]],
  ["Both of us work from home. The road is noisy so keep bedrooms quiet.", ["homeOffice", "quietBedrooms"]],
  ["We host big family gatherings, want a spacious hall. Don't care about vastu.", ["bigLiving", "noVastu"]],
  ["Attached bathroom for every bedroom please, and space for the washing machine.", ["attachedBaths", "utility"]],
  ["Amma ke liye neeche kamra chahiye, bada hall, aur gaadi ke liye parking.", ["elderGround", "bigLiving", "parking"]],
  ["Would love a swimming pool and a lift for my grandmother.", ["elderGround"], true],
  ["Keep the kitchen near the entrance, close to the main door.", ["kitchenFront"]],
  ["We don't have a car.", []],
  ["No need for a study, we don't work from home.", []],
  ["Strictly as per vastu please.", ["vastu"]],
  ["Vastu is not important to us.", ["noVastu"]],
  ["Just a simple home for a young couple.", []],
  ["My mother-in-law uses a walker.", ["elderGround"]],
  ["We have two scooters and a bike.", ["parking"]],
  ["I cook a lot, I want the kitchen to be open to the dining.", ["openKitchen"]],
  ["Light sleeper here, the street gets busy at night.", ["quietBedrooms"]],
  ["Need a utility area for drying clothes.", ["utility"]],
  ["Every room should have its own toilet.", ["attachedBaths"]],
  ["Joint family of 8 people.", ["bigLiving"]],
  ["I run a small tuition class from home.", ["homeOffice"]],
  ["Thatha and paati will live on the ground floor.", ["elderGround"]],
  ["Need a home theatre and a gym.", [], true],
  ["Garden in front with a car porch.", ["parking"], true],
  ["We prefer the kitchen at the back, away from guests.", []],
  ["Big bedrooms, small living room is fine.", []],
  ["We want a spacious living room for our dogs to play.", ["bigLiving"]],
  ["WFH setup needed for my wife.", ["homeOffice"]],
  ["No vastu, but the pooja room must face east.", ["noVastu"]],
  ["Elderly father on wheelchair.", ["elderGround"]],
  ["We don't need parking, we use the metro.", []],
  ["Laundry room near kitchen", ["utility"]],
  ["Quiet bedrooms please, away from the main road", ["quietBedrooms"]],
  ["My kids study in their rooms.", []],
  ["We need en-suite bathrooms in all bedrooms.", ["attachedBaths"]],
  ["Mera office ghar se hai, ek alag kamra chahiye.", ["homeOffice"]],
  ["Ghar mein bade buzurg hain, seedhi nahi chadh sakte.", ["elderGround"]],
  ["Two-wheeler parking only.", ["parking"]],
  ["Pool would be nice but not necessary.", [], true],
  ["Open plan kitchen and a big hall for festivals.", ["openKitchen", "bigLiving"]],
];

/** Written separately and never tuned on: an honest check of how well each reader generalises. */
const HELD_OUT = [
  ["Grandpa had a knee surgery last year, so his room should be downstairs.", ["elderGround"]],
  ["We own an SUV.", ["parking"]],
  ["My husband is a doctor and sees patients at home sometimes.", ["homeOffice"]],
  ["Please make sure there's a separate washing area.", ["utility"]],
  ["Hall should be huge, we have a lot of relatives visiting.", ["bigLiving"]],
  ["Don't put any bedroom facing the street, it's a highway.", ["quietBedrooms"]],
  ["Kitchen should be right next to the hall, open style.", ["openKitchen"]],
  ["We are not particular about vaastu.", ["noVastu"]],
  ["Each bedroom needs a bathroom inside it.", ["attachedBaths"]],
  ["I'd like the kitchen facing the road side so I can see who comes.", ["kitchenFront"]],
  ["We don't entertain much, keep the living compact.", []],
  ["Mom is 80 and uses a wheelchair.", ["elderGround"]],
  ["We need space for 2 cars.", ["parking"]],
  ["Please follow vaastu shastra strictly.", ["vastu"]],
  ["Mujhe ghar se kaam karna hai.", ["homeOffice"]],
  ["Noisy neighbourhood, there's a temple with loudspeakers next door.", ["quietBedrooms"]],
  ["A nice garden and a small pond would be lovely.", [], true],
  ["The kids are teenagers, nothing special.", []],
  ["Patti can't use stairs anymore.", ["elderGround"]],
  ["Put the washing machine near the kitchen please.", ["utility"]],
];
const heldOut = process.argv.includes("--held-out");
if (heldOut) CASES.splice(0, CASES.length, ...HELD_OUT);

const readers = ["keyword", ...(ai ? ["model", "merged"] : [])];
const stats = Object.fromEntries(readers.map((r) => [r, { tp: 0, fp: 0, fn: 0, exact: 0, unmetOk: 0 }]));
const on = (p) => PREF_KEYS.filter((k) => p?.[k]);

for (const [i, [text, want, cannot = false]] of CASES.entries()) {
  const kw = readNotes(text);
  const got = { keyword: { prefs: kw.prefs, unmet: kw.unmet } };
  if (ai) {
    const r = await ai.understand(text, Date.now() + 60_000);
    got.model = { prefs: r.model ?? {}, unmet: r.unmet };
    got.merged = { prefs: r.prefs, unmet: r.unmet };
  }
  const line = [];
  for (const name of readers) {
    const have = on(got[name].prefs);
    const s = stats[name];
    const tp = have.filter((k) => want.includes(k)).length;
    s.tp += tp;
    s.fp += have.length - tp;
    s.fn += want.length - tp;
    const exact = have.length === want.length && tp === want.length;
    if (exact) s.exact++;
    if (!!got[name].unmet.length === cannot) s.unmetOk++;
    line.push(`${name}: ${exact ? "✓" : "✗"} ${have.join(",") || "-"}${got[name].unmet.length ? ` [can't: ${got[name].unmet.join("; ")}]` : ""}`);
  }
  console.log(`${String(i + 1).padStart(2)}. ${text}\n    want ${want.join(",") || "-"}${cannot ? " [can't]" : ""}\n    ${line.join("\n    ")}`);
}

console.log(`\n── ${CASES.length} notes${heldOut ? " (held out)" : ""} ──`);
for (const name of readers) {
  const s = stats[name];
  const precision = s.tp / Math.max(1, s.tp + s.fp);
  const recall = s.tp / Math.max(1, s.tp + s.fn);
  console.log(`${name.padEnd(8)} exact ${s.exact}/${CASES.length}   precision ${(precision * 100).toFixed(0)}%   recall ${(recall * 100).toFixed(0)}%   can't-draw flagged right ${s.unmetOk}/${CASES.length}`);
}
