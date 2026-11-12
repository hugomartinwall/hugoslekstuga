/**
 * The pull: one finger, or the left mouse button, anywhere on the root.
 *
 * This is the feel toy's pointer handling moved onto the game's one touch
 * surface, with the spec's rules for what is and is not a pull (§4.1).
 * Nothing here decides an outcome in the simulation: a release becomes
 * one Launch, handed over through `onLaunch`, and the aim never leaves
 * this file except to be drawn.
 *
 * Lengths are CSS pixels, never room units: a thumb's reach does not
 * change with the size the room is drawn at.
 */
import type { Launch, Tune } from "../sim/types";

/** A thumb leaving the glass jumps. Look this far back from the lift... */
const LIFT_LOOKBACK_MS = 45;
/** ...a move this small in that time is a thumb at rest (or as good as)... CSS px. */
const LIFT_SETTLE_PX = 8;
/** ...and a bigger one, up to this, is still the lift if the thumb was at rest just before it. CSS px. */
const LIFT_JUMP_PX = 24;
/** "At rest just before": moved no further than this in the 45 ms before those 45 ms. CSS px. */
const LIFT_REST_PX = 4;
/** A touch that begins this close to a side edge is the browser's (its back and forward swipes). CSS px. */
export const EDGE_STRIP_PX = 20;
/** How many moves of a pull are remembered for the lift-off filter. */
const MAX_SAMPLES = 24;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** One heard position of the pointer: when (ms) and where (CSS px). */
export type Sample = { t: number; x: number; y: number };

/**
 * Power from the pull's length: `minPower` at `noShotPx`, rising in a
 * straight line to 1 at the full pull.
 */
export function powerForPull(lengthPx: number, tune: Tune): number {
  const p = clamp((lengthPx - tune.noShotPx) / Math.max(1, tune.pullFullPx - tune.noShotPx), 0, 1);
  return tune.minPower + (1 - tune.minPower) * p;
}

/** The newest sample at least `ms` older than `tEnd`, skipping the last one (the lift itself). */
function sampleBefore(samples: Sample[], tEnd: number, ms: number): Sample | null {
  for (let i = samples.length - 2; i >= 0; i--) {
    if (tEnd - samples[i].t >= ms) return samples[i];
  }
  return null;
}

/**
 * The pull a release fires. The rule is: fire what the line showed.
 *
 * The one exception is the jump a thumb makes as it leaves the glass (the
 * contact patch shrinks to one side). Two cases count as that jump and
 * fire from where the thumb sat 45 ms before the lift:
 *   - it moved only a few pixels in those 45 ms (at rest, or as good as);
 *   - it moved more, but it had been at rest in the 45 ms before them:
 *     rest, then a sudden hop, then gone.
 * A thumb that was travelling all along fires from the lift point, and so
 * does a mouse, always. The last sample must be the lift itself.
 */
export function releaseVector(
  samples: Sample[],
  x0: number,
  y0: number,
  pointerType: string,
): { dx: number; dy: number; len: number } {
  const end = samples[samples.length - 1];
  let dx = end.x - x0;
  let dy = end.y - y0;
  const b = sampleBefore(samples, end.t, LIFT_LOOKBACK_MS);
  if (b) {
    const c = sampleBefore(samples, end.t, LIFT_LOOKBACK_MS * 2) ?? b;
    const liftPx = Math.hypot(end.x - b.x, end.y - b.y);
    const beforePx = Math.hypot(b.x - c.x, b.y - c.y);
    const settled = liftPx <= LIFT_SETTLE_PX;
    const hop = liftPx <= LIFT_JUMP_PX && beforePx <= LIFT_REST_PX;
    if (pointerType !== "mouse" && (settled || hop)) {
      dx = b.x - x0;
      dy = b.y - y0;
    }
  }
  return { dx, dy, len: Math.hypot(dx, dy) };
}

/** What a held pull would do if it were let go now. For drawing. */
export type Aim = {
  /** The launch (live, before the lift-off filter). */
  launch: Launch;
  /** 0 at the shortest shot, 1 at the full pull. */
  pull01: number;
  /** Length of the pull, CSS px. */
  lengthPx: number;
  /** Shorter than a shot: letting go here does nothing. Drawn grey. */
  short: boolean;
};

export type PullView = {
  /** Where the pointer came down and where it is, in client CSS px. */
  x0: number;
  y0: number;
  x: number;
  y: number;
  pointerType: string;
  /** Null until the pointer has moved `lineShowsPx`: a touch that has not become a pull. */
  aim: Aim | null;
};

export type PointerHooks = {
  /** The knobs in force (the pull's direction may change while the game runs). */
  tune(): Tune;
  /** Is the game taking pulls now? */
  enabled(): boolean;
  /** A release that is a shot. */
  onLaunch(launch: Launch): void;
  /** Any press on the root, pull or not. */
  onPress(): void;
};

export type PointerHandle = {
  /** The pull being held, or null. */
  pull(): PullView | null;
  /** Drop a held pull. Never a shot. */
  cancel(): void;
  detach(): void;
};

type Pull = { id: number; type: string; x0: number; y0: number; x: number; y: number; samples: Sample[] };

export function attachPointer(root: HTMLElement, hooks: PointerHooks): PointerHandle {
  let pull: Pull | null = null;
  /**
   * Pointers that are down and are not to become a pull: another finger
   * while a pull was held, a touch that began in the edge strip, a press
   * whose pull was dropped. Their later moves must not be taken up by the
   * rule for a pointer first heard as a move.
   */
  const ignored = new Set<number>();
  const ignore = (id: number) => {
    if (ignored.size > 32) ignored.clear();
    ignored.add(id);
  };

  const lengthOf = (p: Pull) => Math.hypot(p.x - p.x0, p.y - p.y0);
  const isLive = (p: Pull) => lengthOf(p) >= hooks.tune().lineShowsPx;

  const release = (id: number) => {
    try {
      root.releasePointerCapture(id);
    } catch {
      /* already released */
    }
  };

  /** Drop the held pull. The pointer may still be down: it stays out until it comes up. */
  const drop = () => {
    if (!pull) return;
    release(pull.id);
    ignore(pull.id);
    pull = null;
  };

  /** May this press, or this first-heard move, begin a pull? */
  const accepts = (e: PointerEvent, leftDown: boolean): boolean => {
    if (!hooks.enabled()) return false;
    // Mouse: the left button only.
    if (e.pointerType === "mouse" && !leftDown) return false;
    if (e.pointerType === "touch") {
      // The side edges belong to the browser's swipes.
      const rect = root.getBoundingClientRect();
      if (e.clientX < rect.left + EDGE_STRIP_PX || e.clientX > rect.right - EDGE_STRIP_PX) return false;
    }
    return true;
  };

  const begin = (e: PointerEvent) => {
    try {
      root.setPointerCapture(e.pointerId);
    } catch {
      /* some webviews refuse capture; moves still arrive while over the root */
    }
    const now = performance.now();
    pull = {
      id: e.pointerId,
      type: e.pointerType || "mouse",
      x0: e.clientX,
      y0: e.clientY,
      x: e.clientX,
      y: e.clientY,
      samples: [{ t: now, x: e.clientX, y: e.clientY }],
    };
  };

  const track = (p: Pull, e: PointerEvent) => {
    p.x = e.clientX;
    p.y = e.clientY;
    p.samples.push({ t: performance.now(), x: e.clientX, y: e.clientY });
    if (p.samples.length > MAX_SAMPLES) p.samples.shift();
  };

  const onDown = (e: PointerEvent) => {
    hooks.onPress();
    // While a pull is held every other finger is ignored. A finger that is
    // down but has not become a pull is replaced by the next one to land.
    // So is a pull whose own pointer went away without a word: a new
    // primary pointer, or the same pointer coming down again, means the
    // old press is over.
    if (pull && (e.pointerId === pull.id || e.isPrimary || !isLive(pull))) drop();
    ignored.delete(e.pointerId);
    if (pull || !accepts(e, e.button === 0)) {
      ignore(e.pointerId);
      return;
    }
    e.preventDefault();
    begin(e);
  };

  const onMove = (e: PointerEvent) => {
    if (pull) {
      if (e.pointerId !== pull.id) return;
      if (e.pointerType === "mouse" && (e.buttons & 1) === 0) {
        // The mouse moves with its left button up: it was let go somewhere
        // the page did not hear (outside the window, over a native menu).
        // The pull is over, and it is no shot.
        release(pull.id);
        pull = null;
        return;
      }
      e.preventDefault();
      track(pull, e);
      return;
    }
    if (e.buttons === 0) {
      // A hover. Whatever press this pointer made before is over.
      ignored.delete(e.pointerId);
      return;
    }
    if (ignored.has(e.pointerId)) return;
    // A pointer first heard as a move with a button or a finger down, with
    // no press before it (a panel closed by a press leaves a sheet over
    // the page for a moment, and that sheet takes the press): it is taken
    // up as if it had come down here.
    if (!accepts(e, (e.buttons & 1) !== 0)) {
      ignore(e.pointerId);
      return;
    }
    hooks.onPress();
    e.preventDefault();
    begin(e);
  };

  const onUp = (e: PointerEvent) => {
    ignored.delete(e.pointerId);
    if (!pull || e.pointerId !== pull.id) return;
    e.preventDefault();
    const p = pull;
    track(p, e);
    const v = releaseVector(p.samples, p.x0, p.y0, p.type);
    release(p.id);
    pull = null;
    if (!hooks.enabled()) return;
    const tune = hooks.tune();
    // Shorter than a shot: a cancel. No shot, nothing spent.
    if (v.len < tune.noShotPx) return;
    const sign = tune.pullDir === "back" ? -1 : 1;
    hooks.onLaunch({ dx: v.dx * sign, dy: v.dy * sign, power: powerForPull(v.len, tune) });
  };

  // A touch the system takes away is a cancel, never a shot.
  const onCancel = (e: PointerEvent) => {
    if (pull && e.pointerId === pull.id) drop();
    ignored.delete(e.pointerId);
  };

  const onContextMenu = (e: Event) => {
    e.preventDefault();
    // A thumb resting half a second before it pulls is a long-press to the
    // browser, which fires this. That is not a cancel; a right-click is.
    if (pull && pull.type === "mouse") drop();
  };

  // Stops the browser recognising a long-press (callout, magnifier) on the
  // root at all. Pointer events, and so pulls, still arrive.
  const onTouchStart = (e: Event) => e.preventDefault();

  root.addEventListener("pointerdown", onDown);
  root.addEventListener("pointermove", onMove);
  root.addEventListener("pointerup", onUp);
  root.addEventListener("pointercancel", onCancel);
  root.addEventListener("contextmenu", onContextMenu);
  root.addEventListener("touchstart", onTouchStart, { passive: false });

  return {
    pull() {
      if (!pull) return null;
      const tune = hooks.tune();
      const dx = pull.x - pull.x0;
      const dy = pull.y - pull.y0;
      const lengthPx = Math.hypot(dx, dy);
      let aim: Aim | null = null;
      if (lengthPx >= tune.lineShowsPx) {
        const sign = tune.pullDir === "back" ? -1 : 1;
        aim = {
          launch: { dx: dx * sign, dy: dy * sign, power: powerForPull(lengthPx, tune) },
          pull01: clamp((lengthPx - tune.noShotPx) / Math.max(1, tune.pullFullPx - tune.noShotPx), 0, 1),
          lengthPx,
          short: lengthPx < tune.noShotPx,
        };
      }
      return { x0: pull.x0, y0: pull.y0, x: pull.x, y: pull.y, pointerType: pull.type, aim };
    },
    cancel: drop,
    detach() {
      if (pull) release(pull.id);
      pull = null;
      ignored.clear();
      root.removeEventListener("pointerdown", onDown);
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerup", onUp);
      root.removeEventListener("pointercancel", onCancel);
      root.removeEventListener("contextmenu", onContextMenu);
      root.removeEventListener("touchstart", onTouchStart);
    },
  };
}
