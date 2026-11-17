"use client";

import { useEffect, useRef, useState } from "react";
import { ROOM_SIZE, type Room } from "@/lib/rooms";
import { fitShape, straighten, traceDrawing, type Point, type Straightened } from "@/lib/shape";

type Props = {
  room: Room;
  /** `shape` null means a plain rectangle. */
  onApply: (shape: [number, number][] | null, w: number, l: number) => void;
  onClose: () => void;
};

const CW = 440, CH = 300;
const clampSize = (v: number) => Math.min(ROOM_SIZE.max, Math.max(ROOM_SIZE.min, Math.round(v * 2) / 2));

/**
 * Draw a room's outline with the mouse or a finger, or upload a photo of one drawn on paper. The rough line is
 * straightened into right-angled walls (shown over the drawing), sized to the room, and applied.
 */
export function ShapeModal({ room, onApply, onClose }: Props) {
  const [mode, setMode] = useState<"draw" | "photo">("draw");
  const [stroke, setStroke] = useState<Point[]>([]);
  const [photo, setPhoto] = useState<{ url: string; outline: Point[]; scale: number; ox: number; oy: number } | null>(null);
  const [result, setResult] = useState<Straightened | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [w, setW] = useState(room.w);
  const [l, setL] = useState(room.l);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef<Point[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const fitted = result ? fitShape(result.corners, w, l) : null;

  function recognise(points: Point[]) {
    const s = straighten(points);
    setResult(s);
    setMessage(s ? null : "Couldn't make a room out of that. Draw the outline in one go, going all the way round.");
  }

  // Redraw: the paper (photo or grid), the rough line, and the straightened shape with wall lengths.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = CW * dpr;
    canvas.height = CH * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(canvas);
    const accent = css.getPropertyValue("--accent").trim() || "#c8f0a0";
    ctx.fillStyle = css.getPropertyValue("--bg").trim() || "#111";
    ctx.fillRect(0, 0, CW, CH);

    const finish = () => {
      ctx.strokeStyle = "rgba(128,128,128,0.18)";
      ctx.lineWidth = 1;
      if (mode === "draw") {
        for (let x = 0; x <= CW; x += 20) { ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, CH); ctx.stroke(); }
        for (let y = 0; y <= CH; y += 20) { ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(CW, y + 0.5); ctx.stroke(); }
      }
      const line = mode === "draw" ? stroke : photo ? photo.outline.map((p) => ({ x: photo.ox + p.x * photo.scale, y: photo.oy + p.y * photo.scale })) : [];
      if (line.length) {
        ctx.strokeStyle = "rgba(160,160,160,0.7)";
        ctx.lineWidth = 2;
        ctx.lineJoin = "round";
        ctx.beginPath();
        line.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.stroke();
      }
      if (!result || !line.length) return;
      // The straightened shape, drawn over the rough one at the same place and size
      const xs = line.map((p) => p.x), ys = line.map((p) => p.y);
      const bx = Math.min(...xs), by = Math.min(...ys), bw = Math.max(...xs) - bx, bh = Math.max(...ys) - by;
      const corners = fitted ?? (result.corners.length === 4 ? result.corners : null);
      if (!corners) return;
      const pts = corners.map(([u, v]) => ({ x: bx + u * bw, y: by + v * bh }));
      ctx.strokeStyle = accent;
      ctx.lineWidth = 3;
      ctx.lineJoin = "miter";
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = accent;
      ctx.font = "11px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      corners.forEach(([u, v], i) => {
        const [nu, nv] = corners[(i + 1) % corners.length];
        const feet = Math.abs(nu - u) * w + Math.abs(nv - v) * l;
        const p = pts[i], q = pts[(i + 1) % pts.length];
        const horizontal = Math.abs(q.y - p.y) < 1;
        ctx.fillText(`${Math.round(feet * 2) / 2} ft`, (p.x + q.x) / 2 + (horizontal ? 0 : 18), (p.y + q.y) / 2 + (horizontal ? -10 : 0));
      });
    };

    if (mode === "photo" && photo) {
      const img = new Image();
      img.onload = () => {
        ctx.globalAlpha = 0.55;
        ctx.drawImage(img, photo.ox, photo.oy, img.width * photo.scale, img.height * photo.scale);
        ctx.globalAlpha = 1;
        finish();
      };
      img.src = photo.url;
    } else {
      finish();
    }
  }, [mode, stroke, photo, result, fitted, w, l]);

  function point(e: React.PointerEvent<HTMLCanvasElement>): Point {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * CW, y: ((e.clientY - rect.top) / rect.height) * CH };
  }

  function loadPhoto(file: File | undefined) {
    if (!file) return;
    setMessage(null);
    setResult(null);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      // Work on a small copy: plenty for an outline, and quick
      const k = Math.min(1, 320 / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0, c.width, c.height);
      const outline = traceDrawing(ctx.getImageData(0, 0, c.width, c.height));
      const scale = Math.min(CW / img.width, CH / img.height);
      const view = { url, scale, ox: (CW - img.width * scale) / 2, oy: (CH - img.height * scale) / 2 };
      // The outline is in the small copy's pixels; show it over the photo as drawn on the canvas
      setPhoto({ ...view, outline: (outline ?? []).map((p) => ({ x: p.x / k, y: p.y / k })) });
      if (!outline) setMessage("Couldn't find a closed outline. Draw it with a dark pen in one closed loop, and photograph it straight on.");
      else recognise(outline);
    };
    img.onerror = () => setMessage("Couldn't read that image. Try a JPG or PNG.");
    img.src = url;
  }

  function matchProportions() {
    if (result) setL(clampSize(w / result.aspect));
  }

  const recognisedRect = result && !fitted;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal shape-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`Shape of ${room.name}`}>
        <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        <h2>Shape of {room.name}</h2>
        <p className="modal-intro">Draw the room&rsquo;s outline in one go, or photograph one drawn on paper. Walls are straightened and corners squared up.</p>
        <div className="segmented" role="group" aria-label="How to give the shape">
          <button className={mode === "draw" ? "active" : undefined} onClick={() => { setMode("draw"); setResult(stroke.length ? straighten(stroke) : null); setMessage(null); }}>Draw</button>
          <button className={mode === "photo" ? "active" : undefined} onClick={() => { setMode("photo"); setResult(photo?.outline.length ? straighten(photo.outline) : null); setMessage(null); }}>From a photo</button>
        </div>
        <canvas
          ref={canvasRef}
          className={`shape-canvas${mode === "draw" ? " drawable" : ""}`}
          style={{ aspectRatio: `${CW} / ${CH}` }}
          onPointerDown={(e) => {
            if (mode !== "draw") return;
            e.currentTarget.setPointerCapture(e.pointerId);
            drawing.current = [point(e)];
            setStroke(drawing.current);
            setResult(null);
            setMessage(null);
          }}
          onPointerMove={(e) => {
            if (!drawing.current) return;
            drawing.current = [...drawing.current, point(e)];
            setStroke(drawing.current);
          }}
          onPointerUp={() => {
            if (!drawing.current) return;
            recognise(drawing.current);
            drawing.current = null;
          }}
          onClick={() => mode === "photo" && !photo && fileRef.current?.click()}
        />
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => loadPhoto(e.target.files?.[0])} />
        <div className="shape-status">
          {message ? (
            <span className="warn">{message}</span>
          ) : mode === "draw" && !stroke.length ? (
            <span>Draw on the grid. Go all the way round and finish near where you started.</span>
          ) : mode === "photo" && !photo ? (
            <button className="manual-btn" onClick={() => fileRef.current?.click()}>Choose a photo…</button>
          ) : recognisedRect ? (
            <span>That&rsquo;s a rectangle. Applying it keeps the room a plain rectangle.</span>
          ) : fitted ? (
            <span>{fitted.length} walls. Set the room&rsquo;s overall size below.</span>
          ) : null}
          {mode === "photo" && photo && <button className="del-btn" onClick={() => fileRef.current?.click()}>Another photo</button>}
          {mode === "draw" && stroke.length > 0 && <button className="del-btn" onClick={() => { setStroke([]); setResult(null); setMessage(null); }}>Clear</button>}
        </div>
        <div className="shape-size">
          <label>
            Overall width (ft)
            <input type="number" min={ROOM_SIZE.min} max={ROOM_SIZE.max} step={0.5} value={w} onChange={(e) => setW(clampSize(Number(e.target.value) || w))} />
          </label>
          <label>
            Overall length (ft)
            <input type="number" min={ROOM_SIZE.min} max={ROOM_SIZE.max} step={0.5} value={l} onChange={(e) => setL(clampSize(Number(e.target.value) || l))} />
          </label>
          <button className="manual-btn" disabled={!result} onClick={matchProportions} title="Set the length so the room has the drawing's proportions">
            Match drawing
          </button>
        </div>
        <div className="shape-actions">
          {room.shape && (
            <button className="manual-btn" onClick={() => onApply(null, w, l)}>Make it a rectangle</button>
          )}
          <button className="manual-btn" onClick={onClose}>Cancel</button>
          <button className="upload-btn" disabled={!result} onClick={() => onApply(fitted, w, l)}>Use this shape</button>
        </div>
      </div>
    </div>
  );
}
