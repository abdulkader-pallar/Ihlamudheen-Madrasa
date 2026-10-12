// The institutions shown in the Accounts portal. Ihlamudheen is this site's own
// Supabase database. The others are separate deployments of the same
// accounting app with their own Supabase projects; they are read and edited
// through app/api/admin/sites/[site]/route.ts (see lib/remote-db.ts), so their
// secret keys never reach the browser. This file is safe to import client-side.
export type SiteId = "ihlamudheen" | "gracevalley" | "pmsa";

export interface Site {
  id: SiteId;
  /** Short label for the switcher tabs. */
  tab: string;
  /** Name shown beside the logo in the sidebar. */
  name: string;
  logo: string;
  /** true = this site's own database; false = another institution's. */
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
