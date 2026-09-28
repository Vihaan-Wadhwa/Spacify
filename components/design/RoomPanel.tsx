"use client";

import { useState } from "react";
import { MAX_FLOORS, ROOM_TYPES, roomColor, type Room } from "@/lib/rooms";

type Props = {
  /** null = default: CSS shows it on desktop and hides it on phones */
  open: boolean | null;
  rooms: Room[];
  floors: number;
  selectedId: number | null;
  addSelectRef: React.Ref<HTMLSelectElement>;
  onAddRoom: (type: string) => void;
  onUpdateRoom: (id: number, patch: Partial<Omit<Room, "id">>) => void;
  onDeleteRoom: (id: number) => void;
  onSelectRoom: (id: number) => void;
  onSetFloors: (n: number) => void;
  onReupload: () => void;
  onShowTutorial: () => void;
};

const DIMENSIONS: { key: "w" | "l" | "h"; label: string; min: number; max: number }[] = [
  { key: "w", label: "W (ft)", min: 4, max: 40 },
  { key: "l", label: "L (ft)", min: 4, max: 40 },
  { key: "h", label: "H (ft)", min: 8, max: 16 },
];

export function RoomPanel({
  open,
  rooms,
  floors,
  selectedId,
  addSelectRef,
  onAddRoom,
  onUpdateRoom,
  onDeleteRoom,
  onSelectRoom,
  onSetFloors,
  onReupload,
  onShowTutorial,
}: Props) {
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [newType, setNewType] = useState(ROOM_TYPES[0]);

  function toggleExpand(id: number) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function commitDimension(room: Room, key: "w" | "l" | "h", raw: string, min: number, max: number) {
    const value = parseFloat(raw);
    if (!Number.isFinite(value) || value <= 0) return;
    onUpdateRoom(room.id, { [key]: Math.min(max, Math.max(min, value)) });
  }

  return (
    <aside className={`panel${open === null ? " auto" : open ? " open" : " collapsed"}`} aria-label="Rooms">
      <div className="panel-head">
        <h3>Rooms</h3>
      </div>

      <div className="panel-body">
        {rooms.length === 0 && <div className="panel-empty">No rooms yet. Upload a sketch or add rooms below.</div>}
        {rooms.map((r) => {
          const expanded = !collapsed.has(r.id);
          return (
            <div key={r.id} className={`room-item${selectedId === r.id ? " selected" : ""}`}>
              <button className="room-header" onClick={() => toggleExpand(r.id)} aria-expanded={expanded}>
                <span className="room-color" style={{ background: roomColor(r.name) }} />
                <span className="room-name">{r.name}</span>
                <span className="room-floor">F{r.floor}</span>
                <span className="room-toggle">{expanded ? "▾" : "▸"}</span>
              </button>
              {expanded && (
                <div className="room-dims">
                  {DIMENSIONS.map((d) => (
                    <div className="dim-input" key={d.key}>
                      <label htmlFor={`room-${r.id}-${d.key}`}>{d.label}</label>
                      {/* Uncontrolled + keyed on value so typing is free and blur/Enter commits */}
                      <input
                        id={`room-${r.id}-${d.key}`}
                        key={`${d.key}-${r[d.key]}`}
                        type="number"
                        defaultValue={r[d.key]}
                        min={d.min}
                        max={d.max}
                        onBlur={(e) => commitDimension(r, d.key, e.target.value, d.min, d.max)}
                        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                      />
                    </div>
                  ))}
                  <div className="dim-input">
                    <label htmlFor={`room-${r.id}-floor`}>Floor</label>
                    <select id={`room-${r.id}-floor`} value={r.floor} onChange={(e) => onUpdateRoom(r.id, { floor: Number(e.target.value) })}>
                      {Array.from({ length: floors }, (_, i) => i + 1).map((f) => (
                        <option key={f} value={f}>{f}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
              <div className="room-actions">
                <button className="del-btn" onClick={() => onDeleteRoom(r.id)}>✕ Remove</button>
                <button className="del-btn select" onClick={() => onSelectRoom(r.id)}>● Select</button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="add-room-section">
        <div className="add-room-row">
          <select ref={addSelectRef} className="room-type-select" value={newType} onChange={(e) => setNewType(e.target.value)} aria-label="Room type">
            {ROOM_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <button className="add-btn" onClick={() => onAddRoom(newType)}>+ Add room</button>
        </div>
        <div className="floors-row">
          <span>Floors:</span>
          {Array.from({ length: MAX_FLOORS }, (_, i) => i + 1).map((n) => (
            <button key={n} className={`cam-btn small${floors === n ? " active" : ""}`} onClick={() => onSetFloors(n)}>
              {n}
            </button>
          ))}
        </div>
        <button className="add-btn block" onClick={onReupload}>↑ Re-upload sketch</button>
        <button className="manual-btn block" onClick={onShowTutorial}>? Sketch tutorial</button>
      </div>
    </aside>
  );
}
