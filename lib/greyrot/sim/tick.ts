/**
 * Simulation clock. 30 Hz fixed tick (CLAUDE.md §4).
 *
 * Nothing in src/sim/ may import three, src/render/, or touch window/document,
 * and Math.random() is banned here — all randomness comes from Rng. A test
 * enforces all of that; determinism is load-bearing, not incidental.
 */

export const TICK_HZ = 30;
export const TICK_MS = 1000 / TICK_HZ;

/** Ticks in `seconds` of simulated time. Use instead of counting frames. */
export function ticks(seconds: number): number {
  return Math.round(seconds * TICK_HZ);
}
