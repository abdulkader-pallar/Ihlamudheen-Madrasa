import { NextResponse } from "next/server";
import { createClient as createSupabase } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { isSuperadmin } from "@/lib/types";
import type { RemoteQuery } from "@/lib/remote-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The other institutions' Supabase projects (see lib/sites.ts). The secret keys
// are SERVER-ONLY env vars — never NEXT_PUBLIC — and bypass RLS, so every
// request is checked against the super-admin list first.
const REMOTES: Record<string, { url?: string; key?: string }> = {
  gracevalley: { url: process.env.GRACEVALLEY_SUPABASE_URL, key: process.env.GRACEVALLEY_SUPABASE_SECRET_KEY },
  pmsa: { url: process.env.PMSA_SUPABASE_URL, key: process.env.PMSA_SUPABASE_SECRET_KEY },
};

// What the Accounts pages may do on a remote database. Login accounts
// (profiles) are read-only here.
const ALLOWED: Record<string, RemoteQuery["op"][]> = {
  categories: ["select", "insert", "update", "delete"],
  funds: ["select", "insert", "update", "delete"],
  transactions: ["select", "insert", "update", "delete"],
  staff: ["select", "insert", "update", "delete"],
  attendance: ["select", "insert", "update", "delete"],
  profiles: ["select"],
};
const IDENT = /^[a-z_][a-z0-9_]*$/;
const PAGE = 1000; // Supabase max rows per request

// POST /api/admin/sites/<site>  body: RemoteQuery (built by lib/remote-db.ts)
export async function POST(request: Request, { params }: { params: Promise<{ site: string }> }) {
  const { site } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!isSuperadmin(user.email)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const remote = REMOTES[site];
  if (!remote) return NextResponse.json({ error: "Unknown site" }, { status: 404 });
  if (!remote.url || !remote.key)
    return NextResponse.json({ error: `Database for ${site} is not configured on the server` }, { status: 500 });

  const q = (await request.json().catch(() => null)) as RemoteQuery | null;
  if (!q || !ALLOWED[q.table]?.includes(q.op))
    return NextResponse.json({ error: "That operation is not allowed" }, { status: 400 });
  const filters = q.filters ?? [];
  const order = q.order ?? [];
  if (![...filters.map((f) => f.column), ...order.map((o) => o.column)].every((c) => IDENT.test(c)))
    return NextResponse.json({ error: "Bad column name" }, { status: 400 });
  // Never update or delete a whole table by accident.
  if ((q.op === "update" || q.op === "delete") && !filters.some((f) => f.op === "eq"))
    return NextResponse.json({ error: "update/delete need an eq filter" }, { status: 400 });

  const db = createSupabase(remote.url, remote.key, { auth: { persistSession: false, autoRefreshToken: false } });

  const build = () => {
    const t = db.from(q.table);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let b: any =
      q.op === "select" ? t.select(q.columns || "*")
      : q.op === "insert" ? t.insert(q.payload as object)
      : q.op === "update" ? t.update(q.payload as object)
      : t.delete();
    for (const f of filters) b = b[f.op](f.column, f.value);
    for (const o of order) b = b.order(o.column, { ascending: o.ascending ?? true });
    return b;
  };

  if (q.op !== "select") {
    const { error } = await build();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ data: null });
  }

  // Page through so tables larger than 1000 rows come back in full.
  const rows: unknown[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return NextResponse.json({ data: rows }, { headers: { "Cache-Control": "no-store" } });
}
