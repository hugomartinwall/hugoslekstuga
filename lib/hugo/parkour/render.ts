/**
 * Hugo's parkour — canvas painters.
 *
 * Pure draw functions; the component owns the canvas, the camera, and
 * the loop. Everything here paints in world coordinates and assumes
 * the caller has already applied any world→screen transform.
 */

import { COLOR_HEX } from "@/lib/colors";
import { withAlpha } from "@/lib/hugo/sprite";

/** Label ink for canvas captions — matches the map labels. */
export const INKISH = "#e8f2e9";

export const DOOR_W = 26;
export const DOOR_H = 34;
export const BEAM_STEPS = 26;

/** The goal door: magenta frame, dark glass, mint knob, phosphor halo. */
export function drawDoor(
  ctx: CanvasRenderingContext2D,
  doorX: number,
  doorY: number,
): void {
  const doorGlow = ctx.createRadialGradient(
    doorX,
    doorY + DOOR_H / 2,
    2,
    doorX,
    doorY + DOOR_H / 2,
    70,
  );
  doorGlow.addColorStop(0, withAlpha(COLOR_HEX.pink, 0.35));
  doorGlow.addColorStop(1, withAlpha(COLOR_HEX.pink, 0));
  ctx.fillStyle = doorGlow;
  ctx.fillRect(doorX - 70, doorY + DOOR_H / 2 - 70, 140, 140);
  ctx.fillStyle = COLOR_HEX.pink;
  ctx.fillRect(doorX - DOOR_W / 2, doorY, DOOR_W, DOOR_H);
  ctx.fillStyle = "#07080f";
  ctx.fillRect(doorX - DOOR_W / 2 + 4, doorY + 4, DOOR_W - 8, DOOR_H - 8);
  ctx.fillStyle = COLOR_HEX.green;
  ctx.fillRect(doorX + DOOR_W / 2 - 9, doorY + DOOR_H / 2 - 2, 4, 4);
  ctx.fillStyle = INKISH;
  ctx.font = "9px var(--font-pixel), monospace";
  ctx.textAlign = "center";
  ctx.fillText("THE EXIT", doorX, doorY + DOOR_H + 14);
}

/** Spawn beam — Hugo is beamed in: a thin phosphor column over the
 *  spawn point that flickers and fades while he drops out of it. The
 *  caller gates it on tick count and reduced motion. */
export function drawBeam(
  ctx: CanvasRenderingContext2D,
  x: number,
  bottom: number,
  accent: string,
  tick: number,
): void {
  const fade = 1 - tick / BEAM_STEPS;
  const flicker = tick % 4 < 2 ? 1 : 0.55;
  const a = 0.4 * fade * flicker;
  ctx.fillStyle = withAlpha(accent, a);
  ctx.fillRect(x - 3, 0, 6, bottom);
  ctx.fillStyle = withAlpha(accent, a * 0.4);
  ctx.fillRect(x - 7, 0, 4, bottom);
  ctx.fillRect(x + 3, 0, 4, bottom);
}
