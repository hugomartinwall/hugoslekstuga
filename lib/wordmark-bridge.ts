/**
 * Read-only bridge between the homepage marquee (PixelWordmark) and
 * the other inhabitants of the room. Same philosophy as the
 * data-slug/data-r attributes ToolMap exposes for the parkour: the
 * wordmark publishes where it is, everyone else only reads.
 *
 *  - ToolMap reads the whole rect per frame so the swarm can drift
 *    around the title instead of parking on it.
 *  - HugoParkour reads the per-letter rects so the letters can serve
 *    as platforms.
 *
 * All coordinates are viewport space (the homepage room is h-dvh at
 * the page origin, so local == viewport there). Rects are the *base*
 * layout — shimmer and cursor displacement never move them, so
 * anything standing on a letter gets a still floor.
 */

export type WordmarkRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type WordmarkLetter = WordmarkRect & {
  /** Index into the wordmark's letter sequence (spaces skipped). */
  index: number;
};

let rect: WordmarkRect | null = null;
let letters: WordmarkLetter[] = [];

export function setWordmark(
  nextRect: WordmarkRect | null,
  nextLetters: WordmarkLetter[] = [],
): void {
  rect = nextRect;
  letters = nextLetters;
}

export function getWordmarkRect(): WordmarkRect | null {
  return rect;
}

export function getWordmarkLetters(): WordmarkLetter[] {
  return letters;
}
