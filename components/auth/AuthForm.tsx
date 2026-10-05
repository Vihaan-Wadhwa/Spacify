"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import type { ZodError } from "zod";
import { LoginInput, RegisterInput } from "@/lib/auth";

type Mode = "login" | "register";

type Field = { name: string; label: string; type: string; autoComplete: string; placeholder?: string };

const FIELDS: Record<Mode, Field[]> = {
  login: [
    { name: "email", label: "Email address", type: "email", autoComplete: "email", placeholder: "you@example.com" },
    { name: "password", label: "Password", type: "password", autoComplete: "current-password" },
  ],
  register: [
    { name: "name", label: "Your name", type: "text", autoComplete: "name", placeholder: "Rahul Sharma" },
    { name: "email", label: "Email address", type: "email", autoComplete: "email", placeholder: "you@example.com" },
    { name: "password", label: "Password", type: "password", autoComplete: "new-password", placeholder: "At least 8 characters" },
    { name: "confirmPassword", label: "Confirm password", type: "password", autoComplete: "new-password" },
  ],
};

function fieldErrors(err: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) out[String(issue.path[0] ?? "")] ??= issue.message;
  return out;
}

type Props = {
  mode: Mode;
  /** Where to go after success (already checked to be a path on this site). */
  next: string;
  /** Prefilled values, e.g. name and email from the landing page form. */
  defaults?: Partial<Record<string, string>>;
};

/** The login / register card. Checks the fields here first, then posts to /api/auth/<mode>. */
export function AuthForm({ mode, next, defaults = {} }: Props) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget));
    const parsed = (mode === "login" ? LoginInput : RegisterInput).safeParse(data);
    setFormError(null);
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    setPending(true);
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        // A full navigation, so every server-rendered page sees the new session.
        window.location.assign(next);
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string; fields?: Record<string, string> };
      if (body.fields && Object.keys(body.fields).length) setErrors(body.fields);
      else setFormError(body.error ?? "Something went wrong. Please try again.");
    } catch {
      setFormError("Can't reach the server. Check your connection and try again.");
    }
    setPending(false);
  }

  const otherHref = `${mode === "login" ? "/register" : "/login"}${next === "/projects" ? "" : `?next=${encodeURIComponent(next)}`}`;

  return (
    <div className="auth-card">
      <h1>{mode === "login" ? "Welcome back" : <>Create your <em>account</em></>}</h1>
      <p className="auth-sub">
        {mode === "login" ? "Log in to open and save your projects." : "Save your designs and pick up where you left off."}
      </p>

      <form onSubmit={onSubmit} noValidate>
        {FIELDS[mode].map((f) => (
          <div className="auth-field" key={f.name}>
            <label htmlFor={`auth-${f.name}`}>{f.label}</label>
            <input
              id={`auth-${f.name}`}
              name={f.name}
              type={f.type}
              autoComplete={f.autoComplete}
              placeholder={f.placeholder}
              defaultValue={defaults[f.name]}
              required
              aria-invalid={errors[f.name] ? true : undefined}
              aria-describedby={errors[f.name] ? `auth-${f.name}-error` : undefined}
            />
            {errors[f.name] && (
              <p className="auth-field-error" id={`auth-${f.name}-error`}>{errors[f.name]}</p>
            )}
          </div>
        ))}

        {formError && <p className="auth-error" role="alert">{formError}</p>}

        <button className="auth-submit" type="submit" disabled={pending}>
          {pending ? (mode === "login" ? "Logging in…" : "Creating account…") : mode === "login" ? "Log in" : "Create account"}
        </button>
      </form>

      <p className="auth-switch">
        {mode === "login" ? "New to Spacify? " : "Already have an account? "}
        <Link href={otherHref}>{mode === "login" ? "Create an account" : "Log in"}</Link>
      </p>
    </div>
  );
}
