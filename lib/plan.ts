// The 2D floor plan: drawing it, plus the geometry the editor needs (hit testing, snapping, placing doors/windows).
// Plan coordinates are feet (x east, z south); a Viewport maps them to CSS pixels on the canvas.

import {
  ROOM_SIZE,
  WALLS,
  fitOpenings,
  overlappingIds,
  planBounds,
  roomColor,
  wallLength,
  wallLine,
  type Opening,
  type Room,
  type Wall,
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

/** A line a dragged room snapped to: vertical (x = at) or horizontal (z = at). */
export type Guide = { orient: "v" | "h"; at: number };

export type PlanOverlay = {
  selectedId: number | null;
  selectedOpening: OpeningRef | null;
  /** Faint preview of a door or window about to be placed. */
  ghost: { room: Room; opening: Opening } | null;
  guides: Guide[];
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
function wallPoints(room: Room, wall: Wall, offset: number, width: number) {
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
  const hits = rooms.filter((r) => x >= r.x && x <= r.x + r.w && z >= r.z && z <= r.z + r.l);
  return hits.find((r) => r.id === preferId) ?? hits.at(-1) ?? null;
}

/**
 * The wall nearest a point, within `tol` feet. Where two rooms share a wall, the room the point is inside wins,
 * so a door swings into the room you clicked from. `along` is how far along the wall (feet from its start) the point is.
 */
export function nearestWall(rooms: Room[], x: number, z: number, tol: number): { room: Room; wall: Wall; along: number } | null {
  let best: { room: Room; wall: Wall; along: number; score: number } | null = null;
  for (const room of rooms) {
    const inside = x >= room.x && x <= room.x + room.w && z >= room.z && z <= room.z + room.l;
    for (const wall of WALLS) {
      const line = wallLine(room, wall);
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

/** Where an opening of `width` centred at `along` starts, kept inside the wall and on the grid where possible. */
export function openingOffset(room: Room, wall: Wall, along: number, width: number): number {
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
    offset: o.offset + (o.wall === "n" || o.wall === "s" ? room.x - left : room.z - top),
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

  // Floor fills
  for (const r of rooms) {
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = roomColor(r.name);
    ctx.fillRect(sx(r.x), sy(r.z), r.w * view.scale, r.l * view.scale);
    if (overlaps.has(r.id)) {
      ctx.fillStyle = c.danger;
      ctx.fillRect(sx(r.x), sy(r.z), r.w * view.scale, r.l * view.scale);
    }
    ctx.globalAlpha = 1;
  }

  // Walls (overlapping rooms in red)
  ctx.lineWidth = wallPx;
  ctx.lineJoin = "miter";
  for (const r of rooms) {
    ctx.strokeStyle = overlaps.has(r.id) ? c.danger : c.wall;
    ctx.strokeRect(sx(r.x), sy(r.z), r.w * view.scale, r.l * view.scale);
  }

  // Doors and windows
  const sel = overlay.interactive ? overlay.selectedOpening : null;
  for (const r of rooms) {
    for (const o of r.openings) {
      drawOpening(ctx, view, r, o, c, wallPx, sel?.roomId === r.id && sel.openingId === o.id ? "selected" : "normal");
    }
  }
  if (overlay.interactive && overlay.ghost) drawOpening(ctx, view, overlay.ghost.room, overlay.ghost.opening, c, wallPx, "ghost");

  // Labels
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const r of rooms) {
    const pw = r.w * view.scale;
    const pl = r.l * view.scale;
    if (pw < 28 || pl < 24) continue;
    const cx = sx(r.x) + pw / 2;
    const cy = sy(r.z) + pl / 2;
    ctx.fillStyle = c.text;
    ctx.font = `500 ${Math.min(13, (pw / r.name.length) * 1.4)}px ${c.font}`;
    ctx.fillText(r.name, cx, cy - 7);
    ctx.fillStyle = overlaps.has(r.id) ? c.danger : c.muted;
    ctx.font = `${Math.min(10, pw / 8)}px ${c.font}`;
    ctx.fillText(overlaps.has(r.id) ? "overlaps another room" : `${r.w}×${r.l} ft`, cx, cy + 8);
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

    // Selected room: outline and resize handles
    const selected = rooms.find((r) => r.id === overlay.selectedId);
    if (selected) {
      ctx.strokeStyle = c.accent;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(sx(selected.x) - 3, sy(selected.z) - 3, selected.w * view.scale + 6, selected.l * view.scale + 6);
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
 * A door is a gap with a leaf and its swing (hinged at the opening's start, opening into the room);
 * a window is a gap with a thin double line.
 */
function drawOpening(
  ctx: CanvasRenderingContext2D,
  view: Viewport,
  room: Room,
  o: Opening,
  c: Palette,
  wallPx: number,
  mode: "normal" | "selected" | "ghost"
) {
  const [a, b] = wallPoints(room, o.wall, o.offset, o.width).map((p) => ({ x: view.ox + p.x * view.scale, y: view.oy + p.z * view.scale }));
  const len = o.width * view.scale;
  const n = INWARD[o.wall];
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
