// A plan option as a 2D drawing sheet: every floor side by side, rooms with names and sizes in feet, the plot and
// the road side, a north arrow, a scale bar and a title block. One self-contained SVG string, so the same drawing
// shows on the page, downloads as SVG and converts to PNG for sending on.

import type { PlanOption } from "@/lib/planner";

const FLOOR_NAMES = ["Ground floor", "First floor", "Second floor"];
const FONT = "'Anek Latin Variable', 'Helvetica Neue', Helvetica, Arial, sans-serif";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const r1 = (v: number) => Math.round(v * 10) / 10;

function fill(name: string): string {
  if (/Bedroom/.test(name)) return "#eceae4";
  if (/Living|Dining/.test(name)) return "#f3ead4";
  if (/Kitchen|Store/.test(name)) return "#efe2c0";
  if (/Bathroom/.test(name)) return "#e3e5e8";
  if (/Utility|Dressing/.test(name)) return "#efeeea";
  if (/Car Parking/.test(name)) return "#ebe9e3";
  if (/Pooja/.test(name)) return "#ead8a6";
  if (/Balcony|Terrace/.test(name)) return "#f7f6f2";
  return "#f7f6f2"; // passages, stairs
}

const SHORT: Record<string, string> = {
  "Master Bedroom": "Master bed",
  "Living Room": "Living",
  "Dining Room": "Dining",
  "Pooja Room": "Pooja",
  "Walk-in Closet": "WIC",
  "Open Terrace": "Terrace",
  "Car Parking": "Parking",
};

export type SheetMeta = { title: string; subtitle: string };

/** The drawing as an SVG string, with its pixel size. */
export function planSheetSvg(o: PlanOption, meta: SheetMeta): { svg: string; width: number; height: number } {
  const floors = Math.max(...o.rooms.map((r) => r.floor));
  const p = o.plotRect;
  const W = 1400;
  const pad = 56;
  const gap = 80;
  const roadBand = 40;
  // Feet → px, so every floor fits side by side
  const s = Math.min(16, (W - pad * 2 - gap * (floors - 1) - roadBand * 2) / (p.w * floors));
  const fw = p.w * s;
  const fh = p.l * s;
  const top = 150;
  const titleH = 92;
  const H = Math.round(top + roadBand + fh + roadBand + 70 + titleH);
  const startX = (W - (fw * floors + gap * (floors - 1))) / 2;
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">`);
  out.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
  out.push(`<text x="${pad}" y="64" font-size="30" font-weight="700" fill="#1d2025">${esc(meta.title)}</text>`);
  out.push(`<text x="${pad}" y="94" font-size="16" fill="#4f545c">${esc(meta.subtitle)}</text>`);

  // North arrow (plan north is up)
  out.push(`<g transform="translate(${W - pad - 22} 72)"><path d="M0 -26 L10 10 L0 3 L-10 10 Z" fill="#1d2025"/><text y="30" text-anchor="middle" font-size="14" font-weight="700" fill="#1d2025">N</text></g>`);

  for (let f = 1; f <= floors; f++) {
    const ox = startX + (f - 1) * (fw + gap);
    const oy = top + roadBand;
    const X = (x: number) => ox + (x - p.x) * s;
    const Y = (z: number) => oy + (z - p.z) * s;
    out.push(`<text x="${ox}" y="${oy - roadBand - 10}" font-size="15" font-weight="700" fill="#1d2025">${FLOOR_NAMES[f - 1] ?? `Floor ${f}`}</text>`);
    // Plot and road
    out.push(`<rect x="${X(p.x)}" y="${Y(p.z)}" width="${fw}" height="${fh}" fill="none" stroke="#8a8e95" stroke-width="1.2" stroke-dasharray="7 5"/>`);
    const road = {
      north: { x: X(p.x), y: Y(p.z) - roadBand + 6, w: fw, h: roadBand - 14 },
      south: { x: X(p.x), y: Y(p.z + p.l) + 8, w: fw, h: roadBand - 14 },
      east: { x: X(p.x + p.w) + 8, y: Y(p.z), w: roadBand - 14, h: fh },
      west: { x: X(p.x) - roadBand + 6, y: Y(p.z), w: roadBand - 14, h: fh },
    }[o.plot.facing];
    const vertical = road.h > road.w;
    out.push(`<rect x="${road.x}" y="${road.y}" width="${road.w}" height="${road.h}" fill="#e9e6dd"/>`);
    out.push(
      `<text x="${road.x + road.w / 2}" y="${road.y + road.h / 2}" font-size="12" font-weight="700" letter-spacing="3" fill="#6d727a" text-anchor="middle" dominant-baseline="middle"${vertical ? ` transform="rotate(-90 ${road.x + road.w / 2} ${road.y + road.h / 2})"` : ""}>ROAD</text>`
    );
    // Rooms: filled, then walls on top
    const rooms = o.rooms.filter((r) => r.floor === f);
    for (const r of rooms) out.push(`<rect x="${X(r.x)}" y="${Y(r.z)}" width="${r.w * s}" height="${r.l * s}" fill="${fill(r.name)}"/>`);
    for (const r of rooms) out.push(`<rect x="${X(r.x)}" y="${Y(r.z)}" width="${r.w * s}" height="${r.l * s}" fill="none" stroke="#1d2025" stroke-width="3"/>`);
    // Stairs: treads
    for (const r of rooms.filter((x) => x.name === "Staircase")) {
      const steps = Math.max(4, Math.floor(r.l / 1));
      for (let k = 1; k < steps; k++) out.push(`<line x1="${X(r.x)}" y1="${Y(r.z) + (k * r.l * s) / steps}" x2="${X(r.x + r.w)}" y2="${Y(r.z) + (k * r.l * s) / steps}" stroke="#8a8e95" stroke-width="1"/>`);
    }
    // Labels: name and size, shortened or dropped when the room is too small to hold them
    for (const r of rooms) {
      if (r.name === "Passage") continue;
      const cx = X(r.x + r.w / 2);
      const cy = Y(r.z + r.l / 2);
      const wpx = r.w * s;
      const hpx = r.l * s;
      const name = wpx < 90 ? SHORT[r.name] ?? r.name : r.name;
      const size = Math.max(10, Math.min(15, wpx / Math.max(6, name.length) * 1.5));
      if (wpx < 34 || hpx < 26) continue;
      out.push(`<text x="${cx}" y="${cy - (hpx > 44 ? 4 : 0)}" font-size="${size.toFixed(1)}" font-weight="700" fill="#1d2025" text-anchor="middle">${esc(name)}</text>`);
      if (hpx > 44 && wpx > 54) out.push(`<text x="${cx}" y="${cy + size}" font-size="${(size * 0.82).toFixed(1)}" fill="#4f545c" text-anchor="middle">${r1(r.w)} × ${r1(r.l)} ft</text>`);
    }
    // Plot dimensions
    out.push(`<text x="${X(p.x) + fw / 2}" y="${Y(p.z + p.l) + roadBand + 22}" font-size="13" fill="#4f545c" text-anchor="middle">${r1(o.plot.facing === "east" || o.plot.facing === "west" ? o.plot.depth : o.plot.width)} ft</text>`);
  }

  // Scale bar and title block
  const sy = H - titleH + 4;
  out.push(`<line x1="0" y1="${sy - 18}" x2="${W}" y2="${sy - 18}" stroke="#e1ded6"/>`);
  out.push(`<g transform="translate(${pad} ${sy + 22})"><rect width="${10 * s}" height="6" fill="#1d2025"/><rect x="${5 * s}" width="${5 * s}" height="6" fill="#ffffff" stroke="#1d2025"/><text y="26" font-size="12" fill="#4f545c">0</text><text x="${10 * s}" y="26" font-size="12" fill="#4f545c" text-anchor="middle">10 ft</text></g>`);
  out.push(`<text x="${W - pad}" y="${sy + 26}" font-size="14" fill="#4f545c" text-anchor="end">Built-up ${o.builtUp.toLocaleString("en-IN")} sq ft · ${floors === 1 ? "G" : `G+${floors - 1}`} · road on the ${o.plot.facing}</text>`);
  out.push(`<text x="${W - pad}" y="${sy + 50}" font-size="13" fill="#8a8e95" text-anchor="end">Spacify · a starting plan; check sizes and local building rules before construction</text>`);
  out.push(`</svg>`);
  return { svg: out.join(""), width: W, height: H };
}

/** The sheet as a PNG blob (2× for sharp text when forwarded). */
export function planSheetPng(svg: string, width: number, height: number, scale = 2): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = width * scale;
      c.height = height * scale;
      const g = c.getContext("2d")!;
      g.scale(scale, scale);
      g.drawImage(img, 0, 0, width, height);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't make the image."))), "image/png");
    };
    img.onerror = () => reject(new Error("Couldn't draw the plan."));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}
