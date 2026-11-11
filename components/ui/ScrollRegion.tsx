"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * A part of a panel that scrolls by itself: a dialog's body under a title
 * that stays put.
 *
 * When its content does not fit, the keyboard has to be able to scroll
 * it. A dialog keeps Tab inside itself, and with only a close key to
 * stop on, the arrow keys, Page Down and End had nothing to act on: the
 * rest of the panel could be read with a wheel or a finger and not at
 * all from the keyboard. So while it overflows it is a Tab stop, named
 * by the panel's heading (`labelledBy`), with a focus line drawn just
 * inside it (one outside would be cut by the panel's stepped corners).
 * When everything fits it is not a stop: there would be nothing to do
 * there.
 */
export default function ScrollRegion({
  labelledBy,
  className = "",
  children,
}: {
  /** The id of the heading that names this part. */
  labelledBy?: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrolls, setScrolls] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // The observer reports once as soon as it starts, and again whenever
    // the region or anything in it changes size.
    const ro = new ResizeObserver(() => {
      setScrolls(el.scrollHeight > el.clientHeight + 1);
    });
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      tabIndex={scrolls ? 0 : undefined}
      role={scrolls ? "group" : undefined}
      aria-labelledby={scrolls ? labelledBy : undefined}
      className={`min-h-0 flex-1 overflow-y-auto overscroll-contain focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue ${className}`.trim()}
    >
      {children}
    </div>
  );
}
