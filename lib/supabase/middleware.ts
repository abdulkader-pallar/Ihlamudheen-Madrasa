import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type CookieToSet = { name: string; value: string; options: CookieOptions };

// Runs on every request: refreshes the auth cookie and guards /admin routes.
// Written defensively so a missing config or transient auth error can NEVER
// 500 the whole site — it fails open (the /admin layout still enforces auth
// server-side, and RLS still protects all data).
export async function updateSession(request: NextRequest) {
  const passthrough = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  // Not configured yet → don't touch auth; let pages render.
  if (!url || !key) return passthrough;

  try {
    let response = NextResponse.next({ request });

    const supabase = createServerClient(url, key, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    });

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const path = request.nextUrl.pathname;

    if (path.startsWith("/admin") && !user) {
      const redirect = request.nextUrl.clone();
      redirect.pathname = "/login";
      redirect.searchParams.set("next", path);
      return NextResponse.redirect(redirect);
    }

    if (path === "/login" && user) {
      const redirect = request.nextUrl.clone();
      redirect.pathname = "/admin";
      return NextResponse.redirect(redirect);
    }

    return response;
  } catch {
    // Never bring the whole site down over an auth hiccup.
    return passthrough;
  }
}
