/**
 * Deterministic RNG — mulberry32. The generator's state is a single u32
 * that lives INSIDE GameState (state.rng), advanced through these pure
 * helpers, so a saved state replays identically. Nothing under sim/ or
 * content/ may touch the built-in random — the determinism suite greps.
 */

/** Advance the state and return [nextState, float in [0,1)]. */
export function rngNext(state: number): [number, number] {
  let t = (state + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const out = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [(state + 0x6d2b79f5) >>> 0, out];
}

/** Mixes a seed and a stream id into an initial u32 state. */
export function rngSeed(seed: number, stream: number): number {
  let h = (seed ^ Math.imul(stream, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** Convenience wrapper: a mutable cursor over the pure generator. */
export class Rng {
  state: number;
  constructor(state: number) {
    this.state = state >>> 0;
  }
  next(): number {
    const [s, v] = rngNext(this.state);
    this.state = s;
    return v;
  }
  /** Integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  /** Float in [a, b). */
  range(a: number, b: number): number {
    return a + this.next() * (b - a);
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
}
