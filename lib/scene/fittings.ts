// Furniture, the modular kitchen and bathroom fixtures. Built in metres; furniture is the basic brown for now.
//
// A model's origin is the centre of its footprint on the floor. Its back is towards −z (the wall) and it faces +z.

import * as THREE from "three";
import { FURNITURE, cornerConvex, isBathroom, roomWalls, wallCuts, wallEdge, type FurnitureType, type Room, type WallKey } from "@/lib/rooms";
import { MeshBuilder } from "./build";
import type { MaterialLibrary } from "./materials";

export const FT = 0.3;
/** Thickness of the plaster/brick layer each room's walls take inside its own footprint (metres). */
export const INNER_T = 0.06;

/** An axis-aligned box in world metres that the walker can't pass through. */
export type Collider = { x0: number; x1: number; z0: number; z1: number; y0: number; y1: number };

type M = MaterialLibrary;

// ─── Furniture ────────────────────────────────────────────────

function bed(b: MeshBuilder, m: M, W: number, D: number) {
  b.rbox(W, 0.28, D - 0.06, 0.02, m.brown, 0, 0.2, 0.03);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.06, 0.08, 0.06, m.darkBrown, sx * (W / 2 - 0.08), 0.04, sz * (D / 2 - 0.12));
  b.rbox(W + 0.04, 1.05, 0.08, 0.02, m.brown, 0, 0.53, -D / 2 + 0.04);
  b.rbox(W - 0.14, 0.04, 0.03, 0.01, m.darkBrown, 0, 0.92, -D / 2 + 0.085);
  b.rbox(W - 0.08, 0.22, D - 0.2, 0.06, m.fabric("#f2efe9"), 0, 0.45, 0.06);
  const pillows = W > 1.2 ? 2 : 1;
  const pw = (W - 0.3) / pillows - (pillows > 1 ? 0.06 : 0);
  for (let i = 0; i < pillows; i++) {
    const x = pillows === 1 ? 0 : (i ? 1 : -1) * (pw / 2 + 0.04);
    b.rbox(pw, 0.13, 0.4, 0.06, m.fabric("#faf8f4"), x, 0.62, -D / 2 + 0.36);
  }
  b.rbox(W - 0.02, 0.06, D * 0.56, 0.025, m.fabric("#b9a68d"), 0, 0.585, D / 2 - D * 0.28 - 0.06);
  b.rbox(W - 0.02, 0.05, 0.3, 0.02, m.fabric("#8c7a63"), 0, 0.6, D / 2 - D * 0.56 - 0.02);
}

function bedside(b: MeshBuilder, m: M, W: number, D: number) {
  b.rbox(W - 0.02, 0.48, D - 0.02, 0.012, m.brown, 0, 0.32, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.035, 0.08, 0.035, m.darkBrown, sx * (W / 2 - 0.05), 0.04, sz * (D / 2 - 0.05));
  b.box(W - 0.06, 0.004, 0.004, m.darkBrown, 0, 0.42, D / 2 - 0.009);
  b.box(0.1, 0.012, 0.02, m.handle, 0, 0.48, D / 2);
  b.box(0.1, 0.012, 0.02, m.handle, 0, 0.34, D / 2);
  // Lamp
  b.cylinder(0.06, 0.07, 0.03, m.handle, -W * 0.15, 0.575, -0.03);
  b.cylinder(0.012, 0.012, 0.25, m.handle, -W * 0.15, 0.7, -0.03);
  b.cylinder(0.09, 0.13, 0.18, m.fabric("#efe6d6"), -W * 0.15, 0.87, -0.03, { segments: 28 });
}

function cupboard(b: MeshBuilder, m: M, W: number, D: number) {
  const H = 2.1;
  b.box(W - 0.04, 0.08, D - 0.06, m.darkBrown, 0, 0.04, -0.02);
  b.rbox(W, H - 0.08, D, 0.01, m.brown, 0, 0.08 + (H - 0.08) / 2, 0);
  const doors = Math.max(2, Math.round(W / 0.5));
  const dw = W / doors;
  for (let i = 1; i < doors; i++) b.box(0.004, H - 0.12, 0.004, m.darkBrown, -W / 2 + i * dw, 0.1 + (H - 0.12) / 2, D / 2);
  b.box(W - 0.02, 0.004, 0.004, m.darkBrown, 0, 1.7, D / 2);
  for (let i = 0; i < doors; i++) {
    const x = -W / 2 + (i + 0.5) * dw + (i % 2 ? -1 : 1) * (dw / 2 - 0.05);
    b.box(0.014, 0.28, 0.025, m.handle, x, 1.15, D / 2 + 0.012);
    b.box(0.014, 0.1, 0.025, m.handle, x, 1.82, D / 2 + 0.012);
  }
}

function dressingTable(b: MeshBuilder, m: M, W: number, D: number) {
  b.rbox(W, 0.035, D, 0.01, m.brown, 0, 0.76, 0);
  b.rbox(0.42, 0.72, D - 0.03, 0.01, m.brown, W / 2 - 0.22, 0.38, 0);
  for (let i = 0; i < 3; i++) {
    b.box(0.36, 0.004, 0.004, m.darkBrown, W / 2 - 0.22, 0.25 + i * 0.2, D / 2 - 0.012);
    b.box(0.09, 0.012, 0.02, m.handle, W / 2 - 0.22, 0.17 + i * 0.2, D / 2 - 0.004);
  }
  for (const sz of [-1, 1]) b.box(0.035, 0.74, 0.035, m.brown, -W / 2 + 0.04, 0.37, sz * (D / 2 - 0.04));
  b.rbox(W * 0.62, 1.0, 0.03, 0.01, m.brown, -W * 0.05, 1.32, -D / 2 + 0.02);
  b.box(W * 0.62 - 0.08, 0.92, 0.006, m.chrome, -W * 0.05, 1.32, -D / 2 + 0.037);
  // Stool
  b.cylinder(0.19, 0.19, 0.07, m.fabric("#a89580"), -W * 0.12, 0.45, D / 2 + 0.2, { segments: 28 });
  b.cylinder(0.025, 0.04, 0.42, m.handle, -W * 0.12, 0.21, D / 2 + 0.2);
}

function chair(b: MeshBuilder, m: M, x: number, z: number, faceZ: number, rotY = 0) {
  const s = Math.sin(rotY), c = Math.cos(rotY);
  const at = (lx: number, lz: number) => [x + lx * c + lz * s, z - lx * s + lz * c] as const;
  const [sx, sz] = at(0, 0);
  b.rbox(0.44, 0.05, 0.44, 0.02, m.brown, sx, 0.46, sz, { rotY });
  b.rbox(0.42, 0.04, 0.4, 0.02, m.fabric("#8b7259"), sx, 0.5, sz, { rotY });
  const [bx, bz] = at(0, -0.2 * faceZ);
  b.rbox(0.44, 0.48, 0.04, 0.015, m.brown, bx, 0.74, bz, { rotY });
  for (const lx of [-0.19, 0.19]) for (const lz of [-0.19, 0.19]) {
    const [px, pz] = at(lx, lz);
    b.box(0.035, 0.44, 0.035, m.darkBrown, px, 0.22, pz);
  }
}

function studyTable(b: MeshBuilder, m: M, W: number, D: number) {
  b.rbox(W, 0.035, D, 0.008, m.brown, 0, 0.75, 0);
  for (const sz of [-1, 1]) b.box(0.04, 0.73, 0.04, m.darkBrown, -W / 2 + 0.05, 0.365, sz * (D / 2 - 0.05));
  b.rbox(0.42, 0.6, D - 0.04, 0.01, m.brown, W / 2 - 0.23, 0.42, 0);
  for (let i = 0; i < 3; i++) b.box(0.08, 0.012, 0.02, m.handle, W / 2 - 0.23, 0.26 + i * 0.19, D / 2 - 0.008);
  b.rbox(W - 0.1, 0.02, 0.02, 0.005, m.darkBrown, 0, 0.67, -D / 2 + 0.03);
  chair(b, m, -W * 0.12, D / 2 + 0.05, 1);
  // A laptop and a lamp so the desk reads as a desk
  b.box(0.33, 0.012, 0.23, m.steel, -W * 0.12, 0.775, -0.02);
  b.box(0.33, 0.22, 0.01, m.blackGlass, -W * 0.12, 0.88, -0.13, { rotY: 0 });
  b.cylinder(0.07, 0.08, 0.02, m.handle, W / 2 - 0.2, 0.778, -D / 2 + 0.15);
  b.cylinder(0.01, 0.01, 0.38, m.handle, W / 2 - 0.2, 0.96, -D / 2 + 0.15);
  b.cylinder(0.05, 0.09, 0.1, m.handle, W / 2 - 0.2, 1.15, -D / 2 + 0.15);
}

function tvPanel(b: MeshBuilder, m: M, W: number, D: number) {
  const back = -D / 2;
  b.rbox(W * 0.86, 1.9, 0.03, 0.006, m.darkBrown, 0, 1.25, back + 0.015);
  for (let i = -3; i <= 3; i++) b.box(0.006, 1.86, 0.004, m.brown, i * (W * 0.86) / 8, 1.25, back + 0.032);
  b.rbox(W, 0.36, D - 0.04, 0.01, m.brown, 0, 0.36, 0.02);
  const doors = 4;
  for (let i = 1; i < doors; i++) b.box(0.004, 0.32, 0.004, m.darkBrown, -W / 2 + (i * W) / doors, 0.36, D / 2);
  // 55-inch TV
  b.rbox(1.24, 0.72, 0.035, 0.006, m.blackGlass, 0, 1.3, back + 0.06);
  b.box(1.2, 0.68, 0.003, m.screen, 0, 1.3, back + 0.079, { ownUv: true });
  b.box(0.5, 0.06, 0.08, m.blackGlass, 0, 0.57, 0.02);
}

function sofa(b: MeshBuilder, m: M, W: number, D: number) {
  const fabricMain = m.fabric("#7b5e48");
  const cushion = m.fabric("#8a6c55");
  b.rbox(W, 0.3, D - 0.04, 0.04, fabricMain, 0, 0.25, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cylinder(0.02, 0.015, 0.1, m.darkBrown, sx * (W / 2 - 0.1), 0.05, sz * (D / 2 - 0.1));
  b.rbox(W, 0.46, 0.22, 0.06, fabricMain, 0, 0.62, -D / 2 + 0.12);
  for (const sx of [-1, 1]) b.rbox(0.2, 0.3, D - 0.04, 0.06, fabricMain, sx * (W / 2 - 0.1), 0.5, 0);
  const seats = 3;
  const sw = (W - 0.42) / seats;
  for (let i = 0; i < seats; i++) {
    const x = -W / 2 + 0.21 + sw * (i + 0.5);
    b.rbox(sw - 0.015, 0.15, D - 0.32, 0.06, cushion, x, 0.47, 0.07);
    b.rbox(sw - 0.03, 0.42, 0.16, 0.07, cushion, x, 0.73, -D / 2 + 0.3);
  }
  b.rbox(0.42, 0.42, 0.12, 0.06, m.fabric("#d9cbb6"), -W / 2 + 0.45, 0.72, -D / 2 + 0.42, { rotY: 0.2 });
}

function diningTable(b: MeshBuilder, m: M, W: number, D: number) {
  const tw = Math.min(1.6, W - 0.8), td = Math.min(0.9, D - 0.9);
  b.rbox(tw, 0.045, td, 0.01, m.brown, 0, 0.75, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.06, 0.73, 0.06, m.darkBrown, sx * (tw / 2 - 0.1), 0.365, sz * (td / 2 - 0.1));
  for (const sx of [-0.38, 0.38]) {
    chair(b, m, sx * tw, td / 2 + 0.12, 1, Math.PI);
    chair(b, m, sx * tw, -td / 2 - 0.12, 1, 0);
  }
  chair(b, m, tw / 2 + 0.18, 0, 1, Math.PI / 2);
  chair(b, m, -tw / 2 - 0.18, 0, 1, -Math.PI / 2);
}

const MODELS: Record<FurnitureType, (b: MeshBuilder, m: M, W: number, D: number) => void> = {
  bed_single: bed,
  bed_double: bed,
  bed_queen: bed,
  bed_king: bed,
  bedside_table: bedside,
  cupboard,
  dressing_table: dressingTable,
  study_table: studyTable,
  tv_panel: tvPanel,
  sofa,
  dining_table: diningTable,
};

/** Model heights (metres) for walkthrough collisions. */
const HEIGHTS: Partial<Record<FurnitureType, number>> = { cupboard: 2.1, tv_panel: 0.6, sofa: 0.9, dining_table: 0.8 };

/** One piece of furniture as a group with its origin at the footprint's centre on the floor. */
export function furnitureModel(type: FurnitureType, m: M): THREE.Group {
  const b = new MeshBuilder();
  const { w, d } = FURNITURE[type];
  MODELS[type](b, m, w * FT, d * FT);
  return b.build();
}

export const furnitureHeight = (type: FurnitureType) => HEIGHTS[type] ?? 0.75;

// ─── Wall frames ──────────────────────────────────────────────

/**
 * A frame on a room's wall, in room-local metres: x runs along the wall from `start`, z points into the room from the
 * wall's inner face. `fromLine` converts plan feet along the wall line into that x.
 */
function wallFrame(room: Room, wall: WallKey) {
  const line = wallEdge(room, wall);
  const len = (line.to - line.from) * FT;
  // Room-local metres: where the wall line is across it, and where it starts and ends along it
  const at = (line.at - (line.axis === "x" ? room.z : room.x)) * FT;
  const from = (line.from - (line.axis === "x" ? room.x : room.z)) * FT;
  const to = from + len;
  const f = {
    n: { x: from, z: at + INNER_T, rot: 0, flip: false },
    s: { x: to, z: at - INNER_T, rot: Math.PI, flip: true },
    w: { x: at + INNER_T, z: to, rot: Math.PI / 2, flip: true },
    e: { x: at - INNER_T, z: from, rot: -Math.PI / 2, flip: false },
  }[line.dir];
  return { ...f, len, fromLine: (ft: number) => (f.flip ? len - (ft - line.from) * FT : (ft - line.from) * FT) };
}

/** Stretches of a wall (frame metres) with no door or open gap in them, clear of it by `margin`. */
function freeRuns(room: Room, wall: WallKey, floorRooms: Room[], margin: number) {
  const fr = wallFrame(room, wall);
  const blocked = wallCuts(room, wall, floorRooms)
    .filter((c) => c.kind !== "window")
    .map((c) => [fr.fromLine(c.from), fr.fromLine(c.to)].sort((a, b) => a - b) as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const runs: [number, number][] = [];
  let at = INNER_T;
  for (const [a, b] of blocked) {
    if (a - margin - at > 0.3) runs.push([at, a - margin]);
    at = Math.max(at, b + margin);
  }
  if (fr.len - INNER_T - at > 0.3) runs.push([at, fr.len - INNER_T]);
  return runs;
}

function windowRuns(room: Room, wall: WallKey, floorRooms: Room[]) {
  const fr = wallFrame(room, wall);
  return wallCuts(room, wall, floorRooms)
    .filter((c) => c.kind === "window")
    .map((c) => [fr.fromLine(c.from), fr.fromLine(c.to)].sort((a, b) => a - b) as [number, number]);
}

/** The world box of a frame-local rectangle (x0..x1 along, z0..z1 out from the wall). */
function frameCollider(b: MeshBuilder, origin: THREE.Vector3, x0: number, x1: number, z0: number, z1: number, y1: number): Collider {
  const pts = [b.toSpace(x0, 0, z0), b.toSpace(x1, 0, z1)];
  return {
    x0: Math.min(pts[0].x, pts[1].x) + origin.x,
    x1: Math.max(pts[0].x, pts[1].x) + origin.x,
    z0: Math.min(pts[0].z, pts[1].z) + origin.z,
    z1: Math.max(pts[0].z, pts[1].z) + origin.z,
    y0: origin.y,
    y1: origin.y + y1,
  };
}

// ─── Modular kitchen ──────────────────────────────────────────

const BASE_D = 0.6, BASE_H = 0.86, TOP = 0.04, WALL_D = 0.35, WALL_Y0 = 1.45, WALL_Y1 = 2.15;

type Fitted = { cupboards: MeshBuilder; appliances: MeshBuilder; colliders: Collider[] };

function baseCabinet(b: MeshBuilder, m: M, x0: number, x1: number, drawers: boolean) {
  const w = x1 - x0, cx = (x0 + x1) / 2;
  b.box(w, 0.1, BASE_D - 0.08, m.darkBrown, cx, 0.05, (BASE_D - 0.08) / 2);
  b.box(w - 0.004, BASE_H - 0.1, BASE_D - 0.02, m.brown, cx, 0.1 + (BASE_H - 0.1) / 2, (BASE_D - 0.02) / 2);
  if (drawers) {
    for (const y of [0.42, 0.66]) b.box(w - 0.02, 0.004, 0.004, m.darkBrown, cx, y, BASE_D - 0.018);
    for (const y of [0.32, 0.56, 0.78]) b.box(Math.min(0.3, w * 0.5), 0.014, 0.022, m.handle, cx, y, BASE_D - 0.005);
  } else {
    b.box(0.004, BASE_H - 0.14, 0.004, m.darkBrown, cx, 0.1 + (BASE_H - 0.1) / 2, BASE_D - 0.018);
    for (const s of [-1, 1]) b.box(0.014, 0.16, 0.022, m.handle, cx + s * 0.05, 0.7, BASE_D - 0.005);
  }
}

function wallCabinet(b: MeshBuilder, m: M, x0: number, x1: number) {
  const w = x1 - x0, cx = (x0 + x1) / 2, h = WALL_Y1 - WALL_Y0;
  b.box(w - 0.004, h, WALL_D, m.brown, cx, WALL_Y0 + h / 2, WALL_D / 2);
  const doors = Math.max(1, Math.round(w / 0.45));
  for (let i = 1; i < doors; i++) b.box(0.004, h - 0.02, 0.004, m.darkBrown, x0 + (i * w) / doors, WALL_Y0 + h / 2, WALL_D + 0.002);
  for (let i = 0; i < doors; i++) b.box(0.12, 0.014, 0.022, m.handle, x0 + ((i + 0.5) * w) / doors, WALL_Y0 + 0.06, WALL_D + 0.01);
}

/** Fridge, pantry and an oven + microwave tower, standing at x0 going along +x. Returns where they end. */
function tallUnits(f: Fitted, m: M, x0: number) {
  const a = f.appliances, c = f.cupboards;
  // Fridge (double door)
  const fw = 0.72;
  a.rbox(fw, 1.8, 0.66, 0.02, m.steel, x0 + fw / 2, 0.9, 0.34);
  a.box(0.004, 1.12, 0.004, m.blackGlass, x0 + fw / 2, 1.2, 0.672);
  a.box(fw - 0.02, 0.004, 0.004, m.blackGlass, x0 + fw / 2, 0.62, 0.672);
  for (const s of [-1, 1]) a.box(0.016, 0.42, 0.03, m.chrome, x0 + fw / 2 + s * 0.04, 1.25, 0.685);
  a.box(0.3, 0.016, 0.03, m.chrome, x0 + fw / 2, 0.5, 0.685);
  c.box(fw + 0.02, 0.36, BASE_D, m.brown, x0 + fw / 2, 1.98, BASE_D / 2);
  let x = x0 + fw + 0.02;
  // Pantry
  const pw = 0.6;
  c.box(pw, 2.16, BASE_D, m.brown, x + pw / 2, 1.08, BASE_D / 2);
  c.box(0.004, 2.1, 0.004, m.darkBrown, x + pw / 2, 1.08, BASE_D + 0.002);
  for (const s of [-1, 1]) c.box(0.014, 0.4, 0.022, m.handle, x + pw / 2 + s * 0.04, 1.1, BASE_D + 0.01);
  x += pw;
  // Oven + microwave tower
  const tw = 0.62;
  c.box(tw, 2.16, BASE_D, m.brown, x + tw / 2, 1.08, BASE_D / 2);
  a.box(0.56, 0.58, 0.02, m.blackGlass, x + tw / 2, 0.98, BASE_D + 0.01);
  a.box(0.4, 0.014, 0.03, m.chrome, x + tw / 2, 1.22, BASE_D + 0.025);
  a.box(0.56, 0.38, 0.02, m.blackGlass, x + tw / 2, 1.55, BASE_D + 0.01);
  a.box(0.12, 0.3, 0.021, m.steel, x + tw / 2 + 0.2, 1.55, BASE_D + 0.012);
  for (const y of [0.35, 2.0]) c.box(tw - 0.02, 0.004, 0.004, m.darkBrown, x + tw / 2, y, BASE_D + 0.002);
  return x + tw;
}

/** Counter, backsplash and the cabinets above along one stretch; sink and hob go where asked. */
function counterRun(f: Fitted, m: M, x0: number, x1: number, windows: [number, number][], sinkAt: number | null, hobAt: number | null) {
  const c = f.cupboards, a = f.appliances;
  // Base cabinets in ~0.6 m modules
  const n = Math.max(1, Math.round((x1 - x0) / 0.6));
  for (let i = 0; i < n; i++) baseCabinet(c, m, x0 + ((x1 - x0) * i) / n, x0 + ((x1 - x0) * (i + 1)) / n, i % 2 === 1);
  c.box(x1 - x0 + 0.02, TOP, BASE_D + 0.03, m.counter, (x0 + x1) / 2, BASE_H + TOP / 2, (BASE_D + 0.03) / 2);
  c.box(x1 - x0, 0.6, 0.012, m.backsplash, (x0 + x1) / 2, BASE_H + TOP + 0.3, 0.006);
  if (sinkAt !== null) {
    a.box(0.62, 0.012, 0.44, m.steel, sinkAt, BASE_H + TOP + 0.002, 0.32);
    a.box(0.5, 0.012, 0.34, m.blackGlass, sinkAt, BASE_H + TOP + 0.006, 0.32);
    a.cylinder(0.015, 0.02, 0.32, m.chrome, sinkAt, BASE_H + TOP + 0.16, 0.06);
    a.box(0.025, 0.025, 0.22, m.chrome, sinkAt, BASE_H + TOP + 0.31, 0.16);
  }
  if (hobAt !== null) {
    a.box(0.76, 0.012, 0.5, m.blackGlass, hobAt, BASE_H + TOP + 0.006, 0.3);
    for (const [dx, dz, r] of [[-0.2, 0.17, 0.085], [0.2, 0.17, 0.075], [0, 0.4, 0.06]] as const) {
      a.cylinder(r, r, 0.02, m.rail, hobAt + dx, BASE_H + TOP + 0.02, 0.3 - 0.17 + dz, { segments: 24 });
    }
    // Chimney hood
    a.box(0.9, 0.08, 0.5, m.steel, hobAt, 1.68, 0.25);
    a.box(0.88, 0.02, 0.48, m.blackGlass, hobAt, 1.635, 0.25);
    a.box(0.28, 0.6, 0.25, m.steel, hobAt, 2.0, 0.13);
  }
  // Wall cabinets, leaving windows and the chimney clear
  const gaps = [...windows.map(([a0, a1]) => [a0 - 0.1, a1 + 0.1] as [number, number]), ...(hobAt !== null ? [[hobAt - 0.5, hobAt + 0.5] as [number, number]] : [])].sort((p, q) => p[0] - q[0]);
  let at = x0;
  for (const [g0, g1] of gaps) {
    if (g0 - at > 0.3) wallCabinet(c, m, at, Math.min(g0, x1));
    at = Math.max(at, g1);
  }
  if (x1 - at > 0.3) wallCabinet(c, m, at, x1);
}

/**
 * Fills a kitchen with a basic modular kitchen: an L of base cabinets with a granite counter and tiled backsplash,
 * sink (under a window when there is one) and hob with a chimney, wall cabinets, and a fridge, pantry and
 * oven/microwave tower. Fits itself around doors. Returns null if no wall has room for it.
 */
export function buildKitchen(room: Room, floorRooms: Room[], m: M, origin: THREE.Vector3): Fitted | null {
  const walls = roomWalls(room);
  const runs = walls.flatMap(({ key: wall }) => freeRuns(room, wall, floorRooms, 0.15).map(([a, b]) => ({ wall, a, b, len: b - a })));
  const main = runs.sort((p, q) => q.len - p.len)[0];
  if (!main || main.len < 1.2) return null;
  const f: Fitted = { cupboards: new MeshBuilder(origin), appliances: new MeshBuilder(origin), colliders: [] };

  // The second leg of the L: a neighbouring wall whose free stretch starts in the corner next to `main`.
  const fr = wallFrame(room, main.wall);
  // Walls run clockwise, each frame starting where the previous one ends; the L only turns at an outward corner.
  const i = walls.findIndex((e) => e.key === main.wall);
  const next = walls[(i + 1) % walls.length].key;
  const prev = walls[(i + walls.length - 1) % walls.length].key;
  const mainEdge = walls[i];
  const frameEnd = fr.flip ? "from" : "to";
  const frameStart = fr.flip ? "to" : "from";
  const endsInCorner = main.b > fr.len - INNER_T - 0.05 && cornerConvex(room, mainEdge, frameEnd);
  const startsInCorner = main.a < INNER_T + 0.05 && cornerConvex(room, mainEdge, frameStart);
  const legWall = endsInCorner ? next : startsInCorner ? prev : null;
  const leg = legWall
    ? runs.filter((r) => r.wall === legWall && (legWall === next ? r.a < INNER_T + 0.05 : r.b > wallFrame(room, legWall).len - INNER_T - 0.05)).sort((p, q) => q.len - p.len)[0]
    : undefined;

  // Main run: tall units at the end away from the L's corner, counter for the rest.
  const windowsMain = windowRuns(room, main.wall, floorRooms);
  f.cupboards.setFrame(fr.x, 0, fr.z, fr.rot);
  f.appliances.setFrame(fr.x, 0, fr.z, fr.rot);
  const tallWidth = 0.74 + 0.6 + 0.62;
  const tallAtStart = endsInCorner || !startsInCorner;
  const [t0, t1] = tallAtStart ? [main.a, main.a + tallWidth] : [main.b - tallWidth, main.b];
  const tallFits = main.len >= tallWidth + 1.2 && !windowsMain.some(([w0, w1]) => w0 < t1 && w1 > t0);
  let cx0 = main.a, cx1 = main.b;
  if (tallFits) {
    tallUnits(f, m, t0);
    if (tallAtStart) cx0 = t1;
    else cx1 = t0;
    f.colliders.push(frameCollider(f.cupboards, origin, t0, t1, 0, BASE_D + 0.1, 2.2));
  }
  const win = windowsMain.find(([w0, w1]) => (w0 + w1) / 2 > cx0 + 0.4 && (w0 + w1) / 2 < cx1 - 0.4);
  const sinkAt = win ? (win[0] + win[1]) / 2 : cx0 + Math.min(0.6, (cx1 - cx0) / 2);
  const hobSpot = sinkAt > (cx0 + cx1) / 2 ? cx0 + 0.5 : cx1 - 0.5;
  const hobAt = Math.abs(hobSpot - sinkAt) > 0.9 && cx1 - cx0 > 1.6 ? hobSpot : null;
  counterRun(f, m, cx0, cx1, windowsMain, sinkAt, hobAt);
  f.colliders.push(frameCollider(f.cupboards, origin, cx0, cx1, 0, BASE_D + 0.1, BASE_H + TOP));

  // The L's second leg: counter and wall cabinets (and the hob, if the main run had no room for it).
  if (leg && leg.len > BASE_D + 0.5) {
    const lf = wallFrame(room, leg.wall);
    f.cupboards.setFrame(lf.x, 0, lf.z, lf.rot);
    f.appliances.setFrame(lf.x, 0, lf.z, lf.rot);
    const atCorner = legWall === next;
    const l0 = atCorner ? leg.a + BASE_D : leg.a;
    const l1 = atCorner ? leg.b : leg.b - BASE_D;
    if (l1 - l0 > 0.3) {
      const legHob = hobAt === null && l1 - l0 > 0.9 ? (l0 + l1) / 2 : null;
      counterRun(f, m, l0, l1, windowRuns(room, leg.wall, floorRooms), null, legHob);
      f.colliders.push(frameCollider(f.cupboards, origin, l0, l1, 0, BASE_D + 0.1, BASE_H + TOP));
    }
  }
  f.cupboards.resetFrame();
  f.appliances.resetFrame();
  return f;
}

// ─── Bathroom ─────────────────────────────────────────────────

/** A WC and a vanity basin with a mirror, along the wall with the fewest doors. */
export function buildBathroom(room: Room, floorRooms: Room[], m: M, origin: THREE.Vector3): Fitted | null {
  if (!isBathroom(room.name)) return null;
  const runs = roomWalls(room).flatMap(({ key: wall }) => freeRuns(room, wall, floorRooms, 0.1).map(([a, b]) => ({ wall, a, b, len: b - a })));
  const run = runs.sort((p, q) => q.len - p.len)[0];
  if (!run || run.len < 0.8) return null;
  const f: Fitted = { cupboards: new MeshBuilder(origin), appliances: new MeshBuilder(origin), colliders: [] };
  const fr = wallFrame(room, run.wall);
  const a = f.appliances;
  a.setFrame(fr.x, 0, fr.z, fr.rot);
  // WC near one end
  const wc = run.a + 0.3;
  a.rbox(0.38, 0.36, 0.18, 0.03, m.porcelain, wc, 0.62, 0.1);
  a.rbox(0.36, 0.38, 0.52, 0.08, m.porcelain, wc, 0.2, 0.3);
  a.rbox(0.38, 0.03, 0.48, 0.03, m.porcelain, wc, 0.405, 0.32);
  a.box(0.06, 0.015, 0.02, m.chrome, wc + 0.1, 0.8, 0.2);
  f.colliders.push(frameCollider(a, origin, wc - 0.2, wc + 0.2, 0, 0.6, 0.6));
  // Vanity with basin and mirror near the other end
  if (run.len > 1.4) {
    const vb = Math.min(run.b - 0.35, run.a + 1.2);
    f.cupboards.setFrame(fr.x, 0, fr.z, fr.rot);
    f.cupboards.rbox(0.6, 0.5, 0.45, 0.01, m.brown, vb, 0.55, 0.23);
    f.cupboards.box(0.004, 0.46, 0.004, m.darkBrown, vb, 0.55, 0.455);
    f.cupboards.resetFrame();
    a.rbox(0.62, 0.06, 0.47, 0.02, m.porcelain, vb, 0.83, 0.24);
    a.cylinder(0.17, 0.12, 0.05, m.porcelain, vb, 0.85, 0.26, { segments: 28 });
    a.cylinder(0.014, 0.014, 0.18, m.chrome, vb, 0.95, 0.06);
    a.box(0.02, 0.02, 0.12, m.chrome, vb, 1.03, 0.11);
    a.box(0.6, 0.8, 0.012, m.chrome, vb, 1.55, 0.008);
    f.colliders.push(frameCollider(a, origin, vb - 0.32, vb + 0.32, 0, 0.5, 0.9));
  }
  // Shower head on the far end
  a.cylinder(0.01, 0.01, 0.35, m.chrome, run.b - 0.3, 2.0, 0.03);
  a.cylinder(0.08, 0.06, 0.03, m.chrome, run.b - 0.3, 1.82, 0.2);
  a.resetFrame();
  return f;
}
