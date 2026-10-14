"use client";

import { useEffect } from "react";
import { PlanSketch } from "@/components/PlanSketch";

const ABBREVIATIONS = [
  "MB → Master Bedroom", "B2, B3 → Bedrooms", "Drg → Drawing Room", "LR → Living Room",
  "Din → Dining Room", "K → Kitchen", "Bath → Bathroom", "WIC → Walk-in Closet",
  "PR, Puja → Pooja Room", "St → Study", "Bal → Balcony", "Store → Store Room",
  "Stair → Staircase", "O, Other → any other room",
];

const TIPS = [
  "Use a dark pen on white paper for maximum contrast",
  "Keep labels inside the room boundary",
  "One room per enclosed area — don't overlap",
  "For multi-floor homes, draw each floor separately and note Floor 1, Floor 2",
  "Digital sketches (iPad, tablet) work even better than paper",
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
          <p className="tut-note">
            A room that isn&apos;t on this list, like a home office, gaming room or gym? Write its name, such as{" "}
            <span className="code-inline">Gaming Room</span>, or mark it <span className="code-inline">O Office</span>. A room marked only{" "}
            <span className="code-inline">O</span> is added as &ldquo;Other&rdquo;, and you can rename it.
          </p>
        </Step>
        <Step n={4} title="Add dimensions (optional)">
          <p>
            Write room sizes under labels like <span className="code-inline">MB 14×13</span>: width (left to right) × length (top to bottom), in feet. If you skip this, the AI will estimate based on proportions.
          </p>
        </Step>
        <Step n={5} title="Take a clear photo">
          <p>Place the sketch on a flat surface. Good lighting, no shadows across the drawing. Hold the camera directly above (bird&apos;s eye view). The whole sketch should be visible with no cropping.</p>
        </Step>

        <div className="example-sketch">
          <p>Example sketch: a 3BHK</p>
          <PlanSketch variant="sketch" style={{ width: "100%", fontFamily: "monospace" }} />
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
