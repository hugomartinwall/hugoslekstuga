import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLoop, type FrameInfo, type LoopHooks } from "../../lib/knuff/loop";

/**
 * The frame loop against a display that is not there: the two frame
 * functions are stand-ins, and a test decides when each frame comes. So
 * the things that are hard to see in a browser can be counted: how many
 * ticks a slow display gets, what a tab that was hidden is handed when it
 * comes back, and how many frames are ever asked for at once.
 */

type Display = {
  /** Frames asked for and not yet drawn or cancelled. */
  pending: Map<number, FrameRequestCallback>;
  asked: number;
  cancelled: number;
  /** Draw every pending frame at this time, ms. */
  frame(now: number): void;
};

let display: Display;

beforeEach(() => {
  let nextId = 1;
  const pending = new Map<number, FrameRequestCallback>();
  display = {
    pending,
    asked: 0,
    cancelled: 0,
    frame(now) {
      const due = [...pending.values()];
      pending.clear();
      for (const cb of due) cb(now);
    },
  };
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    const id = nextId++;
    pending.set(id, cb);
    display.asked++;
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    if (pending.delete(id)) display.cancelled++;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

type Rig = {
  hooks: LoopHooks;
  ticks: number;
  frames: FrameInfo[];
  slowed: boolean;
  queued: boolean;
  held: boolean;
  /** The freeze the next tick asks for, s. Asked once. */
  freezeNext: number;
  onTick: (() => void) | null;
  onRender: (() => void) | null;
};

function rig(): Rig {
  const r: Rig = {
    ticks: 0,
    frames: [],
    slowed: false,
    queued: false,
    held: false,
    freezeNext: 0,
    onTick: null,
    onRender: null,
    hooks: {
      slowed: () => r.slowed,
      slowShare: () => 0.2,
      launchQueued: () => r.queued,
      held: () => r.held,
      tick() {
        r.ticks++;
        r.queued = false;
        r.onTick?.();
        const freeze = r.freezeNext;
        r.freezeNext = 0;
        return freeze;
      },
      render(frame) {
        r.frames.push(frame);
        r.onRender?.();
      },
    },
  };
  return r;
}

/** Run a display at `hz` for `seconds`, starting at `from` ms. Returns the time of the last frame. */
function run(hz: number, seconds: number, from = 0): number {
  const n = Math.round(hz * seconds);
  let now = from;
  for (let i = 0; i <= n; i++) {
    now = from + (i * 1000) / hz;
    display.frame(now);
  }
  return now;
}

describe("the loop: the same game on any display", () => {
  for (const hz of [30, 50, 60, 75, 90, 120, 144, 240]) {
    it(`${hz} frames a second: 60 ticks a second`, () => {
      const r = rig();
      const loop = createLoop(r.hooks);
      loop.start();
      run(hz, 10);
      // Ten seconds are 600 ticks, give or take the part of a tick still building up.
      expect(r.ticks).toBeGreaterThanOrEqual(599);
      expect(r.ticks).toBeLessThanOrEqual(600);
      loop.stop();
    });
  }

  it("a display that draws 20 times a second still gets 60 ticks a second: three a frame", () => {
    const r = rig();
    const loop = createLoop(r.hooks);
    loop.start();
    run(20, 5);
    expect(r.ticks).toBeGreaterThanOrEqual(299);
    expect(r.ticks).toBeLessThanOrEqual(300);
  });

  it("the picture's place between two ticks stays inside 0 and 1", () => {
    const r = rig();
    const loop = createLoop(r.hooks);
    loop.start();
    run(144, 2);
    expect(r.frames.length).toBeGreaterThan(200);
    for (const f of r.frames) {
      expect(f.alpha).toBeGreaterThanOrEqual(0);
      expect(f.alpha).toBeLessThanOrEqual(1);
    }
    // And it is used: not every frame sits on a tick.
    expect(new Set(r.frames.map((f) => Math.round(f.alpha * 100))).size).toBeGreaterThan(3);
  });
});

describe("the loop: catching up is capped", () => {
  it("a frame's real time is capped at 100 ms, and at most six ticks are taken in it", () => {
    const r = rig();
    const loop = createLoop(r.hooks);
    loop.start();
    display.frame(0);
    display.frame(16);
    const before = r.ticks;
    // The display stalls for five seconds.
    display.frame(5016);
    expect(r.ticks - before).toBe(6);
    expect(r.frames[r.frames.length - 1].realDt).toBe(0.1);
    // And what was left over is dropped: the next frame is an ordinary one.
    display.frame(5032);
    expect(r.ticks - before).toBeLessThanOrEqual(7);
  });

  it("a display at ten frames a second runs at full speed, and one at five runs slow rather than bursting", () => {
    const ten = rig();
    createLoop(ten.hooks).start();
    run(10, 5);
    expect(ten.ticks).toBeGreaterThanOrEqual(294);
    expect(ten.ticks).toBeLessThanOrEqual(300);

    display.pending.clear();
    const five = rig();
    createLoop(five.hooks).start();
    run(5, 5);
    // 25 frames after the first, six ticks each.
    expect(five.ticks).toBe(150);
  });

  it("a tab that was hidden is handed none of the time it was away", () => {
    const r = rig();
    const loop = createLoop(r.hooks);
    loop.start();
    const end = run(60, 1);
    const before = r.ticks;
    loop.stop();
    expect(display.pending.size).toBe(0);
    // Ten minutes later it is shown again.
    loop.start();
    display.frame(end + 600_000);
    expect(r.ticks).toBe(before);
    expect(r.frames[r.frames.length - 1].realDt).toBe(0);
    display.frame(end + 600_016);
    expect(r.ticks - before).toBeLessThanOrEqual(1);
  });

  it("time that runs backwards takes no tick", () => {
    const r = rig();
    createLoop(r.hooks).start();
    display.frame(1000);
    display.frame(900);
    expect(r.ticks).toBe(0);
    expect(r.frames[1].realDt).toBe(0);
  });
});

describe("the loop: slow motion, the forced tick, the freeze, the hold", () => {
  it("slowed, the room runs at its share of the speed: 12 ticks a second at 20%", () => {
    const r = rig();
    createLoop(r.hooks).start();
    r.slowed = true;
    const end = run(60, 1);
    // The time scale is eased in at 14 a second: after a second it has arrived.
    const before = r.ticks;
    run(60, 10, end);
    expect(r.ticks - before).toBeGreaterThanOrEqual(119);
    expect(r.ticks - before).toBeLessThanOrEqual(121);
    // And it eases back out at 9 a second.
    r.slowed = false;
    const end2 = run(60, 1, end + 10_000);
    const again = r.ticks;
    run(60, 2, end2);
    expect(r.ticks - again).toBeGreaterThanOrEqual(119);
    expect(r.ticks - again).toBeLessThanOrEqual(121);
  });

  it("the time scale is eased, not switched: the first slowed frames still run nearly full speed", () => {
    const r = rig();
    createLoop(r.hooks).start();
    run(60, 0.5);
    r.slowed = true;
    const f0 = r.frames.length;
    run(60, 0.25, 500);
    const scales = r.frames.slice(f0 + 1).map((f) => f.scaledDt / f.realDt);
    expect(scales[0]).toBeGreaterThan(0.75);
    expect(scales[scales.length - 1]).toBeLessThan(0.25);
    for (let i = 1; i < scales.length; i++) expect(scales[i]).toBeLessThanOrEqual(scales[i - 1] + 1e-12);
  });

  it("a release fires on this frame, however slowly time is running", () => {
    const r = rig();
    createLoop(r.hooks).start();
    r.slowed = true;
    const end = run(60, 2);
    // Slowed to a fifth, a tick comes only every fifth frame...
    const quiet = r.ticks;
    display.frame(end + 16.7);
    r.queued = true;
    display.frame(end + 33.4);
    // ...but the frame after a release takes one whatever has built up.
    expect(r.ticks).toBeGreaterThanOrEqual(quiet + 1);
    expect(r.queued).toBe(false);
  });

  it("a freeze stops the ticks in mid-frame and holds the picture at the contact", () => {
    const r = rig();
    createLoop(r.hooks).start();
    display.frame(0);
    // A long frame that would take six ticks: the second one asks for a freeze.
    let n = 0;
    r.onTick = () => {
      if (++n === 2) r.freezeNext = 0.028;
    };
    display.frame(100);
    expect(r.ticks).toBe(2);
    expect(r.frames[r.frames.length - 1].alpha).toBe(1);
    expect(r.frames[r.frames.length - 1].scaledDt).toBe(0);
    r.onTick = null;
    // 28 ms of freeze: nothing steps, and he is drawn where he was hit.
    display.frame(110);
    display.frame(120);
    expect(r.ticks).toBe(2);
    expect(r.frames[r.frames.length - 1].alpha).toBe(1);
    // The freeze runs out on this frame; the room moves again on the next.
    display.frame(130);
    expect(r.ticks).toBe(2);
    expect(r.frames[r.frames.length - 1].alpha).toBe(1);
    // Then the rest of the long frame is played, as in the toy: the freeze
    // is time added, not time taken out of the game. Still six at most.
    display.frame(146.7);
    expect(r.ticks).toBeGreaterThanOrEqual(6);
    expect(r.ticks).toBeLessThanOrEqual(8);
    display.frame(163.4);
    expect(r.ticks).toBeLessThanOrEqual(9);
  });

  it("at 60 frames a second a freeze costs its own length and nothing more", () => {
    const r = rig();
    createLoop(r.hooks).start();
    const end = run(60, 1);
    expect(r.ticks).toBeGreaterThanOrEqual(59);
    // The next tick asks for 60 ms: the following frames step nothing until it has passed.
    r.freezeNext = 0.06;
    const before = r.ticks;
    run(60, 1, end);
    // One second less the 60 ms (3.6 frames; the frame it runs out on steps nothing either).
    expect(r.ticks - before).toBeGreaterThanOrEqual(55);
    expect(r.ticks - before).toBeLessThanOrEqual(57);
  });

  it("while held no tick is taken, what had built up is dropped, and a freeze ends", () => {
    const r = rig();
    createLoop(r.hooks).start();
    run(60, 0.5);
    r.freezeNext = 5;
    display.frame(600);
    const before = r.ticks;
    r.held = true;
    run(60, 1, 700);
    expect(r.ticks).toBe(before);
    // Released: the five-second freeze is gone, and no backlog arrives at once.
    r.held = false;
    display.frame(1716.7);
    display.frame(1733.4);
    expect(r.ticks - before).toBeLessThanOrEqual(2);
    expect(r.ticks - before).toBeGreaterThanOrEqual(1);
  });
});

describe("the loop: one frame at a time, and none after a stop", () => {
  it("asks for one frame at a time", () => {
    const r = rig();
    const loop = createLoop(r.hooks);
    expect(display.pending.size).toBe(0);
    loop.start();
    loop.start();
    expect(display.pending.size).toBe(1);
    for (let i = 0; i < 50; i++) {
      display.frame(i * 16.7);
      expect(display.pending.size).toBe(1);
    }
    expect(display.asked).toBe(51);
    expect(loop.running).toBe(true);
  });

  it("stop cancels the frame that was asked for, and nothing is drawn after it", () => {
    const r = rig();
    const loop = createLoop(r.hooks);
    loop.start();
    run(60, 0.2);
    const frames = r.frames.length;
    loop.stop();
    expect(display.pending.size).toBe(0);
    expect(display.cancelled).toBe(1);
    expect(loop.running).toBe(false);
    display.frame(10_000);
    expect(r.frames.length).toBe(frames);
    // Every frame asked for was either drawn or cancelled.
    expect(display.asked).toBe(frames + display.cancelled);
    // Stopping again is nothing.
    loop.stop();
    expect(display.cancelled).toBe(1);
  });

  it("stopped from inside a tick or a draw, it asks for no further frame", () => {
    for (const where of ["tick", "render"] as const) {
      display.pending.clear();
      const r = rig();
      const loop = createLoop(r.hooks);
      loop.start();
      display.frame(0);
      if (where === "tick") r.onTick = () => loop.stop();
      else r.onRender = () => loop.stop();
      display.frame(50);
      expect(display.pending.size, where).toBe(0);
      expect(loop.running, where).toBe(false);
    }
  });

  it("stopped and started again from inside a draw, there is still one frame, not two", () => {
    const r = rig();
    const loop = createLoop(r.hooks);
    loop.start();
    display.frame(0);
    r.onRender = () => {
      loop.stop();
      loop.start();
    };
    display.frame(16);
    r.onRender = null;
    expect(display.pending.size).toBe(1);
    display.frame(32);
    expect(display.pending.size).toBe(1);
  });

  it("two loops are two loops: the second mount's loop does not lean on the first's", () => {
    const a = rig();
    const first = createLoop(a.hooks);
    first.start();
    run(60, 0.1);
    first.stop();
    const b = rig();
    const second = createLoop(b.hooks);
    second.start();
    const framesA = a.frames.length;
    run(60, 0.1, 200);
    expect(a.frames.length).toBe(framesA);
    expect(b.frames.length).toBeGreaterThan(4);
    expect(display.pending.size).toBe(1);
    second.stop();
    expect(display.pending.size).toBe(0);
  });
});
