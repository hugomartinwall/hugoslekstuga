/**
 * What is drawn for reading rather than for playing: the top bar (hearts,
 * the clock, the night's twelve steps, the score, the pause key; while the
 * aim would take a charm, that charm's name and line), the pips and the
 * slow-motion meter he carries, the two start hints, and the one line a
 * page too small to play shows.
 *
 * Drawn plainly: the shapes say what they are, and their art comes with
 * the step that draws everything else. Sizes given in px do not scale
 * with the room; sizes given in units do.
 */
import { CHARM_LINE, CHARM_NAME, HINT, HINT_AGAIN } from "../content/copy";
import { CLOCK, HOURS } from "../content/night";
import type { State, Tune } from "../sim/types";
import { hourStep, pauseKeyRect } from "./layout";
import { C, charmColor, rgba } from "./palette";
import type { Paint } from "./renderer";

/** Seconds for one pull-and-let-go of the ghost hand. */
const HAND_LOOP_S = 2.2;

/** A heart on a 7 × 6 grid of 2 px cells: 14 × 12 px. */
const HEART = [".XX.XX.", "XXXXXXX", "XXXXXXX", ".XXXXX.", "..XXX..", "...X..."];

// ── The top bar ───────────────────────────────────────────────────────

function drawHeart(p: Paint, x: number, y: number, full: boolean): void {
  const cell = 2 * p.dpr;
  p.ctx.fillStyle = C.coral;
  for (let r = 0; r < HEART.length; r++) {
    for (let c = 0; c < 7; c++) {
      if (HEART[r][c] !== "X") continue;
      if (!full) {
        // A lost heart is hollow, not dimmer: its outline only.
        const filled = (rr: number, cc: number) => rr >= 0 && rr < HEART.length && cc >= 0 && cc < 7 && HEART[rr][cc] === "X";
        if (filled(r - 1, c) && filled(r + 1, c) && filled(r, c - 1) && filled(r, c + 1)) continue;
      }
      p.ctx.fillRect(Math.round(x + c * cell), Math.round(y + r * cell), Math.round(cell), Math.round(cell));
    }
  }
}

/** The span the charm's words are centred in starts this far into the bar, px, and ends this far from its right edge. */
const NAME_FROM_PX = 88;
const NAME_TO_PX = 60;
/** The span must hold this much for the hearts to stay: a line of 27 cells of 9 px, less the half pixel each side the spec allows. */
const NAME_SPAN_PX = 242;

/**
 * The bar above the room. `live` says a night is in progress: the pause
 * key is drawn at full strength only then, because only then does it act.
 * `named` is the charm the aim line names (§9.3), or "": while there is
 * one, its name and line take the place of the clock, the night's steps
 * and the score, and on a bar too narrow for the line the hearts give way
 * too.
 */
export function drawBar(p: Paint, s: State, tune: Tune, live: boolean, named = "", turn: { from: number; k: number } | null = null): void {
  const { ctx, dpr } = p;
  const bar = p.layout.bar;
  const bx = bar.x * dpr;
  const by = bar.y * dpr;
  const B = bar.w * dpr;
  const naming = named !== "" && CHARM_NAME[named] !== undefined;
  const wide = bar.w - NAME_FROM_PX - NAME_TO_PX >= NAME_SPAN_PX;

  // The bar is on top of the room (§9.9): a pull band that runs up out of the room goes under it, not through its words.
  ctx.fillStyle = C.page;
  ctx.fillRect(Math.round(bx), Math.round(by), Math.round(B), Math.round(bar.h * dpr));

  // Hearts: the first at x 12, y 18 to 30, one every 18 px. Four at most, with Thick skin.
  if (!naming || wide) {
    const most = Math.max(s.stats.maxHearts, s.hearts);
    // Four fit, one every 18 px. More (only a tune typed by hand gives more) close up to fit the same span, clear of the clock.
    const every = most > 4 ? (18 * 3) / (most - 1) : 18;
    for (let i = 0; i < most; i++) drawHeart(p, bx + (12 + every * i) * dpr, by + 18 * dpr, i < s.hearts);
  }

  if (naming) {
    // Its name in its colour, its line in phosphor, centred in the span.
    const from = wide ? NAME_FROM_PX : 12;
    const mid = bx + ((from + bar.w - NAME_TO_PX) / 2) * dpr;
    p.text(CHARM_NAME[named], mid, by + 16 * dpr, 16, charmColor(named), "pixel");
    p.sentence(CHARM_LINE[named] ?? "", mid, by + 34 * dpr, C.ink);
    drawPauseKey(p, live);
    return;
  }

  // The clock, in the middle.
  // When 05:00 ends with no 06:00 to go to, the State's hour is one past
  // the last: the clock stays on the hour that ended.
  // (On a night with the polisher the State's hour is 06:00's, and the clock shows it, beaten or not.)
  const hour = s.ended === "morning" && s.night.hour === HOURS && !s.boss.present ? HOURS - 1 : Math.min(s.night.hour, CLOCK.length - 1);
  if (turn && turn.k < 1 && turn.from >= 0 && turn.from < CLOCK.length) {
    // The clock turns: the hour that ended rolls up and out, the new one up and in.
    const k = Math.max(0, Math.min(1, turn.k));
    const lift = 12 * dpr;
    ctx.save();
    ctx.beginPath();
    ctx.rect(Math.round(bx + B / 2 - 44 * dpr), Math.round(by + 4 * dpr), Math.round(88 * dpr), Math.round(30 * dpr));
    ctx.clip();
    p.text(CLOCK[turn.from], bx + B / 2, by + 20 * dpr - lift * k, 24, rgba(C.ink, 1 - k), "display");
    p.text(CLOCK[hour], bx + B / 2, by + 20 * dpr + lift * (1 - k), 24, rgba(C.ink, k), "display");
    ctx.restore();
  } else {
    p.text(CLOCK[hour], bx + B / 2, by + 20 * dpr, 24, C.ink, "display");
  }

  // The night: twelve steps of 6 × 4 px, 2 px apart.
  const stepW = 6 * dpr;
  const stepH = 4 * dpr;
  const x0 = bx + B / 2 - 47 * dpr;
  const y0 = Math.round(by + 36 * dpr);
  const hair = Math.max(1, Math.round(dpr));
  for (let i = 0; i < 12; i++) {
    const x = Math.round(x0 + i * 8 * dpr);
    const lit = hourStep(s, i);
    if (lit === "done") {
      ctx.fillStyle = C.ink;
      ctx.fillRect(x, y0, Math.round(stepW), Math.round(stepH));
    } else if (lit === "now") {
      ctx.fillStyle = C.magenta;
      ctx.fillRect(x, y0, Math.round(stepW), Math.round(stepH));
    } else {
      ctx.fillStyle = C.inkMuted;
      ctx.fillRect(x, y0, Math.round(stepW), hair);
      ctx.fillRect(x, y0 + Math.round(stepH) - hair, Math.round(stepW), hair);
      ctx.fillRect(x, y0, hair, Math.round(stepH));
      ctx.fillRect(x + Math.round(stepW) - hair, y0, hair, Math.round(stepH));
    }
  }

  // The score: its right edge 64 px from the bar's.
  p.text(String(s.score), bx + B - 64 * dpr, by + 20 * dpr, 24, C.ink, "display", "right");

  drawPauseKey(p, live);
}

/** The pause key: a stepped keycap with two bars, in the bar's right corner. */
function drawPauseKey(p: Paint, live: boolean): void {
  const { ctx, dpr } = p;
  const bar = p.layout.bar;
  const hair = Math.max(1, Math.round(dpr));
  const k = pauseKeyRect(bar);
  const kx = Math.round(k.x * dpr);
  const ky = Math.round(k.y * dpr);
  const kw = Math.round(k.w * dpr);
  const kh = Math.round(k.h * dpr);
  const n = Math.round(2 * dpr);
  ctx.globalAlpha = live ? 1 : 0.35;
  // The frame, then the face inside it: both with 4 px stepped corners.
  for (const [inset, color] of [
    [0, C.rail],
    [hair, C.panel],
  ] as const) {
    ctx.fillStyle = color;
    ctx.fillRect(kx + 2 * n + inset, ky + inset, kw - 4 * n - 2 * inset, kh - 2 * inset);
    ctx.fillRect(kx + n + inset, ky + n + inset, kw - 2 * n - 2 * inset, kh - 2 * n - 2 * inset);
    ctx.fillRect(kx + inset, ky + 2 * n + inset, kw - 2 * inset, kh - 4 * n - 2 * inset);
  }
  // The keycap's bevel: a darker foot.
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.fillRect(kx + 2 * n, ky + kh - Math.round(4 * dpr), kw - 4 * n, Math.round(3 * dpr));
  ctx.fillStyle = C.ink;
  const barW = Math.round(4 * dpr);
  const barH = Math.round(14 * dpr);
  const midX = kx + kw / 2;
  const top = Math.round(ky + (kh - barH) / 2 - dpr);
  ctx.fillRect(Math.round(midX - 6 * dpr), top, barW, barH);
  ctx.fillRect(Math.round(midX + 2 * dpr), top, barW, barH);
  ctx.globalAlpha = 1;
}

// ── On him ────────────────────────────────────────────────────────────

/**
 * The pips: 6 × 6 u squares, one every 9 u. Filled is ready, hollow is
 * spent, and the next one fills from the left as it comes back. After a
 * refused launch they are coral for a moment.
 */
export function drawPips(p: Paint, s: State, tune: Tune, cx: number, cy: number, refused: boolean, shakeU: number): void {
  const { ctx, S } = p;
  // His most after charms: four with Fourth pip.
  const n = Math.max(1, s.stats.pipMax);
  const side = Math.max(3, Math.round(6 * S));
  const gap = 9 * S;
  const edge = Math.max(1, Math.round(S));
  const color = refused ? C.coral : C.ink;
  const y = Math.round(p.Y(cy) - side / 2);
  const coming = s.pips < s.stats.pipMax ? 1 - s.pipTimer / Math.max(1, tune.pipRefillTicks) : 0;
  for (let i = 0; i < n; i++) {
    const x = Math.round(p.X(cx + shakeU) + (i - (n - 1) / 2) * gap - side / 2);
    // What is under a pip must not show inside a hollow one.
    ctx.fillStyle = C.page;
    ctx.fillRect(x, y, side, side);
    ctx.fillStyle = color;
    if (i < s.pips) {
      ctx.fillRect(x, y, side, side);
      continue;
    }
    ctx.fillRect(x, y, side, edge);
    ctx.fillRect(x, y + side - edge, side, edge);
    ctx.fillRect(x, y, edge, side);
    ctx.fillRect(x + side - edge, y, edge, side);
    if (i === s.pips && coming > 0) ctx.fillRect(x, y, Math.round(side * Math.min(1, Math.max(0, coming))), side);
  }
}

/** The slow-motion meter: a 30 × 3 u bar, as full as the meter. */
export function drawMeter(p: Paint, cx: number, cy: number, meter01: number): void {
  const { ctx, S } = p;
  const w = Math.round(30 * S);
  const h = Math.max(2, Math.round(3 * S));
  const x = Math.round(p.X(cx) - w / 2);
  const y = Math.round(p.Y(cy) - h / 2);
  ctx.fillStyle = C.page;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = rgba(C.ink, 0.22);
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = C.ink;
  ctx.fillRect(x, y, Math.round(w * Math.min(1, Math.max(0, meter01))), h);
}

// ── The start hints ───────────────────────────────────────────────────

/** How far along its pull the ghost hand is, 0..1, and whether it is still on the glass. */
function handAt(now: number, reduced: boolean): { travel: number; down: boolean } {
  if (reduced) return { travel: 1, down: true };
  const loop = ((now / 1000) % HAND_LOOP_S) / HAND_LOOP_S;
  const k = loop < 0.6 ? loop / 0.6 : loop < 0.75 ? 1 : 0;
  return { travel: k * k * (3 - 2 * k), down: loop < 0.75 };
}

/**
 * The ghost hand: a disc that pulls from (x, y0) to (x, y1) and lets go,
 * with a faint line back to where it began. All in device px.
 */
function drawHand(p: Paint, x: number, y0: number, y1: number, now: number, reduced: boolean): void {
  const { travel, down } = handAt(now, reduced);
  const y = y0 + (y1 - y0) * travel;
  const w = Math.max(2, Math.round(2 * p.dpr));
  p.ctx.fillStyle = rgba(C.ink, 0.16);
  p.ctx.fillRect(Math.round(x - w / 2), Math.round(Math.min(y0, y)), w, Math.round(Math.abs(y - y0)) + 1);
  p.disc(x, y, 11 * p.dpr, Math.max(2, Math.round(2 * p.dpr)), rgba(C.ink, down ? 0.55 : 0.18));
}

/** A rectangle outline broken into dashes: the pad the ghost hand works in. */
function brokenRect(p: Paint, x: number, y: number, w: number, h: number, color: string): void {
  const t = Math.max(2, Math.round(2 * p.dpr));
  const dash = Math.round(8 * p.dpr);
  const step = Math.round(14 * p.dpr);
  p.ctx.fillStyle = color;
  for (let dx = 0; dx < w; dx += step) {
    const len = Math.min(dash, w - dx);
    p.ctx.fillRect(Math.round(x + dx), Math.round(y), len, t);
    p.ctx.fillRect(Math.round(x + dx), Math.round(y + h - t), len, t);
  }
  for (let dy = 0; dy < h; dy += step) {
    const len = Math.min(dash, h - dy);
    p.ctx.fillRect(Math.round(x), Math.round(y + dy), t, len);
    p.ctx.fillRect(Math.round(x + w - t), Math.round(y + dy), t, len);
  }
}

/**
 * The hint in the thumb deck: the words, and until the third launch a pad
 * under them with the ghost hand in it. Sizes are CSS px.
 */
export function drawDeckHint(
  p: Paint,
  hint: { hand: boolean; words: "first" | "again" | "" },
  dir: "back" | "push",
  now: number,
  reduced: boolean,
): void {
  const { room, deck } = p.layout;
  const cx = (room.x + room.w / 2) * p.dpr;
  const top = deck.y * p.dpr;
  if (hint.words === "first") {
    p.text(HINT.touch[dir], cx, top + 20 * p.dpr, 16, C.ink, "pixel");
  } else if (hint.words === "again") {
    p.text(HINT_AGAIN[0], cx, top + 11 * p.dpr, 16, C.ink, "pixel");
    p.text(HINT_AGAIN[1], cx, top + 29 * p.dpr, 16, C.ink, "pixel");
  }
  if (!hint.hand) return;
  const padW = 180 * p.dpr;
  const padH = 72 * p.dpr;
  const padY = top + 40 * p.dpr;
  brokenRect(p, cx - padW / 2, padY, padW, padH, rgba(C.ink, 0.4));
  const a = padY + 14 * p.dpr;
  const b = padY + 58 * p.dpr;
  if (dir === "back") drawHand(p, cx, a, b, now, reduced);
  else drawHand(p, cx, b, a, now, reduced);
}

/**
 * The hint on the floor, where there is no deck to hold it (a laptop, or
 * a phone whose deck is short): the words above him, and the hand pulling
 * 72 px straight down from him. There is no pad in the room.
 */
export function drawRoomHint(
  p: Paint,
  hint: { hand: boolean; words: "first" | "again" | "" },
  dir: "back" | "push",
  him: { x: number; y: number },
  now: number,
  reduced: boolean,
): void {
  const y = p.Y(318);
  if (hint.words === "first" && p.layout.coarse) {
    p.text(HINT.touch[dir], p.X(180), y, 16, C.ink, "pixel");
  } else if (hint.words === "first") {
    // No touch screen: the keys, then the mouse.
    p.text(HINT.mouse[dir][0], p.X(180), y, 16, C.ink, "pixel");
    p.text(HINT.mouse[dir][1], p.X(180), y + 18 * p.dpr, 16, C.ink, "pixel");
  } else if (hint.words === "again") {
    p.text(HINT_AGAIN[0], p.X(180), y, 16, C.ink, "pixel");
    p.text(HINT_AGAIN[1], p.X(180), y + 18 * p.dpr, 16, C.ink, "pixel");
  }
  if (!hint.hand) return;
  const hx = p.X(him.x);
  const hy = p.Y(him.y);
  const pull = 72 * p.dpr;
  if (dir === "back") drawHand(p, hx, hy, hy + pull, now, reduced);
  else drawHand(p, hx, hy + pull, hy, now, reduced);
}

