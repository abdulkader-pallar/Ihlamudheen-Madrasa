import type { MetadataRoute } from "next";

const SITE_URL = "https://ihlamudheen-madrasa.vercel.app";

// Public pages are open to search engines so people can find the madrasa.
// The staff portals and APIs are kept out of the index.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/admin",       // Accounts portal
          "/dashboard",   // school ERP
          "/api",
          "/login",
          "/register",
          "/auth",
          "/verify",
          "/student",
          "/card",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
