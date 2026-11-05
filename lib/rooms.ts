// Shared types and constants for the design studio.
// Rooms map to the `rooms` table and their doors/windows to `openings`.
//
// Plan coordinates are in feet: x grows east (right), z grows south (down), north is up.

/** A side of a room: north (top on the plan), east, south, west. Also the way any wall faces (outwards). */
export type Wall = "n" | "e" | "s" | "w";
export const WALLS: Wall[] = ["n", "e", "s", "w"];
export const OPPOSITE: Record<Wall, Wall> = { n: "s", s: "n", e: "w", w: "e" };

/** Which wall of a room: a rectangle's are "n", "e", "s", "w"; a shaped room's are numbered "0", "1", … clockwise. */
export type WallKey = Wall | `${number}`;

/** "open" is a gap with no door: a doorless passage, or (across a whole shared wall) a removed wall. */
export type OpeningKind = "door" | "window" | "open";

/** A door or window in one of a room's walls. */
export type Opening = {
  /** Unique within its room. */
  id: number;
  kind: OpeningKind;
  wall: WallKey;
  /** feet from the wall's west end (east–west walls) or north end (north–south walls) to the near edge of the opening */
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
  /**
   * A room that isn't a plain rectangle: its corners, clockwise, as fractions (0–1) of `w` and `l` from its north-west
   * corner. Every corner is a right angle. Absent for rectangles.
   */
  shape?: [number, number][];
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
  window: { min: 1, max: 16, initial: 4 },
  open: { min: 2, max: 40, initial: 4 },
};

// ─── Room designs (MongoDB `room_designs`, one document per room) ───
// The same enums are enforced by the collection's $jsonSchema validator (db/mongo-validator.json).

export const WALL_FINISHES = ["paint", "tiles", "marble", "wallpaper", "wood_panel"] as const;
export const FLOOR_MATERIALS = ["marble", "vitrified", "tiles", "wood", "granite"] as const;
export const CEILING_TYPES = ["plain", "pop", "gypsum", "wood"] as const;
export const KITCHEN_LAYOUTS = ["L", "U", "parallel", "island", "straight"] as const;
export const WINDOW_TYPES = ["sliding", "casement", "fixed", "mesh"] as const;
export const FRAME_MATERIALS = ["aluminium", "wood"] as const;
export const POLISHES = ["matte", "satin", "gloss"] as const;
export const DOOR_STYLES = ["flush", "panelled", "grooved", "glass"] as const;
export const FURNITURE_TYPES = [
  "bed_single", "bed_double", "bed_queen", "bed_king", "bedside_table", "cupboard",
  "dressing_table", "study_table", "tv_panel", "sofa", "dining_table",
] as const;

export type WallFinish = (typeof WALL_FINISHES)[number];
export type FloorMaterial = (typeof FLOOR_MATERIALS)[number];
export type CeilingType = (typeof CEILING_TYPES)[number];
export type KitchenLayout = (typeof KITCHEN_LAYOUTS)[number];
export type WindowType = (typeof WINDOW_TYPES)[number];
export type FrameMaterial = (typeof FRAME_MATERIALS)[number];
export type Polish = (typeof POLISHES)[number];
export type DoorStyle = (typeof DOOR_STYLES)[number];
export type FurnitureType = (typeof FURNITURE_TYPES)[number];

/** Clockwise turn on the plan. 0 = the item's back is against the north wall, facing south. */
export type Rotation = 0 | 90 | 180 | 270;

/** A piece of furniture in a room. x/z are feet from the room's north-west corner to the item's centre. */
export type FurnitureItem = { id: number; type: FurnitureType; x: number; z: number; rot: Rotation };

/**
 * A room's finishes. Walls and flooring are always set; the rest only when chosen.
 * `kitchen` (kitchens only) means the room has a modular kitchen.
 */
export type RoomDesign = {
  /** `name` picks the marble or wallpaper design (and names a paint shade). */
  walls: { finish: WallFinish; color: string; name?: string };
  flooring: { material: FloorMaterial; name: string; color: string };
  /** The room's own windows. `polish` only shows on wood frames. */
  windows?: { type: WindowType; frame: FrameMaterial; color: string; polish: Polish };
  /** The room's own doors (a door on a shared wall belongs to the room it's listed on). */
  doors?: { style: DoorStyle; color: string; polish: Polish };
  furniture?: FurnitureItem[];
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

export const WINDOW_TYPE_LABELS: Record<WindowType, string> = {
  sliding: "Sliding",
  casement: "Opens like a door",
  fixed: "Fixed glass",
  mesh: "Sliding + mesh",
};

export const DOOR_STYLE_LABELS: Record<DoorStyle, string> = {
  flush: "Plain flush",
  panelled: "Panelled",
  grooved: "Grooved lines",
  glass: "Glass inset",
};

export const KITCHEN_LAYOUT_LABELS: Record<KitchenLayout, string> = {
  L: "L",
  U: "U",
  parallel: "Parallel",
  island: "Island",
  straight: "Straight",
};

export const POLISH_LABELS: Record<Polish, string> = { matte: "Matte", satin: "Satin", gloss: "High gloss" };

/** Furniture sizes in feet (w along the wall it backs onto, d out from it). `cupboard` items stay when furniture is hidden
 *  with "keep basic cupboards" on. */
export const FURNITURE: Record<FurnitureType, { label: string; w: number; d: number; cupboard?: boolean }> = {
  bed_single: { label: "Single bed", w: 3.5, d: 6.8 },
  bed_double: { label: "Small double bed", w: 4.5, d: 6.8 },
  bed_queen: { label: "Queen bed", w: 5.3, d: 7 },
  bed_king: { label: "King bed", w: 6.3, d: 7 },
  bedside_table: { label: "Bedside table", w: 1.6, d: 1.4 },
  cupboard: { label: "Cupboard", w: 6, d: 2, cupboard: true },
  dressing_table: { label: "Dressing table", w: 3.5, d: 1.5 },
  study_table: { label: "Study table", w: 4, d: 2 },
  tv_panel: { label: "TV panel", w: 7, d: 1.3 },
  sofa: { label: "Sofa", w: 7, d: 3 },
  dining_table: { label: "Dining table", w: 6, d: 6 },
};

export const isKitchen = (roomType: string) => /kitchen/i.test(roomType);
export const isBathroom = (roomType: string) => /bath|toilet|wash/i.test(roomType);

/** `cupboards` keeps fitted cupboards (and the modular kitchen's cabinets) when `furniture` is off. */
export type LayerName = "walls" | "floors" | "furniture" | "cupboards" | "roof" | "grid";
export type Layers = Record<LayerName, boolean>;

export type CameraPreset = "persp" | "top" | "front" | "side";

export type StudioTab = "floor" | "interior" | "architecture";
/** What the Floor Plan tab shows. */
export type FloorView = "2d" | "3d";

export const MAX_FLOORS = 3;

export const DEFAULT_LAYERS: Layers = { walls: true, floors: true, furniture: true, cupboards: false, roof: false, grid: false };

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

export type Swatch = { name: string; color: string };

/** Paint shades. Any other colour can be picked on the wheel or typed as a hex code. */
export const WALL_PAINTS: Swatch[] = [
  { name: "Ivory White", color: "#f4efe4" },
  { name: "Lime White", color: "#ecebe0" },
  { name: "Warm Linen", color: "#ebdfcb" },
  { name: "Sandstone", color: "#d9c3a0" },
  { name: "Terracotta", color: "#c06e4f" },
  { name: "Blush Pink", color: "#e8c4bd" },
  { name: "Dusty Rose", color: "#c5938e" },
  { name: "Sage Green", color: "#a9b89a" },
  { name: "Olive", color: "#7d8257" },
  { name: "Mint", color: "#cfe3d4" },
  { name: "Powder Blue", color: "#c4d6e2" },
  { name: "Teal", color: "#3f7378" },
  { name: "Indigo", color: "#3b4a6b" },
  { name: "Mustard", color: "#d4a648" },
  { name: "Charcoal", color: "#4a4b4d" },
];

export const WALL_MARBLES: Swatch[] = [
  { name: "Statuario White", color: "#ece9e4" },
  { name: "Botticino Beige", color: "#dccbb0" },
  { name: "Emperador Brown", color: "#5d4536" },
  { name: "Nero Marquina", color: "#1f1f22" },
];

export const WALLPAPER_PATTERNS = ["damask", "stripes", "leaves", "trellis", "chevron", "linen"] as const;
export type WallpaperPattern = (typeof WALLPAPER_PATTERNS)[number];
export const WALLPAPERS: (Swatch & { pattern: WallpaperPattern })[] = [
  { name: "Royal Damask", color: "#d8c8a8", pattern: "damask" },
  { name: "Regency Stripe", color: "#c9d3cf", pattern: "stripes" },
  { name: "Tropical Leaves", color: "#e6e2d3", pattern: "leaves" },
  { name: "Moroccan Trellis", color: "#e3d6cc", pattern: "trellis" },
  { name: "Chevron", color: "#d5d9de", pattern: "chevron" },
  { name: "Grey Linen", color: "#bdbab3", pattern: "linen" },
];

/** Flooring, grouped by material on the Interior Design panel. */
export const FLOOR_OPTIONS: RoomDesign["flooring"][] = [
  { material: "wood", name: "Natural Oak", color: "#b98d5d" },
  { material: "wood", name: "Honey Teak", color: "#9a6435" },
  { material: "wood", name: "Walnut", color: "#5a3b26" },
  { material: "wood", name: "Ash Grey", color: "#8f8579" },
  { material: "tiles", name: "Ivory Tiles", color: "#e6dfd2" },
  { material: "tiles", name: "Sand Beige Tiles", color: "#cdbb9c" },
  { material: "tiles", name: "Slate Grey Tiles", color: "#7e8186" },
  { material: "tiles", name: "Charcoal Tiles", color: "#3d3f43" },
  { material: "marble", name: "Statuario Marble", color: "#ece9e4" },
  { material: "marble", name: "Botticino Marble", color: "#dccbb0" },
  { material: "marble", name: "Emperador Marble", color: "#5d4536" },
  { material: "marble", name: "Nero Marble", color: "#1f1f22" },
];

/** Wood for doors and window frames. */
export const WOOD_TONES: Swatch[] = [
  { name: "Teak", color: "#8a5a2e" },
  { name: "Walnut", color: "#5b3b27" },
  { name: "Oak", color: "#b68b5c" },
  { name: "Sheesham", color: "#6e4127" },
  { name: "Mahogany", color: "#6a2f24" },
];

/** Powder-coat colours for aluminium window frames. */
export const ALUMINIUM_COLOURS: Swatch[] = [
  { name: "Silver", color: "#c3c6ca" },
  { name: "Black", color: "#2a2b2e" },
  { name: "White", color: "#eeeeeb" },
  { name: "Champagne", color: "#b9a47e" },
  { name: "Bronze", color: "#6b5444" },
];

export const DEFAULT_WINDOWS: NonNullable<RoomDesign["windows"]> = { type: "sliding", frame: "aluminium", color: ALUMINIUM_COLOURS[0].color, polish: "satin" };
export const DEFAULT_DOORS: NonNullable<RoomDesign["doors"]> = { style: "panelled", color: WOOD_TONES[0].color, polish: "satin" };

/** What a room's design starts from the first time any finish is picked, so the required parts always have a value. */
export const DEFAULT_DESIGN: RoomDesign = {
  walls: { finish: "paint", color: WALL_PAINTS[0].color, name: WALL_PAINTS[0].name },
  flooring: FLOOR_OPTIONS.find((f) => f.name === "Ivory Tiles")!,
};

/** The finishes a room starts with before anything is picked: tiled walls and a darker tile floor in bathrooms. */
export function defaultDesign(roomName: string): RoomDesign {
  if (!isBathroom(roomName)) return DEFAULT_DESIGN;
  return { walls: { finish: "tiles", color: "#e9e8e4" }, flooring: FLOOR_OPTIONS.find((f) => f.name === "Slate Grey Tiles")! };
}

/** Countertop stored with a kitchen layout (the panel only offers the layout). */
export const DEFAULT_COUNTERTOP = "Black granite";

// ─── Walls and openings ──────────────────────────────────────

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round1 = (v: number) => Math.round(v * 10) / 10;

/** A wall as a line on the plan: east–west walls run along x at z = `at`; north–south walls run along z at x = `at`. */
export type WallLine = { axis: "x" | "z"; at: number; from: number; to: number };

/** One wall of a room: where it runs, and which way it faces (outwards). */
export type WallEdge = WallLine & { key: WallKey; dir: Wall };

type Placed = Pick<Room, "x" | "z" | "w" | "l" | "shape">;

function rectLine(r: Pick<Room, "x" | "z" | "w" | "l">, wall: Wall): WallLine {
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

/** A shaped room's corners on the plan (feet), clockwise. */
export function shapeCorners(r: Placed): { x: number; z: number }[] {
  return (r.shape ?? [[0, 0], [1, 0], [1, 1], [0, 1]]).map(([u, v]) => ({ x: r.x + u * r.w, z: r.z + v * r.l }));
}

/** Every wall of a room: a rectangle's four, or a shaped room's, clockwise. */
export function roomWalls(r: Placed): WallEdge[] {
  if (!r.shape) return WALLS.map((w) => ({ key: w, dir: w, ...rectLine(r, w) }));
  const pts = shapeCorners(r);
  return pts.map((p, i) => {
    const q = pts[(i + 1) % pts.length];
    const key = String(i) as WallKey;
    if (Math.abs(p.z - q.z) < Math.abs(p.x - q.x)) {
      // Going east along the top of the room (clockwise) means the room is to the south: a north-facing wall.
      return { key, dir: q.x > p.x ? "n" : "s", axis: "x", at: p.z, from: Math.min(p.x, q.x), to: Math.max(p.x, q.x) };
    }
    return { key, dir: q.z > p.z ? "e" : "w", axis: "z", at: p.x, from: Math.min(p.z, q.z), to: Math.max(p.z, q.z) };
  });
}

/** One wall of a room. A key the room doesn't have falls back to its first wall facing the same way (or its first). */
export function wallEdge(r: Placed, key: WallKey): WallEdge {
  const walls = roomWalls(r);
  return walls.find((e) => e.key === key) ?? walls.find((e) => e.dir === key) ?? walls[0];
}

export function wallLine(r: Placed, key: WallKey): WallLine {
  const { axis, at, from, to } = wallEdge(r, key);
  return { axis, at, from, to };
}

export function wallLength(room: Pick<Room, "w" | "l" | "shape">, key: WallKey): number {
  const e = wallEdge({ x: 0, z: 0, ...room }, key);
  return e.to - e.from;
}

export type PlanRect = { x: number; z: number; w: number; l: number };

/**
 * A room's floor as rectangles (plan feet): itself, or a shaped room cut into vertical strips. Used for overlaps,
 * hit testing, floors and ceilings in 3D, and whether furniture fits.
 */
export function roomRects(r: Placed): PlanRect[] {
  if (!r.shape) return [{ x: r.x, z: r.z, w: r.w, l: r.l }];
  const walls = roomWalls(r);
  const xs = [...new Set(shapeCorners(r).map((p) => Math.round(p.x * 1000) / 1000))].sort((a, b) => a - b);
  const rects: PlanRect[] = [];
  for (let i = 0; i < xs.length - 1; i++) {
    const mid = (xs[i] + xs[i + 1]) / 2;
    // Walls crossing this strip, top to bottom, alternate between entering and leaving the room.
    const zs = walls.filter((e) => e.axis === "x" && e.from < mid && e.to > mid).map((e) => e.at).sort((a, b) => a - b);
    for (let k = 0; k + 1 < zs.length; k += 2) rects.push({ x: xs[i], z: zs[k], w: xs[i + 1] - xs[i], l: zs[k + 1] - zs[k] });
  }
  return rects;
}

/** Whether a plan point is inside a room (on its edge counts). */
export function pointInRoom(r: Placed, x: number, z: number, margin = 0): boolean {
  return roomRects(r).some((q) => x >= q.x - margin && x <= q.x + q.w + margin && z >= q.z - margin && z <= q.z + q.l + margin);
}

/** Whether the corner at one end of a wall sticks out of the room (convex) rather than in (a notch, reflex). */
export function cornerConvex(r: Placed, e: WallEdge, end: "from" | "to"): boolean {
  const p = end === "to" ? e.to : e.from;
  const along = end === "to" ? 0.25 : -0.25;
  const inward = e.dir === "n" || e.dir === "w" ? 0.25 : -0.25;
  const [x, z] = e.axis === "x" ? [p + along, e.at + inward] : [e.at + inward, p + along];
  return !pointInRoom(r, x, z);
}

/** The middle of a room's biggest rectangle: where its label goes, and its ceiling light. */
export function roomCentre(r: Placed): { x: number; z: number } {
  const big = roomRects(r).sort((a, b) => b.w * b.l - a.w * a.l)[0];
  return { x: big.x + big.w / 2, z: big.z + big.l / 2 };
}

/** A room's size for labels: "14×13 ft", or its area for shaped rooms. */
export const roomSizeText = (r: Pick<Room, "w" | "l" | "shape">) => (r.shape ? `${Math.round(roomArea({ x: 0, z: 0, ...r }))} sq ft` : `${r.w}×${r.l} ft`);

export function roomArea(r: Placed): number {
  return roomRects(r).reduce((s, q) => s + q.w * q.l, 0);
}

/**
 * After a room's shape changes, puts each door and window on the new wall that faces the same way and is nearest
 * where it was, kept inside that wall. Openings with nowhere to go are dropped.
 */
export function remapOpenings(before: Room, after: Placed): Opening[] {
  const walls = roomWalls(after);
  return before.openings.flatMap((o) => {
    const old = wallEdge(before, o.wall);
    const mid = old.from + o.offset + o.width / 2;
    const target = walls
      .filter((e) => e.dir === old.dir && e.to - e.from >= Math.min(o.width, 2))
      .sort((a, b) => Math.abs(a.at - old.at) + Math.max(0, a.from - mid, mid - a.to) - (Math.abs(b.at - old.at) + Math.max(0, b.from - mid, mid - b.to)))[0];
    if (!target) return [];
    const len = target.to - target.from;
    const width = Math.min(o.width, len);
    return [{ ...o, wall: target.key, width, offset: round1(clamp(mid - width / 2 - target.from, 0, len - width)) }];
  });
}

/** Keeps every opening inside its wall, shrinking it if the wall is now too short (e.g. after a resize). */
export function fitOpenings(room: Pick<Room, "w" | "l" | "shape" | "openings">): Opening[] {
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

/** Doors this wide (feet) or wider are a pair of leaves: two doors side by side, so one can be removed. */
export const DOUBLE_DOOR_MIN = 5;

/** The two sizes a door comes in on the plan: a single door, or a double door (two leaves of half this each). */
export const DOOR_WIDTHS = { single: 3, double: DOUBLE_DOOR_MIN } as const;

/** Turns each door that's DOUBLE_DOOR_MIN ft or wider into two half-width doors side by side. */
export function splitWideDoors(openings: Opening[]): Opening[] {
  if (!openings.some((o) => o.kind === "door" && o.width >= DOUBLE_DOOR_MIN)) return openings;
  let nextId = Math.max(0, ...openings.map((o) => o.id)) + 1;
  return openings.flatMap((o) => {
    if (o.kind !== "door" || o.width < DOUBLE_DOOR_MIN) return [o];
    const half = round1(o.width / 2);
    return [
      { ...o, width: half },
      { ...o, id: nextId++, offset: round1(o.offset + half), width: round1(o.width - half) },
    ];
  });
}

/**
 * The second leaf of a double door: a door on the same wall that starts where `o` ends. The pair is drawn hinged
 * at both outer edges, meeting in the middle.
 */
export function doorPartner(openings: Opening[], o: Opening): Opening | undefined {
  if (o.kind !== "door") return undefined;
  return openings.find((p) => p.id !== o.id && p.kind === "door" && p.wall === o.wall && Math.abs(p.offset - (o.offset + o.width)) < 0.05);
}

/** Whether `o` is the right-hand leaf of a double door (its partner starts before it). */
export const isSecondLeaf = (openings: Opening[], o: Opening) =>
  o.kind === "door" && openings.some((p) => p.id !== o.id && doorPartner(openings, p)?.id === o.id);

export type WallCut = { kind: OpeningKind; from: number; to: number };

/**
 * Whether an open stretch [from, to] of `room`'s wall covers all of a stretch it shares with another room: the wall
 * between them is gone (rather than having a doorless passage in it).
 */
export function removesWall(room: Room, wall: WallKey, from: number, to: number, floorRooms: Room[]): boolean {
  return sharedSpans(room, wall, floorRooms).some(([a, b]) => from <= a + 0.1 && to >= b - 0.1 && to - from > 0.1);
}

/**
 * Rooms joined into one space by removed walls, as groups of room ids (every room is in exactly one group).
 * Used so that finishes picked for one part of an L-shaped space apply to all of it.
 */
export function joinedGroups(rooms: Room[]): Map<number, number[]> {
  const parent = new Map(rooms.map((r) => [r.id, r.id]));
  const find = (id: number): number => (parent.get(id) === id ? id : find(parent.get(id)!));
  for (const room of rooms) {
    const floorRooms = rooms.filter((r) => r.floor === room.floor);
    for (const o of room.openings) {
      if (o.kind !== "open") continue;
      const line = wallEdge(room, o.wall);
      const from = line.from + o.offset, to = from + o.width;
      for (const other of floorRooms) {
        if (other.id === room.id) continue;
        for (const ol of roomWalls(other)) {
          if (ol.dir !== OPPOSITE[line.dir] || Math.abs(ol.at - line.at) > 0.1) continue;
          const a = Math.max(line.from, ol.from), b = Math.min(line.to, ol.to);
          if (b - a > 0.05 && from <= a + 0.1 && to >= b - 0.1) parent.set(find(other.id), find(room.id));
        }
      }
    }
  }
  const groups = new Map<number, number[]>();
  for (const r of rooms) groups.set(find(r.id), [...(groups.get(find(r.id)) ?? []), r.id]);
  return new Map(rooms.map((r) => [r.id, groups.get(find(r.id))!]));
}

/**
 * The stretches of a room's wall that are open: its own doors/windows, plus those of any room on the same floor
 * whose wall lies along the same line (a shared wall), so a door between two rooms goes through both walls.
 * `from`/`to` are plan coordinates along the wall's axis.
 */
export function wallCuts(room: Room, wall: WallKey, floorRooms: Room[]): WallCut[] {
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

/** Where the room on the other side of a wall shares it with this room ([from, to] along the wall's axis, plan feet). */
export function sharedSpans(room: Room, wall: WallKey, floorRooms: Room[]): [number, number][] {
  const line = wallEdge(room, wall);
  const spans: [number, number][] = [];
  for (const other of floorRooms) {
    if (other.id === room.id) continue;
    for (const ol of roomWalls(other)) {
      if (ol.dir !== OPPOSITE[line.dir] || Math.abs(ol.at - line.at) > 0.1) continue;
      const from = Math.max(line.from, ol.from);
      const to = Math.min(line.to, ol.to);
      if (to - from > 0.05) spans.push([from, to]);
    }
  }
  return spans.sort((a, b) => a[0] - b[0]);
}

/** The stretches of a wall with no room on the other side (outside walls), [from, to] in plan feet. */
export function exteriorSpans(room: Room, wall: WallKey, floorRooms: Room[]): [number, number][] {
  const line = wallLine(room, wall);
  const out: [number, number][] = [];
  let at = line.from;
  for (const [from, to] of sharedSpans(room, wall, floorRooms)) {
    if (from - at > 0.05) out.push([at, from]);
    at = Math.max(at, to);
  }
  if (line.to - at > 0.05) out.push([at, line.to]);
  return out;
}

/**
 * Moves each room's windows onto an outside wall: a window between two rooms isn't something anyone builds.
 * A window is moved to the middle of the longest outside stretch (shrunk to fit), or dropped if the room has none.
 */
export function windowsOutside(rooms: Room[]): Room[] {
  return rooms.map((room) => {
    const floorRooms = rooms.filter((r) => r.floor === room.floor);
    const outside = roomWalls(room).flatMap(({ key: wall }) => exteriorSpans(room, wall, floorRooms).map(([from, to]) => ({ wall, from, to })));
    const best = outside.sort((a, b) => b.to - b.from - (a.to - a.from))[0];
    const openings = room.openings.flatMap((o) => {
      if (o.kind !== "window") return [o];
      const start = wallLine(room, o.wall).from + o.offset;
      if (exteriorSpans(room, o.wall, floorRooms).some(([from, to]) => start >= from - 0.05 && start + o.width <= to + 0.05)) return [o];
      if (!best || best.to - best.from < OPENING_SIZE.window.min + 1) return [];
      const width = Math.min(o.width, best.to - best.from - 1);
      const offset = round1((best.from + best.to) / 2 - width / 2 - wallLine(room, best.wall).from);
      return [{ ...o, wall: best.wall, offset, width }];
    });
    return { ...room, openings };
  });
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
      if (rectsOverlap(roomRects(a), roomRects(b))) {
        ids.add(a.id);
        ids.add(b.id);
      }
    }
  }
  return ids;
}

/** Whether two sets of plan rectangles overlap anywhere (touching edges don't count). */
export function rectsOverlap(a: PlanRect[], b: PlanRect[]): boolean {
  return a.some((p) => b.some((q) => Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x) > 0.05 && Math.min(p.z + p.l, q.z + q.l) - Math.max(p.z, q.z) > 0.05));
}

export function totalArea(rooms: Room[]): number {
  return Math.round(rooms.reduce((sum, r) => sum + roomArea(r), 0));
}

/** Plain-English summary of the project, sent to the AI assistant as context. */
export function describeProject(rooms: Room[], floors: number): string {
  if (!rooms.length) return "No rooms added yet.";
  const list = rooms.map((r) => `${r.name} (${r.shape ? `${roomArea(r)} sq ft, not rectangular` : `${r.w}x${r.l} ft`}, floor ${r.floor})`).join(", ");
  return `The home has ${rooms.length} rooms totalling ${totalArea(rooms)} sq ft: ${list}. Number of floors: ${floors}.`;
}
