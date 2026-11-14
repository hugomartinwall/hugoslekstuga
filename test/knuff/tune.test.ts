import { describe, expect, it } from "vitest";
import { DEFAULT_TUNE, GAME, PACE, TOY, mergeTune, paceGives } from "../../lib/knuff/content/tune";
import { cloneState, createState, hashState } from "../../lib/knuff/sim/state";
import { step } from "../../lib/knuff/sim/step";
import type { SimEvent, Tune } from "../../lib/knuff/sim/types";

/**
 * The knobs are one plain table, and a caller may lay a partial one over
 * it when a game starts: the owner turns them from a link while he plays.
 * A table typed by hand must not be able to break the game it is laid on.
 */

describe("the knob table", () => {
  it("is plain: every knob a finite number, but the pull's direction and two switches", () => {
    for (const [knob, value] of Object.entries(DEFAULT_TUNE)) {
      if (knob === "pullDir") expect(["back", "push"]).toContain(value);
      else if (knob === "thumpTurnsTokens") expect(value).toBe(true);
      else if (knob === "padHurtsHot") expect(value).toBe(false);
      else expect(typeof value === "number" && Number.isFinite(value), knob).toBe(true);
    }
    expect(JSON.parse(JSON.stringify(DEFAULT_TUNE))).toEqual(DEFAULT_TUNE);
  });

  it("is its two halves, and no knob is in both", () => {
    const toy = Object.keys(TOY);
    const game = Object.keys(GAME);
    expect(toy.filter((k) => game.includes(k))).toEqual([]);
    expect([...toy, ...game].sort()).toEqual(Object.keys(DEFAULT_TUNE).sort());
  });

  it("the pull is a pull back, the room slows to a fifth, and the pull is full at 100 px", () => {
    expect(DEFAULT_TUNE.pullDir).toBe("back");
    expect(DEFAULT_TUNE.slowShare).toBe(0.2);
    expect(DEFAULT_TUNE.pullFullPx).toBe(100);
  });

  it("the game's half holds the spec's starting values (§2.2), as the lead's decisions have set them", () => {
    // Written out, so a number changed in the table shows up here as a change someone made on purpose.
    // From the spec's first values: bossSpeed 90 (decision 16), padHurtsHot off (21), thumpTurnsTokens on (22), paceLastCall 1020 (23),
    // and paceTokens 5, the dial turned to bring the table's rows back in after them (decision 24) and after the thump's
    // wider reach for tokens, thumpTokenReach 43 (decision 31); bellDazeTicks 60, Bell made a live pick (decision 33).
    expect(GAME).toEqual({
      lineShowsPx: 12,
      noShotPx: 24,
      minPower: 0.5,
      aimCushions: 1,
      pipMax: 3,
      pipRefillTicks: 96,
      pipRefundPop: 2,
      gumStopMinPips: 1,
      popHotTicks: 0,
      thumpRadius: 40,
      dazeTicks: 36,
      arriveDazedWithin: 60,
      thumpTurnsTokens: true,
      thumpTokenReach: 43,
      hearts: 3,
      invulnTicks: 72,
      hitWaveRadius: 90,
      hitWaveSpeed: 260,
      slowMeterMax: 16,
      slowRefillTicks: 9,
      slowLandingFloor: 8,
      hourMaxTicks: 1800,
      offerLatestTick: 1320,
      hourPauseTicks: 180,
      telegraphTicks: 36,
      arriveMinDist: 150,
      roomCap: 24,
      pace: 2,
      paceRoom: 6,
      paceEvery: 228,
      paceLastCall: 1020,
      paceLastCallFirst: 456,
      paceTokens: 5,
      bunnySpeed: 22,
      bunnyWobble: 0.6,
      bunnyWobbleRate: 0.07,
      tokenSpeed: 150,
      batterySpeed: 14,
      batteryFuseTicks: 300,
      batteryKnockKeep: 0.9,
      batteryKnockTicks: 48,
      blastRadius: 70,
      blastChainTicks: 12,
      envelopeSpeed: 60,
      envelopeTurnDeg: 0.5,
      envelopeMass: 0.2,
      bagSpeed: 10,
      bagHits: 8,
      bagTokenEvery: 2,
      bagTokenLife: 480,
      heartLife: 480,
      chainCap: 8,
      carryMax: 3,
      cushionCap: 3,
      cushionMergeTicks: 9,
      vBonus: 100,
      offerArmTicks: 60,
      pickupMinDist: 80,
      bumperSpeed: 0.8,
      pipPlateCooldown: 240,
      sparkTicks: 48,
      sparkReach: 12,
      bellDazeTicks: 60,
      bellCooldown: 240,
      coinFactor: 2,
      capBumper: 2,
      capPip: 2,
      capSpark: 2,
      capBell: 1,
      capCoin: 2,
      heavyFactor: 0.7,
      longBurnHotFrac: 0.27,
      wideRadius: 2,
      wideFactor: 0.85,
      bossSpeed: 90,
      bossHits: 6,
      bossStallTicks: 60,
      bossSpeedUp: 1.12,
      bossLaneStallTicks: 48,
      bossNoHitTicks: 1500,
      bossTrickleTicks: 240,
      bossCough: 3,
      plugWidth: 24,
      padThrowSpeed: 450,
      padHurtsHot: false,
      bossMaxTicks: 5400,
      nightBonus: 1000,
      heartBonus: 250,
    });
  });

  it("the three knobs the playable carries on the screen start at pace 2, 0 ticks and 1 cushion", () => {
    expect(DEFAULT_TUNE.pace).toBe(2);
    expect(DEFAULT_TUNE.popHotTicks).toBe(0);
    expect(DEFAULT_TUNE.aimCushions).toBe(1);
  });
});

describe("what each pace gives", () => {
  it("pips come back every 96 ticks at pace 2 and 3, and every 120 at pace 1", () => {
    expect(PACE[1].pipRefillTicks).toBe(120);
    expect(PACE[2].pipRefillTicks).toBe(96);
    expect(PACE[3].pipRefillTicks).toBe(96);
    expect(DEFAULT_TUNE.pipRefillTicks).toBe(96);
  });

  it("an extra bunch carries five tokens at pace 2 and six at pace 3 (the two fix rounds of steps 4 and 5; the spec began at two and three)", () => {
    expect(PACE[2].paceTokens).toBe(5);
    expect(PACE[3].paceTokens).toBe(6);
  });

  it("the other four are the same at 2 and 3: six left, 228 ticks, last call at 1020 (decision 23) and at 456", () => {
    for (const pace of [2, 3] as const) {
      expect(PACE[pace].paceRoom).toBe(6);
      expect(PACE[pace].paceEvery).toBe(228);
      expect(PACE[pace].paceLastCall).toBe(1020);
      expect(PACE[pace].paceLastCallFirst).toBe(456);
    }
  });

  it("the table starts at pace 2 with what pace 2 gives", () => {
    expect(mergeTune(DEFAULT_TUNE, { pace: 2 })).toEqual(DEFAULT_TUNE);
    for (const [knob, value] of Object.entries(PACE[2])) expect(DEFAULT_TUNE[knob as keyof Tune], knob).toBe(value);
  });

  it("naming a pace deals its values", () => {
    expect(mergeTune(DEFAULT_TUNE, { pace: 1 }).pipRefillTicks).toBe(120);
    expect(mergeTune(DEFAULT_TUNE, { pace: 3 }).paceTokens).toBe(6);
    expect(mergeTune(DEFAULT_TUNE, { pace: 3 }).pipRefillTicks).toBe(96);
    const one = mergeTune(DEFAULT_TUNE, { pace: 1 });
    expect(mergeTune(one, { pace: 2 })).toEqual(DEFAULT_TUNE);
    // And changes nothing else.
    const rest = (t: Tune) => Object.entries(t).filter(([k]) => k !== "pace" && !(k in PACE[1]));
    expect(rest(mergeTune(DEFAULT_TUNE, { pace: 3 }))).toEqual(rest(DEFAULT_TUNE));
  });

  it("a value given by name wins over the one the pace gives", () => {
    const tune = mergeTune(DEFAULT_TUNE, { pace: 3, pipRefillTicks: 120, paceTokens: 1 });
    expect(tune.pace).toBe(3);
    expect(tune.pipRefillTicks).toBe(120);
    expect(tune.paceTokens).toBe(1);
    expect(tune.paceRoom).toBe(6);
    // Whatever order they were typed in.
    expect(mergeTune(DEFAULT_TUNE, { pipRefillTicks: 120, pace: 3 }).pipRefillTicks).toBe(120);
    // Named alone, with no pace beside it, it is simply set.
    expect(mergeTune(DEFAULT_TUNE, { pipRefillTicks: 120 }).pipRefillTicks).toBe(120);
    expect(mergeTune(DEFAULT_TUNE, { pipRefillTicks: 120 }).pace).toBe(2);
    expect(mergeTune(DEFAULT_TUNE, { paceLastCall: 684 }).paceLastCall).toBe(684);
  });

  it("an override that does not name the pace leaves what it gave alone", () => {
    const three = mergeTune(DEFAULT_TUNE, { pace: 3 });
    const later = mergeTune(three, { popHotTicks: 15 });
    expect(later.paceTokens).toBe(6);
    expect(later.pace).toBe(3);
    expect(later.popHotTicks).toBe(15);
  });

  it("the whole of what was named is laid over the default table, so a named value outlives a change of pace", () => {
    // What the shell does when a key on the screen changes the pace after a link named the pip timer.
    const named: Partial<Tune> = { pipRefillTicks: 120 };
    const first = mergeTune(DEFAULT_TUNE, named);
    Object.assign(named, { pace: 3 });
    const second = mergeTune(DEFAULT_TUNE, named);
    expect(first.pipRefillTicks).toBe(120);
    expect(second.pipRefillTicks).toBe(120);
    expect(second.paceTokens).toBe(6);
    // Laying only the newest change over the table in use would deal the pace's own value again.
    expect(mergeTune(first, { pace: 3 }).pipRefillTicks).toBe(96);
  });

  it("a pace that is none of the three is read as 1", () => {
    for (const pace of [0, 4, 2.5, -1]) {
      expect(paceGives(pace)).toBe(PACE[1]);
      expect(mergeTune(DEFAULT_TUNE, { pace }).pipRefillTicks).toBe(120);
    }
    expect(paceGives(2)).toBe(PACE[2]);
    expect(paceGives(3)).toBe(PACE[3]);
  });
});

describe("laying a partial table over it", () => {
  it("changes the knobs it names and no other", () => {
    const tune = mergeTune(DEFAULT_TUNE, { aimCushions: 2, pullDir: "push", maxSpeed: 1000, thumpTurnsTokens: false });
    expect(tune.aimCushions).toBe(2);
    expect(tune.pullDir).toBe("push");
    expect(tune.maxSpeed).toBe(1000);
    expect(tune.thumpTurnsTokens).toBe(false);
    const named = ["aimCushions", "pullDir", "maxSpeed", "thumpTurnsTokens"];
    const rest = (t: Tune) => Object.entries(t).filter(([k]) => !named.includes(k));
    expect(rest(tune)).toEqual(rest(DEFAULT_TUNE));
  });

  it("never changes the table it is laid on", () => {
    const before = JSON.stringify(DEFAULT_TUNE);
    const tune = mergeTune(DEFAULT_TUNE, { friction: 1, pace: 3 });
    expect(JSON.stringify(DEFAULT_TUNE)).toBe(before);
    expect(JSON.stringify(PACE[3])).toBe(JSON.stringify({ ...PACE[2], paceTokens: 6 }));
    expect(tune).not.toBe(DEFAULT_TUNE);
    expect(mergeTune(DEFAULT_TUNE, undefined)).toEqual(DEFAULT_TUNE);
    expect(mergeTune(DEFAULT_TUNE, undefined)).not.toBe(DEFAULT_TUNE);
    expect(mergeTune(DEFAULT_TUNE, null)).toEqual(DEFAULT_TUNE);
    expect(mergeTune(DEFAULT_TUNE, {})).toEqual(DEFAULT_TUNE);
  });

  it("leaves out what is not a knob, or not the kind of thing the knob holds", () => {
    // As it would arrive from a link: JSON, typed by hand.
    const typed = JSON.parse(
      '{"aimCushions":2,"speed":3,"maxSpeed":"fast","friction":null,"pullDir":"sideways","hotFrac":true,"restSpeed":[14],"thumpTurnsTokens":1,"pace":"3","__proto__":{"dragK":9},"constructor":1}',
    ) as Partial<Tune>;
    const tune = mergeTune(DEFAULT_TUNE, typed);
    expect(tune).toEqual({ ...DEFAULT_TUNE, aimCushions: 2 });
    expect(Object.keys(tune).sort()).toEqual(Object.keys(DEFAULT_TUNE).sort());
    expect(Object.getPrototypeOf(tune)).toBe(Object.prototype);
  });

  it("leaves out a number that is not one", () => {
    const tune = mergeTune(DEFAULT_TUNE, { maxSpeed: Number.NaN, friction: Number.POSITIVE_INFINITY, dragK: Number.NEGATIVE_INFINITY, pace: Number.NaN });
    expect(tune).toEqual(DEFAULT_TUNE);
  });

  it("a second table goes over the first", () => {
    const once = mergeTune(DEFAULT_TUNE, { maxSpeed: 1000, friction: 100 });
    const twice = mergeTune(once, { friction: 120 });
    expect(twice.maxSpeed).toBe(1000);
    expect(twice.friction).toBe(120);
  });

  it("every knob can be turned from a link", () => {
    // A knob must be in the default table before a link or a key can turn it.
    for (const knob of ["pace", "popHotTicks", "aimCushions", "pipRefillTicks", "paceTokens", "paceLastCall", "pipRefundPop", "slowMeterMax", "slowRefillTicks", "slowLandingFloor", "thumpTurnsTokens", "padHurtsHot"]) {
      expect(Object.prototype.hasOwnProperty.call(DEFAULT_TUNE, knob), knob).toBe(true);
    }
    const typed = JSON.parse('{"popHotTicks":15,"aimCushions":2,"pace":1,"slowMeterMax":10,"thumpTurnsTokens":false,"padHurtsHot":true}') as Partial<Tune>;
    const tune = mergeTune(DEFAULT_TUNE, typed);
    expect([tune.popHotTicks, tune.aimCushions, tune.pace, tune.slowMeterMax, tune.thumpTurnsTokens, tune.padHurtsHot]).toEqual([15, 2, 1, 10, false, true]);
  });
});

describe("an odd table still gives a State made of numbers", () => {
  /**
   * The values of a knob are not checked for sense: a table that asks for
   * a negative mass, or for cushions that give back three times what they
   * get, gets what it asks for (and numbers that run away). What is checked
   * is that the ordinary slips of a hand on a link (a nought, a minus, a
   * knob turned far too high) do not put a NaN into the State, and do not
   * keep a night from ending.
   */
  function survives(over: Partial<Tune>): boolean {
    const tune = mergeTune(DEFAULT_TUNE, over);
    const s = createState(7, tune);
    const events: SimEvent[] = [];
    // Hard launches and soft ones, at the rack and away from it, some with
    // a pull held before them: pops, cushions, landings, lost hearts, rows.
    for (let t = 0; t < 4000; t++) {
      events.length = 0;
      const n = t / 50;
      const launch = t % 50 === 0 ? { dx: Math.cos(n * 2.4) * 0.5, dy: -1 + (n % 5) * 0.45, power: n % 3 === 0 ? 1 : 0.15 + (n % 7) * 0.03 } : null;
      step(s, { launch, pullHeld: t % 50 > 40 }, tune, events);
      // The room never holds more than the table as it stands could have sent.
      if (s.things.length > 400) return false;
    }
    const copy = cloneState(s);
    const text = JSON.stringify(s);
    // No NaN and no Infinity anywhere: JSON would have written them as null.
    return !text.includes("null") && hashState(copy) === hashState(JSON.parse(text));
  }

  const ODD: [string, Partial<Tune>][] = [
    ["nothing changed", {}],
    ["no launch speed", { maxSpeed: 0 }],
    ["a huge launch speed", { maxSpeed: 1e6 }],
    ["no drag and no friction", { dragK: 0, friction: 0 }],
    ["negative friction", { friction: -500 }],
    ["no substeps", { maxSubsteps: 0 }],
    ["no substep travel", { maxSubstepTravel: 0 }],
    ["a negative radius", { himRadius: -5 }],
    ["a radius wider than the room", { himRadius: 400 }],
    ["cushions that give nothing back", { wallRestitution: 0, lightWallRestitution: 0 }],
    ["no slow motion, and time stopped while aiming", { slowShare: 0 }],
    ["everything is hot", { hotFrac: 0 }],
    ["nothing is hot", { hotFrac: 50 }],
    ["a pull with no length", { pullFullPx: 0, noShotPx: 0, lineShowsPx: 0 }],
    ["no minimum power", { minPower: 0 }],
    ["a minimum power over the top", { minPower: 9 }],
    ["no pips", { pipMax: 0 }],
    ["a negative number of pips", { pipMax: -2 }],
    ["pips that come back at once", { pipRefillTicks: 0 }],
    ["pips that never come back", { pipRefillTicks: 1e9 }],
    ["every pop gives a pip", { pipRefundPop: 1 }],
    ["hot for ever after a pop", { popHotTicks: 1e9 }],
    ["a negative hot window", { popHotTicks: -15 }],
    ["no thump", { thumpRadius: 0 }],
    ["a thump as wide as the room", { thumpRadius: 1e6, thumpTurnsTokens: true }],
    ["no daze", { dazeTicks: 0 }],
    ["a negative daze", { dazeTicks: -36 }],
    ["a daze for ever", { dazeTicks: 1e9 }],
    ["every arrival lands dazed", { arriveDazedWithin: 1e6 }],
    ["no hearts", { hearts: 0 }],
    ["a negative number of hearts", { hearts: -1 }],
    ["a thousand hearts", { hearts: 1000 }],
    ["never invulnerable", { invulnTicks: 0 }],
    ["a wave that throws things across the room", { hitWaveRadius: 1e6, hitWaveSpeed: 1e6 }],
    ["no wave", { hitWaveRadius: 0, hitWaveSpeed: 0 }],
    ["no meter", { slowMeterMax: 0, slowLandingFloor: 0 }],
    ["a meter that refills at once", { slowRefillTicks: 0 }],
    ["a meter with a floor over its top", { slowLandingFloor: 99 }],
    ["hours with no length", { hourMaxTicks: 0 }],
    ["hours that never end", { hourMaxTicks: 1e9, hourPauseTicks: 1e9 }],
    ["no pause between hours", { hourPauseTicks: 0, offerLatestTick: 0 }],
    ["no telegraph", { telegraphTicks: 0 }],
    ["a negative telegraph", { telegraphTicks: -10 }],
    ["arrivals as far away as can be", { arriveMinDist: 1e6 }],
    ["arrivals on top of him", { arriveMinDist: 0 }],
    ["no room for anything", { roomCap: 0 }],
    ["a negative cap", { roomCap: -5 }],
    ["a room for two hundred", { roomCap: 200 }],
    ["a pace that is none of the three", { pace: 7 }],
    ["pace 1", { pace: 1 }],
    ["pace 3", { pace: 3 }],
    ["every row called early", { paceRoom: 1e6 }],
    ["no row called early", { paceRoom: -1 }],
    ["a row every tick", { paceEvery: 0 }],
    ["a negative clock", { paceEvery: -228 }],
    ["last call at tick 0", { paceLastCall: 0, paceLastCallFirst: 0 }],
    ["last call never", { paceLastCall: 1e9, paceLastCallFirst: 1e9 }],
    ["a negative number of tokens", { paceTokens: -3 }],
    ["half a token", { paceTokens: 2.5 }],
    ["dust bunnies that do not walk", { bunnySpeed: 0, bunnyWobble: 0, bunnyWobbleRate: 0 }],
    ["dust bunnies faster than he is", { bunnySpeed: 1e5, bunnyWobble: 50, bunnyWobbleRate: 9 }],
    ["tokens that stand still", { tokenSpeed: 0 }],
    ["tokens faster than he is", { tokenSpeed: 1e5 }],
    ["a thing with no mass", { lightMass: 0 }],
    ["no chain and no cushions", { chainCap: 0, cushionCap: 0, carryMax: -1 }],
    ["every cushion merged", { cushionMergeTicks: 1e9 }],
    ["no cushion merged", { cushionMergeTicks: -1 }],
  ];
  for (const [name, over] of ODD) {
    it(name, () => {
      expect(survives(over)).toBe(true);
    });
  }
});
