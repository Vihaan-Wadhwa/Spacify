import type { Metadata } from "next";
import "@fontsource-variable/anek-latin/wdth.css";
import "@fontsource-variable/martian-mono";
import { StartFlow } from "@/components/start/StartFlow";
import { HOME_TYPES, type HomeType } from "@/lib/start";
import { getCurrentUser } from "@/lib/server/currentUser";
import "./start.css";

export const metadata: Metadata = {
  title: "Start your home — Spacify",
  description: "Answer a few questions and watch Spacify lay out a first plan of your home, then open it in the 3D studio.",
};

/** /start?type=house (from the landing page's first question) · /start?sketch=1. Open to everyone; login comes at the end. */
export default async function StartPage({ searchParams }: PageProps<"/start">) {
  const { type, sketch } = await searchParams;
  const user = await getCurrentUser().catch(() => null);
  const initialType = typeof type === "string" && (HOME_TYPES as readonly string[]).includes(type) ? (type as HomeType) : null;
  return <StartFlow user={user} initialType={initialType} initialSketch={sketch === "1"} />;
}
