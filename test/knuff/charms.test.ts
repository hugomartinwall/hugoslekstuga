import { describe, expect, it } from "vitest";
import { BODY_CHARMS, CORNER_MATE, DARK, DARK_PLATES, PLATES, START_PLATES, WALL_CHARMS, type WallCharm } from "../../lib/knuff/content/charms";
import { CHARM_LINE, CHARM_NAME } from "../../lib/knuff/content/copy";
import { KINDS } from "../../lib/knuff/content/kinds";
import { DEFAULT_TUNE } from "../../lib/knuff/content/tune";
import { capOf, insertCentre, plateAt, statsFor } from "../../lib/knuff/sim/charms";
import { isHot, land } from "../../lib/knuff/sim/hot";
import { DT } from "../../lib/knuff/sim/physics";
import { createState, type StartOptions } from "../../lib/knuff/sim/state";
import type { OfferItem, SimEvent, State, Thing, Tune } from "../../lib/knuff/sim/types";
import { CHARM_ICON } from "../../lib/knuff/render/sprites";
import { REST, fire, night, of, put, run, shot, speedOf, tick, tuned, until } from "./room";

/**
 * Plates, charms and the offer (§6, §3.1).
 *
 * A lit plate fires every time he bounces off it; a body charm changes his
 * numbers, and those are made by statsFor alone. The offer is made within
 * the caps and the corner rule, opens when the hour is clear (or at tick
 * 1,320), arms when he lands or a second later, and is taken only by an
 * armed launch: a pickup's tile his circle overlaps, or the offered plate
 * that is that launch's first cushion. Taking settles it; the next hour
 * closes it.
 */

/** Dust bunnies that stand still: what is put in the room stays where it is put. */
const still = tuned({ bunnySpeed: 0 });

/** Ten plates, dark but for these. */
function platesWith(lit: Record<number, WallCharm>): string[] {
  const p = DARK_PLATES.slice();
  for (const [k, v] of Object.entries(lit)) p[Number(k)] = v;
  return p;
}

/** A night begun by hand with these plates lit and nothing offered: for the plates' own cases. */
function lit(plates: Record<number, WallCharm>, tune: Tune = still, start: StartOptions = {}): State {
  return night(tune, { plates: platesWith(plates), offers: false, ...start });
}

/** Put him somewhere, standing. */
function standAt(s: State, x: number, y: number): void {
  s.him.x = x;
  s.him.y = y;
  s.him.px = x;
  s.him.py = y;
}

/** His speed after one tick's drag, from `v`: the toy's slowing. */
function dragged(tune: Tune, v: number): number {
  return v * Math.exp(-tune.dragK * DT) - tune.friction * DT;
}

/** Step until he lands (or `most` ticks), and return what happened. */
function toLanding(s: State, tune: Tune, most = 400): SimEvent[] {
  return until(s, tune, (ev) => ev.some((e) => e.type === "land"), most);
}

/** Put an offer out by hand, open and armed on the tick before this one. Pickups lie where `at` says. */
function offerOut(s: State, items: ({ kind: "plate"; charm: string; plate: number } | { kind: "pickup"; charm: string; at: [number, number] })[]): OfferItem[] {
  const out: OfferItem[] = [];
  for (const it of items) {
    if (it.kind === "plate") out.push({ kind: "plate", charm: it.charm, plate: it.plate, thingId: -1 });
    else {
      const d = put(s, "pickup", it.at[0], it.at[1], { landTick: s.tick - 1 });
      out.push({ kind: "pickup", charm: it.charm, plate: -1, thingId: d.id });
    }
  }
  s.offer = { open: true, openTick: s.tick - 1, armedTick: s.tick - 1, items: out };
  return out;
}

describe("his numbers after charms: statsFor", () => {
  const tune = DEFAULT_TUNE;

  it("without a charm every number is the tune's own, to the last bit", () => {
    const st = statsFor([], tune);
    expect(st).toEqual({ radius: tune.himRadius, hotSpeed: tune.hotFrac * tune.maxSpeed, popImpulse: tune.popImpulseScale, pipMax: tune.pipMax, maxHearts: tune.hearts });
    expect(st.radius).toBe(13);
    expect(st.hotSpeed).toBe(0.33 * 900);
  });

  it("each body charm's number", () => {
    expect(statsFor(["heavy"], tune).popImpulse).toBeCloseTo(0.55 * 0.7, 12);
    expect(statsFor(["wide"], tune)).toMatchObject({ radius: 15 });
    expect(statsFor(["wide"], tune).popImpulse).toBeCloseTo(0.55 * 0.85, 12);
    // Heavy and Wide multiply together.
    expect(statsFor(["heavy", "wide"], tune).popImpulse).toBeCloseTo(0.55 * 0.7 * 0.85, 12);
    expect(statsFor(["longBurn"], tune).hotSpeed).toBeCloseTo(243, 9);
    expect(statsFor(["fourthPip"], tune).pipMax).toBe(4);
    expect(statsFor(["thickSkin"], tune).maxHearts).toBe(4);
    // A wall charm changes none of them.
    expect(statsFor(["bumper", "spark"], tune)).toEqual(statsFor([], tune));
  });

  it("the State carries them, and the start options make them", () => {
    const s = createState(1, tune, { charms: ["wide", "fourthPip", "thickSkin", "wide", "bumper", "nonsense"] });
    // A second copy and a name that is no body charm are left out.
    expect(s.charms).toEqual(["wide", "fourthPip", "thickSkin"]);
    expect(s.stats).toEqual(statsFor(s.charms, tune));
    // Fourth pip starts him with its pip filled; Thick skin with its heart.
    expect([s.pips, s.hearts]).toEqual([4, 4]);
    expect(createState(1, tune, { hearts: 1 }).hearts).toBe(1);
    expect(createState(1, tune, { hearts: 9 }).hearts).toBe(3);
    expect(createState(1, tune, { hearts: 0 }).hearts).toBe(1);
    expect(createState(1, tune, { hearts: 9, charms: ["thickSkin"] }).hearts).toBe(4);
  });

  it("the step reads them: Wide's radius keeps him further from the cushion, Long burn keeps him hot under 297 u/s", () => {
    const w = night(tune, { charms: ["wide"] });
    const events = [...tick(w, tune, shot(-1, 0)), ...until(w, tune, (e) => e.some((x) => x.type === "cushion"))];
    expect(of(events, "cushion")[0].x).toBe(8 + 15);
    // Long burn: hot down to 243 u/s.
    const burn = night(tune, { charms: ["longBurn"] });
    expect(isHot(burn, tune, 250)).toBe(true);
    expect(isHot(night(tune), tune, 250)).toBe(false);
    const plain = night(tune);
    tick(plain, tune, shot(0, -1, 0.5));
    tick(burn, tune, shot(0, -1, 0.5));
    let a = 1;
    let b = 1;
    while (plain.him.hot && a < 200) {
      tick(plain, tune);
      a++;
    }
    while (burn.him.hot && b < 200) {
      tick(burn, tune);
      b++;
    }
    expect(a).toBe(18);
    expect(b).toBeGreaterThan(a);
  });

  it("Wide's radius is the one his body pops with: a dust bunny 22 u off his path pops with Wide (reach 23), and not without (21)", () => {
    const pops = (charms: string[]) => {
      const s = night(still, { charms, plates: DARK_PLATES, offers: false });
      put(s, "bunny", 180 + 22, 374 - 100);
      return of(fire(s, still, shot(0, -1), 30), "pop").length;
    };
    expect(pops(["wide"])).toBe(1);
    expect(pops([])).toBe(0);
  });

  it("Heavy and Wide: the impulse he feels from a pop is 0.7, 0.85 and 0.595 of what it was", () => {
    /** His speed after `ticks` ticks of a launch straight up, a still dust bunny 60 u ahead or not, and the tick of its pop. */
    const after = (charms: string[], bunny: boolean, ticks: number) => {
      const s = night(still, { charms, plates: DARK_PLATES, offers: false });
      if (bunny) put(s, "bunny", 180, 374 - 60);
      const events = fire(s, still, shot(0, -1), ticks);
      return { v: speedOf(s), pop: of(events, "pop")[0]?.tick ?? -1 };
    };
    const popAt = after([], true, 20).pop;
    expect(popAt).toBeGreaterThan(0);
    const n = popAt + 1;
    for (const [charms, k] of [
      [["heavy"], 0.7],
      [["wide"], 0.85],
      [["heavy", "wide"], 0.7 * 0.85],
    ] as const) {
      const free = after([...charms], false, n);
      const lost = after([], true, n);
      const kept = after([...charms], true, n);
      // The pop comes on the same tick with and without the charm (Wide's reach is 2 u longer: a substep at most).
      expect(kept.pop).toBe(lost.pop);
      // Drag is a straight line in speed, so the share of the knock he feels is the share of the speed he lost.
      expect((free.v - kept.v) / (free.v - lost.v)).toBeCloseTo(k, 6);
    }
  });
});

describe("the plates", () => {
  it("a bounce belongs to the plate that holds his centre; a plate owns its lower bound, the last of a cushion both", () => {
    const s = night(DEFAULT_TUNE);
    const cut1 = 8 + 464 / 3;
    const cut2 = 8 + 928 / 3;
    expect([plateAt(s, "top", 8, 21), plateAt(s, "top", 179.999, 21), plateAt(s, "top", 180, 21), plateAt(s, "top", 352, 21)]).toEqual([0, 0, 1, 1]);
    expect([plateAt(s, "bottom", 8, 0), plateAt(s, "bottom", 179.999, 0), plateAt(s, "bottom", 180, 0), plateAt(s, "bottom", 352, 0)]).toEqual([6, 6, 5, 5]);
    expect([plateAt(s, "right", 0, 8), plateAt(s, "right", 0, cut1 - 1e-9), plateAt(s, "right", 0, cut1), plateAt(s, "right", 0, cut2 - 1e-9), plateAt(s, "right", 0, cut2), plateAt(s, "right", 0, 472)]).toEqual([2, 2, 3, 3, 4, 4]);
    expect([plateAt(s, "left", 0, 8), plateAt(s, "left", 0, cut1 - 1e-9), plateAt(s, "left", 0, cut1), plateAt(s, "left", 0, cut2 - 1e-9), plateAt(s, "left", 0, cut2), plateAt(s, "left", 0, 472)]).toEqual([9, 9, 8, 8, 7, 7]);
    // The four corners.
    expect(CORNER_MATE).toEqual([9, 2, 1, -1, 5, 4, 7, 6, -1, 0]);
  });

  it("two are lit from the start: Bumper on plate 0, Pip on plate 4; a launch straight up bounces off plate 1, which is dark", () => {
    const s = night(DEFAULT_TUNE);
    expect(s.plates.map((p) => p.charm)).toEqual([...START_PLATES]);
    const events = fire(s, DEFAULT_TUNE, shot(0, -1), 40);
    expect(of(events, "cushion")[0]).toMatchObject({ side: "top", plate: 1, charm: "" });
  });

  it("each cushion event names its plate, and the side cushion is the first of a corner", () => {
    const s = night(still, { plates: DARK_PLATES, offers: false });
    standAt(s, 40, 40);
    const events = fire(s, still, shot(-1, -1), 20);
    const c = of(events, "cushion");
    expect(c.slice(0, 2).map((e) => [e.side, e.plate])).toEqual([
      ["left", 9],
      ["top", 0],
    ]);
    expect(c[0].tick).toBe(c[1].tick);
  });
});

describe("the wall charms", () => {
  it("Bumper: he leaves at 0.8 of launch speed, 720 u/s, in the direction of the bounce, whatever he came in at", () => {
    for (const power of [1, 0.5]) {
      const s = lit({ 1: "bumper" });
      standAt(s, 200, 70);
      const events = fire(s, still, shot(0, -1, power), 1);
      events.push(...until(s, still, (e) => e.some((x) => x.type === "cushion"), 30));
      const c = of(events, "cushion")[0];
      expect(c).toMatchObject({ plate: 1, charm: "bumper" });
      // He came in faster than 720 at full power and slower at half; he leaves at 720 either way, then one tick's drag.
      if (power === 1) expect(c.speed).toBeGreaterThan(720);
      else expect(c.speed).toBeLessThan(720);
      expect(s.him.vx).toBe(0);
      expect(s.him.vy).toBeGreaterThan(0);
      expect(speedOf(s)).toBeCloseTo(dragged(still, 720), 9);
      expect(still.bumperSpeed * still.maxSpeed).toBe(720);
    }
  });

  it("Bumper kicks once a launch for each plate: two facing each other cannot keep him hot for ever", () => {
    // At 0.8 he cannot cross the room's width off one Bumper; at full launch speed he can, and the rule stops him.
    const full = tuned({ bunnySpeed: 0, bumperSpeed: 1 });
    const s = lit({ 3: "bumper", 8: "bumper" }, full);
    standAt(s, 180, 240);
    const events = fire(s, full, shot(1, 0), 1);
    events.push(...toLanding(s, full, 600));
    const c = of(events, "cushion").map((e) => [e.plate, e.charm]);
    expect(c.slice(0, 3)).toEqual([
      [3, "bumper"],
      [8, "bumper"],
      [3, ""],
    ]);
    expect(s.launch.bumped).toEqual([3, 8]);
    expect(of(events, "land")).toHaveLength(1);
    // A new launch is kicked again.
    const again = fire(s, full, shot(1, 0), 1);
    again.push(...until(s, full, (e) => e.some((x) => x.type === "cushion"), 60));
    expect(of(again, "cushion")[0]).toMatchObject({ plate: 3, charm: "bumper" });
  });

  it("Pip: one pip back if he is below the maximum, at most once every 240 ticks for each plate", () => {
    const s = lit({ 4: "pip" });
    standAt(s, 300, 400);
    const events: SimEvent[] = [];
    // A launch at tick 0, one at 120 and one at 300, each straight at plate 4.
    for (let t = 0; t < 420; t++) {
      if (t === 0 || t === 120 || t === 300) standAt(s, 300, 400);
      events.push(...tick(s, still, t === 0 || t === 120 || t === 300 ? shot(1, 0) : REST));
    }
    const fired = of(events, "cushion").filter((e) => e.plate === 4);
    expect(fired.map((e) => e.charm)).toEqual(["pip", "", "pip"]);
    const back = of(events, "pip").filter((e) => e.why === "plate");
    expect(back).toHaveLength(2);
    expect(back[1].tick - back[0].tick).toBeGreaterThanOrEqual(still.pipPlateCooldown);
    expect(still.pipPlateCooldown).toBe(240);
    // At the maximum it gives nothing, and its cooldown is not spent.
    const full = lit({ 4: "pip" });
    standAt(full, 300, 400);
    tick(full, still, shot(1, 0));
    full.pips = full.stats.pipMax;
    const ev = until(full, still, (e) => e.some((x) => x.type === "cushion"), 30);
    expect(of(ev, "cushion")[0]).toMatchObject({ plate: 4, charm: "" });
    expect(full.plates[4].readyTick).toBe(0);
  });

  it("Pip's cooldown is 240 ticks to the tick: a bounce 240 ticks after the gift gives a pip, one 239 after does not", () => {
    for (const [after, gives] of [
      [240, 1],
      [239, 0],
    ] as const) {
      const s = lit({ 4: "pip" });
      standAt(s, 300, 400);
      const first = fire(s, still, shot(1, 0), 1);
      first.push(...until(s, still, (e) => e.some((x) => x.type === "cushion"), 60));
      const gift = of(first, "pip").filter((e) => e.why === "plate");
      expect(gift, `${after}`).toHaveLength(1);
      // The same launch from the same spot, released `after` ticks after the first: it reaches the plate `after` ticks after the gift.
      run(s, still, after - s.tick);
      standAt(s, 300, 400);
      const again = fire(s, still, shot(1, 0), 1);
      again.push(...until(s, still, (e) => e.some((x) => x.type === "cushion"), 60));
      expect(of(again, "cushion")[0].tick - gift[0].tick, `${after}`).toBe(after);
      expect(of(again, "pip").filter((e) => e.why === "plate"), `${after}`).toHaveLength(gives);
    }
  });

  it("Spark: for 48 ticks after the bounce a ring reaches 12 u past his edge and pops in one hit; not a body pop, no impulse", () => {
    const s = lit({ 1: "spark" });
    standAt(s, 180, 150);
    // Two dust bunnies 27 u to the side of his path: out of his body's reach (21), inside the ring's (33).
    // He passes the first on his way up, before the bounce, and both on his way down.
    const high = put(s, "bunny", 207, 100);
    const low = put(s, "bunny", 207, 220);
    const events = fire(s, still, shot(0, -1), 1);
    events.push(...toLanding(s, still));
    const cushion = of(events, "cushion")[0];
    expect(cushion).toMatchObject({ plate: 1, charm: "spark" });
    const pops = of(events, "pop");
    // Nothing before the bounce: the ring only exists after it.
    expect(pops.every((p) => p.tick >= cushion.tick)).toBe(true);
    expect(pops.map((p) => [p.id, p.source, p.n, p.chain, p.cushions, p.points])).toEqual([
      [high.id, "spark", 1, 1, 2, 20],
      [low.id, "spark", 2, 2, 2, 40],
    ]);
    expect(pops.every((p) => p.tick < cushion.tick + still.sparkTicks)).toBe(true);
    // It counts in his chain and is not a body pop: no pip refund, and he felt nothing.
    expect([s.launch.pops, s.launch.bodyPops]).toEqual([2, 0]);
    expect(of(events, "pip").filter((e) => e.why === "pop")).toEqual([]);
    expect(s.him.x).toBe(180);
    // A pop by the ring is a contact.
    expect(s.him.lastContactTick).toBe(pops[1].tick);
    expect([still.sparkTicks, still.sparkReach]).toEqual([48, 12]);
  });

  it("Spark's reach is 12 u past his edge, to the unit: a dust bunny 32.9 u off his path pops, one 33.1 u off does not", () => {
    const s = lit({ 1: "spark" });
    standAt(s, 180, 150);
    // Both passed on his way down, while the ring lasts: his edge at 13, the ring's at 25, a dust bunny's 8 more.
    const inside = put(s, "bunny", 180 + 32.9, 220);
    const outside = put(s, "bunny", 180 - 33.1, 220);
    const events = fire(s, still, shot(0, -1), 1);
    events.push(...toLanding(s, still));
    const cushion = of(events, "cushion")[0];
    expect(cushion).toMatchObject({ plate: 1, charm: "spark" });
    expect(of(events, "pop").map((p) => [p.id, p.source])).toEqual([[inside.id, "spark"]]);
    expect(outside.hp).toBe(1);
    // He passed both while the ring lasted, at x 180.
    expect(s.him.x).toBe(180);
    expect(of(events, "pop")[0].tick).toBeLessThan(cushion.tick + still.sparkTicks);
  });

  it("Spark's ring ends after 48 ticks, when he lands, and when a new launch is released", () => {
    // A long flight: Spark on plate 3, Bumper on plate 8, and dust bunnies 27 u off his line all the
    // way across, landing as he comes back off the Bumper: some while the ring lasts, most after.
    const s = lit({ 3: "spark", 8: "bumper" });
    standAt(s, 300, 240);
    const row: Thing[] = [];
    for (let x = 30; x <= 330; x += 20) row.push(put(s, "bunny", x, 267, { landTick: 45 }));
    const path: { tick: number; x: number }[] = [];
    const events = fire(s, still, shot(1, 0), 1);
    for (let t = 0; t < 300 && s.launch.active; t++) {
      const ev = tick(s, still);
      events.push(...ev);
      if (s.him.hot) path.push({ tick: s.tick - 1, x: s.him.x });
    }
    const spark = of(events, "cushion").find((e) => e.charm === "spark")!;
    const pops = of(events, "pop");
    expect(pops.length).toBeGreaterThan(2);
    expect(pops.every((p) => p.source === "spark" && p.tick >= spark.tick && p.tick < spark.tick + 48)).toBe(true);
    // And he passed within the ring's reach of some that were left, after the 48 ticks.
    const late = path.filter((p) => p.tick >= spark.tick + 48);
    const left = row.filter((d) => d.hp > 0);
    expect(late.some((p) => left.some((d) => Math.hypot(d.x - p.x, d.y - 240) < 33))).toBe(true);
    // Landed, the ring is off: a dust bunny walking up to him is not popped by it, and costs a heart.
    const walk = tuned({ bunnySpeed: 22 });
    const t2 = lit({ 1: "spark" }, walk);
    tick(t2, walk, shot(0, -1));
    toLanding(t2, walk);
    expect(t2.tick).toBeLessThan(t2.launch.sparkUntil);
    const b = put(t2, "bunny", t2.him.x + 45, t2.him.y);
    const ev = until(t2, walk, (e) => e.some((x) => x.type === "hurt"), 200);
    expect(of(ev, "pop")).toEqual([]);
    expect(of(ev, "hurt")[0].id).toBe(b.id);
    // A new launch puts it out.
    const t3 = lit({ 1: "spark" });
    tick(t3, still, shot(0, -1));
    until(t3, still, (e) => e.some((x) => x.type === "cushion"), 40);
    expect(t3.launch.sparkUntil).toBeGreaterThan(t3.tick);
    tick(t3, still, shot(0, 1));
    expect(t3.launch.sparkUntil).toBe(-1);
  });

  it("Bell: every dust bunny and token in the room is dazed for 36 ticks, at most once every 240 ticks", () => {
    const s = lit({ 1: "bell" });
    standAt(s, 180, 150);
    const a = put(s, "bunny", 60, 400);
    const b = put(s, "bunny", 320, 120);
    const c = put(s, "token", 60, 100, { vx: 0, vy: 150 });
    // One still announced is not in the room yet: it is not dazed.
    const d = put(s, "bunny", 320, 400, { landTick: 500 });
    const events = fire(s, still, shot(0, -1), 1);
    events.push(...toLanding(s, still));
    const bell = of(events, "cushion")[0];
    expect(bell).toMatchObject({ plate: 1, charm: "bell" });
    const until1 = bell.tick + 36;
    expect(of(events, "daze").map((e) => [e.id, e.until])).toEqual([
      [a.id, until1],
      [b.id, until1],
      [c.id, until1],
    ]);
    expect(d.dazedUntil).toBe(0);
    // Again inside 240 ticks: it does not ring.
    const again = fire(s, still, shot(0, -1), 1);
    again.push(...until(s, still, (e) => e.some((x) => x.type === "cushion"), 60));
    expect(of(again, "cushion")[0]).toMatchObject({ plate: 1, charm: "" });
    expect(of(again, "daze")).toEqual([]);
    expect([still.bellDazeTicks, still.bellCooldown, still.capBell]).toEqual([36, 240, 1]);
  });

  it("Coin slot: pops by his body and by Spark's ring pay twice for the rest of the launch; two slots are still twice", () => {
    /** One launch straight up, and a dust bunny on his way down that lands after he has passed it going up. */
    const once = (plates: Record<number, WallCharm>) => {
      const s = lit(plates);
      standAt(s, 180, 150);
      put(s, "bunny", 180, 200);
      const events = fire(s, still, shot(0, -1), 1);
      events.push(...toLanding(s, still));
      return of(events, "pop");
    };
    expect(once({}).map((p) => [p.coin, p.points])).toEqual([[1, 20]]);
    expect(once({ 1: "coin" }).map((p) => [p.coin, p.points])).toEqual([[2, 40]]);
    // A pop by Spark's ring pays twice too: Spark and Coin slot in the top left corner (plates 9 and 0), one bounce off both,
    // and a dust bunny 27 u off his way back out, beyond his body's reach and inside the ring's.
    const ring = lit({ 9: "spark", 0: "coin" });
    standAt(ring, 100, 100);
    const off = 27 / Math.SQRT2;
    const aside = put(ring, "bunny", 21 + 100 + off, 21 + 100 - off);
    const back = fire(ring, still, shot(-1, -1), 1);
    back.push(...toLanding(ring, still));
    expect(of(back, "cushion").map((e) => [e.plate, e.charm])).toEqual([
      [9, "spark"],
      [0, "coin"],
    ]);
    const [byRing] = of(back, "pop");
    expect([byRing.id, byRing.source, byRing.coin]).toEqual([aside.id, "spark", 2]);
    // Two Coin slots in one launch, the two of the top right corner: still two times.
    const s = lit({ 1: "coin", 2: "coin" });
    standAt(s, 250, 100);
    put(s, "bunny", 207, 164);
    const events = fire(s, still, shot(1, -1), 1);
    events.push(...toLanding(s, still));
    const coined = of(events, "cushion").filter((e) => e.charm === "coin");
    expect(coined.map((e) => e.plate)).toEqual([1, 2]);
    const pop = of(events, "pop")[0];
    // The two cushions came within 9 ticks of each other: one cushion for the score.
    expect(pop).toMatchObject({ coin: 2, chain: 1, cushions: 2, points: 10 * 2 * 2 });
    expect(DEFAULT_TUNE.coinFactor).toBe(2);
  });
});

describe("the offer, as it is made", () => {
  /** An empty room at 19:00 at pace 2: clear at last call, tick 456, and the offer opens there. */
  const made = (seed: number, start: StartOptions): { s: State; open: Extract<SimEvent, { type: "offerOpen" }> | null; events: SimEvent[] } => {
    const s = night(DEFAULT_TUNE, start, seed);
    const events = run(s, DEFAULT_TUNE, 457);
    return { s, open: of(events, "offerOpen")[0] ?? null, events };
  };

  /** A random build: some plates lit (caps ignored, so the corner and cap rules are tested hard), some body charms taken. */
  function build(k: number): StartOptions {
    let st = (k * 2654435761) >>> 0;
    const r = () => {
      st = (Math.imul(st, 1664525) + 1013904223) >>> 0;
      return st / 4294967296;
    };
    const plates = DARK_PLATES.slice();
    for (let p = 0; p < PLATES; p++) if (r() < 0.4) plates[p] = WALL_CHARMS[Math.floor(r() * WALL_CHARMS.length)];
    const charms = BODY_CHARMS.filter(() => r() < 0.4);
    return { plates, charms };
  }

  it("opens on the tick the hour is clear, in an empty room, and is never more than one", () => {
    const { s, open, events } = made(1, {});
    expect(of(events, "clear")[0].tick).toBe(456);
    expect(open!.tick).toBe(456);
    expect(of(events, "offerOpen")).toHaveLength(1);
    expect([s.night.offerTick, s.night.settledTick, s.offer.open, s.offer.openTick]).toEqual([456, -1, true, 456]);
    // What it holds: two plates and a pickup, as items and as tiles in the room.
    expect(open!.items.map((i) => i.kind)).toEqual(["plate", "plate", "pickup"]);
    const tiles = s.things.filter((d) => d.kind === "pickup");
    expect(tiles.map((d) => d.id)).toEqual(open!.items.filter((i) => i.kind === "pickup").map((i) => i.thingId));
    // A tile is no intruder: it does not count for clear, the cap, or a threat, and hurts nothing.
    expect(KINDS.pickup).toMatchObject({ boxW: 36, boxH: 36, hurts: false, clear: false, intruder: false });
  });

  it("is made within the caps and the corner rule, from dark plates and body charms he has not taken", () => {
    let offers = 0;
    let twice = 0;
    for (let k = 0; k < 400; k++) {
      const start = build(k);
      const { s, open } = made(k + 1, start);
      const platesBefore = start.plates!;
      const taken = start.charms!;
      const wallLeft = WALL_CHARMS.filter((c) => platesBefore.filter((p) => p === c).length < capOf(c, DEFAULT_TUNE));
      const darkLeft = platesBefore.filter((p) => p === DARK).length;
      const bodyLeft = BODY_CHARMS.filter((c) => !taken.includes(c));
      if (!open) {
        // Nothing at all could be offered: settled the moment it would have opened.
        expect(bodyLeft).toEqual([]);
        expect(s.night.settledTick).toBe(456);
        continue;
      }
      offers++;
      const plates = open.items.filter((i) => i.kind === "plate");
      const pickups = open.items.filter((i) => i.kind === "pickup");
      expect(plates.length).toBeLessThanOrEqual(2);
      for (const p of plates) {
        expect(platesBefore[p.plate]).toBe(DARK);
        const mate = CORNER_MATE[p.plate];
        if (mate >= 0 && p.charm === "pip") expect(platesBefore[mate]).not.toBe("bumper");
        if (mate >= 0 && p.charm === "bumper") expect(platesBefore[mate]).not.toBe("pip");
        const already = platesBefore.filter((c) => c === p.charm).length;
        const asked = plates.filter((q) => q.charm === p.charm).length;
        expect(already + asked).toBeLessThanOrEqual(capOf(p.charm as WallCharm, DEFAULT_TUNE));
      }
      if (plates.length === 2) {
        expect(plates[0].plate).not.toBe(plates[1].plate);
        if (plates[0].charm === plates[1].charm) twice++;
      }
      // The pickups: body charms not taken, each once; three when no plate could be offered, one otherwise.
      for (const p of pickups) expect(taken).not.toContain(p.charm);
      expect(new Set(pickups.map((p) => p.charm)).size).toBe(pickups.length);
      expect(pickups.length).toBe(Math.min(plates.length === 0 ? 3 : 1, bodyLeft.length));
      // A plate could have been offered whenever one is: with no wall charm left, or no dark plate, there is none.
      if (wallLeft.length === 0 || darkLeft === 0) expect(plates).toEqual([]);
      // Every tile on the floor, 40 u inside every cushion.
      for (const p of pickups) {
        const d = s.things.find((t) => t.id === p.thingId)!;
        expect(d.x).toBeGreaterThanOrEqual(48);
        expect(d.x).toBeLessThanOrEqual(312);
        expect(d.y).toBeGreaterThanOrEqual(48);
        expect(d.y).toBeLessThanOrEqual(432);
      }
    }
    expect(offers).toBeGreaterThan(300);
    // The second slot goes to the same charm only when nothing else can fill it; in random builds that happens, rarely.
    expect(twice).toBeLessThan(offers / 10);
  });

  it("the same charm twice only when no other can fill the slot and it has two copies left", () => {
    // Every wall charm at its cap but Spark: both plates offered are Spark.
    const full = ["bumper", "bumper", DARK, DARK, "pip", "pip", "bell", "coin", "coin", DARK];
    const { open } = made(3, { plates: full });
    expect(open!.items.filter((i) => i.kind === "plate").map((i) => i.charm)).toEqual(["spark", "spark"]);
    // With one Spark already lit, one copy is left: one plate, and its pickup.
    const one = full.slice();
    one[2] = "spark";
    const o2 = made(3, { plates: one }).open!;
    expect(o2.items.map((i) => [i.kind, i.charm === "spark" || i.kind === "pickup"])).toEqual([
      ["plate", true],
      ["pickup", true],
    ]);
  });

  it("the corner rule: Pip is never offered beside a Bumper plate, nor Bumper beside a Pip plate", () => {
    // Only Pip has copies left, and the only dark plates share a corner with a Bumper plate: nothing on the plates.
    const plates = ["bumper", DARK, "bumper", "spark", "spark", "bell", "coin", "coin", DARK, DARK];
    // Dark: 1 (beside 2, Bumper), 8 (no corner), 9 (beside 0, Bumper). Pip may use 8 only.
    for (let seed = 1; seed < 40; seed++) {
      const o = made(seed, { plates }).open!;
      const p = o.items.filter((i) => i.kind === "plate");
      expect(p.every((i) => i.charm === "pip" && i.plate === 8)).toBe(true);
    }
  });

  it("three body charms on the floor when no plate can be offered; plates alone when no body charm is left; none at all, settled at once", () => {
    const all = ["bumper", "bumper", "pip", "pip", "spark", "spark", "bell", "coin", "coin", "bumper"];
    const three = made(5, { plates: all }).open!;
    expect(three.items.map((i) => i.kind)).toEqual(["pickup", "pickup", "pickup"]);
    const two = made(5, { plates: all, charms: ["heavy", "wide", "longBurn"] }).open!;
    expect(two.items.map((i) => i.kind)).toEqual(["pickup", "pickup"]);
    const platesOnly = made(5, { charms: [...BODY_CHARMS] }).open!;
    expect(platesOnly.items.map((i) => i.kind)).toEqual(["plate", "plate"]);
    const nothing = made(5, { plates: all, charms: [...BODY_CHARMS] });
    expect(nothing.open).toBeNull();
    expect([nothing.s.night.offerTick, nothing.s.night.settledTick]).toEqual([456, 456]);
    // Settled and clear: the next hour starts 180 ticks later.
    const ev = run(nothing.s, DEFAULT_TUNE, 181);
    expect(of(ev, "hour")).toEqual([{ type: "hour", tick: 636, hour: 1 }]);
  });

  it("each pickup lies 80 u from him or more, 110 u from the others and 100 u from every offered plate's insert", () => {
    let checked = 0;
    for (let seed = 1; seed < 200; seed++) {
      const { s, open } = made(seed, { plates: ["bumper", "bumper", "pip", "pip", "spark", "spark", "bell", "coin", "coin", "bumper"] });
      const tiles = open!.items.map((i) => s.things.find((d) => d.id === i.thingId)!);
      expect(tiles).toHaveLength(3);
      for (const [i, d] of tiles.entries()) {
        expect(Math.hypot(d.x - s.him.x, d.y - s.him.y)).toBeGreaterThanOrEqual(80);
        for (const e of tiles.slice(i + 1)) expect(Math.hypot(d.x - e.x, d.y - e.y)).toBeGreaterThanOrEqual(110);
        checked++;
      }
    }
    for (let seed = 1; seed < 200; seed++) {
      const { s, open } = made(seed, {});
      const plates = open!.items.filter((i) => i.kind === "plate");
      const d = s.things.find((t) => t.kind === "pickup")!;
      for (const p of plates) {
        const c = insertCentre(s, p.plate);
        expect(Math.hypot(d.x - c.x, d.y - c.y)).toBeGreaterThanOrEqual(100);
      }
      expect(Math.hypot(d.x - s.him.x, d.y - s.him.y)).toBeGreaterThanOrEqual(80);
      checked++;
    }
    expect(checked).toBeGreaterThan(700);
    // The insert is 36 u, 4 u inside the rail, in front of the plate's middle.
    const s = night(DEFAULT_TUNE);
    expect(insertCentre(s, 0)).toEqual({ x: 94, y: 30 });
    expect(insertCentre(s, 5)).toEqual({ x: 266, y: 450 });
    expect(insertCentre(s, 3)).toEqual({ x: 330, y: 240 });
    expect(insertCentre(s, 9).x).toBe(30);
  });

  it("draws from the offers stream and from no other", () => {
    const s = night(DEFAULT_TUNE, {}, 7);
    run(s, DEFAULT_TUNE, 456);
    const before = { ...s.rng };
    const ev = run(s, DEFAULT_TUNE, 1);
    expect(of(ev, "offerOpen")).toHaveLength(1);
    expect(s.rng.offers).not.toBe(before.offers);
    expect([s.rng.arrivals, s.rng.behaviour]).toEqual([before.arrivals, before.behaviour]);
  });

  it("opens at tick 1,320 in a room that is not clear, among what is there", () => {
    const tune = tuned({ pace: 1, bunnySpeed: 0, tokenSpeed: 0 });
    const s = createState(1, tune, { hour: 6 });
    s.phase = "night";
    const events = run(s, tune, 1321);
    const open = of(events, "offerOpen");
    expect(open.map((e) => e.tick)).toEqual([1320]);
    expect(s.night.clearTick).toBe(-1);
    expect(s.things.filter((d) => d.kind !== "pickup").length).toBeGreaterThan(5);
  });
});

describe("the offer, as it is taken", () => {
  /** An empty room, the offer made by hand and armed: nothing offered by the night itself. */
  const room = (plates: Record<number, WallCharm> = {}) => {
    const s = lit(plates, still, { offers: true });
    // A tick has passed, so an offer can have armed before the next one.
    run(s, still, 2);
    return s;
  };

  it("arms on the tick it opens if he is landed then; a launch released on that tick is not armed, one on the next is", () => {
    const s = night(DEFAULT_TUNE, {}, 2);
    const ev = run(s, DEFAULT_TUNE, 457);
    expect(of(ev, "offerOpen").map((e) => e.tick)).toEqual([456]);
    expect(of(ev, "offerArmed")).toEqual([{ type: "offerArmed", tick: 456 }]);
    tick(s, DEFAULT_TUNE, shot(1, 0, 0.5));
    expect(s.launch.armed).toBe(true);
    // Released on the tick it opens: the launch comes before the night's part of the tick, so it is not armed
    // (and with him flying, the offer arms later).
    const t = night(DEFAULT_TUNE, {}, 2);
    run(t, DEFAULT_TUNE, 456);
    const at = tick(t, DEFAULT_TUNE, shot(1, 0, 0.5));
    expect(of(at, "offerOpen")).toHaveLength(1);
    expect(t.launch.armed).toBe(false);
  });

  it("arms at the first tick he is landed from opening on, or 60 ticks after it opened, whichever comes first", () => {
    // In flight when it opens: armed on the tick after he lands.
    const a = night(DEFAULT_TUNE, {}, 2);
    run(a, DEFAULT_TUNE, 440);
    const ev = [...tick(a, DEFAULT_TUNE, shot(1, 0)), ...run(a, DEFAULT_TUNE, 100)];
    const landTick = of(ev, "land")[0].tick;
    expect(landTick).toBeGreaterThan(456);
    expect(landTick).toBeLessThan(456 + 59);
    expect(of(ev, "offerArmed")).toEqual([{ type: "offerArmed", tick: landTick + 1 }]);
    // Kept in flight past it (Bumpers at full launch speed on both sides): armed 60 ticks after it opened, in flight.
    const full = tuned({ bumperSpeed: 1 });
    const b = night(full, { plates: platesWith({ 3: "bumper", 8: "bumper" }) }, 2);
    run(b, full, 450);
    standAt(b, 180, 240);
    const ev2 = [...tick(b, full, shot(1, 0)), ...run(b, full, 66)];
    expect(of(ev2, "offerArmed")).toEqual([{ type: "offerArmed", tick: 456 + 60 }]);
    expect(b.him.hot).toBe(true);
    // A launch released on that tick, still in flight, is not armed: the launch comes before the night's part of the tick.
    const c = night(full, { plates: platesWith({ 3: "bumper", 8: "bumper" }) }, 2);
    run(c, full, 450);
    standAt(c, 180, 240);
    tick(c, full, shot(1, 0));
    run(c, full, 456 + 60 - c.tick);
    const relaunch = tick(c, full, shot(-1, 0));
    expect(of(relaunch, "offerArmed")).toEqual([{ type: "offerArmed", tick: 516 }]);
    expect(c.launch.armed).toBe(false);
    expect(of(relaunch, "offerTaken")).toEqual([]);
    expect(DEFAULT_TUNE.offerArmTicks).toBe(60);
  });

  it("a pickup is taken when an armed launch's circle overlaps its tile, at any speed; the rest of the offer goes away", () => {
    const s = room();
    const items = offerOut(s, [
      { kind: "plate", charm: "spark", plate: 2 },
      { kind: "pickup", charm: "heavy", at: [180, 250] },
    ]);
    const events = fire(s, still, shot(0, -1), 1);
    events.push(...toLanding(s, still));
    const taken = of(events, "offerTaken");
    expect(taken).toHaveLength(1);
    expect(taken[0]).toMatchObject({ item: 1, kind: "pickup", charm: "heavy", plate: -1 });
    expect(taken[0].items).toEqual(items);
    expect(s.charms).toEqual(["heavy"]);
    expect(s.stats.popImpulse).toBeCloseTo(0.55 * 0.7, 12);
    expect(s.launch.took).toBe(true);
    // Settled: the offer is over, the tile has left the room, and the plate it offered stays dark.
    expect(s.offer.open).toBe(false);
    expect(s.things.filter((d) => d.kind === "pickup")).toEqual([]);
    expect(s.night.settledTick).toBe(taken[0].tick);
    expect(s.plates[2].charm).toBe(DARK);
    // He is not slowed by it: he lands where he lands without it.
    const twin = room();
    fire(twin, still, shot(0, -1), s.tick - twin.tick);
    expect([s.him.x, s.him.y]).toEqual([twin.him.x, twin.him.y]);
  });

  it("the tick he lands is part of the launch: a tile he is set down on is taken", () => {
    const s = room();
    tick(s, still, shot(0, -1, 0.5));
    offerOut(s, [{ kind: "pickup", charm: "wide", at: [s.him.x + 20, s.him.y] }]);
    s.launch.armed = true;
    const events: SimEvent[] = [];
    land(s, still, events);
    expect(events.map((e) => e.type)).toEqual(["offerTaken", "land", "launchEnd"]);
    expect(s.charms).toEqual(["wide"]);
  });

  it("not a tile he was on when the launch was released, until he has left it", () => {
    const s = room({ 1: "bumper" });
    standAt(s, 180, 300);
    offerOut(s, [{ kind: "pickup", charm: "longBurn", at: [180, 300] }]);
    const events = fire(s, still, shot(0, -1), 1);
    expect(s.launch.blocked).toHaveLength(1);
    events.push(...toLanding(s, still));
    // He left it going up, came back down off the Bumper, and took it on the way back.
    const bounce = of(events, "cushion")[0].tick;
    const taken = of(events, "offerTaken");
    expect(taken).toHaveLength(1);
    expect(taken[0].tick).toBeGreaterThan(bounce);
    // A launch that only leaves it takes nothing.
    const t = room();
    standAt(t, 180, 300);
    offerOut(t, [{ kind: "pickup", charm: "longBurn", at: [180, 300] }]);
    const ev = fire(t, still, shot(0, -1, 0.5), 1);
    ev.push(...toLanding(t, still));
    expect(of(ev, "offerTaken")).toEqual([]);
    expect(t.offer.open).toBe(true);
  });

  it("an offered plate is taken when it is an armed launch's first cushion, and fires on that same bounce", () => {
    const s = room();
    offerOut(s, [
      { kind: "plate", charm: "bumper", plate: 1 },
      { kind: "plate", charm: "spark", plate: 6 },
      { kind: "pickup", charm: "thickSkin", at: [60, 300] },
    ]);
    const events = fire(s, still, shot(0, -1), 1);
    events.push(...until(s, still, (e) => e.some((x) => x.type === "cushion"), 40));
    // The take comes first, then the plate fires, then the cushion event.
    const kinds = events.filter((e) => e.type === "offerTaken" || e.type === "cushion").map((e) => e.type);
    expect(kinds).toEqual(["offerTaken", "cushion"]);
    expect(of(events, "offerTaken")[0]).toMatchObject({ item: 0, kind: "plate", charm: "bumper", plate: 1 });
    expect(of(events, "cushion")[0]).toMatchObject({ plate: 1, charm: "bumper" });
    expect(s.plates[1]).toEqual({ charm: "bumper", readyTick: 0 });
    expect(speedOf(s)).toBeCloseTo(dragged(still, 720), 9);
    expect(s.things.filter((d) => d.kind === "pickup")).toEqual([]);
  });

  it("if his first cushion is anything else the plates are out of reach for that launch; the pickups are not", () => {
    const s = room();
    standAt(s, 300, 240);
    offerOut(s, [{ kind: "plate", charm: "coin", plate: 8 }]);
    const events = fire(s, still, shot(1, 0), 1);
    events.push(...toLanding(s, still));
    const c = of(events, "cushion").map((e) => e.plate);
    expect(c.slice(0, 2)).toEqual([3, 8]);
    expect(of(events, "offerTaken")).toEqual([]);
    expect(s.plates[8].charm).toBe(DARK);
    expect(s.offer.open).toBe(true);
    // A pickup after a first cushion that offers nothing is still in reach.
    const t = room();
    standAt(t, 300, 240);
    offerOut(t, [
      { kind: "plate", charm: "coin", plate: 8 },
      { kind: "pickup", charm: "heavy", at: [120, 240] },
    ]);
    const ev = fire(t, still, shot(1, 0), 1);
    ev.push(...toLanding(t, still));
    expect(of(ev, "offerTaken").map((e) => e.charm)).toEqual(["heavy"]);
  });

  it("a launch takes one thing at most, and only an armed launch takes", () => {
    const s = room();
    offerOut(s, [
      { kind: "plate", charm: "bell", plate: 1 },
      { kind: "pickup", charm: "heavy", at: [180, 250] },
    ]);
    const events = fire(s, still, shot(0, -1), 1);
    events.push(...toLanding(s, still));
    expect(of(events, "offerTaken").map((e) => e.charm)).toEqual(["heavy"]);
    // The plate it bounced off next was no longer offered.
    expect(s.plates[1].charm).toBe(DARK);
    // Not armed: the same launch takes nothing.
    const t = room();
    offerOut(t, [{ kind: "pickup", charm: "heavy", at: [180, 250] }]);
    t.offer.armedTick = t.tick;
    const ev = fire(t, still, shot(0, -1), 1);
    ev.push(...toLanding(t, still));
    expect(of(ev, "offerTaken")).toEqual([]);
    expect(t.launch.armed).toBe(false);
  });

  it("with Fourth pip, a lost heart fills four pips, and the pip timer brings them back to four", () => {
    const walk = tuned({ bunnySpeed: 22 });
    const s = night(walk, { charms: ["fourthPip"], plates: DARK_PLATES, offers: false });
    s.pips = 1;
    put(s, "bunny", s.him.x + 30, s.him.y);
    const hurt = until(s, walk, (e) => e.some((x) => x.type === "hurt"), 200);
    expect(of(hurt, "hurt")).toHaveLength(1);
    expect(s.pips).toBe(4);
    const t = night(still, { charms: ["fourthPip"], plates: DARK_PLATES, offers: false });
    t.pips = 2;
    t.pipTimer = still.pipRefillTicks;
    const back = run(t, still, 2 * still.pipRefillTicks + 1);
    expect(of(back, "pip").filter((e) => e.why === "timer")).toHaveLength(2);
    expect(t.pips).toBe(4);
  });

  it("Fourth pip and Thick skin apply at once: the new pip filled, one heart healed", () => {
    const s = room();
    s.hearts = 2;
    offerOut(s, [{ kind: "pickup", charm: "fourthPip", at: [180, 250] }]);
    fire(s, still, shot(0, -1), 30);
    expect([s.stats.pipMax, s.pips]).toEqual([4, 3]);
    const t = room();
    t.hearts = 2;
    offerOut(t, [{ kind: "pickup", charm: "thickSkin", at: [180, 250] }]);
    fire(t, still, shot(0, -1), 30);
    expect([t.stats.maxHearts, t.hearts]).toEqual([4, 3]);
  });

  it("settled, the next hour starts 180 ticks after the hour is clear and settled; untaken, the next hour closes it", () => {
    // Taken: 180 ticks after the take.
    const s = night(DEFAULT_TUNE, {}, 4);
    run(s, DEFAULT_TUNE, 470);
    const item = s.offer.items.findIndex((i) => i.kind === "pickup");
    const tile = s.things.find((d) => d.id === s.offer.items[item].thingId)!;
    const events = fire(s, DEFAULT_TUNE, shot(tile.x - s.him.x, tile.y - s.him.y), 1);
    events.push(...until(s, DEFAULT_TUNE, (e) => e.some((x) => x.type === "offerTaken"), 100));
    const took = of(events, "offerTaken")[0].tick;
    const after = run(s, DEFAULT_TUNE, 200);
    expect(of(after, "hour")[0].tick).toBe(took + 180);
    // Not taken: the hour runs to tick 1,800, and the offer is closed and lost when the next one starts.
    const t = night(DEFAULT_TUNE, {}, 4);
    const ev = run(t, DEFAULT_TUNE, 1801);
    expect(of(ev, "hour")).toEqual([{ type: "hour", tick: 1800, hour: 1 }]);
    const closed = of(ev, "offerClosed");
    expect(closed).toHaveLength(1);
    expect(closed[0].tick).toBe(1800);
    expect(t.offer).toEqual({ open: false, openTick: -1, armedTick: -1, items: [] });
    expect(t.things.filter((d) => d.kind === "pickup")).toEqual([]);
    // With offers off the same hour is settled at once.
    const u = night(DEFAULT_TUNE, { offers: false }, 4);
    expect(of(run(u, DEFAULT_TUNE, 637), "hour")).toEqual([{ type: "hour", tick: 636, hour: 1 }]);
  });

  it("the offer of 05:00 is closed when the night ends", () => {
    const s = night(DEFAULT_TUNE, { hour: 10 }, 4);
    const ev = run(s, DEFAULT_TUNE, 1802);
    expect(s.ended).toBe("morning");
    expect(of(ev, "offerClosed")).toHaveLength(1);
    expect(ev[ev.length - 1].type).toBe("over");
  });

  it("the start options: plates by number, a name that is no wall charm dark; offers off", () => {
    const s = createState(1, DEFAULT_TUNE, { plates: ["spark", "nonsense", DARK, "heavy"], offers: false });
    expect(s.plates.map((p) => p.charm)).toEqual(["spark", DARK, DARK, DARK, DARK, DARK, DARK, DARK, DARK, DARK]);
    expect(s.night.offers).toBe(false);
    expect(createState(1, DEFAULT_TUNE).night.offers).toBe(true);
  });
});

describe("names, lines and icons (§6.4)", () => {
  const all = [...WALL_CHARMS, ...BODY_CHARMS];

  it("every charm has a name and one line of at most 27 characters", () => {
    for (const c of all) {
      expect(CHARM_NAME[c], c).toMatch(/^[A-Z ]+$/);
      expect(CHARM_LINE[c].length, c).toBeLessThanOrEqual(27);
    }
    expect(CHARM_LINE.coin).toBe("bounce off: pops pay double");
    expect(CHARM_LINE.bumper).toBe("bounce off: fast again");
    // The lead's decision 17: the game never shows the word "weapon".
    expect(CHARM_LINE.spark).toBe("bounce off: pops reach wide");
    expect(CHARM_LINE.longBurn).toBe("stays fast for longer");
    for (const c of all) expect(CHARM_LINE[c], c).not.toMatch(/weapon/i);
  });

  it("every icon is 12 rows of 12, one empty cell all round, and no two are alike", () => {
    const seen = new Set<string>();
    for (const c of all) {
      const rows = CHARM_ICON[c];
      expect(rows, c).toHaveLength(12);
      for (const row of rows) expect(row, c).toMatch(/^[.X]{12}$/);
      expect(rows[0], c).toBe("............");
      expect(rows[11], c).toBe("............");
      expect(rows.every((row) => row[0] === "." && row[11] === "."), c).toBe(true);
      expect(rows.join("").includes("X"), c).toBe(true);
      seen.add(rows.join("/"));
    }
    expect(seen.size).toBe(all.length);
  });
});
