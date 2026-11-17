// Geometry helpers for the house scene: boxes with UVs in world metres (so textures keep their real size and line up
// across pieces), collected per material and merged, so a room is a handful of draw calls instead of hundreds.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

export type PieceOptions = {
  /** Turn about the vertical axis, radians. */
  rotY?: number;
  cast?: boolean;
  receive?: boolean;
  /** Keep the geometry's own UVs instead of world-planar ones (e.g. glass, screens). */
  ownUv?: boolean;
};

/**
 * Sets each vertex's UV from its world position, projected along its face's main axis:
 * walls facing ±x use (z, y), floors and tops (x, z), walls facing ±z (x, y). One UV unit is one metre.
 */
export function planarUv(geometry: THREE.BufferGeometry, offset: THREE.Vector3) {
  const pos = geometry.getAttribute("position");
  const nor = geometry.getAttribute("normal");
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + offset.x, y = pos.getY(i) + offset.y, z = pos.getZ(i) + offset.z;
    const ax = Math.abs(nor.getX(i)), ay = Math.abs(nor.getY(i)), az = Math.abs(nor.getZ(i));
    if (ay >= ax && ay >= az) {
      uv[i * 2] = x;
      uv[i * 2 + 1] = z;
    } else if (ax >= az) {
      uv[i * 2] = z;
      uv[i * 2 + 1] = y;
    } else {
      uv[i * 2] = x;
      uv[i * 2 + 1] = y;
    }
  }
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
}

type Bucket = { material: THREE.Material; cast: boolean; receive: boolean; geometries: THREE.BufferGeometry[] };

const tmpMatrix = new THREE.Matrix4();
const tmpQuat = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Collects pieces in one local space (e.g. a room's), then merges them into one mesh per material.
 * `origin` is where that local space sits in the world, so planar UVs continue from room to room.
 */
export class MeshBuilder {
  private buckets = new Map<string, Bucket>();
  private frame = new THREE.Matrix4();

  constructor(private origin = new THREE.Vector3()) {}

  /** Places everything added after this call in a frame at x, y, z turned by rotY (e.g. along a wall). */
  setFrame(x: number, y: number, z: number, rotY = 0) {
    this.frame.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(UP, rotY), new THREE.Vector3(1, 1, 1));
    return this;
  }

  resetFrame() {
    this.frame.identity();
    return this;
  }

  /** A point in the current frame, in the builder's space. */
  toSpace(x: number, y: number, z: number) {
    return new THREE.Vector3(x, y, z).applyMatrix4(this.frame);
  }

  /** Adds any geometry (consumed: don't reuse it) placed at x, y, z (its own origin). */
  add(geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, opts: PieceOptions = {}) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    if (g !== geometry) geometry.dispose();
    tmpQuat.setFromAxisAngle(UP, opts.rotY ?? 0);
    tmpMatrix.compose(new THREE.Vector3(x, y, z), tmpQuat, new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(tmpMatrix.premultiply(this.frame));
    if (!opts.ownUv) planarUv(g, this.origin);
    // Merging needs identical attribute sets.
    for (const name of Object.keys(g.attributes)) if (name !== "position" && name !== "normal" && name !== "uv") g.deleteAttribute(name);
    if (!g.getAttribute("uv")) planarUv(g, this.origin);
    g.clearGroups();
    const cast = opts.cast ?? true;
    const receive = opts.receive ?? true;
    const key = `${material.uuid}|${cast}|${receive}`;
    let bucket = this.buckets.get(key);
    if (!bucket) this.buckets.set(key, (bucket = { material, cast, receive, geometries: [] }));
    bucket.geometries.push(g);
  }

  /** A box whose centre is at x, y, z. */
  box(w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z: number, opts?: PieceOptions) {
    if (w <= 0.0005 || h <= 0.0005 || d <= 0.0005) return;
    this.add(new THREE.BoxGeometry(w, h, d), material, x, y, z, opts);
  }

  /** A box with rounded edges (furniture, cushions). */
  rbox(w: number, h: number, d: number, radius: number, material: THREE.Material, x: number, y: number, z: number, opts?: PieceOptions) {
    if (w <= 0.0005 || h <= 0.0005 || d <= 0.0005) return;
    const r = Math.min(radius, w / 2, h / 2, d / 2) * 0.999;
    this.add(new RoundedBoxGeometry(w, h, d, 3, r), material, x, y, z, opts);
  }

  /** A vertical cylinder whose centre is at x, y, z. */
  cylinder(rTop: number, rBottom: number, h: number, material: THREE.Material, x: number, y: number, z: number, opts?: PieceOptions & { segments?: number }) {
    this.add(new THREE.CylinderGeometry(rTop, rBottom, h, opts?.segments ?? 20), material, x, y, z, opts);
  }

  get empty() {
    return this.buckets.size === 0;
  }

  /** The merged meshes, in a new group. The builder is empty afterwards. */
  build(userData: Record<string, unknown> = {}): THREE.Group {
    const group = new THREE.Group();
    for (const b of this.buckets.values()) {
      const merged = b.geometries.length === 1 ? b.geometries[0] : mergeGeometries(b.geometries, false);
      if (b.geometries.length > 1) b.geometries.forEach((g) => g.dispose());
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, b.material);
      mesh.castShadow = b.cast;
      mesh.receiveShadow = b.receive;
      mesh.userData = { ...userData, ...(b.material.userData.noAO && { noAO: true }) };
      group.add(mesh);
    }
    this.buckets.clear();
    return group;
  }
}

/** Frees the geometry of everything in a group (materials and textures are shared and freed by their library). */
export function disposeGeometry(root: THREE.Object3D) {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh || (obj as THREE.Line).isLine) mesh.geometry.dispose();
    if ((obj as THREE.InstancedMesh).isInstancedMesh) (obj as THREE.InstancedMesh).dispose();
  });
}
