import { DEMO_ROOMS } from "@/lib/demoPlan";

// The demo house (the one /design?demo=1 opens) drawn three ways: as a hand sketch, as the to-scale plan,
// and as a cut-away axonometric. All three come from the same rooms, so they always agree.

const SHORT: Record<string, string> = {
  "Living Room": "LR",
  "Drawing Room": "Drg",
  "Dining Room": "Din",
  Kitchen: "K",
  "Master Bedroom": "MB",
  "Bedroom 2": "B2",
  "Bedroom 3": "B3",
  Bathroom: "T",
  "Walk-in Closet": "WIC",
  "Pooja Room": "PR",
  Balcony: "Bal",
  Store: "St",
  Passage: "",
};

const W = Math.max(...DEMO_ROOMS.map((r) => r.x + r.w));
const L = Math.max(...DEMO_ROOMS.map((r) => r.z + r.l));

/** Deterministic wobble, so the server and every visit draw the same sketch. */
function jit(seed: number, amp: number) {
  const x = Math.sin(seed * 91.7) * 43758.5453;
  return (x - Math.floor(x) - 0.5) * amp;
}

/** A hand-drawn line: slightly off, slightly curved, overshooting at the ends. */
function pencil(x0: number, y0: number, x1: number, y1: number, seed: number) {
  const over = 0.7;
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  const ux = (x1 - x0) / len;
  const uy = (y1 - y0) / len;
  const ax = x0 - ux * over + jit(seed, 0.5);
  const ay = y0 - uy * over + jit(seed + 1, 0.5);
  const bx = x1 + ux * over + jit(seed + 2, 0.5);
  const by = y1 + uy * over + jit(seed + 3, 0.5);
  const mx = (ax + bx) / 2 - uy * jit(seed + 4, 1.4);
  const my = (ay + by) / 2 + ux * jit(seed + 4, 1.4);
  return `M${ax.toFixed(2)} ${ay.toFixed(2)} Q${mx.toFixed(2)} ${my.toFixed(2)} ${bx.toFixed(2)} ${by.toFixed(2)}`;
}

export function SketchDrawing() {
  const pad = 4;
  const grid: number[] = [];
  for (let g = -pad; g <= W + pad; g += 2) grid.push(g);
  const rows: number[] = [];
  for (let g = -pad; g <= L + pad; g += 2) rows.push(g);
  return (
    <svg className="lp-drawing lp-sketch" viewBox={`${-pad} ${-pad} ${W + pad * 2} ${L + pad * 2}`} role="img" aria-label="A hand-drawn floor plan sketch on squared paper, rooms marked Drg, Din, K, MB, B2, B3, T and Pooja with sizes">
      <g className="lp-sketch-grid">
        {grid.map((g) => <line key={`v${g}`} x1={g} y1={-pad} x2={g} y2={L + pad} />)}
        {rows.map((g) => <line key={`h${g}`} x1={-pad} y1={g} x2={W + pad} y2={g} />)}
      </g>
      <g className="lp-sketch-ink">
        {DEMO_ROOMS.map((r, i) => (
          <g key={`${r.name}-${r.x}-${r.z}`}>
            <path d={pencil(r.x, r.z, r.x + r.w, r.z, i * 10 + 1)} />
            <path d={pencil(r.x + r.w, r.z, r.x + r.w, r.z + r.l, i * 10 + 2)} />
            <path d={pencil(r.x + r.w, r.z + r.l, r.x, r.z + r.l, i * 10 + 3)} />
            <path d={pencil(r.x, r.z + r.l, r.x, r.z, i * 10 + 4)} />
            <text x={r.x + r.w / 2 + jit(i + 7, 1.5)} y={r.z + r.l / 2 - 0.4} transform={`rotate(${jit(i + 3, 6).toFixed(1)} ${r.x + r.w / 2} ${r.z + r.l / 2})`}>
              <tspan className="lp-sketch-label">{SHORT[r.name] ?? r.name}</tspan>
              <tspan className="lp-sketch-dim" x={r.x + r.w / 2 + jit(i + 7, 1.5)} dy="2.6">
                {r.w}×{r.l}
              </tspan>
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
}

export function PlanDrawing() {
  const pad = 3;
  return (
    <svg className="lp-drawing lp-plan" viewBox={`${-pad} ${-pad} ${W + pad * 2} ${L + pad * 2 + 3}`} role="img" aria-label="The same plan drawn to scale with full room names and sizes in feet">
      {DEMO_ROOMS.map((r) => (
        <g key={`${r.name}-${r.x}-${r.z}`}>
          <rect x={r.x} y={r.z} width={r.w} height={r.l} />
          <text className="lp-plan-name" x={r.x + 0.9} y={r.z + 2.1}>{r.name}</text>
          <text className="lp-plan-dim" x={r.x + 0.9} y={r.z + 3.9}>{r.w} × {r.l} ft</text>
          {r.openings.map((o) =>
            o.kind === "door" && o.wall === "s" ? (
              <path key={o.id} className="lp-plan-door" d={`M${r.x + o.offset} ${r.z + r.l} a${o.width} ${o.width} 0 0 1 ${o.width} ${-o.width}`} />
            ) : o.kind === "window" && o.wall === "n" ? (
              <line key={o.id} className="lp-plan-window" x1={r.x + o.offset} y1={r.z} x2={r.x + o.offset + o.width} y2={r.z} />
            ) : null
          )}
        </g>
      ))}
      <g className="lp-plan-scale">
        <line x1={0} y1={L + 2.4} x2={10} y2={L + 2.4} />
        <line x1={0} y1={L + 1.8} x2={0} y2={L + 3} />
        <line x1={10} y1={L + 1.8} x2={10} y2={L + 3} />
        <text x={11} y={L + 3}>10 ft</text>
      </g>
    </svg>
  );
}

// Isometric projection: plan x/z in feet, y up.
const C = Math.cos(Math.PI / 6);
const S = 0.5;
const iso = (x: number, z: number, y = 0) => [(x - z) * C, (x + z) * S - y] as const;
const poly = (pts: (readonly [number, number])[]) => pts.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(" ");

export function AxoDrawing() {
  const H = 4.5; // cut-away wall height, ft
  const T = 0.5; // wall thickness
  type Face = { key: string; depth: number; pts: (readonly [number, number])[]; cls: string };
  const faces: Face[] = [];
  for (const r of DEMO_ROOMS) {
    const x0 = r.x + T / 2;
    const z0 = r.z + T / 2;
    const x1 = r.x + r.w - T / 2;
    const z1 = r.z + r.l - T / 2;
    // Back walls (north, west) are seen from inside the room; front walls (south, east) from outside.
    faces.push({ key: `${r.name}n`, depth: x0 + x1 + 2 * z0 - 0.5, cls: "lp-axo-in", pts: [iso(x0, z0), iso(x1, z0), iso(x1, z0, H), iso(x0, z0, H)] });
    faces.push({ key: `${r.name}w`, depth: 2 * x0 + z0 + z1 - 0.5, cls: "lp-axo-in2", pts: [iso(x0, z0), iso(x0, z1), iso(x0, z1, H), iso(x0, z0, H)] });
    faces.push({ key: `${r.name}s`, depth: x0 + x1 + 2 * z1, cls: "lp-axo-out", pts: [iso(x0, z1), iso(x1, z1), iso(x1, z1, H), iso(x0, z1, H)] });
    faces.push({ key: `${r.name}e`, depth: 2 * x1 + z0 + z1, cls: "lp-axo-out2", pts: [iso(x1, z0), iso(x1, z1), iso(x1, z1, H), iso(x1, z0, H)] });
  }
  faces.sort((a, b) => a.depth - b.depth);
  const corners = [iso(0, 0), iso(W, 0), iso(W, L), iso(0, L), iso(0, 0, H), iso(W, L, H)];
  const minX = Math.min(...corners.map((c) => c[0])) - 2;
  const maxX = Math.max(...corners.map((c) => c[0])) + 2;
  const minY = Math.min(...corners.map((c) => c[1])) - 2;
  const maxY = Math.max(...corners.map((c) => c[1])) + 2;
  return (
    <svg className="lp-drawing lp-axo" viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`} role="img" aria-label="The same plan raised in 3D: red-oxide floors and limewashed walls, cut away so every room shows">
      <polygon className="lp-axo-shadow" points={poly([iso(0.8, L + 0.4), iso(W + 0.8, L + 0.4), iso(W + 1.6, -0.4), iso(W + 0.8, -0.4)])} />
      {DEMO_ROOMS.map((r) => (
        <polygon key={`${r.name}-${r.x}-${r.z}`} className="lp-axo-floor" points={poly([iso(r.x, r.z), iso(r.x + r.w, r.z), iso(r.x + r.w, r.z + r.l), iso(r.x, r.z + r.l)])} />
      ))}
      {faces.map((f) => (
        <polygon key={f.key} className={f.cls} points={poly(f.pts)} />
      ))}
    </svg>
  );
}

const KITCHEN_GLYPHS: Record<string, string> = {
  L: "M4 4v16h16",
  U: "M4 4v16h16V4",
  parallel: "M4 4h16M4 20h16",
  island: "M4 4h16M8 13h8v3H8z",
  straight: "M4 4h16",
};

/** A kitchen layout as a counter outline seen from above. */
export function KitchenGlyph({ layout }: { layout: string }) {
  return (
    <svg className="lp-glyph" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2" y="2" width="20" height="20" />
      <path d={KITCHEN_GLYPHS[layout]} />
    </svg>
  );
}
