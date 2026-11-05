import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { BANDS, applyPrefs, conceptFromBands, floorRooms, realize, usualBand, type Band, type Circulation, type Concept, type PlanBrief, type PlanOption } from "@/lib/planner";
import { PREF_KEYS, PREF_TEXT, mergePrefs, readNotes, type PrefKey, type Prefs } from "@/lib/planNotes";
import { RULE_TEXT, type Violation } from "@/lib/planRules";
import { HOME_TYPE_LABELS } from "@/lib/start";

/**
 * Asks a local text model (Ollama, free, on this machine) where the rooms should go. It never draws coordinates;
 * lib/planner.ts lays every idea out and scores it next to the rule-based ones.
 *
 * A small model is kept on rails five ways:
 *   1. A written guide (lib/server/skills/floor-planning.md) as its standing instructions: the same rulebook the
 *      code checks (lib/planRules.ts), a playbook for plot shapes, edge cases and good/bad examples.
 *   2. A small decision: for each room only "front", "middle" or "back". The answer's schema has a slot for every
 *      room, so it can't skip, repeat or invent one. The mechanical choices are the code's: it orders rooms within a
 *      band (each bathroom beside its bedroom, kitchen beside dining), and draws every idea both ways round and with
 *      each way of moving through the house (a passage across, a corridor down the side, neither), keeping the best.
 *   3. A fixed way of thinking: three short reasoning lines come first (what the visitor asked for, the plan, a
 *      capacity check), before any choice.
 *   4. Facts worked out by the code (the plot's shape, how many rooms a band can hold, which corner is which) are
 *      handed to it rather than left for it to compute.
 *   5. Checking: each idea is drawn and checked against the rulebook. Small mistakes the code fixes itself (a room
 *      moved to the band a fix calls for); anything still broken goes back to the model with a concrete fix to try.
 *      The better version is kept. The visitor's words are read the same way: every wish the model finds must quote
 *      the words it came from, and quotes that aren't in the text are dropped.
 * The second and third ideas are steered away from the first, so the options genuinely differ.
 *
 *   ollama pull qwen2.5:3b     # ~2 GB, fine on an 8 GB laptop (qwen2.5:7b plans better if you have 16 GB)
 *   npm run ai:setup           # optional: bakes the guide into a "spacify-planner" model
 */

export const PLAN_AI_DEFAULTS = { url: "http://localhost:11434", model: "qwen2.5:3b", timeoutMs: 120_000 };

const SKILL_PATH = path.join(process.cwd(), "lib/server/skills/floor-planning.md");
let skill: string | null = null;
/** The model's guide, read once. */
export function planningSkill(): string {
  return (skill ??= readFileSync(SKILL_PATH, "utf8"));
}

export type AiDiag = {
  model: string;
  ms: { notes: number; ideas: number[]; review: number[] };
  /** each idea: the direction it was given, its reasoning, the drawing kept, and its hard faults as the model gave
   *  it, after the code's own small fixes, and after the model's review (null where that step wasn't needed) */
  ideas: { direction: string; think: string[]; drawn: string; before: string[]; afterCode: string[] | null; after: string[] | null }[];
  hardBefore: number;
  hardAfter: number;
  notesByModel: boolean;
  /** the model's raw answers */
  raw: string[];
};

export type AiPlan = {
  concepts: Concept[];
  prefs: Prefs;
  /** what was asked for that can't be drawn */
  unmet: string[];
  status: "used" | "unavailable" | "failed";
  note?: string;
  diag?: AiDiag;
};

function settings() {
  return {
    url: (process.env.OLLAMA_URL || PLAN_AI_DEFAULTS.url).replace(/\/+$/, ""),
    model: process.env.OLLAMA_PLAN_MODEL || PLAN_AI_DEFAULTS.model,
    timeoutMs: Number(process.env.PLAN_AI_TIMEOUT_MS) || PLAN_AI_DEFAULTS.timeoutMs,
  };
}

type Message = { role: "system" | "user" | "assistant"; content: string };
type ChatFail = { ok: false; status: "unavailable" | "failed"; note: string };
type ChatResult = { ok: true; content: string; ms: number } | ChatFail;

async function chat(messages: Message[], format: object, options: Record<string, number>, deadline: number): Promise<ChatResult> {
  const { url, model } = settings();
  const t0 = Date.now();
  let res: Response;
  try {
    res = await fetch(`${url}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, format, stream: false, keep_alive: "15m", options: { num_ctx: 4096, ...options } }),
      signal: AbortSignal.timeout(Math.max(1000, deadline - Date.now())),
      cache: "no-store",
    });
  } catch (err) {
    const timedOut = (err as Error).name === "TimeoutError";
    return { ok: false, status: timedOut ? "failed" : "unavailable", note: timedOut ? "The local model took too long." : "Ollama isn't running." };
  }
  const body = (await res.json().catch(() => ({}))) as { message?: { content?: string }; error?: string };
  if (!res.ok) {
    const missing = res.status === 404 || /not found/i.test(body.error ?? "");
    return { ok: false, status: missing ? "unavailable" : "failed", note: missing ? `Run: ollama pull ${model}` : body.error ?? `Ollama answered ${res.status}` };
  }
  return { ok: true, content: body.message?.content ?? "", ms: Date.now() - t0 };
}

// ─── Reading the visitor's own words ───────────────────────

const NOTES_SCHEMA = {
  type: "object",
  properties: {
    wishes: {
      type: "array",
      maxItems: 6,
      items: { type: "object", properties: { quote: { type: "string", maxLength: 90 }, wish: { type: "string", enum: [...PREF_KEYS] } }, required: ["quote", "wish"] },
    },
    cannot: {
      type: "array",
      maxItems: 3,
      items: { type: "object", properties: { quote: { type: "string", maxLength: 60 }, thing: { type: "string", maxLength: 40 } }, required: ["quote", "thing"] },
    },
  },
  required: ["wishes", "cannot"],
};

const NotesReply = z.object({
  wishes: z.array(z.object({ quote: z.string(), wish: z.enum(PREF_KEYS) })).max(8),
  cannot: z.array(z.object({ quote: z.string(), thing: z.string() })).max(6),
});

const NOTES_SYSTEM = `You read what someone wrote about the home they want and list the wishes in it. For each wish, first copy the exact words from their text that ask for it ("quote"), then name the wish. Only list a wish when their words ask for it or clearly imply it. Most texts have one to three wishes; if none match, give an empty list. Never list a wish their words don't support, and skip anything they say they DON'T want ("we don't have a car" is not parking).

The wishes:
${PREF_KEYS.map((k) => `- ${k}: ${PREF_TEXT[k]}`).join("\n")}

How words map to wishes: an elderly parent, grandparent, knee trouble, a wheelchair or "can't climb stairs" means elderGround. Hosting guests, functions, a joint family or a big hall means bigLiving. A noisy road, traffic or a light sleeper means quietBedrooms. A car, bike or scooter means parking. Working, teaching or seeing clients from home means homeOffice. A washing machine, laundry or drying clothes means utility. "Vastu" means vastu; "no Vastu" or "Vastu doesn't matter" means noVastu.
The text may mix English with Hindi, Kannada, Tamil or Telugu words (amma, appa, nani, dadi, thatha, paati, gaadi, bada, seedhi, ghar se kaam).

"cannot": things they ask for that aren't rooms in a house plan (a swimming pool, a lift, a basement, a garden, a gym, a home theatre, a courtyard, a staff room). Quote their words for each. Empty if they ask for none.`;

/** What the plans genuinely can't show, for checking the model's "cannot" list. */
const CANT_DRAW = /pool|lift|elevator|basement|cellar|garden|lawn|landscap|gym|theat|cinema|courtyard|aangan|servant|maid|driver|staff|terrace garden|jacuzzi|sauna/i;

const squash = (t: string) => t.toLowerCase().replace(/[^a-z0-9\u0900-\u0fff]+/g, " ").trim();

/**
 * A quote the model gave counts only if it's really in the text (most of its words, in case it tidied them) and
 * not right after a "no" or "don't".
 */
function grounded(quote: string, text: string, negationMatters: boolean): boolean {
  const q = squash(quote);
  const t = squash(text);
  if (q.length < 3) return false;
  const words = q.split(" ").filter((w) => w.length > 1);
  const tw = new Set(t.split(" "));
  const found = words.filter((w) => tw.has(w));
  if (!words.length || found.length / words.length < 0.6) return false;
  const at = t.indexOf(found[0]);
  return !negationMatters || !/\b(no|not|dont|don t|do not|never|without)\b[^.]{0,20}$/.test(t.slice(Math.max(0, at - 24), at));
}

/** Worked examples shown to the model before the real text (none of them from the test benches). */
const NOTES_EXAMPLES: Message[] = [
  { role: "user", content: "My father has knee trouble and we have a scooter." },
  { role: "assistant", content: JSON.stringify({ wishes: [{ quote: "father has knee trouble", wish: "elderGround" }, { quote: "we have a scooter", wish: "parking" }], cannot: [] }) },
  { role: "user", content: "We don't have a car. A pool would be lovely though." },
  { role: "assistant", content: JSON.stringify({ wishes: [], cannot: [{ quote: "a pool would be lovely", thing: "swimming pool" }] }) },
  { role: "user", content: "We rarely have visitors, and the kitchen can go wherever it fits. My daughter does homework in her room." },
  { role: "assistant", content: JSON.stringify({ wishes: [], cannot: [] }) },
  { role: "user", content: "We host Diwali parties every year, and the washing machine should sit near the kitchen." },
  {
    role: "assistant",
    content: JSON.stringify({ wishes: [{ quote: "we host diwali parties", wish: "bigLiving" }, { quote: "washing machine should sit near the kitchen", wish: "utility" }], cannot: [] }),
  },
];

/** The visitor's words as wishes: the keyword reading always, the model's evidence-backed reading on top when it's running. */
export async function understand(notes: string | undefined, deadline: number): Promise<{ prefs: Prefs; unmet: string[]; ms: number; used: boolean; model: Prefs | null }> {
  const keyword = readNotes(notes);
  if (!notes?.trim()) return { ...keyword, ms: 0, used: false, model: null };
  const text = notes.trim();
  const r = await chat(
    [{ role: "system", content: NOTES_SYSTEM }, ...NOTES_EXAMPLES, { role: "user", content: text }],
    NOTES_SCHEMA,
    { temperature: 0, num_predict: 260 },
    deadline
  );
  if (!r.ok) return { ...keyword, ms: 0, used: false, model: null };
  try {
    const parsed = NotesReply.parse(JSON.parse(r.content));
    // Every wish must point at words that are really there: a small model otherwise "finds" wishes from its own instructions.
    const model: Prefs = {};
    for (const w of parsed.wishes) if (grounded(w.quote, text, w.wish !== "elderGround" && w.wish !== "noVastu")) model[w.wish] = true;
    const prefs = mergePrefs(model, keyword.prefs);
    // Only things a house plan really can't show count (the model once listed "a car" here for "we own an SUV")
    const fromModel = parsed.cannot
      .filter((c) => grounded(c.quote, text, true) && CANT_DRAW.test(`${c.thing} ${c.quote}`))
      .map((c) => c.thing.trim().toLowerCase())
      .filter(Boolean);
    return { prefs, unmet: keyword.unmet.length ? keyword.unmet : fromModel.slice(0, 3), ms: r.ms, used: true, model };
  } catch {
    return { ...keyword, ms: r.ms, used: false, model: null };
  }
}

// ─── Proposing arrangements ─────────────────────────────────

const CIRCULATIONS = ["across", "side", "none"] as const;
const FLOOR_KEYS = ["ground", "floor2", "floor3"] as const;

/**
 * Rooms Spacify attaches by rule (each bathroom to its bedroom, store and utility to the kitchen, a walk-in closet to
 * the master bedroom, a balcony to an outside band). The model only places the rooms that shape the house.
 */
const ATTACHED = /^(Bathroom|Store|Utility|Walk-in Closet|Balcony)( \d)?$/;
/** Rooms the model places that don't count towards a band's capacity. */
const SMALL_DECIDED = /^Pooja Room$/;

function ideaSchema(decide: string[][]) {
  const band = { type: "string", enum: [...BANDS] };
  const floors = Object.fromEntries(
    decide.map((list, f) => [FLOOR_KEYS[f], { type: "object", properties: Object.fromEntries(list.map((r) => [r, band])), required: list }])
  );
  return {
    type: "object",
    properties: {
      think: { type: "array", items: { type: "string", maxLength: 140 }, minItems: 2, maxItems: 2 },
      ...floors,
    },
    required: ["think", ...decide.map((_, f) => FLOOR_KEYS[f])],
  };
}

const IdeaReply = z.object({
  think: z.array(z.string()).max(8),
  ground: z.record(z.string(), z.enum(BANDS)),
  floor2: z.record(z.string(), z.enum(BANDS)).optional(),
  floor3: z.record(z.string(), z.enum(BANDS)).optional(),
});
type IdeaReply = z.infer<typeof IdeaReply>;

/** Which plot corner is which compass direction, standing on the road facing the plot. */
function corners(facing: PlanBrief["facing"]) {
  const map = {
    north: { frontLeft: "north-east", frontRight: "north-west", backLeft: "south-east", backRight: "south-west" },
    south: { frontLeft: "south-west", frontRight: "south-east", backLeft: "north-west", backRight: "north-east" },
    east: { frontLeft: "south-east", frontRight: "north-east", backLeft: "south-west", backRight: "north-west" },
    west: { frontLeft: "north-west", frontRight: "south-west", backLeft: "north-east", backRight: "south-east" },
  };
  return map[facing];
}

/** Which band each Vastu corner touches, so the model only has to pick bands (the code mirrors the plan for the side). */
function vastuTargets(facing: PlanBrief["facing"]) {
  const c = corners(facing);
  const bandFor = (dir: string) => (c.frontLeft === dir || c.frontRight === dir ? "front" : "back");
  return `Kitchen: ${bandFor("south-east")} band (south-east). Master Bedroom: ${bandFor("south-west")} band (south-west). Pooja Room: ${bandFor("north-east")} band (north-east).`;
}

type Facts = { bw: number; bl: number; shape: string; advice: string; capacity: number; rooms: string[][]; decide: string[][]; brief: PlanBrief; prefs: Prefs };

/** The plot's shape in the guide's terms, and other facts worked out here so the model doesn't have to. */
function facts(brief: PlanBrief, prefs: Prefs): Facts {
  const b = applyPrefs(brief, prefs);
  const sb = b.homeType === "apartment" ? { front: 0, rear: 0, left: 0, right: 0 } : b.setbacks;
  const bw = b.width - sb.left - sb.right;
  const bl = b.depth - sb.front - sb.rear;
  const perFloor = bw * bl;
  let shape = "standard";
  let advice = "Living (+ Pooja) front; Dining, Kitchen, Store middle; bedrooms with their bathrooms back";
  if (bl < 26) {
    shape = "wide and shallow";
    advice = "everything front (one band)";
  } else if (bw < 25) {
    shape = "narrow";
    advice = "one or two big rooms per band; spread the rest over middle and back";
  } else if (perFloor < 700) {
    shape = "small";
    advice = "Living and Kitchen front; bedrooms back";
  } else if (perFloor > 2000) {
    shape = "large";
    advice = "like standard; the Master Bedroom may go front beside the Living Room";
  }
  const rooms = floorRooms(b, prefs);
  return { bw, bl, shape, advice, capacity: Math.max(1, Math.floor((bw + 2) / 10)), rooms, decide: rooms.map((list) => list.filter((r) => !ATTACHED.test(r))), brief: b, prefs };
}

function ideaPrompt(f: Facts, unmet: string[], direction: string) {
  const { brief: b, prefs } = f;
  const c = corners(b.facing);
  const wishes = PREF_KEYS.filter((k) => prefs[k] && k !== "vastu" && k !== "noVastu");
  const lines = [
    `Home: ${HOME_TYPE_LABELS[b.homeType]}, ${b.bhk} BHK, ${f.rooms.length === 1 ? "single floor" : `${f.rooms.length} floors`}.`,
    `${b.homeType === "apartment" ? "Flat" : "Buildable area"}: ${f.bw} ft wide along the road × ${f.bl} ft deep. Plot shape: ${f.shape} (${f.advice}).`,
    `Band capacity: ${f.capacity} big room${f.capacity === 1 ? "" : "s"} per band.`,
    `Road on the ${b.facing}. Corners: front-left ${c.frontLeft}, front-right ${c.frontRight}, back-left ${c.backLeft}, back-right ${c.backRight}.`,
    b.vastu ? `Vastu: follow it. ${vastuTargets(b.facing)}` : "Vastu: not wanted.",
    "",
    "Rooms to place (choose front, middle or back for each):",
    ...f.decide.map((list, i) => {
      const big = list.filter((n) => !SMALL_DECIDED.test(n));
      const attached = attachments(f, i);
      return `${FLOOR_KEYS[i]}: ${list.join(", ")}\n  big rooms: ${big.length}, at most ${f.capacity} in any band${attached.length ? `\n  Spacify adds: ${attached.join("; ")}` : ""}`;
    }),
    "",
  ];
  if (b.notes?.trim()) {
    lines.push(`The visitor wrote: "${b.notes.trim().replace(/"/g, "'")}"`);
    lines.push(wishes.length ? `Understood as: ${wishes.map((k) => PREF_TEXT[k].toLowerCase()).join("; ")}.` : "Nothing in it changes the layout.");
    if (unmet.length) lines.push(`Can't be drawn (ignore): ${unmet.join(", ")}.`);
  } else lines.push("The visitor wrote nothing, so there are no wishes beyond the rooms.");
  lines.push("", direction);
  return lines.join("\n");
}

const DIRECTIONS = {
  best: "Give the arrangement you think is best for this plot and this family.",
  kitchenFront: "Direction for this arrangement: put the Kitchen in the front band beside the Living Room, so it's near the entrance.",
  masterFront: "Direction for this arrangement: put the Master Bedroom and its bathroom in the front band beside the Living Room.",
  diningFront: "Direction for this arrangement: put the Dining Room in the front band with the Living Room, and the Kitchen in the middle band.",
  bedMiddle: "Direction for this arrangement: put one bedroom with its bathroom in the middle band, the other bedrooms in the back band.",
  serviceBack: "Direction for this arrangement: put the Dining Room and Kitchen in the back band, and the bedrooms in the middle band.",
  oneRow: "Direction for this arrangement: put every ground-floor room in the front band, in one row.",
};
type Direction = keyof typeof DIRECTIONS;

/** Two directions for the second and third ideas, chosen so they differ from the first. */
function nextDirections(f: Facts, first: IdeaReply): Direction[] {
  const g = first.ground;
  const groundBeds = f.rooms[0].filter((r) => /Bedroom/.test(r));
  const out: Direction[] = [];
  const add = (d: Direction, ok: boolean) => {
    if (ok && !out.includes(d)) out.push(d);
  };
  add("oneRow", f.bl < 32 && Object.values(g).some((v) => v !== "front"));
  add("kitchenFront", g["Kitchen"] !== "front");
  add("masterFront", g["Master Bedroom"] !== "front" && f.bw >= 30 && !f.prefs.quietBedrooms);
  add("bedMiddle", groundBeds.length >= 2 && !groundBeds.some((r) => g[r] === "middle"));
  add("diningFront", !!g["Dining Room"] && g["Dining Room"] !== "front" && f.bw >= 30);
  add("serviceBack", g["Kitchen"] !== "back" && f.bl >= 30);
  add("kitchenFront", true);
  add("diningFront", true);
  return out.slice(0, 2);
}

const hardOf = (o: PlanOption) => o.violations.filter((v) => v.severity === "hard");

/** Which room each attached room goes with, on one floor (what fullBands() follows). */
function owners(f: Facts, fl: number): Record<string, string> {
  const list = f.rooms[fl];
  const out: Record<string, string> = {};
  const beds = list.filter((r) => /Bedroom/.test(r));
  const has = (r: string) => list.includes(r);
  list.filter((r) => /^Bathroom( \d)?$/.test(r)).forEach((b, i) => {
    out[b] = beds[i] ?? (has("Dining Room") ? "Dining Room" : has("Living Room") ? "Living Room" : beds[0] ?? "");
  });
  for (const r of list.filter((r) => /^(Store|Utility)$/.test(r))) out[r] = has("Kitchen") ? "Kitchen" : "";
  for (const r of list.filter((r) => /^Walk-in Closet/.test(r))) out[r] = has("Master Bedroom") ? "Master Bedroom" : beds[0] ?? "";
  for (const r of list.filter((r) => /^Balcony/.test(r))) out[r] = fl === 0 && has("Living Room") ? "Living Room" : "";
  return out;
}

/** "Bathroom 1 (with Master Bedroom)", for the prompt. */
function attachments(f: Facts, fl: number): string[] {
  return Object.entries(owners(f, fl)).map(([r, o]) => (o ? `${r} (with ${o})` : `${r} (${/Balcony/.test(r) ? "front band" : "back band"})`));
}

/** Every room's band on every floor: the model's choices, and the attached rooms following their owners. */
function fullBands(f: Facts, reply: IdeaReply): Record<string, Band>[] {
  return f.rooms.map((list, fl) => {
    const chosen = reply[FLOOR_KEYS[fl]] ?? {};
    const out: Record<string, Band> = {};
    for (const r of f.decide[fl]) out[r] = chosen[r] ?? usualBand(r, fl);
    for (const [r, owner] of Object.entries(owners(f, fl))) {
      const at = owner ? out[owner] : undefined;
      // A balcony needs an outside wall, so never the middle band
      out[r] = /^Balcony/.test(r) ? (at === "back" ? "back" : "front") : at ?? usualBand(r, fl);
    }
    return out;
  });
}

/** The band a room ends up in. */
function bandOf(f: Facts, reply: IdeaReply, floor: number, room: string): Band | undefined {
  return fullBands(f, reply)[floor]?.[room];
}

/** A concrete change to try for one rule break, worked out from where the model put things. */
function fixFor(v: Violation, reply: IdeaReply, f: Facts): string {
  const floorOf = (r: string) => Math.max(0, f.rooms.findIndex((list) => list.includes(r)));
  // Speak about the rooms the model placed: a bathroom's fix is its bedroom's move
  const placed = (r: string) => owners(f, floorOf(r))[r] || r;
  const room = placed(v.rooms[0] ?? "");
  const big = (b: Band, fl: number) => f.decide[fl].filter((r) => bandOf(f, reply, fl, r) === b && !SMALL_DECIDED.test(r)).length;
  switch (v.rule) {
    case "min-size":
    case "proportion": {
      const fl = floorOf(room);
      const at = bandOf(f, reply, fl, room);
      if (!at) return "Spread the big rooms more evenly between the bands.";
      const free = BANDS.filter((b) => b !== at).sort((a, b) => big(a, fl) - big(b, fl))[0];
      return `The ${at} band has ${big(at, fl)} big rooms for a capacity of ${f.capacity}: move ${room} to the ${free} band.`;
    }
    case "wet-pair":
      return `Move ${placed(v.rooms[1] ?? "") || room} to another band, so its bathroom isn't next to the other one.`;
    case "kitchen-wet":
      return `Keep ${placed(v.rooms[1] ?? "") || "that bedroom"} out of the kitchen's band.`;
    case "pooja-wet":
      return "Move the Pooja Room to the Living Room's band, away from the bedrooms.";
    case "entrance":
      return "Put the Living Room in the front band.";
    case "bed-access":
    case "bath-access":
      return `Move ${room} to the back band, where the passage runs in front of it, or into the Living or Dining Room's band.`;
    case "dead-passage":
      return "Keep the Living Room and Dining Room in the front and middle bands, so the passage connects to them.";
    case "open-air":
      return "Put the Balcony in the front or back band.";
    default:
      return RULE_TEXT[v.rule];
  }
}

function feedback(o: PlanOption, reply: IdeaReply, f: Facts): string {
  const lines = [
    ...hardOf(o).map((v) => `- ${v.rule}: ${v.message}. Fix: ${fixFor(v, reply, f)}`),
    ...o.prefsMissed.map((k) => `- the visitor's wish isn't met: ${PREF_TEXT[k].toLowerCase()}.`),
  ];
  return `Spacify drew this arrangement and it breaks these rules:\n${[...new Set(lines)].join("\n")}\n\nAnswer again with a corrected arrangement that applies every fix. Change the bands of the rooms named above; keep the rest.`;
}

/** A short name for an arrangement, from where its main rooms are (two traits when it has them). */
function nameFor(c: Concept): string {
  const g = c.floors[0] ?? [];
  const at = (re: RegExp) => g.findIndex((b) => b.some((r) => re.test(r)));
  const used = g.filter((b) => b.length).length;
  const kitchen = at(/^Kitchen$/);
  const master = at(/^Master Bedroom$/);
  const bedFront = g[0]?.some((r) => /^Bedroom \d$/.test(r));
  let name = "Living in front, bedrooms behind";
  if (used === 1) name = "All in one row";
  else if (kitchen === 0 && master === 0) name = "Kitchen and master bedroom up front";
  else if (kitchen === 0 && bedFront) name = "Kitchen and a bedroom up front";
  else if (kitchen === 0) name = "Kitchen by the entrance";
  else if (master === 0) name = "Master bedroom at the front";
  else if (kitchen === 2) name = "Kitchen at the back";
  else if (g[1]?.some((r) => /Bedroom/.test(r))) name = "Bedrooms in the middle and back";
  return `${name}${c.circulation === "side" ? ", side corridor" : c.circulation === "none" ? ", no corridor" : ""}`;
}

/** A plain description of an arrangement, from its bands (ground floor). */
function describe(c: Concept): string {
  const names = ["Front", "Middle", "Back"];
  const short = (label: string) => label.replace(/ \d+$/, "").replace(" Room", "").toLowerCase();
  const bands = (c.floors[0] ?? []).map((b, i) => (b.length ? `${names[i]}: ${[...new Set(b.map(short))].join(", ")}` : "")).filter(Boolean);
  const move = { across: " A passage runs across the house to the bedrooms.", side: " A corridor runs down one side to every room.", none: " No corridor: rooms open off the living and dining." }[c.circulation];
  return `${bands.join(". ")}.${move}`;
}

function toConcept(f: Facts, reply: IdeaReply, id: string, circulation: Circulation, mirror: boolean): Concept {
  const c = conceptFromBands(f.brief, f.prefs, fullBands(f, reply), { id, name: "", why: "", circulation, mirror });
  return { ...c, name: nameFor(c), why: describe(c) };
}

/** The model's bands drawn every way round and with each circulation; the best drawing is kept. */
function drawBest(f: Facts, reply: IdeaReply, id: string): { concept: Concept; option: PlanOption } {
  let best: { concept: Concept; option: PlanOption } | null = null;
  for (const circulation of CIRCULATIONS) {
    for (const mirror of [false, true]) {
      const concept = toConcept(f, reply, id, circulation, mirror);
      const option = realize(f.brief, concept, f.prefs);
      const hard = hardOf(option).length;
      if (!best || hard < hardOf(best.option).length || (hard === hardOf(best.option).length && option.score > best.option.score)) best = { concept, option };
    }
  }
  return best!;
}

type Idea = { direction: Direction; reply: IdeaReply; raw: string; concept: Concept; option: PlanOption; messages: Message[] };
type Drawn = { reply: IdeaReply; concept: Concept; option: PlanOption };

const better = (a: PlanOption, b: PlanOption) => hardOf(a).length < hardOf(b).length || (hardOf(a).length === hardOf(b).length && a.score > b.score);

/**
 * Small corrections the code can make itself before asking the model again, each one a move the review round would
 * suggest: a room named in a rule break moved to another band (a bedroom with its bathroom), the living room to the
 * road, a big room out of a band over capacity. Every candidate is drawn; the cleanest wins, for up to two rounds.
 */
function codeFix(f: Facts, start: Drawn, id: string): Drawn {
  let cur = start;
  const floorOf = (room: string) => f.rooms.findIndex((list) => list.includes(room));
  for (let round = 0; round < 2 && hardOf(cur.option).length; round++) {
    const reply = cur.reply;
    const bands = fullBands(f, reply);
    const tries: IdeaReply[] = [];
    const move = (fl: number, room: string, to: Band) => {
      const next = JSON.parse(JSON.stringify(reply)) as IdeaReply;
      const key = FLOOR_KEYS[fl];
      next[key] = { ...(next[key] ?? {}), [room]: to };
      tries.push(next);
    };
    if (bands[0]["Living Room"] && bands[0]["Living Room"] !== "front") move(0, "Living Room", "front");
    for (const v of hardOf(cur.option)) {
      for (const named of v.rooms) {
        const fl = floorOf(named);
        if (fl < 0) continue;
        // An attached room moves by moving what it's attached to
        const room = owners(f, fl)[named] || named;
        if (!f.decide[fl].includes(room) || (fl === 0 && room === "Living Room")) continue;
        for (const to of BANDS) if (to !== bands[fl][room]) move(fl, room, to);
      }
    }
    f.decide.forEach((list, fl) => {
      for (const b of BANDS) {
        const big = list.filter((r) => bands[fl][r] === b && !SMALL_DECIDED.test(r));
        if (big.length <= f.capacity) continue;
        for (const r of big) if (!(fl === 0 && r === "Living Room")) for (const to of BANDS) if (to !== b) move(fl, r, to);
      }
    });
    let best = cur;
    for (const t of tries.slice(0, 30)) {
      const d = drawBest(f, t, id);
      if (better(d.option, best.option)) best = { reply: t, ...d };
    }
    if (best === cur) break;
    cur = best;
  }
  return cur;
}

/**
 * The visitor's wishes, and three arrangement ideas from the model after one review round each. Never throws:
 * without Ollama, the keyword reading of the notes still comes back and the rule templates carry the plans.
 */
export async function planWithAi(brief: PlanBrief): Promise<AiPlan> {
  const { model, timeoutMs } = settings();
  const deadline = Date.now() + timeoutMs;
  const notes = await understand(brief.notes, deadline);
  const { prefs, unmet } = notes;
  const f = facts(brief, prefs);
  const schema = ideaSchema(f.decide);
  const system: Message = { role: "system", content: planningSkill() };
  const diag: AiDiag = { model, ms: { notes: notes.ms, ideas: [], review: [] }, ideas: [], hardBefore: 0, hardAfter: 0, notesByModel: notes.used, raw: [] };

  async function propose(direction: Direction, i: number): Promise<Idea | ChatFail | null> {
    const messages: Message[] = [system, { role: "user", content: ideaPrompt(f, unmet, DIRECTIONS[direction]) }];
    const r = await chat(messages, schema, { temperature: i === 0 ? 0.3 : 0.5, num_predict: 400 }, deadline);
    if (!r.ok) return r;
    diag.ms.ideas.push(r.ms);
    diag.raw.push(r.content);
    try {
      const reply = IdeaReply.parse(JSON.parse(r.content));
      return { direction, reply, raw: r.content, ...drawBest(f, reply, `ai-${i + 1}`), messages };
    } catch {
      return null;
    }
  }

  const first = await propose("best", 0);
  if (!first) return { concepts: [], prefs, unmet, status: "failed", note: "The local model's answer wasn't usable.", diag };
  if ("ok" in first) return { concepts: [], prefs, unmet, status: first.status, note: first.note, diag };
  const ideas: Idea[] = [first];
  // On a slow machine, fewer ideas and time left to fix them beats three ideas and no review.
  const more = diag.ms.ideas[0] > 30_000 ? 1 : 2;
  for (const [k, d] of nextDirections(f, first.reply).slice(0, more).entries()) {
    if (deadline - Date.now() < 15_000) break;
    const idea = await propose(d, k + 1);
    if (idea && !("ok" in idea)) ideas.push(idea);
  }

  for (const idea of ideas) {
    const before = hardOf(idea.option).map((v) => v.rule);
    const drawn = `${idea.concept.circulation}${idea.concept.mirror ? ", mirrored" : ""}`;
    const record = { direction: idea.direction, think: idea.reply.think, drawn, before, afterCode: null as string[] | null, after: null as string[] | null };
    diag.ideas.push(record);
    diag.hardBefore += before.length;
    if (!before.length && !idea.option.prefsMissed.length) continue;
    // First the code's own small fixes (instant), then, if anything is still broken, the model's review.
    if (before.length) {
      const fixed = codeFix(f, idea, idea.concept.id);
      record.afterCode = hardOf(fixed.option).map((v) => v.rule);
      if (fixed !== (idea as Drawn)) Object.assign(idea, { reply: fixed.reply, concept: fixed.concept, option: fixed.option });
    }
    if ((!hardOf(idea.option).length && !idea.option.prefsMissed.length) || deadline - Date.now() < 12_000) continue;
    const r = await chat(
      [...idea.messages, { role: "assistant", content: JSON.stringify(idea.reply) }, { role: "user", content: feedback(idea.option, idea.reply, f) }],
      schema,
      { temperature: 0.4, num_predict: 400 },
      deadline
    );
    if (!r.ok) continue;
    diag.ms.review.push(r.ms);
    diag.raw.push(r.content);
    try {
      const reply = IdeaReply.parse(JSON.parse(r.content));
      const redrawn = codeFix(f, { reply, ...drawBest(f, reply, idea.concept.id) }, idea.concept.id);
      record.after = hardOf(redrawn.option).map((v) => v.rule);
      if (better(redrawn.option, idea.option)) Object.assign(idea, { reply: redrawn.reply, raw: r.content, concept: redrawn.concept, option: redrawn.option });
    } catch {
      // A broken second answer just means the first stands
    }
  }
  diag.hardAfter = ideas.reduce((s, i) => s + hardOf(i.option).length, 0);
  return { concepts: ideas.map((i) => i.concept), prefs, unmet, status: "used", diag };
}

/** The visitor's wishes as sentences, for the "Understood" line. */
export function understoodText(prefs: Prefs): string[] {
  return (Object.keys(prefs) as PrefKey[]).filter((k) => prefs[k]).map((k) => PREF_TEXT[k]);
}

/** Loads the model into memory ahead of time, with the guide already read, so the first plan doesn't wait. Never throws. */
export async function warmPlanModel(): Promise<boolean> {
  const { url, model } = settings();
  try {
    const res = await fetch(`${url}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: planningSkill() },
          { role: "user", content: "Ready?" },
        ],
        stream: false,
        keep_alive: "15m",
        options: { num_ctx: 4096, num_predict: 1 },
      }),
      signal: AbortSignal.timeout(60_000),
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}
