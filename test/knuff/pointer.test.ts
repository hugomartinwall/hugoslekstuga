import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as toy from "../fixtures/knuff/toy-sim";
import { DEFAULT_TUNE, TOY_SETTINGS } from "../../lib/knuff/content/tune";
import {
  EDGE_STRIP_PX,
  attachPointer,
  powerForPull,
  releaseVector,
  type PointerHandle,
  type Sample,
} from "../../lib/knuff/input/pointer";
import type { Launch, Tune } from "../../lib/knuff/sim/types";

/**
 * The pull, rule by rule (§4.1 of the spec), with no browser: a stand-in
 * for the root that remembers its listeners, and events that are plain
 * objects. What the browser adds on top (real touches, capture, the
 * system taking a touch away) is checked in Chromium through the play
 * harness.
 */

type Listener = (e: FakeEvent) => void;
type FakeEvent = {
  type: string;
  pointerId: number;
  pointerType: string;
  isPrimary: boolean;
  button: number;
  buttons: number;
  clientX: number;
  clientY: number;
  defaultPrevented: boolean;
  preventDefault(): void;
};

class FakeRoot {
  readonly listeners = new Map<string, Set<Listener>>();
  readonly captured = new Set<number>();
  added = 0;
  removed = 0;
  rect = { left: 0, top: 0, right: 390, bottom: 664 };

  addEventListener(type: string, fn: Listener): void {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(fn);
    this.added++;
  }
  removeEventListener(type: string, fn: Listener): void {
    if (this.listeners.get(type)?.delete(fn)) this.removed++;
  }
  setPointerCapture(id: number): void {
    this.captured.add(id);
  }
  releasePointerCapture(id: number): void {
    // As a browser does: releasing what is not held throws.
    if (!this.captured.delete(id)) throw new Error("NotFoundError");
  }
  getBoundingClientRect() {
    return this.rect;
  }
  live(): number {
    let n = 0;
    for (const set of this.listeners.values()) n += set.size;
    return n;
  }
  fire(type: string, init: Partial<FakeEvent> = {}): FakeEvent {
    const e: FakeEvent = {
      type,
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
      button: 0,
      buttons: 1,
      clientX: 0,
      clientY: 0,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      ...init,
    };
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn(e);
    return e;
  }
}

type Rig = {
  root: FakeRoot;
  handle: PointerHandle;
  launches: Launch[];
  presses: { n: number };
  state: { tune: Tune; enabled: boolean };
  /** Move the clock on, ms. */
  wait(ms: number): void;
  down(x: number, y: number, init?: Partial<FakeEvent>): FakeEvent;
  move(x: number, y: number, init?: Partial<FakeEvent>): FakeEvent;
  up(x: number, y: number, init?: Partial<FakeEvent>): FakeEvent;
};

let clock = 0;

function rig(tune: Partial<Tune> = {}): Rig {
  const root = new FakeRoot();
  const launches: Launch[] = [];
  const presses = { n: 0 };
  const state = { tune: { ...DEFAULT_TUNE, ...tune }, enabled: true };
  const handle = attachPointer(root as unknown as HTMLElement, {
    tune: () => state.tune,
    enabled: () => state.enabled,
    onLaunch: (l) => launches.push(l),
    onPress: () => presses.n++,
  });
  return {
    root,
    handle,
    launches,
    presses,
    state,
    wait: (ms) => {
      clock += ms;
    },
    down: (x, y, init) => root.fire("pointerdown", { clientX: x, clientY: y, ...init }),
    move: (x, y, init) => root.fire("pointermove", { clientX: x, clientY: y, ...init }),
    up: (x, y, init) => root.fire("pointerup", { clientX: x, clientY: y, buttons: 0, ...init }),
  };
}

/** A steady drag from (x0, y0) to (x1, y1): one move every 16 ms, fast enough that the lift-off filter stays out of it. */
function drag(r: Rig, x0: number, y0: number, x1: number, y1: number, init?: Partial<FakeEvent>): void {
  r.down(x0, y0, init);
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    r.wait(16);
    r.move(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps, init);
  }
}

beforeEach(() => {
  clock = 1000;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the pull: what is a shot", () => {
  it("pull back and let go: one launch, pointing away from the pull", () => {
    const r = rig();
    drag(r, 200, 500, 200, 580);
    r.wait(16);
    r.up(200, 580);
    expect(r.launches).toHaveLength(1);
    const l = r.launches[0];
    expect(l.dx).toBeCloseTo(0, 9);
    expect(l.dy).toBe(-80);
    expect(l.power).toBe(powerForPull(80, DEFAULT_TUNE));
    expect(r.handle.pull()).toBeNull();
  });

  it("push: the launch points the way of the pull", () => {
    const r = rig({ pullDir: "push" });
    drag(r, 200, 500, 260, 500);
    r.wait(16);
    r.up(260, 500);
    expect(r.launches).toHaveLength(1);
    expect(r.launches[0].dx).toBe(60);
    expect(r.launches[0].dy).toBeCloseTo(0, 9);
  });

  it("a pull may begin anywhere on the root: in the deck under the room too", () => {
    const r = rig();
    // The room ends at y 528 on a 390 × 664 phone; this pull begins at 600.
    drag(r, 195, 600, 195, 655);
    r.wait(16);
    r.up(195, 655);
    expect(r.launches).toHaveLength(1);
    expect(r.launches[0].dy).toBe(-55);
  });

  it("a touch that never becomes a pull does nothing", () => {
    const r = rig();
    r.down(200, 500);
    expect(r.handle.pull()?.aim).toBeNull();
    r.wait(200);
    r.up(200, 500);
    expect(r.launches).toEqual([]);
  });

  it("a touch becomes a pull when it has moved lineShowsPx, not before", () => {
    const r = rig();
    r.down(200, 500);
    r.wait(16);
    r.move(200, 500 + DEFAULT_TUNE.lineShowsPx - 0.5);
    expect(r.handle.pull()?.aim).toBeNull();
    r.wait(16);
    r.move(200, 500 + DEFAULT_TUNE.lineShowsPx);
    const aim = r.handle.pull()?.aim;
    expect(aim).toBeTruthy();
    expect(aim?.lengthPx).toBe(DEFAULT_TUNE.lineShowsPx);
  });

  it("a pull released shorter than noShotPx is a cancel: no shot", () => {
    const r = rig();
    // Held still before the lift, so the lift-off filter fires from where the thumb is.
    const short = DEFAULT_TUNE.noShotPx - 1;
    drag(r, 200, 500, 200, 500 + short);
    r.wait(100);
    r.up(200, 500 + short);
    expect(r.launches).toEqual([]);
    // And one exactly at the line is a shot, at minimum power.
    drag(r, 200, 500, 200, 500 + DEFAULT_TUNE.noShotPx);
    r.wait(100);
    r.up(200, 500 + DEFAULT_TUNE.noShotPx);
    expect(r.launches).toHaveLength(1);
    expect(r.launches[0].power).toBe(DEFAULT_TUNE.minPower);
  });

  it("between lineShowsPx and noShotPx the aim is marked short, at minimum power", () => {
    // The game's own numbers (from step 1): the line shows at 12 px, a shot needs 24.
    const r = rig({ lineShowsPx: 12, noShotPx: 24, minPower: 0.5 });
    drag(r, 200, 500, 200, 518);
    const aim = r.handle.pull()?.aim;
    expect(aim?.short).toBe(true);
    expect(aim?.launch.power).toBe(0.5);
    r.wait(100);
    r.up(200, 518);
    expect(r.launches).toEqual([]);
    drag(r, 200, 500, 200, 524);
    expect(r.handle.pull()?.aim?.short).toBe(false);
    r.wait(100);
    r.up(200, 524);
    expect(r.launches).toHaveLength(1);
    expect(r.launches[0].power).toBe(0.5);
  });

  it("a pull brought back to where it began is no shot", () => {
    const r = rig();
    drag(r, 200, 500, 200, 580);
    for (let i = 1; i <= 8; i++) {
      r.wait(16);
      r.move(200, 580 - i * 10);
    }
    r.wait(16);
    r.up(200, 500);
    expect(r.launches).toEqual([]);
  });

  it("every press is reported, pull or not", () => {
    const r = rig();
    r.down(200, 500);
    r.up(200, 500);
    r.down(5, 500); // in the edge strip: not a pull, still a press
    r.up(5, 500);
    expect(r.presses.n).toBe(2);
  });
});

describe("the pull: other fingers", () => {
  it("while a pull is held a second finger is ignored", () => {
    const r = rig();
    drag(r, 200, 500, 200, 580);
    const before = r.handle.pull();
    r.down(100, 300, { pointerId: 2, isPrimary: false });
    r.wait(16);
    r.move(100, 400, { pointerId: 2, isPrimary: false });
    expect(r.handle.pull()).toEqual(before);
    r.wait(16);
    r.up(100, 400, { pointerId: 2, isPrimary: false });
    expect(r.launches).toEqual([]);
    expect(r.handle.pull()).toEqual(before);
    // The first finger still fires its own pull.
    r.wait(16);
    r.up(200, 580);
    expect(r.launches).toHaveLength(1);
    expect(r.launches[0].dy).toBe(-80);
  });

  it("a second finger that outlives the pull does not become one", () => {
    const r = rig();
    drag(r, 200, 500, 200, 580);
    r.down(100, 300, { pointerId: 2, isPrimary: false });
    r.wait(16);
    r.up(200, 580);
    expect(r.launches).toHaveLength(1);
    // The second finger is still down and moves: it was never a pull and does not turn into one.
    r.wait(16);
    r.move(100, 420, { pointerId: 2, isPrimary: false });
    expect(r.handle.pull()).toBeNull();
    r.wait(16);
    r.up(100, 420, { pointerId: 2, isPrimary: false });
    expect(r.launches).toHaveLength(1);
  });

  it("a finger that is down but is not yet a pull is replaced by the next one", () => {
    const r = rig();
    r.down(200, 500);
    r.wait(16);
    r.move(200, 505);
    drag(r, 100, 300, 100, 380, { pointerId: 2, isPrimary: false });
    expect(r.handle.pull()?.x0).toBe(100);
    // The first finger's later moves and its lift mean nothing now.
    r.wait(16);
    r.move(200, 600);
    r.up(200, 600);
    expect(r.launches).toEqual([]);
    r.wait(16);
    r.up(100, 380, { pointerId: 2, isPrimary: false });
    expect(r.launches).toHaveLength(1);
    expect(r.launches[0].dy).toBe(-80);
  });
});

describe("the pull: what is never a shot", () => {
  it("a touch the system takes away is a cancel", () => {
    const r = rig();
    drag(r, 200, 500, 200, 580);
    r.root.fire("pointercancel", { clientX: 200, clientY: 580 });
    expect(r.handle.pull()).toBeNull();
    // Whatever arrives afterwards for that pointer fires nothing.
    r.wait(16);
    r.move(200, 600);
    r.up(200, 600);
    expect(r.launches).toEqual([]);
    // And the next pull works.
    drag(r, 200, 500, 200, 560);
    r.wait(16);
    r.up(200, 560);
    expect(r.launches).toHaveLength(1);
  });

  it("a touch within 20 px of the left or right edge is the browser's", () => {
    const r = rig();
    expect(EDGE_STRIP_PX).toBe(20);
    for (const x of [0, 19, 371, 389]) {
      drag(r, x, 500, 200, 580);
      expect(r.handle.pull()).toBeNull();
      r.wait(16);
      r.up(200, 580);
    }
    expect(r.launches).toEqual([]);
    // 20 px in, it is a pull.
    drag(r, 20, 500, 20, 580);
    r.wait(16);
    r.up(20, 580);
    expect(r.launches).toHaveLength(1);
  });

  it("the edge strip is not for a mouse", () => {
    const r = rig();
    const mouse = { pointerType: "mouse" };
    drag(r, 3, 500, 3, 580, mouse);
    r.wait(16);
    r.up(3, 580, mouse);
    expect(r.launches).toHaveLength(1);
  });

  it("a mouse pulls with its left button only", () => {
    const r = rig();
    drag(r, 200, 500, 200, 580, { pointerType: "mouse", button: 2, buttons: 2 });
    expect(r.handle.pull()).toBeNull();
    r.up(200, 580, { pointerType: "mouse", button: 2 });
    drag(r, 200, 500, 200, 580, { pointerType: "mouse", button: 1, buttons: 4 });
    r.up(200, 580, { pointerType: "mouse", button: 1 });
    expect(r.launches).toEqual([]);
  });

  it("a right-click during a mouse pull is a cancel, and the button coming up fires nothing", () => {
    const r = rig();
    const mouse = { pointerType: "mouse" };
    drag(r, 200, 500, 200, 580, mouse);
    const menu = r.root.fire("contextmenu");
    expect(menu.defaultPrevented).toBe(true);
    expect(r.handle.pull()).toBeNull();
    // The left button is still down and the mouse moves on: no new pull.
    r.wait(16);
    r.move(200, 620, mouse);
    expect(r.handle.pull()).toBeNull();
    r.up(200, 620, mouse);
    expect(r.launches).toEqual([]);
  });

  it("a long press under a thumb is not a cancel", () => {
    const r = rig();
    drag(r, 200, 500, 200, 580);
    const menu = r.root.fire("contextmenu");
    expect(menu.defaultPrevented).toBe(true);
    expect(r.handle.pull()).not.toBeNull();
    r.wait(16);
    r.up(200, 580);
    expect(r.launches).toHaveLength(1);
  });

  it("a mouse that moves with its button up was let go where the page did not hear: no shot", () => {
    const r = rig();
    const mouse = { pointerType: "mouse" };
    drag(r, 200, 500, 200, 580, mouse);
    r.wait(16);
    r.move(200, 590, { pointerType: "mouse", buttons: 0 });
    expect(r.handle.pull()).toBeNull();
    expect(r.root.captured.size).toBe(0);
    expect(r.launches).toEqual([]);
  });

  it("cancel() drops the pull, and the pointer stays out until it comes up", () => {
    const r = rig();
    drag(r, 200, 500, 200, 580);
    r.handle.cancel();
    expect(r.handle.pull()).toBeNull();
    r.wait(16);
    r.move(200, 620);
    expect(r.handle.pull()).toBeNull();
    r.up(200, 620);
    expect(r.launches).toEqual([]);
    drag(r, 200, 500, 200, 560);
    r.wait(16);
    r.up(200, 560);
    expect(r.launches).toHaveLength(1);
  });

  it("while the game is not taking pulls a press begins nothing, and a held pull fires nothing", () => {
    const r = rig();
    r.state.enabled = false;
    drag(r, 200, 500, 200, 580);
    expect(r.handle.pull()).toBeNull();
    r.up(200, 580);
    r.state.enabled = true;
    drag(r, 200, 500, 200, 580);
    r.state.enabled = false;
    r.wait(16);
    r.up(200, 580);
    expect(r.launches).toEqual([]);
  });
});

describe("the pull: a pointer first heard as a move", () => {
  it("with a finger down and no press before it, it is taken up from that spot", () => {
    const r = rig();
    // No pointerdown: a sheet over the page took it.
    r.move(200, 500);
    expect(r.handle.pull()?.x0).toBe(200);
    expect(r.handle.pull()?.aim).toBeNull();
    expect(r.presses.n).toBe(1);
    for (let i = 1; i <= 8; i++) {
      r.wait(16);
      r.move(200, 500 + i * 10);
    }
    r.wait(16);
    r.up(200, 580);
    expect(r.launches).toHaveLength(1);
    expect(r.launches[0].dy).toBe(-80);
  });

  it("a hover is not a pull", () => {
    const r = rig();
    r.move(200, 500, { pointerType: "mouse", buttons: 0 });
    r.move(200, 580, { pointerType: "mouse", buttons: 0 });
    expect(r.handle.pull()).toBeNull();
    expect(r.presses.n).toBe(0);
  });

  it("the edge strip holds for it too", () => {
    const r = rig();
    r.move(4, 500);
    r.wait(16);
    r.move(100, 560);
    expect(r.handle.pull()).toBeNull();
  });
});

describe("the pull: leaving", () => {
  it("detach takes every listener away and lets go of the pointer, even in the middle of a pull", () => {
    const r = rig();
    expect(r.root.live()).toBeGreaterThanOrEqual(5);
    drag(r, 200, 500, 200, 580);
    expect(r.root.captured.has(1)).toBe(true);
    r.handle.detach();
    expect(r.root.live()).toBe(0);
    expect(r.root.removed).toBe(r.root.added);
    expect(r.root.captured.size).toBe(0);
    expect(r.handle.pull()).toBeNull();
    // Nothing is heard any more.
    r.up(200, 580);
    expect(r.launches).toEqual([]);
  });

  it("a pull holds the pointer, and every way out lets it go", () => {
    const r = rig();
    drag(r, 200, 500, 200, 580);
    expect(r.root.captured.has(1)).toBe(true);
    r.wait(16);
    r.up(200, 580);
    expect(r.root.captured.size).toBe(0);
    drag(r, 200, 500, 200, 580);
    r.root.fire("pointercancel");
    expect(r.root.captured.size).toBe(0);
    drag(r, 200, 500, 200, 580);
    r.handle.cancel();
    expect(r.root.captured.size).toBe(0);
  });
});

describe("the pull is the toy's pull", () => {
  /**
   * Step 0 keeps the toy's shortest shot: 35% from a 12 px pull, rising in
   * a straight line to 100% at 100 px. Step 1 moves it to the game's 50%
   * from 24 px on purpose, and this block changes with it.
   */
  const DEAD_ZONE = 12;
  const toyTune: toy.Tune = { ...toy.DEFAULT_TUNE, maxSpeed: TOY_SETTINGS.power };
  const toyPower = (lengthPx: number) => {
    const pull01 = Math.min(1, Math.max(0, (lengthPx - DEAD_ZONE) / Math.max(1, TOY_SETTINGS.pull - DEAD_ZONE)));
    return toy.powerFromPull(pull01, toyTune);
  };

  it("gives the toy's power for every pull length", () => {
    expect(DEFAULT_TUNE.noShotPx).toBe(DEAD_ZONE);
    expect(DEFAULT_TUNE.lineShowsPx).toBe(DEAD_ZONE);
    expect(DEFAULT_TUNE.minPower).toBe(toy.DEFAULT_TUNE.minPowerFrac);
    for (let px = DEAD_ZONE; px <= 220; px += 0.5) {
      expect(powerForPull(px, DEFAULT_TUNE)).toBe(toyPower(px));
    }
    expect(powerForPull(DEAD_ZONE, DEFAULT_TUNE)).toBe(0.35);
    expect(powerForPull(100, DEFAULT_TUNE)).toBe(1);
    expect(powerForPull(400, DEFAULT_TUNE)).toBe(1);
  });

  /**
   * The lift-off filter, by the toy's four numbers: look back 45 ms; a
   * move of 8 px or less in that time is a thumb at rest; one of up to
   * 24 px is still the lift if the 45 ms before it moved 4 px or less.
   */
  const pullDown = (points: [number, number][]): Sample[] => points.map(([t, y]) => ({ t, x: 100, y }));

  it("a thumb at rest that jumps as it lifts fires from where it sat", () => {
    // Held at 80 px for 200 ms, then a 20 px hop in the last 10 ms.
    const samples = pullDown([
      [0, 0],
      [100, 80],
      [200, 80],
      [290, 80],
      [300, 100],
    ]);
    const v = releaseVector(samples, 100, 0, "touch");
    expect(v.len).toBe(80);
    expect(v.dy).toBe(80);
  });

  it("a thumb that only drifts a few pixels fires from 45 ms before the lift", () => {
    const samples = pullDown([
      [0, 0],
      [100, 70],
      [250, 74],
      [300, 80],
    ]);
    expect(releaseVector(samples, 100, 0, "touch").len).toBe(74);
  });

  it("a thumb that was travelling all along fires from the lift point", () => {
    const samples = pullDown([
      [0, 0],
      [200, 20],
      [250, 50],
      [300, 80],
    ]);
    expect(releaseVector(samples, 100, 0, "touch").len).toBe(80);
  });

  it("a hop of more than 24 px is not the lift", () => {
    const samples = pullDown([
      [0, 0],
      [100, 50],
      [200, 50],
      [290, 50],
      [300, 80],
    ]);
    expect(releaseVector(samples, 100, 0, "touch").len).toBe(80);
  });

  it("a mouse always fires from where it was let go", () => {
    const samples = pullDown([
      [0, 0],
      [100, 80],
      [200, 80],
      [290, 80],
      [300, 100],
    ]);
    expect(releaseVector(samples, 100, 0, "mouse").len).toBe(100);
  });

  it("a press and lift too quick to look back fires as it is", () => {
    const samples = pullDown([
      [0, 0],
      [20, 60],
    ]);
    expect(releaseVector(samples, 100, 0, "touch").len).toBe(60);
  });

  it("the filter is on the real path: a thumb that sat still and hopped as it left fires from where it sat", () => {
    const r = rig();
    r.down(200, 500);
    for (let i = 1; i <= 8; i++) {
      r.wait(16);
      r.move(200, 500 + i * 10);
    }
    // At rest at 80 px for 300 ms, then a 20 px hop with the lift.
    for (let i = 0; i < 6; i++) {
      r.wait(50);
      r.move(200, 580);
    }
    r.wait(10);
    r.up(200, 600);
    expect(r.launches).toHaveLength(1);
    expect(r.launches[0].dy).toBe(-80);
    // The same hands on a mouse fire from where the button came up.
    const m = rig();
    const mouse = { pointerType: "mouse" };
    m.down(200, 500, mouse);
    for (let i = 1; i <= 8; i++) {
      m.wait(16);
      m.move(200, 500 + i * 10, mouse);
    }
    for (let i = 0; i < 6; i++) {
      m.wait(50);
      m.move(200, 580, mouse);
    }
    m.wait(10);
    m.up(200, 600, mouse);
    expect(m.launches[0].dy).toBe(-100);
  });
});
