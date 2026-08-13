import type { TouchLayout } from "../render/ui-layout";

/**
 * Touch state machine: a floating stick anchored wherever the left-zone
 * press lands, plus buttons tracked per pointerId so moving-while-
 * attacking always works (the resting-thumb rule).
 */

export type TouchState = {
  seenTouch: boolean;
  stickPointer: number | null;
  stickOrigin: { x: number; y: number };
  stickVec: { x: number; y: number }; // -1..1
  held: Set<string>; // button ids currently down
  pressed: Set<string>; // edge-latched since last drain
};

export function newTouchState(): TouchState {
  return {
    seenTouch: false,
    stickPointer: null,
    stickOrigin: { x: 0, y: 0 },
    stickVec: { x: 0, y: 0 },
    held: new Set(),
    pressed: new Set(),
  };
}

const STICK_R = 56;
const DEAD = 0.12;

export function touchDown(
  ts: TouchState,
  layout: TouchLayout | null,
  id: number,
  x: number,
  y: number,
): boolean {
  ts.seenTouch = true;
  if (!layout) return false;
  for (const btn of layout.buttons) {
    if (Math.hypot(x - btn.x, y - btn.y) <= btn.hitR) {
      ts.held.add(btn.id);
      ts.pressed.add(btn.id);
      return true;
    }
  }
  const z = layout.stickZone;
  if (ts.stickPointer === null && x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h) {
    ts.stickPointer = id;
    ts.stickOrigin = { x, y };
    ts.stickVec = { x: 0, y: 0 };
    return true;
  }
  return false;
}

export function touchMove(ts: TouchState, id: number, x: number, y: number): void {
  if (ts.stickPointer !== id) return;
  let dx = (x - ts.stickOrigin.x) / STICK_R;
  let dy = (y - ts.stickOrigin.y) / STICK_R;
  const mag = Math.hypot(dx, dy);
  if (mag > 1) {
    dx /= mag;
    dy /= mag;
  }
  if (Math.hypot(dx, dy) < DEAD) {
    dx = 0;
    dy = 0;
  }
  ts.stickVec = { x: dx, y: dy };
}

export function touchUp(ts: TouchState, layout: TouchLayout | null, id: number, x: number, y: number): void {
  if (ts.stickPointer === id) {
    ts.stickPointer = null;
    ts.stickVec = { x: 0, y: 0 };
    return;
  }
  if (!layout) {
    ts.held.clear();
    return;
  }
  // Release any button this pointer was over (best-effort per-position).
  for (const btn of layout.buttons) {
    if (Math.hypot(x - btn.x, y - btn.y) <= btn.hitR) ts.held.delete(btn.id);
  }
}

export function touchCancelAll(ts: TouchState): void {
  ts.stickPointer = null;
  ts.stickVec = { x: 0, y: 0 };
  ts.held.clear();
}
