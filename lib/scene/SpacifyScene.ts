import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { clampToRoom, footprint } from "@/lib/furniture";
import { planBounds, roomSizeText, roomWalls, sharedSpans, type CameraPreset, type Layers, type Room, type RoomDesign } from "@/lib/rooms";
import { disposeGeometry } from "./build";
import { FT, buildRoom, floorLevels, resolveDesign, type Collider, type DoorRig, type HouseContext, type Platform, type RoomBuild } from "./house";
import { MaterialLibrary } from "./materials";
import { World } from "./world";

export type ItemRef = { roomId: number; itemId: number };

export type SceneState = {
  rooms: Room[];
  floors: number;
  layers: Layers;
  designs: Record<number, RoomDesign>;
  selectedId: number | null;
  /** Show only this floor and the ones below it (orbit view). Null shows every floor. */
  viewFloor: number | null;
  /** Furniture can be picked and dragged (Interior Design tab). */
  editFurniture: boolean;
  selectedItem: ItemRef | null;
};

type Handlers = {
  onSelect: (roomId: number | null) => void;
  onWalkExit: () => void;
  onSelectItem: (item: ItemRef | null) => void;
  /** A piece was dragged to x, z (feet from the room's north-west corner). */
  onMoveItem: (item: ItemRef, x: number, z: number) => void;
};

type Spherical = { theta: number; phi: number; radius: number };

const PRESETS: Record<CameraPreset, Omit<Spherical, "radius">> = {
  persp: { theta: Math.PI / 5, phi: Math.PI / 3.3 },
  top: { theta: 0, phi: 0.02 },
  front: { theta: 0, phi: Math.PI / 2.4 },
  side: { theta: Math.PI / 2, phi: Math.PI / 2.6 },
};
const MIN_RADIUS = 3;
const MAX_RADIUS = 140;

// Walkthrough body, metres
const EYE = 1.62;
const RADIUS = 0.24;
const STEP_UP = 0.36;
const BODY = 1.75;
const WALK_SPEED = 1.6;
const RUN_SPEED = 3.4;

const ACCENT = new THREE.Color("#a6e36f");
/** Strength of the sky's fill light outdoors and indoors (where walls and the ceiling block most of it). */
const ENV_OUTDOOR = 0.8;
const ENV_INDOOR = 0.6;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const damp = (dt: number, rate: number) => 1 - Math.exp(-dt * rate);

type Entry = { room: Room; design: RoomDesign | undefined; build: RoomBuild };

/**
 * The imperative Three.js scene. React owns the state; this class only draws it.
 * Create it once per <canvas>, push state in with update(), and call dispose() on unmount.
 */
export class SpacifyScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(42, 1, 0.1, 1500);
  private walkCamera = new THREE.PerspectiveCamera(68, 1, 0.06, 1500);
  private composer: EffectComposer;
  private renderPass: RenderPass;
  private aoPass: GTAOPass;
  private mats = new MaterialLibrary();
  private world: World;
  private grid = new THREE.GridHelper(80, 80, 0x8a9a7a, 0x6f7a66);

  // One group per layer; each holds every room's part of that layer.
  private layerGroups = {
    structure: new THREE.Group(),
    floors: new THREE.Group(),
    ceilings: new THREE.Group(),
    roofs: new THREE.Group(),
    furniture: new THREE.Group(),
    cupboards: new THREE.Group(),
    fixtures: new THREE.Group(),
  };
  private selection = new THREE.Group();
  private roomLight = new THREE.PointLight("#ffdcb0", 0, 0, 2);

  private entries = new Map<number, Entry>();
  private ctx: HouseContext | null = null;
  private colliders: Collider[] = [];
  private platforms: Platform[] = [];
  private doors: DoorRig[] = [];
  private houseSize = 15;
  private plotBounds = { x0: -20, x1: 20, z0: -20, z1: 20 };

  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private state: SceneState | null = null;
  private rafId = 0;
  private lastTime = performance.now();
  private dirty = true;
  private resizeObserver: ResizeObserver;
  private cleanups: (() => void)[] = [];

  // Orbit camera: where it is and where it's heading (eased each frame)
  private spherical: Spherical = { ...PRESETS.persp, radius: 38 };
  private goal: Spherical = { ...PRESETS.persp, radius: 38 };
  private target = new THREE.Vector3();
  private targetGoal = new THREE.Vector3();

  // Pointer state
  private drag: { mode: "orbit" | "pan" | "item"; moved: boolean; x: number; y: number } | null = null;
  private itemDrag: { ref: ItemRef; object: THREE.Object3D; plane: THREE.Plane; offset: THREE.Vector3; x: number; z: number } | null = null;
  private lastPinch: number | null = null;

  // Walkthrough
  private walking = false;
  private feet = new THREE.Vector3();
  private velocity = new THREE.Vector3();
  private fall = 0;
  private eyeY = 0;
  private yaw = 0;
  private pitch = 0;
  private stride = 0;
  private keys: Record<string, boolean> = {};
  private hadPointerLock = false;
  private exposure = 1;
  private currentRoom: number | null = null;
  private slowFrames = 0;
  private frames = 0;
  private quality = 2;

  constructor(
    private canvas: HTMLCanvasElement,
    private container: HTMLElement,
    private tooltip: HTMLElement | null,
    private handlers: Handlers
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;

    this.world = new World(this.renderer, this.scene, this.mats);
    this.scene.environmentIntensity = ENV_OUTDOOR;

    this.roomLight.castShadow = true;
    this.roomLight.shadow.mapSize.set(512, 512);
    this.roomLight.shadow.bias = -0.004;
    this.roomLight.shadow.radius = 3;
    this.roomLight.shadow.camera.near = 0.1;
    this.roomLight.shadow.camera.far = 25;
    this.roomLight.visible = false;

    this.grid.position.y = 0.025;
    this.grid.visible = false;
    (this.grid.material as THREE.Material).transparent = true;
    (this.grid.material as THREE.Material).opacity = 0.35;
    this.grid.userData.noAO = true;

    this.scene.add(this.grid, this.selection, this.roomLight, ...Object.values(this.layerGroups));

    // HDR render with 4× MSAA → ambient occlusion → tone mapping and sRGB
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, target);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.aoPass = new GTAOPass(this.scene, this.camera, 1, 1);
    this.aoPass.updateGtaoMaterial({ radius: 0.45, distanceExponent: 1.5, thickness: 1.2, scale: 1.1, samples: 16 });
    this.aoPass.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
    this.aoPass.blendIntensity = 0.9;
    this.hideFromAo(this.aoPass);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.aoPass);
    this.composer.addPass(new OutputPass());

    this.bindInput();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.updateCamera();
    this.loop();
  }

  /** Glass, insect mesh and leaf cards would cast flat grey AO, so the AO pass doesn't see them. */
  private hideFromAo(pass: GTAOPass) {
    const p = pass as unknown as { _overrideVisibility: () => void; _visibilityCache: THREE.Object3D[] };
    const original = p._overrideVisibility.bind(pass);
    p._overrideVisibility = () => {
      original();
      this.scene.traverse((o) => {
        if (o.visible && o.userData.noAO) {
          o.visible = false;
          p._visibilityCache.push(o);
        }
      });
    };
  }

  // ─── Public API ────────────────────────────────────────────

  update(next: SceneState) {
    const prev = this.state;
    this.state = next;
    if (!prev || prev.rooms !== next.rooms || prev.floors !== next.floors) this.rebuildAll();
    else if (prev.designs !== next.designs) this.rebuildChanged();
    this.applyVisibility();
    this.applySelection();
    this.invalidate(true);
  }

  setCameraPreset(preset: CameraPreset) {
    this.goal = { ...PRESETS[preset], radius: this.fitRadius() };
    this.targetGoal.set(0, 0, 0);
    this.invalidate();
  }

  zoom(delta: number) {
    this.goal.radius = clamp(this.goal.radius * (delta > 0 ? 1.18 : 0.85), MIN_RADIUS, MAX_RADIUS);
    this.invalidate();
  }

  /** Swings the camera round to look into one room. */
  focusRoom(roomId: number) {
    const b = this.entries.get(roomId)?.build.bounds;
    if (!b) return;
    this.targetGoal.set((b.x0 + b.x1) / 2, b.y, (b.z0 + b.z1) / 2);
    // Look down into it steeply enough to see over the walls of the rooms around it.
    this.goal.radius = clamp(Math.hypot(b.x1 - b.x0, b.z1 - b.z0) * 1.9 + b.h, 8, 40);
    this.goal.phi = 0.5;
    this.invalidate();
  }

  /** Returns the current view as a PNG data URL. */
  snapshot(): string {
    this.render();
    return this.renderer.domElement.toDataURL("image/png");
  }

  /** Starts walking, just inside `roomId`'s door (or the living room's, or the first room's). */
  enterWalk(roomId: number | null) {
    if (this.walking || !this.state) return;
    this.walking = true;
    this.keys = {};
    this.hadPointerLock = false;
    if (this.tooltip) this.tooltip.style.opacity = "0";
    this.spawn(roomId);
    this.applyVisibility();
    this.applySelection();
    this.invalidate(true);
    // Pointer lock can be refused (e.g. inside some iframes); WASD still works without mouse-look.
    const lock = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
    lock?.catch?.(() => {});
  }

  exitWalk() {
    if (!this.walking) return;
    this.walking = false;
    this.keys = {};
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    for (const d of this.doors) this.setDoor(d, 0);
    this.roomLight.visible = false;
    this.roomLight.intensity = 0;
    this.renderer.toneMappingExposure = this.exposure = 1;
    this.scene.environmentIntensity = ENV_OUTDOOR;
    this.applyVisibility();
    this.applySelection();
    this.setCamera(this.camera);
    this.invalidate(true);
  }

  dispose() {
    cancelAnimationFrame(this.rafId);
    this.resizeObserver.disconnect();
    this.cleanups.forEach((fn) => fn());
    for (const g of Object.values(this.layerGroups)) disposeGeometry(g);
    disposeGeometry(this.selection);
    this.world.dispose();
    this.mats.dispose();
    this.grid.dispose();
    this.aoPass.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }

  // ─── Rendering ─────────────────────────────────────────────

  /** Asks for a new frame; `shadows` also redraws the shadow maps (the scene changed). */
  private invalidate(shadows = false) {
    this.dirty = true;
    if (shadows) this.renderer.shadowMap.needsUpdate = true;
  }

  private render() {
    this.composer.render();
  }

  private loop = () => {
    this.rafId = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;
    if (this.walking) {
      this.stepWalk(dt);
      this.render();
      this.adaptQuality(dt);
      return;
    }
    if (this.easeCamera(dt)) this.dirty = true;
    if (!this.dirty) return;
    this.dirty = false;
    this.render();
  };

  /** Drops ambient occlusion, then resolution, if the walkthrough can't keep ~30 fps. */
  private adaptQuality(dt: number) {
    this.frames++;
    if (dt > 0.036) this.slowFrames++;
    if (this.frames < 90) return;
    if (this.slowFrames > 60 && this.quality > 0) {
      this.quality--;
      if (this.quality === 1) {
        this.aoPass.enabled = false;
      } else {
        this.renderer.setPixelRatio(1);
        this.resize();
      }
    }
    this.frames = this.slowFrames = 0;
  }

  private resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    for (const cam of [this.camera, this.walkCamera]) {
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
    }
    this.invalidate();
  }

  private setCamera(cam: THREE.PerspectiveCamera) {
    this.renderPass.camera = cam;
    this.aoPass.camera = cam;
  }

  private updateCamera() {
    const { theta, phi, radius } = this.spherical;
    this.camera.position.set(
      this.target.x + radius * Math.sin(phi) * Math.sin(theta),
      this.target.y + radius * Math.cos(phi),
      this.target.z + radius * Math.sin(phi) * Math.cos(theta)
    );
    this.camera.lookAt(this.target);
  }

  /** Eases the orbit camera towards its goal. Returns whether it moved. */
  private easeCamera(dt: number): boolean {
    const k = damp(dt, 9);
    const s = this.spherical, g = this.goal;
    const dTheta = g.theta - s.theta, dPhi = g.phi - s.phi, dR = g.radius - s.radius;
    const dT = this.targetGoal.distanceTo(this.target);
    if (Math.abs(dTheta) < 1e-4 && Math.abs(dPhi) < 1e-4 && Math.abs(dR) < 1e-3 && dT < 1e-3) return false;
    s.theta += dTheta * k;
    s.phi += dPhi * k;
    s.radius += dR * k;
    this.target.lerp(this.targetGoal, k);
    this.updateCamera();
    return true;
  }

  private fitRadius() {
    return clamp(this.houseSize * 1.35, 12, MAX_RADIUS);
  }

  // ─── Scene building ────────────────────────────────────────

  private rebuildAll() {
    const state = this.state!;
    for (const id of [...this.entries.keys()]) this.removeEntry(id);
    const b = planBounds(state.rooms);
    if (!b) {
      this.ctx = null;
      this.world.setFootprint(null);
      this.collect();
      return;
    }
    const center = { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 };
    const levels = floorLevels(state.rooms, state.floors);
    this.ctx = { rooms: state.rooms, floors: state.floors, levels, center, designs: state.designs, mats: this.mats };
    for (const room of state.rooms) this.addEntry(room);

    const w = (b.maxX - b.minX) * FT, l = (b.maxZ - b.minZ) * FT;
    const size = Math.hypot(w, l);
    const sizeChanged = Math.abs(size - this.houseSize) > 0.5;
    this.houseSize = size;
    const top = levels[state.floors] + 4;
    this.world.setFootprint({ x0: -w / 2, x1: w / 2, z0: -l / 2, z1: l / 2, top });
    this.plotBounds = { x0: -w / 2 - 3.3, x1: w / 2 + 3.3, z0: -l / 2 - 3.3, z1: l / 2 + 6.8 };
    if (sizeChanged) {
      this.goal.radius = this.fitRadius();
      this.targetGoal.set(0, 0, 0);
    }
    this.collect();
  }

  /** Rebuilds rooms whose design changed, and their neighbours (whose doors show the changed room's design on one face). */
  private rebuildChanged() {
    const state = this.state!;
    if (!this.ctx) return;
    this.ctx.designs = state.designs;
    const changed = state.rooms.filter((r) => this.entries.get(r.id)?.design !== state.designs[r.id]);
    const ids = new Set(changed.map((r) => r.id));
    for (const r of changed) {
      for (const o of state.rooms) if (o.floor === r.floor && o.id !== r.id && roomWalls(o).some((e) => sharedSpans(o, e.key, [r]).length)) ids.add(o.id);
    }
    for (const room of state.rooms) {
      if (!ids.has(room.id)) continue;
      this.removeEntry(room.id);
      this.addEntry(room);
    }
    this.collect();
  }

  private addEntry(room: Room) {
    const design = this.state!.designs[room.id];
    const build = buildRoom(room, design, this.ctx!);
    const g = this.layerGroups;
    const parts: [THREE.Group, THREE.Object3D][] = [
      [g.structure, build.structure],
      [g.floors, build.floorGroup],
      [g.ceilings, build.ceiling],
      [g.roofs, build.roof],
      [g.furniture, build.furniture],
      [g.cupboards, build.cupboards],
      [g.fixtures, build.fixtures],
    ];
    for (const [layer, part] of parts) {
      part.userData.floor = room.floor;
      part.userData.roomId = room.id;
      layer.add(part);
    }
    this.entries.set(room.id, { room, design, build });
  }

  private removeEntry(id: number) {
    const entry = this.entries.get(id);
    if (!entry) return;
    const b = entry.build;
    for (const part of [b.structure, b.floorGroup, b.ceiling, b.roof, b.furniture, b.cupboards, b.fixtures]) {
      part.removeFromParent();
      disposeGeometry(part);
    }
    this.entries.delete(id);
  }

  /** Gathers the walkthrough's collision data from every room. */
  private collect() {
    const builds = [...this.entries.values()].map((e) => e.build);
    this.colliders = builds.flatMap((b) => b.colliders);
    this.platforms = builds.flatMap((b) => b.platforms);
    this.doors = builds.flatMap((b) => b.doors);
  }

  private applyVisibility() {
    const layers = this.state?.layers;
    if (!layers) return;
    const g = this.layerGroups;
    const viewFloor = this.walking ? null : this.state!.viewFloor;
    g.structure.visible = this.walking || layers.walls;
    g.floors.visible = this.walking || layers.floors;
    g.ceilings.visible = this.walking || layers.roof;
    g.roofs.visible = this.walking || layers.roof;
    g.furniture.visible = layers.furniture;
    g.fixtures.visible = layers.furniture;
    g.cupboards.visible = layers.furniture || layers.cupboards;
    this.grid.visible = !this.walking && layers.grid;
    for (const group of Object.values(g)) {
      for (const part of group.children) part.visible = viewFloor === null || part.userData.floor <= viewFloor;
    }
    // Looking down at one floor: hide its ceiling and roof even with the roof on, so you can see in.
    if (viewFloor !== null) for (const part of [...g.ceilings.children, ...g.roofs.children]) if (part.userData.floor === viewFloor) part.visible = false;
    this.invalidate(true);
  }

  /** Outlines the selected room (and the selected piece of furniture) on the floor. */
  private applySelection() {
    disposeGeometry(this.selection);
    this.selection.clear();
    const state = this.state;
    if (!state || this.walking) return;
    const outline = (x0: number, x1: number, z0: number, z1: number, y: number) => {
      const mat = new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.9, depthWrite: false });
      const t = 0.05;
      const add = (w: number, d: number, x: number, z: number) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.01, d), mat);
        m.position.set(x, y, z);
        m.userData.noAO = true;
        this.selection.add(m);
      };
      add(x1 - x0, t, (x0 + x1) / 2, z0 + t / 2);
      add(x1 - x0, t, (x0 + x1) / 2, z1 - t / 2);
      add(t, z1 - z0, x0 + t / 2, (z0 + z1) / 2);
      add(t, z1 - z0, x1 - t / 2, (z0 + z1) / 2);
    };
    const room = state.selectedId !== null ? this.entries.get(state.selectedId) : undefined;
    if (room && (state.viewFloor === null || room.room.floor <= state.viewFloor)) {
      const b = room.build.bounds;
      if (!room.room.shape) {
        outline(b.x0 + 0.06, b.x1 - 0.06, b.z0 + 0.06, b.z1 - 0.06, b.y + 0.012);
      } else {
        // A shaped room: a strip along each wall, just inside it
        const mat = new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.9, depthWrite: false });
        const toWorld = (ftX: number, ftZ: number) => [b.x0 + (ftX - room.room.x) * FT, b.z0 + (ftZ - room.room.z) * FT];
        for (const e of roomWalls(room.room)) {
          const inward = e.dir === "n" || e.dir === "w" ? 0.085 : -0.085;
          const [x0, z0] = e.axis === "x" ? toWorld(e.from, e.at) : toWorld(e.at, e.from);
          const [x1, z1] = e.axis === "x" ? toWorld(e.to, e.at) : toWorld(e.at, e.to);
          const m = new THREE.Mesh(new THREE.BoxGeometry(e.axis === "x" ? x1 - x0 : 0.05, 0.01, e.axis === "x" ? 0.05 : z1 - z0), mat);
          m.position.set((x0 + x1) / 2 + (e.axis === "z" ? inward : 0), b.y + 0.012, (z0 + z1) / 2 + (e.axis === "x" ? inward : 0));
          m.userData.noAO = true;
          this.selection.add(m);
        }
      }
    }
    const sel = state.selectedItem;
    const itemEntry = sel ? this.entries.get(sel.roomId) : undefined;
    const item = itemEntry && resolveDesign(itemEntry.room, itemEntry.design).furniture?.find((f) => f.id === sel!.itemId);
    if (itemEntry && item) {
      const b = itemEntry.build.bounds;
      const pos = clampToRoom(itemEntry.room, item, item.x, item.z);
      const fp = footprint(item.type, item.rot);
      outline(b.x0 + (pos.x - fp.w / 2) * FT - 0.05, b.x0 + (pos.x + fp.w / 2) * FT + 0.05, b.z0 + (pos.z - fp.l / 2) * FT - 0.05, b.z0 + (pos.z + fp.l / 2) * FT + 0.05, b.y + 0.016);
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

  /** The nearest hit among visible objects (raycasting doesn't skip hidden ones by itself). */
  private hit(roots: THREE.Object3D[]) {
    const shown = (o: THREE.Object3D | null): boolean => !o || (o.visible && shown(o.parent));
    return this.raycaster.intersectObjects(roots, true).find((h) => shown(h.object));
  }

  /** The furniture item a hit belongs to (its top-level group carries the ids). */
  private itemOf(object: THREE.Object3D): THREE.Object3D | null {
    for (let o: THREE.Object3D | null = object; o; o = o.parent) if (o.userData.itemId !== undefined) return o;
    return null;
  }

  private orbitBy(dx: number, dy: number) {
    this.goal.theta -= dx * 0.006;
    this.goal.phi = clamp(this.goal.phi - dy * 0.006, 0.02, Math.PI / 2.05);
    this.invalidate();
  }

  private panBy(dx: number, dy: number) {
    const scale = this.goal.radius * 0.0016;
    const right = new THREE.Vector3(Math.cos(this.goal.theta), 0, -Math.sin(this.goal.theta));
    const forward = new THREE.Vector3(-Math.sin(this.goal.theta), 0, -Math.cos(this.goal.theta));
    this.targetGoal.addScaledVector(right, -dx * scale).addScaledVector(forward, dy * scale);
    this.invalidate();
  }

  private bindInput() {
    const c = this.canvas;
    this.listen(c, "contextmenu", (e: MouseEvent) => e.preventDefault());

    this.listen(c, "mousedown", (e: MouseEvent) => {
      if (this.walking) return;
      const mode = e.button === 2 || e.shiftKey ? "pan" : "orbit";
      this.drag = { mode, moved: false, x: e.clientX, y: e.clientY };
      if (mode === "orbit" && this.state?.editFurniture) this.startItemDrag(e);
    });
    this.listen(window, "mouseup", (e: MouseEvent) => {
      const drag = this.drag;
      this.drag = null;
      if (!drag || this.walking) return;
      if (drag.mode === "item") return this.endItemDrag(drag.moved);
      if (drag.moved || drag.mode === "pan" || e.target !== c) return;
      // A click: select the room under the pointer
      this.setPointer(e.clientX, e.clientY);
      const hit = this.hit([this.layerGroups.floors]);
      this.handlers.onSelect(hit ? (hit.object.userData.roomId as number) : null);
      if (this.state?.editFurniture) this.handlers.onSelectItem(null);
    });
    this.listen(window, "mousemove", (e: MouseEvent) => {
      const drag = this.drag;
      if (!drag || this.walking) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      if (drag.mode === "item") this.moveItemDrag(e);
      else if (drag.mode === "pan") this.panBy(dx, dy);
      else this.orbitBy(dx, dy);
      drag.x = e.clientX;
      drag.y = e.clientY;
    });
    this.listen(
      c,
      "wheel",
      (e: WheelEvent) => {
        e.preventDefault();
        if (!this.walking) {
          this.goal.radius = clamp(this.goal.radius * Math.exp(e.deltaY * 0.0012), MIN_RADIUS, MAX_RADIUS);
          this.invalidate();
        }
      },
      { passive: false }
    );

    // Touch: one finger orbits, two fingers pinch-zoom
    this.listen(c, "touchstart", (e: TouchEvent) => {
      if (e.touches.length === 1) this.drag = { mode: "orbit", moved: false, x: e.touches[0].clientX, y: e.touches[0].clientY };
      if (e.touches.length === 2) {
        this.drag = null;
        this.lastPinch = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      }
    });
    this.listen(c, "touchend", () => {
      this.drag = null;
      this.lastPinch = null;
    });
    this.listen(
      c,
      "touchmove",
      (e: TouchEvent) => {
        e.preventDefault();
        if (e.touches.length === 1 && this.drag) {
          this.orbitBy(e.touches[0].clientX - this.drag.x, e.touches[0].clientY - this.drag.y);
          this.drag.x = e.touches[0].clientX;
          this.drag.y = e.touches[0].clientY;
        }
        if (e.touches.length === 2) {
          const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
          if (this.lastPinch) {
            this.goal.radius = clamp(this.goal.radius * (this.lastPinch / d), MIN_RADIUS, MAX_RADIUS);
            this.invalidate();
          }
          this.lastPinch = d;
        }
      },
      { passive: false }
    );

    // Hover tooltip
    this.listen(c, "mousemove", (e: MouseEvent) => {
      if (!this.tooltip || this.walking || this.drag?.moved) return;
      const rect = this.setPointer(e.clientX, e.clientY);
      const hit = this.hit([this.layerGroups.floors]);
      const room = hit && this.state?.rooms.find((r) => r.id === hit.object.userData.roomId);
      if (room) {
        this.tooltip.style.opacity = "1";
        this.tooltip.style.left = `${e.clientX - rect.left + 12}px`;
        this.tooltip.style.top = `${e.clientY - rect.top - 28}px`;
        this.tooltip.textContent = `${room.name} · ${roomSizeText(room)}`;
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
      this.keys[e.code] = true;
      if (e.code === "Escape") this.stopWalkFromInside();
      if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
    });
    this.listen(document, "keyup", (e: KeyboardEvent) => {
      this.keys[e.code] = false;
    });
    this.listen(window, "blur", () => (this.keys = {}));
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
      this.yaw -= e.movementX * 0.0022;
      this.pitch = clamp(this.pitch - e.movementY * 0.0022, -1.35, 1.35);
    });
  }

  // ─── Dragging furniture ────────────────────────────────────

  private startItemDrag(e: MouseEvent) {
    this.setPointer(e.clientX, e.clientY);
    const g = this.layerGroups;
    const hit = this.hit([g.furniture, g.cupboards]);
    const object = hit && this.itemOf(hit.object);
    if (!hit || !object || !this.drag) return;
    const ref = { roomId: object.userData.roomId as number, itemId: object.userData.itemId as number };
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -object.position.y);
    const onPlane = new THREE.Vector3();
    this.raycaster.ray.intersectPlane(plane, onPlane);
    this.drag.mode = "item";
    this.itemDrag = { ref, object, plane, offset: object.position.clone().sub(onPlane), x: 0, z: 0 };
    this.handlers.onSelectItem(ref);
  }

  private moveItemDrag(e: MouseEvent) {
    const d = this.itemDrag;
    const entry = d && this.entries.get(d.ref.roomId);
    const item = entry && resolveDesign(entry.room, entry.design).furniture?.find((f) => f.id === d!.ref.itemId);
    if (!d || !entry || !item) return;
    this.setPointer(e.clientX, e.clientY);
    const p = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(d.plane, p)) return;
    p.add(d.offset);
    const b = entry.build.bounds;
    const pos = clampToRoom(entry.room, item, (p.x - b.x0) / FT, (p.z - b.z0) / FT);
    d.x = pos.x;
    d.z = pos.z;
    d.object.position.set(b.x0 + pos.x * FT, b.y, b.z0 + pos.z * FT);
    this.invalidate(true);
  }

  private endItemDrag(moved: boolean) {
    const d = this.itemDrag;
    this.itemDrag = null;
    if (d && moved) this.handlers.onMoveItem(d.ref, d.x, d.z);
  }

  // ─── Walkthrough ───────────────────────────────────────────

  private stopWalkFromInside() {
    this.exitWalk();
    this.handlers.onWalkExit();
  }

  private spawn(roomId: number | null) {
    const entries = [...this.entries.values()];
    const entry =
      (roomId !== null && this.entries.get(roomId)) ||
      entries.find((e) => /living|drawing/i.test(e.room.name) && e.room.floor === 1) ||
      entries.find((e) => e.room.floor === 1) ||
      entries[0];
    if (!entry) return;
    const b = entry.build.bounds;
    const centre = new THREE.Vector3((b.x0 + b.x1) / 2, b.y, (b.z0 + b.z1) / 2);
    const door = entry.build.doors[0];
    let start = centre.clone();
    let look = new THREE.Vector3(0, 0, -1);
    if (door) {
      const toCentre = centre.clone().sub(new THREE.Vector3(door.x, b.y, door.z)).setY(0);
      if (toCentre.lengthSq() > 0.01) {
        look = toCentre.normalize();
        start = new THREE.Vector3(door.x, b.y, door.z).addScaledVector(look, 0.9);
      }
    }
    this.feet.copy(start);
    this.resolve(this.feet);
    this.velocity.set(0, 0, 0);
    this.fall = 0;
    this.eyeY = this.feet.y + EYE;
    this.yaw = Math.atan2(-look.x, -look.z);
    this.pitch = -0.05;
    this.currentRoom = null;
    this.frames = this.slowFrames = 0;
    this.setCamera(this.walkCamera);
  }

  /** Pushes a body standing at `p` (feet) out of anything solid at its height. */
  private resolve(p: THREE.Vector3) {
    for (let iter = 0; iter < 4; iter++) {
      let pushed = false;
      for (const c of this.colliders) {
        if (c.y1 <= p.y + STEP_UP || c.y0 >= p.y + BODY) continue;
        const cx = clamp(p.x, c.x0, c.x1), cz = clamp(p.z, c.z0, c.z1);
        const dx = p.x - cx, dz = p.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= RADIUS * RADIUS) continue;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          p.x += (dx / d) * (RADIUS - d);
          p.z += (dz / d) * (RADIUS - d);
        } else {
          // Centre is inside the box: leave by the nearest side
          const out = [p.x - c.x0 + RADIUS, c.x1 - p.x + RADIUS, p.z - c.z0 + RADIUS, c.z1 - p.z + RADIUS];
          const i = out.indexOf(Math.min(...out));
          if (i === 0) p.x -= out[0];
          else if (i === 1) p.x += out[1];
          else if (i === 2) p.z -= out[2];
          else p.z += out[3];
        }
        pushed = true;
      }
      if (!pushed) break;
    }
    p.x = clamp(p.x, this.plotBounds.x0, this.plotBounds.x1);
    p.z = clamp(p.z, this.plotBounds.z0, this.plotBounds.z1);
  }

  /** The highest surface under (x, z) that a body with its feet at `y` can stand on. */
  private groundAt(x: number, z: number, y: number) {
    let best = 0;
    for (const p of this.platforms) {
      if (x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1 && p.y <= y + STEP_UP && p.y > best) best = p.y;
    }
    return best;
  }

  private stepWalk(dt: number) {
    const k = this.keys;
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wish = new THREE.Vector3();
    if (k.KeyW || k.ArrowUp) wish.add(forward);
    if (k.KeyS || k.ArrowDown) wish.sub(forward);
    if (k.KeyD || k.ArrowRight) wish.add(right);
    if (k.KeyA || k.ArrowLeft) wish.sub(right);
    const speed = k.ShiftLeft || k.ShiftRight ? RUN_SPEED : WALK_SPEED;
    if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(speed);
    this.velocity.lerp(wish, damp(dt, wish.lengthSq() > 0 ? 10 : 12));

    const next = this.feet.clone().addScaledVector(this.velocity, dt);
    this.resolve(next);
    // Gravity, and stepping up stairs
    const ground = this.groundAt(next.x, next.z, next.y);
    if (next.y > ground + 0.001) {
      this.fall += 9.8 * dt;
      next.y = Math.max(ground, next.y - this.fall * dt);
    } else {
      this.fall = 0;
      next.y = ground;
    }
    const moved = Math.hypot(next.x - this.feet.x, next.z - this.feet.z);
    this.feet.copy(next);

    // Eye height eases over steps; a gentle bob while walking
    this.stride += moved * 5.2;
    const bob = Math.sin(this.stride) * 0.025 * Math.min(1, this.velocity.length() / WALK_SPEED);
    this.eyeY += (this.feet.y + EYE - this.eyeY) * damp(dt, 14);
    this.walkCamera.position.set(this.feet.x, this.eyeY + bob, this.feet.z);
    this.walkCamera.rotation.order = "YXZ";
    this.walkCamera.rotation.set(this.pitch, this.yaw, 0);

    this.updateDoors(dt);
    this.updateIndoorLight(dt);
  }

  private setDoor(d: DoorRig, open: number) {
    d.open = open;
    const ease = open * open * (3 - 2 * open);
    for (const leaf of d.leaves) leaf.pivot.rotation.y = leaf.sign * ease * 1.6;
  }

  /** Doors swing open as you come near and close behind you. */
  private updateDoors(dt: number) {
    let moving = false;
    for (const d of this.doors) {
      const near = Math.abs(d.y - this.feet.y) < 1.2 && Math.hypot(d.x - this.feet.x, d.z - this.feet.z) < 1.9;
      const goal = near ? 1 : 0;
      if (Math.abs(goal - d.open) < 0.001) continue;
      this.setDoor(d, clamp(d.open + Math.sign(goal - d.open) * dt * 1.8, 0, 1));
      moving = true;
    }
    if (moving) this.renderer.shadowMap.needsUpdate = true;
  }

  /** Indoors: the room's ceiling light comes on, the sky light drops and the eye adapts. */
  private updateIndoorLight(dt: number) {
    const f = this.feet;
    let inside: Entry | null = null;
    for (const e of this.entries.values()) {
      const b = e.build.bounds;
      if (Math.abs(f.y - b.y) < 1.3 && e.build.rects.some((q) => f.x >= q.x0 && f.x <= q.x1 && f.z >= q.z0 && f.z <= q.z1)) inside = e;
    }
    const id = inside?.room.id ?? null;
    if (id !== this.currentRoom) {
      this.currentRoom = id;
      if (inside) {
        this.roomLight.position.copy(inside.build.lamp);
        this.roomLight.visible = true;
        this.roomLight.intensity = 0;
        this.renderer.shadowMap.needsUpdate = true;
      }
    }
    const goalLight = inside ? 9 : 0;
    this.roomLight.intensity += (goalLight - this.roomLight.intensity) * damp(dt, 4);
    if (!inside && this.roomLight.intensity < 0.05) this.roomLight.visible = false;
    const goalEnv = inside ? ENV_INDOOR : ENV_OUTDOOR;
    this.scene.environmentIntensity += (goalEnv - this.scene.environmentIntensity) * damp(dt, 3);
    const goalExposure = inside ? 1.45 : 1;
    this.exposure += (goalExposure - this.exposure) * damp(dt, 1.5);
    this.renderer.toneMappingExposure = this.exposure;
  }
}
