import Link from "next/link";
import type { ReactNode } from "react";
import type { Tool } from "@/lib/tools";
import { bgClass, bgSoftClass } from "@/lib/colors";

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
        className="group mb-8 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-soft transition-colors hover:text-ink"
      >
        <span
          aria-hidden
          className="inline-block transition-transform duration-200 group-hover:-translate-x-1"
        >
          ←
        </span>
        Back to all tools
      </Link>

      <header
        className={`card-chunk mb-10 flex flex-col gap-4 rounded-[var(--radius-card)] ${bgSoftClass(tool.color)} p-6 sm:p-8`}
      >
        <div className="flex items-center gap-4">
          <div
            className={`flex h-14 w-14 items-center justify-center rounded-full border-2 border-ink ${bgClass(tool.color)} text-2xl`}
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
