import Link from "next/link";
import { MobileSearchButton, SearchButton } from "@/components/Search";

export default function Nav() {
  return (
    <header className="border-b-2 border-ink bg-cream">
      <nav className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-5 py-4 sm:px-8">
        <Link
          href="/"
          className="font-display text-xl font-extrabold tracking-tight sm:text-2xl"
        >
          hugoslekstuga<span className="text-tomato">.</span>
        </Link>
        <div className="flex items-center gap-2 sm:gap-3">
          <SearchButton />
          <MobileSearchButton />
          <ul className="flex items-center gap-1 text-sm font-medium sm:gap-2 sm:text-base">
            <li>
              <Link
                href="/"
                className="rounded-full px-2 py-1.5 transition-colors hover:bg-cream-deep sm:px-3 sm:py-2"
              >
                Home
              </Link>
            </li>
            <li>
              <Link
                href="/#tools"
                className="rounded-full px-2 py-1.5 transition-colors hover:bg-cream-deep sm:px-3 sm:py-2"
              >
                Tools
              </Link>
            </li>
            <li>
              <Link
                href="/about"
                className="rounded-full px-2 py-1.5 transition-colors hover:bg-cream-deep sm:px-3 sm:py-2"
              >
                About
              </Link>
            </li>
          </ul>
        </div>
      </nav>
    </header>
  );
}
