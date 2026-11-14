/**
 * The canvas: where things are (layout.ts works that out; this file
 * measures and sizes the canvas) and the order they are drawn in.
 *
 * The room is where the spec puts it (§9.1), with the cushions as thick as
 * the floor's edges say they are. He is drawn by the site's own painter,
 * in the visitor's colour, and never dimmed. Everything else is drawn
 * plainly so far: kind is told by outline (a round body with two eyes is
 * a dust bunny, a ring with a hole is a token), and a thing that is only
 * announced is a broken outline of the same shape. Only he ever wears a
 * white ring: it means he is a weapon.
 *
 * Bottom to top: the page; the cushions and their lit plates; the floor
 * and its dither; the offer's inserts and tiles, and gum; the start hint
 * where it is drawn on the floor; the thump ring, the wave and the
 * telegraph outlines; blast rings and blasts; the aim band and line (and a
 * knocked battery's line); his trail; the things in the room; Spark's ring;
 * his pips; him; the hot ring; the slow-motion bar; particles; floating
 * numbers; the top bar; the start hint where it is drawn in the deck; the
 * mark where the pull began.
 *
 * Art is on a 1 u grid and every rectangle is snapped to whole device
 * pixels when it is drawn.
 */
import { SPRITE_SIZE, drawHugoSprite, type EyeState, type SpriteDrawOptions } from "@/lib/hugo/sprite";
import type { KnuffFonts } from "../fonts";
import type { PullView } from "../input/pointer";
import type { AimLine } from "../sim/aim";
import { ROOM_H, ROOM_W } from "../sim/state";
import type { State, Thing, Tune } from "../sim/types";
import { FLICK_TICKS, SHEEN_TICKS, type Effects } from "./effects";
import { drawBoss, drawBossTelegraph, drawSheen } from "./boss";
import { RAIL_GROOVE, drawLitInserts, drawOffer, drawOfferNames, drawPlates, drawSparkRing, drawTileJump } from "./charms";
import { createBaker, stampRect, type Bitmap, type Palette } from "./bake";
import { drawBag, drawBatteryLine, drawBlastRings, drawBody, drawDazeMarks, drawGum, drawGumEdges, drawHeart, drawTelegraph, drawTokenGhost, onFloor, rollMarks } from "./intruders";
import { drawBar, drawDeckHint, drawMeter, drawPips, drawRoomHint } from "./hud";
import {
  DECK_HINT_MIN,
  bodyOrder,
  carriedAt,
  hintFor,
  layoutFor,
  type Insets,
  type Layout,
} from "./layout";
import { C, mix, rgba } from "./palette";

/** The floor through the night: darker each hour until 03:00, then warming toward morning. */
function floorAt(hour: number): string {
  if (hour <= 8) return mix(C.floor, C.floorNight, Math.max(0, hour) / 8);
  return mix(C.floorNight, C.floorWarm, Math.min(1, (hour - 8) / 3));
}

/** The things in the room in the order they are drawn: filled afresh each frame. */
const inOrder: Thing[] = [];

/** The canvas is never backed by more device pixels per px than this. */
const MAX_DPR = 3;

/** The site's Bayer dither tile (--dither in globals.css): ten cells of an 8 × 8 grid. */
const DITHER_CELLS: [number, number][] = [
  [0, 0],
  [2, 0],
  [4, 0],
  [2, 2],
  [6, 2],
  [0, 4],
  [4, 4],
  [6, 4],
  [2, 6],
  [6, 6],
];

export type Frame = {
  state: State;
  tune: Tune;
  /** How far the picture is between the last two ticks, 0..1. */
  alpha: number;
  /** The frame's timestamp, ms. */
  now: number;
  /** A night is in progress and nothing holds it: the pause key acts. */
  live: boolean;
  /** Paused: the picture must not change from one frame to the next. */
  still: boolean;
  /** The pull being held, or null. */
  pull: PullView | null;
  /** The aim line of that pull, once it has become one. */
  line: AimLine | null;
  /** The slow-motion meter, 0..1; -1 while it is not shown. */
  meter: number;
  /** The mascot's colour: the visitor's. */
  accent: string;
  /**
   * The one motion value the picture reads: true while motion is reduced
   * (the player's choice of system, reduced or full, laid over the
   * system's setting: render/motion.ts). It takes away shake, flashes,
   * squash, the trail and the ring's fragments, and two thirds of the
   * particles (§10). It changes no rule and no time a rule counts.
   */
  reduced: boolean;
  /** How far the lights have come on at the end of a night, 0..1 (§10: 1,000 ms). 0 (or left out) while a night is played. */
  lights?: number;
  /** His celebration pixels at MORNING: the painter's `sparklePhase`, or null (or left out). */
  sparkle?: number | null;
  effects: Effects;
};

/** What a drawing helper is handed: the context, the layout, and a few ways to put pixels down. */
export type Paint = {
  ctx: CanvasRenderingContext2D;
  /** The three families, resolved off the page (fonts.ts). */
  fonts: KnuffFonts;
  layout: Layout;
  /** Device pixels per CSS px. */
  dpr: number;
  /** Device pixels per room unit. */
  S: number;
  /** A room coordinate, in units, as device px. */
  X(u: number): number;
  Y(u: number): number;
  /** A disc made of square cells. All in device px. */
  disc(cx: number, cy: number, radius: number, cell: number, color: string): void;
  /**
   * A broken stepped ring: squares set on a circle, with the share `gaps`
   * of them left out, evenly (a quarter unless told: every fourth). All in
   * device px.
   */
  ring(cx: number, cy: number, radius: number, color: string, w: number, gaps?: number): void;
  /** A whole stepped ring, `w` thick, made of cells `cell` across. All in device px. */
  band(cx: number, cy: number, radius: number, w: number, cell: number, color: string): void;
  /** One run of text, centred on (x, y) in device px (or ending at x, or starting there); the size is CSS px. */
  text(
    str: string,
    x: number,
    y: number,
    sizeCss: number,
    color: string,
    face: keyof KnuffFonts,
    align?: "center" | "right" | "left",
  ): void;
  /** A sentence in the body face at 15 px, one character per 9 px cell, centred on (cx, y). */
  sentence(str: string, cx: number, y: number, color: string): void;
  /**
   * A bitmap of 1 u cells, baked in `palette` at the room's scale (once:
   * render/bake.ts) and stamped with its top left at (x, y) in units, on a
   * whole device pixel. `key` names the bitmap and palette together.
   */
  stamp(key: string, rows: Bitmap, palette: Palette, x: number, y: number, scale?: number): void;
};

export type Renderer = {
  /** Measure the root, lay the screen out and size the canvas. True if the layout changed. */
  measure(coarse: boolean): boolean;
  readonly layout: Layout;
  draw(frame: Frame): void;
};

export function createRenderer(root: HTMLElement, canvas: HTMLCanvasElement, fonts: KnuffFonts): Renderer {
  const maybe = canvas.getContext("2d");
  if (!maybe) throw new Error("2d context unavailable");
  const ctx: CanvasRenderingContext2D = maybe;

  let layout = layoutFor(ROOM_W, ROOM_H + 76, 1, false, { top: 0, right: 0, bottom: 0, left: 0 });
  const baker = createBaker();
  /** His sprite at a whole cell, for drawing him scaled (drawHim). Made on first use; null where no canvas can be made. */
  let himCanvas: HTMLCanvasElement | null | undefined;
  let dither: CanvasPattern | null = null;
  let ditherCell = 0;

  /** The site's safe-area values, republished as custom properties in globals.css. */
  function readSafeInsets(): Insets {
    const cs = getComputedStyle(document.documentElement);
    const read = (name: string) => {
      const v = parseFloat(cs.getPropertyValue(name));
      return Number.isFinite(v) ? v : 0;
    };
    return { top: read("--sat"), right: read("--sar"), bottom: read("--sab"), left: read("--sal") };
  }

  function makeDither(cell: number): void {
    if (cell === ditherCell && dither) return;
    ditherCell = cell;
    const tile = document.createElement("canvas");
    tile.width = cell * 8;
    tile.height = cell * 8;
    const tctx = tile.getContext("2d");
    if (!tctx) return;
    tctx.fillStyle = rgba(C.ink, 0.045);
    for (const [cx, cy] of DITHER_CELLS) tctx.fillRect(cx * cell, cy * cell, cell, cell);
    dither = ctx.createPattern(tile, "repeat");
  }

  const paint: Paint = {
    ctx,
    fonts,
    layout,
    dpr: 1,
    S: 1,
    X: (u) => u,
    Y: (u) => u,
    disc(cx, cy, radius, cell, color) {
      const n = Math.ceil(radius / cell);
      ctx.fillStyle = color;
      const ox = Math.round(cx);
      const oy = Math.round(cy);
      for (let j = -n; j < n; j++) {
        // One run of cells per row: cheaper than a cell at a time.
        const y = (j + 0.5) * cell;
        const half = Math.sqrt(Math.max(0, radius * radius - y * y));
        const cells = Math.round(half / cell);
        if (cells <= 0) continue;
        ctx.fillRect(ox - cells * cell, oy + j * cell, cells * 2 * cell, cell);
      }
    },
    ring(cx, cy, radius, color, w, gaps = 0.25) {
      const segs = Math.max(12, Math.round((radius * 2 * Math.PI) / (w * 1.6)));
      ctx.fillStyle = color;
      for (let i = 0; i < segs; i++) {
        if (Math.floor((i + 1) * gaps) > Math.floor(i * gaps)) continue;
        const a = (i / segs) * Math.PI * 2;
        ctx.fillRect(Math.round(cx + Math.cos(a) * radius - w / 2), Math.round(cy + Math.sin(a) * radius - w / 2), w, w);
      }
    },
    band(cx, cy, radius, w, cell, color) {
      const outer = radius + w / 2;
      const inner = Math.max(0, radius - w / 2);
      const n = Math.ceil(outer / cell);
      const ox = Math.round(cx);
      const oy = Math.round(cy);
      ctx.fillStyle = color;
      for (let j = -n; j < n; j++) {
        const y = (j + 0.5) * cell;
        if (Math.abs(y) >= outer) continue;
        const a = Math.round(Math.sqrt(outer * outer - y * y) / cell);
        const b = Math.abs(y) < inner ? Math.round(Math.sqrt(inner * inner - y * y) / cell) : 0;
        if (a <= b) continue;
        if (b === 0) {
          ctx.fillRect(ox - a * cell, oy + j * cell, 2 * a * cell, cell);
        } else {
          ctx.fillRect(ox - a * cell, oy + j * cell, (a - b) * cell, cell);
          ctx.fillRect(ox + b * cell, oy + j * cell, (a - b) * cell, cell);
        }
      }
    },
    text(str, x, y, sizeCss, color, face, align = "center") {
      ctx.font = `${Math.round(sizeCss * paint.dpr)}px ${fonts[face]}`;
      ctx.textAlign = align;
      ctx.textBaseline = "middle";
      ctx.fillStyle = color;
      ctx.fillText(str, Math.round(x), Math.round(y));
    },
    sentence(str, cx, y, color) {
      // The body face has ligatures (ff, fi, fl) that a canvas applies and
      // the page's CSS does not: a sentence is set one character a cell.
      const cellW = 9 * paint.dpr;
      ctx.font = `${Math.round(15 * paint.dpr)}px ${fonts.sans}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = color;
      const x0 = cx - (str.length * cellW) / 2 + cellW / 2;
      for (let i = 0; i < str.length; i++) ctx.fillText(str[i], Math.round(x0 + i * cellW), Math.round(y));
    },
    stamp(key, rows, palette, x, y, scale = 1) {
      const img = baker.get(key, rows, palette, paint.S);
      if (!img) return;
      if (scale === 1) ctx.drawImage(img, Math.round(paint.X(x)), Math.round(paint.Y(y)));
      else ctx.drawImage(img, Math.round(paint.X(x)), Math.round(paint.Y(y)), Math.max(1, Math.round(img.width * scale)), Math.max(1, Math.round(img.height * scale)));
    },
  };

  /**
   * Him, by the site's painter. At his own size the painter draws him
   * straight onto the canvas, every cell a whole `px` at a whole point.
   * Scaled (Wide, a squash), the painter's own `ctx.scale` would make a
   * 6 px cell 6.92 px and every cell edge a soft seam across his body. So
   * he is painted at his whole cell into a canvas of his own and stamped
   * from it at a whole number of device pixels, nearest neighbour: each
   * cell a whole number of pixels, one wider in some places than in others
   * (§9.1), mirrored about his middle when he faces left.
   */
  function drawHim(o: SpriteDrawOptions): void {
    const sx = o.scaleX ?? 1;
    const sy = o.scaleY ?? 1;
    if (Math.abs(sx) === 1 && sy === 1) {
      drawHugoSprite(ctx, o);
      return;
    }
    if (himCanvas === undefined) {
      try {
        himCanvas = document.createElement("canvas");
      } catch {
        himCanvas = null;
      }
    }
    const hctx = himCanvas ? himCanvas.getContext("2d") : null;
    if (!himCanvas || !hctx) {
      drawHugoSprite(ctx, o);
      return;
    }
    const side = SPRITE_SIZE * o.px;
    if (himCanvas.width !== side || himCanvas.height !== side) {
      himCanvas.width = side;
      himCanvas.height = side;
    }
    hctx.setTransform(1, 0, 0, 1, 0, 0);
    hctx.clearRect(0, 0, side, side);
    drawHugoSprite(hctx, { ...o, x: side / 2, y: side / 2, scaleX: 1, scaleY: 1 });
    const at = stampRect(o.x, o.y, side, side, sx, sy);
    if (sx < 0) {
      ctx.save();
      ctx.translate(at.x + at.w, at.y);
      ctx.scale(-1, 1);
      ctx.drawImage(himCanvas, 0, 0, at.w, at.h);
      ctx.restore();
    } else {
      ctx.drawImage(himCanvas, at.x, at.y, at.w, at.h);
    }
  }

  function measure(coarse: boolean): boolean {
    const w = root.clientWidth;
    const h = root.clientHeight;
    if (w === 0 || h === 0) return false;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const next = layoutFor(w, h, dpr, coarse, readSafeInsets());
    const changed = JSON.stringify(next) !== JSON.stringify(layout);
    layout = next;
    const cw = Math.round(w * dpr);
    const ch = Math.round(h * dpr);
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    const roomX = layout.room.x * dpr;
    const roomY = layout.room.y * dpr;
    const S = layout.s * dpr;
    paint.layout = layout;
    paint.dpr = dpr;
    paint.S = S;
    paint.X = (u) => roomX + u * S;
    paint.Y = (u) => roomY + u * S;
    makeDither(Math.max(1, Math.round(S)));
    return changed;
  }

  /** The room's outer shape: the 360 × 480 with stepped corners, 4 u a step. */
  function roomPath(): void {
    const { X, Y, S } = paint;
    const l = Math.round(X(0));
    const t = Math.round(Y(0));
    const r = Math.round(X(ROOM_W));
    const b = Math.round(Y(ROOM_H));
    const n = Math.max(1, Math.round(2 * S));
    ctx.beginPath();
    ctx.moveTo(l, t + 2 * n);
    ctx.lineTo(l + n, t + 2 * n);
    ctx.lineTo(l + n, t + n);
    ctx.lineTo(l + 2 * n, t + n);
    ctx.lineTo(l + 2 * n, t);
    ctx.lineTo(r - 2 * n, t);
    ctx.lineTo(r - 2 * n, t + n);
    ctx.lineTo(r - n, t + n);
    ctx.lineTo(r - n, t + 2 * n);
    ctx.lineTo(r, t + 2 * n);
    ctx.lineTo(r, b - 2 * n);
    ctx.lineTo(r - n, b - 2 * n);
    ctx.lineTo(r - n, b - n);
    ctx.lineTo(r - 2 * n, b - n);
    ctx.lineTo(r - 2 * n, b);
    ctx.lineTo(l + 2 * n, b);
    ctx.lineTo(l + 2 * n, b - n);
    ctx.lineTo(l + n, b - n);
    ctx.lineTo(l + n, b - 2 * n);
    ctx.lineTo(l, b - 2 * n);
    ctx.closePath();
  }

  /** The dots of the aim line: evenly spaced along the path, through the cushions it touches. */
  function aimDots(line: AimLine, col: string): void {
    const { X, Y, S, dpr } = paint;
    // The path: his centre tick by tick, with each cushion's touch put in where it happened.
    const path: number[] = [];
    let c = 0;
    const count = line.pts.length / 2;
    for (let i = 0; i < count; i++) {
      while (c < line.cushions.length && line.cushions[c] === i) {
        path.push(line.cushionPts[c * 2], line.cushionPts[c * 2 + 1]);
        c++;
      }
      path.push(line.pts[i * 2], line.pts[i * 2 + 1]);
    }
    const gap = 9;
    let along = gap;
    let total = 0;
    let n = 0;
    for (let i = 2; i < path.length; i += 2) {
      const ax = path[i - 2];
      const ay = path[i - 1];
      const len = Math.hypot(path[i] - ax, path[i + 1] - ay);
      while (along <= total + len && len > 0) {
        const k = (along - total) / len;
        const size = n % 2 === 0 ? Math.max(3, Math.round(dpr * 3.4)) : Math.max(2, Math.round(dpr * 2.2));
        ctx.fillStyle = rgba(col, Math.max(0.45, 1 - along / 900));
        ctx.fillRect(
          Math.round(X(ax + (path[i] - ax) * k) - size / 2),
          Math.round(Y(ay + (path[i + 1] - ay) * k) - size / 2),
          size,
          size,
        );
        along += gap;
        n++;
      }
      total += len;
    }
    // A mark where it turns at a cushion.
    for (let i = 0; i < line.cushionPts.length; i += 2) {
      const q = Math.max(3, Math.round(S * 3));
      ctx.fillStyle = rgba(col, 0.7);
      ctx.fillRect(Math.round(X(line.cushionPts[i]) - q / 2), Math.round(Y(line.cushionPts[i + 1]) - q / 2), q, q);
    }
  }

  function draw(f: Frame): void {
    const { state, tune, alpha, now, effects: fx } = f;
    const { X, Y, S, dpr } = paint;
    const L = layout;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = C.page;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // Too small to play: the room is not drawn, and the Too small panel (Client.tsx) says why.
    if (L.tooSmall) return;

    const h = state.him;
    const hx = h.px + (h.x - h.px) * alpha;
    const hy = h.py + (h.y - h.py) * alpha;
    // His radius after charms: Wide makes him bigger, and the ring, the pips and the meter take their distances from it.
    const r = state.stats.radius;
    const hair = Math.max(1, Math.round(dpr));
    const cellFx = Math.max(2, Math.round(S * 1.5));
    const aim = f.pull?.aim ?? null;
    const hint = hintFor(state);
    const hintInDeck = L.coarse && L.deck.h >= DECK_HINT_MIN;
    /** The tick the picture is at, between two ticks. */
    const tickNow = state.tick - 1 + alpha;
    // The night's colour; when the lights come on at its end, the room's own light.
    const lights = f.lights ?? 0;
    const floor = lights > 0 ? mix(floorAt(state.night.hour), C.lightsOn, Math.min(1, lights)) : floorAt(state.night.hour);

    if (!f.reduced && !f.still && fx.shake > 0) {
      ctx.translate(Math.round((Math.random() - 0.5) * fx.shake * dpr), Math.round((Math.random() - 0.5) * fx.shake * dpr));
    }

    // The cushions: the room's outer shape, and the floor cut into it.
    roomPath();
    ctx.fillStyle = RAIL_GROOVE;
    ctx.fill();
    const fl = Math.round(X(state.room.left));
    const ft = Math.round(Y(state.room.top));
    const fw = Math.round(X(state.room.right)) - fl;
    const fh = Math.round(Y(state.room.bottom)) - ft;
    // Lit plates, and offered ones, in their charm's colour on the rail.
    drawPlates(paint, state, (i) => (f.reduced ? 0 : fx.plateFlash(i)));
    ctx.fillStyle = floor;
    ctx.fillRect(fl, ft, fw, fh);
    if (dither) {
      ctx.fillStyle = dither;
      ctx.fillRect(fl, ft, fw, fh);
    }
    // Where the polisher has been: the floor shines for a few seconds.
    drawSheen(paint, fx.sheen, tickNow, SHEEN_TICKS);
    // Floor inserts, gum, tiles (§9.9): each offered plate's insert and its
    // name; gum, flat on the floor, under everything that moves; then each
    // pickup's tile and its name, and the love heart's tile.
    drawLitInserts(paint, state);
    drawOffer(paint, state, "inserts");
    drawGum(paint, state, f.line !== null ? f.line.hitId : -1);
    drawOffer(paint, state, "tiles");
    drawHeart(paint, state, tune.heartLife);
    drawOfferNames(paint, state);

    // The hint on the floor, under everything that moves. Its hand is in
    // the way of a pull, so it stands back while one is held or he flies.
    if (!hintInDeck && (hint.hand || hint.words !== "")) {
      const quiet = { hand: hint.hand && !f.pull && !h.hot, words: hint.words };
      drawRoomHint(paint, quiet, tune.pullDir, { x: hx, y: hy }, now, f.reduced);
    }

    // The thump: a broken ring on the floor that closes over the daze. The ring is the timer.
    const ringW = Math.max(2, Math.round(S * 2));
    for (const t of fx.thumps) {
      const k = Math.min(1, Math.max(0, (tickNow - t.tick) / Math.max(1, tune.dazeTicks)));
      const radius = f.reduced ? tune.thumpRadius : tune.thumpRadius - (tune.thumpRadius - r) * k;
      paint.ring(X(t.x), Y(t.y), radius * S, rgba(C.ink, 0.75), ringW);
    }
    // The wave of a lost heart: one broken ring growing to its reach.
    for (const w of fx.waves) {
      const k = 1 - w.life / w.max;
      paint.ring(X(w.x), Y(w.y), (r + (tune.hitWaveRadius - r) * k) * S, rgba(C.coral, 1 - 0.6 * k), Math.max(2, Math.round(S * 3)));
    }
    // What is announced: the broken outline of what will land there.
    for (const d of state.things) if (state.tick < d.landTick) drawTelegraph(paint, d);
    // The polisher's telegraph: its outline where it will land, and the way it will head.
    drawBossTelegraph(paint, state);
    // A battery's blast: its reach, for its last 60 ticks and from the moment it is knocked; and the blasts going off.
    drawBlastRings(paint, state, tune, alpha);
    onFloor(paint, state, () => {
      for (const b of fx.blasts) {
        const k = 1 - b.life / b.max;
        paint.ring(X(b.x), Y(b.y), (10 + (tune.blastRadius - 10) * (f.reduced ? 1 : k)) * S, rgba(b.mine ? C.amber : C.coral, 1 - 0.7 * k), Math.max(3, Math.round(S * 4)));
      }
    });

    // Shorter than a shot, or no pip in hand: grey, to show that letting go here does nothing.
    // Otherwise phosphor at every power. (The toy went mint, acid, coral
    // with the pull: here acid is a token and coral is a lost heart, and
    // the line must not be read as either. The band's length is the power.)
    const col = aim && (aim.short || state.pips <= 0) ? C.inkMuted : C.ink;

    // The aim: the band behind him and a dotted line ahead.
    if (aim) {
      const len = Math.hypot(aim.launch.dx, aim.launch.dy);
      const dx = aim.launch.dx / len;
      const dy = aim.launch.dy / len;
      // The band is as long as the pointer has travelled, capped at a full pull.
      const bandU = Math.min(aim.lengthPx, tune.pullFullPx) / L.s;
      const bx = hx - dx * bandU;
      const by = hy - dy * bandU;
      const bw = Math.max(3, Math.round(dpr * 4));
      const steps = Math.max(2, Math.ceil((bandU * S) / bw));
      ctx.fillStyle = rgba(col, 0.9);
      for (let i = 1; i <= steps; i++) {
        const k = i / steps;
        ctx.fillRect(Math.round(X(hx + (bx - hx) * k) - bw / 2), Math.round(Y(hy + (by - hy) * k) - bw / 2), bw, bw);
      }
      paint.disc(X(bx), Y(by), 6.5 * S, cellFx, col);

      if (f.line && f.line.pts.length >= 4) {
        aimDots(f.line, col);
        // A battery first: its own line, and the ring where it bursts.
        drawBatteryLine(paint, state, f.line, tune, col);
        // Where it ends it says what will happen. (A cross waits for its own pass, over the polisher.)
        const pts = f.line.pts;
        const ex = pts[pts.length - 2];
        const ey = pts[pts.length - 1];
        if (f.line.end === "land") {
          // The thump's ring where he would land.
          paint.ring(X(ex), Y(ey), tune.thumpRadius * S, rgba(col, 0.6), ringW);
        } else if (f.line.end === "cushion" || f.line.end === "time") {
          // Coral if the launch runs on into the pad, which will cost a heart.
          ctx.fillStyle = f.line.padAfter ? C.coral : rgba(col, 0.5);
          const q = Math.max(4, Math.round(dpr * 5));
          ctx.fillRect(Math.round(X(ex) - q / 2), Math.round(Y(ey) - q / 2), q, q);
        }
      }
    }

    // His trail: a decaying smear in his colour. While he is drawn as his
    // outline only, the part of it under him would show through: left out.
    const outlined = state.tick < h.invulnUntil && state.phase !== "over";
    if (!f.reduced) {
      for (let i = 0; i < fx.trail.length; i++) {
        const t = fx.trail[i];
        const k = (i + 1) / (fx.trail.length + 1);
        if (outlined && Math.hypot(t.x - hx, t.y - hy) < r * (1.3 + 0.6 * k)) continue;
        paint.disc(X(t.x), Y(t.y), r * S * (0.3 + 0.6 * k), cellFx, rgba(f.accent, 0.1 + 0.42 * k));
      }
    }

    // The things in the room. Kind is told by outline; colour only confirms
    // it. The live ones first, then the dazed ones over them (a token rolls
    // through anything): a dazed thing's marks are then on its own body. A
    // money bag that came down over him is drawn over him instead (below).
    // Tokens from the money bag that faded: their rings fade where they stood.
    for (const g of fx.ghosts) drawTokenGhost(paint, g.x, g.y, (g.life / g.max) * 0.8);
    let bagOnHim: Thing | null = null;
    for (const d of bodyOrder(state, inOrder)) {
      if (d.onHim) {
        bagOnHim = d;
        continue;
      }
      const dx = d.px + (d.x - d.px) * alpha;
      const dy = d.py + (d.y - d.py) * alpha;
      drawBody(paint, state, d, dx, dy, f.line !== null && f.line.hitId === d.id, f.reduced, tune);
    }
    // Gum hidden under a bunch: its bitten outline again, over the bodies.
    drawGumEdges(paint, state, inOrder);
    // Dazed: two marks inside its own body in place of its eyes, for exactly
    // as long as it is harmless. In a pass of their own, after every body,
    // so no neighbour is drawn over them.
    for (const d of inOrder) {
      if (state.tick >= d.dazedUntil || d.onHim) continue;
      drawDazeMarks(paint, d.px + (d.x - d.px) * alpha, d.py + (d.y - d.py) * alpha);
    }
    // A token the thump has just turned away (decision 31): three acid squares
    // stepping off along its new roll, as an announced token shows its way,
    // fading over `FLICK_TICKS` (held with reduced motion). The thump's ring
    // is the bunnies' daze; the turn is drawn on the token itself.
    for (const fl of fx.flicks) {
      const d = state.things.find((t) => t.id === fl.id);
      if (!d || d.hp <= 0) continue;
      const k = Math.min(1, Math.max(0, (tickNow - fl.tick) / FLICK_TICKS));
      rollMarks(paint, d.px + (d.x - d.px) * alpha, d.py + (d.y - d.py) * alpha, d.vx, d.vy, rgba(C.acid, f.reduced ? 1 : 1 - 0.8 * k));
    }

    // The polisher, over the intruders.
    drawBoss(paint, state, tune, alpha, tickNow, f.reduced);

    // The cross where the aim line ends on a thing, over the polisher: the plug he would hit is
    // where the machine's trailing end will be when he gets there, inside its box as it stands now.
    // Coral on the pad where it will cost a heart (where it only throws him, the line's own colour), and where the
    // launch runs on into the pad after it.
    if (aim && f.line && f.line.pts.length >= 4 && (f.line.end === "thing" || f.line.end === "polisher" || f.line.end === "pad")) {
      const pts = f.line.pts;
      const ex = pts[pts.length - 2];
      const ey = pts[pts.length - 1];
      const arm = Math.round(r * S * 0.9);
      const tw = Math.max(2, Math.round(dpr * 2.6));
      ctx.fillStyle = (f.line.end === "pad" && f.line.padHeart) || f.line.padAfter ? C.coral : col;
      ctx.fillRect(Math.round(X(ex) - arm), Math.round(Y(ey) - tw / 2), arm * 2, tw);
      ctx.fillRect(Math.round(X(ex) - tw / 2), Math.round(Y(ey) - arm), tw, arm * 2);
    }

    // Spark's ring, under his pips, him and the hot ring.
    drawSparkRing(paint, state, hx, hy, tune.sparkReach);

    // His pips, above the things in the room and under him.
    const carried = carriedAt(state, tune, hy);
    const refused = fx.refused > 0;
    const pipShake = refused && !f.reduced ? (Math.floor(now / 30) % 2 === 0 ? 2 : -2) : 0;
    drawPips(paint, state, tune, hx, hy + carried.pips, refused, pipShake);

    // Him, by the site's painter. A sprite cell is 2 u.
    const sp = Math.hypot(h.vx, h.vy);
    const cell = Math.max(1, Math.round(2 * L.s * dpr));
    let lookX = 0;
    let lookY = 0;
    if (aim) {
      const len = Math.hypot(aim.launch.dx, aim.launch.dy);
      lookX = aim.launch.dx / len;
      lookY = aim.launch.dy / len;
    } else if (sp > 40) {
      lookX = h.vx / sp;
      lookY = h.vy / sp;
    }
    // He faces the way he travels, and while aiming the way he would go. A
    // near-vertical aim does not flip him: a thumb wobbles across upright.
    const face = aim && Math.abs(lookX) > 0.2 ? (lookX > 0 ? 1 : -1) : fx.facing;
    const eye: EyeState = {
      open: !(fx.blinking(now) && !h.hot && !aim),
      wide: h.hot || (aim !== null && aim.pull01 > 0.9),
      dx: Math.abs(lookX) > 0.35 ? 1 : 0,
      dy: lookY > 0.4 ? 1 : lookY < -0.4 ? -1 : 0,
    };
    // Wide: drawn bigger, in step with his circle.
    const grow = r / tune.himRadius;
    const sqx = f.reduced ? 1 : fx.squashX;
    const sqy = f.reduced ? 1 : fx.squashY;
    const sx = sqx * grow;
    const sy = sqy * grow;
    // The painter scales about the middle of its grid, and his body's
    // middle is one cell under that. A squash is anchored at the cushion.
    let px = Math.round(X(hx));
    let py = Math.round(Y(hy) - cell * grow);
    if (fx.squashSide === "left") px -= Math.round((1 - sqx) * 7 * cell * grow);
    else if (fx.squashSide === "right") px += Math.round((1 - sqx) * 7 * cell * grow);
    else if (fx.squashSide === "top") py -= Math.round((1 - sqy) * 6 * cell * grow);
    else if (fx.squashSide === "bottom") py += Math.round((1 - sqy) * 6 * cell * grow);
    drawHim({
      x: px,
      y: py,
      px: cell,
      accent: f.accent,
      eye,
      scaleX: sx * face,
      scaleY: sy,
      // Nothing can cost him a heart: his outline only. Not a flash, and
      // not a white ring, which means hot.
      outline: outlined,
      // At MORNING, the sprite's celebration pixels.
      sparklePhase: f.sparkle ?? null,
    });

    // A money bag that came down over him (decision 29): he is under it, and
    // his next launch passes through it. The sack is drawn over him, see-through,
    // so the line that runs through it does not read as a mistake.
    if (bagOnHim) {
      const bx = bagOnHim.px + (bagOnHim.x - bagOnHim.px) * alpha;
      const by = bagOnHim.py + (bagOnHim.y - bagOnHim.py) * alpha;
      ctx.globalAlpha = 0.55;
      drawBag(paint, state, bagOnHim, bx, by, tune.bagHits, f.line !== null && f.line.hitId === bagOnHim.id);
      ctx.globalAlpha = 1;
      if (state.tick < bagOnHim.dazedUntil) drawDazeMarks(paint, bx, by);
    }

    // The hot ring: whole, phosphor, 2 u thick, 4 u outside his circle.
    // Where the room is shrunk his drawn body can be wider than his
    // circle: then the ring moves out to one cell beyond the body.
    if (h.hot) {
      const w = Math.max(2, Math.round(2 * S));
      const inner = Math.max((r + 3) * S, 8 * cell * grow);
      paint.band(X(hx), Y(hy), inner + w / 2, w, Math.max(1, Math.round(S)), C.ink);
    }

    // The slow-motion meter, while a pull is held and something can hurt him.
    if (f.meter >= 0) drawMeter(paint, hx, hy + carried.meter, f.meter);

    // Sparks on top.
    for (const p of fx.particles) {
      const a = Math.min(1, Math.max(0, p.life / p.max));
      const q = Math.max(2, Math.round(p.size * S * 0.9));
      ctx.fillStyle = rgba(p.color, a);
      ctx.fillRect(Math.round(X(p.x) - q / 2), Math.round(Y(p.y) - q / 2), q, q);
    }

    // A pickup taken: its tile flies to him, shrinking.
    for (const j of fx.jumps) {
      const k = 1 - j.life / j.max;
      drawTileJump(paint, j.charm, j.x + (hx - j.x) * k, j.y + (hy - j.y) * k, 1 - 0.6 * k);
    }

    // Floating numbers: a multiplier where a pop earned it, a launch's total a ring above where it
    // ended. One over him while he stands, or over what stands by him, is faded back so it does not
    // hide either (the play check of steps 4 and 5).
    for (const n of fx.floats) {
      let a = Math.min(1, n.life / (n.max * 0.4));
      if (!h.hot && Math.hypot(n.x - hx, n.y - hy) < r + 30) a *= 0.4;
      const fy = Math.max(state.room.top + 12, n.y);
      paint.text(n.text, X(Math.min(state.room.right - 16, Math.max(state.room.left + 16, n.x))), Y(fy), n.big ? 28 : 22, rgba(C.ink, a), "display");
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // While the aim would take an offered thing, or bounce off a lit plate first, the bar names that charm.
    drawBar(paint, state, tune, f.live, f.line ? f.line.charm : "", fx.clock ? { from: fx.clock.from, k: 1 - fx.clock.life / fx.clock.max } : null);

    // The hint in the thumb deck.
    if (hintInDeck && (hint.hand || hint.words !== "")) drawDeckHint(paint, hint, tune.pullDir, now, f.reduced);

    // Where the pull began, faintly, so it has a start you can see. (The keys' aim began nowhere.)
    if (f.pull && f.pull.pointerType !== "keys") {
      const rect = root.getBoundingClientRect();
      paint.ring((f.pull.x0 - rect.left) * dpr, (f.pull.y0 - rect.top) * dpr, 9 * dpr, rgba(C.ink, 0.25), hair);
    }
  }

  return {
    measure,
    get layout() {
      return layout;
    },
    draw,
  };
}
