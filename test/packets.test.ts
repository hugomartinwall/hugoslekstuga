import { describe, expect, it } from "vitest";
import { packetHash } from "../lib/overrun/render/fx";
import { createLevel } from "../lib/overrun/sim/level";
import { EMIT_EVERY } from "../lib/overrun/sim/constants";

/**
 * The packet pips spread a stream sideways using `packetHash(from, to,
 * departTick)`. Packets carry no id, so this triple is the only stable handle
 * on one — and the visual falls apart in two different ways if it stops being
 * one: a hash that changes between frames makes the stream jitter like static,
 * and a hash that collides makes units stack on the same line again, which is
 * the exact problem the pips exist to fix.
 */
describe("packet spread noise", () => {
  it("is stable — the same packet hashes the same every frame", () => {
    for (const [a, b, t] of [
      [0, 1, 0],
      [3, 7, 412],
      [20, 2, 99991],
    ]) {
      expect(packetHash(a!, b!, t!)).toBe(packetHash(a!, b!, t!));
    }
  });

  it("separates the packets that actually share a lane", () => {
    // Within one flow, from and to are fixed and only departTick moves — in
    // steps of EMIT_EVERY. That is the sequence whose spread values have to
    // differ, and a weaker hash (say departTick * k) would band them.
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) {
      seen.add(packetHash(4, 11, 500 + i * EMIT_EVERY) & 0xffff);
    }
    // 200 draws from 65536 buckets: a handful of birthday collisions is
    // expected, wholesale banding is not.
    expect(seen.size).toBeGreaterThan(190);
  });

  it("spreads roughly evenly across the lane rather than hugging one side", () => {
    let sum = 0;
    let lo = 0;
    const n = 400;
    for (let i = 0; i < n; i++) {
      const u = (packetHash(2, 9, i * EMIT_EVERY) & 0xffff) / 0x10000;
      sum += u;
      if (u < 0.5) lo++;
    }
    expect(sum / n).toBeGreaterThan(0.44);
    expect(sum / n).toBeLessThan(0.56);
    expect(lo / n).toBeGreaterThan(0.4);
    expect(lo / n).toBeLessThan(0.6);
  });

  it("gives different lanes different noise", () => {
    // Sibling flows out of one node must not spread identically, or two
    // streams leaving the same source would move in lockstep.
    const a = packetHash(5, 6, 300);
    const b = packetHash(5, 7, 300);
    const c = packetHash(6, 5, 300);
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it("is defined for every node pair a real level can produce", () => {
    for (const level of [1, 7, 12, 25, 60]) {
      const state = createLevel(level);
      for (const from of state.nodes) {
        for (const to of state.nodes) {
          const h = packetHash(from.id, to.id, 1234);
          expect(Number.isFinite(h)).toBe(true);
          expect(h).toBeGreaterThanOrEqual(0);
          expect(h).toBeLessThanOrEqual(0xffffffff);
        }
      }
    }
  });
});
