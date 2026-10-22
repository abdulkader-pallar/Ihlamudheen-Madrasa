"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BarChart3, Banknote, Building2, Fingerprint, Globe, PieChart, LayoutDashboard, ListOrdered, LogOut, Menu, SlidersHorizontal, UserRound, Users, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { Toaster } from "@/components/ui/toast";
import { DataProvider, useData } from "./data-context";
import { SITES } from "@/lib/sites";
import { getMenuForRole, NavMenuBody } from "@/components/app-launcher";
import { SUPERADMIN_LABEL, type UserRole } from "@/lib/roles";
import { isSuperadmin, type Profile, type Role } from "@/lib/types";
import { cx } from "@/lib/ui";

// `local` = Ihlamudheen-only pages (Meelad book), hidden on the other
// institutions' tabs. `units` = only for institutions that have units (PMSA).
const NAV: { href: string; label: string; icon: LucideIcon; exact?: boolean; editor?: boolean; admin?: boolean; superadmin?: boolean; local?: boolean; units?: boolean }[] = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/admin/transactions", label: "Transactions", icon: ListOrdered },
  { href: "/admin/reports", label: "Reports", icon: BarChart3 },
  { href: "/admin/staff", label: "Staff", icon: UserRound },
  { href: "/admin/attendance", label: "Staff Attendance", icon: Fingerprint },
  { href: "/admin/payroll", label: "Payroll", icon: Banknote, units: true },
  { href: "/admin/unit-costs", label: "Institution Costs", icon: PieChart, units: true },
  { href: "/admin/manage", label: "Categories & Funds", icon: SlidersHorizontal },
  { href: "/admin/users", label: "Users & Roles", icon: Users, superadmin: true },
  { href: "/admin/meelad", label: "Meelad Accounts", icon: Wallet, superadmin: true, local: true },
];

const TITLES: Record<string, string> = {
  "/admin": "Dashboard",
  "/admin/transactions": "Transactions",
  "/admin/reports": "Reports",
  "/admin/staff": "Staff",
  "/admin/attendance": "Staff Attendance",
  "/admin/manage": "Categories & Funds",
  "/admin/payroll": "Payroll",
  "/admin/unit-costs": "Institution Costs",
  "/admin/users": "Users & Roles",
  "/admin/meelad": "Meelad Accounts",
};

export function AdminShell({ profile, children }: { profile: Profile; children: React.ReactNode }) {
  return (
    <DataProvider profile={profile}>
      <Shell profile={profile}>{children}</Shell>
      <Toaster />
    </DataProvider>
  );
}

function Shell({ profile, children }: { profile: Profile; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { site, setSite, canEdit, error, units, unit, setUnit, unitName, loading } = useData();
  const hasUnits = units.length > 0;
  const [open, setOpen] = useState(false);
  const [appsOpen, setAppsOpen] = useState(false);
  const admin = profile.role === "admin";
  const superadmin = isSuperadmin(profile.email);
  const name = profile.full_name || "Staff";

  const nav = NAV.filter((n) =>
    (n.superadmin ? superadmin : n.admin ? admin : !n.editor || canEdit) && (!n.local || site.local) && (!n.units || hasUnits)
  );

  // Each institution has its own colour theme (app/globals.css, [data-site]).
  // Set on <html> so dialogs, toasts and the page background follow it too.
  useEffect(() => {
    document.documentElement.dataset.site = site.id;
    return () => { delete document.documentElement.dataset.site; };
  }, [site]);

  // Switching to a remote institution while on a page it doesn't have
  // (e.g. Users & Roles) → back to its dashboard.
  useEffect(() => {
    if (!site.local && NAV.some((n) => n.local && pathname.startsWith(n.href))) router.replace("/admin");
  }, [site, pathname, router]);

  // Same for the unit pages on an institution without units (checked once
  // its units have loaded).
  useEffect(() => {
    if (!loading && !hasUnits && NAV.some((n) => n.units && pathname.startsWith(n.href))) router.replace("/admin");
  }, [loading, hasUnits, pathname, router]);

  const signOut = async () => {
    await createClient().auth.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <>
      <div className="admin-grid grid min-h-screen md:grid-cols-[238px_1fr]">
        {/* Sidebar */}
        <aside
          className={cx(
            "no-print fixed inset-y-0 left-0 z-50 flex w-[238px] flex-col p-4 text-[var(--sidebar-ink,#dbe6f2)] transition-transform md:static md:translate-x-0",
            open ? "translate-x-0" : "-translate-x-full"
          )}
          style={{ background: "var(--sidebar, var(--navy))" }}
        >
          <div className="flex items-center gap-3 px-1 pb-4 pt-1">
            <img
              className="h-16 w-16 shrink-0 object-contain drop-shadow-md"
              style={site.logoScale ? { transform: `scale(${site.logoScale})` } : undefined}
              src={site.logo}
              alt=""
            />
            <div className="min-w-0 leading-tight">
              <b className="font-display text-[18px] font-semibold text-white">{site.name}</b>
              <br />
              <span className="text-[12px] text-[var(--sidebar-muted,#8fa6bf)]">Accounts</span>
            </div>
          </div>

          {/* Institution switcher — super-admins see every institution's books. */}
          {superadmin && (
            // Tabs size to their names (not equal thirds) so the full names fit
            // in capitals; "GRACE VALLEY" breaks onto two lines.
            <div className="mb-4 flex gap-1 rounded-xl bg-black/25 p-1" role="tablist" aria-label="Institution">
              {SITES.map((s) => (
                <button
                  key={s.id}
                  role="tab"
                  aria-selected={s.id === site.id}
                  onClick={() => { setSite(s.id); setOpen(false); }}
                  className={cx(
                    "grid min-h-[40px] flex-auto place-items-center rounded-lg px-2 py-1.5 text-center text-[10.5px] font-extrabold uppercase leading-[1.15] tracking-[0.06em] transition",
                    s.id === site.id ? "bg-white text-navy shadow-sm" : "text-[var(--sidebar-link,#cfe0f2)] hover:bg-white/10"
                  )}
                >
                  {s.tab}
                </button>
              ))}
            </div>
          )}

          {/* Unit picker — PMSA's schools and colleges. Filters the dashboard,
              transactions, reports and staff. */}
          {hasUnits && (
            <label className="mb-4 block">
              <span className="mb-1 flex items-center gap-1.5 px-1 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--sidebar-muted,#8fa6bf)]">
                <Building2 size={13} /> Institution
              </span>
              <select
                value={unit}
                onChange={(e) => { setUnit(e.target.value); setOpen(false); }}
                className="w-full rounded-[10px] border border-white/15 bg-black/25 px-3 py-2 text-[13.5px] font-semibold text-white outline-none focus:border-white/40 [&>option]:bg-white [&>option]:font-semibold [&>option]:text-[#0E2E52]"
              >
                <option value="all">All {site.name}</option>
                {units.filter((u) => u.active || u.id === unit).map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
                <option value="common">{site.name} – Common</option>
              </select>
            </label>
          )}

          {nav.map((n) => {
            const active = n.exact ? pathname === n.href : pathname.startsWith(n.href);
            const Icon = n.icon;
            return (
              <Link
                key={n.href}
                href={n.href}
                onClick={() => setOpen(false)}
                className={cx(
                  "flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-[14.5px] font-semibold transition",
                  active ? "btn-grad text-white" : "text-[var(--sidebar-link,#cfe0f2)] hover:bg-white/10"
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
                <div className="text-[11.5px] capitalize text-[var(--sidebar-muted,#8fa6bf)]">{superadmin ? SUPERADMIN_LABEL : profile.role}</div>
              </div>
            </div>
            <button
              onClick={signOut}
              className="mt-1.5 flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-[14.5px] font-semibold text-[var(--sidebar-link,#cfe0f2)] transition hover:bg-white/10"
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
              {/* Page name, then whose books they are: the selected PMSA
                  institution when one is picked, else the whole institution. */}
              <h1 className="font-display text-xl font-semibold sm:text-[22px]">
                {TITLES[pathname] || "Accounts"}
                <span className="font-normal text-muted"> — </span>
                <span className="text-brand">{hasUnits && unit !== "all" ? unitName(unit === "common" ? null : unit) : site.name}</span>
              </h1>
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
                {appsOpen && <AppsMenu role={profile.role} email={profile.email} local={site.local} units={hasUnits} onClose={() => setAppsOpen(false)} onSignOut={signOut} />}
              </div>
              <ThemeToggle />
            </div>
          </header>

          <main className="p-4 sm:p-7">
            {error ? (
              <div className="rounded-xl border border-bad bg-bad-bg px-4 py-3 text-[14px] font-semibold text-bad">{error}</div>
            ) : (
              children
            )}
          </main>
        </div>
      </div>
    </>
  );
}

function AppsMenu({ role, email, local, units, onClose, onSignOut }: { role: Role; email?: string | null; local: boolean; units: boolean; onClose: () => void; onSignOut: () => void }) {
  const superadmin = isSuperadmin(email);

  // Accounting roles viewer/pending fall back to the student menu. In practice
  // only super-admins ever reach this shell — app/admin/layout.tsx redirects
  // everyone else — so the Accounts section is always present here.
  const erpRole: UserRole = role === "admin" ? "admin" : role === "accountant" ? "accountant" : "student";

  // The same launcher the school ERP uses, so there is one apps menu across the
  // whole portal instead of two that drift apart. getMenuForRole already carries
  // the full Accounts section, so the only thing added by hand is the
  // public-site link the old bespoke menu kept in its footer.
  const all = [
    ...getMenuForRole(erpRole, { isSuperadmin: superadmin }),
    { title: "Site", items: [{ href: "/", label: "Website", icon: Globe, color: "bg-violet-500" }] },
  ];
  // Everything outside the Accounts section is Ihlamudheen's own school ERP and
  // website, so Grace Valley and PMSA only get their Accounts pages — minus the
  // ones they don't have (NAV entries marked local, e.g. Meelad).
  const localOnly = new Set(NAV.filter((n) => n.local).map((n) => n.href));
  const categories = local
    ? all
    : all
        .filter((c) => c.title === "Accounts")
        .map((c) => ({
          ...c,
          items: [
            ...c.items.filter((i) => !localOnly.has(i.href)),
            ...(units
              ? [
                  { href: "/admin/payroll", label: "Payroll", icon: Banknote, color: "bg-amber-500" },
                  { href: "/admin/unit-costs", label: "Institution Costs", icon: PieChart, color: "bg-pink-500" },
                ]
              : []),
          ],
        }));

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute right-0 top-12 z-50 flex max-h-[80vh] w-[320px] flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-card dark:bg-navy-800">
        <NavMenuBody
          categories={categories}
          onItemClick={onClose}
          onLogout={() => { onClose(); onSignOut(); }}
        />
      </div>
    </>
  );
}
