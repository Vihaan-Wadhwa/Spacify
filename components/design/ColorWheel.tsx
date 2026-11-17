"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  value: string;
  onChange: (hex: string) => void;
};

type Hsv = { h: number; s: number; v: number };

function hexToHsv(hex: string): Hsv {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: ((h * 60) + 360) % 360, s: max ? d / max : 0, v: max };
}

function hsvToHex({ h, s, v }: Hsv): string {
  const f = (k: number) => {
    const kk = (k + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(kk, 4 - kk, 1));
  };
  return `#${[f(5), f(3), f(1)].map((c) => Math.round(c * 255).toString(16).padStart(2, "0")).join("")}`;
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const SIZE = 168;

/** A hue/saturation wheel with a brightness slider and a hex field. */
export function ColorWheel({ value, onChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hsv, setHsv] = useState(() => hexToHsv(value));
  const [hex, setHex] = useState(value);
  const [synced, setSynced] = useState(value);
  // A new value from outside (a swatch was clicked) moves the wheel's marker.
  if (value !== synced) {
    setSynced(value);
    setHex(value);
    if (hsvToHex(hsv) !== value.toLowerCase()) setHsv(hexToHsv(value));
  }

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(SIZE, SIZE);
    const r = SIZE / 2;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const dx = x - r + 0.5, dy = y - r + 0.5;
        const d = Math.hypot(dx, dy) / r;
        const i = (y * SIZE + x) * 4;
        if (d > 1) continue;
        const c = hsvToHex({ h: (Math.atan2(dy, dx) * 180) / Math.PI + 180, s: d, v: hsv.v });
        const n = parseInt(c.slice(1), 16);
        img.data[i] = (n >> 16) & 255;
        img.data[i + 1] = (n >> 8) & 255;
        img.data[i + 2] = n & 255;
        img.data[i + 3] = d > 0.985 ? Math.round((1 - d) / 0.015 * 255) : 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [hsv.v]);

  function commit(next: Hsv) {
    setHsv(next);
    const out = hsvToHex(next);
    setHex(out);
    setSynced(out);
    onChange(out);
  }

  function pick(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const dx = e.clientX - rect.left - rect.width / 2, dy = e.clientY - rect.top - rect.height / 2;
    const s = Math.min(1, Math.hypot(dx, dy) / (rect.width / 2));
    commit({ ...hsv, h: (Math.atan2(dy, dx) * 180) / Math.PI + 180, s });
  }

  const angle = ((hsv.h - 180) * Math.PI) / 180;
  const marker = { left: `${50 + Math.cos(angle) * hsv.s * 50}%`, top: `${50 + Math.sin(angle) * hsv.s * 50}%` };

  return (
    <div className="color-wheel">
      <div className="wheel-wrap">
        <canvas
          ref={canvasRef}
          width={SIZE}
          height={SIZE}
          className="wheel"
          aria-label="Colour wheel: hue and saturation"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            pick(e);
          }}
          onPointerMove={(e) => e.buttons && pick(e)}
        />
        <span className="wheel-marker" style={{ ...marker, background: hex }} />
      </div>
      <label className="wheel-row">
        <span>Brightness</span>
        <input type="range" min={0} max={1} step={0.01} value={hsv.v} onChange={(e) => commit({ ...hsv, v: Number(e.target.value) })} />
      </label>
      <label className="wheel-row">
        <span>Hex</span>
        <span className="hex-chip" style={{ background: hex }} />
        <input
          className="hex-input"
          value={hex}
          maxLength={7}
          spellCheck={false}
          aria-invalid={!HEX.test(hex)}
          onChange={(e) => {
            const v = e.target.value.startsWith("#") ? e.target.value : `#${e.target.value}`;
            setHex(v);
            if (HEX.test(v)) {
              setHsv(hexToHsv(v));
              setSynced(v.toLowerCase());
              onChange(v.toLowerCase());
            }
          }}
        />
      </label>
    </div>
  );
}
