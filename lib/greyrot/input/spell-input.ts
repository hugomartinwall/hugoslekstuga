/**
 * Input for the composition sandbox — devices in, discrete intents out.
 *
 * ## Why this is an event QUEUE and not a state sample
 *
 * The exploration input this replaced sampled held keys once per tick, which
 * is right for movement and silently wrong for casting: at 30 Hz, a key pressed
 * and released between two ticks is never observed, so an element the player
 * definitely pressed never reaches the queue. In a game whose whole skill is
 * fast composition under pressure that is not a rare edge case, it is the
 * common one. So presses are captured as EVENTS the moment the browser reports
 * them, buffered, and drained whole by the next tick. Movement stays sampled;
 * `input/rt-commands.ts` is the one place that knows the difference.
 *
 * The old input carried a world-space latching fix, so that camera
 * auto-recenter could not chase its own tail. That apparatus left with the
 * over-the-shoulder camera and CAME BACK with the movement-following yaw
 * (round 7): the frame turns to sit behind the walk again, so held intent is
 * once more latched in world space — but in `input/rt-commands.ts` (rule 4 of
 * its header), the one place device state becomes commands, not here.
 *
 * ## The control scheme, both devices, designed together
 *
 *              desktop                              touch
 *   move       hold left mouse toward the cursor    left-half virtual stick
 *              (or the arrow keys)
 *   elements   Q W E / A S D, also 1-6              six-button arc, right thumb
 *   cast       Space, or right mouse                tap CAST
 *   self-cast  Shift+Space, or middle mouse         hold CAST
 *   clear      Tab or X                             swipe down on the arc
 *
 * **A cast always fires along the hero's facing.** The cursor steers movement
 * and nothing else — it does not choose a target and it does not aim. See
 * `sim/rt/aim.ts` for why that is the whole system.
 *
 * Elements sit on Q W E / A S D because that is where a left hand rests, which
 * is what makes fast composition possible at all — and it is why movement is on
 * the mouse rather than on WASD. That is Magicka's own arrangement and it falls
 * out of the same constraint. Matching on `KeyboardEvent.code` keeps the
 * physical positions identical on AZERTY (`CLAUDE.md` §1); the on-screen
 * legends still say QWERTY and a real build needs `navigator.keyboard`
 * lookup plus rebinding, which §1 requires and this sandbox does not have.
 *
 * Escape is never bound — it is the platform's fullscreen toggle.
 */

import { CASTABLES, type CastForm, type Element } from "../content";

/** A discrete thing the player did, waiting to be turned into a command. */
export type InputEvent =
  | { type: "queue"; element: Element }
  | { type: "clear" }
  | { type: "cast"; form: CastForm }
  /** Take the find you are standing at (third playtest: found means TAKEN). */
  | { type: "take" };

/** Screen position of the aim, or null when there is nothing pointing. */
export interface AimPoint {
  px: number;
  py: number;
}

const KEY_TO_ELEMENT = new Map<string, Element>();
for (let i = 0; i < CASTABLES.length; i++) {
  const c = CASTABLES[i]!;
  KEY_TO_ELEMENT.set(c.code, c.element);
  KEY_TO_ELEMENT.set(`Digit${i + 1}`, c.element);
}

/** Pixels of drag before the virtual stick reads as a direction. */
const STICK_DEADZONE = 8;
/** Pixels of drag at which the virtual stick is fully deflected. */
const STICK_RANGE = 56;
/** Milliseconds a cast control must be held to mean "self-cast". */
const HOLD_MS = 260;

export class SpellInput {
  /** Drained whole, once per sim tick. Never sampled. */
  private events: InputEvent[] = [];
  private keys = new Set<string>();
  private canvas: HTMLCanvasElement;

  /**
   * Mouse position in CSS pixels, for aiming and move-toward.
   *
   * `null` means **the player has not pointed at anything yet** — not "the
   * cursor is at the origin". That distinction is load-bearing: the old build
   * treated a null aim as licence to fall back on homing, so a player who
   * never touched the mouse got a guaranteed hit on every cast. Null now means
   * "cast straight ahead", and nothing anywhere homes.
   */
  aim: AimPoint | null = null;
  /** True while the left mouse button is held — move toward the cursor. */
  private movePointer = false;

  /** Virtual stick: origin and current position, both in CSS pixels. */
  private stick: { id: number; ox: number; oy: number; x: number; y: number } | null = null;
  /** True once a touch has been seen; flips the scheme to the touch layout. */
  touchMode = false;

  /** Pending hold-to-self-cast timer for the on-screen CAST button. */
  private castHeldAt = 0;

  /** Undo list for every listener this input attached. See `detach()`. */
  private disposers: (() => void)[] = [];

  /**
   * @param onExit called when the player presses Escape. game2 left Escape
   *   alone because CrazyGames owned it for fullscreen; on the site it is the
   *   quit key, matching Adventure and the parkour.
   */
  constructor(canvas: HTMLCanvasElement, onExit?: () => void) {
    this.canvas = canvas;

    const listen = <T extends EventTarget>(
      target: T,
      type: string,
      fn: (e: never) => void,
      opts?: AddEventListenerOptions,
    ): void => {
      const handler = fn as EventListener;
      target.addEventListener(type, handler, opts);
      this.disposers.push(() => target.removeEventListener(type, handler, opts));
    };

    listen(window, "keydown", (e: KeyboardEvent) => {
      // Escape quits. Not preventDefault'd — if the browser also wants to
      // leave fullscreen on the same press, that is the same intent.
      if (e.code === "Escape") {
        onExit?.();
        return;
      }
      if (e.repeat) return; // holding a letter must not spam the queue

      const el = KEY_TO_ELEMENT.get(e.code);
      if (el) {
        this.events.push({ type: "queue", element: el });
        e.preventDefault();
      } else if (e.code === "Space") {
        this.events.push({ type: "cast", form: e.shiftKey ? "self" : "aimed" });
        e.preventDefault(); // spacebar must never scroll the page
      } else if (e.code === "Tab" || e.code === "KeyX") {
        this.events.push({ type: "clear" });
        e.preventDefault();
      } else if (e.code === "KeyF") {
        // The interact key. F, not E: E is FROST in the compose arc.
        this.events.push({ type: "take" });
        e.preventDefault();
      }
      this.keys.add(e.code);
    });
    listen(window, "keyup", (e: KeyboardEvent) => this.keys.delete(e.code));
    // Tab-out with a key held would otherwise leave it stuck down.
    listen(window, "blur", () => {
      this.keys.clear();
      this.stick = null;
      this.movePointer = false;
    });

    listen(canvas, "contextmenu", (e: Event) => e.preventDefault());

    listen(canvas, "pointerdown", (e: PointerEvent) => {
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // Throws for synthetic pointers (headless driving) and for pointers
        // the browser no longer considers active. Losing capture only means a
        // drag can escape the canvas — never fatal.
      }

      if (e.pointerType === "touch") {
        this.touchMode = true;
        // Left half of the canvas is the movement stick. The right half is
        // free for the ability arc, which is DOM and captures its own events.
        if (e.clientX < canvas.clientWidth * 0.5 && !this.stick) {
          this.stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY };
        }
        return;
      }

      this.aim = { px: e.clientX, py: e.clientY };
      if (e.button === 0) this.movePointer = true;
      if (e.button === 2) this.events.push({ type: "cast", form: "aimed" });
      if (e.button === 1) this.events.push({ type: "cast", form: "self" });
    });

    listen(canvas, "pointermove", (e: PointerEvent) => {
      if (e.pointerType === "touch") {
        if (this.stick && this.stick.id === e.pointerId) {
          this.stick.x = e.clientX;
          this.stick.y = e.clientY;
        }
        return;
      }
      this.aim = { px: e.clientX, py: e.clientY };
    });

    const up = (e: PointerEvent): void => {
      if (this.stick && this.stick.id === e.pointerId) this.stick = null;
      if (e.pointerType !== "touch" && e.button === 0) this.movePointer = false;
    };
    listen(canvas, "pointerup", up);
    listen(canvas, "pointercancel", up);
  }

  /**
   * Remove every listener this input attached.
   *
   * game2 never needed it — the page outlived the game. A Next route does not,
   * and three of these listeners are on `window`, so without this a second
   * mount would see every keypress twice.
   */
  detach(): void {
    for (const d of this.disposers) d();
    this.disposers = [];
  }

  /* ------------------------------------------------- the on-screen controls */

  /** An element button in the HUD arc was pressed. */
  pressElement(element: Element): void {
    this.events.push({ type: "queue", element });
  }

  /** The HUD's CAST control went down. Hold decides the form, so start timing. */
  castDown(now: number): void {
    this.castHeldAt = now;
  }

  /** The HUD's CAST control came up. Short is aimed, long is a self-cast. */
  castUp(now: number): void {
    if (this.castHeldAt === 0) return;
    const held = now - this.castHeldAt;
    this.castHeldAt = 0;
    this.events.push({ type: "cast", form: held >= HOLD_MS ? "self" : "aimed" });
  }

  clearQueue(): void {
    this.events.push({ type: "clear" });
  }

  /**
   * The HUD's TAKE control was pressed — collect the find you stand at.
   *
   * No `touchMode` flip here, or in any HUD button (R1): a DOM button cannot
   * tell a mouse from a finger, and a desktop click on the take chip was
   * permanently hiding the "F · " key hint. The one honest source of
   * `touchMode` is a real `pointerType === "touch"` on the canvas — which
   * every touch player has produced before any HUD button matters, because
   * moving IS touching the canvas.
   */
  pressTake(): void {
    this.events.push({ type: "take" });
  }

  /** True while CAST has been held past the self-cast threshold — for the HUD. */
  castHeldPastThreshold(now: number): boolean {
    return this.castHeldAt !== 0 && now - this.castHeldAt >= HOLD_MS;
  }

  /* ---------------------------------------------------------------- output */

  /**
   * Take every input event since the last call.
   *
   * Drained, not sampled — see the header. The caller must consume the result
   * in the same tick or the presses are lost, which is the correct failure
   * mode: dropping is better than replaying a press on a later tick, where it
   * would desync a replay.
   */
  drain(): InputEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  /**
   * Movement intent in SCREEN space, unit-length or shorter.
   *
   * The caller rotates it into world space against the camera yaw. Returns
   * null when the player is not asking to move.
   */
  moveIntent(): { dx: number; dy: number } | null {
    if (this.stick) {
      const dx = this.stick.x - this.stick.ox;
      const dy = this.stick.y - this.stick.oy;
      const d = Math.hypot(dx, dy);
      if (d < STICK_DEADZONE) return null;
      const scale = Math.min(1, d / STICK_RANGE) / d;
      return { dx: dx * scale, dy: dy * scale };
    }

    let dx = 0;
    let dy = 0;
    if (this.keys.has("ArrowUp")) dy -= 1;
    if (this.keys.has("ArrowDown")) dy += 1;
    if (this.keys.has("ArrowLeft")) dx -= 1;
    if (this.keys.has("ArrowRight")) dx += 1;
    if (dx !== 0 || dy !== 0) {
      const l = Math.hypot(dx, dy);
      return { dx: dx / l, dy: dy / l };
    }
    return null;
  }

  /** True when the player is holding left mouse to walk toward the cursor. */
  get movingToCursor(): boolean {
    return this.movePointer && !this.touchMode;
  }

  /** Virtual stick origin and knob, in CSS pixels, for the HUD to draw. */
  stickVisual(): { ox: number; oy: number; kx: number; ky: number } | null {
    if (!this.stick) return null;
    const dx = this.stick.x - this.stick.ox;
    const dy = this.stick.y - this.stick.oy;
    const d = Math.hypot(dx, dy);
    const clamp = d > STICK_RANGE ? STICK_RANGE / d : 1;
    return {
      ox: this.stick.ox,
      oy: this.stick.oy,
      kx: this.stick.ox + dx * clamp,
      ky: this.stick.oy + dy * clamp,
    };
  }

  get canvasEl(): HTMLCanvasElement {
    return this.canvas;
  }
}
