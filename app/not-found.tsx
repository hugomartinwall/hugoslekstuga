import type { Metadata } from "next";
import Link from "next/link";
import { tools } from "@/lib/tools";
import { CLUSTER_ORDER, CLUSTERS, pathFor } from "@/lib/clusters";
import { COLOR_HEX, preferredTextHex } from "@/lib/colors";

export const metadata: Metadata = {
  title: "Lost",
};

// A small selection of tools to suggest as starting points.
const SUGGESTED = ["advice", "feeling", "convert", "qr", "focus", "palette"];

export default function NotFound() {
  const suggested = SUGGESTED.map((slug) =>
    tools.find((t) => t.slug === slug),
  ).filter((t): t is NonNullable<typeof t> => Boolean(t));

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-14 sm:px-8 sm:py-20">
      <header className="flex flex-col gap-5">
        <span className="inline-flex w-fit items-center gap-2 rounded-full border-2 border-ink bg-tomato-soft px-3 py-1 text-xs font-bold uppercase tracking-wide">
          <span className="h-2 w-2 rounded-full bg-tomato" aria-hidden />
          404
        </span>
        <h1 className="font-display text-5xl font-extrabold leading-[0.95] tracking-tight sm:text-6xl lg:text-7xl">
          That page got{" "}
          <span className="text-tomato">lost</span>
          <br />
          in the playhouse.
        </h1>
        <p className="max-w-lg text-lg leading-relaxed text-ink-soft sm:text-xl">
          Either you followed a link to nothing, or a tool moved on without
          telling us. Try something else?
        </p>
      </header>

      <section className="mt-10 flex flex-wrap gap-3">
        <Link
          href="/"
          className="btn-chunk rounded-[var(--radius-button)] bg-tomato px-6 py-3 font-display text-base font-extrabold text-cream"
        >
          ← Back home
        </Link>
        <p className="flex items-center text-sm text-ink-muted">
          or press{" "}
          <kbd className="mx-1 rounded border border-ink-muted bg-cream-deep px-1.5 py-0.5 font-mono text-[11px] uppercase">
            ⌘K
          </kbd>{" "}
          anywhere on the site to search the {tools.length} tools
        </p>
      </section>

      <section className="mt-12">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Or try one of these
        </h2>
        <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {suggested.map((t) => {
            return (
              <li key={t.slug}>
                <Link
                  href={pathFor(t.slug)}
                  className="card-chunk flex items-center gap-3 rounded-[var(--radius-card)] bg-cream p-4 transition-colors hover:bg-cream-deep"
                >
                  <span
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-ink text-base"
                    style={{
                      background: COLOR_HEX[t.color],
                      color: preferredTextHex(t.color),
                    }}
                    aria-hidden
                  >
                    {t.emoji}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-base font-extrabold leading-tight tracking-tight">
                      {t.title}
                    </p>
                    <p className="truncate text-sm text-ink-soft">{t.tagline}</p>
                  </div>
                  <span className="text-xs font-semibold text-ink-muted">→</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="mt-12 rounded-[var(--radius-card)] border-2 border-dashed border-ink-muted bg-cream-deep p-5 text-sm text-ink-soft">
        <p>
          The {CLUSTER_ORDER.length} themes:{" "}
          {CLUSTER_ORDER.map((id, i) => {
            const c = CLUSTERS[id];
            return (
              <span key={id}>
                <span
                  className="mr-0.5 inline-block h-2 w-2 rounded-full align-middle"
                  style={{ background: c.color, border: "1px solid #1a1812" }}
                />{" "}
                <span className="font-semibold text-ink">{c.label}</span>
                {i < CLUSTER_ORDER.length - 1 ? " · " : "."}
              </span>
            );
          })}
        </p>
      </section>
    </div>
  );
}
