// Where rooms go on upper floors, and the staircase that comes with a new floor.
// Plan feet: x east, z south. Pure functions over the room list, used by the design page.

import { WALLS, freeSpot, roomRects, sharedSpans, wallLine, type Opening, type Room } from "@/lib/rooms";

type Rect = { x: number; z: number; w: number; l: number };

/** The staircase a new floor gets: small enough to tuck against the house, big enough for a dog-leg stair. */
export const STAIR_SIZE: [number, number] = [8, 10];

const isStair = (r: Pick<Room, "name">) => /stair/i.test(r.name);
/** Rooms a staircase should open onto. */
const isCirculation = (r: Pick<Room, "name">) => /passage|corridor|lobby|foyer|hall|living|drawing|dining|family/i.test(r.name);

const overlaps = (a: Rect, b: Rect) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0.05 && Math.min(a.z + a.l, b.z + b.l) - Math.max(a.z, b.z) > 0.05;

/** Length of wall two rectangles share (touching edges), in feet. */
function sharedLength(a: Rect, b: Rect) {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const oz = Math.min(a.z + a.l, b.z + b.l) - Math.max(a.z, b.z);
  const touchX = Math.abs(a.x + a.w - b.x) < 0.05 || Math.abs(b.x + b.w - a.x) < 0.05;
  const touchZ = Math.abs(a.z + a.l - b.z) < 0.05 || Math.abs(b.z + b.l - a.z) < 0.05;
  if (touchX && oz > 0.05) return oz;
  if (touchZ && ox > 0.05) return ox;
  return 0;
}

/** Whether every part of `r` stands on a room of the floor below (checked on a 1 ft grid). */
function supported(r: Rect, below: Rect[]) {
  for (let x = r.x + 0.5; x < r.x + r.w; x += 1) {
    for (let z = r.z + 0.5; z < r.z + r.l; z += 1) {
      if (!below.some((b) => x >= b.x - 0.01 && x <= b.x + b.w + 0.01 && z >= b.z - 0.01 && z <= b.z + b.l + 0.01)) return false;
    }
  }
  return true;
}

function bbox(rects: Rect[]) {
  return {
    x0: Math.min(...rects.map((r) => r.x)),
    z0: Math.min(...rects.map((r) => r.z)),
    x1: Math.max(...rects.map((r) => r.x + r.w)),
    z1: Math.max(...rects.map((r) => r.z + r.l)),
  };
}

/** Spots for a w × l room against each side of each anchor, sliding along it on a half-foot grid. */
function spotsAround(anchors: Rect[], w: number, l: number): Rect[] {
  const spots: Rect[] = [];
  for (const a of anchors) {
    for (let t = a.x - w + 0.5; t <= a.x + a.w - 0.5; t += 0.5) {
      spots.push({ x: t, z: a.z - l, w, l }, { x: t, z: a.z + a.l, w, l });
    }
    for (let t = a.z - l + 0.5; t <= a.z + a.l - 0.5; t += 0.5) {
      spots.push({ x: a.x - w, z: t, w, l }, { x: a.x + a.w, z: t, w, l });
    }
  }
  return spots;
}

/**
 * The best place for a new w × l room on `floor`: touching as much of that floor's rooms as possible, keeping the
 * floor compact, and (above the ground floor) standing wholly on the floor below. Falls back to the east side.
 */
export function bestSpot(rooms: Room[], floor: number, w: number, l: number, ignoreId?: number): { x: number; z: number } {
  const here = rooms.filter((r) => r.floor === floor && r.id !== ignoreId);
  // What's below as rectangles, so a shaped room only supports where it really is
  const below = rooms.filter((r) => r.floor === floor - 1).flatMap(roomRects);
  const needsSupport = floor > 1 && below.length > 0;
  const anchors: Rect[] = here.length ? here : below;
  // An empty upper floor starts in a corner of the floor below.
  const candidates = here.length ? spotsAround(anchors, w, l) : below.flatMap((b) => [
    { x: b.x, z: b.z, w, l },
    { x: b.x + b.w - w, z: b.z, w, l },
    { x: b.x, z: b.z + b.l - l, w, l },
    { x: b.x + b.w - w, z: b.z + b.l - l, w, l },
  ]);
  const box = here.length ? bbox(here) : null;
  let best: { r: Rect; score: number } | null = null;
  for (const r of candidates) {
    if (here.some((o) => overlaps(o, r))) continue;
    if (needsSupport && !supported(r, below)) continue;
    const shared = here.reduce((s, o) => s + sharedLength(o, r), 0);
    const grown = box ? (Math.max(box.x1, r.x + r.w) - Math.min(box.x0, r.x)) * (Math.max(box.z1, r.z + r.l) - Math.min(box.z0, r.z)) - (box.x1 - box.x0) * (box.z1 - box.z0) : 0;
    const score = shared * 2 - grown * 0.05;
    if (!best || score > best.score) best = { r, score };
  }
  if (best) return { x: best.r.x, z: best.r.z };
  return freeSpot(rooms.filter((r) => r.id !== ignoreId), floor);
}

/** A door on the stair's wall shared with `to`: centred on a short end wall, or near one end of a long wall. */
function stairDoor(stair: Rect, to: Room): Opening | null {
  const asRoom: Room = { ...stair, id: -1, name: "Staircase", h: 10, floor: to.floor, openings: [] };
  for (const wall of WALLS) {
    const span = sharedSpans(asRoom, wall, [to])[0];
    if (!span) continue;
    const line = wallLine(asRoom, wall);
    const len = line.to - line.from;
    const width = 3;
    if (span[1] - span[0] < width + 0.5) continue;
    const isEnd = len <= Math.min(stair.w, stair.l) + 0.01;
    // On a long wall, the end nearest the shared stretch's start becomes the stair's entry end.
    const start = isEnd ? (span[0] + span[1]) / 2 - width / 2 : Math.abs(span[0] - line.from) <= Math.abs(line.to - span[1]) ? Math.max(span[0], line.from + 0.5) : Math.min(span[1], line.to - 0.5) - width;
    return { id: 1, kind: "door", wall, offset: Math.round((start - line.from) * 2) / 2, width };
  }
  return null;
}

/** Where a staircase goes on the ground floor: against the house, opening onto a passage or living area if it can. */
function stairSpot(rooms: Room[]): { rect: Rect; door: Opening | null } | null {
  const ground = rooms.filter((r) => r.floor === 1);
  if (!ground.length) return null;
  const box = bbox(ground);
  let best: { rect: Rect; door: Opening | null; score: number } | null = null;
  for (const [w, l] of [STAIR_SIZE, [STAIR_SIZE[1], STAIR_SIZE[0]] as [number, number]]) {
    for (const r of spotsAround(ground, w, l)) {
      if (ground.some((o) => overlaps(o, r))) continue;
      const touching = ground.filter((o) => sharedLength(o, r) > 0);
      const hub = touching.filter(isCirculation).sort((a, b) => sharedLength(b, r) - sharedLength(a, r))[0];
      const doorTo = hub ?? [...touching].sort((a, b) => sharedLength(b, r) - sharedLength(a, r))[0];
      const door = doorTo ? stairDoor(r, doorTo) : null;
      if (!door) continue;
      const shared = touching.reduce((s, o) => s + sharedLength(o, r), 0);
      const grown = (Math.max(box.x1, r.x + r.w) - Math.min(box.x0, r.x)) * (Math.max(box.z1, r.z + r.l) - Math.min(box.z0, r.z)) - (box.x1 - box.x0) * (box.z1 - box.z0);
      const score = shared * 2 + (hub ? 25 : 0) - grown * 0.08;
      if (!best || score > best.score) best = { rect: r, door, score };
    }
  }
  return best;
}

/**
 * Called when the floor count goes up: makes sure there's a staircase on the ground floor (adding a small one in the
 * best spot if there isn't) and one directly above it on every floor up to `to`, each with its door on the same wall.
 * `newId` hands out room ids.
 */
export function addStairs(rooms: Room[], to: number, newId: () => number): Room[] {
  const out = [...rooms];
  let base = out.find((r) => r.floor === 1 && isStair(r));
  if (!base) {
    const spot = stairSpot(out);
    if (!spot) return out;
    base = { id: newId(), name: "Staircase", ...spot.rect, h: 10, floor: 1, openings: spot.door ? [spot.door] : [] };
    out.push(base);
  }
  for (let f = 2; f <= to; f++) {
    if (out.some((r) => r.floor === f && isStair(r) && overlaps(r, base!))) continue;
    // Anything already standing where the stair goes moves aside.
    const copy: Room = { ...base, id: newId(), floor: f, openings: base.openings.map((o) => ({ ...o })) };
    for (let i = 0; i < out.length; i++) {
      const r = out[i];
      if (r.floor === f && overlaps(r, copy)) out[i] = { ...r, ...bestSpot([...out, copy], f, r.w, r.l, r.id) };
    }
    out.push(copy);
  }
  return out;
}

/** Called when the floor count goes down: drops the stair copies on the removed floors (the rooms there move down). */
export function removeStairCopies(rooms: Room[], floors: number): Room[] {
  return rooms.filter((r) => !(r.floor > floors && isStair(r) && rooms.some((b) => b.floor < r.floor && isStair(b) && overlaps(b, r))));
}

