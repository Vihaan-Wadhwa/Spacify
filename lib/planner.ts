// Plan options for a plot: lay out rooms inside the buildable area, score each layout, keep the best few.
//
// Every layout starts from a "concept": which rooms go in which band across the plot, front (road side) to back,
// and how people move through it (a passage across the house, a corridor down one side, or neither). A rule
// template here or the local AI model (lib/server/planAi.ts) chooses the concept; this file does all the geometry,
// so whatever the source, rooms never overlap and the house always fits the plot.
//
// Each band is laid by search: rooms are grouped into columns (a bedroom with its bathroom tucked into one end, the
// kitchen with its store, the pooja room beside the living room), every grouping is drawn, and the one that breaks
// the fewest rules wins. The rules are lib/planRules.ts (the same rulebook the model's guide teaches), and the
// visitor's own wishes (lib/planNotes.ts) count in the final score.
//
// Pure functions, shared by the browser and POST /api/plans.

import { z } from "zod";
import { MAX_FLOORS } from "@/lib/rooms";
import { EXTRA_ROOMS, EXTRA_MAX, HOME_TYPES, assignFloors, bathroomsFor, defaultSize, roomNames, type PlanRoom } from "@/lib/start";
import { PREF_TEXT, type PrefKey, type Prefs } from "@/lib/planNotes";
import { checkLayout, isBath, isBed, maxAspect, minSide, onRoadSide, shared, type PlacedRoom, type Rect, type Violation } from "@/lib/planRules";

export const FACINGS = ["north", "east", "south", "west"] as const;
export type Facing = (typeof FACINGS)[number];

export const PLOT = { min: 15, maxWidth: 150, maxDepth: 250 };
export const SETBACK_MAX = 30;
export const NOTES_MAX = 500;

export const DEFAULT_SETBACKS = { front: 5, rear: 3, left: 2, right: 2 };

export const PlanBrief = z.object({
  homeType: z.enum(HOME_TYPES),
  bhk: z.number().int().min(1).max(4),
  floors: z.number().int().min(1).max(MAX_FLOORS),
  extras: z.partialRecord(z.enum(EXTRA_ROOMS), z.number().int().min(0).max(EXTRA_MAX)),
  /** feet along the road */
  width: z.number().min(PLOT.min).max(PLOT.maxWidth),
  /** feet from the road to the back */
  depth: z.number().min(PLOT.min).max(PLOT.maxDepth),
  /** the side the road (and the main entrance) is on */
  facing: z.enum(FACINGS),
  setbacks: z.object({
    front: z.number().min(0).max(SETBACK_MAX),
    rear: z.number().min(0).max(SETBACK_MAX),
    left: z.number().min(0).max(SETBACK_MAX),
    right: z.number().min(0).max(SETBACK_MAX),
  }),
  vastu: z.boolean(),
  /** what the visitor wrote in their own words */
  notes: z.string().max(NOTES_MAX).optional(),
});
export type PlanBrief = z.infer<typeof PlanBrief>;

/** How people move through a floor: a passage across the house, a corridor down one side, or straight from room to room. */
export type Circulation = "across" | "side" | "none";

/** Which rooms go in which band, front (road side) to back, for each floor. */
export type Concept = {
  id: string;
  name: string;
  why: string;
  source: "rules" | "ai";
  floors: string[][][]; // floor → band → room labels, left to right as seen from the road
  circulation: Circulation;
  mirror: boolean;
};

export type ScorePart = { key: string; label: string; value: number };

export type PlanOption = {
  id: string;
  name: string;
  why: string;
  source: "rules" | "ai";
  score: number;
  parts: ScorePart[];
  highlights: string[];
  watch: string[];
  violations: Violation[];
  prefsMet: PrefKey[];
  prefsMissed: PrefKey[];
  rooms: PlanRoom[];
  plot: { width: number; depth: number; facing: Facing };
  /** the plot in plan coordinates (x east, z south), for drawing */
  plotRect: { x: number; z: number; w: number; l: number };
  /** the house's outline (the buildable area, or less of it when the rooms don't need it all) */
  buildable: { x: number; z: number; w: number; l: number };
  builtUp: number;
};

const PASSAGE = 3.5;
const STAIR = { w: 7, l: 12 };
const TERRACE = "Open Terrace";

/** Default sizes for rooms the start flow's list doesn't have. */
const EXTRA_SIZES: Record<string, [number, number]> = { "Car Parking": [10, 17], Utility: [6, 5], Dressing: [5, 6] };
const sizeOf = (name: string): [number, number] => EXTRA_SIZES[name] ?? defaultSize(name);

/**
 * A room label's plain name: "Bathroom 2" → "Bathroom", "Bedroom 2" stays (it's a real room name). An "|area" suffix
 * is an area override; a "~" suffix marks the leftover piece of a column (a dressing area, a lobby).
 */
const baseName = (label: string) => (/^Bedroom \d$/.test(label) ? label : label.replace(/[|~].*$/, "").replace(/ \d+$/, ""));
const isBathLabel = (label: string) => isBath(baseName(label));
const isBedLabel = (label: string) => isBed(baseName(label));
const isFiller = (label: string) => label.endsWith("~");

/** Per-layout size overrides (a bigger living room when asked for); set by realize() for the one synchronous run. */
let AREA_OVERRIDE: Record<string, number> = {};
/** How much bigger than standard every room is drawn, when the plot has the space (set by realize() too). */
let AREA_SCALE = 1;

// ─── Rooms for a brief ──────────────────────────────────────

/** The brief as the visitor's wishes change it: a study to work from, enough bathrooms for attached baths, Vastu on or off. */
export function applyPrefs(brief: PlanBrief, prefs: Prefs = {}): PlanBrief {
  const extras = { ...brief.extras };
  if (prefs.homeOffice) extras.Study = Math.max(1, extras.Study ?? 0);
  if (prefs.attachedBaths) {
    const need = brief.bhk - bathroomsFor(brief.bhk) - (extras.Bathroom ?? 0);
    if (need > 0) extras.Bathroom = Math.min(EXTRA_MAX, (extras.Bathroom ?? 0) + need);
  }
  const vastu = prefs.noVastu ? false : prefs.vastu ? true : brief.vastu;
  return { ...brief, extras, vastu };
}

/** The brief's rooms per floor, with duplicates numbered ("Bathroom 1", "Bathroom 2") so each has a label. */
export function floorRooms(b: Pick<PlanBrief, "bhk" | "extras" | "floors" | "homeType">, prefs: Prefs = {}): string[][] {
  const floors = b.homeType === "apartment" ? 1 : b.floors;
  const assigned = assignFloors(roomNames({ bhk: b.bhk, extras: b.extras }), floors).filter((r) => r.name !== "Staircase");
  if (prefs.parking && b.homeType !== "apartment") assigned.push({ name: "Car Parking", floor: 1 });
  if (prefs.utility) assigned.push({ name: "Utility", floor: 1 });
  const out: string[][] = Array.from({ length: floors }, () => []);
  const count: Record<string, number> = {};
  const total: Record<string, number> = {};
  for (const r of assigned) total[r.name] = (total[r.name] ?? 0) + 1;
  for (const r of assigned) {
    count[r.name] = (count[r.name] ?? 0) + 1;
    out[r.floor - 1].push(total[r.name] > 1 ? `${r.name} ${count[r.name]}` : r.name);
  }
  return out;
}

/** The least floor area each kind of room can be drawn in, sq ft (its minimum width, not much longer). */
function leastArea(name: string): number {
  const side = minSide(name);
  if (name === "Car Parking") return 9.5 * 15;
  if (/^(Bathroom|Pooja Room|Store|Utility|Walk-in Closet|Balcony)$/.test(name)) return side * 5;
  return side * side * 1.1;
}

/**
 * Why a brief can't be planned at all, in words for the visitor, or null when it can: the rooms on one floor need
 * more space, even at their smallest, than the buildable area has.
 */
export function briefProblem(brief: PlanBrief, prefs: Prefs = {}): string | null {
  const b = applyPrefs(brief, prefs);
  const sb = b.homeType === "apartment" ? { front: 0, rear: 0, left: 0, right: 0 } : b.setbacks;
  const bw = b.width - sb.left - sb.right;
  const bl = b.depth - sb.front - sb.rear;
  if (bw < 8 || bl < 8) return `After the setbacks, only ${Math.max(0, bw)} × ${Math.max(0, bl)} ft is left to build on. Reduce the setbacks or check the plot size.`;
  const floors = floorRooms(b, prefs);
  const stair = floors.length > 1 ? STAIR.w * STAIR.l : 0;
  // Walls, a passage and the odd leftover corner take about a fifth more than the rooms themselves
  const need = Math.max(...floors.map((f) => f.reduce((s, n) => s + leastArea(baseName(n)), 0) * 1.1 + stair)) * 1.2;
  if (need <= bw * bl) return null;
  const more = b.homeType !== "apartment" && b.floors < MAX_FLOORS ? "add a floor, " : "";
  return `The rooms on one floor need at least ${Math.round(need / 10) * 10} sq ft even at their smallest, and the buildable area is ${Math.round(bw * bl)} sq ft (${bw} × ${bl} ft). Try fewer rooms, ${more}smaller setbacks or a bigger plot.`;
}

// ─── Rule templates ─────────────────────────────────────────

/** Bedrooms with a bathroom after each, master first; extra bathrooms go between other rooms, never two together. */
function bedsWithBaths(rooms: string[]) {
  const beds = rooms.filter(isBedLabel);
  const baths = rooms.filter(isBathLabel);
  const out: string[] = [];
  beds.forEach((b, i) => {
    out.push(b);
    if (baths[i]) out.push(baths[i]);
  });
  const rest = baths.slice(beds.length);
  const others = rooms.filter((r) => /Study|Walk-in/.test(r));
  // Leftover bathrooms go between rooms, never next to each other: after the study or closet where there is one,
  // otherwise before a bedroom (whose own bathroom then goes to its far side), then at the end.
  for (const b of rest) {
    const o = others.shift();
    if (o) out.push(o, b);
    else {
      const slots = out.map((n, i) => i).filter((i) => isBedLabel(out[i]) && !isBathLabel(out[i - 1] ?? "") && (i === 0 || !isBathLabel(out[i - 2] ?? "") || isBedLabel(out[i - 1])));
      const at = slots.find((i) => !isBathLabel(out[i - 1] ?? ""));
      if (at !== undefined && !isBathLabel(out[at - 1] ?? "")) out.splice(at, 0, b);
      else out.push(b);
    }
  }
  return [...out, ...others];
}

const pick = (rooms: string[], re: RegExp) => rooms.filter((r) => re.test(r));
const PARK = /Car Parking/;
const SERVICE = /Kitchen|Store|Utility/;

type Template = { id: string; name: string; why: string; bands: (rooms: string[], floor: number) => string[][] };

const TEMPLATES: Template[] = [
  {
    id: "classic",
    name: "Living in front, bedrooms at the back",
    why: "Guests stay at the road side; the kitchen and dining sit in the middle, and bedrooms get the quiet rear.",
    bands: (r) => [
      [...pick(r, PARK), ...pick(r, /Living|Pooja|Balcony/)],
      [...pick(r, /Dining/), ...pick(r, SERVICE)],
      bedsWithBaths(r),
    ],
  },
  {
    id: "two-band",
    name: "Open front, private back",
    why: "Living, dining and pooja share one open band facing the road; everything private is in a single row behind it.",
    bands: (r) => [
      [...pick(r, PARK), ...pick(r, /Living|Dining|Pooja|Balcony/), ...pick(r, SERVICE)],
      bedsWithBaths(r),
    ],
  },
  {
    id: "kitchen-front",
    name: "Kitchen up front",
    why: "The kitchen takes a front corner next to the living room, so groceries and guests come in the same way and the back stays calm.",
    bands: (r) => {
      const baths = r.filter(isBathLabel);
      const common = baths.length > r.filter(isBedLabel).length ? [baths[baths.length - 1]] : [];
      return [
        [...pick(r, PARK), ...pick(r, /Living|Balcony/), ...pick(r, SERVICE)],
        [...pick(r, /Dining/), ...common, ...pick(r, /Pooja/)],
        bedsWithBaths(r.filter((x) => !common.includes(x))),
      ];
    },
  },
  {
    id: "master-front",
    name: "Master bedroom at the front",
    why: "On a wide plot the master bedroom can sit beside the living room, leaving the back for the children's rooms.",
    bands: (r) => {
      const master = pick(r, /Master/);
      const baths = r.filter(isBathLabel);
      const masterBath = master.length && baths.length ? [baths[0]] : [];
      const rest = r.filter((x) => !master.includes(x) && !masterBath.includes(x));
      return [
        [...pick(rest, PARK), ...pick(rest, /Living|Balcony/), ...master, ...masterBath],
        [...pick(rest, /Dining/), ...pick(rest, SERVICE), ...pick(rest, /Pooja/)],
        bedsWithBaths(rest),
      ];
    },
  },
  {
    id: "split-bedrooms",
    name: "Children's room up front, master at the back",
    why: "Parents and children get rooms at opposite ends of the house, with the kitchen and dining between them.",
    bands: (r) => {
      const beds = r.filter(isBedLabel);
      const baths = r.filter(isBathLabel);
      const front = beds.length > 1 ? [beds[1], ...(baths[1] ? [baths[1]] : [])] : [];
      const rest = r.filter((x) => !front.includes(x));
      return [
        [...pick(rest, PARK), ...pick(rest, /Living|Pooja|Balcony/), ...front],
        [...pick(rest, /Dining/), ...pick(rest, SERVICE)],
        bedsWithBaths(rest),
      ];
    },
  },
  {
    id: "service-side",
    name: "Kitchen and dining down one side",
    why: "Kitchen, dining and utility run down one side of the house; living at the front, bedrooms at the back.",
    bands: (r) => [
      [...pick(r, PARK), ...pick(r, /Living|Balcony/), ...pick(r, /Kitchen/)],
      [...pick(r, /Pooja/), ...pick(r, /Dining/), ...pick(r, /Store|Utility/)],
      bedsWithBaths(r),
    ],
  },
  {
    id: "dining-heart",
    name: "Dining at the heart",
    why: "The dining room sits in the middle of the house with bedrooms either side, so every room opens off the family's main space.",
    bands: (r) => {
      const beds = bedsWithBaths(r);
      const half = Math.ceil(beds.length / 2);
      return [
        [...pick(r, PARK), ...pick(r, /Living|Pooja|Balcony/)],
        [beds.slice(0, half), pick(r, /Dining/), beds.slice(half)].flat(),
        [...pick(r, SERVICE)],
      ];
    },
  },
  {
    id: "one-row",
    name: "Everything on one level row",
    why: "For wide, shallow plots: every room sits side by side facing the road, the bedrooms at one end and the living room at the other.",
    bands: (r) => [[...bedsWithBaths(r).reverse(), ...pick(r, /Dining/), ...pick(r, SERVICE), ...pick(r, /Pooja/), ...pick(r, /Living|Balcony/), ...pick(r, PARK)]],
  },
  {
    id: "deep-row",
    name: "Rooms one behind another",
    why: "For long, narrow plots: rooms follow one another from the road to the back, each the full width that's left beside the corridor.",
    bands: (r) => {
      const bands: string[][] = [[...pick(r, PARK)], pick(r, /Living|Balcony/), pick(r, /Pooja|Dining/), pick(r, SERVICE)];
      const pairs = bedsWithBaths(r);
      for (let i = 0; i < pairs.length; i += 2) bands.push(pairs.slice(i, i + 2));
      return bands;
    },
  },
];

const CIRCULATION_NOTE: Record<Circulation, string> = {
  across: "",
  side: " A corridor down one side reaches every room.",
  none: " No corridor: rooms open off the living and dining rooms, so nothing is lost to passages.",
};

export function ruleConcepts(brief: PlanBrief, prefs: Prefs = {}): Concept[] {
  const rooms = floorRooms(brief, prefs);
  const out: Concept[] = [];
  for (const t of TEMPLATES) {
    for (const circulation of ["across", "side", "none"] as const) {
      for (const mirror of [false, true]) {
        out.push(
          repairConcept(
            brief,
            {
              id: `${t.id}-${circulation}${mirror ? "-m" : ""}`,
              name: t.name,
              why: t.why + CIRCULATION_NOTE[circulation],
              source: "rules",
              floors: rooms.map((r, i) => t.bands(r, i + 1)),
              circulation,
              mirror,
            },
            prefs
          )
        );
      }
    }
  }
  return out;
}

// ─── Geometry helpers ───────────────────────────────────────

const round05 = (v: number) => Math.round(v * 2) / 2;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Rooms that tuck into a strip at one end of a column rather than taking a column of their own. */
const SMALL = /^(Bathroom|Pooja Room|Store|Walk-in Closet|Utility|Balcony)$/;
const isSmall = (label: string) => SMALL.test(baseName(label));
/** How deep the strip is for each small room, ft. */
const STRIP: Record<string, number> = { Bathroom: 6, "Walk-in Closet": 6, "Pooja Room": 5, Store: 5, Utility: 5, Balcony: 5 };

const roomArea = (label: string) => {
  if (label.includes("|")) return Number(label.split("|")[1].replace("~", ""));
  const name = baseName(label);
  if (AREA_OVERRIDE[name]) return AREA_OVERRIDE[name] * AREA_SCALE;
  const [w, l] = sizeOf(name);
  return w * l * AREA_SCALE;
};
const minW = (label: string) => minSide(baseName(label));
const aspectOf = (label: string) => maxAspect(baseName(label));

/** What the rest of a column's strip becomes, beside its small rooms. */
function fillerFor(big: string): string {
  const n = baseName(big);
  if (isBed(n)) return "Dressing~";
  if (n === "Kitchen") return "Utility~";
  if (n === "Study") return "Store~";
  if (n === TERRACE) return `${TERRACE}~`;
  return "Passage~";
}

type Placed = { label: string; r: Rect };

/** Splits `total` in proportion to `weights`, but never gives a part less than its minimum (if the minimums don't fit, they shrink together). */
function share(total: number, weights: number[], mins: number[]): number[] {
  const n = weights.length;
  const minSum = mins.reduce((s, m) => s + m, 0);
  if (!n) return [];
  if (minSum >= total) return mins.map((m) => (m / (minSum || 1)) * total);
  const out = new Array<number>(n).fill(0);
  const fixed = new Array<boolean>(n).fill(false);
  for (let pass = 0; pass <= n; pass++) {
    const left = total - out.reduce((s, v, i) => s + (fixed[i] ? v : 0), 0);
    const wsum = weights.reduce((s, w, i) => s + (fixed[i] ? 0 : Math.max(w, 0.01)), 0);
    let clamped = false;
    for (let i = 0; i < n; i++) {
      if (fixed[i]) continue;
      out[i] = (Math.max(weights[i], 0.01) / wsum) * left;
      if (out[i] < mins[i]) {
        out[i] = mins[i];
        fixed[i] = true;
        clamped = true;
      }
    }
    if (!clamped) break;
  }
  return out;
}

/** Consecutive pieces of these sizes from `start`, snapped to a 0.5 ft grid; the last piece ends exactly at start + total. */
function cuts(start: number, sizes: number[], total: number): [number, number][] {
  const out: [number, number][] = [];
  let acc = 0;
  let prev = start;
  sizes.forEach((size, i) => {
    acc += size;
    const end = i === sizes.length - 1 ? start + total : start + round05(acc);
    out.push([prev, end - prev]);
    prev = end;
  });
  return out;
}

// ─── One band of rooms ──────────────────────────────────────
//
// A band is laid in its own frame: u runs along the band (left to right as seen from the road), v runs into it
// (0 at the edge nearer the road). The context says which of its four edges are outside walls, which open onto
// somewhere people walk (a passage, the stairs, the living room in the next band), and whether the near edge is
// the road, where the main door is.

type Edge = "near" | "far" | "left" | "right";
const EDGES: Edge[] = ["near", "far", "left", "right"];
/** Stretches of an edge, [from, to] along it; a whole edge is [[0, Infinity]]. */
type Spans = [number, number][];
const ALL: Spans = [[0, Infinity]];
type Ctx = { hub: Record<Edge, Spans>; out: Record<Edge, boolean>; road: boolean };
type Local = { label: string; u: number; v: number; du: number; dv: number };
type RowResult = { rooms: Local[]; cost: number };

const EPS = 0.05;
const HUB_ROOM = /^(Living Room|Dining Room|Passage|Staircase)$/;

function sharedL(a: Local, b: Local): number {
  const ov = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
  if (Math.abs(a.u + a.du - b.u) < EPS || Math.abs(b.u + b.du - a.u) < EPS) return ov(a.v, a.v + a.dv, b.v, b.v + b.dv);
  if (Math.abs(a.v + a.dv - b.v) < EPS || Math.abs(b.v + b.dv - a.v) < EPS) return ov(a.u, a.u + a.du, b.u, b.u + b.du);
  return 0;
}

/** How much of a room's side lies along a band edge (within `spans` of it, when given). */
function edgeLen(r: Local, e: Edge, span: number, depth: number, spans: Spans = ALL): number {
  const along = (a0: number, a1: number) => spans.reduce((s, [b0, b1]) => s + Math.max(0, Math.min(a1, b1) - Math.max(a0, b0)), 0);
  switch (e) {
    case "near":
      return r.v < EPS ? along(r.u, r.u + r.du) : 0;
    case "far":
      return Math.abs(r.v + r.dv - depth) < EPS ? along(r.u, r.u + r.du) : 0;
    case "left":
      return r.u < EPS ? along(r.v, r.v + r.dv) : 0;
    case "right":
      return Math.abs(r.u + r.du - span) < EPS ? along(r.v, r.v + r.dv) : 0;
  }
}

/**
 * What a band's arrangement costs: 100 for each break of a hard rule (lib/planRules.ts), a little for each soft one,
 * and a little for rooms far from a comfortable size. The same rules as the final check, judged inside the band.
 */
function rowCost(rooms: Local[], span: number, depth: number, ctx: Ctx): number {
  let cost = 0;
  const named = rooms.map((r) => ({ r, n: baseName(r.label) }));
  const hubEdge = (r: Local, min: number) => EDGES.some((e) => ctx.hub[e].length > 0 && edgeLen(r, e, span, depth, ctx.hub[e]) >= min);
  const outside = (r: Local, min = 2) => EDGES.some((e) => ctx.out[e] && edgeLen(r, e, span, depth) >= min);
  const near = (r: Local, test: (n: string) => boolean, min: number) => named.some((o) => o.r !== r && test(o.n) && sharedL(r, o.r) >= min);
  for (const { r, n } of named) {
    const lo = Math.min(r.du, r.dv);
    const hi = Math.max(r.du, r.dv);
    const ms = minSide(n);
    if (lo < ms - 0.01) cost += 100 + 20 * (ms - lo);
    else if (hi / lo > maxAspect(n) + 0.01) cost += 100 + 50 * (hi / lo - maxAspect(n));
    const a = r.du * r.dv;
    if (isFiller(r.label)) cost += a * 0.04;
    else if (isSmall(r.label)) cost += Math.max(0, a / roomArea(r.label) - 1.6) * 4;
    else cost += (Math.abs(a - roomArea(r.label)) / roomArea(r.label)) * 6;

    if (isBed(n) && !hubEdge(r, 3) && !near(r, (m) => HUB_ROOM.test(m), 3)) cost += 100;
    if (isBath(n) && !hubEdge(r, 2.5) && !near(r, (m) => isBed(m) || m === "Dressing" || HUB_ROOM.test(m), 2.5)) cost += 100;
    if (n === "Passage" && !hubEdge(r, 2.5) && !near(r, (m) => /^(Living Room|Dining Room|Passage)$/.test(m), 2.5)) cost += 100;
    if ((n === "Balcony" || n === TERRACE) && !outside(r)) cost += 100;
    if (/Bedroom|Living Room|Kitchen|Dining Room|Study/.test(n) && !outside(r)) cost += 12;
    if (ctx.road && (n === "Living Room" || n === "Car Parking") && edgeLen(r, "near", span, depth) < 3) cost += 100;
    if (ctx.road && isBed(n) && edgeLen(r, "near", span, depth) > 0) cost += 6;
  }
  const baths = named.filter((x) => isBath(x.n));
  for (let i = 0; i < baths.length; i++) {
    for (let j = i + 1; j < baths.length; j++) if (sharedL(baths[i].r, baths[j].r) >= 1.5) cost += 100;
    if (near(baths[i].r, (m) => m === "Kitchen" || m === "Pooja Room", 1.5)) cost += 100;
  }
  const kitchen = named.find((x) => x.n === "Kitchen");
  const dining = named.find((x) => x.n === "Dining Room");
  if (kitchen && dining && sharedL(kitchen.r, dining.r) < 3) cost += 8;
  const beds = named.filter((x) => isBed(x.n));
  for (const b of beds) {
    if (!baths.length) break;
    const attached = baths.some((w) => sharedL(w.r, b.r) >= 2.5) || named.some((d) => d.n === "Dressing" && sharedL(d.r, b.r) >= 2.5 && baths.some((w) => sharedL(w.r, d.r) >= 1.5));
    if (!attached && (b.n === "Master Bedroom" || baths.length >= beds.length)) cost += b.n === "Master Bedroom" ? 10 : 5;
  }
  return cost;
}

type ColSpec = { labels: string[]; bigs: string[]; smalls: string[]; hardMin: number; min: number; target: number };

function stripDepth(smalls: string[], big: string, depth: number): number {
  const pref = Math.max(...smalls.map((n) => STRIP[baseName(n)] ?? 5));
  return clamp(pref, 4.5, Math.max(4.5, depth - minW(big)));
}

function colSpec(labels: string[], depth: number): ColSpec {
  const bigs = labels.filter((n) => !isSmall(n));
  const smalls = labels.filter(isSmall);
  const area = labels.reduce((s, n) => s + roomArea(n), 0);
  let hardMin: number;
  let min: number;
  if (bigs.length === 1 && smalls.length) {
    const sd = stripDepth(smalls, bigs[0], depth);
    hardMin = Math.max(minW(bigs[0]), smalls.reduce((s, n) => s + minW(n), 0));
    min = Math.max(hardMin, (depth - sd) / aspectOf(bigs[0]));
  } else if (bigs.length === 1) {
    hardMin = minW(bigs[0]);
    min = Math.max(hardMin, depth / aspectOf(bigs[0]));
  } else if (bigs.length === 2) {
    hardMin = Math.max(...bigs.map(minW));
    min = hardMin;
  } else {
    // Small rooms on their own: wide enough that each isn't a slot (beyond about 9 ft, a lobby takes the rest of the depth)
    hardMin = Math.max(...smalls.map(minW));
    min = Math.max(hardMin, ...smalls.map((n) => Math.min(depth / smalls.length, 9) / aspectOf(n)), smalls.some(isBathLabel) ? 5 : 0);
  }
  return { labels, bigs, smalls, hardMin, min, target: area / depth };
}

/** The ways a band's rooms can be grouped into columns, in order: each column one or two main rooms, or one main room with up to two small ones. */
function groupings(labels: string[], span: number, depth: number): ColSpec[][] {
  const out: ColSpec[][] = [];
  const rec = (i: number, acc: ColSpec[], used: number) => {
    if (out.length >= 300) return;
    if (i === labels.length) {
      out.push(acc);
      return;
    }
    for (let k = 1; k <= 3 && i + k <= labels.length; k++) {
      const g = labels.slice(i, i + k);
      const bigs = g.filter((n) => !isSmall(n)).length;
      const smalls = k - bigs;
      if (bigs > 2 || smalls > 2 || (bigs === 2 && smalls) || g.filter(isBathLabel).length > 1) continue;
      if (k > 1 && g.some((n) => baseName(n) === "Car Parking")) continue;
      const spec = colSpec(g, depth);
      if (used + spec.hardMin > span + 0.01) continue;
      rec(i + k, [...acc, spec], used + spec.hardMin);
    }
  };
  rec(0, [], 0);
  return out;
}

/** A main room with small rooms in a strip at one end; the rest of the strip becomes a dressing area, a lobby or a utility. */
function stripCol(big: string, smalls: string[], x: number, w: number, depth: number, sd: number, far: boolean, alignLeft: boolean): Local[] {
  const bigL = depth - sd;
  let ws = smalls.map((n) => clamp(roomArea(n) / sd, minW(n), sd * aspectOf(n)));
  const sum = ws.reduce((s, v) => s + v, 0);
  if (sum > w) ws = share(w, ws, smalls.map(minW));
  const total = ws.reduce((s, v) => s + v, 0);
  let filler = w - total;
  if (filler < 4) {
    ws = ws.map((v) => v + (filler * v) / total);
    filler = 0;
  }
  const pieces = [...smalls.map((n, i) => ({ label: n, du: ws[i] })), ...(filler ? [{ label: fillerFor(big), du: filler }] : [])];
  if (!alignLeft) pieces.reverse();
  const xs = cuts(x, pieces.map((p) => p.du), w);
  const sv = far ? bigL : 0;
  return [{ label: big, u: x, v: far ? 0 : sd, du: w, dv: bigL }, ...pieces.map((p, i) => ({ label: p.label, u: xs[i][0], v: sv, du: xs[i][1], dv: sd }))];
}

/** Rooms stacked one behind another, each the column's full width. */
function stackCol(labels: string[], x: number, w: number, depth: number): Local[] {
  const ds = share(depth, labels.map((n) => roomArea(n) / Math.max(w, 1)), labels.map(minW));
  return cuts(0, ds, depth).map(([v, dv], k) => ({ label: labels[k], u: x, v, du: w, dv }));
}

/** Small rooms only: each sized for its area, with a short lobby on one side when there's depth to spare. */
function smallsCol(smalls: string[], x: number, w: number, depth: number, lobbyNear: boolean): Local[] {
  // (a half-foot under the proportion limit, so rounding to the grid can't tip a room over it)
  const want = smalls.map((n) => clamp(roomArea(n) / w, Math.max(minW(n), w / aspectOf(n)), w * aspectOf(n) - 0.5));
  const sum = want.reduce((s, v) => s + v, 0);
  const spare = depth - sum;
  if (spare < 3) return stackCol(smalls, x, w, depth);
  const labels = lobbyNear ? ["Passage~", ...smalls] : [...smalls, "Passage~"];
  const sizes = lobbyNear ? [spare, ...want] : [...want, spare];
  return cuts(0, sizes, depth).map(([v, dv], k) => ({ label: labels[k], u: x, v, du: w, dv }));
}

function colVariants(c: ColSpec, x: number, w: number, depth: number): Local[][] {
  if (c.bigs.length === 1 && !c.smalls.length) return [[{ label: c.bigs[0], u: x, v: 0, du: w, dv: depth }]];
  if (c.bigs.length === 2) return [stackCol(c.bigs, x, w, depth), stackCol([c.bigs[1], c.bigs[0]], x, w, depth)];
  if (!c.bigs.length) {
    const orders = c.smalls.length === 2 ? [c.smalls, [c.smalls[1], c.smalls[0]]] : [c.smalls];
    return orders.flatMap((o) => [smallsCol(o, x, w, depth, true), smallsCol(o, x, w, depth, false)]);
  }
  const big = c.bigs[0];
  const sd = stripDepth(c.smalls, big, depth);
  // Too shallow for a strip at one end: the rooms are stacked instead (never a room of negative depth)
  if (depth - sd < 3) return [stackCol([big, ...c.smalls], x, w, depth), stackCol([...c.smalls, big], x, w, depth)];
  // A deep column can give its strip more depth, so the main room doesn't end up long and thin.
  const deep = clamp(round05(depth - w * 1.3), sd, Math.min(8, depth - minW(big)));
  const depths = deep > sd + 0.4 ? [sd, deep] : [sd];
  const orders = c.smalls.length === 2 ? [c.smalls, [c.smalls[1], c.smalls[0]]] : [c.smalls];
  const out: Local[][] = [];
  for (const d of depths) for (const o of orders) for (const far of [true, false]) for (const left of [true, false]) out.push(stripCol(big, o, x, w, depth, d, far, left));
  return out;
}

const ROW_CACHE = new Map<string, RowResult>();

/** The best way to lay one band's rooms, in order, across `span` × `depth`. */
function layRow(labels: string[], span: number, depth: number, ctx: Ctx, fill: string): RowResult {
  if (!labels.length) return { rooms: span > 0.4 ? [{ label: fill, u: 0, v: 0, du: span, dv: depth }] : [], cost: 30 };
  const key = `${labels.join(",")}|${span}|${depth}|${JSON.stringify(ctx)}|${JSON.stringify(AREA_OVERRIDE)}|${AREA_SCALE}`;
  const hit = ROW_CACHE.get(key);
  if (hit) return hit;
  let best: RowResult | null = null;
  for (const cols of groupings(labels, span, depth)) {
    const widths = share(span, cols.map((c) => c.target), cols.map((c) => c.min));
    const placed: Local[] = [];
    let prev: Local[] = [];
    cuts(0, widths, span).forEach(([x, w], j) => {
      let pickV: Local[] = [];
      let pickC = Infinity;
      for (const v of colVariants(cols[j], x, w, depth)) {
        const c = rowCost([...prev, ...v], span, depth, ctx);
        if (c < pickC) {
          pickC = c;
          pickV = v;
        }
      }
      placed.push(...pickV);
      prev = pickV;
    });
    const cost = rowCost(placed, span, depth, ctx);
    if (!best || cost < best.cost) best = { rooms: placed, cost };
  }
  // Nothing fits the width (more rooms than the plot can take side by side): squeeze them in and let the score say so.
  if (!best) {
    const widths = share(span, labels.map((n) => roomArea(n) / depth), labels.map(minW));
    const rooms = cuts(0, widths, span).map(([u, du], k) => ({ label: labels[k], u, v: 0, du, dv: depth }));
    best = { rooms, cost: rowCost(rooms, span, depth, ctx) };
  }
  if (ROW_CACHE.size > 20000) ROW_CACHE.clear();
  ROW_CACHE.set(key, best);
  return best;
}

// ─── One floor ──────────────────────────────────────────────

const hasHubRoom = (b: string[]) => b.some((n) => /^(Living Room|Dining Room)$/.test(baseName(n)));

/**
 * Lays one floor's bands into the house outline (local coords: x across the frontage from the left as seen from the
 * road, z from the road). With a staircase, it takes the back band's left corner, the same spot on every floor; a
 * side corridor runs down the left from behind the first band to the stairs (or the back wall).
 */
function sliceFloor(bands: string[][], bw: number, D: number, circulation: Circulation, stair: boolean, ground: boolean): { placed: Placed[]; cost: number } {
  const used = bands.filter((b) => b.length);
  if (!used.length) used.push([]);
  // A band with too little in it to cross the plot at a usable depth (a kitchen and store on their own) is also
  // tried folded into the band in front of it or behind it; whichever lays out best is kept.
  const options = [used];
  used.forEach((b, i) => {
    const area = b.reduce((s, n) => s + roomArea(n), 0);
    const deepest = Math.max(0, ...b.map((n) => (isSmall(n) ? 4.5 : minW(n))));
    if (!b.length || area / bw >= deepest * 0.85) return;
    if (i > 0) options.push(used.flatMap((x, j) => (j === i ? [] : j === i - 1 ? [[...x, ...b]] : [x])));
    if (i < used.length - 1) options.push(used.flatMap((x, j) => (j === i ? [] : j === i + 1 ? [[...b, ...x]] : [x])));
  });
  // A band with more rooms than fit side by side is also tried as two rows, cut where the areas balance (never
  // between a bedroom and the bathroom after it).
  used.forEach((b, i) => {
    const need = b.reduce((s, n) => s + (isSmall(n) ? minW(n) * 0.5 : minW(n)), 0);
    if (b.length < 4 || need <= bw * 0.9) return;
    const total = b.reduce((s, n) => s + roomArea(n), 0);
    let acc = 0;
    let cut = 1;
    let bestGap = Infinity;
    b.forEach((n, k) => {
      acc += roomArea(n);
      const gap = Math.abs(acc - total / 2);
      if (k + 1 < b.length && !isSmall(b[k + 1]) && gap < bestGap) {
        bestGap = gap;
        cut = k + 1;
      }
    });
    options.push([...used.slice(0, i), b.slice(0, cut), b.slice(cut), ...used.slice(i + 1)]);
  });
  // An open terrace upstairs can also run down the side of the band behind it, rather than across the front,
  // so a few bedrooms aren't stretched across the whole width.
  if (used.length > 1 && used[0].some((n) => baseName(n) === TERRACE)) options.push([[...used[1], ...used[0]], ...used.slice(2)]);
  let best: { placed: Placed[]; cost: number } | null = null;
  for (const o of options) {
    const r = layBands(o, bw, D, circulation, stair, ground);
    if (!best || r.cost < best.cost) best = r;
  }
  return best!;
}

function layBands(used: string[][], bw: number, D: number, circulation: Circulation, stair: boolean, ground: boolean): { placed: Placed[]; cost: number } {
  const last = used.length - 1;
  const side = circulation === "side" && used.length > 1;
  // A passage across the house goes after the second band (after the only one, along the back, in a single row)
  const across = circulation === "across" ? Math.max(0, Math.min(1, last - 1)) : -1;
  const sw = stair ? Math.max(Math.min(STAIR.w, bw / 3), side ? PASSAGE : 0) : 0;
  const leftW = (i: number) => (i === last && sw ? sw : side && i > 0 ? PASSAGE : 0);
  const spans = used.map((_, i) => bw - leftW(i));
  const fill = ground ? "Passage~" : `${TERRACE}~`;
  const free = D - (across >= 0 ? PASSAGE : 0);
  const mins = used.map((b, i) => Math.max(b.length ? Math.max(...b.map((n) => (isSmall(n) ? 4.5 : minW(n)))) : 3, i === last && sw ? Math.min(STAIR.l, free) : 0));
  const weights = used.map((b, i) => (b.reduce((s, n) => s + roomArea(n), 0) + (i === last ? sw * STAIR.l : 0)) / bw);
  const ds = share(free, weights, mins).map(round05);
  ds[last] = free - ds.slice(0, last).reduce((s, v) => s + v, 0);

  // Bands are laid front to back, so each knows exactly where the band in front of it opens onto a room people
  // walk through (the living room, a lobby, the stairs). Behind it, only a passage across is certain.
  const memo = new Map<string, RowResult>();
  const layAll = (depths: number[]) => {
    const rows: RowResult[] = [];
    let cost = 0;
    used.forEach((b, i) => {
      let near: Spans = [];
      if (i > 0 && across === i - 1) near = ALL;
      else if (i > 0) {
        const shift = leftW(i) - leftW(i - 1);
        near = rows[i - 1].rooms
          .filter((r) => HUB_ROOM.test(baseName(r.label)) && Math.abs(r.v + r.dv - depths[i - 1]) < EPS)
          .map((r): [number, number] => [r.u - shift, r.u + r.du - shift]);
      }
      const ctx: Ctx = {
        hub: {
          near,
          far: i < last && (across === i || hasHubRoom(used[i + 1])) ? ALL : [],
          left: leftW(i) > 0 ? ALL : [],
          right: [],
        },
        out: { near: i === 0, far: i === last, left: leftW(i) === 0, right: true },
        road: ground && i === 0,
      };
      const k = `${i}|${depths[i]}|${JSON.stringify(near)}`;
      let row = memo.get(k);
      if (!row) memo.set(k, (row = layRow(b, spans[i], depths[i], ctx, fill)));
      rows.push(row);
      cost += row.cost;
    });
    return { rows, cost };
  };
  // Move the boundaries between bands a little either way while that makes the floor better, never taking a band below its minimum.
  let best = layAll(ds);
  for (let round = 0; round < 2; round++) {
    let moved = false;
    for (let i = 0; i < last; i++) {
      for (const step of [-3, -1.5, 1.5, 3]) {
        const a = ds[i] + step;
        const b = ds[i + 1] - step;
        if ((step < 0 && a < mins[i]) || (step > 0 && b < mins[i + 1]) || a < 3 || b < 3) continue;
        const trial = [...ds];
        trial[i] = a;
        trial[i + 1] = b;
        const t = layAll(trial);
        if (t.cost < best.cost - 0.5) {
          ds.splice(0, ds.length, ...trial);
          best = t;
          moved = true;
        }
      }
    }
    if (!moved) break;
  }

  const placed: Placed[] = [];
  let z = 0;
  used.forEach((_, i) => {
    const d = ds[i];
    const lw = leftW(i);
    if (i === last && sw) {
      // The staircase keeps one spot on every floor: the back corner. Any depth in front of it is its landing.
      const sl = d - STAIR.l < 3 ? d : STAIR.l;
      if (d - sl > 0.4) placed.push({ label: "Passage", r: { x: 0, z, w: sw, l: d - sl } });
      placed.push({ label: "Staircase", r: { x: 0, z: z + d - sl, w: sw, l: sl } });
    }
    for (const r of best.rows[i].rooms) placed.push({ label: r.label, r: { x: lw + r.u, z: z + r.v, w: r.du, l: r.dv } });
    z += d;
    if (i === across) {
      placed.push({ label: "Passage", r: { x: 0, z, w: bw, l: PASSAGE } });
      z += PASSAGE;
    }
  });
  if (side) {
    const z0 = ds[0];
    const z1 = sw ? D - ds[last] : D;
    if (z1 - z0 > 0.4) placed.push({ label: "Passage", r: { x: 0, z: z0, w: PASSAGE, l: z1 - z0 } });
  }
  return { placed, cost: best.cost };
}

/** Local plot coords (u from the left as you face the plot from the road, v from the road) → plan coords (x east, z south). */
function toWorld(r: Rect, facing: Facing, W: number, D: number): Rect {
  switch (facing) {
    case "north": // road on the north; facing the plot you look south, so your left is east
      return { x: W - r.x - r.w, z: r.z, w: r.w, l: r.l };
    case "south":
      return { x: r.x, z: D - r.z - r.l, w: r.w, l: r.l };
    case "east": // road on the east; looking west, left is south
      return { x: D - r.z - r.l, z: W - r.x - r.w, w: r.l, l: r.w };
    case "west":
      return { x: r.z, z: r.x, w: r.l, l: r.w };
  }
}

// ─── Scoring ────────────────────────────────────────────────

type Quadrant = "NE" | "SE" | "SW" | "NW";

function quadrant(r: Rect, house: Rect): Quadrant {
  const cx = r.x + r.w / 2 - (house.x + house.w / 2);
  const cz = r.z + r.l / 2 - (house.z + house.l / 2);
  return cz < 0 ? (cx >= 0 ? "NE" : "NW") : cx >= 0 ? "SE" : "SW";
}

/** Which of the visitor's wishes a layout meets. */
function checkPrefs(rooms: PlacedRoom[], house: Rect, facing: Facing, prefs: Prefs): { met: PrefKey[]; missed: PrefKey[] } {
  const met: PrefKey[] = [];
  const missed: PrefKey[] = [];
  const touch = (a: PlacedRoom | undefined, b: PlacedRoom | undefined, min = 2.5) => !!a && !!b && a.floor === b.floor && shared(a.r, b.r) >= min;
  const find = (n: string) => rooms.find((x) => x.name === n);
  const baths = rooms.filter((x) => isBath(x.name));
  const has = (k: PrefKey, ok: boolean) => prefs[k] && (ok ? met : missed).push(k);
  const viaDressing = (b: PlacedRoom) => rooms.some((d) => d.name === "Dressing" && touch(d, b) && baths.some((w) => touch(w, d, 1.5)));
  const ownBath = (b: PlacedRoom) => baths.some((w) => touch(w, b)) || viaDressing(b);
  has("elderGround", rooms.some((b) => isBed(b.name) && b.floor === 1 && ownBath(b)));
  const kitchen = find("Kitchen");
  has("openKitchen", touch(kitchen, find("Living Room"), 6) || touch(kitchen, find("Dining Room"), 6));
  const park = find("Car Parking");
  has("parking", !!park && onRoadSide(park.r, house, facing));
  has("homeOffice", !!find("Study"));
  const living = find("Living Room");
  has("bigLiving", !!living && living.r.w * living.r.l >= 300);
  has("quietBedrooms", !rooms.some((b) => isBed(b.name) && b.floor === 1 && onRoadSide(b.r, house, facing)));
  has("kitchenFront", !!kitchen && onRoadSide(kitchen.r, house, facing));
  has("attachedBaths", rooms.filter((b) => isBed(b.name)).every(ownBath));
  has("utility", rooms.some((u) => u.name === "Utility" && touch(u, kitchen, 2)));
  return { met, missed };
}

function scoreLayout(rooms: PlacedRoom[], house: Rect, facing: Facing, vastu: boolean, prefs: Prefs) {
  const violations = checkLayout(rooms, house, facing);
  const hard = violations.filter((v) => v.severity === "hard");
  const soft = violations.filter((v) => v.severity === "soft");
  const real = rooms.filter((x) => !/^(Passage|Staircase|Open Terrace|Balcony|Dressing|Utility|Store)$/.test(x.name) || x.label === x.name);
  const highlights: string[] = [];

  // Size: each room close to a comfortable size for its kind.
  const sized = real.filter((x) => !/^(Passage|Staircase|Open Terrace|Dressing)$/.test(x.name));
  const sizeFit =
    sized.reduce((s, x) => {
      const [dw, dl] = sizeOf(x.name);
      const t = (AREA_OVERRIDE[x.name] ?? dw * dl) * AREA_SCALE;
      return s + Math.max(0, 1 - Math.abs(x.r.w * x.r.l - t) / t);
    }, 0) / Math.max(1, sized.length);

  // Shape: how comfortably each room sits inside its proportion limit.
  const shaped = sized.filter((x) => Number.isFinite(maxAspect(x.name)));
  const shape = shaped.reduce((s, x) => s + Math.min(1, maxAspect(x.name) / (Math.max(x.r.w, x.r.l) / Math.max(0.1, Math.min(x.r.w, x.r.l)))), 0) / Math.max(1, shaped.length);

  // Daylight and the other soft rules, as a share of the chances to break them.
  const habitable = rooms.filter((x) => /Bedroom|Living Room|Kitchen|Dining Room|Study/.test(x.name));
  const dark = soft.filter((v) => v.rule === "daylight").length;
  const light = 1 - dark / Math.max(1, habitable.length);
  if (habitable.length && !dark) highlights.push("Every bedroom, the kitchen and the living room have an outside wall for windows");
  const beds = rooms.filter((x) => isBed(x.name));
  const chances = 1 + beds.length + beds.filter((b) => b.floor === 1).length + rooms.filter((x) => isBath(x.name) && x.floor > 1).length + rooms.filter((x) => x.name === "Staircase").length;
  const flow = 1 - soft.filter((v) => v.rule !== "daylight").length / chances;
  if (!soft.some((v) => v.rule === "kitchen-dining") && rooms.some((x) => x.name === "Kitchen")) highlights.push("The kitchen opens onto the dining space");
  const baths = rooms.filter((x) => isBath(x.name));
  if (baths.length > 1 && !hard.some((v) => v.rule === "wet-pair")) highlights.push("No two bathrooms side by side");

  // Passages and leftover pieces are floor area nobody lives in.
  const total = rooms.filter((x) => x.name !== TERRACE).reduce((s, x) => s + x.r.w * x.r.l, 0);
  const lost = rooms.filter((x) => x.name === "Passage").reduce((s, x) => s + x.r.w * x.r.l, 0);
  const economy = clamp(1 - Math.max(0, lost / Math.max(1, total) - 0.08) * 3, 0, 1);

  // Vastu, read from the house's real compass directions.
  let vastuScore = 1;
  if (vastu) {
    let ok = 0;
    let n = 0;
    const where = (name: string) => rooms.find((x) => x.name === name && x.floor === 1) ?? rooms.find((x) => x.name === name);
    const k = where("Kitchen");
    if (k) {
      n++;
      const q = quadrant(k.r, house);
      if (q === "SE") ok++;
      else if (q === "NW") ok += 0.6;
    }
    const m = where("Master Bedroom");
    if (m) {
      n++;
      if (quadrant(m.r, house) === "SW") ok++;
    }
    const pooja = where("Pooja Room");
    if (pooja) {
      n++;
      const q = quadrant(pooja.r, house);
      if (q === "NE") ok++;
      else if (q === "NW" || q === "SE") ok += 0.4;
    }
    for (const b of baths) {
      n++;
      if (quadrant(b.r, house) !== "NE") ok++;
    }
    vastuScore = n ? ok / n : 1;
    const hits = [
      k && quadrant(k.r, house) === "SE" ? "kitchen in the south-east" : null,
      m && quadrant(m.r, house) === "SW" ? "master bedroom in the south-west" : null,
      pooja && quadrant(pooja.r, house) === "NE" ? "pooja room in the north-east" : null,
    ].filter(Boolean);
    if (hits.length) highlights.unshift(`Vastu: ${hits.join(", ")}`);
  }

  const { met, missed } = checkPrefs(rooms, house, facing, prefs);
  for (const k of met) highlights.unshift(PREF_TEXT[k]);

  const parts: ScorePart[] = [
    { key: "size", label: "Room sizes", value: sizeFit },
    { key: "shape", label: "Room shapes", value: shape },
    { key: "light", label: "Daylight", value: light },
    { key: "flow", label: "Flow", value: Math.max(0, flow) },
    { key: "economy", label: "Little lost to passages", value: economy },
  ];
  if (vastu) parts.push({ key: "vastu", label: "Vastu", value: vastuScore });
  if (met.length + missed.length) parts.push({ key: "wishes", label: "Your wishes", value: met.length / (met.length + missed.length) });
  const weights: Record<string, number> = { size: 0.15, shape: 0.15, light: 0.2, flow: 0.25, economy: 0.1, vastu: 0.2, wishes: 0.3 };
  const wsum = parts.reduce((s, p) => s + weights[p.key], 0);
  // Each hard fault costs a sixth of the score: a plan with two bathrooms side by side shouldn't win on neatness.
  const penalty = 0.84 ** Math.min(hard.length, 6);
  const score = Math.round((parts.reduce((s, p) => s + p.value * weights[p.key], 0) / wsum) * penalty * 100);
  const watch = [...hard, ...soft.filter((v) => v.rule !== "daylight"), ...soft.filter((v) => v.rule === "daylight")].map((v) => v.message);
  for (const k of missed) watch.unshift(`Couldn't fit: ${PREF_TEXT[k].toLowerCase()}`);
  return { score, parts, highlights: [...new Set(highlights)].slice(0, 4), watch: [...new Set(watch)].slice(0, 4), violations, prefsMet: met, prefsMissed: missed };
}

// ─── Options ────────────────────────────────────────────────

const roomsArea = (bands: string[][]) => bands.flat().reduce((s, n) => s + roomArea(n), 0);

/** Floor area the fullest floor's rooms need, with walls and a passage, sq ft. */
function floorNeed(c: Concept, bw: number): number {
  const stair = c.floors.length > 1 ? STAIR.w * STAIR.l : 0;
  const corridor = c.circulation === "none" ? 0 : PASSAGE * bw;
  return Math.max(...c.floors.map((f) => (roomsArea(f) + stair) * 1.1 + corridor));
}

/**
 * The house's outline: all of the buildable area for a flat or a full plot. On a big plot where the rooms don't need
 * it all, the house is as deep as its rooms are comfortable (the rest stays open at the back) and, on a wide plot,
 * only as wide as it needs (centred), so rooms aren't stretched to fill the land.
 */
function houseSize(c: Concept, bw: number, bl: number, apartment: boolean): { hw: number; D: number } {
  if (apartment) return { hw: bw, D: bl };
  const need = floorNeed(c, bw);
  const used = (c.floors[0] ?? []).filter((b) => b.length);
  const across = c.circulation === "across" ? PASSAGE : 0;
  const mins = used.reduce((s, b) => s + Math.max(...b.map((n) => (isSmall(n) ? 4.5 : minW(n)))), 0) + across;
  const comfy = used.reduce((s, b) => s + Math.max(...b.map((n) => (isSmall(n) ? 5 : Math.min(...sizeOf(baseName(n))) * Math.sqrt(AREA_SCALE)))), 0) + across;
  const sideW = c.circulation === "side" ? PASSAGE : 0;
  const D = clamp(Math.ceil(Math.max(need / (bw - sideW), mins, comfy) * 2) / 2, Math.min(bl, 12), bl);
  const hw = need / (bw * D) < 0.75 ? clamp(Math.ceil((need * 1.05) / D + sideW), Math.min(bw, 24), bw) : bw;
  return { hw, D };
}

const LAYOUT_CACHE = new Map<string, { floors: Placed[][]; hw: number; D: number }>();

/** Lays out one concept on the plot and scores it. */
export function realize(brief: PlanBrief, c: Concept, prefs: Prefs = {}): PlanOption {
  const b = applyPrefs(brief, prefs);
  AREA_OVERRIDE = prefs.bigLiving ? { "Living Room": Math.round(sizeOf("Living Room")[0] * sizeOf("Living Room")[1] * 1.45) } : {};
  try {
    const apartment = b.homeType === "apartment";
    const sb = apartment ? { front: 0, rear: 0, left: 0, right: 0 } : b.setbacks;
    const W = b.width;
    const PD = b.depth;
    const bw = Math.max(8, W - sb.left - sb.right);
    const bl = Math.max(8, PD - sb.front - sb.rear);
    const stair = c.floors.length > 1;
    // The same layout serves the concept and its mirror image, so it's worked out once.
    // Rooms grow (up to about 1.45× the area) when the plot has far more space than standard rooms need
    AREA_SCALE = 1;
    if (!apartment) AREA_SCALE = clamp(Math.round(((bw * bl * 0.5) / floorNeed(c, bw)) * 10) / 10, 1, 1.45);
    const key = JSON.stringify([bw, bl, apartment, c.floors, c.circulation, AREA_OVERRIDE, AREA_SCALE]);
    let layout = LAYOUT_CACHE.get(key);
    if (!layout) {
      const { hw, D } = houseSize(c, bw, bl, apartment);
      const floors = c.floors.map((bands, i) => {
        // An upper floor with much less to hold than the footprint gets an open terrace at the front.
        const need = roomsArea(bands) + (stair ? STAIR.w * STAIR.l : 0);
        const spare = hw * D * 0.85 - need;
        // It joins the front band when that band holds only a balcony; otherwise it's a band of its own.
        const terrace = `${TERRACE}|${Math.round(spare)}`;
        const front = bands[0] ?? [];
        const withTerrace =
          i > 0 && spare > hw * D * 0.2 ? (front.every((n) => baseName(n) === "Balcony") ? [[terrace, ...front], ...bands.slice(1)] : [[terrace], ...bands]) : bands;
        return sliceFloor(withTerrace, hw, D, c.circulation, stair, i === 0).placed;
      });
      layout = { floors, hw, D };
      if (LAYOUT_CACHE.size > 500) LAYOUT_CACHE.clear();
      LAYOUT_CACHE.set(key, layout);
    }
    const { hw, D } = layout;
    const ox = sb.left + round05((bw - hw) / 2);
    const placed: PlacedRoom[] = [];
    layout.floors.forEach((rooms, i) => {
      const count: Record<string, number> = {};
      for (const p of rooms) {
        const x = c.mirror ? hw - p.r.x - p.r.w : p.r.x;
        const local = { x: x + ox, z: p.r.z + sb.front, w: p.r.w, l: p.r.l };
        const name = baseName(p.label);
        // Labels stay unique for the rule messages ("Dressing 2"), names stay plain for display
        count[name] = (count[name] ?? 0) + 1;
        const plain = p.label.includes("|") || isFiller(p.label) || p.label === name;
        const label = plain ? (count[name] > 1 ? `${name} ${count[name]}` : name) : p.label;
        placed.push({ label, name, r: toWorld(local, b.facing, W, PD), floor: i + 1 });
      }
    });
    const plotRect = toWorld({ x: 0, z: 0, w: W, l: PD }, b.facing, W, PD);
    const house = toWorld({ x: ox, z: sb.front, w: hw, l: D }, b.facing, W, PD);
    const s = scoreLayout(placed, house, b.facing, b.vastu, prefs);
    // Say so when the brief asks for more than the plot can hold on a floor
    const need = floorNeed(c, bw);
    if (need > bw * bl * 1.02) s.watch = [`Tight: the rooms on a floor need about ${Math.round(need / 10) * 10} sq ft and the buildable area is ${Math.round(bw * bl)}, so rooms are smaller than usual. Another floor would help.`, ...s.watch].slice(0, 4);
    const r1 = (v: number) => Math.round(v * 10) / 10;
    return {
      id: c.id,
      name: c.name,
      why: c.why,
      source: c.source,
      ...s,
      rooms: placed.map((p) => ({ name: p.name, w: r1(p.r.w), l: r1(p.r.l), h: 10, floor: p.floor, x: r1(p.r.x), z: r1(p.r.z) })),
      plot: { width: W, depth: PD, facing: b.facing },
      plotRect,
      buildable: house,
      builtUp: Math.round(placed.filter((p) => p.name !== TERRACE).reduce((sum, p) => sum + p.r.w * p.r.l, 0)),
    };
  } finally {
    AREA_OVERRIDE = {};
    AREA_SCALE = 1;
  }
}

/** The arrangement an option came from, without its corridor and mirror variants ("classic-side-m" → "classic"). */
const family = (o: PlanOption) => (o.source === "ai" ? o.id : o.id.replace(/-m$/, "").replace(/-(across|side|none)$/, ""));

/** The best few options, at most one per arrangement, best first. */
export function bestOptions(brief: PlanBrief, extra: Concept[] = [], count = 5, prefs: Prefs = {}): PlanOption[] {
  const all = [...extra, ...ruleConcepts(brief, prefs)].map((c) => realize(brief, c, prefs));
  const hard = (o: PlanOption) => o.violations.filter((v) => v.severity === "hard").length;
  all.sort((a, b) => b.score - a.score || hard(a) - hard(b) || (a.source === "ai" ? -1 : 1));
  const out: PlanOption[] = [];
  const seen = new Set<string>();
  for (const o of all) {
    const shape = o.rooms.map((r) => `${r.name}@${Math.round(r.x)},${Math.round(r.z)}`).sort().join("|");
    if (seen.has(family(o)) || seen.has(shape)) continue;
    seen.add(family(o));
    seen.add(shape);
    out.push(o);
    if (out.length === count) break;
  }
  // Keep at least three, but don't pad the list with layouts far worse than the best. Names never repeat in a list.
  const kept = out.filter((o, i) => i < 3 || o.score >= out[0].score - 30);
  const names = new Map<string, number>();
  return kept.map((o) => {
    const n = (names.get(o.name) ?? 0) + 1;
    names.set(o.name, n);
    return n === 1 ? o : { ...o, name: `${o.name} (${["", "", "second", "third", "fourth", "fifth"][n]} take)` };
  });
}

export const BANDS = ["front", "middle", "back"] as const;
export type Band = (typeof BANDS)[number];

/**
 * One band's rooms in a sensible order, left to right: parking at the end, a common bathroom beside the living or
 * dining room, the pooja room by the living room, kitchen beside dining with its utility and store, then each
 * bedroom followed by its own bathroom (never two bathrooms together). Used when the local model only says which
 * band each room goes in.
 */
export function arrangeBand(labels: string[], band: Band): string[] {
  const take = (re: RegExp) => labels.filter((l) => re.test(baseName(l)));
  const beds = labels.filter(isBedLabel);
  const common = beds.length ? [] : labels.filter(isBathLabel);
  const privateRooms = beds.length ? bedsWithBaths(labels) : take(/^(Study|Walk-in Closet)$/);
  const balcony = take(/^Balcony$/);
  const pooja = take(/^Pooja Room$/);
  const order = [
    ...take(/^Car Parking$/),
    ...common,
    ...take(/^Living Room$/),
    ...(band === "front" ? balcony : []),
    ...(common.length ? [] : pooja),
    ...take(/^Dining Room$/),
    ...(common.length ? pooja : []),
    ...take(/^Kitchen$/),
    ...take(/^Utility$/),
    ...take(/^Store$/),
    ...privateRooms,
    ...(band === "front" ? [] : balcony),
  ];
  return [...new Set([...order, ...labels])];
}

/** Where a room goes when nobody said: the usual band for its kind. */
export function usualBand(label: string, floor: number): Band {
  const n = baseName(label);
  if (floor === 0 && /^(Living Room|Car Parking|Pooja Room|Balcony)$/.test(n)) return "front";
  if (floor === 0 && /^(Dining Room|Kitchen|Store|Utility)$/.test(n)) return "middle";
  if (floor > 0 && n === "Balcony") return "front";
  return "back";
}

/** A concept from a band for each room on each floor (what the local model answers), ordered by arrangeBand(). */
export function conceptFromBands(
  brief: PlanBrief,
  prefs: Prefs,
  floors: Partial<Record<string, Band>>[],
  meta: Pick<Concept, "id" | "name" | "why" | "circulation" | "mirror">
): Concept {
  const want = floorRooms(applyPrefs(brief, prefs), prefs);
  const bands = want.map((rooms, f) => BANDS.map((band) => arrangeBand(rooms.filter((r) => (floors[f]?.[r] ?? usualBand(r, f)) === band), band)));
  return { ...meta, source: "ai", floors: bands };
}

/** Puts every room the brief needs into the concept exactly once, so a sloppy suggestion still lays out. */
export function repairConcept(brief: PlanBrief, c: Concept, prefs: Prefs = {}): Concept {
  const want = floorRooms(applyPrefs(brief, prefs), prefs);
  const floors = want.map((rooms, f) => {
    const bands = (c.floors[f] ?? []).map((b) => b.filter((x) => rooms.includes(x)));
    const seen = new Set<string>();
    const clean = bands.map((b) => b.filter((x) => (seen.has(x) ? false : (seen.add(x), true))));
    while (clean.length < 2) clean.push([]);
    for (const r of rooms) {
      if (seen.has(r)) continue;
      if (PARK.test(r)) clean[0].unshift(r);
      else if (isBedLabel(r) || isBathLabel(r) || /Study|Walk-in/.test(r)) clean[clean.length - 1].push(r);
      else if (/Living|Pooja|Balcony/.test(r)) clean[0].push(r);
      else clean[Math.min(1, clean.length - 1)].push(r);
    }
    // At most six bands; anything past that joins the last one
    const kept = clean.filter((b) => b.length);
    while (kept.length > 6) kept[kept.length - 2].push(...kept.pop()!);
    return kept.length ? kept : [[]];
  });
  return { ...c, floors };
}

/** Names of rooms per floor that the model must place, for its prompt. */
export function roomsToPlace(brief: PlanBrief, prefs: Prefs = {}): string[][] {
  return floorRooms(applyPrefs(brief, prefs), prefs);
}
