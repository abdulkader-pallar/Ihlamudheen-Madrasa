"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { BarChart3, Fingerprint, Globe, LayoutDashboard, ListOrdered, LogOut, Menu, SlidersHorizontal, Users, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { Toaster } from "@/components/ui/toast";
import { DataProvider } from "./data-context";
import { getMenuForRole } from "@/components/app-launcher";
import type { UserRole } from "@/lib/roles";
import { isEditor, isSuperadmin, type Profile, type Role } from "@/lib/types";
import { cx } from "@/lib/ui";

const NAV: { href: string; label: string; icon: LucideIcon; exact?: boolean; editor?: boolean; admin?: boolean; superadmin?: boolean }[] = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/admin/transactions", label: "Transactions", icon: ListOrdered },
  { href: "/admin/reports", label: "Reports", icon: BarChart3 },
  { href: "/admin/attendance", label: "Staff Attendance", icon: Fingerprint },
  { href: "/admin/manage", label: "Categories & Funds", icon: SlidersHorizontal, editor: true },
  { href: "/admin/users", label: "Users & Roles", icon: Users, superadmin: true },
  { href: "/admin/meelad", label: "Meelad Accounts", icon: Wallet, superadmin: true },
];

const TITLES: Record<string, string> = {
  "/admin": "Dashboard",
  "/admin/transactions": "Transactions",
  "/admin/reports": "Reports",
  "/admin/attendance": "Staff Attendance",
  "/admin/manage": "Categories & Funds",
  "/admin/users": "Users & Roles",
  "/admin/meelad": "Meelad Accounts",
};

export function AdminShell({ profile, children }: { profile: Profile; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [appsOpen, setAppsOpen] = useState(false);
  const editor = isEditor(profile.role);
  const admin = profile.role === "admin";
  const superadmin = isSuperadmin(profile.email);
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
            <img className="h-10" src="/Logo of Ihlamudheen Madrasa dark-bg removed.png" alt="" />
            <div className="leading-tight">
              <b className="font-display text-base font-semibold text-white">Ihlamudheen</b>
              <br />
              <span className="text-[11.5px] text-[#8fa6bf]">Accounts</span>
            </div>
          </div>

          {NAV.filter((n) => (n.superadmin ? superadmin : n.admin ? admin : !n.editor || editor)).map((n) => {
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
            <div className="flex items-center gap-2.5">
              <div className="relative">
                <button
                  onClick={() => setAppsOpen((v) => !v)}
                  aria-label="Apps"
                  className={cx(
                    "grid h-10 w-10 place-items-center rounded-xl border bg-surface text-ink transition hover:border-brand",
                    appsOpen ? "border-brand text-brand" : "border-line"
                  )}
                >
                  {/* Nine-dot app grid — same launcher icon as the school ERP. */}
                  <span className="grid grid-cols-3 gap-[3px]">
                    {Array.from({ length: 9 }).map((_, i) => (
                      <span key={i} className="block size-[4px] rounded-full bg-current" />
                    ))}
                  </span>
                </button>
                {appsOpen && <AppsMenu role={profile.role} email={profile.email} onClose={() => setAppsOpen(false)} onSignOut={signOut} />}
              </div>
              <ThemeToggle />
            </div>
          </header>

          <main className="p-4 sm:p-7">{children}</main>
        </div>
      </div>
      <Toaster />
    </DataProvider>
  );
}

function AppsMenu({ role, email, onClose, onSignOut }: { role: Role; email?: string | null; onClose: () => void; onSignOut: () => void }) {
  const editor = isEditor(role);
  const superadmin = isSuperadmin(email);
  const apps: { label: string; href: string; icon: LucideIcon; color: string }[] = [
    { label: "Dashboard", href: "/admin", icon: LayoutDashboard, color: "var(--brand)" },
    { label: "Transactions", href: "/admin/transactions", icon: ListOrdered, color: "#3b82f6" },
    { label: "Reports", href: "/admin/reports", icon: BarChart3, color: "var(--accent)" },
    { label: "Attendance", href: "/admin/attendance", icon: Fingerprint, color: "#0ea5e9" },
    ...(editor ? [{ label: "Categories", href: "/admin/manage", icon: SlidersHorizontal, color: "var(--good)" }] : []),
    ...(superadmin ? [{ label: "Users", href: "/admin/users", icon: Users, color: "#8b5cf6" }] : []),
    // Also in the sidebar, but the shared menu's "Accounts" section is filtered
    // out below, so without this the grid would not list it at all.
    ...(superadmin ? [{ label: "Meelad Accounts", href: "/admin/meelad", icon: Wallet, color: "#059669" }] : []),
  ];

  const tileCls = "flex flex-col items-center gap-2 rounded-xl p-3 text-center transition hover:bg-surface-2";
  const Icon = ({ icon: I, color }: { icon: LucideIcon; color: string }) => (
    <span className="grid h-11 w-11 place-items-center rounded-2xl text-white" style={{ background: color }}>
      <I size={20} />
    </span>
  );

  // Full school-ERP module menu (Academics, Teachers, Grade Book, Fest, HRMS,
  // Finance, Tools, Reports…) shown alongside the accounting apps. Accounting
  // roles viewer/pending fall back to the student menu.
  const erpRole: UserRole = role === "admin" ? "admin" : role === "accountant" ? "accountant" : "student";
  // Drop the shared menu's own "Accounts" section — this menu already lists the
  // accounting apps above, so showing it again would duplicate the heading.
  const erpCategories = getMenuForRole(erpRole, { isSuperadmin: superadmin })
    .filter((c) => c.title !== "Accounts");

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute right-0 top-12 z-50 max-h-[80vh] w-[320px] overflow-y-auto rounded-2xl border border-line bg-surface p-4 shadow-card">
        <div className="mb-2 px-1 text-[11px] font-bold uppercase tracking-wider text-muted">Accounts</div>
        <div className="grid grid-cols-3 gap-1">
          {apps.map((a) => (
            <Link key={a.href} href={a.href} onClick={onClose} className={tileCls}>
              <Icon icon={a.icon} color={a.color} />
              <span className="text-[11.5px] font-semibold leading-tight">{a.label}</span>
            </Link>
          ))}
        </div>

        {/* School ERP modules */}
        {erpCategories.map((cat) => (
          <div key={cat.title}>
            <div className="my-3 border-t border-line" />
            <div className="mb-2 px-1 text-[11px] font-bold uppercase tracking-wider text-muted">{cat.title}</div>
            <div className="grid grid-cols-3 gap-1">
              {cat.items.map((it) => {
                const ItIcon = it.icon;
                return (
                  <Link key={it.href} href={it.href} onClick={onClose} className={tileCls}>
                    <span className={cx("grid h-11 w-11 place-items-center rounded-2xl text-white", it.color)}>
                      <ItIcon className="size-5" />
                    </span>
                    <span className="text-[11.5px] font-semibold leading-tight">{it.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}

        <div className="my-3 border-t border-line" />
        <div className="grid grid-cols-3 gap-1">
          <Link href="/" onClick={onClose} className={tileCls}>
            <Icon icon={Globe} color="#8b5cf6" />
            <span className="text-[11.5px] font-semibold leading-tight">Website</span>
          </Link>
          <button onClick={onSignOut} className={tileCls}>
            <Icon icon={LogOut} color="var(--bad)" />
            <span className="text-[11.5px] font-semibold leading-tight">Sign out</span>
          </button>
        </div>
      </div>
    </>
  );
}
