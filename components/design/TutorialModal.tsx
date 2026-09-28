"use client";

import { useEffect } from "react";

const ABBREVIATIONS = [
  "MB → Master Bedroom", "LR → Living Room", "K → Kitchen", "B1, B2 → Bedrooms",
  "Bath → Bathroom", "WIC → Walk-in Closet", "PR → Pooja Room", "St → Study",
  "Bal → Balcony", "Store → Store Room", "Stair → Staircase", "DR → Dining Room",
];

const TIPS = [
  "Use a dark pen on white paper for maximum contrast",
  "Keep labels inside the room boundary",
  "One room per enclosed area — don't overlap",
  "For multi-floor homes, draw each floor separately and note Floor 1, Floor 2",
  "Digital sketches (iPad, tablet) work even better than paper",
];

const SKETCH_ROOMS = [
  { x: 10, y: 10, w: 180, h: 130, fill: "rgba(200,240,160,0.05)", label: "LR", dims: "18×13", tx: 100, ty: 72 },
  { x: 190, y: 10, w: 200, h: 140, fill: "rgba(200,160,240,0.05)", label: "MB", dims: "14×13", tx: 290, ty: 77 },
  { x: 10, y: 140, w: 110, h: 130, fill: "rgba(160,240,200,0.05)", label: "K", dims: "12×10", tx: 65, ty: 202 },
  { x: 120, y: 140, w: 140, h: 130, fill: "rgba(240,200,160,0.05)", label: "B1", dims: "12×12", tx: 190, ty: 202 },
  { x: 260, y: 150, w: 80, h: 70, fill: "rgba(160,200,240,0.05)", label: "Bath", tx: 300, ty: 187 },
  { x: 260, y: 220, w: 80, h: 50, fill: "none", label: "Store", tx: 300, ty: 248 },
];

type Props = { onClose: () => void; onUpload: () => void };

export function TutorialModal({ onClose, onUpload }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="tutorial-title">
        <button className="modal-close" onClick={onClose} aria-label="Close tutorial">×</button>
        <h2 id="tutorial-title">How to sketch your floor plan</h2>
        <p className="modal-intro">Follow these simple steps to draw a floor plan that Spacify&apos;s AI can read accurately.</p>

        <Step n={1} title="Draw the outer boundary">
          <p>Draw a rectangle or L-shape representing the total plot area. Use thick lines for outer walls. Keep it proportional — a 40×30 ft plot should look wider than it is tall.</p>
        </Step>
        <Step n={2} title="Divide into rooms">
          <p>Draw internal walls as lines dividing the space. Each enclosed area = one room. Don&apos;t worry about perfect straight lines — the AI handles rough sketches well.</p>
        </Step>
        <Step n={3} title="Label every room">
          <p>Write a label inside each room. You can use full names or short codes:</p>
          <div className="abbr-grid">
            {ABBREVIATIONS.map((a) => <div key={a}>{a}</div>)}
          </div>
        </Step>
        <Step n={4} title="Add dimensions (optional)">
          <p>
            Write room sizes next to labels like <span className="code-inline">MB 14×13</span>. If you skip this, the AI will estimate based on proportions.
          </p>
        </Step>
        <Step n={5} title="Take a clear photo">
          <p>Place the sketch on a flat surface. Good lighting, no shadows across the drawing. Hold the camera directly above (bird&apos;s eye view). The whole sketch should be visible with no cropping.</p>
        </Step>

        <div className="example-sketch">
          <p>Example sketch</p>
          <svg viewBox="0 0 400 280" style={{ width: "100%", fontFamily: "monospace" }} xmlns="http://www.w3.org/2000/svg">
            <rect x="10" y="10" width="380" height="260" fill="none" stroke="currentColor" strokeWidth="3" opacity="0.4" />
            {SKETCH_ROOMS.map((r) => (
              <g key={r.label}>
                <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={r.fill} stroke="currentColor" strokeWidth="1.5" opacity="0.3" />
                <text x={r.tx} y={r.ty} textAnchor="middle" fontSize={r.dims ? 13 : 11} fill="currentColor" opacity="0.7">{r.label}</text>
                {r.dims && <text x={r.tx} y={r.ty + 16} textAnchor="middle" fontSize="10" fill="currentColor" opacity="0.4">{r.dims}</text>}
              </g>
            ))}
            <path d="M100 140 Q115 140 115 125" stroke="currentColor" strokeWidth="1" strokeDasharray="3 2" fill="none" opacity="0.4" />
            <path d="M190 140 Q190 155 205 155" stroke="currentColor" strokeWidth="1" strokeDasharray="3 2" fill="none" opacity="0.4" />
            <line x1="10" y1="4" x2="390" y2="4" stroke="currentColor" strokeWidth="0.5" opacity="0.25" />
            <text x="200" y="3" textAnchor="middle" fontSize="8" fill="currentColor" opacity="0.35">40 ft</text>
            <line x1="4" y1="10" x2="4" y2="270" stroke="currentColor" strokeWidth="0.5" opacity="0.25" />
            <text x="2" y="145" textAnchor="middle" fontSize="8" fill="currentColor" opacity="0.35" transform="rotate(-90,2,145)">30 ft</text>
          </svg>
        </div>

        <div className="tips">
          <p>Tips for best results</p>
          <ul>{TIPS.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>

        <button className="upload-btn wide" onClick={onUpload}>I&apos;m ready — upload my sketch</button>
      </div>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="tut-step">
      <div className="tut-num">{n}</div>
      <div>
        <h4>{title}</h4>
        {children}
      </div>
    </div>
  );
}
