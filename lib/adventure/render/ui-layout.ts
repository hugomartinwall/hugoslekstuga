import type { ViewLayout } from "./view";

/**
 * Layout math as data — the single source both the renderer (drawing)
 * and the input layer (hit testing) read, so a button can never be
 * painted where it can't be tapped.
 */

export const MIN_TAP = 44;

export type Rect = { x: number; y: number; w: number; h: number };

/** Grow a rect about its centre to the 44px tap floor. */
export function tappable(r: Rect): Rect {
  const w = Math.max(r.w, MIN_TAP);
  const h = Math.max(r.h, MIN_TAP);
  return { x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w, h };
}

export function inRect(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

export type TouchButton = {
  id: "attack" | "roll" | "dagger" | "parry" | "dash" | "whirl" | "bomb" | "flash" | "overclock" | "flask";
  x: number; // centre, css px
  y: number;
  r: number; // visual radius
  hitR: number;
};

export type TouchLayout = {
  stickZone: Rect; // any press here anchors the floating stick
  buttons: TouchButton[];
  pause: Rect;
};

/** The verbs that earn a touch button, in pad order, as they're bought. */
const PAD_VERBS: TouchButton["id"][] = [
  "dagger",
  "parry",
  "dash",
  "whirl",
  "bomb",
  "flash",
  "overclock",
  "flask",
];

export function computeTouchLayout(view: ViewLayout, gear: readonly string[]): TouchLayout {
  const { w, h, safe } = view;
  const bottom = h - safe.bottom;
  const right = w - safe.right;

  const attack: TouchButton = {
    id: "attack",
    x: right - 52,
    y: bottom - 52,
    r: 34,
    hitR: 46,
  };
  const roll: TouchButton = {
    id: "roll",
    x: right - 118,
    y: bottom - 92,
    r: 27,
    hitR: 38,
  };
  const buttons: TouchButton[] = [attack];
  if (gear.includes("roll")) buttons.push(roll);

  // The verb pad grows as verbs are bought: small buttons arcing above.
  const owned = PAD_VERBS.filter(
    (v) => gear.includes(v) || (v === "flask" && gear.includes("flask")),
  );
  owned.forEach((id, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    buttons.push({
      id,
      x: right - 40 - col * 58,
      y: bottom - 150 - row * 54,
      r: 22,
      hitR: 30,
    });
  });

  return {
    stickZone: { x: 0, y: view.oy, w: w * 0.55, h: h - view.oy },
    buttons,
    pause: tappable({ x: right - 40, y: safe.top + 4, w: 36, h: 28 }),
  };
}
