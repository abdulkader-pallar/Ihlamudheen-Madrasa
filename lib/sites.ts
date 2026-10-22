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
  /** Full name and logo for the letterhead on downloaded PDFs
   *  (lib/accounts-pdf.ts); the logo must read well on white. */
  fullName: string;
  pdfLogo: string;
  /** Letterhead accent colour, taken from the logo. */
  pdfColor: string;
  /** true = Ihlamudheen itself, which alone also has the school ERP, the
   *  public website and the Meelad book. */
  local: boolean;
}

export const SITES: Site[] = [
  { id: "ihlamudheen", tab: "Ihlamudheen", name: "Ihlamudheen", logo: "/Logo of Ihlamudheen Madrasa dark-bg removed.png", logoScale: 1.3, local: true,
    fullName: "Ihlamudheen Madrasa", pdfLogo: "/Logo of Ihlamudheen Madrasa light-bg removed.png", pdfColor: "#0E2E52" },
  { id: "gracevalley", tab: "Grace Valley", name: "Grace Valley", logo: "/sites/grace-valley.png", local: false,
    fullName: "Grace Valley Institutions", pdfLogo: "/sites/grace-valley.png", pdfColor: "#1B7F3B" },
  { id: "pmsa", tab: "PMSA", name: "PMSA", logo: "/sites/pmsa.png", local: false,
    fullName: "PMSA Kattilangadi", pdfLogo: "/sites/pmsa.png", pdfColor: "#0E3A63" },
];

export const DEFAULT_SITE: SiteId = "ihlamudheen";

export const getSite = (id: string | null | undefined): Site =>
  SITES.find((s) => s.id === id) ?? SITES[0];
