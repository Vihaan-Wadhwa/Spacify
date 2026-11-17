"use client";

import { roomColor, type Room, type RoomDesign } from "@/lib/rooms";

type Props = {
  /** null = default: CSS shows it on desktop and hides it on phones */
  open: boolean | null;
  rooms: Room[];
  floors: number;
  designs: Record<number, RoomDesign>;
  selectedId: number | null;
  /** "Entire home" is picked: floors and walls for every room at once. */
  wholeHome: boolean;
  onSelectRoom: (id: number) => void;
  onSelectHome: () => void;
};

/** The Interior Design tab's room picker: every room by floor, with its current floor and wall colours. */
export function RoomList({ open, rooms, floors, designs, selectedId, wholeHome, onSelectRoom, onSelectHome }: Props) {
  return (
    <aside className={`panel${open === null ? " auto" : open ? " open" : " collapsed"}`} aria-label="Rooms">
      <div className="panel-head">
        <h3>Rooms</h3>
      </div>
      <div className="panel-body">
        {rooms.length === 0 && <div className="panel-empty">No rooms yet. Add them in Floor Plan.</div>}
        {rooms.length > 0 && (
          <button className={`room-pick home${wholeHome ? " selected" : ""}`} onClick={onSelectHome}>
            <span className="room-color" style={{ background: "var(--accent)" }} />
            <span className="room-name">Entire home</span>
            <span className="room-count">{rooms.length} rooms</span>
          </button>
        )}
        {Array.from({ length: floors }, (_, i) => i + 1).map((f) => {
          const onFloor = rooms.filter((r) => r.floor === f);
          if (!onFloor.length) return null;
          return (
            <div key={f} className="room-group">
              {floors > 1 && <div className="room-group-title">Floor {f}</div>}
              {onFloor.map((r) => {
                const d = designs[r.id];
                return (
                  <button key={r.id} className={`room-pick${selectedId === r.id ? " selected" : ""}`} onClick={() => onSelectRoom(r.id)}>
                    <span className="room-color" style={{ background: roomColor(r.name) }} />
                    <span className="room-name">{r.name}</span>
                    {d && (
                      <span className="room-finishes" aria-label="Floor and wall colours">
                        <span style={{ background: d.flooring.color }} />
                        <span style={{ background: d.walls.color }} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
