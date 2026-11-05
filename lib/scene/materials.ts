// Every material the house scene uses, made once and shared. Finishes come from a room's design; the rest are fixed.

import * as THREE from "three";
import { WALLPAPERS, type Polish, type RoomDesign } from "@/lib/rooms";
import { TextureLibrary, type SurfaceKind } from "./textures";

/** Roughness and clear coat for each wood polish. */
const POLISH: Record<Polish, { roughness: number; clearcoat: number }> = {
  matte: { roughness: 0.75, clearcoat: 0 },
  satin: { roughness: 0.5, clearcoat: 0.35 },
  gloss: { roughness: 0.3, clearcoat: 1 },
};

/** The basic brown of furniture and cupboards (not customisable yet). */
export const FURNITURE_BROWN = "#6e4a30";

export class MaterialLibrary {
  readonly textures = new TextureLibrary();
  private cache = new Map<string, THREE.Material>();

  private get<T extends THREE.Material>(key: string, make: () => T): T {
    let m = this.cache.get(key) as T | undefined;
    if (!m) this.cache.set(key, (m = make()));
    return m;
  }

  private surface(kind: SurfaceKind, hex: string | null, params: THREE.MeshStandardMaterialParameters = {}) {
    return this.get(`surface:${kind}:${hex}:${JSON.stringify(params)}`, () => {
      const set = this.textures.get(kind, hex);
      return new THREE.MeshStandardMaterial({ ...set, ...(hex === null && { color: "#ffffff" }), ...params });
    });
  }

  floor(f: RoomDesign["flooring"]) {
    const kind: SurfaceKind = f.material === "wood" ? "wood" : f.material === "marble" ? "marble" : f.material === "granite" ? "granite" : "tiles";
    return this.surface(kind, f.color);
  }

  /** The inner face of a room's walls. */
  wall(w: RoomDesign["walls"]) {
    switch (w.finish) {
      case "marble":
        return this.surface("marble", w.color);
      case "tiles":
        return this.surface("wallTile", w.color);
      case "wood_panel":
        return this.wood(w.color, "satin");
      case "wallpaper": {
        const paper = WALLPAPERS.find((p) => p.name === w.name) ?? WALLPAPERS[0];
        return this.get(`wallpaper:${paper.pattern}:${w.color}`, () => new THREE.MeshStandardMaterial({ ...this.textures.wallpaper(paper.pattern, w.color), roughness: 0.75 }));
      }
      default:
        return this.get(`paint:${w.color}`, () => {
          const set = this.textures.get("plaster", null);
          return new THREE.MeshStandardMaterial({ color: w.color, normalMap: set.normalMap, normalScale: new THREE.Vector2(0.35, 0.35), roughness: 0.82 });
        });
    }
  }

  /** Wood with a polish (doors, window frames, wood panelling). `hex` is the wood's colour. */
  wood(hex: string, polish: Polish) {
    return this.get(`wood:${hex}:${polish}`, () => {
      const set = this.textures.get("veneer", hex);
      const p = POLISH[polish];
      return new THREE.MeshPhysicalMaterial({ map: set.map, normalMap: set.normalMap, roughness: p.roughness, clearcoat: p.clearcoat, clearcoatRoughness: 0.25 });
    });
  }

  /** Powder-coated aluminium. */
  aluminium(hex: string) {
    return this.get(`alu:${hex}`, () => {
      const metallic = hex.toLowerCase() === "#c3c6ca" || hex.toLowerCase() === "#b9a47e";
      return new THREE.MeshStandardMaterial({ color: hex, metalness: metallic ? 0.85 : 0.2, roughness: metallic ? 0.32 : 0.45 });
    });
  }

  get plaster() {
    return this.get("plaster", () => {
      const set = this.textures.get("plaster", null);
      return new THREE.MeshStandardMaterial({ color: "#f3f0ea", normalMap: set.normalMap, normalScale: new THREE.Vector2(0.3, 0.3), roughness: 0.9 });
    });
  }
  get ceiling() {
    return this.get("ceiling", () => new THREE.MeshStandardMaterial({ color: "#f7f5f1", roughness: 0.95 }));
  }
  /** The top of a cut wall seen from above: a flat section colour, like an architect's model. */
  get wallCap() {
    return this.get("cap", () => new THREE.MeshStandardMaterial({ color: "#d9d4cb", roughness: 0.95 }));
  }
  get exterior() {
    return this.surface("exterior", "#e9e2d4");
  }
  get exteriorAccent() {
    return this.surface("exterior", "#b9a58a");
  }
  get plinth() {
    return this.surface("stone", "#8e8579");
  }
  get roof() {
    return this.surface("paving", "#b9b2a6");
  }
  get skirting() {
    return this.get("skirting", () => new THREE.MeshStandardMaterial({ color: "#efebe4", roughness: 0.45 }));
  }
  get threshold() {
    return this.surface("marble", "#ece9e4");
  }
  get sill() {
    return this.surface("granite", "#2c2b2d");
  }
  get concrete() {
    return this.surface("exterior", "#c8c3ba");
  }
  get glass() {
    return this.get("glass", () => {
      const m = new THREE.MeshStandardMaterial({ color: "#c9dde4", roughness: 0.03, metalness: 0.1, transparent: true, opacity: 0.22, envMapIntensity: 1.6, depthWrite: false });
      m.userData.noAO = true;
      return m;
    });
  }
  get frostedGlass() {
    return this.get("frosted", () => {
      const m = new THREE.MeshStandardMaterial({ color: "#e8eef0", roughness: 0.35, transparent: true, opacity: 0.6, depthWrite: false });
      m.userData.noAO = true;
      return m;
    });
  }
  get insectMesh() {
    return this.get("mesh", () => {
      const m = new THREE.MeshStandardMaterial({ color: "#3a3c3e", roughness: 0.8, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
      m.userData.noAO = true;
      return m;
    });
  }
  get chrome() {
    return this.get("chrome", () => new THREE.MeshStandardMaterial({ color: "#d8d8d8", metalness: 1, roughness: 0.18 }));
  }
  get steel() {
    return this.get("steel", () => new THREE.MeshStandardMaterial({ color: "#c7c9cb", metalness: 0.9, roughness: 0.35 }));
  }
  get blackGlass() {
    return this.get("blackGlass", () => new THREE.MeshStandardMaterial({ color: "#0d0e10", metalness: 0.2, roughness: 0.08 }));
  }
  /** A switched-off TV: dark, with a faint sky reflection. */
  get screen() {
    return this.get("screen", () => new THREE.MeshStandardMaterial({ color: "#050608", metalness: 0.5, roughness: 0.04 }));
  }
  get porcelain() {
    return this.get("porcelain", () => new THREE.MeshPhysicalMaterial({ color: "#f6f6f4", roughness: 0.12, clearcoat: 1 }));
  }
  /** Furniture and cupboards: one basic brown laminate for now. */
  get brown() {
    return this.get("brown", () => {
      const set = this.textures.get("veneer", FURNITURE_BROWN);
      return new THREE.MeshStandardMaterial({ map: set.map, normalMap: set.normalMap, roughness: 0.55 });
    });
  }
  get darkBrown() {
    return this.get("darkBrown", () => {
      const set = this.textures.get("veneer", "#4a3020");
      return new THREE.MeshStandardMaterial({ map: set.map, normalMap: set.normalMap, roughness: 0.6 });
    });
  }
  fabric(hex: string) {
    return this.surface("fabric", hex, { roughness: 1 });
  }
  get counter() {
    return this.surface("granite", "#1e1e20");
  }
  get backsplash() {
    return this.surface("wallTile", "#f1efea");
  }
  get handle() {
    return this.get("handle", () => new THREE.MeshStandardMaterial({ color: "#9a9a96", metalness: 1, roughness: 0.3 }));
  }
  get lamp() {
    return this.get("lamp", () => new THREE.MeshStandardMaterial({ color: "#fff7ea", emissive: "#fff1d8", emissiveIntensity: 2.2, roughness: 0.5 }));
  }
  get rail() {
    return this.get("rail", () => new THREE.MeshStandardMaterial({ color: "#2c2d30", metalness: 0.7, roughness: 0.4 }));
  }
  get grass() {
    return this.surface("grass", "#5b7a3a");
  }
  get paving() {
    return this.surface("paving", "#a8a39a");
  }
  get asphalt() {
    return this.surface("asphalt", "#3d3e40");
  }
  get bark() {
    return this.surface("bark", "#5a4a3c");
  }

  dispose() {
    for (const m of this.cache.values()) m.dispose();
    this.cache.clear();
    this.textures.dispose();
  }
}
