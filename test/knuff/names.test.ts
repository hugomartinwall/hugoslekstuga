import { describe, expect, it } from "vitest";
import { PLATE_SIDE } from "../../lib/knuff/content/charms";
import { CHARM_NAME } from "../../lib/knuff/content/copy";
import { DEFAULT_TUNE } from "../../lib/knuff/content/tune";
import { floatBox, floatOver, offerTiles, overlaps, placeNames, type UBox } from "../../lib/knuff/render/names";
import { INSERT_INSET, insertCentre } from "../../lib/knuff/sim/charms";
import { createState } from "../../lib/knuff/sim/state";
import { step } from "../../lib/knuff/sim/step";
import type { SimEvent, State } from "../../lib/knuff/sim/types";

/**
 * An offered plate's name must never lie under a pickup's tile or another
 * name (the step-2 check found it did, 16 times in 6,000 offers, at the
 * spec's spots). Offers are made as that check made them: plates lit at
 * random within their caps (a third with only the two starting plates),
 * an empty room at 19:00, the offer of its clear, him anywhere. Names are
 * measured as the spec measures them: COIN SLOT is 96 px, so a character
 * is 96 / 9 px, at 1 px a unit.
 */

const tune = DEFAULT_TUNE;
const width = (text: string) => text.length * (96 / 9);
const WALL = ["bumper", "pip", "spark", "bell", "coin"];
const CAP: Record<string, number> = { bumper: 2, pip: 2, spark: 2, bell: 1, coin: 2 };

function offers(count: number): State[] {
  let x = 99;
  const rnd = () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 4294967296;
  };
  const out: State[] = [];
  const ev: SimEvent[] = [];
  for (let n = 0; out.length < count && n < count * 2; n++) {
    const plates: string[] = [];
    const used: Record<string, number> = { bumper: 0, pip: 0, spark: 0, bell: 0, coin: 0 };
    for (let i = 0; i < 10; i++) {
      let c = "";
      if (n % 3 && rnd() < 0.4) {
        const w = WALL[Math.floor(rnd() * 5)];
        if (used[w] < CAP[w]) {
          c = w;
          used[w]++;
        }
      }
      plates.push(c);
    }
    if (n % 3 === 0) {
      plates.fill("");
      plates[0] = "bumper";
      plates[4] = "pip";
    }
    const s = createState(n + 1, tune, { kinds: [], plates });
    ev.length = 0;
    step(s, { launch: { dx: 0, dy: -1, power: 0.5 }, pullHeld: false }, tune, ev);
    while (s.tick < 456) step(s, { launch: null, pullHeld: false }, tune, ev);
    s.him.x = 21 + rnd() * 318;
    s.him.y = 21 + rnd() * 438;
    step(s, { launch: null, pullHeld: false }, tune, ev);
    if (s.offer.open) out.push(s);
  }
  return out;
}

/** The spec's own spots (§6.3), as the playable drew them: where the step-2 check found the overlaps. */
function specSpots(s: State): UBox[] {
  const out: UBox[] = [];
  for (const it of s.offer.items) {
    const w = width(CHARM_NAME[it.charm]);
    if (it.kind === "plate") {
      const c = insertCentre(s, it.plate);
      const under = it.plate <= 3 || it.plate >= 8;
      const ym = under ? c.y + 18 + 12 : c.y - 18 - 12;
      const side = PLATE_SIDE[it.plate];
      let l = side === "right" ? s.room.right - INSERT_INSET - w : side === "left" ? s.room.left + INSERT_INSET : c.x - w / 2;
      l = Math.min(Math.max(l, s.room.left + 2), s.room.right - 2 - w);
      out.push({ x0: l, y0: ym - 7, x1: l + w, y1: ym + 7 });
    } else {
      const d = s.things.find((t) => t.id === it.thingId);
      if (!d) continue;
      let l = d.x - w / 2;
      l = Math.min(Math.max(l, s.room.left + 2), s.room.right - 2 - w);
      out.push({ x0: l, y0: d.y + 30 - 7, x1: l + w, y1: d.y + 30 + 7 });
    }
  }
  return out;
}

describe("the offer's names", () => {
  const made = offers(3000);

  it("are made for enough offers, and at the spec's own spots some did lie on a tile or a name", () => {
    expect(made.length).toBeGreaterThan(2500);
    let clashes = 0;
    for (const s of made) {
      const spots = specSpots(s);
      const tiles = offerTiles(s);
      for (let i = 0; i < spots.length; i++) {
        const other = [...tiles, ...spots.filter((_, j) => j !== i)];
        if (other.some((b) => overlaps(spots[i], b))) clashes++;
      }
    }
    // Without this the check below proves nothing: the case it guards must come up.
    expect(clashes).toBeGreaterThan(0);
  });

  it("no name lies on an insert, a tile or another name, and every one is inside the floor", () => {
    const bad: string[] = [];
    for (const s of made) {
      const spots = placeNames(s, width, 1);
      expect(spots.length).toBe(s.offer.items.length);
      const tiles = offerTiles(s);
      for (let i = 0; i < spots.length; i++) {
        const n = spots[i];
        const on = tiles.some((t) => overlaps(n, t)) || spots.some((m, j) => j !== i && overlaps(n, m));
        const out = n.x0 < s.room.left || n.x1 > s.room.right || n.y0 < s.room.top || n.y1 > s.room.bottom;
        if (on || out) bad.push(`seed ${s.seed}: ${n.text} ${JSON.stringify(n)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("stands where the spec puts it whenever that spot is clear", () => {
    let moved = 0;
    let total = 0;
    for (const s of made) {
      const spec = specSpots(s);
      const placed = placeNames(s, width, 1);
      const plates = s.offer.items.filter((it) => it.kind === "plate").length;
      // placeNames lists the plates first, then the pickups: the order of specSpots, sorted the same way.
      const order = [...s.offer.items.keys()].sort((a, b) => Number(s.offer.items[b].kind === "plate") - Number(s.offer.items[a].kind === "plate"));
      for (let i = 0; i < placed.length; i++) {
        total++;
        const want = spec[order[i]];
        const same = Math.abs(placed[i].x0 - want.x0) < 1e-6 && Math.abs(placed[i].y0 - want.y0) < 1e-6;
        if (!same) moved++;
      }
      expect(plates).toBeLessThanOrEqual(2);
    }
    // Moved only where the spec's spot was taken: a few in a thousand.
    expect(moved).toBeGreaterThan(0);
    expect(moved / total).toBeLessThan(0.02);
  });

  it("is placed for the room's scale: a smaller room gives a name more units", () => {
    const s = made[0];
    const at1 = placeNames(s, width, 1)[0];
    const at84 = placeNames(s, width, 0.84)[0];
    expect(at84.x1 - at84.x0).toBeCloseTo((at1.x1 - at1.x0) / 0.84, 6);
  });

  it("a floating number on a name or a tile is in the offer's way (it is drawn faded); one clear of them is not", () => {
    let over = 0;
    let away = 0;
    for (const s of made.slice(0, 200)) {
      const names = placeNames(s, width, 1);
      const clear = [...offerTiles(s), ...names];
      // 'x4' risen onto each name's middle, and onto each tile's: in the way.
      for (const b of clear) {
        expect(floatOver(floatBox((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, "x4", false, 1), clear)).toBe(true);
        over++;
      }
      // A launch's total in an empty corner of the floor, if the offer left one empty: not in the way.
      for (const [x, y] of [
        [40, 40],
        [320, 40],
        [40, 440],
        [320, 440],
      ]) {
        const b = floatBox(x, y, "1250", true, 1);
        if (clear.some((c) => overlaps(b, c))) continue;
        expect(floatOver(b, clear)).toBe(false);
        away++;
      }
    }
    expect(over).toBeGreaterThan(400);
    expect(away).toBeGreaterThan(100);
    // Its box is the face's: 10 px a character at 22 px, 13 at 28, in units at the room's scale.
    const b = floatBox(100, 50, "x4", false, 1);
    expect([b.x1 - b.x0, b.y1 - b.y0]).toEqual([24, 19]);
    const big = floatBox(100, 50, "250", true, 1.5);
    expect(big.x1 - big.x0).toBeCloseTo(43 / 1.5, 6);
  });
});
