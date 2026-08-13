import type { Faction, NodeKind, NodeSize } from "../sim/state";
import {
  KIND_BEACON,
  KIND_FACTORY,
  KIND_FORTRESS,
  KIND_CORRUPTER,
  KIND_NURSERY,
  KIND_RELAY,
  KIND_SIPHON,
  KIND_STANDARD,
  KIND_TURRET,
  KIND_RIFT,
  KIND_VAULT,
  KIND_VOLATILE,
  NEUTRAL,
  PLAYER,
  WORLD_H,
  WORLD_W,
} from "../sim/state";
import { NODE_R, unitCap } from "../sim/constants";
import { FACTION_COLORS, GOLD_HEX, inkOn, PARTICLE_PALETTE, UI_ACCENT, UI_INK } from "./palette";
import { SIGILS, SIGIL_R1, type Sigil } from "./sigil";
import { reducedMotion } from "./motion";
import type { Rect } from "./ui-layout";
import { screenRight } from "./camera";
import type { AbilityKey, TrackKey } from "../app/run";

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
  /** World-space screen-down, so "gravity" falls down the screen after rotation. */
  private down = { x: 0, y: 1 };

  setDown(d: { x: number; y: number }): void {
    this.down = d;
  }

  /**
   * Injectable so a test can assert the reduced-motion early return without a
   * canvas or a matchMedia stub.
   */
  constructor(private readonly isReduced: () => boolean = reducedMotion) {}

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
    // The single chokepoint for every particle effect in the game — capture
    // bursts, volatile blasts, upgrade pops, turret sparks, defeat embers, the
    // final-blow burst, HUD streak sparks, and confetti (burst() and
    // confetti() both funnel through here). None of them carry information
    // that is not already on screen: a capture is announced by the owner
    // crossfade and two expanding rings, a volatile blast by a ring drawn at
    // its exact radius.
    if (this.isReduced()) return;
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

  /**
   * Confetti wave falling from the top of the *screen* (win overlay). `down` is
   * the world-space screen-down vector, so this still falls downward when the
   * board is quarter-turned on a portrait phone.
   */
  confetti(
    count: number,
    colorIdxA: number,
    colorIdxB: number,
    down: { x: number; y: number } = { x: 0, y: 1 },
  ): void {
    // Spawn along the screen's top edge: the world axis perpendicular to down.
    const across = screenRight(down);
    const span = Math.abs(across.x) * WORLD_W + Math.abs(across.y) * WORLD_H;
    const cx = WORLD_W / 2;
    const cy = WORLD_H / 2;
    const reach = (Math.abs(down.x) * WORLD_W + Math.abs(down.y) * WORLD_H) / 2 + 2;
    for (let i = 0; i < count; i++) {
      const t = (Math.random() - 0.5) * span;
      const drift = (Math.random() - 0.5) * 20;
      const fall = 15 + Math.random() * 25;
      this.spawn(
        cx + across.x * t - down.x * reach,
        cy + across.y * t - down.y * reach,
        across.x * drift + down.x * fall,
        across.y * drift + down.y * fall,
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
        if (this.gravity[i]) {
          this.vx[i]! += this.down.x * 60 * dt;
          this.vy[i]! += this.down.y * 60 * dt;
        }
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

/**
 * Darken by multiplying; BRIGHTEN by blending toward white. The old
 * multiply-and-clamp brightened saturated colours unevenly — amber's ×1.45
 * highlight clamped R and G first and came out pure yellow, which under the
 * overlay scrim read as the olive smudge on dimmed balls. Specular light is
 * white; the blend keeps the hue and heads there.
 */
function shade(hex: string, factor: number): string {
  const chan = (i: number) => parseInt(hex.slice(i, i + 2), 16);
  const n = (v: number) =>
    Math.max(
      0,
      Math.min(255, Math.round(factor <= 1 ? v * factor : v + (255 - v) * (factor - 1))),
    );
  return `rgb(${n(chan(1))},${n(chan(3))},${n(chan(5))})`;
}

/**
 * Pre-rendered sprites per (faction, size) — per-frame canvas shadowBlur is
 * the classic low-end performance cliff, so it's banned here. Layers, all
 * rebuilt on resize (scale-dependent), each one drawImage per node:
 *  - shadow: elliptical drop shadow (owner-independent, sells depth)
 *  - halo: soft additive glow under owned nodes
 *  - sphere: pseudo-3D shaded disc (off-center highlight, darker limb, rim)
 */
/**
 * Stable per-packet noise, for the lateral spread and along-lane stagger that
 * make a stream read as a column. Keyed on `(from, to, departTick)` because
 * packets carry no id — the sim guarantees that triple is unique (one flow per
 * source node, one packet per flow per emit tick), so the value is stable for
 * a packet's whole flight and identical on every client. Presentation only:
 * nothing here feeds back into the simulation.
 *
 * Returns a full 32-bit word; callers slice the bits they need.
 */
export function packetHash(from: number, to: number, departTick: number): number {
  let h = Math.imul(from, 73856093) ^ Math.imul(to, 19349663) ^ Math.imul(departTick, 83492791);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Pip core radius, world units. A unit should read at a glance, not dominate. */
export const PIP_R = 0.62;
/** Bloom extent as a multiple of the core — the soft glow around it. */
const PIP_BLOOM = 2.6;

export class SpriteCache {
  private halos = new Map<string, HTMLCanvasElement>();
  private spheres = new Map<string, HTMLCanvasElement>();
  private shadows: HTMLCanvasElement[] = [];
  private pips: HTMLCanvasElement[] = [];
  private scale = 0;
  /** World-space direction the light comes from; screen top-left after rotation. */
  private light = { x: -Math.SQRT1_2, y: -Math.SQRT1_2 };
  /** World-space screen-down, derived from the light. Shadows key off this. */
  private down = { x: 0, y: 1 };
  /** Kill switch — first rung of the degradation ladder. */
  enabled = true;

  rebuild(
    scale: number,
    light: { x: number; y: number } = { x: -Math.SQRT1_2, y: -Math.SQRT1_2 },
    down: { x: number; y: number } = { x: 0, y: 1 },
  ): void {
    this.scale = scale;
    this.light = light;
    this.down = down;
    this.halos.clear();
    this.spheres.clear();
    this.shadows = [];
    this.pips = [];

    // Drop shadows: one per size, owner-independent. `light` and `down` arrive
    // in world space already accounting for board rotation, so the highlight
    // stays at screen top-left and the shadow falls down-screen in both
    // orientations. See drawShadow for the offset.
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

    // Packet pips. One per faction: a hot near-white core inside a coloured
    // bloom, so a travelling unit reads as a glowing object rather than as the
    // 1.6px line dash it used to be. Blitted additively, so a dense stream
    // brightens where units overlap instead of flattening into one stroke.
    for (let f = 0 as Faction; f <= 4; f++) {
      const r = PIP_R * scale;
      const side = Math.max(4, Math.ceil(2 * r * PIP_BLOOM));
      const c = document.createElement("canvas");
      c.width = side;
      c.height = side;
      const g = c.getContext("2d")!;
      const mid = side / 2;
      const grad = g.createRadialGradient(mid, mid, 0, mid, mid, mid);
      grad.addColorStop(0, `rgba(${UI_INK},0.95)`);
      grad.addColorStop(0.28, FACTION_COLORS[f]! + "ee");
      grad.addColorStop(0.55, FACTION_COLORS[f]! + "70");
      grad.addColorStop(1, FACTION_COLORS[f]! + "00");
      g.fillStyle = grad;
      g.fillRect(0, 0, side, side);
      this.pips.push(c);
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
        // Highlight sits toward the light. Baked, so rotation costs nothing.
        const hx = cx + this.light.x * r * 0.5;
        const hy = cy + this.light.y * r * 0.55;
        const grad = g.createRadialGradient(hx, hy, r * 0.1, cx, cy, r);
        grad.addColorStop(0, shade(base, 1.45));
        grad.addColorStop(0.35, shade(base, 1.12));
        grad.addColorStop(0.75, base);
        grad.addColorStop(1, shade(base, 0.62));
        g.fillStyle = grad;
        g.beginPath();
        g.arc(cx, cy, r, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = `rgba(${UI_INK},0.14)`;
        g.lineWidth = Math.max(1, r * 0.07);
        g.beginPath();
        // Specular rim on the far side of the light, so it too follows rotation.
        const rim = Math.atan2(-this.light.y, -this.light.x);
        // Radius clamp: a zero-sized window at boot (hidden iframe) makes r
        // tiny and r - lineWidth/2 negative, which throws in arc().
        g.arc(cx, cy, Math.max(0, r - g.lineWidth / 2), rim - Math.PI * 0.22, rim + Math.PI * 0.23);
        g.stroke();

        // No faction sigil inside the sphere any more — Hugo's call
        // (2026-08-10): colour is the ball's identity, the mark read as
        // noise. The sigils still live everywhere the colour needs a
        // fallback name: the ticker badge, the intro-card legend, the
        // death mark, and the share-bar hatches. The cost, accepted
        // knowingly: no per-ball cue for the one near-metameric CVD pair
        // (player blue vs Vulture violet, test/sigil.test.ts pins it).
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
    // Offset built from the *screen* basis. Applying the 0.1/0.72 anisotropy to
    // the world components of a rotating light vector swapped the two on a
    // quarter-turned board, so the shadow fell to the right instead of down.
    const d = this.down;
    const a = screenRight(d);
    ctx.drawImage(
      sprite,
      x + a.x * 0.1 * r + d.x * 0.72 * r - w / 2,
      y + a.y * 0.1 * r + d.y * 0.72 * r - h / 2,
      w,
      h,
    );
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

  /** Is there a baked pip to blit? Callers fall back to strokes if not. */
  hasPips(): boolean {
    return this.enabled && this.scale > 0 && this.pips.length > 0;
  }

  /**
   * One packet. Caller sets `globalCompositeOperation` once for the whole
   * batch — doing it per pip would cost more than the blit.
   */
  drawPip(ctx: CanvasRenderingContext2D, owner: Faction, x: number, y: number): void {
    const sprite = this.pips[owner];
    if (!sprite) return;
    const side = sprite.width / this.scale;
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
      // Two depth bands, not one cloud. The FAR half (even indices) drifts at
      // a third of the speed and draws at half size — that speed/size coupling
      // is what parallax IS, and it was the missing second plane: the whole
      // field used to move as one sheet glued to the board. Same 40 fillRects.
      const far = i % 2 === 0;
      this.v.push((far ? 0.18 : 0.6) + Math.random() * (far ? 0.4 : 1.2)); // wu/s, up-left
      this.s.push((far ? 0.1 : 0.24) + Math.random() * (far ? 0.16 : 0.32));
    }
  }

  draw(ctx: CanvasRenderingContext2D, color = `rgba(${UI_INK},0.07)`): void {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    // Keep drawing the field at rest under reduced motion — it is part of the
    // biome's texture, and removing it makes the mode look like a rendering
    // bug rather than a setting. Only the drift stops.
    const still = reducedMotion();
    ctx.fillStyle = color;
    for (let i = 0; i < this.x.length; i++) {
      if (!still) {
        this.x[i]! -= this.v[i]! * dt * 0.6;
        this.y[i]! -= this.v[i]! * dt;
        if (this.y[i]! < 0) {
          this.y[i] = WORLD_H;
          this.x[i] = Math.random() * WORLD_W;
        }
        if (this.x[i]! < 0) this.x[i] = WORLD_W;
      }
      ctx.fillRect(this.x[i]!, this.y[i]!, this.s[i]!, this.s[i]!);
    }
  }
}

/* ------------------------------------------------- screen-space UI chrome */

/**
 * Chrome is laid out in CSS pixels by ./ui-layout and drawn outside the board
 * transform. It used to be authored in world units inside that transform,
 * which anchored it to the board rect instead of the screen and painted the
 * HUD straight onto the playfield in portrait.
 */

/** Pause icon (two bars), centred in a CSS-pixel rect. */
export function drawPauseIcon(ctx: CanvasRenderingContext2D, r: Rect, hot = false): void {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const s = Math.min(r.w, r.h) * 0.34;
  ctx.save();
  ctx.fillStyle = hot ? `rgba(${UI_INK},0.9)` : `rgba(${UI_INK},0.55)`;
  ctx.fillRect(cx - s * 0.62, cy - s, s * 0.44, s * 2);
  ctx.fillRect(cx + s * 0.18, cy - s, s * 0.44, s * 2);
  ctx.restore();
}

/** Speaker icon. Slash when muted. */
export function drawMuteIcon(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  muted: boolean,
  hot = false,
): void {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const s = Math.min(r.w, r.h) / 5.6;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  const ink = hot ? `rgba(${UI_INK},0.9)` : `rgba(${UI_INK},0.55)`;
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
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
    ctx.strokeStyle = "rgba(255,120,120,0.8)";
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

/**
 * Chevron upgrade button, floated above a node. Still world-anchored (it
 * belongs to the node, not the screen), but its offset and hit radius are
 * derived from the camera scale so it stays a fixed CSS-pixel size.
 */
export function chevronPos(
  nx: number,
  ny: number,
  r: number,
  cssScale: number,
  down: { x: number; y: number },
): { x: number; y: number } {
  const gap = r + 22 / Math.max(0.001, cssScale);
  return { x: nx - down.x * gap, y: ny - down.y * gap };
}

/** Chevron hit radius in world units, holding ~44 CSS px on every screen. */
export function chevronHitR(cssScale: number): number {
  return 22 / Math.max(0.001, cssScale);
}

export function hitChevron(
  wx: number,
  wy: number,
  nx: number,
  ny: number,
  r: number,
  cssScale: number,
  down: { x: number; y: number },
): boolean {
  const p = chevronPos(nx, ny, r, cssScale, down);
  return Math.hypot(wx - p.x, wy - p.y) <= chevronHitR(cssScale);
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
  for (let a = 0 as Faction; a <= 4; a++) {
    for (let b = 0 as Faction; b <= 4; b++) {
      if (a === b) continue;
      const ca = parse(FACTION_COLORS[a]);
      const cb = parse(FACTION_COLORS[b]);
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

/**
 * Fullness fraction shared by the renderer (units/cap clamped).
 *
 * Takes `kind` because a vault's cap is not UNIT_CAP — without it the ring on
 * a vault would read as full at 50 units and stay full to 130, hiding exactly
 * the property that makes the kind worth taking.
 */
export function fullness(units: number, size: NodeSize, kind: NodeKind): number {
  return Math.min(1, units / unitCap(size, kind));
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

export const BIOMES: readonly Biome[] = [
  // 1 Deep Field. Was a flat single #141821 with no signature — "onboarding
  // purity" back when it was the opener, but it stopped being the opener and
  // stayed the plainest thing in the game (its slot is L21-25 now, mid-run).
  // A whisper of a gradient and two vast concentric rings — the emptiest biome
  // keeps its emptiness as an aesthetic instead of an absence.
  { name: "DEEP FIELD", bgTop: "#121620", bgBottom: "#171b26", board: "#1c2230",
    dustColor: `rgba(${UI_INK},0.07)`,
    signature: (g, w, h) => {
      g.strokeStyle = "rgba(160,180,220,0.035)";
      for (const [r, lw] of [
        [Math.min(w, h) * 0.52, 1.5],
        [Math.min(w, h) * 0.78, 1],
      ] as const) {
        g.lineWidth = lw;
        g.beginPath();
        g.arc(w * 0.5, h * 0.48, r, 0, Math.PI * 2);
        g.stroke();
      }
    } },
  // 2 Nebula
  { name: "NEBULA", bgTop: "#101426", bgBottom: "#1a1030", board: "#1b2136",
    dustColor: "rgba(207,216,255,0.08)",
    signature: (g, w, h) => {
      const blob = (x: number, y: number, r: number, c: string) => {
        const grad = g.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, c);
        grad.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = grad;
        g.fillRect(x - r, y - r, r * 2, r * 2);
      };
      blob(w * 0.25, h * 0.3, w * 0.28, "rgba(186,85,211,0.05)");
      blob(w * 0.7, h * 0.65, w * 0.33, "rgba(0,180,190,0.05)");
      blob(w * 0.55, h * 0.2, w * 0.2, "rgba(120,120,255,0.05)");
    } },
  // 3 Ember Wastes
  { name: "EMBER WASTES", bgTop: "#1a1210", bgBottom: "#241108", board: "#241c18",
    dustColor: "rgba(255,154,61,0.10)",
    signature: (g, w, h) => {
      for (let i = 0; i < 4; i++) {
        const y = h * (0.25 + i * 0.18);
        const grad = g.createLinearGradient(0, y - 14, 0, y + 14);
        grad.addColorStop(0, "rgba(0,0,0,0)");
        grad.addColorStop(0.5, "rgba(255,110,40,0.035)");
        grad.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = grad;
        g.fillRect(0, y - 14, w, 28);
      }
    } },
  // 4 Glacier
  { name: "GLACIER", bgTop: "#0e1620", bgBottom: "#12202c", board: "#16232e",
    dustColor: "rgba(240,248,255,0.10)",
    signature: (g, w, h) => {
      for (let band = 0; band < 2; band++) {
        g.beginPath();
        for (let x = 0; x <= w; x += 8) {
          const y = h * (0.22 + band * 0.14) + Math.sin(x / 90 + band * 2) * 18;
          if (x === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.strokeStyle = band === 0 ? "rgba(80,220,180,0.05)" : "rgba(90,190,240,0.05)";
        g.lineWidth = 22;
        g.stroke();
      }
    } },
  // 5 Void Grid
  { name: "VOID GRID", bgTop: "#0b0d14", bgBottom: "#0b0d14", board: "#12141d",
    dustColor: "rgba(177,104,255,0.08)",
    signature: (g, w, h) => {
      g.strokeStyle = "rgba(120,130,180,0.05)";
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

/**
 * One biome per five levels, rotating through all of them.
 *
 * Deliberately does NOT open on Deep Field. That biome is a flat single colour
 * with no signature layer — it was chosen for "onboarding purity", but the
 * effect was that the first five levels, the only ones most players ever see,
 * were the plainest thing in the game. Every bit of the art direction was
 * gated behind the point where a reviewer stops playing. Deep Field still gets
 * its turn as a calm stretch later in the rotation.
 */
export function biomeIndexForLevel(level: number): number {
  const OPENER = 1; // Nebula
  return (OPENER + Math.floor((level - 1) / 5)) % BIOMES.length;
}

export function biomeForLevel(level: number): Biome {
  return BIOMES[biomeIndexForLevel(level)]!;
}

/**
 * Display names and one-line verbs per node kind.
 *
 * Presentation-only, and deliberately here rather than in `src/sim/` — the
 * simulation has no strings in it and should keep none. Used by the boss intro
 * card, which is the only place the game names a mechanic in words; everywhere
 * else teaching is by placement.
 */
export const KIND_NAMES: Record<NodeKind, string> = {
  [KIND_STANDARD]: "BALL",
  [KIND_FACTORY]: "FACTORY",
  [KIND_FORTRESS]: "FORTRESS",
  [KIND_TURRET]: "TURRET",
  [KIND_RELAY]: "RELAY",
  [KIND_VOLATILE]: "VOLATILE",
  [KIND_BEACON]: "BEACON",
  [KIND_SIPHON]: "SIPHON",
  [KIND_VAULT]: "VAULT",
  [KIND_NURSERY]: "NURSERY",
  [KIND_CORRUPTER]: "CORRUPTER",
  [KIND_RIFT]: "RIFT",
};

export const KIND_VERBS: Record<NodeKind, string> = {
  [KIND_STANDARD]: "",
  [KIND_FACTORY]: "BUILDS FASTER",
  [KIND_FORTRESS]: "ARMOURED AGAINST ATTACK",
  [KIND_TURRET]: "SHOOTS DOWN PASSING UNITS",
  [KIND_RELAY]: "SENDS ARRIVE FASTER",
  [KIND_VOLATILE]: "EXPLODES WHEN TAKEN",
  [KIND_BEACON]: "SPEEDS UP NEARBY ALLIES",
  [KIND_SIPHON]: "DRAINS NEARBY ENEMIES",
  [KIND_VAULT]: "HOLDS FAR MORE, FILLS SLOWLY",
  [KIND_NURSERY]: "GROWS UNTIL SOMEONE TAKES IT",
  [KIND_CORRUPTER]: "STEALS PASSING ENEMY UNITS",
  [KIND_RIFT]: "LINKS TO YOUR OTHER RIFTS",
};

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
          g.strokeStyle = `rgba(${UI_INK},0.18)`;
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
  faction: Faction;
  at: number;
}

/** Top-right event feed: "◆ BUILDER HAS FALLEN". Max 2 lines, coalesces. */
export class Ticker {
  private lines: TickerLine[] = [];

  /** Takes a Faction, not a colour, so the swatch cannot disagree with the name. */
  push(text: string, faction: Faction): void {
    const now = performance.now();
    const dupe = this.lines.find((l) => l.text === text);
    if (dupe) {
      dupe.at = now;
      return;
    }
    this.lines.push({ text, faction, at: now });
    if (this.lines.length > 4) this.lines.shift();
  }

  /**
   * Right-aligned at a CSS-pixel anchor, outside the board transform.
   *
   * `playerOnly` is the teaching-band mode: war news ("AMBER HAS FALLEN")
   * stays quiet on L1–L3, but deliberate app speech — refusals, the
   * cap-stall nudge — is pushed with the PLAYER faction and must always
   * draw, because the levels where the app most needs to speak are exactly
   * the ones the war-news suppression covers.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    anchor: { x: number; y: number },
    fontScale: number,
    maxLines = 2,
    playerOnly = false,
    // Site seam: the host passes its pixel face so the ticker matches the
    // rest of the HUD. Defaults to the upstream stack to minimize drift.
    family = "system-ui, sans-serif",
  ): void {
    const now = performance.now();
    const size = 13 * fontScale;
    this.lines = this.lines.filter((l) => now - l.at < 2950);
    let y = anchor.y;
    let shown = 0;
    for (const l of this.lines) {
      if (shown >= maxLines) break;
      if (playerOnly && l.faction !== PLAYER) continue;
      const age = now - l.at;
      const a = Math.min(1, age / 150) * Math.min(1, (2950 - age) / 300);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.font = `bold ${size}px ${family}`;
      ctx.textAlign = "right";
      ctx.textBaseline = "top";
      const textW = ctx.measureText(l.text).width;
      const dot = size * 0.85;

      // Scrim. The ticker draws over the playfield rather than inside a
      // reserved band — a permanent 38 CSS px of a portrait phone's board was
      // too much to pay for a message that lives three seconds — so it has to
      // stay readable on top of a bright node. A soft rounded plate does that
      // for a fraction of the space, and reads as a notification besides.
      const padX = size * 0.55;
      const padY = size * 0.22;
      const boxW = textW + dot * 2 + padX * 2;
      const boxH = size + padY * 2;
      const boxX = anchor.x - textW - dot * 2 - padX;
      const boxY = y - padY;
      const rr = boxH / 2;
      ctx.beginPath();
      ctx.moveTo(boxX + rr, boxY);
      ctx.arcTo(boxX + boxW, boxY, boxX + boxW, boxY + boxH, rr);
      ctx.arcTo(boxX + boxW, boxY + boxH, boxX, boxY + boxH, rr);
      ctx.arcTo(boxX, boxY + boxH, boxX, boxY, rr);
      ctx.arcTo(boxX, boxY, boxX + boxW, boxY, rr);
      ctx.closePath();
      ctx.fillStyle = "rgba(10,13,20,0.72)";
      ctx.fill();

      ctx.globalAlpha = a * 0.9;
      ctx.fillStyle = FACTION_COLORS[l.faction];
      // Was a plain colour square; the badge says the same thing without
      // relying on hue. At ~11 px the marks read as texture rather than
      // shape — which is fine, the line already names the faction.
      drawSigilBadge(ctx, l.faction, anchor.x - textW - dot * 1.2, y + size * 0.05, dot / 2);
      ctx.fillStyle = `rgba(${UI_INK},0.88)`;
      ctx.fillText(l.text, anchor.x, y);
      ctx.restore();
      y += size * 1.25;
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
    // Cached module read — this used to call matchMedia per kick, and up to
    // five kicks land in a single frame.
    if (reducedMotion()) return;
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

/**
 * Checkpoint flag — a pole and a pennant, in the drawMuteIcon unit-space idiom.
 * Screen space, so no counter-rotation needed.
 */
/* --------------------------------------------------- HUD glyphs (♥ ◈ ★) */

/**
 * Vector replacements for the three Unicode symbols the HUD leaned on.
 *
 * `system-ui` contains none of ♥ ◈ ★, so the browser silently fell back to a
 * symbol font (Apple Symbols / Segoe UI Symbol / Noto), which renders at a
 * different weight, optical size and baseline than the text beside it — and
 * differently on every OS. It was the loudest "unfinished" tell in the game.
 * Same unit-space idiom as drawFlagIcon/TRACK_ICONS: path once, scale to size.
 *
 * All three take (cx, cy) as the CENTRE, to sit on a text row drawn with
 * textBaseline "middle".
 */
export function drawHeartIcon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  ink: string,
): void {
  const s = size / 4.6;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  ctx.fillStyle = ink;
  ctx.beginPath();
  // Two lobes + a point; slightly wide, slightly soft — matches the bold caps.
  ctx.moveTo(0, 2.2);
  ctx.bezierCurveTo(-2.6, 0.4, -2.3, -2.2, -0.1, -1.0);
  ctx.bezierCurveTo(0, -1.06, 0, -1.06, 0.1, -1.0);
  ctx.bezierCurveTo(2.3, -2.2, 2.6, 0.4, 0, 2.2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function drawCoreIcon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  ink: string,
): void {
  const s = size / 4.6;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = 0.4;
  ctx.lineJoin = "round";
  // ◈: outer diamond stroked, inner diamond filled.
  ctx.beginPath();
  ctx.moveTo(0, -2.1);
  ctx.lineTo(2.1, 0);
  ctx.lineTo(0, 2.1);
  ctx.lineTo(-2.1, 0);
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, -1.0);
  ctx.lineTo(1.0, 0);
  ctx.lineTo(0, 1.0);
  ctx.lineTo(-1.0, 0);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Five-point star; `filled` false draws the earned-slot outline (☆). */
export function drawStarIcon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  ink: string,
  filled = true,
): void {
  const s = size / 4.6;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  ctx.fillStyle = ink;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 0.4;
  ctx.lineJoin = "round";
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? 2.3 : 1.0;
    const x = r * Math.cos(a);
    const y = r * Math.sin(a);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  if (filled) ctx.fill();
  else ctx.stroke();
  ctx.restore();
}

export function drawFlagIcon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  ink: string,
): void {
  const s = size / 2.4;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = 0.42;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-0.55, -1.9);
  ctx.lineTo(-0.55, 2.1);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-0.55, -1.9);
  ctx.lineTo(1.7, -1.1);
  ctx.lineTo(-0.55, -0.3);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}


/* ------------------------------------------------------------ faction sigils */

/**
 * Trace a sigil into the current path, in a screen-oriented basis.
 *
 * `across`/`down` are world-space vectors pointing screen-right and
 * screen-down, so the mark lands upright whatever the camera rotation — the
 * same trick the sphere highlight already uses. Fills only, never strokes, so
 * a boot-time zero-size canvas degrades safely instead of throwing.
 */
export function traceSigil(
  g: CanvasRenderingContext2D,
  s: Sigil,
  cx: number,
  cy: number,
  r: number,
  across: { x: number; y: number },
  down: { x: number; y: number },
): void {
  if (r < 1) return;
  g.beginPath();
  for (const poly of s.polys) {
    poly.forEach(([u, v], i) => {
      const px = cx + (u * across.x + v * down.x) * r;
      const py = cy + (u * across.y + v * down.y) * r;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    });
    g.closePath();
  }
}

/**
 * Screen-space faction badge: a filled disc with the sigil cut into it.
 *
 * Used wherever a faction is NAMED rather than played — the intro card legend,
 * the start card, the ticker. Drawn at r/SIGIL_R1 so the marks reach the rim:
 * a badge has no unit numeral to keep clear of.
 */
export function drawSigilBadge(
  ctx: CanvasRenderingContext2D,
  f: Faction,
  cx: number,
  cy: number,
  R: number,
): void {
  ctx.save();
  ctx.fillStyle = FACTION_COLORS[f];
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();
  const sig = SIGILS[f];
  if (sig) {
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = inkOn(f);
    traceSigil(ctx, sig, cx, cy, R / SIGIL_R1, { x: 1, y: 0 }, { x: 0, y: 1 });
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "rgba(10,12,18,0.55)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/* ------------------------------------------------------- upgrade-track icons */

/**
 * One icon per meta upgrade track.
 *
 * Same idiom as drawMuteIcon: translate, scale into a unit space, and trace
 * hard-coded vertices in roughly the ±2.6 range. Drawn live rather than baked
 * — six glyphs on a static panel do not justify a canvas each, and a bake path
 * would call document.createElement and make this module untestable in node.
 *
 * Keyed by TrackKey | AbilityKey as a Record so tsc fails the build if a new
 * track or ability is added without an icon — the shop resolves rows by key.
 */
export type ShopIconKey = TrackKey | AbilityKey;
export type IconFn = (ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, ink: string) => void;

const glyph = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  ink: string,
  body: (g: CanvasRenderingContext2D) => void,
): void => {
  const s = size / 5.6;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  ctx.fillStyle = ink;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 0.45;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  body(ctx);
  ctx.restore();
};

export const TRACK_ICONS: Record<ShopIconKey, IconFn> = {
  // Shield with a pip: troops already standing on your node.
  garrison: (ctx, cx, cy, size, ink) =>
    glyph(ctx, cx, cy, size, ink, (g) => {
      g.beginPath();
      g.moveTo(0, -2.3);
      g.lineTo(1.9, -1.5);
      g.lineTo(1.9, 0.4);
      g.quadraticCurveTo(1.9, 2.0, 0, 2.4);
      g.quadraticCurveTo(-1.9, 2.0, -1.9, 0.4);
      g.lineTo(-1.9, -1.5);
      g.closePath();
      g.stroke();
      g.beginPath();
      g.arc(0, -0.1, 0.62, 0, Math.PI * 2);
      g.fill();
    }),
  // Rising bars: more per second. Not a gear — the factory node owns gears,
  // and a gear is mud at 20 px on a 1x screen anyway.
  production: (ctx, cx, cy, size, ink) =>
    glyph(ctx, cx, cy, size, ink, (g) => {
      g.fillRect(-2.0, 0.4, 1.0, 1.8);
      g.fillRect(-0.5, -0.6, 1.0, 3.0);
      g.fillRect(1.0, -1.8, 1.0, 4.2);
    }),
  // Hammer, tilted: cheaper AND faster builds — the merged discount/speed track.
  engineering: (ctx, cx, cy, size, ink) =>
    glyph(ctx, cx, cy, size, ink, (g) => {
      g.save();
      g.rotate(-Math.PI / 4);
      g.fillRect(-1.5, -2.5, 3.0, 1.3); // head
      g.fillRect(-0.35, -1.2, 0.7, 3.6); // handle
      g.restore();
    }),
  // The core diamond with a plus — deliberately echoes the ◈ in the cost
  // column, so the icon teaches what the currency is.
  salvage: (ctx, cx, cy, size, ink) =>
    glyph(ctx, cx, cy, size, ink, (g) => {
      g.beginPath();
      g.moveTo(0, -2.2);
      g.lineTo(1.8, 0);
      g.lineTo(0, 2.2);
      g.lineTo(-1.8, 0);
      g.closePath();
      g.stroke();
      g.fillRect(-0.75, -0.22, 1.5, 0.44);
      g.fillRect(-0.22, -0.75, 0.44, 1.5);
    }),
  // Heart with a plus: the HUD already draws lives as ♥, so the heart is the
  // established symbol for exactly this.
  secondWind: (ctx, cx, cy, size, ink) =>
    glyph(ctx, cx, cy, size, ink, (g) => {
      g.beginPath();
      g.moveTo(0, 2.3);
      g.bezierCurveTo(-2.6, 0.5, -1.7, -2.2, 0, -1.0);
      g.bezierCurveTo(1.7, -2.2, 2.6, 0.5, 0, 2.3);
      g.closePath();
      g.stroke();
      g.fillRect(1.2, -2.15, 1.1, 0.4);
      g.fillRect(1.6, -2.55, 0.4, 1.1);
    }),
  // Bolt — production surge. Inherited from the retired RAPID DEPLOY glyph;
  // the most legible shape in the set at small size, and OVERCHARGE is the
  // row (and the in-level button) that most needs to read at 20 px.
  overcharge: (ctx, cx, cy, size, ink) =>
    glyph(ctx, cx, cy, size, ink, (g) => {
      g.beginPath();
      g.moveTo(0.6, -2.4);
      g.lineTo(-1.6, 0.3);
      g.lineTo(-0.1, 0.3);
      g.lineTo(-0.6, 2.4);
      g.lineTo(1.6, -0.4);
      g.lineTo(0.1, -0.4);
      g.closePath();
      g.fill();
    }),
  // Pause bars in a ring: frozen in place.
  stasis: (ctx, cx, cy, size, ink) =>
    glyph(ctx, cx, cy, size, ink, (g) => {
      g.beginPath();
      g.arc(0, 0, 2.2, 0, Math.PI * 2);
      g.stroke();
      g.fillRect(-1.0, -1.05, 0.72, 2.1);
      g.fillRect(0.28, -1.05, 0.72, 2.1);
    }),
  // Return arrow: an open arc curling back with an arrowhead at its end.
  recall: (ctx, cx, cy, size, ink) =>
    glyph(ctx, cx, cy, size, ink, (g) => {
      g.beginPath();
      g.arc(0.2, 0.2, 1.8, -Math.PI * 0.35, Math.PI * 0.95);
      g.stroke();
      g.beginPath();
      g.moveTo(-1.9, -1.1); // tip, pointing up-left along the arc's tangent
      g.lineTo(-0.5, -0.9);
      g.lineTo(-1.5, 0.4);
      g.closePath();
      g.fill();
    }),
};

/** Per-key tint. Every value already exists elsewhere in the game's palette. */
export const TRACK_TINT: Record<ShopIconKey, string> = {
  garrison: FACTION_COLORS[1], // player cyan — it is YOUR garrison
  production: FACTION_COLORS[3], // Builder acid — production is its verb
  engineering: GOLD_HEX, // the HUD streak gold (carried from RAPID DEPLOY)
  salvage: FACTION_COLORS[4], // Vulture violet — salvage is its verb
  secondWind: "#ffd7dd", // the HUD heart pink
  overcharge: GOLD_HEX, // objective gold — the surge mark uses it too
  stasis: UI_ACCENT, // core ice (freed by UPGRADE DISCOUNT's retirement)
  recall: FACTION_COLORS[1], // player cyan — it recalls YOUR packets
};
