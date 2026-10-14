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

/**
 * A room before it has any doors (from a sketch, or picked from the list).
 * `x`/`z` are set when the sketch showed where the room is; otherwise placeRooms() finds it a spot.
 */
export type RoomDraft = Pick<Room, "name" | "w" | "l" | "h" | "floor"> & Partial<Pick<Room, "x" | "z">>;

/** Width and length limits the editor keeps rooms within, in feet. */
export const ROOM_SIZE = { min: 4, max: 40 };

/** Opening widths in feet: allowed range and the width a new one starts at. */
export const OPENING_SIZE: Record<OpeningKind, { min: number; max: number; initial: number }> = {
  door: { min: 2, max: 8, initial: 3 },
  window: { min: 1, max: 12, initial: 4 },
};

// ─── Room designs (MongoDB `room_designs`, one document per room) ───
// The same enums are enforced by the collection's $jsonSchema validator (db/mongo-validator.json).

export const WALL_FINISHES = ["paint", "tiles", "marble", "wallpaper", "wood_panel"] as const;
export const FLOOR_MATERIALS = ["marble", "vitrified", "tiles", "wood", "granite"] as const;
export const CEILING_TYPES = ["plain", "pop", "gypsum", "wood"] as const;
export const KITCHEN_LAYOUTS = ["L", "U", "parallel", "island", "straight"] as const;

export type WallFinish = (typeof WALL_FINISHES)[number];
export type FloorMaterial = (typeof FLOOR_MATERIALS)[number];
export type CeilingType = (typeof CEILING_TYPES)[number];
export type KitchenLayout = (typeof KITCHEN_LAYOUTS)[number];

/** A room's finishes. Walls and flooring are always set; the rest only when chosen (kitchen only for kitchens). */
export type RoomDesign = {
  walls: { finish: WallFinish; color: string };
  flooring: { material: FloorMaterial; name: string; color: string };
  ceiling?: { type: CeilingType };
  lighting?: { type: string; count: number }[];
  kitchen?: { layout: KitchenLayout; countertop: string };
};

export const WALL_FINISH_LABELS: Record<WallFinish, string> = {
  paint: "Paint",
  tiles: "Tiles",
  marble: "Marble",
  wallpaper: "Wallpaper",
  wood_panel: "Wood panel",
};

export const KITCHEN_LAYOUT_LABELS: Record<KitchenLayout, string> = {
  L: "L",
  U: "U",
  parallel: "Parallel",
  island: "Island",
  straight: "Straight",
};

export const isKitchen = (roomType: string) => /kitchen/i.test(roomType);

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
  "Drawing Room": "#9ec5ff",
  Passage: "#bfc4cc",
  Other: "#d8c8b0",
};
const DEFAULT_ROOM_COLOR = "#cccccc";

export function roomColor(name: string): string {
  return ROOM_COLORS[name] ?? DEFAULT_ROOM_COLOR;
}

/** Default [width, length] in feet when a room is added by hand. */
export const ROOM_DEFAULTS: Record<string, [number, number]> = {
  "Living Room": [18, 14],
  "Drawing Room": [18, 14],
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
  // Anything else (office, gaming room, gym, guest room…): the user or the sketch gives it its own name.
  Other: [10, 10],
};
export const ROOM_TYPES = Object.keys(ROOM_DEFAULTS);
/** The room type whose name is chosen by the user. */
export const OTHER_ROOM = "Other";

export const WALL_PRESETS = [
  "#f5f0e8", "#e8f0f5", "#f0e8f5", "#e8f5ec", "#f5ebe8",
  "#e8ecf5", "#f5f5e8", "#e8f0e8", "#f2e8e8", "#e8e8f2",
];

export const FLOOR_OPTIONS: RoomDesign["flooring"][] = [
  { material: "marble", name: "White Marble", color: "#f0eeea" },
  { material: "tiles", name: "Beige Tiles", color: "#d4c9b0" },
  { material: "wood", name: "Dark Wood", color: "#5c3d1e" },
  { material: "wood", name: "Light Wood", color: "#c8a46e" },
  { material: "granite", name: "Grey Granite", color: "#9e9e9e" },
  { material: "vitrified", name: "Vitrified", color: "#dde0e3" },
];

/** What a room's design starts from the first time any finish is picked, so the required parts always have a value. */
export const DEFAULT_DESIGN: RoomDesign = {
  walls: { finish: "paint", color: WALL_PRESETS[0] },
  flooring: FLOOR_OPTIONS.find((f) => f.name === "Vitrified")!,
};

/** Countertop stored with a kitchen layout (the panel only offers the layout). */
export const DEFAULT_COUNTERTOP = "Black granite";

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
 * Gives a sketch's rooms their default door and window, and a place if the sketch didn't give them one.
 * Rooms without a position are packed in rows below the floor's positioned rooms, left to right with walls touching,
 * wrapping when a row passes 60 ft.
 */
export function placeRooms(drafts: RoomDraft[]): Omit<Room, "id">[] {
  const rows = new Map<number, { x: number; z: number; rowL: number }>();
  for (const r of drafts) {
    if (r.x === undefined || r.z === undefined) continue;
    const row = rows.get(r.floor) ?? { x: 0, z: 0, rowL: 0 };
    row.z = Math.max(row.z, r.z + r.l);
    rows.set(r.floor, row);
  }
  return drafts.map((r) => {
    if (r.x !== undefined && r.z !== undefined) return { ...r, x: r.x, z: r.z, openings: defaultOpenings(r.w) };
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

export function totalArea(rooms: Room[]): number {
  return rooms.reduce((sum, r) => sum + r.w * r.l, 0);
}

/** Plain-English summary of the project, sent to the AI assistant as context. */
export function describeProject(rooms: Room[], floors: number): string {
  if (!rooms.length) return "No rooms added yet.";
  const list = rooms.map((r) => `${r.name} (${r.w}x${r.l} ft, floor ${r.floor})`).join(", ");
  return `The home has ${rooms.length} rooms totalling ${totalArea(rooms)} sq ft: ${list}. Number of floors: ${floors}.`;
}
