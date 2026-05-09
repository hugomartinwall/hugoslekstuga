import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Promise",
  description:
    "What hugoslekstuga does and doesn't do with your data. The honest version.",
};

export default function PromisePage() {
  return (
    <article className="mx-auto w-full max-w-3xl px-5 py-14 sm:px-8 sm:py-20">
      <header className="flex flex-col gap-4">
        <span className="inline-flex w-fit items-center gap-2 rounded-full border-2 border-ink bg-yellow px-3 py-1 text-xs font-bold uppercase tracking-wide">
          The promise
        </span>
        <h1 className="font-display text-5xl font-extrabold leading-[0.95] tracking-tight sm:text-6xl">
          What we do, and don&rsquo;t,
          <br className="hidden sm:block" /> with your data.
        </h1>
        <p className="max-w-xl text-lg leading-relaxed text-ink-soft sm:text-xl">
          Most of the &ldquo;your privacy matters to us&rdquo; pages on the
          internet are wallpaper. This one tries to be a useful read.
        </p>
      </header>

      <Section title="The 43 tools">
        <p>
          Files, text, images, code — everything you drop into the toolbox is
          read, processed, and rendered by JavaScript running on this device.
          Nothing gets uploaded. The downloads come from your own browser.
        </p>
        <p>
          Tools persist in-progress work to <code>localStorage</code> when it
          makes sense — a session in Sum, a tally count, your wind-down
          minutes in Sleep. Storage keys are namespaced{" "}
          <code>hugoslekstuga:*</code> and stay on this device. Clearing your
          site data wipes them.
        </p>
      </Section>

      <Section title="Munch">
        <p>
          Munch is the one tool that needs a server. It&rsquo;s a real-time
          multiplayer game; for other players to see your blob, your name and
          your moves have to be sent somewhere. That somewhere is a small
          Node process intended for a Stockholm region.
        </p>
        <p>
          The server keeps no logs, no database, no third-party connections.
          When the last player disconnects, it idles. We don&rsquo;t track
          who plays. The room is shared globally; the only persistent state
          is what&rsquo;s currently on screen.
        </p>
      </Section>

      <Section title="Fonts and assets">
        <p>
          Geist and Bricolage Grotesque are downloaded from Google Fonts at{" "}
          <em>build time</em> and bundled with the site. After your page
          loads, no requests go to Google. The pdf.js worker that powers the
          PDF tool is vendored at <code>/vendor/pdf.worker.min.mjs</code> for
          the same reason.
        </p>
      </Section>

      <Section title="What we&rsquo;d need to add to break this">
        <p>
          Analytics. Ad networks. Live currency rates. A cloud sync. A login.
          None of those are here, and none of them are coming. If a feature
          can&rsquo;t be built without one of them, we don&rsquo;t ship the
          feature.
        </p>
      </Section>

      <div className="mt-12 flex flex-wrap gap-3">
        <Link
          href="/"
          className="btn-chunk rounded-[var(--radius-button)] bg-tomato px-5 py-2 font-display text-sm font-extrabold text-cream"
        >
          Back to the tools
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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-12 flex flex-col gap-3">
      <h2 className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
        {title}
      </h2>
      <div className="flex flex-col gap-3 text-base leading-relaxed text-ink-soft sm:text-lg">
        {children}
      </div>
    </section>
  );
}
