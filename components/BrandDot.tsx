"use client";

import { useState } from "react";
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
 * The colored period that punctuates the wordmark.
 *
 * Two flavours:
 *   - `interactive` — used in the top nav. Click cycles to the next
 *     colour and bounces. Idle "breathing" animation hints that it's
 *     a button, not a typeface period.
 *   - non-interactive — used in the footer. Reads the same localStorage
 *     key so footer + nav stay in sync; if you click the nav dot pink,
 *     the footer dot turns pink on the next render.
 *
 * Both share `hugoslekstuga:dot-color` storage. Rendered as the literal
 * "." glyph so the wordmark's typographic rhythm stays intact — the
 * colour is the only thing changing.
 */
export default function BrandDot({
  interactive = false,
}: {
  interactive?: boolean;
}) {
  const [dotIdx, setDotIdx] = useLocalStorageState<number>(DOT_KEY, 0);
  const [bouncing, setBouncing] = useState(false);

  const safeIdx =
    Number.isFinite(dotIdx) && dotIdx >= 0 && dotIdx < DOT_COLORS.length
      ? dotIdx
      : 0;
  const color = DOT_COLORS[safeIdx];

  if (!interactive) {
    return <span style={{ color }}>.</span>;
  }

  const cycle = () => {
    setDotIdx((i) => (i + 1) % DOT_COLORS.length);
    setBouncing(true);
    window.setTimeout(() => setBouncing(false), 280);
  };

  // Idle "breathing" hint: a slow, gentle scale pulse so the dot reads
  // as interactive. Disabled while bouncing so the cycle animation
  // isn't fighting the breathe transform on the same element.
  return (
    <button
      type="button"
      onClick={cycle}
      aria-label="Change accent colour"
      className="cursor-pointer rounded transition-transform hover:scale-110"
      style={{
        color,
        transform: bouncing ? "scale(1.4)" : undefined,
        transition: bouncing
          ? "transform 280ms cubic-bezier(0.34, 1.56, 0.64, 1), color 220ms ease"
          : "transform 180ms ease, color 220ms ease",
      }}
    >
      <span
        style={{
          display: "inline-block",
          animation: bouncing
            ? "none"
            : "brand-dot-breathe 3.4s ease-in-out infinite",
        }}
      >
        .
      </span>
    </button>
  );
}
