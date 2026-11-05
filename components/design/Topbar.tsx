"use client";

import Link from "next/link";
import { ThemeToggleButton } from "@/components/ThemeToggleButton";
import { UserMenu } from "@/components/UserMenu";
import { loginPath, type CurrentUser } from "@/lib/auth";
import type { StudioTab } from "@/lib/rooms";

const TABS: { id: StudioTab; label: string }[] = [
  { id: "floor", label: "Floor Plan" },
  { id: "interior", label: "Interior Design" },
  { id: "architecture", label: "Architecture" },
];

export type SaveState = "unsaved" | "saving" | "saved" | "readonly";

const SAVE_LABELS: Record<SaveState, string> = {
  unsaved: "Save",
  saving: "Saving…",
  saved: "Saved",
  readonly: "View only",
};

type Props = {
  /** null in the demo when nobody is logged in: Save becomes a link to the login page. */
  user: CurrentUser | null;
  tab: StudioTab;
  onTab: (tab: StudioTab) => void;
  aiOpen: boolean;
  projectName: string;
  saveState: SaveState;
  onProjectName: (name: string) => void;
  onTogglePanel: () => void;
  onToggleAi: () => void;
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
      <nav className="topbar-center" aria-label="Panels">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab-btn${p.tab === t.id && !p.aiOpen ? " active" : ""}`}
            aria-current={p.tab === t.id && !p.aiOpen ? "page" : undefined}
            onClick={() => p.onTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div className="topbar-right">
        <button className="icon-btn" title="Toggle side panel" aria-label="Toggle side panel" onClick={p.onTogglePanel}>☰</button>
        <ThemeToggleButton className="icon-btn" />
        <button className={`icon-btn${p.aiOpen ? " active" : ""}`} title="AI assistant" aria-label="AI assistant" aria-pressed={p.aiOpen} onClick={p.onToggleAi}>✦</button>
        <button className="icon-btn" title="Export 3D view as PNG" aria-label="Export 3D view as PNG" onClick={p.onExport}>↑</button>
        <input
          className="project-name"
          aria-label="Project name"
          value={p.projectName}
          readOnly={p.saveState === "readonly"}
          onChange={(e) => p.onProjectName(e.target.value)}
        />
        {p.user ? (
          <>
            <button
              className={`save-btn ${p.saveState}`}
              onClick={p.onSave}
              disabled={!canSave}
              title={canSave ? "Save to database (Ctrl+S)" : undefined}
            >
              {canSave && <span className="save-dot" aria-hidden />}
              {SAVE_LABELS[p.saveState]}
            </button>
            <UserMenu user={p.user} />
          </>
        ) : (
          <Link href={loginPath("/design?demo=1")} className="save-btn unsaved">Log in to save</Link>
        )}
      </div>
    </header>
  );
}
