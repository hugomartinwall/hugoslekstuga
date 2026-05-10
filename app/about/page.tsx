import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About",
  description:
    "hugoslekstuga is Hugo's playhouse — a place where things he made for fun end up.",
};

const NOT_HERE = [
  "newsletters",
  "venture capital",
  "a five-year plan",
  "a “subscribe to our blog” popup",
  "an algorithm that learns about you",
  "your data, anywhere it shouldn’t be",
  "homework",
  "the love of your life",
];

export default function AboutPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-14 sm:px-8 sm:py-20">
      {/* Hero — punchy title + the long sentence as a subhead */}
      <header className="flex flex-col gap-4">
        <h1 className="font-display text-5xl font-extrabold leading-[0.95] tracking-tight sm:text-6xl lg:text-7xl">
          Made for <span className="text-tomato">fun</span>.
        </h1>
        <p className="max-w-xl text-base leading-relaxed text-ink-soft sm:text-lg">
          Hugo spends the off-hours on experiments that occasionally turn into
          something worth{" "}
          <span className="font-semibold text-ink">sharing</span>.
        </p>
      </header>

      {/* Things you won't find here */}
      <section className="mt-14 rounded-[var(--radius-card)] border-2 border-dashed border-ink bg-cream-deep p-6 sm:p-8">
        <h2 className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
          Things you won&rsquo;t find here
        </h2>
        <ul className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {NOT_HERE.map((item) => (
            <li
              key={item}
              className="rounded-full border-2 border-ink bg-cream px-3 py-1 text-center text-sm font-semibold text-ink-soft line-through decoration-ink/60"
            >
              {item}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
