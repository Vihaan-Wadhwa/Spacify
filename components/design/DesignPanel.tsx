"use client";

import {
  DEFAULT_COUNTERTOP,
  DEFAULT_DESIGN,
  FLOOR_OPTIONS,
  KITCHEN_LAYOUTS,
  KITCHEN_LAYOUT_LABELS,
  WALL_FINISHES,
  WALL_FINISH_LABELS,
  WALL_PRESETS,
  isKitchen,
  roomColor,
  type Room,
  type RoomDesign,
} from "@/lib/rooms";

type Props = {
  open: boolean;
  room: Room | null;
  /** null until something is picked for this room; it's then stored in MongoDB on save. */
  design: RoomDesign | null;
  onClose: () => void;
  onChangeDesign: (patch: Partial<RoomDesign>) => void;
  onChangeHeight: (h: number) => void;
};

export function DesignPanel({ open, room, design, onClose, onChangeDesign, onChangeHeight }: Props) {
  const walls = design?.walls ?? DEFAULT_DESIGN.walls;
  return (
    <aside className={`design-panel${open ? " open" : ""}`} aria-label="Room design">
      <div className="panel-head">
        <h3>Room Design</h3>
        <button className="close-dp" onClick={onClose} aria-label="Close room design">×</button>
      </div>
      <div className="dp-body">
        {!room ? (
          <div className="dp-none">Select a room to design it</div>
        ) : (
          <>
            <div className="dp-room">
              <span className="room-color" style={{ background: roomColor(room.name) }} />
              {room.name}
            </div>

            <div className="dp-section">
              <h4>Wall Finish</h4>
              <div className="chip-options" role="group" aria-label="Wall finish">
                {WALL_FINISHES.map((finish) => (
                  <button
                    key={finish}
                    className={`floor-opt${design?.walls.finish === finish ? " active" : ""}`}
                    aria-pressed={design?.walls.finish === finish}
                    onClick={() => onChangeDesign({ walls: { ...walls, finish } })}
                  >
                    {WALL_FINISH_LABELS[finish]}
                  </button>
                ))}
              </div>
            </div>

            <div className="dp-section">
              <h4>Wall Colour</h4>
              <div className="color-grid">
                {WALL_PRESETS.map((col) => (
                  <button
                    key={col}
                    className={`color-swatch${design?.walls.color === col ? " active" : ""}`}
                    style={{ background: col }}
                    title={col}
                    aria-label={`Wall colour ${col}`}
                    onClick={() => onChangeDesign({ walls: { ...walls, color: col } })}
                  />
                ))}
              </div>
              <input
                type="color"
                className="color-picker"
                aria-label="Custom wall colour"
                value={walls.color}
                onChange={(e) => onChangeDesign({ walls: { ...walls, color: e.target.value } })}
              />
            </div>

            <div className="dp-section">
              <h4>Flooring</h4>
              <div className="floor-options">
                {FLOOR_OPTIONS.map((f) => (
                  <button
                    key={f.name}
                    className={`floor-opt${design?.flooring.name === f.name ? " active" : ""}`}
                    onClick={() => onChangeDesign({ flooring: { ...f } })}
                  >
                    <span className="floor-preview" style={{ background: f.color }} />
                    {f.name}
                  </button>
                ))}
              </div>
            </div>

            {isKitchen(room.name) && (
              <div className="dp-section">
                <h4>Kitchen Layout</h4>
                <div className="chip-options" role="group" aria-label="Kitchen layout">
                  {KITCHEN_LAYOUTS.map((layout) => (
                    <button
                      key={layout}
                      className={`floor-opt${design?.kitchen?.layout === layout ? " active" : ""}`}
                      aria-pressed={design?.kitchen?.layout === layout}
                      onClick={() => onChangeDesign({ kitchen: { layout, countertop: design?.kitchen?.countertop ?? DEFAULT_COUNTERTOP } })}
                    >
                      {KITCHEN_LAYOUT_LABELS[layout]}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="dp-section">
              <h4>Ceiling Height</h4>
              <input
                type="range"
                className="range"
                min={8}
                max={16}
                step={0.5}
                value={room.h}
                aria-label="Ceiling height"
                onChange={(e) => onChangeHeight(parseFloat(e.target.value))}
              />
              <div className="range-value">Height: {room.h} ft</div>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
