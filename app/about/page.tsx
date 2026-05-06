import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About",
  description:
    "About hugoslekstuga — a small playhouse of useful, friendly browser tools.",
};

export default function AboutPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-14 sm:px-8 sm:py-20">
      <h1 className="font-display text-4xl font-extrabold tracking-tight sm:text-5xl">
        About <span className="text-tomato">hugoslekstuga</span>
      </h1>

      <div className="mt-10 flex flex-col gap-5 text-lg leading-relaxed text-ink-soft sm:text-xl">
        <p>
          <span className="font-display font-bold text-ink">hugoslekstuga</span>{" "}
          (Swedish for &ldquo;Hugo&rsquo;s playhouse&rdquo;) is a small home for
          useful browser tools.
        </p>
        <p>
          Each tool tries to do one thing well. No accounts. No uploads. No
          tracking. Open a tab, use the thing, close the tab.
        </p>
        <p>
          Everything you do here happens in your browser — files never leave
          your device.
        </p>
        <p>
          Built and tended by Hugo, with a little help.
        </p>
      </div>
    </div>
  );
}
