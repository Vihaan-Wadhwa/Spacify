// Project types and validation shared by the browser and the API.
import { z } from "zod";
import {
  CEILING_TYPES,
  DOOR_STYLES,
  FLOOR_MATERIALS,
  FRAME_MATERIALS,
  FURNITURE_TYPES,
  KITCHEN_LAYOUTS,
  MAX_FLOORS,
  POLISHES,
  WALL_FINISHES,
  WINDOW_TYPES,
  wallLength,
  type Room,
  type WallKey,
  type RoomDesign,
} from "@/lib/rooms";

export type Access = "owner" | "edit" | "view";

/** A project as the design page loads and saves it. */
export type SavedProject = {
  id: number;
  name: string;
  floors: number;
  totalArea: number;
  access: Access;
  ownerName: string;
  updatedAt: string;
  rooms: Room[];
};

/** One row on the projects page. */
export type ProjectListItem = Omit<SavedProject, "rooms"> & { roomCount: number };

/**
 * What a save returns: the stored project, plus which new database id each browser-side room id became.
 * `warning` is set when the rooms were saved (PostgreSQL) but their designs weren't (MongoDB).
 */
export type SaveResult = { project: SavedProject; idMap: Record<number, number>; warning?: string };

const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Must be a colour like #f5f0e8");

/** One room's design document, minus the ids and audit fields the server adds. Mirrors db/mongo-validator.json. */
export const Design = z.object({
  walls: z.object({ finish: z.enum(WALL_FINISHES), color: HexColor, name: z.string().trim().min(1).max(50).optional() }),
  flooring: z.object({ material: z.enum(FLOOR_MATERIALS), name: z.string().trim().min(1).max(50), color: HexColor }),
  windows: z.object({ type: z.enum(WINDOW_TYPES), frame: z.enum(FRAME_MATERIALS), color: HexColor, polish: z.enum(POLISHES) }).optional(),
  doors: z.object({ style: z.enum(DOOR_STYLES), color: HexColor, polish: z.enum(POLISHES) }).optional(),
  furniture: z
    .array(
      z.object({
        id: z.number().int().min(1),
        type: z.enum(FURNITURE_TYPES),
        x: z.number().min(0).max(100),
        z: z.number().min(0).max(100),
        rot: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
      })
    )
    .max(40)
    .optional(),
  ceiling: z.object({ type: z.enum(CEILING_TYPES) }).optional(),
  lighting: z
    .array(z.object({ type: z.string().trim().min(1).max(40), count: z.number().int().min(1).max(50) }))
    .max(10)
    .optional(),
  kitchen: z.object({ layout: z.enum(KITCHEN_LAYOUTS), countertop: z.string().trim().min(1).max(50) }).optional(),
}) satisfies z.ZodType<RoomDesign>;

const OpeningInput = z.object({
  // Browser-side id, only unique within its room. Not stored: a room's openings are replaced on every save.
  id: z.number().int().optional(),
  kind: z.enum(["door", "window", "open"]),
  // n/e/s/w on a rectangle; a shaped room's walls are numbered
  wall: z
    .string()
    .regex(/^([nesw]|\d{1,2})$/)
    .transform((v) => v as WallKey),
  offset: z.number().min(0),
  width: z.number().positive().max(40),
});

const RoomInput = z
  .object({
    // Browser-side id. If it matches a room already in this project that room is updated; otherwise a new one is inserted.
    id: z.number().int().positive(),
    name: z.string().trim().min(1).max(50),
    w: z.number().positive().max(100),
    l: z.number().positive().max(100),
    h: z.number().min(7).max(20),
    floor: z.number().int().min(1).max(MAX_FLOORS),
    // Position on the 2D plan (feet).
    x: z.number().min(-1000).max(1000).default(0),
    z: z.number().min(-1000).max(1000).default(0),
    // Corners of a room that isn't a rectangle, as fractions of w and l (see Room.shape).
    shape: z
      .array(z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]))
      .min(4)
      .max(24)
      .refine((pts) => pts.every(([u, v], i) => {
        const [nu, nv] = pts[(i + 1) % pts.length];
        return Math.abs(u - nu) < 1e-6 || Math.abs(v - nv) < 1e-6;
      }), "Every wall of a shaped room must run straight across or down")
      .optional(),
    openings: z.array(OpeningInput).max(20).default([]),
  })
  .refine((r) => r.openings.every((o) => (/^\d/.test(o.wall) ? !!r.shape && Number(o.wall) < r.shape.length : true)), {
    message: "A door or window is on a wall the room doesn't have",
    path: ["openings"],
  })
  .refine((r) => r.openings.every((o) => o.offset + o.width <= wallLength(r, o.wall) + 0.01), {
    message: "A door or window doesn't fit in its wall",
    path: ["openings"],
  });

export const ProjectInput = z
  .object({
    name: z.string().trim().min(1, "Project name can't be empty").max(100),
    floors: z.number().int().min(1).max(MAX_FLOORS),
    rooms: z.array(RoomInput).max(60),
    // Browser room id → design (stored in MongoDB). Optional so clients that only send rooms still work.
    designs: z.record(z.string().regex(/^\d+$/), Design).optional(),
  })
  .refine((p) => p.rooms.every((r) => r.floor <= p.floors), { message: "A room is on a floor above the project's floor count", path: ["rooms"] })
  .refine((p) => Object.keys(p.designs ?? {}).every((id) => p.rooms.some((r) => r.id === Number(id))), {
    message: "A design is for a room that isn't in the project",
    path: ["designs"],
  });

export type ProjectInput = z.infer<typeof ProjectInput>;

export const ExportInput = z.object({ type: z.enum(["2d", "3d"]) });

/** Body of PUT /api/design: one room's design. */
export const RoomDesignInput = z.object({
  projectId: z.number().int().positive(),
  roomId: z.number().int().positive(),
  design: Design,
});
