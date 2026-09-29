import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { ProjectCard } from "@/components/projects/ProjectCard";
import { ThemeToggleButton } from "@/components/ThemeToggleButton";
import type { ProjectListItem } from "@/lib/projects";
import { getCurrentUserId } from "@/lib/server/currentUser";
import { describeError } from "@/lib/server/errors";
import { listProjects } from "@/lib/server/projects";
import "./projects.css";

export const metadata: Metadata = { title: "My projects — Spacify" };

export default async function ProjectsPage() {
  await connection(); // always read fresh from the database, never prerender at build time
  let projects: ProjectListItem[] = [];
  let error: string | null = null;
  try {
    projects = await listProjects(await getCurrentUserId());
  } catch (err) {
    error = describeError(err, "projects page").message;
  }

  const own = projects.filter((p) => p.access === "owner");
  const shared = projects.filter((p) => p.access !== "owner");

  return (
    <div className="projects-page">
      <header className="pp-nav">
        <Link href="/" className="pp-logo">
          Spac<span>i</span>fy
        </Link>
        <div className="pp-nav-right">
          <ThemeToggleButton className="pp-theme" />
        </div>
      </header>

      <main className="pp-main">
        <div className="pp-head">
          <div>
            <h1>My projects</h1>
            <p>Saved in PostgreSQL. Open one to keep designing.</p>
          </div>
          <Link href="/design" className="pp-new">+ New project</Link>
        </div>

        {error ? (
          <div className="pp-error" role="alert">
            <strong>Couldn&apos;t load your projects.</strong>
            <p>{error}</p>
          </div>
        ) : (
          <>
            {own.length === 0 ? (
              <div className="pp-empty">
                <p>You haven&apos;t saved a project yet.</p>
                <Link href="/design" className="pp-new">Start a project</Link>
              </div>
            ) : (
              <div className="pp-grid">
                {own.map((p) => <ProjectCard key={p.id} project={p} />)}
              </div>
            )}

            {shared.length > 0 && (
              <>
                <h2>Shared with me</h2>
                <div className="pp-grid">
                  {shared.map((p) => <ProjectCard key={p.id} project={p} />)}
                </div>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
