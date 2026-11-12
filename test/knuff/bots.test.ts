import { beforeAll, describe, expect, it } from "vitest";
import { KITER, kiterBot, onceBot } from "../../lib/knuff/bots/aimless";
import { CAST, STEP1_NIGHT, nightSeed, player, playerStream, runNight, type Night } from "../../lib/knuff/bots/driver";
import { CAUTIOUS, EXPERT, NO_INPUT, ORDINARY, PROBE, handBot, isDown, ms, probePick, rollout, type Now } from "../../lib/knuff/bots/probe";
import { AIMLESS, SMOKE, SMOKE_LOOK_AHEAD, STEP1_BOUNDS, boundsFor, summarise, type Sum } from "../../lib/knuff/bots/table";
import { DEFAULT_TUNE } from "../../lib/knuff/content/tune";
import { createState, hashState } from "../../lib/knuff/sim/state";
import { step } from "../../lib/knuff/sim/step";
import type { SimEvent } from "../../lib/knuff/sim/types";
import { night, put, tuned } from "./room";

/**
 * The players, and the smoke check of the balance table (§13.5).
 *
 * The table itself is the script's (scripts/knuff-balance.ts: 200 nights a
 * player, half an hour). What runs here is the same list of bounds on few
 * nights, loosened as §13.5 says: 60 nights and 10 points for the players
 * who do not look ahead, 12 nights and 20 points for the four who do. It
 * catches a broken build and nothing finer. It runs on the tune as it
 * stands, on the step-1 night.
 *
 * The fairness rules are not loosened: one case fails.
 */

const tune = DEFAULT_TUNE;
const LONG = { timeout: 240_000 };

const batches = new Map<string, Sum>();
/** A player's batch of nights, run once and shared: a bound measured against another player reads that player's from here. */
function batch(key: string): Sum {
  let sum = batches.get(key);
  if (!sum) {
    const who = player(key);
    const count = who.looksAhead ? 12 : 60;
    const nights: Night[] = [];
    for (let i = 0; i < count; i++) nights.push(runNight(nightSeed(i), who, tune, STEP1_NIGHT));
    sum = summarise(key, who.label, nights, tune);
    batches.set(key, sum);
  }
  return sum;
}

/** Assert every bound of one player's row, and the rules that hold for every player, on that player's nights. */
function holds(key: string, against: readonly string[] = []): void {
  const who = player(key);
  const w = who.looksAhead ? SMOKE_LOOK_AHEAD : SMOKE;
  const sums = new Map<string, Sum>([[key, batch(key)]]);
  for (const other of against) sums.set(other, batch(other));
  for (const b of boundsFor(key, sums)) {
    const v = b.check(sums, tune, w);
    expect(v.ok, `${b.text}: ${v.measured}`).toBe(true);
  }
  const own = new Map<string, Sum>([[key, batch(key)]]);
  for (const b of boundsFor("every", own)) {
    const v = b.check(own, tune, w);
    expect(v.ok, `${who.label}. ${b.text}: ${v.measured}`).toBe(true);
  }
}

describe("the step-1 table, as a smoke check", () => {
  // The two players other rows are measured against, and the five Straight must outscore.
  beforeAll(() => {
    batch("expert");
    batch("ordinary");
    for (const key of AIMLESS) batch(key);
  }, LONG.timeout);

  it("every bound belongs to a player of the cast, and every player of the table has a row", () => {
    const keys = CAST.map((c) => c.key);
    for (const b of STEP1_BOUNDS) {
      if (b.row !== "every") expect(keys).toContain(b.row);
      for (const k of b.needs) expect(keys).toContain(k);
    }
    // The studies' random kiter is printed beside the table and has no bound.
    for (const k of keys) expect(STEP1_BOUNDS.some((b) => b.row === k), k).toBe(k !== "kiter-random");
    expect(STEP1_BOUNDS.filter((b) => b.row === "every")).toHaveLength(4);
  });

  it("Once", () => holds("once"));
  it("Spam", LONG, () => holds("spam", ["expert"]));
  it("Flicker", LONG, () => holds("flicker", ["expert"]));
  it("Rhythm", () => holds("rhythm"));
  it("Kiter", LONG, () => holds("kiter", ["ordinary"]));
  it("the studies' random kiter: no bound, but the rules that hold for everyone", LONG, () => holds("kiter-random"));
  it("Straight", LONG, () => holds("straight", AIMLESS));
  it("Corner", LONG, () => holds("corner", ["ordinary"]));
  it("Cautious", LONG, () => holds("cautious"));
  it("Ordinary", LONG, () => holds("ordinary"));
  it("Expert", LONG, () => holds("expert"));

  it("loosens a share by points, another bound by a part of itself, and a rule for every night not at all", () => {
    const one = batch("once");
    const made = (over: Partial<Sum>): Map<string, Sum> => new Map([["cautious", { ...one, key: "cautious", ...over }]]);
    const verdicts = (sums: Map<string, Sum>, w: typeof SMOKE) => Object.fromEntries(boundsFor("cautious", sums).map((b) => [b.text, b.check(sums, tune, w).ok]));
    const at20 = "Cautious: alive at 20:00 in at least 9 nights in 10";
    const real = "Cautious: lasts a median of at least 45 s of real time";
    const early = "Cautious: no heart lost within 120 ticks of its first launch, in any night";
    const alive = (n: number) => [100, n, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    // 75 nights in 100 at 20:00: outside as written and with 10 points, inside with 20.
    const short = made({ n: 100, aliveAt: alive(75), realMedian: 38, earlyHeartNights: 1 });
    expect(verdicts(short, { share: 0, part: 0, hour: 0 })[at20]).toBe(false);
    expect(verdicts(short, SMOKE)[at20]).toBe(false);
    expect(verdicts(short, SMOKE_LOOK_AHEAD)[at20]).toBe(true);
    // 38 s against 45: inside only when a fifth is taken off.
    expect(verdicts(short, SMOKE)[real]).toBe(false);
    expect(verdicts(short, SMOKE_LOOK_AHEAD)[real]).toBe(true);
    // One night with an early heart fails however much is loosened.
    expect(verdicts(short, SMOKE_LOOK_AHEAD)[early]).toBe(false);
  });
});

describe("the driver", () => {
  it("plays the same night twice from the same seed", () => {
    const a = runNight(nightSeed(3), player("straight"), tune);
    const b = runNight(nightSeed(3), player("straight"), tune);
    expect(a).toEqual(b);
    expect(runNight(nightSeed(4), player("straight"), tune)).not.toEqual(a);
  });

  it("gives each player its own stream, by the night's seed and the player's name", () => {
    const draws = (seed: number, name: string) => {
      const r = playerStream(seed, name);
      return [r(), r(), r()];
    };
    expect(draws(1000, "spam")).toEqual(draws(1000, "spam"));
    expect(draws(1000, "spam")).not.toEqual(draws(1000, "rhythm"));
    expect(draws(1000, "spam")).not.toEqual(draws(8919, "spam"));
    for (const x of draws(1000, "spam")) expect(x >= 0 && x < 1).toBe(true);
  });

  it("a player's look-ahead and its draws leave the State as it was", () => {
    const s = createState(nightSeed(0), tune, STEP1_NIGHT);
    const before = hashState(s);
    const bot = player("ordinary").make(playerStream(nightSeed(0), "ordinary"));
    expect(bot.act(s, tune, { clock: 0, landedTick: -1 }).launch).not.toBeNull();
    expect(hashState(s)).toBe(before);
  });

  it("counts real time: a slowed tick is five sixtieths of a second on the player's clock", () => {
    // The Cautious starts its pull 400 ms after he lands and holds it 600 ms. With a threat in the room that
    // is 24 normal ticks and 8 slowed ones, and the launch is the tick after: the 33rd (§13.4).
    const gaps: number[] = [];
    for (let i = 0; i < 4; i++) {
      let landed = -1;
      runNight(nightSeed(i), player("cautious"), tune, STEP1_NIGHT, (events) => {
        for (const e of events) {
          if (e.type === "land") landed = e.tick;
          if (e.type === "launch" && landed >= 0) {
            gaps.push(e.tick - landed);
            landed = -1;
          }
        }
      });
    }
    expect(gaps.length).toBeGreaterThan(50);
    expect(Math.min(...gaps)).toBe(33);
    // The Ordinary: 200 to 400 ms, then 250 ms held, which is 3 slowed ticks. Never sooner than the 16th tick.
    const quick: number[] = [];
    let landed = -1;
    runNight(nightSeed(0), player("ordinary"), tune, STEP1_NIGHT, (events) => {
      for (const e of events) {
        if (e.type === "land") landed = e.tick;
        if (e.type === "launch" && landed >= 0) {
          quick.push(e.tick - landed);
          landed = -1;
        }
      }
    });
    expect(Math.min(...quick)).toBe(16);
  });

  it("keeps the books the table reads", () => {
    const n = runNight(nightSeed(1), player("spam"), tune);
    expect(n.ended).toBe("hearts");
    expect(n.heartsLost).toBe(3);
    expect(n.losses).toHaveLength(3);
    expect(n.ticks).toBe(n.normalTicks + n.slowedTicks);
    expect(n.slowedTicks).toBe(0); // it never holds a pull
    expect(n.maxRoom).toBeLessThanOrEqual(tune.roomCap);
    expect(n.hourLen.length).toBe(n.hour);
    // Once clears nothing: 19:00's second bunch is called early at tick 0 and its third comes by the clock (§13.4).
    const once = runNight(nightSeed(1), player("once"), tune);
    expect(once.early).toBe(2);
    expect(once.announced).toBe(8);
    expect(once.launches).toBe(1);
  });
});

describe("the players", () => {
  const now = (clock: number, landedTick = -1): Now => ({ clock, landedTick });

  it("their times are whole numbers of the clock", () => {
    expect([50, 100, 150, 200, 250, 400, 600].map(ms)).toEqual([3, 6, 9, 12, 15, 24, 36]);
    expect([EXPERT.hold, ORDINARY.hold, CAUTIOUS.hold]).toEqual([9, 15, 36]);
    expect([ORDINARY.delayLo, ORDINARY.delayHi, CAUTIOUS.delayLo, CAUTIOUS.delayHi]).toEqual([12, 24, 24, 24]);
    expect([EXPERT.errDeg, ORDINARY.errDeg, CAUTIOUS.errDeg]).toEqual([3, 3, 6]);
    expect(PROBE).toMatchObject({ dirs: 36, horizon: 70, powers: [1] });
  });

  it("the first shot is taken at once, and the probe finds the rack", () => {
    const s = createState(1, tune, STEP1_NIGHT);
    const bot = handBot(playerStream(1, "x"), { ...ORDINARY, errDeg: 0 });
    const input = bot.act(s, tune, now(0));
    expect(input.launch).not.toBeNull();
    const o = rollout(s, tune, input.launch, PROBE.horizon);
    expect(o.points).toBeGreaterThan(0);
    expect(o.hearts).toBe(0);
  });

  it("the probe does not launch into an empty room, and looking ahead changes nothing", () => {
    const s = night(tune);
    const before = hashState(s);
    const pick = probePick(s, tune, PROBE, playerStream(1, "x"));
    expect(pick.launch).toBeNull();
    expect(hashState(s)).toBe(before);
  });

  it("the probe puts a heart before any number of points", () => {
    // A dust bunny on him takes a heart if he stays. Every launch avoids that; the probe launches.
    const s = night(tune);
    put(s, "bunny", s.him.x + 22, s.him.y);
    expect(rollout(s, tune, null, PROBE.horizon).hearts).toBe(1);
    const pick = probePick(s, tune, PROBE, playerStream(1, "x"));
    expect(pick.launch).not.toBeNull();
    expect(rollout(s, tune, pick.launch, PROBE.horizon).hearts).toBe(0);
  });

  it("a thing is down, to a player, from the tick after its landing tick", () => {
    const s = night(tune);
    s.tick = 100;
    expect(isDown(s, { landTick: 100 })).toBe(false);
    expect(isDown(s, { landTick: 99 })).toBe(true);
    expect(isDown(s, { landTick: -1 })).toBe(true);
  });

  it("Once launches once", () => {
    const bot = onceBot(playerStream(1, "once"));
    const s = createState(1, tune, STEP1_NIGHT);
    expect(bot.act(s, tune, now(0)).launch).not.toBeNull();
    expect(bot.act(s, tune, now(1))).toBe(NO_INPUT);
  });

  it("Spam launches on the tick a pip is there; Rhythm every 42 ticks", () => {
    const launches = (key: string) => {
      const ticks: number[] = [];
      runNight(nightSeed(2), player(key), tune, STEP1_NIGHT, (events) => {
        for (const e of events) if (e.type === "launch") ticks.push(e.tick);
      });
      return ticks;
    };
    const spam = launches("spam");
    // Three pips at once, then one each time the timer gives one (or a pop or a heart does).
    expect(spam.slice(0, 3)).toEqual([0, 1, 2]);
    const rhythm = launches("rhythm");
    expect(rhythm[0]).toBe(0);
    for (const t of rhythm) expect(t % 42).toBe(0);
  });

  it("the Kiter sits until something is within 55 u, then 15 ticks later flees within 20 degrees of straight away", () => {
    const t = tuned({ bunnySpeed: 0 });
    for (let k = 0; k < 20; k++) {
      const s = night(t);
      const bot = kiterBot(playerStream(k, "kiter"), KITER);
      const far = put(s, "bunny", s.him.x + 80, s.him.y);
      for (let i = 0; i < 30; i++) expect(bot.act(s, t, now(i)).launch).toBeNull();
      far.x = s.him.x + 50;
      const events: SimEvent[] = [];
      let fired = null;
      for (let i = 30; i < 60 && fired === null; i++) {
        const input = bot.act(s, t, now(i));
        if (input.launch) fired = { at: i, launch: input.launch };
        step(s, NO_INPUT, t, events);
      }
      expect(fired).not.toBeNull();
      // Seen at clock 30, fired at 45.
      expect(fired!.at).toBe(45);
      const away = Math.atan2(fired!.launch.dy, fired!.launch.dx);
      const off = Math.abs(Math.atan2(Math.sin(away - Math.PI), Math.cos(away - Math.PI)));
      expect(off).toBeLessThanOrEqual(0.35 + 1e-9);
      expect(fired!.launch.power).toBe(1);
    }
  });
});
