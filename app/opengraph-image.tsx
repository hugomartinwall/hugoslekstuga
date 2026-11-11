import { ImageResponse } from "next/og";
import {
  Hugo,
  OG_INK,
  OG_MUTED,
  OG_ROOM,
  PixelText,
  Wordmark,
  hugoSize,
  measurePixelText,
} from "@/lib/og";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "HUGOS LEKSTUGA — a small playhouse of browser tools";

/**
 * OG / share-card image — the homepage marquee, faithfully: HUGOS
 * LEKSTUGA as phosphor pixel blocks on the room dark, scanlines over
 * everything, Hugo signing off next to the tagline. The live wordmark
 * is sampled from Jersey 15 on a canvas; @vercel/og has no canvas, so
 * the hand-authored 5×7 pixel face in lib/og.tsx stands in — same
 * language, same room. Hugo is the canonical sprite, and the tagline is
 * set in the same face as the marquee: nothing here is typeset.
 *
 * Everything is placed by hand on whole pixels (see lib/og.tsx for why).
 */

const TAGLINE = "A SMALL PLAYHOUSE OF BROWSER TOOLS";

/** The marquee. */
const MARQUEE_CELL = 13;
/** The sign-off under it: Hugo, then the tagline as a tracked label. */
const HUGO_CELL = 5;
const TAGLINE_CELL = 4;
const TAGLINE_SPACING = { tracking: 2, space: 3 } as const;
const MARQUEE_GAP = 56;
const HUGO_GAP = 24;

export default async function OGImage() {
  const hugo = hugoSize(HUGO_CELL);
  const taglineWidth =
    measurePixelText(TAGLINE, TAGLINE_SPACING).width * TAGLINE_CELL;
  const marqueeHeight = 7 * MARQUEE_CELL;
  const top = Math.round(
    (size.height - marqueeHeight - MARQUEE_GAP - hugo.height) / 2,
  );
  const signOffY = top + marqueeHeight + MARQUEE_GAP;
  const signOffX = Math.round(
    (size.width - hugo.width - HUGO_GAP - taglineWidth) / 2,
  );

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: OG_ROOM,
          display: "flex",
          position: "relative",
        }}
      >
        {/* The marquee */}
        <Wordmark
          x={size.width / 2}
          y={top}
          cell={MARQUEE_CELL}
          color={OG_INK}
          align="center"
        />

        {/* Sign-off — Hugo and the standing invitation. */}
        <Hugo x={signOffX} y={signOffY} cell={HUGO_CELL} />
        <PixelText
          text={TAGLINE}
          x={signOffX + hugo.width + HUGO_GAP}
          y={signOffY + Math.ceil((hugo.height - 7 * TAGLINE_CELL) / 2)}
          cell={TAGLINE_CELL}
          color={OG_MUTED}
          {...TAGLINE_SPACING}
        />

        {/* Scanlines — the whisper overlay, baked in. */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            backgroundImage:
              "repeating-linear-gradient(to bottom, rgba(232,242,233,0.04) 0px, rgba(232,242,233,0.04) 1px, transparent 1px, transparent 4px)",
          }}
        />
      </div>
    ),
    { ...size },
  );
}
