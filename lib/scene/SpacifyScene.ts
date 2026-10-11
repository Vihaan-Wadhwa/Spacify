import * as THREE from "three";
import {
  WALLS,
  planBounds,
  roomColor,
  wallCuts,
  wallLine,
  type CameraPreset,
  type Layers,
  type Room,
  type RoomDesign,
} from "@/lib/rooms";

export type SceneState = {
  rooms: Room[];
  floors: number;
  layers: Layers;
  designs: Record<number, RoomDesign>;
  selectedId: number | null;
};

type Handlers = {
  onSelect: (roomId: number | null) => void;
  onWalkExit: () => void;
};

type Spherical = { theta: number; phi: number; radius: number };

/** A room's box in scene units. */
type Box = { x: number; z: number; w: number; l: number; h: number };

const FT_TO_UNITS = 0.3;
const FLOOR_SPACING = 3.2;
const WALL_T = 0.12;
// Heights in feet above the floor
const DOOR_TOP = 7;
const SILL = 3;
const MIN_RADIUS = 5;
const MAX_RADIUS = 80;

const PRESETS: Record<CameraPreset, Spherical> = {
  persp: { theta: Math.PI / 4, phi: Math.PI / 3.5, radius: 38 },
  top: { theta: Math.PI / 4, phi: 0.05, radius: 42 },
  front: { theta: 0, phi: Math.PI / 2.2, radius: 38 },
  side: { theta: Math.PI / 2, phi: Math.PI / 2.8, radius: 38 },
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Frees GPU memory for everything inside a group, then empties it. */
function clearGroup(group: THREE.Group) {
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      (m as THREE.MeshBasicMaterial).map?.dispose();
      m.dispose();
    }
  });
  group.clear();
}

function cssVar(name: string, fallback: string) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/**
 * The imperative Three.js scene. React owns the state; this class only draws it.
 * Create it once per <canvas>, push state in with update(), and call dispose() on unmount.
 */
export class SpacifyScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
  private walkCamera = new THREE.PerspectiveCamera(70, 1, 0.05, 200);
  private grid = new THREE.GridHelper(60, 60, 0x333333, 0x222222);
  private wallGroup = new THREE.Group();
  private floorGroup = new THREE.Group();
  private furnitureGroup = new THREE.Group();
  private labelGroup = new THREE.Group();
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();

  private spherical: Spherical = { ...PRESETS.persp };
  private orbitTarget = new THREE.Vector3(0, 0, 0);
  private state: SceneState | null = null;
  private rafId = 0;
  private resizeObserver: ResizeObserver;
  private cleanups: (() => void)[] = [];

  // Pointer / drag state
  private dragging = false;
  private dragMoved = false;
  private lastX = 0;
  private lastY = 0;
  private lastPinch: number | null = null;

  // Walkthrough state
  private walking = false;
  private walkPos = new THREE.Vector3(0, 1.7, 8);
  private walkYaw = Math.PI;
  private walkPitch = 0;
  private walkKeys: Record<string, boolean> = {};
  private hadPointerLock = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private container: HTMLElement,
    private tooltip: HTMLElement | null,
    private handlers: Handlers
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    // Modern three.js uses physical light units; ×π keeps the brightness of the old r128 build.
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.5 * Math.PI));
    const sun = new THREE.DirectionalLight(0xffffff, 0.9 * Math.PI);
    sun.position.set(20, 30, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { near: 0.5, far: 200, left: -40, right: 40, top: 40, bottom: -40 });
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0xffffff, 0.3 * Math.PI);
    fill.position.set(-15, 10, -10);
    this.scene.add(fill);

    this.scene.add(this.grid, this.wallGroup, this.floorGroup, this.furnitureGroup, this.labelGroup);

    this.bindInput();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.updateCamera();
    this.loop();
  }

  // ─── Public API ────────────────────────────────────────────

  update(next: SceneState) {
    const prev = this.state;
    this.state = next;
    const needsRebuild =
      !prev ||
      prev.rooms !== next.rooms ||
      prev.floors !== next.floors ||
      prev.designs !== next.designs ||
      prev.layers.furniture !== next.layers.furniture ||
      prev.layers.labels !== next.layers.labels;
    if (needsRebuild) this.build();
    this.applyVisibility();
    this.applySelection();
  }

  setTheme(theme: "dark" | "light") {
    this.renderer.setClearColor(theme === "dark" ? 0x0a0a0a : 0xf5f3ef, 1);
    // GridHelper bakes its colours into vertex colours, so swap in a new one rather than tinting the material.
    const visible = this.grid.visible;
    this.scene.remove(this.grid);
    this.grid.dispose();
    this.grid = theme === "dark" ? new THREE.GridHelper(60, 60, 0x333333, 0x222222) : new THREE.GridHelper(60, 60, 0xc4c2bc, 0xdcdad4);
    this.grid.visible = visible;
    this.scene.add(this.grid);
  }

  setCameraPreset(preset: CameraPreset) {
    this.spherical = { ...PRESETS[preset] };
    this.updateCamera();
  }

  zoom(delta: number) {
    this.spherical.radius = clamp(this.spherical.radius + delta, MIN_RADIUS, MAX_RADIUS);
    this.updateCamera();
  }

  /** Returns the current view as a PNG data URL. */
  snapshot(): string {
    this.renderer.render(this.scene, this.walking ? this.walkCamera : this.camera);
    return this.renderer.domElement.toDataURL("image/png");
  }

  enterWalk() {
    if (this.walking) return;
    this.walking = true;
    this.walkPos.set(0, 1.7, 8);
    this.walkYaw = Math.PI;
    this.walkPitch = 0;
    this.walkKeys = {};
    this.hadPointerLock = false;
    if (this.tooltip) this.tooltip.style.opacity = "0";
    // Pointer lock can be refused (e.g. inside some iframes); WASD still works without mouse-look.
    const lock = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
    lock?.catch?.(() => {});
  }

  exitWalk() {
    if (!this.walking) return;
    this.walking = false;
    this.walkKeys = {};
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.updateCamera();
  }

  dispose() {
    cancelAnimationFrame(this.rafId);
    this.resizeObserver.disconnect();
    this.cleanups.forEach((fn) => fn());
    [this.wallGroup, this.floorGroup, this.furnitureGroup, this.labelGroup].forEach(clearGroup);
    this.grid.dispose();
    this.renderer.dispose();
  }

  // ─── Rendering ─────────────────────────────────────────────

  private loop = () => {
    this.rafId = requestAnimationFrame(this.loop);
    if (this.walking) {
      this.stepWalk();
      this.renderer.render(this.scene, this.walkCamera);
    } else {
      for (const label of this.labelGroup.children) label.quaternion.copy(this.camera.quaternion);
      this.renderer.render(this.scene, this.camera);
    }
  };

  private resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.walkCamera.aspect = w / h;
    this.walkCamera.updateProjectionMatrix();
  }

  private updateCamera() {
    const { theta, phi, radius } = this.spherical;
    this.camera.position.set(
      this.orbitTarget.x + radius * Math.sin(phi) * Math.sin(theta),
      this.orbitTarget.y + radius * Math.cos(phi),
      this.orbitTarget.z + radius * Math.sin(phi) * Math.cos(theta)
    );
    this.camera.lookAt(this.orbitTarget);
  }

  // ─── Scene building ────────────────────────────────────────

  private build() {
    [this.wallGroup, this.floorGroup, this.furnitureGroup, this.labelGroup].forEach(clearGroup);
    const state = this.state;
    if (!state) return;

    // Rooms sit where they are on the 2D plan; the whole house is centred on the origin so floors stay stacked.
    const b = planBounds(state.rooms);
    if (!b) return;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    for (let floor = 1; floor <= state.floors; floor++) {
      const floorRooms = state.rooms.filter((r) => r.floor === floor);
      const y0 = (floor - 1) * FLOOR_SPACING;
      for (const room of floorRooms) {
        const design = state.designs[room.id];
        const pos: Box = {
          x: (room.x - cx) * FT_TO_UNITS,
          z: (room.z - cz) * FT_TO_UNITS,
          w: room.w * FT_TO_UNITS,
          l: room.l * FT_TO_UNITS,
          h: room.h * FT_TO_UNITS,
        };
        this.buildRoom(room, pos, y0, design, state.layers);
        this.buildWalls(room, floorRooms, { x: cx, z: cz }, y0, design);
      }
    }
  }

  private buildRoom(r: Room, pos: Box, y0: number, design: RoomDesign | undefined, layers: Layers) {
    const colCSS = roomColor(r.name);
    const floorColor = design?.flooring.color ?? colCSS;

    // Floor slab
    const floorMesh = new THREE.Mesh(
      new THREE.BoxGeometry(pos.w, 0.08, pos.l),
      new THREE.MeshLambertMaterial({ color: floorColor, transparent: true, opacity: 0.35 })
    );
    floorMesh.position.set(pos.x + pos.w / 2, y0 - 0.04, pos.z + pos.l / 2);
    floorMesh.receiveShadow = true;
    floorMesh.userData = { roomId: r.id, type: "floor" };
    this.floorGroup.add(floorMesh);

    // Ceiling slab
    const ceil = new THREE.Mesh(
      new THREE.BoxGeometry(pos.w, 0.06, pos.l),
      new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.15 })
    );
    ceil.position.set(pos.x + pos.w / 2, y0 + pos.h, pos.z + pos.l / 2);
    this.wallGroup.add(ceil);

    if (layers.furniture) this.addFurniture(r, pos, y0);
    if (layers.labels) this.addLabel(r, pos, y0, colCSS);

    if (r.name === "Staircase") {
      const stepMat = new THREE.MeshLambertMaterial({ color: 0xeeeeee });
      for (let s = 0; s < 8; s++) {
        const step = new THREE.Mesh(new THREE.BoxGeometry(pos.w, 0.1, pos.l / 8), stepMat);
        step.position.set(pos.x + pos.w / 2, y0 + s * 0.38, pos.z + (s * pos.l) / 8 + pos.l / 16);
        step.castShadow = true;
        this.wallGroup.add(step);
      }
    }
  }

  /**
   * Four walls, open top, each split around its doors and windows (including ones that belong to the room on the other
   * side of a shared wall). A door leaves a gap with a lintel above; a window gets a sill, glass and a header.
   */
  private buildWalls(r: Room, floorRooms: Room[], center: { x: number; z: number }, y0: number, design: RoomDesign | undefined) {
    // A chosen wall colour applies to all four sides; otherwise the e/w sides are a touch darker, as before.
    const wallColor = design?.walls.color;
    const wallMat = new THREE.MeshLambertMaterial({ color: wallColor ?? 0xfafafa, transparent: true, opacity: 0.9 });
    const sideMat = wallColor ? wallMat : new THREE.MeshLambertMaterial({ color: 0xe8e8e8, transparent: true, opacity: 0.85 });
    const glassMat = new THREE.MeshLambertMaterial({ color: 0x88ccff, transparent: true, opacity: 0.5 });
    const h = r.h;
    const doorTop = Math.min(DOOR_TOP, h - 1);
    const sill = Math.min(SILL, doorTop - 1);

    for (const wall of WALLS) {
      const line = wallLine(r, wall);
      const mat = line.axis === "x" ? wallMat : sideMat;
      // Walls sit just outside the room; n/s walls run half a wall past each end to close the corners.
      const outward = wall === "n" || wall === "w" ? -1 : 1;
      const across = (line.at - (line.axis === "x" ? center.z : center.x)) * FT_TO_UNITS + (outward * WALL_T) / 2;
      const ext = line.axis === "x" ? WALL_T / 2 / FT_TO_UNITS : 0;

      /** One box along this wall, from `from` to `to` (feet along the wall) and `bottom` to `top` (feet up). */
      const piece = (from: number, to: number, bottom: number, top: number, material: THREE.Material, thickness = WALL_T) => {
        if (to - from < 0.01 || top - bottom < 0.01) return;
        const len = (to - from) * FT_TO_UNITS;
        const mid = ((from + to) / 2 - (line.axis === "x" ? center.x : center.z)) * FT_TO_UNITS;
        const height = (top - bottom) * FT_TO_UNITS;
        const mesh = new THREE.Mesh(
          line.axis === "x" ? new THREE.BoxGeometry(len, height, thickness) : new THREE.BoxGeometry(thickness, height, len),
          material
        );
        const y = y0 + ((bottom + top) / 2) * FT_TO_UNITS;
        if (line.axis === "x") mesh.position.set(mid, y, across);
        else mesh.position.set(across, y, mid);
        mesh.castShadow = material !== glassMat;
        mesh.receiveShadow = true;
        mesh.userData = { roomId: r.id, type: "wall" };
        this.wallGroup.add(mesh);
      };

      let solidFrom = line.from - ext;
      for (const cut of wallCuts(r, wall, floorRooms)) {
        piece(solidFrom, cut.from, 0, h, mat);
        if (cut.kind === "door") {
          piece(cut.from, cut.to, doorTop, h, mat);
        } else {
          piece(cut.from, cut.to, 0, sill, mat);
          piece(cut.from, cut.to, sill, doorTop, glassMat, WALL_T * 0.3);
          piece(cut.from, cut.to, doorTop, h, mat);
        }
        solidFrom = Math.max(solidFrom, cut.to);
      }
      piece(solidFrom, line.to + ext, 0, h, mat);
    }
  }

  private addLabel(r: Room, pos: Box, y0: number, colCSS: string) {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 64;
    const ctx = c.getContext("2d")!;
    const font = cssVar("--font-sans", "sans-serif");
    ctx.fillStyle = colCSS + "33";
    ctx.beginPath();
    ctx.roundRect(4, 4, 248, 56, 8);
    ctx.fill();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#1a1a1a";
    ctx.font = `500 18px ${font}`;
    ctx.fillText(r.name, 128, 26);
    ctx.fillStyle = "#555";
    ctx.font = `13px ${font}`;
    ctx.fillText(`${r.w}×${r.l} ft`, 128, 46);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 0.55),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide })
    );
    label.position.set(pos.x + pos.w / 2, y0 + pos.h * 0.45, pos.z + pos.l / 2);
    this.labelGroup.add(label);
  }

  private addFurniture(r: Room, pos: Box, y0: number) {
    const wood = new THREE.MeshLambertMaterial({ color: 0xd4a96a });
    const dark = new THREE.MeshLambertMaterial({ color: 0x8b5e3c });
    const white = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const add = (sx: number, sy: number, sz: number, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
      m.position.set(pos.x + x, y0 + y, pos.z + z);
      m.castShadow = true;
      this.furnitureGroup.add(m);
    };
    const { w, l } = pos;

    if (r.name.includes("Bedroom")) {
      add(1.8, 0.28, 2.2, wood, w * 0.5, 0.14, l * 0.55); // bed
      add(1.8, 0.55, 0.25, dark, w * 0.5, 0.42, l * 0.55 - 1.1); // headboard
      add(0.65, 0.14, 0.55, white, w * 0.5 - 0.5, 0.35, l * 0.55 - 0.75); // pillows
      add(0.65, 0.14, 0.55, white, w * 0.5 + 0.5, 0.35, l * 0.55 - 0.75);
      add(0.4, 0.6, 0.4, dark, w * 0.15, 0.3, l * 0.5); // side table
    }
    if (r.name === "Living Room") {
      add(2.4, 0.45, 0.9, wood, w * 0.45, 0.225, l * 0.75); // sofa
      add(2.4, 0.65, 0.25, dark, w * 0.45, 0.5, l * 0.75 + 0.33);
      add(1.0, 0.05, 0.6, dark, w * 0.45, 0.38, l * 0.45); // coffee table
      for (const [dx, dz] of [[-0.42, -0.24], [0.42, -0.24], [-0.42, 0.24], [0.42, 0.24]]) {
        add(0.06, 0.38, 0.06, dark, w * 0.45 + dx, 0.19, l * 0.45 + dz);
      }
      add(1.8, 0.45, 0.4, dark, w * 0.45, 0.225, l * 0.1); // TV unit
      add(1.4, 0.8, 0.06, new THREE.MeshLambertMaterial({ color: 0x111111 }), w * 0.45, 0.85, l * 0.1);
    }
    if (r.name === "Kitchen") {
      add(w * 0.75, 0.9, 0.55, dark, w * 0.5, 0.45, l * 0.12); // counter
      add(w * 0.75, 0.05, 0.55, new THREE.MeshLambertMaterial({ color: 0xcccccc }), w * 0.5, 0.925, l * 0.12);
      add(0.5, 0.12, 0.35, new THREE.MeshLambertMaterial({ color: 0x999999 }), w * 0.7, 0.92, l * 0.12); // sink
      add(w * 0.75, 0.6, 0.3, dark, w * 0.5, 2.1, l * 0.08); // wall cabinets
    }
    if (r.name === "Bathroom") {
      add(0.45, 0.45, 0.65, white, w * 0.25, 0.225, l * 0.75); // toilet
      add(0.5, 0.05, 0.35, white, w * 0.7, 0.85, l * 0.25); // basin
      add(0.5, 0.85, 0.35, new THREE.MeshLambertMaterial({ color: 0xdddddd }), w * 0.7, 0.425, l * 0.25);
    }
    if (r.name === "Dining Room") {
      add(1.8, 0.07, 0.9, dark, w * 0.5, 0.75, l * 0.5); // table
      for (let ci = 0; ci < 4; ci++) {
        const cx = ci < 2 ? w * 0.5 + (ci === 0 ? -0.7 : 0.7) : w * 0.5;
        const cz = ci < 2 ? l * 0.5 : l * 0.5 + (ci === 2 ? -0.55 : 0.55);
        add(0.42, 0.04, 0.42, wood, cx, 0.46, cz);
        add(0.42, 0.5, 0.06, wood, cx, 0.71, cz - (ci >= 2 ? (ci === 2 ? -0.18 : 0.18) : 0));
      }
    }
  }

  private applyVisibility() {
    const layers = this.state?.layers;
    if (!layers) return;
    this.wallGroup.visible = layers.walls;
    this.floorGroup.visible = layers.floors;
    this.furnitureGroup.visible = layers.furniture;
    this.labelGroup.visible = layers.labels;
    this.grid.visible = layers.grid;
  }

  private applySelection() {
    const selected = this.state?.selectedId ?? null;
    for (const obj of this.floorGroup.children) {
      const mesh = obj as THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>;
      mesh.material.opacity = mesh.userData.roomId === selected ? 0.65 : 0.35;
    }
  }

  // ─── Input ─────────────────────────────────────────────────

  /** addEventListener that is automatically removed in dispose(). */
  private listen(target: EventTarget, type: string, fn: (e: never) => void, opts?: AddEventListenerOptions) {
    target.addEventListener(type, fn as EventListener, opts);
    this.cleanups.push(() => target.removeEventListener(type, fn as EventListener, opts));
  }

  private setPointer(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return rect;
  }

  private orbitBy(dx: number, dy: number) {
    this.spherical.theta -= dx * 0.007;
    this.spherical.phi = clamp(this.spherical.phi + dy * 0.007, 0.15, Math.PI / 2.1);
    this.updateCamera();
  }

  private bindInput() {
    const c = this.canvas;

    this.listen(c, "mousedown", (e: MouseEvent) => {
      if (this.walking) return;
      this.dragging = true;
      this.dragMoved = false;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    this.listen(window, "mouseup", () => (this.dragging = false));
    this.listen(window, "mousemove", (e: MouseEvent) => {
      if (!this.dragging || this.walking) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      if (Math.abs(dx) + Math.abs(dy) > 3) this.dragMoved = true;
      this.orbitBy(dx, dy);
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    this.listen(
      c,
      "wheel",
      (e: WheelEvent) => {
        e.preventDefault();
        if (!this.walking) this.zoom(e.deltaY * 0.04);
      },
      { passive: false }
    );

    // Touch: one finger orbits, two fingers pinch-zoom
    this.listen(c, "touchstart", (e: TouchEvent) => {
      if (e.touches.length === 1) {
        this.dragging = true;
        this.lastX = e.touches[0].clientX;
        this.lastY = e.touches[0].clientY;
      }
      if (e.touches.length === 2) {
        this.lastPinch = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      }
    });
    this.listen(c, "touchend", () => {
      this.dragging = false;
      this.lastPinch = null;
    });
    this.listen(
      c,
      "touchmove",
      (e: TouchEvent) => {
        e.preventDefault();
        if (e.touches.length === 1 && this.dragging) {
          this.orbitBy(e.touches[0].clientX - this.lastX, e.touches[0].clientY - this.lastY);
          this.lastX = e.touches[0].clientX;
          this.lastY = e.touches[0].clientY;
        }
        if (e.touches.length === 2) {
          const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
          if (this.lastPinch) this.zoom(-(d - this.lastPinch) * 0.05);
          this.lastPinch = d;
        }
      },
      { passive: false }
    );

    // Click a floor to select a room (ignored if the click ended a drag)
    this.listen(c, "click", (e: MouseEvent) => {
      if (this.walking || this.dragMoved) return;
      this.setPointer(e.clientX, e.clientY);
      const hit = this.raycaster.intersectObjects(this.floorGroup.children, false)[0];
      this.handlers.onSelect(hit ? (hit.object.userData.roomId as number) : null);
    });

    // Hover tooltip
    this.listen(c, "mousemove", (e: MouseEvent) => {
      if (!this.tooltip || this.walking) return;
      const rect = this.setPointer(e.clientX, e.clientY);
      const hit = this.raycaster.intersectObjects([...this.floorGroup.children, ...this.wallGroup.children], false)[0];
      const room = hit && this.state?.rooms.find((r) => r.id === hit.object.userData.roomId);
      if (room) {
        this.tooltip.style.opacity = "1";
        this.tooltip.style.left = `${e.clientX - rect.left + 12}px`;
        this.tooltip.style.top = `${e.clientY - rect.top - 28}px`;
        this.tooltip.textContent = `${room.name} · ${room.w}×${room.l} ft`;
      } else {
        this.tooltip.style.opacity = "0";
      }
    });
    this.listen(c, "mouseleave", () => {
      if (this.tooltip) this.tooltip.style.opacity = "0";
    });

    // Walkthrough controls
    this.listen(document, "keydown", (e: KeyboardEvent) => {
      if (!this.walking) return;
      this.walkKeys[e.code] = true;
      if (e.code === "Escape") this.stopWalkFromInside();
    });
    this.listen(document, "keyup", (e: KeyboardEvent) => {
      this.walkKeys[e.code] = false;
    });
    this.listen(document, "pointerlockchange", () => {
      if (document.pointerLockElement === this.canvas) {
        this.hadPointerLock = true;
      } else if (this.walking && this.hadPointerLock) {
        // Browsers swallow the Esc keypress that releases pointer lock, so treat losing the lock as "exit".
        this.stopWalkFromInside();
      }
    });
    this.listen(document, "mousemove", (e: MouseEvent) => {
      if (!this.walking || document.pointerLockElement !== this.canvas) return;
      // Chrome can report one huge jump right after the pointer locks; ignore spikes like that.
      if (Math.abs(e.movementX) > 150 || Math.abs(e.movementY) > 150) return;
      this.walkYaw -= e.movementX * 0.002;
      this.walkPitch = clamp(this.walkPitch - e.movementY * 0.002, -Math.PI / 2.5, Math.PI / 2.5);
    });
  }

  private stopWalkFromInside() {
    this.exitWalk();
    this.handlers.onWalkExit();
  }

  private stepWalk() {
    const k = this.walkKeys;
    const speed = k.ShiftLeft || k.ShiftRight ? 0.12 : 0.05;
    const dir = new THREE.Vector3(
      Math.sin(this.walkYaw) * Math.cos(this.walkPitch),
      Math.sin(this.walkPitch),
      Math.cos(this.walkYaw) * Math.cos(this.walkPitch)
    );
    const right = new THREE.Vector3(-Math.cos(this.walkYaw), 0, Math.sin(this.walkYaw));
    if (k.KeyW || k.ArrowUp) this.walkPos.addScaledVector(dir, speed);
    if (k.KeyS || k.ArrowDown) this.walkPos.addScaledVector(dir, -speed);
    if (k.KeyA || k.ArrowLeft) this.walkPos.addScaledVector(right, -speed);
    if (k.KeyD || k.ArrowRight) this.walkPos.addScaledVector(right, speed);
    this.walkCamera.position.copy(this.walkPos);
    this.walkCamera.lookAt(this.walkPos.clone().add(dir));
  }
}
