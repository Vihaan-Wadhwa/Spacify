"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useTheme } from "@/components/ThemeProvider";
import { downloadDataUrl } from "@/lib/browser";
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
import { Topbar } from "./Topbar";
import { TutorialModal } from "./TutorialModal";
import { UploadFlow } from "./UploadFlow";

/**
 * The design page. All project state lives here and flows down to the panels and the 3D canvas.
 * (Task 4 will load/save this state through /api/projects.)
 */
export function DesignStudio({ demo }: { demo: boolean }) {
  const { theme } = useTheme();

  // ─── Project state ───────────────────────────────────────
  const [rooms, setRooms] = useState<Room[]>(() => (demo ? DEMO_ROOMS.map((r, i) => ({ ...r, id: i + 1 })) : []));
  const [floors, setFloorsState] = useState(1);
  const [designs, setDesigns] = useState<Record<number, RoomDesign>>({});
  const [projectName, setProjectName] = useState("Untitled Project");
  const nextId = useRef(demo ? DEMO_ROOMS.length + 1 : 1);

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
  const [toast, setToast] = useState<string | null>(null);

  const canvasRef = useRef<ThreeCanvasHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const addSelectRef = useRef<HTMLSelectElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const withIds = useCallback((list: Omit<Room, "id">[]): Room[] => list.map((r) => ({ ...r, id: nextId.current++ })), []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }, []);

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

  function export3D() {
    const dataUrl = canvasRef.current?.snapshot();
    if (!dataUrl) return;
    downloadDataUrl(dataUrl, `${projectName || "spacify"}-3d.png`);
    showToast("3D snapshot exported!");
  }

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
            <PlanView rooms={rooms} floors={floors} theme={theme} projectName={projectName} onExported={() => showToast("2D plan exported!")} />
          )}
          <ChatView visible={tab === "ai"} projectContext={projectContext} />

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
