// The sample home: a 3BHK used by /design?demo=1, drawn as the tutorial's example sketch and on the landing page.
// One definition, so the three always show the same plan.
//
// Feet; x grows east, z grows south (north is up). Rooms that touch share a wall, and a door on a shared wall
// opens both rooms, so each door is listed once, on one of the two rooms.
//
//            ┌ Bal ┐
//   ┌────────┴─────┼ WIC ┬───────────┬ Bath ┬───────────┐
//   │  Master      ├─────┤ Bedroom 2 ├──────┤ Bedroom 3 │
//   │  Bedroom     │Bath │           │ Bath │           │
//   ├──────────────┴──┬──┴───────────┴──────┴───────────┤
//   │  Drawing Room   │              Passage            │
//   │                 ├────────────┬───────────┬ Pooja ─┤
//   │                 │   Dining   │  Kitchen  ├ Store ─┤
//   ├── Balcony ──┐   └────────────┴─ Utility ─┴────────┘
//   └─────────────┘                  balcony

import type { Opening, Room, Wall } from "@/lib/rooms";

type PlanRoom = Omit<Room, "id" | "h" | "floor" | "openings"> & {
  /** What the tutorial's sketch writes in the room. */
  code: string;
  /** Whether the sketch writes the room's size under its label (small rooms are left for the AI to estimate). */
  sized?: boolean;
  openings?: Omit<Opening, "id">[];
};

const door = (wall: Wall, offset: number, width = 3): Omit<Opening, "id"> => ({ kind: "door", wall, offset, width });
const win = (wall: Wall, offset: number, width = 4): Omit<Opening, "id"> => ({ kind: "window", wall, offset, width });

export const DEMO_PLAN: PlanRoom[] = [
  { name: "Balcony", code: "Bal", x: 0, z: 0, w: 10, l: 5, openings: [door("s", 3.5)] },
  {
    name: "Master Bedroom", code: "MB", sized: true, x: 0, z: 5, w: 14, l: 13,
    // to the drawing room; into the walk-in closet and the en-suite bathroom
    openings: [win("w", 4, 5), door("s", 10.5), door("e", 1.5, 2.5), door("e", 8.5, 2.5)],
  },
  { name: "Walk-in Closet", code: "WIC", x: 14, z: 5, w: 6, l: 6 },
  { name: "Bathroom", code: "Bath", x: 14, z: 11, w: 6, l: 7 },
  { name: "Bedroom 2", code: "B2", sized: true, x: 20, z: 5, w: 12, l: 13, openings: [win("n", 4), door("s", 9)] },
  { name: "Bathroom", code: "Bath", x: 32, z: 5, w: 6, l: 7, openings: [win("n", 1.5, 3), door("e", 2, 2.5)] }, // attached to Bedroom 3
  { name: "Bathroom", code: "Bath", x: 32, z: 12, w: 6, l: 6, openings: [door("s", 1.5, 2.5)] }, // common, off the passage
  { name: "Bedroom 3", code: "B3", sized: true, x: 38, z: 5, w: 12, l: 13, openings: [win("n", 4), win("e", 4.5), door("s", 1)] },
  {
    name: "Drawing Room", code: "Drg", sized: true, x: 0, z: 18, w: 18, l: 14,
    // west window; to the balcony; main entrance; wide opening to the dining room
    openings: [win("w", 4, 6), door("s", 3.5, 4), door("s", 13.5, 3.5), door("e", 6, 5)],
  },
  { name: "Passage", code: "Passage", x: 18, z: 18, w: 32, l: 4, openings: [door("w", 0.5), door("s", 4, 5)] },
  { name: "Dining Room", code: "Din", sized: true, x: 18, z: 22, w: 14, l: 10, openings: [win("s", 4, 5)] },
  { name: "Kitchen", code: "K", sized: true, x: 32, z: 22, w: 12, l: 10, openings: [door("n", 1), door("w", 3), door("s", 1), win("s", 6)] },
  { name: "Pooja Room", code: "PR", x: 44, z: 22, w: 6, l: 6, openings: [door("n", 1.5), win("e", 1.5, 3)] },
  { name: "Store", code: "Store", x: 44, z: 28, w: 6, l: 4, openings: [door("w", 0.5, 2.5)] },
  { name: "Balcony", code: "Bal", x: 0, z: 32, w: 12, l: 5 },
  { name: "Balcony", code: "Bal", x: 32, z: 32, w: 12, l: 4 }, // utility balcony off the kitchen
];

/** The sample home as editor rooms, without ids. */
export const DEMO_ROOMS: Omit<Room, "id">[] = DEMO_PLAN.map(({ name, x, z, w, l, openings = [] }) => ({
  name,
  x,
  z,
  w,
  l,
  h: 10,
  floor: 1,
  openings: openings.map((o, i) => ({ ...o, id: i + 1 })),
}));
