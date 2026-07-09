"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Category, Fund, Profile, Transaction } from "@/lib/types";

type SupabaseClient = ReturnType<typeof createClient>;

type DataCtx = {
  profile: Profile;
  categories: Category[];
  funds: Fund[];
  transactions: Transaction[];
  loading: boolean;
  reload: () => Promise<void>;
  supabase: SupabaseClient;
};

const Ctx = createContext<DataCtx | null>(null);

export function useData() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useData must be used inside <DataProvider>");
  return c;
}

export function DataProvider({ profile, children }: { profile: Profile; children: React.ReactNode }) {
  const [supabase] = useState(() => createClient());
  const [categories, setCategories] = useState<Category[]>([]);
  const [funds, setFunds] = useState<Fund[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const [c, f, t] = await Promise.all([
      supabase.from("categories").select("*").order("kind").order("name"),
      supabase.from("funds").select("*").order("name"),
      supabase
        .from("transactions")
        .select("*")
        .order("occurred_on", { ascending: false })
        .order("created_at", { ascending: false }),
    ]);
    setCategories((c.data as Category[]) || []);
    setFunds((f.data as Fund[]) || []);
    setTransactions((t.data as Transaction[]) || []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    reload();
  }, [reload]);

  return (
    <Ctx.Provider value={{ profile, categories, funds, transactions, loading, reload, supabase }}>
      {children}
    </Ctx.Provider>
  );
}
