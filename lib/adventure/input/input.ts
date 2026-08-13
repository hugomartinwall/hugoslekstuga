import { emptyIntent, type Intent } from "../sim/state";
import { ACTION_CODES, ACTION_KEYS, MOVE_CODES } from "./bindings";
import {
  newTouchState,
  touchCancelAll,
  touchDown,
  touchMove,
  touchUp,
  type TouchState,
} from "./touch";
import type { TouchLayout } from "../render/ui-layout";

/**
 * The one input router. Keyboard held-state + edge latches and the touch
 * state machine both drain into a fresh Intent once per sim tick; menu
 * interactions go straight to the game's callbacks. Pointer Events only.
 */

export type InputApi = {
  /** Menus: taps land here with css coords; game hit-tests screen rects. */
  onTap(x: number, y: number): void;
  onMenuKey(key: "up" | "down" | "left" | "right" | "confirm" | "back"): void;
  onPause(): void;
  onMute(): void;
  /** True while the sim consumes movement (scene === play). */
  isPlaying(): boolean;
  touchLayout(): TouchLayout | null;
};

export type InputHandle = {
  /** Drain the accumulated input into a fresh per-tick Intent. */
  intent(): Intent;
  touch: TouchState;
  detach(): void;
};

export function attachInput(canvas: HTMLCanvasElement, api: InputApi): InputHandle {
  const held = new Set<string>();
  const pressed = new Set<string>();
  const touch = newTouchState();
  const disposers: Array<() => void> = [];
  const listen = <K extends keyof WindowEventMap>(
    target: Window | HTMLCanvasElement,
    type: K | string,
    fn: (e: never) => void,
    options?: AddEventListenerOptions,
  ) => {
    const l = fn as EventListener;
    target.addEventListener(type as string, l, options);
    disposers.push(() => target.removeEventListener(type as string, l, options));
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const action = ACTION_CODES[e.code] ?? ACTION_KEYS[e.key.toLowerCase()];
    const move = MOVE_CODES[e.code];

    if (!api.isPlaying()) {
      // Menu navigation.
      if (move) {
        api.onMenuKey(move === "up" ? "up" : move === "down" ? "down" : move === "left" ? "left" : "right");
        e.preventDefault();
        return;
      }
      if (action === "attack" || action === "confirm") {
        api.onMenuKey("confirm");
        e.preventDefault();
        return;
      }
      if (action === "pause") {
        api.onMenuKey("back");
        e.preventDefault();
        return;
      }
      if (action === "mute") api.onMute();
      return;
    }

    if (action === "pause") {
      api.onPause();
      e.preventDefault();
      return;
    }
    if (action === "mute") {
      api.onMute();
      return;
    }
    if (move || action) {
      if (!e.repeat) {
        if (move) held.add(e.code);
        if (action) {
          held.add(`act:${action}`);
          pressed.add(action);
        }
      } else if (move) {
        held.add(e.code);
      }
      e.preventDefault();
    }
  };
  const onKeyUp = (e: KeyboardEvent) => {
    held.delete(e.code);
    const action = ACTION_CODES[e.code] ?? ACTION_KEYS[e.key.toLowerCase()];
    if (action) held.delete(`act:${action}`);
  };
  const onBlur = () => {
    held.clear();
    touchCancelAll(touch);
  };

  listen(window, "keydown", onKeyDown);
  listen(window, "keyup", onKeyUp);
  listen(window, "blur", onBlur);

  // Pointer events — mouse and touch through the one API.
  const isTouch = (e: PointerEvent) => e.pointerType === "touch";
  const onPointerDown = (e: PointerEvent) => {
    try {
      canvas.setPointerCapture?.(e.pointerId);
    } catch {
      /* pointer already gone (or synthetic) — capture is best-effort */
    }
    if (isTouch(e) && api.isPlaying()) {
      const claimed = touchDown(touch, api.touchLayout(), e.pointerId, e.clientX, e.clientY);
      if (claimed) {
        e.preventDefault();
        return;
      }
    }
    api.onTap(e.clientX, e.clientY);
    e.preventDefault();
  };
  const onPointerMove = (e: PointerEvent) => {
    if (isTouch(e)) touchMove(touch, e.pointerId, e.clientX, e.clientY);
  };
  const onPointerUp = (e: PointerEvent) => {
    if (isTouch(e)) touchUp(touch, api.touchLayout(), e.pointerId, e.clientX, e.clientY);
  };
  const onPointerCancel = () => touchCancelAll(touch);

  listen(canvas, "pointerdown", onPointerDown);
  listen(canvas, "pointermove", onPointerMove);
  listen(canvas, "pointerup", onPointerUp);
  listen(canvas, "pointercancel", onPointerCancel);
  // An unprevented wheel scrolls the page out from under the game.
  listen(canvas, "wheel", (e: WheelEvent) => e.preventDefault(), { passive: false });
  listen(canvas, "contextmenu", (e: MouseEvent) => e.preventDefault());

  const dirHeld = (dir: string) =>
    Object.entries(MOVE_CODES).some(([code, d]) => d === dir && held.has(code));

  return {
    touch,
    intent(): Intent {
      const i = emptyIntent();
      let mx = (dirHeld("right") ? 1 : 0) - (dirHeld("left") ? 1 : 0);
      let my = (dirHeld("down") ? 1 : 0) - (dirHeld("up") ? 1 : 0);
      if (mx === 0 && my === 0 && (touch.stickVec.x || touch.stickVec.y)) {
        mx = touch.stickVec.x;
        my = touch.stickVec.y;
      } else if (mx !== 0 && my !== 0) {
        const inv = 1 / Math.hypot(mx, my);
        mx *= inv;
        my *= inv;
      }
      i.mx = mx;
      i.my = my;

      const edge = (name: string) => pressed.has(name) || touch.pressed.has(name);
      i.attack = edge("attack");
      i.attackHeld = held.has("act:attack") || touch.held.has("attack");
      i.dodge = edge("dodge") || touch.pressed.has("roll");
      i.dagger = edge("dagger");
      i.parry = edge("parry");
      i.dash = edge("dash");
      i.whirl = edge("whirl");
      i.bomb = edge("bomb");
      i.flash = edge("flash");
      i.overclock = edge("overclock");
      i.flask = edge("flask");
      i.interact = edge("attack") || edge("confirm");
      pressed.clear();
      touch.pressed.clear();
      return i;
    },
    detach() {
      for (const d of disposers) d();
    },
  };
}
