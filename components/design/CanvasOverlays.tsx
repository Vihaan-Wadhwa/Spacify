"use client";

import type { CameraPreset, LayerName, Layers, Room } from "@/lib/rooms";

const LAYER_LABELS: { id: LayerName; label: string }[] = [
  { id: "walls", label: "Walls" },
  { id: "floors", label: "Floors" },
  { id: "furniture", label: "Furniture" },
  { id: "roof", label: "Roof" },
  { id: "grid", label: "Grid" },
];

const CAMERA_LABELS: { id: CameraPreset; label: string }[] = [
  { id: "persp", label: "Perspective" },
  { id: "top", label: "Top view" },
  { id: "front", label: "Front" },
  { id: "side", label: "Side" },
];

type Props = {
  /** "plan" shows layer toggles and camera presets too (Floor Plan → 3D); "interior" keeps to floors and zoom. */
  mode: "plan" | "interior";
  rooms: Room[];
  floors: number;
  layers: Layers;
  camera: CameraPreset;
  viewFloor: number | null;
  onViewFloor: (floor: number | null) => void;
  onToggleLayer: (layer: LayerName) => void;
  onCamera: (preset: CameraPreset) => void;
  onZoom: (delta: number) => void;
};

/** Floating controls drawn over the 3D canvas. */
export function CanvasOverlays({ mode, rooms, floors, layers, camera, viewFloor, onViewFloor, onToggleLayer, onCamera, onZoom }: Props) {
  return (
    <>
      {floors > 1 && (
        <div className="floor-indicator" role="group" aria-label="Floors to show">
          <button className={`floor-chip${viewFloor === null ? " active" : ""}`} onClick={() => onViewFloor(null)}>All floors</button>
          {Array.from({ length: floors }, (_, i) => i + 1).map((f) => (
            <button key={f} className={`floor-chip${viewFloor === f ? " active" : ""}`} aria-pressed={viewFloor === f} onClick={() => onViewFloor(f)}>
              Floor {f} · {rooms.filter((r) => r.floor === f).length} {rooms.filter((r) => r.floor === f).length === 1 ? "room" : "rooms"}
            </button>
          ))}
        </div>
      )}

      {mode === "plan" && (
        <>
          <div className="canvas-toggles">
            {LAYER_LABELS.map((l) => (
              <button key={l.id} className={`toggle-pill${layers[l.id] ? " on" : ""}`} aria-pressed={layers[l.id]} onClick={() => onToggleLayer(l.id)}>
                <span className="toggle-dot" />
                {l.label}
              </button>
            ))}
          </div>

          <div className="cam-presets">
            {CAMERA_LABELS.map((c) => (
              <button key={c.id} className={`cam-btn${camera === c.id ? " active" : ""}`} onClick={() => onCamera(c.id)}>
                {c.label}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="view-controls">
        <button className="vc-btn" onClick={() => onZoom(-1)} aria-label="Zoom in">+</button>
        <button className="vc-btn" onClick={() => onZoom(1)} aria-label="Zoom out">−</button>
        <button className="vc-btn" onClick={() => onCamera("persp")} title="Reset camera" aria-label="Reset camera">⌂</button>
      </div>
      <div className="canvas-hint">Drag to orbit · right-drag or Shift-drag to pan · scroll to zoom</div>
    </>
  );
}
