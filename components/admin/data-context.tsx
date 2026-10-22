"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { scopeToInstitution } from "@/lib/scoped-db";
import { DEFAULT_SITE, getSite, type Site, type SiteId } from "@/lib/sites";
import { isEditor, type Category, type Fund, type Profile, type SalaryComponent, type SalaryRevision, type Staff, type Transaction, type Unit } from "@/lib/types";

type SupabaseClient = ReturnType<typeof createClient>;

/** Unit filter: every unit, the institution's common (unassigned) rows, or one unit. */
export type UnitFilter = "all" | "common" | string;

type DataCtx = {
  profile: Profile;
  /** The institution whose books are on screen (see lib/sites.ts). */
  site: Site;
  setSite: (id: SiteId) => void;
  canEdit: boolean;
  categories: Category[];
  funds: Fund[];
  /** Transactions and staff of the selected unit (all of them when the
   *  institution has no units or "all" is picked). */
  transactions: Transaction[];
  staff: Staff[];
  /** Every transaction / staff member of the institution, whatever unit. */
  allTransactions: Transaction[];
  allStaff: Staff[];
  /** The institution's units (PMSA's schools and colleges); empty if none. */
  units: Unit[];
  unit: UnitFilter;
  setUnit: (u: UnitFilter) => void;
  unitName: (id: string | null | undefined) => string;
  salaryRevisions: SalaryRevision[];
  salaryComponents: SalaryComponent[];
  reloadSalary: () => Promise<void>;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  reloadStaff: () => Promise<void>;
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
const UNIT_KEY = "accounts-unit";

const inUnit = (u: UnitFilter, unitId: string | null | undefined) =>
  u === "all" || (u === "common" ? !unitId : unitId === u);

export function DataProvider({ profile, children }: { profile: Profile; children: React.ReactNode }) {
  const [local] = useState(() => createClient());
  const [siteId, setSiteId] = useState<SiteId>(DEFAULT_SITE);
  const [categories, setCategories] = useState<Category[]>([]);
  const [funds, setFunds] = useState<Fund[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [unit, setUnitState] = useState<UnitFilter>("all");
  const [salaryRevisions, setSalaryRevisions] = useState<SalaryRevision[]>([]);
  const [salaryComponents, setSalaryComponents] = useState<SalaryComponent[]>([]);
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
    setUnitState("all");
    try { localStorage.setItem(SITE_KEY, id); localStorage.removeItem(UNIT_KEY); } catch {}
  }, []);

  const setUnit = useCallback((u: UnitFilter) => {
    setUnitState(u);
    try { localStorage.setItem(UNIT_KEY, u); } catch {}
  }, []);

  const reloadSalary = useCallback(async () => {
    const [r, c] = await Promise.all([
      supabase.from("salary_revisions").select("id, staff_id, basic_salary, effective_from").order("effective_from"),
      supabase.from("salary_components").select("id, staff_id, kind, name, amount, effective_from, effective_to").order("effective_from"),
    ]);
    setSalaryRevisions((r.data as SalaryRevision[]) || []);
    setSalaryComponents((c.data as SalaryComponent[]) || []);
  }, [supabase]);

  const reloadStaff = useCallback(async () => {
    const { data } = await supabase.from("staff").select("*").order("name");
    setStaff((data as Staff[]) || []);
  }, [supabase]);

  const reload = useCallback(async () => {
    const my = ++gen.current;
    setError(null);
    const [c, f, t, s, u] = await Promise.all([
      supabase.from("categories").select("*").order("kind").order("name"),
      supabase.from("funds").select("*").order("name"),
      supabase
        .from("transactions")
        .select("*")
        .order("occurred_on", { ascending: false })
        .order("created_at", { ascending: false }),
      supabase.from("staff").select("*").order("name"),
      supabase.from("units").select("id, name, sort, active, monthly_budget").order("sort").order("name"),
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
    const us = (u.data as Unit[]) || [];
    setUnits(us);
    // Keep a remembered unit only if it still belongs to this institution.
    let saved: string | null = null;
    try { saved = localStorage.getItem(UNIT_KEY); } catch {}
    setUnitState(saved && (saved === "all" || saved === "common" || us.some((x) => x.id === saved)) && us.length ? saved : "all");
    if (us.length) await reloadSalary(); else { setSalaryRevisions([]); setSalaryComponents([]); }
    setLoading(false);
  }, [supabase, reloadSalary]);

  // On first load and whenever the institution changes, clear the previous
  // site's figures so they never show under the new site's name.
  useEffect(() => {
    setLoading(true);
    setCategories([]);
    setFunds([]);
    setTransactions([]);
    setStaff([]);
    setUnits([]);
    reload();
  }, [reload]);

  const canEdit = isEditor(profile.role);

  const filteredTx = useMemo(() => transactions.filter((t) => inUnit(unit, t.unit_id)), [transactions, unit]);
  const filteredStaff = useMemo(() => staff.filter((s) => inUnit(unit, s.unit_id)), [staff, unit]);
  const unitName = useCallback(
    (id: string | null | undefined) => (id ? units.find((x) => x.id === id)?.name ?? "Unknown institution" : `${site.name} – Common`),
    [units, site]
  );

  return (
    <Ctx.Provider
      value={{
        profile, site, setSite, canEdit, categories, funds,
        transactions: filteredTx, staff: filteredStaff, allTransactions: transactions, allStaff: staff,
        units, unit, setUnit, unitName, salaryRevisions, salaryComponents, reloadSalary,
        loading, error, reload, reloadStaff, supabase,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}
