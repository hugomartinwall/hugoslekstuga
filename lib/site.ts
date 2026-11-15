import type { Metadata } from "next";
import { pathFor } from "./clusters";
import { findTool } from "./tools";

/**
 * What a page says about itself in its <head>: its address, and the name
 * and description a link preview shows.
 *
 * Next merges a page's metadata into its layout's one level deep: a page
 * that sets `openGraph`, `twitter` or `alternates` replaces the layout's
 * whole object. So a page cannot set its own og:url and inherit the
 * rest; it has to say all of it, and `pageMetadata` is where that is
 * written once. The root layout says only what is true of every page. It
 * used to carry the homepage's canonical address and og:url as well, and
 * every tool page inherited them and called itself the homepage.
 *
 * Share images are not set here. They come from each route's
 * opengraph-image file: Next adds that image to whatever `openGraph` the
 * page in the same folder sets. A page with no image file of its own
 * (/about) has to hand the layout's image on; see app/about/page.tsx.
 */

/** The site's address, spelled as app/sitemap.ts and app/robots.ts spell it. */
export const SITE_URL = "https://hugoslekstuga.com";

/** The searchable name. The wordmark is the unspaced "hugoslekstuga";
 *  both appear in titles and descriptions so a search matches either. */
export const SITE_NAME = "Hugos Lekstuga";
/** The homepage's title, and the title of a page that sets none. */
export const SITE_TITLE = "Hugos Lekstuga (Hugos Playhouse)";

/** The site in one sentence: its meta description, and the description
 *  in a share preview of any page that has none of its own. The
 *  homepage's hidden intro (components/HomeShell.tsx) opens with it too,
 *  so the voice is the same by search, by preview and on the page. */
export const SITE_TAGLINE =
  "Hugo spends the off-hours on experiments that occasionally turn into something worth sharing.";

/** A page's full title: its own name, then the site's. */
function fullTitle(name: string): string {
  return `${name} — ${SITE_NAME}`;
}

/** The same as the template the root layout gives Next, for the pages
 *  that only set a `title` (the 404, the lab). */
export const TITLE_TEMPLATE = fullTitle("%s");

/** The share fields that are the same on every page. */
const OPEN_GRAPH = {
  siteName: SITE_NAME,
  locale: "en_US",
  type: "website",
} as const;
const TWITTER = { card: "summary_large_image" } as const;

/**
 * The site's own share text. The root layout carries it, so a page that
 * says nothing about itself still previews as the site, and the homepage
 * adds its address (app/page.tsx).
 */
export const SITE_OPEN_GRAPH = {
  ...OPEN_GRAPH,
  title: SITE_TITLE,
  description: SITE_TAGLINE,
} as const;
export const SITE_TWITTER = {
  ...TWITTER,
  title: SITE_NAME,
  description: SITE_TAGLINE,
} as const;

type PageHead = {
  /** The page's own name ("About"); the site's name is added to it. */
  title: string;
  description: string;
  /** Where it lives, from the root: "/about". */
  path: string;
};

/**
 * One page's metadata: the canonical address and og:url are its own, and
 * the title and description are the same text in the <title>, the Open
 * Graph tags and the Twitter tags.
 */
export function pageMetadata({ title, description, path }: PageHead): Metadata {
  const url = `${SITE_URL}${path}`;
  const full = fullTitle(title);
  return {
    title: { absolute: full },
    description,
    alternates: { canonical: url },
    openGraph: { ...OPEN_GRAPH, title: full, description, url },
    twitter: { ...TWITTER, title: full, description },
  };
}

/**
 * The metadata of a tool's or a game's page, from its registry entry:
 * `export const metadata = toolMetadata("<slug>")` is the whole of it.
 */
export function toolMetadata(slug: string): Metadata {
  const tool = findTool(slug);
  if (!tool) throw new Error(`toolMetadata: no "${slug}" in lib/tools.ts`);
  return pageMetadata({
    title: tool.title,
    description: tool.description,
    path: pathFor(slug),
  });
}
