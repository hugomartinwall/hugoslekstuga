import { describe, expect, it } from "vitest";
import { player, runNight, STEP1_NIGHT, nightSeed } from "../../lib/knuff/bots/driver";
import { KINDS } from "../../lib/knuff/content/kinds";
import { DEFAULT_TUNE } from "../../lib/knuff/content/tune";
import {
  BAR_H,
  BAR_MIN_W,
  DAZE_MARKS,
  EYE_U,
  LAPTOP_MARGIN,
  MIN_SCALE,
  bodyOrder,
  carriedAt,
  hintFor,
  hourStep,
  layoutFor,
  pauseKeyRect,
  type Insets,
  type Layout,
} from "../../lib/knuff/render/layout";
import { createState } from "../../lib/knuff/sim/state";
import { step } from "../../lib/knuff/sim/step";
import type { SimEvent, State, Thing } from "../../lib/knuff/sim/types";

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
      // A bar as narrow as that room would run the score into the clock: it keeps 360 px, centred on the room.
      expect(l.bar.w).toBe(BAR_MIN_W);
      expect(Math.abs(l.bar.x + l.bar.w / 2 - (l.room.x + l.room.w / 2))).toBeLessThanOrEqual(1);
    }
    expect(laptop(1280, 400, 1).tooSmall).toBe(true);
  });

  it("the window the owner judged the toy in, 768 × 479, is laid out as the final route lays it out", () => {
    expect(playable(768, 479, 1)).toEqual(laptop(768, 479, 1));
    // The room is 302 px there. The bar keeps 360, centred on it: six digits clear of the clock.
    const l = laptop(768, 479, 1);
    expect(Math.round(l.room.w)).toBe(302);
    expect(l.bar.w).toBe(BAR_MIN_W);
    expect(BAR_MIN_W).toBe(360);
    expect(Math.abs(l.bar.x + l.bar.w / 2 - (l.room.x + l.room.w / 2))).toBeLessThanOrEqual(1);
    // Where the room is 360 or wider the bar is the room's width, as before.
    expect(laptop(1280, 633, 1).bar.w).toBe(laptop(1280, 633, 1).room.w);
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

describe("the night's twelve steps in the top bar", () => {
  const tune = DEFAULT_TUNE;
  const REST = { launch: null, pullHeld: false };
  /** The twelve steps as the bar draws them. */
  const steps = (s: State) => Array.from({ length: 12 }, (_, i) => hourStep(s, i));
  const row = (done: number, now: boolean) =>
    Array.from({ length: 12 }, (_, i) => (i < done ? "done" : i === done && now ? "now" : "to come"));
  /** A night with nothing in it, begun at `hour` by a launch straight up. */
  const begun = (hour: number) => {
    const s = createState(7, tune, { hour, empty: true });
    step(s, { launch: { dx: 0, dy: -1, power: 1 }, pullHeld: false }, tune, []);
    expect(s.phase).toBe("night");
    return s;
  };

  it("before the first launch no hour is lit", () => {
    expect(steps(createState(7, tune, { empty: true }))).toEqual(row(0, false));
  });

  it("in a night the hours done are filled and the hour now is lit", () => {
    for (const hour of [0, 3, 10]) expect(steps(begun(hour)), `${hour}`).toEqual(row(hour, true));
  });

  it("at morning the first eleven are filled and the twelfth, the boss's, is to come: none is lit", () => {
    const s = begun(10);
    for (let i = 0; i < 5000 && s.phase !== "over"; i++) step(s, REST, tune, []);
    expect(s.ended).toBe("morning");
    // The State's hour is one past the last.
    expect(s.night.hour).toBe(11);
    expect(steps(s)).toEqual(row(11, false));
  });

  it("a night lost in 05:00 keeps 05:00 lit: the hour it was lost in", () => {
    const s = begun(10);
    s.hearts = 1;
    for (let i = 0; i < 300 && s.him.hot; i++) step(s, REST, tune, []);
    expect(s.him.hot).toBe(false);
    // A dust bunny walks into him while he is landed.
    const x = s.him.x + 30;
    const y = s.him.y;
    s.things.push({ id: s.nextId++, kind: "bunny", x, y, px: x, py: y, vx: 0, vy: 0, wx: 0, wy: 0, hp: 1, landTick: -1, dazedUntil: 0, phase: 0, worth0: false, fuseTick: -1, knockTick: -1, mine: false, launchId: -1, heading: 0, v: -1, goneTick: -1 });
    for (let i = 0; i < 300 && s.phase !== "over"; i++) step(s, REST, tune, []);
    expect(s.ended).toBe("hearts");
    expect(s.night.hour).toBe(10);
    expect(steps(s)).toEqual(row(10, true));
  });
});

describe("a dazed thing's marks (§9.5)", () => {
  const tune = DEFAULT_TUNE;
  const REST = { launch: null, pullHeld: false };
  const radius = (d: Thing) => KINDS[d.kind].radius;
  const dazed = (s: State, d: Thing) => s.tick < d.dazedUntil;
  /** How near a box, in units from the centre (cx, cy), comes to the point (ox, oy). */
  const reachOf = (b: { x: number; y: number; w: number; h: number }, cx: number, cy: number, ox: number, oy: number) => {
    const nx = Math.min(Math.max(ox, cx + b.x), cx + b.x + b.w);
    const ny = Math.min(Math.max(oy, cy + b.y), cy + b.y + b.h);
    return Math.hypot(nx - ox, ny - oy);
  };
  /** Do `d`'s marks touch `o`'s body? */
  const marksOn = (d: Thing, o: Thing) => DAZE_MARKS.some((m) => reachOf(m, d.x, d.y, o.x, o.y) <= radius(o));
  /** The marks as they were drawn until now: 2 u above the body. */
  const OLD_MARKS = (d: Thing) => [
    { x: -4.5, y: -radius(d) - 5, w: 3, h: 3 },
    { x: 1.5, y: -radius(d) - 5, w: 3, h: 3 },
  ];
  const put = (s: State, kind: Thing["kind"], x: number, y: number, dazedUntil = 0): Thing => {
    const d: Thing = { id: s.nextId++, kind, x, y, px: x, py: y, vx: 0, vy: 0, wx: 0, wy: 0, hp: 1, landTick: -1, dazedUntil, phase: 0, worth0: false, fuseTick: -1, knockTick: -1, mine: false, launchId: -1, heading: 0, v: -1, goneTick: -1 };
    s.things.push(d);
    return d;
  };

  it("are two 3 × 3 u squares, 3 u apart, on the middle row, well inside a dust bunny and a token", () => {
    const [a, b] = DAZE_MARKS;
    expect(DAZE_MARKS.length).toBe(2);
    for (const m of DAZE_MARKS) expect([m.w, m.h, m.y + m.h / 2]).toEqual([3, 3, 0]);
    expect(b.x - (a.x + a.w)).toBe(3);
    expect(a.x + b.x + b.w).toBe(0);
    for (const kind of ["bunny", "token"] as const) {
      // Every corner at least 2 u inside the body: rounding to device pixels cannot take a mark out of it.
      for (const m of DAZE_MARKS) {
        for (const [x, y] of [
          [m.x, m.y],
          [m.x + m.w, m.y],
          [m.x, m.y + m.h],
          [m.x + m.w, m.y + m.h],
        ]) {
          expect(Math.hypot(x, y), kind).toBeLessThanOrEqual(KINDS[kind].radius - 2);
        }
      }
    }
  });

  it("take the place of a dust bunny's eyes: each eye lies inside a mark", () => {
    const r = KINDS.bunny.radius;
    const eyes = [
      { x: -r / 2, y: -EYE_U / 2, w: EYE_U, h: EYE_U },
      { x: r / 2 - EYE_U, y: -EYE_U / 2, w: EYE_U, h: EYE_U },
    ];
    for (const [i, e] of eyes.entries()) {
      const m = DAZE_MARKS[i];
      expect(e.x).toBeGreaterThanOrEqual(m.x);
      expect(e.x + e.w).toBeLessThanOrEqual(m.x + m.w);
      expect(e.y).toBeGreaterThanOrEqual(m.y);
      expect(e.y + e.h).toBeLessThanOrEqual(m.y + m.h);
    }
  });

  it("the live things are drawn first and the dazed ones over them; announced things are not bodies yet", () => {
    const s = createState(7, tune, { empty: true });
    s.tick = 100;
    const a = put(s, "bunny", 100, 300, 130);
    const b = put(s, "token", 106, 301);
    const c = put(s, "token", 200, 300, 130);
    const d = put(s, "bunny", 207, 300);
    const e = put(s, "bunny", 260, 300);
    e.landTick = 120;
    const f = put(s, "bunny", 100, 100, 100);
    expect(bodyOrder(s, []).map((t) => t.id)).toEqual([b, d, f, a, c].map((t) => t.id));
    // A live thing across a dazed one's marks is under them.
    expect(marksOn(a, b) && marksOn(c, d)).toBe(true);
  });

  it("the opening rack after a weak straight first pull: no mark touches another body, where 2 u above it they lay on the bunny above", () => {
    let wereOnLive = 0;
    for (const power of [0.6, 0.7, 0.8]) {
      for (const seed of [1, 7, 42]) {
        const s = createState(seed, tune);
        step(s, { launch: { dx: 0, dy: -1, power }, pullHeld: false }, tune, []);
        for (let i = 0; i < 600 && s.him.hot; i++) step(s, REST, tune, []);
        const at = `power ${power}, seed ${seed}`;
        const out = s.things.filter((d) => dazed(s, d));
        expect(out.length, at).toBeGreaterThan(0);
        for (const d of out) {
          for (const o of s.things) {
            if (o === d) continue;
            expect(marksOn(d, o), at).toBe(false);
            if (!dazed(s, o) && OLD_MARKS(d).some((m) => reachOf(m, d.x, d.y, o.x, o.y) <= radius(o))) wereOnLive++;
          }
        }
      }
    }
    expect(wereOnLive).toBeGreaterThan(0);
  });

  it("in whole nights, no live body is ever drawn over a mark it touches", () => {
    let crossings = 0;
    const order: Thing[] = [];
    for (let i = 0; i < 6; i++) {
      runNight(nightSeed(i), player("kiter"), tune, STEP1_NIGHT, (_events, s) => {
        bodyOrder(s, order);
        for (const [di, d] of order.entries()) {
          if (!dazed(s, d)) continue;
          for (const [oi, o] of order.entries()) {
            if (o === d || !marksOn(d, o)) continue;
            crossings++;
            // Drawn before it, under it: the marks lie on its own body.
            if (!dazed(s, o)) expect(oi, `night ${i} tick ${s.tick}`).toBeLessThan(di);
          }
        }
      });
    }
    // The nights did bring a token across a dazed thing, and the other way round.
    expect(crossings).toBeGreaterThan(0);
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
