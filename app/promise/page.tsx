import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Promise",
  description:
    "How hugoslekstuga handles your data. The honest version — in five-second-readable form.",
};

const RULE_BULLETS = [
  "static site bundle, no backend",
  "saved state lives in your browser’s localStorage",
  "no network calls after the page loads",
  "files dropped into a tool never leave the browser",
];

const MUNCH_BULLETS = [
  "only on /games/munch — nowhere else",
  "server keeps no logs and no database",
  "no third-party connections",
  "sleeps when the room is empty",
];

const NOT_HERE = [
  "analytics",
  "tracking pixels",
  "third-party scripts",
  "ad networks",
  "account systems",
  "cloud sync",
  "a cookie banner",
  "newsletter signup forms",
];

export default function PromisePage() {
  return (
    <article className="mx-auto w-full max-w-4xl px-5 py-14 sm:px-8 sm:py-20">
      {/* Hero */}
      <header>
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          The promise
        </p>
        <h1 className="mt-3 font-display text-5xl font-extrabold leading-[0.95] tracking-tight sm:text-6xl lg:text-7xl">
          What goes <span className="text-tomato">where</span>.
        </h1>
        <p className="mt-4 max-w-xl text-base leading-relaxed text-ink-soft sm:text-lg">
          Most &ldquo;your privacy matters&rdquo; pages are wallpaper. This
          one names the parts.
        </p>
      </header>

      {/* Two-pane: rule + exception */}
      <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-[2fr_1fr]">
        {/* Rule */}
        <section className="card-chunk rounded-[var(--radius-card)] bg-cream p-6 sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Your device
          </p>
          <h2 className="mt-2 font-display text-2xl font-extrabold leading-tight tracking-tight sm:text-3xl">
            Stays in your browser.
          </h2>
          <p className="mt-3 text-base leading-relaxed text-ink-soft">
            Anything you drop into a tool — files, text, settings — is read and
            processed by JavaScript running on your device. Downloads come from
            your own browser. Nothing is uploaded.
          </p>
          <ul className="mt-5 flex flex-col gap-2 text-sm text-ink-soft">
            {RULE_BULLETS.map((b) => (
              <li key={b} className="flex items-start gap-3">
                <span
                  aria-hidden
                  className="mt-2 h-2 w-2 shrink-0 rounded-full border-2 border-ink bg-green"
                />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* Exception */}
        <section className="card-chunk rounded-[var(--radius-card)] bg-cream-deep p-6 sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Except munch
          </p>
          <h2 className="mt-2 font-display text-2xl font-extrabold leading-tight tracking-tight sm:text-3xl">
            One small server.
          </h2>
          <p className="mt-3 text-base leading-relaxed text-ink-soft">
            Munch is a real-time multiplayer game. For other players to see
            your blob, your name and position have to go somewhere — a small
            Node process in Stockholm. It does as little as it can get away
            with.
          </p>
          <ul className="mt-5 flex flex-col gap-2 text-sm text-ink-soft">
            {MUNCH_BULLETS.map((b) => (
              <li key={b} className="flex items-start gap-3">
                <span
                  aria-hidden
                  className="mt-2 h-2 w-2 shrink-0 rounded-full border-2 border-ink bg-yellow"
                />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* Things you'll never see here — × prefix list */}
      <section className="mt-10 rounded-[var(--radius-card)] border-2 border-dashed border-ink bg-cream-deep p-6 sm:p-8">
        <h2 className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
          Things you&rsquo;ll never see here.
        </h2>
        <p className="mt-2 text-sm text-ink-soft">
          The audit version of the list on{" "}
          <Link href="/about" className="font-bold text-ink underline-offset-4 hover:underline">
            about
          </Link>
          .
        </p>
        <ul className="mt-5 grid grid-cols-1 gap-x-6 gap-y-2.5 text-base sm:grid-cols-2">
          {NOT_HERE.map((item) => (
            <li key={item} className="flex items-baseline gap-3">
              <span
                aria-hidden
                className="font-display text-xl font-extrabold leading-none text-tomato"
              >
                ×
              </span>
              <span className="text-ink-soft">{item}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Closing nav */}
      <div className="mt-12 flex flex-wrap gap-3">
        <Link
          href="/"
          className="btn-chunk rounded-[var(--radius-button)] bg-tomato px-5 py-2 font-display text-sm font-extrabold text-cream"
        >
          Back to the dots
        </Link>
        <Link
          href="/about"
          className="btn-chunk rounded-[var(--radius-button)] bg-cream px-5 py-2 font-display text-sm font-extrabold text-ink"
        >
          About
        </Link>
      </div>
    </article>
  );
}
