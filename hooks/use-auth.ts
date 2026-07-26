"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";

// Safe localStorage wrapper — mobile Safari (ITP / private mode) can throw SecurityError
function safeLocalGet(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function safeLocalRemove(key: string): void {
  try { localStorage.removeItem(key) } catch { /* ignore */ }
}

// Apply role override from localStorage if user has no role assigned yet
function applyRoleOverride(user: User): User {
  try {
    const override = safeLocalGet("auth_role_override")
    if (!override) return user
    if (user.user_metadata?.role) {
      // Metadata already has role — the admin API update worked, clear the override
      safeLocalRemove("auth_role_override")
      return user
    }
    // Patch the user object with the override role
    return {
      ...user,
      user_metadata: { ...user.user_metadata, role: override },
    }
  } catch {
    return user
  }
}

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
          setUser(applyRoleOverride(session.user));
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
        setUser(applyRoleOverride(session.user));
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
