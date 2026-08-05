import type { Owner } from "../sim/state";
import { NODE_R, UNIT_CAP } from "../sim/constants";
import { WORLD_H, WORLD_W } from "../sim/state";

/**
 * Presentation-only effects infrastructure. Nothing here touches sim state;
 * everything runs on wall-clock time in the render layer.
 */

/* ------------------------------------------------------------- particles */

const MAX_PARTICLES = 512;

/**
 * Fixed-pool particle system: parallel number arrays, no per-particle
 * objects, ring-buffer overwrite when full. Drawn as fillRect squares
 * batched by color — the cheapest possible canvas path.
 */
export class ParticlePool {
  private x = new Float32Array(MAX_PARTICLES);
  private y = new Float32Array(MAX_PARTICLES);
  private vx = new Float32Array(MAX_PARTICLES);
  private vy = new Float32Array(MAX_PARTICLES);
  private born = new Float64Array(MAX_PARTICLES);
  private life = new Float32Array(MAX_PARTICLES);
  private size = new Float32Array(MAX_PARTICLES);
  private color = new Uint8Array(MAX_PARTICLES); // index into palette
  private gravity = new Uint8Array(MAX_PARTICLES); // 0/1
  private head = 0;
  private lastUpdate = 0;

  constructor(private palette: string[]) {}

  spawn(
    x: number,
    y: number,
    vx: number,
    vy: number,
    lifeMs: number,
    size: number,
    colorIdx: number,
    gravity = false,
  ): void {
    const i = this.head;
    this.head = (this.head + 1) % MAX_PARTICLES;
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.born[i] = performance.now();
    this.life[i] = lifeMs;
    this.size[i] = size;
    this.color[i] = colorIdx;
    this.gravity[i] = gravity ? 1 : 0;
  }

  /** Radial burst (captures). colorIdx: palette slot for the new owner. */
  burst(x: number, y: number, count: number, colorIdx: number): void {
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2 + Math.random() * 0.5;
      const speed = 20 + Math.random() * 30; // wu/s
      this.spawn(
        x,
        y,
        Math.cos(ang) * speed,
        Math.sin(ang) * speed,
        400 + Math.random() * 200,
        0.6 + Math.random() * 0.6,
        colorIdx,
        false,
      );
    }
  }

  /** Confetti wave from the top edge (win overlay). */
  confetti(count: number, colorIdxA: number, colorIdxB: number): void {
    for (let i = 0; i < count; i++) {
      this.spawn(
        Math.random() * WORLD_W,
        -2,
        (Math.random() - 0.5) * 20,
        15 + Math.random() * 25,
        2500,
        0.7 + Math.random() * 0.7,
        Math.random() < 0.6 ? colorIdxA : colorIdxB,
        true,
      );
    }
  }

  /** Update + draw. Call once per frame inside the world transform. */
  draw(ctx: CanvasRenderingContext2D): void {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastUpdate) / 1000);
    this.lastUpdate = now;

    // Batch by color to minimise fillStyle changes.
    for (let c = 0; c < this.palette.length; c++) {
      let started = false;
      for (let i = 0; i < MAX_PARTICLES; i++) {
        if (this.color[i] !== c || this.life[i] === 0) continue;
        const age = now - this.born[i]!;
        if (age >= this.life[i]!) {
          this.life[i] = 0;
          continue;
        }
        if (this.gravity[i]) this.vy[i]! += 60 * dt;
        this.x[i]! += this.vx[i]! * dt;
        this.y[i]! += this.vy[i]! * dt;
        if (!started) {
          ctx.fillStyle = this.palette[c]!;
          started = true;
        }
        const fade = 1 - age / this.life[i]!;
        const s = this.size[i]! * (0.5 + 0.5 * fade);
        ctx.globalAlpha = fade;
        ctx.fillRect(this.x[i]! - s / 2, this.y[i]! - s / 2, s, s);
      }
    }
    ctx.globalAlpha = 1;
  }
}

/* ----------------------------------------------------------- halo sprites */

function shade(hex: string, factor: number): string {
  const n = (i: number) =>
    Math.max(0, Math.min(255, Math.round(parseInt(hex.slice(i, i + 2), 16) * factor)));
  return `rgb(${n(1)},${n(3)},${n(5)})`;
}

/**
 * Pre-rendered sprites per (owner, size) — per-frame canvas shadowBlur is the
 * classic low-end performance cliff, so it's banned here. Two layers, both
 * rebuilt on resize (scale-dependent), each one drawImage per node:
 *  - halo: soft additive glow under owned nodes
 *  - sphere: pseudo-3D shaded disc (off-center highlight, darker limb, rim)
 */
export class SpriteCache {
  private halos = new Map<string, HTMLCanvasElement>();
  private spheres = new Map<string, HTMLCanvasElement>();
  private scale = 0;
  /** Kill switch — first rung of the degradation ladder. */
  enabled = true;

  rebuild(scale: number, colors: Record<Owner, string>): void {
    this.scale = scale;
    this.halos.clear();
    this.spheres.clear();
    for (const owner of ["player", "enemy"] as const) {
      for (let size = 0; size < NODE_R.length; size++) {
        const r = NODE_R[size]! * scale;
        const pad = 4 * scale;
        const side = Math.ceil(2 * (r + pad));
        const c = document.createElement("canvas");
        c.width = side;
        c.height = side;
        const g = c.getContext("2d")!;
        const grad = g.createRadialGradient(
          side / 2, side / 2, r * 0.8,
          side / 2, side / 2, r + pad,
        );
        grad.addColorStop(0, colors[owner] + "38"); // 0.22 alpha
        grad.addColorStop(1, colors[owner] + "00");
        g.fillStyle = grad;
        g.fillRect(0, 0, side, side);
        this.halos.set(`${owner}${size}`, c);
      }
    }
    for (const owner of ["player", "enemy", "neutral"] as const) {
      for (let size = 0; size < NODE_R.length; size++) {
        const r = NODE_R[size]! * scale;
        const side = Math.ceil(2 * (r + 2)); // small pad for AA
        const c = document.createElement("canvas");
        c.width = side;
        c.height = side;
        const g = c.getContext("2d")!;
        const cx = side / 2;
        const cy = side / 2;
        const base = colors[owner];
        // Sphere shading: highlight up-left of centre, limb darkening at edge.
        const grad = g.createRadialGradient(
          cx - r * 0.35, cy - r * 0.4, r * 0.1,
          cx, cy, r,
        );
        grad.addColorStop(0, shade(base, 1.45));
        grad.addColorStop(0.35, shade(base, 1.12));
        grad.addColorStop(0.75, base);
        grad.addColorStop(1, shade(base, 0.62));
        g.fillStyle = grad;
        g.beginPath();
        g.arc(cx, cy, r, 0, Math.PI * 2);
        g.fill();
        // Thin rim light along the lower-right limb for depth.
        g.strokeStyle = "rgba(232,242,233,0.14)"; // ink @ lib/colors.ts
        g.lineWidth = Math.max(1, r * 0.07);
        g.beginPath();
        g.arc(cx, cy, r - g.lineWidth / 2, Math.PI * 0.15, Math.PI * 0.6);
        g.stroke();
        this.spheres.set(`${owner}${size}`, c);
      }
    }
  }

  /** Draw under a node. Coordinates in world units (ctx is world-transformed). */
  drawHalo(ctx: CanvasRenderingContext2D, owner: Owner, size: number, x: number, y: number): void {
    if (!this.enabled || owner === "neutral" || this.scale === 0) return;
    const sprite = this.halos.get(`${owner}${size}`);
    if (!sprite) return;
    const side = sprite.width / this.scale; // back to world units
    ctx.drawImage(sprite, x - side / 2, y - side / 2, side, side);
  }

  /**
   * Draw the shaded sphere at an arbitrary radius (scale pops just scale the
   * sprite). `alpha` supports the flip crossfade: draw old owner at 1, new
   * owner on top at t.
   */
  drawSphere(
    ctx: CanvasRenderingContext2D,
    owner: Owner,
    size: number,
    x: number,
    y: number,
    r: number,
    alpha = 1,
  ): boolean {
    if (this.scale === 0) return false;
    const sprite = this.spheres.get(`${owner}${size}`);
    if (!sprite) return false;
    const baseR = NODE_R[size]!;
    const side = (sprite.width / this.scale) * (r / baseR);
    if (alpha < 1) ctx.globalAlpha = alpha;
    ctx.drawImage(sprite, x - side / 2, y - side / 2, side, side);
    if (alpha < 1) ctx.globalAlpha = 1;
    return true;
  }
}

/* ------------------------------------------------------ background ambience */

/** Baked full-screen vignette (device pixels), rebuilt on resize. */
export function bakeVignette(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(
    w / 2, h / 2, Math.min(w, h) * 0.35,
    w / 2, h / 2, Math.hypot(w, h) / 2,
  );
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(1, "rgba(0,0,0,0.35)");
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  return c;
}

/** Slow-drifting background dust, world-space, wraps around. */
export class Dust {
  private x: number[] = [];
  private y: number[] = [];
  private v: number[] = [];
  private s: number[] = [];
  private last = 0;

  constructor(count = 40) {
    for (let i = 0; i < count; i++) {
      this.x.push(Math.random() * WORLD_W);
      this.y.push(Math.random() * WORLD_H);
      this.v.push(0.5 + Math.random() * 1.2); // wu/s, drifting up-left
      this.s.push(0.2 + Math.random() * 0.35);
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    ctx.fillStyle = "rgba(232,242,233,0.07)"; // ink @ lib/colors.ts
    for (let i = 0; i < this.x.length; i++) {
      this.x[i]! -= this.v[i]! * dt * 0.6;
      this.y[i]! -= this.v[i]! * dt;
      if (this.y[i]! < 0) {
        this.y[i] = WORLD_H;
        this.x[i] = Math.random() * WORLD_W;
      }
      if (this.x[i]! < 0) this.x[i] = WORLD_W;
      ctx.fillRect(this.x[i]!, this.y[i]!, this.s[i]!, this.s[i]!);
    }
  }
}

/* ---------------------------------------------------------------- UI chrome */

export const MUTE_POS = { x: WORLD_W - 5, y: 4.5 };
export const PAUSE_POS = { x: WORLD_W - 12, y: 4.5 };
const UI_HIT_R = 3.4; // generous for touch, but the two buttons are 7 wu apart

export type UiButton = "mute" | "pause";

/** Which top-right UI button a world-space point hits, if any. */
export function hitUiButton(wx: number, wy: number): UiButton | null {
  if (Math.hypot(wx - MUTE_POS.x, wy - MUTE_POS.y) <= UI_HIT_R) return "mute";
  if (Math.hypot(wx - PAUSE_POS.x, wy - PAUSE_POS.y) <= UI_HIT_R) return "pause";
  return null;
}

/** Back-compat helper used by the overlay guard. */
export function isMuteHit(wx: number, wy: number): boolean {
  return hitUiButton(wx, wy) === "mute";
}

/** Pause icon (two bars), world coordinates. */
export function drawPauseIcon(ctx: CanvasRenderingContext2D): void {
  const { x, y } = PAUSE_POS;
  ctx.save();
  ctx.fillStyle = "rgba(232,242,233,0.55)";
  ctx.fillRect(x - 1.3, y - 1.7, 1.0, 3.4);
  ctx.fillRect(x + 0.3, y - 1.7, 1.0, 3.4);
  ctx.restore();
}

/* ------------------------------------------------------- pause menu layout */

export interface PanelButton {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** World-space button rects for the pause/settings panel. */
export const PAUSE_MENU = {
  panel: { x: 48, y: 14, w: 64, h: 62 },
  resume: { x: 55, y: 24, w: 50, h: 9 },
  restart: { x: 55, y: 36, w: 50, h: 9 },
  mute: { x: 55, y: 48, w: 50, h: 9 },
  exit: { x: 55, y: 60, w: 50, h: 9 },
} as const;

export type PauseAction = "resume" | "restart" | "mute" | "exit";

export function hitPauseMenu(wx: number, wy: number): PauseAction | "outside" | "panel" {
  const inRect = (r: PanelButton) => wx >= r.x && wx <= r.x + r.w && wy >= r.y && wy <= r.y + r.h;
  if (inRect(PAUSE_MENU.resume)) return "resume";
  if (inRect(PAUSE_MENU.restart)) return "restart";
  if (inRect(PAUSE_MENU.mute)) return "mute";
  if (inRect(PAUSE_MENU.exit)) return "exit";
  if (inRect(PAUSE_MENU.panel)) return "panel";
  return "outside"; // tap outside = resume
}

/** Speaker icon, drawn in world coordinates. Slash when muted. */
export function drawMuteIcon(ctx: CanvasRenderingContext2D, muted: boolean): void {
  const { x, y } = MUTE_POS;
  ctx.save();
  ctx.strokeStyle = "rgba(232,242,233,0.55)";
  ctx.fillStyle = "rgba(232,242,233,0.55)";
  ctx.lineWidth = 0.4;

  // Speaker body: small rect + triangle cone
  ctx.beginPath();
  ctx.moveTo(x - 2.2, y - 0.7);
  ctx.lineTo(x - 1.2, y - 0.7);
  ctx.lineTo(x - 0.1, y - 1.8);
  ctx.lineTo(x - 0.1, y + 1.8);
  ctx.lineTo(x - 1.2, y + 0.7);
  ctx.lineTo(x - 2.2, y + 0.7);
  ctx.closePath();
  ctx.fill();

  if (muted) {
    ctx.strokeStyle = "rgba(255,110,94,0.8)"; // coral @ lib/colors.ts
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(x - 2.6, y + 2.4);
    ctx.lineTo(x + 2.4, y - 2.4);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(x + 0.4, y, 1.1, -Math.PI / 3, Math.PI / 3);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + 0.4, y, 2.0, -Math.PI / 3, Math.PI / 3);
    ctx.stroke();
  }
  ctx.restore();
}

/* ----------------------------------------------------------- color lerping */

/** Precomputed crossfade steps between owner colors (no per-frame parsing). */
export function buildColorSteps(colors: Record<Owner, string>, steps: number) {
  const parse = (hex: string): [number, number, number] => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
  const table = new Map<string, string[]>();
  const owners: Owner[] = ["player", "enemy", "neutral"];
  for (const a of owners) {
    for (const b of owners) {
      if (a === b) continue;
      const ca = parse(colors[a]);
      const cb = parse(colors[b]);
      const ramp: string[] = [];
      for (let i = 0; i < steps; i++) {
        const t = i / (steps - 1);
        ramp.push(
          `rgb(${Math.round(ca[0] + (cb[0] - ca[0]) * t)},${Math.round(
            ca[1] + (cb[1] - ca[1]) * t,
          )},${Math.round(ca[2] + (cb[2] - ca[2]) * t)})`,
        );
      }
      table.set(`${a}>${b}`, ramp);
    }
  }
  return table;
}

/** Fullness fraction helper shared by renderer (units/cap clamped). */
export function fullness(units: number, size: number): number {
  return Math.min(1, units / UNIT_CAP[size]!);
}
