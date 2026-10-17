// The planning rulebook: what makes an Indian home plan good or bad, as checks on a laid-out floor plan.
//
// One list, three users: the planner's scoring (lib/planner.ts), the review round that sends the local model its
// mistakes (lib/server/planAi.ts), and the written guide the model reads (lib/server/skills/floor-planning.md),
// which cites the same rule ids. Change a rule here and in the guide together.

export type Rect = { x: number; z: number; w: number; l: number };
export type PlacedRoom = { label: string; name: string; r: Rect; floor: number };

export type RuleId =
  | "wet-pair"
  | "bath-access"
  | "bed-access"
  | "kitchen-wet"
  | "pooja-wet"
  | "min-size"
  | "proportion"
  | "entrance"
  | "dead-passage"
  | "kitchen-dining"
  | "attached-bath"
  | "daylight"
  | "quiet-bedrooms"
  | "wet-stack"
  | "stair-access"
  | "open-air"
  | "master-largest";

export type Violation = { rule: RuleId; severity: "hard" | "soft"; message: string; rooms: string[] };

/** The rules in plain words, by id: shown to the model in the review round and mirrored in its guide. */
export const RULE_TEXT: Record<RuleId, string> = {
  "wet-pair": "Never put two bathrooms side by side; give each bathroom its own bedroom or the passage.",
  "bath-access": "Every bathroom must open off a bedroom, the passage, the dining room or the living room, never only through the kitchen, pooja room or store.",
  "bed-access": "Every bedroom must open off the living room, dining room, passage or staircase landing, never only through another bedroom or the kitchen.",
  "kitchen-wet": "The kitchen must not share a wall with a bathroom.",
  "pooja-wet": "The pooja room must not share a wall with a bathroom.",
  "min-size": "Rooms must be big enough to use (bedrooms at least 9 ft across, living 10 ft, kitchen 7 ft, bathrooms 4.5 ft).",
  "proportion": "Rooms must not be long and thin: bedrooms at most 1.6 times as long as wide, living 1.8, kitchen 2.2, bathrooms 2.4.",
  "entrance": "The main door opens from the road side into the living room, so the living room must touch the road side on the ground floor.",
  "dead-passage": "A passage must lead somewhere: it must touch the living room, dining room, staircase or another passage.",
  "kitchen-dining": "The kitchen should open onto the dining room (or the living room when there is no dining room).",
  "attached-bath": "The master bedroom should have its own bathroom beside it; other bedrooms ideally too.",
  "daylight": "Bedrooms, kitchen, living and dining should each have an outside wall for windows.",
  "quiet-bedrooms": "Bedrooms are best away from the road side.",
  "wet-stack": "On upper floors, put bathrooms above bathrooms or the kitchen, so the plumbing stacks.",
  "stair-access": "The staircase must be reachable from the living room, dining room or passage.",
  "open-air": "Balconies and terraces must be on an outside wall.",
  "master-largest": "The master bedroom should be the largest bedroom.",
};

const HARD: RuleId[] = ["wet-pair", "bath-access", "bed-access", "kitchen-wet", "pooja-wet", "min-size", "proportion", "entrance", "dead-passage", "open-air"];
export const isHard = (id: RuleId) => HARD.includes(id);

const EPS = 0.05;

/** Length of wall two rooms share (0 if they don't touch). */
export function shared(a: Rect, b: Rect): number {
  const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
  if (Math.abs(a.x + a.w - b.x) < EPS || Math.abs(b.x + b.w - a.x) < EPS) return overlap(a.z, a.z + a.l, b.z, b.z + b.l);
  if (Math.abs(a.z + a.l - b.z) < EPS || Math.abs(b.z + b.l - a.z) < EPS) return overlap(a.x, a.x + a.w, b.x, b.x + b.w);
  return 0;
}

export const isBed = (n: string) => /Bedroom/.test(n);
export const isBath = (n: string) => n === "Bathroom";
const HUB = /^(Living Room|Dining Room|Passage|Staircase)$/;

/** Smallest sensible side, ft. */
export function minSide(name: string): number {
  if (isBed(name)) return 9;
  if (name === "Living Room") return 10;
  if (name === "Dining Room") return 8;
  if (name === "Kitchen") return 7;
  if (name === "Study") return 7;
  if (name === "Car Parking") return 9.5;
  if (isBath(name)) return 4.5;
  if (name === "Balcony") return 3.5;
  if (name === "Passage") return 3;
  return 4;
}

/** Longest side ÷ shortest side allowed; Infinity where shape doesn't matter. */
export function maxAspect(name: string): number {
  if (isBed(name)) return 1.6;
  if (name === "Living Room") return 1.8;
  if (name === "Dining Room") return 1.7;
  if (name === "Kitchen") return 2.2;
  if (name === "Study" || name === "Pooja Room") return 1.8;
  if (name === "Car Parking") return 2.2;
  if (/^(Bathroom|Store|Utility|Dressing|Walk-in Closet)$/.test(name)) return 2.4;
  return Infinity; // passages, stairs, balconies, terraces
}

/** Which edge of the buildable area faces the road, as a test on a room. */
export function onRoadSide(r: Rect, buildable: Rect, facing: "north" | "east" | "south" | "west"): boolean {
  switch (facing) {
    case "north":
      return Math.abs(r.z - buildable.z) < EPS;
    case "south":
      return Math.abs(r.z + r.l - (buildable.z + buildable.l)) < EPS;
    case "east":
      return Math.abs(r.x + r.w - (buildable.x + buildable.w)) < EPS;
    case "west":
      return Math.abs(r.x - buildable.x) < EPS;
  }
}

export function onOutsideWall(r: Rect, b: Rect): boolean {
  return Math.abs(r.x - b.x) < EPS || Math.abs(r.z - b.z) < EPS || Math.abs(r.x + r.w - (b.x + b.w)) < EPS || Math.abs(r.z + r.l - (b.z + b.l)) < EPS;
}

const touching = (a: PlacedRoom, b: PlacedRoom, min = 2.5) => a !== b && a.floor === b.floor && shared(a.r, b.r) >= min;

/** Every rule break in a layout. */
export function checkLayout(rooms: PlacedRoom[], buildable: Rect, facing: "north" | "east" | "south" | "west"): Violation[] {
  const out: Violation[] = [];
  const add = (rule: RuleId, message: string, names: string[]) => out.push({ rule, severity: isHard(rule) ? "hard" : "soft", message, rooms: names });
  const floors = Math.max(1, ...rooms.map((r) => r.floor));

  for (const room of rooms) {
    const lo = Math.min(room.r.w, room.r.l);
    const hi = Math.max(room.r.w, room.r.l);
    if (lo + 0.01 < minSide(room.name)) add("min-size", `${room.label} is only ${lo} ft across`, [room.label]);
    else if (hi / Math.max(lo, 0.1) > maxAspect(room.name) + 0.01) add("proportion", `${room.label} is long and thin (${room.r.w} × ${room.r.l} ft)`, [room.label]);
  }

  const baths = rooms.filter((x) => isBath(x.name));
  for (let i = 0; i < baths.length; i++) {
    for (let j = i + 1; j < baths.length; j++) {
      if (touching(baths[i], baths[j], 1.5)) add("wet-pair", `${baths[i].label} and ${baths[j].label} are side by side`, [baths[i].label, baths[j].label]);
    }
    const b = baths[i];
    const reachable = rooms.some((x) => touching(x, b) && (isBed(x.name) || HUB.test(x.name) || x.name === "Dressing"));
    if (!reachable) add("bath-access", `${b.label} can only be reached through ${rooms.find((x) => touching(x, b))?.label ?? "nothing"}`, [b.label]);
  }

  for (const bed of rooms.filter((x) => isBed(x.name))) {
    if (!rooms.some((x) => touching(x, bed, 3) && HUB.test(x.name))) add("bed-access", `${bed.label} can only be reached through another room`, [bed.label]);
  }

  const kitchen = rooms.find((x) => x.name === "Kitchen");
  for (const b of baths) {
    if (kitchen && touching(kitchen, b, 1.5)) add("kitchen-wet", `The kitchen shares a wall with ${b.label}`, ["Kitchen", b.label]);
    const pooja = rooms.find((x) => x.name === "Pooja Room" && touching(x, b, 1.5));
    if (pooja) add("pooja-wet", `The pooja room shares a wall with ${b.label}`, ["Pooja Room", b.label]);
  }

  const living = rooms.find((x) => x.name === "Living Room" && x.floor === 1);
  if (living && !onRoadSide(living.r, buildable, facing)) add("entrance", "The living room doesn't reach the road side, so the main door can't open into it", ["Living Room"]);

  for (const p of rooms.filter((x) => x.name === "Passage")) {
    const leads = rooms.some((x) => touching(x, p, 2.5) && /^(Living Room|Dining Room|Staircase|Passage)$/.test(x.name)) || onRoadSide(p.r, buildable, facing);
    if (!leads) add("dead-passage", "A passage leads nowhere", ["Passage"]);
  }

  // Soft rules
  const dining = rooms.find((x) => x.name === "Dining Room") ?? living;
  if (kitchen && dining && !touching(kitchen, dining, 3)) add("kitchen-dining", `The kitchen doesn't open onto the ${dining.name.toLowerCase()}`, ["Kitchen", dining.label]);
  for (const bed of rooms.filter((x) => isBed(x.name))) {
    const attached = baths.some((b) => touching(b, bed, 2.5)) || rooms.some((d) => d.name === "Dressing" && touching(d, bed) && baths.some((b) => touching(b, d)));
    if (!attached && (bed.name === "Master Bedroom" || baths.length >= rooms.filter((x) => isBed(x.name)).length)) add("attached-bath", `${bed.label} has no bathroom of its own`, [bed.label]);
  }
  for (const x of rooms.filter((x) => /Bedroom|Living Room|Kitchen|Dining Room|Study/.test(x.name))) {
    if (!onOutsideWall(x.r, buildable)) add("daylight", `${x.label} has no outside wall for windows`, [x.label]);
  }
  for (const bed of rooms.filter((x) => isBed(x.name) && x.floor === 1)) {
    if (onRoadSide(bed.r, buildable, facing)) add("quiet-bedrooms", `${bed.label} faces the road`, [bed.label]);
  }
  if (floors > 1) {
    const below = rooms.filter((x) => x.floor === 1 && (isBath(x.name) || x.name === "Kitchen"));
    for (const b of baths.filter((x) => x.floor > 1)) {
      const stacked = below.some((w) => Math.min(w.r.x + w.r.w, b.r.x + b.r.w) - Math.max(w.r.x, b.r.x) > 1 && Math.min(w.r.z + w.r.l, b.r.z + b.r.l) - Math.max(w.r.z, b.r.z) > 1);
      if (!stacked) add("wet-stack", `${b.label} upstairs isn't above a bathroom or the kitchen`, [b.label]);
    }
  }
  for (const x of rooms.filter((x) => x.name === "Balcony" || x.name === "Open Terrace")) {
    if (!onOutsideWall(x.r, buildable)) add("open-air", `${x.label} has no outside wall`, [x.label]);
  }
  const master = rooms.find((x) => x.name === "Master Bedroom");
  const area = (x: PlacedRoom) => x.r.w * x.r.l;
  const bigger = master && rooms.find((x) => isBed(x.name) && x !== master && area(x) > area(master) + 10);
  if (master && bigger) add("master-largest", `${bigger.label} is bigger than the master bedroom`, ["Master Bedroom", bigger.label]);
  for (const s of rooms.filter((x) => x.name === "Staircase")) {
    if (!rooms.some((x) => touching(x, s, 2.5) && /^(Living Room|Dining Room|Passage)$/.test(x.name))) add("stair-access", "The staircase isn't reachable from the living room, dining room or passage", ["Staircase"]);
  }
  return out;
}
