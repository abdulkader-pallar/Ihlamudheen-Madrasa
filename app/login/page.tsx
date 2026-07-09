"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { supabaseConfigured } from "@/lib/supabase/config";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { btn, cx } from "@/lib/ui";

const configured = supabaseConfigured;

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // If already signed in, skip the login screen.
  useEffect(() => {
    if (!configured) return;
    createClient()
      .auth.getUser()
      .then(({ data }) => {
        if (data?.user) router.replace("/admin");
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

  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="fixed right-5 top-5">
        <ThemeToggle />
      </div>
      <form onSubmit={onSubmit} className="w-full max-w-[400px] rounded-2xl border border-line bg-surface p-8 shadow-lift">
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

        <label className="mb-1.5 block text-[13px] font-bold">Email</label>
        <input name="email" type="email" autoComplete="username" required placeholder="you@example.com"
          className="mb-4 w-full rounded-[11px] border-[1.5px] border-line bg-surface-2 px-3.5 py-3 text-[15px] text-ink outline-none focus:border-brand" />

        <label className="mb-1.5 block text-[13px] font-bold">Password</label>
        <input name="password" type="password" autoComplete="current-password" required placeholder="••••••••"
          className="mb-5 w-full rounded-[11px] border-[1.5px] border-line bg-surface-2 px-3.5 py-3 text-[15px] text-ink outline-none focus:border-brand" />

        <button type="submit" disabled={loading || !configured} className={cx(btn({ variant: "primary", size: "lg" }), "w-full")}>
          {loading ? "Signing in…" : "Sign in"}
        </button>
        {error && <p className="mt-3 text-sm font-semibold text-bad">{error}</p>}
      </form>
    </main>
  );
}
