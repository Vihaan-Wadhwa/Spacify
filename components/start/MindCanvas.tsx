"use client";

import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import type { MindInput, MindScene } from "@/lib/scene/MindScene";
import type { PlanRoom } from "@/lib/start";

export type MindCanvasHandle = {
  setAnswers: (input: MindInput) => void;
  build: () => void;
  reveal: (rooms: PlanRoom[]) => void;
  unreveal: () => void;
};

type Props = {
  className?: string;
  /** Only the revealed house, without the particle field. */
  houseOnly?: boolean;
  /** Shifts the drawing sideways in px to clear a panel. */
  offset?: number;
  onRevealed?: () => void;
  ref?: Ref<MindCanvasHandle>;
};

/**
 * Hosts MindScene. Three.js is loaded on the client only, after first paint, so the page's text and
 * controls never wait for it. Without WebGL the canvas just stays empty and the page still works.
 */
export function MindCanvas({ className, houseOnly = false, offset = 0, onRevealed, ref }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<MindScene | null>(null);
  const queued = useRef<((s: MindScene) => void)[]>([]);
  const onRevealedRef = useRef(onRevealed);
  useEffect(() => {
    onRevealedRef.current = onRevealed;
  });

  useEffect(() => {
    let disposed = false;
    import("@/lib/scene/MindScene")
      .then(({ MindScene }) => {
        if (disposed || !canvasRef.current) return;
        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        let scene: MindScene;
        try {
          scene = new MindScene(canvasRef.current, {
            houseOnly,
            reducedMotion,
            onRevealed: () => onRevealedRef.current?.(),
          });
        } catch {
          return; // no WebGL
        }
        sceneRef.current = scene;
        for (const fn of queued.current) fn(scene);
        queued.current = [];
      })
      .catch(() => {});
    return () => {
      disposed = true;
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, [houseOnly]);

  useEffect(() => {
    const apply = (s: MindScene) => s.setOffset(offset);
    if (sceneRef.current) apply(sceneRef.current);
    else queued.current.push(apply);
  }, [offset]);

  useImperativeHandle(ref, () => {
    const run = (fn: (s: MindScene) => void) => (sceneRef.current ? fn(sceneRef.current) : queued.current.push(fn));
    return {
      setAnswers: (input) => run((s) => s.setAnswers(input)),
      build: () => run((s) => s.build()),
      reveal: (rooms) => run((s) => s.reveal(rooms)),
      unreveal: () => run((s) => s.unreveal()),
    };
  }, []);

  return (
    <div className={className}>
      <canvas ref={canvasRef} aria-hidden="true" />
    </div>
  );
}
