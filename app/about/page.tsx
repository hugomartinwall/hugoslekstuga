import type { Metadata } from "next";
import Link from "next/link";
import { tools } from "@/lib/tools";
import { CLUSTER_ORDER, CLUSTERS, TOOL_CLUSTER, pathFor } from "@/lib/clusters";

export const metadata: Metadata = {
  title: "About",
  description:
    "hugoslekstuga is Hugo's playhouse — a place where potentially useful things end up.",
};

const HOUSE_RULES = [
  {
    title: "One thing, sharply",
    body:
      "Each tool tries to do exactly one thing. If it grows past that, it splits. The day Sum starts sending emails, you'll know I've given up.",
  },
  {
    title: "Quiet by default",
    body:
      "No analytics, no accounts, no third-party scripts, no cookie banner (because there's nothing to put in it). The one server keeps Munch's multiplayer alive — it keeps no logs.",
  },
  {
    title: "Open a tab, use it, close it",
    body:
      "No onboarding. No settings buried three menus deep. If a tool needs a tour to be useful, the tool is wrong.",
  },
];

const NOT_HERE = [
  "newsletters",
  "venture capital",
  "a chat bubble in the corner",
  "a “subscribe to our blog” popup",
  "an algorithm that learns about you",
  "your data, anywhere it shouldn’t be",
];

export default function AboutPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-14 sm:px-8 sm:py-20">
      {/* Hero */}
      <header className="flex flex-col gap-5">
        <span className="inline-flex w-fit items-center gap-2 rounded-full border-2 border-ink bg-yellow px-3 py-1 text-xs font-bold uppercase tracking-wide">
          <span className="pulse-dot h-2 w-2 rounded-full bg-ink" aria-hidden />{" "}
          about the playhouse
        </span>
        <h1 className="font-display text-5xl font-extrabold leading-[0.95] tracking-tight sm:text-6xl">
          A playhouse for{" "}
          <span className="text-tomato">potentially</span>{" "}
          <span className="text-blue">useful</span>{" "}
          things.
        </h1>
        <p className="text-lg leading-relaxed text-ink-soft sm:text-xl">
          <span className="font-display font-bold text-ink">hugoslekstuga</span>{" "}
          is Swedish for &ldquo;Hugo&rsquo;s playhouse.&rdquo; It&rsquo;s the
          space and the joke: a small corner of the internet where I release
          things I made for myself that turned out to maybe be useful for
          someone else too.
        </p>
        <p className="text-base leading-relaxed text-ink-soft sm:text-lg">
          Some of it is genuinely useful. Some of it is mostly an excuse to
          play with a font, a colour, or a strange idea I had on a Tuesday.
          Pick whichever.
        </p>
      </header>

      {/* Themes */}
      <section className="mt-14">
        <h2 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
          What&rsquo;s in here
        </h2>
        <p className="mt-2 text-base text-ink-soft sm:text-lg">
          The map on the homepage is the real index. This is the
          straight-faced version — themes, with the things in them.
        </p>
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {CLUSTER_ORDER.map((id) => {
            const c = CLUSTERS[id];
            const inCluster = tools.filter((t) => TOOL_CLUSTER[t.slug] === id);
            return (
              <div
                key={id}
                className="card-chunk flex flex-col gap-2 rounded-[var(--radius-card)] bg-cream p-5"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="h-3 w-3 rounded-full border-2 border-ink"
                    style={{ background: c.color }}
                    aria-hidden
                  />
                  <p className="font-display text-lg font-extrabold tracking-tight">
                    {c.label}
                  </p>
                  <span className="ml-auto text-xs text-ink-muted">
                    {inCluster.length}
                  </span>
                </div>
                <p className="text-sm text-ink-soft">{c.description}</p>
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {inCluster.map((t) => (
                    <li key={t.slug}>
                      <Link
                        href={pathFor(t.slug)}
                        className="rounded-full border-2 border-ink bg-cream-deep px-2 py-0.5 text-xs font-bold transition-colors hover:bg-cream"
                      >
                        {t.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </section>

      {/* House rules */}
      <section className="mt-14">
        <h2 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
          Three house rules
        </h2>
        <p className="mt-2 text-base text-ink-soft sm:text-lg">
          Less a manifesto, more a list of things I keep reminding myself.
        </p>
        <ol className="mt-6 flex flex-col gap-3">
          {HOUSE_RULES.map((p, i) => (
            <li
              key={p.title}
              className="card-chunk flex gap-4 rounded-[var(--radius-card)] bg-cream p-5"
            >
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-tomato font-display text-sm font-extrabold text-cream"
                aria-hidden
              >
                {i + 1}
              </span>
              <div className="flex flex-col gap-1">
                <p className="font-display text-lg font-extrabold tracking-tight">
                  {p.title}
                </p>
                <p className="text-sm leading-relaxed text-ink-soft">
                  {p.body}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* Things you won't find here */}
      <section className="mt-14 rounded-[var(--radius-card)] border-2 border-dashed border-ink bg-cream-deep p-6 sm:p-8">
        <h2 className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
          Things you won&rsquo;t find here
        </h2>
        <p className="mt-2 text-sm text-ink-soft">
          A non-exhaustive list, with a smile.
        </p>
        <ul className="mt-4 flex flex-wrap gap-2">
          {NOT_HERE.map((item) => (
            <li
              key={item}
              className="rounded-full border-2 border-ink bg-cream px-3 py-1 text-sm font-semibold text-ink-soft line-through decoration-ink/60"
            >
              {item}
            </li>
          ))}
        </ul>
      </section>

      {/* Closing */}
      <section className="mt-14 rounded-[var(--radius-card)] border-2 border-ink bg-cream-deep p-6 sm:p-8">
        <p className="font-display text-2xl font-extrabold leading-snug tracking-tight sm:text-3xl">
          Built and tended by Hugo,
          <br className="hidden sm:block" /> with a little help.
        </p>
        <p className="mt-3 text-sm text-ink-soft">
          Almost everything runs as a single static page bundle. The one
          exception is{" "}
          <Link href="/games/munch" className="font-bold underline">
            Munch
          </Link>
          , which connects to a small WebSocket server so other players can
          see your blob. No database, no telemetry, no third-party scripts.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            href="/"
            className="btn-chunk rounded-[var(--radius-button)] bg-tomato px-5 py-2 font-display text-sm font-extrabold text-cream"
          >
            Back to the dots
          </Link>
          <Link
            href="/promise"
            className="btn-chunk rounded-[var(--radius-button)] bg-cream px-5 py-2 font-display text-sm font-extrabold"
          >
            Read the promise →
          </Link>
        </div>
      </section>
    </div>
  );
}
