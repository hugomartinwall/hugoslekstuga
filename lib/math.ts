/** Clamp a value into the inclusive `[lo, hi]` range. */
export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
