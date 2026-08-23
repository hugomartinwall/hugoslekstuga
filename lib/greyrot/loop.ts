import { TICK_MS } from "./sim/tick";

/**
 * Fixed-timestep loop. The sim advances in exact TICK_MS steps regardless of
 * display refresh rate (the 144 Hz / 165 Hz requirement); rendering happens
 * once per animation frame with an interpolation alpha in [0, 1).
 */

export interface LoopCallbacks {
  /** Advance the simulation by exactly one tick. */
  simTick(): void;
  /** Draw. `alpha` is how far we are between the last two ticks. */
  render(alpha: number): void;
}

/** Don't try to catch up more than this after a stall (tab switch, ad). */
const MAX_FRAME_MS = 250;

export interface Loop {
  start(): void;
  pause(): void;
  resume(): void;
  readonly paused: boolean;
  /**
   * Presentation-side time dilation (final-blow slow-mo): scales how fast
   * wall-clock feeds the accumulator. Sim ticks are unchanged and identical —
   * determinism is untouched. Clamped to [0.1, 1].
   */
  setTimeScale(s: number): void;
  /**
   * Cancel the pending frame and refuse to schedule another.
   *
   * game2 never had this — a CrazyGames page runs until the tab closes, so
   * nothing ever needed to stop. A Next route unmounts, twice under
   * StrictMode, and a loop left running holds the whole scene graph and its
   * WebGL context alive behind it. Terminal on purpose: a stopped loop cannot
   * be restarted, because `createGreyrot` is the thing you call again.
   */
  stop(): void;
}

export function createLoop(cb: LoopCallbacks): Loop {
  let acc = 0;
  let last = 0;
  let paused = false;
  let started = false;
  let stopped = false;
  let timeScale = 1;
  let rafId = 0;

  function frame(now: number): void {
    // A frame already queued when stop() landed must not simulate. Real
    // browsers drop a cancelled callback and this never fires, but relying on
    // that puts up to MAX_FRAME_MS of catch-up — seven ticks — into state that
    // destroy() is midway through dismantling.
    if (stopped) return;

    const dt = Math.min(now - last, MAX_FRAME_MS);
    last = now;

    if (!paused) {
      acc += dt * timeScale;
      while (acc >= TICK_MS) {
        cb.simTick();
        acc -= TICK_MS;
      }
    }

    cb.render(paused ? 0 : acc / TICK_MS);
    if (!stopped) rafId = requestAnimationFrame(frame);
  }

  return {
    start() {
      if (started || stopped) return;
      started = true;
      rafId = requestAnimationFrame((now) => {
        last = now;
        if (!stopped) rafId = requestAnimationFrame(frame);
      });
    },
    pause() {
      paused = true;
      acc = 0;
    },
    resume() {
      paused = false;
      acc = 0;
    },
    get paused() {
      return paused;
    },
    setTimeScale(s: number) {
      timeScale = Math.max(0.1, Math.min(1, s));
    },
    stop() {
      stopped = true;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
    },
  };
}
