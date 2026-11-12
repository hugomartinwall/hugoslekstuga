import { describe, expect, it } from "vitest";
import { DEFAULT_TUNE } from "../../lib/knuff/content/tune";
import { cloneState, createState, hashState } from "../../lib/knuff/sim/state";
import { step } from "../../lib/knuff/sim/step";
import type { SimEvent, State } from "../../lib/knuff/sim/types";

/**
 * The State is plain data, copied and fingerprinted by one generic walk.
 * These checks walk it generically too, so a field added in a later step
 * is covered without anyone adding it here.
 */

/** A State with history in it: he is in flight and hot, dummies have popped, some are back, one is still gone, one is sliding. */
function midRun(): State {
  const s = createState(20261111, DEFAULT_TUNE);
  const events: SimEvent[] = [];
  const launches: Record<number, [number, number, number]> = {
    0: [0, -1, 1],
    60: [1, -0.4, 0.9],
    130: [-1, 0.2, 1],
  };
  for (let t = 0; t < 150; t++) {
    const l = launches[t];
    step(s, { launch: l ? { dx: l[0], dy: l[1], power: l[2] } : null, pullHeld: false }, DEFAULT_TUNE, events);
  }
  return s;
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
  const state = midRun();

  it("the mid-run State has something of everything in it", () => {
    expect(state.tick).toBe(150);
    expect(state.launch.id).toBe(3);
    expect(state.him.hot).toBe(true);
    expect(state.things.some((d) => d.alive && d.bornTick > 0)).toBe(true);
    expect(state.things.some((d) => !d.alive)).toBe(true);
    expect(state.things.some((d) => d.alive && (d.vx !== 0 || d.vy !== 0))).toBe(true);
    expect(state.him.vx !== 0 || state.him.vy !== 0).toBe(true);
  });

  it("is plain data: numbers, booleans and strings, with no undefined and no Infinity", () => {
    const all = leaves(state);
    expect(all.length).toBeGreaterThan(80);
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

  it("a State at rest survives JSON too: a speed that ran down to nothing is a plain zero", () => {
    // Slowing multiplies a speed by zero, and a negative speed times zero is
    // a negative zero, which JSON writes as a plain one: the stored State
    // would not be the State that was stored. He is set down under the rack
    // and sent into it too slowly to pop anything: he and the dummies he
    // shoves all run down to rest, most of them from a negative speed.
    const s = createState(20261111, DEFAULT_TUNE);
    const rack = s.things.map((d) => [d.x, d.y]);
    s.him.x = 184;
    s.him.y = 250;
    const events: SimEvent[] = [];
    for (let t = 0; t < 500; t++) {
      step(s, { launch: t === 0 ? { dx: 0, dy: -1, power: 0.32 } : null, pullHeld: false }, DEFAULT_TUNE, events);
    }
    expect(events.some((e) => e.type === "pop")).toBe(false);
    expect(s.things.filter((d, i) => d.x !== rack[i][0] || d.y !== rack[i][1]).length).toBeGreaterThanOrEqual(3);
    expect([s.him.vx, s.him.vy]).toEqual([0, 0]);
    for (const d of s.things) expect([d.vx, d.vy]).toEqual([0, 0]);
    for (const { path, value } of leaves(s)) {
      expect(Object.is(value, -0), `${path.join(".")} is a negative zero`).toBe(false);
    }
    const revived = JSON.parse(JSON.stringify(s)) as State;
    expect(revived).toEqual(s);
    expect(hashState(revived)).toBe(hashState(s));
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
});
