import type { Metadata } from "next";
import Link from "next/link";
import PixelIcon from "@/components/PixelIcon";
import IconTile from "@/components/ui/IconTile";
import Keycap from "@/components/ui/Keycap";
import Panel from "@/components/ui/Panel";
import Tag from "@/components/ui/Tag";
import { isGameSlug, pathFor } from "@/lib/clusters";
import { accentVars } from "@/lib/colors";
import { iconForSlug } from "@/lib/pixel-icons";
import { tools } from "@/lib/tools";

export const metadata: Metadata = {
  title: "Lost",
};

// A small selection of tools to suggest as starting points.
const SUGGESTED = ["advice", "sudoku", "roll", "focus", "breathe", "strip"];

export default function NotFound() {
  const suggested = SUGGESTED.map((slug) =>
    tools.find((t) => t.slug === slug),
  ).filter((t): t is NonNullable<typeof t> => Boolean(t));

  return (
    // Coral is this page's accent: the tag, the lost word and the one
    // primary key all read it from here. The top padding is what keeps
    // the column out of Hugo's corner (he ends 62px down, at any width).
    <main
      style={accentVars("tomato")}
      className="page-col px-5 pt-20 pb-14 sm:px-8 sm:pb-20"
    >
      <header className="flex flex-col gap-5">
        <Tag tone="accent" className="gap-2 px-2.5 py-1.5">
          <span className="h-1.5 w-1.5 bg-(--accent)" aria-hidden />
          404
        </Tag>
        <h1 className="font-display text-5xl leading-[0.95] sm:text-6xl lg:text-7xl">
          That page got{" "}
          <span className="text-(--accent)">lost</span>
          <br />
          in the playhouse.
        </h1>
        <p className="max-w-lg text-lg leading-relaxed text-ink-soft sm:text-xl">
          Either the link is wrong, or the tool you&rsquo;re after moved on.
          The playhouse keeps a smaller, sharper set now — try something else.
        </p>
      </header>

      <section className="mt-10 flex flex-wrap items-center gap-x-4 gap-y-3">
        <Keycap href="/" tone="accent" size="lg">
          <PixelIcon name="back" size={12} />
          Back home
        </Keycap>
        {/* A keyboard shortcut is no use to a finger. */}
        <p className="text-sm text-ink-muted pointer-coarse:hidden">
          or, you know,{" "}
          <kbd className="kbd-chunk">⌘K</kbd>{" "}
          from anywhere.
        </p>
      </section>

      <section className="mt-12">
        <h2 className="label-pixel">Or try one of these</h2>
        {/* Every row is as tall as the tallest, so a tagline that needs a
            second line gets one (it used to be cut off) and the six
            cards still match. */}
        <ul className="mt-3 grid auto-rows-fr grid-cols-1 gap-3 sm:grid-cols-2">
          {suggested.map((t) => {
            return (
              <li key={t.slug} className="flex">
                <Panel
                  as={Link}
                  href={pathFor(t.slug)}
                  className="flex w-full min-w-0 items-center gap-3 p-4"
                >
                  {/* Each tile wears its own tool's colour, not the page's coral. */}
                  <span style={accentVars(t.color)} className="flex shrink-0">
                    <IconTile name={iconForSlug(t.slug, isGameSlug(t.slug))} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-2xl leading-none">
                      {t.title}
                    </p>
                    <p className="mt-1 text-sm leading-snug text-ink-soft">
                      {t.tagline}
                    </p>
                  </div>
                  <PixelIcon
                    name="forward"
                    size={12}
                    className="shrink-0 text-ink-muted"
                  />
                </Panel>
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
