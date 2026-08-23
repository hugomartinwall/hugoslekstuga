import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLoop } from "../../lib/greyrot/loop";
import { effectiveReduced } from "../../lib/greyrot/render/motion";
import { SpellInput } from "../../lib/greyrot/input/spell-input";
import { TICK_MS } from "../../lib/greyrot/sim/tick";

/**
 * The port's own seams.
 *
 * Everything else in test/greyrot/ came from game2 and tests the game. This
 * file tests the four things the move to hugoslekstuga added, all of which
 * exist because a CrazyGames page never unmounts and a Next route does —
 * twice, under StrictMode.
 */

/* --------------------------------------------------------- reduced motion */

describe("the reduced-motion policy", () => {
  /**
   * The OS setting is a default, not a verdict: a player who has asked for
   * motion gets it even on a machine configured to suppress it, and vice
   * versa. Same three-state rule as Overrun and Adventure.
   */
  it("lets the player override win in both directions", () => {
    expect(effectiveReduced("auto", true), "auto follows the OS").toBe(true);
    expect(effectiveReduced("auto", false), "auto follows the OS").toBe(false);
    expect(effectiveReduced("on", false), "'on' beats an OS that said no").toBe(true);
    expect(effectiveReduced("off", true), "'off' beats an OS that said yes").toBe(false);
  });
});

/**
 * The hard half of the rule: reduced motion changes PRESENTATION only, never
 * sim timings, or the game would be a different difficulty for the people who
 * need it.
 *
 * Asserted structurally rather than by comparing two runs, because structure
 * cannot drift: `motion.ts` lives under `render/`, and the sim is already
 * forbidden from importing anything from there ("never imports the renderer"
 * in architecture.test.ts). This test names the dependency that assertion is
 * protecting, so the connection is findable from either end.
 */
describe("reduced motion cannot reach the simulation", () => {
  it("keeps the motion module in the render layer", async () => {
    const mod = await import("../../lib/greyrot/render/motion");
    expect(typeof mod.reducedMotion, "motion is a render-layer concern").toBe("function");
    // If this module is ever moved under sim/, architecture.test.ts's
    // "never imports the renderer" stops covering it — hence the guard.
    expect(new URL("../../lib/greyrot/render/motion.ts", import.meta.url).pathname).toContain(
      "/render/",
    );
  });
});

/* ------------------------------------------------------------------- loop */

describe("the loop's stop()", () => {
  let frames: ((t: number) => void)[] = [];
  let cancelled: number[] = [];

  beforeEach(() => {
    frames = [];
    cancelled = [];
    let id = 0;
    vi.stubGlobal("requestAnimationFrame", (fn: (t: number) => void) => {
      frames.push(fn);
      return ++id;
    });
    vi.stubGlobal("cancelAnimationFrame", (n: number) => cancelled.push(n));
  });

  /** Drive the stubbed rAF queue forward by one frame at time `t`. */
  const pump = (t: number): void => {
    const queued = frames;
    frames = [];
    for (const fn of queued) fn(t);
  };

  it("stops ticking the sim and stops rescheduling", () => {
    let ticks = 0;
    const loop = createLoop({ simTick: () => ticks++, render: () => {} });
    loop.start();
    pump(0); // the priming frame records `last`
    // A hair over five ticks' worth of wall clock: TICK_MS is 1000/30, so an
    // exact multiple can land a float's breadth short of the fifth step.
    pump(TICK_MS * 5 + 0.5);
    expect(ticks, "the loop runs before it is stopped — the vacuity guard").toBe(5);

    loop.stop();
    const before = ticks;
    pump(TICK_MS * 50);
    expect(ticks, "a stopped loop must not advance the sim").toBe(before);
    expect(cancelled.length, "the pending frame is cancelled, not just ignored").toBeGreaterThan(0);
    expect(frames.length, "and nothing new is scheduled").toBe(0);
  });

  it("cannot be restarted — createGreyrot is the way back", () => {
    let ticks = 0;
    const loop = createLoop({ simTick: () => ticks++, render: () => {} });
    loop.stop();
    loop.start();
    pump(0);
    pump(TICK_MS * 10);
    expect(ticks).toBe(0);
  });
});

/* ------------------------------------------------------------------ input */

describe("SpellInput.detach()", () => {
  /** A target that records its listeners so the test can fire and count them. */
  const target = () => {
    const bound = new Map<string, Set<EventListener>>();
    return {
      el: {
        addEventListener: (t: string, fn: EventListener) => {
          if (!bound.has(t)) bound.set(t, new Set());
          bound.get(t)!.add(fn);
        },
        removeEventListener: (t: string, fn: EventListener) => {
          bound.get(t)?.delete(fn);
        },
        clientWidth: 800,
        clientHeight: 450,
        setPointerCapture: () => {},
      },
      count: () => [...bound.values()].reduce((n, s) => n + s.size, 0),
      fire: (t: string, e: unknown) => {
        for (const fn of bound.get(t) ?? []) fn(e as Event);
      },
    };
  };

  it("unbinds every listener it attached, on the window as well as the canvas", () => {
    const win = target();
    const cv = target();
    vi.stubGlobal("window", win.el);

    const input = new SpellInput(cv.el as unknown as HTMLCanvasElement);
    expect(win.count(), "binds on the window: keydown, keyup, blur").toBe(3);
    expect(cv.count(), "and on the canvas").toBeGreaterThan(0);

    input.detach();
    expect(win.count(), "window listeners are the ones that would double up").toBe(0);
    expect(cv.count()).toBe(0);
  });

  it("routes Escape to onExit rather than swallowing it", () => {
    const win = target();
    const cv = target();
    vi.stubGlobal("window", win.el);

    let exits = 0;
    const input = new SpellInput(cv.el as unknown as HTMLCanvasElement, () => exits++);
    win.fire("keydown", { code: "Escape", preventDefault: () => {} });
    expect(exits, "Escape is the quit key on the site — CrazyGames owned it before").toBe(1);
    expect(input.drain(), "and it queues nothing").toEqual([]);

    input.detach();
    win.fire("keydown", { code: "Escape", preventDefault: () => {} });
    expect(exits, "a detached input hears nothing").toBe(1);
  });
});
