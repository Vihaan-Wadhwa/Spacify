// The 2D floor plan: drawing it, plus the geometry the editor needs (hit testing, snapping, placing doors/windows).
// Plan coordinates are feet (x east, z south); a Viewport maps them to CSS pixels on the canvas.

import { footprint, itemRect } from "@/lib/furniture";
import {
  DOOR_WIDTHS,
  FURNITURE,
  OPENING_SIZE,
  ROOM_SIZE,
  doorPartner,
  fitOpenings,
  isSecondLeaf,
  overlappingIds,
  planBounds,
  pointInRoom,
  roomCentre,
  roomColor,
  roomSizeText,
  roomWalls,
  shapeCorners,
  wallEdge,
  wallLength,
  wallLine,
  type FurnitureItem,
  type Opening,
  type Room,
  type Wall,
  type WallKey,
} from "@/lib/rooms";

/** A plan point (feet) is drawn at (ox + x·scale, oy + z·scale) CSS pixels. */
export type Viewport = { scale: number; ox: number; oy: number };

export const MIN_SCALE = 2;
export const MAX_SCALE = 80;
/** Dragged rooms, edges and openings land on multiples of this (feet) unless they snap to another room. */
export const GRID = 0.5;

/** The selected room's resize handles, named by the side(s) they move. */
export type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export type OpeningRef = { roomId: number; openingId: number };
export type ItemRef = { roomId: number; itemId: number };
/** One room's furniture, as drawn on the plan. */
export type RoomFurniture = { room: Room; items: FurnitureItem[] };

/** A line a dragged room snapped to: vertical (x = at) or horizontal (z = at). */
export type Guide = { orient: "v" | "h"; at: number };

export type PlanOverlay = {
  selectedId: number | null;
  selectedOpening: OpeningRef | null;
  /** Faint preview of a door or window about to be placed. */
  ghost: { room: Room; opening: Opening } | null;
  guides: Guide[];
  /** Furniture to draw (null hides it). */
  furniture: RoomFurniture[] | null;
  selectedItem: ItemRef | null;
  /** false for the exported PNG: no grid, selection, guides or ghost. */
  interactive: boolean;
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const snapToGrid = (v: number) => Math.round(v / GRID) * GRID;

export const toPlan = (v: Viewport, sx: number, sy: number) => ({ x: (sx - v.ox) / v.scale, z: (sy - v.oy) / v.scale });

/** A viewport that fits these rooms into a width × height canvas with a margin. */
export function fitViewport(rooms: Room[], width: number, height: number): Viewport {
  const PAD = 60;
  const b = planBounds(rooms);
  if (!b) return { scale: 12, ox: width / 2, oy: height / 2 };
  const w = Math.max(b.maxX - b.minX, 10);
  const l = Math.max(b.maxZ - b.minZ, 10);
  const scale = clamp(Math.min((width - PAD * 2) / w, (height - PAD * 2) / l), MIN_SCALE, MAX_SCALE);
  return { scale, ox: width / 2 - ((b.minX + b.maxX) / 2) * scale, oy: height / 2 - ((b.minZ + b.maxZ) / 2) * scale };
}

// ─── Geometry ────────────────────────────────────────────────

/** Unit vector pointing from a wall into its room. */
const INWARD: Record<Wall, { x: number; z: number }> = { n: { x: 0, z: 1 }, s: { x: 0, z: -1 }, w: { x: 1, z: 0 }, e: { x: -1, z: 0 } };

/** The two ends of an opening (or any stretch of a wall) in plan coordinates. */
function wallPoints(room: Room, wall: WallKey, offset: number, width: number) {
  const line = wallLine(room, wall);
  const a = line.from + offset;
  const b = a + width;
  return line.axis === "x" ? [{ x: a, z: line.at }, { x: b, z: line.at }] : [{ x: line.at, z: a }, { x: line.at, z: b }];
}

function distToSegment(px: number, pz: number, a: { x: number; z: number }, b: { x: number; z: number }) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const t = dx || dz ? clamp(((px - a.x) * dx + (pz - a.z) * dz) / (dx * dx + dz * dz), 0, 1) : 0;
  return Math.hypot(px - (a.x + t * dx), pz - (a.z + t * dz));
}

function handlePoints(r: Room): Record<Handle, { x: number; z: number }> {
  const { x, z, w, l } = r;
  return {
    nw: { x, z }, n: { x: x + w / 2, z }, ne: { x: x + w, z },
    w: { x, z: z + l / 2 }, e: { x: x + w, z: z + l / 2 },
    sw: { x, z: z + l }, s: { x: x + w / 2, z: z + l }, se: { x: x + w, z: z + l },
  };
}

export const HANDLE_CURSOR: Record<Handle, string> = {
  n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize",
  ne: "nesw-resize", sw: "nesw-resize", nw: "nwse-resize", se: "nwse-resize",
};

/** The handle of `room` under a canvas point, if any. `tol` is in feet. */
export function handleAt(room: Room, x: number, z: number, tol: number): Handle | null {
  for (const [name, p] of Object.entries(handlePoints(room)) as [Handle, { x: number; z: number }][]) {
    if (Math.abs(p.x - x) <= tol && Math.abs(p.z - z) <= tol) return name;
  }
  return null;
}

/** The door or window under a point (within `tol` feet of it), checking `preferId`'s room first. */
export function openingAt(rooms: Room[], x: number, z: number, tol: number, preferId: number | null): { room: Room; opening: Opening } | null {
  const ordered = [...rooms].sort((a, b) => Number(b.id === preferId) - Number(a.id === preferId));
  for (const room of ordered) {
    for (const opening of room.openings) {
      const [a, b] = wallPoints(room, opening.wall, opening.offset, opening.width);
      if (distToSegment(x, z, a, b) <= tol) return { room, opening };
    }
  }
  return null;
}

/** The room under a point: `preferId` if it's one of them, otherwise the one drawn last (on top). */
export function roomAt(rooms: Room[], x: number, z: number, preferId: number | null): Room | null {
  const hits = rooms.filter((r) => pointInRoom(r, x, z));
  return hits.find((r) => r.id === preferId) ?? hits.at(-1) ?? null;
}

/** The piece of furniture under a point, if any (the selected one first, then the one drawn last). */
export function furnitureAt(furniture: RoomFurniture[], x: number, z: number, prefer: ItemRef | null): { room: Room; item: FurnitureItem } | null {
  const hits: { room: Room; item: FurnitureItem }[] = [];
  for (const { room, items } of furniture) {
    for (const item of items) {
      const r = itemRect(item);
      if (x >= room.x + r.x0 && x <= room.x + r.x1 && z >= room.z + r.z0 && z <= room.z + r.z1) hits.push({ room, item });
    }
  }
  return hits.find((h) => prefer && h.room.id === prefer.roomId && h.item.id === prefer.itemId) ?? hits.at(-1) ?? null;
}

/**
 * The wall nearest a point, within `tol` feet. Where two rooms share a wall, the room the point is inside wins,
 * so a door swings into the room you clicked from. `along` is how far along the wall (feet from its start) the point is.
 */
export function nearestWall(rooms: Room[], x: number, z: number, tol: number): { room: Room; wall: WallKey; along: number } | null {
  let best: { room: Room; wall: WallKey; along: number; score: number } | null = null;
  for (const room of rooms) {
    const inside = pointInRoom(room, x, z);
    for (const line of roomWalls(room)) {
      const wall = line.key;
      const [a, b] = wallPoints(room, wall, 0, wallLength(room, wall));
      const d = distToSegment(x, z, a, b);
      if (d > tol) continue;
      const score = d - (inside ? tol / 2 : 0);
      if (!best || score < best.score) {
        const along = clamp((line.axis === "x" ? x : z) - line.from, 0, line.to - line.from);
        best = { room, wall, along, score };
      }
    }
  }
  return best && { room: best.room, wall: best.wall, along: best.along };
}

/**
 * The whole unit an opening belongs to, in feet along its wall: a double door's two leaves together, otherwise just
 * the opening. `ids` lists the unit's openings, first leaf first.
 */
export function openingUnit(room: Room, o: Opening): { offset: number; width: number; ids: number[] } {
  const first = isSecondLeaf(room.openings, o) ? room.openings.find((p) => doorPartner(room.openings, p)?.id === o.id) : undefined;
  const lead = first ?? o;
  const partner = doorPartner(room.openings, lead);
  return partner ? { offset: lead.offset, width: lead.width + partner.width, ids: [lead.id, partner.id] } : { offset: o.offset, width: o.width, ids: [o.id] };
}

/** Which end handle of a selected opening's unit is under a point (within `tol` feet), if either. */
export function openingHandleAt(room: Room, o: Opening, x: number, z: number, tol: number): "start" | "end" | null {
  const unit = openingUnit(room, o);
  const [a, b] = wallPoints(room, o.wall, unit.offset, unit.width);
  if (Math.hypot(a.x - x, a.z - z) <= tol) return "start";
  if (Math.hypot(b.x - x, b.z - z) <= tol) return "end";
  return null;
}

/** How far along `room`'s `wall` (feet from its start) a point is, ignoring how far off the wall it is. */
export function alongWall(room: Room, wall: WallKey, x: number, z: number) {
  const line = wallLine(room, wall);
  return clamp((line.axis === "x" ? x : z) - line.from, 0, line.to - line.from);
}

/**
 * Drags one end of an opening's unit to `along` (feet along its wall), keeping the other end where it is.
 * Windows and open gaps stretch freely (on the grid, within their size limits and the wall). Doors snap to the two
 * door sizes: a single door, or a double door of two leaves, whichever the pointer is nearer.
 * Returns the room's new openings and the id to keep selected.
 */
export function dragOpeningEnd(room: Room, o: Opening, end: "start" | "end", along: number): { openings: Opening[]; selectId: number } {
  const len = wallLength(room, o.wall);
  const unit = openingUnit(room, o);
  const fixed = end === "end" ? unit.offset : unit.offset + unit.width;
  const pointer = clamp(snapToGrid(along), 0, len);
  const others = room.openings.filter((x) => !unit.ids.includes(x.id));
  const space = end === "end" ? len - fixed : fixed; // room to grow away from the fixed end

  if (o.kind !== "door") {
    const { min, max } = OPENING_SIZE[o.kind];
    const width = clamp(Math.abs(pointer - fixed), Math.min(min, space), Math.min(max, space));
    return { openings: [...others, { ...o, offset: end === "end" ? fixed : fixed - width, width }], selectId: o.id };
  }

  const wantDouble = Math.abs(pointer - fixed) >= (DOOR_WIDTHS.single + DOOR_WIDTHS.double) / 2;
  const total = wantDouble && space >= DOOR_WIDTHS.double ? DOOR_WIDTHS.double : Math.min(DOOR_WIDTHS.single, space);
  if (total < OPENING_SIZE.door.min) return { openings: room.openings, selectId: o.id };
  const start = end === "end" ? fixed : fixed - total;
  const lead = room.openings.find((x) => x.id === unit.ids[0]) ?? o;
  const secondId = unit.ids[1] ?? Math.max(0, ...room.openings.map((x) => x.id)) + 1;
  const leaves: Opening[] =
    total === DOOR_WIDTHS.double
      ? [
          { ...lead, offset: start, width: total / 2 },
          { ...lead, id: secondId, offset: start + total / 2, width: total / 2 },
        ]
      : [{ ...lead, offset: start, width: total }];
  return { openings: [...others, ...leaves], selectId: lead.id };
}

/** Makes a door single or double, growing from its start (or back from its end if the wall runs out). */
export function setDoorSize(room: Room, o: Opening, size: keyof typeof DOOR_WIDTHS) {
  const unit = openingUnit(room, o);
  const w = DOOR_WIDTHS[size];
  return unit.offset + w <= wallLength(room, o.wall) + 0.01
    ? dragOpeningEnd(room, o, "end", unit.offset + w)
    : dragOpeningEnd(room, o, "start", unit.offset + unit.width - w);
}

/** Where an opening of `width` centred at `along` starts, kept inside the wall and on the grid where possible. */
export function openingOffset(room: Room, wall: WallKey, along: number, width: number): number {
  return clamp(snapToGrid(along - width / 2), 0, Math.max(0, wallLength(room, wall) - width));
}

/**
 * Snaps a value to the nearest of `targets` within `tol`, else to the grid.
 * Returns the snapped value and the target line it met (null for a grid snap).
 */
export function snapValue(v: number, targets: number[], tol: number): { v: number; at: number | null } {
  let best: number | null = null;
  for (const t of targets) if (Math.abs(t - v) <= tol && (best === null || Math.abs(t - v) < Math.abs(best - v))) best = t;
  return best === null ? { v: snapToGrid(v), at: null } : { v: best, at: best };
}

/**
 * Snaps a room being moved to (x, z): either edge lines up with another room's edge if one is within `tol`,
 * otherwise the position goes to the grid.
 */
export function snapMove(room: Room, others: Room[], x: number, z: number, tol: number): { x: number; z: number; guides: Guide[] } {
  const guides: Guide[] = [];
  const axis = (pos: number, size: number, edges: number[], orient: Guide["orient"]) => {
    const lead = snapValue(pos, edges, tol);
    const trail = snapValue(pos + size, edges, tol);
    if (lead.at === null && trail.at === null) return lead.v;
    const useTrail = lead.at === null || (trail.at !== null && Math.abs(trail.v - (pos + size)) < Math.abs(lead.v - pos));
    guides.push({ orient, at: useTrail ? trail.v : lead.v });
    return useTrail ? trail.v - size : lead.v;
  };
  return {
    x: axis(x, room.w, others.flatMap((o) => [o.x, o.x + o.w]), "v"),
    z: axis(z, room.l, others.flatMap((o) => [o.z, o.z + o.l]), "h"),
    guides,
  };
}

/**
 * Resizes a room by dragging `handle` to (x, z). Moved edges snap to other rooms' edges or the grid, and the room stays
 * within ROOM_SIZE. Doors and windows keep their place on the plan when the west or north edge moves.
 */
export function resizeRoom(room: Room, handle: Handle, x: number, z: number, others: Room[], tol: number): { room: Room; guides: Guide[] } {
  const guides: Guide[] = [];
  const edge = (v: number, targets: number[], orient: Guide["orient"]) => {
    const s = snapValue(v, targets, tol);
    if (s.at !== null) guides.push({ orient, at: s.at });
    return s.v;
  };
  const xs = others.flatMap((o) => [o.x, o.x + o.w]);
  const zs = others.flatMap((o) => [o.z, o.z + o.l]);
  const { min, max } = ROOM_SIZE;
  let left = room.x;
  let top = room.z;
  let right = room.x + room.w;
  let bottom = room.z + room.l;
  if (handle.includes("w")) left = clamp(edge(x, xs, "v"), right - max, right - min);
  if (handle.includes("e")) right = clamp(edge(x, xs, "v"), left + min, left + max);
  if (handle.includes("n")) top = clamp(edge(z, zs, "h"), bottom - max, bottom - min);
  if (handle.includes("s")) bottom = clamp(edge(z, zs, "h"), top + min, top + max);

  const round2 = (v: number) => Math.round(v * 100) / 100;
  const openings = room.openings.map((o) => ({
    ...o,
    // A shaped room scales with its box, so its doors and windows only need keeping inside their walls (below).
    offset: room.shape ? o.offset : o.offset + (wallEdge(room, o.wall).axis === "x" ? room.x - left : room.z - top),
  }));
  const next = { ...room, x: left, z: top, w: round2(right - left), l: round2(bottom - top), openings };
  return { room: { ...next, openings: fitOpenings(next) }, guides };
}

// ─── Drawing ─────────────────────────────────────────────────

function palette(isDark: boolean) {
  const css = getComputedStyle(document.documentElement);
  return {
    font: css.getPropertyValue("--font-sans").trim() || "sans-serif",
    accent: css.getPropertyValue("--accent").trim() || (isDark ? "#c8f0a0" : "#2a7a00"),
    bg: isDark ? "#0a0a0a" : "#f5f3ef",
    gridMinor: isDark ? "rgba(255,255,255,0.035)" : "rgba(0,0,0,0.04)",
    gridMajor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.09)",
    wall: isDark ? "rgba(240,237,232,0.75)" : "rgba(26,26,24,0.75)",
    text: isDark ? "rgba(240,237,232,0.9)" : "#1a1a18",
    muted: isDark ? "rgba(136,136,128,0.8)" : "#777770",
    door: isDark ? "rgba(200,240,160,0.75)" : "rgba(42,122,0,0.7)",
    window: isDark ? "#7cc4ff" : "#2a7ab8",
    furniture: isDark ? "rgba(196,150,108,0.32)" : "rgba(140,96,60,0.22)",
    furnitureLine: isDark ? "rgba(222,186,150,0.75)" : "rgba(110,72,44,0.75)",
    danger: isDark ? "#ff7a7a" : "#cc2f2f",
  };
}
type Palette = ReturnType<typeof palette>;

/**
 * Draws one floor's rooms. `rooms` should already be filtered to the floor.
 * The canvas context must be scaled so that 1 unit = 1 CSS pixel.
 */
export function drawPlan(
  ctx: CanvasRenderingContext2D,
  size: { width: number; height: number },
  rooms: Room[],
  view: Viewport,
  isDark: boolean,
  overlay: PlanOverlay,
  emptyText: string
) {
  const c = palette(isDark);
  const { width, height } = size;
  const sx = (x: number) => view.ox + x * view.scale;
  const sy = (z: number) => view.oy + z * view.scale;
  const wallPx = clamp(0.35 * view.scale, 2, 6);

  ctx.fillStyle = c.bg;
  ctx.fillRect(0, 0, width, height);
  if (overlay.interactive) drawGrid(ctx, size, view, c);

  if (!rooms.length) {
    ctx.fillStyle = c.muted;
    ctx.font = `14px ${c.font}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(emptyText, width / 2, height / 2);
    return;
  }

  const overlaps = overlappingIds(rooms);

  /** Traces a room's outline (a rectangle, or a shaped room's corners). */
  const outline = (r: Room) => {
    ctx.beginPath();
    for (const p of shapeCorners(r)) ctx.lineTo(sx(p.x), sy(p.z));
    ctx.closePath();
  };

  // Floor fills
  for (const r of rooms) {
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = roomColor(r.name);
    outline(r);
    ctx.fill();
    if (overlaps.has(r.id)) {
      ctx.fillStyle = c.danger;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Walls (overlapping rooms in red)
  ctx.lineWidth = wallPx;
  ctx.lineJoin = "miter";
  for (const r of rooms) {
    ctx.strokeStyle = overlaps.has(r.id) ? c.danger : c.wall;
    outline(r);
    ctx.stroke();
  }

  // Doors and windows
  const sel = overlay.interactive ? overlay.selectedOpening : null;
  for (const r of rooms) {
    for (const o of r.openings) {
      drawOpening(ctx, view, r, o, c, wallPx, sel?.roomId === r.id && sel.openingId === o.id ? "selected" : "normal", isSecondLeaf(r.openings, o));
    }
  }
  if (overlay.interactive && overlay.ghost) drawOpening(ctx, view, overlay.ghost.room, overlay.ghost.opening, c, wallPx, "ghost", false);

  if (overlay.furniture) {
    for (const { room, items } of overlay.furniture) {
      for (const item of items) {
        const selected = overlay.interactive && overlay.selectedItem?.roomId === room.id && overlay.selectedItem.itemId === item.id;
        drawFurniture(ctx, view, room, item, c, selected);
      }
    }
  }

  // Labels
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const r of rooms) {
    const pw = r.w * view.scale;
    const pl = r.l * view.scale;
    if (pw < 28 || pl < 24) continue;
    const centre = roomCentre(r);
    const cx = sx(centre.x);
    const cy = sy(centre.z);
    ctx.fillStyle = c.text;
    ctx.font = `500 ${Math.min(13, (pw / r.name.length) * 1.4)}px ${c.font}`;
    ctx.fillText(r.name, cx, cy - 7);
    ctx.fillStyle = overlaps.has(r.id) ? c.danger : c.muted;
    ctx.font = `${Math.min(10, pw / 8)}px ${c.font}`;
    ctx.fillText(overlaps.has(r.id) ? "overlaps another room" : roomSizeText(r), cx, cy + 8);
  }

  if (overlay.interactive) {
    // Snap guides
    ctx.save();
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    for (const g of overlay.guides) {
      ctx.beginPath();
      if (g.orient === "v") {
        ctx.moveTo(sx(g.at), 0);
        ctx.lineTo(sx(g.at), height);
      } else {
        ctx.moveTo(0, sy(g.at));
        ctx.lineTo(width, sy(g.at));
      }
      ctx.stroke();
    }
    ctx.restore();

    // Selected door/window/opening: a handle at each end of its unit for resizing
    const selOpening = overlay.selectedOpening && rooms.find((r) => r.id === overlay.selectedOpening!.roomId);
    const opening = selOpening?.openings.find((o) => o.id === overlay.selectedOpening!.openingId);
    if (selOpening && opening) {
      const unit = openingUnit(selOpening, opening);
      ctx.strokeStyle = c.accent;
      ctx.fillStyle = c.accent;
      ctx.lineWidth = 1.5;
      for (const p of wallPoints(selOpening, opening.wall, unit.offset, unit.width)) {
        ctx.beginPath();
        ctx.arc(sx(p.x), sy(p.z), 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Selected room: outline and resize handles
    const selected = rooms.find((r) => r.id === overlay.selectedId);
    if (selected) {
      ctx.strokeStyle = c.accent;
      ctx.lineWidth = 1.5;
      if (selected.shape) {
        // A shaped room: its outline, plus a faint box showing what the handles stretch
        outline(selected);
        ctx.stroke();
        ctx.save();
        ctx.setLineDash([3, 4]);
        ctx.globalAlpha = 0.5;
        ctx.strokeRect(sx(selected.x) - 3, sy(selected.z) - 3, selected.w * view.scale + 6, selected.l * view.scale + 6);
        ctx.restore();
      } else {
        ctx.strokeRect(sx(selected.x) - 3, sy(selected.z) - 3, selected.w * view.scale + 6, selected.l * view.scale + 6);
      }
      for (const p of Object.values(handlePoints(selected))) {
        ctx.fillStyle = c.bg;
        ctx.fillRect(sx(p.x) - 4, sy(p.z) - 4, 8, 8);
        ctx.strokeRect(sx(p.x) - 4, sy(p.z) - 4, 8, 8);
      }
    }
  }

  drawCompass(ctx, c);
  drawScaleBar(ctx, size, view, c);
}

function drawGrid(ctx: CanvasRenderingContext2D, { width, height }: { width: number; height: number }, view: Viewport, c: Palette) {
  // 1 ft lines when there's room for them, 5 ft lines always (or 10 ft when zoomed far out).
  const major = view.scale < 4 ? 10 : 5;
  const steps = view.scale >= 8 ? [1, major] : [major];
  for (const step of steps) {
    ctx.strokeStyle = step === 1 ? c.gridMinor : c.gridMajor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const x0 = Math.floor(-view.ox / view.scale / step) * step;
    for (let x = x0; view.ox + x * view.scale <= width; x += step) {
      const px = Math.round(view.ox + x * view.scale) + 0.5;
      ctx.moveTo(px, 0);
      ctx.lineTo(px, height);
    }
    const z0 = Math.floor(-view.oy / view.scale / step) * step;
    for (let z = z0; view.oy + z * view.scale <= height; z += step) {
      const py = Math.round(view.oy + z * view.scale) + 0.5;
      ctx.moveTo(0, py);
      ctx.lineTo(width, py);
    }
    ctx.stroke();
  }
}

/**
 * One piece of furniture seen from above: its footprint plus a simple symbol (pillows on a bed, a sofa's back and
 * arms, chairs round a table…). `u` runs across the piece, `v` from its back (against the wall) to its front.
 */
function drawFurniture(ctx: CanvasRenderingContext2D, view: Viewport, room: Room, item: FurnitureItem, c: Palette, selected: boolean) {
  const { w, d } = FURNITURE[item.type];
  const fp = footprint(item.type, item.rot);
  const cx = room.x + item.x, cz = room.z + item.z;
  const at = (u: number, v: number): [number, number] => {
    const [px, pz] =
      item.rot === 0 ? [cx + u, cz - d / 2 + v] : item.rot === 90 ? [cx + d / 2 - v, cz + u] : item.rot === 180 ? [cx - u, cz + d / 2 - v] : [cx - d / 2 + v, cz - u];
    return [view.ox + px * view.scale, view.oy + pz * view.scale];
  };
  const shape = (u0: number, u1: number, v0: number, v1: number, fill: string | null) => {
    ctx.beginPath();
    for (const [u, v] of [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]) ctx.lineTo(...at(u, v));
    ctx.closePath();
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    ctx.stroke();
  };
  const line = (u0: number, v0: number, u1: number, v1: number) => {
    ctx.beginPath();
    ctx.moveTo(...at(u0, v0));
    ctx.lineTo(...at(u1, v1));
    ctx.stroke();
  };
  ctx.save();
  ctx.lineWidth = selected ? 2 : 1;
  ctx.strokeStyle = selected ? c.accent : c.furnitureLine;
  const fill = c.furniture;
  const hw = w / 2;
  switch (item.type) {
    case "bed_single":
    case "bed_double":
    case "bed_queen":
    case "bed_king": {
      shape(-hw, hw, 0, d, fill);
      shape(-hw, hw, 0, 0.3, null);
      const pillows = w > 4 ? 2 : 1;
      const pw = (w - 0.8) / pillows - (pillows > 1 ? 0.2 : 0);
      for (let i = 0; i < pillows; i++) {
        const u0 = pillows === 1 ? -pw / 2 : i ? 0.1 : -0.1 - pw;
        shape(u0, u0 + pw, 0.55, 1.6, null);
      }
      line(-hw, d * 0.45, hw, d * 0.45);
      break;
    }
    case "sofa":
      shape(-hw, hw, 0, d, fill);
      shape(-hw + 0.7, hw - 0.7, 0, 0.8, null);
      shape(-hw, -hw + 0.7, 0, d, null);
      shape(hw - 0.7, hw, 0, d, null);
      for (let i = 1; i < 3; i++) line(-hw + 0.7 + ((w - 1.4) * i) / 3, 0.8, -hw + 0.7 + ((w - 1.4) * i) / 3, d);
      break;
    case "dining_table": {
      const tw = Math.min(5.3, w - 2.6), td = Math.min(3, d - 3);
      shape(-tw / 2, tw / 2, d / 2 - td / 2, d / 2 + td / 2, fill);
      for (const u of [-tw * 0.38, tw * 0.38]) {
        shape(u - 0.7, u + 0.7, d / 2 - td / 2 - 1.6, d / 2 - td / 2 - 0.2, null);
        shape(u - 0.7, u + 0.7, d / 2 + td / 2 + 0.2, d / 2 + td / 2 + 1.6, null);
      }
      for (const s of [-1, 1]) shape(s * (tw / 2 + 0.2), s * (tw / 2 + 1.6), d / 2 - 0.7, d / 2 + 0.7, null);
      break;
    }
    case "study_table":
      shape(-hw, hw, 0, d, fill);
      shape(-w * 0.12 - 0.7, -w * 0.12 + 0.7, d + 0.1, d + 1.5, null);
      break;
    case "cupboard": {
      shape(-hw, hw, 0, d, fill);
      line(-hw, d - 0.15, hw, d - 0.15);
      const doors = Math.max(2, Math.round(w / 1.6));
      for (let i = 1; i < doors; i++) line(-hw + (w * i) / doors, 0, -hw + (w * i) / doors, d);
      break;
    }
    case "tv_panel":
      shape(-hw, hw, 0, d, fill);
      shape(-2.1, 2.1, 0.05, 0.3, null);
      break;
    case "dressing_table":
      shape(-hw, hw, 0, d, fill);
      shape(-w * 0.36, w * 0.26, 0, 0.15, null);
      ctx.beginPath();
      ctx.arc(...at(-w * 0.12, d + 0.7), 0.6 * view.scale, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case "bedside_table":
      shape(-hw, hw, 0, d, fill);
      ctx.beginPath();
      ctx.arc(...at(-w * 0.15, d * 0.45), 0.35 * view.scale, 0, Math.PI * 2);
      ctx.stroke();
      break;
  }
  // Name, if there's room for it
  const pw = fp.w * view.scale, pl = fp.l * view.scale;
  const label = FURNITURE[item.type].label;
  if (Math.max(pw, pl) > label.length * 5.5 && Math.min(pw, pl) > 12) {
    ctx.fillStyle = selected ? c.accent : c.furnitureLine;
    ctx.font = `10px ${c.font}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const [lx, ly] = [view.ox + cx * view.scale, view.oy + cz * view.scale];
    ctx.translate(lx, ly);
    if (pl > pw * 1.4 && pw < label.length * 5.5) ctx.rotate(-Math.PI / 2);
    ctx.fillText(label, 0, 0);
  }
  ctx.restore();
}

/**
 * An open gap (no door) is just a break in the wall.
 * A door is a gap with a leaf and its swing (hinged at the opening's start, opening into the room; the second leaf of
 * a double door is hinged at its end, so the pair meets in the middle). A window is a gap with a thin double line.
 */
function drawOpening(
  ctx: CanvasRenderingContext2D,
  view: Viewport,
  room: Room,
  o: Opening,
  c: Palette,
  wallPx: number,
  mode: "normal" | "selected" | "ghost",
  hingeAtEnd: boolean
) {
  const ends = wallPoints(room, o.wall, o.offset, o.width).map((p) => ({ x: view.ox + p.x * view.scale, y: view.oy + p.z * view.scale }));
  const [a, b] = hingeAtEnd ? [ends[1], ends[0]] : ends;
  const len = o.width * view.scale;
  const n = INWARD[wallEdge(room, o.wall).dir];
  const ux = (b.x - a.x) / (len || 1);
  const uy = (b.y - a.y) / (len || 1);

  ctx.save();
  if (mode === "ghost") ctx.globalAlpha = 0.5;

  // Clear the wall where the opening is
  ctx.lineCap = "butt";
  ctx.strokeStyle = mode === "selected" ? c.accent : c.bg;
  ctx.globalAlpha *= mode === "selected" ? 0.35 : 1;
  ctx.lineWidth = wallPx + (mode === "selected" ? 8 : 1);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  if (mode === "selected") {
    ctx.globalAlpha = 1;
    ctx.strokeStyle = c.bg;
    ctx.lineWidth = wallPx + 1;
    ctx.stroke();
  }

  if (o.kind === "open") {
    // No door: just the gap, with short marks where the wall ends and a faint line where it used to run
    const half = wallPx / 2 + 2;
    ctx.globalAlpha = mode === "ghost" ? 0.6 : 1;
    ctx.strokeStyle = mode === "normal" ? c.wall : c.accent;
    ctx.lineWidth = mode === "selected" ? 2 : 1.25;
    ctx.beginPath();
    for (const p of [a, b]) {
      ctx.moveTo(p.x - uy * half, p.y + ux * half);
      ctx.lineTo(p.x + uy * half, p.y - ux * half);
    }
    ctx.stroke();
    ctx.setLineDash([2, 4]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = mode === "normal" ? c.muted : c.accent;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
    return;
  }

  const color = o.kind === "door" ? c.door : c.window;
  ctx.strokeStyle = mode === "selected" ? c.accent : color;
  ctx.lineWidth = mode === "selected" ? 2 : 1.25;
  if (o.kind === "door") {
    // Leaf, standing open at 90° into the room, then the arc it sweeps back to the far jamb
    const leaf = { x: a.x + n.x * len, y: a.y + n.z * len };
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(leaf.x, leaf.y);
    ctx.stroke();
    const start = Math.atan2(n.z, n.x);
    let sweep = Math.atan2(uy, ux) - start;
    if (sweep > Math.PI) sweep -= Math.PI * 2;
    if (sweep < -Math.PI) sweep += Math.PI * 2;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(a.x, a.y, len, start, start + sweep, sweep < 0);
    ctx.stroke();
  } else {
    const off = wallPx / 2;
    ctx.beginPath();
    for (const k of [-off, 0, off]) {
      ctx.moveTo(a.x - uy * k, a.y + ux * k);
      ctx.lineTo(b.x - uy * k, b.y + ux * k);
    }
    ctx.moveTo(a.x - uy * off, a.y + ux * off);
    ctx.lineTo(a.x + uy * off, a.y - ux * off);
    ctx.moveTo(b.x - uy * off, b.y + ux * off);
    ctx.lineTo(b.x + uy * off, b.y - ux * off);
    ctx.stroke();
  }
  ctx.restore();
}

function drawCompass(ctx: CanvasRenderingContext2D, c: Palette) {
  const x = 28;
  const y = 30;
  ctx.fillStyle = "#ffcc44";
  ctx.beginPath();
  ctx.moveTo(x, y - 12);
  ctx.lineTo(x + 6, y + 4);
  ctx.lineTo(x, y);
  ctx.lineTo(x - 6, y + 4);
  ctx.closePath();
  ctx.fill();
  ctx.font = `600 10px ${c.font}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText("N", x, y + 8);
}

/** A 10 ft bar (or 50 ft when zoomed far out) in the bottom-left corner. */
function drawScaleBar(ctx: CanvasRenderingContext2D, { height }: { height: number }, view: Viewport, c: Palette) {
  const feet = view.scale < 4 ? 50 : 10;
  const barPx = feet * view.scale;
  const bx = 24;
  const by = height - 24;
  ctx.strokeStyle = c.muted;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(bx, by);
  ctx.lineTo(bx + barPx, by);
  ctx.moveTo(bx, by - 4);
  ctx.lineTo(bx, by + 4);
  ctx.moveTo(bx + barPx, by - 4);
  ctx.lineTo(bx + barPx, by + 4);
  ctx.stroke();
  ctx.fillStyle = c.muted;
  ctx.font = `10px ${c.font}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(`${feet} ft`, bx + barPx / 2, by - 8);
}
