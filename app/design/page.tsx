import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DesignStudio } from "@/components/design/DesignStudio";
import type { SavedProject } from "@/lib/projects";
import type { CurrentUser } from "@/lib/auth";
import { getCurrentUser, requireUser } from "@/lib/server/currentUser";
import { HttpError, describeError } from "@/lib/server/errors";
import { parseId } from "@/lib/server/params";
import { getProject } from "@/lib/server/projects";
import "./studio.css";

export const metadata: Metadata = {
  title: "Spacify — 3D Model Builder",
};

/**
 * /design              → new, unsaved project (logged in)
 * /design?project=12   → loads saved project 12 from PostgreSQL (on the server, before the page renders; logged in)
 * /design?demo=1       → sample rooms, open to everyone; saving needs a login
 */
export default async function DesignPage({ searchParams }: PageProps<"/design">) {
  const { demo, project } = await searchParams;
  const projectParam = typeof project === "string" ? project : null;
  const isDemo = demo === "1" && projectParam === null;

  let user: CurrentUser | null = null;
  let initialProject: SavedProject | null = null;
  let loadError: string | null = null;
  if (isDemo) {
    // The demo works without a database, so a lookup failure just means "not logged in".
    user = await getCurrentUser().catch(() => null);
  } else {
    const signedIn = await requireUser(projectParam ? `/design?project=${encodeURIComponent(projectParam)}` : "/design");
    user = signedIn;
    if (projectParam !== null) {
      try {
        initialProject = await getProject(signedIn.id, parseId(projectParam, "project id"));
      } catch (err) {
        if (err instanceof HttpError && (err.status === 404 || err.status === 400)) notFound();
        loadError = describeError(err, "design page").message;
      }
    }
  }

  return <DesignStudio demo={isDemo} user={user} initialProject={initialProject} loadError={loadError} />;
}
