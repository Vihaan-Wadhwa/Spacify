"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ProjectListItem } from "@/lib/projects";

function timeAgo(iso: string) {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString();
}

export function ProjectCard({ project: p }: { project: ProjectListItem }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setDeleting(true);
    setError(null);
    const res = await fetch(`/api/projects/${p.id}`, { method: "DELETE" }).catch(() => null);
    if (res?.ok) {
      router.refresh();
      return;
    }
    const data = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    setError(data?.error ?? "Couldn't delete the project.");
    setDeleting(false);
    setConfirming(false);
  }

  return (
    <article className="pp-card">
      <Link href={`/design?project=${p.id}`} className="pp-card-link">
        <h3>{p.name}</h3>
        {p.access !== "owner" && (
          <p className="pp-shared">
            Shared by {p.ownerName} · {p.access === "edit" ? "can edit" : "view only"}
          </p>
        )}
        <dl className="pp-stats">
          <div><dt>Rooms</dt><dd>{p.roomCount}</dd></div>
          <div><dt>Area</dt><dd>{p.totalArea.toLocaleString()} sq ft</dd></div>
          <div><dt>Floors</dt><dd>{p.floors}</dd></div>
        </dl>
        <p className="pp-updated">Updated {timeAgo(p.updatedAt)}</p>
      </Link>

      {p.access === "owner" && (
        <div className="pp-actions">
          {confirming ? (
            <>
              <span>Delete for good?</span>
              <button className="pp-danger" onClick={remove} disabled={deleting}>{deleting ? "Deleting…" : "Delete"}</button>
              <button onClick={() => setConfirming(false)} disabled={deleting}>Cancel</button>
            </>
          ) : (
            <button onClick={() => setConfirming(true)}>Delete</button>
          )}
        </div>
      )}
      {error && <p className="pp-card-error" role="alert">{error}</p>}
    </article>
  );
}
