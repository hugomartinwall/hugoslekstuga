import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "HUGOS LEKSTUGA — a small playhouse of browser tools";

/**
 * OG / share-card image — the homepage marquee, faithfully: HUGOS
 * LEKSTUGA as phosphor pixel blocks on the room dark, scanlines over
 * everything, Hugo (the dot, with his eyes) signing off next to the
 * tagline. The live wordmark is sampled from Jersey 15 on a canvas;
 * @vercel/og has no canvas, so this hand-authored 5×7 pixel font
 * stands in — same language, same room.
 */

const INK = "#e8f2e9";
const CREAM = "#0b0c14";
const MUTED = "#8e97a8";
const CORAL = "#ff6e5e";

/** 5×7 pixel glyphs — just the letters the wordmark needs. */
const GLYPHS: Record<string, string[]> = {
  H: ["X...X", "X...X", "X...X", "XXXXX", "X...X", "X...X", "X...X"],
  U: ["X...X", "X...X", "X...X", "X...X", "X...X", "X...X", ".XXX."],
  G: [".XXX.", "X...X", "X....", "X.XXX", "X...X", "X...X", ".XXXX"],
  O: [".XXX.", "X...X", "X...X", "X...X", "X...X", "X...X", ".XXX."],
  S: [".XXXX", "X....", "X....", ".XXX.", "....X", "....X", "XXXX."],
  L: ["X....", "X....", "X....", "X....", "X....", "X....", "XXXXX"],
  E: ["XXXXX", "X....", "X....", "XXXX.", "X....", "X....", "XXXXX"],
  K: ["X...X", "X..X.", "X.X..", "XX...", "X.X..", "X..X.", "X...X"],
  T: ["XXXXX", "..X..", "..X..", "..X..", "..X..", "..X..", "..X.."],
  A: [".XXX.", "X...X", "X...X", "XXXXX", "X...X", "X...X", "X...X"],
};

function PixelWord({ word, cell }: { word: string; cell: number }) {
  return (
    <div style={{ display: "flex" }}>
      {word.split("").map((ch, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            flexDirection: "column",
            marginRight: i < word.length - 1 ? cell : 0,
          }}
        >
          {(GLYPHS[ch] ?? GLYPHS.O).map((row, r) => (
            <div key={r} style={{ display: "flex" }}>
              {row.split("").map((px, c) => (
                <div
                  key={c}
                  style={{
                    width: cell,
                    height: cell,
                    background: px === "X" ? INK : "transparent",
                  }}
                />
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export default async function OGImage() {
  const cell = 13;
  const dotSize = 64;
  const eyeSize = Math.round(dotSize * 0.18);
  const eyeGap = Math.round(dotSize * 0.12);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: CREAM,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
        }}
      >
        {/* The marquee */}
        <div style={{ display: "flex", alignItems: "flex-end" }}>
          <PixelWord word="HUGOS" cell={cell} />
          <div style={{ display: "flex", width: cell * 3 }} />
          <PixelWord word="LEKSTUGA" cell={cell} />
        </div>

        {/* Sign-off — Hugo and the standing invitation. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            marginTop: 56,
            gap: 20,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: dotSize,
              height: dotSize,
              borderRadius: 9999,
              background: CORAL,
              gap: eyeGap,
            }}
          >
            <div
              style={{
                width: eyeSize,
                height: eyeSize,
                borderRadius: 9999,
                background: CREAM,
              }}
            />
            <div
              style={{
                width: eyeSize,
                height: eyeSize,
                borderRadius: 9999,
                background: CREAM,
              }}
            />
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 30,
              fontFamily: "system-ui, -apple-system, sans-serif",
              fontWeight: 600,
              letterSpacing: "0.24em",
              color: MUTED,
            }}
          >
            A SMALL PLAYHOUSE OF BROWSER TOOLS
          </div>
        </div>

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
