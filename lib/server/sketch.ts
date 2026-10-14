import { z } from "zod";
import { MAX_FLOORS, type RoomDraft } from "@/lib/rooms";
import { layoutSketch, type SketchRoom } from "./sketchLayout";

/** A pixel point or box from the model, if it sent one with the right number of finite values. */
const pixels = (n: number) =>
  z
    .array(z.coerce.number())
    .optional()
    .transform((v) => (v && v.length === n && v.every(Number.isFinite) ? v : undefined));

/**
 * One room as the vision model may describe it. The model sometimes spells keys out
 * (width/length/height), returns numbers as strings, or leaves the floor out — accept all of that.
 * A width or length of 0 (or none) means no dimensions were written for that room.
 */
const RawRoom = z
  .object({
    name: z.string().trim().min(1).max(60),
    w: z.coerce.number().optional(),
    width: z.coerce.number().optional(),
    l: z.coerce.number().optional(),
    length: z.coerce.number().optional(),
    h: z.coerce.number().optional(),
    height: z.coerce.number().optional(),
    floor: z.coerce.number().int().optional(),
    label_point_2d: pixels(2),
    bbox_2d: pixels(4),
  })
  .transform((r) => ({
    name: r.name,
    w: r.w ?? r.width ?? 0,
    l: r.l ?? r.length ?? 0,
    h: r.h ?? r.height ?? 10,
    floor: r.floor ?? 1,
    point: r.label_point_2d as [number, number] | undefined,
    box: r.bbox_2d as [number, number, number, number] | undefined,
  }))
  .pipe(
    z.object({
      name: z.string(),
      w: z.number().min(0),
      l: z.number().min(0),
      h: z.number().positive(),
      floor: z.number().int(),
      // Already checked by pixels() above.
      point: z.custom<[number, number] | undefined>(),
      box: z.custom<[number, number, number, number] | undefined>(),
    })
  );

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number) => Math.round(v * 10) / 10;

/** Digs the rooms array out of whatever shape n8n / the model returned. */
function extractRoomArray(data: unknown): unknown[] | null {
  if (Array.isArray(data)) {
    // n8n wraps node output in an array: [{ rooms: [...] }] or [{ text: "..." }]
    if (data.length === 1 && data[0] && typeof data[0] === "object" && !("name" in data[0])) return extractRoomArray(data[0]);
    return data;
  }
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.rooms)) return obj.rooms;
    for (const key of ["text", "output", "content"]) {
      if (typeof obj[key] === "string") {
        const cleaned = (obj[key] as string).replace(/```json|```/g, "").trim();
        try {
          return extractRoomArray(JSON.parse(cleaned));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Turns a raw AI response into validated rooms, sized and (when the model said where each room is) positioned in feet.
 * Invalid entries are dropped, values are kept in sane ranges.
 */
export function parseSketchRooms(data: unknown): RoomDraft[] {
  const raw = extractRoomArray(data) ?? [];
  const rooms: SketchRoom[] = [];
  for (const item of raw) {
    const parsed = RawRoom.safeParse(item);
    if (!parsed.success) continue;
    const r = parsed.data;
    const written = r.w && r.l ? { w: round(clamp(r.w, 3, 60)), l: round(clamp(r.l, 3, 60)) } : {};
    rooms.push({
      name: r.name,
      ...written,
      h: round(clamp(r.h, 8, 16)),
      floor: clamp(r.floor, 1, MAX_FLOORS),
      point: r.point,
      box: r.box,
    });
  }
  return layoutSketch(rooms.slice(0, 40));
}
