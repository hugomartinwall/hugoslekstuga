import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ResolvingMetadata } from "next";
import { describe, expect, it, vi } from "vitest";
import sitemap from "../../app/sitemap";
import { pathFor } from "../../lib/clusters";
import {
  SITE_NAME,
  SITE_OPEN_GRAPH,
  SITE_TAGLINE,
  SITE_TITLE,
  SITE_TWITTER,
  TITLE_TEMPLATE,
  pageMetadata,
  toolMetadata,
} from "../../lib/site";
import { tools } from "../../lib/tools";

/**
 * Every page used to say it was the homepage: the root layout carried
 * the homepage's canonical address and og:url, and a page inherits what
 * its layout says. Now each page says its own (lib/site.ts). This suite
 * holds what keeps that true: what the helper builds, what each page
 * exports (the thirteen from the registry, the homepage and /about),
 * that the layout stays out of it, and that nothing else under app/
 * writes an address by hand.
 *
 * What a browser is finally served is Next's doing and is not tested
 * here; it was measured against the running site when this was written.
 */

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/**
 * What a page module exports, without what it renders: `component`, the
 * client component it imports, is stood in for, so none of the page's UI
 * is loaded.
 */
async function exportsOf(page: string, component: string) {
  vi.doMock(component, () => ({ default: () => null }));
  return (await import(page)) as Record<string, unknown>;
}

describe("what a page says about itself", () => {
  it("a page's address, title and description are its own, in all three places", () => {
    expect(
      pageMetadata({ title: "About", description: "Words.", path: "/about" }),
    ).toEqual({
      title: { absolute: "About — Hugos Lekstuga" },
      description: "Words.",
      alternates: { canonical: "https://hugoslekstuga.com/about" },
      openGraph: {
        title: "About — Hugos Lekstuga",
        description: "Words.",
        url: "https://hugoslekstuga.com/about",
        siteName: "Hugos Lekstuga",
        locale: "en_US",
        type: "website",
      },
      twitter: {
        card: "summary_large_image",
        title: "About — Hugos Lekstuga",
        description: "Words.",
      },
    });
  });

  it("a tool's comes from its registry entry, at the address the sitemap lists", () => {
    const listed = sitemap().map((entry) => entry.url);
    for (const tool of tools) {
      const head = toolMetadata(tool.slug);
      expect(head).toEqual(
        pageMetadata({
          title: tool.title,
          description: tool.description,
          path: pathFor(tool.slug),
        }),
      );
      expect(listed).toContain(head.alternates?.canonical);
    }
    expect(() => toolMetadata("no-such-slug")).toThrow();
  });

  it("each tool's page exports exactly that, and has its image route beside it", async () => {
    for (const tool of tools) {
      const dir = `app${pathFor(tool.slug)}`;
      // Both files: a page without its own image file has no share
      // picture at all (its share block replaces the layout's).
      for (const file of ["page.tsx", "opengraph-image.tsx"]) {
        expect(existsSync(join(ROOT, dir, file)), `${dir}/${file} exists`).toBe(true);
      }
      // The helper's block for its own slug, whole: a page copied from
      // its neighbour, or one that swaps a part of the block out, says
      // something else.
      const page = await exportsOf(`../../${dir}/page`, `../../${dir}/Client`);
      expect(page.metadata, `${dir}/page.tsx`).toEqual(toolMetadata(tool.slug));
      expect(page.generateMetadata, `${dir}/page.tsx`).toBeUndefined();
    }
  });

  it("the homepage says its own address, with the site's share text", async () => {
    const page = await exportsOf("../../app/page", "../../components/HomeShell");
    // Its share block replaces the layout's, so it is the layout's again
    // with the address added.
    expect(page.metadata).toEqual({
      alternates: { canonical: "https://hugoslekstuga.com" },
      openGraph: { ...SITE_OPEN_GRAPH, url: "https://hugoslekstuga.com" },
    });
    expect(page.generateMetadata).toBeUndefined();
  });

  it("/about says its own, and hands the site's image on", async () => {
    const page = await exportsOf("../../app/about/page", "../../app/about/Client");
    const generate = page.generateMetadata as (
      props: unknown,
      parent: ResolvingMetadata,
    ) => Promise<unknown>;
    const images = [{ url: "the layout's image" }];
    const parent = Promise.resolve({ openGraph: { images } });
    // Its description is brand voice (AGENTS.md): not reworded in passing.
    const own = pageMetadata({
      title: "About",
      description: "lekstuga (n., Swedish). Potentially useful.",
      path: "/about",
    });
    expect(await generate({}, parent as unknown as ResolvingMetadata)).toEqual({
      ...own,
      openGraph: { ...own.openGraph, images },
    });
    expect(page.metadata).toBeUndefined();
  });

  it("the root layout says what is true of every page, and no address", () => {
    // Read as text: the module pulls in the fonts and the whole chrome.
    const layout = read("app/layout.tsx");
    const block = layout.match(/\nexport const metadata: Metadata = \{\n([^]*?\n)\};\n/)?.[1];
    expect(block, "the layout's metadata").toBeDefined();
    // What a page that says nothing falls back on, and the homepage's
    // own title and description.
    for (const line of [
      "    default: SITE_TITLE,",
      "    template: TITLE_TEMPLATE,",
      "  description: SITE_TAGLINE,",
      "  metadataBase: new URL(SITE_URL),",
      "  openGraph: SITE_OPEN_GRAPH,",
      "  twitter: SITE_TWITTER,",
    ]) {
      expect(block).toContain(`\n${line}\n`);
    }
    // Nothing else reaches the block: not spread in, not added
    // afterwards, not generated.
    expect(block).not.toContain("...");
    expect(layout).not.toMatch(/\bgenerateMetadata\b|\bmetadata\s*[.[]/);
    // The two blocks every page falls back on: the site's words, no address.
    expect(SITE_OPEN_GRAPH).toEqual({
      siteName: SITE_NAME,
      locale: "en_US",
      type: "website",
      title: SITE_TITLE,
      description: SITE_TAGLINE,
    });
    expect(SITE_TWITTER).toEqual({
      card: "summary_large_image",
      title: SITE_NAME,
      description: SITE_TAGLINE,
    });
    // A page that only sets a title (the 404, the lab) gets the same full
    // title the helper builds.
    expect(TITLE_TEMPLATE).toBe("%s — Hugos Lekstuga");
  });

  it("nothing else under app/ writes an address or a share block by hand", () => {
    const files = readdirSync(join(ROOT, "app"), { recursive: true, encoding: "utf8" })
      .filter((file) => /\.tsx?$/.test(file))
      .map((file) => `app/${file}`)
      .sort();
    const naming = (word: RegExp) => files.filter((file) => word.test(read(file)));
    // A canonical link: the homepage's own. Every other page gets its
    // from the helper, and the 404 and the lab have none.
    expect(naming(/\balternates\b|\bcanonical\s*:/)).toEqual(["app/page.tsx"]);
    // A share block: the layout's, the homepage's (the layout's with the
    // address added) and /about's (the helper's with the image handed on).
    expect(naming(/\bopenGraph\b/)).toEqual([
      "app/about/page.tsx",
      "app/layout.tsx",
      "app/page.tsx",
    ]);
    expect(naming(/\btwitter\s*:/)).toEqual(["app/layout.tsx"]);
  });
});
