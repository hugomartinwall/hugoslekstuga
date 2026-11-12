import { describe, expect, it } from "vitest";
import { DEFAULT_TUNE } from "../../lib/knuff/content/tune";
import {
  BAR_H,
  BAR_MIN_W,
  LAPTOP_MARGIN,
  MIN_SCALE,
  carriedAt,
  hintFor,
  layoutFor,
  pauseKeyRect,
  type Insets,
  type Layout,
} from "../../lib/knuff/render/layout";
import { createState } from "../../lib/knuff/sim/state";
import { step } from "../../lib/knuff/sim/step";
import type { SimEvent, State } from "../../lib/knuff/sim/types";

/**
 * Where the room is drawn: the sizing rules of the spec (§9.1), row by
 * row of its table. The room is 360 × 480 units on every device; what
 * changes is the scale, and what is left under the room.
 */

const NONE: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

const phone = (w: number, h: number, dpr: number, safe = NONE): Layout => layoutFor(w, h, dpr, true, safe);
const laptop = (w: number, h: number, dpr: number, safe = NONE): Layout => layoutFor(w, h, dpr, false, safe);

describe("sizing on a phone (a coarse pointer)", () => {
  it("390 × 664: the room at 1 px a unit, x 15 to 375, y 48 to 528, a deck of 136 px", () => {
    for (const dpr of [2, 3]) {
      const l = phone(390, 664, dpr);
      expect(l.s).toBe(1);
      expect(l.room).toEqual({ x: 15, y: 48, w: 360, h: 480 });
      expect(l.deck).toEqual({ x: 0, y: 528, w: 390, h: 136 });
      expect(l.bar).toEqual({ x: 0, y: 0, w: 390, h: 48 });
      expect(l.tooSmall).toBe(false);
    }
  });

  it("360 × 672: 1 px a unit, a deck of 144 px", () => {
    const l = phone(360, 672, 3);
    expect(l.s).toBe(1);
    expect(l.room).toEqual({ x: 0, y: 48, w: 360, h: 480 });
    expect(l.deck.h).toBe(144);
  });

  it("430 × 739 at 3 device pixels: 1.169 snaps down to 7/6, a room of 420 × 560, a deck of 131 px", () => {
    const l = phone(430, 739, 3);
    expect(l.s).toBeCloseTo(7 / 6, 12);
    expect(l.room.w).toBeCloseTo(420, 9);
    expect(l.room.h).toBeCloseTo(560, 9);
    expect(l.deck.h).toBeCloseTo(131, 9);
    expect(l.room.x).toBeCloseTo(5, 9);
  });

  it("412 × 780 at 2.625 device pixels: 1.144 snaps down to 1.143, a room of 411 × 549, a deck of 183 px", () => {
    const l = phone(412, 780, 2.625);
    expect(l.s).toBeCloseTo(6 / 5.25, 12);
    expect(Math.round(l.room.w)).toBe(411);
    expect(Math.round(l.room.h)).toBe(549);
    expect(Math.round(l.deck.h)).toBe(183);
  });

  it("412 × 780 at 3 device pixels: 1.144 snaps down to 1, a deck of 252 px", () => {
    const l = phone(412, 780, 3);
    expect(l.s).toBe(1);
    expect(l.room).toEqual({ x: 26, y: 48, w: 360, h: 480 });
    expect(l.deck.h).toBe(252);
  });

  it("a snap that would come out under 1 where the room fits is 1", () => {
    // 1.04 at 2.625 device pixels snaps to 5 / 5.25 = 0.952.
    const l = phone(375, 720, 2.625);
    expect(l.s).toBe(1);
    expect(l.deck.h).toBe(192);
  });

  it("360 × 640: no room for a full deck, so rule 2: 1 px a unit and a deck of 112 px", () => {
    const l = phone(360, 640, 3);
    expect(l.s).toBe(1);
    expect(l.deck.h).toBe(112);
  });

  it("375 × 553: rule 2 again, with 25 px under the room", () => {
    const l = phone(375, 553, 2);
    expect(l.s).toBe(1);
    expect(l.room).toEqual({ x: 7.5, y: 48, w: 360, h: 480 });
    expect(l.deck.h).toBe(25);
  });

  it("320 × 568: the room shrinks to fit (rule 3): 0.889, 320 × 427, 93 px under it", () => {
    const l = phone(320, 568, 2);
    expect(l.s).toBeCloseTo(320 / 360, 12);
    expect(l.room.w).toBeCloseTo(320, 9);
    expect(Math.round(l.room.h)).toBe(427);
    expect(Math.round(l.deck.h)).toBe(93);
    expect(l.tooSmall).toBe(false);
  });

  it("664 × 390, a phone on its side: 0.7125, too small to play", () => {
    const l = phone(664, 390, 3);
    expect(l.s).toBeCloseTo(0.7125, 12);
    expect(l.tooSmall).toBe(true);
  });

  it("the deck is never under 130 px where rule 1 holds", () => {
    for (let w = 360; w <= 440; w += 7) {
      for (let h = 658; h <= 960; h += 13) {
        for (const dpr of [2, 2.625, 3, 3.5]) {
          const l = phone(w, h, dpr);
          expect(l.s, `${w} × ${h} @ ${dpr}`).toBeGreaterThanOrEqual(1);
          expect(l.deck.h, `${w} × ${h} @ ${dpr}`).toBeGreaterThanOrEqual(130 - 1e-9);
          expect(l.room.x, `${w} × ${h} @ ${dpr}`).toBeGreaterThanOrEqual(0);
          expect(l.room.x + l.room.w, `${w} × ${h} @ ${dpr}`).toBeLessThanOrEqual(w + 1e-9);
        }
      }
    }
  });

  it("the safe areas come off the page before anything is sized", () => {
    // A notch of 47 px and a home bar of 34 px on a 390 × 844 phone.
    const l = phone(390, 844, 3, { top: 47, right: 0, bottom: 34, left: 0 });
    expect(l.bar.y).toBe(47);
    expect(l.room.y).toBe(47 + 48);
    expect(l.deck.y + l.deck.h).toBe(844 - 34);
    expect(l.s).toBe(1);
  });
});

describe("sizing on a laptop (a fine pointer)", () => {
  it("1280 × 633: the room at 1 px a unit with 28 px under it, the block centred", () => {
    for (const dpr of [1, 1.25, 1.5, 2]) {
      const l = laptop(1280, 633, dpr);
      expect(l.s, `dpr ${dpr}`).toBe(1);
      expect(l.room.w).toBe(360);
      expect(l.room.h).toBe(480);
      expect(l.room.x).toBe(460);
      // The block is the bar, the room and the margin: 556 px in 633.
      const top = l.bar.y;
      const bottom = 633 - (l.room.y + l.room.h + LAPTOP_MARGIN);
      expect(l.room.y - top).toBeCloseTo(BAR_H, 9);
      expect(Math.abs(top - bottom)).toBeLessThanOrEqual(1);
      expect(l.deck.h).toBe(0);
      expect(l.tooSmall).toBe(false);
    }
  });

  it("at 1.25 device pixels the snap alone would give 0.8 where 1 fits", () => {
    expect(Math.floor(1.16 * 2 * 1.25) / (2 * 1.25)).toBe(0.8);
    expect(laptop(1280, 633, 1.25).s).toBe(1);
  });

  it("1440 × 900: a scale and a half, a room of 540 × 720", () => {
    const l = laptop(1440, 900, 1);
    expect(l.s).toBe(1.5);
    expect(l.room).toEqual({ x: 450, y: 100, w: 540, h: 720 });
    expect(l.bar).toEqual({ x: 450, y: 52, w: 540, h: 48 });
  });

  it("1280 × 552 at 1.5 device pixels: shrunk to fit, 0.992, and not refused", () => {
    const l = laptop(1280, 552, 1.5);
    expect(l.s).toBeCloseTo(476 / 480, 12);
    expect(Math.round(l.room.w)).toBe(357);
    expect(Math.round(l.room.h)).toBe(476);
    expect(l.tooSmall).toBe(false);
  });

  it("768 × 479: 0.84, a room of 302 × 403 that fills the height", () => {
    for (const dpr of [1, 2]) {
      const l = laptop(768, 479, dpr);
      expect(l.s).toBeCloseTo(403 / 480, 12);
      expect(l.room.w).toBeCloseTo(302.25, 9);
      expect(l.room.h).toBeCloseTo(403, 9);
      expect(l.bar.y).toBe(0);
      expect(l.room.y).toBe(48);
      expect(l.tooSmall).toBe(false);
    }
  });

  it("a laptop page is too small only under 436 px tall", () => {
    expect(MIN_SCALE).toBe(0.75);
    for (const dpr of [1, 1.25, 1.5, 2]) {
      expect(laptop(1280, 436, dpr).tooSmall, `436 @ ${dpr}`).toBe(false);
      expect(laptop(1280, 435, dpr).tooSmall, `435 @ ${dpr}`).toBe(true);
    }
    expect(laptop(1280, 436, 1).s).toBe(0.75);
  });

  it("a scale that was snapped keeps a sprite cell (2 units) on whole device pixels", () => {
    for (let h = 556; h <= 1400; h += 37) {
      for (const dpr of [1, 1.25, 1.5, 2, 3]) {
        const l = laptop(1600, h, dpr);
        const cell = 2 * l.s * dpr;
        if (l.s > 1) expect(Math.abs(cell - Math.round(cell)), `${h} @ ${dpr}`).toBeLessThan(1e-9);
        expect(l.s, `${h} @ ${dpr}`).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("the room lands on a whole device pixel", () => {
    for (const [w, h, dpr] of [
      [1280, 633, 1],
      [1281, 634, 1],
      [1366, 768, 1.25],
      [1536, 730, 1.5],
      [769, 480, 2],
    ] as const) {
      const l = laptop(w, h, dpr);
      expect(Math.abs(l.room.x * dpr - Math.round(l.room.x * dpr)), `${w} × ${h} x`).toBeLessThan(1e-6);
      expect(Math.abs(l.room.y * dpr - Math.round(l.room.y * dpr)), `${w} × ${h} y`).toBeLessThan(1e-6);
    }
  });
});

describe("the playable of the owner's checks (steps 1 to 5)", () => {
  const playable = (w: number, h: number, dpr: number, coarse = false): Layout => layoutFor(w, h, dpr, coarse, NONE, true);

  it("1280 × 400 with a mouse: 0.675, a room of 243 × 324, and nothing is refused", () => {
    for (const dpr of [1, 1.25, 2]) {
      const l = playable(1280, 400, dpr);
      expect(l.s).toBeCloseTo(0.675, 12);
      expect(Math.round(l.room.w)).toBe(243);
      expect(Math.round(l.room.h)).toBe(324);
      expect(l.tooSmall).toBe(false);
      expect(l.room.y + l.room.h + LAPTOP_MARGIN).toBeLessThanOrEqual(400 + 1e-9);
      // A bar as narrow as that room would run the score into the clock: it keeps 300 px, centred on the room.
      expect(l.bar.w).toBe(BAR_MIN_W);
      expect(Math.abs(l.bar.x + l.bar.w / 2 - (l.room.x + l.room.w / 2))).toBeLessThanOrEqual(1);
    }
    expect(laptop(1280, 400, 1).tooSmall).toBe(true);
  });

  it("the window the owner judged the toy in, 768 × 479, is laid out as the final route lays it out", () => {
    expect(playable(768, 479, 1)).toEqual(laptop(768, 479, 1));
    expect(playable(1280, 633, 1.25)).toEqual(laptop(1280, 633, 1.25));
    expect(playable(1440, 900, 1)).toEqual(laptop(1440, 900, 1));
  });

  it("a laptop page is never too small, however short, and the room is never inside out", () => {
    for (let h = 0; h <= 440; h += 20) {
      const l = playable(900, h, 1);
      expect(l.tooSmall, `${h}`).toBe(false);
      expect(l.s, `${h}`).toBeGreaterThan(0);
      expect(l.room.w, `${h}`).toBeGreaterThan(0);
    }
  });

  it("a phone keeps its rule: on its side it is still too small, upright it is laid out as before", () => {
    expect(playable(664, 390, 3, true).tooSmall).toBe(true);
    expect(playable(390, 664, 3, true)).toEqual(phone(390, 664, 3));
    expect(playable(360, 640, 3, true)).toEqual(phone(360, 640, 3));
  });
});

describe("what is drawn for reading: where it goes", () => {
  /** A night, one launch straight up at `power`, stepped until `until` says stop. */
  function night(): State {
    return createState(7, DEFAULT_TUNE, { empty: true });
  }
  const events: SimEvent[] = [];
  const fire = (s: State, power = 1) => step(s, { launch: { dx: 0.3, dy: -1, power }, pullHeld: false }, DEFAULT_TUNE, events);
  const coast = (s: State) => step(s, { launch: null, pullHeld: false }, DEFAULT_TUNE, events);
  const toLanding = (s: State) => {
    for (let i = 0; i < 600 && s.him.hot; i++) coast(s);
    expect(s.him.hot).toBe(false);
  };

  it("the pause key is 44 × 44 in the bar's right corner: x 338 to 382, y 2 to 46 on a 390 px phone", () => {
    const k = pauseKeyRect(phone(390, 664, 3).bar);
    expect(k).toEqual({ x: 338, y: 2, w: 44, h: 44 });
    const l = laptop(1280, 633, 1);
    const kl = pauseKeyRect(l.bar);
    expect(kl.x + kl.w).toBe(l.bar.x + l.bar.w - 8);
    expect(kl.y).toBe(l.bar.y + 2);
  });

  it("the first words and the hand show from the start; the words change at his first landing", () => {
    const s = night();
    expect(hintFor(s)).toEqual({ hand: true, words: "first" });
    fire(s);
    // In his first flight the first words still stand.
    expect(s.him.hot).toBe(true);
    expect(hintFor(s)).toEqual({ hand: true, words: "first" });
    toLanding(s);
    expect(hintFor(s)).toEqual({ hand: true, words: "again" });
  });

  it("the hand goes at the third launch, and the second words at the sixth", () => {
    const s = night();
    const seen: string[] = [];
    for (let n = 1; n <= 7; n++) {
      // A pip is back by the time he has landed and waited.
      s.pips = DEFAULT_TUNE.pipMax;
      fire(s);
      expect(s.launch.id).toBe(n);
      const h = hintFor(s);
      seen.push(`${n}:${h.hand ? "hand" : "-"}/${h.words || "-"}`);
      toLanding(s);
    }
    expect(seen).toEqual(["1:hand/first", "2:hand/again", "3:-/again", "4:-/again", "5:-/again", "6:-/-", "7:-/-"]);
  });

  it("his pips are 23 u under his centre and the meter 24 u above it; near a cushion they change sides", () => {
    const s = night();
    const r = DEFAULT_TUNE.himRadius;
    expect(r).toBe(13);
    expect(carriedAt(s, DEFAULT_TUNE, 240)).toEqual({ pips: 23, meter: -24 });
    // Within his radius + 15 u of the top cushion the meter goes under the pips, 33 u under his centre.
    expect(carriedAt(s, DEFAULT_TUNE, s.room.top + 28)).toEqual({ pips: 23, meter: 33 });
    expect(carriedAt(s, DEFAULT_TUNE, s.room.top + 28.5)).toEqual({ pips: 23, meter: -24 });
    // Within the same distance of the bottom cushion the pips go above him, and the meter above them.
    expect(carriedAt(s, DEFAULT_TUNE, s.room.bottom - 28)).toEqual({ pips: -23, meter: -33 });
    expect(carriedAt(s, DEFAULT_TUNE, s.room.bottom - 28.5)).toEqual({ pips: 23, meter: -24 });
  });

  it("neither ever leaves the floor, wherever he can stand", () => {
    const s = night();
    const r = DEFAULT_TUNE.himRadius;
    for (let y = s.room.top + r; y <= s.room.bottom - r; y += 0.5) {
      const at = carriedAt(s, DEFAULT_TUNE, y);
      // A pip is 6 u tall and the meter 3 u.
      for (const [off, half] of [
        [at.pips, 3],
        [at.meter, 1.5],
      ]) {
        expect(y + off - half, `${y}`).toBeGreaterThanOrEqual(s.room.top);
        expect(y + off + half, `${y}`).toBeLessThanOrEqual(s.room.bottom);
      }
      // And they never sit on each other.
      expect(Math.abs(at.pips - at.meter), `${y}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("sizing, either way", () => {
  it("the room is never stretched: always 3 wide to 4 tall", () => {
    for (const coarse of [true, false]) {
      for (const [w, h] of [
        [390, 664],
        [320, 568],
        [1280, 633],
        [2560, 1300],
        [664, 390],
      ] as const) {
        const l = layoutFor(w, h, 2, coarse, NONE);
        expect(l.room.w / l.room.h).toBeCloseTo(360 / 480, 12);
        expect(l.room.w).toBeCloseTo(360 * l.s, 9);
      }
    }
  });

  it("the room is inside the page wherever the game runs", () => {
    for (const coarse of [true, false]) {
      for (let w = 300; w <= 1500; w += 61) {
        for (let h = 400; h <= 1100; h += 47) {
          const l = layoutFor(w, h, 2, coarse, NONE);
          if (l.tooSmall) continue;
          const at = `${w} × ${h} ${coarse ? "phone" : "laptop"}`;
          expect(l.room.x, at).toBeGreaterThanOrEqual(-1e-9);
          expect(l.room.y, at).toBeGreaterThanOrEqual(BAR_H - 1e-9);
          expect(l.room.x + l.room.w, at).toBeLessThanOrEqual(w + 1e-9);
          expect(l.room.y + l.room.h, at).toBeLessThanOrEqual(h + 1e-9);
        }
      }
    }
  });
});
