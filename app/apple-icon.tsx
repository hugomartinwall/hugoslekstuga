import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/**
 * Apple touch icon. iOS home-screen icon shown when a user adds
 * hugoslekstuga.com to their Home Screen via Safari. Rendered as the
 * canonical static Hugo lockup — tomato disc with chunky ink border,
 * two cream eyes on cream background.
 *
 * Proportions match `app/opengraph-image.tsx` so the favicon, this
 * touch icon, and the OG share image all read as the same character:
 * eye diameter is 18% of dot diameter, edge gap is 12% of dot
 * diameter. Tomato is the canonical static colour — the live
 * `BrandDot` cycles through eight accents, but caches (search
 * engines, OS icon caches) need a stable choice.
 *
 * Composition is inlined rather than imported from `lib/` after a
 * Vercel `modifyConfig` build failure that traced to one of the
 * newer metadata-route additions; keeping this file self-contained
 * avoids re-tripping the same edge case while we polish.
 */
const CANVAS = 180;
const DOT = Math.round(CANVAS * 0.73); // 131
const BORDER = Math.max(2, Math.round(CANVAS * 0.039)); // 7
const EYE = Math.round(DOT * 0.18); // 24
const EYE_GAP = Math.round(DOT * 0.12); // 16

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
            width: DOT,
            height: DOT,
            borderRadius: 9999,
            background: "#ff5a3c",
            border: `${BORDER}px solid #1a1812`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: EYE_GAP,
          }}
        >
          <div
            style={{
              width: EYE,
              height: EYE,
              borderRadius: 9999,
              background: "#fbf6ee",
            }}
          />
          <div
            style={{
              width: EYE,
              height: EYE,
              borderRadius: 9999,
              background: "#fbf6ee",
            }}
          />
        </div>
      </div>
    ),
    { ...size },
  );
}
