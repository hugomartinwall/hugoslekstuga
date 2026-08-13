import { ROOM_PX_H, ROOM_PX_W } from "../sim/rooms";

/**
 * The "camera" — deliberately not a camera. Rooms are single screens, so
 * this is a pure view-transform calculator: scale the 320×192 playfield
 * into the available rect, reserving a HUD band on top and (in portrait)
 * handing the freed bottom band to the touch controls, Game-Boy style.
 */

export type SafeInsets = { top: number; right: number; bottom: number; left: number };

export type ViewLayout = {
  scale: number;
  ox: number; // playfield origin, css px
  oy: number;
  hudH: number;
  portrait: boolean;
  w: number; // canvas css size
  h: number;
  safe: SafeInsets;
  /** The band below the playfield (portrait) — where touch controls live. */
  bandTop: number;
};

export const HUD_H = 36;

export function computeView(w: number, h: number, safe: SafeInsets): ViewLayout {
  const portrait = h > w * 1.1;
  const hudTop = safe.top;
  const hudH = HUD_H;
  const availW = w - safe.left - safe.right - 8;
  const availH = h - hudTop - hudH - safe.bottom - 8;

  let scale = Math.min(availW / ROOM_PX_W, availH / ROOM_PX_H);
  // Prefer crisp integer scales when we're in their neighbourhood.
  if (scale >= 1.5) {
    const snapped = Math.floor(scale * 2) / 2; // half-integer steps
    if (scale - snapped < 0.35) scale = snapped;
  }
  scale = Math.max(0.5, scale);

  const pw = ROOM_PX_W * scale;
  const ph = ROOM_PX_H * scale;
  const ox = safe.left + (w - safe.left - safe.right - pw) / 2;
  // Portrait: playfield rides high under the HUD; landscape: centred.
  const oy = portrait
    ? hudTop + hudH + 6
    : hudTop + hudH + (availH - ph) / 2 + 4;

  return {
    scale,
    ox,
    oy,
    hudH,
    portrait,
    w,
    h,
    safe,
    bandTop: oy + ph,
  };
}
