import { DT } from "./sim/physics";

/**
 * The frame loop. It is the feel toy's, not Adventure's: the simulation
 * still advances in whole ticks of 1/60 s whatever the display does, but
 *
 *  - the room can run slowed (while a pull is held), with the time scale
 *    eased in and out as the toy eases it;
 *  - a release fires on this frame however slowly time is running: if a
 *    launch is waiting and less than a tick has built up, one is forced;
 *  - a freeze after a pop stops stepping in mid-frame and holds the
 *    picture at the contact;
 *  - a frame's real time is capped at 100 ms and at most six ticks are
 *    taken in one frame (a phone that draws at 30 a second must not run
 *    the game slow: that would be free slow motion).
 *
 * Nothing here decides an outcome. The same ticks, fed the same inputs,
 * give the same game at any frame rate.
 */

/** A frame's real time is capped at this, in seconds. */
const MAX_FRAME_S = 0.1;
const MAX_TICKS_PER_FRAME = 6;
/** How fast the time scale closes on its target, per second: going slow, and coming back. */
const EASE_IN_PER_S = 14;
const EASE_OUT_PER_S = 9;

export type FrameInfo = {
  /** How far the picture is between the last two ticks, 0..1. */
  alpha: number;
  /** The frame's timestamp, ms. */
  now: number;
  /** Real seconds since the last frame, capped. */
  realDt: number;
  /** The same, as the room felt it: slowed with the room, zero during a freeze. */
  scaledDt: number;
};

export type LoopHooks = {
  /** Asked once a frame, before its ticks: should the room run slowed now? */
  slowed(realDt: number): boolean;
  /** The slowed room's speed as a share of normal speed. */
  slowShare(): number;
  /** Is a launch waiting to be handed to the simulation? */
  launchQueued(): boolean;
  /** While true no tick is taken (the page is too small; later: paused, over). */
  held(): boolean;
  /** One tick of the simulation. Returns the freeze it asks for, in seconds; 0 for none. */
  tick(): number;
  /** Draw one picture. */
  render(frame: FrameInfo): void;
};

export type Loop = {
  /** Start drawing frames. Does nothing if it is already running. */
  start(): void;
  /** Stop: no frame is drawn and no tick is taken until `start`. */
  stop(): void;
  readonly running: boolean;
};

export function createLoop(hooks: LoopHooks): Loop {
  let running = false;
  let raf = 0;
  let last = -1;
  let acc = 0;
  let timeScale = 1;
  let freeze = 0;
  /** A freeze just ended and no tick has been taken since: he is still drawn at the contact. */
  let atContact = false;

  /** Ask for the next frame: one at a time, and none once the loop has stopped. */
  function schedule(): void {
    if (running && raf === 0) raf = requestAnimationFrame(frame);
  }

  function frame(now: number): void {
    raf = 0;
    if (!running) return;
    const realDt = last < 0 ? 0 : Math.min(MAX_FRAME_S, Math.max(0, (now - last) / 1000));
    last = now;

    const slow = hooks.slowed(realDt);
    const target = slow ? hooks.slowShare() : 1;
    timeScale += (target - timeScale) * Math.min(1, realDt * (slow ? EASE_IN_PER_S : EASE_OUT_PER_S));
    if (Math.abs(timeScale - target) < 0.01) timeScale = target;

    if (hooks.held()) {
      // Nothing moves, and what had built up is dropped. A hold during a freeze ends the freeze.
      acc = 0;
      freeze = 0;
    } else if (freeze > 0) {
      freeze -= realDt;
    } else {
      acc += realDt * timeScale;
      // A release fires on this frame, however slowly time is running.
      if (hooks.launchQueued() && acc < DT) acc = DT;
      let taken = 0;
      while (acc >= DT && taken < MAX_TICKS_PER_FRAME) {
        const asked = hooks.tick();
        atContact = false;
        acc -= DT;
        taken++;
        if (asked > 0) {
          // Hold everything at the contact through the freeze. Until the
          // next tick the picture is drawn at this tick's end, or the first
          // frame after the freeze would draw him a part-step back.
          freeze = asked;
          atContact = true;
          break;
        }
      }
      if (taken >= MAX_TICKS_PER_FRAME) acc = 0;
    }

    const frozen = freeze > 0;
    const alpha = frozen || atContact ? 1 : Math.min(1, Math.max(0, acc / DT));
    hooks.render({ alpha, now, realDt, scaledDt: frozen ? 0 : realDt * timeScale });
    // A hook may have stopped the loop (the game was torn down from inside
    // a tick or a draw), or stopped and started it: either way there is
    // never more than one frame asked for.
    schedule();
  }

  return {
    start() {
      if (running) return;
      running = true;
      // The first frame after a start measures no time: a tab that comes
      // back from hiding must not be handed the time it was away.
      last = -1;
      schedule();
    },
    stop() {
      // The unmount path, and a hidden tab. Without the cancel every mount
      // and unmount would leave a frame loop running.
      running = false;
      if (raf !== 0) cancelAnimationFrame(raf);
      raf = 0;
    },
    get running() {
      return running;
    },
  };
}
