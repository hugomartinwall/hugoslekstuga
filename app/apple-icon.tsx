import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/**
 * Apple touch icon. The brand mark is now a single coloured disc on
 * cream — the same dot that punctuates the wordmark, scaled up. The
 * disc is tomato in the static lockup; the live dot in the nav can be
 * any of the eight accent colours, but the favicon/touch-icon needs a
 * stable choice (no localStorage available here).
 */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#fbf6ee",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: 132,
            height: 132,
            borderRadius: 9999,
            background: "#ff5a3c",
            border: "7px solid #1a1812",
            display: "flex",
          }}
        />
      </div>
    ),
    { ...size },
  );
}
