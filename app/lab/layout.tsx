import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";

export const metadata: Metadata = {
  title: "Lab",
  robots: { index: false, follow: false },
};

/**
 * Lab routes are prototyping surfaces. They:
 *   - Return 404 in production builds (the gate below). Local dev only.
 *   - Live under `/lab` (no leading underscore) — Next.js App Router
 *     treats `_`-prefixed folders as private and won't route them.
 *   - Render under the root layout, so the real nav + brand dot are in
 *     view while we prototype. The yellow strip below makes it obvious
 *     at a glance that you're not on a shipped page.
 */
export default function LabLayout({ children }: { children: ReactNode }) {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }
  return (
    <div className="relative">
      <div className="sticky top-0 z-20 border-b-2 border-ink bg-yellow text-ink">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-5 py-2 sm:px-8">
          <p className="font-display text-xs font-extrabold uppercase tracking-widest">
            Lab · prototypes, not shipped
          </p>
          <a
            href="/lab"
            className="rounded-full border-2 border-ink bg-cream px-3 py-0.5 text-xs font-bold transition-colors hover:bg-cream-deep"
          >
            ← lab index
          </a>
        </div>
      </div>
      {children}
    </div>
  );
}
