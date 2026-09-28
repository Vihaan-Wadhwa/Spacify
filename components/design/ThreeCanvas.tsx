"use client";

import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import { SpacifyScene, type SceneState } from "@/lib/scene/SpacifyScene";
import type { CameraPreset } from "@/lib/rooms";
import type { Theme } from "@/components/ThemeProvider";

export type ThreeCanvasHandle = {
  setCameraPreset: (preset: CameraPreset) => void;
  zoom: (delta: number) => void;
  snapshot: () => string | null;
};

type Props = SceneState & {
  theme: Theme;
  walking: boolean;
  onSelect: (roomId: number | null) => void;
  onWalkExit: () => void;
  ref?: Ref<ThreeCanvasHandle>;
};

/**
 * Hosts the Three.js scene. Three.js touches the DOM and WebGL directly, so this only runs on the client:
 * the scene is created once on mount and receives state updates through effects.
 */
export function ThreeCanvas({ rooms, floors, layers, designs, selectedId, theme, walking, onSelect, onWalkExit, ref }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SpacifyScene | null>(null);

  // Keep the latest callbacks without recreating the scene when they change.
  const handlersRef = useRef({ onSelect, onWalkExit });
  useEffect(() => {
    handlersRef.current = { onSelect, onWalkExit };
  });

  useEffect(() => {
    const scene = new SpacifyScene(canvasRef.current!, wrapRef.current!, tooltipRef.current, {
      onSelect: (id) => handlersRef.current.onSelect(id),
      onWalkExit: () => handlersRef.current.onWalkExit(),
    });
    sceneRef.current = scene;
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.update({ rooms, floors, layers, designs, selectedId });
  }, [rooms, floors, layers, designs, selectedId]);

  useEffect(() => {
    sceneRef.current?.setTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (walking) sceneRef.current?.enterWalk();
    else sceneRef.current?.exitWalk();
  }, [walking]);

  useImperativeHandle(ref, () => ({
    setCameraPreset: (preset) => sceneRef.current?.setCameraPreset(preset),
    zoom: (delta) => sceneRef.current?.zoom(delta),
    snapshot: () => sceneRef.current?.snapshot() ?? null,
  }));

  return (
    <div ref={wrapRef} style={{ position: "absolute", inset: 0 }}>
      <canvas ref={canvasRef} className="three-canvas" />
      <div ref={tooltipRef} className="tooltip" />
    </div>
  );
}
