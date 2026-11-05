// Procedural PBR textures for the 3D house: colour, roughness and normal maps, generated in the browser so every finish
// works in any colour and nothing has to be downloaded. All patterns tile seamlessly and are sized in real metres
// (see TEXTURE_METRES), because the house's UVs are in metres.

import * as THREE from "three";
import type { WallpaperPattern } from "@/lib/rooms";

/** How many metres one repeat of each texture covers. */
export const TEXTURE_METRES = {
  wood: 2.4,
  tiles: 1.2,
  marble: 1.2,
  plaster: 1.5,
  wallpaper: 0.53, // one roll width
  wallTile: 0.6,
  veneer: 0.8,
  exterior: 2.5,
  stone: 1.2,
  grass: 2.5,
  paving: 1.8,
  asphalt: 4,
  fabric: 0.25,
  granite: 0.8,
  bark: 1,
} as const;

export type SurfaceKind = keyof typeof TEXTURE_METRES;

/**
 * A pattern before colouring: `tone` multiplies the base colour, `accent` (0–1) blends towards a second colour
 * (grout, veins, plank gaps), `height` makes the normal map and `rough` is the roughness.
 */
type Structure = { size: number; tone: Float32Array; accent: Float32Array; height: Float32Array; rough: Float32Array };

// ─── Noise ────────────────────────────────────────────────────

function hash(x: number, y: number, seed: number) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 982451653);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const mod = (a: number, n: number) => ((a % n) + n) % n;

/** Value noise that repeats every `period` units in both directions (so textures tile). Range 0–1. */
function noise(x: number, y: number, period: number, seed: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = fade(x - xi);
  const fy = fade(y - yi);
  const x0 = mod(xi, period), x1 = mod(xi + 1, period), y0 = mod(yi, period), y1 = mod(yi + 1, period);
  const a = hash(x0, y0, seed), b = hash(x1, y0, seed), c = hash(x0, y1, seed), d = hash(x1, y1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Fractal noise over u,v in 0–1 (tiling), starting at `freq` cells across. Range about 0–1. */
function fbm(u: number, v: number, freq: number, octaves: number, seed: number, gain = 0.5) {
  let sum = 0, amp = 1, norm = 0, f = freq;
  for (let o = 0; o < octaves; o++) {
    sum += noise(u * f, v * f, f, seed + o * 17) * amp;
    norm += amp;
    amp *= gain;
    f *= 2;
  }
  return sum / norm;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function structure(size: number, fn: (u: number, v: number, out: { tone: number; accent: number; height: number; rough: number }) => void): Structure {
  const n = size * size;
  const s: Structure = { size, tone: new Float32Array(n), accent: new Float32Array(n), height: new Float32Array(n), rough: new Float32Array(n) };
  const px = { tone: 1, accent: 0, height: 0.5, rough: 0.5 };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      px.tone = 1; px.accent = 0; px.height = 0.5; px.rough = 0.5;
      fn((x + 0.5) / size, (y + 0.5) / size, px);
      const i = y * size + x;
      s.tone[i] = px.tone; s.accent[i] = px.accent; s.height[i] = px.height; s.rough[i] = px.rough;
    }
  }
  return s;
}

// ─── Patterns ─────────────────────────────────────────────────

const ROWS = 12; // wood: 0.2 m planks across 2.4 m

function woodPlanks(size: number) {
  return structure(size, (u, v, p) => {
    const row = Math.floor(v * ROWS);
    const fy = v * ROWS - row;
    const uu = mod(u + hash(row, 1, 3), 1) * 2; // two 1.2 m planks per row, staggered
    const k = Math.floor(uu);
    const fx = uu - k;
    const seed = row * 2 + k;
    const plank = 0.86 + hash(seed, 7, 11) * 0.26;
    // Grain runs along the plank: growth rings warped by noise, plus fine pores.
    const warp = fbm(fx * 0.5 + hash(seed, 2, 5), fy * 0.5, 3, 3, seed + 40) * 2.2;
    const ring = mod((fy * (2.2 + hash(seed, 3, 9) * 2) + warp) * 3, 1);
    const late = smooth(0.55, 0.95, ring) * 0.22;
    const pores = (noise(uu * 400, fy * 24, 800, seed + 90) - 0.5) * 0.08;
    const knot = Math.max(0, 1 - Math.hypot((fx - hash(seed, 4, 1)) * 6, (fy - 0.5) * 1.6) * 3) * (hash(seed, 6, 2) > 0.7 ? 0.35 : 0);
    const gapY = Math.min(fy, 1 - fy) * (size / ROWS); // pixels from the long edge
    const gapX = Math.min(fx, 1 - fx) * (size / 2); // pixels from the plank's end
    const gap = 1 - smooth(0, 1.6, Math.min(gapY, gapX));
    p.tone = plank * (1 - late + pores) * (1 - knot);
    p.accent = gap * 0.85;
    p.height = 0.5 + (pores + late * 0.3) * 0.4 - gap * 0.5;
    p.rough = 0.42 + late * 0.25 + gap * 0.4;
  });
}

function floorTiles(size: number) {
  const tiles = 2; // 0.6 m (2 ft) tiles, 2 × 2 per repeat
  return structure(size, (u, v, p) => {
    const tx = Math.floor(u * tiles), ty = Math.floor(v * tiles);
    const fx = u * tiles - tx, fy = v * tiles - ty;
    const edge = Math.min(fx, 1 - fx, fy, 1 - fy) * (size / tiles); // pixels from the grout line
    const grout = 1 - smooth(1.2, 2.2, edge);
    const bevel = smooth(1.5, 6, edge);
    const mottle = fbm(u, v, 6, 4, 21 + tx * 3 + ty * 5) - 0.5;
    p.tone = 0.96 + hash(tx, ty, 31) * 0.08 + mottle * 0.08;
    p.accent = grout;
    p.height = 0.25 + bevel * 0.5 + mottle * 0.02;
    p.rough = 0.18 + mottle * 0.08 + grout * 0.7;
  });
}

function marbleSlab(size: number) {
  return structure(size, (u, v, p) => {
    const wu = u + (fbm(u, v, 2, 4, 51) - 0.5) * 0.6;
    const wv = v + (fbm(u, v, 2, 4, 52) - 0.5) * 0.6;
    // Thin ridged veins (the main ones) and a softer secondary network
    const n1 = fbm(mod(wu, 1), mod(wv, 1), 3, 6, 61);
    const vein = Math.pow(1 - Math.min(1, Math.abs(n1 - 0.5) * 2), 22);
    const n2 = fbm(mod(wu * 1.0 + 0.3, 1), mod(wv, 1), 5, 5, 71);
    const vein2 = Math.pow(1 - Math.min(1, Math.abs(n2 - 0.5) * 2), 40) * 0.5;
    const cloud = fbm(u, v, 3, 5, 81) - 0.5;
    const edge = Math.min(u, 1 - u, v, 1 - v) * size;
    const joint = 1 - smooth(0.6, 1.4, edge);
    p.tone = 1 + cloud * 0.1;
    p.accent = Math.min(1, vein * 0.85 + vein2 + cloud * 0.05);
    p.height = 0.5 - joint * 0.4;
    p.rough = 0.07 + vein * 0.08 + joint * 0.5;
  });
}

function plaster(size: number) {
  return structure(size, (u, v, p) => {
    const n = fbm(u, v, 24, 4, 91);
    const fine = noise(u * 220, v * 220, 220, 92);
    p.tone = 0.985 + (n - 0.5) * 0.04;
    p.height = n * 0.6 + fine * 0.15;
    p.rough = 0.88;
  });
}

function exteriorPlaster(size: number) {
  return structure(size, (u, v, p) => {
    const n = fbm(u, v, 10, 5, 101);
    const grit = noise(u * 300, v * 300, 300, 102);
    const stain = Math.max(0, fbm(u, v, 3, 3, 103) - 0.55) * 0.5;
    p.tone = 0.95 + (n - 0.5) * 0.12 - stain;
    p.height = n * 0.5 + grit * 0.35;
    p.rough = 0.92;
  });
}

function wallTiles(size: number) {
  // 300 × 600 mm tiles laid in a stack bond: 2 across, 1 down per 0.6 m repeat
  return structure(size, (u, v, p) => {
    const tx = Math.floor(u * 2), ty = Math.floor(v * 1);
    const fx = u * 2 - tx, fy = v - ty;
    const edge = Math.min(fx * (size / 2), (1 - fx) * (size / 2), fy * size, (1 - fy) * size);
    const grout = 1 - smooth(1.2, 2.4, edge);
    const n = fbm(u, v, 8, 3, 111 + tx);
    p.tone = 0.97 + hash(tx, ty, 113) * 0.05 + (n - 0.5) * 0.04;
    p.accent = grout;
    p.height = 0.3 + smooth(1.5, 5, edge) * 0.5;
    p.rough = 0.12 + grout * 0.75;
  });
}

function veneer(size: number) {
  // Straight-grained veneer: fine, slightly wavy lines running along v, with soft streaks and pores
  return structure(size, (u, v, p) => {
    const warp = (fbm(u, v, 3, 4, 121) - 0.5) * 0.9 + Math.sin(v * Math.PI * 2 * 2 + u * 9) * 0.08;
    const ring = mod(u * 26 + warp * 0.7, 1);
    const late = smooth(0.62, 0.95, ring) * 0.16;
    const streak = (noise(u * 90, v * 3, 90, 123) - 0.5) * 0.12;
    const pores = (noise(u * 160, v * 700, 160, 122) - 0.5) * 0.06;
    p.tone = 1 - late + streak + pores;
    p.height = 0.5 + pores * 0.6 - late * 0.2;
    p.rough = 0.5 + late * 0.2;
  });
}

function stone(size: number) {
  // Rough-cut stone blocks for the plinth: 3 courses of offset blocks
  return structure(size, (u, v, p) => {
    const row = Math.floor(v * 3);
    const fy = v * 3 - row;
    const uu = mod(u + (row % 2) * 0.25, 1) * 2;
    const k = Math.floor(uu);
    const fx = uu - k;
    const edge = Math.min(fx * size * 0.5, (1 - fx) * size * 0.5, fy * size / 3, (1 - fy) * size / 3);
    const joint = 1 - smooth(1, 4, edge);
    const n = fbm(u, v, 8, 5, 131 + row * 4 + k);
    p.tone = 0.85 + hash(row * 2 + k, 1, 132) * 0.25 + (n - 0.5) * 0.25;
    p.accent = joint;
    p.height = 0.2 + smooth(1, 10, edge) * 0.5 + n * 0.3;
    p.rough = 0.9;
  });
}

function grass(size: number) {
  return structure(size, (u, v, p) => {
    const blades = noise(u * 380, v * 90, 380, 141) * 0.6 + noise(u * 120, v * 420, 120, 142) * 0.4;
    const clump = fbm(u, v, 6, 5, 143);
    const dry = Math.max(0, fbm(u, v, 3, 4, 144) - 0.55) * 1.6;
    p.tone = 0.7 + blades * 0.35 + (clump - 0.5) * 0.35;
    p.accent = Math.min(1, dry);
    p.height = blades * 0.7 + clump * 0.3;
    p.rough = 0.95;
  });
}

function paving(size: number) {
  // 300 mm concrete pavers, 6 × 6 per 1.8 m
  return structure(size, (u, v, p) => {
    const tx = Math.floor(u * 6), ty = Math.floor(v * 6);
    const fx = u * 6 - tx, fy = v * 6 - ty;
    const edge = Math.min(fx, 1 - fx, fy, 1 - fy) * (size / 6);
    const joint = 1 - smooth(0.8, 2.5, edge);
    const n = fbm(u, v, 12, 4, 151);
    p.tone = 0.9 + hash(tx, ty, 152) * 0.14 + (n - 0.5) * 0.12;
    p.accent = joint;
    p.height = 0.3 + smooth(1, 5, edge) * 0.5 + n * 0.1;
    p.rough = 0.85;
  });
}

function asphalt(size: number) {
  return structure(size, (u, v, p) => {
    const n = fbm(u, v, 16, 5, 161);
    const grain = noise(u * 500, v * 500, 500, 162);
    p.tone = 0.85 + (n - 0.5) * 0.2 + (grain - 0.5) * 0.2;
    p.height = grain * 0.6 + n * 0.2;
    p.rough = 0.9;
  });
}

function fabric(size: number) {
  return structure(size, (u, v, p) => {
    const warp = Math.sin(u * Math.PI * 2 * 64) * 0.5 + 0.5;
    const weft = Math.sin(v * Math.PI * 2 * 64) * 0.5 + 0.5;
    const n = noise(u * 64, v * 64, 64, 171);
    p.tone = 0.92 + (warp * weft) * 0.1 + (n - 0.5) * 0.06;
    p.height = warp * 0.5 + weft * 0.5;
    p.rough = 0.95;
  });
}

function granite(size: number) {
  return structure(size, (u, v, p) => {
    const a = noise(u * 180, v * 180, 180, 181);
    const b = noise(u * 70, v * 70, 70, 182);
    const fleck = a > 0.82 ? 1 : 0;
    p.tone = 0.8 + b * 0.35;
    p.accent = fleck * 0.8;
    p.height = 0.5;
    p.rough = 0.12 + (1 - b) * 0.08;
  });
}

function bark(size: number) {
  return structure(size, (u, v, p) => {
    const n = fbm(u, v * 0.3, 8, 5, 191);
    const ridges = Math.pow(Math.abs(Math.sin((u * 14 + n * 2) * Math.PI)), 0.4);
    p.tone = 0.6 + ridges * 0.4;
    p.height = ridges;
    p.rough = 0.95;
  });
}

const STRUCTURES: Record<SurfaceKind, (size: number) => Structure> = {
  wood: woodPlanks,
  tiles: floorTiles,
  marble: marbleSlab,
  plaster,
  wallpaper: plaster, // wallpapers get their colour from a drawing (below); this is their paper texture
  wallTile: wallTiles,
  veneer,
  exterior: exteriorPlaster,
  stone,
  grass,
  paving,
  asphalt,
  fabric,
  granite,
  bark,
};

/** Normal map strength per surface: how deep its bumps look. */
const BUMP: Record<SurfaceKind, number> = {
  wood: 2.5, tiles: 3, marble: 1.5, plaster: 1.2, wallpaper: 0.8, wallTile: 3, veneer: 1, exterior: 1.1,
  stone: 6, grass: 4, paving: 4, asphalt: 3, fabric: 2, granite: 0.5, bark: 8,
};

// ─── Colour ───────────────────────────────────────────────────

type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const luminance = ([r, g, b]: RGB) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
const mixRgb = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const scaleRgb = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];

/** The second colour each surface blends towards where its `accent` is set. */
function accentColour(kind: SurfaceKind, base: RGB): RGB {
  switch (kind) {
    case "marble": // dark veins on light stone, pale veins on dark stone
      return luminance(base) > 0.45 ? mixRgb(scaleRgb(base, 0.45), [96, 92, 90], 0.5) : [214, 208, 198];
    case "tiles":
    case "wallTile":
      return luminance(base) > 0.4 ? scaleRgb(base, 0.72) : mixRgb(base, [160, 160, 160], 0.35);
    case "wood":
      return scaleRgb(base, 0.3);
    case "grass":
      return [148, 140, 84];
    case "stone":
    case "paving":
      return scaleRgb(base, 0.55);
    case "granite":
      return luminance(base) > 0.4 ? [40, 40, 42] : [200, 196, 190];
    default:
      return base;
  }
}

// ─── Building textures ────────────────────────────────────────

function finishTexture(t: THREE.Texture, kind: SurfaceKind, srgb: boolean) {
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.repeat.setScalar(1 / TEXTURE_METRES[kind]);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

function dataTexture(data: Uint8Array, size: number, kind: SurfaceKind, srgb: boolean) {
  return finishTexture(new THREE.DataTexture(data, size, size, THREE.RGBAFormat), kind, srgb);
}

function colourPixels(s: Structure, hex: string, kind: SurfaceKind): Uint8Array {
  const base = hexToRgb(hex);
  const accent = accentColour(kind, base);
  const out = new Uint8Array(s.size * s.size * 4);
  for (let i = 0; i < s.tone.length; i++) {
    const t = s.tone[i], a = s.accent[i];
    for (let c = 0; c < 3; c++) out[i * 4 + c] = Math.max(0, Math.min(255, base[c] * t * (1 - a) + accent[c] * a));
    out[i * 4 + 3] = 255;
  }
  return out;
}

function normalPixels(s: Structure, strength: number): Uint8Array {
  const { size, height } = s;
  const out = new Uint8Array(size * size * 4);
  const h = (x: number, y: number) => height[mod(y, size) * size + mod(x, size)];
  const k = strength * (size / 512);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * k;
      const dy = (h(x, y + 1) - h(x, y - 1)) * k;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      out[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      out[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
      out[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      out[i + 3] = 255;
    }
  }
  return out;
}

function roughPixels(s: Structure): Uint8Array {
  const out = new Uint8Array(s.size * s.size * 4);
  for (let i = 0; i < s.rough.length; i++) {
    const r = Math.max(0, Math.min(255, s.rough[i] * 255));
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = r;
    out[i * 4 + 3] = 255;
  }
  return out;
}

// ─── Wallpapers (drawn with the 2D canvas) ───────────────────

function shade(hex: string, k: number) {
  const [r, g, b] = hexToRgb(hex).map((c) => Math.max(0, Math.min(255, Math.round(c * k))));
  return `rgb(${r},${g},${b})`;
}

/** Draws `fn` at every wrapped position so shapes crossing an edge continue on the other side. */
function tiled(size: number, fn: (dx: number, dy: number) => void) {
  for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) fn(dx, dy);
}

function drawWallpaper(ctx: CanvasRenderingContext2D, size: number, pattern: WallpaperPattern, color: string) {
  const s = size;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, s, s);
  const motif = luminance(hexToRgb(color)) > 0.5 ? shade(color, 0.8) : shade(color, 1.35);
  const fine = luminance(hexToRgb(color)) > 0.5 ? shade(color, 0.9) : shade(color, 1.15);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (pattern === "stripes") {
    const bands = [0.18, 0.04, 0.03, 0.04, 0.21];
    let x = 0;
    for (let rep = 0; rep < 2; rep++) {
      bands.forEach((w, i) => {
        ctx.fillStyle = i % 2 ? fine : i === 0 ? motif : color;
        ctx.fillRect(x * s, 0, w * s, s);
        x += w;
      });
    }
  } else if (pattern === "chevron") {
    ctx.strokeStyle = motif;
    ctx.lineWidth = s * 0.06;
    for (let row = -1; row < 6; row++) {
      ctx.beginPath();
      for (let i = 0; i <= 4; i++) ctx.lineTo((i / 4) * s, row * (s / 5) + (i % 2 ? s * 0.1 : 0));
      ctx.stroke();
    }
  } else if (pattern === "trellis") {
    ctx.strokeStyle = motif;
    ctx.lineWidth = s * 0.018;
    const c = s / 2;
    tiled(s, (dx, dy) => {
      for (const [ox, oy] of [[0, 0], [c, c]]) {
        ctx.beginPath();
        const x = ox + dx, y = oy + dy;
        // Ogee: four arcs bulging alternately in and out
        ctx.moveTo(x, y - c / 2);
        ctx.quadraticCurveTo(x + c * 0.5, y - c * 0.3, x + c / 2, y);
        ctx.quadraticCurveTo(x + c * 0.5, y + c * 0.3, x, y + c / 2);
        ctx.quadraticCurveTo(x - c * 0.5, y + c * 0.3, x - c / 2, y);
        ctx.quadraticCurveTo(x - c * 0.5, y - c * 0.3, x, y - c / 2);
        ctx.stroke();
      }
    });
  } else if (pattern === "damask") {
    ctx.fillStyle = motif;
    const medallion = (x: number, y: number, r: number) => {
      ctx.save();
      ctx.translate(x, y);
      for (const flip of [1, -1]) {
        ctx.save();
        ctx.scale(flip, 1);
        ctx.beginPath();
        ctx.moveTo(0, -r);
        ctx.bezierCurveTo(r * 0.5, -r * 0.8, r * 0.15, -r * 0.35, r * 0.55, -r * 0.2);
        ctx.bezierCurveTo(r * 0.9, -r * 0.05, r * 0.6, r * 0.35, r * 0.25, r * 0.4);
        ctx.bezierCurveTo(r * 0.45, r * 0.7, r * 0.15, r * 0.85, 0, r);
        ctx.lineTo(0, -r);
        ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.ellipse(0, -r * 0.05, r * 0.14, r * 0.28, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = motif;
      ctx.restore();
    };
    tiled(s, (dx, dy) => {
      medallion(s * 0.25 + dx, s * 0.25 + dy, s * 0.22);
      medallion(s * 0.75 + dx, s * 0.75 + dy, s * 0.22);
    });
    ctx.fillStyle = fine;
    tiled(s, (dx, dy) => {
      for (const [x, y] of [[0.75, 0.25], [0.25, 0.75]]) {
        ctx.beginPath();
        ctx.arc(x * s + dx, y * s + dy, s * 0.03, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  } else if (pattern === "leaves") {
    const greens = ["#5d7a4e", "#7a9663", "#486a45", "#93a873"];
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 26; i++) {
      const x = rnd() * s, y = rnd() * s, r = s * (0.05 + rnd() * 0.06), a = rnd() * Math.PI * 2;
      const col = greens[i % greens.length];
      tiled(s, (dx, dy) => {
        ctx.save();
        ctx.translate(x + dx, y + dy);
        ctx.rotate(a);
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(0, -r);
        ctx.quadraticCurveTo(r * 0.6, 0, 0, r);
        ctx.quadraticCurveTo(-r * 0.6, 0, 0, -r);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.35)";
        ctx.lineWidth = s * 0.003;
        ctx.beginPath();
        ctx.moveTo(0, -r * 0.9);
        ctx.lineTo(0, r * 0.9);
        ctx.stroke();
        ctx.restore();
      });
    }
  } else {
    // linen: fine crosshatch
    const img = ctx.getImageData(0, 0, s, s);
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const u = x / s, v = y / s;
        const t = 0.9 + noise(u * 260, v * 6, 260, 201) * 0.12 + noise(u * 6, v * 260, 6, 202) * 0.08;
        const i = (y * s + x) * 4;
        for (let c = 0; c < 3; c++) img.data[i + c] = Math.min(255, img.data[i + c] * t);
      }
    }
    ctx.putImageData(img, 0, 0);
  }
}

// ─── Cache and public API ─────────────────────────────────────

export type PbrSet = { map: THREE.Texture | null; normalMap: THREE.Texture; roughnessMap: THREE.Texture };

/** Texture resolution: floors are seen close up in the walkthrough, so they get the most pixels. */
const RES: Partial<Record<SurfaceKind, number>> = { wood: 1024, tiles: 1024, marble: 1024, grass: 1024, wallpaper: 1024 };
const resOf = (kind: SurfaceKind) => RES[kind] ?? 512;

/**
 * Makes and caches textures. One cache per scene; dispose() frees them all.
 * Structures (the expensive part) are shared between colours; only the colour map is made per colour.
 */
export class TextureLibrary {
  private structures = new Map<SurfaceKind, Structure>();
  private surfaceMaps = new Map<SurfaceKind, { normalMap: THREE.Texture; roughnessMap: THREE.Texture }>();
  private colourMaps = new Map<string, THREE.Texture>();

  private structure(kind: SurfaceKind) {
    let s = this.structures.get(kind);
    if (!s) this.structures.set(kind, (s = STRUCTURES[kind](resOf(kind))));
    return s;
  }

  private maps(kind: SurfaceKind) {
    let m = this.surfaceMaps.get(kind);
    if (!m) {
      const s = this.structure(kind);
      m = { normalMap: dataTexture(normalPixels(s, BUMP[kind]), s.size, kind, false), roughnessMap: dataTexture(roughPixels(s), s.size, kind, false) };
      this.surfaceMaps.set(kind, m);
    }
    return m;
  }

  /** Normal and roughness maps for a surface, plus a colour map in `hex` (null: colour comes from the material). */
  get(kind: SurfaceKind, hex: string | null): PbrSet {
    const maps = this.maps(kind);
    if (!hex) return { map: null, ...maps };
    const key = `${kind}:${hex}`;
    let map = this.colourMaps.get(key);
    if (!map) {
      const s = this.structure(kind);
      this.colourMaps.set(key, (map = dataTexture(colourPixels(s, hex, kind), s.size, kind, true)));
    }
    return { map, ...maps };
  }

  wallpaper(pattern: WallpaperPattern, hex: string): PbrSet {
    const key = `wallpaper:${pattern}:${hex}`;
    let map = this.colourMaps.get(key);
    if (!map) {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = resOf("wallpaper");
      drawWallpaper(canvas.getContext("2d")!, canvas.width, pattern, hex);
      this.colourMaps.set(key, (map = finishTexture(new THREE.CanvasTexture(canvas), "wallpaper", true)));
    }
    return { map, ...this.maps("wallpaper") };
  }

  dispose() {
    for (const m of this.surfaceMaps.values()) {
      m.normalMap.dispose();
      m.roughnessMap.dispose();
    }
    for (const t of this.colourMaps.values()) t.dispose();
    this.surfaceMaps.clear();
    this.colourMaps.clear();
    this.structures.clear();
  }
}

// ─── Swatch previews for the panel ────────────────────────────

const previews = new Map<string, HTMLCanvasElement>();

/** A small preview of a finish (about 0.6 m of it), drawn with the same generators as the 3D textures. Cached. */
export function previewCanvas(kind: SurfaceKind, hex: string, pattern?: WallpaperPattern): HTMLCanvasElement {
  const key = `${kind}:${hex}:${pattern ?? ""}`;
  const cached = previews.get(key);
  if (cached) return cached;
  const res = 192;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = res;
  const ctx = canvas.getContext("2d")!;
  if (pattern) {
    drawWallpaper(ctx, res, pattern, hex);
  } else {
    const s = STRUCTURES[kind](256);
    const tmp = document.createElement("canvas");
    tmp.width = tmp.height = 256;
    tmp.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(colourPixels(s, hex, kind)), 256, 256), 0, 0);
    const crop = Math.min(1, 0.6 / TEXTURE_METRES[kind]) * 256;
    ctx.drawImage(tmp, 0, 0, crop, crop, 0, 0, res, res);
  }
  previews.set(key, canvas);
  return canvas;
}
