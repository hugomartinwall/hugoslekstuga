/**
 * What is drawn for reading rather than for playing. Step 0 has two
 * things: the start hint that shows the gesture, and the one line a page
 * too small to play shows. The top bar, the pips and the meter join in
 * the steps that build them.
 */
import { HINT, TOO_SMALL } from "../content/copy";
import { C, rgba } from "./palette";
import type { Paint } from "./renderer";

/** The deck must be this tall for the hint to be drawn in it, px. Under that it goes on the floor. */
export const DECK_HINT_MIN = 124;
/** The hint shows until this launch. */
export const HINT_UNTIL_LAUNCH = 3;

/** Seconds for one pull-and-let-go of the ghost hand. */
const HAND_LOOP_S = 2.2;

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
 * The start hint in the thumb deck: the words, and under them a pad with
 * the ghost hand in it. Sizes are CSS px and do not scale with the room.
 */
export function drawDeckHint(p: Paint, dir: "back" | "push", now: number, reduced: boolean): void {
  const { room, deck } = p.layout;
  const cx = (room.x + room.w / 2) * p.dpr;
  const top = deck.y * p.dpr;
  p.text(HINT.touch[dir], cx, top + 20 * p.dpr, 16, C.ink, "pixel");
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
 * The start hint on the floor, where there is no deck to hold it (a
 * laptop, or a phone whose deck is short): the words above him, and the
 * hand pulling 72 px straight down from him. There is no pad in the room.
 */
export function drawRoomHint(
  p: Paint,
  dir: "back" | "push",
  him: { x: number; y: number },
  now: number,
  reduced: boolean,
): void {
  const words = p.layout.coarse ? HINT.touch[dir] : HINT.mouse[dir];
  p.text(words, p.X(180), p.Y(318), 16, C.ink, "pixel");
  const x = p.X(him.x);
  const y = p.Y(him.y);
  const pull = 72 * p.dpr;
  if (dir === "back") drawHand(p, x, y, y + pull, now, reduced);
  else drawHand(p, x, y + pull, y, now, reduced);
}

/** The page is too small to play: one line, in the middle of it. */
export function drawTooSmall(p: Paint): void {
  const { page, coarse } = p.layout;
  p.sentence(coarse ? TOO_SMALL.phone : TOO_SMALL.laptop, (page.w / 2) * p.dpr, (page.h / 2) * p.dpr, C.ink);
}
