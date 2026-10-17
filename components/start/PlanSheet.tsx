"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type WheelEvent as RWheelEvent } from "react";
import type { PlanOption } from "@/lib/planner";
import { planSheetPng, planSheetSvg, type SheetMeta } from "@/lib/planSheet";
import type { PlanRoom } from "@/lib/start";

const FLOOR_NAMES = ["Ground floor", "First floor", "Second floor"];
const fileName = (title: string, ext: string) => `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.${ext}`;
const r1 = (v: number) => Math.round(v * 10) / 10;

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function kind(name: string) {
  if (/Bedroom/.test(name)) return "bed";
  if (/Living|Dining/.test(name)) return "live";
  if (/Kitchen|Store|Utility/.test(name)) return "cook";
  if (/Bathroom/.test(name)) return "wet";
  if (/Pooja/.test(name)) return "pooja";
  if (/Balcony|Terrace/.test(name)) return "out";
  return "move";
}

type Picked = { room: PlanRoom; key: string } | null;

/**
 * The picked plan as a live 2D drawing: hover or tap a room for its size, click to pin it, scroll or use the
 * buttons to zoom, drag to pan. The downloads are a clean drawing sheet of the same plan (lib/planSheet.ts).
 */
export function PlanSheet({ option, meta, on3d }: { option: PlanOption; meta: SheetMeta; on3d: () => void }) {
  const [note, setNote] = useState<string | null>(null);
  const [hover, setHover] = useState<Picked>(null);
  const [pinned, setPinned] = useState<Picked>(null);
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const drag = useRef<{ px: number; py: number; x: number; y: number; moved: boolean } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const canShare = typeof navigator !== "undefined" && "share" in navigator;

  // Layout in feet: floors side by side with a gap, the plot around each
  const p = option.plotRect;
  const floors = Math.max(...option.rooms.map((r) => r.floor));
  // Floors sit side by side, or stacked on a narrow screen so each stays readable
  const [stacked, setStacked] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const update = () => setStacked(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  const gapFt = Math.max(8, (stacked ? p.l : p.w) * 0.18);
  const margin = 6;
  const vbW = stacked ? p.w + margin * 2 : p.w * floors + gapFt * (floors - 1) + margin * 2;
  const vbH = stacked ? p.l * floors + gapFt * (floors - 1) + margin * 2 + 4 : p.l + margin * 2 + 4;

  const sheet = useMemo(() => planSheetSvg(option, meta), [option, meta]);

  async function png() {
    try {
      save(await planSheetPng(sheet.svg, sheet.width, sheet.height), fileName(meta.title, "png"));
    } catch (e) {
      setNote((e as Error).message);
    }
  }

  async function share() {
    try {
      const blob = await planSheetPng(sheet.svg, sheet.width, sheet.height);
      const file = new File([blob], fileName(meta.title, "png"), { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: meta.title, text: meta.subtitle });
      else save(blob, file.name);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setNote("Couldn't open sharing here, so the image was saved instead.");
    }
  }

  // Zoom about a point given in viewBox units
  const zoomBy = (f: number, cx = vbW / 2, cy = vbH / 2) =>
    setView((v) => {
      const k = Math.min(6, Math.max(1, v.k * f));
      const s = k / v.k;
      return k === 1 ? { k: 1, x: 0, y: 0 } : { k, x: cx - (cx - v.x) * s, y: cy - (cy - v.y) * s };
    });
  const toVb = (clientX: number, clientY: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    const scale = Math.max(vbW / r.width, vbH / r.height);
    return { x: (clientX - r.left - (r.width - vbW / scale) / 2) * scale, y: (clientY - r.top - (r.height - vbH / scale) / 2) * scale, scale };
  };
  function onWheel(e: RWheelEvent<SVGSVGElement>) {
    const { x, y } = toVb(e.clientX, e.clientY);
    zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, x, y);
  }
  function onDown(e: RPointerEvent<SVGSVGElement>) {
    if (view.k === 1) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, x: view.x, y: view.y, moved: false };
  }
  function onMove(e: RPointerEvent<SVGSVGElement>) {
    const d = drag.current;
    if (!d) return;
    const { scale } = toVb(e.clientX, e.clientY);
    const dx = (e.clientX - d.px) * scale;
    const dy = (e.clientY - d.py) * scale;
    if (Math.abs(dx) + Math.abs(dy) > 0.5) d.moved = true;
    setView((v) => ({ ...v, x: d.x + dx, y: d.y + dy }));
  }
  const onUp = () => {
    setTimeout(() => (drag.current = null), 0);
  };

  const shown = hover ?? pinned;
  const pick = (room: PlanRoom, key: string) => {
    if (drag.current?.moved) return;
    setPinned((cur) => (cur?.key === key ? null : { room, key }));
  };

  return (
    <div className="st-sheet" role="region" aria-label={`${meta.title}: floor plan`}>
      <div className="st-sheet-paper">
        <div className="st-sheet-head">
          <div>
            <p className="st-sheet-title">{meta.title}</p>
            <p className="st-sheet-sub">{meta.subtitle}</p>
          </div>
          <div className="st-sheet-zoom" role="group" aria-label="Zoom">
            <button type="button" onClick={() => zoomBy(1.3)} aria-label="Zoom in">
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 10h10M10 5v10" /></svg>
            </button>
            <button type="button" onClick={() => zoomBy(1 / 1.3)} aria-label="Zoom out" disabled={view.k === 1}>
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 10h10" /></svg>
            </button>
            <button type="button" onClick={() => setView({ k: 1, x: 0, y: 0 })} disabled={view.k === 1}>
              Fit
            </button>
          </div>
        </div>

        <svg
          ref={svgRef}
          className={`st-plan${view.k > 1 ? " is-zoomed" : ""}`}
          viewBox={`0 0 ${vbW} ${vbH}`}
          onWheel={onWheel}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerLeave={onUp}
          role="group"
          aria-label="Floor plan. Rooms can be selected for their sizes."
        >
          <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
            {Array.from({ length: floors }, (_, i) => {
              const f = i + 1;
              const ox = margin + (stacked ? 0 : i * (p.w + gapFt)) - p.x;
              const oy = margin + 3 + (stacked ? i * (p.l + gapFt) : 0) - p.z;
              const rooms = option.rooms.filter((r) => r.floor === f);
              return (
                <g key={f} transform={`translate(${ox} ${oy})`}>
                  {floors > 1 && (
                    <text className="st-plan-floor" x={p.x} y={p.z - 1.6}>
                      {FLOOR_NAMES[i] ?? `Floor ${f}`}
                    </text>
                  )}
                  <rect className="st-plan-plot" x={p.x} y={p.z} width={p.w} height={p.l} />
                  {rooms.map((r, j) => {
                    const key = `${f}-${j}`;
                    const on = shown?.key === key;
                    const label = r.name !== "Passage" && r.w >= 5 && r.l >= 4;
                    const fs = Math.max(0.9, Math.min(1.5, r.w / Math.max(6, r.name.length) * 1.4));
                    return (
                      <g
                        key={key}
                        className={`st-plan-room is-${kind(r.name)}${on ? " is-on" : ""}${pinned?.key === key ? " is-pinned" : ""}`}
                        tabIndex={0}
                        role="button"
                        aria-label={`${r.name}, ${r1(r.w)} by ${r1(r.l)} feet, ${FLOOR_NAMES[i]?.toLowerCase() ?? `floor ${f}`}`}
                        onPointerEnter={() => setHover({ room: r, key })}
                        onPointerLeave={() => setHover(null)}
                        onFocus={() => setHover({ room: r, key })}
                        onBlur={() => setHover(null)}
                        onClick={() => pick(r, key)}
                        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), pick(r, key))}
                      >
                        <rect x={r.x} y={r.z} width={r.w} height={r.l} />
                        {label && (
                          <text x={r.x + r.w / 2} y={r.z + r.l / 2} fontSize={fs}>
                            {r.w < 9 ? r.name.replace(" Room", "").replace("Master Bedroom", "Master") : r.name}
                          </text>
                        )}
                        {label && r.l >= 7 && r.w >= 7 && (
                          <text className="st-plan-dim" x={r.x + r.w / 2} y={r.z + r.l / 2 + fs * 1.15} fontSize={fs * 0.8}>
                            {r1(r.w)} × {r1(r.l)}
                          </text>
                        )}
                      </g>
                    );
                  })}
                </g>
              );
            })}
          </g>
        </svg>

        <p className="st-sheet-info" aria-live="polite">
          {shown ? (
            <>
              <strong>{shown.room.name}</strong> · {r1(shown.room.w)} × {r1(shown.room.l)} ft · {Math.round(shown.room.w * shown.room.l)} sq ft ·{" "}
              {FLOOR_NAMES[shown.room.floor - 1]?.toLowerCase()}
            </>
          ) : (
            "Hover or tap a room for its size. Scroll to zoom, drag to move around."
          )}
        </p>
      </div>

      <div className="st-sheet-bar">
        <button type="button" className="st-sheet-btn is-main" onClick={png}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3v10M6 9l4 4 4-4M4 16h12" /></svg>
          Download PNG
        </button>
        <button type="button" className="st-sheet-btn" onClick={() => save(new Blob([sheet.svg], { type: "image/svg+xml" }), fileName(meta.title, "svg"))}>
          SVG for print
        </button>
        {canShare && (
          <button type="button" className="st-sheet-btn" onClick={share}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 13V3M6 7l4-4 4 4M4 11v5h12v-5" /></svg>
            Share
          </button>
        )}
        <button type="button" className="st-sheet-btn" onClick={on3d}>
          View in 3D
        </button>
      </div>
      {note && <p className="st-note">{note}</p>}
    </div>
  );
}
