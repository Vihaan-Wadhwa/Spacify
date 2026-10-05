import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth/AuthForm";
import { AuthPage } from "@/components/auth/AuthPage";
import { safeNext } from "@/lib/auth";
import { getCurrentUser } from "@/lib/server/currentUser";

export const metadata: Metadata = { title: "Log in — Spacify" };

/** /login?next=/design?project=2 — goes to `next` (a path on this site) after logging in, else /projects. */
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  // If the database is down, show the form; submitting it will say what's wrong.
  if (await getCurrentUser().catch(() => null)) redirect("/projects");
  return (
    <AuthPage>
      <AuthForm mode="login" next={safeNext(typeof next === "string" ? next : null)} />
    </AuthPage>
  );
}
