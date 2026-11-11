import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import PixelIcon from "@/components/PixelIcon";
import { keycapClass } from "@/components/ui/Keycap";

export const metadata: Metadata = {
  title: "Lab",
  robots: { index: false, follow: false },
};

/* The tape's cut end: the card notch (8px and 4px steps) on its left
   corners only. The right end runs off the screen, so it has none. */
const TAPE_END =
  "polygon(0 8px, 4px 8px, 4px 4px, 8px 4px, 8px 0, 100% 0, 100% 100%, 8px 100%, 8px calc(100% - 4px), 4px calc(100% - 4px), 4px calc(100% - 8px), 0 calc(100% - 8px))";

/**
 * Lab routes are prototyping surfaces. They:
 *   - Return 404 in production builds (the gate below). Local dev only.
 *   - Live under `/lab` (no leading underscore) — Next.js App Router
 *     treats `_`-prefixed folders as private and won't route them.
 *   - Render under the root layout, so the real nav + brand dot are in
 *     view while we prototype. The yellow strip below makes it obvious
 *     at a glance that you're not on a shipped page.
 *
 * The strip is a length of acid tape across the top of the screen. It
 * starts to the right of Hugo's corner (the same line a tool page's
 * title row starts on), so he is never sitting half on it; the band
 * behind it is page-coloured, so what scrolls under the tape does not
 * show through beside him.
 */
export default function LabLayout({ children }: { children: ReactNode }) {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }
  return (
    <div className="relative">
      <div className="sticky top-0 z-20 bg-cream bg-(image:--dither) pl-19">
        <div
          style={{ clipPath: TAPE_END }}
          className="flex min-h-11 items-center justify-between gap-2 bg-yellow px-2.5 py-1 sm:gap-3 sm:pr-6 sm:pl-4"
        >
          {/* On a phone the label takes two lines beside the key. */}
          <p className="label-pixel text-balance text-cream">
            Lab · prototypes, not shipped
          </p>
          <a
            href="/lab"
            className={keycapClass({
              tone: "quiet",
              size: "sm",
              className: "shrink-0",
            })}
          >
            <PixelIcon name="back" size={12} />
            <span className="label-pixel text-ink-soft">lab index</span>
          </a>
        </div>
      </div>
      {children}
    </div>
  );
}
