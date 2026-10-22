// The institutions shown in the Accounts portal. All of their books are kept in
// Ihlamudheen's own database, each row tagged with its institution id
// (supabase/institutions.sql, lib/scoped-db.ts).
export type SiteId = "ihlamudheen" | "gracevalley" | "pmsa";

export interface Site {
  id: SiteId;
  /** Short label for the switcher tabs. */
  tab: string;
  /** Name shown beside the logo in the sidebar. */
  name: string;
  logo: string;
  /** Enlarges the sidebar logo to offset empty space inside the image. */
  logoScale?: number;
  /** true = Ihlamudheen itself, which alone also has the school ERP, the
   *  public website and the Meelad book. */
  local: boolean;
}

export const SITES: Site[] = [
  { id: "ihlamudheen", tab: "Ihlamudheen", name: "Ihlamudheen", logo: "/Logo of Ihlamudheen Madrasa dark-bg removed.png", logoScale: 1.3, local: true },
  { id: "gracevalley", tab: "Grace Valley", name: "Grace Valley", logo: "/sites/grace-valley.png", local: false },
  { id: "pmsa", tab: "PMSA", name: "PMSA", logo: "/sites/pmsa.png", local: false },
];

export const DEFAULT_SITE: SiteId = "ihlamudheen";

export const getSite = (id: string | null | undefined): Site =>
  SITES.find((s) => s.id === id) ?? SITES[0];
