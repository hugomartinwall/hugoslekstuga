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
      <header className="flex flex-col gap-5">
        <h1 className="font-display text-3xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl">
          You&rsquo;ve found the small corner of the internet where I release
          things I made for{" "}
          <span className="text-tomato">fun</span>.
        </h1>
      </header>

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
