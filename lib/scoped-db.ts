import type { createClient } from "@/lib/supabase/client";
import type { SiteId } from "@/lib/sites";

type SupabaseClient = ReturnType<typeof createClient>;

// Every institution's books live in this one database (supabase/institutions.sql),
// told apart by an `institution` column. The Accounts pages are written as if
// they owned the whole database, so instead of adding a filter to every query
// they get this wrapper: on the accounting tables it limits reads, updates and
// deletes to the selected institution and stamps it on every new row. Other
// tables (profiles, …) pass straight through.
export const SCOPED_TABLES = new Set([
  "categories", "funds", "transactions", "staff", "attendance",
  "units", "salary_revisions", "salary_components", "payroll_runs", "payroll_lines",
]);

type Row = Record<string, unknown>;
const stamp = (payload: Row | Row[], institution: SiteId) =>
  Array.isArray(payload) ? payload.map((r) => ({ ...r, institution })) : { ...payload, institution };

export function scopeToInstitution(db: SupabaseClient, institution: SiteId): SupabaseClient {
  const from = (table: string) => {
    const q = db.from(table);
    if (!SCOPED_TABLES.has(table)) return q;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = q as any;
    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      select: (...a: any[]) => b.select(...a).eq("institution", institution),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      insert: (p: Row | Row[], ...a: any[]) => b.insert(stamp(p, institution), ...a),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      upsert: (p: Row | Row[], ...a: any[]) => b.upsert(stamp(p, institution), ...a),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      update: (...a: any[]) => b.update(...a).eq("institution", institution),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete: (...a: any[]) => b.delete(...a).eq("institution", institution),
    };
  };
  return new Proxy(db, {
    get(target, prop) {
      if (prop === "from") return from;
      const v = Reflect.get(target, prop, target);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}
