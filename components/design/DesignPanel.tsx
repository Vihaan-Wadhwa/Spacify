"use client";

import { FLOOR_OPTIONS, WALL_PRESETS, roomColor, type Room, type RoomDesign } from "@/lib/rooms";

type Props = {
  open: boolean;
  room: Room | null;
  design: RoomDesign;
  onClose: () => void;
  onChangeDesign: (patch: RoomDesign) => void;
  onChangeHeight: (h: number) => void;
};

export function DesignPanel({ open, room, design, onClose, onChangeDesign, onChangeHeight }: Props) {
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
              <h4>Wall Colour</h4>
              <div className="color-grid">
                {WALL_PRESETS.map((col) => (
                  <button
                    key={col}
                    className={`color-swatch${design.wallColor === col ? " active" : ""}`}
                    style={{ background: col }}
                    title={col}
                    aria-label={`Wall colour ${col}`}
                    onClick={() => onChangeDesign({ wallColor: col })}
                  />
                ))}
              </div>
              <input
                type="color"
                className="color-picker"
                aria-label="Custom wall colour"
                value={design.wallColor ?? "#f5f0e8"}
                onChange={(e) => onChangeDesign({ wallColor: e.target.value })}
              />
            </div>

            <div className="dp-section">
              <h4>Flooring</h4>
              <div className="floor-options">
                {FLOOR_OPTIONS.map((f) => (
                  <button
                    key={f.name}
                    className={`floor-opt${design.flooring === f.name ? " active" : ""}`}
                    onClick={() => onChangeDesign({ flooring: f.name })}
                  >
                    <span className="floor-preview" style={{ background: f.color }} />
                    {f.name}
                  </button>
                ))}
              </div>
            </div>

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
