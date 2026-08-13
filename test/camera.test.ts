import { describe, expect, it } from "vitest";
import { createLevel, worldScaleForLevel } from "../lib/overrun/sim/level";
import { NODE_R } from "../lib/overrun/sim/constants";
import { WORLD_H, WORLD_W } from "../lib/overrun/sim/state";
import {
  applyCamera,
  computeCamera,
  contentBox,
  downVector,
  lightVector,
  MIN_DIAMETER_CSS,
  MIN_SEPARATION_CSS,
  NO_INSETS,
  screenRight,
  screenToWorld,
  THETA_LANDSCAPE,
  THETA_PORTRAIT,
  TILT_Y,
  worldToScreen,
  type Camera,
  type Insets,
  type Viewport,
} from "../lib/overrun/render/camera";
import { clampView, composeView, HOME_VIEW, playZoom } from "../lib/overrun/render/view";
import { computeUiLayout, reservedInsets } from "../lib/overrun/render/ui-layout";
import { notched, SUPPORTED, VIEWPORTS } from "./viewports";

const vp = (v: { cssW: number; cssH: number; dpr: number }): Viewport => ({
  cssW: v.cssW,
  cssH: v.cssH,
  dpr: v.dpr,
});

/**
 * Look a viewport up by NAME. Several tests used to index into VIEWPORTS,
 * and one matrix insertion silently retargeted them — `VIEWPORTS[3]`, the
 * "landscape" leg of the rotation round-trip, became a portrait phone and the
 * test kept passing while asserting nothing.
 */
const byName = (n: string) => {
  const v = VIEWPORTS.find((x) => x.name === n);
  if (!v) throw new Error(`no viewport named ${n}`);
  return v;
};

/**
 * The chrome the camera actually has to work around, taken from the real
 * layout rather than a hand-written approximation — otherwise this suite can
 * pass while the shipping game reserves a different band.
 */
const chromeFor = (v: { cssW: number; cssH: number }): Insets => {
  const safe = notched(v.cssH);
  return reservedInsets(computeUiLayout(v.cssW, v.cssH, safe), safe);
};

/**
 * The level's board half-extents, exactly as the renderer feeds them to
 * contentBox: bigger late boards extend about the same fixed centre, and the
 * ?? defaults are the classic one-screen rect.
 */
const halfFor = (s: ReturnType<typeof createLevel>) => ({
  rx: s.cfg.worldHx ?? WORLD_W / 2,
  ry: s.cfg.worldHy ?? WORLD_H / 2,
});

/**
 * The camera legibility is owed at.
 *
 * For one-screen boards (worldScale 1) that is the FIT itself — HOME_VIEW
 * composes to the fit bit-for-bit (the invariant view.ts is built on), so the
 * teaching band's guarantees stay exactly what they always were. For the
 * scrolling bands the fit is deliberately an overview of a board bigger than
 * the screen; 44 px tap targets there are the PLAY ZOOM's job — the camera a
 * larger-than-one-screen board opens at (see PLAY_CSS in view.ts) — so that is
 * the camera the legibility bars are asserted against.
 */
const legibilityCam = (
  state: ReturnType<typeof createLevel>,
  v: { cssW: number; cssH: number; dpr: number },
  box: { rx: number; ry: number },
): Camera => {
  const insets = chromeFor(v);
  const fit = computeCamera(vp(v), insets, box);
  const view =
    worldScaleForLevel(state.cfg.level) === 1
      ? HOME_VIEW
      : clampView(
          { zoom: playZoom(fit), fx: WORLD_W / 2, fy: WORLD_H / 2 },
          fit,
          box,
          vp(v),
          insets,
        );
  return composeView(fit, view);
};

/**
 * The pre-camera framing, reproduced exactly (renderer.resize before this
 * change): fit-contain the *whole* 160×90 rect into the *whole* viewport, with
 * no reservation for chrome. Kept as a fixture so the regression this camera
 * exists to fix stays visible rather than becoming folklore.
 */
function legacyCssScale(cssW: number, cssH: number): number {
  return Math.min(cssW / WORLD_W, cssH / (WORLD_H * TILT_Y));
}

function minSeparationCss(cam: Camera, nodes: ReturnType<typeof createLevel>["nodes"], dpr: number): number {
  let min = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = worldToScreen(cam, nodes[i]!.x, nodes[i]!.y, dpr);
      const b = worldToScreen(cam, nodes[j]!.x, nodes[j]!.y, dpr);
      min = Math.min(min, Math.hypot(a.x - b.x, a.y - b.y));
    }
  }
  return min;
}

describe("the regression this camera exists to fix", () => {
  it("legacy framing left nodes 37.5 CSS px apart on a 375×812 phone", () => {
    // MIN_SPACING is 16 wu; fit-containing the whole 160×90 rect into 375×812
    // gave 2.34 CSS px/wu in portrait, so adjacent nodes were 37.5 px apart —
    // unhittable no matter how generous the touch radius.
    const cssScale = legacyCssScale(375, 812);
    expect(cssScale).toBeCloseTo(2.344, 2);
    expect(16 * cssScale).toBeLessThan(44);
  });

  it("legacy framing wasted three quarters of a portrait screen", () => {
    const boardH = WORLD_H * TILT_Y * legacyCssScale(375, 812);
    expect(boardH / 812).toBeLessThan(0.3);
  });
});

describe("contentBox", () => {
  it("is symmetric about the world centre, so no faction is cropped harder", () => {
    // The level's half-extents go in as the clamp: on scrolling bands the
    // content genuinely extends past the classic 80×45, and clamping to the
    // default rect would crop it — which is exactly the asymmetry-by-cropping
    // this test forbids.
    for (let level = 1; level <= 25; level++) {
      const s = createLevel(level);
      const box = contentBox(s.nodes, halfFor(s));
      for (const n of s.nodes) {
        const r = NODE_R[n.size]!;
        expect(Math.abs(n.x - WORLD_W / 2) + r).toBeLessThanOrEqual(box.rx + 1e-9);
        expect(Math.abs(n.y - WORLD_H / 2) + r).toBeLessThanOrEqual(box.ry + 1e-9);
      }
    }
  });

  it("never exceeds the board", () => {
    // "The board" is the level's own half-extents now, not the classic rect.
    for (let level = 1; level <= 25; level++) {
      const s = createLevel(level);
      const half = halfFor(s);
      const box = contentBox(s.nodes, half);
      expect(box.rx, `L${level}`).toBeLessThanOrEqual(half.rx);
      expect(box.ry, `L${level}`).toBeLessThanOrEqual(half.ry);
    }
  });

  it("reports a tighter box for 3-way disc boards than for duels", () => {
    // genTriad confines nodes to a centred disc bounded by the SHORT half-
    // extent (radius 35 on the classic board, 53 in L12's 1.4 band) — so a
    // triad never needs the full half-width a mirrored duel does, even though
    // L12's board is 1.4× the size of L2's. That cramping is also why triads
    // are now rare; see factionsForLevel.
    const l12 = createLevel(12);
    const l2 = createLevel(2);
    const triad = contentBox(l12.nodes, halfFor(l12));
    const duel = contentBox(l2.nodes, halfFor(l2));
    expect(triad.rx).toBeLessThan(duel.rx);
  });
});

describe("computeCamera — legibility", () => {
  it("meets the 44 CSS px node diameter target on roomy screens, and stays tappable on small ones", () => {
    // Phase 3A closed most of this gap. The old comment here blamed late-game
    // node *count* and said reducing it was the remedy — that was wrong, and
    // measuring it is what showed why: the camera's scale is set by the board's
    // world extent, which the outermost nodes pin near the map margin whatever
    // the count, so diameter barely moves with it. Node *radius* is the lever.
    // Radii grew ~49%, the reserved HUD band shrank from 172 to 125 CSS px on a
    // phone, and the worst case went 27.5 → 42.7 px.
    //
    // The remaining floor is one viewport: 360×640, the smallest supported
    // Android, at 42.7 px against a 44 px target. Every iPhone clears the
    // target in both orientations, which is the bar we set. Closing the last
    // 1.3 px would cost another radius bump and therefore more nodes, and it is
    // not worth it — so this records the real number rather than pretending.
    //
    // Per-level board sizes: only the one-screen teaching band (worldScale 1)
    // is judged at the fit — its worst case is 43.0 px, L6 on that same
    // Android. Scrolling-band boards are judged at the play zoom they open at
    // (legibilityCam), where PLAY_CSS pins the small-node diameter at ~88 px
    // on every supported viewport.
    const SMALL_SCREEN_FLOOR = 42;
    expect(SMALL_SCREEN_FLOOR).toBeLessThan(MIN_DIAMETER_CSS);

    let worst = Infinity;
    for (let level = 1; level <= 25; level++) {
      const state = createLevel(level);
      const box = contentBox(state.nodes, halfFor(state));
      for (const v of SUPPORTED) {
        const cam = legibilityCam(state, v, box);
        const smallest = Math.min(...state.nodes.map((n) => 2 * NODE_R[n.size]! * cam.cssScale));
        expect(smallest, `L${level} @ ${v.name}`).toBeGreaterThanOrEqual(SMALL_SCREEN_FLOOR);
        worst = Math.min(worst, smallest);
      }
    }
    // Everything except that one Android clears the real target.
    for (const v of SUPPORTED.filter((x) => !(x.cssW === 360 && x.cssH === 640))) {
      for (const level of [2, 6, 12]) {
        const state = createLevel(level);
        const cam = legibilityCam(state, v, contentBox(state.nodes, halfFor(state)));
        const smallest = 2 * NODE_R[0] * cam.cssScale;
        expect(smallest, `L${level} @ ${v.name}`).toBeGreaterThanOrEqual(MIN_DIAMETER_CSS);
      }
    }
  });

  it("clears both legibility targets on an iPhone, in both orientations", () => {
    // The bar Hugo set: "a maximum that works on a normal iPhone". Asserted
    // directly rather than inferred from the aggregate floors above, because it
    // is the actual acceptance criterion for the whole node-resize phase.
    // Scrolling-band boards hold the bar at their play zoom (legibilityCam);
    // the teaching band still holds it at the fit, byte-for-byte.
    const iphones = SUPPORTED.filter((v) => v.name.startsWith("iPhone"));
    expect(iphones.length, "portrait and landscape iPhones in the matrix").toBeGreaterThanOrEqual(3);
    for (const v of iphones) {
      for (let level = 1; level <= 25; level++) {
        const state = createLevel(level);
        const cam = legibilityCam(state, v, contentBox(state.nodes, halfFor(state)));
        const smallest = Math.min(...state.nodes.map((n) => 2 * NODE_R[n.size]! * cam.cssScale));
        expect(smallest, `diameter L${level} @ ${v.name}`).toBeGreaterThanOrEqual(MIN_DIAMETER_CSS);
        expect(minSeparationCss(cam, state.nodes, v.dpr), `separation L${level} @ ${v.name}`)
          .toBeGreaterThanOrEqual(MIN_SEPARATION_CSS);
      }
    }
  });

  it("keeps neighbouring nodes separately tappable on every supported viewport", () => {
    // Now met everywhere: MIN_SEPARATION_CSS is no longer a target the game
    // misses, it is a floor the game clears. Worst case over L1-25 and the
    // whole supported matrix is 67.0 px (L2 on a landscape iPhone), against the
    // 56 px target — measured at the teaching band's fit; scrolling bands are
    // measured at their play zoom, where MIN_SPACING × PLAY_CSS keeps
    // neighbours ~124 px apart. The old 40 recorded a 21-node board on a
    // landscape phone at 41.9 px; both the node budget and the HUD band
    // changed under it.
    const FLOOR = MIN_SEPARATION_CSS;
    for (let level = 1; level <= 25; level++) {
      const state = createLevel(level);
      const box = contentBox(state.nodes, halfFor(state));
      for (const v of SUPPORTED) {
        const cam = legibilityCam(state, v, box);
        const sep = minSeparationCss(cam, state.nodes, v.dpr);
        expect(sep, `L${level} @ ${v.name}`).toBeGreaterThanOrEqual(FLOOR);
        // Roomy screens must hit the real target, not just the floor.
        if (v.cssW >= 900 && v.cssH >= 500) {
          expect(sep, `L${level} @ ${v.name}`).toBeGreaterThanOrEqual(MIN_SEPARATION_CSS);
        }
      }
    }
  });

  it("nearly doubles the portrait node separation versus legacy framing", () => {
    const { nodes } = createLevel(2);
    const v = byName("iPhone X portrait");
    const cam = computeCamera(vp(v), chromeFor(v), contentBox(nodes));
    const after = minSeparationCss(cam, nodes, v.dpr);
    const before = 16 * legacyCssScale(v.cssW, v.cssH);
    expect(after / before).toBeGreaterThan(1.9);
  });
});

describe("computeCamera — containment", () => {
  it("keeps every node fully on screen, clear of reserved chrome", () => {
    // A statement about the FIT camera: given the level's half-extents, the
    // fit frames the whole board — on scrolling bands that is the zoomed-out
    // overview — so no node may be cropped or sit under chrome there.
    for (let level = 1; level <= 25; level++) {
      const s = createLevel(level);
      const nodes = s.nodes;
      const box = contentBox(nodes, halfFor(s));
      for (const v of VIEWPORTS) {
        const cam = computeCamera(vp(v), chromeFor(v), box);
        for (const n of nodes) {
          const p = worldToScreen(cam, n.x, n.y, v.dpr);
          const r = NODE_R[n.size]! * cam.cssScale;
          const where = `L${level} @ ${v.name} node ${n.id}`;
          const ch = chromeFor(v);
          expect(p.x - r, where).toBeGreaterThanOrEqual(ch.left - 0.5);
          expect(p.x + r, where).toBeLessThanOrEqual(v.cssW - ch.right + 0.5);
          expect(p.y - r, where).toBeGreaterThanOrEqual(ch.top - 0.5);
          expect(p.y + r, where).toBeLessThanOrEqual(v.cssH - ch.bottom + 0.5);
        }
      }
    }
  });
});

describe("computeCamera — rotation", () => {
  it("quarter-turns on phone portrait and stays upright on landscape", () => {
    const box = contentBox(createLevel(2).nodes);
    // By name, not index — an index survived one viewport-matrix insertion
    // already and silently started testing a different device.
    const byName = (n: string) => VIEWPORTS.find((v) => v.name === n)!;
    const theta = (v: (typeof VIEWPORTS)[number]) =>
      computeCamera(vp(v), chromeFor(v), box).theta;
    expect(theta(byName("iPhone X portrait"))).toBe(THETA_PORTRAIT);
    expect(theta(byName("iPhone X landscape"))).toBe(THETA_LANDSCAPE);
    expect(theta(byName("1080p"))).toBe(THETA_LANDSCAPE);
  });

  it("leaves the player in the lower half of a portrait screen", () => {
    // genMirror samples the player at low x; a −90° turn must send low x down,
    // not up, or the player ends up reaching over the whole board.
    const state = createLevel(2);
    const v = byName("iPhone X portrait");
    const cam = computeCamera(vp(v), chromeFor(v), contentBox(state.nodes));
    const player = state.nodes.find((n) => n.owner === 1)!;
    expect(worldToScreen(cam, player.x, player.y, v.dpr).y).toBeGreaterThan(v.cssH / 2);
  });

  it("has a hysteresis band, and it is where the rotation actually flips", () => {
    // An earlier version of this test swept 600×600–605, nowhere near the
    // crossing — it passed identically with the hysteresis deleted. Find the
    // real threshold by bisection first, then probe around it.
    const box = contentBox(createLevel(2).nodes);
    const cssW = 600;
    const thetaAt = (cssH: number, prev?: Camera) =>
      computeCamera({ cssW, cssH, dpr: 2 }, chromeFor({ cssW, cssH }), box, prev).theta;

    let lo = 400; // landscape
    let hi = 1600; // portrait
    expect(thetaAt(lo)).toBe(THETA_LANDSCAPE);
    expect(thetaAt(hi)).toBe(THETA_PORTRAIT);
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (thetaAt(mid) === THETA_PORTRAIT) hi = mid;
      else lo = mid;
    }
    const enterAt = hi;

    // Coming from landscape, just below the enter threshold stays landscape.
    expect(thetaAt(enterAt - 1)).toBe(THETA_LANDSCAPE);
    // Having entered portrait, the same height must NOT immediately fall back —
    // that gap is the hysteresis, and without it a 1 px wobble would strobe.
    const portrait = computeCamera(
      { cssW, cssH: enterAt + 1, dpr: 2 },
      chromeFor({ cssW, cssH: enterAt + 1 }),
      box,
    );
    expect(portrait.theta).toBe(THETA_PORTRAIT);
    expect(thetaAt(enterAt - 1, portrait)).toBe(THETA_PORTRAIT);
  });

  it("does not oscillate when swept back and forth across the threshold", () => {
    const box = contentBox(createLevel(2).nodes);
    const cssW = 600;
    // Sweep up through the crossing, then back down, feeding each result
    // forward. A camera without hysteresis flips twice; with it, once.
    let cam: Camera | undefined;
    let flips = 0;
    let last: number | undefined;
    for (const cssH of [...Array(60).keys()]
      .map((i) => 700 + i * 5)
      .concat([...Array(60).keys()].map((i) => 995 - i * 5))) {
      cam = computeCamera({ cssW, cssH, dpr: 2 }, chromeFor({ cssW, cssH }), box, cam);
      if (last !== undefined && cam.theta !== last) flips++;
      last = cam.theta;
    }
    expect(flips).toBeLessThanOrEqual(2);
  });

  it("returns to the same rotation after a round trip", () => {
    const box = contentBox(createLevel(2).nodes);
    const portrait = computeCamera(vp(byName("iPhone X portrait")), chromeFor(byName("iPhone X portrait")), box);
    const landscape = computeCamera(vp(byName("iPhone X landscape")), chromeFor(byName("iPhone X landscape")), box, portrait);
    const back = computeCamera(vp(byName("iPhone X portrait")), chromeFor(byName("iPhone X portrait")), box, landscape);
    expect(back.theta).toBe(portrait.theta);
  });
});

describe("computeCamera — fairness", () => {
  it("preserves pairwise distances up to the fixed squash", () => {
    // The camera must be a similarity: any two node pairs the same distance
    // apart in the sim must be the same distance apart on screen, or the
    // geometric fairness the mapgen guarantees is lost in presentation.
    for (const level of [2, 6, 12, 20]) {
      const s = createLevel(level);
      const nodes = s.nodes;
      const box = contentBox(nodes, halfFor(s));
      for (const v of VIEWPORTS) {
        const cam = computeCamera(vp(v), chromeFor(v), box);
        const unsquash = (p: { x: number; y: number }) => ({ x: p.x, y: p.y / TILT_Y });
        const ratios: number[] = [];
        for (let i = 0; i < nodes.length; i++) {
          for (let j = i + 1; j < nodes.length; j++) {
            const a = unsquash(worldToScreen(cam, nodes[i]!.x, nodes[i]!.y, v.dpr));
            const b = unsquash(worldToScreen(cam, nodes[j]!.x, nodes[j]!.y, v.dpr));
            const world = Math.hypot(nodes[i]!.x - nodes[j]!.x, nodes[i]!.y - nodes[j]!.y);
            ratios.push(Math.hypot(a.x - b.x, a.y - b.y) / world);
          }
        }
        const spread = Math.max(...ratios) - Math.min(...ratios);
        expect(spread, `L${level} @ ${v.name}`).toBeLessThan(1e-9);
      }
    }
  });

  it("centres exactly on the world centre", () => {
    const box = contentBox(createLevel(6).nodes);
    for (const v of VIEWPORTS) {
      const cam = computeCamera(vp(v), NO_INSETS, box);
      const c = worldToScreen(cam, WORLD_W / 2, WORLD_H / 2, v.dpr);
      expect(c.x).toBeCloseTo(v.cssW / 2, 6);
      expect(c.y).toBeCloseTo(v.cssH / 2, 6);
    }
  });
});

describe("screenToWorld / worldToScreen", () => {
  it("round-trips in both rotations", () => {
    const box = contentBox(createLevel(2).nodes);
    for (const v of VIEWPORTS) {
      const cam = computeCamera(vp(v), chromeFor(v), box);
      for (const p of [
        { x: 80, y: 45 },
        { x: 14, y: 8 },
        { x: 152, y: 84 },
        { x: 100, y: 20 },
      ]) {
        const s = worldToScreen(cam, p.x, p.y, v.dpr);
        const back = screenToWorld(cam, s.x, s.y, v.dpr);
        expect(back.x, v.name).toBeCloseTo(p.x, 6);
        expect(back.y, v.name).toBeCloseTo(p.y, 6);
      }
    }
  });
});

describe("orientation vectors", () => {
  it("downVector points down the screen in both rotations", () => {
    const box = contentBox(createLevel(2).nodes);
    for (const v of [byName("iPhone X portrait"), byName("1080p")]) {
      const cam = computeCamera(vp(v), chromeFor(v), box);
      const d = downVector(cam);
      const origin = worldToScreen(cam, 80, 45, v.dpr);
      const moved = worldToScreen(cam, 80 + d.x, 45 + d.y, v.dpr);
      expect(moved.y - origin.y, v.name).toBeGreaterThan(0);
      expect(Math.abs(moved.x - origin.x), v.name).toBeLessThan(1e-6);
    }
  });

  it("screenRight points right on screen in both rotations", () => {
    // The other perpendicular points left. Getting this backwards drew the
    // chevron cost label on top of the chevron in portrait.
    const box = contentBox(createLevel(2).nodes);
    for (const v of [byName("iPhone X portrait"), byName("1080p")]) {
      const cam = computeCamera(vp(v), chromeFor(v), box);
      const a = screenRight(downVector(cam));
      const origin = worldToScreen(cam, 80, 45, v.dpr);
      const moved = worldToScreen(cam, 80 + a.x, 45 + a.y, v.dpr);
      expect(moved.x - origin.x, v.name).toBeGreaterThan(0);
      expect(Math.abs(moved.y - origin.y), v.name).toBeLessThan(1e-6);
    }
  });

  it("lightVector points to the screen's top-left in both rotations", () => {
    const box = contentBox(createLevel(2).nodes);
    for (const v of [byName("iPhone X portrait"), byName("1080p")]) {
      const cam = computeCamera(vp(v), chromeFor(v), box);
      const l = lightVector(cam);
      const origin = worldToScreen(cam, 80, 45, v.dpr);
      const moved = worldToScreen(cam, 80 + l.x, 45 + l.y, v.dpr);
      expect(moved.x - origin.x, v.name).toBeLessThan(0);
      expect(moved.y - origin.y, v.name).toBeLessThan(0);
    }
  });
});

describe("applyCamera", () => {
  it("issues the same transform screenToWorld inverts", () => {
    // Replay the canvas calls against a plain 2×3 matrix and check a point.
    const box = contentBox(createLevel(2).nodes);
    const v = byName("iPhone X portrait");
    const cam = computeCamera(vp(v), chromeFor(v), box);

    let m = [1, 0, 0, 1, 0, 0];
    const mul = (n: number[]) => {
      const [a, b, c, d, e, f] = m as [number, number, number, number, number, number];
      const [a2, b2, c2, d2, e2, f2] = n as [number, number, number, number, number, number];
      m = [
        a * a2 + c * b2,
        b * a2 + d * b2,
        a * c2 + c * d2,
        b * c2 + d * d2,
        a * e2 + c * f2 + e,
        b * e2 + d * f2 + f,
      ];
    };
    const fake = {
      translate: (x: number, y: number) => mul([1, 0, 0, 1, x, y]),
      scale: (x: number, y: number) => mul([x, 0, 0, y, 0, 0]),
      rotate: (r: number) => mul([Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]),
    } as unknown as CanvasRenderingContext2D;

    applyCamera(fake, cam);

    const world = { x: 40, y: 70 };
    const [a, b, c, d, e, f] = m as [number, number, number, number, number, number];
    const device = { x: a * world.x + c * world.y + e, y: b * world.x + d * world.y + f };
    const expected = worldToScreen(cam, world.x, world.y, v.dpr);
    expect(device.x / v.dpr).toBeCloseTo(expected.x, 6);
    expect(device.y / v.dpr).toBeCloseTo(expected.y, 6);
  });
});

describe("desktop framing", () => {
  it("uses more of a 1080p screen than the legacy whole-rect fit", () => {
    // Fitting content rather than the 160×90 rect is the point of this module.
    // The old maths silently collapsed to the legacy fit here, so this is the
    // assertion that would have caught it.
    for (const v of [byName("720p"), byName("1080p")]) {
      for (const level of [2, 6, 12]) {
        const cam = computeCamera(vp(v), NO_INSETS, contentBox(createLevel(level).nodes));
        expect(cam.cssScale, `L${level} @ ${v.name}`).toBeGreaterThan(legacyCssScale(v.cssW, v.cssH));
        expect(cam.theta).toBe(THETA_LANDSCAPE);
      }
    }
  });
});

describe("the board actually fills the screen", () => {
  /**
   * Replaces a claim that was never true of the board.
   *
   * SUBMISSION-CHECKLIST.md advertised "portrait PLAYFIELD coverage, not just
   * chrome tap-target size … the board keeps >66% of screen height", and cited
   * an assertion in ui-layout.test.ts that measures `cssH - insets` — the
   * viewport height left over after chrome. That is a statement about how much
   * room the HUD eats. It never calls `computeCamera`, never touches
   * `contentBox`, and cannot tell "the board fills the space" from "the board
   * is a thin strip floating in empty space" — which is verbatim the bug the
   * rejection was traced to.
   *
   * So: measure the rendered board. Rotate the content half-extents by the
   * camera's theta, apply the 2.5D squash, scale to CSS px. That is exactly
   * what `applyCamera` puts on screen.
   */
  const boardSize = (cam: Camera, c: { rx: number; ry: number }) => {
    const { theta, cssScale: s } = cam;
    const cos = Math.abs(Math.cos(theta));
    const sin = Math.abs(Math.sin(theta));
    return {
      w: 2 * s * (c.rx * cos + c.ry * sin),
      h: 2 * s * (c.rx * sin + c.ry * cos) * TILT_Y,
    };
  };

  // Measured at the FIT — on scrolling bands that is the zoomed-out home
  // view, and the rejection case ("a thin strip floating in empty space") is
  // exactly as fatal there. The fit is a similarity, so these shares are
  // properties of the content box's ASPECT and carry across board sizes; the
  // per-level values only move where a band changed a level's topology.
  const measure = (v: (typeof VIEWPORTS)[number], level: number) => {
    const safe = notched(v.cssH);
    const s = createLevel(level);
    const c = contentBox(s.nodes, halfFor(s));
    const layout = computeUiLayout(v.cssW, v.cssH, safe);
    const ins = reservedInsets(layout, safe);
    const cam = computeCamera({ cssW: v.cssW, cssH: v.cssH, dpr: v.dpr }, ins, c);
    const b = boardSize(cam, c);
    return {
      ...b,
      usableW: v.cssW - ins.left - ins.right,
      usableH: v.cssH - ins.top - ins.bottom,
      screenShare: (b.w * b.h) / (v.cssW * v.cssH),
    };
  };

  it("leaves nothing on the table: the fit is tight on its binding axis", () => {
    // The real invariant. Whichever axis binds, the board fills it — so the
    // only unused space is the letterbox the board's own aspect ratio forces.
    for (const v of VIEWPORTS) {
      for (const level of [1, 9, 12, 14]) {
        const m = measure(v, level);
        const fill = Math.max(m.w / m.usableW, m.h / m.usableH);
        expect(fill, `${v.name} L${level}: fills only ${(fill * 100).toFixed(0)}%`).toBeGreaterThan(
          0.98,
        );
        // And never overflows the box it was fitted into.
        expect(m.w, `${v.name} L${level} too wide`).toBeLessThanOrEqual(m.usableW + 0.5);
        expect(m.h, `${v.name} L${level} too tall`).toBeLessThanOrEqual(m.usableH + 0.5);
      }
    }
  });

  it("gives the board a real share of the screen on every supported size", () => {
    // Per-topology floors, because the honest number differs by geometry. The
    // bug being guarded against put the board at roughly a fifth of a 375x812
    // phone; every floor is comfortably above that. Duels/quads (L1/L9/L14)
    // hold 30% — the binding case is iPad portrait's 37% (L9's band-1.4 box
    // is fractionally taller and bottoms out at 41%), where a 16:9 board in a
    // 3:4 screen is width-bound and letterboxes vertically. The triad (L12) is
    // a 120° disc bounded by the SHORT world axis, so its content box is small
    // by construction: it measures 27% on the widest landscape phone — the
    // same number at 1.4× board scale, because the fit shares are aspect
    // properties, not size properties. Its 25% floor is a regression pin, not
    // an aspiration. (An earlier version swept only [1, 14] — exactly the
    // levels that clear a blanket 30%.)
    const failures: string[] = [];
    for (const v of SUPPORTED) {
      for (const level of [1, 9, 12, 14]) {
        const floor = level === 12 ? 0.25 : 0.3;
        const m = measure(v, level);
        if (m.screenShare < floor) {
          failures.push(`${v.name} L${level}: ${(m.screenShare * 100).toFixed(0)}%`);
        }
      }
    }
    expect(failures, `board too small: ${failures.join("; ")}`).toEqual([]);
  });

  it("keeps a portrait PHONE's board tall — the rejection case, per topology", () => {
    // Stated for phones only, because it is false in general: iPad portrait
    // sits at 37% for the geometric reason above, and the checklist claimed
    // ">66% on every viewport" without ever measuring one. The floor is per
    // topology for the same reason as the share test: rect boards (L1/L14)
    // clear 70%; the L9 quad now measures 74-75% (it was 66% as a one-screen
    // 13-node board; its 1.4-band content box is fractionally taller) and the
    // L12 triad disc 45% on portrait phones — geometry, pinned so regressions
    // still show. L9's floor stays at the old 0.6 deliberately: the pin
    // guards against the thin-strip regression, not against the band's bonus.
    const phones = SUPPORTED.filter((v) => v.cssW < 500 && v.cssH > v.cssW);
    expect(phones.length, "no portrait phones in the matrix").toBeGreaterThan(0);
    for (const v of phones) {
      for (const level of [1, 9, 12, 14]) {
        const floor = level === 12 ? 0.4 : level === 9 ? 0.6 : 0.7;
        const m = measure(v, level);
        const share = m.h / v.cssH;
        expect(share, `${v.name} L${level}: ${(share * 100).toFixed(0)}% of height`).toBeGreaterThan(
          floor,
        );
      }
    }
  });
});
