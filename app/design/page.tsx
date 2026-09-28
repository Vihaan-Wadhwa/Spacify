import type { Metadata } from "next";
import { DesignStudio } from "@/components/design/DesignStudio";
import "./studio.css";

export const metadata: Metadata = {
  title: "Spacify — 3D Model Builder",
};

export default async function DesignPage({ searchParams }: PageProps<"/design">) {
  // /design?demo=1 opens with sample rooms (used by the landing page's "Generate 3D Model" button).
  const { demo } = await searchParams;
  return <DesignStudio demo={demo === "1"} />;
}
