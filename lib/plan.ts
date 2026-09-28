import { layoutRooms, roomColor, type Room } from "@/lib/rooms";

/** Draws a to-scale 2D plan of one floor onto a canvas (sized in CSS pixels × devicePixelRatio). */
export function drawPlan(canvas: HTMLCanvasElement, rooms: Room[], floor: number, isDark: boolean) {
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const font = getComputedStyle(document.documentElement).getPropertyValue("--font-sans").trim() || "sans-serif";
  const text = isDark ? "rgba(240,237,232,0.9)" : "#1a1a18";
  const muted = isDark ? "rgba(136,136,128,0.8)" : "#777770";

  ctx.fillStyle = isDark ? "#0a0a0a" : "#f5f3ef";
  ctx.fillRect(0, 0, width, height);

  const floorRooms = rooms.filter((r) => r.floor === floor);
  if (!floorRooms.length) {
    ctx.fillStyle = muted;
    ctx.font = `14px ${font}`;
    ctx.textAlign = "center";
    ctx.fillText(rooms.length ? `No rooms on floor ${floor}` : "No rooms to display", width / 2, height / 2);
    return;
  }

  // Same packing as the 3D view, but in feet (scale 1) so we can fit it to the canvas.
  const PAD = 60;
  const boxes = layoutRooms(floorRooms, { scale: 1, gap: 1.5, maxRowWidth: 60, center: false });
  const maxX = Math.max(...boxes.map((b) => b.x + b.w));
  const maxZ = Math.max(...boxes.map((b) => b.z + b.l));
  const scale = Math.min((width - PAD * 2) / maxX, (height - PAD * 2) / maxZ);
  const offX = (width - maxX * scale) / 2;
  const offZ = (height - maxZ * scale) / 2;

  ctx.fillStyle = "#ffcc44";
  ctx.font = `11px ${font}`;
  ctx.textAlign = "center";
  ctx.fillText("☀ North", offX + (maxX * scale) / 2, offZ - 20);

  for (const box of boxes) {
    const r = floorRooms.find((x) => x.id === box.id)!;
    const px = offX + box.x * scale;
    const pz = offZ + box.z * scale;
    const pw = box.w * scale;
    const pl = box.l * scale;

    // Floor fill
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = roomColor(r.name);
    ctx.fillRect(px, pz, pw, pl);
    ctx.globalAlpha = 1;

    // Walls
    ctx.strokeStyle = isDark ? "rgba(240,237,232,0.7)" : "rgba(26,26,24,0.7)";
    ctx.lineWidth = 2.5;
    ctx.strokeRect(px, pz, pw, pl);

    // Door swing
    const dw = Math.min(pw * 0.25, 30);
    ctx.strokeStyle = isDark ? "rgba(200,240,160,0.5)" : "rgba(42,122,0,0.4)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(px + dw, pz + pl, dw, Math.PI * 1.5, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(px, pz + pl);
    ctx.lineTo(px + dw, pz + pl);
    ctx.stroke();

    // Labels
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = text;
    ctx.font = `500 ${Math.min(13, (pw / r.name.length) * 1.4)}px ${font}`;
    ctx.fillText(r.name, px + pw / 2, pz + pl / 2 - 7);
    ctx.fillStyle = muted;
    ctx.font = `${Math.min(10, pw / 8)}px ${font}`;
    ctx.fillText(`${r.w}×${r.l} ft`, px + pw / 2, pz + pl / 2 + 8);
  }

  // 10 ft scale bar
  const barPx = 10 * scale;
  const bx = PAD;
  const by = height - PAD / 2;
  ctx.strokeStyle = isDark ? "rgba(240,237,232,0.4)" : "rgba(26,26,24,0.4)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(bx, by);
  ctx.lineTo(bx + barPx, by);
  ctx.moveTo(bx, by - 4);
  ctx.lineTo(bx, by + 4);
  ctx.moveTo(bx + barPx, by - 4);
  ctx.lineTo(bx + barPx, by + 4);
  ctx.stroke();
  ctx.fillStyle = muted;
  ctx.font = `10px ${font}`;
  ctx.textBaseline = "alphabetic";
  ctx.fillText("10 ft", bx + barPx / 2, by - 8);
}
