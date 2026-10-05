// Project types and validation shared by the browser and the API.
import { z } from "zod";
import { MAX_FLOORS, wallLength, type Room } from "@/lib/rooms";

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

/** What a save returns: the stored project, plus which new database id each browser-side room id became. */
export type SaveResult = { project: SavedProject; idMap: Record<number, number> };

const OpeningInput = z.object({
  // Browser-side id, only unique within its room. Not stored: a room's openings are replaced on every save.
  id: z.number().int().optional(),
  kind: z.enum(["door", "window"]),
  wall: z.enum(["n", "e", "s", "w"]),
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
    openings: z.array(OpeningInput).max(20).default([]),
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
  })
  .refine((p) => p.rooms.every((r) => r.floor <= p.floors), { message: "A room is on a floor above the project's floor count", path: ["rooms"] });

export type ProjectInput = z.infer<typeof ProjectInput>;

export const ExportInput = z.object({ type: z.enum(["2d", "3d"]) });
