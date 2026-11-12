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
 * Bottom to top: the page; the cushions; the floor and its dither; the
 * start hint where it is drawn on the floor; the thump ring, the wave and
 * the telegraph outlines; the aim band and line; his trail; the things in
 * the room; his pips; him; the hot ring; the slow-motion bar; particles;
 * floating numbers; the top bar; the start hint where it is drawn in the
 * deck; the mark where the pull began.
 *
 * Art is on a 1 u grid and every rectangle is snapped to whole device
 * pixels when it is drawn.
 */
import { drawHugoSprite, type EyeState } from "@/lib/hugo/sprite";
import type { KnuffFonts } from "../fonts";
import type { PullView } from "../input/pointer";
import type { AimLine } from "../sim/aim";
import { KINDS } from "../content/kinds";
import { ROOM_H, ROOM_W } from "../sim/state";
import type { State, Tune } from "../sim/types";
import type { Effects } from "./effects";
import { DECK_HINT_MIN, carriedAt, drawBar, drawDeckHint, drawMeter, drawPips, drawRoomHint, drawTooSmall, hintFor } from "./hud";
import { layoutFor, type Insets, type Layout } from "./layout";
import { C, mix, rgba } from "./palette";

/** The floor through the night: darker each hour until 03:00, then warming toward morning. */
function floorAt(hour: number): string {
  if (hour <= 8) return mix(C.floor, C.floorNight, Math.max(0, hour) / 8);
  return mix(C.floorNight, C.floorWarm, Math.min(1, (hour - 8) / 3));
}

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
  /** The pull being held, or null. */
  pull: PullView | null;
  /** The aim line of that pull, once it has become one. */
  line: AimLine | null;
  /** The slow-motion meter, 0..1; -1 while it is not shown. */
  meter: number;
  /** The mascot's colour: the visitor's. */
  accent: string;
  reduced: boolean;
  effects: Effects;
};

/** What a drawing helper is handed: the context, the layout, and a few ways to put pixels down. */
export type Paint = {
  ctx: CanvasRenderingContext2D;
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
  /** A broken stepped ring: squares set on a circle, every fourth left out. All in device px. */
  ring(cx: number, cy: number, radius: number, color: string, w: number): void;
  /** A whole stepped ring, `w` thick, made of cells `cell` across. All in device px. */
  band(cx: number, cy: number, radius: number, w: number, cell: number, color: string): void;
  /** One run of text, centred on (x, y) in device px (or ending at x); the size is CSS px. */
  text(
    str: string,
    x: number,
    y: number,
    sizeCss: number,
    color: string,
    face: keyof KnuffFonts,
    align?: "center" | "right",
  ): void;
  /** A sentence in the body face at 15 px, one character per 9 px cell, centred on (cx, y). */
  sentence(str: string, cx: number, y: number, color: string): void;
};

export type Renderer = {
  /** Measure the root, lay the screen out and size the canvas. True if the layout changed. */
  measure(coarse: boolean, playable: boolean): boolean;
  readonly layout: Layout;
  draw(frame: Frame): void;
};

function powerColor(pull01: number): string {
  return pull01 >= 0.98 ? C.coral : pull01 >= 0.55 ? C.acid : C.mint;
}

export function createRenderer(root: HTMLElement, canvas: HTMLCanvasElement, fonts: KnuffFonts): Renderer {
  const maybe = canvas.getContext("2d");
  if (!maybe) throw new Error("2d context unavailable");
  const ctx: CanvasRenderingContext2D = maybe;

  let layout = layoutFor(ROOM_W, ROOM_H + 76, 1, false, { top: 0, right: 0, bottom: 0, left: 0 });
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
    ring(cx, cy, radius, color, w) {
      const segs = Math.max(12, Math.round((radius * 2 * Math.PI) / (w * 1.6)));
      ctx.fillStyle = color;
      for (let i = 0; i < segs; i++) {
        if (i % 4 === 3) continue;
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
  };

  function measure(coarse: boolean, playable: boolean): boolean {
    const w = root.clientWidth;
    const h = root.clientHeight;
    if (w === 0 || h === 0) return false;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const next = layoutFor(w, h, dpr, coarse, readSafeInsets(), playable);
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
    if (L.tooSmall) {
      drawTooSmall(paint);
      return;
    }

    const h = state.him;
    const hx = h.px + (h.x - h.px) * alpha;
    const hy = h.py + (h.y - h.py) * alpha;
    const r = tune.himRadius;
    const hair = Math.max(1, Math.round(dpr));
    const cellFx = Math.max(2, Math.round(S * 1.5));
    const aim = f.pull?.aim ?? null;
    const hint = hintFor(state);
    const hintInDeck = L.coarse && L.deck.h >= DECK_HINT_MIN;
    /** The tick the picture is at, between two ticks. */
    const tickNow = state.tick - 1 + alpha;
    const floor = floorAt(state.night.hour);

    if (!f.reduced && fx.shake > 0) {
      ctx.translate(Math.round((Math.random() - 0.5) * fx.shake * dpr), Math.round((Math.random() - 0.5) * fx.shake * dpr));
    }

    // The cushions: the room's outer shape, and the floor cut into it.
    roomPath();
    ctx.fillStyle = C.rail;
    ctx.fill();
    const fl = Math.round(X(state.room.left));
    const ft = Math.round(Y(state.room.top));
    const fw = Math.round(X(state.room.right)) - fl;
    const fh = Math.round(Y(state.room.bottom)) - ft;
    ctx.fillStyle = floor;
    ctx.fillRect(fl, ft, fw, fh);
    if (dither) {
      ctx.fillStyle = dither;
      ctx.fillRect(fl, ft, fw, fh);
    }

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
    for (const d of state.things) {
      if (state.tick >= d.landTick) continue;
      const dr = KINDS[d.kind].radius;
      if (d.kind === "token") {
        paint.ring(X(d.x), Y(d.y), dr * S, C.acid, ringW);
        // Which way it will roll: three squares, stepping off along its roll.
        const v = Math.hypot(d.vx, d.vy);
        if (v > 0) {
          ctx.fillStyle = C.acid;
          for (let i = 1; i <= 3; i++) {
            const q = Math.max(2, Math.round(S * (3.4 - i * 0.6)));
            const reach = dr + 1 + i * 5;
            ctx.fillRect(Math.round(X(d.x + (d.vx / v) * reach) - q / 2), Math.round(Y(d.y + (d.vy / v) * reach) - q / 2), q, q);
          }
        }
      } else {
        paint.ring(X(d.x), Y(d.y), dr * S, C.ash, ringW);
      }
    }

    // The aim: the band behind him and a dotted line ahead.
    if (aim) {
      const len = Math.hypot(aim.launch.dx, aim.launch.dy);
      const dx = aim.launch.dx / len;
      const dy = aim.launch.dy / len;
      // Shorter than a shot, or no pip in hand: grey, to show that letting go here does nothing.
      const col = aim.short || state.pips <= 0 ? C.inkMuted : powerColor(aim.pull01);
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
        // Where it ends it says what will happen.
        const pts = f.line.pts;
        const ex = pts[pts.length - 2];
        const ey = pts[pts.length - 1];
        if (f.line.end === "thing") {
          // A cross on the thing he reaches.
          const arm = Math.round(r * S * 0.9);
          const tw = Math.max(2, Math.round(dpr * 2.6));
          ctx.fillStyle = col;
          ctx.fillRect(Math.round(X(ex) - arm), Math.round(Y(ey) - tw / 2), arm * 2, tw);
          ctx.fillRect(Math.round(X(ex) - tw / 2), Math.round(Y(ey) - arm), tw, arm * 2);
        } else if (f.line.end === "land") {
          // The thump's ring where he would land.
          paint.ring(X(ex), Y(ey), tune.thumpRadius * S, rgba(col, 0.6), ringW);
        } else {
          ctx.fillStyle = rgba(col, 0.5);
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

    // The things in the room. Kind is told by outline; colour only confirms it.
    for (const d of state.things) {
      if (state.tick < d.landTick) continue;
      const dx = d.px + (d.x - d.px) * alpha;
      const dy = d.py + (d.y - d.py) * alpha;
      const dr = KINDS[d.kind].radius;
      const willHit = f.line !== null && f.line.hitId === d.id;
      if (d.kind === "token") {
        // A ring with a hole.
        paint.disc(X(dx), Y(dy), dr * S, cellFx, willHit ? mix(C.acid, C.ink, 0.45) : C.acid);
        paint.disc(X(dx), Y(dy), dr * S * 0.45, cellFx, floor);
      } else {
        // A small round body with two eyes.
        paint.disc(X(dx), Y(dy), dr * S, cellFx, willHit ? mix(C.ash, C.ink, 0.45) : C.ash);
        const eyeS = Math.max(2, Math.round(S * 2.4));
        ctx.fillStyle = C.page;
        ctx.fillRect(Math.round(X(dx) - dr * S * 0.5), Math.round(Y(dy) - eyeS / 2), eyeS, eyeS);
        ctx.fillRect(Math.round(X(dx) + dr * S * 0.5 - eyeS), Math.round(Y(dy) - eyeS / 2), eyeS, eyeS);
      }
      if (state.tick < d.dazedUntil) {
        // Dazed: two 3 u phosphor squares, 3 u apart, 2 u above the body,
        // for exactly as long as it is harmless.
        const q = Math.max(2, Math.round(S * 3));
        ctx.fillStyle = C.ink;
        ctx.fillRect(Math.round(X(dx - 4.5)), Math.round(Y(dy - dr - 5)), q, q);
        ctx.fillRect(Math.round(X(dx + 1.5)), Math.round(Y(dy - dr - 5)), q, q);
      }
    }

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
    const sx = f.reduced ? 1 : fx.squashX;
    const sy = f.reduced ? 1 : fx.squashY;
    // The painter scales about the middle of its grid, and his body's
    // middle is one cell under that. A squash is anchored at the cushion.
    let px = Math.round(X(hx));
    let py = Math.round(Y(hy)) - cell;
    if (fx.squashSide === "left") px -= Math.round((1 - sx) * 7 * cell);
    else if (fx.squashSide === "right") px += Math.round((1 - sx) * 7 * cell);
    else if (fx.squashSide === "top") py -= Math.round((1 - sy) * 6 * cell);
    else if (fx.squashSide === "bottom") py += Math.round((1 - sy) * 6 * cell);
    drawHugoSprite(ctx, {
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
    });

    // The hot ring: whole, phosphor, 2 u thick, 4 u outside his circle.
    // Where the room is shrunk his drawn body can be wider than his
    // circle: then the ring moves out to one cell beyond the body.
    if (h.hot) {
      const w = Math.max(2, Math.round(2 * S));
      const inner = Math.max((r + 3) * S, 8 * cell);
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

    // Floating numbers: a multiplier where a pop earned it, a launch's total where it ended.
    for (const n of fx.floats) {
      const a = Math.min(1, n.life / (n.max * 0.4));
      const fy = Math.max(state.room.top + 12, n.y);
      paint.text(n.text, X(Math.min(state.room.right - 16, Math.max(state.room.left + 16, n.x))), Y(fy), n.big ? 28 : 22, rgba(C.ink, a), "display");
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);

    drawBar(paint, state, tune, f.live);

    // The hint in the thumb deck.
    if (hintInDeck && (hint.hand || hint.words !== "")) drawDeckHint(paint, hint, tune.pullDir, now, f.reduced);

    // Where the pull began, faintly, so it has a start you can see.
    if (f.pull) {
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
