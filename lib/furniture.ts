// Where furniture goes in a room. Plain geometry in room-local feet (x from the west wall, z from the north wall),
// shared by the Interior Design panel (adding pieces) and the 3D scene (drawing and colliding with them).

import { FURNITURE, pointInRoom, roomWalls, wallCuts, type FurnitureItem, type FurnitureType, type Room, type Rotation, type Wall, type WallEdge } from "@/lib/rooms";

/** How far furniture keeps from the wall line (the wall's plaster sits just inside the room). */
const WALL_GAP = 0.3;
/** Space kept free in front of a door so it can swing and you can walk through. */
const DOOR_CLEARANCE = 2.5;
const STEP = 0.5;

type Rect = { x0: number; z0: number; x1: number; z1: number };

/** Which wall an item's back is against at each rotation (clockwise on the plan). */
const BACK_WALL: Record<Rotation, Wall> = { 0: "n", 90: "e", 180: "s", 270: "w" };
const ROT_FOR_WALL: Record<Wall, Rotation> = { n: 0, e: 90, s: 180, w: 270 };

/** Width (east–west) and length (north–south) the item covers on the plan at its rotation. */
export function footprint(type: FurnitureType, rot: Rotation): { w: number; l: number } {
  const { w, d } = FURNITURE[type];
  return rot === 0 || rot === 180 ? { w, l: d } : { w: d, l: w };
}

export function itemRect(item: Pick<FurnitureItem, "type" | "x" | "z" | "rot">): Rect {
  const { w, l } = footprint(item.type, item.rot);
  return { x0: item.x - w / 2, z0: item.z - l / 2, x1: item.x + w / 2, z1: item.z + l / 2 };
}

const overlaps = (a: Rect, b: Rect, gap = 0) => a.x0 < b.x1 + gap && b.x0 < a.x1 + gap && a.z0 < b.z1 + gap && b.z0 < a.z1 + gap;

/** The room with its north-west corner at 0,0: furniture positions are relative to it. */
const local = (room: Room) => ({ ...room, x: 0, z: 0 });

/**
 * A room's walls in room-local feet, each with the stretches (feet along it, from its start) that are doors or open
 * passages and that are windows.
 */
function localWalls(room: Room, floorRooms: Room[]) {
  return roomWalls(local(room)).map((e) => {
    const shift = e.axis === "x" ? room.x : room.z;
    const cuts = wallCuts(room, e.key, floorRooms).map((c) => ({ kind: c.kind, from: c.from - shift - e.from, to: c.to - shift - e.from }));
    return { edge: e, passages: cuts.filter((c) => c.kind !== "window"), windows: cuts.filter((c) => c.kind === "window") };
  });
}

/** A point `along` feet along a wall and `out` feet into the room from it (room-local). */
function intoRoom(e: WallEdge, along: number, out: number) {
  const a = e.from + along;
  if (e.dir === "n") return { x: a, z: e.at + out };
  if (e.dir === "s") return { x: a, z: e.at - out };
  if (e.dir === "w") return { x: e.at + out, z: a };
  return { x: e.at - out, z: a };
}

/** Whether a rectangle (room-local) is inside the room with WALL_GAP to spare, checked on a half-foot grid. */
function insideRoom(room: Room, r: Rect) {
  const lr = local(room);
  const x0 = r.x0 - WALL_GAP + 0.02, x1 = r.x1 + WALL_GAP - 0.02, z0 = r.z0 - WALL_GAP + 0.02, z1 = r.z1 + WALL_GAP - 0.02;
  if (!room.shape) return x0 >= -0.01 && z0 >= -0.01 && x1 <= room.w + 0.01 && z1 <= room.l + 0.01;
  const nx = Math.max(1, Math.ceil((x1 - x0) / 0.5)), nz = Math.max(1, Math.ceil((z1 - z0) / 0.5));
  for (let i = 0; i <= nx; i++) for (let k = 0; k <= nz; k++) if (!pointInRoom(lr, x0 + ((x1 - x0) * i) / nx, z0 + ((z1 - z0) * k) / nz)) return false;
  return true;
}

/** Keeps an item's centre so the whole piece stays inside the room. */
export function clampToRoom(room: Pick<Room, "w" | "l">, item: Pick<FurnitureItem, "type" | "rot">, x: number, z: number) {
  const { w, l } = footprint(item.type, item.rot);
  // Snapped to a quarter foot first, then kept inside (snapping last could push a piece against the wall past the gap).
  const cx = (v: number, half: number, size: number) =>
    size - 2 * WALL_GAP < 2 * half ? size / 2 : Math.max(WALL_GAP + half, Math.min(size - WALL_GAP - half, Math.round(v * 4) / 4));
  return { x: cx(x, w / 2, room.w), z: cx(z, l / 2, room.l) };
}

/** Areas that must stay clear: in front of every door or open passage (the room's own, and neighbours' on shared walls). */
function doorZones(room: Room, floorRooms: Room[]): Rect[] {
  return localWalls(room, floorRooms).flatMap(({ edge, passages }) =>
    passages.map((c) => {
      const p = intoRoom(edge, c.from - 0.5, 0), q = intoRoom(edge, c.to + 0.5, DOOR_CLEARANCE);
      return { x0: Math.min(p.x, q.x), x1: Math.max(p.x, q.x), z0: Math.min(p.z, q.z), z1: Math.max(p.z, q.z) };
    })
  );
}

/** Tall pieces would rather not stand in front of a window (they do if there's nowhere else). */
const TALL: FurnitureType[] = ["cupboard", "dressing_table", "tv_panel"];
/** Pieces that look best centred on their wall rather than pushed into a corner. */
const CENTRED: FurnitureType[] = ["bed_single", "bed_double", "bed_queen", "bed_king", "sofa", "tv_panel"];

/** Candidate spots with the item's back against a wall, best first. */
function wallSpots(room: Room, type: FurnitureType, floorRooms: Room[]) {
  const { w, d } = FURNITURE[type];
  const spots: { x: number; z: number; rot: Rotation; score: number }[] = [];
  // Longer walls first: a bed or sofa usually goes on one.
  const walls = localWalls(room, floorRooms).sort((a, b) => b.edge.to - b.edge.from - (a.edge.to - a.edge.from));
  walls.forEach(({ edge, windows }, rank) => {
    const len = edge.to - edge.from;
    if (len - 2 * WALL_GAP < w) return;
    for (let a = WALL_GAP + w / 2; a <= len - WALL_GAP - w / 2 + 0.01; a += STEP) {
      const blocksWindow = TALL.includes(type) && windows.some((c) => a - w / 2 < c.to && a + w / 2 > c.from);
      const pos = intoRoom(edge, a, WALL_GAP + d / 2);
      const offCentre = Math.abs(a - len / 2);
      const toCorner = Math.min(a - w / 2, len - a - w / 2);
      spots.push({ ...pos, rot: ROT_FOR_WALL[edge.dir], score: (blocksWindow ? 1000 : 0) + rank * 100 + (CENTRED.includes(type) ? offCentre : toCorner) });
    }
  });
  return spots.sort((p, q) => p.score - q.score);
}

/** Next to an existing bed's head, on either side. */
function besideBed(items: FurnitureItem[]) {
  const spots: { x: number; z: number; rot: Rotation }[] = [];
  for (const bed of items.filter((i) => i.type.startsWith("bed_"))) {
    const { w } = FURNITURE[bed.type];
    const side = FURNITURE.bedside_table;
    const back = BACK_WALL[bed.rot];
    const head = FURNITURE[bed.type].d / 2 - side.d / 2; // from the bed's centre to the table's centre, towards the wall
    const across = w / 2 + side.w / 2 + 0.25; // a little more than the 0.15 ft gap placeFurniture keeps
    for (const s of [-1, 1]) {
      if (back === "n") spots.push({ x: bed.x + s * across, z: bed.z - head, rot: 0 });
      if (back === "s") spots.push({ x: bed.x + s * across, z: bed.z + head, rot: 180 });
      if (back === "w") spots.push({ x: bed.x - head, z: bed.z + s * across, rot: 270 });
      if (back === "e") spots.push({ x: bed.x + head, z: bed.z + s * across, rot: 90 });
    }
  }
  return spots;
}

/**
 * Finds a free spot for a new piece: against a wall (centred for beds and sofas, in a corner for cupboards), clear of
 * doors, other furniture and (for tall pieces) windows. A dining table goes in the middle; a bedside table beside the bed.
 * Null if nothing fits.
 */
export function placeFurniture(room: Room, floorRooms: Room[], items: FurnitureItem[], type: FurnitureType): Omit<FurnitureItem, "id"> | null {
  const blocked = [...doorZones(room, floorRooms), ...items.map(itemRect)];
  const fits = (s: { x: number; z: number; rot: Rotation }) => {
    const r = itemRect({ type, ...s });
    return insideRoom(room, r) && !blocked.some((b) => overlaps(r, b, 0.15));
  };

  let candidates: { x: number; z: number; rot: Rotation }[];
  if (type === "dining_table") {
    candidates = [];
    for (let dz = 0; dz <= room.l / 2; dz += STEP) {
      for (let dx = 0; dx <= room.w / 2; dx += STEP) {
        for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) candidates.push({ x: room.w / 2 + sx * dx, z: room.l / 2 + sz * dz, rot: room.w >= room.l ? 0 : 90 });
      }
    }
  } else {
    candidates = [...(type === "bedside_table" ? besideBed(items) : []), ...wallSpots(room, type, floorRooms)];
  }
  const spot = candidates.find(fits);
  return spot ? { type, ...clampToRoom(room, { type, rot: spot.rot }, spot.x, spot.z), rot: spot.rot } : null;
}

/** A typical set of furniture for a room, by its name (empty for rooms with no usual set). */
export function typicalFurniture(room: Pick<Room, "name" | "w" | "l">): FurnitureType[] {
  const n = room.name.toLowerCase();
  const small = Math.min(room.w, room.l);
  if (n.includes("bedroom") || n.includes("guest")) {
    const bed: FurnitureType = n.includes("master") ? (small >= 12 ? "bed_king" : "bed_queen") : small >= 11 ? "bed_queen" : small >= 9 ? "bed_double" : "bed_single";
    return [bed, "bedside_table", "bedside_table", "cupboard", ...(n.includes("master") ? (["dressing_table"] as const) : [])];
  }
  if (n.includes("living") || n.includes("drawing") || n.includes("family")) return ["sofa", "tv_panel"];
  if (n.includes("dining")) return ["dining_table"];
  if (n.includes("study") || n.includes("office")) return ["study_table", "cupboard"];
  if (n.includes("closet") || n.includes("wardrobe")) return ["cupboard", "cupboard"];
  return [];
}

/** Adds pieces one after another, each placed around the ones before. Returns the new list and how many didn't fit. */
export function addFurniture(room: Room, floorRooms: Room[], items: FurnitureItem[], types: FurnitureType[]): { items: FurnitureItem[]; skipped: number } {
  let next = items;
  let skipped = 0;
  for (const type of types) {
    const spot = placeFurniture(room, floorRooms, next, type);
    if (!spot) {
      skipped++;
      continue;
    }
    next = [...next, { id: Math.max(0, ...next.map((i) => i.id)) + 1, ...spot }];
  }
  return { items: next, skipped };
}
