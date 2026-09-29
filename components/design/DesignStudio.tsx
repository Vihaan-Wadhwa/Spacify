"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "@/components/ThemeProvider";
import { downloadDataUrl } from "@/lib/browser";
import type { Access, SaveResult, SavedProject } from "@/lib/projects";
import {
  DEFAULT_LAYERS,
  DEMO_ROOMS,
  MAX_FLOORS,
  ROOM_DEFAULTS,
  describeProject,
  totalArea,
  type CameraPreset,
  type LayerName,
  type Layers,
  type Room,
  type RoomDesign,
  type StudioTab,
} from "@/lib/rooms";
import { CanvasOverlays } from "./CanvasOverlays";
import { ChatView } from "./ChatView";
import { DesignPanel } from "./DesignPanel";
import { PlanView } from "./PlanView";
import { RoomPanel } from "./RoomPanel";
import { ThreeCanvas, type ThreeCanvasHandle } from "./ThreeCanvas";
import { Topbar, type SaveState } from "./Topbar";
import { TutorialModal } from "./TutorialModal";
import { UploadFlow } from "./UploadFlow";

type Props = {
  /** Start with sample rooms (not saved). */
  demo: boolean;
  /** Project loaded from PostgreSQL by the page, or null for a new one. */
  initialProject: SavedProject | null;
  /** Why the requested project couldn't be loaded (e.g. database down). */
  loadError: string | null;
};

type Snapshot = { name: string; floors: number; rooms: Room[] };

/** What gets compared to decide whether there are unsaved changes. */
const snapshotKey = (s: Snapshot) => JSON.stringify({ name: s.name.trim(), floors: s.floors, rooms: s.rooms });

function initialRooms(demo: boolean, project: SavedProject | null): Room[] {
  if (project) return project.rooms;
  return demo ? DEMO_ROOMS.map((r, i) => ({ ...r, id: i + 1 })) : [];
}

/**
 * The design page. All project state lives here and flows down to the panels and the 3D canvas.
 * Saving sends name, floors and rooms to /api/projects (PostgreSQL).
 */
export function DesignStudio({ demo, initialProject, loadError }: Props) {
  const { theme } = useTheme();

  // ─── Project state ───────────────────────────────────────
  const [rooms, setRooms] = useState<Room[]>(() => initialRooms(demo, initialProject));
  const [floors, setFloorsState] = useState(initialProject?.floors ?? 1);
  const [designs, setDesigns] = useState<Record<number, RoomDesign>>({});
  const [projectName, setProjectName] = useState(initialProject?.name ?? "Untitled Project");
  const nextId = useRef(Math.max(0, ...initialRooms(demo, initialProject).map((r) => r.id)) + 1);

  // ─── Persistence state ───────────────────────────────────
  const [projectId, setProjectId] = useState<number | null>(initialProject?.id ?? null);
  const [access, setAccess] = useState<Access>(initialProject?.access ?? "owner");
  const [savedKey, setSavedKey] = useState<string | null>(() => (initialProject ? snapshotKey(initialProject) : null));
  const [saving, setSaving] = useState(false);

  // ─── UI state ────────────────────────────────────────────
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [layers, setLayers] = useState<Layers>(DEFAULT_LAYERS);
  const [camera, setCamera] = useState<CameraPreset>("persp");
  const [tab, setTab] = useState<StudioTab>("model");
  // null = not toggled yet: CSS decides (open on desktop, closed on phones)
  const [panelOpen, setPanelOpen] = useState<boolean | null>(null);
  const [designOpen, setDesignOpen] = useState(false);
  const [walking, setWalking] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [toast, setToast] = useState<string | null>(loadError ? `Couldn't load the project: ${loadError}` : null);

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

  // A load error stays up longer than a normal toast.
  useEffect(() => {
    if (!loadError) return;
    toastTimer.current = setTimeout(() => setToast(null), 8000);
  }, [loadError]);

  // ─── Room actions ────────────────────────────────────────
  function addRoom(name: string) {
    const [w, l] = ROOM_DEFAULTS[name] ?? [10, 10];
    setRooms((prev) => [...prev, { id: nextId.current++, name, w, l, h: 10, floor: 1 }]);
  }

  function updateRoom(id: number, patch: Partial<Omit<Room, "id">>) {
    setRooms((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
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
    if (id !== null) setDesignOpen(true);
  }, []);

  function setFloors(n: number) {
    setFloorsState(n);
    setRooms((prev) => (prev.some((r) => r.floor > n) ? prev.map((r) => (r.floor > n ? { ...r, floor: n } : r)) : prev));
  }

  function acceptSketch(found: Omit<Room, "id">[]) {
    const maxFloor = Math.min(MAX_FLOORS, Math.max(1, ...found.map((r) => r.floor)));
    setFloorsState((f) => Math.max(f, maxFloor));
    setRooms(withIds(found.map((r) => ({ ...r, floor: Math.min(r.floor, MAX_FLOORS) }))));
    setDesigns({});
    setSelectedId(null);
    setManualMode(false);
  }

  function reupload() {
    setRooms([]);
    setDesigns({});
    setSelectedId(null);
    setManualMode(false);
    setTab("model");
  }

  function startManually() {
    setManualMode(true);
    setPanelOpen(true);
    setTab("model");
    setTimeout(() => addSelectRef.current?.focus(), 300);
  }

  // ─── View actions ────────────────────────────────────────
  function toggleLayer(layer: LayerName) {
    setLayers((prev) => ({ ...prev, [layer]: !prev[layer] }));
  }

  function setCameraPreset(preset: CameraPreset) {
    setCamera(preset);
    canvasRef.current?.setCameraPreset(preset);
  }

  function startWalkthrough() {
    if (walking) return setWalking(false);
    if (!rooms.length) return showToast("Add rooms first");
    setTab("model");
    setWalking(true);
  }

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
  const currentKey = snapshotKey({ name: projectName, floors, rooms });
  const dirty = currentKey !== savedKey;
  const saveState: SaveState = access === "view" ? "readonly" : saving ? "saving" : !projectId || dirty ? "unsaved" : "saved";

  // Latest state for code that runs after an await (the save response may arrive after more edits).
  const latest = useRef({ rooms, designs, selectedId });
  useEffect(() => {
    latest.current = { rooms, designs, selectedId };
  });

  async function save() {
    if (saveState !== "unsaved") return;
    const sent: Snapshot = { name: projectName.trim() || "Untitled Project", floors, rooms };
    setSaving(true);
    try {
      const res = await fetch(projectId ? `/api/projects/${projectId}` : "/api/projects", {
        method: projectId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sent),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<SaveResult> & { error?: string };
      if (!res.ok || !data.project || !data.idMap) throw new Error(data.error ?? "Couldn't save the project.");
      applySaved(sent, data as SaveResult);
      showToast(projectId ? "Saved" : "Project saved to the database");
    } catch (err) {
      showToast((err as Error).message, 6000);
    } finally {
      setSaving(false);
    }
  }

  /** New rooms get database ids on save; swap them in everywhere a room id is used. */
  function applySaved(sent: Snapshot, { project, idMap }: SaveResult) {
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

    setSavedKey(snapshotKey({ ...sent, rooms: sent.rooms.map((r) => ({ ...r, id: saved.get(r.id)! })) }));
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

  function toggleDesignPanel() {
    setDesignOpen((open) => !open);
  }

  const selectedRoom = rooms.find((r) => r.id === selectedId) ?? null;
  const projectContext = useMemo(() => describeProject(rooms, floors), [rooms, floors]);
  const showEmptyState = rooms.length === 0 && !manualMode;

  return (
    <div className="studio">
      <Topbar
        tab={tab}
        onTab={setTab}
        walking={walking}
        designOpen={designOpen}
        projectName={projectName}
        saveState={saveState}
        onSave={save}
        onProjectName={setProjectName}
        onTogglePanel={() => setPanelOpen((o) => !(o ?? window.innerWidth >= 800))}
        onWalkthrough={startWalkthrough}
        onToggleDesign={toggleDesignPanel}
        onExport={export3D}
      />

      <div className="main">
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
          onSetFloors={setFloors}
          onReupload={reupload}
          onShowTutorial={() => setTutorialOpen(true)}
        />

        <div className="canvas-wrap">
          <ThreeCanvas
            ref={canvasRef}
            rooms={rooms}
            floors={floors}
            layers={layers}
            designs={designs}
            selectedId={selectedId}
            theme={theme}
            walking={walking}
            onSelect={selectRoom}
            onWalkExit={() => setWalking(false)}
          />

          {!walking && (
            <CanvasOverlays
              rooms={rooms}
              floors={floors}
              layers={layers}
              camera={camera}
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

          {tab === "plan" && (
            <PlanView
              rooms={rooms}
              floors={floors}
              theme={theme}
              projectName={projectName}
              onExported={() => {
                recordExport("2d");
                showToast("2D plan exported!");
              }}
            />
          )}
          <ChatView visible={tab === "ai"} projectContext={projectContext} projectId={projectId} />

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
              <div className="wasd-badge">WASD · Move &nbsp;|&nbsp; Mouse · Look &nbsp;|&nbsp; Shift · Sprint</div>
              <div className="crosshair" />
              <button className="wasd-exit" onClick={() => setWalking(false)}>Exit walkthrough (Esc)</button>
            </div>
          )}
        </div>

        <DesignPanel
          open={designOpen}
          room={selectedRoom}
          design={(selectedId !== null && designs[selectedId]) || {}}
          onClose={() => setDesignOpen(false)}
          onChangeDesign={(patch) => {
            if (selectedId === null) return;
            setDesigns((prev) => ({ ...prev, [selectedId]: { ...prev[selectedId], ...patch } }));
          }}
          onChangeHeight={(h) => selectedId !== null && updateRoom(selectedId, { h })}
        />
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
