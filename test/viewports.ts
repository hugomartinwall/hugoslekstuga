/**
 * Shared viewport matrix for the camera and UI-layout suites.
 *
 * Deliberately NOT a `.test.ts` file: importing a spec from another spec makes
 * vitest evaluate it inside both workers, so every `describe`/`it` in it runs
 * twice.
 *
 * Covers the CLAUDE.md §1 legibility range (907×510 → 1920×1080), real phone
 * and tablet sizes in both orientations, and the short-and-narrow region
 * (split-screen, on-screen keyboard) where fixed-list testing missed a HUD
 * overflow.
 */
export interface TestViewport {
  name: string;
  cssW: number;
  cssH: number;
  dpr: number;
  /**
   * Smaller than the 907×510 floor CLAUDE.md §1 commits to. Included so layout
   * overflow still gets caught there (split-screen and on-screen-keyboard sizes
   * do happen), but excluded from the strict legibility bars — a 21-node board
   * genuinely cannot show 56 px node separation on a 375×500 screen.
   */
  belowSupportedFloor?: boolean;
}

export const VIEWPORTS: TestViewport[] = [
  { name: "iPhone X portrait", cssW: 375, cssH: 812, dpr: 2 },
  { name: "iPhone 14 portrait", cssW: 390, cssH: 844, dpr: 2 },
  // The Pro Max body — the widest-selling iPhone class, and for a long time
  // the matrix's blind spot: 428-479 px is wide enough for the share bar to
  // stay inline yet still `compact`, the one regime where the bar and the
  // folded-up hearts shared row 1. The bar painted over the hearts on every
  // such phone and no test could see it, because no viewport sat in the band.
  { name: "iPhone Pro Max portrait", cssW: 430, cssH: 932, dpr: 3 },
  { name: "small Android portrait", cssW: 360, cssH: 640, dpr: 2 },
  { name: "iPhone X landscape", cssW: 812, cssH: 375, dpr: 2 },
  // Notched landscape shrinks effective width by 94 px, which put 640-wide
  // phones into the same collision band as the Pro Max portraits. Below the
  // supported floor (both dimensions under 907×510): overlap and fit rules
  // are enforced here, but the 42 px node-legibility bar genuinely cannot
  // hold — with the notch there is neither the width to keep the share bar
  // inline nor the height to give it a row without shrinking the board.
  { name: "small Android landscape", cssW: 640, cssH: 360, dpr: 2, belowSupportedFloor: true },
  { name: "iPad portrait", cssW: 768, cssH: 1024, dpr: 2 },
  { name: "iPad landscape", cssW: 1024, cssH: 768, dpr: 2 },
  { name: "min supported", cssW: 907, cssH: 510, dpr: 1 },
  { name: "720p", cssW: 1280, cssH: 720, dpr: 1 },
  { name: "1080p", cssW: 1920, cssH: 1080, dpr: 1 },
  // Short-and-narrow: keyboard up, split-screen, small desktop windows. These
  // are the sizes that exposed the share-bar and lives/cores collisions.
  { name: "narrow short", cssW: 375, cssH: 500, dpr: 2, belowSupportedFloor: true },
  { name: "narrow short 2", cssW: 360, cssH: 540, dpr: 2, belowSupportedFloor: true },
  { name: "narrow short 3", cssW: 414, cssH: 500, dpr: 2, belowSupportedFloor: true },
];

/**
 * iPhone-class safe-area insets. A device rotates its notch with the screen, so
 * a short (landscape) viewport gets side insets, not a top one — a 47 px top
 * inset on a 375-tall screen is a combination no device produces.
 */
export const notched = (cssH: number) =>
  cssH < 560
    ? { top: 0, right: 47, bottom: 21, left: 47 }
    : { top: 47, right: 0, bottom: 34, left: 0 };

/** Only the sizes the game actually promises to be legible at. */
export const SUPPORTED = VIEWPORTS.filter((v) => !v.belowSupportedFloor);
