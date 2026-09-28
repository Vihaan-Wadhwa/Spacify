"use client";

import type { CameraPreset, LayerName, Layers, Room } from "@/lib/rooms";

const LAYER_LABELS: { id: LayerName; label: string }[] = [
  { id: "walls", label: "Walls" },
  { id: "floors", label: "Floors" },
  { id: "furniture", label: "Furniture" },
  { id: "labels", label: "Labels" },
  { id: "grid", label: "Grid" },
];

const CAMERA_LABELS: { id: CameraPreset; label: string }[] = [
  { id: "persp", label: "Perspective" },
  { id: "top", label: "Top view" },
  { id: "front", label: "Front" },
  { id: "side", label: "Side" },
];

type Props = {
  rooms: Room[];
  floors: number;
  layers: Layers;
  camera: CameraPreset;
  onToggleLayer: (layer: LayerName) => void;
  onCamera: (preset: CameraPreset) => void;
  onZoom: (delta: number) => void;
};

/** Floating controls drawn over the 3D canvas. */
export function CanvasOverlays({ rooms, floors, layers, camera, onToggleLayer, onCamera, onZoom }: Props) {
  return (
    <>
      <div className="floor-indicator">
        {Array.from({ length: floors }, (_, i) => i + 1).map((f) => (
          <div key={f} className="floor-chip">
            Floor {f} · {rooms.filter((r) => r.floor === f).length} rooms
          </div>
        ))}
      </div>

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

      <div className="view-controls">
        <button className="vc-btn" onClick={() => onZoom(-4)} aria-label="Zoom in">+</button>
        <button className="vc-btn" onClick={() => onZoom(4)} aria-label="Zoom out">−</button>
        <button className="vc-btn" onClick={() => onCamera("persp")} title="Reset camera" aria-label="Reset camera">⌂</button>
      </div>
    </>
  );
}
