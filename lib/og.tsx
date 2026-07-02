import { ImageResponse } from "next/og";
import { findTool } from "@/lib/tools";
import { COLOR_HEX, COLOR_HEX_SOFT } from "@/lib/colors";

/**
 * Shared OG-image renderer for per-tool share previews.
 *
 * Each per-route `app/{tools,games}/<slug>/opengraph-image.tsx` is a
 * thin wrapper that calls `renderToolOG("<slug>")`. Visual lives here
 * so a future tweak touches one file, not 18.
 *
 * Visual matches the homepage tool tile (ToolCard): the tool's
 * accent-soft as the background, the solid accent as a big ball
 * with the chunky ink border and offset shadow, ink for title
 * + tagline, the small "hugoslekstuga" wordmark + a coloured dot in
 * the bottom-right corner — same shape as the root OG.
 *
 * The ball contains the tool's first letter, not its emoji. Most of
 * the registry's emojis are obscure geometric Unicode (⊚, ⌷, ⇄, …)
 * and the @vercel/og render context only ships a basic system font,
 * so emojis fall back to tofu. The initial letter renders reliably
 * in any font and is still distinct per-tool.
 *
 * Font: system-ui at weight 900. Bricolage Grotesque is the live
 * site's display face but ImageResponse runs in an isolated render
 * context with no @font-face — embedding the TTF is doable but
 * doubles the surface for marginal benefit at 1200×630 scale.
 * Revisit if Hugo wants the perfect type match.
 */

export const OG_SIZE = { width: 1200, height: 630 } as const;

const INK = "#e8f2e9";
const CREAM = "#0b0c14";
const SHADOW = "#05060c";

export function renderToolOG(slug: string): ImageResponse {
  const tool = findTool(slug);
  // Should never hit at runtime — per-route wrappers hard-code their
  // own slug — but keep the function total so a typo doesn't crash
  // the Vercel build.
  if (!tool) {
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            background: CREAM,
            color: INK,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 64,
            fontWeight: 900,
            fontFamily: "system-ui, -apple-system, sans-serif",
          }}
        >
          hugoslekstuga
        </div>
      ),
      { ...OG_SIZE },
    );
  }

  const accent = COLOR_HEX[tool.color];
  const accentSoft = COLOR_HEX_SOFT[tool.color];
  const initial = tool.title.charAt(0).toUpperCase();

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: accentSoft,
          color: INK,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "60px 80px",
          fontFamily: "system-ui, -apple-system, sans-serif",
          position: "relative",
        }}
      >
        {/* Ball — solid accent, chunky ink border + offset shadow, with
            the tool's first letter at large size. The site's per-tool
            emoji can't reliably render in @vercel/og's font stack, so
            the initial letter stands in. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 220,
            height: 220,
            borderRadius: 9999,
            background: accent,
            border: `6px solid ${INK}`,
            boxShadow: `0 10px 0 0 ${SHADOW}`,
            fontSize: 150,
            fontWeight: 900,
            color: CREAM,
            lineHeight: 1,
            marginBottom: 52,
          }}
        >
          {initial}
        </div>

        {/* Title */}
        <div
          style={{
            fontSize: 104,
            fontWeight: 900,
            lineHeight: 1,
            letterSpacing: "-0.03em",
            textAlign: "center",
            marginBottom: 20,
          }}
        >
          {tool.title}
        </div>

        {/* Tagline */}
        <div
          style={{
            fontSize: 38,
            fontWeight: 500,
            lineHeight: 1.25,
            textAlign: "center",
            maxWidth: 900,
            color: INK,
            opacity: 0.78,
          }}
        >
          {tool.tagline}
        </div>

        {/* Bottom-right corner — wordmark + brand dot in accent. */}
        <div
          style={{
            position: "absolute",
            bottom: 36,
            right: 48,
            display: "flex",
            alignItems: "flex-end",
            fontSize: 32,
            fontWeight: 800,
            letterSpacing: "-0.02em",
            lineHeight: 1,
            color: INK,
          }}
        >
          hugoslekstuga
          <div
            style={{
              width: 22,
              height: 22,
              borderRadius: 9999,
              background: accent,
              marginLeft: 6,
              marginBottom: 4,
            }}
          />
        </div>
      </div>
    ),
    { ...OG_SIZE },
  );
}
