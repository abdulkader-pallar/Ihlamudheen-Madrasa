// ============================================================================
//  Supabase connection — PUBLIC values only.
//  These two values are safe to expose in the browser (that is how Supabase
//  is designed). Security is enforced by Row Level Security in the database.
//  NEVER put the "service_role" / secret key here.
//
//  Where to find the anon key:
//    Supabase Dashboard → Project Settings → API → Project API keys → "anon" "public"
// ============================================================================
window.SUPABASE_CONFIG = {
  url: "https://tvmhycdyfflnxrnpvhjf.supabase.co",
  anonKey: "PASTE_YOUR_PUBLIC_ANON_KEY_HERE"
};
