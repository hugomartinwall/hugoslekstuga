"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MobileSearchButton, SearchButton } from "@/components/Search";

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
  const [dotIdx, setDotIdx] = useState(0);
  const [bouncing, setBouncing] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(DOT_KEY);
      const n = saved ? Number(saved) : NaN;
      if (Number.isFinite(n) && n >= 0 && n < DOT_COLORS.length) {
        setDotIdx(n);
      }
    } catch {}
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(DOT_KEY, String(dotIdx));
    } catch {}
  }, [dotIdx, hydrated]);

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
              color: DOT_COLORS[dotIdx],
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
