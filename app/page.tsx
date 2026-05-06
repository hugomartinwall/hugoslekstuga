import ToolCard from "@/components/ToolCard";
import { tools } from "@/lib/tools";

export default function Home() {
  return (
    <div className="mx-auto w-full max-w-5xl px-5 sm:px-8">
      {/* Hero */}
      <section className="grid grid-cols-1 items-end gap-8 py-14 sm:py-20 lg:grid-cols-[3fr_2fr] lg:gap-12 lg:py-28">
        <div className="flex flex-col gap-5">
          <span className="inline-flex w-fit items-center gap-2 rounded-full border-2 border-ink bg-yellow px-3 py-1 text-xs font-bold uppercase tracking-wide">
            <span className="h-2 w-2 rounded-full bg-ink" aria-hidden /> a small playhouse
          </span>
          <h1 className="font-display text-5xl font-extrabold leading-[0.95] tracking-tight text-ink sm:text-6xl lg:text-7xl">
            Small,
            <br />
            <span className="text-tomato">useful</span>{" "}
            <span className="text-blue">browser</span>{" "}
            <span className="text-pink">tools</span>.
          </h1>
          <p className="max-w-md text-lg leading-relaxed text-ink-soft sm:text-xl">
            Quick tools that do one thing well — no signup, no upload, no
            tracking. Just open a tab and use them.
          </p>
        </div>

        <div className="hidden lg:block">
          <div className="card-chunk flex aspect-square w-full max-w-sm flex-col justify-between rounded-[var(--radius-card)] bg-pink p-6">
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border-2 border-ink bg-cream px-3 py-1 text-sm font-bold">advice</span>
              <span className="rounded-full border-2 border-ink bg-cream px-3 py-1 text-sm font-bold">feelings</span>
              <span className="rounded-full border-2 border-ink bg-cream px-3 py-1 text-sm font-bold">files</span>
              <span className="rounded-full border-2 border-ink bg-cream px-3 py-1 text-sm font-bold">more soon</span>
            </div>
            <p className="font-display text-3xl font-bold leading-tight">
              Built with care,
              <br />
              in the open.
            </p>
          </div>
        </div>
      </section>

      {/* Tool grid */}
      <section id="tools" className="scroll-mt-24 pb-20">
        <div className="mb-8 flex items-end justify-between">
          <h2 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
            The tools
          </h2>
          <span className="text-sm font-medium text-ink-muted">
            {tools.length} so far
          </span>
        </div>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {tools.map((tool) => (
            <ToolCard key={tool.slug} tool={tool} />
          ))}
        </div>
      </section>
    </div>
  );
}
