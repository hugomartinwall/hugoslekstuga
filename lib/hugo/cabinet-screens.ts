/**
 * What is playing on each cabinet.
 *
 * On the homepage the games used to be four identical magenta boxes
 * told apart only by their labels. Each cabinet's screen now runs a
 * tiny scene from its own game, drawn in code on a 30×16 grid of
 * "screen pixels" — small enough to be cheap, big enough to read as
 * that game and no other.
 *
 * A painter gets `put(x, y, w, h, color)` in grid cells and a time in
 * seconds. It never touches a canvas itself, so the same scene draws
 * at any size (the homepage row, the phone cards). Reduced motion
 * calls it with one fixed time: a still frame, nothing loops.
 *
 * Pure: time in, rectangles out. No state between frames.
 */

export const SCREEN_W = 30;
export const SCREEN_H = 16;

export type Put = (x: number, y: number, w: number, h: number, color: string) => void;
export type ScreenPainter = (put: Put, t: number) => void;

/** The time a still frame is drawn at under reduced motion. */
export const STILL_T = 1.35;

const C = {
  ink: "#e8f2e9",
  coral: "#ff6e5e",
  cyan: "#35e0ff",
  acid: "#d8ff3d",
  magenta: "#ff4fd8",
  mint: "#3df08a",
  violet: "#a78bff",
  amber: "#ffb13d",
  ash: "#5b6577",
  ashDark: "#343a4a",
  dim: "#1b2033",
};

/** Overrun — two sides send everything down three lanes. */
const overrun: ScreenPainter = (put, t) => {
  // Home edges.
  put(0, 1, 1, 14, C.cyan);
  put(29, 1, 1, 14, C.coral);
  const lanes = [3, 7, 11];
  for (let lane = 0; lane < 3; lane++) {
    const y = lanes[lane];
    put(1, y + 1, 28, 1, C.dim);
    for (let i = 0; i < 3; i++) {
      const a = 2 + ((t * (5 + lane) + i * 9 + lane * 4) % 26);
      const b = 27 - ((t * (4.5 + lane * 0.5) + i * 9 + lane * 2) % 26);
      const ax = Math.floor(a);
      const bx = Math.floor(b);
      if (Math.abs(ax - bx) <= 1) {
        // They meet: one white frame of contact.
        put(Math.min(ax, bx), y - 1, 2, 3, C.ink);
      } else {
        put(ax, y, 2, 1, C.cyan);
        put(bx, y, 2, 1, C.coral);
      }
    }
  }
};

/** Adventure — a small hero, a sword, a slime, three hearts. */
const adventure: ScreenPainter = (put, t) => {
  put(0, 13, SCREEN_W, 1, C.mint);
  put(0, 14, SCREEN_W, 2, "#14352c");
  for (let i = 0; i < 3; i++) put(1 + i * 3, 1, 2, 2, C.coral);
  const p = (t % 4.2) / 4.2;
  const walk = Math.min(1, p / 0.62);
  const hx = Math.floor(3 + walk * 15);
  const bob = p < 0.62 && Math.floor(t * 8) % 2 === 0 ? 1 : 0;
  // The hero is the mascot's colour.
  put(hx, 9 + bob, 4, 4 - bob, C.coral);
  put(hx + 2, 10 + bob, 1, 1, C.ink);
  const swinging = p >= 0.62 && p < 0.74;
  const popped = p >= 0.68 && p < 0.92;
  if (swinging) {
    put(hx + 4, 8, 1, 1, C.ink);
    put(hx + 5, 9, 1, 1, C.ink);
    put(hx + 6, 10, 2, 1, C.ink);
  } else {
    put(hx + 4, 10, 2, 1, C.ink);
  }
  if (!popped) {
    const squash = Math.floor(t * 3) % 2;
    put(23, 10 + squash, 5, 3 - squash, C.violet);
    put(24, 11, 1, 1, C.dim);
    put(26, 11, 1, 1, C.dim);
  } else {
    const k = (p - 0.68) / 0.24;
    const d = Math.floor(k * 4);
    put(22 - d, 9 - d, 1, 1, C.violet);
    put(28 + d, 9 - d, 1, 1, C.violet);
    put(25, 8 - d, 1, 1, C.violet);
  }
};

/** Greyrot — colour pushed back into a grey world, and the rot creeping in again. */
const greyrot: ScreenPainter = (put, t) => {
  const warm = [C.amber, C.mint, C.magenta, C.cyan, C.acid, C.coral];
  const p = (t % 7) / 7;
  // The colour front grows from the middle, holds, then recedes.
  const reach = p < 0.5 ? (p / 0.5) * 4.2 : p < 0.7 ? 4.2 : (1 - (p - 0.7) / 0.3) * 4.2;
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 6; col++) {
      const d = Math.hypot(col - 2.5, (row - 1) * 1.4);
      const alive = d <= reach;
      const edge = !alive && d <= reach + 0.8;
      const color = alive ? warm[(col + row * 2) % warm.length] : edge ? C.ash : C.ashDark;
      put(col * 5, 1 + row * 5, 4, 4, color);
    }
  }
  // The sporeling, in the middle of it.
  put(14, 7, 2, 2, C.ink);
};

/** Survival Maxx — they close in from every side; the shots go out by themselves. */
const survivalMaxx: ScreenPainter = (put, t) => {
  const cx = 14;
  const cy = 7;
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.3;
    const r = 13 - ((t * 2.6 + i * 1.3) % 12);
    if (r < 1.6) continue;
    const x = Math.round(cx + Math.cos(a) * r * 1.15);
    const y = Math.round(cy + Math.sin(a) * r * 0.62);
    put(x, y, i % 3 === 0 ? 2 : 1, i % 3 === 0 ? 2 : 1, C.magenta);
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + t * 1.7;
    const r = (t * 9 + i * 2) % 8;
    put(Math.round(cx + Math.cos(a) * r * 1.15), Math.round(cy + Math.sin(a) * r * 0.62), 1, 1, C.acid);
  }
  put(cx, cy, 2, 2, C.mint);
  // The wave bar.
  put(1, 14, 28, 1, C.dim);
  put(1, 14, 1 + Math.floor(((t % 9) / 9) * 27), 1, C.mint);
};

/** A cabinet with nothing special to show: two idle pixels (the old look). */
const idle: ScreenPainter = (put, t) => {
  const blink = Math.floor(t * 2) % 2;
  put(8, 6 + blink, 3, 3, C.magenta);
  put(19, 8 - blink, 3, 3, C.magenta);
};

const SCREENS: Record<string, ScreenPainter> = {
  overrun,
  adventure,
  greyrot,
  "survival-maxx": survivalMaxx,
};

export function screenFor(slug: string): ScreenPainter {
  return SCREENS[slug] ?? idle;
}
