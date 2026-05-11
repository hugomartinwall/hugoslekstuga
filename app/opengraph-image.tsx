import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "hugoslekstuga";

/**
 * OG / share-card image — just the wordmark, centered, on cream.
 * The description sentence does the talking in the message preview;
 * the image is purely the brand identity.
 */
export default async function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#fbf6ee",
          color: "#1a1812",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            fontSize: "180px",
            fontWeight: 900,
            lineHeight: 1,
            letterSpacing: "-0.04em",
          }}
        >
          hugoslekstuga
          <div
            style={{
              width: "32px",
              height: "32px",
              borderRadius: "9999px",
              background: "#ff5a3c",
              marginLeft: "14px",
              marginBottom: "26px",
            }}
          />
        </div>
      </div>
    ),
    { ...size },
  );
}
