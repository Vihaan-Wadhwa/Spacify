// Shared types and constants for the design studio.
// Rooms map to the `rooms` table and their doors/windows to `openings`.
//
// Plan coordinates are in feet: x grows east (right), z grows south (down), north is up.

/** A side of a room: north (top on the plan), east, south, west. */
export type Wall = "n" | "e" | "s" | "w";
export const WALLS: Wall[] = ["n", "e", "s", "w"];

export type OpeningKind = "door" | "window";

/** A door or window in one of a room's walls. */
export type Opening = {
  /** Unique within its room. */
  id: number;
  kind: OpeningKind;
  wall: Wall;
  /** feet from the wall's west end (n/s walls) or north end (e/w walls) to the near edge of the opening */
  offset: number;
  /** feet */
  width: number;
};

export type Room = {
  id: number;
  name: string;
  /** width (east–west) in feet */
  w: number;
  /** length (north–south) in feet */
  l: number;
  /** ceiling height in feet */
  h: number;
  floor: number;
  /** west edge on the plan, in feet */
  x: number;
  /** north edge on the plan, in feet */
  z: number;
  openings: Opening[];
};

/** A room before it has a place on the plan or any doors (from a sketch, or picked from the list). */
export type RoomDraft = Pick<Room, "name" | "w" | "l" | "h" | "floor">;

/** Width and length limits the editor keeps rooms within, in feet. */
export const ROOM_SIZE = { min: 4, max: 40 };

/** Opening widths in feet: allowed range and the width a new one starts at. */
export const OPENING_SIZE: Record<OpeningKind, { min: number; max: number; initial: number }> = {
  door: { min: 2, max: 8, initial: 3 },
  window: { min: 1, max: 12, initial: 4 },
};

export type RoomDesign = {
  wallColor?: string;
  flooring?: string;
};

export type LayerName = "walls" | "floors" | "furniture" | "labels" | "grid";
export type Layers = Record<LayerName, boolean>;

export type CameraPreset = "persp" | "top" | "front" | "side";

export type StudioTab = "model" | "plan" | "ai";

export const MAX_FLOORS = 3;

export const DEFAULT_LAYERS: Layers = { walls: true, floors: true, furniture: false, labels: true, grid: true };

export const ROOM_COLORS: Record<string, string> = {
  "Living Room": "#8ecfff",
  "Master Bedroom": "#c8a0ff",
  "Bedroom 2": "#ffb8c8",
  "Bedroom 3": "#ffcfa0",
  Kitchen: "#a0ffcc",
  Bathroom: "#a0e8ff",
  "Pooja Room": "#ffe0a0",
  Study: "#c0f0a0",
  "Walk-in Closet": "#e8c0ff",
  Balcony: "#fff0a0",
  Store: "#d0d0d0",
  Staircase: "#ffaa80",
  "Dining Room": "#ffc8a0",
};
const DEFAULT_ROOM_COLOR = "#cccccc";

export function roomColor(name: string): string {
  return ROOM_COLORS[name] ?? DEFAULT_ROOM_COLOR;
}

/** Default [width, length] in feet when a room is added by hand. */
export const ROOM_DEFAULTS: Record<string, [number, number]> = {
  "Living Room": [18, 14],
  "Master Bedroom": [14, 13],
  "Bedroom 2": [12, 12],
  "Bedroom 3": [12, 11],
  Kitchen: [12, 10],
  "Dining Room": [14, 12],
  Bathroom: [8, 6],
  "Pooja Room": [6, 6],
  Study: [10, 10],
  "Walk-in Closet": [8, 6],
  Balcony: [10, 5],
  Store: [6, 5],
  Staircase: [8, 8],
};
export const ROOM_TYPES = Object.keys(ROOM_DEFAULTS);

export const WALL_PRESETS = [
  "#f5f0e8", "#e8f0f5", "#f0e8f5", "#e8f5ec", "#f5ebe8",
  "#e8ecf5", "#f5f5e8", "#e8f0e8", "#f2e8e8", "#e8e8f2",
];

export const FLOOR_OPTIONS = [
  { name: "White Marble", color: "#f0eeea" },
  { name: "Beige Tiles", color: "#d4c9b0" },
  { name: "Dark Wood", color: "#5c3d1e" },
  { name: "Light Wood", color: "#c8a46e" },
  { name: "Grey Granite", color: "#9e9e9e" },
  { name: "Vitrified", color: "#dde0e3" },
];

export function flooringColor(name: string | undefined): string | undefined {
  return FLOOR_OPTIONS.find((f) => f.name === name)?.color;
}

// ─── Walls and openings ──────────────────────────────────────

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round1 = (v: number) => Math.round(v * 10) / 10;

export function wallLength(room: Pick<Room, "w" | "l">, wall: Wall): number {
  return wall === "n" || wall === "s" ? room.w : room.l;
}

/** A wall as a line on the plan: n/s walls run along x at z = `at`; e/w walls run along z at x = `at`. */
export type WallLine = { axis: "x" | "z"; at: number; from: number; to: number };

export function wallLine(r: Pick<Room, "x" | "z" | "w" | "l">, wall: Wall): WallLine {
  switch (wall) {
    case "n":
      return { axis: "x", at: r.z, from: r.x, to: r.x + r.w };
    case "s":
      return { axis: "x", at: r.z + r.l, from: r.x, to: r.x + r.w };
    case "w":
      return { axis: "z", at: r.x, from: r.z, to: r.z + r.l };
    case "e":
      return { axis: "z", at: r.x + r.w, from: r.z, to: r.z + r.l };
  }
}

/** Keeps every opening inside its wall, shrinking it if the wall is now too short (e.g. after a resize). */
export function fitOpenings(room: Pick<Room, "w" | "l" | "openings">): Opening[] {
  return room.openings.map((o) => {
    const len = wallLength(room, o.wall);
    const width = Math.min(o.width, len);
    const offset = clamp(o.offset, 0, len - width);
    return width === o.width && offset === o.offset ? o : { ...o, width, offset };
  });
}

/** What a new room starts with: a door near the west end of the south wall and a window centred on the north wall. */
export function defaultOpenings(w: number): Opening[] {
  const door = Math.min(OPENING_SIZE.door.initial, w / 2);
  const win = Math.min(OPENING_SIZE.window.initial, w / 2);
  return [
    { id: 1, kind: "door", wall: "s", offset: round1(Math.min(1, (w - door) / 2)), width: door },
    { id: 2, kind: "window", wall: "n", offset: round1((w - win) / 2), width: win },
  ];
}

export type WallCut = { kind: OpeningKind; from: number; to: number };

/**
 * The stretches of a room's wall that are open: its own doors/windows, plus those of any room on the same floor
 * whose wall lies along the same line (a shared wall), so a door between two rooms goes through both walls.
 * `from`/`to` are plan coordinates along the wall's axis.
 */
export function wallCuts(room: Room, wall: Wall, floorRooms: Room[]): WallCut[] {
  const line = wallLine(room, wall);
  const cuts: WallCut[] = [];
  for (const other of floorRooms) {
    for (const o of other.openings) {
      const ol = wallLine(other, o.wall);
      if (ol.axis !== line.axis || Math.abs(ol.at - line.at) > 0.05) continue;
      const from = Math.max(line.from, ol.from + o.offset);
      const to = Math.min(line.to, ol.from + o.offset + o.width);
      if (to - from > 0.05) cuts.push({ kind: o.kind, from, to });
    }
  }
  return cuts.sort((a, b) => a.from - b.from);
}

// ─── Placement ───────────────────────────────────────────────

export type Bounds = { minX: number; minZ: number; maxX: number; maxZ: number };

/** The box around some rooms, or null if there are none. */
export function planBounds(rooms: Room[]): Bounds | null {
  if (!rooms.length) return null;
  return {
    minX: Math.min(...rooms.map((r) => r.x)),
    minZ: Math.min(...rooms.map((r) => r.z)),
    maxX: Math.max(...rooms.map((r) => r.x + r.w)),
    maxZ: Math.max(...rooms.map((r) => r.z + r.l)),
  };
}

/** Where a newly added room goes: against the east side of everything already on its floor, level with the top. */
export function freeSpot(rooms: Room[], floor: number): { x: number; z: number } {
  const b = planBounds(rooms.filter((r) => r.floor === floor));
  return b ? { x: b.maxX, z: b.minZ } : { x: 0, z: 0 };
}

/**
 * Gives rooms that have no position yet (a sketch's rooms) a place and their default door and window.
 * Each floor is packed in rows, left to right with walls touching, wrapping when a row passes 60 ft.
 */
export function placeRooms(drafts: RoomDraft[]): Omit<Room, "id">[] {
  const rows = new Map<number, { x: number; z: number; rowL: number }>();
  return drafts.map((r) => {
    const row = rows.get(r.floor) ?? { x: 0, z: 0, rowL: 0 };
    if (row.x + r.w > 60 && row.x > 0) {
      row.z += row.rowL;
      row.x = 0;
      row.rowL = 0;
    }
    const placed = { ...r, x: row.x, z: row.z, openings: defaultOpenings(r.w) };
    row.x += r.w;
    row.rowL = Math.max(row.rowL, r.l);
    rows.set(r.floor, row);
    return placed;
  });
}

/** Ids of rooms that overlap another room on the same floor (touching walls don't count). */
export function overlappingIds(rooms: Room[]): Set<number> {
  const ids = new Set<number>();
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i];
      const b = rooms[j];
      if (a.floor !== b.floor) continue;
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oz = Math.min(a.z + a.l, b.z + b.l) - Math.max(a.z, b.z);
      if (ox > 0.05 && oz > 0.05) {
        ids.add(a.id);
        ids.add(b.id);
      }
    }
  }
  return ids;
}

/** Sample rooms loaded by /design?demo=1: a 2BHK with shared walls. */
export const DEMO_ROOMS: Omit<Room, "id">[] = (
  [
    { name: "Living Room", w: 18, l: 14, x: 0, z: 0 },
    { name: "Dining Room", w: 14, l: 12, x: 18, z: 0 },
    { name: "Kitchen", w: 12, l: 10, x: 32, z: 0 },
    { name: "Master Bedroom", w: 14, l: 13, x: 0, z: 14 },
    { name: "Bathroom", w: 8, l: 6, x: 14, z: 14 },
    { name: "Bedroom 2", w: 12, l: 12, x: 22, z: 14 },
  ] as const
).map((r) => ({ ...r, h: 10, floor: 1, openings: defaultOpenings(r.w) }));

export function totalArea(rooms: Room[]): number {
  return rooms.reduce((sum, r) => sum + r.w * r.l, 0);
}

/** Plain-English summary of the project, sent to the AI assistant as context. */
export function describeProject(rooms: Room[], floors: number): string {
  if (!rooms.length) return "No rooms added yet.";
  const list = rooms.map((r) => `${r.name} (${r.w}x${r.l} ft, floor ${r.floor})`).join(", ");
  return `The home has ${rooms.length} rooms totalling ${totalArea(rooms)} sq ft: ${list}. Number of floors: ${floors}.`;
}
