"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";

// NOTE: there is deliberately no client-side role override here. Roles come from
// app_metadata (service-role-only) via getUserRole() in lib/roles.ts; anything
// the browser can write — localStorage, user_metadata — is not a role source.

export function useAuth(requireAuth = true) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let settled = false

    // getSession() reads from local storage — instant, no network call.
    // getUser() makes a server round-trip which can hang indefinitely on mobile.
    const initSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (settled) return          // onAuthStateChange already resolved first
        settled = true
        if (session?.user) {
          setUser(session.user);
        } else if (requireAuth) {
          router.push("/login");
        }
      } catch (err) {
        console.error("[useAuth] getSession failed:", err);
        if (!settled) {
          settled = true
          if (requireAuth) router.push("/login");
        }
      } finally {
        setLoading(false);
      }
    };

    initSession();

    // Safety net: if both getSession and onAuthStateChange somehow stall,
    // release the loading gate after 5 s so the user sees something.
    const safetyTimer = setTimeout(() => {
      if (!settled) {
        settled = true
        setLoading(false)
        if (requireAuth) router.push("/login")
      }
    }, 5000)

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUser(session.user);
        if (!settled) { settled = true; setLoading(false) }
      } else {
        setUser(null);
        if (!settled) { settled = true; setLoading(false) }
        if (requireAuth) {
          router.push("/login");
        }
      }
    });

    return () => { subscription.unsubscribe(); clearTimeout(safetyTimer) }
  }, [requireAuth, router]);

  const signOut = async () => {
    await supabase.auth.signOut();
    router.push("/");
  };

  return { user, loading, signOut };
}
