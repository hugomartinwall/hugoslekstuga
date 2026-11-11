import Link from "next/link";
import { isGameSlug, pathFor } from "@/lib/clusters";
import { tools } from "@/lib/tools";
import type { Tool } from "@/lib/tools";

/**
 * The index footer: the way to another toy, and to About, without a trip
 * back through the homepage. One line of games and one of tools, straight
 * from the registry (a new entry shows up here by itself), then the small
 * print.
 *
 * It is the one place v2 adds chrome to a site that is sparse on purpose,
 * so it stays the quietest thing on the page: small type, no icons, no
 * frames. Three short rows on a desktop, sharing one lead column (label,
 * then links). On a phone the links wrap and each label sits above its row.
 *
 * `pathname` marks the link for the page you are on (aria-current, and
 * not dimmed). `className` lands on the <footer> itself, so a route can
 * decide in CSS where it shows. `index={false}` leaves only the small
 * print: the phone homepage is itself the index, and a second copy of it
 * straight underneath would be noise.
 *
 * The column is the page column (48rem), so the footer's left edge is the
 * left edge of the tool or About page above it.
 */

const GAMES = tools.filter((t) => isGameSlug(t.slug));
const TOOLS = tools.filter((t) => !isGameSlug(t.slug));

/* A link is 44px tall under a finger and a short 28px row under a mouse.
   Its side padding is half the space between two links, so a row is one
   unbroken run of targets; a list pulls back by the same amount to keep
   its text on the column's edge. Keyboard focus is the site-wide cyan
   outline (globals.css, base layer): nothing to add, nothing to remove. */
const LINK =
  "inline-flex min-h-11 items-center px-2.5 text-ink-muted hover:text-ink aria-[current=page]:text-ink pointer-fine:min-h-7";

/* The lead column: what a row starts with. */
const LEAD = "w-16 shrink-0";

function IndexRow({
  id,
  label,
  items,
  pathname,
}: {
  id: string;
  label: string;
  items: Tool[];
  pathname?: string;
}) {
  return (
    <nav aria-labelledby={id} className="sm:flex sm:items-baseline">
      <p id={id} className={`label-pixel ${LEAD}`}>
        {label}
      </p>
      <ul className="-mx-2.5 flex min-w-0 flex-wrap sm:flex-1">
        {items.map((t) => {
          const href = pathFor(t.slug);
          return (
            <li key={t.slug}>
              {/* No prefetch: with the whole index in view, every page
                  would pull every other route in the background. */}
              <Link
                href={href}
                prefetch={false}
                aria-current={pathname === href ? "page" : undefined}
                className={LINK}
              >
                {t.title}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export default function Footer({
  pathname,
  className = "",
  index = true,
}: {
  pathname?: string;
  className?: string;
  index?: boolean;
}) {
  const year = new Date().getFullYear();
  return (
    <footer
      className={`mt-24 border-t border-line bg-cream-deep bg-(image:--dither) text-xs text-ink-muted ${className}`.trim()}
    >
      <div className="page-col px-5 py-5 sm:px-8 sm:py-4">
        {index ? (
          <div className="mb-3 flex flex-col gap-3 sm:mb-0 sm:gap-0">
            <IndexRow
              id="footer-games"
              label="Games"
              items={GAMES}
              pathname={pathname}
            />
            <IndexRow
              id="footer-tools"
              label="Tools"
              items={TOOLS}
              pathname={pathname}
            />
          </div>
        ) : null}

        {/* The small print: two lead-and-line pairs. Side by side where
            there is room, the second one under the first where there is
            not, and then they share the lead column too. */}
        <div className="flex flex-wrap items-baseline justify-between gap-x-6">
          <div className="flex items-baseline">
            <span className={LEAD}>
              <Link
                href="/about"
                prefetch={false}
                aria-current={pathname === "/about" ? "page" : undefined}
                className={`${LINK} -ml-2.5`}
              >
                About
              </Link>
            </span>
            <p>No tracking, no accounts.</p>
          </div>
          <div className="flex items-baseline">
            <p className={LEAD}>© {year}</p>
            <p>potentially useful</p>
          </div>
        </div>
      </div>
    </footer>
  );
}
