/**
 * Hugo the brand dot, as a static lockup for favicons / Apple touch
 * icon / PWA manifest. The live `BrandDot` component animates eyes,
 * cycles colours, drags, blinks, sleeps — this is the still version
 * for surfaces with no DOM (search snippets, browser tabs, home
 * screens).
 *
 * Proportions match `app/opengraph-image.tsx` so the favicon, Apple
 * touch icon, 512×512 manifest icon, and OG share image all read as
 * the same character:
 *   - dot diameter   = canvas × 0.73
 *   - chunky border  = canvas × 0.039 (clamped ≥ 2px)
 *   - eye diameter   = dot diameter × 0.18
 *   - eye-edge gap   = dot diameter × 0.12  (flex `gap`)
 *
 * Tomato is the canonical static colour. The live dot cycles through
 * eight accents, but caches (search engines, OS icon caches) need a
 * stable choice. See the comment in `app/apple-icon.tsx` for the
 * earlier justification.
 */

const BG = "#fbf6ee"; // cream
const DOT = "#ff5a3c"; // tomato
const INK = "#1a1812"; // ink
const EYE = "#fbf6ee"; // cream (same as bg — eyes read as "holes" in the disc)

/**
 * Returns the JSX for an `ImageResponse` at the given square canvas
 * size. The composition is centred and self-contained — caller just
 * sets the `ImageResponse` `size`.
 */
export function renderHugoIcon(canvas: number) {
  const dot = Math.round(canvas * 0.73);
  const border = Math.max(2, Math.round(canvas * 0.039));
  const eye = Math.round(dot * 0.18);
  const eyeGap = Math.round(dot * 0.12);
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: BG,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          width: dot,
          height: dot,
          borderRadius: 9999,
          background: DOT,
          border: `${border}px solid ${INK}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: eyeGap,
        }}
      >
        <div
          style={{
            width: eye,
            height: eye,
            borderRadius: 9999,
            background: EYE,
          }}
        />
        <div
          style={{
            width: eye,
            height: eye,
            borderRadius: 9999,
            background: EYE,
          }}
        />
      </div>
    </div>
  );
}
