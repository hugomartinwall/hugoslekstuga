import { describe, expect, it } from "vitest";
import { DEFAULT_TUNE } from "../../lib/knuff/content/tune";
import { cloneState, createState, hashState } from "../../lib/knuff/sim/state";
import { step } from "../../lib/knuff/sim/step";
import type { Input, SimEvent, State } from "../../lib/knuff/sim/types";

/**
 * The State is plain data, copied and fingerprinted by one generic walk.
 * These checks walk it generically too, so a field added in a later step
 * is covered without anyone adding it here.
 */

/** A scripted player: a launch every 20 to 70 ticks, any direction, holding a pull for a while before each. */
function scripted(scriptSeed: number): (s: State) => Input {
  let state = scriptSeed >>> 0;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  let wait = 0;
  return () => {
    const pullHeld = wait < 10;
    if (wait > 0) {
      wait--;
      return { launch: null, pullHeld };
    }
    wait = 20 + Math.floor(next() * 51);
    const a = next() * Math.PI * 2;
    return { launch: { dx: Math.cos(a), dy: Math.sin(a), power: 0.5 + 0.5 * next() }, pullHeld };
  };
}

/** A State a night passes through by itself: he is flying, one heart down, with pips and meter spent, tokens about and something announced. */
function busy(s: State): boolean {
  return (
    s.phase === "night" &&
    s.him.hot &&
    s.hearts < DEFAULT_TUNE.hearts &&
    s.pips < DEFAULT_TUNE.pipMax &&
    s.slow.meter < DEFAULT_TUNE.slowMeterMax &&
    s.launch.pops > 0 &&
    s.night.hour >= 1 &&
    s.things.some((d) => s.tick < d.landTick) &&
    s.things.some((d) => d.kind === "token" && s.tick >= d.landTick) &&
    s.things.filter((d) => d.kind === "bunny" && s.tick >= d.landTick && (d.wx !== 0 || d.wy !== 0)).length >= 3
  );
}

/**
 * A State from the middle of a night, with something of everything in it.
 * Scripted nights are played until one passes through a busy tick; what a
 * night seldom holds all at once is then set by hand: a dazed dust bunny,
 * one sliding from a shove, and a thing he overlapped at the release.
 */
function midNight(): State {
  for (let script = 1; script <= 40; script++) {
    const s = createState(20261111, DEFAULT_TUNE);
    const input = scripted(script);
    const events: SimEvent[] = [];
    for (let t = 0; t < 6000 && s.phase !== "over"; t++) {
      step(s, input(s), DEFAULT_TUNE, events);
      if (!busy(s)) continue;
      const bunnies = s.things.filter((d) => d.kind === "bunny" && s.tick >= d.landTick);
      bunnies[0].dazedUntil = s.tick + 20;
      bunnies[1].vx = 120;
      bunnies[1].vy = -45;
      s.launch.blocked.push(bunnies[2].id);
      return s;
    }
  }
  throw new Error("no scripted night passed through a busy State");
}

type Path = (string | number)[];

/** Every number, boolean and string in a value, with the path to it. */
function leaves(v: unknown, path: Path = []): { path: Path; value: number | boolean | string }[] {
  if (Array.isArray(v)) return v.flatMap((item, i) => leaves(item, [...path, i]));
  if (v !== null && typeof v === "object") {
    return Object.entries(v as Record<string, unknown>).flatMap(([k, item]) => leaves(item, [...path, k]));
  }
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "string") return [{ path, value: v }];
  throw new Error(`${path.join(".")} holds ${String(v)}: not a number, a boolean or a string`);
}

/** Every object and list in a value, with the path to it. */
function containers(v: unknown, path: Path = []): { path: Path; value: object }[] {
  if (Array.isArray(v)) return [{ path, value: v }, ...v.flatMap((item, i) => containers(item, [...path, i]))];
  if (v !== null && typeof v === "object") {
    return [
      { path, value: v },
      ...Object.entries(v as Record<string, unknown>).flatMap(([k, item]) => containers(item, [...path, k])),
    ];
  }
  return [];
}

function at(root: unknown, path: Path): unknown {
  let v = root;
  for (const key of path) v = (v as Record<string | number, unknown>)[key];
  return v;
}

function set(root: unknown, path: Path, value: unknown): void {
  const parent = at(root, path.slice(0, -1)) as Record<string | number, unknown>;
  parent[path[path.length - 1]] = value;
}

describe("the State", () => {
  const state = midNight();

  it("the mid-night State has something of everything in it", () => {
    expect(busy(state)).toBe(true);
    expect(state.things.some((d) => state.tick < d.dazedUntil)).toBe(true);
    expect(state.things.some((d) => d.kind === "bunny" && d.vx !== 0)).toBe(true);
    expect(state.him.invulnUntil).toBeGreaterThan(0);
    expect(state.tick).toBeGreaterThan(600);
    expect(state.score).toBeGreaterThan(0);
    expect(state.bestShot).toBeGreaterThan(0);
    expect(state.lastHurtBy).not.toBe("");
    expect(state.launch.blocked).toHaveLength(1);
    expect(state.night.kinds).toEqual(["bunny", "token", "polisher"]);
  });

  it("is plain data: numbers, booleans and strings, with no undefined and no Infinity", () => {
    const all = leaves(state);
    expect(all.length).toBeGreaterThan(120);
    for (const { path, value } of all) {
      if (typeof value === "number") {
        expect(Number.isFinite(value), `${path.join(".")} is ${value}`).toBe(true);
      }
    }
    // No class anywhere: every container is a plain object or a plain list.
    for (const { path, value } of containers(state)) {
      const proto = Object.getPrototypeOf(value);
      expect(proto === Object.prototype || proto === Array.prototype, path.join(".")).toBe(true);
    }
  });

  it("changing any one field changes the fingerprint", () => {
    const before = hashState(state);
    const all = leaves(state);
    for (const { path, value } of all) {
      const changed = cloneState(state);
      set(changed, path, typeof value === "number" ? value + 1 : typeof value === "boolean" ? !value : `${value}x`);
      expect(hashState(changed), `changing ${path.join(".")} went unseen`).not.toBe(before);
    }
    // And the smallest step the fingerprint promises to see: 1/1024.
    for (const { path, value } of all) {
      if (typeof value !== "number") continue;
      const changed = cloneState(state);
      set(changed, path, value + 1 / 1024);
      expect(hashState(changed), `a 1/1024 change of ${path.join(".")} went unseen`).not.toBe(before);
    }
  });

  it("a list that grows or shrinks changes the fingerprint", () => {
    const before = hashState(state);
    const shorter = cloneState(state);
    shorter.things.pop();
    expect(hashState(shorter)).not.toBe(before);
    const longer = cloneState(state);
    longer.things.push({ ...longer.things[0] });
    expect(hashState(longer)).not.toBe(before);
  });

  it("the fingerprint is about the simulation, not the last bits of a float", () => {
    const nudged = cloneState(state);
    nudged.him.x += 1e-9;
    expect(hashState(nudged)).toBe(hashState(state));
  });

  it("a copy has the same fingerprint and shares no object with the original", () => {
    const copy = cloneState(state);
    expect(hashState(copy)).toBe(hashState(state));
    expect(copy).toEqual(state);
    const originals = containers(state);
    expect(originals.length).toBeGreaterThan(8);
    for (const { path, value } of originals) {
      expect(at(copy, path), `${path.join(".") || "the State itself"} is shared`).not.toBe(value);
    }
  });

  it("survives JSON.parse(JSON.stringify())", () => {
    const revived = JSON.parse(JSON.stringify(state)) as State;
    expect(revived).toEqual(state);
    expect(hashState(revived)).toBe(hashState(state));
    // And it still plays: the revived State and the original go on alike.
    const a = cloneState(state);
    const events: SimEvent[] = [];
    for (let t = 0; t < 300; t++) {
      const input = { launch: t === 10 ? { dx: -0.5, dy: -1, power: 1 } : null, pullHeld: false };
      step(a, input, DEFAULT_TUNE, events);
      step(revived, input, DEFAULT_TUNE, events);
    }
    expect(hashState(revived)).toBe(hashState(a));
    expect(revived).toEqual(a);
  });

  it("no number in it is ever a negative zero: every tick of a night survives JSON", () => {
    // Slowing multiplies a speed by zero, and a negative speed times zero is
    // a negative zero, which JSON writes as a plain one: the stored State
    // would not be the State that was stored. A night is played through,
    // with dust bunnies thrown by the wave sliding to rest, and every
    // number of every tick is looked at.
    const s = createState(20261111, DEFAULT_TUNE);
    const input = scripted(3);
    const events: SimEvent[] = [];
    const negativeZero = (v: unknown, path: string): string => {
      if (typeof v === "number") return Object.is(v, -0) ? path : "";
      if (v !== null && typeof v === "object") {
        for (const [k, item] of Object.entries(v as Record<string, unknown>)) {
          const hit = negativeZero(item, `${path}.${k}`);
          if (hit) return hit;
        }
      }
      return "";
    };
    let slidToRest = 0;
    let revived = 0;
    for (let t = 0; t < 20000 && s.phase !== "over"; t++) {
      const sliding = s.things.filter((d) => d.kind === "bunny" && (d.vx !== 0 || d.vy !== 0)).map((d) => d.id);
      step(s, input(s), DEFAULT_TUNE, events);
      slidToRest += s.things.filter((d) => sliding.includes(d.id) && d.vx === 0 && d.vy === 0).length;
      const hit = negativeZero(s, "state");
      if (hit) expect.fail(`${hit} is a negative zero at tick ${s.tick}`);
      if (t % 211 === 0) {
        const back = JSON.parse(JSON.stringify(s)) as State;
        expect(back).toEqual(s);
        expect(hashState(back)).toBe(hashState(s));
        revived++;
      }
    }
    expect(s.phase).toBe("over");
    expect(slidToRest).toBeGreaterThan(0);
    expect(revived).toBeGreaterThan(5);
    // A launch straight along an axis gives him a speed of exactly zero the other way, with either sign.
    const still = createState(1, DEFAULT_TUNE, { empty: true });
    step(still, { launch: { dx: -0, dy: -1, power: 1 }, pullHeld: false }, DEFAULT_TUNE, events);
    expect(Object.is(still.him.vx, -0)).toBe(false);
  });

  it("a field under another name is another State", () => {
    // The fingerprint is of names and values together: the same numbers
    // under a renamed field must not pass for the same State (a stored run
    // from a build that called things otherwise).
    const before = hashState(state);
    const renamed = cloneState(state) as unknown as { him: Record<string, unknown> };
    // The new name sorts where the old one did, so the values are walked in
    // the same order: only the name can tell the two apart.
    renamed.him.vx2 = renamed.him.vx;
    delete renamed.him.vx;
    expect(Object.keys(renamed.him).sort().indexOf("vx2")).toBe(Object.keys(state.him).sort().indexOf("vx"));
    expect(hashState(renamed as unknown as State)).not.toBe(before);
    // Two values that change places are seen as well.
    const swapped = cloneState(state);
    [swapped.him.x, swapped.him.y] = [swapped.him.y, swapped.him.x];
    expect(hashState(swapped)).not.toBe(before);
  });

  it("the fingerprint does not depend on the order the keys were written in", () => {
    const reversed = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(reversed);
      if (v !== null && typeof v === "object") {
        return Object.fromEntries(
          Object.entries(v as Record<string, unknown>)
            .reverse()
            .map(([k, item]) => [k, reversed(item)]),
        );
      }
      return v;
    };
    const other = reversed(state) as State;
    expect(Object.keys(other)).not.toEqual(Object.keys(state));
    expect(hashState(other)).toBe(hashState(state));
  });

  it("a fresh State is the same State every time, and a new seed is a new one", () => {
    expect(createState(5, DEFAULT_TUNE)).toEqual(createState(5, DEFAULT_TUNE));
    expect(hashState(createState(5, DEFAULT_TUNE))).toBe(hashState(createState(5, DEFAULT_TUNE)));
    expect(hashState(createState(6, DEFAULT_TUNE))).not.toBe(hashState(createState(5, DEFAULT_TUNE)));
  });

  it("a fresh State is the start screen: the rack in place, everything full, nothing moving", () => {
    const s = createState(5, DEFAULT_TUNE);
    expect(s.v).toBe(1);
    expect(s.phase).toBe("waiting");
    expect(s.ended).toBe("");
    expect([s.tick, s.normalTicks, s.slowedTicks]).toEqual([0, 0, 0]);
    expect(s.hearts).toBe(3);
    expect(s.pips).toBe(3);
    expect(s.slow).toEqual({ meter: 16, refill: 0 });
    expect(s.him).toEqual({ x: 180, y: 374, px: 180, py: 374, vx: 0, vy: 0, hot: false, lastContactTick: -1, invulnUntil: 0 });
    expect(s.launch.id).toBe(0);
    expect(s.launch.active).toBe(false);
    expect(s.night).toEqual({
      hour: 0,
      hourStart: 0,
      kinds: ["bunny", "token", "polisher"],
      nextRow: 0,
      rowTick: -1,
      rowLandTick: -1,
      holdFrom: -1,
      holdTo: -1,
      clearTick: -1,
      offerTick: -1,
      settledTick: -1,
      offers: true,
    });
    expect([s.score, s.bestShot, s.lastHurtBy, s.lastHurtHour]).toEqual([0, 0, "", -1]);
    // The polisher is not in the room until 06:00.
    expect(s.boss.present).toBe(false);
    expect([s.boss.hp, s.boss.speed, s.boss.beganTick, s.boss.lastHitTick]).toEqual([6, DEFAULT_TUNE.bossSpeed, -1, -1]);
    // Two plates lit from the start: Bumper on plate 0, Pip on plate 4. No charm taken, no offer out.
    expect(s.plates.map((p) => p.charm)).toEqual(["bumper", "", "", "", "pip", "", "", "", "", ""]);
    expect(s.plates.every((p) => p.readyTick === 0)).toBe(true);
    expect(s.charms).toEqual([]);
    expect(s.stats).toEqual({ radius: 13, hotSpeed: 0.33 * 900, popImpulse: 0.55, pipMax: 3, maxHearts: 3 });
    expect(s.offer).toEqual({ open: false, openTick: -1, armedTick: -1, items: [] });
    // The 19:00 rack: rows of 1, 2 and then the one that is left, centred; apex at (180, 163), toward him.
    expect(s.things.map((d) => [d.kind, d.x, d.y, d.landTick, d.hp])).toEqual([
      ["bunny", 180, 163, -1, 1],
      ["bunny", 171, 147, -1, 1],
      ["bunny", 189, 147, -1, 1],
      ["bunny", 180, 131, -1, 1],
    ]);
    expect(s.nextId).toBe(5);
    // Nothing in the room moves until the first launch: without one the tick does not advance.
    const before = hashState(s);
    const events: SimEvent[] = [];
    for (let t = 0; t < 500; t++) step(s, { launch: null, pullHeld: t % 2 === 0 }, DEFAULT_TUNE, events);
    expect(hashState(s)).toBe(before);
    expect(events).toEqual([]);
  });
});
