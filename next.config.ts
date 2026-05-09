import type { NextConfig } from "next";

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
    ];
  },
};

export default nextConfig;
