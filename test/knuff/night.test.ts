import { describe, expect, it } from "vitest";
import { KINDS, type Kind } from "../../lib/knuff/content/kinds";
import { BUNCH, CLOCK, HOURS, ROWS, SIX, type Row } from "../../lib/knuff/content/night";
import { PACE } from "../../lib/knuff/content/tune";
import { dealtRows, intruders, lastCall, paced, threats } from "../../lib/knuff/sim/night";
import { rand } from "../../lib/knuff/sim/rng";
import { createState, type StartOptions } from "../../lib/knuff/sim/state";
import { step } from "../../lib/knuff/sim/step";
import type { SimEvent, State, Tune } from "../../lib/knuff/sim/types";
import { REST, distance, fire, of, put, shot, tuned } from "./room";

/**
 * The night (§3.2 to §3.4): the timetable, the hour clock, arrivals, the
 * room's cap, and the pace the rows are dealt at.
 *
 * The rules are checked with no player. A night is begun by hand, with
 * things that stay where they land, so nothing ever reaches him and he
 * never moves; and what a player would do to the room, popping this and
 * leaving that, is done to the State directly, on the tick a case needs it.
 */

/** Things that stay where they land. */
const STILL = { bunnySpeed: 0, tokenSpeed: 0 };
const STEP1 = ["bunny", "token"];

type Seen = { hour: number; row: number; how: string; at: number; n: number; cut: number };

/** A night begun by hand in a given hour, and the means to do to its room what a player would. */
class Night {
  readonly tune: Tune;
  readonly s: State;
  readonly events: SimEvent[] = [];
  /** The tick each hour began. */
  readonly began: number[] = [];

  constructor(over: Partial<Tune> = {}, start: StartOptions = {}, seed = 1) {
    this.tune = tuned({ ...STILL, ...over });
    this.s = createState(seed, this.tune, start);
    this.s.phase = "night";
    this.began[this.s.night.hour] = 0;
  }

  /** Step `n` ticks; `after` is called after each one. */
  run(n: number, after?: () => void): this {
    for (let i = 0; i < n && this.s.phase !== "over"; i++) {
      const from = this.events.length;
      step(this.s, REST, this.tune, this.events);
      for (let k = from; k < this.events.length; k++) {
        const e = this.events[k];
        if (e.type === "hour") this.began[e.hour] = e.tick;
      }
      after?.();
    }
    return this;
  }

  /** Step until tick `tick` of the State has been taken. */
  through(tick: number, after?: () => void): this {
    return this.run(tick + 1 - this.s.tick, after);
  }

  /** The tick of the hour now. */
  get into(): number {
    return this.s.tick - this.s.night.hourStart;
  }

  /** Every row announced so far, with the tick of its hour it came on. */
  rows(hour?: number): Seen[] {
    return of(this.events, "row")
      .filter((e) => hour === undefined || e.hour === hour)
      .map((e) => ({ hour: e.hour, row: e.row, how: e.how, at: e.tick - this.began[e.hour], n: e.n, cut: e.cut }));
  }

  /**
   * A player who pops everything the moment it has landed. (Called between
   * two ticks: a thing has landed if its landing tick is one already taken.)
   */
  popLanded = (): void => {
    const s = this.s;
    s.things = s.things.filter((d) => d.landTick >= s.tick);
  };

  /** Pop landed things until `n` are left in the room, announced ones included. */
  leave(n: number): this {
    const s = this.s;
    while (s.things.length > n) {
      const i = s.things.findIndex((d) => d.landTick < s.tick);
      if (i < 0) throw new Error(`cannot leave ${n}: ${s.things.length} are still announced`);
      s.things.splice(i, 1);
    }
    return this;
  }

  /** Take everything out of the room, announced or not. */
  empty(): this {
    this.s.things.length = 0;
    return this;
  }

  /**
   * Play on, popping everything as it lands, until the hour's first extra
   * bunch has been announced. It gives up after two hours' worth of ticks:
   * a night that deals no extra bunch must fail the case, not hang it.
   */
  toFirstExtra(): Seen {
    for (let i = 0; i < 3600 && this.s.phase !== "over" && this.rows().every((r) => r.row !== -1); i++) this.run(1, this.popLanded);
    const extra = this.rows().find((r) => r.row === -1);
    if (!extra) throw new Error(`no extra bunch was announced from ${CLOCK[this.s.night.hour]} on`);
    return extra;
  }
}

/** The intruders a written row brings, by kind. */
function count(row: Row, kind?: Kind): number {
  return row.parts.filter((p) => (kind ? p.kind === kind : p.kind !== "polisher" && KINDS[p.kind].intruder)).reduce((sum, p) => sum + p.n, 0);
}
const hourRows = (hour: number) => ROWS.filter((r) => r.hour === hour);

describe("the timetable as written", () => {
  it("is eleven hours, 19:00 to 05:00, with the boss at 06:00 and morning at 07:00", () => {
    expect(HOURS).toBe(11);
    expect(CLOCK).toEqual(["19:00", "20:00", "21:00", "22:00", "23:00", "00:00", "01:00", "02:00", "03:00", "04:00", "05:00", "06:00", "07:00"]);
    expect(new Set(ROWS.map((r) => r.hour))).toEqual(new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
    // In the table's order: by hour, then by tick.
    for (let i = 1; i < ROWS.length; i++) {
      const a = ROWS[i - 1];
      const b = ROWS[i];
      expect(b.hour > a.hour || (b.hour === a.hour && b.tick > a.tick), `row ${i}`).toBe(true);
    }
    expect(ROWS).toHaveLength(35);
  });

  it("every hour's rows add up to 24 or fewer: 12, 11, 13, 15, 23, 20, 18, 22, 24, 24, 24", () => {
    const totals = Array.from({ length: HOURS }, (_, h) => hourRows(h).reduce((sum, r) => sum + count(r), 0));
    expect(totals).toEqual([12, 11, 13, 15, 23, 20, 18, 22, 24, 24, 24]);
    for (const total of totals) expect(total).toBeLessThanOrEqual(tuned().roomCap);
  });

  it("holds 206 intruders: 118 dust bunnies, 51 tokens, 25 envelopes, 6 batteries, 5 gum and the money bag", () => {
    const all = (kind?: Kind) => ROWS.reduce((sum, r) => sum + count(r, kind), 0);
    expect(all()).toBe(206);
    expect([all("bunny"), all("token"), all("envelope"), all("battery"), all("gum"), all("bag")]).toEqual([118, 51, 25, 6, 5, 1]);
    // And one heart, which is not an intruder.
    expect(all("heart")).toBe(1);
    expect(KINDS.heart.intruder).toBe(false);
  });

  it("each new kind's first row is alone, at tick 0 of its hour", () => {
    const firsts = ROWS.filter((r) => r.first !== "");
    expect(firsts.map((r) => [r.first, r.hour, r.tick])).toEqual([
      ["token", 1, 0],
      ["gum", 2, 0],
      ["battery", 3, 0],
      ["envelope", 4, 0],
      ["bag", 5, 0],
    ]);
    for (const r of firsts) {
      // The only thing its row brings, and the first row of its hour: the only thing that hour has sent so far.
      expect(r.parts.map((p) => p.kind)).toEqual([r.first]);
      expect(hourRows(r.hour)[0]).toBe(r);
      // And no row before it brings that kind.
      const earlier = ROWS.slice(0, ROWS.indexOf(r));
      expect(earlier.some((e) => e.parts.some((p) => p.kind === r.first))).toBe(false);
    }
    // Every kind of intruder but the dust bunny is brought in that way.
    const kinds = new Set(ROWS.flatMap((r) => r.parts.map((p) => p.kind)).filter((k) => k !== "polisher" && KINDS[k].intruder));
    expect([...kinds].sort()).toEqual(["bag", "battery", "bunny", "envelope", "gum", "token"]);
    // One thing alone, but for the newsletter, which is five envelopes in a V.
    expect(firsts.map((r) => r.parts[0].n)).toEqual([1, 1, 1, 5, 1]);
  });

  it("every tabled bunch has its hour's size", () => {
    expect(BUNCH).toEqual([
      [4, 0],
      [5, 0],
      [5, 1],
      [6, 1],
      [6, 1],
      [6, 2],
      [7, 2],
      [7, 2],
      [8, 2],
      [8, 3],
      [8, 3],
    ]);
    let bunches = 0;
    for (const r of ROWS) {
      const blob = r.parts.find((p) => p.kind === "bunny");
      if (!blob) continue;
      bunches++;
      // The dust bunnies, and what was swapped in for some of them, are the hour's dust bunnies; its loose tokens are the hour's tokens.
      const swapped = r.parts.reduce((sum, p) => sum + p.swapped, 0);
      const loose = r.parts.filter((p) => p.kind === "token" && p.form === "loose").reduce((sum, p) => sum + p.n, 0);
      expect(blob.n + swapped, `${CLOCK[r.hour]} tick ${r.tick}`).toBe(BUNCH[r.hour][0]);
      expect(loose, `${CLOCK[r.hour]} tick ${r.tick}`).toBe(BUNCH[r.hour][1]);
    }
    expect(bunches).toBe(23);
    // Gum under a bunch is an extra piece of floor, except at 05:00, where it takes a dust bunny's place.
    const gum = ROWS.flatMap((r) => r.parts.filter((p) => p.kind === "gum" && p.form === "under").map((p) => [r.hour, p.swapped]));
    expect(gum).toEqual([
      [4, 0],
      [7, 0],
      [8, 0],
      [10, 1],
    ]);
  });

  it("every tabled row is announced by tick 684, so everything has landed by tick 720", () => {
    expect(new Set(ROWS.map((r) => r.tick))).toEqual(new Set([0, 228, 342, 456, 513, 684]));
    expect(Math.max(...ROWS.map((r) => r.tick)) + tuned().telegraphTicks).toBe(720);
  });

  it("the files of tokens come at tick 513: three from 23:00 to 03:00, two at 04:00 and 05:00", () => {
    const files = ROWS.filter((r) => r.parts.some((p) => p.form === "file"));
    expect(files.map((r) => [r.hour, r.tick, r.parts[0].n])).toEqual([
      [4, 513, 3],
      [5, 513, 3],
      [7, 513, 3],
      [8, 513, 3],
      [9, 513, 2],
      [10, 513, 2],
    ]);
  });

  it("the love heart has one line, at tick 342 of 01:00, and 06:00 has the polisher's three", () => {
    const heart = ROWS.filter((r) => r.parts.some((p) => p.kind === "heart"));
    expect(heart.map((r) => [r.hour, r.tick, r.parts.length])).toEqual([[6, 342, 1]]);
    expect(SIX.map((l) => [l.when, l.tick, l.kind, l.n, l.worth0])).toEqual([
      ["tick", 0, "polisher", 1, false],
      ["every", 240, "bunny", 1, true],
      ["plugHit", 0, "bunny", 3, true],
    ]);
  });
});

describe("what a night deals", () => {
  const dealt = dealtRows(STEP1);
  const shape = (hour: number) => dealt[hour].map((d) => [d.row, d.tick, d.bunnies, d.loose, d.file]);

  it("the step-1 night: dust bunnies and tokens, every other kind left out of its rows", () => {
    expect(shape(0)).toEqual([
      [0, 0, 4, 0, 0],
      [1, 228, 4, 0, 0],
      [2, 456, 4, 0, 0],
    ]);
    expect(shape(1)).toEqual([
      [0, 0, 0, 1, 0],
      [1, 228, 5, 0, 0],
      [2, 456, 5, 0, 0],
    ]);
    expect(shape(6)).toEqual([
      [0, 0, 7, 2, 0],
      [2, 684, 7, 2, 0],
    ]);
    expect(shape(7)).toEqual([
      [0, 0, 6, 2, 0],
      [1, 342, 2, 2, 0],
      [2, 513, 0, 0, 3],
    ]);
    expect(shape(8)).toEqual([
      [0, 0, 7, 2, 0],
      [1, 342, 7, 2, 0],
      [2, 513, 0, 0, 3],
    ]);
    expect(shape(9)).toEqual([
      [0, 0, 3, 3, 0],
      [1, 342, 3, 3, 0],
      [2, 513, 0, 0, 2],
    ]);
    expect(shape(10)).toEqual([
      [0, 0, 6, 3, 0],
      [1, 342, 3, 3, 0],
      [2, 513, 0, 0, 2],
    ]);
    expect(dealt[0][0].rack).toBe(true);
    expect(dealt[1][0].alone).toBe(true);
    expect(dealt.flat().filter((d) => d.rack)).toHaveLength(1);
  });

  it("a row keeps its dust bunnies and tokens: nothing is swapped back in for what is left out", () => {
    // 23:00's first bunch is five dust bunnies and a token: the battery's place stays empty.
    expect(shape(4)[0].slice(2)).toEqual([5, 1, 0]);
    // 02:00's second is two dust bunnies and two tokens: the five envelopes are not made up.
    expect(shape(7)[1].slice(2)).toEqual([2, 2, 0]);
    const all = dealt.flat();
    expect(all.reduce((sum, d) => sum + d.bunnies, 0)).toBe(118);
    expect(all.reduce((sum, d) => sum + d.loose + d.file, 0)).toBe(51);
  });

  it("a row left empty is skipped, and the four hours whose opening row is left empty are shifted", () => {
    // 21:00 to 00:00 open with gum, a battery, the newsletter and the money
    // bag. With those left out, the bunches written at ticks 342 and 684
    // are announced at ticks 0 and 342. A file stays at 513.
    expect(shape(2)).toEqual([
      [1, 0, 5, 1, 0],
      [2, 342, 5, 1, 0],
    ]);
    expect(shape(3)).toEqual([
      [1, 0, 6, 1, 0],
      [2, 342, 6, 1, 0],
    ]);
    // 23:00 and 00:00: bunch, bunch, file.
    expect(shape(4)).toEqual([
      [1, 0, 5, 1, 0],
      [3, 342, 6, 1, 0],
      [2, 513, 0, 0, 3],
    ]);
    expect(shape(5)).toEqual([
      [1, 0, 6, 2, 0],
      [3, 342, 6, 2, 0],
      [2, 513, 0, 0, 3],
    ]);
    // So every hour of this night has a first row at tick 0.
    for (let hour = 0; hour < HOURS; hour++) expect(dealt[hour][0].tick, CLOCK[hour]).toBe(0);
    // The shift belongs to the leaving-out: the table itself still says 342 and 684.
    expect(hourRows(4).map((r) => r.tick)).toEqual([0, 342, 513, 684]);
  });

  it("an hour whose opening row is dealt keeps its written ticks", () => {
    // 01:00 opens with a bunch: its second bunch stays at 684.
    expect(shape(6).map((r) => r[1])).toEqual([0, 684]);
    expect(shape(0).map((r) => r[1])).toEqual([0, 228, 456]);
  });

  it("the love heart's line is passed over: it is not a row of the order", () => {
    // 01:00 has three written lines; the night deals the first and the third.
    expect(hourRows(6)).toHaveLength(3);
    expect(dealt[6].map((d) => d.row)).toEqual([0, 2]);
  });

  it("a first row holds the next one back; no other does", () => {
    expect(dealt.flat().filter((d) => d.first).map((d) => [d.row, d.loose])).toEqual([[0, 1]]);
    expect(dealt[1][0].first).toBe(true);
  });

  it("a kind not listed is left out; a night of no kinds deals nothing", () => {
    const bunnies = dealtRows(["bunny"]);
    expect(bunnies.flat().every((d) => d.loose === 0 && d.file === 0)).toBe(true);
    expect(bunnies.flat().reduce((sum, d) => sum + d.bunnies, 0)).toBe(118);
    // With the first token left out, 20:00's opening row is empty too; its bunches are at 228 and 456, and stay there.
    expect(bunnies[1].map((d) => d.tick)).toEqual([228, 456]);
    // The files are rows of tokens: left empty, and skipped.
    expect(bunnies[7].map((d) => d.row)).toEqual([0, 1]);
    expect(dealtRows([]).flat()).toEqual([]);
  });

  it("is the same answer every time, for the same list, however the list is held", () => {
    expect(dealtRows(["bunny", "token"])).toBe(dealt);
    const mine = ["bunny"];
    const first = dealtRows(mine);
    mine.push("token");
    // A list changed in place is read again, not remembered by the look of it.
    expect(dealtRows(mine)).toBe(dealt);
    expect(first).not.toBe(dealt);
    // And dealing changes nothing in the table.
    expect(ROWS[7].tick).toBe(342);
  });
});

describe("pace 1: the table as written", () => {
  it("every row is announced at its tick, whole, and there is no extra bunch", () => {
    const night = new Night({ pace: 1 });
    night.run(30000, night.popLanded);
    expect(night.s.ended).toBe("morning");
    const expected: Seen[] = [];
    dealtRows(STEP1).forEach((rows, hour) => {
      for (const d of rows) expected.push({ hour, row: d.row, how: "tick", at: d.tick, n: d.bunnies + d.loose + d.file, cut: 0 });
    });
    expect(night.rows()).toEqual(expected);
    expect(night.rows().reduce((sum, r) => sum + r.n, 0)).toBe(169);
  });

  it("a row is not called early, however empty the room, and no clock brings one", () => {
    const night = new Night({ pace: 1 }, { hour: 6 });
    night.run(1).empty().run(683);
    expect(night.rows()).toEqual([{ hour: 6, row: 0, how: "tick", at: 0, n: 9, cut: 0 }]);
    night.run(1);
    expect(night.rows()[1]).toEqual({ hour: 6, row: 2, how: "tick", at: 684, n: 9, cut: 0 });
    // With the room full it waits just the same.
    const full = new Night({ pace: 1 }, { hour: 6 });
    full.through(683);
    expect(full.rows()).toHaveLength(1);
    expect(paced(full.tune)).toBe(false);
  });

  it("the pace's five numbers are not used", () => {
    // The same night whatever they say.
    const plain = new Night({ pace: 1 }).run(4000);
    const odd = new Night({ pace: 1, paceRoom: 99, paceEvery: 1, paceLastCall: 1700, paceLastCallFirst: 1700, paceTokens: 9 }).run(4000);
    expect(odd.rows()).toEqual(plain.rows());
    expect(odd.s.things).toEqual(plain.s.things);
  });
});

describe("arrivals", () => {
  it("every arrival is announced 36 ticks before it lands; only the rack has no telegraph", () => {
    for (const pace of [1, 2, 3]) {
      const night = new Night({ pace });
      // The rack is in the room before the night begins: landed, with no telegraph and no landing.
      expect(night.s.things.map((d) => d.landTick)).toEqual([-1, -1, -1, -1]);
      night.run(20000, night.popLanded);
      const announced = new Map(of(night.events, "announce").map((e) => [e.id, e]));
      const arrived = of(night.events, "arrive");
      expect(arrived.length).toBeGreaterThan(150);
      for (const e of arrived) {
        const a = announced.get(e.id);
        if (!a) expect.fail(`thing ${e.id} landed at tick ${e.tick} with no telegraph`);
        else {
          expect(e.tick - a.tick).toBe(36);
          expect(a.landTick).toBe(e.tick);
          expect([e.x, e.y]).toEqual([a.x, a.y]);
        }
      }
      // And nothing of the rack was ever announced or landed.
      expect([1, 2, 3, 4].some((id) => announced.has(id) || arrived.some((e) => e.id === id))).toBe(false);
      expect(tuned().telegraphTicks).toBe(36);
    }
  });

  it("an announced thing does not move, and cannot be touched: he flies through it", () => {
    const tune = tuned();
    const s = createState(1, tune, { empty: true });
    const token = put(s, "token", 180, 374 - 60, { landTick: 200, vx: 150, vy: 0 });
    const bunny = put(s, "bunny", 180, 374 - 120, { landTick: 200 });
    const events = fire(s, tune, shot(0, -1), 20);
    expect(of(events, "pop")).toEqual([]);
    expect(s.him.y).toBeLessThan(374 - 150);
    expect([token.x, token.y, bunny.x, bunny.y]).toEqual([180, 314, 180, 254]);
  });

  it("an arrival that lands within 60 u of him lands dazed for 36 ticks; at 60.01 it does not", () => {
    const night = new Night({}, { empty: true });
    const s = night.s;
    const close = put(s, "bunny", 180 + 60, 374, { landTick: 5 });
    const far = put(s, "bunny", 180 - 60.01, 374, { landTick: 5 });
    const token = put(s, "token", 180, 374 - 59, { landTick: 5 });
    night.through(5);
    expect(close.dazedUntil).toBe(5 + 36);
    expect(far.dazedUntil).toBe(0);
    expect(token.dazedUntil).toBe(41);
    expect(of(night.events, "arrive").map((e) => [e.id, Math.round(e.dist * 100) / 100, e.dazed])).toEqual([
      [close.id, 60, true],
      [far.id, 60.01, false],
      [token.id, 59, true],
    ]);
    expect(of(night.events, "daze").map((e) => [e.id, e.until])).toEqual([
      [close.id, 41],
      [token.id, 41],
    ]);
    expect(night.tune.arriveDazedWithin).toBe(60);
  });

  it("a dazed token stands still for its 36 ticks, then rolls on the way it was rolling", () => {
    const night = new Night({ tokenSpeed: 150 }, { empty: true });
    const s = night.s;
    // It lands 50 u from him, pointed up the room and away.
    const token = put(s, "token", 180 + 40, 374 - 30, { landTick: 5, vx: 0, vy: -150 });
    night.through(5);
    expect(token.dazedUntil).toBe(41);
    for (let t = 6; t <= 40; t++) {
      night.through(t);
      expect([token.x, token.y], `tick ${t}`).toEqual([220, 344]);
    }
    // Its roll was kept all the while.
    expect([token.vx, token.vy]).toEqual([0, -150]);
    night.through(41);
    expect([token.x, token.y]).toEqual([220, 344 - 150 / 60]);
    night.through(50);
    expect(token.y).toBeCloseTo(344 - (10 * 150) / 60, 9);
    // A dazed dust bunny does not walk, but a shove still carries it: it slides.
    const walking = new Night({ bunnySpeed: 22 }, { empty: true });
    const still = put(walking.s, "bunny", 180 + 100, 374, { dazedUntil: 30 });
    const shoved = put(walking.s, "bunny", 180 - 100, 374, { dazedUntil: 30, vx: -60 });
    walking.through(20);
    expect([still.x, still.y]).toEqual([280, 374]);
    expect(shoved.x).toBeLessThan(80 - 5);
    walking.through(40);
    expect(still.x).toBeLessThan(280);
  });

  it("a far spot is at least 150 u from him when it is announced", () => {
    // A token by itself or loose is at its own far spot; a file's head is at one.
    let tokens = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const night = new Night({ pace: 3 }, {}, seed);
      night.run(6000, night.popLanded);
      const rowsOf = of(night.events, "announce").filter((e) => e.kind === "token");
      for (const e of rowsOf) {
        tokens++;
        // (A file's later tokens trail its head by 24 u each: at most 48 u nearer.)
        expect(distance(night.s, e)).toBeGreaterThanOrEqual(150 - 48);
      }
      // A blob's far spot is its middle: no dust bunny is nearer than the blob's own radius allows.
      for (const e of of(night.events, "announce").filter((a) => a.kind === "bunny")) {
        expect(distance(night.s, e)).toBeGreaterThanOrEqual(150 - (8 + 9 * Math.sqrt(8)) - 17);
      }
    }
    expect(tokens).toBeGreaterThan(100);
    expect(tuned().arriveMinDist).toBe(150);
  });

  it("it is the first of up to 24 points that is far enough, and the farthest of the 24 if none is", () => {
    // The first token of 20:00 comes alone: two draws for each point tried, and one for the way it rolls.
    const draws = (over: Partial<Tune>): number => {
      const night = new Night(over, { hour: 1 }, 7);
      const stream = { ...night.s.rng };
      night.run(1);
      expect(night.s.things).toHaveLength(1);
      for (let n = 0; n <= 60; n++) {
        if (stream.arrivals === night.s.rng.arrivals) return n;
        rand(stream, "arrivals");
      }
      return -1;
    };
    // Any point will do: the first is taken.
    expect(draws({ arriveMinDist: 0 })).toBe(3);
    // No point of the room is this far: all 24 are tried.
    expect(draws({ arriveMinDist: 1e6 })).toBe(49);
    const none = new Night({ arriveMinDist: 1e6 }, { hour: 1 }, 7);
    none.run(1);
    // Of 24 points drawn over the floor, the farthest from a mascot near the bottom is far up the room.
    expect(distance(none.s, none.s.things[0])).toBeGreaterThan(250);
  });

  it("a token alone is 20 u clear of every cushion, a loose one 9 u, and a file's head 60 u", () => {
    /** How close a thing is to the nearest cushion. */
    const clear = (d: { x: number; y: number }) => Math.min(d.x - 8, 352 - d.x, d.y - 8, 472 - d.y);
    const alone: number[] = [];
    const loose: number[] = [];
    const heads: number[] = [];
    for (let seed = 1; seed <= 60; seed++) {
      // 20:00 opens with the first token, alone.
      alone.push(clear(new Night({}, { hour: 1 }, seed).run(1).s.things[0]));
      // 04:00 opens with a bunch that has three loose tokens.
      for (const d of new Night({}, { hour: 9 }, seed).run(1).s.things) if (d.kind === "token") loose.push(clear(d));
      // 04:00's file, at pace 1, on its tick.
      const file = new Night({ pace: 1 }, { hour: 9 }, seed).through(512);
      file.empty().run(1);
      heads.push(clear(file.s.things[0]));
    }
    // Each kind of spot keeps its own distance, and comes as close as that distance allows: no nearer, and not kept further off.
    expect(Math.min(...alone)).toBeGreaterThanOrEqual(20);
    expect(Math.min(...alone)).toBeLessThan(40);
    expect(Math.min(...loose)).toBeGreaterThanOrEqual(9);
    expect(Math.min(...loose)).toBeLessThan(20);
    expect(Math.min(...heads)).toBeGreaterThanOrEqual(60);
    expect(Math.min(...heads)).toBeLessThan(80);
    expect(loose).toHaveLength(180);
  });

  it("a blob's spot is far enough in that its whole disc is on the floor: no dust bunny is pressed against a cushion", () => {
    let pressed = 0;
    let bunnies = 0;
    for (let seed = 1; seed <= 60; seed++) {
      for (const d of new Night({}, { hour: 8 }, seed).run(1).s.things) {
        if (d.kind !== "bunny") continue;
        bunnies++;
        // A dust bunny clamped to the floor's edge sits exactly its radius from it.
        if (d.x === 16 || d.x === 344 || d.y === 16 || d.y === 464) pressed++;
        expect(Math.min(d.x - 8, 352 - d.x, d.y - 8, 472 - d.y)).toBeGreaterThanOrEqual(8);
      }
    }
    expect(bunnies).toBe(60 * 7);
    expect(pressed).toBe(0);
  });

  it("a blob: dust bunnies scattered round one spot, pushed apart to 17 u", () => {
    let blobs = 0;
    for (let seed = 1; seed <= 40; seed++) {
      for (const hour of [0, 3, 6, 8]) {
        const night = new Night({ pace: 1 }, { hour }, seed).run(1);
        const bunnies = night.s.things.filter((d) => d.kind === "bunny" && d.landTick > 0);
        const n = bunnies.length;
        if (n === 0) continue;
        blobs++;
        expect(n).toBe(dealtRows(STEP1)[hour][0].rack ? 0 : dealtRows(STEP1)[hour][0].bunnies);
        const cx = bunnies.reduce((sum, d) => sum + d.x, 0) / n;
        const cy = bunnies.reduce((sum, d) => sum + d.y, 0) / n;
        const R = 8 + 9 * Math.sqrt(n);
        for (let a = 0; a < n; a++) {
          // Inside the disc, give or take the push apart.
          expect(Math.hypot(bunnies[a].x - cx, bunnies[a].y - cy)).toBeLessThan(R + 20);
          for (let b = a + 1; b < n; b++) {
            expect(Math.hypot(bunnies[a].x - bunnies[b].x, bunnies[a].y - bunnies[b].y)).toBeGreaterThan(17 - 1e-3);
          }
        }
      }
    }
    expect(blobs).toBeGreaterThan(100);
  });

  it("a blob is as wide as its disc: seven dust bunnies lie 8 + 9√7 over √2 from their middle, on average", () => {
    // Points scattered evenly over a disc of radius R lie R / √2 from its
    // centre, root mean square. The push apart and measuring from their own
    // middle move that by a fraction of a unit; a disc of 8 + 8√7 is 1.9 u short.
    let sum = 0;
    let count = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const bunnies = new Night({}, { hour: 8 }, seed).run(1).s.things.filter((d) => d.kind === "bunny");
      expect(bunnies).toHaveLength(7);
      const cx = bunnies.reduce((t, d) => t + d.x, 0) / 7;
      const cy = bunnies.reduce((t, d) => t + d.y, 0) / 7;
      for (const d of bunnies) {
        sum += (d.x - cx) ** 2 + (d.y - cy) ** 2;
        count++;
      }
    }
    const want = (8 + 9 * Math.sqrt(7)) / Math.SQRT2;
    expect(Math.abs(Math.sqrt(sum / count) - want)).toBeLessThan(0.6);
  });

  it("loose tokens each roll their own way; a file is a line 24 u apart, all rolling the way the line points", () => {
    const rolling = { tokenSpeed: 150 };
    // 01:00's opening bunch has two loose tokens.
    const loose = new Night(rolling, { hour: 6 }, 3).run(1);
    const two = loose.s.things.filter((d) => d.kind === "token");
    expect(two).toHaveLength(2);
    for (const t of two) expect(Math.hypot(t.vx, t.vy)).toBeCloseTo(150, 9);
    expect(two[0].vx).not.toBeCloseTo(two[1].vx, 3);
    // The blob is placed first, then each token.
    const ids = loose.s.things.map((d) => [d.kind, d.id]);
    expect(ids.slice(0, 7).every(([kind]) => kind === "bunny")).toBe(true);
    expect(ids.slice(7).every(([kind]) => kind === "token")).toBe(true);
    // 02:00's file, at pace 1, on its tick.
    for (let seed = 1; seed <= 10; seed++) {
      const file = new Night({ ...rolling, pace: 1, hearts: 99 }, { hour: 7 }, seed).through(512);
      file.empty().run(1);
      const tokens = file.s.things;
      expect(tokens.map((d) => d.kind)).toEqual(["token", "token", "token"]);
      const [head, second, third] = tokens;
      const ux = head.vx / 150;
      const uy = head.vy / 150;
      expect(Math.hypot(ux, uy)).toBeCloseTo(1, 9);
      for (const t of tokens) expect([t.vx, t.vy]).toEqual([head.vx, head.vy]);
      // The head leads: the others trail it along the line.
      expect(second.x).toBeCloseTo(head.x - ux * 24, 9);
      expect(second.y).toBeCloseTo(head.y - uy * 24, 9);
      expect(third.x).toBeCloseTo(head.x - ux * 48, 9);
      expect(third.y).toBeCloseTo(head.y - uy * 48, 9);
      // The head is 60 u clear of every cushion, so the whole file is on the floor.
      expect(head.x).toBeGreaterThanOrEqual(8 + 60);
      expect(head.x).toBeLessThanOrEqual(352 - 60);
    }
  });
});

describe("the hour clock", () => {
  it("an hour is clear at the first tick when every row has been announced and nothing is alive or announced", () => {
    const night = new Night({ pace: 1 }, { hour: 6 });
    // The room is emptied while the second bunch is still to come: not clear.
    night.through(40).empty().through(683);
    expect(night.s.night.clearTick).toBe(-1);
    // The second bunch is announced on tick 684: every row is out, and the room is not empty.
    night.run(1);
    expect(night.s.night.nextRow).toBe(2);
    expect(night.s.night.clearTick).toBe(-1);
    // Taken out while it is still announced, on tick 700: the hour is clear on the next tick.
    night.through(700).empty().run(1);
    expect(night.s.night.clearTick).toBe(701);
    expect(of(night.events, "clear")).toEqual([{ type: "clear", tick: 701, hour: 6 }]);
  });

  it("an announced thing counts: the hour is not clear while a telegraph is up", () => {
    const night = new Night({ pace: 1 }, { hour: 6 });
    night.through(684);
    // Everything that has landed is popped; the second bunch is still announced.
    night.popLanded();
    expect(night.s.things.length).toBe(9);
    night.through(719);
    expect(night.s.night.clearTick).toBe(-1);
    // It lands on tick 720 and is popped: clear on 721.
    night.run(1);
    night.popLanded();
    night.run(1);
    expect(night.s.night.clearTick).toBe(721);
  });

  it("the next hour starts 180 ticks after the hour is clear", () => {
    const night = new Night({ pace: 1 }, { hour: 6 });
    night.through(700).empty().through(880);
    expect(night.s.night.hour).toBe(6);
    expect([night.s.night.clearTick, night.s.night.offerTick, night.s.night.settledTick]).toEqual([701, 701, 701]);
    night.run(1);
    expect(night.s.night.hour).toBe(7);
    expect(night.s.night.hourStart).toBe(881);
    expect(of(night.events, "hour")).toEqual([{ type: "hour", tick: 881, hour: 7 }]);
    expect(night.tune.hourPauseTicks).toBe(180);
    // Its first row is announced on its tick 0, the tick the hour changes.
    expect(night.rows(7)).toEqual([{ hour: 7, row: 0, how: "tick", at: 0, n: 8, cut: 0 }]);
  });

  it("an hour not clear by tick 1,320 gets its offer then; with nothing to offer it is settled at once", () => {
    const night = new Night({ pace: 1 }, { hour: 6 });
    night.through(1319);
    expect([night.s.night.clearTick, night.s.night.offerTick, night.s.night.settledTick]).toEqual([-1, -1, -1]);
    night.run(1);
    expect([night.s.night.clearTick, night.s.night.offerTick, night.s.night.settledTick]).toEqual([-1, 1320, 1320]);
    expect(night.tune.offerLatestTick).toBe(1320);
    // Settled is not clear: the hour goes on.
    night.through(1500);
    expect(night.s.night.hour).toBe(6);
    // Cleared now, it ends 180 ticks after it is both: at 1,681.
    night.empty().through(1680);
    expect(night.s.night.clearTick).toBe(1501);
    expect(night.s.night.hour).toBe(6);
    night.run(1);
    expect(night.s.night.hour).toBe(7);
    expect(night.s.night.hourStart).toBe(1681);
  });

  it("an hour never lasts longer than 1,800 ticks: cleared at 1,700, it ends at 1,800, not at 1,881", () => {
    const night = new Night({ pace: 1 }, { hour: 6 });
    night.through(1699).empty().through(1799);
    expect(night.s.night.clearTick).toBe(1700);
    expect(night.s.night.hour).toBe(6);
    night.run(1);
    expect(night.s.night.hour).toBe(7);
    expect(night.s.night.hourStart).toBe(1800);
    expect(night.tune.hourMaxTicks).toBe(1800);
  });

  it("an hour that is never cleared ends at tick 1,800, and the next arrives on top of what is left", () => {
    const night = new Night({ pace: 1 }, { hour: 6 });
    night.through(1799);
    expect(night.s.night.hour).toBe(6);
    const left = night.s.things.map((d) => d.id);
    expect(left).toHaveLength(18);
    night.run(1);
    expect(night.s.night.hour).toBe(7);
    // Everything stays, and still counts: for clear, and toward the cap.
    expect(night.s.things.map((d) => d.id).slice(0, 18)).toEqual(left);
    expect(threats(night.s)).toBe(24);
    expect(night.rows(7)).toEqual([{ hour: 7, row: 0, how: "tick", at: 0, n: 6, cut: 2 }]);
    // Things left over from an earlier hour keep the new one from being clear.
    night.through(1800 + 600);
    expect(night.s.night.clearTick).toBe(-1);
  });

  it("when the hour changes, its books are opened afresh", () => {
    const night = new Night({ pace: 2 }, { hour: 0 });
    night.run(3000, night.popLanded);
    expect(night.s.night.hour).toBeGreaterThanOrEqual(1);
    const began = night.began[1];
    const at = new Night({ pace: 2 }, { hour: 0 });
    at.through(began, at.popLanded);
    // The tick 20:00 began: its first row, the first token, has been announced, and nothing else of the hour is known.
    expect(at.s.night).toMatchObject({ hour: 1, hourStart: began, nextRow: 1, rowTick: began, rowLandTick: began + 36, clearTick: -1, offerTick: -1, settledTick: -1 });
    const token = at.s.things[at.s.things.length - 1];
    expect(token.kind).toBe("token");
    expect([at.s.night.holdFrom, at.s.night.holdTo]).toEqual([token.id, token.id + 1]);
  });

  it("when 05:00 ends, morning comes, and nothing is added to the score", () => {
    const night = new Night({ pace: 1 }, { hour: 10 });
    night.s.score = 4321;
    night.s.bestShot = 250;
    night.through(1799);
    expect(night.s.phase).toBe("night");
    expect(night.s.night.hour).toBe(10);
    night.run(1);
    expect(night.s.phase).toBe("over");
    expect(night.s.ended).toBe("morning");
    expect(night.s.night.hour).toBe(11);
    expect(night.s.score).toBe(4321);
    expect(night.s.bestShot).toBe(250);
    expect(night.s.hearts).toBe(3);
    expect(night.events.slice(-1)).toEqual([{ type: "over", tick: 1800, how: "morning", score: 4321 }]);
    // The tick is counted, and no twelfth hour is announced.
    expect(night.s.tick).toBe(1801);
    expect(of(night.events, "hour")).toEqual([]);
    expect(night.rows(11)).toEqual([]);
  });

  it("the night's first hour is announced on the tick of the first launch", () => {
    const tune = tuned();
    const s = createState(1, tune);
    const events = fire(s, tune, shot(0, -1));
    expect(events.filter((e) => e.type === "hour")).toEqual([{ type: "hour", tick: 0, hour: 0 }]);
    expect(events[0].type).toBe("hour");
  });

  it("eleven hours that are never cleared take 19,800 ticks, and no night of the first two minutes can be longer", () => {
    for (const pace of [1, 2, 3]) {
      const night = new Night({ pace });
      night.run(30000);
      expect(night.s.ended).toBe("morning");
      expect(night.s.tick).toBe(11 * 1800 + 1);
      expect(night.began.slice(0, 11)).toEqual([0, 1800, 3600, 5400, 7200, 9000, 10800, 12600, 14400, 16200, 18000]);
    }
  });
});

describe("the room's cap", () => {
  /** A night at pace 1 in 22:00, whose opening row is six dust bunnies and a token, with `held` things in the room already. */
  function crowded(held: number): Night {
    const night = new Night({ pace: 1 }, { hour: 3 });
    for (let i = 0; i < held; i++) put(night.s, "bunny", 20 + (i % 12) * 26, 30 + Math.floor(i / 12) * 26);
    return night.run(1);
  }
  const brought = (night: Night, kind: string) => night.s.things.filter((d) => d.landTick > 0 && d.kind === kind).length;

  it("holds 24: a row that fits arrives whole", () => {
    const night = crowded(17);
    expect(night.rows()).toEqual([{ hour: 3, row: 1, how: "tick", at: 0, n: 7, cut: 0 }]);
    expect(intruders(night.s)).toBe(24);
    expect(night.tune.roomCap).toBe(24);
  });

  it("a row that would go over is cut to fit, dust bunnies first", () => {
    const night = crowded(20);
    expect(night.rows()).toEqual([{ hour: 3, row: 1, how: "tick", at: 0, n: 4, cut: 3 }]);
    expect([brought(night, "bunny"), brought(night, "token")]).toEqual([3, 1]);
    expect(intruders(night.s)).toBe(24);
  });

  it("then tokens: with one place left the token still comes, and with none nothing does", () => {
    const one = crowded(23);
    expect(one.rows()).toEqual([{ hour: 3, row: 1, how: "tick", at: 0, n: 1, cut: 6 }]);
    expect([brought(one, "bunny"), brought(one, "token")]).toEqual([0, 1]);
    const none = crowded(24);
    expect(none.rows()).toEqual([{ hour: 3, row: 1, how: "tick", at: 0, n: 0, cut: 7 }]);
    expect(none.s.things).toHaveLength(24);
    // Over the cap already (a table typed by hand): the whole row is cut, and no more.
    const over = crowded(30);
    expect(over.rows()).toEqual([{ hour: 3, row: 1, how: "tick", at: 0, n: 0, cut: 7 }]);
  });

  it("a file is cut from its tail", () => {
    const night = new Night({ pace: 1, tokenSpeed: 150, hearts: 99 }, { hour: 7 });
    night.through(512).empty();
    for (let i = 0; i < 22; i++) put(night.s, "bunny", 20 + (i % 12) * 26, 30 + Math.floor(i / 12) * 26);
    night.run(1);
    expect(night.rows().slice(-1)).toEqual([{ hour: 7, row: 2, how: "tick", at: 513, n: 2, cut: 1 }]);
    const [head, second] = night.s.things.slice(-2);
    expect(Math.hypot(head.x - second.x, head.y - second.y)).toBeCloseTo(24, 9);
  });

  it("what is cut never arrives", () => {
    const night = crowded(23);
    night.empty().through(2000);
    // The room was emptied the moment after; the six dust bunnies that were cut are not made up later.
    expect(night.rows().slice(0, 2)).toEqual([
      { hour: 3, row: 1, how: "tick", at: 0, n: 1, cut: 6 },
      { hour: 3, row: 2, how: "tick", at: 342, n: 7, cut: 0 },
    ]);
    expect(night.rows(3)).toHaveLength(2);
  });

  it("there are never more than 24 intruders alive or announced, at any pace, for a player who pops nothing", () => {
    for (const pace of [1, 2, 3]) {
      const night = new Night({ pace });
      let most = 0;
      let atCap = 0;
      night.run(30000, () => {
        const n = intruders(night.s);
        if (n > most) most = n;
        if (n === 24) atCap++;
      });
      expect(most).toBe(24);
      expect(atCap).toBeGreaterThan(5000);
      // The cap refused a good deal of the night.
      expect(night.rows().reduce((sum, r) => sum + r.cut, 0)).toBeGreaterThan(100);
    }
  });
});

describe("the pace: a row does not wait for its tick", () => {
  it("is on at pace 2 and 3", () => {
    expect(paced(tuned({ pace: 2 }))).toBe(true);
    expect(paced(tuned({ pace: 3 }))).toBe(true);
    expect(paced(tuned({ pace: 1 }))).toBe(false);
    expect(paced(tuned({ pace: 4 }))).toBe(false);
    expect(tuned().pace).toBe(2);
  });

  for (const pace of [2, 3]) {
    describe(`pace ${pace}`, () => {
      it("the hour's first row comes at tick 0, as written", () => {
        for (let hour = 0; hour < HOURS; hour++) {
          const night = new Night({ pace }, { hour }).run(1);
          const first = dealtRows(STEP1)[hour][0];
          expect(night.rows()[0]).toMatchObject({ hour, row: first.row, how: "tick", at: 0 });
        }
      });

      it("an hour's first row is never brought by the pace: it has no row before it", () => {
        // A night of dust bunnies alone has no first token, and 20:00's
        // rows are the two bunches written for ticks 228 and 456. The room
        // is empty and the clock has nothing to count from: the first of
        // them waits for its tick.
        const night = new Night({ pace }, { hour: 1, kinds: ["bunny"] });
        night.through(227);
        expect(night.rows()).toEqual([]);
        expect([night.s.night.rowTick, night.s.night.rowLandTick]).toEqual([-1, -1]);
        night.run(1);
        expect(night.rows()).toEqual([{ hour: 1, row: 1, how: "tick", at: 228, n: 5, cut: 0 }]);
        // From then on the pace deals as usual: five is under six, so the next is called the tick it lands.
        night.through(264);
        expect(night.rows()[1]).toEqual({ hour: 1, row: 2, how: "early", at: 264, n: 5, cut: 0 });
      });

      it("a row is called early with six left, and not with seven", () => {
        // 01:00: nine arrive at tick 0, and the second bunch is written for tick 684.
        const night = new Night({ pace }, { hour: 6 });
        night.through(36);
        expect(night.rows()).toHaveLength(1);
        night.leave(7).run(40);
        expect(night.rows()).toHaveLength(1);
        expect(threats(night.s)).toBe(7);
        night.leave(6);
        const next = night.s.tick;
        night.run(1);
        expect(night.rows()[1]).toEqual({ hour: 6, row: 2, how: "early", at: next, n: 9, cut: 0 });
        expect(night.tune.paceRoom).toBe(6);
      });

      it("not before the row before it has landed, and on that tick if the room allows", () => {
        const night = new Night({ pace }, { hour: 6 });
        // Everything the first row announced is taken out while it is still announced: the room holds nothing.
        night.run(1).empty();
        expect(night.s.night.rowLandTick).toBe(36);
        night.through(35);
        expect(night.rows()).toHaveLength(1);
        night.run(1);
        expect(night.rows()[1]).toEqual({ hour: 6, row: 2, how: "early", at: 36, n: 9, cut: 0 });
      });

      it("the test reads the room as the tick before left it: a row that lands on a tick is seen the tick after", () => {
        // The second row's test on tick 36 counts the nine still announced. They land on that tick and are popped: called on tick 37.
        const night = new Night({ pace }, { hour: 6 });
        night.through(36, night.popLanded).run(1);
        expect(night.rows()[1]).toMatchObject({ row: 2, how: "early", at: 37 });
      });

      it("the clock: no row waits longer than 228 ticks after the row before it was announced", () => {
        // Nothing is popped. The second bunch, written for tick 684, comes at 228.
        const night = new Night({ pace }, { hour: 6 });
        night.through(227);
        expect(night.rows()).toHaveLength(1);
        night.run(1);
        expect(night.rows()[1]).toEqual({ hour: 6, row: 2, how: "clock", at: 228, n: 9, cut: 0 });
        expect(night.tune.paceEvery).toBe(228);
      });

      it("the clock is counted from the row before, whenever that came", () => {
        const night = new Night({ pace }, { hour: 4 });
        // 23:00: bunch, bunch, file. The first bunch is six: the second is called early the tick it lands, 36.
        night.through(36);
        expect(night.rows()[1]).toMatchObject({ row: 3, how: "early", at: 36 });
        // That makes thirteen, and they are left alone. The file, written for 513, comes 228 ticks after tick 36.
        night.through(263);
        expect(night.rows()).toHaveLength(2);
        night.run(1);
        expect(night.rows()[2]).toEqual({ hour: 4, row: 2, how: "clock", at: 264, n: 3, cut: 0 });
      });

      it("rows keep the table's order, whatever brings them", () => {
        const order = (night: Night) =>
          night
            .rows(4)
            .filter((r) => r.row >= 0)
            .map((r) => r.row);
        expect(order(new Night({ pace }, { hour: 4 }).run(900))).toEqual([1, 3, 2]);
        const popped = new Night({ pace }, { hour: 4 });
        expect(order(popped.run(900, popped.popLanded))).toEqual([1, 3, 2]);
        const late = new Night({ pace, paceEvery: 1e6, paceRoom: -1 }, { hour: 4 });
        expect(order(late.run(900))).toEqual([1, 3, 2]);
      });

      it("a row is still announced at its own tick at the latest", () => {
        // With no clock and nothing called early, every row comes on the tick the night deals it.
        const night = new Night({ pace, paceEvery: 1e6, paceRoom: -1 }, { hour: 4 });
        night.run(900);
        expect(night.rows()).toEqual([
          { hour: 4, row: 1, how: "tick", at: 0, n: 6, cut: 0 },
          { hour: 4, row: 3, how: "tick", at: 342, n: 7, cut: 0 },
          { hour: 4, row: 2, how: "tick", at: 513, n: 3, cut: 0 },
        ]);
        // And a row that came early leaves the ticks of the rows after it where they are.
        const early = new Night({ pace, paceEvery: 1e6 }, { hour: 4 });
        early.run(900);
        expect(early.rows().slice(0, 3)).toEqual([
          { hour: 4, row: 1, how: "tick", at: 0, n: 6, cut: 0 },
          { hour: 4, row: 3, how: "early", at: 36, n: 7, cut: 0 },
          { hour: 4, row: 2, how: "tick", at: 513, n: 3, cut: 0 },
        ]);
      });

      it("at 19:00 the second bunch is announced on the tick of the first launch, and lands 36 ticks later", () => {
        const tune = tuned({ pace });
        const s = createState(1, tune);
        const events = fire(s, tune, shot(1, 0, 0.5));
        // The rack is four and paceRoom is six.
        expect(of(events, "row")).toEqual([
          { type: "row", tick: 0, hour: 0, row: 0, how: "tick", n: 4, cut: 0 },
          { type: "row", tick: 0, hour: 0, row: 1, how: "early", n: 4, cut: 0 },
        ]);
        expect(of(events, "announce")).toHaveLength(4);
        expect(s.things.slice(4).map((d) => d.landTick)).toEqual([36, 36, 36, 36]);
        // The rack has landed at once: it is the row before, from tick 0.
        expect([s.night.rowTick, s.night.rowLandTick]).toEqual([0, 36]);
      });

      it("a player who clears nothing at 19:00 is sent the third bunch by the clock, and nothing more", () => {
        const night = new Night({ pace }, { hour: 0 });
        night.through(1799);
        expect(night.rows(0)).toEqual([
          { hour: 0, row: 0, how: "tick", at: 0, n: 4, cut: 0 },
          { hour: 0, row: 1, how: "early", at: 0, n: 4, cut: 0 },
          { hour: 0, row: 2, how: "clock", at: 228, n: 4, cut: 0 },
        ]);
      });
    });
  }
});

describe("the pace: a new kind keeps its moment", () => {
  for (const pace of [2, 3]) {
    describe(`pace ${pace}`, () => {
      it("the first token comes alone at tick 0 of 20:00, as the only thing the hour has sent", () => {
        const night = new Night({ pace }, { hour: 1 }).run(1);
        expect(night.rows()).toEqual([{ hour: 1, row: 0, how: "tick", at: 0, n: 1, cut: 0 }]);
        expect(night.s.things.map((d) => d.kind)).toEqual(["token"]);
      });

      it("while it is there the next row waits for its own tick: neither moment applies", () => {
        // One token is far fewer than seven, and it has landed; a short clock has long run out. Still nothing.
        const night = new Night({ pace, paceEvery: 100 }, { hour: 1 });
        night.through(227);
        expect(night.rows()).toHaveLength(1);
        expect(threats(night.s)).toBe(1);
        night.run(1);
        expect(night.rows()[1]).toEqual({ hour: 1, row: 1, how: "tick", at: 228, n: 5, cut: 0 });
      });

      it("once it is gone the next row is called early", () => {
        const night = new Night({ pace }, { hour: 1 });
        night.through(50).empty().run(1);
        expect(night.rows()[1]).toEqual({ hour: 1, row: 1, how: "early", at: 51, n: 5, cut: 0 });
      });

      it("gone before it has landed, the next row still waits for the landing", () => {
        const night = new Night({ pace }, { hour: 1 });
        night.through(10).empty().through(35);
        expect(night.rows()).toHaveLength(1);
        night.run(1);
        expect(night.rows()[1]).toMatchObject({ row: 1, how: "early", at: 36 });
      });

      it("the hold is over once the next row has been announced: it never holds the rows after that one", () => {
        // The token is never popped, and the room is kept above six. The
        // second row came at its tick; the third comes by the clock all the same.
        const night = new Night({ pace, paceEvery: 100 }, { hour: 1 });
        for (let i = 0; i < 3; i++) put(night.s, "bunny", 30 + i * 20, 30);
        night.through(228);
        expect([night.s.night.holdFrom, night.s.night.holdTo]).toEqual([-1, -1]);
        expect(night.s.things.some((d) => d.kind === "token")).toBe(true);
        night.through(328);
        expect(night.rows()[2]).toEqual({ hour: 1, row: 2, how: "clock", at: 328, n: 5, cut: 0 });
      });

      it("the hold is on what that row announced, and on nothing else in the room", () => {
        const night = new Night({ pace }, { hour: 1 });
        night.run(1);
        const token = night.s.things[0];
        expect([night.s.night.holdFrom, night.s.night.holdTo]).toEqual([token.id, token.id + 1]);
        // Things left over from 19:00 do not hold the row; they only count toward its six.
        for (let i = 0; i < 6; i++) put(night.s, "bunny", 30 + i * 20, 30);
        night.through(60);
        night.s.things = night.s.things.filter((d) => d !== token);
        night.run(1);
        expect(night.rows()[1]).toMatchObject({ row: 1, how: "early", at: 61 });
      });
    });
  }
});

describe("the pace: extra bunches until last call", () => {
  it("last call is tick 840 of the hour, and tick 456 at 19:00", () => {
    const tune = tuned();
    expect(lastCall(0, tune)).toBe(456);
    for (let hour = 1; hour < HOURS; hour++) expect(lastCall(hour, tune)).toBe(840);
    expect([PACE[2].paceLastCall, PACE[2].paceLastCallFirst]).toEqual([840, 456]);
  });

  for (const pace of [2, 3]) {
    describe(`pace ${pace}`, () => {
      it("when the hour's rows are out, extra bunches follow, one at a time, each when the one before has landed and been cleared", () => {
        const night = new Night({ pace }, { hour: 6 });
        night.through(1019, night.popLanded);
        const rows = night.rows(6);
        expect(rows.slice(0, 2).map((r) => [r.row, r.how, r.at])).toEqual([
          [0, "tick", 0],
          [2, "early", 37],
        ]);
        const extra = rows.slice(2);
        expect(extra.every((r) => r.row === -1 && r.how === "early")).toBe(true);
        // A bunch lands 36 ticks after it is announced and is popped; the next is called the tick after.
        expect(extra.map((r) => r.at)).toEqual(Array.from({ length: 21 }, (_, k) => 74 + 37 * k));
        // Never two on one tick.
        expect(new Set(extra.map((r) => r.at)).size).toBe(extra.length);
        // The last is announced before tick 840: everything has landed by tick 875.
        expect(extra[extra.length - 1].at).toBe(814);
        expect(Math.max(...of(night.events, "arrive").map((e) => e.tick))).toBeLessThanOrEqual(875);
      });

      it("no extra bunch is announced at tick 840 or later", () => {
        // A player who pops nothing gets them by the clock: 456 and 684, and not at 912.
        const night = new Night({ pace }, { hour: 6 });
        night.through(1799);
        expect(night.rows(6).map((r) => [r.row, r.how, r.at])).toEqual([
          [0, "tick", 0],
          [2, "clock", 228],
          [-1, "clock", 456],
          [-1, "clock", 684],
        ]);
        // On the very tick: one that would come at 839 does, and one at 840 does not.
        const before = new Night({ pace, paceLastCall: 840, paceEvery: 839 }, { hour: 9 });
        before.through(1799, before.popLanded);
        const last = before.rows(9).filter((r) => r.row === -1);
        expect(Math.max(...last.map((r) => r.at))).toBeLessThan(840);
        const edge = new Night({ pace, paceEvery: 280, paceRoom: -1 }, { hour: 6 });
        edge.through(1799);
        // 0, 280, 560, and the next would be exactly 840: not announced.
        expect(edge.rows(6).map((r) => r.at)).toEqual([0, 280, 560]);
        const inside = new Night({ pace, paceEvery: 279, paceRoom: -1 }, { hour: 6 });
        inside.through(1799);
        expect(inside.rows(6).map((r) => r.at)).toEqual([0, 279, 558, 837]);
      });

      it("at 19:00 last call is tick 456: nothing is dealt later than the table deals it", () => {
        const night = new Night({ pace }, { hour: 0 });
        night.through(635, night.popLanded);
        const rows = night.rows(0);
        expect(rows.slice(0, 3).map((r) => [r.row, r.how, r.at])).toEqual([
          [0, "tick", 0],
          [1, "early", 0],
          [2, "early", 36],
        ]);
        // A bunch of four is under the six by itself: the next is called the very tick it lands.
        const extra = rows.slice(3);
        expect(extra.map((r) => r.at)).toEqual(Array.from({ length: 11 }, (_, k) => 72 + 36 * k));
        expect(extra[extra.length - 1].at).toBe(432);
        expect(extra.every((r) => r.row === -1 && r.n === 4)).toBe(true);
        // Everything has landed by tick 492.
        expect(Math.max(...of(night.events, "arrive").map((e) => e.tick))).toBeLessThanOrEqual(491);
        expect(night.tune.paceLastCallFirst).toBe(456);
      });

      it("an extra bunch is the hour's dust bunnies in a blob, with a few loose tokens before midnight", () => {
        const tokensGiven = PACE[pace as 2 | 3].paceTokens;
        expect(tokensGiven).toBe(pace === 2 ? 2 : 3);
        for (let hour = 0; hour < HOURS; hour++) {
          const night = new Night({ pace, tokenSpeed: 150, hearts: 999 }, { hour });
          // Popped as it lands, until the first extra bunch has been announced.
          const row = night.toFirstExtra();
          const things = night.s.things.filter((d) => d.landTick === night.s.tick - 1 + 36);
          const bunnies = things.filter((d) => d.kind === "bunny");
          const tokens = things.filter((d) => d.kind === "token");
          // The hour's dust bunnies: the first number of its bunch size.
          expect(bunnies.length, CLOCK[hour]).toBe(BUNCH[hour][0]);
          // None at 19:00; paceTokens from 20:00 to 23:00; two fewer from 00:00 on.
          const want = hour === 0 ? 0 : hour <= 4 ? tokensGiven : tokensGiven - 2;
          expect(tokens.length, CLOCK[hour]).toBe(want);
          expect(row.n).toBe(bunnies.length + tokens.length);
          // It carries nothing else, and it is placed as a tabled bunch is: the blob first, then each token, loose.
          expect(things.length).toBe(row.n);
          expect(Math.max(...bunnies.map((d) => d.id))).toBeLessThan(Math.min(Infinity, ...tokens.map((d) => d.id)));
          for (const t of tokens) expect(Math.hypot(t.vx, t.vy)).toBeCloseTo(150, 9);
          if (tokens.length === 2) expect(tokens[0].vx).not.toBeCloseTo(tokens[1].vx, 3);
        }
      });
    });
  }

  it("two fewer tokens from 00:00 on, and never fewer than none: with paceTokens at 1 or 0, none", () => {
    const tokensAt = (hour: number, paceTokens: number): number => {
      const night = new Night({ pace: 2, paceTokens }, { hour });
      night.toFirstExtra();
      return night.s.things.filter((d) => d.kind === "token" && d.landTick === night.s.tick - 1 + 36).length;
    };
    // Before midnight the knob is the count; after it, two fewer, and never under zero.
    expect([4, 3, 2, 1, 0].map((n) => tokensAt(4, n))).toEqual([4, 3, 2, 1, 0]);
    expect([4, 3, 2, 1, 0].map((n) => tokensAt(5, n))).toEqual([2, 1, 0, 0, 0]);
    expect([4, 3, 2, 1, 0].map((n) => tokensAt(10, n))).toEqual([2, 1, 0, 0, 0]);
    expect(tokensAt(0, 4)).toBe(0);
    expect(tokensAt(5, -3)).toBe(0);
  });

  it("an extra bunch is cut by the cap like any row", () => {
    const night = new Night({ pace: 2 }, { hour: 3 });
    night.through(684);
    // Two bunches of seven by the clock, and then extras of six dust bunnies and two tokens: 14, 22, and the cap.
    expect(night.rows(3).map((r) => [r.row, r.at, r.n, r.cut])).toEqual([
      [1, 0, 7, 0],
      [2, 228, 7, 0],
      [-1, 456, 8, 0],
      [-1, 684, 2, 6],
    ]);
    // Dust bunnies were cut first: the two that came are its tokens.
    expect(night.s.things.slice(-2).map((d) => d.kind)).toEqual(["token", "token"]);
  });

  it("a night that leaves tokens out has none on its extra bunches either", () => {
    const night = new Night({ pace: 3 }, { hour: 2, kinds: ["bunny"] });
    night.through(1799, night.popLanded);
    expect(night.rows(2).filter((r) => r.row === -1).length).toBeGreaterThan(10);
    expect(of(night.events, "announce").every((e) => e.kind === "bunny")).toBe(true);
  });
});

describe("the pace: no hour is clear before last call", () => {
  it("an empty room is not a clear hour until tick 840; then the hour ends 180 ticks later", () => {
    const night = new Night({ pace: 2 }, { hour: 6 });
    night.through(839, night.popLanded);
    night.empty();
    expect(night.s.night.clearTick).toBe(-1);
    night.run(1);
    // (The last extra bunch, announced at 814, was taken out with the rest.)
    expect(night.s.night.clearTick).toBe(840);
    night.through(1019);
    expect(night.s.night.hour).toBe(6);
    night.run(1);
    expect(night.s.night.hour).toBe(7);
    expect(night.s.night.hourStart).toBe(1020);
  });

  it("a night in which nothing arrives: 636 ticks for 19:00 and 1,020 for each hour after, 10,836 in all", () => {
    for (const pace of [2, 3]) {
      const night = new Night({ pace }, { empty: true });
      night.run(20000);
      expect(of(night.events, "clear").map((e) => e.tick - night.began[e.hour])).toEqual([456, 840, 840, 840, 840, 840, 840, 840, 840, 840, 840]);
      expect(night.began.slice(0, 11)).toEqual([0, 636, 1656, 2676, 3696, 4716, 5736, 6756, 7776, 8796, 9816]);
      expect(night.s.ended).toBe("morning");
      expect(of(night.events, "over")[0].tick).toBe(10836);
      // Three minutes, by construction.
      expect(10836).toBe(night.tune.paceLastCallFirst + 180 + 10 * (night.tune.paceLastCall + 180));
      expect(10836 / 60).toBeGreaterThanOrEqual(180);
    }
  });

  it("at pace 1 the same night is clear at once, hour after hour: 1,980 ticks", () => {
    const night = new Night({ pace: 1 }, { empty: true });
    night.run(20000);
    expect(of(night.events, "clear").map((e) => e.tick - night.began[e.hour])).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(of(night.events, "over")[0].tick).toBe(11 * 180);
  });

  it("a player who clears everything as it lands is in each hour until last call and the last bunch after it", () => {
    const night = new Night({ pace: 2 });
    night.run(30000, night.popLanded);
    expect(night.s.ended).toBe("morning");
    const lengths = night.began.slice(1, 11).map((start, i) => start - night.began[i]);
    // 19:00: the last extra bunch is announced at 432, lands at 468 and is popped: clear at 469, over at 649.
    expect(lengths[0]).toBe(649);
    // Every other hour: announced at 814 or so, landed and popped by 851; the hour ends 180 ticks later.
    for (const length of lengths.slice(1)) {
      expect(length).toBeGreaterThanOrEqual(1020);
      expect(length).toBeLessThanOrEqual(1060);
    }
    // And he is sent far more than the table holds.
    expect(night.rows().reduce((sum, r) => sum + r.n, 0)).toBeGreaterThan(169 * 4);
  });
});

describe("the pace: a row the cap cuts", () => {
  it("to nothing has still been announced: it is the row before, and the clock starts again from it", () => {
    // 01:00 in a room that holds nine: the opening bunch fills it, and nothing is popped.
    const night = new Night({ pace: 2, roomCap: 9 }, { hour: 6 });
    night.through(1799);
    expect(night.rows(6)).toEqual([
      { hour: 6, row: 0, how: "tick", at: 0, n: 9, cut: 0 },
      // Cut whole, at the clock's tick...
      { hour: 6, row: 2, how: "clock", at: 228, n: 0, cut: 9 },
      // ...and the next comes 228 ticks after THAT, not on the tick after: the clock started again.
      { hour: 6, row: -1, how: "clock", at: 456, n: 0, cut: 7 },
      { hour: 6, row: -1, how: "clock", at: 684, n: 0, cut: 7 },
    ]);
    expect(night.s.things).toHaveLength(9);
  });

  it("it counts as landed a telegraph later, like any row, for the row called early after it", () => {
    const night = new Night({ pace: 2, roomCap: 9, paceEvery: 100 }, { hour: 6 });
    night.through(100);
    expect(night.rows(6)[1]).toEqual({ hour: 6, row: 2, how: "clock", at: 100, n: 0, cut: 9 });
    expect([night.s.night.rowTick, night.s.night.rowLandTick]).toEqual([100, 136]);
    // The room is emptied. The next is called early, but not before tick 136.
    night.empty().through(135);
    expect(night.rows(6)).toHaveLength(2);
    night.run(1);
    expect(night.rows(6)[2]).toMatchObject({ row: -1, how: "early", at: 136 });
  });

  it("a first row cut whole holds nothing back", () => {
    // 20:00 in a room already at the cap: the first token is cut, and the next row is dealt by the usual moments.
    const night = new Night({ pace: 2 }, { hour: 1 });
    for (let i = 0; i < 24; i++) put(night.s, "bunny", 20 + (i % 12) * 26, 30 + Math.floor(i / 12) * 26);
    night.run(1);
    expect(night.rows()).toEqual([{ hour: 1, row: 0, how: "tick", at: 0, n: 0, cut: 1 }]);
    expect([night.s.night.holdFrom, night.s.night.holdTo]).toEqual([25, 25]);
    night.through(40).leave(6).run(1);
    expect(night.rows()[1]).toMatchObject({ row: 1, how: "early", at: 41 });
  });
});

describe("the pace: what it sends", () => {
  it("pace 3 is pace 2 with one more token on every extra bunch", () => {
    const two = new Night({ pace: 2 }, { hour: 2 });
    const three = new Night({ pace: 3 }, { hour: 2 });
    two.through(1019, two.popLanded);
    three.through(1019, three.popLanded);
    // The same rows on the same ticks.
    expect(three.rows().map((r) => [r.row, r.how, r.at])).toEqual(two.rows().map((r) => [r.row, r.how, r.at]));
    const extra = (night: Night) => night.rows().filter((r) => r.row === -1);
    expect(extra(two).every((r) => r.n === 7)).toBe(true);
    expect(extra(three).every((r) => r.n === 8)).toBe(true);
    // And the tabled rows are the table's at both.
    expect(two.rows().filter((r) => r.row >= 0).map((r) => r.n)).toEqual([6, 6]);
    expect(three.rows().filter((r) => r.row >= 0).map((r) => r.n)).toEqual([6, 6]);
  });

  it("pips come back every 96 ticks, and a value given by name wins over the one the pace gives", () => {
    expect(tuned({ pace: 2 }).pipRefillTicks).toBe(96);
    expect(tuned({ pace: 3 }).pipRefillTicks).toBe(96);
    expect(tuned({ pace: 1 }).pipRefillTicks).toBe(120);
    expect(tuned({ pace: 2, pipRefillTicks: 120 }).pipRefillTicks).toBe(120);
    // The same holds for the pace's own numbers: last call moved by name, the rest as the pace gives them.
    const night = new Night({ pace: 2, paceLastCall: 300 }, { hour: 6 });
    night.through(1799);
    expect(night.rows(6).map((r) => r.at)).toEqual([0, 228]);
    expect(night.tune.paceEvery).toBe(228);
  });

  it("one thing at most is announced by the pace on a tick, and the love heart's line is never one of them", () => {
    for (const pace of [2, 3]) {
      const night = new Night({ pace }, { hour: 5 });
      night.run(4000, night.popLanded);
      const byTick = new Map<number, Seen[]>();
      for (const r of night.rows()) byTick.set(r.hour * 100000 + r.at, [...(byTick.get(r.hour * 100000 + r.at) ?? []), r]);
      for (const rows of byTick.values()) {
        // Rows whose tick has come may share a tick with one row or bunch the pace brings.
        expect(rows.filter((r) => r.how !== "tick").length).toBeLessThanOrEqual(1);
      }
      // 01:00 was played through: its rows are the two bunches, and what follows them is extra bunches.
      expect(night.rows(6).filter((r) => r.row >= 0).map((r) => r.row)).toEqual([0, 2]);
      expect(night.rows(6).length).toBeGreaterThan(10);
    }
  });
});
