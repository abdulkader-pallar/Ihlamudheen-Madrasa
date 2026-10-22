"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { scopeToInstitution } from "@/lib/scoped-db";
import { DEFAULT_SITE, getSite, type Site, type SiteId } from "@/lib/sites";
import { isEditor, type Attendance, type Category, type Fund, type Profile, type Staff, type Transaction } from "@/lib/types";

type SupabaseClient = ReturnType<typeof createClient>;

type DataCtx = {
  profile: Profile;
  /** The institution whose books are on screen (see lib/sites.ts). */
  site: Site;
  setSite: (id: SiteId) => void;
  canEdit: boolean;
  categories: Category[];
  funds: Fund[];
  transactions: Transaction[];
  staff: Staff[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  reloadStaff: () => Promise<void>;
  loadAttendance: (date: string) => Promise<Attendance[]>;
  /** The database, limited to the selected institution's rows on the
   *  accounting tables (lib/scoped-db.ts). */
  supabase: SupabaseClient;
};

const Ctx = createContext<DataCtx | null>(null);

export function useData() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useData must be used inside <DataProvider>");
  return c;
}

const SITE_KEY = "accounts-site";

export function DataProvider({ profile, children }: { profile: Profile; children: React.ReactNode }) {
  const [local] = useState(() => createClient());
  const [siteId, setSiteId] = useState<SiteId>(DEFAULT_SITE);
  const [categories, setCategories] = useState<Category[]>([]);
  const [funds, setFunds] = useState<Fund[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const site = getSite(siteId);
  // Bumped on every reload so a slow response for a previous site is dropped.
  const gen = useRef(0);

  const supabase = useMemo(() => scopeToInstitution(local, site.id), [site, local]);

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
    const { data } = await supabase.from("staff").select("*").order("name");
    setStaff((data as Staff[]) || []);
  }, [supabase]);

  const reload = useCallback(async () => {
    const my = ++gen.current;
    setError(null);
    const [c, f, t, s] = await Promise.all([
      supabase.from("categories").select("*").order("kind").order("name"),
      supabase.from("funds").select("*").order("name"),
      supabase
        .from("transactions")
        .select("*")
        .order("occurred_on", { ascending: false })
        .order("created_at", { ascending: false }),
      supabase.from("staff").select("*").order("name"),
    ]);
    if (my !== gen.current) return;
    // Only the core books block the page. Staff is optional: a site that never
    // ran supabase/staff-attendance.sql has no staff table and just shows
    // "No staff added yet", as before.
    const failed = [c, f, t].find((r) => r.error)?.error;
    if (failed) setError(failed.message);
    setCategories((c.data as Category[]) || []);
    setFunds((f.data as Fund[]) || []);
    setTransactions((t.data as Transaction[]) || []);
    setStaff((s.data as Staff[]) || []);
    setLoading(false);
  }, [supabase]);

  const loadAttendance = useCallback(async (date: string): Promise<Attendance[]> => {
    const { data, error } = await supabase
      .from("attendance")
      .select("id, staff_id, work_date, check_in, check_out, source, remarks")
      .eq("work_date", date);
    if (error) throw new Error(error.message);
    return (data as Attendance[]) || [];
  }, [supabase]);

  // On first load and whenever the institution changes, clear the previous
  // site's figures so they never show under the new site's name.
  useEffect(() => {
    setLoading(true);
    setCategories([]);
    setFunds([]);
    setTransactions([]);
    setStaff([]);
    reload();
  }, [reload]);

  const canEdit = isEditor(profile.role);

  return (
    <Ctx.Provider
      value={{ profile, site, setSite, canEdit, categories, funds, transactions, staff, loading, error, reload, reloadStaff, loadAttendance, supabase }}
    >
      {children}
    </Ctx.Provider>
  );
}
