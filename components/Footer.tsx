import Link from "next/link";

export default function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="mt-24 border-t-2 border-ink bg-cream-deep">
      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-5 py-10 sm:px-8 sm:py-12">
        <div className="flex flex-col gap-2">
          <p className="font-display text-2xl font-extrabold tracking-tight">
            hugoslekstuga<span className="text-tomato">.</span>
          </p>
          <p className="text-sm leading-relaxed text-ink-soft">
            Swedish for hugos playground
          </p>
          <p className="mt-1 text-sm">
            <Link
              href="/promise"
              className="font-bold text-ink underline-offset-4 hover:underline"
            >
              Read the full promise →
            </Link>
          </p>
        </div>

        <div className="flex flex-col-reverse items-start justify-between gap-3 border-t border-ink/15 pt-5 text-xs text-ink-muted sm:flex-row sm:items-center">
          <p>© {year}</p>
          <p>potentially useful · all running locally in your browser</p>
        </div>
      </div>
    </footer>
  );
}
