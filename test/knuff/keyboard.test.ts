import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_TUNE } from "../../lib/knuff/content/tune";
import { createKnuff, type KnuffHandle, type KnuffView } from "../../lib/knuff/game";
import {
  HELD_TAIL_MS,
  TAP_DEG,
  TURN_FAST_DEG_S,
  TURN_SLOW_DEG_S,
  TURN_SLOW_MS,
  createKeys,
  keyRole,
  pointOrder,
  turnedBy,
  type Keys,
} from "../../lib/knuff/input/keyboard";
import { addThing } from "../../lib/knuff/sim/night";
import { createState } from "../../lib/knuff/sim/state";
import { step } from "../../lib/knuff/sim/step";
import type { Launch, State } from "../../lib/knuff/sim/types";
import { FONTS, MemoryStorage, installBrowser, pull, type Browser } from "./browser";

/**
 * The keys (§4.3): aim, point, launch, with no pointer at all. The first
 * part holds the keys' own rules against a State; the second makes the
 * whole game in a stand-in for the browser and plays it on the keys.
 */

const press = (k: Keys, code: string, now: number, repeat = false) => k.down({ code, repeat }, now);

/** An empty room with him at the start, after one launch, landed: things placed by hand. */
function room(): State {
  const s = createState(3, DEFAULT_TUNE, { empty: true });
  step(s, { launch: { dx: 0, dy: -1, power: 0.5 }, pullHeld: false }, DEFAULT_TUNE, []);
  for (let i = 0; i < 400 && (s.him.hot || s.launch.active); i++) step(s, { launch: null, pullHeld: false }, DEFAULT_TUNE, []);
  return s;
}

function keysOn(s: State, launches: Launch[] = [], enabled = () => true): Keys {
  return createKeys({ state: () => s, enabled, onLaunch: (l) => launches.push(l) });
}

describe("which key does what", () => {
  it("reads keys by their place: arrows and A, D, W; Space and Enter launch", () => {
    expect(["ArrowLeft", "KeyA"].map(keyRole)).toEqual(["left", "left"]);
    expect(["ArrowRight", "KeyD"].map(keyRole)).toEqual(["right", "right"]);
    expect(["ArrowUp", "KeyW"].map(keyRole)).toEqual(["point", "point"]);
    expect(["Space", "Enter", "NumpadEnter"].map(keyRole)).toEqual(["launch", "launch", "launch"]);
    // Esc, P and M are the game's own; the rest are nobody's.
    expect(["Escape", "KeyP", "KeyM", "ArrowDown", "KeyS", "Slash", "KeyK"].map(keyRole)).toEqual([null, null, null, null, null, null, null]);
  });
});

describe("turning the aim", () => {
  it("a tap turns 3 degrees; held, 150 a second for 150 ms and 420 after", () => {
    expect(TAP_DEG).toBe(3);
    expect([TURN_SLOW_DEG_S, TURN_SLOW_MS, TURN_FAST_DEG_S]).toEqual([150, 150, 420]);
    expect(turnedBy(0)).toBe(3);
    expect(turnedBy(10)).toBe(3);
    expect(turnedBy(100)).toBeCloseTo(15, 9);
    expect(turnedBy(150)).toBeCloseTo(22.5, 9);
    expect(turnedBy(1150)).toBeCloseTo(22.5 + 420, 9);
  });

  it("starts straight up; Left turns it left and Right right, as held", () => {
    const s = room();
    const launches: Launch[] = [];
    const k = keysOn(s, launches);
    expect(k.deg).toBe(0);
    press(k, "ArrowLeft", 1000);
    k.up({ code: "ArrowLeft" }, 1000);
    expect(k.deg).toBeCloseTo(-3, 9);
    press(k, "KeyD", 2000);
    k.frame(2050);
    k.frame(2100);
    k.up({ code: "KeyD" }, 2100);
    expect(k.deg).toBeCloseTo(-3 + 15, 9);
    // Held for a second and a bit: the fast turn after 150 ms.
    press(k, "ArrowRight", 3000);
    for (let t = 3000; t <= 4150; t += 16) k.frame(t);
    k.frame(4150);
    k.up({ code: "ArrowRight" }, 4150);
    expect(k.deg).toBeCloseTo(normal(12 + 22.5 + 420), 6);
    // The system's own key repeat is not a tap.
    const before = k.deg;
    press(k, "ArrowLeft", 5000);
    press(k, "ArrowLeft", 5010, true);
    press(k, "ArrowLeft", 5020, true);
    k.up({ code: "ArrowLeft" }, 5020);
    expect(k.deg).toBeCloseTo(normal(before - 3), 9);
  });

  it("the aim is the direction of the launch, at full power", () => {
    const s = room();
    const launches: Launch[] = [];
    const k = keysOn(s, launches);
    press(k, "Space", 1000);
    press(k, "ArrowRight", 2000);
    k.frame(2000 + 150 + (67.5 / 420) * 1000);
    k.up({ code: "ArrowRight" }, 2000 + 150 + (67.5 / 420) * 1000);
    expect(k.deg).toBeCloseTo(90, 6);
    press(k, "Enter", 3000);
    expect(launches).toHaveLength(2);
    expect(launches[0].dx).toBeCloseTo(0, 9);
    expect(launches[0].dy).toBeCloseTo(-1, 9);
    expect(launches[0].power).toBe(1);
    expect(launches[1].dx).toBeCloseTo(1, 6);
    expect(launches[1].dy).toBeCloseTo(0, 6);
    expect(launches[1].power).toBe(1);
  });

  it("one press is one launch: a held Space spends one pip, not three", () => {
    const launches: Launch[] = [];
    const k = keysOn(room(), launches);
    press(k, "Space", 1000);
    press(k, "Space", 1030, true);
    press(k, "Space", 1060, true);
    expect(launches).toHaveLength(1);
  });

  it("does nothing while the game takes no launch", () => {
    const launches: Launch[] = [];
    let on = false;
    const k = keysOn(room(), launches, () => on);
    expect(press(k, "Space", 1000)).toBe(true);
    press(k, "ArrowLeft", 1000);
    expect(launches).toHaveLength(0);
    expect(k.deg).toBe(0);
    expect(k.aim()).toBeNull();
    on = true;
    press(k, "Space", 1100);
    expect(launches).toHaveLength(1);
  });
});

describe("pointing", () => {
  it("Up points at the nearest intruder, and again at the next nearest; the order starts again after a launch", () => {
    const s = room();
    const hx = s.him.x;
    const hy = s.him.y;
    const far = addThing(s, "bunny", hx + 100, hy - 100, s.tick, 0, 0);
    const near = addThing(s, "token", hx, hy - 60, s.tick, 0, 0);
    const mid = addThing(s, "bunny", hx - 80, hy, s.tick, 0, 0);
    // An offered thing and the love heart are not intruders; something announced is not in the room yet.
    addThing(s, "heart", hx + 30, hy, s.tick, 0, 0);
    addThing(s, "bunny", hx + 20, hy + 20, s.tick + 30, 0, 0);
    expect(pointOrder(s).map((t) => (t.kind === "thing" ? t.id : -1))).toEqual([near.id, mid.id, far.id]);
    const k = keysOn(s);
    press(k, "ArrowUp", 1000);
    expect(k.deg).toBeCloseTo(0, 9);
    press(k, "KeyW", 1100);
    expect(k.deg).toBeCloseTo(-90, 9);
    press(k, "ArrowUp", 1200);
    expect(k.deg).toBeCloseTo(45, 9);
    press(k, "ArrowUp", 1300);
    expect(k.deg).toBeCloseTo(0, 9);
    // The order was worked out at the first press: a thing that comes nearer since does not jump the queue...
    near.x = hx + 200;
    press(k, "ArrowUp", 1400);
    expect(k.deg).toBeCloseTo(-90, 9);
    // ...until a launch, after which it is worked out again.
    s.launch.id++;
    mid.x = hx - 300;
    press(k, "ArrowUp", 1500);
    expect(k.deg).toBeCloseTo(45, 9);
  });

  it("with no intruder in the room it steps through the offered things", () => {
    const s = room();
    const tile = addThing(s, "pickup", s.him.x + 50, s.him.y, s.tick, 0, 0);
    s.offer.open = true;
    s.offer.items = [
      { kind: "pickup", charm: "wide", plate: -1, thingId: tile.id },
      { kind: "plate", charm: "bell", plate: 0, thingId: -1 },
    ];
    const order = pointOrder(s);
    expect(order[0]).toEqual({ kind: "thing", id: tile.id });
    expect(order[1]).toEqual({ kind: "plate", plate: 0 });
    const k = keysOn(s);
    press(k, "ArrowUp", 1000);
    expect(k.deg).toBeCloseTo(90, 9);
    press(k, "ArrowUp", 1100);
    // Plate 0 is the top cushion's left half: up and to the left of him.
    expect(k.deg).toBeLessThan(0);
    expect(k.deg).toBeGreaterThan(-90);
    // An intruder in the room comes first, once the order is worked out again.
    addThing(s, "bunny", s.him.x, s.him.y + 40, s.tick, 0, 0);
    s.launch.id++;
    press(k, "ArrowUp", 1200);
    expect(Math.abs(k.deg)).toBeCloseTo(180, 9);
  });
});

describe("held, and the line", () => {
  it("is held while an aim key is down and for 300 ms after it comes up; Space alone holds nothing", () => {
    const k = keysOn(room());
    expect(HELD_TAIL_MS).toBe(300);
    press(k, "Space", 900);
    expect(k.held(900)).toBe(false);
    press(k, "ArrowLeft", 1000);
    expect(k.held(1000)).toBe(true);
    expect(k.held(5000)).toBe(true);
    k.up({ code: "ArrowLeft" }, 5000);
    expect(k.held(5299)).toBe(true);
    expect(k.held(5300)).toBe(false);
    press(k, "ArrowUp", 6000);
    k.up({ code: "ArrowUp" }, 6010);
    expect(k.held(6200)).toBe(true);
    expect(k.held(6400)).toBe(false);
  });

  it("the line shows once an aim key is used, and goes at a touch or mouse press", () => {
    const k = keysOn(room());
    expect(k.aim()).toBeNull();
    press(k, "Space", 1000);
    expect(k.aim()).toBeNull();
    press(k, "ArrowRight", 1100);
    k.up({ code: "ArrowRight" }, 1100);
    expect(k.aim()).not.toBeNull();
    expect(k.aim()?.dx).toBeCloseTo(Math.sin((3 * Math.PI) / 180), 9);
    k.pressed();
    expect(k.aim()).toBeNull();
  });
});

function normal(deg: number): number {
  return ((deg % 360) + 540) % 360 - 180;
}

// ── The whole game, on the keys ────────────────────────────────────────

describe("a night on the keys alone", () => {
  let b: Browser | null = null;
  let game: KnuffHandle | null = null;
  let views: KnuffView[] = [];
  afterEach(() => {
    game?.destroy();
    game = null;
    b?.restore();
    b = null;
    views = [];
  });
  const open = () => {
    b = installBrowser({ coarse: false, w: 1440, h: 900, local: new MemoryStorage(), session: new MemoryStorage() });
    views = [];
    game = createKnuff(b.root as unknown as HTMLElement, b.canvas, { fonts: FONTS, onChange: (v) => views.push(v) });
    return { b: b as Browser, game: game as KnuffHandle };
  };
  const view = () => views[views.length - 1];
  const tap = (br: Browser, key: string, code: string, opts: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean } = {}) => {
    const down = br.key("keydown", { key, code, ...opts });
    br.key("keyup", { key, code, ...opts }, br.win);
    return down;
  };

  it("Space starts the night; the arrows, Up and Enter play it; Escape pauses", () => {
    const { b: br } = open();
    br.frames(3);
    expect(view().screen).toBe("start");
    const space = tap(br, " ", "Space");
    expect(space.defaultPrevented).toBe(true);
    br.frames(2);
    expect(view().screen).toBe("play");
    br.frames(120);
    tap(br, "ArrowUp", "ArrowUp");
    tap(br, "ArrowLeft", "ArrowLeft");
    tap(br, "Enter", "Enter");
    br.frames(60);
    tap(br, "w", "KeyW");
    tap(br, " ", "Space");
    br.frames(60);
    const esc = br.key("keydown", { key: "Escape", code: "Escape" });
    expect(esc.defaultPrevented).toBe(false);
    expect(view().screen).toBe("paused");
  });

  it("a key pressed with Ctrl, Cmd or Alt is left alone, and so is / (the site's search)", () => {
    const { b: br } = open();
    br.frames(3);
    for (const mod of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
      const e = tap(br, " ", "Space", mod);
      expect(e.defaultPrevented).toBe(false);
    }
    const slash = tap(br, "/", "Slash");
    expect(slash.defaultPrevented).toBe(false);
    br.frames(3);
    expect(view().screen).toBe("start");
  });

  it("an aim key held slows the room as a held pull does, and a pull's press hides the keys' line", () => {
    const { b: br } = open();
    br.frames(3);
    tap(br, " ", "Space");
    br.frames(2);
    // Hold Left: the keys hold a pull until 300 ms after it comes up.
    br.key("keydown", { key: "ArrowLeft", code: "ArrowLeft" });
    br.frames(10);
    br.key("keyup", { key: "ArrowLeft", code: "ArrowLeft" }, br.win);
    br.frames(1);
    // A press on the root is a touch or a mouse: the keys' line goes, and a pull can be made.
    pull(br, 700, 600, 0, 90, "mouse");
    br.frames(30);
    expect(view().screen).toBe("play");
  });
});
