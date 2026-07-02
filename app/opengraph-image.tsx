import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "hugoslekstuga";

/**
 * OG / share-card image — the wordmark with the brand dot beside it,
 * centred on the room dark. The dot has two tiny room-dark eyes so the social
 * preview wears the *character* face of the identity, not just the
 * shape. (Live, the eyes only appear when a cursor passes near the
 * nav dot; on a static share-card the face is the introduction.)
 */
export default async function OGImage() {
  // Sized relative to the dot so eyes stay proportional if we ever
  // change the dot dimensions.
  const dotSize = 110;
  const eyeSize = Math.round(dotSize * 0.18);
  const eyeGap = Math.round(dotSize * 0.12);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#0b0c14",
          color: "#e8f2e9",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            fontSize: 150,
            fontWeight: 900,
            lineHeight: 1,
            letterSpacing: "-0.04em",
          }}
        >
          hugoslekstuga
          <div
            style={{
              position: "relative",
              width: dotSize,
              height: dotSize,
              borderRadius: 9999,
              background: "#ff6e5e",
              marginLeft: 18,
              marginBottom: 14,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: eyeGap,
            }}
          >
            <div
              style={{
                width: eyeSize,
                height: eyeSize,
                borderRadius: 9999,
                background: "#0b0c14",
              }}
            />
            <div
              style={{
                width: eyeSize,
                height: eyeSize,
                borderRadius: 9999,
                background: "#0b0c14",
              }}
            />
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
