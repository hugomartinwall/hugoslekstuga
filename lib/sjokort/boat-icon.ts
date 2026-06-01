/**
 * Boat marker icons for the sjökort GPS position. Each is a top-view
 * silhouette drawn pointing **north** (bow at the top of the 36×36
 * viewBox); the marker is then rotated to the GPS heading so the bow
 * points where you're going.
 *
 * Teal fill + a heavy ink outline so the marker reads clearly against
 * a busy nautical chart, with a cream bow dot as a direction hint.
 * Brand colours (teal #14b8a6, ink #1a1812, cream #fbf6ee).
 */

export type BoatKind = "motor" | "sail" | "kayak" | "custom";

const TEAL = "#14b8a6";
const INK = "#1a1812";
const CREAM = "#fbf6ee";

/** Shared hull outline (pointed bow up, rounded stern). */
const HULL = "M18 2 C25 10 25 26 18 34 C11 26 11 10 18 2 Z";
/** Slimmer hull for sail/kayak. */
const SLIM_HULL = "M18 2 C22 11 22 25 18 34 C14 25 14 11 18 2 Z";

function wrap(inner: string, size: number): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg" style="display:block;filter:drop-shadow(0 1px 2px rgba(26,24,18,0.35))">${inner}</svg>`;
}

function bowDot(): string {
  return `<circle cx="18" cy="8" r="1.8" fill="${CREAM}"/>`;
}

/** Returns an SVG string for the given boat profile, sized `size` px. */
export function boatIconSvg(kind: BoatKind, size = 36): string {
  switch (kind) {
    case "sail":
      return wrap(
        // Slim hull + a big mainsail triangle.
        `<path d="${SLIM_HULL}" fill="${TEAL}" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>` +
          `<path d="M18 5 L25 21 L11 21 Z" fill="${CREAM}" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>`,
        size,
      );
    case "kayak":
      return wrap(
        // Symmetric slim hull, paddler dot in the middle.
        `<path d="M18 2 C20.5 12 20.5 24 18 34 C15.5 24 15.5 12 18 2 Z" fill="${TEAL}" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>` +
          `<circle cx="18" cy="18" r="2.2" fill="${INK}"/>` +
          bowDot(),
        size,
      );
    case "motor":
      return wrap(
        // Hull + a console/windshield block.
        `<path d="${HULL}" fill="${TEAL}" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>` +
          `<rect x="13.5" y="16" width="9" height="8" rx="2" fill="${CREAM}" stroke="${INK}" stroke-width="1.6"/>` +
          bowDot(),
        size,
      );
    default:
      // Generic hull.
      return wrap(
        `<path d="${HULL}" fill="${TEAL}" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>` +
          bowDot(),
        size,
      );
  }
}
