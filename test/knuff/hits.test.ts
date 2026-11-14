import { describe, expect, it } from "vitest";
import { DARK_PLATES } from "../../lib/knuff/content/charms";
import { KINDS } from "../../lib/knuff/content/kinds";
import { BOSS_HOUR } from "../../lib/knuff/content/night";
import { BOSS_TELEGRAPH, boxOf, laneMiddle, overlapDepth } from "../../lib/knuff/sim/boss";
import { gapToGum } from "../../lib/knuff/sim/battery";
import { aimLine } from "../../lib/knuff/sim/aim";
import { land } from "../../lib/knuff/sim/hot";
import { HIM_MASS, slow } from "../../lib/knuff/sim/physics";
import { cloneState, createState, type StartOptions } from "../../lib/knuff/sim/state";
import type { BossMode, SimEvent, State, Thing, Tune } from "../../lib/knuff/sim/types";
import { distance, fire, night, of, put, run, shot, speedOf, tick, tuned, until } from "./room";

/**
 * What hits what (§5.3): one case for every cell of the table that can
 * happen by now. The table's rows are the things that can hit, shove, daze
 * or cost a heart; its columns are what they meet. A cell that says "—" is
 * a case too: that nothing happens there is a rule.
 *
 * "Pops in one hit" is the dust bunny, the token and the envelope (step 5).
 *
 * Every room is set up by hand: nothing walks, drifts or rolls unless a
 * case says so, every plate is dark unless a case lights one, and nothing
 * is offered.
 */

const STILL = { bunnySpeed: 0, batterySpeed: 0, tokenSpeed: 0, envelopeSpeed: 0, bagSpeed: 0 };
const T = tuned(STILL);
const DARK: StartOptions = { plates: DARK_PLATES, offers: false };

/** A night begun by hand in an empty room, him at the start, landed. */
function room(tune: Tune = T, start: StartOptions = {}): State {
  return night(tune, { ...DARK, ...start });
}

/** Put him somewhere, landed. */
function stand(s: State, x: number, y: number): void {
  const h = s.him;
  h.x = x;
  h.y = y;
  h.px = x;
  h.py = y;
  h.vx = 0;
  h.vy = 0;
  h.hot = false;
}

/** A battery, landed, its fuse running out `fuse` ticks from now. */
function battery(s: State, x: number, y: number, over: Partial<Thing> = {}, fuse = 300): Thing {
  return put(s, "battery", x, y, { fuseTick: s.tick + fuse, ...over });
}

/** A battery he has knocked and that is flying, by hand: his, its blast this launch's. */
function knocked(s: State, x: number, y: number, vx: number, vy: number, over: Partial<Thing> = {}): Thing {
  return battery(s, x, y, { mine: true, knockTick: s.tick, launchId: Math.max(1, s.launch.id), fuseTick: s.tick + 48, vx, vy, ...over });
}

/** The love heart's tile, lying there, until long after any case ends. */
function heart(s: State, x: number, y: number): Thing {
  return put(s, "heart", x, y, { landTick: 0, goneTick: 1e9 });
}

/** Light one plate with a wall charm. */
function light(s: State, plate: number, charm: string): void {
  s.plates[plate] = { charm, readyTick: 0 };
}

/** Is it still in the room? */
const alive = (s: State, d: Thing) => s.things.includes(d) && d.hp > 0;

/** Ticks until a battery bursts (at most `most`), and what happened. */
function toBurst(s: State, tune: Tune, most = 400): SimEvent[] {
  return until(s, tune, (e) => of(e, "burst").length > 0, most);
}

/** The tick a heart is lost in a one-tick blast, with him landed at `dist` u from a battery not his that goes off on the next tick. */
function blastAt(dist: number, over: (s: State) => void = () => {}): { s: State; events: SimEvent[] } {
  const s = room();
  const b = battery(s, 180, 374 - dist, {}, 1);
  over(s);
  const events = run(s, T, 2);
  expect(of(events, "burst").map((e) => e.id)).toEqual([b.id]);
  return { s, events };
}

// ── The polisher, begun by hand as the boss suite begins it ───────────

const QUIET = { ...STILL, bossTrickleTicks: 1_000_000, bossSpeed: 70 };
const B = tuned(QUIET);

/** 06:00 begun by hand, the machine landed, him out of its way. */
function fight(tune: Tune = B): State {
  const s = createState(1, tune, { hour: BOSS_HOUR, empty: true, kinds: ["polisher"], ...DARK });
  s.phase = "boss";
  tick(s, tune);
  stand(s, 180, 300);
  run(s, tune, BOSS_TELEGRAPH);
  expect(s.boss.mode).toBe("lane");
  return s;
}

function machine(s: State, o: { lane: number; x: number; dir?: 1 | -1; mode?: BossMode; until?: number; laneStep?: 1 | -1 }): void {
  const b = s.boss;
  b.lane = o.lane;
  b.y = laneMiddle(s, o.lane);
  b.x = o.x;
  if (o.dir !== undefined) b.dir = o.dir;
  if (o.mode !== undefined) b.mode = o.mode;
  if (o.until !== undefined) b.modeUntil = o.until;
  if (o.laneStep !== undefined) b.laneStep = o.laneStep;
  b.px = b.x;
  b.py = b.y;
}

// ── 1. His hot body, no cushion yet this launch ───────────────────────

describe("his hot body, no cushion yet this launch", () => {
  it("pops in one hit: a dust bunny, a token or an envelope pops, and he flies on (rule 6)", () => {
    for (const kind of ["bunny", "token", "envelope"] as const) {
      const s = room();
      const d = put(s, kind, 180, 300);
      const events = fire(s, T, shot(0, -1), 8);
      const [pop] = of(events, "pop");
      expect([pop.id, pop.source, pop.cushions, pop.points]).toEqual([d.id, "body", 1, KINDS[kind].points]);
      expect(alive(s, d)).toBe(false);
      expect(s.him.hot).toBe(true);
      expect(s.him.vy).toBeLessThan(0);
    }
  });

  it("a battery is knocked: it flies off along the line between the two centres at 0.9 of his speed along it, and it is his", () => {
    const s = room();
    // A little off his line, so the line between the centres is not his heading.
    const b = battery(s, 186, 300);
    const events = fire(s, T, shot(0, -1), 6);
    const [k] = of(events, "knock");
    expect(k.id).toBe(b.id);
    const nx = (k.x - k.hx) / Math.hypot(k.x - k.hx, k.y - k.hy);
    const ny = (k.y - k.hy) / Math.hypot(k.x - k.hx, k.y - k.hy);
    // His velocity going in was straight up at `k.speed`: along the line, that is -ny of it.
    const along = -k.speed * ny;
    expect(k.vx).toBeCloseTo(0.9 * along * nx, 6);
    expect(k.vy).toBeCloseTo(0.9 * along * ny, 6);
    expect([b.mine, b.launchId, b.knockTick]).toEqual([true, s.launch.id, k.tick]);
    // It bursts 48 ticks after the knock at the latest.
    expect(b.fuseTick).toBe(k.tick + 48);
    expect(k.until).toBe(k.tick + 48);
    // It stopped drifting.
    expect([b.wx, b.wy]).toEqual([0, 0]);
    // He felt a light body's pop and flies on; a knock is a contact.
    expect(s.him.hot).toBe(true);
    expect(s.him.lastContactTick).toBe(k.tick);
    expect(of(events, "pop")).toEqual([]);
  });

  it("a knock: he feels the impulse of a pop of a lightMass body along the line between the centres, then the tick's drag", () => {
    const s = room();
    const b = battery(s, 186, 300);
    tick(s, T, shot(0, -1));
    let v0 = { vx: s.him.vx, vy: s.him.vy };
    let k: Extract<SimEvent, { type: "knock" }> | undefined;
    for (let i = 0; i < 20 && k === undefined; i++) {
      v0 = { vx: s.him.vx, vy: s.him.vy };
      [k] = of(tick(s, T), "knock");
    }
    expect(k?.id).toBe(b.id);
    if (k === undefined) return;
    const len = Math.hypot(k.x - k.hx, k.y - k.hy);
    const nx = (k.x - k.hx) / len;
    const ny = (k.y - k.hy) / len;
    // The battery stood still: his closing speed is his velocity along the line.
    const closing = v0.vx * nx + v0.vy * ny;
    const impulse = (m: number) => ((1 + T.bodyRestitution) * closing) / (1 / HIM_MASS + 1 / m);
    const after = (m: number) => {
      const v = { x: 0, y: 0, vx: v0.vx - (impulse(m) / HIM_MASS) * nx * s.stats.popImpulse, vy: v0.vy - (impulse(m) / HIM_MASS) * ny * s.stats.popImpulse };
      slow(v, T.dragK, T.friction, T.restSpeed);
      return v;
    };
    const want = after(T.lightMass);
    expect(s.him.vx).toBeCloseTo(want.vx, 6);
    expect(s.him.vy).toBeCloseTo(want.vy, 6);
    // A heavy body's pop would leave him going another way.
    const heavy = after(1);
    expect(Math.hypot(heavy.vx - want.vx, heavy.vy - want.vy)).toBeGreaterThan(20);
  });

  it("a battery knocked again: sent off along the new line, its blast this launch's, and its 48 ticks not restarted", () => {
    const s = room();
    run(s, T, 40);
    // Knocked 30 ticks ago by launch 1, it has come to rest in his path: 18 ticks of its knock's time are left.
    s.launch = { ...s.launch, id: 1 };
    const b = battery(s, 180, 300, { mine: true, knockTick: s.tick - 30, launchId: 1, fuseTick: s.tick + 18 });
    const until = b.fuseTick;
    const events = fire(s, T, shot(0, -1), 6);
    const [k] = of(events, "knock");
    expect(k.id).toBe(b.id);
    expect(k.vy).toBeLessThan(0);
    expect([b.knockTick, b.fuseTick, k.until]).toEqual([until - 48, until, until]);
    expect(b.launchId).toBe(2);
    const burst = of(toBurst(s, T, 30), "burst");
    expect(burst.map((e) => [e.id, e.tick])).toEqual([[b.id, until]]);
  });

  it("gum with two hits left: one hit, 15 points, and he stops dead on it and lands, with the thump", () => {
    const s = room();
    const g = put(s, "gum", 180, 280);
    const bunny = put(s, "bunny", 180 + 30, 296);
    const events = fire(s, T, shot(0, -1), 20);
    const [hit] = of(events, "hit");
    expect([hit.kind, hit.id, hit.left, hit.points, hit.two, hit.source, hit.stop]).toEqual(["gum", g.id, 1, 15, false, "body", true]);
    const [land] = of(events, "land");
    expect(land.tick).toBe(hit.tick);
    expect([land.x, land.y]).toEqual([hit.x, hit.y]);
    expect(s.him.hot).toBe(false);
    expect([s.him.vx, s.him.vy]).toEqual([0, 0]);
    // On it: his circle overlaps its box.
    expect(Math.abs(s.him.y - g.y)).toBeLessThan(13 + 6);
    expect(g.hp).toBe(1);
    expect(s.score).toBe(15);
    // The thump dazed the dust bunny beside him.
    expect(s.tick < bunny.dazedUntil).toBe(true);
    // The hit that stops him is not a contact.
    expect(s.him.lastContactTick).toBe(-1);
  });

  it("gum: a launch released on top of it cannot hit it until he has left it (rule 5); left and come back, it can", () => {
    const s = room();
    // Near the top cushion, so that the launch released on it comes back down through it.
    const g = put(s, "gum", 180, 100);
    fire(s, T, shot(0, -1), 30);
    // Stopped on it, one hit left, standing on its box.
    expect([g.hp, s.him.hot]).toEqual([1, false]);
    expect(gapToGum(s.him.x, s.him.y, g)).toBeLessThan(s.stats.radius);
    // Released on it, straight up: nothing as he leaves it.
    const events = tick(s, T, shot(0, -1));
    expect(s.launch.blocked).toContain(g.id);
    events.push(...until(s, T, () => gapToGum(s.him.x, s.him.y, g) >= s.stats.radius, 30));
    expect(gapToGum(s.him.x, s.him.y, g)).toBeGreaterThanOrEqual(s.stats.radius);
    expect(of(events, "hit")).toEqual([]);
    expect(g.hp).toBe(1);
    // Off the top cushion and back down through it: now it is hit, and the hit counts as two.
    const back = until(s, T, (e) => of(e, "hit").length > 0 || of(e, "land").length > 0, 120);
    const [hit] = of(back, "hit");
    expect([hit.id, hit.kind, hit.source, hit.two, hit.left, hit.points, hit.stop]).toEqual([g.id, "gum", "body", true, 0, 15, false]);
    expect(alive(s, g)).toBe(false);
  });

  it("a gum stop leaves him at least one pip: with none, he is given one", () => {
    const s = room();
    put(s, "gum", 180, 280);
    s.pips = 1;
    const events = fire(s, T, shot(0, -1), 20);
    expect(of(events, "pip").map((e) => [e.why, e.pips])).toEqual([["gum", 1]]);
    expect(s.pips).toBe(1);
    // With a pip in hand, nothing is given.
    const t = room();
    put(t, "gum", 180, 280);
    t.pips = 2;
    expect(of(fire(t, T, shot(0, -1), 12), "pip")).toEqual([]);
    expect(t.pips).toBe(1);
  });

  it("gum with one hit left: it pops, 15 points, and he flies on unslowed", () => {
    const s = room();
    const g = put(s, "gum", 180, 280, { hp: 1 });
    const events = tick(s, T, shot(0, -1));
    let before = speedOf(s);
    let hitTick = -1;
    for (let i = 0; i < 10 && hitTick < 0; i++) {
      before = speedOf(s);
      const e = tick(s, T);
      events.push(...e);
      if (of(e, "hit").length > 0) hitTick = s.tick - 1;
    }
    const [hit] = of(events, "hit");
    expect([hit.left, hit.points, hit.two, hit.stop]).toEqual([0, 15, false, false]);
    expect(alive(s, g)).toBe(false);
    // Unslowed: the tick's drag alone.
    expect(speedOf(s)).toBeCloseTo(before * Math.exp(-T.dragK / 60) - T.friction / 60, 6);
    expect(s.him.hot).toBe(true);
    expect(s.him.lastContactTick).toBe(hitTick);
  });

  it("the money bag: one hit, 40, flat, and he bounces off (bodyRestitution); met again in that launch, a bounce and no hit", () => {
    const s = room();
    stand(s, 180, 440);
    const bag = put(s, "bag", 180, 380);
    // Up into it, down off it to the bottom cushion, and back up into it.
    const events = fire(s, T, shot(0, -1), 40);
    const hits = of(events, "hit");
    expect(hits.map((e) => [e.kind, e.id, e.left, e.points, e.two, e.source])).toEqual([["bag", bag.id, 7, 40, false, "body"]]);
    expect(bag.hp).toBe(7);
    expect(s.score).toBe(40);
    const bounces = of(events, "bounce");
    expect(bounces.map((e) => [e.kind, e.id])).toEqual([["bag", bag.id]]);
    expect(bounces[0].tick).toBeGreaterThan(hits[0].tick);
    // He cannot move it.
    expect([bag.x, bag.y, bag.vx, bag.vy]).toEqual([180, 380, 0, 0]);
    // The first meeting sent him back down: 0.6 of his speed into it.
    const after = of(events, "cushion")[0];
    expect(after.side).toBe("bottom");
    expect(s.him.lastContactTick).toBe(bounces[0].tick);
  });

  it("the money bag, head on: his speed along the line between the centres comes back at 0.6 of itself", () => {
    const s = room();
    stand(s, 180, 440);
    put(s, "bag", 180, 300);
    tick(s, T, shot(0, -1));
    let speedIn = speedOf(s);
    let events = tick(s, T);
    for (let i = 0; i < 20 && of(events, "hit").length === 0; i++) {
      speedIn = speedOf(s);
      events = tick(s, T);
    }
    expect(of(events, "hit")).toHaveLength(1);
    // Straight down at 0.6 of what he came in with, less the tick's drag.
    expect(s.him.vx).toBeCloseTo(0, 9);
    expect(s.him.vy).toBeGreaterThan(0.6 * speedIn * 0.9);
    expect(s.him.vy).toBeLessThan(0.6 * speedIn);
  });

  it("the love heart is taken, if he is missing a heart: he gets one, and he is not slowed; at full hearts it stays", () => {
    const s = room();
    s.hearts = 2;
    const h = heart(s, 180, 280);
    const events = fire(s, T, shot(0, -1), 10);
    expect(of(events, "heartTaken").map((e) => [e.id, e.hearts])).toEqual([[h.id, 3]]);
    expect([s.hearts, alive(s, h)]).toEqual([3, false]);
    expect(of(events, "pop")).toEqual([]);
    const free = room();
    fire(free, T, shot(0, -1), 10);
    expect(speedOf(s)).toBeCloseTo(speedOf(free), 9);
    // Full: not taken, and it stays.
    const full = room();
    const stays = heart(full, 180, 280);
    expect(of(fire(full, T, shot(0, -1), 10), "heartTaken")).toEqual([]);
    expect([full.hearts, alive(full, stays)]).toEqual([3, true]);
  });

  it("a pickup is taken, if the offer allows, and he is not slowed", () => {
    const s = room();
    run(s, T, 2);
    const tile = put(s, "pickup", 180, 280, { landTick: 0 });
    s.offer = { open: true, openTick: 1, armedTick: 1, items: [{ kind: "pickup", charm: "heavy", plate: -1, thingId: tile.id }] };
    const events = fire(s, T, shot(0, -1), 10);
    expect(of(events, "offerTaken").map((e) => e.charm)).toEqual(["heavy"]);
    expect(s.charms).toEqual(["heavy"]);
    expect(of(events, "pop")).toEqual([]);
    // Not slowed: his speed is the open floor's.
    const free = room();
    fire(free, T, shot(0, -1), 10);
    expect(speedOf(s)).toBeCloseTo(speedOf(free), 9);
  });

  it("the polisher's plug: one hit, only while it moves along a lane, and he bounces off", () => {
    const s = fight();
    machine(s, { lane: 3, x: 200, dir: 1 });
    stand(s, 60, 212);
    const events = tick(s, B, shot(1, 0));
    events.push(...until(s, B, (e) => of(e, "hit").length > 0, 30));
    const [hit] = of(events, "hit");
    expect([hit.kind, hit.left, hit.points, hit.two]).toEqual(["polisher", 5, 200, false]);
    expect(s.him.vx).toBeLessThan(0);
    // Stalled, the same launch is a bounce off the casing.
    const t = fight();
    machine(t, { lane: 3, x: 200, dir: 1, mode: "hitStall", until: t.tick + 200 });
    stand(t, 60, 212);
    const ev = fire(t, B, shot(1, 0), 30);
    expect(of(ev, "hit")).toEqual([]);
    expect(of(ev, "bossBounce").map((e) => e.part)).toEqual(["casing"]);
  });

  it("the polisher's casing: he bounces as off a cushion, and it never counts as one", () => {
    const s = fight();
    machine(s, { lane: 3, x: 180, dir: 1, mode: "hitStall", until: s.tick + 200 });
    stand(s, 180, 120);
    const events = tick(s, B, shot(0, 1));
    events.push(...until(s, B, (e) => of(e, "bossBounce").length > 0, 20));
    const [bounce] = of(events, "bossBounce");
    expect(bounce.part).toBe("casing");
    expect(bounce.vy).toBeCloseTo(-0.84 * bounce.speed, 6);
    expect(of(events, "cushion")).toEqual([]);
    expect(s.launch.cushions).toBe(0);
  });

  it("him: nothing (his body does not meet itself)", () => {
    const s = room();
    const events = fire(s, T, shot(0, -1), 20);
    expect(events.filter((e) => e.type === "hurt" || e.type === "pop" || e.type === "hit" || e.type === "knock")).toEqual([]);
  });
});

// ── 2. His hot body, off a cushion ────────────────────────────────────

describe("his hot body, off a cushion", () => {
  /** He stands under the top cushion; a launch straight up bounces off plate 1 and comes back down the room. */
  function banked(): State {
    const s = room();
    stand(s, 180, 60);
    return s;
  }

  it("pops in one hit: the same, and the pop is multiplied by the cushion", () => {
    for (const kind of ["bunny", "token", "envelope"] as const) {
      const s = banked();
      put(s, kind, 180, 150);
      const events = fire(s, T, shot(0, -1), 20);
      expect(of(events, "cushion")).toHaveLength(1);
      const [pop] = of(events, "pop");
      expect([pop.kind, pop.source, pop.cushions, pop.points]).toEqual([kind, "body", 2, 2 * KINDS[kind].points]);
      expect(s.him.hot).toBe(true);
    }
  });

  it("a battery: the same, it is knocked and it is his", () => {
    const s = banked();
    const b = battery(s, 180, 150);
    const events = fire(s, T, shot(0, -1), 20);
    expect(of(events, "cushion")).toHaveLength(1);
    expect(of(events, "knock").map((e) => e.id)).toEqual([b.id]);
    expect(b.mine).toBe(true);
    // Straight down the room, at 0.9 of his speed going in.
    const [k] = of(events, "knock");
    expect(k.vx).toBeCloseTo(0, 9);
    expect(k.vy).toBeCloseTo(0.9 * k.speed, 6);
  });

  it("gum with two left: the hit counts as two, it pops at once, 30 points, and he flies on", () => {
    const s = banked();
    const g = put(s, "gum", 180, 150);
    const events = fire(s, T, shot(0, -1), 20);
    const [hit] = of(events, "hit");
    expect([hit.left, hit.points, hit.two, hit.stop, hit.source]).toEqual([0, 30, true, false, "body"]);
    expect(alive(s, g)).toBe(false);
    expect(of(events, "land")).toEqual([]);
    expect(s.him.hot).toBe(true);
    expect(s.score).toBe(30);
  });

  it("gum with one left: off a cushion it takes the one hit point there is, and pays once", () => {
    const s = banked();
    put(s, "gum", 180, 150, { hp: 1 });
    const [hit] = of(fire(s, T, shot(0, -1), 20), "hit");
    expect([hit.left, hit.points, hit.two]).toEqual([0, 15, true]);
  });

  it("the money bag: two hits, 80, and it lets out its first token at 6 left", () => {
    const s = banked();
    const bag = put(s, "bag", 180, 200);
    const events = fire(s, T, shot(0, -1), 20);
    expect(of(events, "cushion")).toHaveLength(1);
    const [hit] = of(events, "hit");
    expect([hit.kind, hit.left, hit.points, hit.two, hit.source]).toEqual(["bag", 6, 80, true, "body"]);
    expect(bag.hp).toBe(6);
    expect(of(events, "bagToken")).toHaveLength(1);
  });

  it("the love heart: the same, it is taken", () => {
    const s = banked();
    s.hearts = 1;
    const h = heart(s, 180, 150);
    const events = fire(s, T, shot(0, -1), 20);
    expect(of(events, "cushion")).toHaveLength(1);
    expect(of(events, "heartTaken").map((e) => e.id)).toEqual([h.id]);
    expect(s.hearts).toBe(2);
  });

  it("a pickup: the same, it is taken", () => {
    const s = banked();
    run(s, T, 2);
    const tile = put(s, "pickup", 180, 150, { landTick: 0 });
    s.offer = { open: true, openTick: 1, armedTick: 1, items: [{ kind: "pickup", charm: "wide", plate: -1, thingId: tile.id }] };
    const events = fire(s, T, shot(0, -1), 20);
    expect(of(events, "cushion")).toHaveLength(1);
    expect(of(events, "offerTaken").map((e) => e.charm)).toEqual(["wide"]);
  });

  it("the polisher's plug: two hits", () => {
    const s = fight();
    machine(s, { lane: 3, x: 220, dir: 1 });
    // Against the left cushion, he bounces off it first and then meets the plug.
    stand(s, 60, 212);
    const events = fire(s, B, shot(-1, 0), 40);
    expect(of(events, "cushion").map((e) => e.side)).toEqual(["left"]);
    const [hit] = of(events, "hit");
    expect([hit.left, hit.points, hit.two]).toEqual([4, 400, true]);
  });
});

// ── 3. Spark's ring ───────────────────────────────────────────────────

describe("Spark's ring (it only exists after a cushion)", () => {
  /** Spark on plate 1: a launch straight up from under it bounces off it and comes back down with the ring on. */
  function sparked(): State {
    const s = room();
    light(s, 1, "spark");
    stand(s, 180, 60);
    return s;
  }
  /** Off his line by more than his body and less than the ring: 13 u + 6 u. */
  const SIDE = 180 + 13 + 6;

  /** The launch, a tick at a time: how near his edge came to `gap(s)`'s thing while the ring was on. */
  function nearest(s: State, gap: (s: State) => number, ticks = 20): { events: SimEvent[]; closest: number } {
    const events = tick(s, T, shot(0, -1));
    let closest = Infinity;
    for (let i = 0; i < ticks; i++) {
      events.push(...tick(s, T));
      if (s.him.hot && s.tick < s.launch.sparkUntil) closest = Math.min(closest, gap(s));
    }
    return { events, closest };
  }

  it("pops in one hit: it pops and counts in his chain, it is not a body pop, he feels nothing, and it is a contact", () => {
    for (const kind of ["bunny", "token", "envelope"] as const) {
      const s = sparked();
      const d = put(s, kind, SIDE + KINDS[kind].radius, 150);
      const events = fire(s, T, shot(0, -1), 20);
      const [pop] = of(events, "pop");
      expect([pop.id, pop.source, pop.n]).toEqual([d.id, "spark", 1]);
      expect(s.launch.pops).toBe(1);
      expect(s.launch.bodyPops).toBe(0);
      expect(s.him.vx).toBe(0);
      expect(s.him.lastContactTick).toBe(pop.tick);
    }
  });

  it("a battery: nothing (the ring does not knock it)", () => {
    const s = sparked();
    const b = battery(s, SIDE + 10, 150);
    const { events, closest } = nearest(s, (s) => distance(s, b) - 13 - 10);
    // The ring passed over it: it came within the ring's reach and stayed out of his body's.
    expect(closest).toBeGreaterThan(0);
    expect(closest).toBeLessThan(12);
    expect(of(events, "knock")).toEqual([]);
    expect(b.mine).toBe(false);
    expect([b.vx, b.vy]).toEqual([0, 0]);
  });

  it("gum: one hit that counts as two, and it pops", () => {
    const s = sparked();
    // The box's near edge 6 u past his edge.
    const g = put(s, "gum", SIDE + 14, 150);
    const events = fire(s, T, shot(0, -1), 20);
    const [hit] = of(events, "hit");
    expect([hit.id, hit.source, hit.two, hit.left, hit.points, hit.stop]).toEqual([g.id, "spark", true, 0, 30, false]);
    expect(alive(s, g)).toBe(false);
    expect(s.him.hot).toBe(true);
  });

  it("the money bag: one hit that counts as two, if the bag has not been hit this launch", () => {
    const s = sparked();
    const bag = put(s, "bag", SIDE + 34, 150);
    const events = fire(s, T, shot(0, -1), 20);
    const hits = of(events, "hit");
    expect(hits.map((e) => [e.id, e.source, e.two, e.left, e.points])).toEqual([[bag.id, "spark", true, 6, 80]]);
    expect(of(events, "bounce")).toEqual([]);
    expect(s.him.lastContactTick).toBe(hits[0].tick);
    // In his path: the ring reaches it first and takes the launch's one hit; his body then only bounces off it.
    const t = sparked();
    const inPath = put(t, "bag", 180, 200);
    const ev = fire(t, T, shot(0, -1), 20);
    expect(of(ev, "hit").map((e) => [e.id, e.source, e.two])).toEqual([[inPath.id, "spark", true]]);
    expect(of(ev, "bounce").map((e) => e.id)).toEqual([inPath.id]);
    expect(inPath.hp).toBe(6);
  });

  it("the love heart: nothing (only his body takes it)", () => {
    const s = sparked();
    s.hearts = 2;
    const h = heart(s, SIDE + 14, 150);
    const { events, closest } = nearest(s, (s) => h.x - 14 - s.him.x - 13);
    expect(closest).toBeGreaterThan(0);
    expect(closest).toBeLessThan(12);
    expect(of(events, "heartTaken")).toEqual([]);
    expect([s.hearts, alive(s, h)]).toEqual([2, true]);
  });

  it("a pickup: nothing (only his body takes one)", () => {
    const s = sparked();
    run(s, T, 2);
    const tile = put(s, "pickup", SIDE + 18, 150, { landTick: 0 });
    s.offer = { open: true, openTick: 1, armedTick: 1, items: [{ kind: "pickup", charm: "heavy", plate: -1, thingId: tile.id }] };
    // His edge to the tile's near side.
    const { events, closest } = nearest(s, (s) => tile.x - 18 - s.him.x - 13);
    expect(closest).toBeGreaterThan(0);
    expect(closest).toBeLessThan(12);
    expect(of(events, "offerTaken")).toEqual([]);
    expect(s.offer.open).toBe(true);
  });

  it("the polisher: nothing (the ring is never a plug hit)", () => {
    const s = fight();
    machine(s, { lane: 3, x: 200, dir: 1 });
    stand(s, 140 - 15.3, 260);
    const events = tick(s, B, shot(0, -1));
    s.launch.sparkUntil = s.tick + 48;
    events.push(...run(s, B, 12));
    expect(of(events, "hit")).toEqual([]);
    expect(s.boss.hp).toBe(B.bossHits);
  });
});

// ── 4. The landing thump ──────────────────────────────────────────────

describe("the landing thump", () => {
  /** A half-power launch straight up lands him after a short flight; things are put round where he lands. */
  function landing(put: (s: State, x: number, y: number) => void): { s: State; events: SimEvent[] } {
    const probe = room();
    fire(probe, T, shot(0, -1, 0.5), 40);
    const s = room();
    put(s, probe.him.x, probe.him.y);
    const events = fire(s, T, shot(0, -1, 0.5), 40);
    expect([s.him.x, s.him.y]).toEqual([probe.him.x, probe.him.y]);
    return { s, events };
  }

  it("dust bunnies within 40 u are dazed 36 ticks; a token or an envelope is not dazed, not turned and not moved", () => {
    let bunny: Thing | null = null;
    let token: Thing | null = null;
    let envelope: Thing | null = null;
    let at = { x: 0, y: 0 };
    const { s, events } = landing((s, x, y) => {
      bunny = put(s, "bunny", x + 30, y);
      token = put(s, "token", x - 30, y, { vx: 0, vy: 0 });
      // Pointed at him, so its heading does not turn.
      envelope = put(s, "envelope", x, y - 30, { heading: Math.PI / 2 });
      at = { x, y: y - 30 };
    });
    const [land] = of(events, "land");
    expect(land.dazed).toBe(1);
    expect(bunny!.dazedUntil).toBe(land.tick + 36);
    expect(token!.dazedUntil).toBe(0);
    expect([envelope!.dazedUntil, envelope!.x, envelope!.y, envelope!.heading, envelope!.vx, envelope!.vy]).toEqual([0, at.x, at.y, Math.PI / 2, 0, 0]);
    expect(s.things.length).toBe(3);
  });

  it("a battery: nothing (not dazed, not moved)", () => {
    let b: Thing | null = null;
    landing((s, x, y) => {
      b = battery(s, x + 30, y);
    });
    expect(b!.dazedUntil).toBe(0);
    expect([b!.vx, b!.vy]).toEqual([0, 0]);
  });

  it("the money bag: nothing (not dazed, not moved), even with its centre inside the ring", () => {
    const s = room();
    // He lands where he stands, the bag's centre 38 u from his (it is dazed, so it costs no heart).
    const bag = put(s, "bag", 180 + 38, 374, { dazedUntil: 5 });
    const events: SimEvent[] = [];
    land(s, T, events);
    expect(of(events, "land")[0].dazed).toBe(0);
    expect([bag.x, bag.y, bag.dazedUntil]).toEqual([180 + 38, 374, 5]);
  });

  it("gum: nothing", () => {
    let g: Thing | null = null;
    landing((s, x, y) => {
      g = put(s, "gum", x + 30, y);
    });
    expect([g!.hp, g!.dazedUntil]).toEqual([2, 0]);
  });

  it("the polisher: nothing, and him: he has landed", () => {
    const s = fight();
    machine(s, { lane: 1, x: 180, dir: 1, mode: "hitStall", until: s.tick + 200 });
    stand(s, 180, 400);
    const before = { ...s.boss };
    const events = fire(s, B, shot(0, -1, 0.5), 40);
    expect(of(events, "land")).toHaveLength(1);
    expect(s.him.hot).toBe(false);
    expect([s.boss.x, s.boss.y, s.boss.hp]).toEqual([before.x, before.y, before.hp]);
  });
});

// ── 5. The wave of a lost heart ───────────────────────────────────────

describe("the wave of a lost heart", () => {
  /** A dust bunny touching him while he is landed costs a heart on the first tick; the wave goes out from him. */
  function hurt(over: (s: State) => void, tune: Tune = T): { s: State; events: SimEvent[] } {
    const s = room(tune);
    put(s, "bunny", 180, 374 - 20);
    over(s);
    const events = run(s, tune, 1);
    expect(of(events, "hurt")).toHaveLength(1);
    return { s, events };
  }

  it("dust bunnies within 90 u are thrown straight away at 260 u/s; tokens are turned to roll straight away", () => {
    let d: Thing | null = null;
    let t: Thing | null = null;
    hurt(
      (s) => {
        d = put(s, "bunny", 180 + 60, 374);
        t = put(s, "token", 180 - 60, 374, { vx: 150, vy: 0 });
      },
      tuned({ ...STILL, tokenSpeed: 150 }),
    );
    // Thrown at 260 u/s, and slowed by the tick's own drag as a knocked thing is.
    expect(d!.vx).toBeCloseTo(260 * Math.exp(-T.lightDragK / 60) - T.lightFriction / 60, 6);
    expect(d!.vy).toBeCloseTo(0, 9);
    expect(t!.vx).toBeCloseTo(-150, 6);
  });

  it("envelopes within 90 u are thrown straight away at 260 u/s, dazed or not; their heading is kept", () => {
    let e: Thing | null = null;
    let dz: Thing | null = null;
    let far: Thing | null = null;
    hurt(
      (s) => {
        e = put(s, "envelope", 180, 374 + 60, { heading: 2 });
        dz = put(s, "envelope", 180 - 80, 374, { dazedUntil: 100 });
        far = put(s, "envelope", 180 + 91, 374);
      },
      tuned({ ...STILL, envelopeTurnDeg: 0 }),
    );
    expect(e!.vy).toBeCloseTo(260 * Math.exp(-T.lightDragK / 60) - T.lightFriction / 60, 6);
    expect(e!.vx).toBeCloseTo(0, 9);
    expect(e!.heading).toBe(2);
    expect(dz!.vx).toBeLessThan(-200);
    expect(dz!.dazedUntil).toBe(100);
    expect([far!.vx, far!.vy]).toEqual([0, 0]);
  });

  it("a battery is thrown straight away at 260 u/s; its timers are unchanged and it does not become his", () => {
    let b: Thing | null = null;
    const { s } = hurt((s) => {
      b = battery(s, 180, 374 + 60);
    });
    const fuse = b!.fuseTick;
    expect(b!.vx).toBeCloseTo(0, 9);
    expect(b!.vy).toBeCloseTo(260 * Math.exp(-T.lightDragK / 60) - T.lightFriction / 60, 6);
    expect([b!.fuseTick, b!.knockTick, b!.mine, b!.launchId]).toEqual([fuse, -1, false, -1]);
    // Thrown, not knocked: it bounces off a cushion and does not burst there.
    const events = run(s, T, 30);
    expect(of(events, "burst")).toEqual([]);
    expect(of(events, "cushion")).toEqual([]);
    expect(b!.vy).toBeLessThan(0);
  });

  it("the money bag: nothing (it ignores the wave)", () => {
    let bag: Thing | null = null;
    hurt((s) => {
      bag = put(s, "bag", 180 + 60, 374 + 20);
    });
    expect([bag!.x, bag!.y, bag!.vx, bag!.vy, bag!.hp, bag!.dazedUntil]).toEqual([240, 394, 0, 0, 8, 0]);
  });

  it("gum: nothing", () => {
    let g: Thing | null = null;
    hurt((s) => {
      g = put(s, "gum", 180 + 40, 374);
    });
    expect([g!.x, g!.y, g!.vx, g!.vy, g!.hp]).toEqual([220, 374, 0, 0, 2]);
  });

  it("the love heart: nothing (its tile lies where it lies)", () => {
    let h: Thing | null = null;
    hurt((s) => {
      h = heart(s, 180 + 50, 374);
    });
    expect([h!.x, h!.y, h!.vx, h!.vy]).toEqual([230, 374, 0, 0]);
  });

  it("a pickup: nothing; him: invulnerable 72 ticks and his pips refilled", () => {
    let tile: Thing | null = null;
    const { s } = hurt((s) => {
      tile = put(s, "pickup", 180 + 50, 374, { landTick: 0 });
      s.pips = 0;
    });
    expect([tile!.x, tile!.y]).toEqual([230, 374]);
    expect(s.him.invulnUntil).toBe(s.tick - 1 + 72);
    expect(s.pips).toBe(3);
  });

  it("the polisher: nothing", () => {
    const s = fight();
    machine(s, { lane: 5, x: 180, dir: 1, mode: "hitStall", until: s.tick + 200 });
    stand(s, 180, 120);
    put(s, "bunny", 180, 120 + 20);
    const before = [s.boss.x, s.boss.y];
    const events = run(s, B, 1);
    expect(of(events, "hurt")).toHaveLength(1);
    expect([s.boss.x, s.boss.y]).toEqual(before);
  });
});

// ── 6. Bell ───────────────────────────────────────────────────────────

describe("Bell", () => {
  function rung(over: (s: State) => void): { s: State; events: SimEvent[] } {
    const s = room();
    light(s, 1, "bell");
    stand(s, 180, 60);
    over(s);
    const events = fire(s, T, shot(0, -1), 4);
    expect(of(events, "cushion").map((e) => e.charm)).toEqual(["bell"]);
    return { s, events };
  }

  it("dust bunnies, tokens and envelopes, all of them in the room: dazed bellDazeTicks (60 since decision 33)", () => {
    let d: Thing | null = null;
    let t: Thing | null = null;
    let e: Thing | null = null;
    const { events } = rung((s) => {
      d = put(s, "bunny", 40, 440);
      t = put(s, "token", 320, 440);
      e = put(s, "envelope", 320, 300);
    });
    const [c] = of(events, "cushion");
    const until = c.tick + T.bellDazeTicks;
    expect(T.bellDazeTicks).toBe(60);
    expect([d!.dazedUntil, t!.dazedUntil, e!.dazedUntil]).toEqual([until, until, until]);
  });

  it("a battery, gum and the money bag: nothing", () => {
    let b: Thing | null = null;
    let g: Thing | null = null;
    let bag: Thing | null = null;
    rung((s) => {
      b = battery(s, 40, 440);
      g = put(s, "gum", 320, 440);
      bag = put(s, "bag", 300, 300);
      heart(s, 60, 300);
    });
    expect([b!.dazedUntil, g!.dazedUntil, g!.hp, bag!.dazedUntil, bag!.hp]).toEqual([0, 0, 2, 0, 8]);
  });
});

// ── 7. A blast of his ─────────────────────────────────────────────────

describe("a blast of his (70 u)", () => {
  /** His battery, at rest, going off on the next tick; him landed far from it. */
  function his(x = 180, y = 150): { s: State; b: Thing } {
    const s = room();
    stand(s, 180, 440);
    const b = battery(s, x, y, { mine: true, knockTick: 0, launchId: 1 }, 1);
    return { s, b };
  }

  it("pops what pops in one hit, at twice its points, flat; not in his chain, not a body pop, not a contact", () => {
    const { s, b } = his();
    const d = put(s, "bunny", 180 + 50, 150);
    const t = put(s, "token", 180, 150 - 69);
    const e = put(s, "envelope", 180 - 60, 150 + 30);
    const far = put(s, "bunny", 180 + 71, 150);
    // A dazed thing pops all the same (rule 9), and the reach is 70 u inclusive.
    const dazed = put(s, "bunny", 180 - 30, 150 - 30, { dazedUntil: 100 });
    const edge = put(s, "bunny", 180, 150 + 70);
    const events = run(s, T, 2);
    const [burst] = of(events, "burst");
    expect([burst.id, burst.mine, burst.pops]).toEqual([b.id, true, 5]);
    expect(of(events, "pop").map((e) => [e.id, e.source, e.points, e.n, e.chain, e.cushions])).toEqual([
      [d.id, "blast", 20, 0, 1, 1],
      [t.id, "blast", 50, 0, 1, 1],
      [e.id, "blast", 30, 0, 1, 1],
      [dazed.id, "blast", 20, 0, 1, 1],
      [edge.id, "blast", 20, 0, 1, 1],
    ]);
    expect(alive(s, far)).toBe(true);
    // 40 for the battery that went off as his, and the pops.
    expect(burst.points).toBe(40 + 20 + 50 + 30 + 20 + 20);
    expect(s.score).toBe(180);
    expect([s.launch.pops, s.launch.bodyPops]).toEqual([0, 0]);
    expect(s.him.lastContactTick).toBe(-1);
    expect(alive(s, b)).toBe(false);
  });

  it("a battery is set off 12 ticks later, and it becomes his, its blast the same launch's", () => {
    const { s, b } = his();
    const other = battery(s, 180 + 60, 150);
    const events = run(s, T, 2);
    const [burst] = of(events, "burst");
    expect(burst.set).toBe(1);
    expect([other.fuseTick, other.mine, other.launchId]).toEqual([burst.tick + 12, true, b.launchId]);
    const next = toBurst(s, T, 20);
    const [second] = of(next, "burst");
    expect([second.id, second.tick, second.mine, second.why, second.launchId]).toEqual([other.id, burst.tick + 12, true, "chain", 1]);
    // Each battery that goes off as his pays 40.
    expect(s.score).toBe(80);
  });

  it("a battery already his, of another launch, set off by a blast of his takes that blast's launch (§5.4)", () => {
    const s = room();
    stand(s, 180, 440);
    const b = battery(s, 180, 150, { mine: true, knockTick: 0, launchId: 2 }, 1);
    const older = battery(s, 180 + 60, 150, { mine: true, knockTick: 0, launchId: 1, fuseTick: 400 });
    const events = run(s, T, 2);
    const [burst] = of(events, "burst");
    expect([burst.id, burst.launchId, burst.set]).toEqual([b.id, 2, 1]);
    expect([older.mine, older.launchId, older.fuseTick]).toEqual([true, 2, burst.tick + 12]);
    const [second] = of(toBurst(s, T, 20), "burst");
    expect([second.id, second.why, second.mine, second.launchId]).toEqual([older.id, "chain", true, 2]);
  });

  it("the money bag: one hit, never two, 40; its seventh hit point lost lets out no token, its eighth... at 6 left one comes", () => {
    const { s, b } = his();
    const bag = put(s, "bag", 180 + 60, 150);
    const events = run(s, T, 2);
    const [burst] = of(events, "burst");
    expect(of(events, "hit").map((e) => [e.kind, e.id, e.left, e.points, e.two, e.source])).toEqual([["bag", bag.id, 7, 40, false, "blast"]]);
    expect(burst.points).toBe(40 + 40);
    expect(of(events, "bagToken")).toEqual([]);
    // He cannot move it, and neither can a blast.
    expect([bag.x, bag.y, bag.vx, bag.vy]).toEqual([240, 150, 0, 0]);
    expect(alive(s, b)).toBe(false);
    // A blast that takes it from 7 to 6 lets a token out: one that is not caught in the blast that let it out.
    const t = his();
    const seven = put(t.s, "bag", 180 + 60, 150, { hp: 7 });
    const ev = run(t.s, T, 2);
    expect(of(ev, "bagToken").map((e) => e.bag)).toEqual([seven.id]);
    expect(of(ev, "pop")).toEqual([]);
    expect(t.s.things.filter((d) => d.kind === "token")).toHaveLength(1);
  });

  it("gum: one hit, never two (off a cushion or not), 15 points", () => {
    const { s } = his();
    const g = put(s, "gum", 180 + 40, 150);
    s.launch = { ...s.launch, id: 1, active: true, cushions: 2, lastCushionTick: 0 };
    const events = run(s, T, 2);
    const [hit] = of(events, "hit");
    expect([hit.id, hit.source, hit.left, hit.points, hit.two]).toEqual([g.id, "blast", 1, 15, false]);
    expect(of(events, "burst")[0].points).toBe(40 + 15);
  });

  it("the love heart: nothing", () => {
    const { s } = his();
    s.hearts = 2;
    const h = heart(s, 180 + 30, 150);
    run(s, T, 2);
    expect([alive(s, h), s.hearts]).toEqual([true, 2]);
  });

  it("a pickup: nothing", () => {
    const { s } = his();
    const tile = put(s, "pickup", 180 + 30, 150, { landTick: 0 });
    run(s, T, 2);
    expect(alive(s, tile)).toBe(true);
  });

  it("the polisher: nothing (a blast is never a plug hit)", () => {
    const s = fight();
    machine(s, { lane: 1, x: 180, dir: 1, mode: "lane" });
    stand(s, 180, 440);
    battery(s, 180 - 60 - 5, laneMiddle(s, 1), { mine: true, knockTick: 0, launchId: 1, vx: 0, vy: 0 }, 1);
    const events = run(s, B, 2);
    expect(of(events, "burst")).toHaveLength(1);
    expect(of(events, "hit")).toEqual([]);
    expect(s.boss.hp).toBe(B.bossHits);
  });

  it("him: nothing, ever (his own blast never hurts him), landed in it or not", () => {
    const { s } = his(180, 440 - 20);
    const events = run(s, T, 2);
    expect(of(events, "burst")).toHaveLength(1);
    expect(of(events, "hurt")).toEqual([]);
    expect(s.hearts).toBe(3);
  });
});

// ── 8. A blast that is not his ────────────────────────────────────────

describe("a blast that is not his (70 u)", () => {
  it("pops nothing, and pays nothing", () => {
    const s = room();
    stand(s, 180, 440);
    const d = put(s, "bunny", 180 + 30, 150);
    const t = put(s, "token", 180 - 30, 150);
    const e = put(s, "envelope", 180, 150 + 30);
    battery(s, 180, 150, {}, 1);
    const events = run(s, T, 2);
    const [burst] = of(events, "burst");
    expect([burst.mine, burst.pops, burst.points, burst.launchId]).toEqual([false, 0, 0, -1]);
    expect(of(events, "pop")).toEqual([]);
    expect([alive(s, d), alive(s, t), alive(s, e)]).toEqual([true, true, true]);
    expect(s.score).toBe(0);
  });

  it("a battery is set off 12 ticks later, and its owner does not change", () => {
    const s = room();
    stand(s, 180, 440);
    battery(s, 180, 150, {}, 1);
    const notHis = battery(s, 180 + 50, 150);
    const hisToo = battery(s, 180 - 50, 150, { mine: true, knockTick: 0, launchId: 7, fuseTick: 400 });
    const events = run(s, T, 2);
    const [burst] = of(events, "burst");
    expect(burst.set).toBe(2);
    expect([notHis.fuseTick, notHis.mine, notHis.launchId]).toEqual([burst.tick + 12, false, -1]);
    expect([hisToo.fuseTick, hisToo.mine, hisToo.launchId]).toEqual([burst.tick + 12, true, 7]);
  });

  it("the money bag: nothing", () => {
    const s = room();
    stand(s, 180, 440);
    const bag = put(s, "bag", 180 + 40, 150);
    battery(s, 180, 150, {}, 1);
    const events = run(s, T, 2);
    expect(of(events, "hit")).toEqual([]);
    expect([bag.hp, bag.x, bag.y]).toEqual([8, 220, 150]);
  });

  it("gum and a pickup: nothing", () => {
    const s = room();
    stand(s, 180, 440);
    const g = put(s, "gum", 180 + 30, 150);
    const tile = put(s, "pickup", 180 - 30, 150, { landTick: 0 });
    const h = heart(s, 180, 150 + 30);
    battery(s, 180, 150, {}, 1);
    run(s, T, 2);
    expect(g.hp).toBe(2);
    expect([alive(s, tile), alive(s, h)]).toEqual([true, true]);
  });

  it("the polisher: nothing", () => {
    const s = fight();
    machine(s, { lane: 1, x: 180, dir: 1, mode: "lane" });
    stand(s, 180, 440);
    battery(s, 180 - 60 - 15, laneMiddle(s, 1), {}, 1);
    const before = [s.boss.hp, s.boss.mode];
    const events = run(s, B, 2);
    expect(of(events, "burst")).toHaveLength(1);
    expect([s.boss.hp, s.boss.mode]).toEqual(before);
  });

  it("him: it costs a heart while he is landed, not invulnerable, and his centre within 70 u", () => {
    const { s, events } = blastAt(70);
    const [hurt] = of(events, "hurt");
    expect([hurt.by, hurt.blast, hurt.hearts]).toEqual(["battery", true, 2]);
    expect(of(events, "burst")[0].hurt).toBe(true);
    expect(s.lastHurtBy).toBe("battery");
    // Its wave goes out from him, and his pips are refilled, as for any lost heart.
    expect(s.him.invulnUntil).toBe(hurt.tick + 72);
  });

  it("him: not 70.5 u from it; not while he is invulnerable; not while he is hot", () => {
    expect(of(blastAt(70.5).events, "hurt")).toEqual([]);
    expect(of(blastAt(30, (s) => (s.him.invulnUntil = s.tick + 10)).events, "hurt")).toEqual([]);
    // Flying: he is released on the tick before it goes off, and it goes off on the next.
    const s = room();
    battery(s, 180 + 40, 374, {}, 2);
    const events = fire(s, T, shot(0, -1, 0.6), 3);
    expect(of(events, "burst")).toHaveLength(1);
    expect(of(events, "hurt")).toEqual([]);
    expect(distance(s, { x: 220, y: 374 })).toBeLessThan(70);
  });

  it("him: not from a battery that is dazed when it goes off (§5.2 rule 9: a dazed thing cannot cost a heart)", () => {
    const { events } = blastAt(40, (s) => {
      s.things[0].dazedUntil = s.tick + 30;
    });
    expect(of(events, "burst")[0].hurt).toBe(false);
    expect(of(events, "hurt")).toEqual([]);
  });
});

// ── 9. A knocked battery in flight ────────────────────────────────────

describe("a knocked battery in flight", () => {
  /** Him landed down the room; the battery flies right across it at 400 u/s. */
  function flying(): { s: State; b: Thing } {
    const s = room();
    stand(s, 180, 440);
    const b = knocked(s, 60, 200, 400, 0);
    return { s, b };
  }

  it("bursts the moment it touches a dust bunny, a token or an envelope", () => {
    for (const kind of ["bunny", "token", "envelope"] as const) {
      const { s, b } = flying();
      const d = put(s, kind, 160, 200);
      const events = toBurst(s, T, 30);
      const [burst] = of(events, "burst");
      expect([burst.id, burst.why, burst.mine]).toEqual([b.id, "touch", true]);
      // It burst where it touched, and its blast popped what it touched.
      expect(Math.hypot(burst.x - d.x, burst.y - d.y)).toBeLessThan(10 + KINDS[kind].radius);
      expect(Math.hypot(burst.x - d.x, burst.y - d.y)).toBeGreaterThan(10 + KINDS[kind].radius - 400 / 60);
      expect(of(events, "pop").map((e) => [e.id, e.source])).toEqual([[d.id, "blast"]]);
    }
  });

  it("bursts on touching the money bag, and its blast takes one hit off it", () => {
    const { s, b } = flying();
    const bag = put(s, "bag", 200, 200);
    const events = toBurst(s, T, 30);
    const [burst] = of(events, "burst");
    expect([burst.id, burst.why]).toEqual([b.id, "touch"]);
    expect(Math.hypot(burst.x - bag.x, burst.y - bag.y)).toBeLessThan(10 + 34);
    expect(of(events, "hit").map((e) => [e.id, e.source, e.left])).toEqual([[bag.id, "blast", 7]]);
  });

  it("bursts on touching another battery, which is set off 12 ticks later and becomes his", () => {
    const { s, b } = flying();
    const other = battery(s, 160, 200);
    const events = toBurst(s, T, 30);
    const [burst] = of(events, "burst");
    expect([burst.id, burst.why]).toEqual([b.id, "touch"]);
    expect([other.mine, other.launchId, other.fuseTick]).toEqual([true, b.launchId, burst.tick + 12]);
  });

  it("passes over gum, over a pickup, and over the love heart", () => {
    const { s, b } = flying();
    const g = put(s, "gum", 90, 200);
    const tile = put(s, "pickup", 130, 200, { landTick: 0 });
    const h = heart(s, 110, 200);
    const events = run(s, T, 34);
    expect(alive(s, h)).toBe(true);
    // It is past both, still flying (a knocked thing slows as the toy's dummies do), and neither is touched.
    expect(b.x).toBeGreaterThan(130 + 18 + 10);
    expect(b.vx).toBeGreaterThan(0);
    expect(of(events, "burst")).toEqual([]);
    expect(g.hp).toBe(2);
    expect(alive(s, tile)).toBe(true);
  });

  it("bursts on touching the polisher", () => {
    const s = fight();
    machine(s, { lane: 3, x: 240, dir: 1, mode: "hitStall", until: s.tick + 300 });
    stand(s, 180, 440);
    const b = knocked(s, 60, laneMiddle(s, 3), 400, 0);
    const events = toBurst(s, B, 30);
    const [burst] = of(events, "burst");
    expect([burst.id, burst.why]).toEqual([b.id, "touch"]);
    // At the casing, and the machine is not hit.
    expect(Math.abs(burst.x - (boxOf(s.boss).x0 - 10))).toBeLessThan(400 / 60);
    expect(s.boss.hp).toBe(B.bossHits);
  });

  it("him: nothing (it is his): it passes him, landed, and costs no heart", () => {
    const s = room();
    stand(s, 180, 200);
    const b = knocked(s, 120, 200, 400, 0, { fuseTick: s.tick + 200, knockTick: s.tick - 1 });
    const events = run(s, T, 40);
    expect(b.x).toBeGreaterThan(180 + 23);
    expect(of(events, "hurt")).toEqual([]);
    expect([s.him.x, s.him.y]).toEqual([180, 200]);
  });
});

// ── 10. A cushion ─────────────────────────────────────────────────────

describe("a cushion", () => {
  it("a token mirrors off it; a shoved dust bunny bounces", () => {
    const s = room(tuned({ bunnySpeed: 0, batterySpeed: 0 }));
    const t = put(s, "token", 340, 200, { vx: 150, vy: 0 });
    const d = put(s, "bunny", 340, 300, { vx: 200, vy: 0 });
    run(s, T, 8);
    expect(t.vx).toBe(-150);
    expect(d.vx).toBeLessThan(0);
  });

  it("an envelope's heading is mirrored off it; a shoved envelope bounces", () => {
    const flying = tuned({ ...STILL, envelopeSpeed: 60, envelopeTurnDeg: 0 });
    const s = room(flying);
    const e = put(s, "envelope", 340, 100, { heading: 0.2 });
    run(s, flying, 30);
    expect(e.x).toBeLessThan(352 - 9);
    expect(e.heading).toBeCloseTo(Math.PI - 0.2, 12);
    const still = tuned({ ...STILL, envelopeTurnDeg: 0 });
    const t = room(still);
    const shoved = put(t, "envelope", 330, 200, { vx: 260, vy: 0 });
    run(t, still, 10);
    expect(shoved.vx).toBeLessThan(0);
    // Its heading pointed into the cushion too, and was mirrored with it.
    expect(shoved.heading).toBe(Math.PI);
  });

  it("a knocked battery bursts on it; a shoved one bounces", () => {
    const s = room();
    stand(s, 180, 440);
    const b = knocked(s, 320, 200, 400, 0);
    const events = toBurst(s, T, 20);
    expect(of(events, "burst").map((e) => [e.id, e.why])).toEqual([[b.id, "touch"]]);
    expect(of(events, "burst")[0].x).toBe(352 - 10);
    const t = room();
    stand(t, 180, 440);
    const shoved = battery(t, 320, 200, { vx: 260, vy: 0 });
    const ev = run(t, T, 10);
    expect(of(ev, "burst")).toEqual([]);
    expect(shoved.vx).toBeLessThan(0);
  });

  it("gum: nothing", () => {
    const s = room();
    const g = put(s, "gum", 352 - 14, 200);
    run(s, T, 10);
    expect([g.x, g.y, g.hp]).toEqual([338, 200, 2]);
  });

  it("the money bag: nothing (it creeps along it, kept on the floor, and nothing bounces it)", () => {
    const creep = tuned({ ...STILL, bagSpeed: 10 });
    const s = room(creep);
    stand(s, 352 - 13, 200);
    s.him.invulnUntil = 1e9;
    // Him in the corner beyond it: it creeps into the cushion and along it.
    const bag = put(s, "bag", 352 - 34, 100);
    run(s, creep, 120);
    expect(bag.x).toBe(352 - 34);
    expect(bag.y).toBeGreaterThan(100);
    expect([bag.vx, bag.vy]).toEqual([0, 0]);
  });

  it("the polisher stalls at it and changes lane", () => {
    const s = fight();
    machine(s, { lane: 3, x: 352 - 60 - 1, dir: 1 });
    stand(s, 60, 440);
    const events = run(s, B, 4);
    expect(of(events, "bossStall").map((e) => e.why)).toEqual(["wall"]);
    const more = run(s, B, 60);
    expect(of(more, "bossLane")).toHaveLength(1);
  });

  it("him: he bounces, and the plate fires", () => {
    const s = room();
    light(s, 1, "pip");
    stand(s, 180, 60);
    s.pips = 1;
    const events = fire(s, T, shot(0, -1), 4);
    const [c] = of(events, "cushion");
    expect([c.side, c.plate, c.charm]).toEqual(["top", 1, "pip"]);
    expect(s.him.vy).toBeGreaterThan(0);
  });
});

// ── 11. Touching him while he is landed ───────────────────────────────

describe("touching him while he is landed", () => {
  it("pops in one hit: costs a heart; dazed, or with him invulnerable, it is held at arm's length and a token bounces off", () => {
    for (const kind of ["bunny", "token", "envelope"] as const) {
      const s = room();
      put(s, kind, 180, 374 - 18);
      expect(of(run(s, T, 1), "hurt").map((e) => e.by)).toEqual([kind]);
      const dazed = room();
      const d = put(dazed, kind, 180, 374 - 18, { dazedUntil: 10 });
      expect(of(run(dazed, T, 1), "hurt")).toEqual([]);
      expect(distance(dazed, d)).toBeCloseTo(13 + KINDS[kind].radius, 9);
    }
    const s = room();
    s.him.invulnUntil = 50;
    const t = put(s, "token", 180, 374 - 25, { vx: 0, vy: 150 });
    run(s, tuned({ bunnySpeed: 0 }), 3);
    expect(s.hearts).toBe(3);
    expect(t.vy).toBe(-150);
  });

  it("a battery: costs a heart, unless it is his, it is dazed, or he is invulnerable", () => {
    const s = room();
    const b = battery(s, 180, 374 - 22);
    const [hurt] = of(run(s, T, 1), "hurt");
    expect([hurt.by, hurt.id, hurt.blast]).toEqual(["battery", b.id, false]);
    const mine = room();
    const m = battery(mine, 180, 374 - 22, { mine: true, launchId: 1 });
    expect(of(run(mine, T, 3), "hurt")).toEqual([]);
    // His passes him: it is not held at arm's length.
    expect(distance(mine, m)).toBe(22);
    const dazed = room();
    const d = battery(dazed, 180, 374 - 22, { dazedUntil: 10 });
    expect(of(run(dazed, T, 1), "hurt")).toEqual([]);
    expect(distance(dazed, d)).toBeCloseTo(23, 9);
    const safe = room();
    safe.him.invulnUntil = 10;
    battery(safe, 180, 374 - 22);
    expect(of(run(safe, T, 1), "hurt")).toEqual([]);
  });

  it("a battery going off no longer touches: overlapping him on its fuse tick, it costs one heart, the blast's", () => {
    const s = room();
    const b = battery(s, 180, 374 - 22, {}, 0);
    const events = run(s, T, 1);
    expect(of(events, "burst").map((e) => [e.id, e.hurt])).toEqual([[b.id, true]]);
    expect(of(events, "hurt").map((e) => [e.by, e.id, e.blast])).toEqual([["battery", b.id, true]]);
    expect(s.hearts).toBe(2);
  });

  it("the money bag: costs a heart, unless it is dazed or he is invulnerable; hurt or not, it is held at arm's length, and he never moves it", () => {
    const s = room();
    const bag = put(s, "bag", 180, 374 - 46);
    expect(of(run(s, T, 1), "hurt").map((e) => [e.by, e.id])).toEqual([["bag", bag.id]]);
    // Creeping into him while he cannot be hurt: its creep is undone, and it stands touching him.
    const creep = tuned({ ...STILL, bagSpeed: 10 });
    const t = room(creep);
    t.him.invulnUntil = 60;
    const b = put(t, "bag", 180, 374 - 47.1);
    expect(of(run(t, creep, 30), "hurt")).toEqual([]);
    expect(distance(t, b)).toBeCloseTo(13 + 34, 9);
    expect([t.him.x, t.him.y]).toEqual([180, 374]);
  });

  it("the money bag that takes a heart by creeping into him is put back touching him (§3.5): his next launch straight at it hits it", () => {
    const creep = tuned({ ...STILL, bagSpeed: 10 });
    const s = room(creep);
    const bag = put(s, "bag", 180, 374 - 47.05);
    const events = until(s, creep, (e) => of(e, "hurt").length > 0, 30);
    expect(of(events, "hurt").map((e) => [e.by, e.id])).toEqual([["bag", bag.id]]);
    // Not left inside him by that tick's creep: touching, on the line between the centres.
    expect(distance(s, bag)).toBeCloseTo(13 + 34, 9);
    expect(bag.x).toBe(180);
    expect([s.him.x, s.him.y]).toEqual([180, 374]);
    // So the launch straight at it is not one released on top of it (rule 5): one hit, and he bounces off it.
    const shotAt = fire(s, creep, shot(0, -1), 3);
    expect(s.launch.blocked).toEqual([]);
    expect(of(shotAt, "hit").map((e) => [e.kind, e.id, e.left, e.source])).toEqual([["bag", bag.id, 7, "body"]]);
    expect(of(shotAt, "bounce")).toEqual([]);
    expect(s.him.vy).toBeGreaterThan(0);
  });

  it("the money bag that lands on him dazed stays where it landed, and a launch released on it passes through it (rule 5)", () => {
    const u = room();
    // It comes down over him on this tick: dazed (within 94 u), and on him.
    const on = put(u, "bag", 180, 374 - 30, { landTick: u.tick });
    const landed = run(u, T, 3);
    expect(of(landed, "arrive").map((e) => [e.id, e.dazed])).toEqual([[on.id, true]]);
    expect(of(landed, "hurt")).toEqual([]);
    expect(on.onHim).toBe(true);
    // Nothing moves it out, and he does not move.
    expect([on.x, on.y]).toEqual([180, 374 - 30]);
    expect([u.him.x, u.him.y]).toEqual([180, 374]);

    for (const [dx, dy, why] of [
      [0, 1, "away from it"],
      [0, -1, "straight at its centre"],
      [1, 0, "across it"],
    ] as const) {
      const v = cloneState(u);
      // A twin room without the bag: where the same launch takes him in the open.
      const o = cloneState(u);
      o.things.length = 0;
      const line = aimLine(v, { dx, dy, power: 1 }, T);
      const first = tick(v, T, shot(dx, dy));
      tick(o, T, shot(dx, dy));
      // Not moved to its rim on the first tick: exactly where the open room puts him.
      expect([v.him.x, v.him.y], why).toEqual([o.him.x, o.him.y]);
      expect(v.launch.blocked, why).toEqual([on.id]);
      // Until he has left it: no bounce and no hit, and it does not move.
      const inside = [...first, ...until(v, T, () => !v.launch.blocked.includes(on.id), 20)];
      expect(v.launch.blocked, why).toEqual([]);
      expect(of(inside, "bounce"), why).toEqual([]);
      expect(of(inside, "hit"), why).toEqual([]);
      expect(on.hp, why).toBe(8);
      const bagNow = v.things.find((d) => d.id === on.id)!;
      expect([bagNow.x, bagNow.y], why).toEqual([180, 374 - 30]);
      // He has left it: it is held at arm's length from now on.
      expect(bagNow.onHim, why).toBe(false);
      // The aim line runs on through it: it does not end on the bag where he starts.
      expect([line.pts[2], line.pts[3]], why).toEqual([o.him.x, o.him.y]);
      expect(line.pts.length, why).toBeGreaterThan(12);
    }
  });

  it("gum and a pickup: nothing", () => {
    const s = room();
    put(s, "gum", 180, 374);
    put(s, "pickup", 180 + 20, 374, { landTick: 0 });
    expect(of(run(s, T, 30), "hurt")).toEqual([]);
    expect(s.hearts).toBe(3);
    // The love heart under him, landed: nothing. It is taken only during a launch.
    const t = room();
    t.hearts = 2;
    const h = heart(t, 180, 374 + 10);
    expect(of(run(t, T, 30), "heartTaken")).toEqual([]);
    expect([t.hearts, alive(t, h)]).toEqual([2, true]);
  });

  it("the polisher's casing pushes him, and never hurts him", () => {
    const s = fight();
    machine(s, { lane: 6, x: 352 - 60, dir: 1, mode: "laneMove", laneStep: 1 });
    stand(s, 352 - 13, 472 - 13);
    const events = run(s, B, 60);
    expect(of(events, "hurt")).toEqual([]);
    expect(s.him.x).toBeLessThan(352 - 13);
    expect(overlapDepth(s.boss, s.him.x, s.him.y, 13)).toBe(0);
  });
});

// ── 12. The polisher's pad ────────────────────────────────────────────

describe("the polisher's pad", () => {
  it("pushes dust bunnies aside; a token bounces off it", () => {
    const s = fight();
    machine(s, { lane: 3, x: 90, dir: 1 });
    stand(s, 180, 440);
    const d = put(s, "bunny", 155, 212);
    const t = put(s, "token", 152, 200, { vx: -150, vy: 0 });
    run(s, tuned({ ...QUIET, tokenSpeed: 150 }), 30);
    expect(d.x).toBeGreaterThan(boxOf(s.boss).x1);
    expect(t.vx).toBeGreaterThan(0);
  });

  it("pushes an envelope aside", () => {
    const s = fight();
    machine(s, { lane: 3, x: 90, dir: 1 });
    stand(s, 180, 440);
    const e = put(s, "envelope", 155, 212);
    run(s, B, 30);
    expect(e.x).toBeGreaterThan(boxOf(s.boss).x1);
    expect(alive(s, e)).toBe(true);
  });

  it("pushes the money bag aside", () => {
    const s = fight();
    machine(s, { lane: 3, x: 90, dir: 1 });
    stand(s, 180, 440);
    const bag = put(s, "bag", 175, 212);
    run(s, B, 40);
    expect(overlapDepth(s.boss, bag.x, bag.y, 34)).toBe(0);
    expect([alive(s, bag), bag.hp]).toEqual([true, 8]);
  });

  it("pushes a battery aside", () => {
    const s = fight();
    machine(s, { lane: 3, x: 90, dir: 1 });
    stand(s, 180, 440);
    const b = battery(s, 155, 212);
    const events = run(s, B, 30);
    expect(overlapDepth(s.boss, b.x, b.y, 10)).toBe(0);
    expect(b.x).toBeGreaterThan(boxOf(s.boss).x1);
    expect(of(events, "burst")).toEqual([]);
  });

  it("gum and a pickup: nothing (they lie where they lie)", () => {
    const s = fight();
    machine(s, { lane: 3, x: 90, dir: 1 });
    stand(s, 180, 440);
    const g = put(s, "gum", 170, 212);
    const tile = put(s, "pickup", 220, 212, { landTick: 0 });
    const h = heart(s, 195, 212);
    run(s, B, 60);
    expect([g.x, g.y, g.hp]).toEqual([170, 212, 2]);
    expect([tile.x, tile.y]).toEqual([220, 212]);
    expect([h.x, h.y, alive(s, h)]).toEqual([195, 212, true]);
  });

  it("him: it throws him, hot or landed, invulnerable or not, and costs a heart unless he is invulnerable", () => {
    const s = fight();
    machine(s, { lane: 3, x: 90, dir: 1 });
    stand(s, 150 + 13 + 0.5, 212);
    const events = run(s, B, 3);
    expect(of(events, "hurt").map((e) => e.by)).toEqual(["polisher"]);
    expect(of(events, "bossThrow").map((e) => e.hurt)).toEqual([true]);
    const safe = fight();
    machine(safe, { lane: 3, x: 90, dir: 1 });
    stand(safe, 150 + 13 + 0.5, 212);
    safe.him.invulnUntil = safe.tick + 50;
    const ev = run(safe, B, 3);
    expect(of(ev, "hurt")).toEqual([]);
    expect(of(ev, "bossThrow").map((e) => e.hurt)).toEqual([false]);
  });
});

// ── 13. The polisher changing lane, or landing at 06:00 ───────────────

describe("the polisher changing lane, or landing at 06:00", () => {
  it("dust bunnies, tokens, envelopes and batteries are pushed, never hurt; gum and the love heart lie where they lie", () => {
    const s = fight();
    machine(s, { lane: 2, x: 120, dir: -1, mode: "laneMove", laneStep: 1 });
    stand(s, 300, 440);
    const lower = laneMiddle(s, 3);
    const d = put(s, "bunny", 100, lower + 20);
    const b = battery(s, 140, lower + 20);
    const e = put(s, "envelope", 80, lower + 10);
    const g = put(s, "gum", 120, lower);
    const h = heart(s, 150, lower);
    const events = run(s, B, 70);
    expect([h.x, h.y, alive(s, h)]).toEqual([150, lower, true]);
    expect(s.boss.lane).toBe(3);
    expect(overlapDepth(s.boss, d.x, d.y, 8)).toBe(0);
    expect(overlapDepth(s.boss, b.x, b.y, 10)).toBe(0);
    expect(overlapDepth(s.boss, e.x, e.y, 9)).toBe(0);
    expect([alive(s, d), alive(s, b), alive(s, e)]).toEqual([true, true, true]);
    expect(of(events, "burst")).toEqual([]);
    expect([g.x, g.y, g.hp]).toEqual([120, lower, 2]);
  });

  it("the money bag is pushed, never hurt", () => {
    const s = fight();
    machine(s, { lane: 2, x: 120, dir: -1, mode: "laneMove", laneStep: 1 });
    stand(s, 300, 440);
    const bag = put(s, "bag", 110, laneMiddle(s, 3) + 10);
    run(s, B, 70);
    expect(s.boss.lane).toBe(3);
    expect(overlapDepth(s.boss, bag.x, bag.y, 34)).toBe(0);
    expect([alive(s, bag), bag.hp]).toEqual([true, 8]);
  });

  it("its landing pushes what is under it out, never hurt, a battery too", () => {
    const s = createState(1, B, { hour: BOSS_HOUR, empty: true, kinds: ["polisher"], ...DARK });
    s.phase = "boss";
    tick(s, B);
    stand(s, 300, 440);
    const b = battery(s, s.boss.x + 20, s.boss.y);
    const events = run(s, B, BOSS_TELEGRAPH);
    expect(of(events, "bossArrive")).toHaveLength(1);
    expect(overlapDepth(s.boss, b.x, b.y, 10)).toBe(0);
    expect(alive(s, b)).toBe(true);
  });

  it("him: pushed, never hurt", () => {
    const s = createState(1, B, { hour: BOSS_HOUR, empty: true, kinds: ["polisher"], ...DARK });
    s.phase = "boss";
    tick(s, B);
    stand(s, s.boss.x, s.boss.y);
    const events = run(s, B, BOSS_TELEGRAPH);
    expect(of(events, "bossArrive")).toHaveLength(1);
    expect(of(events, "hurt")).toEqual([]);
    expect(overlapDepth(s.boss, s.him.x, s.him.y, 13)).toBe(0);
  });
});

// ── How a battery moves (5.4), which the table's rows lean on ─────────

describe("a battery's drift", () => {
  const D = tuned({ ...STILL, batterySpeed: 14 });

  it("drifts straight toward him at 14 u/s; dazed, it stands still; his, it no longer drifts", () => {
    const s = room(D);
    const live = battery(s, 180 + 120, 374 - 160);
    const dazed = battery(s, 40, 100, { dazedUntil: 30 });
    const his = battery(s, 300, 440, { mine: true, launchId: 1, knockTick: 0, fuseTick: 400 });
    const from = { x: live.x, y: live.y };
    run(s, D, 20);
    const moved = Math.hypot(live.x - from.x, live.y - from.y);
    expect(moved).toBeCloseTo((14 * 20) / 60, 6);
    // Along the bearing to him: it is no farther off the line from where it was to him than rounding.
    const ux = (180 - from.x) / Math.hypot(180 - from.x, 374 - from.y);
    const uy = (374 - from.y) / Math.hypot(180 - from.x, 374 - from.y);
    expect((live.x - from.x) * uy - (live.y - from.y) * ux).toBeCloseTo(0, 6);
    // Toward him, not away: it is nearer him by all it moved.
    expect(Math.hypot(live.x - 180, live.y - 374)).toBeCloseTo(Math.hypot(from.x - 180, from.y - 374) - moved, 6);
    expect((live.x - from.x) * ux + (live.y - from.y) * uy).toBeGreaterThan(0);
    expect([dazed.x, dazed.y]).toEqual([40, 100]);
    expect([his.x, his.y]).toEqual([300, 440]);
    // When the daze ends it drifts on.
    run(s, D, 20);
    expect(Math.hypot(dazed.x - 40, dazed.y - 100)).toBeCloseTo((14 * (40 - 30)) / 60, 6);
  });
});
