import type { NextConfig } from "next";

// Tools retired in the 2026 curation cull. Bookmarks land on the
// homepage with ?retired=<slug> so Hugo can acknowledge the loss.
const RETIRED_TOOLS = [
  "case",
  "cleantext",
  "convert",
  "diff",
  "pdf",
  "qr",
  "read",
  "typing",
  "stretch",
];

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // Picker was folded into Roll (which now has a "remove winners as
      // they spin" mode). Anyone with a /tools/picker bookmark lands on
      // the wheel instead.
      {
        source: "/tools/picker",
        destination: "/tools/roll",
        permanent: true,
      },
      ...RETIRED_TOOLS.map((slug) => ({
        source: `/tools/${slug}`,
        destination: `/?retired=${slug}`,
        permanent: true,
      })),
    ];
  },
};

export default nextConfig;
