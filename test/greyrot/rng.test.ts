import { describe, expect, it } from "vitest";
import { Rng, STREAM_NAMES, Stream, dailySeed, mixSeed, subSeed } from "../../lib/greyrot/sim/rng";

/**
 * Determinism is load-bearing (CLAUDE.md §4): replay, headless balance runs,
 * reproducible bug reports and the marketing capture rig all depend on it.
 * These tests exist to catch the day somebody "optimises" the generator.
 */

const take = (s: Stream, n: number): number[] =>
  Array.from({ length: n }, () => s.next());

describe("Stream", () => {
  it("is reproducible from a seed", () => {
    expect(take(new Stream(12345), 50)).toEqual(take(new Stream(12345), 50));
  });

  it("differs between seeds", () => {
    expect(take(new Stream(1), 20)).not.toEqual(take(new Stream(2), 20));
  });

  it("stays in [0, 1)", () => {
    const s = new Stream(99);
    for (let i = 0; i < 5000; i++) {
      const v = s.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("is roughly uniform", () => {
    // Not a rigorous statistical test — just enough to catch a generator that
    // has collapsed into a narrow band or a short cycle.
    const s = new Stream(7);
    const buckets = new Array(10).fill(0);
    const N = 100_000;
    for (let i = 0; i < N; i++) buckets[Math.floor(s.next() * 10)]!++;
    for (const b of buckets) {
      expect(b).toBeGreaterThan(N / 10 - N / 100);
      expect(b).toBeLessThan(N / 10 + N / 100);
    }
  });

  it("int() covers its inclusive bounds", () => {
    const s = new Stream(3);
    const seen = new Set<number>();
    for (let i = 0; i < 3000; i++) seen.add(s.int(1, 6));
    expect([...seen].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("weighted() honours the weights", () => {
    const s = new Stream(11);
    const counts = { a: 0, b: 0 };
    for (let i = 0; i < 20_000; i++) counts[s.weighted(["a", "b"] as const, [3, 1])]++;
    const ratio = counts.a / counts.b;
    expect(ratio).toBeGreaterThan(2.7);
    expect(ratio).toBeLessThan(3.3);
  });

  it("weighted() rejects malformed input instead of silently guessing", () => {
    const s = new Stream(1);
    expect(() => s.weighted([], [])).toThrow(/empty/);
    expect(() => s.weighted(["a"], [1, 2])).toThrow(/differ in length/);
    expect(() => s.weighted(["a", "b"], [0, 0])).toThrow(/sum to zero/);
    expect(() => s.weighted(["a", "b"], [1, -1])).toThrow(/negative/);
  });

  it("pick() throws on an empty list rather than returning undefined", () => {
    expect(() => new Stream(1).pick([])).toThrow(/empty/);
  });

  it("shuffle() is a permutation and is deterministic", () => {
    const base = [1, 2, 3, 4, 5, 6, 7, 8];
    const a = new Stream(42).shuffle([...base]);
    const b = new Stream(42).shuffle([...base]);
    expect(a).toEqual(b);
    expect([...a].sort((x, y) => x - y)).toEqual(base);
  });

  it("round-trips through a snapshot mid-sequence", () => {
    const s = new Stream(555);
    take(s, 17);
    const snap = s.snapshot();
    const expected = take(s, 10);
    expect(take(Stream.restore(snap), 10)).toEqual(expected);
  });

  it("snapshots are plain JSON-safe data", () => {
    const snap = new Stream(1).snapshot();
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
  });
});

describe("Rng streams", () => {
  it("gives each stream a different sequence from the same run seed", () => {
    const rng = new Rng(2024);
    const seqs = STREAM_NAMES.map((n) => take(rng.get(n), 10).join(","));
    expect(new Set(seqs).size).toBe(STREAM_NAMES.length);
  });

  it("keeps streams independent — the whole point of the design", () => {
    // Draw heavily from loot in one run and not at all in the other. Combat
    // must be unaffected. If this fails, a UI-side reroll can desync a replay.
    const a = new Rng(77);
    const b = new Rng(77);
    for (let i = 0; i < 500; i++) a.loot.next();
    expect(take(a.combat, 20)).toEqual(take(b.combat, 20));
  });

  it("seeds streams by name, so adding one later cannot shift the others", () => {
    // Name-derived seeding is what makes old saves keep replaying identically
    // when a new stream is introduced.
    expect(mixSeed(5, "combat")).toBe(mixSeed(5, "combat"));
    expect(mixSeed(5, "combat")).not.toBe(mixSeed(5, "loot"));
    // A hypothetical future stream does not collide with an existing one.
    expect(mixSeed(5, "weather")).not.toBe(mixSeed(5, "combat"));
  });

  it("round-trips every stream through a snapshot", () => {
    const rng = new Rng(31337);
    for (const n of STREAM_NAMES) take(rng.get(n), 5 + n.length);
    const snap = rng.snapshot();
    const expected = STREAM_NAMES.map((n) => take(rng.get(n), 8));

    const restored = Rng.restore(31337, snap);
    expect(STREAM_NAMES.map((n) => take(restored.get(n), 8))).toEqual(expected);
  });

  it("survives a JSON round-trip, as the save path requires", () => {
    const rng = new Rng(8);
    take(rng.world, 12);
    const snap = JSON.parse(JSON.stringify(rng.snapshot()));
    expect(take(Rng.restore(8, snap).world, 5)).toEqual(take(rng.world, 5));
  });
});

describe("seed derivation", () => {
  it("subSeed is stable and order-sensitive", () => {
    expect(subSeed(1, "zone", 3)).toBe(subSeed(1, "zone", 3));
    expect(subSeed(1, "zone", 3)).not.toBe(subSeed(1, 3, "zone"));
    expect(subSeed(1, "zone", 3)).not.toBe(subSeed(2, "zone", 3));
  });

  it("subSeed gives distinct seeds to distinct content, so items differ", () => {
    // Item affixes are stored as (baseId, seed) and regenerated (CLAUDE.md §7),
    // so collisions here would make different drops identical.
    const seeds = new Set<number>();
    for (let i = 0; i < 2000; i++) seeds.add(subSeed(99, "item", i));
    expect(seeds.size).toBe(2000);
  });

  it("dailySeed is stable per UTC date and differs across days", () => {
    expect(dailySeed("2026-08-06")).toBe(dailySeed("2026-08-06"));
    expect(dailySeed("2026-08-06")).not.toBe(dailySeed("2026-08-07"));
  });
});
