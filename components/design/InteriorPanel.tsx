"use client";

import { useEffect, useRef, useState } from "react";
import {
  ALUMINIUM_COLOURS,
  DEFAULT_DOORS,
  DEFAULT_WINDOWS,
  DOOR_STYLES,
  DOOR_STYLE_LABELS,
  FLOOR_OPTIONS,
  FURNITURE,
  POLISHES,
  POLISH_LABELS,
  WALLPAPERS,
  WALL_MARBLES,
  WALL_PAINTS,
  WINDOW_TYPES,
  WINDOW_TYPE_LABELS,
  WOOD_TONES,
  isKitchen,
  roomColor,
  roomSizeText,
  type FloorMaterial,
  type FurnitureType,
  type LayerName,
  type Layers,
  type Room,
  type RoomDesign,
  type WallpaperPattern,
} from "@/lib/rooms";
import { previewCanvas, type SurfaceKind } from "@/lib/scene/textures";
import { ColorWheel } from "./ColorWheel";

type Section = "floor" | "walls" | "windows" | "doors" | "furniture" | "kitchen";

type Props = {
  open: boolean;
  room: Room | null;
  /** Editing every room at once (floors and walls only). */
  wholeHome: boolean;
  roomCount: number;
  /** Doors in this room's walls, including ones listed on the room next door. */
  doorCount: number;
  /** Rooms this one is joined to by removed walls: its finishes go to them too. */
  joinedWith: string[];
  /** The room's design, or its defaults if nothing has been picked yet. */
  design: RoomDesign;
  layers: Layers;
  selectedItemId: number | null;
  onToggleLayer: (layer: LayerName) => void;
  onChangeDesign: (patch: Partial<RoomDesign>) => void;
  onAddFurniture: (type: FurnitureType) => void;
  onAddTypical: () => void;
  onSelectItem: (itemId: number | null) => void;
  onRotateItem: (itemId: number) => void;
  onRemoveItem: (itemId: number) => void;
  onToggleKitchen: (on: boolean) => void;
  onWalk: () => void;
};

const FLOOR_GROUPS: { material: FloorMaterial; label: string }[] = [
  { material: "wood", label: "Wooden" },
  { material: "tiles", label: "Tiles" },
  { material: "marble", label: "Marble" },
];

const ADDABLE: { label: string; types: FurnitureType[] }[] = [
  { label: "Beds", types: ["bed_single", "bed_double", "bed_queen", "bed_king"] },
  { label: "Storage & tables", types: ["cupboard", "bedside_table", "dressing_table", "study_table", "tv_panel"] },
  { label: "Living & dining", types: ["sofa", "dining_table"] },
];

/** A square preview of a finish, drawn with the 3D view's own texture generator. */
function FinishPreview({ kind, color, pattern }: { kind: SurfaceKind; color: string; pattern?: WallpaperPattern }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (ctx) ctx.drawImage(previewCanvas(kind, color, pattern), 0, 0, 64, 64);
  }, [kind, color, pattern]);
  return <canvas ref={ref} width={64} height={64} className="finish-preview" aria-hidden />;
}

function Swatches<T extends { name: string; color: string }>(p: {
  items: T[];
  active: (item: T) => boolean;
  onPick: (item: T) => void;
  preview?: (item: T) => React.ReactNode;
  label: string;
}) {
  return (
    <div className="finish-grid" role="group" aria-label={p.label}>
      {p.items.map((item) => (
        <button key={item.name} className={`finish-opt${p.active(item) ? " active" : ""}`} aria-pressed={p.active(item)} title={item.name} onClick={() => p.onPick(item)}>
          {p.preview ? p.preview(item) : <span className="finish-preview" style={{ background: item.color }} />}
          <span className="finish-name">{item.name}</span>
        </button>
      ))}
    </div>
  );
}

function Chips<T extends string>(p: { options: readonly T[]; labels: Record<T, string>; value: T; onPick: (v: T) => void; label: string }) {
  return (
    <div className="chip-options" role="group" aria-label={p.label}>
      {p.options.map((o) => (
        <button key={o} className={`floor-opt${p.value === o ? " active" : ""}`} aria-pressed={p.value === o} onClick={() => p.onPick(o)}>
          {p.labels[o]}
        </button>
      ))}
    </div>
  );
}

function Toggle({ on, onClick, children, disabled }: { on: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button className={`switch-row${on ? " on" : ""}`} role="switch" aria-checked={on} disabled={disabled} onClick={onClick}>
      <span className="switch" aria-hidden />
      <span>{children}</span>
    </button>
  );
}

/** Interior Design: finishes, doors and windows, furniture and the kitchen of the selected room. */
export function InteriorPanel(p: Props) {
  const [section, setSection] = useState<Section>("floor");
  const { room, design, wholeHome } = p;
  const kitchen = !!room && isKitchen(room.name);
  const sections: { id: Section; label: string }[] = wholeHome
    ? [
        { id: "floor", label: "Flooring" },
        { id: "walls", label: "Walls" },
      ]
    : [
        { id: "floor", label: "Flooring" },
        { id: "walls", label: "Walls" },
        { id: "windows", label: "Windows" },
        { id: "doors", label: "Doors" },
        { id: "furniture", label: "Furniture" },
        ...(kitchen ? [{ id: "kitchen" as const, label: "Kitchen" }] : []),
      ];
  const current = sections.some((x) => x.id === section) ? section : "floor";
  const windows = design.windows ?? DEFAULT_WINDOWS;
  const doors = design.doors ?? DEFAULT_DOORS;
  const walls = design.walls;
  const hasWindows = room?.openings.some((o) => o.kind === "window");

  return (
    <aside className={`design-panel${p.open ? " open" : ""}`} aria-label="Interior design">
      <div className="panel-head">
        <h3>Interior Design</h3>
        {room && <button className="walk-link" onClick={p.onWalk}>Walk in this room →</button>}
      </div>
      {!room && !wholeHome ? (
        <div className="dp-body">
          <div className="dp-none">Click a room in the 3D view, or pick one from the list, to design it.</div>
          <FurnitureToggles layers={p.layers} onToggleLayer={p.onToggleLayer} />
        </div>
      ) : (
        <>
          {room ? (
            <div className="dp-room">
              <span className="room-color" style={{ background: roomColor(room.name) }} />
              {room.name}
              <span className="dp-room-size">{roomSizeText(room)} · Floor {room.floor}</span>
            </div>
          ) : null}
          {room && p.joinedWith.length > 0 && (
            <div className="dp-joined">Joined with {p.joinedWith.join(", ")} (wall removed): floor, walls, windows and doors apply to all of it.</div>
          )}
          {!room && (
            <div className="dp-room">
              <span className="room-color" style={{ background: "var(--accent)" }} />
              Entire home
              <span className="dp-room-size">Applies to all {p.roomCount} rooms</span>
            </div>
          )}
          <nav className="dp-tabs" aria-label="Design sections">
            {sections.map((s) => (
              <button key={s.id} className={`dp-tab${current === s.id ? " active" : ""}`} aria-current={current === s.id ? "true" : undefined} onClick={() => setSection(s.id)}>
                {s.label}
              </button>
            ))}
          </nav>
          <div className="dp-body">
            {current === "floor" &&
              FLOOR_GROUPS.map((g) => (
                <div className="dp-section" key={g.material}>
                  <h4>{g.label}</h4>
                  <Swatches
                    label={`${g.label} flooring`}
                    items={FLOOR_OPTIONS.filter((f) => f.material === g.material)}
                    active={(f) => design.flooring.name === f.name}
                    onPick={(f) => p.onChangeDesign({ flooring: { ...f } })}
                    preview={(f) => <FinishPreview kind={f.material === "wood" ? "wood" : f.material === "marble" ? "marble" : "tiles"} color={f.color} />}
                  />
                </div>
              ))}

            {current === "walls" && (
              <>
                <div className="dp-section">
                  <h4>Finish</h4>
                  <Chips
                    label="Wall finish"
                    options={["paint", "marble", "wallpaper"] as const}
                    labels={{ paint: "Paint", marble: "Marble", wallpaper: "Wallpaper" }}
                    value={walls.finish === "marble" || walls.finish === "wallpaper" ? walls.finish : "paint"}
                    onPick={(finish) => {
                      if (finish === "paint") p.onChangeDesign({ walls: { finish, color: WALL_PAINTS[0].color, name: WALL_PAINTS[0].name } });
                      if (finish === "marble") p.onChangeDesign({ walls: { finish, color: WALL_MARBLES[0].color, name: WALL_MARBLES[0].name } });
                      if (finish === "wallpaper") p.onChangeDesign({ walls: { finish, color: WALLPAPERS[0].color, name: WALLPAPERS[0].name } });
                    }}
                  />
                </div>
                {(walls.finish === "paint" || walls.finish === "tiles" || walls.finish === "wood_panel") && (
                  <>
                    <div className="dp-section">
                      <h4>Paint colours</h4>
                      <div className="color-grid">
                        {WALL_PAINTS.map((c) => (
                          <button
                            key={c.name}
                            className={`color-swatch${walls.finish === "paint" && walls.color === c.color ? " active" : ""}`}
                            style={{ background: c.color }}
                            title={c.name}
                            aria-label={`Paint: ${c.name}`}
                            onClick={() => p.onChangeDesign({ walls: { finish: "paint", color: c.color, name: c.name } })}
                          />
                        ))}
                      </div>
                      <div className="dp-note">{walls.finish === "paint" ? (walls.name ?? "Custom colour") : "Pick a colour to paint over the current finish"}</div>
                    </div>
                    <div className="dp-section">
                      <h4>Any colour</h4>
                      <ColorWheel value={walls.color} onChange={(color) => p.onChangeDesign({ walls: { finish: "paint", color } })} />
                    </div>
                  </>
                )}
                {walls.finish === "marble" && (
                  <div className="dp-section">
                    <h4>Marble</h4>
                    <Swatches
                      label="Marble walls"
                      items={WALL_MARBLES}
                      active={(m) => walls.name === m.name}
                      onPick={(m) => p.onChangeDesign({ walls: { finish: "marble", color: m.color, name: m.name } })}
                      preview={(m) => <FinishPreview kind="marble" color={m.color} />}
                    />
                  </div>
                )}
                {walls.finish === "wallpaper" && (
                  <div className="dp-section">
                    <h4>Wallpaper</h4>
                    <Swatches
                      label="Wallpaper designs"
                      items={WALLPAPERS}
                      active={(w) => walls.name === w.name}
                      onPick={(w) => p.onChangeDesign({ walls: { finish: "wallpaper", color: w.color, name: w.name } })}
                      preview={(w) => <FinishPreview kind="wallpaper" color={w.color} pattern={w.pattern} />}
                    />
                  </div>
                )}
              </>
            )}

            {current === "windows" && (
              <>
                {!hasWindows && <div className="dp-note warn">This room has no windows of its own. Add one in Floor Plan → 2D plan.</div>}
                <div className="dp-section">
                  <h4>Type</h4>
                  <Chips label="Window type" options={WINDOW_TYPES} labels={WINDOW_TYPE_LABELS} value={windows.type} onPick={(type) => p.onChangeDesign({ windows: { ...windows, type } })} />
                </div>
                <div className="dp-section">
                  <h4>Frame</h4>
                  <Chips
                    label="Frame material"
                    options={["aluminium", "wood"] as const}
                    labels={{ aluminium: "Aluminium", wood: "Wood" }}
                    value={windows.frame}
                    onPick={(frame) =>
                      p.onChangeDesign({ windows: { ...windows, frame, color: frame === "wood" ? WOOD_TONES[0].color : ALUMINIUM_COLOURS[0].color } })
                    }
                  />
                </div>
                <div className="dp-section">
                  <h4>{windows.frame === "wood" ? "Wood" : "Colour"}</h4>
                  <Swatches
                    label="Frame colour"
                    items={windows.frame === "wood" ? WOOD_TONES : ALUMINIUM_COLOURS}
                    active={(c) => windows.color === c.color}
                    onPick={(c) => p.onChangeDesign({ windows: { ...windows, color: c.color } })}
                    preview={windows.frame === "wood" ? (c) => <FinishPreview kind="veneer" color={c.color} /> : undefined}
                  />
                </div>
                {windows.frame === "wood" && (
                  <div className="dp-section">
                    <h4>Polish</h4>
                    <Chips label="Wood polish" options={POLISHES} labels={POLISH_LABELS} value={windows.polish} onPick={(polish) => p.onChangeDesign({ windows: { ...windows, polish } })} />
                  </div>
                )}
              </>
            )}

            {current === "doors" && (
              <>
                {p.doorCount === 0 ? (
                  <div className="dp-note warn">This room has no doors. Add one in Floor Plan → 2D plan.</div>
                ) : (
                  <div className="dp-note">Applies to all {p.doorCount} {p.doorCount === 1 ? "door" : "doors"} of this room, on the side facing into it.</div>
                )}
                <div className="dp-section">
                  <h4>Design</h4>
                  <Chips label="Door design" options={DOOR_STYLES} labels={DOOR_STYLE_LABELS} value={doors.style} onPick={(style) => p.onChangeDesign({ doors: { ...doors, style } })} />
                </div>
                <div className="dp-section">
                  <h4>Wood</h4>
                  <Swatches
                    label="Door wood"
                    items={WOOD_TONES}
                    active={(c) => doors.color === c.color}
                    onPick={(c) => p.onChangeDesign({ doors: { ...doors, color: c.color } })}
                    preview={(c) => <FinishPreview kind="veneer" color={c.color} />}
                  />
                </div>
                <div className="dp-section">
                  <h4>Polish</h4>
                  <Chips label="Door polish" options={POLISHES} labels={POLISH_LABELS} value={doors.polish} onPick={(polish) => p.onChangeDesign({ doors: { ...doors, polish } })} />
                </div>
              </>
            )}

            {current === "furniture" && (
              <>
                <FurnitureToggles layers={p.layers} onToggleLayer={p.onToggleLayer} />
                <div className="dp-section">
                  <h4>In this room</h4>
                  {!design.furniture?.length ? (
                    <div className="dp-note">Nothing yet. Add pieces below; drag them in the 3D view to move them.</div>
                  ) : (
                    <ul className="item-list">
                      {design.furniture.map((f) => (
                        <li key={f.id} className={p.selectedItemId === f.id ? "selected" : undefined}>
                          <button className="item-name" onClick={() => p.onSelectItem(f.id)}>{FURNITURE[f.type].label}</button>
                          <button className="item-btn" title="Rotate (R)" aria-label={`Rotate ${FURNITURE[f.type].label}`} onClick={() => p.onRotateItem(f.id)}>↻</button>
                          <button className="item-btn" title="Remove (Delete)" aria-label={`Remove ${FURNITURE[f.type].label}`} onClick={() => p.onRemoveItem(f.id)}>✕</button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <button className="manual-btn block" onClick={p.onAddTypical}>Add a typical set for this room</button>
                </div>
                {ADDABLE.map((g) => (
                  <div className="dp-section" key={g.label}>
                    <h4>{g.label}</h4>
                    <div className="add-grid">
                      {g.types.map((t) => (
                        <button key={t} className="floor-opt" onClick={() => p.onAddFurniture(t)}>+ {FURNITURE[t].label}</button>
                      ))}
                    </div>
                  </div>
                ))}
                <div className="dp-note">Furniture is basic brown for now. Colours and materials are coming later.</div>
              </>
            )}

            {current === "kitchen" && (
              <>
                <div className="dp-section">
                  <Toggle on={!!design.kitchen} onClick={() => p.onToggleKitchen(!design.kitchen)}>Modular kitchen</Toggle>
                  <div className="dp-note">
                    Fills the kitchen with base and wall cabinets, a granite counter, sink, gas stove with chimney, fridge, pantry, and an oven and
                    microwave unit, fitted around the doors.
                  </div>
                </div>
                <div className="dp-coming">Designing the kitchen (layout, shutters, counter) is coming soon.</div>
              </>
            )}
          </div>
        </>
      )}
    </aside>
  );
}

/** "Hide furniture" for every room, with "keep basic cupboards" inside it. */
function FurnitureToggles({ layers, onToggleLayer }: { layers: Layers; onToggleLayer: (layer: LayerName) => void }) {
  return (
    <div className="dp-section toggles">
      <Toggle on={!layers.furniture} onClick={() => onToggleLayer("furniture")}>Hide furniture in every room</Toggle>
      <div className="nested">
        <Toggle on={layers.cupboards} disabled={layers.furniture} onClick={() => onToggleLayer("cupboards")}>Keep basic cupboards</Toggle>
      </div>
    </div>
  );
}
