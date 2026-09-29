"use client";

import Link from "next/link";
import { ThemeToggleButton } from "@/components/ThemeToggleButton";
import type { StudioTab } from "@/lib/rooms";

const TABS: { id: StudioTab; label: string }[] = [
  { id: "model", label: "3D Model" },
  { id: "plan", label: "Floor Plan" },
  { id: "ai", label: "AI Assistant" },
];

export type SaveState = "unsaved" | "saving" | "saved" | "readonly";

const SAVE_LABELS: Record<SaveState, string> = {
  unsaved: "Save",
  saving: "Saving…",
  saved: "Saved",
  readonly: "View only",
};

type Props = {
  tab: StudioTab;
  onTab: (tab: StudioTab) => void;
  walking: boolean;
  designOpen: boolean;
  projectName: string;
  saveState: SaveState;
  onProjectName: (name: string) => void;
  onTogglePanel: () => void;
  onWalkthrough: () => void;
  onToggleDesign: () => void;
  onExport: () => void;
  onSave: () => void;
};

export function Topbar(p: Props) {
  const canSave = p.saveState === "unsaved";
  return (
    <header className="topbar">
      <div className="topbar-left">
        <Link href="/" className="logo">
          Spac<span>i</span>fy
        </Link>
        <Link href="/projects" className="topbar-link">My projects</Link>
      </div>
      <nav className="topbar-center" aria-label="Views">
        {TABS.map((t) => (
          <button key={t.id} className={`tab-btn${p.tab === t.id ? " active" : ""}`} onClick={() => p.onTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
      <div className="topbar-right">
        <button className="icon-btn" title="Toggle panel" aria-label="Toggle rooms panel" onClick={p.onTogglePanel}>☰</button>
        <ThemeToggleButton className="icon-btn" />
        <button className={`icon-btn${p.walking ? " active" : ""}`} title="Walkthrough mode (WASD)" aria-label="Walkthrough mode" onClick={p.onWalkthrough}>⊕</button>
        <button className={`icon-btn${p.designOpen ? " active" : ""}`} title="Room design" aria-label="Room design" onClick={p.onToggleDesign}>◈</button>
        <button className="icon-btn" title="Export PNG" aria-label="Export 3D view as PNG" onClick={p.onExport}>↑</button>
        <input
          className="project-name"
          aria-label="Project name"
          value={p.projectName}
          readOnly={p.saveState === "readonly"}
          onChange={(e) => p.onProjectName(e.target.value)}
        />
        <button
          className={`save-btn ${p.saveState}`}
          onClick={p.onSave}
          disabled={!canSave}
          title={canSave ? "Save to database (Ctrl+S)" : undefined}
        >
          {canSave && <span className="save-dot" aria-hidden />}
          {SAVE_LABELS[p.saveState]}
        </button>
      </div>
    </header>
  );
}
