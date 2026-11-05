// Turning a rough outline into a room shape: a freehand stroke (mouse or finger) or a photo of a drawing on paper
// becomes a clean outline with straight walls and right-angled corners, like a notes app's shape recognition.

export type Point = { x: number; y: number };

/** A cleaned-up outline: corners clockwise as fractions (0–1) of its box, and the box's width ÷ height. */
export type Straightened = { corners: [number, number][]; aspect: number };

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Distance from p to the segment a–b. */
function segDist(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = dx || dy ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Ramer–Douglas–Peucker: keeps only the points that matter for the line's shape, within `eps`. */
function simplify(pts: Point[], eps: number): Point[] {
  if (pts.length < 3) return pts;
  let worst = 0, index = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = segDist(pts[i], pts[0], pts[pts.length - 1]);
    if (d > worst) [worst, index] = [d, i];
  }
  if (worst <= eps) return [pts[0], pts[pts.length - 1]];
  return [...simplify(pts.slice(0, index + 1), eps).slice(0, -1), ...simplify(pts.slice(index), eps)];
}

/** Groups nearby values (within `tol`) and replaces each with its group's average, so near-equal walls line up. */
function cluster(values: number[], tol: number): (v: number) => number {
  const sorted = [...values].sort((a, b) => a - b);
  const groups: number[][] = [];
  for (const v of sorted) {
    const g = groups.at(-1);
    if (g && v - g[g.length - 1] <= tol) g.push(v);
    else groups.push([v]);
  }
  const means = groups.map((g) => ({ lo: g[0], hi: g[g.length - 1], mean: g.reduce((s, x) => s + x, 0) / g.length }));
  return (v) => means.find((m) => v >= m.lo - 1e-9 && v <= m.hi + 1e-9)?.mean ?? v;
}

/** Whether a closed outline of horizontal and vertical edges crosses itself. */
function selfIntersects(c: Point[]) {
  const n = c.length;
  for (let i = 0; i < n; i++) {
    const a1 = c[i], a2 = c[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // neighbours through the wrap-around
      const b1 = c[j], b2 = c[(j + 1) % n];
      const ax0 = Math.min(a1.x, a2.x), ax1 = Math.max(a1.x, a2.x), ay0 = Math.min(a1.y, a2.y), ay1 = Math.max(a1.y, a2.y);
      const bx0 = Math.min(b1.x, b2.x), bx1 = Math.max(b1.x, b2.x), by0 = Math.min(b1.y, b2.y), by1 = Math.max(b1.y, b2.y);
      if (ax0 <= bx1 + 1e-9 && bx0 <= ax1 + 1e-9 && ay0 <= by1 + 1e-9 && by0 <= ay1 + 1e-9) return true;
    }
  }
  return false;
}

/** Drops corners that don't turn (on a straight run) and zero-length edges, until nothing changes. */
function tidy(c: Point[]): Point[] {
  let out = c;
  for (let changed = true; changed && out.length > 3; ) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const p = out[(i + out.length - 1) % out.length], q = out[i], r = out[(i + 1) % out.length];
      const straight = (Math.abs(p.x - q.x) < 1e-6 && Math.abs(q.x - r.x) < 1e-6) || (Math.abs(p.y - q.y) < 1e-6 && Math.abs(q.y - r.y) < 1e-6);
      if (straight || dist(p, q) < 1e-6) {
        out = out.filter((_, k) => k !== i);
        changed = true;
        break;
      }
    }
  }
  return out;
}

/**
 * Straightens a rough closed outline (screen coordinates, y down) into right-angled walls. Each stretch of the line is
 * taken as running across or down, runs going the same way are merged, walls at nearly the same level are lined up,
 * and the corners are where the walls meet. Null if it doesn't make a sensible room (too few walls, or it crosses itself).
 */
export function straighten(raw: Point[]): Straightened | null {
  const pts = raw.filter((p, i) => i === 0 || dist(p, raw[i - 1]) > 0.5);
  if (pts.length < 6) return null;
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
  const diag = Math.hypot(w, h);
  if (w < diag * 0.1 || h < diag * 0.1) return null;

  // Simplify the closed loop, starting from the point farthest from the first so the seam doesn't hide a corner.
  const far = pts.reduce((best, p, i) => (dist(p, pts[0]) > dist(pts[best], pts[0]) ? i : best), 0);
  const loop = [...pts.slice(far), ...pts.slice(0, far), pts[far]];
  const simple = simplify(loop, diag * 0.035).slice(0, -1);
  if (simple.length < 3) return null;

  // Each stretch runs across (H) or down (V); merge neighbours that run the same way (round the loop too).
  type Run = { dir: "H" | "V"; pts: Point[] };
  let runs: Run[] = simple.map((p, i) => {
    const q = simple[(i + 1) % simple.length];
    return { dir: Math.abs(q.x - p.x) >= Math.abs(q.y - p.y) ? "H" : "V", pts: [p, q] };
  });
  for (let merged = true; merged && runs.length > 1; ) {
    merged = false;
    for (let i = 0; i < runs.length; i++) {
      const next = (i + 1) % runs.length;
      if (runs[i].dir === runs[next].dir && i !== next) {
        const joined = { dir: runs[i].dir, pts: [...runs[i].pts, ...runs[next].pts] };
        runs = runs.flatMap((r, k) => (k === i ? [joined] : k === next ? [] : [r]));
        merged = true;
        break;
      }
    }
  }
  if (runs.length < 4) return null;

  // Each wall's level: the average height (H) or position (V) of its points, lined up with similar walls.
  const level = runs.map((r) => r.pts.reduce((s, p) => s + (r.dir === "H" ? p.y : p.x), 0) / r.pts.length);
  const snapY = cluster(level.filter((_, i) => runs[i].dir === "H"), h * 0.07);
  const snapX = cluster(level.filter((_, i) => runs[i].dir === "V"), w * 0.07);
  const lv = level.map((v, i) => (runs[i].dir === "H" ? snapY(v) : snapX(v)));

  // Corners are where each wall meets the next.
  let corners: Point[] = runs.map((r, i) => {
    const j = (i + 1) % runs.length;
    return r.dir === "H" ? { x: lv[j], y: lv[i] } : { x: lv[i], y: lv[j] };
  });
  corners = tidy(corners);
  if (corners.length < 4 || selfIntersects(corners)) return null;

  // Clockwise on screen (y down) means a positive shoelace sum.
  const area = corners.reduce((s, p, i) => s + p.x * corners[(i + 1) % corners.length].y - corners[(i + 1) % corners.length].x * p.y, 0);
  if (area < 0) corners.reverse();
  // Start from the top-left-most corner, so the walls are numbered the same way each time.
  const start = corners.reduce((best, p, i) => (p.x + p.y < corners[best].x + corners[best].y ? i : best), 0);
  corners = [...corners.slice(start), ...corners.slice(0, start)];

  const minX = Math.min(...corners.map((p) => p.x)), maxX = Math.max(...corners.map((p) => p.x));
  const minY = Math.min(...corners.map((p) => p.y)), maxY = Math.max(...corners.map((p) => p.y));
  if (maxX - minX < 1e-6 || maxY - minY < 1e-6) return null;
  return {
    corners: corners.map((p) => [(p.x - minX) / (maxX - minX), (p.y - minY) / (maxY - minY)]),
    aspect: (maxX - minX) / (maxY - minY),
  };
}

/**
 * Fits straightened corners to a room of w × l feet, with every corner on the half-foot grid, and tidies again
 * (snapping can line walls up). Null if what's left is a plain rectangle (or nothing usable).
 */
export function fitShape(corners: [number, number][], w: number, l: number): [number, number][] | null {
  const snapped = corners.map(([u, v]) => ({ x: Math.round(u * w * 2) / 2, y: Math.round(v * l * 2) / 2 }));
  const clean = tidy(snapped);
  if (clean.length <= 4 || selfIntersects(clean)) return null;
  return clean.map((p) => [p.x / w, p.y / l]);
}

/**
 * Finds the room drawn on a photo of paper and returns its outline (image pixels, roughly in order round it).
 * Dark pen lines are picked out against the paper's local brightness (so shadows and uneven light don't matter),
 * thickened a little to close small gaps, and the paper outside them filled in from the edges; the biggest
 * enclosed area left is the room. Null if nothing closed is found.
 */
export function traceDrawing(img: ImageData): Point[] | null {
  const { width: W, height: H, data } = img;
  const lum = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) lum[i] = data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114;

  // Local mean brightness (box blur via an integral image)
  const integral = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) {
      row += lum[y * W + x];
      integral[(y + 1) * (W + 1) + x + 1] = integral[y * (W + 1) + x + 1] + row;
    }
  }
  const r = Math.max(4, Math.round(Math.max(W, H) / 20));
  const ink = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(W, x + r + 1), y0 = Math.max(0, y - r), y1 = Math.min(H, y + r + 1);
      const sum = integral[y1 * (W + 1) + x1] - integral[y0 * (W + 1) + x1] - integral[y1 * (W + 1) + x0] + integral[y0 * (W + 1) + x0];
      const mean = sum / ((x1 - x0) * (y1 - y0));
      if (lum[y * W + x] < mean - 22) ink[y * W + x] = 1;
    }
  }
  // Thicken the lines by a couple of pixels so small gaps in the pen stroke close
  const grow = Math.max(1, Math.round(Math.max(W, H) / 150));
  const thick = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!ink[y * W + x]) continue;
      for (let dy = -grow; dy <= grow; dy++) for (let dx = -grow; dx <= grow; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < W && ny < H) thick[ny * W + nx] = 1;
      }
    }
  }

  // Label the paper: 1 = outside (reached from the border), 2+ = enclosed areas
  const label = new Int32Array(W * H);
  const fill = (sx: number, sy: number, id: number) => {
    const stack = [sy * W + sx];
    label[stack[0]] = id;
    let count = 0;
    while (stack.length) {
      const i = stack.pop()!;
      count++;
      const x = i % W, y = (i - x) / W;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (!label[j] && !thick[j]) {
          label[j] = id;
          stack.push(j);
        }
      }
    }
    return count;
  };
  for (let x = 0; x < W; x++) for (const y of [0, H - 1]) if (!label[y * W + x] && !thick[y * W + x]) fill(x, y, 1);
  for (let y = 0; y < H; y++) for (const x of [0, W - 1]) if (!label[y * W + x] && !thick[y * W + x]) fill(x, y, 1);
  let best = { id: 0, size: 0 };
  let next = 2;
  for (let i = 0; i < W * H; i++) {
    if (label[i] || thick[i]) continue;
    const id = next++;
    const size = fill(i % W, Math.floor(i / W), id);
    if (size > best.size) best = { id, size };
  }
  if (best.size < W * H * 0.02) return null;

  // Trace the area's outer edge (Moore neighbour tracing), clockwise on screen
  const inRegion = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && label[y * W + x] === best.id;
  let start = -1;
  for (let i = 0; i < W * H && start < 0; i++) if (label[i] === best.id) start = i;
  const sx = start % W, sy = (start - sx) / W;
  const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const out: Point[] = [{ x: sx, y: sy }];
  let cx = sx, cy = sy, back = 4; // we "came from" the west (the scan found the top-left pixel first)
  for (let steps = 0; steps < W * H * 2; steps++) {
    let moved = false;
    for (let k = 1; k <= 8; k++) {
      const d = (back + k) % 8;
      const nx = cx + dirs[d][0], ny = cy + dirs[d][1];
      if (inRegion(nx, ny)) {
        cx = nx;
        cy = ny;
        back = (d + 4) % 8;
        moved = true;
        break;
      }
    }
    if (!moved || (cx === sx && cy === sy)) break;
    out.push({ x: cx, y: cy });
  }
  return out.length >= 12 ? out : null;
}
