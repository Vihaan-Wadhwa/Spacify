"use client";

import { useTheme } from "@/components/ThemeProvider";

export function ThemeToggleButton({ className }: { className: string }) {
  const { theme, toggleTheme } = useTheme();
  return (
    <button className={className} onClick={toggleTheme} title="Toggle theme" aria-label="Toggle theme">
      {theme === "dark" ? "☽" : "○"}
    </button>
  );
}
