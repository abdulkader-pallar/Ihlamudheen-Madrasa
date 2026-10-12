import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSuperadmin } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Server-side config for the remote institutions (see lib/sites.ts). The API
// keys are SERVER-ONLY env vars — never NEXT_PUBLIC.
const REMOTES: Record<string, { url?: string; key?: string }> = {
  gracevalley: {
    url: process.env.GRACEVALLEY_EXPORT_URL || "https://gracevalley.vercel.app/api/export",
    key: process.env.GRACEVALLEY_EXPORT_API_KEY,
  },
  pmsa: {
    url: process.env.PMSA_EXPORT_URL || "https://pmsa-kattilangadi.vercel.app/api/export",
    key: process.env.PMSA_EXPORT_API_KEY,
  },
};

const TABLES = new Set(["categories", "funds", "transactions", "staff", "attendance"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/admin/sites/<site>?tables=categories,funds,...&date=YYYY-MM-DD
// Read-only proxy to another institution's /api/export. Super-admins only.
// `date` narrows the attendance rows to one work day.
export async function GET(request: Request, { params }: { params: Promise<{ site: string }> }) {
  const { site } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!isSuperadmin(user.email)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const remote = REMOTES[site];
  if (!remote) return NextResponse.json({ error: "Unknown site" }, { status: 404 });
  if (!remote.key || !remote.url)
    return NextResponse.json({ error: `Export key for ${site} is not configured on the server` }, { status: 500 });

  const url = new URL(request.url);
  const tables = (url.searchParams.get("tables") || "categories,funds,transactions,staff")
    .split(",").map((t) => t.trim()).filter((t) => TABLES.has(t));
  if (!tables.length) return NextResponse.json({ error: "No valid tables requested" }, { status: 400 });
  const date = url.searchParams.get("date");
  if (date && !DATE_RE.test(date)) return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });

  const target = new URL(remote.url);
  target.searchParams.set("tables", tables.join(","));
  // Only an attendance-only request may be date-filtered remotely — on sites
  // that support from/to it would also cut the transactions down.
  if (date && tables.length === 1 && tables[0] === "attendance") {
    target.searchParams.set("from", date);
    target.searchParams.set("to", date);
  }

  let res: Response;
  try {
    res = await fetch(target, { headers: { Authorization: `Bearer ${remote.key}` }, cache: "no-store" });
  } catch {
    return NextResponse.json({ error: `Could not reach ${site}` }, { status: 502 });
  }
  if (!res.ok) return NextResponse.json({ error: `${site} export failed (${res.status})` }, { status: 502 });

  const body = (await res.json()) as { data?: Record<string, Record<string, unknown>[]> };
  const data = body.data ?? {};
  // Sites that ignore from/to return every attendance row; filter here.
  if (date && data.attendance) data.attendance = data.attendance.filter((r) => r.work_date === date);

  return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
}
