"use client";

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

/**
 * A small, static dot the same colour as the user's nav BrandDot
 * choice. Lives quietly at the corner of each tool's header card and
 * in the back link so the brand is present across the tool surface
 * without competing with the tool itself.
 *
 * Reads the same `hugoslekstuga:dot-color` key the interactive
 * BrandDot writes; subscribed via useLocalStorageState so cycling the
 * nav dot updates the tool-page dots live without a reload.
 */
export default function ToolHeaderDot({ size = 12 }: { size?: number }) {
  const [idx] = useLocalStorageState<number>(DOT_KEY, 0);
  const safe =
    Number.isFinite(idx) && idx >= 0 && idx < DOT_COLORS.length ? idx : 0;
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 rounded-full transition-colors duration-200"
      style={{
        background: DOT_COLORS[safe],
        width: size,
        height: size,
      }}
    />
  );
}
