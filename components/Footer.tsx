import Link from "next/link";
import { tools } from "@/lib/tools";

export default function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="mt-24 border-t-2 border-ink bg-cream-deep">
      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-5 py-10 sm:px-8 sm:py-12">
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-3">
          <div className="flex flex-col gap-2">
            <p className="font-display text-2xl font-extrabold tracking-tight">
              hugoslekstuga<span className="text-tomato">.</span>
            </p>
            <p className="max-w-xs text-sm leading-relaxed text-ink-soft">
              A small playhouse of useful browser tools. Open a tab, use the
              thing, close the tab.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Made
            </p>
            <p className="text-sm text-ink-soft">by Hugo, with care</p>
            <p className="text-sm text-ink-soft">in Sweden, in the open</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              No
            </p>
            <p className="text-sm text-ink-soft">tracking · no accounts</p>
            <p className="text-sm text-ink-soft">uploads · no analytics</p>
            <p className="mt-1 text-sm">
              <Link
                href="/promise"
                className="font-bold text-ink underline-offset-4 hover:underline"
              >
                Read the full promise →
              </Link>
            </p>
          </div>
        </div>

        <div className="flex flex-col-reverse items-start justify-between gap-3 border-t border-ink/15 pt-5 text-xs text-ink-muted sm:flex-row sm:items-center">
          <p>© {year}</p>
          <p>
            <span className="font-bold text-ink">{tools.length}</span> tools
            and counting · all running locally in your browser
          </p>
        </div>
      </div>
    </footer>
  );
}
