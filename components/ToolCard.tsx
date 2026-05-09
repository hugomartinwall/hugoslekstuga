import Link from "next/link";
import type { Tool } from "@/lib/tools";
import { pathFor } from "@/lib/clusters";
import { bgClass, bgSoftClass } from "@/lib/colors";

export default function ToolCard({ tool }: { tool: Tool }) {
  return (
    <Link
      href={pathFor(tool.slug)}
      className={`card-chunk group flex flex-col gap-4 rounded-[var(--radius-card)] ${bgSoftClass(tool.color)} p-6 sm:p-7`}
    >
      <div className="flex items-start justify-between">
        <div
          className={`flex h-12 w-12 items-center justify-center rounded-full border-2 border-ink ${bgClass(tool.color)} text-2xl text-ink`}
          aria-hidden
        >
          {tool.emoji}
        </div>
        <span
          className="text-sm font-semibold uppercase tracking-wide text-ink-soft transition-transform group-hover:-translate-x-1"
          aria-hidden
        >
          open →
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="font-display text-2xl font-extrabold leading-tight tracking-tight text-ink sm:text-3xl">
          {tool.title}
        </h3>
        <p className="text-base font-medium text-ink-soft">{tool.tagline}</p>
      </div>

      <p className="text-sm leading-relaxed text-ink-soft">
        {tool.description}
      </p>
    </Link>
  );
}
