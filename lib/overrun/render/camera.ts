import { NODE_R } from "../sim/constants";
import { WORLD_H, WORLD_W } from "../sim/state";
import type { Node } from "../sim/state";

/**
 * Orientation-aware presentation camera.
 *
 * The simulation is a fixed 160×90 board and stays that way — nothing in this
 * file touches sim state, and level identity is device-independent. What
 * changes per device is only how that board is *framed*:
 *
 *  - On a portrait phone the board is rendered quarter-turned (world +x points
 *    up the screen), so a 16:9 field fills a 9:19.5 screen instead of
 *    collapsing into a thin band across a fifth of it.
 *  - The fit targets the board's actual *content* — symmetrized about the world
 *    centre — rather than the full 160×90 rect, so 3-way boards (which only
 *    ever occupy a centred disc) stop wasting the margins the rect implies.
 *    This does change desktop framing relative to the old whole-rect fit; that
 *    is the point, and it is why there is no "desktop is byte-identical" claim
 *    here.
 *
 * Pure and DOM-free: vitest runs in node with no jsdom, and every rule in here
 * is worth asserting directly.
 */

/** Subtle affine tilt: 6% vertical compression, applied in screen space. */
export const TILT_Y = 0.94;

/** Board rotation. Only these two — see pickTheta. */
export const THETA_LANDSCAPE = 0;
export const THETA_PORTRAIT = -Math.PI / 2;

/** Breathing room around the content box, in world units. */
const CONTENT_PAD = 3;

/**
 * Legibility targets, in CSS px. These are **not** inputs to the fit — fitting
 * the content box already maximises scale without cropping, so there is nothing
 * for a floor to add. They are documented here, and asserted in
 * test/camera.test.ts, as the bar the framing is expected to clear.
 *
 * An earlier version fed them into the fit as `min(contentFit, max(full,
 * needed))`. Because the content box is clamped to the board, `contentFit` is
 * always ≥ `full`, so that expression collapsed to the legacy whole-rect fit
 * whenever the floor was not binding — the opposite of what it claimed to do.
 */
export const MIN_SEPARATION_CSS = 56;
export const MIN_DIAMETER_CSS = 44;

/** Rotation hysteresis: enter a quarter-turn at 1.25× fit gain, leave at 1.10×. */
const ROTATE_ENTER = 1.25;
const ROTATE_LEAVE = 1.1;

export interface Viewport {
  /** CSS pixels. */
  cssW: number;
  cssH: number;
  /** Device pixel ratio actually used for the backing store (already capped). */
  dpr: number;
}

/** Screen-space bands reserved for chrome, in CSS px. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const NO_INSETS: Insets = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });

/** Half-extents of the board content about the world centre, in world units. */
export interface ContentBox {
  rx: number;
  ry: number;
}

/** The full-board fallback, used before any level exists. */
export const FULL_CONTENT: ContentBox = Object.freeze({
  rx: WORLD_W / 2,
  ry: WORLD_H / 2,
});

export interface Camera {
  theta: number;
  /** Device pixels per world unit along the board's own axes. */
  scale: number;
  /** Centre of the fitted region, in device pixels. */
  cx: number;
  cy: number;
  /** CSS px per world unit — the unit chrome sizing and hit radii key off. */
  cssScale: number;
}

/**
 * Content half-extents, *symmetrized* about the world centre.
 *
 * Symmetrizing is load-bearing rather than tidy: a 3-fold rotationally
 * symmetric point set does not have a bounding box centred on its centre of
 * rotation (three points at 90°/210°/330° span y ∈ [−0.5r, r]). Fitting a naive
 * bbox would crop asymmetrically and hand one faction a better view of its own
 * territory than its rotational twins get. Taking max|x − 80| keeps the camera
 * fair by construction — and as a bonus it neutralizes the deliberate turret
 * asymmetry hand-placed on level 7.
 */
export function contentBox(nodes: readonly Node[], half: ContentBox = FULL_CONTENT): ContentBox {
  if (nodes.length === 0) return half;

  let rx = 0;
  let ry = 0;
  for (const n of nodes) {
    const r = NODE_R[n.size]!;
    rx = Math.max(rx, Math.abs(n.x - WORLD_W / 2) + r);
    ry = Math.max(ry, Math.abs(n.y - WORLD_H / 2) + r);
  }
  return {
    // Never fit tighter than the content, never wider than the board —
    // where "the board" is the LEVEL's half-extents (bigger late boards
    // extend around the same fixed centre; the default is the classic rect).
    rx: Math.min(half.rx, rx + CONTENT_PAD),
    ry: Math.min(half.ry, ry + CONTENT_PAD),
  };
}

/**
 * Usable CSS-pixel box after chrome insets, floored so it can never invert.
 *
 * The centre is derived from the floored box and then clamped into the
 * viewport. Deriving it from the raw insets instead put the board centre below
 * the bottom of the canvas at the 64×36 hidden-iframe floor, where the reserved
 * chrome band is taller than the whole viewport — nothing rendered at all until
 * the first real resize.
 */
function usable(vp: Viewport, insets: Insets): { w: number; h: number; cx: number; cy: number } {
  const w = Math.max(32, vp.cssW - insets.left - insets.right);
  const h = Math.max(32, vp.cssH - insets.top - insets.bottom);
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  return {
    w,
    h,
    cx: clamp(insets.left + w / 2, w / 2, Math.max(w / 2, vp.cssW - w / 2)),
    cy: clamp(insets.top + h / 2, h / 2, Math.max(h / 2, vp.cssH - h / 2)),
  };
}

/**
 * CSS px per world unit for a given rotation. The 2.5D squash always compresses
 * the *screen* vertical, so which world axis it applies to flips with theta —
 * getting this backwards gives a rotated board a nonsensical 6% horizontal
 * squeeze.
 */
function fitScale(boxW: number, boxH: number, rx: number, ry: number, theta: number): number {
  const [screenRx, screenRy] = theta === 0 ? [rx, ry] : [ry, rx];
  return Math.min(boxW / (2 * screenRx), boxH / (2 * screenRy * TILT_Y));
}

/**
 * Landscape or quarter-turn, with hysteresis so a viewport hovering near square
 * cannot oscillate. Seeded from the previous choice when there is one.
 *
 * The rotation direction needs no choice: genMirror samples the player at low x
 * and genQuad places them bottom-left, so under a −90° turn the player lands in
 * the lower half of the screen either way — which is where a thumb is.
 */
function pickTheta(boxW: number, boxH: number, content: ContentBox, prev?: Camera): number {
  const land = fitScale(boxW, boxH, content.rx, content.ry, THETA_LANDSCAPE);
  const port = fitScale(boxW, boxH, content.rx, content.ry, THETA_PORTRAIT);
  const gain = port / land;
  const wasPortrait = prev?.theta === THETA_PORTRAIT;
  const threshold = wasPortrait ? ROTATE_LEAVE : ROTATE_ENTER;
  return gain >= threshold ? THETA_PORTRAIT : THETA_LANDSCAPE;
}

/** Options that pin camera behaviour, for the marketing capture pipeline. */
export interface CameraOverrides {
  /**
   * Force a rotation instead of choosing one. The video capture needs this:
   * `pickTheta` decides per level, so a multi-scene portrait clip would
   * quarter-turn a wide-spread board and leave a disc-shaped one upright,
   * flipping orientation mid-video — and, because `prev` is threaded, doing so
   * differently depending on scene order.
   */
  theta?: number;
}

/**
 * Fit the board into the viewport minus reserved chrome.
 */
export function computeCamera(
  vp: Viewport,
  insets: Insets,
  content: ContentBox,
  prev?: Camera,
  overrides: CameraOverrides = {},
): Camera {
  const box = usable(vp, insets);
  const theta = overrides.theta ?? pickTheta(box.w, box.h, content, prev);

  // Fit the content box. It is centred on the world centre and already includes
  // each node's radius, so this is the largest scale that crops nothing — no
  // floor to add, no ceiling to clamp against.
  const cssScale = fitScale(box.w, box.h, content.rx, content.ry, theta);

  return {
    theta,
    scale: cssScale * vp.dpr,
    cx: box.cx * vp.dpr,
    cy: box.cy * vp.dpr,
    cssScale,
  };
}

/**
 * Base world transform. The squash is applied *after* the rotation, in screen
 * space, so the 2.5D tilt always reads as a vertical compression on screen.
 * screenToWorld/worldToScreen invert exactly this.
 */
export function applyCamera(ctx: CanvasRenderingContext2D, cam: Camera): void {
  ctx.translate(cam.cx, cam.cy);
  ctx.scale(1, TILT_Y);
  if (cam.theta !== 0) ctx.rotate(cam.theta);
  ctx.scale(cam.scale, cam.scale);
  ctx.translate(-WORLD_W / 2, -WORLD_H / 2);
}

/** CSS-pixel screen coords → world coords. */
export function screenToWorld(cam: Camera, sx: number, sy: number, dpr: number): { x: number; y: number } {
  // Undo translate(cx, cy) and the screen-space squash.
  const px = sx * dpr - cam.cx;
  const py = (sy * dpr - cam.cy) / TILT_Y;
  // Undo the rotation.
  const c = Math.cos(-cam.theta);
  const s = Math.sin(-cam.theta);
  const rx = px * c - py * s;
  const ry = px * s + py * c;
  return {
    x: rx / cam.scale + WORLD_W / 2,
    y: ry / cam.scale + WORLD_H / 2,
  };
}

/** World coords → CSS-pixel screen coords. */
export function worldToScreen(cam: Camera, wx: number, wy: number, dpr: number): { x: number; y: number } {
  const rx = (wx - WORLD_W / 2) * cam.scale;
  const ry = (wy - WORLD_H / 2) * cam.scale;
  const c = Math.cos(cam.theta);
  const s = Math.sin(cam.theta);
  const px = rx * c - ry * s;
  const py = rx * s + ry * c;
  return {
    x: (px + cam.cx) / dpr,
    y: (py * TILT_Y + cam.cy) / dpr,
  };
}

/**
 * World-space unit vector pointing *down the screen*. Depth shading, drop
 * shadows and falling confetti all key off this rather than assuming +y.
 */
export function downVector(cam: Camera): { x: number; y: number } {
  const c = Math.cos(-cam.theta);
  const s = Math.sin(-cam.theta);
  // Screen-down (0, 1) rotated back into world space.
  return { x: -s, y: c };
}

/**
 * World-space unit vector pointing *screen-right*, given screen-down.
 *
 * One definition, because the sign is easy to get backwards and the wrong
 * perpendicular points screen-left — which is how the upgrade chevron's cost
 * label ended up drawn on top of the glyph in portrait.
 */
export function screenRight(down: { x: number; y: number }): { x: number; y: number } {
  return { x: down.y, y: -down.x };
}

/**
 * World-space unit vector pointing toward the *screen's* top-left, so baked
 * sphere highlights and drop-shadow offsets keep a single fixed light direction
 * regardless of board rotation. Pre-applied at bake time, so this costs nothing
 * per frame.
 */
export function lightVector(cam: Camera): { x: number; y: number } {
  const c = Math.cos(-cam.theta);
  const s = Math.sin(-cam.theta);
  const lx = -Math.SQRT1_2;
  const ly = -Math.SQRT1_2;
  return { x: lx * c - ly * s, y: lx * s + ly * c };
}
