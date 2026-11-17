// Builds one room of the house in 3D: floor, walls (with the room's finish on its inner face, and an exterior skin
// where a wall faces outside), doors and windows as real units, skirting, ceiling, roof, stairs, furniture and fittings.
// Also returns what the walkthrough needs: boxes you can't walk through, surfaces you can stand on, doors that swing.

import * as THREE from "three";
import { clampToRoom, footprint } from "@/lib/furniture";
import {
  DEFAULT_DOORS,
  DEFAULT_WINDOWS,
  FURNITURE,
  OPPOSITE,
  cornerConvex,
  defaultDesign,
  doorPartner,
  exteriorSpans,
  isKitchen,
  isSecondLeaf,
  removesWall,
  roomCentre,
  roomRects,
  roomWalls,
  wallCuts,
  wallEdge,
  type Room,
  type RoomDesign,
  type WallEdge,
  type WallKey,
} from "@/lib/rooms";
import { MeshBuilder } from "./build";
import { FT, INNER_T, buildBathroom, buildKitchen, furnitureHeight, furnitureModel, type Collider } from "./fittings";
import type { MaterialLibrary } from "./materials";

export { FT, INNER_T, type Collider };

/** Exterior skin added outside a room's own wall where nothing is on the other side (total ≈ 9-inch brick wall). */
export const OUTER_T = 0.16;
/** Ground floor height above the ground. */
export const PLINTH = 0.3;
/** Floor slab thickness. */
export const SLAB = 0.15;
const DOOR_TOP_FT = 7;
const SILL_FT = 3;
const BALCONY_PARAPET = 1.0;

/** A surface the walker can stand on (world metres). */
export type Platform = { x0: number; x1: number; z0: number; z1: number; y: number };

/** A door the walkthrough swings open as you approach. `sign` is the direction its pivot turns to open. */
export type DoorRig = { leaves: { pivot: THREE.Object3D; sign: number }[]; x: number; z: number; y: number; open: number };

export type RoomBuild = {
  roomId: number;
  floor: number;
  /** Walls, doors, windows, stairs. */
  structure: THREE.Group;
  /** The floor surface; its mesh carries userData.roomId for picking. */
  floorGroup: THREE.Group;
  ceiling: THREE.Group;
  roof: THREE.Group;
  /** Loose furniture, one child group per item (userData.roomId / itemId). */
  furniture: THREE.Group;
  /** Fitted cupboards: cupboard items, kitchen cabinets, the vanity. */
  cupboards: THREE.Group;
  /** Appliances and sanitary ware. */
  fixtures: THREE.Group;
  doors: DoorRig[];
  colliders: Collider[];
  platforms: Platform[];
  /** Where the ceiling light hangs (world). */
  lamp: THREE.Vector3;
  /** Footprint in world metres, and the floor level. */
  bounds: { x0: number; x1: number; z0: number; z1: number; y: number; h: number };
  /** The floor as rectangles in world metres (one for a rectangular room; a shaped room's are its strips). */
  rects: { x0: number; x1: number; z0: number; z1: number }[];
};

export type HouseContext = {
  rooms: Room[];
  floors: number;
  levels: number[];
  /** Plan feet at the world origin. */
  center: { x: number; z: number };
  /** Every room's design: a door shows the design of the room on each side of it. */
  designs: Record<number, RoomDesign>;
  mats: MaterialLibrary;
};

/** Floor heights (world y) by floor number: each floor sits on the tallest room of the one below plus a slab. */
export function floorLevels(rooms: Room[], floors: number): number[] {
  const levels = [0, PLINTH];
  for (let f = 1; f < floors; f++) {
    const tallest = Math.max(10, ...rooms.filter((r) => r.floor === f).map((r) => r.h));
    levels.push(levels[f] + tallest * FT + SLAB);
  }
  return levels;
}

/** The finishes a room shows: its saved design, or sensible defaults (tiled walls in bathrooms). */
export function resolveDesign(room: Room, design: RoomDesign | undefined): Required<Pick<RoomDesign, "walls" | "flooring" | "windows" | "doors">> & RoomDesign {
  const base = design ?? defaultDesign(room.name);
  return { ...base, windows: base.windows ?? DEFAULT_WINDOWS, doors: base.doors ?? DEFAULT_DOORS };
}

const isStair = (r: Room) => /stair/i.test(r.name);
const isBalcony = (r: Room) => /balcony|terrace/i.test(r.name);
const overlap = (a: Room, b: Room) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0.5 && Math.min(a.z + a.l, b.z + b.l) - Math.max(a.z, b.z) > 0.5;

function shadeHex(hex: string, k: number) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, Math.round(v * k))));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * How a staircase room's dog-leg stair runs, in room-local metres. `a` runs along the room's longer side from the
 * entry end (the end nearest its first door), `c` across it. You enter on a strip at the entry end, climb the first
 * flight on one half to a landing at the far end, and come back up the second flight on the other half, arriving above
 * the entry strip on the next floor.
 */
function stairLayout(room: Room) {
  const W = room.w * FT, L = room.l * FT;
  const axis: "x" | "z" = W > L ? "x" : "z";
  const len = (axis === "x" ? W : L) - 2 * INNER_T;
  const wid = (axis === "x" ? L : W) - 2 * INNER_T;
  const door = room.openings.find((o) => o.kind === "door");
  let bottomLow = true;
  if (door) {
    if (axis === "z") bottomLow = door.wall === "n" || ((door.wall === "e" || door.wall === "w") && door.offset + door.width / 2 < room.l / 2);
    else bottomLow = door.wall === "w" || ((door.wall === "n" || door.wall === "s") && door.offset + door.width / 2 < room.w / 2);
  }
  const entry = Math.min(0.9, len * 0.28);
  const landing = Math.min(0.9, len * 0.28);
  /** A rectangle in (a, c) as room-local x0, x1, z0, z1. */
  const rect = (a0: number, a1: number, c0: number, c1: number): [number, number, number, number] => {
    const A0 = bottomLow ? INNER_T + a0 : (axis === "x" ? W : L) - INNER_T - a1;
    const A1 = bottomLow ? INNER_T + a1 : (axis === "x" ? W : L) - INNER_T - a0;
    return axis === "x" ? [A0, A1, INNER_T + c0, INNER_T + c1] : [INNER_T + c0, INNER_T + c1, A0, A1];
  };
  return { axis, len, wid, entry, landing, run: Math.max(0.6, len - entry - landing), bottomLow, rect };
}

/** Builds one room. `floorRooms` are the rooms on the same floor (for shared walls and doors). */
export function buildRoom(room: Room, design: RoomDesign | undefined, ctx: HouseContext): RoomBuild {
  const { mats, levels, center } = ctx;
  const floorRooms = ctx.rooms.filter((r) => r.floor === room.floor);
  const d = resolveDesign(room, design);
  const y0 = levels[room.floor];
  const origin = new THREE.Vector3((room.x - center.x) * FT, y0, (room.z - center.z) * FT);
  const W = room.w * FT, L = room.l * FT, H = room.h * FT;
  const doorTop = Math.min(DOOR_TOP_FT, room.h - 1) * FT;
  const sill = Math.min(SILL_FT, Math.min(DOOR_TOP_FT, room.h - 1) - 1) * FT;
  const balcony = isBalcony(room);
  const below = ctx.rooms.find((r) => r.floor === room.floor - 1 && isStair(r) && isStair(room) && overlap(r, room));
  const above = ctx.rooms.filter((r) => r.floor === room.floor + 1 && overlap(r, room));
  const hasFlight = isStair(room) && room.floor < ctx.floors;

  const walls = new MeshBuilder(origin);
  const floorB = new MeshBuilder(origin);
  const ceilB = new MeshBuilder(origin);
  const roofB = new MeshBuilder(origin);
  const colliders: Collider[] = [];
  const platforms: Platform[] = [];
  const doors: DoorRig[] = [];
  const structure = new THREE.Group();

  const world = (x0: number, x1: number, z0: number, z1: number) => ({ x0: origin.x + x0, x1: origin.x + x1, z0: origin.z + z0, z1: origin.z + z1 });
  const collide = (x0: number, x1: number, z0: number, z1: number, b: number, t: number) => colliders.push({ ...world(x0, x1, z0, z1), y0: y0 + b, y1: y0 + t });

  /** Where a wall line is, in room-local metres across it. */
  const atLocal = (e: WallEdge) => (e.at - (e.axis === "x" ? room.z : room.x)) * FT;
  /**
   * A rectangle (room-local metres x0, x1, z0, z1) against a wall: `a`–`b` plan feet along it, `c0`–`c1` metres in
   * from the wall line towards the room (negative = outside it).
   */
  const edgeRect = (e: WallEdge, a: number, bb: number, c0: number, c1: number): [number, number, number, number] => {
    const base = e.axis === "x" ? room.x : room.z;
    const p0 = (a - base) * FT, p1 = (bb - base) * FT;
    const at = atLocal(e);
    const [q0, q1] = e.dir === "n" || e.dir === "w" ? [at + c0, at + c1] : [at - c1, at - c0];
    return e.axis === "x" ? [p0, p1, q0, q1] : [q0, q1, p0, p1];
  };
  /** A box against a wall (see edgeRect), `bottom`–`top` metres up from the floor. */
  const wallBox = (b: MeshBuilder, e: WallEdge, a: number, bb: number, bottom: number, top: number, c0: number, c1: number, mat: THREE.Material, solid = true) => {
    if (bb - a < 0.01 || top - bottom < 0.005) return;
    const [x0, x1, z0, z1] = edgeRect(e, a, bb, c0, c1);
    b.box(x1 - x0, top - bottom, z1 - z0, mat, (x0 + x1) / 2, (bottom + top) / 2, (z0 + z1) / 2);
    if (solid) collide(x0, x1, z0, z1, bottom, top);
  };
  /** The room's floor as rectangles in room-local metres. */
  const localRects = roomRects(room).map((q) => ({ x0: (q.x - room.x) * FT, x1: (q.x + q.w - room.x) * FT, z0: (q.z - room.z) * FT, z1: (q.z + q.l - room.z) * FT }));

  // ─── Floor ───────────────────────────────────────────────
  // An upper staircase room only has floor on the landing; the rest is the stairwell above the flight below.
  let floorRects = localRects;
  if (below) {
    // Keep only the strip over the stair's entry end (where the second flight arrives).
    const [sx0, sx1, sz0, sz1] = stairLayout(below).rect(-INNER_T, stairLayout(below).entry, -INNER_T, 99);
    const bx = (below.x - room.x) * FT, bz = (below.z - room.z) * FT;
    floorRects = [{ x0: Math.max(0, bx + sx0), x1: Math.min(W, bx + sx1), z0: Math.max(0, bz + sz0), z1: Math.min(L, bz + sz1) }];
  }
  for (const f of floorRects) {
    floorB.box(f.x1 - f.x0, 0.02, f.z1 - f.z0, mats.floor(d.flooring), (f.x0 + f.x1) / 2, -0.01, (f.z0 + f.z1) / 2);
    floorB.box(f.x1 - f.x0, SLAB - 0.02, f.z1 - f.z0, mats.ceiling, (f.x0 + f.x1) / 2, -0.02 - (SLAB - 0.02) / 2, (f.z0 + f.z1) / 2, { cast: true });
    platforms.push({ ...world(f.x0, f.x1, f.z0, f.z1), y: y0 });
  }

  // ─── Walls ───────────────────────────────────────────────
  const finish = mats.wall(d.walls);
  const edges = roomWalls(room);
  const ext = new Map(edges.map((e) => [e.key, exteriorSpans(room, e.key, floorRooms)]));
  const isExtAt = (wall: WallKey, ft: number) => ext.get(wallEdge(room, wall).key)!.some(([a, b]) => ft >= a - 0.05 && ft <= b + 0.05);
  /** Whether the north–south wall through a corner (x, z) faces outside there. */
  const sideOutsideAt = (x: number, z: number) => edges.some((f) => f.axis === "z" && Math.abs(f.at - x) < 0.05 && z >= f.from - 0.05 && z <= f.to + 0.05 && isExtAt(f.key, z));

  for (const line of edges) {
    const wall = line.key;
    const cuts = wallCuts(room, wall, floorRooms);
    /**
     * Splits [from, to] into solid runs and openings. An open gap across a whole shared wall is "gone" (the wall was
     * removed, joining the rooms); a shorter one is a doorless passage with a lintel.
     */
    const segments = (from: number, to: number) => {
      const out: { a: number; b: number; kind: "solid" | "door" | "window" | "open" | "gone" }[] = [];
      let at = from;
      for (const c of cuts) {
        const a = Math.max(c.from, from), b = Math.min(c.to, to);
        if (b - a < 0.01) continue;
        if (a > at) out.push({ a: at, b: a, kind: "solid" });
        const kind = c.kind === "open" && removesWall(room, wall, c.from, c.to, floorRooms) ? "gone" : c.kind;
        out.push({ a: Math.max(a, at), b, kind });
        at = Math.max(at, b);
      }
      if (to > at) out.push({ a: at, b: to, kind: "solid" });
      return out;
    };
    const pieces = (b: MeshBuilder, from: number, to: number, bottom: number, top: number, c0: number, c1: number, mat: THREE.Material) => {
      for (const s of segments(from, to)) {
        if (s.kind === "solid") wallBox(b, line, s.a, s.b, bottom, top, c0, c1, mat);
        else if (s.kind === "door" || s.kind === "open") wallBox(b, line, s.a, s.b, doorTop, top, c0, c1, mat);
        else if (s.kind === "window") {
          wallBox(b, line, s.a, s.b, bottom, sill, c0, c1, mat);
          wallBox(b, line, s.a, s.b, doorTop, top, c0, c1, mat);
          collide(...edgeRect(line, s.a, s.b, c0, c1), sill, doorTop); // the glass
        }
      }
    };

    const parapetOnly = balcony;
    const top = (a: number, b: number) => (parapetOnly && isExtAt(wall, (a + b) / 2) ? BALCONY_PARAPET : H);
    // The room's own wall: plaster body with the finish as a thin face on the inside, and skirting. At a notch in a
    // shaped room (an inward corner) it runs on by the wall's thickness, so the two walls meet without a gap.
    const chunks = splitByExterior(line.from, line.to, ext.get(wall)!);
    if (chunks.length && !cornerConvex(room, line, "from")) chunks[0][0] -= INNER_T / FT;
    if (chunks.length && !cornerConvex(room, line, "to")) chunks[chunks.length - 1][1] += INNER_T / FT;
    for (const [a, b] of chunks) {
      const t = top(a, b);
      pieces(walls, a, b, 0, t, 0, INNER_T - 0.006, mats.plaster);
      pieces(walls, a, b, 0, t, INNER_T - 0.006, INNER_T, t < H ? mats.plaster : finish);
      for (const s of segments(a, b)) if (s.kind === "solid" || s.kind === "window") wallBox(walls, line, s.a, s.b, 0, 0.09, INNER_T, INNER_T + 0.012, mats.skirting, false);
    }
    // Exterior skin, carried round the house's outside corners; down to the ground on the ground floor.
    for (const [a0, b0] of ext.get(wall)!) {
      let a = a0, b = b0;
      if (line.axis === "x") {
        if (Math.abs(a - line.from) < 0.05 && cornerConvex(room, line, "from") && sideOutsideAt(line.from, line.at)) a -= OUTER_T / FT;
        if (Math.abs(b - line.to) < 0.05 && cornerConvex(room, line, "to") && sideOutsideAt(line.to, line.at)) b += OUTER_T / FT;
      }
      const bottom = room.floor === 1 ? -PLINTH : -SLAB;
      const t = parapetOnly ? BALCONY_PARAPET : H + SLAB;
      pieces(walls, a, b, bottom, t, -OUTER_T, 0, mats.exterior);
      if (parapetOnly) wallBox(walls, line, a, b, t, t + 0.05, -OUTER_T - 0.02, INNER_T + 0.02, mats.concrete);
      if (room.floor === 1) wallBox(walls, line, a - (a < a0 ? 0.08 : 0), b + (b > b0 ? 0.08 : 0), -PLINTH, 0.02, -OUTER_T - 0.025, -OUTER_T + 0.01, mats.plinth, false);
    }
  }

  // ─── Doors and windows (this room's own) ─────────────────
  // Two doors side by side make one double door, built once from its first leaf.
  for (const o of room.openings) {
    if (o.kind === "open" || isSecondLeaf(room.openings, o)) continue; // open gaps are just the missing wall
    const partner = doorPartner(room.openings, o);
    const line = wallEdge(room, o.wall);
    const a = line.from + o.offset;
    const b = Math.min(line.to, a + o.width + (partner?.width ?? 0));
    if (b - a < 0.1) continue;
    const exterior = isExtAt(o.wall, (a + b) / 2);
    const depthOut = exterior ? OUTER_T : INNER_T;
    const base = line.axis === "x" ? room.x : room.z;
    const la = (a - base) * FT, lb = (b - base) * FT;
    const at = atLocal(line);
    const frame = { n: [la, at, 0], s: [lb, at, Math.PI], w: [at, lb, Math.PI / 2], e: [at, la, -Math.PI / 2] }[line.dir];
    const unit = { x: frame[0], z: frame[1], rot: frame[2] };
    const width = lb - la;
    if (o.kind === "window") {
      if (!(balcony && exterior)) buildWindow(walls, structure, mats, d.windows, unit, width, sill, doorTop, depthOut, exterior, origin);
    } else {
      // Each face of the door takes the design of the room it faces.
      const across = roomAcross(room, o.wall, (a + b) / 2, floorRooms);
      const outside = across ? resolveDesign(across, ctx.designs[across.id]).doors : d.doors;
      const rig = buildDoor(walls, structure, mats, { inside: d.doors, outside }, unit, width, doorTop, depthOut, partner ? 2 : 1, line.dir === "n" || line.dir === "e", origin);
      const mid = { x: unit.x + Math.cos(unit.rot) * (width / 2), z: unit.z - Math.sin(unit.rot) * (width / 2) };
      doors.push({ ...rig, x: origin.x + mid.x, z: origin.z + mid.z, y: y0 });
      if (exterior && room.floor === 1) entranceSteps(walls, mats, unit, width, depthOut, platforms, origin);
    }
  }

  // ─── Stairs ──────────────────────────────────────────────
  if (hasFlight) buildFlight(walls, mats, room, levels[room.floor + 1] - y0, origin, platforms, colliders);

  // ─── Ceiling and roof ────────────────────────────────────
  const centre = roomCentre(room);
  const lx = (centre.x - room.x) * FT, lz = (centre.z - room.z) * FT;
  const lamp = new THREE.Vector3(origin.x + lx, y0 + H - 0.3, origin.z + lz);
  const coveredAbove = above.some((r) => !isBalcony(r));
  if (!(balcony && !coveredAbove) && !hasFlight) {
    for (const f of localRects) ceilB.box(f.x1 - f.x0, 0.02, f.z1 - f.z0, mats.ceiling, (f.x0 + f.x1) / 2, H + 0.01, (f.z0 + f.z1) / 2, { cast: true });
    ceilB.cylinder(0.2, 0.2, 0.025, mats.lamp, lx, H - 0.0125, lz, { cast: false, segments: 32 });
  }
  if (!coveredAbove && !balcony) {
    for (const f of localRects) roofB.box(f.x1 - f.x0, SLAB, f.z1 - f.z0, mats.roof, (f.x0 + f.x1) / 2, H + 0.02 + SLAB / 2, (f.z0 + f.z1) / 2);
    for (const e of edges) {
      for (const [a, b] of ext.get(e.key)!) {
        wallBox(roofB, e, a, b, H + SLAB, H + SLAB + 0.9, -OUTER_T, 0.05, mats.exterior, false);
        wallBox(roofB, e, a, b, H + SLAB + 0.9, H + SLAB + 0.95, -OUTER_T - 0.03, 0.08, mats.concrete, false);
      }
    }
  }

  const wallMeshes = walls.build({ roomId: room.id, type: "wall" });
  wallMeshes.position.copy(origin);
  structure.add(wallMeshes);

  // ─── Furniture and fittings ──────────────────────────────
  const furniture = new THREE.Group();
  const cupboards = new THREE.Group();
  const fixtures = new THREE.Group();
  for (const item of d.furniture ?? []) {
    const model = furnitureModel(item.type, mats);
    const pos = clampToRoom(room, item, item.x, item.z);
    model.position.set(origin.x + pos.x * FT, y0, origin.z + pos.z * FT);
    model.rotation.y = (-item.rot * Math.PI) / 180;
    model.userData = { roomId: room.id, itemId: item.id };
    (FURNITURE[item.type].cupboard ? cupboards : furniture).add(model);
    const fp = footprint(item.type, item.rot);
    collide((pos.x - fp.w / 2) * FT, (pos.x + fp.w / 2) * FT, (pos.z - fp.l / 2) * FT, (pos.z + fp.l / 2) * FT, 0, furnitureHeight(item.type));
  }
  const fitted = isKitchen(room.name) && d.kitchen ? buildKitchen(room, floorRooms, mats, origin) : buildBathroom(room, floorRooms, mats, origin);
  if (fitted) {
    const place = (g: THREE.Group) => {
      g.position.copy(origin);
      return g;
    };
    if (!fitted.cupboards.empty) cupboards.add(place(fitted.cupboards.build()));
    if (!fitted.appliances.empty) fixtures.add(place(fitted.appliances.build()));
    colliders.push(...fitted.colliders);
  }

  const floorGroup = floorB.build({ roomId: room.id, type: "floor" });
  const ceiling = ceilB.build();
  const roof = roofB.build();
  for (const g of [floorGroup, ceiling, roof]) g.position.copy(origin);

  return {
    roomId: room.id,
    floor: room.floor,
    structure,
    floorGroup,
    ceiling,
    roof,
    furniture,
    cupboards,
    fixtures,
    doors,
    colliders,
    platforms,
    lamp,
    bounds: { x0: origin.x, x1: origin.x + W, z0: origin.z, z1: origin.z + L, y: y0, h: H },
    rects: localRects.map((f) => world(f.x0, f.x1, f.z0, f.z1)),
  };
}

/** The room on the other side of a wall at `along` (plan feet along the wall), if any. */
function roomAcross(room: Room, wall: WallKey, along: number, floorRooms: Room[]): Room | undefined {
  const e = wallEdge(room, wall);
  return floorRooms.find(
    (o) => o.id !== room.id && roomWalls(o).some((l) => l.dir === OPPOSITE[e.dir] && Math.abs(l.at - e.at) < 0.1 && along > l.from && along < l.to)
  );
}

/** Splits a wall into stretches that are wholly outside-facing or wholly shared (so a balcony's parapet can differ). */
function splitByExterior(from: number, to: number, ext: [number, number][]): [number, number][] {
  const cuts = [from, ...ext.flat(), to].filter((v, i, all) => v >= from && v <= to && all.indexOf(v) === i).sort((p, q) => p - q);
  const out: [number, number][] = [];
  for (let i = 0; i < cuts.length - 1; i++) if (cuts[i + 1] - cuts[i] > 0.01) out.push([cuts[i], cuts[i + 1]]);
  return out;
}

type Unit = { x: number; z: number; rot: number };

/** Builds a moving part (door leaf, casement) as its own group, positioned at a hinge in a unit's frame. */
function hingedGroup(parent: THREE.Group, origin: THREE.Vector3, unit: Unit, hx: number, hz: number, build: (b: MeshBuilder) => void) {
  const b = new MeshBuilder(origin);
  build(b);
  const pivot = new THREE.Group();
  const local = new THREE.Vector3(hx, 0, hz).applyAxisAngle(new THREE.Vector3(0, 1, 0), unit.rot);
  pivot.position.set(origin.x + unit.x + local.x, origin.y, origin.z + unit.z + local.z);
  const leafHolder = new THREE.Group();
  leafHolder.rotation.y = unit.rot;
  leafHolder.add(b.build());
  pivot.add(leafHolder);
  parent.add(pivot);
  return leafHolder;
}

function buildWindow(
  b: MeshBuilder,
  parent: THREE.Group,
  mats: MaterialLibrary,
  spec: NonNullable<RoomDesign["windows"]>,
  unit: Unit,
  width: number,
  sill: number,
  head: number,
  depthOut: number,
  exterior: boolean,
  origin: THREE.Vector3
) {
  b.setFrame(unit.x, 0, unit.z, unit.rot);
  const frameMat = spec.frame === "wood" ? mats.wood(spec.color, spec.polish) : mats.aluminium(spec.color);
  const fw = spec.frame === "wood" ? 0.07 : 0.05;
  const fd = 0.08;
  const zc = (INNER_T - depthOut) / 2;
  const h = head - sill;
  // Reveals, frame and sills
  b.box(width, 0.025, INNER_T + depthOut + 0.04, mats.sill, width / 2, sill + 0.0125, zc + 0.02);
  b.box(fw, h, fd, frameMat, fw / 2, sill + h / 2, zc);
  b.box(fw, h, fd, frameMat, width - fw / 2, sill + h / 2, zc);
  b.box(width, fw, fd, frameMat, width / 2, head - fw / 2, zc);
  b.box(width, fw, fd, frameMat, width / 2, sill + 0.025 + fw / 2, zc);
  if (exterior) {
    // Sunshade (chajja) over the window and a drip sill under it
    b.box(width + 0.3, 0.07, 0.45, mats.concrete, width / 2, head + 0.12, -depthOut - 0.225);
    b.box(width + 0.08, 0.04, 0.06, mats.concrete, width / 2, sill - 0.02, -depthOut - 0.03);
  }
  const iw = width - 2 * fw, ih = h - fw - 0.025 - fw, iy = sill + 0.025 + fw;
  const sash = (bb: MeshBuilder, x0: number, w: number, z: number, glassMat: THREE.Material) => {
    const s = 0.04;
    bb.box(w, s, 0.03, frameMat, x0 + w / 2, iy + s / 2, z);
    bb.box(w, s, 0.03, frameMat, x0 + w / 2, iy + ih - s / 2, z);
    bb.box(s, ih, 0.03, frameMat, x0 + s / 2, iy + ih / 2, z);
    bb.box(s, ih, 0.03, frameMat, x0 + w - s / 2, iy + ih / 2, z);
    bb.box(w - 2 * s, ih - 2 * s, 0.006, glassMat, x0 + w / 2, iy + ih / 2, z, { cast: false, ownUv: true });
  };
  if (spec.type === "fixed") {
    b.box(iw, ih, 0.008, mats.glass, fw + iw / 2, iy + ih / 2, zc, { cast: false, ownUv: true });
  } else if (spec.type === "sliding" || spec.type === "mesh") {
    const sw = iw / 2 + 0.03;
    sash(b, fw, sw, zc - 0.018, mats.glass);
    sash(b, fw + iw - sw, sw, zc + 0.018, mats.glass);
    b.box(0.015, 0.12, 0.02, mats.handle, fw + iw - sw + 0.03, iy + ih / 2, zc + 0.04);
    if (spec.type === "mesh") sash(b, fw, sw, zc + 0.05, mats.insectMesh);
  } else {
    // Casement: side-hung leaves, standing a little open to the outside
    const leaves = iw > 0.75 ? 2 : 1;
    const lw = iw / leaves;
    for (let i = 0; i < leaves; i++) {
      const left = i === 0;
      const hx = left ? fw : width - fw;
      const holder = hingedGroup(parent, origin, unit, hx, zc - 0.02, (bb) => sash(bb, left ? 0 : -lw, lw, 0, mats.glass));
      holder.parent!.rotation.y = left ? 0.45 : -0.45;
      holder.position.set(0, 0, 0);
      const hb = new MeshBuilder();
      hb.box(0.02, 0.1, 0.03, mats.handle, left ? lw - 0.05 : -lw + 0.05, iy + ih / 2, 0.03);
      holder.add(hb.build());
    }
    if (leaves === 2) b.box(0.02, ih, fd * 0.6, frameMat, width / 2, iy + ih / 2, zc);
  }
  b.resetFrame();
}

type DoorSpec = NonNullable<RoomDesign["doors"]>;

/**
 * A door unit: frame, architraves, threshold and its leaf (or two leaves for a double door).
 * `inside` styles the faces towards this room, `outside` the faces towards the room (or garden) beyond.
 */
function buildDoor(
  b: MeshBuilder,
  parent: THREE.Group,
  mats: MaterialLibrary,
  specs: { inside: DoorSpec; outside: DoorSpec },
  unit: Unit,
  width: number,
  head: number,
  depthOut: number,
  count: 1 | 2,
  hingeAtStart: boolean,
  origin: THREE.Vector3
): Pick<DoorRig, "leaves" | "open"> {
  const woodIn = mats.wood(specs.inside.color, specs.inside.polish);
  const woodOut = mats.wood(specs.outside.color, specs.outside.polish);
  const jw = 0.06;
  const depth = INNER_T + depthOut;
  const zc = (INNER_T - depthOut) / 2;
  b.setFrame(unit.x, 0, unit.z, unit.rot);
  // Frame (chaukhat) and architraves on both faces
  b.box(jw, head, depth, woodIn, jw / 2, head / 2, zc);
  b.box(jw, head, depth, woodIn, width - jw / 2, head / 2, zc);
  b.box(width, jw, depth, woodIn, width / 2, head - jw / 2, zc);
  for (const [face, wood] of [[INNER_T + 0.008, woodIn], [-depthOut - 0.008, woodOut]] as const) {
    b.box(0.07, head + 0.07, 0.016, wood, -0.035 + jw / 2, (head + 0.07) / 2, face);
    b.box(0.07, head + 0.07, 0.016, wood, width + 0.035 - jw / 2, (head + 0.07) / 2, face);
    b.box(width + 0.14 - jw, 0.07, 0.016, wood, width / 2, head + 0.035, face);
  }
  b.box(width, 0.012, depth + 0.02, mats.threshold, width / 2, 0.006, zc);
  b.resetFrame();

  const leaves: DoorRig["leaves"] = [];
  const lw = (width - 2 * jw) / count - 0.004;
  const lh = head - jw - 0.012;
  const lz = INNER_T - 0.03;
  for (let i = 0; i < count; i++) {
    const atStart = count === 2 ? i === 0 : hingeAtStart;
    const hx = atStart ? jw + 0.002 : width - jw - 0.002;
    const dir = atStart ? 1 : -1; // which way the leaf extends from its hinge
    const holder = hingedGroup(parent, origin, unit, hx, lz, (bb) => {
      doorFace(bb, mats, specs.inside, lw, lh, dir, 1);
      doorFace(bb, mats, specs.outside, lw, lh, dir, -1);
      for (const hy of [0.25, lh / 2, lh - 0.25]) bb.cylinder(0.009, 0.009, 0.1, mats.chrome, dir * 0.002, 0.01 + hy, 0.01);
    });
    leaves.push({ pivot: holder.parent!, sign: atStart ? -1 : 1 });
  }
  return { leaves, open: 0 };
}

/**
 * One face (half the thickness) of a door leaf, from its hinge (x = 0) out to x = dir·w, bottom at y = 0.01.
 * `side` is +1 for the face towards this room, −1 for the other.
 */
function doorFace(b: MeshBuilder, mats: MaterialLibrary, spec: DoorSpec, w: number, h: number, dir: number, side: 1 | -1) {
  const wood = mats.wood(spec.color, spec.polish);
  const dark = mats.wood(shadeHex(spec.color, 0.55), spec.polish);
  const T = 0.04;
  const x = (v: number) => dir * v;
  const y0 = 0.01;
  /** A slab of the leaf `t` thick in total, of which this face builds its half. */
  const rect = (x0: number, x1: number, ya: number, yb: number, t: number, mat: THREE.Material, opts?: { ownUv?: boolean; cast?: boolean }) =>
    b.box(x1 - x0, yb - ya, t / 2, mat, x((x0 + x1) / 2), y0 + (ya + yb) / 2, (side * t) / 4, opts);
  if (spec.style === "flush") {
    rect(0, w, 0, h, T, wood);
  } else if (spec.style === "grooved") {
    rect(0, w, 0, h, T, wood);
    for (let i = 1; i <= 6; i++) rect(0.08, w - 0.08, (h * i) / 7 - 0.003, (h * i) / 7 + 0.003, T + 0.002, dark);
  } else {
    const stile = 0.11;
    const rails: [number, number][] = spec.style === "glass" ? [[0, 0.2], [h * 0.42, h * 0.42 + 0.12], [h - 0.11, h]] : [[0, 0.2], [h * 0.45, h * 0.45 + 0.14], [h - 0.11, h]];
    rect(0, stile, 0, h, T, wood);
    rect(w - stile, w, 0, h, T, wood);
    for (const [ya, yb] of rails) rect(stile, w - stile, ya, yb, T, wood);
    const panels: [number, number][] = [[rails[0][1], rails[1][0]], [rails[1][1], rails[2][0]]];
    panels.forEach(([ya, yb], i) => {
      if (spec.style === "glass" && i === 1) {
        rect(stile, w - stile, ya, yb, 0.008, mats.frostedGlass, { ownUv: true, cast: false });
        rect(w / 2 - 0.015, w / 2 + 0.015, ya, yb, 0.03, wood);
        rect(stile, w - stile, (ya + yb) / 2 - 0.015, (ya + yb) / 2 + 0.015, 0.03, wood);
      } else {
        // Recessed panel with a raised field in the middle
        rect(stile, w - stile, ya, yb, T * 0.55, dark);
        rect(stile + 0.04, w - stile - 0.04, ya + 0.04, yb - 0.04, T * 0.8, wood);
      }
    });
  }
  // Lever handle on this face
  b.box(0.03, 0.16, 0.008, mats.chrome, x(w - 0.07), y0 + 1.0, side * (T / 2 + 0.004));
  b.box(0.12, 0.018, 0.02, mats.chrome, x(w - 0.1), y0 + 1.03, side * (T / 2 + 0.02));
}

/** Two steps down from an outside door to the ground. */
function entranceSteps(b: MeshBuilder, mats: MaterialLibrary, unit: Unit, width: number, depthOut: number, platforms: Platform[], origin: THREE.Vector3) {
  b.setFrame(unit.x, 0, unit.z, unit.rot);
  const z = -depthOut;
  b.box(width + 0.5, PLINTH * 0.5, 0.35, mats.threshold, width / 2, -PLINTH * 0.75, z - 0.175);
  b.box(width + 0.5, PLINTH * 0.5, 0.35, mats.threshold, width / 2, -PLINTH * 0.25, z - 0.175);
  b.box(width + 0.7, PLINTH * 0.5, 0.3, mats.threshold, width / 2, -PLINTH * 0.75, z - 0.5);
  const p0 = b.toSpace(-0.25, 0, z - 0.35), p1 = b.toSpace(width + 0.25, 0, z);
  platforms.push({ x0: origin.x + Math.min(p0.x, p1.x), x1: origin.x + Math.max(p0.x, p1.x), z0: origin.z + Math.min(p0.z, p1.z), z1: origin.z + Math.max(p0.z, p1.z), y: origin.y });
  const q0 = b.toSpace(-0.35, 0, z - 0.65), q1 = b.toSpace(width + 0.35, 0, z - 0.35);
  platforms.push({ x0: origin.x + Math.min(q0.x, q1.x), x1: origin.x + Math.max(q0.x, q1.x), z0: origin.z + Math.min(q0.z, q1.z), z1: origin.z + Math.max(q0.z, q1.z), y: origin.y - PLINTH * 0.5 });
  b.resetFrame();
}

/** A dog-leg stair up to the next floor (see stairLayout). Each tread is a surface the walker can climb. */
function buildFlight(b: MeshBuilder, mats: MaterialLibrary, room: Room, rise: number, origin: THREE.Vector3, platforms: Platform[], colliders: Collider[]) {
  const s = stairLayout(room);
  const half = s.wid / 2;
  const perFlight = Math.max(2, Math.ceil(rise / 2 / 0.19));
  const riser = rise / (perFlight * 2);
  const tread = s.run / perFlight;
  const add = (a0: number, a1: number, c0: number, c1: number, bottom: number, top: number, mat: THREE.Material, walk: boolean, solid = false) => {
    const [x0, x1, z0, z1] = s.rect(a0, a1, c0, c1);
    b.box(x1 - x0, top - bottom, z1 - z0, mat, (x0 + x1) / 2, (bottom + top) / 2, (z0 + z1) / 2);
    if (walk) platforms.push({ x0: origin.x + x0, x1: origin.x + x1, z0: origin.z + z0, z1: origin.z + z1, y: origin.y + top });
    if (solid) colliders.push({ x0: origin.x + x0, x1: origin.x + x1, z0: origin.z + z0, z1: origin.z + z1, y0: origin.y + bottom, y1: origin.y + top });
  };
  // First flight: up along the first half, away from the entry
  for (let i = 0; i < perFlight; i++) {
    const a0 = s.entry + i * tread, top = (i + 1) * riser;
    add(a0, a0 + tread + 0.02, 0, half, 0, top - 0.03, mats.concrete, false);
    add(a0, a0 + tread + 0.02, 0, half, top - 0.03, top, mats.threshold, true);
  }
  // Mid landing across the far end
  const mid = perFlight * riser;
  add(s.entry + s.run, s.len, 0, s.wid, 0, mid - 0.03, mats.concrete, false);
  add(s.entry + s.run, s.len, 0, s.wid, mid - 0.03, mid, mats.threshold, true);
  // Second flight: back towards the entry on the other half
  for (let i = 0; i < perFlight; i++) {
    const a1 = s.entry + s.run - i * tread, top = mid + (i + 1) * riser;
    add(a1 - tread - 0.02, a1, half, s.wid, 0, top - 0.03, mats.concrete, false);
    add(a1 - tread - 0.02, a1, half, s.wid, top - 0.03, top, mats.threshold, true);
  }
  // Dividing wall between the flights, and a rail where the upper floor meets the stairwell over the first flight
  add(s.entry, s.entry + s.run, half - 0.06, half + 0.06, 0, mid + 1.0, mats.plaster, false, true);
  add(s.entry - 0.03, s.entry + 0.02, 0, half - 0.06, rise + 0.9, rise + 0.95, mats.rail, false);
  for (let c = 0.05; c < half - 0.06; c += 0.12) add(s.entry - 0.02, s.entry + 0.01, c, c + 0.02, rise, rise + 0.9, mats.rail, false);
  add(s.entry - 0.03, s.entry + 0.02, 0, half - 0.06, rise, rise + 0.95, mats.rail, false, true);
}

/** Room-local feet → world metres, for furniture dragging. */
export function roomOrigin(room: Room, ctx: Pick<HouseContext, "levels" | "center">) {
  return new THREE.Vector3((room.x - ctx.center.x) * FT, ctx.levels[room.floor], (room.z - ctx.center.z) * FT);
}
