"use client";

import Link from "next/link";
import { useState } from "react";
import { MobileSearchButton, SearchButton } from "@/components/Search";
import { useLocalStorageState } from "@/lib/use-local-storage-state";

const DOT_COLORS = [
  "var(--color-tomato)",
  "var(--color-blue)",
  "var(--color-yellow)",
  "var(--color-pink)",
  "var(--color-green)",
  "var(--color-purple)",
  "var(--color-orange)",
  "var(--color-teal)",
];

const DOT_KEY = "hugoslekstuga:dot-color";

export default function Nav() {
  const [dotIdx, setDotIdx] = useLocalStorageState<number>(DOT_KEY, 0);
  // Defensive clamp in case the stored value is out of range or stale.
  const safeDotIdx =
    Number.isFinite(dotIdx) && dotIdx >= 0 && dotIdx < DOT_COLORS.length
      ? dotIdx
      : 0;
  const [bouncing, setBouncing] = useState(false);

  const cycleDot = () => {
    setDotIdx((i) => (i + 1) % DOT_COLORS.length);
    setBouncing(true);
    window.setTimeout(() => setBouncing(false), 280);
  };

  return (
    <header className="border-b-2 border-ink bg-cream">
      <nav className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-5 py-4 sm:px-8">
        <div className="flex items-baseline font-display text-xl font-extrabold tracking-tight sm:text-2xl">
          <Link
            href="/"
            className="rounded-md transition-opacity hover:opacity-80"
          >
            hugoslekstuga
          </Link>
          <button
            type="button"
            onClick={cycleDot}
            aria-label="Change accent colour"
            className="cursor-pointer rounded transition-transform hover:scale-110"
            style={{
              color: DOT_COLORS[safeDotIdx],
              transform: bouncing ? "scale(1.4)" : undefined,
              transition: bouncing
                ? "transform 280ms cubic-bezier(0.34, 1.56, 0.64, 1), color 220ms ease"
                : "transform 180ms ease, color 220ms ease",
            }}
          >
            .
          </button>
        </div>
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
