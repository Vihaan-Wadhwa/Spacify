"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { CurrentUser } from "@/lib/auth";
import "./UserMenu.css";

/** The signed-in user's name; opens a small menu with their email, My projects and Log out. */
export function UserMenu({ user }: { user: CurrentUser }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on a click outside or Esc.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="user-menu" ref={ref}>
      <button className="user-menu-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu">
        <span className="user-menu-avatar" aria-hidden>{user.name.trim().charAt(0).toUpperCase() || "?"}</span>
        <span className="user-menu-name">{user.name}</span>
      </button>
      {open && (
        <div className="user-menu-pop" role="menu">
          <div className="user-menu-who">
            <strong>{user.name}</strong>
            <span>{user.email}</span>
          </div>
          <Link href="/projects" role="menuitem" onClick={() => setOpen(false)}>My projects</Link>
          {/* A real form post, so logging out works even before the page's JavaScript loads */}
          <form method="post" action="/api/auth/logout">
            <button type="submit" role="menuitem">Log out</button>
          </form>
        </div>
      )}
    </div>
  );
}
