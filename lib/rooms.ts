// Shared types and constants for the design studio.
// The Room shape matches the old vanilla-JS build; the DB layer (Task 3) will map it to the `rooms` table.

export type Room = {
  id: number;
  name: string;
  /** width in feet */
  w: number;
  /** length in feet */
  l: number;
  /** ceiling height in feet */
  h: number;
  floor: number;
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

/** Sample rooms loaded by /design?demo=1. */
export const DEMO_ROOMS: Omit<Room, "id">[] = [
  { name: "Living Room", w: 18, l: 14, h: 10, floor: 1 },
  { name: "Master Bedroom", w: 14, l: 13, h: 10, floor: 1 },
  { name: "Kitchen", w: 12, l: 10, h: 10, floor: 1 },
  { name: "Bedroom 2", w: 12, l: 12, h: 10, floor: 1 },
  { name: "Bathroom", w: 8, l: 6, h: 10, floor: 1 },
  { name: "Dining Room", w: 14, l: 12, h: 10, floor: 1 },
];

export type LayoutBox = { id: number; x: number; z: number; w: number; l: number; h: number };

/**
 * Row-based auto layout: packs rooms left-to-right, wraps when a row gets too wide,
 * then centres the result on the origin. Units are whatever `scale` turns feet into.
 * The server uses the same packing (in feet) to store each room's position_x / position_z on save.
 */
export function layoutRooms(rooms: Room[], opts: { scale: number; gap: number; maxRowWidth: number; center: boolean }): LayoutBox[] {
  const boxes: LayoutBox[] = [];
  let x = 0;
  let z = 0;
  let rowH = 0;
  for (const r of rooms) {
    const w = r.w * opts.scale;
    const l = r.l * opts.scale;
    if (x + w > opts.maxRowWidth && x > 0) {
      z += rowH + opts.gap;
      x = 0;
      rowH = 0;
    }
    boxes.push({ id: r.id, x, z, w, l, h: r.h * opts.scale });
    x += w + opts.gap;
    rowH = Math.max(rowH, l);
  }
  if (!opts.center || !boxes.length) return boxes;
  const offX = Math.max(...boxes.map((b) => b.x + b.w)) / 2;
  const offZ = Math.max(...boxes.map((b) => b.z + b.l)) / 2;
  return boxes.map((b) => ({ ...b, x: b.x - offX, z: b.z - offZ }));
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
