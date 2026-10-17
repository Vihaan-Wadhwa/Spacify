import * as THREE from "three";
import { layoutHome, type HomeType, type PlanRoom, type StartAnswers } from "@/lib/start";

/**
 * The "thinking" scene behind /start and the landing hero.
 *
 * A field of points orbits the plan. Each answer pulls some of them out of the field onto the walls
 * of the rooms it implies (laid out by the same layoutHome() the server uses); building lifts them
 * into wall surfaces under a rising scan plane; the reveal raises the real house in limewash walls
 * on red-oxide floors under a sun. Floors are drawn exploded, so every storey stays visible.
 */

export type MindPhase = "field" | "plan" | "sketch" | "building" | "revealed";

export type MindInput = Partial<StartAnswers> & {
  sketch?: boolean;
  /** Rooms already laid out (the planner's preview); otherwise they're derived from the answers. */
  rooms?: PlanRoom[];
  /** The plot in plan feet (x east, z south). */
  plotRect?: { x: number; z: number; w: number; l: number };
};

type Options = {
  /** Only the revealed house: no particle field or plan lines (the liquid blob does the thinking). */
  houseOnly?: boolean;
  reducedMotion?: boolean;
  /** Called once the reveal's walls are up. */
  onRevealed?: () => void;
};

const S = 0.1; // scene units per foot
const FLOOR_GAP = 20 * S; // exploded storeys
const CUT = 0.45; // revealed walls are cut away at 45% of their height, so the floors show
const WALL_T = 0.35 * S;

const COLORS = {
  gold: new THREE.Color("#b07f26"),
  goldLine: new THREE.Color("#a87d2e"),
  goldDeep: new THREE.Color("#7d5a18"), // a flash reads darker, not lighter, on white marble
  goldMetal: new THREE.Color("#c9a04a"),
  charcoal: new THREE.Color("#2a2d33"),
  slate: new THREE.Color("#4a4f58"),
};

/** A white-marble floor texture: grey veins and a little gold, drawn once on a canvas. */
function marbleTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d")!;
  g.fillStyle = "#f1efea";
  g.fillRect(0, 0, 512, 512);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const vein = (color: string, width: number, alpha: number) => {
    g.strokeStyle = color;
    g.globalAlpha = alpha;
    g.lineWidth = width;
    g.beginPath();
    let x = rnd() * 512;
    let y = 0;
    g.moveTo(x, y);
    while (y < 512) {
      const nx = x + (rnd() - 0.45) * 90;
      const ny = y + 30 + rnd() * 60;
      g.quadraticCurveTo(x + (rnd() - 0.5) * 60, (y + ny) / 2, nx, ny);
      x = nx;
      y = ny;
    }
    g.stroke();
  };
  for (let i = 0; i < 14; i++) vein("#9a9ea6", 0.6 + rnd() * 1.2, 0.18 + rnd() * 0.22);
  for (let i = 0; i < 2; i++) vein("#c49a45", 1.2, 0.55);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const PLOT_MARGIN: Record<HomeType, number> = { apartment: 1.5, house: 4, villa: 11 };

type Seg = { ax: number; az: number; bx: number; bz: number; y: number; h: number; len: number };

/** A soft round alpha mask, so the scan reads as light rather than a square sheet. */
function softDisc() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "#fff");
  grad.addColorStop(0.55, "#888");
  grad.addColorStop(1, "#000");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Deterministic pseudo-random in [0, 1) for particle i and channel k. */
function rand(i: number, k: number) {
  const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

const VERT = /* glsl */ `
  attribute float aSeed;
  attribute float aBound;
  uniform float uTime;
  uniform float uSize;
  uniform float uPixelRatio;
  uniform float uOpacity;
  uniform vec3 uFlashPos;
  uniform float uFlashT;
  varying float vAlpha;
  varying float vHot;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float twinkle = 0.6 + 0.4 * sin(uTime * 1.7 + aSeed * 40.0);
    float d = distance(position, uFlashPos);
    float flash = exp(-d * d * 2.2) * exp(-uFlashT * 2.2);
    vHot = flash;
    vAlpha = uOpacity * (mix(0.5 * twinkle, 1.0, aBound) + flash * 0.9);
    gl_PointSize = uSize * uPixelRatio * mix(0.85, 1.15, aBound) * (1.0 + flash * 1.4) * (7.0 / -mv.z);
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uHot;
  varying float vAlpha;
  varying float vHot;
  void main() {
    float r = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, r);
    gl_FragColor = vec4(mix(uColor, uHot, clamp(vHot, 0.0, 1.0)), a * a * vAlpha);
  }
`;

export class MindScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
  private clock = new THREE.Clock();
  private raf = 0;
  private running = false;
  private visible = true;
  private resizeObs: ResizeObserver;
  private io: IntersectionObserver;

  // Particles
  private n: number;
  private cur: Float32Array;
  private tgt: Float32Array;
  private bound: Float32Array;
  private boundTarget: Float32Array;
  private boundCount = 0;
  private points: THREE.Points;
  private pmat: THREE.ShaderMaterial;

  // Lines and solids
  private lines = new THREE.Group();
  private lineMat = new THREE.LineBasicMaterial({ color: COLORS.goldLine, transparent: true, opacity: 0, depthWrite: false });
  private ghostMat = new THREE.LineBasicMaterial({ color: COLORS.goldLine, transparent: true, opacity: 0, depthWrite: false });
  private house = new THREE.Group();
  private walls: { mesh: THREE.Mesh; delay: number }[] = [];
  private floorsMeshes: { mesh: THREE.Mesh; delay: number }[] = [];
  private scan: THREE.Mesh;
  private hemi = new THREE.HemisphereLight("#ffffff", "#d9d6cf", 0);
  private houseMaterials: THREE.Material[] = [];
  private sun = new THREE.DirectionalLight("#fff0d4", 0);
  private catcher: THREE.Mesh;

  // State
  private phase: MindPhase = "field";
  private phaseT = 0;
  private time = 0;
  private heat = 0;
  private rooms: PlanRoom[] = [];
  private center = new THREE.Vector3();
  private camTarget = new THREE.Vector3();
  private camRadius = 7;
  private radiusGoal = 7;
  private theta = Math.PI * 0.22;
  private phi = 0.98;
  private fieldR = 2.6;
  private offsetPx = 0;
  private dragging: { x: number; theta: number } | null = null;
  private revealedFired = false;
  private lastInput: MindInput = {};

  constructor(
    private canvas: HTMLCanvasElement,
    private opts: Options = {}
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const small = Math.min(window.innerWidth, window.innerHeight) < 700;
    this.n = small ? 1500 : 2800;
    this.cur = new Float32Array(this.n * 3);
    this.tgt = new Float32Array(this.n * 3);
    this.bound = new Float32Array(this.n);
    this.boundTarget = new Float32Array(this.n);
    const seeds = new Float32Array(this.n);
    for (let i = 0; i < this.n; i++) {
      seeds[i] = rand(i, 0);
      const p = this.fieldPoint(i, 0);
      this.cur.set(p, i * 3);
      this.tgt.set(p, i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.cur, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
    geo.setAttribute("aBound", new THREE.BufferAttribute(this.bound, 1).setUsage(THREE.DynamicDrawUsage));
    this.pmat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      uniforms: {
        uTime: { value: 0 },
        uSize: { value: small ? 7.5 : 6.5 },
        uPixelRatio: { value: 1 },
        uOpacity: { value: 1 },
        uColor: { value: COLORS.gold.clone() },
        uHot: { value: COLORS.goldDeep.clone() },
        uFlashPos: { value: new THREE.Vector3(0, -99, 0) },
        uFlashT: { value: 10 },
      },
    });
    this.points = new THREE.Points(geo, this.pmat);
    this.points.frustumCulled = false;
    this.scene.add(this.points, this.lines, this.house);

    // Scan plane: a thin sheet of light that sweeps while the server builds.
    this.scan = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: COLORS.goldMetal, alphaMap: softDisc(), transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false })
    );
    this.scan.rotation.x = -Math.PI / 2;
    this.scene.add(this.scan);

    // Sun and sky for the reveal.
    this.sun.position.set(6, 10, 4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.catcher = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.ShadowMaterial({ opacity: 0 }));
    this.catcher.rotation.x = -Math.PI / 2;
    this.catcher.position.y = -0.005;
    this.catcher.receiveShadow = true;
    this.scene.add(this.catcher);

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(canvas.parentElement ?? canvas);
    this.io = new IntersectionObserver(([e]) => {
      this.visible = e.isIntersecting;
      if (this.visible) this.start();
    });
    this.io.observe(canvas);
    document.addEventListener("visibilitychange", this.onVisibility);
    canvas.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);

    this.resize();
    if (opts.houseOnly) {
      this.points.visible = false;
      this.lines.visible = false;
      this.scan.visible = false;
    }
    this.start();
  }

  // ─── Public API ──────────────────────────────────────────

  /** Follows the answers so far: the plot appears with a home type, rooms with a BHK, storeys with floors. */
  setAnswers(input: MindInput) {
    if (this.phase === "building" || this.phase === "revealed") return;
    const prev = this.lastInput;
    this.lastInput = input;
    if (input.sketch) {
      this.setSketch();
      return;
    }
    const rooms = input.rooms ?? layoutHome(input);
    const added = rooms.find((r) => !this.rooms.some((o) => o.name === r.name && o.floor === r.floor));
    this.rooms = rooms;
    this.phase = input.homeType ? "plan" : "field";
    this.phaseT = 0;
    this.heat = 1;
    this.layoutTargets("plan");
    this.drawLines(input.homeType ?? null, input);
    // Flash where the change landed: the new room, or the whole plan for a type/size/floors change.
    const changed = added ?? (prev.homeType !== input.homeType || prev.area !== input.area || prev.floors !== input.floors || prev.plotRect?.w !== input.plotRect?.w || prev.plotRect?.l !== input.plotRect?.l ? null : undefined);
    if (changed !== undefined) {
      const c = changed ? this.roomCenter(changed) : this.center.clone();
      this.pmat.uniforms.uFlashPos.value.copy(c);
      this.pmat.uniforms.uFlashT.value = 0;
    }
  }

  /** The server is building: lift the plan into walls of light under a sweeping scan. */
  build() {
    this.phase = "building";
    this.phaseT = 0;
    this.heat = 1.4;
    this.layoutTargets("walls");
  }

  /** Raises the real house from the server's rooms. */
  reveal(rooms: PlanRoom[]) {
    this.rooms = rooms;
    this.computeCenter();
    this.layoutTargets("walls");
    this.buildHouse();
    this.phase = "revealed";
    this.phaseT = 0;
    this.revealedFired = false;
  }

  /** Back from the reveal to the plan, to change answers. */
  unreveal() {
    this.clearHouse();
    this.phase = "field";
    this.setAnswers({ ...this.lastInput });
  }

  /** Shifts the drawing sideways (px, positive = right) to clear an overlapping panel. */
  setOffset(px: number) {
    this.offsetPx = px;
    this.resize();
  }

  dispose() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    this.io.disconnect();
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    this.clearHouse();
    this.clearLines();
    this.points.geometry.dispose();
    this.pmat.dispose();
    this.lineMat.dispose();
    this.ghostMat.dispose();
    (this.scan.material as THREE.MeshBasicMaterial).alphaMap?.dispose();
    (this.scan.material as THREE.Material).dispose();
    this.scan.geometry.dispose();
    this.catcher.geometry.dispose();
    (this.catcher.material as THREE.Material).dispose();
    this.renderer.dispose();
  }

  // ─── Layout ──────────────────────────────────────────────

  private floorY(floor: number) {
    return (floor - 1) * FLOOR_GAP;
  }

  private computeCenter() {
    if (!this.rooms.length) {
      this.center.set(0, 0, 0);
      return;
    }
    const xs = this.rooms.flatMap((r) => [r.x, r.x + r.w]);
    const zs = this.rooms.flatMap((r) => [r.z, r.z + r.l]);
    const floors = Math.max(...this.rooms.map((r) => r.floor));
    this.center.set(((Math.min(...xs) + Math.max(...xs)) / 2) * S, 0, ((Math.min(...zs) + Math.max(...zs)) / 2) * S);
    const span = Math.hypot((Math.max(...xs) - Math.min(...xs)) * S, (Math.max(...zs) - Math.min(...zs)) * S);
    this.fieldR = Math.max(2.2, span * 0.75);
    this.radiusGoal = Math.max(5.5, Math.min(30, span * 1.75 + (floors - 1) * FLOOR_GAP * 1.4));
    this.camTarget.set(this.center.x, ((floors - 1) * FLOOR_GAP) / 2 + 0.3, this.center.z);
  }

  private roomCenter(r: PlanRoom) {
    return new THREE.Vector3((r.x + r.w / 2) * S, this.floorY(r.floor), (r.z + r.l / 2) * S);
  }

  private roomSegs(r: PlanRoom): Seg[] {
    const x0 = r.x * S;
    const z0 = r.z * S;
    const x1 = (r.x + r.w) * S;
    const z1 = (r.z + r.l) * S;
    const y = this.floorY(r.floor);
    const h = r.h * S;
    return [
      { ax: x0, az: z0, bx: x1, bz: z0, y, h, len: x1 - x0 },
      { ax: x1, az: z0, bx: x1, bz: z1, y, h, len: z1 - z0 },
      { ax: x1, az: z1, bx: x0, bz: z1, y, h, len: x1 - x0 },
      { ax: x0, az: z1, bx: x0, bz: z0, y, h, len: z1 - z0 },
    ];
  }

  /** The plot around the ground floor (or a guessed square before any rooms exist). */
  private plotRect(type: HomeType | null, input: MindInput) {
    if (input.plotRect) {
      const p = input.plotRect;
      return { x0: p.x * S, z0: p.z * S, x1: (p.x + p.w) * S, z1: (p.z + p.l) * S };
    }
    const m = PLOT_MARGIN[type ?? "house"] * S;
    const ground = this.rooms.filter((r) => r.floor === 1);
    if (ground.length) {
      return {
        x0: Math.min(...ground.map((r) => r.x)) * S - m,
        z0: Math.min(...ground.map((r) => r.z)) * S - m,
        x1: Math.max(...ground.map((r) => r.x + r.w)) * S + m,
        z1: Math.max(...ground.map((r) => r.z + r.l)) * S + m,
      };
    }
    const side = Math.sqrt((input.area ?? 1200) / (input.floors ?? 1)) * 1.1 * S;
    return { x0: -side / 2 - m, z0: -side / 2 - m, x1: side / 2 + m, z1: side / 2 + m };
  }

  private layoutTargets(mode: "plan" | "walls") {
    this.computeCenter();
    const segs: Seg[] = [];
    for (const r of this.rooms) for (const s of this.roomSegs(r)) segs.push({ ...s, h: mode === "walls" ? s.h * CUT : 0 });
    if (this.lastInput.homeType && mode === "plan") {
      const p = this.plotRect(this.lastInput.homeType, this.lastInput);
      const plot: Seg[] = [
        { ax: p.x0, az: p.z0, bx: p.x1, bz: p.z0, y: 0, h: 0, len: p.x1 - p.x0 },
        { ax: p.x1, az: p.z0, bx: p.x1, bz: p.z1, y: 0, h: 0, len: p.z1 - p.z0 },
        { ax: p.x1, az: p.z1, bx: p.x0, bz: p.z1, y: 0, h: 0, len: p.x1 - p.x0 },
        { ax: p.x0, az: p.z1, bx: p.x0, bz: p.z0, y: 0, h: 0, len: p.z1 - p.z0 },
      ];
      // Sparser on the plot line than on walls.
      for (const s of plot) segs.push({ ...s, len: s.len * 0.45 });
      if (!this.rooms.length) {
        this.center.set((p.x0 + p.x1) / 2, 0, (p.z0 + p.z1) / 2);
        this.camTarget.copy(this.center);
        this.radiusGoal = Math.max(5.5, (p.x1 - p.x0) * 2.2);
      }
    }
    this.assign(segs, mode === "walls" ? 70 : 42, mode === "walls" ? 0.82 : 0.6);
  }

  /** Puts the first `count` particles evenly along the segments; the rest return to the field. */
  private assign(segs: Seg[], density: number, cap: number) {
    const total = segs.reduce((s, g) => s + g.len, 0);
    const count = Math.min(Math.floor(this.n * cap), Math.round(total * density));
    this.boundCount = count;
    let si = 0;
    let acc = 0;
    for (let i = 0; i < this.n; i++) {
      if (i >= count || !segs.length) {
        this.boundTarget[i] = 0;
        continue;
      }
      const at = ((i + 0.5) / count) * total;
      while (si < segs.length - 1 && acc + segs[si].len < at) acc += segs[si++].len;
      const g = segs[si];
      const f = g.len > 0 ? clamp01((at - acc) / g.len) : 0;
      const jitter = 0.006;
      this.tgt[i * 3] = g.ax + (g.bx - g.ax) * f + (rand(i, 3) - 0.5) * jitter;
      this.tgt[i * 3 + 1] = g.y + (g.h > 0 ? rand(i, 4) * g.h : 0);
      this.tgt[i * 3 + 2] = g.az + (g.bz - g.az) * f + (rand(i, 5) - 0.5) * jitter;
      this.boundTarget[i] = 1;
    }
    si = 0;
    acc = 0;
  }

  /** A sheet of paper with a loose plan on it, being read by a scan line. */
  private setSketch() {
    this.phase = "sketch";
    this.phaseT = 0;
    this.heat = 1;
    this.rooms = [];
    this.clearLines();
    const W = 4.2;
    const D = 3;
    const segs: Seg[] = [];
    const line = (ax: number, az: number, bx: number, bz: number) => segs.push({ ax, az, bx, bz, y: 0, h: 0, len: Math.hypot(bx - ax, bz - az) });
    line(-W / 2, -D / 2, W / 2, -D / 2);
    line(W / 2, -D / 2, W / 2, D / 2);
    line(W / 2, D / 2, -W / 2, D / 2);
    line(-W / 2, D / 2, -W / 2, -D / 2);
    // The sketch: a 2BHK drawn by hand.
    const sx = -1.6;
    const sz = -1.1;
    const k = 0.1;
    const rects = [
      [0, 0, 16, 12],
      [16, 0, 14, 12],
      [0, 12, 12, 10],
      [12, 12, 8, 10],
      [20, 12, 10, 10],
    ];
    for (const [x, z, w, l] of rects) {
      const x0 = sx + x * k;
      const z0 = sz + z * k;
      const x1 = x0 + w * k;
      const z1 = z0 + l * k;
      line(x0, z0, x1, z0);
      line(x1, z0, x1, z1);
      line(x1, z1, x0, z1);
      line(x0, z1, x0, z0);
    }
    this.center.set(0, 0, 0);
    this.camTarget.set(0, 0, 0);
    this.radiusGoal = 6.4;
    this.fieldR = 2.8;
    this.assign(segs, 60, 0.7);
  }

  // ─── Drawing ─────────────────────────────────────────────

  private clearLines() {
    for (const child of [...this.lines.children]) {
      (child as THREE.LineSegments).geometry.dispose();
      this.lines.remove(child);
    }
  }

  private drawLines(type: HomeType | null, input: MindInput) {
    this.clearLines();
    const pts: number[] = [];
    for (const r of this.rooms) {
      for (const s of this.roomSegs(r)) pts.push(s.ax, s.y, s.az, s.bx, s.y, s.bz);
    }
    if (pts.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      this.lines.add(new THREE.LineSegments(g, this.lineMat));
    }
    if (!type) return;
    // Plot boundary, plus ghost storeys below for an apartment (a floor in a tower).
    const p = this.plotRect(type, input);
    const ghost: number[] = [];
    const rect = (y: number) => ghost.push(p.x0, y, p.z0, p.x1, y, p.z0, p.x1, y, p.z0, p.x1, y, p.z1, p.x1, y, p.z1, p.x0, y, p.z1, p.x0, y, p.z1, p.x0, y, p.z0);
    rect(0);
    if (type === "apartment") for (let k = 1; k <= 3; k++) rect(-k * FLOOR_GAP * 0.55);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(ghost, 3));
    this.lines.add(new THREE.LineSegments(g, this.ghostMat));
  }

  private clearHouse() {
    // Frees walls, their gold caps, floors, and the materials and marble texture made for this house.
    this.house.traverse((obj) => (obj as THREE.Mesh).geometry?.dispose());
    for (const child of [...this.house.children]) this.house.remove(child);
    for (const m of this.houseMaterials) {
      (m as THREE.MeshStandardMaterial).map?.dispose();
      m.dispose();
    }
    this.houseMaterials = [];
    this.walls = [];
    this.floorsMeshes = [];
  }

  private buildHouse() {
    this.clearHouse();
    const wallMat = new THREE.MeshStandardMaterial({ color: COLORS.charcoal, roughness: 0.82, metalness: 0 });
    const floorMat = new THREE.MeshStandardMaterial({ map: marbleTexture(), roughness: 0.28, metalness: 0.02 });
    const stairMat = new THREE.MeshStandardMaterial({ color: COLORS.slate, roughness: 0.6 });
    // Not metallic: without reflections to pick up, metal renders near-black. A faint glow keeps it reading as gold.
    const goldMat = new THREE.MeshStandardMaterial({ color: COLORS.goldMetal, roughness: 0.45, metalness: 0.15, emissive: COLORS.goldMetal, emissiveIntensity: 0.25 });
    this.houseMaterials = [wallMat, floorMat, stairMat, goldMat];
    const order = [...this.rooms].sort((a, b) => a.floor - b.floor || a.z - b.z || a.x - b.x);
    order.forEach((r, i) => {
      const delay = i * 0.07 + (r.floor - 1) * 0.25;
      const y = this.floorY(r.floor);
      const slab = new THREE.Mesh(new THREE.BoxGeometry(r.w * S, 0.025, r.l * S), r.name === "Staircase" ? stairMat : floorMat);
      slab.position.set((r.x + r.w / 2) * S, y - 0.0125, (r.z + r.l / 2) * S);
      slab.receiveShadow = true;
      slab.castShadow = true;
      slab.scale.set(0.001, 1, 0.001);
      this.house.add(slab);
      this.floorsMeshes.push({ mesh: slab, delay });
      const h = r.h * S * CUT;
      for (const s of this.roomSegs(r)) {
        const along = s.ax !== s.bx;
        const len = s.len;
        const geo = new THREE.BoxGeometry(along ? len : WALL_T, h, along ? WALL_T : len);
        geo.translate(0, h / 2, 0);
        const mesh = new THREE.Mesh(geo, wallMat);
        // A gold strip along the top of every wall.
        const cap = new THREE.Mesh(new THREE.BoxGeometry(along ? len : WALL_T * 1.1, 0.02, along ? WALL_T * 1.1 : len), goldMat);
        cap.position.y = h + 0.01;
        mesh.add(cap);
        // Inset each wall into its own room, so shared walls don't fight.
        const inset = WALL_T / 2;
        const mx = (s.ax + s.bx) / 2;
        const mz = (s.az + s.bz) / 2;
        const cx = (r.x + r.w / 2) * S;
        const cz = (r.z + r.l / 2) * S;
        mesh.position.set(along ? mx : mx + Math.sign(cx - mx) * inset, y, along ? mz + Math.sign(cz - mz) * inset : mz);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.scale.y = 0.001;
        this.house.add(mesh);
        this.walls.push({ mesh, delay: delay + 0.12 });
      }
    });
    // Fit the sun's shadow camera around the house.
    const span = Math.max(6, this.radiusGoal * 1.4);
    const cam = this.sun.shadow.camera;
    cam.left = -span;
    cam.right = span;
    cam.top = span;
    cam.bottom = -span;
    cam.near = 0.5;
    cam.far = 60;
    cam.updateProjectionMatrix();
    this.sun.target.position.copy(this.camTarget);
    this.sun.position.copy(this.camTarget).add(new THREE.Vector3(span * 0.9, span * 1.6, span * 0.5));
  }

  // ─── Loop ────────────────────────────────────────────────

  private fieldPoint(i: number, t: number): [number, number, number] {
    const r0 = 0.55 + rand(i, 1) * 1.1;
    const r = this.fieldR * r0;
    const speed = (0.12 + rand(i, 2) * 0.1) / r0;
    const th = rand(i, 6) * Math.PI * 2 + t * speed;
    const wob = Math.sin(th * 3 + rand(i, 7) * 10 + t * 0.6) * 0.18 * this.fieldR * (0.4 + r0 * 0.4);
    return [this.center.x + Math.cos(th) * r, this.camTarget.y * 0.5 + wob + (rand(i, 8) - 0.5) * 0.25, this.center.z + Math.sin(th) * r];
  }

  private start() {
    if (this.running) return;
    this.running = true;
    this.clock.getDelta();
    const loop = () => {
      if (!this.running) return;
      if (!this.visible || document.hidden) {
        this.running = false;
        return;
      }
      this.tick(Math.min(this.clock.getDelta(), 0.05));
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private onVisibility = () => {
    if (!document.hidden && this.visible) this.start();
  };

  private onPointerDown = (e: PointerEvent) => {
    if (this.phase !== "revealed") return;
    this.dragging = { x: e.clientX, theta: this.theta };
  };
  private onPointerMove = (e: PointerEvent) => {
    if (!this.dragging) return;
    this.theta = this.dragging.theta - (e.clientX - this.dragging.x) * 0.006;
  };
  private onPointerUp = () => {
    this.dragging = null;
  };

  private tick(dt: number) {
    const rm = !!this.opts.reducedMotion;
    this.time += rm ? 0 : dt;
    this.phaseT += dt;
    this.heat = Math.max(0, this.heat - dt * 0.7);

    // Particles: bound ones spring to their wall, free ones orbit the field.
    const t = this.time;
    const k = rm ? 1 : 1 - Math.pow(0.0025, dt);
    const stir = 1 + this.heat * 2.2;
    for (let i = 0; i < this.n; i++) {
      const i3 = i * 3;
      let tx: number, ty: number, tz: number;
      if (this.boundTarget[i] > 0) {
        tx = this.tgt[i3];
        ty = this.tgt[i3 + 1];
        tz = this.tgt[i3 + 2];
        if (!rm && this.phase === "building") ty += Math.sin(t * 3 + i) * 0.004;
      } else {
        const p = this.fieldPoint(i, t * stir);
        tx = p[0];
        ty = p[1];
        tz = p[2];
      }
      // Each particle has its own pace, so a change ripples instead of snapping.
      const ki = rm ? 1 : k * (0.35 + rand(i, 9) * 0.65);
      this.cur[i3] += (tx - this.cur[i3]) * ki;
      this.cur[i3 + 1] += (ty - this.cur[i3 + 1]) * ki;
      this.cur[i3 + 2] += (tz - this.cur[i3 + 2]) * ki;
      this.bound[i] += (this.boundTarget[i] - this.bound[i]) * Math.min(1, dt * 4);
    }
    const geo = this.points.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aBound.needsUpdate = true;

    const u = this.pmat.uniforms;
    u.uTime.value = t;
    u.uFlashT.value += dt;

    // Lines, scan, particles' opacity and the sun by phase.
    const lerp = (cur: number, to: number, rate = 3) => (rm ? to : cur + (to - cur) * Math.min(1, dt * rate));
    const ph = this.phase;
    this.lineMat.opacity = lerp(this.lineMat.opacity, ph === "plan" ? 0.7 : ph === "building" ? 0.3 : 0);
    this.ghostMat.opacity = lerp(this.ghostMat.opacity, ph === "plan" ? 0.3 : 0);
    u.uOpacity.value = lerp(u.uOpacity.value, ph === "revealed" ? 0.0 : 1, ph === "revealed" ? 3.5 : 3);

    const scanMat = this.scan.material as THREE.MeshBasicMaterial;
    if (ph === "building" || ph === "sketch") {
      const span = ph === "sketch" ? 4.4 : Math.max(3, this.radiusGoal * 0.9);
      this.scan.scale.set(span * 1.3, span * 1.3, 1);
      if (ph === "building") {
        const floors = Math.max(1, ...this.rooms.map((r) => r.floor));
        const top = (floors - 1) * FLOOR_GAP + 1.0;
        const cyc = rm ? 0.5 : (this.phaseT * 0.45) % 1;
        this.scan.rotation.set(-Math.PI / 2, 0, 0);
        this.scan.position.set(this.center.x, cyc * top, this.center.z);
        scanMat.opacity = lerp(scanMat.opacity, 0.12);
      } else {
        // Sketch: a vertical bar sweeping across the sheet.
        const cyc = rm ? 0.5 : (this.phaseT * 0.3) % 1;
        this.scan.rotation.set(0, Math.PI / 2, 0);
        this.scan.scale.set(3.2, 0.5, 1);
        this.scan.position.set(-2.1 + cyc * 4.2, 0.2, 0);
        scanMat.opacity = lerp(scanMat.opacity, 0.2);
        u.uFlashPos.value.set(this.scan.position.x, 0, 0);
        u.uFlashT.value = 0.15;
      }
    } else {
      scanMat.opacity = lerp(scanMat.opacity, 0);
    }

    if (ph === "revealed") {
      const tt = this.phaseT;
      for (const { mesh, delay } of this.floorsMeshes) {
        const e = rm ? 1 : easeOutExpo(clamp01((tt - delay) / 0.9));
        mesh.scale.set(Math.max(0.001, e), 1, Math.max(0.001, e));
      }
      for (const { mesh, delay } of this.walls) {
        mesh.scale.y = Math.max(0.001, rm ? 1 : easeOutExpo(clamp01((tt - delay) / 1.1)));
      }
      this.hemi.intensity = lerp(this.hemi.intensity, 1.6, 1.2);
      this.sun.intensity = lerp(this.sun.intensity, 3.0, 1.2);
      (this.catcher.material as THREE.ShadowMaterial).opacity = lerp((this.catcher.material as THREE.ShadowMaterial).opacity, 0.18, 1.2);
      const lastDelay = Math.max(0, ...this.walls.map((w) => w.delay));
      if (!this.revealedFired && (rm || tt > lastDelay + 1.1)) {
        this.revealedFired = true;
        this.opts.onRevealed?.();
      }
    } else {
      this.hemi.intensity = lerp(this.hemi.intensity, 0);
      this.sun.intensity = lerp(this.sun.intensity, 0);
      (this.catcher.material as THREE.ShadowMaterial).opacity = lerp((this.catcher.material as THREE.ShadowMaterial).opacity, 0);
    }

    // Camera: slow orbit around the plan; drag to turn it after the reveal.
    if (!rm && !this.dragging) this.theta += dt * (ph === "revealed" ? 0.07 : 0.045);
    this.camRadius = lerp(this.camRadius, this.radiusGoal, 1.6);
    const target = this.camTarget;
    const r = this.camRadius;
    this.camera.position.set(
      target.x + r * Math.sin(this.phi) * Math.cos(this.theta),
      target.y + r * Math.cos(this.phi),
      target.z + r * Math.sin(this.phi) * Math.sin(this.theta)
    );
    this.camera.lookAt(target);
    this.renderer.render(this.scene, this.camera);
  }

  private resize() {
    const host = this.canvas.parentElement ?? this.canvas;
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.pmat.uniforms.uPixelRatio.value = dpr;
    this.camera.aspect = w / h;
    // Narrow screens need more distance to fit the plan.
    this.camera.fov = w / h < 0.8 ? 46 : 32;
    if (this.offsetPx) this.camera.setViewOffset(w, h, -this.offsetPx, 0, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }
}
