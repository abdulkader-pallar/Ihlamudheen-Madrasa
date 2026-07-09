"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { BarChart3, LayoutDashboard, ListOrdered, LogOut, Menu, SlidersHorizontal } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { Toaster } from "@/components/ui/toast";
import { DataProvider } from "./data-context";
import { isEditor, type Profile } from "@/lib/types";
import { cx } from "@/lib/ui";

const NAV = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/admin/transactions", label: "Transactions", icon: ListOrdered },
  { href: "/admin/reports", label: "Reports", icon: BarChart3 },
  { href: "/admin/manage", label: "Categories & Funds", icon: SlidersHorizontal, editor: true },
];

const TITLES: Record<string, string> = {
  "/admin": "Dashboard",
  "/admin/transactions": "Transactions",
  "/admin/reports": "Reports",
  "/admin/manage": "Categories & Funds",
};

export function AdminShell({ profile, children }: { profile: Profile; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const editor = isEditor(profile.role);
  const name = profile.full_name || "Staff";

  const signOut = async () => {
    await createClient().auth.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <DataProvider profile={profile}>
      <div className="admin-grid grid min-h-screen md:grid-cols-[238px_1fr]">
        {/* Sidebar */}
        <aside
          className={cx(
            "no-print fixed inset-y-0 left-0 z-50 flex w-[238px] flex-col p-4 text-[#dbe6f2] transition-transform md:static md:translate-x-0",
            open ? "translate-x-0" : "-translate-x-full"
          )}
          style={{ background: "var(--navy)" }}
        >
          <div className="flex items-center gap-3 px-2 pb-5 pt-1.5">
            <img className="h-10" src="/Logo of Ihlamudheen Madrasa dark.png" alt="" />
            <div className="leading-tight">
              <b className="font-display text-base font-semibold text-white">Ihlamudheen</b>
              <br />
              <span className="text-[11.5px] text-[#8fa6bf]">Accounts</span>
            </div>
          </div>

          {NAV.filter((n) => !n.editor || editor).map((n) => {
            const active = n.exact ? pathname === n.href : pathname.startsWith(n.href);
            const Icon = n.icon;
            return (
              <Link
                key={n.href}
                href={n.href}
                onClick={() => setOpen(false)}
                className={cx(
                  "flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-[14.5px] font-semibold transition",
                  active ? "bg-brand text-white" : "text-[#cfe0f2] hover:bg-white/10"
                )}
              >
                <Icon size={19} className="opacity-90" />
                {n.label}
              </Link>
            );
          })}

          <div className="mt-auto border-t border-white/10 pt-3.5">
            <div className="flex items-center gap-2.5 px-2 py-1.5">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand font-bold text-white">
                {name[0]?.toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="truncate text-[13.5px] font-bold text-white">{name}</div>
                <div className="text-[11.5px] capitalize text-[#8fa6bf]">{profile.role}</div>
              </div>
            </div>
            <button
              onClick={signOut}
              className="mt-1.5 flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-[14.5px] font-semibold text-[#cfe0f2] transition hover:bg-white/10"
            >
              <LogOut size={19} className="opacity-90" /> Sign out
            </button>
          </div>
        </aside>

        {open && <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setOpen(false)} />}

        {/* Main */}
        <div className="flex min-w-0 flex-col">
          <header
            className="no-print sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-line px-4 py-3.5 backdrop-blur-md sm:px-7"
            style={{ background: "color-mix(in srgb, var(--bg) 70%, transparent)" }}
          >
            <div className="flex items-center gap-3">
              <button className="grid h-10 w-10 place-items-center rounded-xl border border-line bg-surface text-ink md:hidden" aria-label="Menu" onClick={() => setOpen(true)}>
                <Menu size={20} />
              </button>
              <h1 className="font-display text-xl font-semibold sm:text-[22px]">{TITLES[pathname] || "Accounts"}</h1>
            </div>
            <ThemeToggle />
          </header>

          <main className="p-4 sm:p-7">{children}</main>
        </div>
      </div>
      <Toaster />
    </DataProvider>
  );
}
