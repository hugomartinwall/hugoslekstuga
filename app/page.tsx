import ToolsSection from "@/components/ToolsSection";

export default function Home() {
  return (
    <div className="mx-auto w-full max-w-5xl px-5 sm:px-8">
      {/* Hero — quietly sets the stage so the Map below can take over. */}
      <section className="py-14 sm:py-20 lg:py-20">
        <div className="flex max-w-3xl flex-col gap-5">
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
      </section>

      <ToolsSection />
    </div>
  );
}
