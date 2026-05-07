import HeroFeatured from "@/components/HeroFeatured";
import ToolsSection from "@/components/ToolsSection";
import { tools } from "@/lib/tools";

export default function Home() {
  return (
    <div className="mx-auto w-full max-w-5xl px-5 sm:px-8">
      {/* Hero */}
      <section className="grid grid-cols-1 items-end gap-8 py-14 sm:py-20 lg:grid-cols-[3fr_2fr] lg:gap-12 lg:py-24">
        <div className="flex flex-col gap-5">
          <span className="inline-flex w-fit items-center gap-2 rounded-full border-2 border-ink bg-yellow px-3 py-1 text-xs font-bold uppercase tracking-wide">
            <span className="pulse-dot h-2 w-2 rounded-full bg-ink" aria-hidden /> a small playhouse
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

          <dl className="mt-3 flex flex-wrap items-baseline gap-x-6 gap-y-2 text-sm text-ink-muted">
            <div className="flex items-baseline gap-1.5">
              <dt className="sr-only">Tools</dt>
              <dd className="font-display text-2xl font-extrabold text-ink">
                {tools.length}
              </dd>
              <span>tools</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <dt className="sr-only">Themes</dt>
              <dd className="font-display text-2xl font-extrabold text-ink">5</dd>
              <span>themes</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <dt className="sr-only">Servers used</dt>
              <dd className="font-display text-2xl font-extrabold text-ink">0</dd>
              <span>servers</span>
            </div>
          </dl>
        </div>

        <HeroFeatured />
      </section>

      <ToolsSection />
    </div>
  );
}
