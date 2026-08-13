import type { Camera, ContentBox, Viewport, Insets } from "./camera";
import { TILT_Y } from "./camera";
import { WORLD_H, WORLD_W } from "../sim/state";

/**
 * Pan/zoom view state, composed OVER the fit camera.
 *
 * computeCamera stays exactly what it was — the largest crop-nothing framing,
 * which is now the HOME state — and this module derives the effective camera
 * from a small view state on top of it. The invariant everything hangs on:
 *
 *   composeView(fit, HOME_VIEW, …) ≡ fit, bit for bit.
 *
 * So every camera test written against the fit still describes the home
 * state, zoom = 1 can never reveal past the content box, and a player who
 * never touches the camera plays exactly the game that shipped before this
 * file existed.
 *
 * Pure and DOM-free like camera.ts. The sim never sees any of it.
 */

export interface ViewState {
  /** Multiplier on the fit scale. ≥ 1 — the fit already shows everything. */
  zoom: number;
  /** World-space focus: the point framed at the usable-box centre. */
  fx: number;
  fy: number;
}

export const HOME_VIEW: Readonly<ViewState> = Object.freeze({
  zoom: 1,
  fx: WORLD_W / 2,
  fy: WORLD_H / 2,
});

/**
 * Zoom ceiling, expressed as a CSS px-per-world-unit target rather than a bare
 * multiplier: "as close as anyone needs" is a statement about on-screen ball
 * size, not about the device it happens on. 13 css px/wu sits just above the
 * measured desktop fit maximum (11.35), so desktop gets a modest nudge and a
 * phone (fit ≈ 3.4-5) gets the 3-4× it actually needs. The ×4 guard keeps a
 * pathological viewport from unbounded zoom.
 */
export const Z_MAX_CSS = 13;

/**
 * The default zoom a larger-than-one-screen board OPENS at: small ball
 * diameter ≈ 2·6.7·6.6 ≈ 88 css px — twice the 44 px tap floor. This is the
 * scale the A2 legibility tests assert against.
 */
export const PLAY_CSS = 6.6;

export function maxZoom(fit: Camera): number {
  return Math.max(1, Math.min(4, Z_MAX_CSS / fit.cssScale));
}

export function playZoom(fit: Camera): number {
  return Math.max(1, Math.min(maxZoom(fit), PLAY_CSS / fit.cssScale));
}

/** Rotate a device-px screen vector (squash already removed) into world units. */
function screenVecToWorld(
  pxX: number,
  pxY: number,
  theta: number,
  scale: number,
): { x: number; y: number } {
  const c = Math.cos(-theta);
  const s = Math.sin(-theta);
  return {
    x: (pxX * c - pxY * s) / scale,
    y: (pxX * s + pxY * c) / scale,
  };
}

/**
 * Visible half-extents of the usable box in world units, along the BOARD's
 * axes. Which screen dimension covers which world axis flips with theta, and
 * the 2.5D squash always eats screen-vertical — the same two facts fitScale
 * encodes, inverted.
 */
export function visibleHalfExtents(
  vp: Viewport,
  insets: Insets,
  theta: number,
  scale: number,
): { hx: number; hy: number } {
  const uw = Math.max(32, vp.cssW - insets.left - insets.right) * vp.dpr;
  const uh = Math.max(32, vp.cssH - insets.top - insets.bottom) * vp.dpr;
  return theta === 0
    ? { hx: uw / (2 * scale), hy: uh / (2 * scale * TILT_Y) }
    : { hx: uh / (2 * scale * TILT_Y), hy: uw / (2 * scale) };
}

/**
 * Clamp a view so it can never reveal past the content box (the region the
 * fit frames). When the visible extent covers the whole content on an axis,
 * the focus pins to the world centre on that axis — which is what makes
 * zoom = 1 provably identical to the fit.
 */
export function clampView(
  view: ViewState,
  fit: Camera,
  content: ContentBox,
  vp: Viewport,
  insets: Insets,
): ViewState {
  const zoom = Math.max(1, Math.min(maxZoom(fit), view.zoom));
  const { hx, hy } = visibleHalfExtents(vp, insets, fit.theta, fit.scale * zoom);
  const bx = Math.max(0, content.rx - hx);
  const by = Math.max(0, content.ry - hy);
  return {
    zoom,
    fx: Math.max(WORLD_W / 2 - bx, Math.min(WORLD_W / 2 + bx, view.fx)),
    fy: Math.max(WORLD_H / 2 - by, Math.min(WORLD_H / 2 + by, view.fy)),
  };
}

/**
 * Derive the effective camera: fit scale × zoom, with cx/cy solved so the
 * focus point lands where the fit put the world centre. Same rotation, same
 * squash, same transform math — pan/zoom is a composition, not a rewrite.
 */
export function composeView(fit: Camera, view: ViewState): Camera {
  if (view.zoom === 1 && view.fx === WORLD_W / 2 && view.fy === WORLD_H / 2) {
    return fit; // the invariant, by construction rather than by arithmetic
  }
  const scale = fit.scale * view.zoom;
  const rx = (view.fx - WORLD_W / 2) * scale;
  const ry = (view.fy - WORLD_H / 2) * scale;
  const c = Math.cos(fit.theta);
  const s = Math.sin(fit.theta);
  const px = rx * c - ry * s;
  const py = rx * s + ry * c;
  return {
    theta: fit.theta,
    scale,
    cx: fit.cx - px,
    cy: fit.cy - py * TILT_Y,
    cssScale: fit.cssScale * view.zoom,
  };
}

/**
 * Pan by a CSS-pixel drag delta. Dragging is grabbing the board: content
 * follows the finger, so the focus moves against the delta.
 */
export function panBy(
  view: ViewState,
  dxCss: number,
  dyCss: number,
  fit: Camera,
  vp: Viewport,
  insets: Insets,
  content: ContentBox,
): ViewState {
  const scale = fit.scale * view.zoom;
  const d = screenVecToWorld(dxCss * vp.dpr, (dyCss * vp.dpr) / TILT_Y, fit.theta, scale);
  return clampView({ zoom: view.zoom, fx: view.fx - d.x, fy: view.fy - d.y }, fit, content, vp, insets);
}

/**
 * Zoom by `factor` about a CSS-pixel anchor: the world point under the anchor
 * stays under it. The anchor offset is measured from the usable-box centre
 * (fit.cx/cy), which is where the focus is framed — so the solve is one
 * rotate-and-scale, not a full inverse.
 */
export function zoomAt(
  view: ViewState,
  sxCss: number,
  syCss: number,
  factor: number,
  fit: Camera,
  vp: Viewport,
  insets: Insets,
  content: ContentBox,
): ViewState {
  const zoom = Math.max(1, Math.min(maxZoom(fit), view.zoom * factor));
  if (zoom === view.zoom) return clampView(view, fit, content, vp, insets);

  // Anchor offset from the usable centre, squash removed, in device px.
  const ax = sxCss * vp.dpr - fit.cx;
  const ay = (syCss * vp.dpr - fit.cy) / TILT_Y;

  // World point under the anchor at the CURRENT zoom…
  const before = screenVecToWorld(ax, ay, fit.theta, fit.scale * view.zoom);
  const wx = view.fx + before.x;
  const wy = view.fy + before.y;

  // …must still be under it at the NEW zoom.
  const after = screenVecToWorld(ax, ay, fit.theta, fit.scale * zoom);
  return clampView({ zoom, fx: wx - after.x, fy: wy - after.y }, fit, content, vp, insets);
}

/* --------------------------------------------------------------- animation */

/**
 * A view-to-view ease on the RENDER clock. Sim-independent by construction:
 * the sim neither knows nor cares where the camera is looking.
 */
export interface ViewAnim {
  from: ViewState;
  to: ViewState;
  /** performance.now() at start. */
  at: number;
  ms: number;
}

const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;

/** Sample an animation at `now`; returns `anim.to` when finished (or null anim). */
export function sampleAnim(anim: ViewAnim | null, now: number): ViewState | null {
  if (!anim) return null;
  const t = Math.min(1, Math.max(0, (now - anim.at) / anim.ms));
  const k = easeOutCubic(t);
  return {
    zoom: anim.from.zoom + (anim.to.zoom - anim.from.zoom) * k,
    fx: anim.from.fx + (anim.to.fx - anim.from.fx) * k,
    fy: anim.from.fy + (anim.to.fy - anim.from.fy) * k,
  };
}

export function animDone(anim: ViewAnim | null, now: number): boolean {
  return !anim || now - anim.at >= anim.ms;
}
