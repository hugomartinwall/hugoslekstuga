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
  stop(): void;
  pause(): void;
  resume(): void;
  readonly paused: boolean;
  /**
   * Presentation-side time dilation (final-blow slow-mo): scales how fast
   * wall-clock feeds the accumulator. Sim ticks are unchanged and identical —
   * determinism is untouched. Clamped to [0.1, 1].
   */
  setTimeScale(s: number): void;
}

export function createLoop(cb: LoopCallbacks): Loop {
  let acc = 0;
  let last = 0;
  let paused = false;
  let started = false;
  let rafId = 0;
  let timeScale = 1;

  function frame(now: number): void {
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
    rafId = requestAnimationFrame(frame);
  }

  return {
    start() {
      if (started) return;
      started = true;
      rafId = requestAnimationFrame((now) => {
        last = now;
        rafId = requestAnimationFrame(frame);
      });
    },
    stop() {
      // Unmount path (the game lives inside a React page now) — without this
      // every mount/unmount cycle would leak a zombie rAF loop.
      cancelAnimationFrame(rafId);
      started = false;
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
  };
}
