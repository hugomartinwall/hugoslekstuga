/**
 * The easing vocabulary, in one place.
 *
 * Every animation in the renderer reads wall-clock time against a stored
 * `*At: number` and hand-rolls the same quadratic ease-out — `drawIntro` and
 * the overlay title had it open-coded as `1.3 - 0.3*t*(2-t)` and
 * `1.2 - 0.2*t*(2-t)`. This is a consolidation, not a new concept.
 *
 * Pure and DOM-free on purpose: vitest runs in node with no jsdom, and
 * `progress`'s reduced-motion contract is worth asserting directly. It also
 * means `fx.ts` can import it without reaching into the renderer.
 */

export const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Quadratic ease-out. The one curve in the game. */
export function easeOut(t: number): number {
  const c = clamp01(t);
  return c * (2 - c);
}

/**
 * Eased 0..1 progress since `at`.
 *
 * Clamped at both ends because a backgrounded tab hands you an age of minutes,
 * and returns 1 flat when motion is reduced — so a caller gets the animation's
 * *end state* rather than its start, which is what "no animation" has to mean.
 */
export function progress(now: number, at: number, ms: number, reduced = false): number {
  if (reduced || ms <= 0) return 1;
  return easeOut((now - at) / ms);
}
