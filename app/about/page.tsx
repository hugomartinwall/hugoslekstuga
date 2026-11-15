import type { Metadata, ResolvingMetadata } from "next";
import { pageMetadata } from "@/lib/site";
import Client from "./Client";

const head = pageMetadata({
  title: "About",
  description: "lekstuga (n., Swedish). Potentially useful.",
  path: "/about",
});

/**
 * /about has no share image of its own: it shows the site's. A page's
 * `openGraph` replaces the layout's whole block, the image with it, and
 * Next only puts an image back for a folder that has its own
 * opengraph-image file. So this page hands the layout's image on. (A
 * tool or a game has its own file and exports a plain `metadata`.)
 */
export async function generateMetadata(
  _props: unknown,
  parent: ResolvingMetadata,
): Promise<Metadata> {
  const images = (await parent).openGraph?.images;
  return { ...head, openGraph: { ...head.openGraph, images } };
}

export default function AboutPage() {
  return <Client />;
}
