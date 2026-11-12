import type { Metadata } from "next";
import HomeShell from "@/components/HomeShell";
import { SITE_OPEN_GRAPH, SITE_URL } from "@/lib/site";

/**
 * The homepage's own address. It is said here and not in the root
 * layout, where every other page would inherit it. Setting `openGraph`
 * replaces the layout's whole block, so the site's share text is said
 * again with the address added.
 */
export const metadata: Metadata = {
  alternates: { canonical: SITE_URL },
  openGraph: { ...SITE_OPEN_GRAPH, url: SITE_URL },
};

export default function Home() {
  return <HomeShell />;
}
