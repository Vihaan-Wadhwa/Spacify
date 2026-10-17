// The /start setup: answers → a room list → a laid-out house.
// Shared by the browser (the scene before a plot is known, and the landing demo) and lib/planner.ts (room lists and sizes).

import { z } from "zod";
import { MAX_FLOORS, ROOM_DEFAULTS, ROOM_SIZE, type Room } from "@/lib/rooms";

export const HOME_TYPES = ["apartment", "house", "villa"] as const;
export type HomeType = (typeof HOME_TYPES)[number];

export const HOME_TYPE_LABELS: Record<HomeType, string> = {
  apartment: "Apartment",
  house: "Independent house",
  villa: "Villa",
};

export const BHK_OPTIONS = [1, 2, 3, 4] as const;

/** Rooms you can add on top of the BHK set, with how many of each are allowed. */
export const EXTRA_ROOMS = ["Bathroom", "Dining Room", "Pooja Room", "Study", "Balcony", "Walk-in Closet", "Store"] as const;
export type ExtraRoom = (typeof EXTRA_ROOMS)[number];
export const EXTRA_MAX = 3;

export const AREA = { min: 300, max: 6000, step: 50 };

/** What /start collects. `extras` counts rooms added beyond the BHK set. */
export const StartAnswers = z.object({
  homeType: z.enum(HOME_TYPES),
  bhk: z.number().int().min(1).max(4),
  area: z.number().int().min(AREA.min).max(AREA.max),
  floors: z.number().int().min(1).max(MAX_FLOORS),
  extras: z.partialRecord(z.enum(EXTRA_ROOMS), z.number().int().min(0).max(EXTRA_MAX)),
});
export type StartAnswers = z.infer<typeof StartAnswers>;

/** A room on the preview plan: what the browser draws and the server returns. */
export type PlanRoom = Pick<Room, "name" | "w" | "l" | "h" | "floor" | "x" | "z">;

/** A sensible built-up area for a BHK count, used until the visitor sets their own. */
export const AREA_FOR_BHK: Record<number, number> = { 1: 550, 2: 950, 3: 1450, 4: 2200 };

/** Extras a home type starts with; the visitor can take any of them away. */
export const EXTRAS_FOR_TYPE: Record<HomeType, Partial<Record<ExtraRoom, number>>> = {
  apartment: { Balcony: 1 },
  house: { "Pooja Room": 1, Store: 1 },
  villa: { "Pooja Room": 1, "Dining Room": 1, Balcony: 1, Study: 1 },
};

/** Bathrooms that come with a BHK (1 → 1, 2 → 2, 3 → 2, 4 → 3). */
export const bathroomsFor = (bhk: number) => (bhk <= 2 ? bhk : bhk - 1);

const ROOM_ORDER = ["Staircase", "Living Room", "Dining Room", "Kitchen", "Pooja Room", "Store", "Master Bedroom", "Bathroom", "Study", "Walk-in Closet", "Balcony"];
const orderOf = (name: string) => {
  const i = ROOM_ORDER.indexOf(name.startsWith("Bedroom") ? "Master Bedroom" : name);
  return i === -1 ? ROOM_ORDER.length : i;
};

/** Rooms that belong downstairs in a multi-storey home. */
const GROUND = new Set(["Living Room", "Dining Room", "Kitchen", "Pooja Room", "Store", "Master Bedroom"]);

/** The rooms the answers ask for, before sizes and positions. Partial answers give a partial list. */
export function roomNames(a: Partial<StartAnswers>): string[] {
  if (!a.bhk) return [];
  const names = ["Living Room", "Kitchen", "Master Bedroom"];
  for (let i = 2; i <= a.bhk; i++) names.push(`Bedroom ${i}`);
  for (let i = 0; i < bathroomsFor(a.bhk); i++) names.push("Bathroom");
  for (const room of EXTRA_ROOMS) for (let i = 0; i < (a.extras?.[room] ?? 0); i++) names.push(room);
  return names;
}

const round05 = (v: number) => Math.round(v * 2) / 2;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function defaultSize(name: string): [number, number] {
  return ROOM_DEFAULTS[name] ?? ROOM_DEFAULTS[name.startsWith("Bedroom") ? "Bedroom 3" : "Study"] ?? [10, 10];
}

/** Splits rooms across floors: shared rooms downstairs, bedrooms and their baths spread over the floors above. */
export function assignFloors(names: string[], floors: number): { name: string; floor: number }[] {
  if (floors <= 1) return names.map((name) => ({ name, floor: 1 }));
  const out: { name: string; floor: number }[] = [];
  const upper: string[] = [];
  let groundBath = false;
  for (const name of names) {
    if (GROUND.has(name)) out.push({ name, floor: 1 });
    else if (name === "Bathroom" && !groundBath) {
      groundBath = true;
      out.push({ name, floor: 1 });
    } else upper.push(name);
  }
  upper.forEach((name, i) => out.push({ name, floor: 2 + (i % (floors - 1)) }));
  for (let f = 1; f <= floors; f++) out.push({ name: "Staircase", floor: f });
  return out;
}

/**
 * Sizes and places the rooms. Each floor is scaled so its rooms fill about 85% of the area per floor,
 * then packed in rows with walls touching. Staircases go first on every floor, so they line up.
 */
export function layoutHome(a: Partial<StartAnswers>): PlanRoom[] {
  const floors = clamp(a.floors ?? 1, 1, MAX_FLOORS);
  const assigned = assignFloors(roomNames(a), floors);
  const out: PlanRoom[] = [];
  for (let f = 1; f <= floors; f++) {
    const onFloor = assigned.filter((r) => r.floor === f).sort((p, q) => orderOf(p.name) - orderOf(q.name));
    if (!onFloor.length) continue;
    const base = onFloor.map((r) => defaultSize(r.name));
    const baseArea = base.reduce((s, [w, l]) => s + w * l, 0);
    const target = ((a.area ?? AREA_FOR_BHK[a.bhk ?? 2]) * 0.85) / floors;
    const k = clamp(Math.sqrt(target / baseArea), 0.65, 1.8);
    const sized = onFloor.map((r, i) => {
      const fixed = r.name === "Staircase";
      return {
        name: r.name,
        w: fixed ? 8 : clamp(round05(base[i][0] * k), ROOM_SIZE.min, ROOM_SIZE.max),
        l: fixed ? 10 : clamp(round05(base[i][1] * k), ROOM_SIZE.min, ROOM_SIZE.max),
      };
    });
    const floorArea = sized.reduce((s, r) => s + r.w * r.l, 0);
    const rowWidth = Math.max(Math.sqrt(floorArea) * 1.25, ...sized.map((r) => r.w));
    let x = 0;
    let z = 0;
    let rowL = 0;
    for (const r of sized) {
      if (x > 0 && x + r.w > rowWidth + 0.01) {
        z += rowL;
        x = 0;
        rowL = 0;
      }
      out.push({ ...r, h: 10, floor: f, x, z });
      x += r.w;
      rowL = Math.max(rowL, r.l);
    }
  }
  return out;
}

export const planArea = (rooms: PlanRoom[]) => Math.round(rooms.reduce((s, r) => s + r.w * r.l, 0));

/** Where /start leaves the chosen plan for the studio to open with (read once by DesignStudio, then removed). */
export const HANDOFF_KEY = "spacify-handoff";
export type Handoff = { name: string; floors: number; rooms: PlanRoom[] };
