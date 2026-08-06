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

// The multiplayer games, shut down 2026-08 along with their WebSocket
// server. Same landing treatment, different URL prefix.
const RETIRED_GAMES = ["munch", "noodle"];

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
      ...RETIRED_GAMES.map((slug) => ({
        source: `/games/${slug}`,
        destination: `/?retired=${slug}`,
        permanent: true,
      })),
    ];
  },
};

export default nextConfig;
