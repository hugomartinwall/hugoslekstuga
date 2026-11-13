import { describe, expect, it } from "vitest";
import { AIM_TICKS, aimLine } from "../../lib/knuff/sim/aim";
import { cloneState, createState, hashState } from "../../lib/knuff/sim/state";
import { step } from "../../lib/knuff/sim/step";
import type { Launch, SimEvent, State, Tune } from "../../lib/knuff/sim/types";
import { REST, distance, night, put, run, scripted, shot, tick, tuned } from "./room";

/**
 * The aim line (§4.2) is the real step run on a copy: copy the State,
 * apply the launch, and step with no further input. It ends on the first
 * thing he would pop, at the cushion after the last one it runs through,
 * where he would land, or after 120 ticks.
 */

const UP: Launch = { dx: 0, dy: -1, power: 1 };

/** A small room, so that a launch reaches cushion after cushion while it is still hot. */
const BOX = { left: 100, top: 294, right: 260, bottom: 454 };

describe("the aim line in an empty room", () => {
  const tune = tuned();

  it("leaves the State as it was", () => {
    const s = createState(55, tune);
    const input = scripted(2);
    const events: SimEvent[] = [];
    for (let t = 0; t < 400; t++) step(s, input(), tune, events);
    const before = hashState(s);
    const copy = cloneState(s);
    const line = aimLine(s, { dx: 0.3, dy: -1, power: 1 }, tune);
    expect(hashState(s)).toBe(before);
    expect(s).toEqual(copy);
    expect(line.pts.length).toBeGreaterThan(4);
  });

  it("with aimCushions 1 it runs through one cushion and ends at the second", () => {
    expect(tune.aimCushions).toBe(1);
    const s = night(tune, { room: BOX });
    const line = aimLine(s, { dx: 1, dy: 0.7, power: 1 }, tune);
    expect(line.end).toBe("cushion");
    expect(line.cushionPts).toHaveLength(4);
    expect(line.cushions).toHaveLength(2);
    // It stops exactly where he touches the second: on the bottom cushion, his radius inside the edge.
    expect(line.pts.slice(-2)).toEqual(line.cushionPts.slice(-2));
    expect(line.cushionPts[0]).toBe(BOX.right - 13);
    expect(line.cushionPts[3]).toBe(BOX.bottom - 13);
    expect(line.hitId).toBe(-1);
  });

  it("with aimCushions 2 it runs through two and ends at the third", () => {
    const two = tuned({ aimCushions: 2 });
    const s = night(two, { room: BOX });
    const launch = { dx: 1, dy: 0.7, power: 1 };
    const line = aimLine(s, launch, two);
    expect(line.end).toBe("cushion");
    expect(line.cushionPts).toHaveLength(6);
    expect(line.cushionPts[4]).toBe(BOX.left + 13);
    expect(line.pts.slice(-2)).toEqual(line.cushionPts.slice(-2));
    // The same line as with one cushion, drawn on.
    const one = aimLine(s, launch, tune);
    expect(line.cushionPts.slice(0, 4)).toEqual(one.cushionPts);
    expect(line.pts.length).toBeGreaterThan(one.pts.length);
    expect(line.pts.slice(0, one.pts.length - 2)).toEqual(one.pts.slice(0, -2));
  });

  it("it changes what is drawn and nothing in the simulation", () => {
    const one = night(tune, { room: BOX });
    const two = night(tuned({ aimCushions: 2 }), { room: BOX });
    const launch = { dx: 1, dy: 0.7, power: 1 };
    tick(one, tune, { launch, pullHeld: false });
    tick(two, tuned({ aimCushions: 2 }), { launch, pullHeld: false });
    run(one, tune, 100);
    run(two, tuned({ aimCushions: 2 }), 100);
    expect(two).toEqual(one);
  });

  it("is his real path: one point for each tick, where he will be on that tick", () => {
    for (const launch of [
      { dx: 0.62, dy: -1, power: 1 },
      { dx: -1, dy: 0.2, power: 0.7 },
      { dx: 0.1, dy: 1, power: 0.5 },
    ]) {
      const s = night(tune);
      const line = aimLine(s, launch, tuned({ aimCushions: 9 }));
      const points = line.pts.length / 2;
      expect(points).toBeGreaterThan(10);
      expect(line.pts.slice(0, 2)).toEqual([180, 374]);
      tick(s, tune, { launch, pullHeld: false });
      for (let t = 1; t < points; t++) {
        expect([s.him.x, s.him.y], `tick ${t}`).toEqual([line.pts[t * 2], line.pts[t * 2 + 1]]);
        tick(s, tune);
      }
      // It ended where he landed.
      expect(line.end).toBe("land");
      expect(s.him.hot).toBe(false);
    }
  });

  it("ends where he would land: a 50% shot, 18 ticks and 112 u on", () => {
    const s = night(tune);
    const line = aimLine(s, { dx: 0, dy: -1, power: 0.5 }, tune);
    expect(line.end).toBe("land");
    expect(line.pts.length / 2).toBe(19);
    expect(line.pts[line.pts.length - 2]).toBe(180);
    expect(line.pts[line.pts.length - 1]).toBeCloseTo(374 - 111.551, 3);
    expect(line.cushionPts).toEqual([]);
  });

  it("a cushion that would land him ends it there", () => {
    const soft = tuned({ minPower: 0.01 });
    const s = night(soft);
    s.him.y = 31;
    const line = aimLine(s, { dx: 0, dy: -1, power: 0.37 }, soft);
    expect(line.end).toBe("land");
    expect(line.cushionPts).toEqual([180, 21]);
    expect(line.pts.slice(-2)).toEqual([180, 21]);
  });

  it("looks 120 ticks ahead and no further", () => {
    expect(AIM_TICKS).toBe(120);
    // With nothing to slow him he flies for ever; the line does not.
    const endless = tuned({ dragK: 0, friction: 0, aimCushions: 999 });
    const s = night(endless);
    const line = aimLine(s, { dx: 0.3, dy: -1, power: 1 }, endless);
    expect(line.end).toBe("time");
    expect(line.pts.length / 2).toBe(121);
    expect(aimLine(s, { dx: 0.3, dy: -1, power: 1 }, endless, 30).pts.length / 2).toBe(31);
  });

  it("a launch with no direction has no line, and neither has a night that is over", () => {
    const s = night(tune);
    expect(aimLine(s, { dx: 0, dy: 0, power: 1 }, tune)).toEqual({ pts: [180, 374], cushions: [], cushionPts: [], end: "time", hitId: -1, takes: -1, plate: -1, charm: "" });
    s.phase = "over";
    expect(aimLine(s, UP, tune).pts).toEqual([180, 374]);
  });

  it("is drawn at the power it is given, and never under the minimum", () => {
    const s = night(tune);
    const full = aimLine(s, { dx: 0, dy: -1, power: 1 }, tune);
    const half = aimLine(s, { dx: 0, dy: -1, power: 0.5 }, tune);
    // At full power he reaches the top cushion and comes back off it; at 50% he lands 112 u up the room.
    expect(full.cushionPts).toEqual([180, 21]);
    expect(half.cushionPts).toEqual([]);
    expect(half.pts.length / 2).toBe(19);
    expect(full.pts.length).toBeGreaterThan(half.pts.length);
    // Between 12 and 24 px of pull the line is drawn grey at minimum power: the same line as a 50% shot.
    expect(aimLine(s, { dx: 0, dy: -1, power: 0.2 }, tune)).toEqual(half);
    expect(aimLine(s, { dx: 0, dy: -1, power: 0.75 }, tune)).not.toEqual(half);
  });

  it("with no pip in hand the line is drawn all the same: the copy is given one", () => {
    const s = night(tune);
    const withPips = aimLine(s, { dx: 0.4, dy: -1, power: 0.8 }, tune);
    s.pips = 0;
    const without = aimLine(s, { dx: 0.4, dy: -1, power: 0.8 }, tune);
    expect(without).toEqual(withPips);
    expect(without.pts.length).toBeGreaterThan(10);
    // The real State still has none, and the real step still refuses.
    expect(s.pips).toBe(0);
    expect(tick(s, tune, shot(0.4, -1, 0.8)).map((e) => e.type)).toEqual(["refused"]);
  });

  it("from the start screen it shows the first launch, and does not start the night", () => {
    const s = createState(4, tune);
    const line = aimLine(s, UP, tune);
    expect(line.end).toBe("thing");
    expect(line.hitId).toBe(s.things[0].id);
    expect(s.phase).toBe("waiting");
    expect(s.tick).toBe(0);
  });

  it("while he is flying it shows where a relaunch from here would take him", () => {
    const s = night(tune);
    tick(s, tune, shot(0, -1));
    run(s, tune, 6);
    expect(s.him.hot).toBe(true);
    const line = aimLine(s, { dx: 1, dy: 0, power: 1 }, tune);
    expect(line.pts.slice(0, 2)).toEqual([s.him.x, s.him.y]);
    expect(line.pts[2]).toBeGreaterThan(s.him.x + 10);
    expect(line.pts[3]).toBe(s.him.y);
  });
});

describe("the aim line and the things in the room", () => {
  const tune = tuned({ bunnySpeed: 0 });

  it("ends on the first thing he would pop, at the spot where he touches it", () => {
    const s = night(tune);
    const near = put(s, "bunny", 180 + 6, 374 - 100);
    put(s, "bunny", 180, 374 - 160);
    const line = aimLine(s, UP, tune);
    expect(line.end).toBe("thing");
    expect(line.hitId).toBe(near.id);
    const [x, y] = line.pts.slice(-2);
    expect(x).toBe(180);
    // His centre at the contact: within reach of it (13 + 8 u), and only just.
    const reach = Math.hypot(near.x - x, near.y - y);
    expect(reach).toBeLessThan(21);
    expect(reach).toBeGreaterThan(21 - 6);
    // And he is hot when he gets there: the real launch pops it.
    tick(s, tune, { launch: UP, pullHeld: false });
    run(s, tune, line.pts.length / 2 - 1);
    expect(s.things.map((d) => d.id)).not.toContain(near.id);
  });

  it("a thing he would only reach after the cushion the line stops at is not named", () => {
    const s = night(tune, { room: BOX });
    // Behind him: he gets there off two cushions.
    put(s, "bunny", 180, 374 + 50);
    const line = aimLine(s, { dx: 1, dy: -0.6, power: 1 }, tune);
    expect(line.end).toBe("cushion");
    expect(line.hitId).toBe(-1);
  });

  it("shows a rolling token where it will be when he gets there", () => {
    const s = night(tune);
    // Off his line now, and rolling onto it: by the time he is there, so is the token.
    const crossing = put(s, "token", 180 - 37.5, 374 - 150, { vx: 150, vy: 0 });
    const line = aimLine(s, UP, tune);
    expect(Math.abs(crossing.x - 180)).toBeGreaterThan(21);
    expect(line.end).toBe("thing");
    expect(line.hitId).toBe(crossing.id);
    // On his line now, and rolling off it: by the time he is there it is gone, and the line runs on.
    const t = night(tune);
    const leaving = put(t, "token", 180, 374 - 150, { vx: 150, vy: 0 });
    const past = aimLine(t, UP, tune);
    expect(distance(t, leaving)).toBe(150);
    expect(past.hitId).toBe(-1);
    expect(past.end).toBe("land");
    expect(past.cushionPts).toEqual([180, 21]);
  });

  it("an announced thing is not in the way, and one that lands in time is", () => {
    const s = night(tune);
    const late = put(s, "bunny", 180, 374 - 100, { landTick: 300 });
    expect(aimLine(s, UP, tune).hitId).toBe(-1);
    // It lands two ticks from now; he is there in seven.
    late.landTick = s.tick + 2;
    expect(aimLine(s, UP, tune).hitId).toBe(late.id);
  });

  it("a thing he overlaps at the release is not the thing he would hit", () => {
    const s = night(tune);
    put(s, "bunny", 180 + 4, 374 - 4, { dazedUntil: 1e6 });
    const ahead = put(s, "bunny", 180, 374 - 80);
    const line = aimLine(s, UP, tune);
    expect(line.hitId).toBe(ahead.id);
  });
});

describe("the line names what the real game touches", () => {
  /** What a real launch does first, read off the real step: the same question the line answers, asked the long way round. */
  function first(s: State, launch: Launch, tune: Tune): { end: string; hitId: number; ticks: number } {
    const real = cloneState(s);
    if (real.pips <= 0) real.pips = 1;
    const events: SimEvent[] = [];
    let cushions = 0;
    for (let t = 0; t < AIM_TICKS; t++) {
      events.length = 0;
      step(real, t === 0 ? { launch, pullHeld: false } : REST, tune, events);
      for (const e of events) {
        if (e.type === "pop") return { end: "thing", hitId: e.id, ticks: t };
        if (e.type === "cushion" && ++cushions > tune.aimCushions) return { end: "cushion", hitId: -1, ticks: t };
        if (e.type === "land") return { end: "land", hitId: -1, ticks: t };
      }
      if (real.phase === "over") return { end: "time", hitId: -1, ticks: t };
    }
    return { end: "time", hitId: -1, ticks: AIM_TICKS - 1 };
  }

  it("for 500 random rooms and launches", () => {
    let seed = 987654321;
    const next = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const ends: Record<string, number> = {};
    let flying = 0;
    let moving = 0;
    for (let room = 0; room < 500; room++) {
      // A room from the middle of a night, in any of its hours: a scripted
      // player plays for a while, and the line is asked for there.
      const tune = tuned({ hearts: 99, aimCushions: room % 2 === 0 ? 1 : 2, popHotTicks: room % 5 === 0 ? 15 : 0, pace: 1 + (room % 3) });
      const s = createState(1000 + room, tune, { hour: room % 11 });
      const input = scripted(room + 1);
      const events: SimEvent[] = [];
      const warm = Math.floor(next() * 1500);
      for (let t = 0; t < warm; t++) step(s, input(), tune, events);
      const a = next() * Math.PI * 2;
      const launch = { dx: Math.cos(a), dy: Math.sin(a), power: 0.5 + 0.5 * next() };
      if (s.him.hot) flying++;
      if (s.things.some((d) => d.kind === "token" && s.tick >= d.landTick)) moving++;

      const before = hashState(s);
      const line = aimLine(s, launch, tune);
      expect(hashState(s), `room ${room}`).toBe(before);
      const real = first(s, launch, tune);
      expect(line.end, `room ${room}`).toBe(real.end);
      expect(line.hitId, `room ${room}`).toBe(real.hitId);
      // The line has a point for where he is now, one for each whole tick before the end, and the end.
      expect(line.pts.length / 2, `room ${room}`).toBe(real.ticks + 2);
      ends[line.end] = (ends[line.end] ?? 0) + 1;
    }
    // The rooms were of every sort: each way a line can end came up often, bar running out of time, which never does.
    expect(ends.thing).toBeGreaterThan(80);
    expect(ends.cushion).toBeGreaterThan(20);
    expect(ends.land).toBeGreaterThan(80);
    expect(ends.time ?? 0).toBe(0);
    expect(flying).toBeGreaterThan(20);
    expect(moving).toBeGreaterThan(100);
  });
});

describe("the charm the line names (§4.2, §9.3)", () => {
  const tune = tuned({ bunnySpeed: 0 });

  /** An empty room with an armed offer out: a pickup at (180, 250), and plate 1 offered as Spark. */
  function offered(): State {
    const s = night(tune);
    run(s, tune, 2);
    const tile = put(s, "pickup", 180, 250, { landTick: 0 });
    s.offer = {
      open: true,
      openTick: 1,
      armedTick: 1,
      items: [
        { kind: "plate", charm: "spark", plate: 9, thingId: -1 },
        { kind: "pickup", charm: "heavy", plate: -1, thingId: tile.id },
      ],
    };
    return s;
  }

  it("names the offered thing the launch would take", () => {
    const s = offered();
    const line = aimLine(s, UP, tune);
    expect([line.takes, line.charm]).toEqual([1, "heavy"]);
    // And an offered plate that would be the launch's first cushion.
    const left = aimLine(s, { dx: -1, dy: -1.5, power: 1 }, tune);
    expect([left.plate, left.takes, left.charm]).toEqual([9, 0, "spark"]);
    // Nothing was taken in the State: it is a copy.
    expect(s.offer.open).toBe(true);
    expect(s.plates[9].charm).toBe("");
  });

  it("only otherwise the lit plate that is its first cushion; a dark plate names nothing", () => {
    const s = night(tune);
    // Up and to the left: the first cushion is plate 0, lit with Bumper from the start.
    const upLeft = aimLine(s, { dx: -0.35, dy: -1, power: 1 }, tune);
    expect([upLeft.plate, upLeft.takes, upLeft.charm]).toEqual([0, -1, "bumper"]);
    // Straight up: plate 1, dark.
    const up = aimLine(s, UP, tune);
    expect([up.plate, up.charm]).toEqual([1, ""]);
    // A pickup on the way names its charm, whatever the first cushion carries.
    const o = offered();
    o.plates[1] = { charm: "coin", readyTick: 0 };
    expect(aimLine(o, UP, tune).charm).toBe("heavy");
  });

  it("names nothing a launch released now could not take: an offer that has not armed", () => {
    const s = offered();
    s.offer.armedTick = -1;
    const line = aimLine(s, UP, tune);
    expect([line.takes, line.charm]).toEqual([-1, ""]);
  });
});
