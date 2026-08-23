/**
 * Deterministic random, in independent streams.
 *
 * `Math.random()` is banned under src/sim/ and a test enforces it. Determinism
 * is load-bearing here, not incidental: it buys free replay, headless balance
 * testing, reproducible bug reports, and the replay-driven marketing capture
 * that game1 proved out (CLAUDE.md §4).
 *
 * ## Why streams
 *
 * A single shared generator couples everything to everything. If loot rolls
 * and combat rolls draw from the same sequence, then re-rolling an item shifts
 * every subsequent crit — so a UI action silently desyncs a replay, and a
 * balance change in one system moves results in another. Splitting them means
 * each system consumes its own sequence and nothing else can perturb it.
 *
 * Add a stream whenever a new system needs randomness. Never share one.
 */

/** Every independent random sequence in the simulation. */
export type StreamName =
  /** Zone layout, encounter placement, world generation. */
  | "world"
  /** Drops, affix rolls, chest contents. */
  | "loot"
  /** Crits, miss chance, damage variance, AI decision jitter. */
  | "combat"
  /** Cosmetic sim-side variation that must still replay identically. */
  | "flavour";

export const STREAM_NAMES: readonly StreamName[] = ["world", "loot", "combat", "flavour"];

/**
 * A single deterministic stream.
 *
 * mulberry32: 32-bit state, good distribution, and — the part that matters —
 * exactly reproducible across engines because it uses only `Math.imul` and
 * integer ops. Anything relying on float rounding would eventually diverge.
 */
export class Stream {
  private state: number;
  /** Draw count. Part of the save so a stream resumes mid-sequence. */
  private drawn = 0;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.drawn++;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Uniform element. Throws on an empty list rather than returning undefined. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("Stream.pick: empty list");
    return items[Math.floor(this.next() * items.length)]!;
  }

  /**
   * Weighted pick. Weights need not sum to 1, but must be non-negative and not
   * all zero.
   */
  weighted<T>(items: readonly T[], weights: readonly number[]): T {
    if (items.length === 0) throw new Error("Stream.weighted: empty list");
    if (items.length !== weights.length) {
      throw new Error("Stream.weighted: items and weights differ in length");
    }
    let total = 0;
    for (const w of weights) {
      if (w < 0) throw new Error("Stream.weighted: negative weight");
      total += w;
    }
    if (total <= 0) throw new Error("Stream.weighted: weights sum to zero");
    let r = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i]!;
      if (r <= 0) return items[i]!;
    }
    return items[items.length - 1]!;
  }

  /** In-place Fisher-Yates. Deterministic given the stream position. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const t = items[i]!;
      items[i] = items[j]!;
      items[j] = t;
    }
    return items;
  }

  /** Serialisable position. Plain data — sim state must stay JSON-safe (§4). */
  snapshot(): StreamSnapshot {
    return { state: this.state, drawn: this.drawn };
  }

  static restore(s: StreamSnapshot): Stream {
    const stream = new Stream(0);
    stream.state = s.state >>> 0;
    stream.drawn = s.drawn;
    return stream;
  }
}

export interface StreamSnapshot {
  state: number;
  drawn: number;
}

export type RngSnapshot = Record<StreamName, StreamSnapshot>;

/**
 * The set of streams for one run.
 *
 * Each stream is seeded by mixing the run seed with the stream's *name*, so
 * adding a new stream later cannot shift the sequences of the existing ones —
 * old saves keep replaying identically.
 */
export class Rng {
  private streams: Record<StreamName, Stream>;
  readonly seed: number;

  constructor(seed: number) {
    this.seed = seed | 0;
    this.streams = Object.fromEntries(
      STREAM_NAMES.map((name) => [name, new Stream(mixSeed(seed, name))]),
    ) as Record<StreamName, Stream>;
  }

  get(name: StreamName): Stream {
    return this.streams[name];
  }

  get world(): Stream {
    return this.streams.world;
  }
  get loot(): Stream {
    return this.streams.loot;
  }
  get combat(): Stream {
    return this.streams.combat;
  }
  get flavour(): Stream {
    return this.streams.flavour;
  }

  snapshot(): RngSnapshot {
    return Object.fromEntries(
      STREAM_NAMES.map((n) => [n, this.streams[n].snapshot()]),
    ) as RngSnapshot;
  }

  static restore(seed: number, snap: RngSnapshot): Rng {
    const rng = new Rng(seed);
    for (const name of STREAM_NAMES) {
      const s = snap[name];
      if (s) rng.streams[name] = Stream.restore(s);
    }
    return rng;
  }
}

/** FNV-1a over the stream name, mixed with the run seed. */
export function mixSeed(seed: number, name: string): number {
  let h = 2166136261 ^ (seed | 0);
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Derive a stable sub-seed — for a zone layout, an item's affixes, an
 * encounter. Store the seed, never the generated result (CLAUDE.md §7).
 */
export function subSeed(seed: number, ...parts: (string | number)[]): number {
  let h = seed >>> 0;
  for (const p of parts) {
    h = mixSeed(h, String(p));
  }
  return h >>> 0;
}

/** UTC date string → seed. Same daily content worldwide. */
export function dailySeed(dateUTC: string): number {
  return mixSeed(0, dateUTC);
}
