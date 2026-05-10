import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About",
  description:
    "hugoslekstuga is Hugo's playhouse — a place where things he made for fun end up.",
};

const NOT_HERE = [
  "newsletters",
  "venture capital",
  "a “subscribe to our blog” popup",
  "an algorithm that learns about you",
  "your data, anywhere it shouldn’t be",
  "the love of your life",
];

export default function AboutPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-14 sm:px-8 sm:py-20">
      {/* Hero */}
      <header>
        <h1 className="font-display text-5xl font-extrabold leading-[0.95] tracking-tight sm:text-6xl lg:text-7xl">
          Made for <span className="text-tomato">fun</span>.
        </h1>
      </header>

      {/* Hugo, in passing */}
      <section className="mt-10 max-w-xl">
        <p className="text-base leading-relaxed text-ink-soft sm:text-lg">
          Hugo, by the way. A designer working out of Stockholm. Spends the
          off-hours on fonts, colours, and weekend experiments that
          occasionally turn into something worth shipping.
        </p>
      </section>

      {/* Things you won't find here */}
      <section className="mt-12 rounded-[var(--radius-card)] border-2 border-dashed border-ink bg-cream-deep p-6 sm:p-8">
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
    </div>
  );
}
