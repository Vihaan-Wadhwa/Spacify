import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DesignStudio } from "@/components/design/DesignStudio";
import type { SavedProject } from "@/lib/projects";
import { getCurrentUserId } from "@/lib/server/currentUser";
import { HttpError, describeError } from "@/lib/server/errors";
import { parseId } from "@/lib/server/params";
import { getProject } from "@/lib/server/projects";
import "./studio.css";

export const metadata: Metadata = {
  title: "Spacify — 3D Model Builder",
};

/**
 * /design              → new, unsaved project
 * /design?project=12   → loads saved project 12 from PostgreSQL (on the server, before the page renders)
 * /design?demo=1       → sample rooms, not saved
 */
export default async function DesignPage({ searchParams }: PageProps<"/design">) {
  const { demo, project } = await searchParams;

  let initialProject: SavedProject | null = null;
  let loadError: string | null = null;
  if (typeof project === "string") {
    try {
      initialProject = await getProject(await getCurrentUserId(), parseId(project, "project id"));
    } catch (err) {
      if (err instanceof HttpError && (err.status === 404 || err.status === 400)) notFound();
      loadError = describeError(err, "design page").message;
    }
  }

  return <DesignStudio demo={demo === "1" && !initialProject} initialProject={initialProject} loadError={loadError} />;
}
