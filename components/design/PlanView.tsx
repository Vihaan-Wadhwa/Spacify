"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { downloadDataUrl } from "@/lib/browser";
import {
  GRID,
  HANDLE_CURSOR,
  alongWall,
  dragOpeningEnd,
  MAX_SCALE,
  MIN_SCALE,
  drawPlan,
  fitViewport,
  furnitureAt,
  handleAt,
  nearestWall,
  openingAt,
  openingHandleAt,
  openingOffset,
  resizeRoom,
  roomAt,
  setDoorSize,
  snapMove,
  toPlan,
  type Guide,
  type Handle,
  type ItemRef,
  type OpeningRef,
  type PlanOverlay,
  type RoomFurniture,
  type Viewport,
} from "@/lib/plan";
import { clampToRoom } from "@/lib/furniture";
import {
  DOOR_WIDTHS,
  FURNITURE,
  OPENING_SIZE,
  doorPartner,
  isSecondLeaf,
  removesWall,
  sharedSpans,
  wallEdge,
  wallLength,
  wallLine,
  type FurnitureItem,
  type Opening,
  type OpeningKind,
  type Room,
  type RoomDesign,
  type Wall,
  type WallKey,
} from "@/lib/rooms";
import type { Theme } from "@/components/ThemeProvider";

type Props = {
  rooms: Room[];
  floors: number;
  theme: Theme;
  projectName: string;
  selectedId: number | null;
  designs: Record<number, RoomDesign>;
  selectedItem: ItemRef | null;
  onSelectRoom: (id: number | null) => void;
  onUpdateRoom: (id: number, patch: Partial<Omit<Room, "id">>) => void;
  onSelectItem: (item: ItemRef | null) => void;
  onMoveItem: (item: ItemRef, x: number, z: number) => void;
  onRotateItem: (item: ItemRef) => void;
  onRemoveItem: (item: ItemRef) => void;
  onExported: () => void;
};

/**
 * "select" moves and resizes things; "door"/"window"/"open" place a new opening on the next wall clicked;
 * "unwall" removes the wall clicked between two rooms, joining them into one space.
 */
type Tool = "select" | OpeningKind | "unwall";

const KIND_NAMES: Record<OpeningKind, string> = { door: "door", window: "window", open: "opening" };

/** What the pointer is doing. Rooms being edited are drawn from `draft` and only committed on release. */
type Drag = { startX: number; startY: number; moved: boolean } & (
  | { kind: "pan"; view: Viewport }
  | { kind: "move"; room: Room; grabX: number; grabZ: number; draft: Room | null }
  | { kind: "resize"; room: Room; handle: Handle; draft: Room | null }
  | { kind: "opening"; room: Room; openingId: number; draft: Room | null }
  | { kind: "openingEnd"; room: Room; openingId: number; end: "start" | "end"; draft: Room | null; selectId: number }
  | { kind: "item"; room: Room; item: FurnitureItem; grabX: number; grabZ: number; draft: Room | null; at: { x: number; z: number } | null }
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
export function PlanView(props: Props) {
  const { rooms, floors, theme, projectName, selectedId, designs, selectedItem, onSelectRoom, onUpdateRoom, onSelectItem, onExported } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [floor, setFloor] = useState(1);
  const [tool, setTool] = useState<Tool>("select");
  const [selOpening, setSelOpening] = useState<OpeningRef | null>(null);
  const [showFurniture, setShowFurniture] = useState(true);
  /** A one-off message in the hint bar (e.g. after removing a wall); cleared by the next action. */
  const [notice, setNotice] = useState<string | null>(null);
  const shownFloor = Math.min(floor, floors);

  const floorRooms = useMemo(() => rooms.filter((r) => r.floor === shownFloor), [rooms, shownFloor]);
  const furniture = useMemo<RoomFurniture[]>(
    () => floorRooms.flatMap((room) => (designs[room.id]?.furniture?.length ? [{ room, items: designs[room.id].furniture! }] : [])),
    [floorRooms, designs]
  );
  const activeItem = (selectedItem && furniture.find((f) => f.room.id === selectedItem.roomId)?.items.find((i) => i.id === selectedItem.itemId)) || null;
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
  const shownItems = showFurniture ? furniture : null;
  const latest = useRef({ floorRooms, selectedId, selOpening: activeOpening ? selOpening : null, isDark, emptyText, furniture: shownItems, selectedItem });
  useEffect(() => {
    latest.current = { floorRooms, selectedId, selOpening: activeOpening ? selOpening : null, isDark, emptyText, furniture: shownItems, selectedItem };
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
    // Furniture follows a room being dragged, and a piece being dragged is drawn where it is now.
    const itemDrag = drag?.kind === "item" ? drag : null;
    const furnitureShown =
      s.furniture?.map((f) => ({
        room: shown.find((r) => r.id === f.room.id) ?? f.room,
        items: itemDrag && itemDrag.room.id === f.room.id && itemDrag.at ? f.items.map((i) => (i.id === itemDrag.item.id ? { ...i, ...itemDrag.at } : i)) : f.items,
      })) ?? null;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawPlan(
      ctx,
      { width, height },
      shown,
      viewRef.current,
      s.isDark,
      { selectedId: s.selectedId, selectedOpening: s.selOpening, ghost: ghostRef.current, guides: guidesRef.current, furniture: furnitureShown, selectedItem: s.selectedItem, interactive: true },
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
  }, [draw, floorRooms, selectedId, selOpening, isDark, emptyText, shownItems, selectedItem]);

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

  function addOpening(kind: OpeningKind, room: Room, wall: WallKey, along: number) {
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

  /** The stretch of `wall` (plan feet) shared with another room at `along` feet from the wall's start, and that room. */
  function sharedAt(room: Room, wall: WallKey, along: number) {
    const at = wallLine(room, wall).from + along;
    for (const other of floorRooms) {
      if (other.id === room.id) continue;
      const span = sharedSpans(room, wall, [other]).find(([a, b]) => at >= a - 0.05 && at <= b + 0.05);
      if (span) return { span, other };
    }
    return null;
  }

  /**
   * Removes the wall between `room` and the room on the other side at `along`: one open gap across the whole shared
   * stretch, replacing any doors and windows in it (on both sides).
   */
  function removeWall(room: Room, wall: WallKey, along: number) {
    const hit = sharedAt(room, wall, along);
    if (!hit) {
      setNotice("Only a wall between two rooms can be removed. Use + Opening for a gap in an outside wall.");
      return;
    }
    const [a, b] = hit.span;
    const line = wallLine(room, wall);
    /** A room's openings, minus any on this wall line within [a, b]. */
    const keep = (r: Room) =>
      r.openings.filter((o) => {
        const ol = wallLine(r, o.wall);
        if (ol.axis !== line.axis || Math.abs(ol.at - line.at) > 0.1) return true;
        const start = ol.from + o.offset;
        return start + o.width <= a + 0.05 || start >= b - 0.05;
      });
    const id = Math.max(0, ...room.openings.map((o) => o.id)) + 1;
    onUpdateRoom(room.id, { openings: [...keep(room), { id, kind: "open", wall, offset: Math.round((a - line.from) * 100) / 100, width: Math.round((b - a) * 100) / 100 }] });
    onUpdateRoom(hit.other.id, { openings: keep(hit.other) });
    onSelectRoom(room.id);
    setSelOpening({ roomId: room.id, openingId: id });
    setNotice(`Wall between ${room.name} and ${hit.other.name} removed. They're one space now, so their finishes are designed together.`);
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
    setNotice(null);
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
        if (tool === "unwall") removeWall(hit.room, hit.wall, hit.along);
        else addOpening(tool, hit.room, hit.wall, hit.along);
        setTool("select");
        ghostRef.current = null;
      }
      return;
    }
    setNotice(null);

    // The selected door/window/opening's end handles come first: drag one to resize it.
    if (selectedRoom && activeOpening) {
      const end = openingHandleAt(selectedRoom, activeOpening, p.x, p.z, tol * 1.3);
      if (end) {
        dragRef.current = { ...start, kind: "openingEnd", room: selectedRoom, openingId: activeOpening.id, end, draft: null, selectId: activeOpening.id };
        return;
      }
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
      onSelectItem(null);
      setSelOpening({ roomId: hitOpening.room.id, openingId: hitOpening.opening.id });
      dragRef.current = { ...start, kind: "opening", room: hitOpening.room, openingId: hitOpening.opening.id, draft: null };
      return;
    }
    const hitItem = showFurniture ? furnitureAt(furniture, p.x, p.z, selectedItem) : null;
    setSelOpening(null);
    if (hitItem) {
      if (hitItem.room.id !== selectedId) onSelectRoom(hitItem.room.id);
      onSelectItem({ roomId: hitItem.room.id, itemId: hitItem.item.id });
      const { room, item } = hitItem;
      dragRef.current = { ...start, kind: "item", room, item, grabX: p.x - room.x - item.x, grabZ: p.z - room.z - item.z, draft: null, at: null };
      return;
    }
    onSelectItem(null);
    const room = roomAt(floorRooms, p.x, p.z, selectedId);
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
      case "openingEnd": {
        const o = drag.room.openings.find((x) => x.id === drag.openingId);
        if (!o) break;
        const result = dragOpeningEnd(drag.room, o, drag.end, alongWall(drag.room, o.wall, p.x, p.z));
        drag.draft = { ...drag.room, openings: result.openings };
        drag.selectId = result.selectId;
        break;
      }
      case "item": {
        drag.at = clampToRoom(drag.room, drag.item, p.x - drag.room.x - drag.grabX, p.z - drag.room.z - drag.grabZ);
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
    if (tool === "unwall") {
      // Preview the whole shared stretch that would open up
      const hit = nearestWall(floorRooms, p.x, p.z, 12 / view.scale);
      const shared = hit && sharedAt(hit.room, hit.wall, hit.along);
      const from = hit && wallLine(hit.room, hit.wall).from;
      ghostRef.current = hit && shared ? { room: hit.room, opening: { id: -1, kind: "open", wall: hit.wall, offset: shared.span[0] - from!, width: shared.span[1] - shared.span[0] } } : null;
      canvas.style.cursor = shared ? "pointer" : hit ? "not-allowed" : "crosshair";
      requestDraw();
      return;
    }
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
    const openingEnd = selectedRoom && activeOpening && openingHandleAt(selectedRoom, activeOpening, p.x, p.z, tol * 1.3);
    if (openingEnd) {
      canvas.style.cursor = wallEdge(selectedRoom, activeOpening.wall).axis === "x" ? "ew-resize" : "ns-resize";
      return;
    }
    const handle = selectedRoom && handleAt(selectedRoom, p.x, p.z, tol);
    canvas.style.cursor = handle
      ? HANDLE_CURSOR[handle]
      : openingAt(floorRooms, p.x, p.z, tol, selectedId) || (showFurniture && furnitureAt(furniture, p.x, p.z, selectedItem))
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
    if (commit && drag?.kind === "item" && drag.at) {
      props.onMoveItem({ roomId: drag.room.id, itemId: drag.item.id }, drag.at.x, drag.at.z);
      requestDraw();
    } else if (commit && drag && drag.kind !== "pan" && drag.draft) {
      if (drag.kind === "openingEnd") setSelOpening({ roomId: drag.room.id, openingId: drag.selectId });
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
        else if (activeItem) onSelectItem(null);
        else onSelectRoom(null);
      } else if ((e.key === "Delete" || e.key === "Backspace") && selectedRoom && activeOpening) {
        e.preventDefault();
        removeOpening(selectedRoom, activeOpening.id);
      } else if ((e.key === "Delete" || e.key === "Backspace") && activeItem && selectedItem && showFurniture) {
        e.preventDefault();
        props.onRemoveItem(selectedItem);
      } else if ((e.key === "r" || e.key === "R") && !e.ctrlKey && !e.metaKey && activeItem && selectedItem && showFurniture) {
        props.onRotateItem(selectedItem);
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
      { selectedId: null, selectedOpening: null, ghost: null, guides: [], furniture: shownItems, selectedItem: null, interactive: false },
      emptyText
    );
    downloadDataUrl(out.toDataURL("image/png"), `${projectName || "spacify-plan"}-floor${shownFloor}-2d.png`);
    onExported();
  }

  // ─── Render ───────────────────────────────────────────────

  let hint: React.ReactNode;
  if (tool === "unwall") {
    hint = <span>Click a wall between two rooms to remove it and join them · Esc to cancel</span>;
  } else if (tool !== "select") {
    hint = <span>Click a wall to place {tool === "open" ? "an opening (no door)" : `a ${KIND_NAMES[tool]}`} · Esc to cancel</span>;
  } else if (notice) {
    hint = <span>{notice}</span>;
  } else if (activeItem && selectedItem && showFurniture) {
    hint = (
      <>
        <span>
          <b>{FURNITURE[activeItem.type].label}</b> · drag to move · R to rotate
        </span>
        <button className="del-btn" onClick={() => props.onRotateItem(selectedItem)}>↻ Rotate</button>
        <button className="del-btn" onClick={() => props.onRemoveItem(selectedItem)}>✕ Remove</button>
      </>
    );
  } else if (selectedRoom && activeOpening) {
    const o = activeOpening;
    const pair = o.kind === "door" && (isSecondLeaf(selectedRoom.openings, o) || !!doorPartner(selectedRoom.openings, o));
    const start = wallLine(selectedRoom, o.wall).from + o.offset;
    const gone = o.kind === "open" && removesWall(selectedRoom, o.wall, start, start + o.width, floorRooms);
    const label = o.kind === "door" ? (pair ? "One leaf of a double door" : "Door") : o.kind === "window" ? "Window" : gone ? "Removed wall" : "Opening (no door)";
    hint = (
      <>
        <span>
          {label} · {selectedRoom.name}, {WALL_NAMES[wallEdge(selectedRoom, o.wall).dir]} wall
          {pair && " · remove it to make a single door"}
          {gone && " · remove it to put the wall back"}
        </span>
        {o.kind === "door" ? (
          <span className="segmented small" role="group" aria-label="Door size">
            {(["single", "double"] as const).map((size) => {
              const active = (pair ? "double" : "single") === size;
              return (
                <button
                  key={size}
                  className={active ? "active" : undefined}
                  aria-pressed={active}
                  onClick={() => {
                    if (active) return;
                    const result = setDoorSize(selectedRoom, o, size);
                    updateOpenings(selectedRoom, result.openings);
                    setSelOpening({ roomId: selectedRoom.id, openingId: result.selectId });
                  }}
                >
                  {size === "single" ? `Single ${DOOR_WIDTHS.single} ft` : `Double ${DOOR_WIDTHS.double} ft`}
                </button>
              );
            })}
          </span>
        ) : (
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
        )}
        <span className="plan-hint-tip">drag the dots to {o.kind === "door" ? "switch size" : "resize"}</span>
        <button className="del-btn" onClick={() => removeOpening(selectedRoom, o.id)}>{gone ? "↺ Put wall back" : "✕ Remove"}</button>
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
          <button
            className={`cam-btn small${tool === "open" ? " active" : ""}`}
            onClick={() => chooseTool("open")}
            disabled={!floorRooms.length}
            title="A gap in a wall with no door: a passage or an archway"
          >
            + Opening
          </button>
          <button
            className={`cam-btn small${tool === "unwall" ? " active" : ""}`}
            onClick={() => chooseTool("unwall")}
            disabled={floorRooms.length < 2}
            title="Remove the wall between two rooms to make one space (e.g. an L-shaped kitchen)"
          >
            Remove wall
          </button>
        </div>
        <button
          className={`toggle-pill${showFurniture ? " on" : ""}`}
          aria-pressed={showFurniture}
          onClick={() => {
            setShowFurniture((v) => !v);
            onSelectItem(null);
          }}
        >
          <span className="toggle-dot" />
          Furniture
        </button>
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
