"use client";

import { useEffect, useRef, useState } from "react";
import { drawPlan } from "@/lib/plan";
import { downloadDataUrl } from "@/lib/browser";
import type { Room } from "@/lib/rooms";
import type { Theme } from "@/components/ThemeProvider";

type Props = {
  rooms: Room[];
  floors: number;
  theme: Theme;
  projectName: string;
  onExported: () => void;
};

export function PlanView({ rooms, floors, theme, projectName, onExported }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [floor, setFloor] = useState(1);
  const shownFloor = Math.min(floor, floors);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const redraw = () => drawPlan(canvas, rooms, shownFloor, theme === "dark");
    redraw();
    const observer = new ResizeObserver(redraw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [rooms, shownFloor, theme]);

  function exportPlan() {
    const canvas = canvasRef.current!;
    downloadDataUrl(canvas.toDataURL("image/png"), `${projectName || "spacify-plan"}-floor${shownFloor}-2d.png`);
    onExported();
  }

  return (
    <div className="plan-view">
      <div className="plan-toolbar">
        <span>2D Floor Plan — Scale view</span>
        {floors > 1 &&
          Array.from({ length: floors }, (_, i) => i + 1).map((f) => (
            <button key={f} className={`cam-btn small${shownFloor === f ? " active" : ""}`} onClick={() => setFloor(f)}>
              Floor {f}
            </button>
          ))}
        <div className="spacer">
          <button className="cam-btn" onClick={exportPlan}>Export PNG</button>
        </div>
      </div>
      <div className="plan-canvas-wrap">
        <canvas ref={canvasRef} className="plan-canvas" />
      </div>
    </div>
  );
}
