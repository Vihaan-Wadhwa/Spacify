"use client";

import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import { SpacifyScene, type ItemRef, type SceneState } from "@/lib/scene/SpacifyScene";
import type { CameraPreset } from "@/lib/rooms";

export type ThreeCanvasHandle = {
  setCameraPreset: (preset: CameraPreset) => void;
  zoom: (delta: number) => void;
  focusRoom: (roomId: number) => void;
  snapshot: () => string | null;
};

type Props = SceneState & {
  walking: boolean;
  /** Room the walkthrough starts in (null: the living room or first room). */
  walkRoomId: number | null;
  onSelect: (roomId: number | null) => void;
  onWalkExit: () => void;
  onSelectItem: (item: ItemRef | null) => void;
  onMoveItem: (item: ItemRef, x: number, z: number) => void;
  ref?: Ref<ThreeCanvasHandle>;
};

/**
 * Hosts the Three.js scene. Three.js touches the DOM and WebGL directly, so this only runs on the client:
 * the scene is created once on mount and receives state updates through effects.
 */
export function ThreeCanvas(props: Props) {
  const { rooms, floors, layers, designs, selectedId, viewFloor, editFurniture, selectedItem, walking, walkRoomId, ref } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SpacifyScene | null>(null);

  // Keep the latest callbacks without recreating the scene when they change.
  const handlersRef = useRef(props);
  useEffect(() => {
    handlersRef.current = props;
  });

  useEffect(() => {
    const scene = new SpacifyScene(canvasRef.current!, wrapRef.current!, tooltipRef.current, {
      onSelect: (id) => handlersRef.current.onSelect(id),
      onWalkExit: () => handlersRef.current.onWalkExit(),
      onSelectItem: (item) => handlersRef.current.onSelectItem(item),
      onMoveItem: (item, x, z) => handlersRef.current.onMoveItem(item, x, z),
    });
    sceneRef.current = scene;
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.update({ rooms, floors, layers, designs, selectedId, viewFloor, editFurniture, selectedItem });
  }, [rooms, floors, layers, designs, selectedId, viewFloor, editFurniture, selectedItem]);

  useEffect(() => {
    if (walking) sceneRef.current?.enterWalk(walkRoomId);
    else sceneRef.current?.exitWalk();
    // Only entering/leaving matters; the start room is read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walking]);

  useImperativeHandle(ref, () => ({
    setCameraPreset: (preset) => sceneRef.current?.setCameraPreset(preset),
    zoom: (delta) => sceneRef.current?.zoom(delta),
    focusRoom: (roomId) => sceneRef.current?.focusRoom(roomId),
    snapshot: () => sceneRef.current?.snapshot() ?? null,
  }));

  return (
    <div ref={wrapRef} style={{ position: "absolute", inset: 0 }}>
      <canvas ref={canvasRef} className="three-canvas" />
      <div ref={tooltipRef} className="tooltip" />
    </div>
  );
}
