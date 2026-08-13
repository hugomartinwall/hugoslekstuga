import { describe, expect, it } from "vitest";
import {
  computeCamera,
  contentBox,
  worldToScreen,
  screenToWorld,
  NO_INSETS,
  THETA_PORTRAIT,
  type Camera,
  type Viewport,
} from "../lib/overrun/render/camera";
import {
  HOME_VIEW,
  composeView,
  clampView,
  panBy,
  zoomAt,
  maxZoom,
  playZoom,
  visibleHalfExtents,
  sampleAnim,
  type ViewState,
} from "../lib/overrun/render/view";
import { WORLD_H, WORLD_W } from "../lib/overrun/sim/state";
import type { Node } from "../lib/overrun/sim/state";

/**
 * The pan/zoom composition layer. The load-bearing invariant: the home view
 * composes to EXACTLY the fit camera, so every guarantee the camera tests
 * make about the fit carries over to a player who never touches the camera.
 */

const mkNode = (x: number, y: number): Node => ({
  id: 0,
  x,
  y,
  owner: 1,
  units: 10,
  size: 1,
  kind: 0,
  guard: 0,
  upgrading: 0,
  selected: false,
});

// A spread board: content box ≈ the full world.
const NODES: Node[] = [
  mkNode(12, 12),
  mkNode(148, 78),
  mkNode(80, 45),
  mkNode(20, 70),
  mkNode(140, 20),
];
const CONTENT = contentBox(NODES);

const DESKTOP: Viewport = { cssW: 1280, cssH: 720, dpr: 2 };
const PHONE_PORTRAIT: Viewport = { cssW: 375, cssH: 812, dpr: 3 };

const fitFor = (vp: Viewport): Camera => computeCamera(vp, NO_INSETS, CONTENT);

describe("the home invariant", () => {
  it("the home view composes to exactly the fit camera", () => {
    for (const vp of [DESKTOP, PHONE_PORTRAIT]) {
      const fit = fitFor(vp);
      expect(composeView(fit, HOME_VIEW)).toBe(fit); // identity, not just equality
    }
  });

  it("zoom = 1 clamps any focus back to the world centre", () => {
    const fit = fitFor(DESKTOP);
    const wild: ViewState = { zoom: 1, fx: 20, fy: 80 };
    const clamped = clampView(wild, fit, CONTENT, DESKTOP, NO_INSETS);
    expect(clamped.fx).toBeCloseTo(WORLD_W / 2, 6);
    expect(clamped.fy).toBeCloseTo(WORLD_H / 2, 6);
  });
});

describe("clamping", () => {
  it("never reveals past the content box at any zoom", () => {
    // On an axis where the visible extent exceeds the content (the fit's
    // non-binding axis letterboxes by construction), the focus pins to the
    // centre; where it is smaller, the reveal edge respects the content box.
    const fit = fitFor(DESKTOP);
    for (const zoom of [1, 1.05, 1.5, 2, 4]) {
      const v = clampView({ zoom, fx: -100, fy: 300 }, fit, CONTENT, DESKTOP, NO_INSETS);
      const { hx, hy } = visibleHalfExtents(DESKTOP, NO_INSETS, fit.theta, fit.scale * v.zoom);
      if (hx < CONTENT.rx) {
        expect(Math.abs(v.fx - WORLD_W / 2) + hx).toBeLessThanOrEqual(CONTENT.rx + 1e-6);
      } else {
        expect(v.fx).toBeCloseTo(WORLD_W / 2, 6);
      }
      if (hy < CONTENT.ry) {
        expect(Math.abs(v.fy - WORLD_H / 2) + hy).toBeLessThanOrEqual(CONTENT.ry + 1e-6);
      } else {
        expect(v.fy).toBeCloseTo(WORLD_H / 2, 6);
      }
    }
  });

  it("caps zoom at the css-target ceiling", () => {
    const fit = fitFor(DESKTOP);
    const v = clampView({ zoom: 99, fx: 80, fy: 45 }, fit, CONTENT, DESKTOP, NO_INSETS);
    expect(v.zoom).toBeCloseTo(maxZoom(fit), 6);
    expect(v.zoom).toBeLessThanOrEqual(4);
  });

  it("desktop gets a modest ceiling, a phone gets a real one", () => {
    const desktopFit = fitFor(DESKTOP);
    const phoneFit = fitFor(PHONE_PORTRAIT);
    expect(maxZoom(desktopFit)).toBeLessThan(2);
    expect(maxZoom(phoneFit)).toBeGreaterThan(2);
    expect(maxZoom(phoneFit)).toBeGreaterThan(maxZoom(desktopFit));
    expect(maxZoom(phoneFit)).toBeLessThanOrEqual(4);
    expect(playZoom(phoneFit)).toBeGreaterThan(1);
    expect(playZoom(phoneFit)).toBeLessThanOrEqual(maxZoom(phoneFit));
  });
});

describe("zoomAt", () => {
  it("keeps the world point under the anchor fixed", () => {
    const fit = fitFor(DESKTOP);
    const anchor = { x: 900, y: 200 }; // CSS px, off-centre
    let view: ViewState = { ...HOME_VIEW };
    const before = screenToWorld(composeView(fit, view), anchor.x, anchor.y, DESKTOP.dpr);
    view = zoomAt(view, anchor.x, anchor.y, 1.3, fit, DESKTOP, NO_INSETS, CONTENT);
    const cam = composeView(fit, view);
    const after = worldToScreen(cam, before.x, before.y, DESKTOP.dpr);
    // The anchor point may shift only if clamping engaged; at 1.3× on a
    // desktop fit it should not.
    expect(after.x).toBeCloseTo(anchor.x, 4);
    expect(after.y).toBeCloseTo(anchor.y, 4);
  });

  it("round-trips home: zoom in then fully out lands exactly on the fit", () => {
    const fit = fitFor(DESKTOP);
    let view: ViewState = { ...HOME_VIEW };
    view = zoomAt(view, 400, 500, 1.4, fit, DESKTOP, NO_INSETS, CONTENT);
    view = zoomAt(view, 640, 360, 1 / 100, fit, DESKTOP, NO_INSETS, CONTENT);
    expect(view.zoom).toBe(1);
    expect(view.fx).toBeCloseTo(WORLD_W / 2, 6);
    expect(view.fy).toBeCloseTo(WORLD_H / 2, 6);
    expect(composeView(fit, { zoom: 1, fx: WORLD_W / 2, fy: WORLD_H / 2 })).toBe(fit);
  });
});

describe("panBy", () => {
  it("dragging right moves the view left (content follows the finger)", () => {
    const fit = fitFor(DESKTOP);
    let view = zoomAt({ ...HOME_VIEW }, 640, 360, 2, fit, DESKTOP, NO_INSETS, CONTENT);
    const fx0 = view.fx;
    view = panBy(view, 60, 0, fit, DESKTOP, NO_INSETS, CONTENT);
    expect(view.fx).toBeLessThan(fx0);
  });

  it("panning against the clamp wall sticks instead of revealing void", () => {
    const fit = fitFor(DESKTOP);
    let view = zoomAt({ ...HOME_VIEW }, 640, 360, 2, fit, DESKTOP, NO_INSETS, CONTENT);
    for (let i = 0; i < 50; i++) view = panBy(view, -400, 0, fit, DESKTOP, NO_INSETS, CONTENT);
    const { hx } = visibleHalfExtents(DESKTOP, NO_INSETS, fit.theta, fit.scale * view.zoom);
    expect(view.fx + hx).toBeLessThanOrEqual(WORLD_W / 2 + CONTENT.rx + 1e-6);
    // And it is AT the wall, not short of it.
    expect(view.fx + hx).toBeCloseTo(WORLD_W / 2 + CONTENT.rx, 4);
  });
});

describe("portrait (quarter-turned) views", () => {
  it("all invariants hold under the portrait rotation", () => {
    const fit = fitFor(PHONE_PORTRAIT);
    expect(fit.theta).toBe(THETA_PORTRAIT); // sanity: this viewport rotates

    // Anchor-fixed zoom in rotated space. Near-centre anchor at a DEEP zoom:
    // shallow zooms leave near-zero clamp range (the visible extent almost
    // covers the content), and clamping beats anchor fidelity by design —
    // the aggressive-clamp case is covered by the assertions below.
    const anchor = { x: 200, y: 380 };
    let view: ViewState = { ...HOME_VIEW };
    const before = screenToWorld(composeView(fit, view), anchor.x, anchor.y, PHONE_PORTRAIT.dpr);
    view = zoomAt(view, anchor.x, anchor.y, 2.5, fit, PHONE_PORTRAIT, NO_INSETS, CONTENT);
    const after = worldToScreen(composeView(fit, view), before.x, before.y, PHONE_PORTRAIT.dpr);
    expect(after.x).toBeCloseTo(anchor.x, 3);
    expect(after.y).toBeCloseTo(anchor.y, 3);

    // Pan clamp still respects the content box along the board's own axes.
    for (let i = 0; i < 60; i++) view = panBy(view, 0, 500, fit, PHONE_PORTRAIT, NO_INSETS, CONTENT);
    const { hx, hy } = visibleHalfExtents(
      PHONE_PORTRAIT,
      NO_INSETS,
      fit.theta,
      fit.scale * view.zoom,
    );
    expect(Math.abs(view.fx - WORLD_W / 2) + hx).toBeLessThanOrEqual(CONTENT.rx + 1e-6);
    expect(Math.abs(view.fy - WORLD_H / 2) + hy).toBeLessThanOrEqual(CONTENT.ry + 1e-6);
  });
});

describe("animation sampling", () => {
  it("eases from → to on the render clock and clamps at both ends", () => {
    const anim = {
      from: { zoom: 1, fx: 80, fy: 45 },
      to: { zoom: 2.5, fx: 40, fy: 30 },
      at: 1000,
      ms: 500,
    };
    expect(sampleAnim(anim, 900)).toEqual(anim.from); // before start: clamped to from
    expect(sampleAnim(anim, 1000)).toEqual(anim.from);
    expect(sampleAnim(anim, 1500)).toEqual(anim.to);
    expect(sampleAnim(anim, 9999)).toEqual(anim.to);
    const mid = sampleAnim(anim, 1250)!;
    expect(mid.zoom).toBeGreaterThan(1);
    expect(mid.zoom).toBeLessThan(2.5);
    expect(sampleAnim(null, 0)).toBeNull();
  });
});
