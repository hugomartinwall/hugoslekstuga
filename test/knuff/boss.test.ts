import { describe, expect, it } from "vitest";
import { DARK_PLATES } from "../../lib/knuff/content/charms";
import { BOSS_HOUR } from "../../lib/knuff/content/night";
import { BOSS_TELEGRAPH, LANES, boxOf, laneMiddle, laneTop, overlapDepth } from "../../lib/knuff/sim/boss";
import { aimLine } from "../../lib/knuff/sim/aim";
import { wouldSlow } from "../../lib/knuff/sim/hot";
import { cloneState, createState, type StartOptions } from "../../lib/knuff/sim/state";
import { step } from "../../lib/knuff/sim/step";
import type { BossMode, Input, SimEvent, State, Tune } from "../../lib/knuff/sim/types";
import { HOLD, fire, of, put, run, scripted, shot, tick, tuned, until } from "./room";

/**
 * The boss: the floor polisher of 06:00 (§8).
 *
 * A fight is begun by hand, as the rule suites begin a night: the
 * polisher's hour from its first tick, nothing in the room but him and the
 * machine, and no dust bunny trickling in unless a case wants one. The
 * machine is put where a case needs it by setting its fields, as a thing
 * is put in the room by hand.
 */

/**
 * No trickle: nothing arrives during the fight unless a case says so. And the
 * cases are worked at 70 u/s, the spec's draft speed, so their ticks come out
 * whole: the rules do not depend on the speed (the default is 90: tune.ts).
 */
const QUIET = { bossTrickleTicks: 1_000_000, bossSpeed: 70 };
const T = tuned(QUIET);
/** And no plug to hit: for the cases that watch the machine walk while the pad throws him about. */
const NO_PLUG = { ...QUIET, plugWidth: -1 };

/** 06:00 begun by hand: on the next tick the polisher is announced. He stands at the start, landed. */
function fight(tune: Tune = T, start: StartOptions = {}, seed = 1): State {
  const s = createState(seed, tune, { hour: BOSS_HOUR, empty: true, kinds: ["polisher"], plates: DARK_PLATES, offers: false, ...start });
  s.phase = "boss";
  return s;
}

/** A fight in which the machine has landed: it is announced, and 120 ticks later it is on the floor. He is moved out of its way first. */
function landed(tune: Tune = T, start: StartOptions = {}): State {
  const s = fight(tune, start);
  tick(s, tune);
  him(s, 180, 300);
  run(s, tune, BOSS_TELEGRAPH);
  expect(s.boss.mode).toBe("lane");
  return s;
}

/** Put the machine where a case needs it. */
function machine(s: State, o: { lane?: number; x?: number; dir?: 1 | -1; mode?: BossMode; speed?: number; until?: number; laneStep?: 1 | -1 }): void {
  const b = s.boss;
  if (o.lane !== undefined) {
    b.lane = o.lane;
    b.y = laneMiddle(s, o.lane);
  }
  if (o.x !== undefined) b.x = o.x;
  if (o.dir !== undefined) b.dir = o.dir;
  if (o.mode !== undefined) b.mode = o.mode;
  if (o.speed !== undefined) b.speed = o.speed;
  if (o.until !== undefined) b.modeUntil = o.until;
  if (o.laneStep !== undefined) b.laneStep = o.laneStep;
  b.px = b.x;
  b.py = b.y;
}

/** Put him somewhere, landed. */
function him(s: State, x: number, y: number): void {
  const h = s.him;
  h.x = x;
  h.y = y;
  h.px = x;
  h.py = y;
  h.vx = 0;
  h.vy = 0;
  h.hot = false;
}

/** A launch from where he stands, then ticks until `done`. */
function launchAnd(s: State, tune: Tune, launch: Input, done: (events: SimEvent[]) => boolean, most = 200): SimEvent[] {
  const events = tick(s, tune, launch);
  events.push(...until(s, tune, done, most));
  return events;
}

const inside = (s: State) => overlapDepth(s.boss, s.him.x, s.him.y, s.stats.radius);

describe("the lanes", () => {
  it("eight lanes cover the floor from 8 to 472, neighbours overlapping by 2 to 4 u, so no strip is left to sit in", () => {
    const s = createState(1, T);
    expect(LANES).toBe(8);
    for (let k = 0; k < 7; k++) expect([laneTop(s, k), laneTop(s, k) + 60]).toEqual([8 + 58 * k, 68 + 58 * k]);
    expect([laneTop(s, 7), laneTop(s, 7) + 60]).toEqual([412, 472]);
    expect(laneTop(s, 0)).toBe(s.room.top);
    expect(laneTop(s, 7) + 60).toBe(s.room.bottom);
    for (let k = 1; k < LANES; k++) {
      const overlap = laneTop(s, k - 1) + 60 - laneTop(s, k);
      expect(overlap).toBeGreaterThanOrEqual(2);
      expect(overlap).toBeLessThanOrEqual(4);
    }
  });
});

describe("06:00", () => {
  it("a night can be started at 06:00: the first launch begins the polisher's hour, and the polisher is announced on that tick", () => {
    const s = createState(3, tuned(), { hour: BOSS_HOUR });
    expect(s.night.hour).toBe(11);
    expect(s.phase).toBe("waiting");
    expect(s.boss.present).toBe(false);
    expect(s.things).toEqual([]);
    const events = tick(s, tuned(), shot(0, -1));
    expect(of(events, "hour")).toEqual([{ type: "hour", tick: 0, hour: 11 }]);
    expect(s.phase).toBe("boss");
    expect(s.boss.present).toBe(true);
    expect(s.boss.mode).toBe("arriving");
    // It starts at `bossSpeed`, with `bossHits` on its plug.
    expect([s.boss.speed, s.boss.hp]).toEqual([tuned().bossSpeed, tuned().bossHits]);
    expect(s.boss.beganTick).toBe(0);
    expect(s.boss.modeUntil).toBe(BOSS_TELEGRAPH);
  });

  it("when 05:00 ends the phase becomes boss and the clock 06:00; whatever is left in the room stays", () => {
    const tune = tuned({ ...QUIET, bunnySpeed: 0 });
    const s = createState(1, tune, { hour: 10, empty: true, kinds: ["polisher"], plates: DARK_PLATES, offers: false });
    s.phase = "night";
    const left = put(s, "bunny", 40, 440, { dazedUntil: 1_000_000 });
    const events = run(s, tune, 1801);
    expect(of(events, "hour")).toEqual([{ type: "hour", tick: 1800, hour: 11 }]);
    expect(s.phase).toBe("boss");
    expect(s.boss.beganTick).toBe(1800);
    expect(s.things).toContain(left);
    expect(of(events, "over")).toEqual([]);
  });

  it("a night whose kinds leave the polisher out has no 06:00: it ends when 05:00 ends, with nothing added", () => {
    // Nothing arrives: 05:00 is clear at last call (840), and ends 180 ticks later.
    const s = createState(1, T, { hour: 10, empty: true, kinds: [], plates: DARK_PLATES, offers: false });
    s.phase = "night";
    const events = run(s, T, 1801);
    expect(of(events, "over")).toEqual([{ type: "over", tick: 1020, how: "morning", score: 0, bonus: 0 }]);
    expect(of(events, "hour")).toEqual([]);
    expect(s.boss.present).toBe(false);
    expect(s.night.hour).toBe(11);
  });

  it("it is announced in lane 0 at the left end, heading right, and lands 120 ticks later; until then nothing touches it", () => {
    const s = fight();
    tick(s, T);
    expect(boxOf(s.boss)).toEqual({ x0: 8, y0: 8, x1: 128, y1: 68 });
    expect([s.boss.dir, s.boss.lane, s.boss.speed, s.boss.hp]).toEqual([1, 0, 70, 6]);
    // He flies straight through where it will be while it is only announced.
    him(s, 60, 120);
    const events = fire(s, T, shot(0, -1), 30);
    expect(events.some((e) => e.type.startsWith("boss") || e.type === "hurt" || e.type === "hit")).toBe(false);
    expect(of(events, "cushion").length).toBeGreaterThan(0);
    const rest = until(s, T, (e) => e.some((x) => x.type === "bossArrive"), 200);
    expect(of(rest, "bossArrive")).toEqual([{ type: "bossArrive", tick: 120, x: 68, y: 38, lane: 0, dir: 1 }]);
    expect(s.boss.mode).toBe("lane");
    expect(s.boss.lastHitTick).toBe(120);
  });

  it("when it lands, whatever is inside its box, him included, is pushed out, never hurt, and not into the pad's way", () => {
    const s = fight();
    tick(s, T);
    run(s, T, BOSS_TELEGRAPH - 2);
    him(s, 70, 40);
    const d = put(s, "bunny", 100, 30, { dazedUntil: 0 });
    const events = run(s, T, 2);
    expect(of(events, "bossArrive")).toHaveLength(1);
    expect(of(events, "hurt")).toEqual([]);
    expect(inside(s)).toBe(0);
    // Under it, not ahead of the pad: the box is 8 to 68 across, so out the bottom.
    expect(s.him.y).toBeCloseTo(68 + 13, 6);
    expect(overlapDepth(s.boss, d.x, d.y, 8)).toBe(0);
    expect(s.hearts).toBe(3);
  });

  it("when it lands with its pad's face nearest him, he is put out another way", () => {
    const s = fight();
    tick(s, T);
    run(s, T, BOSS_TELEGRAPH - 2);
    // 6 u inside the pad's face (x 128), 30 u above its bottom face; its top lies against the cushion.
    him(s, 122, 38);
    run(s, T, 2);
    expect(s.boss.mode).toBe("lane");
    expect(inside(s)).toBe(0);
    expect([s.him.x, s.him.y]).toEqual([122, 68 + 13]);
    expect(s.hearts).toBe(3);
  });
});

describe("the walk", () => {
  it("along a lane until its leading end reaches the far cushion; a 48-tick stall; the next lane at its speed; and off the other way", () => {
    const tune = tuned(NO_PLUG);
    const s = landed(tune);
    s.him.invulnUntil = 1_000_000;
    const events = until(s, tune, (e) => of(e, "bossTurn").length >= 1, 1000);
    const [stall] = of(events, "bossStall");
    // 224 u at 70 u/s: 192 ticks from the landing to the right cushion.
    expect(stall.why).toBe("wall");
    expect(stall.tick).toBe(120 + 192);
    expect(stall.until - stall.tick).toBe(48);
    expect(stall.x + 60).toBe(352);
    const [lane] = of(events, "bossLane");
    expect(lane.tick).toBe(stall.tick + 48);
    expect([lane.from, lane.lane]).toEqual([0, 1]);
    const [turn] = of(events, "bossTurn");
    // 58 u at 70 u/s: just under 50 ticks.
    expect(turn.tick - lane.tick).toBeGreaterThanOrEqual(49);
    expect(turn.tick - lane.tick).toBeLessThanOrEqual(50);
    expect(turn.dir).toBe(-1);
    expect(s.boss.y).toBe(laneMiddle(s, 1));
    expect(s.boss.mode).toBe("lane");
  });

  it("walks the lanes 0, 1, ... 7, 6, ... 0, 1: an end lane is not repeated", () => {
    // Fast, so the walk is long enough in 90 s; he is out of its way, invulnerable.
    const tune = tuned({ ...NO_PLUG, bossSpeed: 400, bossMaxTicks: 100_000 });
    const s = landed(tune);
    s.him.invulnUntil = 1_000_000;
    s.hearts = 1;
    const events = until(s, tune, (e) => of(e, "bossLane").length >= 17, 20_000);
    expect(of(events, "bossLane").map((e) => e.lane)).toEqual([1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 1, 0, 1, 2, 3]);
  });

  it("the pad is off while it stalls and while it changes lane: flying into its leading end is a bounce off the casing", () => {
    for (const mode of ["wallStall", "laneMove", "hitStall"] as const) {
      const s = landed();
      // Heading right, its leading end at x 260; he flies left into it.
      machine(s, { lane: 3, x: 200, dir: 1, mode, until: s.tick + 100, laneStep: 1 });
      him(s, 330, 212);
      const events = launchAnd(s, T, shot(-1, 0), (e) => of(e, "bossBounce").length > 0 || of(e, "bossThrow").length > 0, 40);
      expect(of(events, "hurt"), mode).toEqual([]);
      expect(of(events, "bossThrow"), mode).toEqual([]);
      expect(of(events, "bossBounce")[0].part, mode).toBe("casing");
    }
  });
});

describe("the pad", () => {
  it("costs a heart while he is landed, and throws him straight ahead at 450 u/s, hot, on a launch that costs no pip", () => {
    const s = landed();
    machine(s, { lane: 3, x: 90, dir: 1 });
    him(s, 150 + 13 + 0.5, 212);
    s.pips = 1;
    const id = s.launch.id;
    const events = run(s, T, 3);
    const [hurt] = of(events, "hurt");
    expect(hurt.by).toBe("polisher");
    expect(s.hearts).toBe(2);
    const [thrown] = of(events, "bossThrow");
    expect([thrown.vx, thrown.vy, thrown.hurt]).toEqual([450, 0, true]);
    expect(s.him.hot).toBe(true);
    expect(s.launch.id).toBe(id + 1);
    expect(s.launch.thrown).toBe(true);
    expect(s.launch.carry).toBe(0);
    // No pip was spent: a lost heart refills them.
    expect(s.pips).toBe(3);
    expect(of(events, "launch")).toEqual([]);
    expect(inside(s)).toBe(0);
  });

  it("costs a heart while he is hot too, flying into it", () => {
    const s = landed();
    machine(s, { lane: 3, x: 90, dir: 1 });
    him(s, 300, 212);
    const events = launchAnd(s, T, shot(-1, 0), (e) => of(e, "bossThrow").length > 0, 60);
    expect(of(events, "hurt").map((e) => e.by)).toEqual(["polisher"]);
    expect(of(events, "bossThrow")[0].hurt).toBe(true);
    expect(of(events, "bossThrow")[0].vx).toBe(450);
    expect(s.hearts).toBe(2);
  });

  it("with padHurtsHot off (decision 3 turned over) it takes a heart only while he is landed; hot, he is thrown all the same", () => {
    const soft = tuned({ ...QUIET, padHurtsHot: false });
    const s = landed(soft);
    machine(s, { lane: 3, x: 90, dir: 1 });
    him(s, 300, 212);
    const events = launchAnd(s, soft, shot(-1, 0), (e) => of(e, "bossThrow").length > 0, 60);
    expect(of(events, "hurt")).toEqual([]);
    expect([of(events, "bossThrow")[0].vx, of(events, "bossThrow")[0].hurt]).toEqual([450, false]);
    expect(s.hearts).toBe(3);
    const still = landed(soft);
    machine(still, { lane: 3, x: 90, dir: 1 });
    him(still, 150 + 13 + 0.5, 212);
    expect(of(run(still, soft, 3), "hurt").map((e) => e.by)).toEqual(["polisher"]);
    expect(T.padHurtsHot).toBe(true);
  });

  it("throws an invulnerable mascot and takes no heart", () => {
    const s = landed();
    // Heading left: the pad is the left end, at x 190.
    machine(s, { lane: 3, x: 250, dir: -1 });
    him(s, 190 - 13 - 0.5, 212);
    s.him.invulnUntil = s.tick + 50;
    const events = run(s, T, 2);
    expect(of(events, "hurt")).toEqual([]);
    const [thrown] = of(events, "bossThrow");
    expect([thrown.vx, thrown.vy, thrown.hurt]).toEqual([-450, 0, false]);
    expect(s.hearts).toBe(3);
    expect(s.him.hot).toBe(true);
  });

  it("cannot pin him: with a cushion within 60 u ahead it throws him along that cushion, toward the side with more room", () => {
    const s = landed();
    // Heading right in lane 3 (182 to 242), its leading end 40 u from the right cushion; he stands against that cushion.
    machine(s, { lane: 3, x: 352 - 40 - 60, dir: 1 });
    him(s, 352 - 13, 212);
    s.him.x = 352 - 13;
    const events: SimEvent[] = [];
    let worst = 0;
    for (let i = 0; i < 120 && s.boss.mode === "lane"; i++) {
      events.push(...tick(s, T));
      worst = Math.max(worst, inside(s));
    }
    const thrown = of(events, "bossThrow");
    expect(thrown).toHaveLength(1);
    // Down: from y 212 there are 260 u below and 204 above.
    expect([thrown[0].vx, thrown[0].vy]).toEqual([0, 450]);
    // Set clear under the box, and thrown from there.
    expect(thrown[0].ty).toBe(242 + 13);
    expect(of(events, "hurt")).toHaveLength(1);
    expect(worst).toBe(0);
    expect(s.boss.mode).toBe("wallStall");
  });

  it("a cushion 59 u ahead of the pad: thrown along it; 61 u ahead: straight ahead", () => {
    for (const [ahead, along] of [
      [59, true],
      [61, false],
    ] as const) {
      const s = landed();
      // Heading right at 6 u/s, a tenth of a unit a tick, its leading end this far from the right cushion after one more
      // tick; he stands just clear of it, and that tick it meets him.
      machine(s, { lane: 3, x: 352 - ahead - 60 - 0.1, dir: 1, speed: 6 });
      him(s, 352 - ahead - 0.1 + 13 + 0.05, 212);
      const events = until(s, T, (e) => of(e, "bossThrow").length > 0, 5);
      const [thrown] = of(events, "bossThrow");
      // Where its leading end was when the pad met him: the tick of the throw, after the machine's move.
      expect(352 - (s.boss.x + 60), `${ahead}`).toBeCloseTo(ahead, 6);
      expect([thrown.vx, thrown.vy], `${ahead}`).toEqual(along ? [0, 450] : [450, 0]);
    }
  });

  it("pushes intruders aside, and a token bounces off it at its own speed", () => {
    const tune = tuned({ ...QUIET, bunnySpeed: 0 });
    const s = landed(tune);
    machine(s, { lane: 3, x: 90, dir: 1 });
    him(s, 180, 400);
    const d = put(s, "bunny", 155, 212);
    const t = put(s, "token", 152, 200, { vx: -150, vy: 0 });
    run(s, tune, 30);
    expect(overlapDepth(s.boss, d.x, d.y, 8)).toBe(0);
    expect(d.x).toBeGreaterThan(boxOf(s.boss).x1);
    expect(t.vx).toBeGreaterThan(0);
    expect(Math.hypot(t.vx, t.vy)).toBeCloseTo(150, 9);
  });
});

describe("the plug", () => {
  /** The machine heading right in lane 3, its box 140 to 260 by 182 to 242; he stands behind its trailing end. */
  function behind(tune: Tune = T): State {
    const s = landed(tune);
    machine(s, { lane: 3, x: 200, dir: 1 });
    him(s, 60, 212);
    return s;
  }

  it("a hot launch that meets the middle 24 u of the trailing end hits it: 200 points, one hit, and he bounces off", () => {
    const s = behind();
    const events = launchAnd(s, T, shot(1, 0), (e) => of(e, "hit").length > 0, 60);
    const [hit] = of(events, "hit");
    expect([hit.kind, hit.id, hit.left, hit.points, hit.two]).toEqual(["polisher", 0, 5, 200, false]);
    expect(s.boss.hp).toBe(5);
    expect(s.score).toBe(200);
    expect(s.launch.points).toBe(200);
    expect(s.bestShot).toBe(200);
    expect(s.launch.hit).toEqual([0]);
    // Flat: it is not a pop, and does not move the chain.
    expect(s.launch.pops).toBe(0);
    expect(s.him.vx).toBeLessThan(0);
    expect(of(events, "bossHit")[0].left).toBe(5);
  });

  it("the plug is 24 u wide: a launch 11 u off its middle hits it, one 13 u off bounces off the casing", () => {
    for (const [off, part] of [
      [11, "plug"],
      [-11, "plug"],
      [13, "casing"],
      [-13, "casing"],
    ] as const) {
      const s = behind();
      s.him.y = 212 + off;
      const events = launchAnd(s, T, shot(1, 0), (e) => of(e, "hit").length > 0 || of(e, "bossBounce").length > 0, 60);
      expect(of(events, "hit").length, `${off}`).toBe(part === "plug" ? 1 : 0);
      if (part === "casing") expect(of(events, "bossBounce")[0].part, `${off}`).toBe("casing");
    }
  });

  it("off a cushion the hit counts as two and pays 400; on a plug with one left it takes one off and pays 200", () => {
    const s = behind();
    // Back to the left cushion first, then across.
    s.him.x = 40;
    const events = launchAnd(s, T, shot(-1, 0.02), (e) => of(e, "hit").length > 0, 90);
    expect(of(events, "cushion").length).toBeGreaterThan(0);
    const [hit] = of(events, "hit");
    expect([hit.left, hit.points, hit.two]).toEqual([4, 400, true]);

    const last = behind();
    last.boss.hp = 1;
    last.him.x = 40;
    const end = launchAnd(last, T, shot(-1, 0.02), (e) => of(e, "over").length > 0, 90);
    const [h1] = of(end, "hit");
    expect([h1.left, h1.points, h1.two]).toEqual([0, 200, true]);
  });

  it("one hit a launch: the same launch meeting it again only bounces off", () => {
    const s = behind();
    const events = launchAnd(s, T, shot(1, 0), (e) => of(e, "hit").length > 0, 60);
    expect(of(events, "hit")).toHaveLength(1);
    // Moving along its lane again at once, and he is put behind it once more, still in the same launch, flying at it.
    machine(s, { mode: "lane" });
    s.him.x = boxOf(s.boss).x0 - 20;
    s.him.y = 212;
    s.him.vx = 600;
    s.him.vy = 0;
    s.him.hot = true;
    const again = until(s, T, (e) => of(e, "bossBounce").length > 0 || of(e, "hit").length > 0, 20);
    expect(of(again, "hit")).toEqual([]);
    expect(of(again, "bossBounce")[0].part).toBe("plug");
    expect(s.boss.hp).toBe(5);
  });

  it("no hit while it is stalled or changing lane: every face is casing then", () => {
    for (const mode of ["wallStall", "laneMove", "hitStall"] as const) {
      const s = behind();
      machine(s, { mode, until: s.tick + 100, laneStep: 1 });
      const events = launchAnd(s, T, shot(1, 0), (e) => of(e, "bossBounce").length > 0 || of(e, "hit").length > 0, 60);
      expect(of(events, "hit"), mode).toEqual([]);
      expect(of(events, "bossBounce")[0].part, mode).toBe("casing");
      expect(s.boss.hp).toBe(6);
    }
  });

  it("while he is landed the plug is casing: landed over its middle, he is set clear and nothing is hit", () => {
    const s = behind();
    // His right edge is at 73: the trailing end 2 u inside it, and the machine moves 1.17 u a tick away from him.
    machine(s, { x: 73 - 2 + 60 });
    const events = run(s, T, 1);
    expect(of(events, "hit")).toEqual([]);
    expect(of(events, "bossBounce")).toEqual([]);
    expect(s.boss.hp).toBe(6);
    expect(inside(s)).toBe(0);
    expect(s.him.hot).toBe(false);
  });

  it("a hit stalls it 60 ticks with the plug dark, coughs out three dust bunnies, and then it turns round, 1.12 times faster", () => {
    const s = behind();
    const events = launchAnd(s, T, shot(1, 0), (e) => of(e, "hit").length > 0, 60);
    const hitTick = of(events, "hit")[0].tick;
    expect(s.boss.mode).toBe("hitStall");
    expect(s.boss.modeUntil).toBe(hitTick + 60);
    // At its axis, so out of the top side: a quarter, a half and three quarters of its length, 12 u outside the casing.
    const box = boxOf(s.boss);
    const coughed = s.things.filter((d) => d.kind === "bunny");
    expect(coughed.map((d) => [d.x - box.x0, d.y])).toEqual([
      [30, box.y0 - 12],
      [60, box.y0 - 12],
      [90, box.y0 - 12],
    ]);
    for (const d of coughed) {
      expect(d.worth0).toBe(true);
      expect(d.dazedUntil).toBe(hitTick + 36);
      expect(d.landTick).toBe(hitTick);
    }
    expect(of(events, "bossHit")[0].coughed).toBe(3);
    const rest = until(s, T, (e) => of(e, "bossTurn").length > 0, 100);
    expect(of(rest, "bossTurn")[0].tick).toBe(hitTick + 60);
    expect(s.boss.dir).toBe(-1);
    expect(of(rest, "bossFaster").map((e) => [e.tick, e.speed, e.why])).toEqual([[hitTick + 60, 70 * 1.12, "hit"]]);
  });

  it("coughs out of the bottom side when he is above its axis, and of the other side when that one lies against a cushion", () => {
    const s = behind();
    s.him.y = 212 - 10;
    launchAnd(s, T, shot(1, 0), (e) => of(e, "hit").length > 0, 60);
    expect(s.things.every((d) => d.y === 242 + 12)).toBe(true);

    const top = landed();
    machine(top, { lane: 0, x: 200, dir: 1 });
    him(top, 60, 38);
    launchAnd(top, T, shot(1, 0), (e) => of(e, "hit").length > 0, 60);
    expect(top.things.map((d) => d.y)).toEqual([80, 80, 80]);
  });

  it("the dust bunnies of the boss pop for no points, and still count in the chain", () => {
    const s = behind();
    const d = put(s, "bunny", 100, 212, { worth0: true });
    const events = launchAnd(s, T, shot(1, 0), (e) => of(e, "hit").length > 0, 60);
    const [pop] = of(events, "pop");
    expect(pop.id).toBe(d.id);
    expect([pop.n, pop.points]).toEqual([1, 0]);
  });

  it("Spark's ring never hits the plug", () => {
    const s = landed();
    machine(s, { lane: 3, x: 200, dir: 1 });
    // Straight up past the trailing end (x 140, moving away), his edge 2.3 u from it: the ring, 12 u past his edge, sweeps the plug.
    him(s, 140 - 15.3, 260);
    const events = tick(s, T, shot(0, -1));
    s.launch.sparkUntil = s.tick + 48;
    // How close his centre came to the trailing end while level with the plug: inside the ring's reach, outside his body's.
    let closest = Infinity;
    for (let i = 0; i < 12; i++) {
      events.push(...tick(s, T));
      if (Math.abs(s.him.y - s.boss.y) <= 12) closest = Math.min(closest, boxOf(s.boss).x0 - s.him.x);
    }
    expect(closest).toBeGreaterThan(13);
    expect(closest).toBeLessThan(13 + 12);
    expect(s.him.hot).toBe(true);
    expect(of(events, "launch")).toHaveLength(1);
    expect(of(events, "hit")).toEqual([]);
    expect(of(events, "bossBounce")).toEqual([]);
    expect(s.boss.hp).toBe(6);
    expect(s.him.y).toBeLessThan(182);
  });
});

describe("the casing", () => {
  it("he bounces off it as off a cushion, and it never counts as one: no multiplier, no plate", () => {
    const plates = new Array<string>(10).fill("bumper");
    const s = landed(T, { plates });
    // Stalled, so the box stands still; he flies down onto its top face.
    machine(s, { lane: 3, x: 180, dir: 1, mode: "hitStall", until: s.tick + 200 });
    him(s, 180, 120);
    const events = launchAnd(s, T, shot(0, 1), (e) => of(e, "bossBounce").length > 0, 30);
    const [bounce] = of(events, "bossBounce");
    expect(bounce.part).toBe("casing");
    expect(of(events, "cushion")).toEqual([]);
    expect(s.launch.cushions).toBe(0);
    expect(s.launch.lastCushionTick).toBe(-1);
    // Off as off a cushion: the speed into the face comes back at 0.84 of itself.
    expect(bounce.vy).toBeCloseTo(-0.84 * bounce.speed, 6);
    expect(bounce.vx).toBe(0);
    expect(s.him.lastContactTick).toBe(bounce.tick);
  });

  it("a moving face: the bounce is by his speed relative to it", () => {
    const s = landed();
    // Changing lane, moving down at 70 u/s; he flies up into its bottom face at 600.
    machine(s, { lane: 3, x: 180, dir: 1, mode: "laneMove", laneStep: 1 });
    him(s, 180, 300);
    const events = launchAnd(s, T, shot(0, -1, 2 / 3), (e) => of(e, "bossBounce").length > 0, 30);
    const [bounce] = of(events, "bossBounce");
    // Going in at vy, out at 70 - 0.84 (vy - 70): faster than off a face at rest.
    const vin = -bounce.speed;
    expect(bounce.vy).toBeCloseTo(70 - 0.84 * (vin - 70), 6);
    expect(bounce.vy).toBeGreaterThan(-0.84 * vin);
  });

  it("a moving face along a lane: off its trailing end, moving away at 70 u/s, he comes back slower than off a face at rest", () => {
    const s = landed();
    // Heading right at 70 u/s, its box 140 to 260 across, 182 to 242 down; he flies into its trailing end 20 u off the plug.
    machine(s, { lane: 3, x: 200, dir: 1 });
    him(s, 60, 232);
    const events = launchAnd(s, T, shot(1, 0), (e) => of(e, "bossBounce").length > 0, 60);
    const [bounce] = of(events, "bossBounce");
    expect(bounce.part).toBe("casing");
    // Going in at vin, out at 70 - 0.84 (vin - 70).
    const vin = bounce.speed;
    expect(bounce.vx).toBeCloseTo(70 - 0.84 * (vin - 70), 6);
    expect(bounce.vy).toBe(0);
  });

  it("changing lane, it pushes him and never hurts him; squeezed against a cushion he is moved along it, clear of the machine", () => {
    const s = landed();
    // At the right end of lane 6, about to move down into lane 7; he sits in the bottom right corner.
    machine(s, { lane: 6, x: 352 - 60, dir: 1, mode: "laneMove", laneStep: 1 });
    him(s, 352 - 13, 472 - 13);
    let worst = 0;
    const events: SimEvent[] = [];
    for (let i = 0; i < 80 && s.boss.mode === "laneMove"; i++) {
      events.push(...tick(s, T));
      worst = Math.max(worst, inside(s));
    }
    expect(s.boss.lane).toBe(7);
    expect(of(events, "hurt")).toEqual([]);
    expect(worst).toBe(0);
    // Along the bottom cushion to the left of the box: its end is at 232.
    expect(s.him.y).toBe(472 - 13);
    expect(s.him.x).toBeCloseTo(232 - 13, 6);
    expect(s.him.hot).toBe(false);
    expect(s.hearts).toBe(3);
  });
});

describe("where the machine puts him", () => {
  it("a lane change into an end lane slides him along the cushion onto the face that will lead: the pad throws him there and takes no heart", () => {
    const s = landed();
    // At the right end of lane 6, about to move down into lane 7; he sits in the bottom right corner.
    machine(s, { lane: 6, x: 352 - 60, dir: 1, mode: "laneMove", laneStep: 1 });
    him(s, 352 - 13, 472 - 13);
    const events = until(s, T, (e) => of(e, "bossThrow").length > 0, 120);
    // Slid along the bottom cushion to the left of the box, which leads when it sets off: thrown, unhurt.
    const turn = of(events, "bossTurn")[0];
    const [thrown] = of(events, "bossThrow");
    expect(turn.dir).toBe(-1);
    expect(thrown.tick - turn.tick).toBeLessThan(T.telegraphTicks);
    expect(thrown.hurt).toBe(false);
    expect(of(events, "hurt")).toEqual([]);
    expect(s.hearts).toBe(3);
    expect(s.boss.shovedTick).toBeGreaterThan(turn.tick - T.telegraphTicks);
  });

  it("only for a telegraph after it put him there, and only until he launches", () => {
    // The pad heading right in lane 3, its leading end at 150; he stands landed just ahead of it.
    const base = landed();
    machine(base, { lane: 3, x: 90, dir: 1 });
    him(base, 150 + 13 + 0.5, 212);
    const probe = cloneState(base);
    const at = of(run(probe, T, 5), "bossThrow")[0].tick;
    const hearts = (ago: number, launchedAfter = false) => {
      const s = cloneState(base);
      s.boss.shovedTick = at - ago;
      // As if he had launched since it put him there, and landed again.
      if (launchedAfter) s.launch.startTick = at - ago + 1;
      return of(run(s, T, 5), "hurt").length;
    };
    expect(hearts(T.telegraphTicks - 1)).toBe(0);
    expect(hearts(T.telegraphTicks)).toBe(1);
    expect(hearts(10, true)).toBe(1);
    // Never put there: the pad takes its heart.
    expect(base.boss.shovedTick).toBe(-1);
    expect(of(run(cloneState(base), T, 5), "hurt")).toHaveLength(1);
  });
});

describe("so the fight always ends", () => {
  it("without a hit for 1,500 ticks it speeds up 1.12 times: no stall, no turn, no dust bunnies", () => {
    const tune = tuned(NO_PLUG);
    const s = landed(tune);
    s.him.invulnUntil = 1_000_000;
    const events = run(s, tune, 3200);
    const faster = of(events, "bossFaster");
    expect(faster.map((e) => [e.tick, e.why])).toEqual([
      [120 + 1500, "time"],
      [120 + 3000, "time"],
    ]);
    expect(faster[1].speed).toBeCloseTo(70 * 1.12 * 1.12, 9);
    expect(of(events, "bossStall").every((e) => e.why === "wall")).toBe(true);
    expect(of(events, "announce")).toEqual([]);
  });

  it("a hit starts the 1,500 ticks again: the next speed-up without a hit comes 1,500 ticks after it", () => {
    const s = landed();
    machine(s, { lane: 3, x: 200, dir: 1 });
    him(s, 60, 212);
    s.him.invulnUntil = 1_000_000;
    const events = launchAnd(s, T, shot(1, 0), (e) => of(e, "hit").length > 0, 60);
    const hitTick = of(events, "hit")[0].tick;
    // No more hits after this one: the plug cannot be hit, and the pad throws him about without a heart.
    events.push(...run(s, tuned(NO_PLUG), 1600));
    expect(of(events, "hit")).toHaveLength(1);
    expect(of(events, "bossFaster").map((e) => [e.tick, e.why])).toEqual([
      [hitTick + 60, "hit"],
      [hitTick + 1500, "time"],
    ]);
  });

  it("the last hit powers it down: the night ends as morning, with 1,000 and 250 a heart left, outside the launch's total and the best shot", () => {
    const s = landed();
    machine(s, { lane: 3, x: 200, dir: 1 });
    him(s, 60, 212);
    s.boss.hp = 1;
    s.hearts = 2;
    const events = launchAnd(s, T, shot(1, 0), (e) => of(e, "over").length > 0, 60);
    expect(of(events, "bossDown")).toHaveLength(1);
    const [over] = of(events, "over");
    expect([over.how, over.bonus, over.score]).toEqual(["morning", 1500, 1700]);
    expect(s.ended).toBe("morning");
    expect(s.phase).toBe("over");
    expect(s.bestShot).toBe(200);
    expect(s.launch.points).toBe(200);
  });

  it("90 s after 06:00 began the night ends whether it is beaten or not: the lights came on, no bonus", () => {
    const tune = tuned({ ...NO_PLUG, hearts: 99 });
    const s = fight(tune, { hearts: 99 });
    const events = run(s, tune, 6000);
    const [over] = of(events, "over");
    expect([over.how, over.bonus]).toEqual(["dawn", 0]);
    // Ticks 0 to 5,399 of 06:00: the last is its 5,400th.
    expect(over.tick).toBe(5399);
    expect(s.tick).toBe(5400);
    expect(s.ended).toBe("dawn");
  });

  it("a night whose hours are never cleared reaches 06:00 at 19,800 and is over by 25,200 ticks: seven minutes, exactly", () => {
    const tune = tuned({ ...NO_PLUG, hearts: 99, bunnySpeed: 0 });
    const s = createState(1, tune, { empty: true, kinds: ["polisher"], plates: DARK_PLATES, offers: false, hearts: 99 });
    s.phase = "night";
    // A dust bunny that never goes: no hour is ever clear.
    put(s, "bunny", 30, 30, { dazedUntil: 1_000_000 });
    s.him.invulnUntil = 1_000_000;
    const events = run(s, tune, 26000);
    expect(of(events, "hour").find((e) => e.hour === 11)?.tick).toBe(19_800);
    expect(of(events, "over")[0].how).toBe("dawn");
    expect(s.tick).toBe(25_200);
  });

  it("zero hearts comes first: the last hit and the last heart in one tick end the night as the hour he fell in, with no bonus", () => {
    const s = landed();
    machine(s, { lane: 3, x: 200, dir: 1 });
    // 1 u behind the plug; a token rolling after him, its centre 20.5 u back (20 is touching). A soft launch hits the
    // plug on its first tick, he bounces off and lands, and the token reaches him on that same tick.
    him(s, 140 - 13 - 1, 212);
    put(s, "token", 140 - 13 - 1 - 20.5, 212, { vx: 150, vy: 0 });
    s.boss.hp = 1;
    s.hearts = 1;
    const events = tick(s, T, shot(1, 0, 0.5));
    const [hit] = of(events, "hit");
    const [hurt] = of(events, "hurt");
    expect(hit.left).toBe(0);
    expect(hurt.tick).toBe(hit.tick);
    expect(of(events, "over")).toEqual([{ type: "over", tick: hit.tick, how: "hearts", score: 200, bonus: 0 }]);
    expect(s.ended).toBe("hearts");
  });
});

describe("around it", () => {
  it("one dust bunny worth nothing is announced every 240 ticks from tick 240 of 06:00, alone at a far spot, by the usual telegraph", () => {
    const tune = tuned({ bunnySpeed: 0 });
    const s = fight(tune);
    // The machine stays announced, so nothing moves him or them.
    tick(s, tune);
    s.boss.modeUntil = 1_000_000;
    const events = run(s, tune, 999);
    const announced = of(events, "announce");
    expect(announced.map((e) => e.tick)).toEqual([240, 480, 720, 960]);
    expect(announced.every((e) => e.kind === "bunny" && e.landTick === e.tick + 36)).toBe(true);
    expect(s.things).toHaveLength(4);
    expect(s.things.every((d) => d.worth0)).toBe(true);
    // A far spot: at least 150 u from him, and 20 u in from every cushion.
    for (const d of s.things) {
      expect(Math.hypot(d.x - s.him.x, d.y - s.him.y)).toBeGreaterThanOrEqual(150);
      expect(d.x).toBeGreaterThanOrEqual(28);
      expect(d.y).toBeLessThanOrEqual(452);
    }
  });

  it("stalled at a wall or after a hit it is as solid as when it moves: a dust bunny walking into it is pushed out, and a token bounces off it", () => {
    const walk = tuned({ ...QUIET, bunnySpeed: 22 });
    for (const mode of ["wallStall", "hitStall"] as const) {
      // Stalled in lane 3 (182 to 242), its box 140 to 260 across; he stands above it, out of its way.
      const s = landed(walk);
      machine(s, { lane: 3, x: 200, dir: 1, mode, until: s.tick + 1000 });
      him(s, 200, 100);
      // A dust bunny under it, walking up toward him, into its bottom face.
      const d = put(s, "bunny", 200, 290);
      // A token under it too, rolling straight up at its bottom face.
      const t = put(s, "token", 160, 300, { vx: 0, vy: -120 });
      let deepest = 0;
      let bounced = false;
      for (let i = 0; i < 200; i++) {
        tick(s, walk);
        deepest = Math.max(deepest, overlapDepth(s.boss, d.x, d.y, 8), overlapDepth(s.boss, t.x, t.y, 7));
        if (t.vy > 0) bounced = true;
      }
      expect(s.boss.mode, mode).toBe(mode);
      expect(deepest, mode).toBeLessThanOrEqual(1e-9);
      // Never through it, never under it: both stayed below its bottom face.
      expect(d.y, mode).toBeGreaterThanOrEqual(242 + 8 - 1e-9);
      expect(bounced, mode).toBe(true);
      expect(Math.hypot(t.vx, t.vy), mode).toBeCloseTo(120, 9);
    }
  });

  it("no dust bunny trickles in while the room is full", () => {
    const tune = tuned({ bunnySpeed: 0, roomCap: 2 });
    const s = fight(tune);
    tick(s, tune);
    s.boss.modeUntil = 1_000_000;
    put(s, "bunny", 30, 300, { dazedUntil: 1_000_000 });
    put(s, "bunny", 330, 300, { dazedUntil: 1_000_000 });
    const events = run(s, tune, 500);
    expect(of(events, "announce")).toEqual([]);
  });

  it("the polisher is a threat: the room slows for a held pull with nothing else in it", () => {
    const s = landed();
    expect(s.things).toEqual([]);
    expect(wouldSlow(s, HOLD)).toBe(true);
  });
});

describe("the aim line on the polisher", () => {
  it("ends on the plug it would hit, on the casing it would bounce off, and on the pad, which will cost a heart", () => {
    const s = landed();
    machine(s, { lane: 3, x: 200, dir: 1 });
    him(s, 60, 212);
    const toPlug = aimLine(s, { dx: 1, dy: 0, power: 1 }, T);
    expect([toPlug.end, toPlug.hitId]).toEqual(["thing", 0]);
    him(s, 200, 100);
    expect(aimLine(s, { dx: 0, dy: 1, power: 1 }, T).end).toBe("polisher");
    him(s, 330, 212);
    expect(aimLine(s, { dx: -1, dy: 0, power: 1 }, T).end).toBe("pad");
  });

  it("says when the launch meets the pad after the line has ended, which will cost a heart", () => {
    const s = landed();
    // The pad heading right in lane 3, its leading end at 150; a dust bunny between it and him.
    machine(s, { lane: 3, x: 90, dir: 1 });
    him(s, 330, 212);
    const d = put(s, "bunny", 260, 212, { dazedUntil: 1_000_000 });
    const left = { dx: -1, dy: 0, power: 1 };
    const line = aimLine(s, left, T);
    expect([line.end, line.hitId, line.padAfter]).toEqual(["thing", d.id, true]);
    // The real launch pops it and runs on into the pad.
    const real = cloneState(s);
    const ev = launchAnd(real, T, { launch: left, pullHeld: false }, (e) => of(e, "bossThrow").length > 0, 120);
    expect(of(ev, "pop").map((e) => e.id)).toEqual([d.id]);
    expect(of(ev, "hurt").map((e) => e.by)).toEqual(["polisher"]);
    // Not when it would cost nothing: invulnerable, or with padHurtsHot off.
    s.him.invulnUntil = s.tick + 1000;
    expect(aimLine(s, left, T).padAfter).toBe(false);
    s.him.invulnUntil = 0;
    expect(aimLine(s, left, tuned({ ...QUIET, padHurtsHot: false })).padAfter).toBe(false);
    // Nor when the line ends on the pad itself: that end is the pad's own.
    d.hp = 0;
    s.things.length = 0;
    expect([aimLine(s, left, T).end, aimLine(s, left, T).padAfter]).toEqual(["pad", false]);
  });

  it("warns of the pad on his last heart too, where the night ends and nothing throws him", () => {
    // As above, with one heart left: the pad heading right in lane 3, its leading end at 150.
    const s = landed();
    machine(s, { lane: 3, x: 90, dir: 1 });
    him(s, 330, 212);
    s.hearts = 1;
    const left = { dx: -1, dy: 0, power: 1 };
    // Straight at the pad: the line ends on it, where the real launch loses the heart that ends the night.
    const line = aimLine(s, left, T);
    expect([line.end, line.padAfter]).toEqual(["pad", false]);
    const real = cloneState(s);
    const ev = launchAnd(real, T, { launch: left, pullHeld: false }, () => real.phase === "over", 120);
    const [hurt] = of(ev, "hurt");
    expect([hurt.by, hurt.hearts, real.ended]).toEqual(["polisher", 0, "hearts"]);
    expect(of(ev, "bossThrow")).toEqual([]);
    expect(line.pts.slice(-2)).toEqual([hurt.x, hurt.y]);
    // Through a dazed dust bunny and on into the pad: the line ends on the bunny, and says the pad comes after.
    const d = put(s, "bunny", 260, 212, { dazedUntil: 1_000_000 });
    const through = aimLine(s, left, T);
    expect([through.end, through.hitId, through.padAfter]).toEqual(["thing", d.id, true]);
    const real2 = cloneState(s);
    const ev2 = launchAnd(real2, T, { launch: left, pullHeld: false }, () => real2.phase === "over", 120);
    expect(of(ev2, "pop").map((e) => e.id)).toEqual([d.id]);
    expect(of(ev2, "hurt").map((e) => [e.by, e.hearts])).toEqual([["polisher", 0]]);
    expect(real2.ended).toBe("hearts");
    // Invulnerable, the pad costs nothing and throws him: no warning.
    s.him.invulnUntil = s.tick + 1000;
    expect(aimLine(s, left, T).padAfter).toBe(false);
  });
});

describe("he is never inside its box", () => {
  it("at the end of every tick of 40 fights of random launches, with charms, he is clear of the machine", () => {
    let worst = 0;
    let ticks = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const tune = tuned({ hearts: 99 });
      const s = createState(seed, tune, { hour: BOSS_HOUR, hearts: 99, charms: seed % 2 ? ["wide", "heavy"] : ["longBurn"] });
      const input = scripted(seed);
      for (let t = 0; t < 5400 && s.phase !== "over"; t++) {
        step(s, input(), tune, []);
        worst = Math.max(worst, inside(s));
        ticks++;
      }
    }
    expect(ticks).toBeGreaterThan(100_000);
    expect(worst).toBeLessThanOrEqual(1e-9);
  });
});
