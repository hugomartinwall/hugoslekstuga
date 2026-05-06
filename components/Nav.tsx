import Link from "next/link";

export default function Nav() {
  return (
    <header className="border-b-2 border-ink bg-cream">
      <nav className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4 sm:px-8">
        <Link
          href="/"
          className="font-display text-xl font-extrabold tracking-tight sm:text-2xl"
        >
          hugoslekstuga<span className="text-tomato">.</span>
        </Link>
        <ul className="flex items-center gap-1 text-sm font-medium sm:gap-3 sm:text-base">
          <li>
            <Link
              href="/"
              className="rounded-full px-3 py-2 transition-colors hover:bg-cream-deep"
            >
              Home
            </Link>
          </li>
          <li>
            <Link
              href="/#tools"
              className="rounded-full px-3 py-2 transition-colors hover:bg-cream-deep"
            >
              Tools
            </Link>
          </li>
          <li>
            <Link
              href="/about"
              className="rounded-full px-3 py-2 transition-colors hover:bg-cream-deep"
            >
              About
            </Link>
          </li>
        </ul>
      </nav>
    </header>
  );
}
