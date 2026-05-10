"use client";

import Link from "next/link";

/**
 * Noodle — placeholder lobby.
 *
 * The protocol, server, and client renderer are coming. For now the
 * page exists at /games/noodle so links resolve and the page can be
 * polished in parallel with the server work.
 *
 * When the full client lands, this file will house the lobby +
 * playing state machine the same way munch does.
 */
export default function NoodleClient() {
  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-14 sm:px-8 sm:py-20">
      <header className="flex flex-col gap-5">
        <span className="inline-flex w-fit items-center gap-2 rounded-full border-2 border-ink bg-yellow px-3 py-1 text-xs font-bold uppercase tracking-wide">
          <span className="pulse-dot h-2 w-2 rounded-full bg-ink" aria-hidden />
          in the oven
        </span>
        <h1 className="font-display text-5xl font-extrabold leading-[0.95] tracking-tight sm:text-6xl lg:text-7xl">
          Noodle is{" "}
          <span className="text-tomato">cooking</span>.
        </h1>
        <p className="max-w-xl text-base leading-relaxed text-ink-soft sm:text-lg">
          A multiplayer snake. Eat dots, grow long, don&rsquo;t bump into other
          snakes. Built on the same shell as Munch — should land soon.
        </p>
      </header>

      <section className="mt-12 rounded-[var(--radius-card)] border-2 border-dashed border-ink bg-cream-deep p-6 sm:p-8">
        <h2 className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
          What&rsquo;s in v1
        </h2>
        <ul className="mt-4 grid grid-cols-1 gap-2 text-base sm:grid-cols-2">
          {[
            "continuous forward motion",
            "mouse / touch aim",
            "eat to grow",
            "head-on-body death",
            "boost — costs length",
            "death drops body as food",
            "mushroom-named bots",
            "leaderboard",
          ].map((item) => (
            <li key={item} className="flex items-baseline gap-3 text-ink-soft">
              <span
                aria-hidden
                className="font-display text-lg font-extrabold text-green"
              >
                ·
              </span>
              {item}
            </li>
          ))}
        </ul>
      </section>

      <div className="mt-12 flex flex-wrap gap-3">
        <Link
          href="/"
          className="btn-chunk rounded-[var(--radius-button)] bg-tomato px-5 py-2 font-display text-sm font-extrabold text-cream"
        >
          Back to the map
        </Link>
        <Link
          href="/games/munch"
          className="btn-chunk rounded-[var(--radius-button)] bg-cream px-5 py-2 font-display text-sm font-extrabold text-ink"
        >
          Play Munch instead
        </Link>
      </div>
    </div>
  );
}
