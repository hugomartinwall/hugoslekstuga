import type { MetadataRoute } from "next";
import { tools } from "@/lib/tools";
import { pathFor } from "@/lib/clusters";

const BASE = "https://hugoslekstuga.se";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const roots: MetadataRoute.Sitemap = [
    {
      url: `${BASE}/`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1.0,
    },
    {
      url: `${BASE}/about`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: `${BASE}/promise`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.5,
    },
  ];
  const toolRoutes = tools.map((t) => ({
    url: `${BASE}${pathFor(t.slug)}`,
    lastModified: now,
    changeFrequency: "monthly" as const,
    priority: 0.8,
  }));
  return [...roots, ...toolRoutes];
}
