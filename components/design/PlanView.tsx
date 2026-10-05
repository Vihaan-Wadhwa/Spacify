"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { downloadDataUrl } from "@/lib/browser";
import {
  GRID,
  HANDLE_CURSOR,
  MAX_SCALE,
  MIN_SCALE,
  drawPlan,
  fitViewport,
  handleAt,
  nearestWall,
  openingAt,
  openingOffset,
  resizeRoom,
  roomAt,
  snapMove,
  toPlan,
  type Guide,
  type Handle,
  type OpeningRef,
  type PlanOverlay,
  type Viewport,
} from "@/lib/plan";
import { OPENING_SIZE, wallLength, type Opening, type OpeningKind, type Room, type Wall } from "@/lib/rooms";
import type { Theme } from "@/components/ThemeProvider";

type Props = {
  rooms: Room[];
  floors: number;
  theme: Theme;
  projectName: string;
  selectedId: number | null;
  onSelectRoom: (id: number | null) => void;
  onUpdateRoom: (id: number, patch: Partial<Omit<Room, "id">>) => void;
  onExported: () => void;
};

/** "select" moves and resizes things; "door"/"window" place a new opening on the next wall clicked. */
type Tool = "select" | OpeningKind;

/** What the pointer is doing. Rooms being edited are drawn from `draft` and only committed on release. */
type Drag = { startX: number; startY: number; moved: boolean } & (
  | { kind: "pan"; view: Viewport }
  | { kind: "move"; room: Room; grabX: number; grabZ: number; draft: Room | null }
  | { kind: "resize"; room: Room; handle: Handle; draft: Room | null }
  | { kind: "opening"; room: Room; openingId: number; draft: Room | null }
);

const WALL_NAMES: Record<Wall, string> = { n: "north", e: "east", s: "south", w: "west" };
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Changes the scale by `factor`, keeping the plan point under (sx, sy) where it is. */
function zoomAt(view: Viewport, sx: number, sy: number, factor: number) {
  const p = toPlan(view, sx, sy);
  view.scale = clamp(view.scale * factor, MIN_SCALE, MAX_SCALE);
  view.ox = sx - p.x * view.scale;
  view.oy = sy - p.z * view.scale;
}

/**
 * The 2D plan editor: drag rooms to move them (they snap to each other's walls), drag the handles to resize,
 * and place, slide, resize or remove doors and windows. Scroll or pinch to zoom, drag empty space to pan.
 */
export function PlanView({ rooms, floors, theme, projectName, selectedId, onSelectRoom, onUpdateRoom, onExported }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [floor, setFloor] = useState(1);
  const [tool, setTool] = useState<Tool>("select");
  const [selOpening, setSelOpening] = useState<OpeningRef | null>(null);
  const shownFloor = Math.min(floor, floors);

  const floorRooms = useMemo(() => rooms.filter((r) => r.floor === shownFloor), [rooms, shownFloor]);
  const selectedRoom = floorRooms.find((r) => r.id === selectedId) ?? null;
  const activeOpening =
    (selOpening && selectedRoom?.id === selOpening.roomId && selectedRoom.openings.find((o) => o.id === selOpening.openingId)) || null;
  const emptyText = rooms.length ? `No rooms on floor ${shownFloor}` : "No rooms yet. Add one from the Rooms panel.";
  const isDark = theme === "dark";

  // Interaction state lives in refs: it changes on every pointer move and only the canvas needs it.
  /** null = fit the rooms on the next draw */
  const viewRef = useRef<Viewport | null>(null);
  const fittedEmpty = useRef(false);
  const sizeRef = useRef<{ width: number; height: number } | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const guidesRef = useRef<Guide[]>([]);
  const ghostRef = useRef<PlanOverlay["ghost"]>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<number | null>(null);
  const frame = useRef(0);

  // Latest render values for the draw loop and the document-level listeners.
  const latest = useRef({ floorRooms, selectedId, selOpening: activeOpening ? selOpening : null, isDark, emptyText });
  useEffect(() => {
    latest.current = { floorRooms, selectedId, selOpening: activeOpening ? selOpening : null, isDark, emptyText };
  });

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const s = latest.current;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }

    const prev = sizeRef.current;
    if (!viewRef.current || (fittedEmpty.current && s.floorRooms.length)) {
      viewRef.current = fitViewport(s.floorRooms, width, height);
      fittedEmpty.current = !s.floorRooms.length;
    } else if (prev && (prev.width !== width || prev.height !== height)) {
      // Keep what was in the middle in the middle when the canvas resizes.
      viewRef.current.ox += (width - prev.width) / 2;
      viewRef.current.oy += (height - prev.height) / 2;
    }
    sizeRef.current = { width, height };

    const drag = dragRef.current;
    const draft = drag && drag.kind !== "pan" ? drag.draft : null;
    const shown = draft ? s.floorRooms.map((r) => (r.id === draft.id ? draft : r)) : s.floorRooms;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawPlan(
      ctx,
      { width, height },
      shown,
      viewRef.current,
      s.isDark,
      { selectedId: s.selectedId, selectedOpening: s.selOpening, ghost: ghostRef.current, guides: guidesRef.current, interactive: true },
      s.emptyText
    );
  }, []);

  const requestDraw = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(draw);
  }, [draw]);

  // Fit the view when switching floors (declared before the redraw so it applies to it).
  useEffect(() => {
    viewRef.current = null;
  }, [shownFloor]);

  useEffect(() => {
    draw();
  }, [draw, floorRooms, selectedId, selOpening, isDark, emptyText]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const observer = new ResizeObserver(() => draw());
    observer.observe(canvas);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame.current);
    };
  }, [draw]);

  // Wheel zoom needs a non-passive listener so the page doesn't scroll.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const view = viewRef.current;
      if (!view) return;
      const rect = canvas.getBoundingClientRect();
      // Trackpad pinches arrive as ctrl+wheel with small deltas.
      zoomAt(view, e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
      requestDraw();
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [requestDraw]);

  // ─── Editing ──────────────────────────────────────────────

  function updateOpenings(room: Room, openings: Opening[]) {
    onUpdateRoom(room.id, { openings });
  }

  function addOpening(kind: OpeningKind, room: Room, wall: Wall, along: number) {
    const width = Math.min(OPENING_SIZE[kind].initial, wallLength(room, wall));
    const id = Math.max(0, ...room.openings.map((o) => o.id)) + 1;
    updateOpenings(room, [...room.openings, { id, kind, wall, offset: openingOffset(room, wall, along, width), width }]);
    onSelectRoom(room.id);
    setSelOpening({ roomId: room.id, openingId: id });
  }

  function removeOpening(room: Room, id: number) {
    updateOpenings(room, room.openings.filter((o) => o.id !== id));
    setSelOpening(null);
  }

  /** New width from the inspector, kept centred on the same spot and inside the wall. */
  function resizeOpening(room: Room, o: Opening, raw: string) {
    const value = parseFloat(raw);
    if (!Number.isFinite(value)) return;
    const len = wallLength(room, o.wall);
    const width = clamp(value, OPENING_SIZE[o.kind].min, Math.min(OPENING_SIZE[o.kind].max, len));
    const offset = clamp(o.offset + o.width / 2 - width / 2, 0, len - width);
    updateOpenings(room, room.openings.map((x) => (x.id === o.id ? { ...x, width, offset } : x)));
  }

  function chooseTool(next: Tool) {
    setTool((t) => (t === next && next !== "select" ? "select" : next));
    ghostRef.current = null;
    requestDraw();
  }

  function zoomBy(factor: number) {
    const view = viewRef.current;
    const size = sizeRef.current;
    if (!view || !size) return;
    zoomAt(view, size.width / 2, size.height / 2, factor);
    requestDraw();
  }

  function fit() {
    viewRef.current = null;
    requestDraw();
  }

  // ─── Pointer input ────────────────────────────────────────

  function canvasPoint(e: React.PointerEvent) {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { sx: e.clientX - rect.left, sy: e.clientY - rect.top };
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.pointerType === "mouse" && e.button !== 0 && e.button !== 1) return;
    const view = viewRef.current;
    if (!view) return;
    const { sx, sy } = canvasPoint(e);
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: sx, y: sy });

    // A second finger turns whatever was happening into a pinch zoom.
    if (pointers.current.size === 2) {
      dragRef.current = null;
      guidesRef.current = [];
      const [a, b] = [...pointers.current.values()];
      pinchRef.current = Math.hypot(a.x - b.x, a.y - b.y);
      requestDraw();
      return;
    }

    const p = toPlan(view, sx, sy);
    const tol = 7 / view.scale;
    const start = { startX: sx, startY: sy, moved: false };

    if (e.button === 1) {
      dragRef.current = { ...start, kind: "pan", view: { ...view } };
      return;
    }

    if (tool !== "select") {
      const hit = nearestWall(floorRooms, p.x, p.z, 12 / view.scale);
      if (hit) {
        addOpening(tool, hit.room, hit.wall, hit.along);
        setTool("select");
        ghostRef.current = null;
      }
      return;
    }

    // A selected door/window wins over a resize handle drawn on top of it; otherwise handles come first.
    const hitOpening = openingAt(floorRooms, p.x, p.z, tol, selectedId);
    const handle = selectedRoom && handleAt(selectedRoom, p.x, p.z, tol);
    if (selectedRoom && handle && hitOpening?.opening !== activeOpening) {
      dragRef.current = { ...start, kind: "resize", room: selectedRoom, handle, draft: null };
      return;
    }
    if (hitOpening) {
      onSelectRoom(hitOpening.room.id);
      setSelOpening({ roomId: hitOpening.room.id, openingId: hitOpening.opening.id });
      dragRef.current = { ...start, kind: "opening", room: hitOpening.room, openingId: hitOpening.opening.id, draft: null };
      return;
    }
    const room = roomAt(floorRooms, p.x, p.z, selectedId);
    setSelOpening(null);
    if (room) {
      if (room.id !== selectedId) onSelectRoom(room.id);
      dragRef.current = { ...start, kind: "move", room, grabX: p.x - room.x, grabZ: p.z - room.z, draft: null };
      return;
    }
    onSelectRoom(null);
    dragRef.current = { ...start, kind: "pan", view: { ...view } };
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const view = viewRef.current;
    if (!view) return;
    const canvas = e.currentTarget;
    const { sx, sy } = canvasPoint(e);

    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: sx, y: sy });
    if (pinchRef.current !== null && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      zoomAt(view, (a.x + b.x) / 2, (a.y + b.y) / 2, dist / pinchRef.current);
      pinchRef.current = dist;
      requestDraw();
      return;
    }

    const p = toPlan(view, sx, sy);
    const drag = dragRef.current;
    if (!drag) {
      updateHover(canvas, view, p);
      return;
    }
    // Ignore the jitter of a click so clicking a room doesn't snap it somewhere.
    if (!drag.moved && Math.hypot(sx - drag.startX, sy - drag.startY) < 3) return;
    drag.moved = true;

    const tol = 8 / view.scale;
    const others = drag.kind === "pan" ? [] : floorRooms.filter((r) => r.id !== drag.room.id);
    switch (drag.kind) {
      case "pan":
        canvas.style.cursor = "grabbing";
        view.ox = drag.view.ox + (sx - drag.startX);
        view.oy = drag.view.oy + (sy - drag.startY);
        break;
      case "move": {
        const snap = snapMove(drag.room, others, p.x - drag.grabX, p.z - drag.grabZ, tol);
        drag.draft = { ...drag.room, x: snap.x, z: snap.z };
        guidesRef.current = snap.guides;
        break;
      }
      case "resize": {
        const result = resizeRoom(drag.room, drag.handle, p.x, p.z, others, tol);
        drag.draft = result.room;
        guidesRef.current = result.guides;
        break;
      }
      case "opening": {
        // Slide along the wall, or onto another wall of the same room.
        const room = drag.room;
        const hit = nearestWall([room], p.x, p.z, 1000)!;
        drag.draft = {
          ...room,
          openings: room.openings.map((o) => {
            if (o.id !== drag.openingId) return o;
            const width = Math.min(o.width, wallLength(room, hit.wall));
            return { ...o, wall: hit.wall, width, offset: openingOffset(room, hit.wall, hit.along, width) };
          }),
        };
        break;
      }
    }
    requestDraw();
  }

  function updateHover(canvas: HTMLCanvasElement, view: Viewport, p: { x: number; z: number }) {
    if (tool !== "select") {
      const hit = nearestWall(floorRooms, p.x, p.z, 12 / view.scale);
      ghostRef.current = hit && {
        room: hit.room,
        opening: (() => {
          const width = Math.min(OPENING_SIZE[tool].initial, wallLength(hit.room, hit.wall));
          return { id: -1, kind: tool, wall: hit.wall, width, offset: openingOffset(hit.room, hit.wall, hit.along, width) };
        })(),
      };
      canvas.style.cursor = hit ? "copy" : "crosshair";
      requestDraw();
      return;
    }
    const tol = 7 / view.scale;
    const handle = selectedRoom && handleAt(selectedRoom, p.x, p.z, tol);
    canvas.style.cursor = handle
      ? HANDLE_CURSOR[handle]
      : openingAt(floorRooms, p.x, p.z, tol, selectedId)
        ? "grab"
        : roomAt(floorRooms, p.x, p.z, selectedId)
          ? "move"
          : "default";
  }

  function endPointer(e: React.PointerEvent<HTMLCanvasElement>, commit: boolean) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchRef.current = null;
    const drag = dragRef.current;
    dragRef.current = null;
    guidesRef.current = [];
    e.currentTarget.style.cursor = "default";
    if (commit && drag && drag.kind !== "pan" && drag.draft) {
      const { x, z, w, l, openings } = drag.draft;
      // The redraw happens when the new rooms come back down as props, so the draft never flickers back.
      onUpdateRoom(drag.draft.id, { x, z, w, l, openings });
    } else {
      requestDraw();
    }
  }

  function onPointerLeave() {
    if (!ghostRef.current) return;
    ghostRef.current = null;
    requestDraw();
  }

  // ─── Keyboard: Esc, Delete, arrow keys ────────────────────

  const onKey = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    onKey.current = (e) => {
      if (e.key === "Escape") {
        if (tool !== "select") chooseTool("select");
        else if (activeOpening) setSelOpening(null);
        else onSelectRoom(null);
      } else if ((e.key === "Delete" || e.key === "Backspace") && selectedRoom && activeOpening) {
        e.preventDefault();
        removeOpening(selectedRoom, activeOpening.id);
      } else if (e.key.startsWith("Arrow") && selectedRoom) {
        e.preventDefault();
        const step = e.shiftKey ? 5 : GRID;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dz = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        onUpdateRoom(selectedRoom.id, { x: selectedRoom.x + dx, z: selectedRoom.z + dz });
      }
    };
  });
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable='true']")) return;
      onKey.current(e);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  // ─── Export ───────────────────────────────────────────────

  /** Exports the floor fitted to the image, without the grid or selection. */
  function exportPlan() {
    const canvas = canvasRef.current!;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    const out = document.createElement("canvas");
    out.width = Math.round(width * dpr);
    out.height = Math.round(height * dpr);
    const ctx = out.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawPlan(
      ctx,
      { width, height },
      floorRooms,
      fitViewport(floorRooms, width, height),
      isDark,
      { selectedId: null, selectedOpening: null, ghost: null, guides: [], interactive: false },
      emptyText
    );
    downloadDataUrl(out.toDataURL("image/png"), `${projectName || "spacify-plan"}-floor${shownFloor}-2d.png`);
    onExported();
  }

  // ─── Render ───────────────────────────────────────────────

  let hint: React.ReactNode;
  if (tool !== "select") {
    hint = <span>Click a wall to place a {tool} · Esc to cancel</span>;
  } else if (selectedRoom && activeOpening) {
    const o = activeOpening;
    hint = (
      <>
        <span>
          {o.kind === "door" ? "Door" : "Window"} · {selectedRoom.name}, {WALL_NAMES[o.wall]} wall
        </span>
        <label className="plan-hint-field">
          Width
          <input
            key={`${o.id}-${o.width}`}
            type="number"
            step={0.5}
            min={OPENING_SIZE[o.kind].min}
            max={Math.min(OPENING_SIZE[o.kind].max, wallLength(selectedRoom, o.wall))}
            defaultValue={o.width}
            onBlur={(e) => resizeOpening(selectedRoom, o, e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
          ft
        </label>
        <button className="del-btn" onClick={() => removeOpening(selectedRoom, o.id)}>✕ Remove</button>
      </>
    );
  } else if (selectedRoom) {
    hint = (
      <span>
        <b>{selectedRoom.name}</b> · {selectedRoom.w}×{selectedRoom.l} ft · drag to move, handles to resize, arrow keys to nudge
      </span>
    );
  } else if (floorRooms.length) {
    hint = <span>Drag a room to move it · scroll to zoom · drag empty space to pan</span>;
  }

  return (
    <div className="plan-view">
      <div className="plan-toolbar">
        <div className="plan-tools" role="group" aria-label="Plan tools">
          <button className={`cam-btn small${tool === "select" ? " active" : ""}`} onClick={() => chooseTool("select")}>Select</button>
          <button className={`cam-btn small${tool === "door" ? " active" : ""}`} onClick={() => chooseTool("door")} disabled={!floorRooms.length}>
            + Door
          </button>
          <button className={`cam-btn small${tool === "window" ? " active" : ""}`} onClick={() => chooseTool("window")} disabled={!floorRooms.length}>
            + Window
          </button>
        </div>
        {floors > 1 &&
          Array.from({ length: floors }, (_, i) => i + 1).map((f) => (
            <button key={f} className={`cam-btn small${shownFloor === f ? " active" : ""}`} onClick={() => setFloor(f)}>
              Floor {f}
            </button>
          ))}
        <div className="spacer">
          <button className="cam-btn small" onClick={() => zoomBy(1 / 1.25)} aria-label="Zoom out">−</button>
          <button className="cam-btn small" onClick={() => zoomBy(1.25)} aria-label="Zoom in">+</button>
          <button className="cam-btn small" onClick={fit}>Fit</button>
          <button className="cam-btn" onClick={exportPlan}>Export PNG</button>
        </div>
      </div>
      <div className="plan-canvas-wrap">
        <canvas
          ref={canvasRef}
          className="plan-canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(e) => endPointer(e, true)}
          onPointerCancel={(e) => endPointer(e, false)}
          onPointerLeave={onPointerLeave}
        />
        {hint && <div className="plan-hint">{hint}</div>}
      </div>
    </div>
  );
}
