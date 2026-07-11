import type { MetadataRoute } from "next";

// Search Console feeds from this. Only the public marketing surface belongs
// here — dashboards, claim links, and operator pages are auth-gated and
// deliberately absent. Keep in sync with middleware PUBLIC_PREFIXES.
export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXT_PUBLIC_APP_URL || "https://greenkeep.us";
  const now = new Date();
  const page = (
    path: string,
    priority: number,
    changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] = "weekly"
  ) => ({ url: `${base}${path}`, lastModified: now, changeFrequency, priority });

  return [
    page("/", 1, "daily"),
    page("/buyers/signup", 0.9),
    page("/why", 0.8),
    page("/about", 0.7),
    page("/residential", 0.7),
    page("/commercial", 0.7),
    page("/bids", 0.6),
    page("/contact", 0.5, "monthly"),
    page("/terms", 0.2, "yearly"),
    page("/privacy", 0.2, "yearly"),
  ];
}
