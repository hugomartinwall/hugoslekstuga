import Link from "next/link";
import type { ReactNode } from "react";
import type { Tool } from "@/lib/tools";

const colorBg: Record<Tool["color"], string> = {
  tomato: "bg-tomato-soft",
  blue: "bg-blue-soft",
  yellow: "bg-yellow-soft",
  pink: "bg-pink-soft",
  green: "bg-green-soft",
  purple: "bg-purple-soft",
  orange: "bg-orange-soft",
  teal: "bg-teal-soft",
};

const colorAccent: Record<Tool["color"], string> = {
  tomato: "bg-tomato",
  blue: "bg-blue",
  yellow: "bg-yellow",
  pink: "bg-pink",
  green: "bg-green",
  purple: "bg-purple",
  orange: "bg-orange",
  teal: "bg-teal",
};

export default function ToolFrame({
  tool,
  children,
}: {
  tool: Tool;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
      <Link
        href="/"
        className="mb-8 inline-flex items-center gap-2 text-sm font-semibold text-ink-soft transition-colors hover:text-ink"
      >
        ← Back to all tools
      </Link>

      <header
        className={`card-chunk mb-10 flex flex-col gap-4 rounded-[var(--radius-card)] ${colorBg[tool.color]} p-6 sm:p-8`}
      >
        <div className="flex items-center gap-4">
          <div
            className={`flex h-14 w-14 items-center justify-center rounded-full border-2 border-ink ${colorAccent[tool.color]} text-2xl`}
            aria-hidden
          >
            {tool.emoji}
          </div>
          <div className="flex flex-col">
            <h1 className="font-display text-3xl font-extrabold leading-tight tracking-tight text-ink sm:text-4xl">
              {tool.title}
            </h1>
            <p className="text-base font-medium text-ink-soft">
              {tool.tagline}
            </p>
          </div>
        </div>
      </header>

      <main>{children}</main>
    </div>
  );
}
