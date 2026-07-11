import type { MetadataRoute } from "next";

// Before this file existed, /robots.txt redirected to the LOGIN PAGE (the
// middleware catch-all) — a crawler-hostile answer. Public marketing pages
// are crawlable; everything auth-gated or token-addressed is not.
export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_APP_URL || "https://greenkeep.us";
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/buyers/claim/", // token-addressed
          "/buyers/residential",
          "/dashboard",
          "/properties",
          "/campaigns",
          "/packages",
          "/messages",
          "/companies",
          "/customers",
          "/quote/", // unguessable buyer microsites — public but not indexable
          "/proposals",
          "/login",
        ],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
