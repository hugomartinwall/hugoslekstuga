import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_TUNE } from "../../lib/knuff/content/tune";
import { createKnuff, type KnuffHandle } from "../../lib/knuff/game";
import { createStore } from "../../lib/knuff/save";
import { createState } from "../../lib/knuff/sim/state";
import { step } from "../../lib/knuff/sim/step";
import type { State } from "../../lib/knuff/sim/types";
import { stampRect } from "../../lib/knuff/render/bake";
import { FLICK_TICKS, createEffects } from "../../lib/knuff/render/effects";
import { C, rgba } from "../../lib/knuff/render/palette";
import type { SimEvent } from "../../lib/knuff/sim/types";
import { night, put } from "./room";
import { FONTS, MemoryStorage, installBrowser, type Browser } from "./browser";

/**
 * The picture on the pixel grid (§9.1: "every rectangle is snapped to
 * whole device pixels when it is drawn"), held where it went wrong: him
 * drawn bigger by Wide and squashed against a cushion. Scaled by the
 * painter's own `ctx.scale`, a 6 px cell became 6.92 px and every cell
 * edge a soft seam across his body for the rest of the night (the play
 * check of step 6).
 *
 * The whole game is made in the stand-in browser with a canvas that keeps
 * every rectangle it is asked to fill or stamp, in device pixels, after
 * the transform; the canvases the game makes for itself keep theirs too.
 */

type Rect = { x0: number; y0: number; x1: number; y1: number; what: string; on: string; color: string };

/** A 2D context that draws nothing and keeps every rectangle, transformed, in `out`. */
function recordingContext(name: string, out: Rect[]): CanvasRenderingContext2D {
  let m = [1, 0, 0, 1, 0, 0];
  const stack: number[][] = [];
  const at = (x: number, y: number) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  const props: Record<string | symbol, unknown> = { globalAlpha: 1, lineWidth: 1, font: "10px sans-serif", fillStyle: "#000", strokeStyle: "#000" };
  const keep = (what: string, x: number, y: number, w: number, h: number) => {
    const [ax, ay] = at(x, y);
    const [bx, by] = at(x + w, y + h);
    out.push({ x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by), what, on: name, color: String(props.fillStyle) });
  };
  const calls: Record<string, (...a: never[]) => unknown> = {
    save: () => void stack.push(m.slice()),
    restore: () => void (m = stack.pop() ?? [1, 0, 0, 1, 0, 0]),
    setTransform: (a: number, b: number, c: number, d: number, e: number, f: number) => void (m = [a, b, c, d, e, f]),
    resetTransform: () => void (m = [1, 0, 0, 1, 0, 0]),
    translate: (x: number, y: number) => void (m = [m[0], m[1], m[2], m[3], m[4] + m[0] * x + m[2] * y, m[5] + m[1] * x + m[3] * y]),
    scale: (x: number, y: number) => void (m = [m[0] * x, m[1] * x, m[2] * y, m[3] * y, m[4], m[5]]),
    fillRect: (x: number, y: number, w: number, h: number) => keep("fillRect", x, y, w, h),
    drawImage: (img: { width: number; height: number; name?: string }, ...a: number[]) => {
      const [x, y, w, h] = a.length >= 8 ? a.slice(4) : a.length === 4 ? a : [a[0], a[1], img.width, img.height];
      keep(`drawImage ${img.name ?? "?"}`, x, y, w, h);
    },
    measureText: (text: string) => ({ width: String(text).length * 8 }),
    createPattern: () => ({}),
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)) }),
    createLinearGradient: () => ({ addColorStop: () => undefined }),
    createRadialGradient: () => ({ addColorStop: () => undefined }),
  };
  return new Proxy(props, {
    get(target, key) {
      if (typeof key === "string" && key in calls) return calls[key];
      if (key in target) return target[key];
      return () => undefined;
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

let made = 0;
function recordingCanvas(name: string, out: Rect[]): HTMLCanvasElement {
  const c: Record<string, unknown> = { width: 300, height: 150, name };
  const ctx = recordingContext(name, out);
  c.getContext = () => ctx;
  c.getBoundingClientRect = () => ({ left: 0, top: 0, right: c.width, bottom: c.height, width: c.width, height: c.height });
  return c as unknown as HTMLCanvasElement;
}

/** A rectangle whose every edge is a whole device pixel. */
const whole = (r: Rect) => [r.x0, r.y0, r.x1, r.y1].every((v) => Math.abs(v - Math.round(v)) < 1e-6);

describe("him on the pixel grid (§9.1)", () => {
  let b: Browser | null = null;
  let game: KnuffHandle | null = null;
  afterEach(() => {
    game?.destroy();
    game = null;
    b?.restore();
    b = null;
  });

  /** A night with `charms` taken, a few ticks in, stored and resumed in a game drawn at `w` × `h` at device scale `dpr`. */
  const drawn = (charms: string[], w: number, h: number, dpr: number, coarse: boolean, ticks = 6) => {
    const s: State = createState(7, DEFAULT_TUNE, { hour: 1, charms });
    step(s, { launch: { dx: 0.3, dy: -1, power: 1 }, pullHeld: false }, DEFAULT_TUNE, []);
    for (let i = 0; i < ticks; i++) step(s, { launch: null, pullHeld: false }, DEFAULT_TUNE, []);
    const session = new MemoryStorage();
    const local = new MemoryStorage();
    createStore(local, session).writeRun({ ...DEFAULT_TUNE }, s);
    b = installBrowser({ w, h, coarse, local, session });
    b.win.devicePixelRatio = dpr;
    const rects: Rect[] = [];
    const main = recordingCanvas("main", rects);
    b.doc.createElement = () => recordingCanvas(`made ${++made}`, rects);
    game = createKnuff(b.root as unknown as HTMLElement, main, { fonts: FONTS, onChange: () => undefined });
    game.resumeStored();
    return { b: b as Browser, rects };
  };

  // Sizes of §9.1's table, with the room's scale there: his cell is 2 u, rounded to whole device pixels.
  const SIZES: Array<[number, number, number, boolean, number]> = [
    [390, 664, 3, true, 1],
    [390, 664, 2, true, 1],
    [412, 780, 2.625, true, 1.1423],
    [1440, 900, 1, false, 1.5],
    [768, 479, 2, false, 0.84],
    [1280, 552, 1.5, false, 0.9926],
  ];

  for (const [w, h, dpr, coarse, scale] of SIZES) {
    for (const charms of [["wide"], []]) {
      it(`${charms.length ? "with Wide" : "without it"}, through flights, cushions and landings, every rectangle lands on whole device pixels: ${w} × ${h} at ${dpr}`, () => {
        const { b: br, rects } = drawn(charms, w, h, dpr, coarse);
        // RESUME holds the room still for 500 ms; then a second and a half of the night, frame by frame.
        br.wait(600);
        rects.length = 0;
        br.frames(90);
        expect(rects.length).toBeGreaterThan(1000);
        const off = rects.filter((r) => !whole(r));
        expect(off.slice(0, 3)).toEqual([]);
        if (charms.length) {
          // And Wide still shows: at rest he is stamped 15/13 of his 16 cells across, to the nearest pixel.
          const cell = Math.max(1, Math.round(2 * scale * dpr));
          const side = Math.round(16 * cell * (15 / 13));
          expect(side).toBeGreaterThan(16 * cell);
          expect(rects.some((r) => r.what.startsWith("drawImage made") && r.x1 - r.x0 === side && r.y1 - r.y0 === side)).toBe(true);
        }
      });
    }
  }
});

describe("stampRect: where a scaled picture is stamped", () => {
  it("is whole device pixels at every cell and scale he is drawn at, the nearest pixel to the exact size, mirrored about his middle", () => {
    const scales = [15 / 13, 0.78, 0.84, 1.16, 1.18, (15 / 13) * 0.78, (15 / 13) * 1.18, 1.0004, 0.9996];
    for (let cell = 1; cell <= 9; cell++) {
      const side = 16 * cell;
      for (const sx of scales) {
        for (const sy of scales) {
          const cx = 101;
          const cy = 57;
          const r = stampRect(cx, cy, side, side, sx, sy);
          for (const v of [r.x, r.y, r.w, r.h]) expect(Number.isInteger(v)).toBe(true);
          expect(Math.abs(r.w - side * sx)).toBeLessThanOrEqual(0.5);
          expect(Math.abs(r.h - side * sy)).toBeLessThanOrEqual(0.5);
          // Centred to within half a pixel.
          expect(Math.abs(r.x + r.w / 2 - cx)).toBeLessThanOrEqual(0.5);
          expect(Math.abs(r.y + r.h / 2 - cy)).toBeLessThanOrEqual(0.5);
          const m = stampRect(cx, cy, side, side, -sx, sy);
          expect([m.w, m.h, m.y]).toEqual([r.w, r.h, r.y]);
          expect(m.x + m.w - cx).toBe(cx - r.x);
        }
      }
    }
  });
});

describe("the turned token's flick (decision 31, §9.5)", () => {
  let b: Browser | null = null;
  let game: KnuffHandle | null = null;
  afterEach(() => {
    game?.destroy();
    game = null;
    b?.restore();
    b = null;
  });

  const turned = (): SimEvent => ({ type: "tokenTurned", tick: 100, x: 200, y: 300, id: 7, vx: 90, vy: -120 }) as SimEvent;

  it("is held for FLICK_TICKS after the turn, then let go", () => {
    const fx = createEffects(() => DEFAULT_TUNE);
    fx.onEvent(turned());
    expect(fx.flicks).toEqual([{ id: 7, tick: 100 }]);
    const s = night(DEFAULT_TUNE);
    s.tick = 100 + FLICK_TICKS - 1;
    fx.afterTick(s);
    expect(fx.flicks.length).toBe(1);
    s.tick = 100 + FLICK_TICKS;
    fx.afterTick(s);
    expect(fx.flicks.length).toBe(0);
  });

  it("throws four acid squares off the token; with reduced motion none fly, and the marks hold", () => {
    const full = createEffects(() => DEFAULT_TUNE);
    full.onEvent(turned());
    expect(full.particles.length).toBe(4);
    const reduced = createEffects(() => DEFAULT_TUNE);
    reduced.setReduced(true);
    reduced.onEvent(turned());
    expect(reduced.particles.length).toBe(0);
    expect(reduced.flicks.length).toBe(1);
  });

  it("is drawn on the token: three acid squares stepping off it the way it now rolls, away from him", () => {
    // He lands on the next tick with a token past the bunnies' ring and inside the tokens' reach, rolling at him.
    const s = night(DEFAULT_TUNE);
    put(s, "token", s.him.x + 42 * 0.6, s.him.y - 42 * 0.8, { vx: -150 * 0.6, vy: 150 * 0.8 });
    s.him.hot = true;
    s.him.vx = 30;
    s.launch.active = true;
    s.launch.id = 1;
    const session = new MemoryStorage();
    const local = new MemoryStorage();
    createStore(local, session).writeRun({ ...DEFAULT_TUNE }, s);
    // 390 × 664 at device scale 2: s 1, 2 device px a unit; motion reduced, so nothing shakes and no square flies.
    b = installBrowser({ w: 390, h: 664, coarse: true, local, session });
    const rects: Rect[] = [];
    const main = recordingCanvas("main", rects);
    b.doc.createElement = () => recordingCanvas(`made ${++made}`, rects);
    game = createKnuff(b.root as unknown as HTMLElement, main, { fonts: FONTS, onChange: () => undefined });
    game.setMotion("on");
    game.resumeStored();
    b.wait(600);
    // Away from him: the way the thump turned it.
    const away = { x: 0.6, y: -0.8 };
    const acid = rgba(C.acid, 1);
    let seen = 0;
    for (let f = 0; f < 12; f++) {
      rects.length = 0;
      b.frame();
      const sq = (n: number) => rects.filter((r) => r.on === "main" && r.color === acid && r.x1 - r.x0 === n && r.y1 - r.y0 === n);
      const mid = (r: Rect) => ({ x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 });
      for (const a of sq(6)) {
        for (const c of sq(4)) {
          const d = { x: (mid(c).x - mid(a).x) / 10, y: (mid(c).y - mid(a).y) / 10 };
          if (Math.abs(Math.hypot(d.x, d.y) - 1) > 0.12) continue;
          const third = sq(3).find((e) => Math.hypot(mid(e).x - (mid(c).x + d.x * 10), mid(e).y - (mid(c).y + d.y * 10)) <= 1.5);
          if (!third) continue;
          // The squares step off the token along its new roll, not toward him.
          expect(d.x * away.x + d.y * away.y).toBeGreaterThan(0.95);
          seen++;
        }
      }
    }
    expect(seen).toBeGreaterThan(5);
  });
});
