// Everything around the house: a physical sky (also used to light the scene), the sun and its shadows, a lawn running
// to the horizon, and the plot itself: compound wall with a gate, driveway, footpath around the house, road, trees and
// hedges. Rebuilt when the house's footprint changes.

import * as THREE from "three";
import { Sky } from "three/addons/objects/Sky.js";
import { MeshBuilder, disposeGeometry } from "./build";
import type { MaterialLibrary } from "./materials";

/** Direction the sunlight comes from: high in the south-west, as in an Indian early afternoon. North is −z. */
export const SUN_DIR = new THREE.Vector3(-0.38, 0.84, 0.42).normalize();
const FOG = new THREE.Color("#d5dde3");

export type Footprint = { x0: number; x1: number; z0: number; z1: number; top: number };

/** A tiny seeded random generator, so the garden looks the same every time. */
function rng(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}

function leafTexture() {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const rand = rng(11);
  const greens = ["#3f5f2a", "#4e7232", "#5e8239", "#36521f", "#6b8f41"];
  for (let i = 0; i < 90; i++) {
    const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * size * 0.42;
    const x = size / 2 + Math.cos(a) * r, y = size / 2 + Math.sin(a) * r;
    const len = 14 + rand() * 16;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rand() * Math.PI * 2);
    ctx.fillStyle = greens[Math.floor(rand() * greens.length)];
    ctx.beginPath();
    ctx.ellipse(0, 0, len * 0.38, len, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class World {
  readonly sun = new THREE.DirectionalLight("#fff0d8", 3.8);
  readonly group = new THREE.Group();
  private plot = new THREE.Group();
  private ground: THREE.Mesh;
  private leafMat: THREE.MeshStandardMaterial;
  private envTarget: THREE.WebGLRenderTarget;
  private skyTarget: THREE.WebGLCubeRenderTarget;

  constructor(renderer: THREE.WebGLRenderer, private scene: THREE.Scene, private mats: MaterialLibrary) {
    // Sky → background (sharp cube map) and environment lighting (prefiltered)
    const sky = new Sky();
    sky.scale.setScalar(900);
    const u = sky.material.uniforms;
    u.turbidity.value = 3.2;
    u.rayleigh.value = 1.1;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.82;
    u.cloudCoverage.value = 0.32;
    u.cloudDensity.value = 0.5;
    u.sunPosition.value.copy(SUN_DIR).multiplyScalar(450);
    const skyScene = new THREE.Scene();
    skyScene.add(sky);
    this.skyTarget = new THREE.WebGLCubeRenderTarget(1024, { type: THREE.HalfFloatType });
    new THREE.CubeCamera(1, 2000, this.skyTarget).update(renderer, skyScene);
    scene.background = this.skyTarget.texture;

    // Lighting from the sky: a soft, neutral gradient (pale sky above, warm ground bounce below) rather than the
    // saturated sky itself, which would tint every shadow blue.
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(100, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        uniforms: { top: { value: new THREE.Color("#b8c6d4") }, horizon: { value: new THREE.Color("#ebe6dc") }, ground: { value: new THREE.Color("#8a8070") } },
        vertexShader: "varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
        fragmentShader:
          "uniform vec3 top; uniform vec3 horizon; uniform vec3 ground; varying vec3 vDir;" +
          "void main() { float y = vDir.y; vec3 c = y > 0.0 ? mix(horizon, top, pow(y, 0.6)) : mix(horizon, ground, pow(-y, 0.4)); gl_FragColor = vec4(c, 1.0); }",
      })
    );
    const envScene = new THREE.Scene();
    envScene.add(dome);
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.envTarget = pmrem.fromScene(envScene, 0.04, 0.5, 500);
    scene.environment = this.envTarget.texture;
    pmrem.dispose();
    for (const m of [sky, dome]) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }

    scene.fog = new THREE.Fog(FOG, 70, 520);

    // Sun
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.025;
    this.sun.shadow.radius = 2.5;
    scene.add(this.sun, this.sun.target);

    // Lawn to the horizon
    const gb = new MeshBuilder();
    gb.add(new THREE.PlaneGeometry(1200, 1200).rotateX(-Math.PI / 2), mats.grass, 0, 0, 0, { cast: false });
    this.ground = gb.build().children[0] as THREE.Mesh;
    this.group.add(this.ground);

    this.leafMat = new THREE.MeshStandardMaterial({ map: leafTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8 });
    this.group.add(this.plot);
    scene.add(this.group);
  }

  /** Lays out the plot around the house's footprint (world metres) and aims the sun's shadows at it. */
  setFootprint(fp: Footprint | null) {
    disposeGeometry(this.plot);
    this.plot.clear();
    const f = fp ?? { x0: -5, x1: 5, z0: -5, z1: 5, top: 3 };
    const m = this.mats;
    const side = 3.5, back = 3.5, front = 7;
    const px0 = f.x0 - side, px1 = f.x1 + side, pz0 = f.z0 - back, pz1 = f.z1 + front;
    const cx = (f.x0 + f.x1) / 2;
    const b = new MeshBuilder();

    if (fp) {
      // Footpath round the house and a driveway from the gate
      const apron = 0.9;
      b.box(f.x1 - f.x0 + apron * 2, 0.04, f.z1 - f.z0 + apron * 2, m.paving, cx, 0.02, (f.z0 + f.z1) / 2, { cast: false });
      b.box(3.2, 0.04, pz1 - f.z1, m.paving, cx, 0.021, (f.z1 + pz1) / 2, { cast: false });

      // Compound wall with a gate in the front
      const wh = 1.5, wt = 0.23;
      const wall = (x0: number, x1: number, z0: number, z1: number) => {
        b.box(x1 - x0, wh, z1 - z0, m.exterior, (x0 + x1) / 2, wh / 2, (z0 + z1) / 2);
        b.box(x1 - x0 + 0.06, 0.06, z1 - z0 + 0.06, m.concrete, (x0 + x1) / 2, wh + 0.03, (z0 + z1) / 2);
      };
      wall(px0, px1, pz0 - wt, pz0);
      wall(px0 - wt, px0, pz0 - wt, pz1 + wt);
      wall(px1, px1 + wt, pz0 - wt, pz1 + wt);
      const gate = 3.6;
      wall(px0, cx - gate / 2, pz1, pz1 + wt);
      wall(cx + gate / 2, px1, pz1, pz1 + wt);
      for (const gx of [cx - gate / 2 - 0.2, cx + gate / 2 + 0.2]) b.box(0.4, 1.8, 0.4, m.exteriorAccent, gx, 0.9, pz1 + wt / 2);
      // Sliding gate: vertical bars in a frame
      for (let i = 0; i <= 18; i++) b.box(0.025, 1.3, 0.025, m.rail, cx - gate / 2 + (i * gate) / 18, 0.75, pz1 + wt / 2);
      for (const gy of [0.12, 1.38]) b.box(gate, 0.05, 0.05, m.rail, cx, gy, pz1 + wt / 2);

      // Road and kerb in front
      const roadZ = pz1 + wt + 2.2;
      b.box(400, 0.12, 2, m.paving, 0, 0.06, pz1 + wt + 1, { cast: false });
      b.box(400, 0.02, 8, m.asphalt, 0, 0.01, roadZ + 4, { cast: false });
      for (let x = -200; x < 200; x += 6) b.box(3, 0.005, 0.15, m.skirting, x, 0.022, roadZ + 4, { cast: false });
    }
    const built = b.build();
    this.plot.add(built);

    // Trees and hedges from leaf cards (one draw call for all of them)
    const rand = rng(7);
    const cards: THREE.Matrix4[] = [];
    const colours: THREE.Color[] = [];
    const tb = new MeshBuilder();
    const tree = (x: number, z: number, scale: number) => {
      const h = 3.2 * scale;
      tb.cylinder(0.09 * scale, 0.16 * scale, h, m.bark, x, h / 2, z, { segments: 10 });
      const cy = h + 1.3 * scale;
      for (let i = 0; i < 260; i++) {
        const v = new THREE.Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1);
        if (v.lengthSq() > 1) continue;
        const pos = new THREE.Vector3(x + v.x * 2.1 * scale, cy + v.y * 1.5 * scale, z + v.z * 2.1 * scale);
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI));
        cards.push(new THREE.Matrix4().compose(pos, q, new THREE.Vector3().setScalar((0.9 + rand() * 0.6) * scale)));
        colours.push(new THREE.Color().setHSL(0.24 + rand() * 0.05, 0.45, 0.32 + v.y * 0.08 + rand() * 0.08));
      }
    };
    const hedge = (x0: number, x1: number, z0: number, z1: number) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      for (let t = 0; t < len; t += 0.18) {
        const k = t / len;
        const pos = new THREE.Vector3(x0 + (x1 - x0) * k + (rand() - 0.5) * 0.4, 0.35 + rand() * 0.6, z0 + (z1 - z0) * k + (rand() - 0.5) * 0.4);
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI));
        cards.push(new THREE.Matrix4().compose(pos, q, new THREE.Vector3().setScalar(0.7 + rand() * 0.3)));
        colours.push(new THREE.Color().setHSL(0.25 + rand() * 0.04, 0.45, 0.3 + rand() * 0.1));
      }
    };
    if (fp) {
      tree(px0 + 1.4, pz0 + 1.4, 1.1);
      tree(px1 - 1.4, pz1 - 1.8, 0.9);
      tree(px0 + 1.4, pz1 - 2.2, 0.8);
      tree(px1 - 1.2, pz0 + 1.3, 1);
      for (let x = -60; x <= 60; x += 14 + rand() * 6) tree(cx + x, pz1 + 15 + rand() * 3, 0.9 + rand() * 0.5);
      hedge(px0 + 0.4, cx - 2.3, pz1 - 0.4, pz1 - 0.4);
      hedge(cx + 2.3, px1 - 0.4, pz1 - 0.4, pz1 - 0.4);
      hedge(px0 + 0.4, px0 + 0.4, pz0 + 2.8, pz1 - 3);
      hedge(px1 - 0.4, px1 - 0.4, pz0 + 2.6, pz1 - 2.6);
    }
    if (!tb.empty) this.plot.add(tb.build());
    if (cards.length) {
      const leaves = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.9, 0.9), this.leafMat, cards.length);
      cards.forEach((mtx, i) => {
        leaves.setMatrixAt(i, mtx);
        leaves.setColorAt(i, colours[i]);
      });
      leaves.castShadow = true;
      leaves.receiveShadow = true;
      leaves.userData.noAO = true;
      leaves.computeBoundingSphere();
      this.plot.add(leaves);
    }

    // Shadows cover the plot
    const centre = new THREE.Vector3((px0 + px1) / 2, 0, (pz0 + pz1) / 2);
    const radius = Math.hypot(px1 - px0, pz1 - pz0) / 2 + 2;
    this.sun.target.position.copy(centre);
    this.sun.position.copy(centre).addScaledVector(SUN_DIR, 80);
    Object.assign(this.sun.shadow.camera, { left: -radius, right: radius, top: radius, bottom: -radius, near: 40, far: 80 + radius + f.top + 20 });
    this.sun.shadow.camera.updateProjectionMatrix();
  }

  dispose() {
    disposeGeometry(this.group);
    this.leafMat.map?.dispose();
    this.leafMat.dispose();
    this.envTarget.dispose();
    this.skyTarget.dispose();
    this.scene.remove(this.group, this.sun, this.sun.target);
  }
}
