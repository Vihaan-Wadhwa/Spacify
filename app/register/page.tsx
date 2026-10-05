import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth/AuthForm";
import { AuthPage } from "@/components/auth/AuthPage";
import { safeNext } from "@/lib/auth";
import { getCurrentUser } from "@/lib/server/currentUser";

export const metadata: Metadata = { title: "Create an account — Spacify" };

/** /register?name=…&email=… (prefilled from the landing page) &next=… */
export default async function RegisterPage({ searchParams }: PageProps<"/register">) {
  const { next, name, email } = await searchParams;
  if (await getCurrentUser().catch(() => null)) redirect("/projects");
  const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  return (
    <AuthPage>
      <AuthForm mode="register" next={safeNext(str(next))} defaults={{ name: str(name), email: str(email) }} />
    </AuthPage>
  );
}
