"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "@/components/ThemeProvider";
import type { CurrentUser } from "@/lib/auth";
import { downloadDataUrl } from "@/lib/browser";
import { DEMO_ROOMS } from "@/lib/demoPlan";
import type { Access, SaveResult, SavedProject } from "@/lib/projects";
import { addStairs, bestSpot, removeStairCopies } from "@/lib/floors";
import { addFurniture, clampToRoom, placeFurniture, typicalFurniture } from "@/lib/furniture";
import {
  DEFAULT_COUNTERTOP,
  DEFAULT_LAYERS,
  FURNITURE,
  MAX_FLOORS,
  ROOM_DEFAULTS,
  ROOM_SIZE,
  defaultDesign,
  defaultOpenings,
  describeProject,
  fitOpenings,
  freeSpot,
  joinedGroups,
  placeRooms,
  remapOpenings,
  splitWideDoors,
  totalArea,
  wallCuts,
  windowsOutside,
  WALLS,
  type CameraPreset,
  type FloorView,
  type FurnitureItem,
  type FurnitureType,
  type LayerName,
  type Layers,
  type Room,
  type RoomDesign,
  type RoomDraft,
  type Rotation,
  type StudioTab,
} from "@/lib/rooms";
import type { ItemRef } from "@/lib/scene/SpacifyScene";
import { HANDOFF_KEY, type Handoff } from "@/lib/start";
import { ArchitectureView } from "./ArchitectureView";
import { CanvasOverlays } from "./CanvasOverlays";
import { ChatView } from "./ChatView";
import { InteriorPanel } from "./InteriorPanel";
import { PlanView } from "./PlanView";
import { RoomList } from "./RoomList";
import { RoomPanel } from "./RoomPanel";
import { ShapeModal } from "./ShapeModal";
import { ThreeCanvas, type ThreeCanvasHandle } from "./ThreeCanvas";
import { Topbar, type SaveState } from "./Topbar";
import { TutorialModal } from "./TutorialModal";
import { UploadFlow } from "./UploadFlow";

type Props = {
  /** Start with sample rooms (not saved). */
  demo: boolean;
  /** Who's logged in; null only in the demo, where saving then asks you to log in. */
  user: CurrentUser | null;
  /** Project loaded from PostgreSQL by the page, or null for a new one. */
  initialProject: SavedProject | null;
  /** Its room designs from MongoDB, keyed by room id. */
  initialDesigns: Record<number, RoomDesign>;
  /** Why the requested project couldn't be loaded (e.g. database down). */
  loadError: string | null;
  /** Why its designs couldn't be loaded (e.g. MongoDB down); the rooms still load. */
  designsError: string | null;
};

type Snapshot = { name: string; floors: number; rooms: Room[]; designs: Record<number, RoomDesign> };

/** Designs of the snapshot's rooms only, in room order. */
const roomDesigns = (s: Snapshot) => Object.fromEntries(s.rooms.filter((r) => s.designs[r.id]).map((r) => [r.id, s.designs[r.id]]));

/** What gets compared to decide whether there are unsaved changes. */
const snapshotKey = (s: Snapshot) => JSON.stringify({ name: s.name.trim(), floors: s.floors, rooms: s.rooms, designs: roomDesigns(s) });

/** The rooms the page opens with. Wide doors are shown as a pair of leaves (see splitWideDoors). */
function initialRooms(demo: boolean, project: SavedProject | null): Room[] {
  const rooms = project ? project.rooms : demo ? DEMO_ROOMS.map((r, i) => ({ ...r, id: i + 1 })) : [];
  return rooms.map((r) => ({ ...r, openings: splitWideDoors(r.openings) }));
}

/**
 * The design page. All project state lives here and flows down to the panels and the 3D canvas.
 * Saving sends name, floors and rooms (PostgreSQL) and the rooms' designs (MongoDB) to /api/projects in one request.
 */
export function DesignStudio({ demo, user, initialProject, initialDesigns, loadError, designsError }: Props) {
  const { theme } = useTheme();

  // ─── Project state ───────────────────────────────────────
  const [rooms, setRooms] = useState<Room[]>(() => initialRooms(demo, initialProject));
  const [floors, setFloorsState] = useState(initialProject?.floors ?? 1);
  const [designs, setDesigns] = useState<Record<number, RoomDesign>>(initialDesigns);
  const [projectName, setProjectName] = useState(initialProject?.name ?? "Untitled Project");
  const nextId = useRef(Math.max(0, ...initialRooms(demo, initialProject).map((r) => r.id)) + 1);

  // ─── Persistence state ───────────────────────────────────
  const [projectId, setProjectId] = useState<number | null>(initialProject?.id ?? null);
  const [access, setAccess] = useState<Access>(initialProject?.access ?? "owner");
  const [savedKey, setSavedKey] = useState<string | null>(() =>
    initialProject ? snapshotKey({ ...initialProject, rooms: initialRooms(false, initialProject), designs: initialDesigns }) : null
  );
  const [saving, setSaving] = useState(false);

  // ─── UI state ────────────────────────────────────────────
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [layers, setLayers] = useState<Layers>(DEFAULT_LAYERS);
  const [camera, setCamera] = useState<CameraPreset>("persp");
  const [tab, setTabState] = useState<StudioTab>("floor");
  const [floorView, setFloorView] = useState<FloorView>("3d");
  const [aiOpen, setAiOpen] = useState(false);
  // null = not toggled yet: CSS decides (open on desktop, closed on phones)
  const [panelOpen, setPanelOpen] = useState<boolean | null>(null);
  const [viewFloor, setViewFloor] = useState<number | null>(null);
  const [selectedItem, setSelectedItem] = useState<ItemRef | null>(null);
  const [walking, setWalking] = useState(false);
  const [walkRoomId, setWalkRoomId] = useState<number | null>(null);
  /** Interior Design is editing every room at once. */
  const [wholeHome, setWholeHome] = useState(false);
  /** The room whose shape is being drawn, if any. */
  const [shapeRoomId, setShapeRoomId] = useState<number | null>(null);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [toast, setToast] = useState<string | null>(
    loadError ? `Couldn't load the project: ${loadError}` : designsError ? `Finishes couldn't be loaded, so defaults are shown: ${designsError}` : null
  );

  const canvasRef = useRef<ThreeCanvasHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const addSelectRef = useRef<HTMLSelectElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const withIds = useCallback((list: Omit<Room, "id">[]): Room[] => list.map((r) => ({ ...r, id: nextId.current++ })), []);

  const showToast = useCallback((msg: string, ms = 2500) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), ms);
  }, []);

  // A plan chosen on /start opens here as a new, unsaved project (once; the hand-off is removed after reading).
  useEffect(() => {
    if (demo || initialProject) return;
    let handoff: Handoff | null = null;
    try {
      handoff = JSON.parse(sessionStorage.getItem(HANDOFF_KEY) ?? "null") as Handoff | null;
      sessionStorage.removeItem(HANDOFF_KEY);
    } catch {
      return;
    }
    if (!handoff?.rooms?.length) return;
    const clampSide = (v: number) => Math.max(ROOM_SIZE.min, Math.min(ROOM_SIZE.max, v));
    const rooms = handoff.rooms.map((r) => {
      const w = clampSide(r.w);
      const l = clampSide(r.l);
      return { ...r, w, l, id: nextId.current++, openings: defaultOpenings(w) };
    });
    setRooms(windowsOutside(rooms));
    setFloorsState(Math.min(MAX_FLOORS, Math.max(1, handoff.floors)));
    setProjectName(handoff.name);
    showToast("Your plan from Start is here. Move walls, add doors and windows, then Save.", 5000);
  }, [demo, initialProject, showToast]);

  // A load error stays up longer than a normal toast.
  useEffect(() => {
    if (!loadError && !designsError) return;
    toastTimer.current = setTimeout(() => setToast(null), 8000);
  }, [loadError, designsError]);

  // ─── Room actions ────────────────────────────────────────
  /** Adds a room: on the ground floor against the east side, on an upper floor in the best spot over the floor below. */
  function addRoom(name: string, floor = 1) {
    const [w, l] = ROOM_DEFAULTS[name] ?? [10, 10];
    const id = nextId.current++;
    setRooms((prev) => [...prev, { id, name, w, l, h: 10, floor, ...(floor === 1 ? freeSpot(prev, 1) : bestSpot(prev, floor, w, l)), openings: defaultOpenings(w) }]);
    setSelectedId(id);
  }

  /**
   * Applies a change to one room. Doors and windows are kept inside walls that got shorter, wide doors become a pair,
   * and a room moved to another floor goes to the best spot there.
   */
  function updateRoom(id: number, patch: Partial<Omit<Room, "id">>) {
    setRooms((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const next = { ...r, ...patch };
        if (patch.floor !== undefined && patch.floor !== r.floor && patch.x === undefined) Object.assign(next, bestSpot(prev, patch.floor, r.w, r.l, r.id));
        return { ...next, openings: splitWideDoors(fitOpenings(next)) };
      })
    );
  }

  /** Gives a room a drawn shape (null: back to a rectangle) and size; its doors and windows move to the matching walls. */
  function applyShape(id: number, shape: [number, number][] | null, w: number, l: number) {
    setRooms((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const next = { ...r, w, l, shape: shape ?? undefined };
        return { ...next, openings: splitWideDoors(fitOpenings({ ...next, openings: remapOpenings(r, next) })) };
      })
    );
    setShapeRoomId(null);
    showToast(shape ? "Shape applied. Doors and windows moved to the matching walls." : "Back to a rectangle.");
  }

  function deleteRoom(id: number) {
    setRooms((prev) => prev.filter((r) => r.id !== id));
    setDesigns((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (selectedId === id) setSelectedId(null);
  }

  const selectRoom = useCallback((id: number | null) => {
    setSelectedId(id);
    if (id !== null) setWholeHome(false);
    setSelectedItem((item) => (item && item.roomId === id ? item : null));
  }, []);

  function setTab(next: StudioTab) {
    setTabState(next);
    setAiOpen(false);
    setWalking(false);
  }

  /** More floors get a staircase (added on the ground floor if there's none, and repeated above it); fewer move rooms down. */
  function setFloors(n: number) {
    if (n === floors) return;
    setFloorsState(n);
    if (n > floors) {
      const before = rooms.length;
      const next = addStairs(rooms, n, () => nextId.current++);
      setRooms(next);
      if (next.length > before) showToast(n - floors > 1 ? `Floors ${floors + 1}–${n} added, with a staircase` : `Floor ${n} added, with a staircase`, 3500);
      return;
    }
    setRooms((prev) => removeStairCopies(prev, n).map((r) => (r.floor > n ? { ...r, floor: n } : r)));
  }

  function acceptSketch(found: RoomDraft[]) {
    const maxFloor = Math.min(MAX_FLOORS, Math.max(1, ...found.map((r) => r.floor)));
    setFloorsState((f) => Math.max(f, maxFloor));
    setRooms(windowsOutside(withIds(placeRooms(found.map((r) => ({ ...r, floor: Math.min(r.floor, MAX_FLOORS) }))))));
    setDesigns({});
    setSelectedId(null);
    setSelectedItem(null);
    setManualMode(false);
    setTab("floor");
    setFloorView("3d");
  }

  function reupload() {
    setRooms([]);
    setDesigns({});
    setSelectedId(null);
    setSelectedItem(null);
    setManualMode(false);
    setTab("floor");
  }

  function startManually() {
    setManualMode(true);
    setPanelOpen(true);
    setTab("floor");
    setTimeout(() => addSelectRef.current?.focus(), 300);
  }

  // ─── Design actions ──────────────────────────────────────
  /** Rooms joined into one space by removed walls (each room maps to its whole group). */
  const joined = useMemo(() => joinedGroups(rooms), [rooms]);

  /**
   * Changes the selected room's design (starting from its defaults the first time). Finishes also go to the rooms it's
   * joined to by removed walls; with "Entire home", to every room. Furniture and the kitchen stay with the one room.
   */
  function changeDesign(patch: Partial<RoomDesign>, roomId = selectedId) {
    const finishesOnly = !("furniture" in patch) && !("kitchen" in patch);
    const ids = wholeHome && roomId === selectedId ? rooms.map((r) => r.id) : roomId === null ? [] : finishesOnly ? (joined.get(roomId) ?? [roomId]) : [roomId];
    const targets = rooms.filter((r) => ids.includes(r.id));
    if (!targets.length) return;
    setDesigns((prev) => ({ ...prev, ...Object.fromEntries(targets.map((r) => [r.id, { ...(prev[r.id] ?? defaultDesign(r.name)), ...patch }])) }));
  }

  const designOf = (room: Room) => designs[room.id] ?? defaultDesign(room.name);

  function setItems(room: Room, update: (items: FurnitureItem[]) => FurnitureItem[]) {
    changeDesign({ furniture: update(designOf(room).furniture ?? []) }, room.id);
  }

  function addItem(type: FurnitureType) {
    const room = rooms.find((r) => r.id === selectedId);
    if (!room) return;
    const items = designOf(room).furniture ?? [];
    const spot = placeFurniture(room, rooms.filter((r) => r.floor === room.floor), items, type);
    if (!spot) return showToast(`No free space for a ${FURNITURE[type].label.toLowerCase()} in the ${room.name}. Move or remove something first.`, 4000);
    const id = Math.max(0, ...items.map((i) => i.id)) + 1;
    setItems(room, (list) => [...list, { id, ...spot }]);
    setSelectedItem({ roomId: room.id, itemId: id });
  }

  function addTypical() {
    const room = rooms.find((r) => r.id === selectedId);
    if (!room) return;
    const types = typicalFurniture(room);
    if (!types.length) return showToast(`There's no typical set for a ${room.name}; add pieces one by one.`, 4000);
    const { items, skipped } = addFurniture(room, rooms.filter((r) => r.floor === room.floor), designOf(room).furniture ?? [], types);
    setItems(room, () => items);
    if (skipped) showToast(`${skipped} piece${skipped > 1 ? "s" : ""} didn't fit.`, 3000);
  }

  function updateItem(ref: ItemRef, update: (item: FurnitureItem, room: Room) => FurnitureItem | null) {
    const room = rooms.find((r) => r.id === ref.roomId);
    if (!room) return;
    setItems(room, (list) => list.flatMap((i) => (i.id === ref.itemId ? [update(i, room)].filter((x): x is FurnitureItem => !!x) : [i])));
  }

  const moveItem = (ref: ItemRef, x: number, z: number) => updateItem(ref, (i) => ({ ...i, x, z }));
  const rotateItem = (ref: ItemRef) =>
    updateItem(ref, (i, room) => {
      const rot = ((i.rot + 90) % 360) as Rotation;
      return { ...i, rot, ...clampToRoom(room, { type: i.type, rot }, i.x, i.z) };
    });
  function removeItem(ref: ItemRef) {
    updateItem(ref, () => null);
    setSelectedItem(null);
  }

  function toggleKitchen(on: boolean) {
    changeDesign({ kitchen: on ? { layout: "L", countertop: DEFAULT_COUNTERTOP } : undefined });
  }

  /** Picking a room from the Interior list also swings the camera to it. */
  function pickRoom(id: number) {
    selectRoom(id);
    canvasRef.current?.focusRoom(id);
  }

  /** What the "Entire home" panel shows as picked: a finish only if every room has it. */
  function homeDesign(): RoomDesign {
    const all = rooms.map(designOf);
    const same = <T,>(pick: (d: RoomDesign) => T) => all.every((d) => JSON.stringify(pick(d)) === JSON.stringify(pick(all[0])));
    return {
      flooring: same((d) => d.flooring.name) ? all[0].flooring : { ...all[0].flooring, name: "" },
      walls: same((d) => d.walls) ? all[0].walls : { finish: "paint", color: all[0].walls.color, name: "Mixed" },
    };
  }

  /** "Entire home": floors and walls for every room at once. */
  function pickWholeHome() {
    setSelectedId(null);
    setSelectedItem(null);
    setWholeHome(true);
    setCameraPreset("persp");
  }

  // ─── View actions ────────────────────────────────────────
  function toggleLayer(layer: LayerName) {
    setLayers((prev) => ({ ...prev, [layer]: !prev[layer] }));
  }

  function setCameraPreset(preset: CameraPreset) {
    setCamera(preset);
    canvasRef.current?.setCameraPreset(preset);
  }

  /** Walks through the house, starting in `roomId` (or the living room). */
  function startWalkthrough(roomId: number | null = null) {
    if (!rooms.length) return showToast("Add rooms first");
    setAiOpen(false);
    setWalkRoomId(roomId);
    setWalking(true);
  }

  // R rotates and Delete removes the selected piece of furniture (Interior Design tab).
  const itemKeys = useRef({ rotateItem, removeItem, selectedItem, tab });
  useEffect(() => {
    itemKeys.current = { rotateItem, removeItem, selectedItem, tab };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = itemKeys.current;
      if (!k.selectedItem || k.tab !== "interior" || e.ctrlKey || e.metaKey) return;
      if ((e.target as HTMLElement).closest("input, textarea, select")) return;
      if (e.key === "r" || e.key === "R") k.rotateItem(k.selectedItem);
      else if (e.key === "Delete" || e.key === "Backspace") k.removeItem(k.selectedItem);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  /** Records an export in the `exports` table (only for saved projects; failures are ignored). */
  function recordExport(type: "2d" | "3d") {
    if (!projectId) return;
    fetch(`/api/projects/${projectId}/exports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type }),
    }).catch(() => {});
  }

  function export3D() {
    const dataUrl = canvasRef.current?.snapshot();
    if (!dataUrl) return;
    downloadDataUrl(dataUrl, `${projectName || "spacify"}-3d.png`);
    recordExport("3d");
    showToast("3D snapshot exported!");
  }

  // ─── Saving ──────────────────────────────────────────────
  const currentKey = snapshotKey({ name: projectName, floors, rooms, designs });
  const dirty = currentKey !== savedKey;
  const saveState: SaveState = access === "view" ? "readonly" : saving ? "saving" : !projectId || dirty ? "unsaved" : "saved";

  // Latest state for code that runs after an await (the save response may arrive after more edits).
  const latest = useRef({ rooms, designs, selectedId });
  useEffect(() => {
    latest.current = { rooms, designs, selectedId };
  });

  async function save() {
    if (!user) return showToast("Log in to save your project.");
    if (saveState !== "unsaved") return;
    const sent: Snapshot = { name: projectName.trim() || "Untitled Project", floors, rooms, designs };
    setSaving(true);
    try {
      const res = await fetch(projectId ? `/api/projects/${projectId}` : "/api/projects", {
        method: projectId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...sent, designs: roomDesigns(sent) }),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<SaveResult> & { error?: string };
      if (!res.ok || !data.project || !data.idMap) throw new Error(data.error ?? "Couldn't save the project.");
      applySaved(sent, data as SaveResult);
      if (data.warning) showToast(data.warning, 8000);
      else showToast(projectId ? "Saved" : "Project saved to the database");
    } catch (err) {
      showToast((err as Error).message, 6000);
    } finally {
      setSaving(false);
    }
  }

  /** New rooms get database ids on save; swap them in everywhere a room id is used. */
  function applySaved(sent: Snapshot, { project, idMap, warning }: SaveResult) {
    const saved = new Map(Object.entries(idMap).map(([from, to]) => [Number(from), to]));
    const taken = new Set(saved.values());
    const { rooms: current, designs: currentDesigns, selectedId: currentSelected } = latest.current;

    // Rooms added while the save was in flight keep their ids unless a new database id now clashes.
    let fresh = Math.max(0, ...current.map((r) => r.id), ...taken) + 1;
    const remap = new Map<number, number>();
    for (const r of current) remap.set(r.id, saved.get(r.id) ?? (taken.has(r.id) ? fresh++ : r.id));
    nextId.current = fresh;

    setRooms(current.map((r) => ({ ...r, id: remap.get(r.id)! })));
    setDesigns(Object.fromEntries(Object.entries(currentDesigns).map(([id, d]) => [remap.get(Number(id)) ?? Number(id), d])));
    if (currentSelected !== null) setSelectedId(remap.get(currentSelected) ?? null);
    if (!projectName.trim()) setProjectName(sent.name);

    // If the designs didn't reach MongoDB, stay unsaved so the next Save sends them again (the rooms are now stored,
    // so that save updates them rather than inserting copies).
    setSavedKey(
      warning
        ? null
        : snapshotKey({
            ...sent,
            rooms: sent.rooms.map((r) => ({ ...r, id: saved.get(r.id)! })),
            designs: Object.fromEntries(Object.entries(sent.designs).map(([id, d]) => [saved.get(Number(id)) ?? Number(id), d])),
          })
    );
    setAccess(project.access);
    if (!projectId) {
      setProjectId(project.id);
      // Put the id in the URL so a reload opens this project (no navigation, state is kept).
      window.history.replaceState(null, "", `/design?project=${project.id}`);
    }
  }

  // Ctrl+S / Cmd+S saves.
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Warn before leaving with unsaved rooms.
  const hasUnsavedWork = saveState === "unsaved" && rooms.length > 0 && (projectId !== null || !demo);
  useEffect(() => {
    if (!hasUnsavedWork) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasUnsavedWork]);

  const selectedRoom = rooms.find((r) => r.id === selectedId) ?? null;
  const projectContext = useMemo(() => describeProject(rooms, floors), [rooms, floors]);
  const showEmptyState = rooms.length === 0 && !manualMode && tab !== "architecture";
  const in3d = tab === "interior" || (tab === "floor" && floorView === "3d");
  const togglePanel = () => setPanelOpen((o) => !(o ?? window.innerWidth >= 800));

  return (
    <div className="studio">
      <Topbar
        user={user}
        tab={tab}
        onTab={setTab}
        aiOpen={aiOpen}
        projectName={projectName}
        saveState={saveState}
        onSave={save}
        onProjectName={setProjectName}
        onTogglePanel={togglePanel}
        onToggleAi={() => setAiOpen((o) => !o)}
        onExport={export3D}
      />

      {tab === "floor" && (
        <div className="subbar">
          <div className="segmented" role="group" aria-label="Floor plan view">
            <button className={floorView === "2d" && !walking ? "active" : undefined} aria-pressed={floorView === "2d" && !walking} onClick={() => { setWalking(false); setFloorView("2d"); }}>2D plan</button>
            <button className={floorView === "3d" && !walking ? "active" : undefined} aria-pressed={floorView === "3d" && !walking} onClick={() => { setWalking(false); setFloorView("3d"); }}>3D view</button>
            <button className={walking ? "active" : undefined} aria-pressed={walking} onClick={() => (walking ? setWalking(false) : startWalkthrough(selectedId))}>Walkthrough</button>
          </div>
          <span className="subbar-hint">
            {walking ? "Walking: WASD to move, mouse to look, Esc to stop" : floorView === "2d" ? "Move and resize rooms, add doors and windows" : "Rooms, walls, doors and windows in 3D"}
          </span>
        </div>
      )}
      {tab === "interior" && (
        <div className="subbar">
          <span className="subbar-title">{selectedRoom ? selectedRoom.name : wholeHome ? "Entire home" : "Pick a room"}</span>
          <span className="subbar-hint">
            {selectedItem ? "Drag the piece to move it · R to rotate · Delete to remove" : "Click a room to choose its floor, walls, windows, doors and furniture"}
          </span>
          <button className="cam-btn" onClick={() => (walking ? setWalking(false) : startWalkthrough(selectedId))}>{walking ? "Stop walking" : "Walk through"}</button>
        </div>
      )}

      <div className="main">
        {tab === "floor" && (
          <RoomPanel
            open={panelOpen}
            rooms={rooms}
            floors={floors}
            selectedId={selectedId}
            addSelectRef={addSelectRef}
            onAddRoom={addRoom}
            onUpdateRoom={updateRoom}
            onDeleteRoom={deleteRoom}
            onSelectRoom={selectRoom}
            onEditShape={setShapeRoomId}
            onSetFloors={setFloors}
            onReupload={reupload}
            onShowTutorial={() => setTutorialOpen(true)}
          />
        )}
        {tab === "interior" && (
          <RoomList open={panelOpen} rooms={rooms} floors={floors} designs={designs} selectedId={selectedId} wholeHome={wholeHome} onSelectRoom={pickRoom} onSelectHome={pickWholeHome} />
        )}

        <div className="canvas-wrap">
          <ThreeCanvas
            ref={canvasRef}
            rooms={rooms}
            floors={floors}
            layers={layers}
            designs={designs}
            selectedId={selectedId}
            viewFloor={viewFloor}
            editFurniture={tab === "interior"}
            selectedItem={tab === "interior" ? selectedItem : null}
            walking={walking}
            walkRoomId={walkRoomId}
            onSelect={selectRoom}
            onWalkExit={() => setWalking(false)}
            onSelectItem={(item) => {
              setSelectedItem(item);
              if (item) setSelectedId(item.roomId);
            }}
            onMoveItem={moveItem}
          />

          {!walking && in3d && rooms.length > 0 && (
            <CanvasOverlays
              mode={tab === "floor" ? "plan" : "interior"}
              rooms={rooms}
              floors={floors}
              layers={layers}
              camera={camera}
              viewFloor={viewFloor}
              onViewFloor={setViewFloor}
              onToggleLayer={toggleLayer}
              onCamera={setCameraPreset}
              onZoom={(d) => canvasRef.current?.zoom(d)}
            />
          )}

          <UploadFlow
            showEmptyState={showEmptyState}
            inputRef={fileInputRef}
            onAccept={acceptSketch}
            onShowTutorial={() => setTutorialOpen(true)}
            onAddManually={startManually}
          />

          {tab === "floor" && floorView === "2d" && !walking && (
            <PlanView
              rooms={rooms}
              floors={floors}
              theme={theme}
              projectName={projectName}
              selectedId={selectedId}
              designs={designs}
              selectedItem={selectedItem}
              onSelectRoom={setSelectedId}
              onUpdateRoom={updateRoom}
              onSelectItem={setSelectedItem}
              onMoveItem={moveItem}
              onRotateItem={rotateItem}
              onRemoveItem={removeItem}
              onExported={() => {
                recordExport("2d");
                showToast("2D plan exported!");
              }}
            />
          )}
          {tab === "architecture" && <ArchitectureView />}
          <ChatView visible={aiOpen} projectContext={projectContext} projectId={projectId} />

          {shapeRoomId !== null && rooms.some((r) => r.id === shapeRoomId) && (
            <ShapeModal
              room={rooms.find((r) => r.id === shapeRoomId)!}
              onApply={(shape, w, l) => applyShape(shapeRoomId, shape, w, l)}
              onClose={() => setShapeRoomId(null)}
            />
          )}

          {tutorialOpen && (
            <TutorialModal
              onClose={() => setTutorialOpen(false)}
              onUpload={() => {
                setTutorialOpen(false);
                fileInputRef.current?.click();
              }}
            />
          )}

          {walking && (
            <div className="wasd-overlay">
              <div className="wasd-badge">WASD · Move &nbsp;|&nbsp; Mouse · Look &nbsp;|&nbsp; Shift · Run &nbsp;|&nbsp; Walk up the stairs to change floor</div>
              <div className="crosshair" />
              <button className="wasd-exit" onClick={() => setWalking(false)}>Exit walkthrough (Esc)</button>
            </div>
          )}
        </div>

        {tab === "interior" && (
          <InteriorPanel
            open
            room={selectedRoom}
            wholeHome={wholeHome && rooms.length > 0}
            joinedWith={selectedRoom ? (joined.get(selectedRoom.id) ?? []).filter((id) => id !== selectedRoom.id).map((id) => rooms.find((r) => r.id === id)!.name) : []}
            roomCount={rooms.length}
            doorCount={selectedRoom ? WALLS.reduce((n, w) => n + wallCuts(selectedRoom, w, rooms.filter((r) => r.floor === selectedRoom.floor)).filter((c) => c.kind === "door").length, 0) : 0}
            design={selectedRoom ? designOf(selectedRoom) : wholeHome ? homeDesign() : defaultDesign("")}
            layers={layers}
            selectedItemId={selectedItem && selectedItem.roomId === selectedId ? selectedItem.itemId : null}
            onToggleLayer={toggleLayer}
            onChangeDesign={(patch) => changeDesign(patch)}
            onAddFurniture={addItem}
            onAddTypical={addTypical}
            onSelectItem={(itemId) => setSelectedItem(itemId === null || selectedId === null ? null : { roomId: selectedId, itemId })}
            onRotateItem={(itemId) => selectedId !== null && rotateItem({ roomId: selectedId, itemId })}
            onRemoveItem={(itemId) => selectedId !== null && removeItem({ roomId: selectedId, itemId })}
            onToggleKitchen={toggleKitchen}
            onWalk={() => startWalkthrough(selectedId)}
          />
        )}
      </div>

      <div className={`toast${toast ? " show" : ""}`} role="status">{toast}</div>

      <footer className="statusbar">
        <div className="status-item">Rooms: <span>{rooms.length}</span></div>
        <div className="status-item">Total area: <span>{totalArea(rooms).toLocaleString()}</span> sq ft</div>
        <div className="status-item">Floors: <span>{floors}</span></div>
        <div className="status-item">{selectedRoom ? `Selected: ${selectedRoom.name}` : "Click a room to select"}</div>
      </footer>
    </div>
  );
}
