import type { GameState, Node, Owner } from "../sim/state";
import { WORLD_W, WORLD_H } from "../sim/state";
import { NODE_R } from "../sim/constants";
import { dist } from "../sim/tick";
import {
  bakeVignette,
  buildColorSteps,
  drawMuteIcon,
  drawPauseIcon,
  Dust,
  fullness,
  ParticlePool,
  PAUSE_MENU,
  SpriteCache,
} from "./fx";

/**
 * Canvas 2D renderer. Reads sim state (+ input drag state via getter), never
 * mutates either. World is a fixed 160×90 board, fit-contained into the
 * canvas with letterboxing so the game is legible from 907×510 up to
 * 1920×1080 and on mobile in both orientations.
 *
 * All animation state in here is presentation-only, keyed to wall-clock time.
 */

// Nattöppet palette — literals mirror lib/colors.ts + globals.css (canvas
// code can't read CSS variables). Player = cyan, enemy = coral: magenta is
// the game's *branding* accent on the homepage, not the antagonist.
const COLORS: Record<Owner, string> = {
  player: "#35e0ff", // cyan
  enemy: "#ff6e5e", // coral
  neutral: "#8e97a8", // ink-muted
};
const COLORS_DIM: Record<Owner, string> = {
  player: "rgba(53,224,255,0.35)",
  enemy: "rgba(255,110,94,0.35)",
  neutral: "rgba(142,151,168,0.35)",
};
const BG_LETTERBOX = "#0b0c14"; // cream (room dark)
const BG_FIELD = "#151726"; // cream-deep
const BG_PANEL = "#1e2136"; // panel
const INK = "#e8f2e9";
const BACKDROP = "rgba(5,6,12,0.75)";
const ink = (a: number) => `rgba(232,242,233,${a})`;
const coral = (a: number) => `rgba(255,110,94,${a})`;

// Particle palette indices
const P_PLAYER = 0;
const P_ENEMY = 1;
const P_WHITE = 2;
const P_EMBER = 3;

const CROSSFADE_MS = 250;
const FLIP_POP_MS = 200;
const DEPOSIT_POP_MS = 120;
const INTRO_MS = 1400;

/** What the input layer exposes for the drag-to-send preview. */
export interface DragView {
  active: boolean;
  fromNodeId: number;
  wx: number;
  wy: number;
  hoverNodeId: number | null;
}

export interface OverlayView {
  kind: "won" | "lost" | "runover";
  /** lives remaining after a "lost" defeat */
  lives?: number;
  /** level the ended run reached ("runover") */
  reachedLevel?: number;
  bestLevel?: number;
}

/** App-layer HUD data (run progression lives outside the sim). */
export interface HudView {
  lives: number;
  maxLives: number;
  bestLevel: number;
  paused: boolean;
}

interface FlipRecord {
  at: number;
  oldOwner: Owner;
}

/** Concrete font-family names (next/font hashes them — resolved by lib/overrun/fonts.ts). */
export interface GameFonts {
  display: string;
  pixel: string;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private scale = 1;
  private offsetX = 0;
  private offsetY = 0;

  private flips = new Map<number, FlipRecord>();
  private lastOwners = new Map<number, Owner>();
  private lastUnits = new Map<number, number>();
  private depositPopAt = new Map<number, number>();
  private colorSteps = buildColorSteps(COLORS, 8);
  private particles = new ParticlePool([
    COLORS.player,
    COLORS.enemy,
    INK,
    "#5c2a24", // dark-coral ember
  ]);
  private halos = new SpriteCache();
  private dust = new Dust();
  private vignette: HTMLCanvasElement | null = null;
  private reduceMotion = false;
  private motionQuery: MediaQueryList | null = null;

  private hudP = 0.5; // eased strength-bar fraction
  private lastFrameAt = 0;

  private introLevel = -1;
  private introAt = 0;
  private lastTick = -1;

  private overlayAt = 0;
  private overlayKind: OverlayView["kind"] | null = null;
  private confettiWaves = 0;

  /** Rolling average render cost in ms, exposed for perf verification. */
  lastRenderMs = 0;

  private fonts: GameFonts;
  private onWindowResize = () => this.resize();
  private onMotionChange = (e: MediaQueryListEvent) => {
    this.reduceMotion = e.matches;
  };

  constructor(
    private canvas: HTMLCanvasElement,
    private getDrag: () => DragView | null = () => null,
    private getMuted: () => boolean = () => false,
    fonts?: GameFonts,
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas not supported");
    this.ctx = ctx;
    this.fonts = fonts ?? { display: "ui-monospace, monospace", pixel: "ui-monospace, monospace" };
    this.motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.reduceMotion = this.motionQuery.matches;
    this.motionQuery.addEventListener("change", this.onMotionChange);
    this.resize();
    window.addEventListener("resize", this.onWindowResize);
  }

  /** Unmount path: releases the window/media-query listeners. */
  destroy(): void {
    window.removeEventListener("resize", this.onWindowResize);
    this.motionQuery?.removeEventListener("change", this.onMotionChange);
    this.motionQuery = null;
  }

  private pixelFont(size: number, bold = false): string {
    return `${bold ? "bold " : ""}${size}px ${this.fonts.pixel}`;
  }

  /** Jersey 15 ships weight 400 only — never ask canvas for synthetic bold. */
  private displayFont(size: number): string {
    return `${size}px ${this.fonts.display}`;
  }

  private resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;

    this.scale = Math.min(this.canvas.width / WORLD_W, this.canvas.height / WORLD_H);
    this.offsetX = (this.canvas.width - WORLD_W * this.scale) / 2;
    this.offsetY = (this.canvas.height - WORLD_H * this.scale) / 2;
    // A zero-sized viewport (mid-navigation layout race) would bake
    // zero-radius sprites and negative arc radii — wait for real dimensions;
    // render() retries every frame until they exist.
    if (this.scale <= 0) {
      this.scale = 0;
      return;
    }
    this.halos.rebuild(this.scale, COLORS);
    this.vignette = bakeVignette(this.canvas.width, this.canvas.height);
  }

  /** CSS-pixel screen coords → world coords (for input hit-testing). */
  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    const dpr = this.canvas.width / this.canvas.clientWidth;
    return {
      x: (sx * dpr - this.offsetX) / this.scale,
      y: (sy * dpr - this.offsetY) / this.scale,
    };
  }

  render(
    prev: GameState,
    curr: GameState,
    alpha: number,
    overlay: OverlayView | null,
    hud: HudView,
  ): void {
    if (this.scale === 0) {
      this.resize();
      if (this.scale === 0) return; // viewport still 0×0 — try next frame
    }
    const t0 = performance.now();
    const { ctx, canvas } = this;
    const now = t0;
    const dt = Math.min(0.05, (now - this.lastFrameAt) / 1000);
    this.lastFrameAt = now;

    this.trackLevelChanges(curr, now);
    this.trackFlips(curr, now);
    this.trackDeposits(curr, now);
    this.trackOverlay(overlay, now);

    ctx.fillStyle = BG_LETTERBOX;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.scale, this.scale);

    ctx.fillStyle = BG_FIELD;
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);

    if (!this.reduceMotion) this.dust.draw(ctx);
    this.drawFlows(curr);
    this.drawHint(curr, now);
    this.drawDrag(curr, now);
    for (const node of curr.nodes) this.halos.drawHalo(ctx, node.owner, node.size, node.x, node.y);
    for (const node of curr.nodes) this.drawNode(node, now);
    this.drawPackets(curr, alpha);
    if (!overlay && !hud.paused && !this.reduceMotion) this.particles.draw(ctx); // else drawn over the dim, below
    this.drawHud(curr, dt, hud);
    drawMuteIcon(ctx, this.getMuted());
    drawPauseIcon(ctx);
    this.drawIntro(curr, now);
    ctx.restore();

    if (this.vignette) ctx.drawImage(this.vignette, 0, 0);

    if (hud.paused) this.drawPauseMenu();
    else if (overlay) {
      this.drawOverlay(overlay, curr, now);
      if (!this.reduceMotion) {
        // Confetti/embers belong ON TOP of the dimmed backdrop.
        ctx.save();
        ctx.translate(this.offsetX, this.offsetY);
        ctx.scale(this.scale, this.scale);
        this.particles.draw(ctx);
        ctx.restore();
      }
    }

    this.lastRenderMs = this.lastRenderMs * 0.95 + (performance.now() - t0) * 0.05;
  }

  /* ------------------------------------------------------------ tracking */

  private trackLevelChanges(curr: GameState, now: number): void {
    // New level OR same-level retry (tick reset) → intro flash + effect reset.
    if (curr.cfg.level !== this.introLevel || curr.tick < this.lastTick) {
      this.introLevel = curr.cfg.level;
      this.introAt = now;
      this.flips.clear();
      this.lastOwners.clear();
      this.lastUnits.clear();
      this.depositPopAt.clear();
      this.confettiWaves = 0;
    }
    this.lastTick = curr.tick;
  }

  private trackFlips(curr: GameState, now: number): void {
    for (const n of curr.nodes) {
      const before = this.lastOwners.get(n.id);
      if (before !== undefined && before !== n.owner) {
        this.flips.set(n.id, { at: now, oldOwner: before });
        const colorIdx = n.owner === "player" ? P_PLAYER : n.owner === "enemy" ? P_ENEMY : P_WHITE;
        if (!this.reduceMotion) this.particles.burst(n.x, n.y, 14, colorIdx);
      }
      this.lastOwners.set(n.id, n.owner);
    }
  }

  private trackDeposits(curr: GameState, now: number): void {
    for (const n of curr.nodes) {
      const before = this.lastUnits.get(n.id);
      if (before !== undefined && n.units > before) this.depositPopAt.set(n.id, now);
      this.lastUnits.set(n.id, n.units);
    }
  }

  private trackOverlay(overlay: OverlayView | null, now: number): void {
    const kind = overlay?.kind ?? null;
    if (kind === this.overlayKind) {
      // Ongoing win overlay: release confetti in 3 waves over the first second.
      if (
        kind === "won" &&
        !this.reduceMotion &&
        this.confettiWaves < 3 &&
        now - this.overlayAt > this.confettiWaves * 350
      ) {
        this.particles.confetti(34, P_PLAYER, P_WHITE);
        this.confettiWaves++;
      }
      return;
    }
    this.overlayKind = kind;
    this.overlayAt = now;
    this.confettiWaves = 0;
    if (kind === "lost" && !this.reduceMotion) {
      for (let i = 0; i < 20; i++) {
        this.particles.spawn(
          WORLD_W / 2 + (Math.random() - 0.5) * 40,
          WORLD_H / 2 + (Math.random() - 0.5) * 20,
          (Math.random() - 0.5) * 6,
          8 + Math.random() * 8,
          2200,
          0.8,
          P_EMBER,
          false,
        );
      }
    }
  }

  /* -------------------------------------------------------------- drawing */

  private drawFlows(state: GameState): void {
    const { ctx } = this;
    ctx.save();
    ctx.setLineDash([1.5, 2.5]);
    ctx.lineWidth = 0.5;
    for (const f of state.flows) {
      const a = state.nodes[f.from]!;
      const b = state.nodes[f.to]!;
      ctx.strokeStyle = COLORS_DIM[a.owner];
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  private nodeFill(node: Node, now: number): string {
    const flip = this.flips.get(node.id);
    if (flip) {
      const t = (now - flip.at) / CROSSFADE_MS;
      if (t < 1) {
        const ramp = this.colorSteps.get(`${flip.oldOwner}>${node.owner}`);
        if (ramp) return ramp[Math.min(ramp.length - 1, Math.floor(t * ramp.length))]!;
      }
    }
    return COLORS[node.owner];
  }

  /** Shaded sphere with flip crossfade (old sprite under, new fading in). */
  private drawNodeBody(node: Node, r: number, now: number): void {
    const { ctx } = this;
    const flip = this.flips.get(node.id);
    const t = flip ? (now - flip.at) / CROSSFADE_MS : 1;
    let drawn: boolean;
    if (flip && t < 1) {
      drawn = this.halos.drawSphere(ctx, flip.oldOwner, node.size, node.x, node.y, r);
      this.halos.drawSphere(ctx, node.owner, node.size, node.x, node.y, r, t);
    } else {
      drawn = this.halos.drawSphere(ctx, node.owner, node.size, node.x, node.y, r);
    }
    if (!drawn) {
      // Sprite cache not ready (first frame) — flat-fill fallback.
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      ctx.fillStyle = this.nodeFill(node, now);
      ctx.fill();
    }
  }

  private nodeRadius(node: Node, now: number): number {
    let r = NODE_R[node.size];
    const flip = this.flips.get(node.id);
    if (flip) {
      const t = (now - flip.at) / FLIP_POP_MS;
      if (t < 1) r *= 1 + 0.15 * (1 - t) * (1 - t) * (1 - t); // ease-out cubic
      else if (now - flip.at > 600) this.flips.delete(node.id);
    }
    const dep = this.depositPopAt.get(node.id);
    if (dep !== undefined) {
      const t = (now - dep) / DEPOSIT_POP_MS;
      if (t < 1) r *= 1 + 0.05 * (1 - t);
      else this.depositPopAt.delete(node.id);
    }
    return r;
  }

  private drawNode(node: Node, now: number): void {
    const { ctx } = this;
    const r = this.nodeRadius(node, now);

    if (node.selected) {
      const pulse = this.reduceMotion ? 0 : 0.4 * Math.sin(now / 150);
      ctx.beginPath();
      ctx.arc(node.x, node.y, r + 1.5 + pulse, 0, Math.PI * 2);
      ctx.strokeStyle = ink(0.85 + (this.reduceMotion ? 0.15 : 0.15 * Math.sin(now / 150)));
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }

    // Flip flash: expanding, fading white ring for 300 ms after capture.
    const flip = this.flips.get(node.id);
    if (flip) {
      const t = (now - flip.at) / 300;
      if (t < 1) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 1 + t * 5, 0, Math.PI * 2);
        ctx.strokeStyle = ink((1 - t) * 0.9);
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    this.drawNodeBody(node, r, now);

    // Fullness arc — teaches "full node = growth stopped, spend me".
    if (node.owner !== "neutral") {
      const frac = fullness(node.units, node.size);
      ctx.beginPath();
      ctx.arc(node.x, node.y, r - 0.6, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
      ctx.strokeStyle = ink(0.55);
      ctx.lineWidth = 0.7;
      ctx.stroke();
    }

    ctx.fillStyle = INK;
    ctx.font = this.pixelFont(NODE_R[node.size] * 0.8, true);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(node.units), node.x, node.y);
  }

  private drawPackets(state: GameState, alpha: number): void {
    const { ctx } = this;
    // Packets with arriveTick <= tick were consumed before tick incremented,
    // so "now" for survivors is (tick - 1 + alpha) on the departTick scale.
    const now = state.tick - 1 + alpha;
    const count = state.packets.length;
    const stride = count > 2000 ? 2 : 1;
    const asRects = count > 3000; // last-ditch degradation

    ctx.lineWidth = 1.6;
    ctx.lineCap = "round";
    for (let i = 0; i < count; i += stride) {
      const p = state.packets[i]!;
      const a = state.nodes[p.from]!;
      const b = state.nodes[p.to]!;
      const span = p.arriveTick - p.departTick;
      const t = Math.max(0, Math.min(1, (now - p.departTick) / span));
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      if (asRects) {
        ctx.fillStyle = COLORS[p.owner];
        ctx.fillRect(x - 0.55, y - 0.55, 1.1, 1.1);
        continue;
      }
      // Motion streak: a short line trailing 1.5 ticks behind along the path.
      const tt = Math.max(0, t - 1.5 / span);
      ctx.strokeStyle = COLORS[p.owner];
      ctx.beginPath();
      ctx.moveTo(a.x + (b.x - a.x) * tt, a.y + (b.y - a.y) * tt);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
  }

  private drawDrag(state: GameState, now: number): void {
    const drag = this.getDrag();
    if (!drag?.active) return;
    const from = state.nodes[drag.fromNodeId];
    if (!from) return;
    const { ctx } = this;

    const tx = drag.hoverNodeId != null ? state.nodes[drag.hoverNodeId]!.x : drag.wx;
    const ty = drag.hoverNodeId != null ? state.nodes[drag.hoverNodeId]!.y : drag.wy;

    ctx.save();
    ctx.strokeStyle = COLORS_DIM.player;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(tx, ty);
    ctx.stroke();

    const ang = Math.atan2(ty - from.y, tx - from.x);
    ctx.fillStyle = COLORS_DIM.player;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx - 3 * Math.cos(ang - 0.5), ty - 3 * Math.sin(ang - 0.5));
    ctx.lineTo(tx - 3 * Math.cos(ang + 0.5), ty - 3 * Math.sin(ang + 0.5));
    ctx.fill();

    if (drag.hoverNodeId != null) {
      const h = state.nodes[drag.hoverNodeId]!;
      const pulse = this.reduceMotion ? 0 : 0.3 * Math.sin(now / 120);
      ctx.beginPath();
      ctx.arc(h.x, h.y, NODE_R[h.size] + 2 + pulse, 0, Math.PI * 2);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawHint(state: GameState, now: number): void {
    if (state.firstSendDone || state.cfg.level > 3) return;
    let from: Node | null = null;
    for (const n of state.nodes)
      if (n.owner === "player" && (!from || n.units > from.units)) from = n;
    if (!from) return;
    let to: Node | null = null;
    let best = Infinity;
    for (const n of state.nodes) {
      if (n.owner !== "neutral") continue;
      const cost = n.units + dist(from, n) / 4;
      if (cost < best) {
        best = cost;
        to = n;
      }
    }
    if (!to) return;

    const { ctx } = this;
    const pulse = this.reduceMotion ? 0.65 : 0.45 + 0.35 * Math.sin(now / 300);
    const ang = Math.atan2(to.y - from.y, to.x - from.x);
    const r0 = NODE_R[from.size] + 2;
    const r1 = NODE_R[to.size] + 3;
    const x0 = from.x + r0 * Math.cos(ang);
    const y0 = from.y + r0 * Math.sin(ang);
    const x1 = to.x - r1 * Math.cos(ang);
    const y1 = to.y - r1 * Math.sin(ang);

    ctx.save();
    ctx.strokeStyle = ink(pulse);
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = ink(pulse);
    ctx.beginPath();
    ctx.moveTo(x1 + 2.5 * Math.cos(ang), y1 + 2.5 * Math.sin(ang));
    ctx.lineTo(x1 - 2.5 * Math.cos(ang - 0.55), y1 - 2.5 * Math.sin(ang - 0.55));
    ctx.lineTo(x1 - 2.5 * Math.cos(ang + 0.55), y1 - 2.5 * Math.sin(ang + 0.55));
    ctx.fill();

    if (!this.reduceMotion) {
      const gt = (now % 1500) / 1500;
      ctx.beginPath();
      ctx.arc(x0 + (x1 - x0) * gt, y0 + (y1 - y0) * gt, 1.1, 0, Math.PI * 2);
      ctx.fillStyle = ink(pulse + 0.2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawHud(state: GameState, dt: number, hud: HudView): void {
    const { ctx } = this;
    ctx.save();

    ctx.fillStyle = ink(0.7);
    ctx.font = this.pixelFont(4, true);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(`LEVEL ${state.cfg.level}`, 2.5, 2.2);

    // Lives as hearts; dim the spent ones so the stake is always visible.
    for (let i = 0; i < hud.maxLives; i++) {
      ctx.fillStyle = i < hud.lives ? coral(0.95) : ink(0.18);
      ctx.font = "4px system-ui, sans-serif"; // ♥ isn't in the pixel font
      ctx.fillText("♥", 2.5 + i * 4.4, 7.4);
    }
    if (hud.bestLevel > 1) {
      ctx.fillStyle = ink(0.4);
      ctx.font = this.pixelFont(3, true);
      ctx.fillText(`BEST ${hud.bestLevel}`, 2.5, 12.6);
    }

    let p = 0;
    let e = 0;
    for (const n of state.nodes) {
      if (n.owner === "player") p += n.units;
      else if (n.owner === "enemy") e += n.units;
    }
    for (const pk of state.packets) {
      if (pk.owner === "player") p += 1;
      else if (pk.owner === "enemy") e += 1;
    }
    const total = p + e;
    if (total > 0) {
      // Eased bar — glides toward the real ratio instead of snapping.
      this.hudP += (p / total - this.hudP) * Math.min(1, dt * 8);
      const barW = 50;
      const x = (WORLD_W - barW) / 2;
      const split = this.hudP * barW;
      ctx.fillStyle = COLORS.player;
      ctx.fillRect(x, 2.5, split, 1.6);
      ctx.fillStyle = COLORS.enemy;
      ctx.fillRect(x + split, 2.5, barW - split, 1.6);
    }
    ctx.restore();
  }

  /** "LEVEL N" center flash for the first 1.4 s of each level/retry. */
  private drawIntro(state: GameState, now: number): void {
    const age = now - this.introAt;
    if (age > INTRO_MS) return;
    const { ctx } = this;
    const fadeIn = Math.min(1, age / 350);
    const fadeOut = Math.min(1, (INTRO_MS - age) / 350);
    const a = Math.min(fadeIn, fadeOut);
    const scale = 1.3 - 0.3 * fadeIn * (2 - fadeIn); // ease-out toward 1
    ctx.save();
    ctx.translate(WORLD_W / 2, WORLD_H / 2 - 14);
    ctx.scale(scale, scale);
    ctx.fillStyle = ink(0.9 * a);
    ctx.font = this.displayFont(12);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`LEVEL ${state.cfg.level}`, 0, 0);
    ctx.restore();
  }

  private drawOverlay(overlay: OverlayView, state: GameState, now: number): void {
    const { ctx, canvas } = this;
    const age = now - this.overlayAt;
    const backdrop = Math.min(1, age / 250) * 0.72;
    const titleT = Math.min(1, age / 300);
    const titleScale = 1.2 - 0.2 * titleT * (2 - titleT);
    const subA = Math.max(0, Math.min(1, (age - 500) / 250));

    ctx.save();
    ctx.fillStyle = `rgba(5,6,12,${backdrop})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const u = this.scale;

    const title =
      overlay.kind === "won" ? "VICTORY" : overlay.kind === "lost" ? "DEFEATED" : "RUN OVER";
    const titleColor = overlay.kind === "won" ? COLORS.player : COLORS.enemy;

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.save();
    ctx.translate(cx, cy - 10 * u);
    ctx.scale(titleScale, titleScale);
    ctx.fillStyle = titleColor;
    ctx.globalAlpha = titleT;
    ctx.font = this.displayFont(14 * u);
    ctx.fillText(title, 0, 0);
    ctx.restore();

    ctx.globalAlpha = subA;
    ctx.fillStyle = ink(0.85);
    ctx.font = this.pixelFont(4 * u, true);
    if (overlay.kind === "won") {
      ctx.fillText(`TAP FOR LEVEL ${state.cfg.level + 1}`, cx, cy + 2 * u);
    } else if (overlay.kind === "lost") {
      ctx.fillStyle = coral(0.9);
      ctx.fillText(`♥ ${overlay.lives ?? 1} LEFT`, cx, cy + 2 * u);
      ctx.fillStyle = ink(0.85);
      ctx.fillText("TAP TO RETRY", cx, cy + 8 * u);
    } else {
      ctx.fillText(
        `REACHED LEVEL ${overlay.reachedLevel ?? state.cfg.level} · BEST ${overlay.bestLevel ?? 1}`,
        cx,
        cy + 2 * u,
      );
      ctx.fillText("TAP FOR NEW RUN", cx, cy + 8 * u);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /** Pause/settings panel. Button rects come from PAUSE_MENU (shared with input). */
  private drawPauseMenu(): void {
    const { ctx, canvas } = this;
    ctx.save();
    ctx.fillStyle = BACKDROP;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.scale, this.scale);

    const p = PAUSE_MENU.panel;
    ctx.fillStyle = BG_PANEL;
    ctx.strokeStyle = ink(0.16); // --color-line
    ctx.lineWidth = 0.4;
    this.roundRect(p.x, p.y, p.w, p.h, 2.5);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = ink(0.85);
    ctx.font = this.displayFont(6);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("PAUSED", p.x + p.w / 2, p.y + 5.5);

    const button = (r: { x: number; y: number; w: number; h: number }, label: string) => {
      ctx.fillStyle = ink(0.08);
      ctx.strokeStyle = ink(0.25);
      this.roundRect(r.x, r.y, r.w, r.h, 1.5);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = ink(0.9);
      ctx.font = this.pixelFont(3.2, true);
      ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2);
    };
    button(PAUSE_MENU.resume, "RESUME");
    button(PAUSE_MENU.restart, "RESTART RUN");
    button(PAUSE_MENU.mute, this.getMuted() ? "SOUND: OFF" : "SOUND: ON");
    button(PAUSE_MENU.exit, "BACK TO PLAYHOUSE");
    ctx.restore();
  }

  private roundRect(x: number, y: number, w: number, h: number, r: number): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}
