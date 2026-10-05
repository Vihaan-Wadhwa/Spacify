import Link from "next/link";
import { ThemeToggleButton } from "@/components/ThemeToggleButton";
import "./auth.css";

/** Page frame for /login and /register: a small header and the card centred below it. */
export function AuthPage({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-page">
      <header className="auth-nav">
        <Link href="/" className="auth-logo">
          Spac<span>i</span>fy
        </Link>
        <ThemeToggleButton className="auth-theme" />
      </header>
      <main className="auth-main">
        {children}
        <p className="auth-demo">
          Just looking? <Link href="/design?demo=1">Try the demo</Link> without an account.
        </p>
      </main>
    </div>
  );
}
