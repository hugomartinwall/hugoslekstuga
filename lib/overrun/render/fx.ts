import type { Faction } from "../sim/state";
import { NEUTRAL, WORLD_H, WORLD_W } from "../sim/state";
import { NODE_R, UNIT_CAP } from "../sim/constants";
import { coral, FACTION_COLORS, ink, PARTICLE_PALETTE } from "./palette";

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
  private color = new Uint8Array(MAX_PARTICLES); // index into PARTICLE_PALETTE
  private gravity = new Uint8Array(MAX_PARTICLES); // 0/1
  private head = 0;
  private lastUpdate = 0;

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
    for (let c = 0; c < PARTICLE_PALETTE.length; c++) {
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
          ctx.fillStyle = PARTICLE_PALETTE[c]!;
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
 * Pre-rendered sprites per (faction, size) — per-frame canvas shadowBlur is
 * the classic low-end performance cliff, so it's banned here. Layers, all
 * rebuilt on resize (scale-dependent), each one drawImage per node:
 *  - shadow: elliptical drop shadow (owner-independent, sells depth)
 *  - halo: soft additive glow under owned nodes
 *  - sphere: pseudo-3D shaded disc (off-center highlight, darker limb, rim)
 */
export class SpriteCache {
  private halos = new Map<string, HTMLCanvasElement>();
  private spheres = new Map<string, HTMLCanvasElement>();
  private shadows: HTMLCanvasElement[] = [];
  private scale = 0;
  /** Kill switch — first rung of the degradation ladder. */
  enabled = true;

  rebuild(scale: number): void {
    this.scale = scale;
    this.halos.clear();
    this.spheres.clear();
    this.shadows = [];

    // Drop shadows: one per size, owner-independent. Light is locked top-left
    // (project rule), so shadows fall slightly down-right of center.
    for (let size = 0; size < NODE_R.length; size++) {
      const r = NODE_R[size]! * scale;
      const rx = 1.05 * r;
      const ry = 0.34 * r;
      const c = document.createElement("canvas");
      c.width = Math.ceil(rx * 2.6);
      c.height = Math.ceil(ry * 2.6);
      const g = c.getContext("2d")!;
      g.translate(c.width / 2, c.height / 2);
      g.scale(1, ry / rx);
      const grad = g.createRadialGradient(0, 0, 0, 0, 0, rx * 1.25);
      grad.addColorStop(0, "rgba(0,0,0,0.32)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grad;
      g.fillRect(-rx * 1.3, (-rx * 1.3 * rx) / ry, rx * 2.6, (rx * 2.6 * rx) / ry);
      this.shadows.push(c);
    }

    for (let f = 1 as Faction; f <= 4; f++) {
      for (let size = 0; size < NODE_R.length; size++) {
        const r = NODE_R[size]! * scale;
        const pad = 4 * scale;
        const side = Math.ceil(2 * (r + pad));
        const c = document.createElement("canvas");
        c.width = side;
        c.height = side;
        const g = c.getContext("2d")!;
        const grad = g.createRadialGradient(side / 2, side / 2, r * 0.8, side / 2, side / 2, r + pad);
        grad.addColorStop(0, FACTION_COLORS[f]! + "38"); // 0.22 alpha
        grad.addColorStop(1, FACTION_COLORS[f]! + "00");
        g.fillStyle = grad;
        g.fillRect(0, 0, side, side);
        this.halos.set(`${f}:${size}`, c);
      }
    }
    for (let f = 0 as Faction; f <= 4; f++) {
      for (let size = 0; size < NODE_R.length; size++) {
        const r = NODE_R[size]! * scale;
        const side = Math.ceil(2 * (r + 2));
        const c = document.createElement("canvas");
        c.width = side;
        c.height = side;
        const g = c.getContext("2d")!;
        const cx = side / 2;
        const cy = side / 2;
        const base = FACTION_COLORS[f]!;
        const grad = g.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
        grad.addColorStop(0, shade(base, 1.45));
        grad.addColorStop(0.35, shade(base, 1.12));
        grad.addColorStop(0.75, base);
        grad.addColorStop(1, shade(base, 0.62));
        g.fillStyle = grad;
        g.beginPath();
        g.arc(cx, cy, r, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = ink(0.14);
        g.lineWidth = Math.max(1, r * 0.07);
        g.beginPath();
        // Radius clamp: a zero-sized window at boot (hidden iframe) makes r
        // tiny and r - lineWidth/2 negative, which throws in arc().
        g.arc(cx, cy, Math.max(0, r - g.lineWidth / 2), Math.PI * 0.15, Math.PI * 0.6);
        g.stroke();
        this.spheres.set(`${f}:${size}`, c);
      }
    }
  }

  drawShadow(ctx: CanvasRenderingContext2D, size: number, x: number, y: number): void {
    if (!this.enabled || this.scale === 0) return;
    const sprite = this.shadows[size];
    if (!sprite) return;
    const r = NODE_R[size]!;
    const w = sprite.width / this.scale;
    const h = sprite.height / this.scale;
    ctx.drawImage(sprite, x + 0.1 * r - w / 2, y + 0.72 * r - h / 2, w, h);
  }

  /** Draw under a node. `mult` carries the per-faction pulse rhythm. */
  drawHalo(
    ctx: CanvasRenderingContext2D,
    owner: Faction,
    size: number,
    x: number,
    y: number,
    mult = 1,
  ): void {
    if (!this.enabled || owner === NEUTRAL || this.scale === 0) return;
    const sprite = this.halos.get(`${owner}:${size}`);
    if (!sprite) return;
    const side = (sprite.width / this.scale) * mult;
    ctx.drawImage(sprite, x - side / 2, y - side / 2, side, side);
  }

  /**
   * Draw the shaded sphere at an arbitrary radius (scale pops just scale the
   * sprite). `alpha` supports the flip crossfade.
   */
  drawSphere(
    ctx: CanvasRenderingContext2D,
    owner: Faction,
    size: number,
    x: number,
    y: number,
    r: number,
    alpha = 1,
  ): boolean {
    if (this.scale === 0) return false;
    const sprite = this.spheres.get(`${owner}:${size}`);
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

  draw(ctx: CanvasRenderingContext2D, color = ink(0.07)): void {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    ctx.fillStyle = color;
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

/** Subtle affine tilt: 6% vertical compression + y-depth sprite scaling. */
export const TILT_Y = 0.94;

/**
 * UI scale for small viewports. All chrome (HUD text, buttons, menus, the
 * chevron) is authored in world units, so on a portrait phone it renders at
 * ~2.4 CSS px per wu — 16 px touch targets, 10 px text. uiScale() grows the
 * chrome (draw AND hit geometry, kept in lockstep by sharing this module
 * state) until interactive targets reach ~44 CSS px; on desktop it is exactly
 * 1 and nothing changes. The board itself stays fit-contained and untouched.
 */
const UI_TARGET_CSS_PX_PER_WU = 6.5; // ≈ 44px target / (2 × UI_HIT_R)
const UI_SCALE_MAX = 3;
const MENU_FIT_MARGIN = 0.94;
const MIN_HIT_CSS = 40;

let ui = { u: 1, cssW: 0, cssH: 0, cssScale: 12 };

/** Called from the renderer's resize(); cssScale is CSS px per world unit. */
export function setUiMetrics(cssW: number, cssH: number, cssScale: number): void {
  const u = Math.min(UI_SCALE_MAX, Math.max(1, UI_TARGET_CSS_PX_PER_WU / cssScale));
  ui = { u, cssW, cssH, cssScale };
}

export function uiScale(): number {
  return ui.u;
}

/**
 * Extra zoom (≥1, ≤uiScale) applied about world center (80,45) so a menu
 * panel grows on phones without leaving the canvas. Fit is per-directional
 * extent from the anchor, so letterbox space gets used where it exists.
 */
export function menuZoom(r: { x: number; y: number; w: number; h: number }): number {
  if (ui.cssW === 0) return 1;
  const cx = WORLD_W / 2;
  const cy = WORLD_H / 2;
  const fit =
    MENU_FIT_MARGIN *
    Math.min(
      ui.cssW / 2 / (Math.max(cx - r.x, r.x + r.w - cx) * ui.cssScale),
      ui.cssH / 2 / (Math.max(cy - r.y, r.y + r.h - cy) * ui.cssScale * TILT_Y),
    );
  return Math.max(1, Math.min(ui.u, fit));
}

/** Map a world-space point back through a menuZoom about the world center. */
const unzoom = (w: number, c: number, mz: number) => c + (w - c) / mz;

/** Vertical hit padding (wu) to bring a row of height h up to MIN_HIT_CSS. */
const hitPad = (h: number, mz: number, cap: number) =>
  Math.min(cap, Math.max(0, (MIN_HIT_CSS / (ui.cssScale * mz * TILT_Y) - h) / 2));

const mutePos = () => ({ x: WORLD_W - 5 * ui.u, y: 4.5 * ui.u });
const pausePos = () => ({ x: WORLD_W - 12 * ui.u, y: 4.5 * ui.u });
const UI_HIT_R = 3.4; // generous for touch; spacing scales with u so no overlap

export type UiButton = "mute" | "pause";

/** Which top-right UI button a world-space point hits, if any. */
export function hitUiButton(wx: number, wy: number): UiButton | null {
  const m = mutePos();
  const p = pausePos();
  if (Math.hypot(wx - m.x, wy - m.y) <= UI_HIT_R * ui.u) return "mute";
  if (Math.hypot(wx - p.x, wy - p.y) <= UI_HIT_R * ui.u) return "pause";
  return null;
}

/** Back-compat helper used by the overlay guard. */
export function isMuteHit(wx: number, wy: number): boolean {
  return hitUiButton(wx, wy) === "mute";
}

/** Pause icon (two bars), world coordinates. */
export function drawPauseIcon(ctx: CanvasRenderingContext2D): void {
  const { x, y } = pausePos();
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(ui.u, ui.u);
  ctx.fillStyle = ink(0.55);
  ctx.fillRect(-1.3, -1.7, 1.0, 3.4);
  ctx.fillRect(0.3, -1.7, 1.0, 3.4);
  ctx.restore();
}

/** Speaker icon, drawn in world coordinates. Slash when muted. */
export function drawMuteIcon(ctx: CanvasRenderingContext2D, muted: boolean): void {
  const { x, y } = mutePos();
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(ui.u, ui.u);
  ctx.strokeStyle = ink(0.55);
  ctx.fillStyle = ink(0.55);
  ctx.lineWidth = 0.4;

  ctx.beginPath();
  ctx.moveTo(-2.2, -0.7);
  ctx.lineTo(-1.2, -0.7);
  ctx.lineTo(-0.1, -1.8);
  ctx.lineTo(-0.1, 1.8);
  ctx.lineTo(-1.2, 0.7);
  ctx.lineTo(-2.2, 0.7);
  ctx.closePath();
  ctx.fill();

  if (muted) {
    ctx.strokeStyle = coral(0.8);
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(-2.6, 2.4);
    ctx.lineTo(2.4, -2.4);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(0.4, 0, 1.1, -Math.PI / 3, Math.PI / 3);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0.4, 0, 2.0, -Math.PI / 3, Math.PI / 3);
    ctx.stroke();
  }
  ctx.restore();
}

/* ------------------------------------------------------- pause menu layout */

export interface PanelButton {
  x: number;
  y: number;
  w: number;
  h: number;
}

const inRect = (r: PanelButton, wx: number, wy: number) =>
  wx >= r.x && wx <= r.x + r.w && wy >= r.y && wy <= r.y + r.h;

/**
 * World-space button rects for the pause/settings panel.
 *
 * Six rows here against upstream's five — the site adds BACK TO PLAYHOUSE,
 * because a game embedded in a page needs a way out that isn't the browser
 * back button. Pitch is 10.5 (upstream 11) so six 9-high rows still finish
 * at 77 inside a panel ending at 86. Keep the panel taller than the rows or
 * menuZoom will fit to a box the buttons overflow.
 */
export const PAUSE_MENU = {
  panel: { x: 48, y: 6, w: 64, h: 80 },
  resume: { x: 55, y: 15.5, w: 50, h: 9 },
  restart: { x: 55, y: 26, w: 50, h: 9 },
  mute: { x: 55, y: 36.5, w: 50, h: 9 },
  shop: { x: 55, y: 47, w: 50, h: 9 },
  daily: { x: 55, y: 57.5, w: 50, h: 9 },
  exit: { x: 55, y: 68, w: 50, h: 9 },
} as const;

export type PauseAction = "resume" | "restart" | "mute" | "shop" | "daily" | "exit";

export function hitPauseMenu(wx: number, wy: number): PauseAction | "outside" | "panel" {
  const mz = menuZoom(PAUSE_MENU.panel);
  wx = unzoom(wx, WORLD_W / 2, mz);
  wy = unzoom(wy, WORLD_H / 2, mz);
  // Rows sit 1.5 apart at this pitch; pad the hit boxes on touch the way
  // hitShopMenu and hitOverlayButton already do.
  const pad = hitPad(9, mz, 0.75);
  const inPadded = (r: PanelButton) =>
    wx >= r.x && wx <= r.x + r.w && wy >= r.y - pad && wy <= r.y + r.h + pad;
  if (inPadded(PAUSE_MENU.resume)) return "resume";
  if (inPadded(PAUSE_MENU.restart)) return "restart";
  if (inPadded(PAUSE_MENU.mute)) return "mute";
  if (inPadded(PAUSE_MENU.shop)) return "shop";
  if (inPadded(PAUSE_MENU.daily)) return "daily";
  if (inPadded(PAUSE_MENU.exit)) return "exit";
  if (inRect(PAUSE_MENU.panel, wx, wy)) return "panel";
  return "outside"; // tap outside = resume
}

/** Secondary buttons on end-of-level overlays (world coordinates). */
export const OVERLAY_BUTTONS = {
  shop: { x: 32, y: 72, w: 42, h: 8 },
  daily: { x: 86, y: 72, w: 42, h: 8 },
} as const;

/** Union of both overlay buttons — the zoom anchor rect they share. */
export const OVERLAY_BUTTONS_RECT = { x: 32, y: 72, w: 96, h: 8 } as const;

export function hitOverlayButton(wx: number, wy: number): "shop" | "daily" | null {
  const mz = menuZoom(OVERLAY_BUTTONS_RECT);
  wx = unzoom(wx, WORLD_W / 2, mz);
  wy = unzoom(wy, WORLD_H / 2, mz);
  const pad = hitPad(OVERLAY_BUTTONS_RECT.h, mz, 2);
  const padded = (r: PanelButton) => ({ x: r.x, y: r.y - pad, w: r.w, h: r.h + 2 * pad });
  if (inRect(padded(OVERLAY_BUTTONS.shop), wx, wy)) return "shop";
  if (inRect(padded(OVERLAY_BUTTONS.daily), wx, wy)) return "daily";
  return null;
}

/** Upgrade shop: 6 track rows + close. */
export const SHOP_MENU = {
  panel: { x: 30, y: 8, w: 100, h: 76 },
  rowX: 34,
  rowW: 92,
  rowH: 8.6,
  rowY0: 18,
  rowGap: 9.6,
  close: { x: 55, y: 76.5, w: 50, h: 6 },
} as const;

export function hitShopMenu(wx: number, wy: number): number | "close" | "panel" | "outside" {
  const mz = menuZoom(SHOP_MENU.panel);
  wx = unzoom(wx, WORLD_W / 2, mz);
  wy = unzoom(wy, WORLD_H / 2, mz);
  if (inRect(SHOP_MENU.close, wx, wy)) return "close";
  const pad = hitPad(SHOP_MENU.rowH, mz, (SHOP_MENU.rowGap - SHOP_MENU.rowH) / 2);
  for (let i = 0; i < 6; i++) {
    const r = {
      x: SHOP_MENU.rowX,
      y: SHOP_MENU.rowY0 + i * SHOP_MENU.rowGap - pad,
      w: SHOP_MENU.rowW,
      h: SHOP_MENU.rowH + 2 * pad,
    };
    if (inRect(r, wx, wy)) return i;
  }
  if (inRect(SHOP_MENU.panel, wx, wy)) return "panel";
  return "outside";
}

/** Chevron upgrade button floated above a selected, eligible node.
 *  Offset grows with uiScale so the bigger glyph never overlaps the node
 *  (glyph half-height is 1.8u; gap stays 1.6 + 0.6u). At u=1 this is the
 *  original -4. */
export function chevronPos(nx: number, ny: number, r: number): { x: number; y: number } {
  return { x: nx, y: ny - r - (1.6 + 2.4 * ui.u) };
}

export function hitChevron(wx: number, wy: number, nx: number, ny: number, r: number): boolean {
  const p = chevronPos(nx, ny, r);
  return Math.hypot(wx - p.x, wy - p.y) <= 3.2 * ui.u;
}

/* ----------------------------------------------------------- color lerping */

/** Precomputed crossfade steps between faction colors (no per-frame parsing). */
export function buildColorSteps(steps: number): Map<string, string[]> {
  const parse = (hex: string): [number, number, number] => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
  const table = new Map<string, string[]>();
  for (let a = 0; a <= 4; a++) {
    for (let b = 0; b <= 4; b++) {
      if (a === b) continue;
      const ca = parse(FACTION_COLORS[a]!);
      const cb = parse(FACTION_COLORS[b]!);
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

/* ------------------------------------------------------------------ biomes */

export interface Biome {
  name: string;
  bgTop: string;
  bgBottom: string;
  board: string;
  dustColor: string;
  /** Bakes the signature ambient element onto the oversized bg canvas. */
  signature?: (g: CanvasRenderingContext2D, w: number, h: number) => void;
}

/**
 * Five biomes cycling by level. Re-tinted from upstream onto Nattöppet's
 * soft accent surfaces (--color-*-soft in globals.css) so the game keeps
 * upstream's escalation without drifting off the site's palette after
 * level 5. Board fills stay near --color-cream-deep; the signature washes
 * carry the accent.
 */
export const BIOMES: readonly Biome[] = [
  // 1 Deep Field — onboarding purity: the plain room-dark board.
  { name: "DEEP FIELD", bgTop: "#0f1119", bgBottom: "#0f1119", board: "#151726",
    dustColor: ink(0.07) },
  // 2 Nebula — teal-soft #283a49
  { name: "NEBULA", bgTop: "#0d1620", bgBottom: "#141c2b", board: "#16202b",
    dustColor: "rgba(138,240,255,0.08)",
    signature: (g, w, h) => {
      const blob = (x: number, y: number, r: number, c: string) => {
        const grad = g.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, c);
        grad.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = grad;
        g.fillRect(x - r, y - r, r * 2, r * 2);
      };
      blob(w * 0.25, h * 0.3, w * 0.28, "rgba(167,139,255,0.05)");
      blob(w * 0.7, h * 0.65, w * 0.33, "rgba(138,240,255,0.05)");
      blob(w * 0.55, h * 0.2, w * 0.2, "rgba(53,224,255,0.05)");
    } },
  // 3 Ember Wastes — tomato-soft #3a252f
  { name: "EMBER WASTES", bgTop: "#180f14", bgBottom: "#22131a", board: "#1f1720",
    dustColor: "rgba(255,110,94,0.10)",
    signature: (g, w, h) => {
      for (let i = 0; i < 4; i++) {
        const y = h * (0.25 + i * 0.18);
        const grad = g.createLinearGradient(0, y - 14, 0, y + 14);
        grad.addColorStop(0, "rgba(0,0,0,0)");
        grad.addColorStop(0.5, "rgba(255,110,94,0.035)");
        grad.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = grad;
        g.fillRect(0, y - 14, w, 28);
      }
    } },
  // 4 Glacier — blue-soft #1a3749
  { name: "GLACIER", bgTop: "#0b1620", bgBottom: "#0f2130", board: "#132430",
    dustColor: "rgba(138,240,255,0.10)",
    signature: (g, w, h) => {
      for (let band = 0; band < 2; band++) {
        g.beginPath();
        for (let x = 0; x <= w; x += 8) {
          const y = h * (0.22 + band * 0.14) + Math.sin(x / 90 + band * 2) * 18;
          if (x === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.strokeStyle = band === 0 ? "rgba(61,240,138,0.05)" : "rgba(53,224,255,0.05)";
        g.lineWidth = 22;
        g.stroke();
      }
    } },
  // 5 Void Grid — purple-soft #2c2a49
  { name: "VOID GRID", bgTop: "#0b0c14", bgBottom: "#0b0c14", board: "#141322",
    dustColor: "rgba(167,139,255,0.08)",
    signature: (g, w, h) => {
      g.strokeStyle = "rgba(167,139,255,0.05)";
      g.lineWidth = 1;
      for (let i = 0; i <= 12; i++) {
        const y = (h * i) / 12;
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(w, y);
        g.stroke();
      }
      for (let i = 0; i <= 20; i++) {
        const x = (w * i) / 20;
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x, h);
        g.stroke();
      }
    } },
];

export function biomeForLevel(level: number): Biome {
  if (level <= 5) return BIOMES[0]!;
  return BIOMES[1 + (Math.floor((level - 6) / 5) % 4)]!;
}

/** Bake a biome background, oversized by `pad` px for parallax drift. */
export function bakeBiomeBg(biome: Biome, w: number, h: number, pad: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w + pad * 2;
  c.height = h + pad * 2;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 0, c.height);
  grad.addColorStop(0, biome.bgTop);
  grad.addColorStop(1, biome.bgBottom);
  g.fillStyle = grad;
  g.fillRect(0, 0, c.width, c.height);
  biome.signature?.(g, c.width, c.height);
  return c;
}

/* ----------------------------------------------------- node-kind accessories */

/**
 * Baked accessory sprites per (faction, size): factory gear ring, fortress
 * hex shell, turret base. Drawn over the sphere; the turret barrel and zap
 * beams stay vector (they aim/animate).
 */
export class KindSprites {
  private gears = new Map<string, HTMLCanvasElement>();
  private hexes = new Map<string, HTMLCanvasElement>();
  private scale = 0;

  rebuild(scale: number): void {
    this.scale = scale;
    this.gears.clear();
    this.hexes.clear();
    for (let f = 0 as Faction; f <= 4; f++) {
      for (let size = 0; size < NODE_R.length; size++) {
        const r = NODE_R[size]! * scale;
        // Gear ring: 8 trapezoid teeth at 1.25r.
        {
          const R = r * 1.42;
          const side = Math.ceil(R * 2.2);
          const c = document.createElement("canvas");
          c.width = side;
          c.height = side;
          const g = c.getContext("2d")!;
          g.translate(side / 2, side / 2);
          g.fillStyle = shade(FACTION_COLORS[f]!, 0.55);
          for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            g.save();
            g.rotate(a);
            g.fillRect(r * 1.06, -r * 0.16, r * 0.3, r * 0.32);
            g.restore();
          }
          g.strokeStyle = shade(FACTION_COLORS[f]!, 0.75);
          g.lineWidth = Math.max(1, r * 0.1);
          g.beginPath();
          g.arc(0, 0, r * 1.1, 0, Math.PI * 2);
          g.stroke();
          this.gears.set(`${f}:${size}`, c);
        }
        // Fortress hex shell.
        {
          const R = r * 1.3;
          const side = Math.ceil(R * 2.3);
          const c = document.createElement("canvas");
          c.width = side;
          c.height = side;
          const g = c.getContext("2d")!;
          g.translate(side / 2, side / 2);
          g.beginPath();
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
            const x = R * Math.cos(a);
            const y = R * Math.sin(a);
            if (i === 0) g.moveTo(x, y);
            else g.lineTo(x, y);
          }
          g.closePath();
          g.strokeStyle = shade(FACTION_COLORS[f]!, 0.6);
          g.lineWidth = Math.max(1.5, r * 0.16);
          g.stroke();
          g.strokeStyle = ink(0.18);
          g.lineWidth = Math.max(1, r * 0.05);
          g.stroke();
          this.hexes.set(`${f}:${size}`, c);
        }
      }
    }
  }

  drawGear(
    ctx: CanvasRenderingContext2D,
    owner: Faction,
    size: number,
    x: number,
    y: number,
    angle: number,
  ): void {
    if (this.scale === 0) return;
    const s = this.gears.get(`${owner}:${size}`);
    if (!s) return;
    const side = s.width / this.scale;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.drawImage(s, -side / 2, -side / 2, side, side);
    ctx.restore();
  }

  drawHex(ctx: CanvasRenderingContext2D, owner: Faction, size: number, x: number, y: number): void {
    if (this.scale === 0) return;
    const s = this.hexes.get(`${owner}:${size}`);
    if (!s) return;
    const side = s.width / this.scale;
    ctx.drawImage(s, x - side / 2, y - side / 2, side, side);
  }
}

/* ------------------------------------------------------------------ ticker */

interface TickerLine {
  text: string;
  color: string;
  at: number;
}

/** Top-right event feed: "◆ BUILDER HAS FALLEN". Max 2 lines, coalesces. */
export class Ticker {
  private lines: TickerLine[] = [];

  push(text: string, color: string): void {
    const now = performance.now();
    const dupe = this.lines.find((l) => l.text === text);
    if (dupe) {
      dupe.at = now;
      return;
    }
    this.lines.push({ text, color, at: now });
    if (this.lines.length > 4) this.lines.shift();
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const now = performance.now();
    const u = ui.u;
    this.lines = this.lines.filter((l) => now - l.at < 2950);
    let y = 9.5 * u;
    let shown = 0;
    for (const l of this.lines) {
      if (shown >= 2) break;
      const age = now - l.at;
      const a = Math.min(1, age / 150) * Math.min(1, (2950 - age) / 300);
      ctx.save();
      ctx.globalAlpha = a * 0.85;
      ctx.font = `bold ${3.2 * u}px system-ui, sans-serif`;
      ctx.textAlign = "right";
      ctx.textBaseline = "top";
      ctx.fillStyle = l.color;
      const textW = ctx.measureText(l.text).width;
      ctx.fillRect(WORLD_W - 2.5 * u - textW - 3 * u, y + 0.6 * u, 1.6 * u, 1.6 * u);
      ctx.fillStyle = ink(0.75);
      ctx.fillText(l.text, WORLD_W - 2.5 * u, y);
      ctx.restore();
      y += 4 * u;
      shown++;
    }
  }
}

/* ------------------------------------------------------------- screen shake */

/** Exponential-decay noise shake, expressed as a world-space offset. */
export class Shake {
  private amp = 0;
  private startedAt = 0;
  private tau = 80;

  kick(amplitude: number, tauMs = 80): void {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Compare against the *decayed* amplitude: rapid re-kicks sustain at the
    // per-kick level instead of pinning the stored max forever.
    const decayed = this.amp * Math.exp(-(performance.now() - this.startedAt) / this.tau);
    this.amp = Math.min(1.5, Math.max(decayed, amplitude));
    this.tau = tauMs;
    this.startedAt = performance.now();
  }

  offset(): { x: number; y: number } {
    const t = performance.now() - this.startedAt;
    const a = this.amp * Math.exp(-t / this.tau);
    if (a < 0.02) return { x: 0, y: 0 };
    return { x: (Math.random() - 0.5) * 2 * a, y: (Math.random() - 0.5) * 2 * a };
  }
}
