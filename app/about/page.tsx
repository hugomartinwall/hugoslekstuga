import type { Metadata } from "next";
import Link from "next/link";
import { tools } from "@/lib/tools";
import { CLUSTER_ORDER, CLUSTERS, TOOL_CLUSTER, pathFor } from "@/lib/clusters";

export const metadata: Metadata = {
  title: "About",
  description:
    "About hugoslekstuga — a small playhouse of useful, friendly browser tools.",
};

const PRINCIPLES = [
  {
    title: "One thing, well",
    body: "Each tool tries to do one specific thing. If it grows, it becomes two tools.",
  },
  {
    title: "Your device, your data",
    body: "Everything runs in your browser. Nothing is uploaded; no account is required; no analytics watch you.",
  },
  {
    title: "Open a tab, use it, close it",
    body: "No onboarding, no settings. Land on a tool, do the thing, get back to your day.",
  },
  {
    title: "A bit of personality",
    body: "Bold colours, chunky shadows, a small wink here and there. Useful doesn't mean dry.",
  },
];

export default function AboutPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-14 sm:px-8 sm:py-20">
      {/* Hero */}
      <header className="flex flex-col gap-5">
        <span className="inline-flex w-fit items-center gap-2 rounded-full border-2 border-ink bg-yellow px-3 py-1 text-xs font-bold uppercase tracking-wide">
          <span className="pulse-dot h-2 w-2 rounded-full bg-ink" aria-hidden /> about the playhouse
        </span>
        <h1 className="font-display text-5xl font-extrabold leading-[0.95] tracking-tight sm:text-6xl">
          About <span className="text-tomato">hugoslekstuga</span>
        </h1>
        <p className="text-lg leading-relaxed text-ink-soft sm:text-xl">
          <span className="font-display font-bold text-ink">hugoslekstuga</span>{" "}
          (Swedish for &ldquo;Hugo&rsquo;s playhouse&rdquo;) is a small home
          for useful browser tools. Each one tries to do a single thing well,
          without asking anything of you.
        </p>
      </header>

      {/* Stats */}
      <section className="mt-12 grid grid-cols-3 gap-3 sm:gap-4">
        <Stat value={String(tools.length)} label="tools" accent="bg-yellow" />
        <Stat
          value={String(CLUSTER_ORDER.length)}
          label="themes"
          accent="bg-pink"
        />
        <Stat value="1" label="server (munch)" accent="bg-blue" />
      </section>

      {/* Themes */}
      <section className="mt-14">
        <h2 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
          What&rsquo;s in here
        </h2>
        <p className="mt-2 text-base text-ink-soft sm:text-lg">
          {tools.length} tools, grouped by what they help with. Hover any
          theme on the homepage Map to see its cluster light up.
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
                    {inCluster.length} tools
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

      {/* Principles */}
      <section className="mt-14">
        <h2 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
          Four principles
        </h2>
        <ol className="mt-6 flex flex-col gap-3">
          {PRINCIPLES.map((p, i) => (
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
          , which connects to a tiny WebSocket server so other players can see
          your blob. No database, no telemetry, no third-party scripts. Source
          code lives on a single laptop until it doesn&rsquo;t.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            href="/"
            className="btn-chunk rounded-[var(--radius-button)] bg-tomato px-5 py-2 font-display text-sm font-extrabold text-cream"
          >
            Back to the tools
          </Link>
        </div>
      </section>
    </div>
  );
}

function Stat({
  value,
  label,
  accent,
}: {
  value: string;
  label: string;
  accent: string;
}) {
  return (
    <div className={`card-chunk flex flex-col items-start gap-1 rounded-[var(--radius-card)] ${accent} p-4 sm:p-5`}>
      <p className="font-display text-4xl font-extrabold leading-none tabular-nums sm:text-5xl">
        {value}
      </p>
      <p className="text-xs font-semibold uppercase tracking-wide">{label}</p>
    </div>
  );
}
