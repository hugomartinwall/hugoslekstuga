import { describe, expect, it } from "vitest";
import { cloneState, hashState } from "../../lib/knuff/sim/state";
import { REST, distance, fire, night, of, put, run, shot, tick, tuned } from "./room";

/**
 * Hearts (§3.6). A heart is lost when a thing that hurts on touch overlaps
 * him while he is landed, the thing has landed and is not dazed, and he is
 * not invulnerable. Then he is invulnerable for a while, a wave throws
 * what is near him away, and his pips are refilled.
 */

/** Things that stay where they are put, so a case decides who touches him and when. */
const STILL = { bunnySpeed: 0, tokenSpeed: 0 };

describe("losing a heart", () => {
  const tune = tuned(STILL);

  it("he has three", () => {
    expect(night(tune).hearts).toBe(3);
    expect(tune.hearts).toBe(3);
  });

  it("a dust bunny overlapping him while he is landed costs one", () => {
    const s = night(tune);
    const bunny = put(s, "bunny", 180 + 10, 374);
    const events = tick(s, tune);
    expect(s.hearts).toBe(2);
    expect(of(events, "hurt")).toEqual([{ type: "hurt", tick: 0, x: 180, y: 374, by: "bunny", id: bunny.id, hearts: 2 }]);
    expect(s.lastHurtBy).toBe("bunny");
    expect(s.lastHurtHour).toBe(0);
  });

  it("so does a token, and the State remembers what took the last one and in which hour", () => {
    const s = night(tune, { hour: 3 });
    put(s, "token", 180, 374 + 12);
    tick(s, tune);
    expect(s.hearts).toBe(2);
    expect(s.lastHurtBy).toBe("token");
    expect(s.lastHurtHour).toBe(3);
  });

  it("touching is not overlapping: a thing at arm's length costs nothing", () => {
    const s = night(tune);
    put(s, "bunny", 180 + 21, 374);
    put(s, "token", 180, 374 - 20);
    expect(of(run(s, tune, 50), "hurt")).toEqual([]);
    expect(s.hearts).toBe(3);
    // A hair closer and it does.
    put(s, "token", 180 - 19.99, 374);
    expect(of(tick(s, tune), "hurt")).toHaveLength(1);
  });

  it("not while he is hot: he pops it instead", () => {
    const s = night(tune);
    put(s, "bunny", 180, 374 - 30);
    const events = fire(s, tune, shot(0, -1), 5);
    expect(of(events, "pop")).toHaveLength(1);
    expect(of(events, "hurt")).toEqual([]);
    expect(s.hearts).toBe(3);
  });

  it("not while the thing is announced, and a thing that lands on him lands dazed: 36 ticks more", () => {
    // A dust bunny that walks: once it may, it walks into him.
    const walking = tuned({ tokenSpeed: 0 });
    const s = night(walking);
    const bunny = put(s, "bunny", 180 + 5, 374, { landTick: 50 });
    const events = run(s, walking, 50);
    // Announced: it cannot be touched, cannot hurt, and does not move.
    expect(of(events, "hurt")).toEqual([]);
    expect([bunny.x, bunny.y]).toEqual([185, 374]);
    // It lands on tick 50, within 60 u of him: dazed for 36 ticks, and held off him.
    events.push(...run(s, walking, 36));
    expect(of(events, "arrive")).toEqual([{ type: "arrive", tick: 50, x: 185, y: 374, id: bunny.id, kind: "bunny", dist: 5, dazed: true }]);
    expect(of(events, "hurt")).toEqual([]);
    expect(s.hearts).toBe(3);
    expect(distance(s, bunny)).toBeCloseTo(21, 9);
    // So nothing costs a heart that was not on screen, landed and harmless, for a telegraph first.
    events.push(...tick(s, walking));
    expect(of(events, "hurt").map((e) => e.tick)).toEqual([86]);
  });

  it("not while the thing is dazed", () => {
    const walking = tuned({ tokenSpeed: 0 });
    const s = night(walking);
    put(s, "bunny", 180 + 10, 374, { dazedUntil: 30 });
    const events = run(s, walking, 30);
    expect(of(events, "hurt")).toEqual([]);
    events.push(...tick(s, walking));
    expect(of(events, "hurt").map((e) => e.tick)).toEqual([30]);
  });

  it("when two overlap him, the first in the room's order takes it and the other is held off", () => {
    const s = night(tune);
    const first = put(s, "token", 180 - 8, 374);
    put(s, "token", 180 + 8, 374);
    const events = tick(s, tune);
    expect(of(events, "hurt").map((e) => e.id)).toEqual([first.id]);
    expect(s.hearts).toBe(2);
  });
});

describe("after a lost heart", () => {
  it("nothing can cost a heart for 72 ticks, and on the 72nd it can", () => {
    const tune = tuned({ tokenSpeed: 0 });
    const s = night(tune);
    put(s, "bunny", 180 + 10, 374);
    const events = tick(s, tune);
    expect(s.him.invulnUntil).toBe(72);
    expect(tune.invulnTicks).toBe(72);
    // A second dust bunny is put on him. It keeps walking in, and is held off.
    events.push(...run(s, tune, 20));
    const second = put(s, "bunny", 180 - 12, 374);
    while (s.tick < 72) {
      events.push(...tick(s, tune));
      expect(distance(s, second)).toBeCloseTo(21, 6);
    }
    expect(of(events, "hurt").map((e) => e.tick)).toEqual([0]);
    events.push(...tick(s, tune));
    expect(of(events, "hurt").map((e) => [e.tick, e.id])).toEqual([
      [0, 1],
      [72, second.id],
    ]);
    expect(s.hearts).toBe(1);
  });

  it("his pips are refilled and the pip timer restarts", () => {
    const tune = tuned(STILL);
    const s = night(tune);
    for (let i = 0; i < 3; i++) tick(s, tune, shot(0, 1, 0.5));
    run(s, tune, 40);
    expect(s.pips).toBe(0);
    expect(s.him.hot).toBe(false);
    expect(s.pipTimer).toBeLessThan(60);
    put(s, "bunny", s.him.x + 10, s.him.y);
    const events = tick(s, tune);
    expect(s.pips).toBe(3);
    expect(s.pipTimer).toBe(tune.pipRefillTicks);
    expect(of(events, "pip")).toEqual([{ type: "pip", tick: s.tick - 1, pips: 3, why: "heart" }]);
    // The timer then waits, as it does whenever he is full.
    run(s, tune, 30);
    expect(s.pipTimer).toBe(tune.pipRefillTicks);
  });

  it("at full pips a lost heart reports no pip, and still restarts the timer", () => {
    const tune = tuned(STILL);
    const s = night(tune);
    s.pipTimer = 7;
    put(s, "bunny", 180 + 10, 374);
    const events = tick(s, tune);
    expect(of(events, "pip")).toEqual([]);
    expect(s.pips).toBe(3);
    expect(s.pipTimer).toBe(96);
  });
});

describe("the wave", () => {
  const tune = tuned(STILL);
  /** One tick of the slowing a shoved dust bunny gets, on a speed. */
  const slowed = (speed: number) => speed * Math.exp(-tune.lightDragK / 60) - tune.lightFriction / 60;

  it("throws every dust bunny within 90 u straight away from him at 260 u/s", () => {
    const s = night(tune);
    put(s, "bunny", 180 + 10, 374);
    const near = put(s, "bunny", 180 + 30, 374 - 40);
    const edge = put(s, "bunny", 180, 374 - 90);
    const beyond = put(s, "bunny", 180 - 90.01, 374);
    tick(s, tune);
    // Straight away: along the line from his centre through its own.
    expect(near.vx / near.vy).toBeCloseTo(30 / -40, 9);
    expect(near.vx).toBeGreaterThan(0);
    // 260 u/s, less the one tick of slowing it has had since.
    expect(Math.hypot(near.vx, near.vy)).toBeCloseTo(slowed(260), 9);
    expect(edge.vx).toBe(0);
    expect(edge.vy).toBeCloseTo(-slowed(260), 9);
    expect([beyond.vx, beyond.vy]).toEqual([0, 0]);
    expect(tune.hitWaveRadius).toBe(90);
    expect(tune.hitWaveSpeed).toBe(260);
  });

  it("carries a dust bunny about 87 u, and it slows to rest as a knocked thing does", () => {
    const s = night(tune);
    const taker = put(s, "bunny", 180, 374 - 10);
    tick(s, tune);
    run(s, tune, 300);
    expect([taker.vx, taker.vy]).toEqual([0, 0]);
    expect(374 - 10 - taker.y).toBeGreaterThan(84);
    expect(374 - 10 - taker.y).toBeLessThan(90);
    expect(taker.x).toBe(180);
  });

  it("turns every token within 90 u to roll straight away at its usual speed", () => {
    const rolling = tuned({ bunnySpeed: 0 });
    const s = night(rolling);
    put(s, "bunny", 180 + 10, 374);
    const near = put(s, "token", 180, 374 - 60, { vx: 150, vy: 0 });
    const far = put(s, "token", 180 + 120, 374, { vx: 0, vy: 150 });
    tick(s, rolling);
    // It was rolling across the room above him; now it rolls straight away
    // from him, from where the wave caught it (it had rolled 2.5 u on).
    // Turned, not shoved: no faster than a token rolls.
    expect(near.vx / near.vy).toBeCloseTo(2.5 / -60, 9);
    expect(near.vy).toBeLessThan(-149);
    expect(Math.hypot(near.vx, near.vy)).toBeCloseTo(150, 9);
    expect([far.vx, far.vy]).toEqual([0, 150]);
    // And it never slows.
    run(s, rolling, 60);
    expect(Math.hypot(near.vx, near.vy)).toBeCloseTo(150, 9);
  });

  it("pops nothing and dazes nothing", () => {
    const s = night(tune);
    put(s, "bunny", 180 + 10, 374);
    put(s, "bunny", 180 - 40, 374);
    put(s, "token", 180, 374 + 50);
    const events = tick(s, tune);
    expect(s.things).toHaveLength(3);
    expect(of(events, "pop")).toEqual([]);
    expect(of(events, "daze")).toEqual([]);
    expect(s.things.map((d) => d.dazedUntil)).toEqual([0, 0, 0]);
    expect(s.score).toBe(0);
  });

  it("throws dazed things too, and their daze runs on while they slide", () => {
    const s = night(tune);
    put(s, "bunny", 180 + 10, 374);
    const dazed = put(s, "bunny", 180 - 30, 374, { dazedUntil: 500 });
    tick(s, tune);
    expect(dazed.vx).toBeLessThan(-200);
    expect(dazed.dazedUntil).toBe(500);
    const before = dazed.x;
    run(s, tune, 10);
    expect(dazed.x).toBeLessThan(before - 20);
    expect(s.tick).toBeLessThan(dazed.dazedUntil);
  });

  it("does not reach a thing that is still announced", () => {
    const s = night(tune);
    put(s, "bunny", 180 + 10, 374);
    const announced = put(s, "bunny", 180 - 50, 374, { landTick: 400 });
    const token = put(s, "token", 180, 374 - 50, { landTick: 400, vx: 150, vy: 0 });
    tick(s, tune);
    expect([announced.vx, announced.vy]).toEqual([0, 0]);
    expect([token.vx, token.vy]).toEqual([150, 0]);
  });

  it("throws the one that took the heart, and one standing on his very centre goes off to the right", () => {
    const s = night(tune);
    const onHim = put(s, "bunny", 180, 374);
    tick(s, tune);
    expect(onHim.vx).toBeCloseTo(slowed(260), 9);
    expect(onHim.vy).toBe(0);
  });
});

describe("held at arm's length", () => {
  it("a dazed dust bunny that overlaps him is put back touching him, and he is not moved", () => {
    const tune = tuned(STILL);
    const s = night(tune);
    const bunny = put(s, "bunny", 180 + 6, 374 + 8, { dazedUntil: 900 });
    const events = run(s, tune, 5);
    expect(distance(s, bunny)).toBeCloseTo(21, 9);
    // Out along the line between the two centres.
    expect((bunny.x - 180) / (bunny.y - 374)).toBeCloseTo(6 / 8, 9);
    expect([s.him.x, s.him.y]).toEqual([180, 374]);
    expect(of(events, "hurt")).toEqual([]);
  });

  it("while he is invulnerable a token bounces off him", () => {
    const tune = tuned({ bunnySpeed: 0 });
    const s = night(tune);
    s.him.invulnUntil = 500;
    const token = put(s, "token", 180 + 30, 374, { vx: -150, vy: 0 });
    const events = run(s, tune, 10);
    // It came in from the right and went back out to the right, as fast as it came.
    expect(token.vx).toBeCloseTo(150, 9);
    expect(token.vy).toBeCloseTo(0, 9);
    expect(token.x).toBeGreaterThan(180 + 21);
    expect(of(events, "hurt")).toEqual([]);
    expect([s.him.x, s.him.y, s.hearts]).toEqual([180, 374, 3]);
  });

  it("a token that rolls into a landed mascot who can be hurt takes a heart: slow is a target", () => {
    const tune = tuned({ bunnySpeed: 0 });
    const s = night(tune);
    const token = put(s, "token", 180 + 80, 374, { vx: -150, vy: 0 });
    const events = run(s, tune, 40);
    expect(of(events, "hurt").map((e) => e.by)).toEqual(["token"]);
    // The wave turned it round.
    expect(token.vx).toBeCloseTo(150, 9);
  });
});

describe("the last heart", () => {
  const tune = tuned({ ...STILL, hearts: 1 });

  it("ends the night where it stands", () => {
    const s = night(tune, { hour: 5 });
    s.score = 1230;
    const bunny = put(s, "bunny", 180 + 10, 374);
    const other = put(s, "token", 300, 100);
    const events = tick(s, tune);
    expect(s.hearts).toBe(0);
    expect(s.phase).toBe("over");
    expect(s.ended).toBe("hearts");
    expect(events.map((e) => e.type)).toEqual(["hurt", "over"]);
    expect(of(events, "over")).toEqual([{ type: "over", tick: 0, how: "hearts", score: 1230 }]);
    expect(s.lastHurtBy).toBe("bunny");
    expect(s.lastHurtHour).toBe(5);
    // The tick it ended in is counted, and nothing is added to the score.
    expect(s.tick).toBe(1);
    expect(s.normalTicks + s.slowedTicks).toBe(1);
    expect(s.score).toBe(1230);
    // What was in the room is still there.
    expect(s.things).toEqual([bunny, other]);
  });

  it("after that nothing moves and no input is taken", () => {
    const s = night(tune);
    put(s, "bunny", 180 + 10, 374);
    put(s, "token", 300, 100, { vx: 100, vy: 100 });
    tick(s, tune);
    const over = hashState(s);
    const copy = cloneState(s);
    const events = run(s, tune, 50, REST);
    events.push(...tick(s, tune, shot(0, -1)));
    events.push(...run(s, tune, 50, { launch: null, pullHeld: true }));
    expect(events).toEqual([]);
    expect(hashState(s)).toBe(over);
    expect(s).toEqual(copy);
  });

  it("a launch in flight cannot be the one that ends it: he is never hurt while hot", () => {
    const s = night(tune);
    for (let i = 0; i < 6; i++) put(s, "bunny", 180 - 40 + i * 16, 374 - 40);
    const events = fire(s, tune, shot(0, -1), 12);
    expect(of(events, "pop").length).toBeGreaterThan(0);
    expect(of(events, "hurt")).toEqual([]);
    expect(s.phase).toBe("night");
  });
});
