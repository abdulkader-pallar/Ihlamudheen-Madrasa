"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { DEFAULT_SITE, getSite, type Site, type SiteId } from "@/lib/sites";
import { isEditor, type Attendance, type Category, type Fund, type Profile, type Staff, type Transaction } from "@/lib/types";

type SupabaseClient = ReturnType<typeof createClient>;

type DataCtx = {
  profile: Profile;
  /** The institution whose books are on screen (see lib/sites.ts). */
  site: Site;
  setSite: (id: SiteId) => void;
  /** false for the read-only remote institutions, whatever the user's role. */
  canEdit: boolean;
  categories: Category[];
  funds: Fund[];
  transactions: Transaction[];
  staff: Staff[];
  /** Login accounts of a remote institution (empty for Ihlamudheen, which
   *  uses the full user-management tool instead). */
  users: Profile[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  reloadStaff: () => Promise<void>;
  loadAttendance: (date: string) => Promise<Attendance[]>;
  supabase: SupabaseClient;
};

const Ctx = createContext<DataCtx | null>(null);

export function useData() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useData must be used inside <DataProvider>");
  return c;
}

const SITE_KEY = "accounts-site";

async function fetchRemote(site: SiteId, params: Record<string, string>) {
  const res = await fetch(`/api/admin/sites/${site}?${new URLSearchParams(params)}`, { cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Could not load ${site}`);
  return body.data as Record<string, unknown[]>;
}

export function DataProvider({ profile, children }: { profile: Profile; children: React.ReactNode }) {
  const [supabase] = useState(() => createClient());
  const [siteId, setSiteId] = useState<SiteId>(DEFAULT_SITE);
  const [categories, setCategories] = useState<Category[]>([]);
  const [funds, setFunds] = useState<Fund[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [users, setUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const site = getSite(siteId);
  // Bumped on every reload so a slow response for a previous site is dropped.
  const gen = useRef(0);

  // Remember the chosen institution per browser.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SITE_KEY);
      if (saved) setSiteId(getSite(saved).id);
    } catch {}
  }, []);

  const setSite = useCallback((id: SiteId) => {
    setSiteId(id);
    try { localStorage.setItem(SITE_KEY, id); } catch {}
  }, []);

  const reloadStaff = useCallback(async () => {
    if (!site.local) {
      const d = await fetchRemote(site.id, { tables: "staff" });
      setStaff(((d.staff as Staff[]) || []).sort((a, b) => a.name.localeCompare(b.name)));
      return;
    }
    const { data } = await supabase.from("staff").select("*").order("name");
    setStaff((data as Staff[]) || []);
  }, [supabase, site]);

  const reload = useCallback(async () => {
    const my = ++gen.current;
    setError(null);
    if (!site.local) {
      try {
        const d = await fetchRemote(site.id, { tables: "profiles,categories,funds,transactions,staff" });
        if (my !== gen.current) return;
        const byKindName = (a: Category, b: Category) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name);
        setCategories(((d.categories as Category[]) || []).sort(byKindName));
        setFunds(((d.funds as Fund[]) || []).sort((a, b) => a.name.localeCompare(b.name)));
        setTransactions(((d.transactions as Transaction[]) || []).sort(
          (a, b) => b.occurred_on.localeCompare(a.occurred_on) || b.created_at.localeCompare(a.created_at)
        ));
        setStaff(((d.staff as Staff[]) || []).sort((a, b) => a.name.localeCompare(b.name)));
        setUsers(((d.profiles as Profile[]) || []).sort((a, b) => (a.full_name || "").localeCompare(b.full_name || "")));
      } catch (e) {
        if (my !== gen.current) return;
        setError((e as Error).message);
      }
      setLoading(false);
      return;
    }
    const [c, f, t] = await Promise.all([
      supabase.from("categories").select("*").order("kind").order("name"),
      supabase.from("funds").select("*").order("name"),
      supabase
        .from("transactions")
        .select("*")
        .order("occurred_on", { ascending: false })
        .order("created_at", { ascending: false }),
      reloadStaff(),
    ]);
    if (my !== gen.current) return;
    setCategories((c.data as Category[]) || []);
    setFunds((f.data as Fund[]) || []);
    setTransactions((t.data as Transaction[]) || []);
    setLoading(false);
  }, [supabase, site, reloadStaff]);

  const loadAttendance = useCallback(async (date: string): Promise<Attendance[]> => {
    if (!site.local) {
      const d = await fetchRemote(site.id, { tables: "attendance", date });
      return (d.attendance as Attendance[]) || [];
    }
    const { data, error } = await supabase
      .from("attendance")
      .select("id, staff_id, work_date, check_in, check_out, source, remarks")
      .eq("work_date", date);
    if (error) throw new Error(error.message);
    return (data as Attendance[]) || [];
  }, [supabase, site]);

  // On first load and whenever the institution changes, clear the previous
  // site's figures so they never show under the new site's name.
  useEffect(() => {
    setLoading(true);
    setCategories([]);
    setFunds([]);
    setTransactions([]);
    setStaff([]);
    setUsers([]);
    reload();
  }, [reload]);

  const canEdit = site.local && isEditor(profile.role);

  return (
    <Ctx.Provider
      value={{ profile, site, setSite, canEdit, categories, funds, transactions, staff, users, loading, error, reload, reloadStaff, loadAttendance, supabase }}
    >
      {children}
    </Ctx.Provider>
  );
}
