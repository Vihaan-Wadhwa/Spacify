import { ROOM_DEFAULTS, ROOM_SIZE, type RoomDraft } from "@/lib/rooms";

/**
 * Turns what the vision model saw on a sketch into a floor plan in feet.
 *
 * The model is reliable about *where each label is written* and about dimensions written on the sketch,
 * and less reliable about the exact outline of each room. Hand-drawn sketches also aren't to scale.
 * So: written dimensions set each room's size and the sketch's scale, label positions set the arrangement
 * (what's left of / above what), and rooms are then pushed together so neighbours share a wall, like on the sketch.
 */

/** One room as read from the sketch. Coordinates are in the image's pixels, as the model reported them. */
export type SketchRoom = {
  name: string;
  /** Feet, as written on the sketch; undefined if no dimensions were written. */
  w?: number;
  l?: number;
  h: number;
  floor: number;
  /** Centre of the room's label. */
  point?: [number, number];
  /** The room's walls: [x1, y1, x2, y2]. */
  box?: [number, number, number, number];
};

type Rect = { x: number; z: number; w: number; l: number };
type Axis = "x" | "z";

/** Gaps up to this wide (feet) between neighbours are taken to be sketching error, so the rooms are moved to touch. */
const GAP_TOLERANCE = 3;

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN;
};
const clampSize = (v: number) => Math.min(ROOM_SIZE.max, Math.max(ROOM_SIZE.min, Math.round(v * 2) / 2));
const defaultSize = (name: string): [number, number] => ROOM_DEFAULTS[name] ?? [10, 10];

const inside = (b: SketchRoom["box"] & {}, [px, py]: [number, number], margin: number) =>
  px >= b[0] - margin && px <= b[2] + margin && py >= b[1] - margin && py <= b[3] + margin;

/** A box is only trusted if it contains its own label and no other room's label. */
function trustedBox(room: SketchRoom, all: SketchRoom[]): SketchRoom["box"] {
  const b = room.box;
  if (!b || !room.point || !(b[2] > b[0] && b[3] > b[1])) return undefined;
  if (!inside(b, room.point, 4)) return undefined;
  const inset = Math.min(b[2] - b[0], b[3] - b[1]) * 0.05;
  if (all.some((o) => o !== room && o.point && inside(b, o.point, -inset))) return undefined;
  return b;
}

/**
 * Size in feet: written dimensions, else the drawn box at the sketch's scale, else a typical size for the room type.
 * Written sizes are taken as width (left–right) × length (top–bottom), as the tutorial asks; the drawn shape isn't used
 * to turn them round, because the model's boxes are least reliable exactly on the busy plans where that would matter.
 */
function sizeOf(room: SketchRoom, box: SketchRoom["box"], scale: number): [number, number] {
  if (room.w && room.l) return [room.w, room.l];
  if (box && Number.isFinite(scale)) return [clampSize((box[2] - box[0]) * scale), clampSize((box[3] - box[1]) * scale)];
  return defaultSize(room.name);
}

/** Feet per pixel, from rooms whose size is known and whose box is trusted (or, failing that, from how far apart labels are). */
function sketchScale(rooms: SketchRoom[], boxes: SketchRoom["box"][]): number {
  const fromBoxes = (known: (r: SketchRoom) => [number, number] | null) =>
    median(
      rooms.flatMap((r, i) => {
        const b = boxes[i], size = known(r);
        return b && size ? [Math.sqrt((size[0] * size[1]) / ((b[2] - b[0]) * (b[3] - b[1])))] : [];
      })
    );
  let s = fromBoxes((r) => (r.w && r.l ? [r.w, r.l] : null));
  if (!Number.isFinite(s)) s = fromBoxes((r) => defaultSize(r.name));
  if (Number.isFinite(s)) return s;

  // No usable boxes: assume each label's nearest neighbour is the room next door, whose centre is half of both sizes away.
  const samples: number[] = [];
  rooms.forEach((a, i) => {
    let best: { d: number; j: number; axis: Axis } | null = null;
    rooms.forEach((b, j) => {
      if (i === j) return;
      const dx = Math.abs(b.point![0] - a.point![0]), dy = Math.abs(b.point![1] - a.point![1]);
      const d = Math.hypot(dx, dy);
      if (d > 0 && (!best || d < best.d)) best = { d, j, axis: dx >= dy ? "x" : "z" };
    });
    if (!best) return;
    const { j, axis } = best as { d: number; j: number; axis: Axis };
    const [aw, al] = a.w && a.l ? [a.w, a.l] : defaultSize(a.name);
    const [bw, bl] = rooms[j].w && rooms[j].l ? [rooms[j].w!, rooms[j].l!] : defaultSize(rooms[j].name);
    const ft = axis === "x" ? (aw + bw) / 2 : (al + bl) / 2;
    const px = Math.abs(axis === "x" ? rooms[j].point![0] - a.point![0] : rooms[j].point![1] - a.point![1]);
    if (px > 0) samples.push(ft / px);
  });
  return median(samples);
}

const lo = (r: Rect, a: Axis) => (a === "x" ? r.x : r.z);
const len = (r: Rect, a: Axis) => (a === "x" ? r.w : r.l);
const set = (r: Rect, a: Axis, v: number) => (a === "x" ? (r.x = v) : (r.z = v));
const other = (a: Axis): Axis => (a === "x" ? "z" : "x");
const overlap = (a: Rect, b: Rect, axis: Axis) => Math.min(lo(a, axis) + len(a, axis), lo(b, axis) + len(b, axis)) - Math.max(lo(a, axis), lo(b, axis));

/** Lays out one floor's rooms, all of which have a label point. Null if the sketch gives nothing to go on (e.g. all labels in one spot). */
function layoutFloor(rooms: SketchRoom[]): Rect[] | null {
  const boxes = rooms.map((r) => trustedBox(r, rooms));
  const scale = sketchScale(rooms, boxes);
  if (!(scale > 0 && Number.isFinite(scale))) return null;
  const centre = rooms.map((r) => ({ x: r.point![0] * scale, z: r.point![1] * scale }));
  const sketched: Rect[] = rooms.map((r, i) => {
    const [w, l] = sizeOf(r, boxes[i], scale);
    return { x: centre[i].x - w / 2, z: centre[i].z - l / 2, w, l };
  });
  const rects = sketched.map((r) => ({ ...r }));

  // For each pair, which way the sketch separates them: side by side ("x") or one above the other ("z"),
  // judged by how far apart their labels are compared with the rooms' sizes.
  const sideBySide = (i: number, j: number) => {
    const nx = Math.abs(centre[j].x - centre[i].x) / ((rects[i].w + rects[j].w) / 2);
    const nz = Math.abs(centre[j].z - centre[i].z) / ((rects[i].l + rects[j].l) / 2);
    return nx >= nz;
  };
  const separatedOn = (i: number, j: number, axis: Axis) => sideBySide(i, j) === (axis === "x");

  // One pass along an axis: going left→right (or top→bottom), each room moves up against the neighbours before it
  // that it faces across a wall. A room with no such neighbour lines up with the edge of a room it's stacked with.
  const pass = (axis: Axis) => {
    const order = rooms.map((_, i) => i).sort((a, b) => (axis === "x" ? centre[a].x - centre[b].x : centre[a].z - centre[b].z));
    order.forEach((j, k) => {
      const before = order.slice(0, k);
      const wanted = lo(sketched[j], axis);
      const facing = before.filter((i) => separatedOn(i, j, axis) && overlap(rects[i], rects[j], other(axis)) > 0.5);
      if (facing.length) {
        const wall = Math.max(...facing.map((i) => lo(rects[i], axis) + len(rects[i], axis)));
        // A clearly bigger gap on the sketch (a courtyard, an open area) is kept.
        set(rects[j], axis, wanted < wall + Math.max(GAP_TOLERANCE, 0.3 * len(rects[j], axis)) ? wall : wanted);
        return;
      }
      const edges = before.filter((i) => !separatedOn(i, j, axis)).map((i) => lo(rects[i], axis));
      const near = edges.filter((e) => Math.abs(e - wanted) <= GAP_TOLERANCE).sort((a, b) => Math.abs(a - wanted) - Math.abs(b - wanted));
      set(rects[j], axis, near.length ? near[0] : wanted);
    });
  };
  for (let round = 0; round < 3; round++) {
    pass("x");
    pass("z");
  }

  // Anything still overlapping is pushed apart the way the sketch separates it.
  for (let round = 0; round < 5; round++) {
    let moved = false;
    for (let i = 0; i < rects.length; i++) {
      for (let j = 0; j < rects.length; j++) {
        if (i === j || overlap(rects[i], rects[j], "x") <= 0.05 || overlap(rects[i], rects[j], "z") <= 0.05) continue;
        const axis: Axis = sideBySide(i, j) ? "x" : "z";
        if (lo(sketched[i], axis) + len(sketched[i], axis) / 2 > lo(sketched[j], axis) + len(sketched[j], axis) / 2) continue; // handle each pair once, moving the later room
        set(rects[j], axis, lo(rects[i], axis) + len(rects[i], axis));
        moved = true;
      }
    }
    if (!moved) break;
  }

  // Start the floor at 0,0 and tidy floating-point noise (positions are sums of sizes, so walls still meet exactly).
  const minX = Math.min(...rects.map((r) => r.x));
  const minZ = Math.min(...rects.map((r) => r.z));
  const step = rects.every((r) => Number.isInteger(r.w * 2) && Number.isInteger(r.l * 2)) ? 0.5 : 0.1;
  const snap = (v: number) => Math.round(v / step) * step;
  const laid = rects.map((r) => ({ ...r, x: snap(r.x - minX), z: snap(r.z - minZ) }));
  return laid.every((r) => [r.x, r.z, r.w, r.l].every(Number.isFinite)) ? laid : null;
}

/**
 * Sizes every room and, where the sketch shows where rooms are, positions them (feet, per floor).
 * Rooms without a label position are returned without x/z, so placeRooms() packs them as before.
 */
export function layoutSketch(rooms: SketchRoom[]): RoomDraft[] {
  const out: RoomDraft[] = rooms.map((r) => {
    const [w, l] = r.w && r.l ? [r.w, r.l] : defaultSize(r.name);
    return { name: r.name, w, l, h: r.h, floor: r.floor };
  });
  for (const floor of new Set(rooms.map((r) => r.floor))) {
    const idx = rooms.flatMap((r, i) => (r.floor === floor && r.point ? [i] : []));
    if (idx.length < 2) continue; // one room needs no arrangement
    const rects = layoutFloor(idx.map((i) => rooms[i]));
    if (rects) idx.forEach((i, k) => Object.assign(out[i], rects[k]));
  }
  return out;
}
