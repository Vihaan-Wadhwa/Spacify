// Account validation and helpers shared by the browser, the API and proxy.ts.
import { z } from "zod";

/** Name of the cookie holding the raw session token (the database only stores its SHA-256 hash). */
export const SESSION_COOKIE = "spacify_session";

/** What the UI is told about the signed-in user. */
export type CurrentUser = { id: number; name: string; email: string };

const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(255, "That email is too long.")
  .pipe(z.email("Enter a valid email address."));

// bcrypt only looks at the first 72 bytes, so longer passwords are refused rather than silently cut.
const password = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .refine((p) => new TextEncoder().encode(p).length <= 72, "Password must be at most 72 characters.");

export const RegisterInput = z
  .object({
    name: z.string().trim().min(1, "Enter your name.").max(100, "Name must be at most 100 characters."),
    email,
    password,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, { message: "Passwords don't match.", path: ["confirmPassword"] });

export type RegisterInput = z.infer<typeof RegisterInput>;

export const LoginInput = z.object({
  email: z.string().trim().toLowerCase().min(1, "Enter your email."),
  password: z.string().min(1, "Enter your password."),
});

export type LoginInput = z.infer<typeof LoginInput>;

/** Where to go after logging in: `next` if it's a path on this site, otherwise /projects. */
export function safeNext(next: string | null | undefined): string {
  // "//evil.com" and "/\evil.com" are treated by browsers as other sites.
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/projects";
  return next;
}

/** The login page, coming back to `next` afterwards. */
export function loginPath(next: string): string {
  return `/login?next=${encodeURIComponent(next)}`;
}
