"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { supabaseConfigured } from "@/lib/supabase/config";
import { hasAccess, type Role } from "@/lib/types";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { btn, cx } from "@/lib/ui";

const configured = supabaseConfigured;

const ERRORS: Record<string, string> = {
  unauthorized: "This account isn't registered for access. Please ask an administrator to add you.",
  "no-access": "Your account has no access profile yet. Please contact an administrator.",
  auth: "Sign-in failed. Please try again.",
};

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z" />
      <path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z" />
      <path fill="#FBBC05" d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z" />
      <path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z" />
    </svg>
  );
}


export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [oauthBusy, setOauthBusy] = useState<"google" | null>(null);

  // Show any error passed back from the OAuth callback / server guard.
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("error");
    if (code && ERRORS[code]) setError(ERRORS[code]);
  }, []);

  // If already signed in AND approved, skip the login screen. A lingering
  // unapproved session is cleared so it can't loop.
  useEffect(() => {
    if (!configured) return;
    const sb = createClient();
    sb.auth
      .getUser()
      .then(async ({ data }) => {
        if (!data?.user) return;
        const { data: p } = await sb.from("profiles").select("role").eq("id", data.user.id).single();
        if (p && hasAccess(p.role as Role)) router.replace("/admin");
        else await sb.auth.signOut();
      })
      .catch(() => {});
  }, [router]);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const f = new FormData(e.currentTarget);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: String(f.get("email")).trim(),
      password: String(f.get("password")),
    });
    if (error) {
      setLoading(false);
      setError(error.message || "Sign in failed.");
      return;
    }
    const next = new URLSearchParams(window.location.search).get("next") || "/admin";
    router.push(next);
    router.refresh();
  };

  const oauth = async (provider: "google" | "apple") => {
    setError("");
    setOauthBusy(provider);
    const next = new URLSearchParams(window.location.search).get("next") || "/admin";
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    if (error) {
      setOauthBusy(null);
      setError(error.message || `${provider} sign-in isn't available.`);
    }
  };

  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="fixed left-5 top-5">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted transition hover:text-brand">
          <ArrowLeft size={16} /> Back to site
        </Link>
      </div>
      <div className="fixed right-5 top-5">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-[400px] rounded-2xl border border-line bg-surface p-8 shadow-lift">
        <div className="mb-4 grid place-items-center">
          <img className="logo-light h-[76px]" src="/Logo of Ihlamudheen Madrasa light.png" alt="Ihlamudheen Madrasa" />
          <img className="logo-dark h-[76px]" src="/Logo of Ihlamudheen Madrasa dark.png" alt="Ihlamudheen Madrasa" />
        </div>
        <h1 className="text-center font-display text-2xl font-semibold">Accounts Portal</h1>
        <p className="mb-6 mt-1.5 text-center text-sm text-muted">
          <span className="font-ar" dir="rtl">مدرسة إعلام الدين</span> · Staff sign in
        </p>

        {!configured && (
          <p className="mb-4 rounded-lg bg-accent px-3 py-2.5 text-[13px] font-semibold text-[#3a2a05]">
            Not configured yet — add your Supabase anon key to <code>.env.local</code>, then restart.
          </p>
        )}

        <form onSubmit={onSubmit}>
          <label className="mb-1.5 block text-[13px] font-bold">Email</label>
          <input name="email" type="email" autoComplete="username" required placeholder="you@example.com"
            className="mb-4 w-full rounded-[11px] border-[1.5px] border-line bg-surface-2 px-3.5 py-3 text-[15px] text-ink outline-none focus:border-brand" />

          <label className="mb-1.5 block text-[13px] font-bold">Password</label>
          <input name="password" type="password" autoComplete="current-password" required placeholder="••••••••"
            className="mb-5 w-full rounded-[11px] border-[1.5px] border-line bg-surface-2 px-3.5 py-3 text-[15px] text-ink outline-none focus:border-brand" />

          <button type="submit" disabled={loading || !configured} className={cx(btn({ variant: "primary", size: "lg" }), "w-full")}>
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <div className="my-5 flex items-center gap-3 text-[12px] font-semibold uppercase tracking-wide text-muted">
          <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
        </div>

        {/* Social sign-in */}
        <div className="grid gap-2.5">
          <button type="button" onClick={() => oauth("google")} disabled={!configured || !!oauthBusy}
            className="inline-flex w-full items-center justify-center gap-2.5 rounded-[11px] border-[1.5px] border-line bg-surface px-4 py-3 text-[14.5px] font-bold text-ink transition hover:bg-surface-2 disabled:opacity-60">
            <GoogleIcon /> {oauthBusy === "google" ? "Redirecting…" : "Sign in with Google"}
          </button>
        </div>

        {error && <p className="mt-4 rounded-lg border border-bad/30 bg-bad/10 px-3 py-2.5 text-[13px] font-semibold text-bad">{error}</p>}

        <p className="mt-5 text-center text-[12.5px] text-muted">
          Access is limited to registered staff. Accounts are added by an administrator.
        </p>
      </div>
    </main>
  );
}
