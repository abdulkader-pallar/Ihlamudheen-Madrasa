// The institutions shown in the Accounts portal. Ihlamudheen is this site's own
// Supabase database (read/write). The others are separate deployments of the
// same accounting app; their data is pulled read-only through each site's
// GET /api/export endpoint via app/api/admin/sites/[site]/route.ts, so their
// API keys never reach the browser. This file is safe to import client-side.
export type SiteId = "ihlamudheen" | "gracevalley" | "pmsa";

export interface Site {
  id: SiteId;
  /** Short label for the switcher tabs. */
  tab: string;
  /** Name shown beside the logo in the sidebar. */
  name: string;
  logo: string;
  /** true = this site's own database; false = read-only remote export. */
  local: boolean;
}

export const SITES: Site[] = [
  { id: "ihlamudheen", tab: "Ihlamudheen", name: "Ihlamudheen", logo: "/Logo of Ihlamudheen Madrasa dark-bg removed.png", local: true },
  { id: "gracevalley", tab: "Grace Valley", name: "Grace Valley", logo: "/sites/grace-valley.png", local: false },
  { id: "pmsa", tab: "PMSA", name: "PMSA", logo: "/sites/pmsa.png", local: false },
];

export const DEFAULT_SITE: SiteId = "ihlamudheen";

export const getSite = (id: string | null | undefined): Site =>
  SITES.find((s) => s.id === id) ?? SITES[0];
