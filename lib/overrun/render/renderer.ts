import type { Faction, GameState, Node, Packet } from "../sim/state";
import { KIND_FACTORY, KIND_FORTRESS, KIND_TURRET, NEUTRAL, PLAYER, WORLD_W, WORLD_H } from "../sim/state";
import { NODE_R, TURRET_RANGE, UPGRADE_TICKS } from "../sim/constants";
import { dist, prodInterval } from "../sim/tick";
import {
  bakeBiomeBg,
  bakeVignette,
  biomeForLevel,
  buildColorSteps,
  chevronPos,
  drawMuteIcon,
  drawPauseIcon,
  Dust,
  fullness,
  KindSprites,
  OVERLAY_BUTTONS,
  ParticlePool,
  type PanelButton,
  PAUSE_MENU,
  menuZoom,
  OVERLAY_BUTTONS_RECT,
  RESTART_MENU,
  RUNOVER_BUTTONS,
  setUiMetrics,
  Shake,
  SHOP_MENU,
  SpriteCache,
  Ticker,
  TILT_Y,
  uiScale,
} from "./fx";
import {
  backdrop as backdropFill,
  BG_PANEL,
  CORE_HEX,
  coral,
  FACTION_COLORS,
  FACTION_DIM,
  FACTION_NAMES,
  GOLD_HEX,
  ink,
  inkOn,
  P_WHITE,
  P_EMBER,
} from "./palette";

/**
 * Canvas 2D renderer. Reads sim state (+ input drag state via getter), never
 * mutates either. World is a fixed 160×90 board with a subtle 2.5D tilt,
 * fit-contained with letterboxing, legible from 907×510 to 1920×1080 and on
 * mobile in both orientations.
 *
 * All animation state in here is presentation-only, keyed to wall-clock time.
 */

const CROSSFADE_MS = 250;
const FLIP_POP_MS = 200;
const DEPOSIT_POP_MS = 120;
const INTRO_MS = 1400;

/**
 * Lazily-held MediaQueryList — the render loop asks this several times a
 * frame, and allocating a fresh one each call is pure garbage. No listener,
 * so there's nothing to tear down.
 */
let motionQuery: MediaQueryList | null = null;
const REDUCED_MOTION = (): boolean => {
  motionQuery ??= matchMedia("(prefers-reduced-motion: reduce)");
  return motionQuery.matches;
};

/**
 * Concrete font-family names. next/font hashes the family, so the values are
 * resolved off probe spans at runtime by lib/overrun/fonts.ts and handed in.
 */
export interface GameFonts {
  display: string;
  pixel: string;
}

export interface DragView {
  active: boolean;
  fromNodeId: number;
  wx: number;
  wy: number;
  hoverNodeId: number | null;
}

export interface OverlayView {
  kind: "won" | "lost" | "runover" | "daily-won" | "daily-lost";
  lives?: number;
  reachedLevel?: number;
  bestLevel?: number;
  /** Cores banked (win/runover/daily overlays). */
  cores?: number;
  /** Stars earned on a won level (1–3). */
  stars?: number;
  /** Set on a win that banked a fresh checkpoint — the level it banked at. */
  checkpoint?: number;
  /** Latest banked checkpoint; >1 turns the run-over screen into a choice. */
  checkpointLevel?: number;
}

/** App-layer HUD data (run progression lives outside the sim). */
export interface HudView {
  lives: number;
  maxLives: number;
  bestLevel: number;
  /** Latest banked checkpoint level (1 = none banked yet). */
  checkpoint?: number;
  streak: number;
  cores: number;
  paused: boolean;
  /** Set while playing the daily challenge ("DAILY · MUTATOR NAME"). */
  dailyName?: string;
  /** Node id currently showing the upgrade chevron, if any. */
  chevronNodeId?: number | null;
  /** One-time teaching nudge: node spotlit with pulse ring + unprompted chevron. */
  nudgeNodeId?: number | null;
  /** After the nudge has fired once, faint standing chevrons on eligible unselected nodes. */
  showDimChevrons?: boolean;
}

/** Restart-choice panel view-model (RESTART RUN with a checkpoint banked). */
export interface RestartView {
  checkpointLevel: number;
}

/** Upgrade shop view-model, built by the app layer from TRACKS + save. */
export interface ShopView {
  cores: number;
  rows: Array<{ name: string; desc: string; cost: number | null; tier: number; maxTier: number; affordable: boolean }>;
}

interface FlipRecord {
  at: number;
  oldOwner: Faction;
}

interface Zap {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  color: string;
  at: number;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private scale = 1;
  private offsetX = 0;
  private offsetY = 0;
  /** UI-chrome scale for small viewports (1 on desktop). See fx.setUiMetrics. */
  private u = 1;

  private flips = new Map<number, FlipRecord>();
  private lastOwners = new Map<number, Faction>();
  private lastUnits = new Map<number, number>();
  private depositPopAt = new Map<number, number>();
  private lastSizes = new Map<number, number>();
  private upgradePopAt = new Map<number, number>();
  private lastHitKickAt = 0;
  private colorSteps = buildColorSteps(8);
  private particles = new ParticlePool();
  private sprites = new SpriteCache();
  private kinds = new KindSprites();
  private dust = new Dust();
  private ticker = new Ticker();
  private shake = new Shake();
  private vignette: HTMLCanvasElement | null = null;
  private biomeBg: HTMLCanvasElement | null = null;
  private biomeLevel = -1;

  private prevPackets: Packet[] = [];
  private zaps: Zap[] = [];
  private turretAim = new Map<number, number>();
  private factionAlive = [false, false, false, false, false];
  private threatAnnounced = new Set<number>();

  private hudShares: number[] = [0.5, 0.5, 0, 0, 0];
  private lastFrameAt = 0;

  private introLevel = -1;
  private introAt = 0;
  private lastTick = -1;

  private overlayAt = 0;
  private overlayKind: OverlayView["kind"] | null = null;
  private confettiWaves = 0;

  /** Final-blow zoom-punch state. */
  private winFocus: { x: number; y: number; at: number } | null = null;

  /** Rolling average render cost in ms, exposed for perf verification. */
  lastRenderMs = 0;

  private fonts: GameFonts;
  private resizeObserver: ResizeObserver | null = null;

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
    this.resize();
    // The game is a component in a page, not the whole viewport — observe the
    // canvas box itself. Also catches the mobile URL bar collapsing, which
    // resizes the container without firing a window resize on some browsers.
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
  }

  /** Unmount path — release the observer so remounts don't stack them. */
  destroy(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
  }

  /** Jersey 15 ships weight 400 only — never ask canvas for synthetic bold. */
  private displayFont(size: number): string {
    return `${size}px ${this.fonts.display}`;
  }

  private pixelFont(size: number, bold = false): string {
    return `${bold ? "bold " : ""}${size}px ${this.fonts.pixel}`;
  }

  /**
   * ♥ ★ ☆ ◈ aren't in Jersey 15 or Silkscreen — asking for them there draws
   * tofu. These few glyphs stay on the system stack; everything else uses
   * the site's faces.
   */
  private glyphFont(size: number): string {
    return `bold ${size}px system-ui, sans-serif`;
  }

  private resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // Measure our own box, not the viewport. Floor: a zero-sized container
    // mid-navigation must not zero the transform — the observer re-fires
    // once real dimensions exist.
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(64, rect.width);
    const h = Math.max(36, rect.height);
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);

    this.scale = Math.min(
      this.canvas.width / WORLD_W,
      this.canvas.height / (WORLD_H * TILT_Y),
    );
    this.offsetX = (this.canvas.width - WORLD_W * this.scale) / 2;
    this.offsetY = (this.canvas.height - WORLD_H * TILT_Y * this.scale) / 2;
    // UI chrome scaling for small viewports; keyed to CSS px per wu, not
    // device px (the backing store carries the DPR cap).
    setUiMetrics(w, h, this.scale / dpr);
    this.u = uiScale();
    this.sprites.rebuild(this.scale);
    this.kinds.rebuild(this.scale);
    this.vignette = bakeVignette(this.canvas.width, this.canvas.height);
    this.biomeLevel = -1; // force biome rebake at the new size
  }

  /**
   * The single source of truth for the world transform (tilt + shake + the
   * final-blow zoom). screenToWorld inverts exactly the same math.
   */
  private applyWorldTransform(now: number): void {
    const { ctx } = this;
    const sh = this.shake.offset();
    let zoom = 1;
    let fx = WORLD_W / 2;
    let fy = WORLD_H / 2;
    if (this.winFocus) {
      const t = (now - this.winFocus.at) / 1000;
      if (t < 1.2) {
        const inT = Math.min(1, t / 0.12);
        const outT = Math.max(0, (t - 0.62) / 0.4);
        zoom = 1 + 0.06 * Math.min(inT, 1 - Math.min(1, outT));
        fx = this.winFocus.x;
        fy = this.winFocus.y;
      } else {
        this.winFocus = null;
      }
    }
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.scale, this.scale * TILT_Y);
    if (zoom !== 1) {
      ctx.translate(fx, fy);
      ctx.scale(zoom, zoom);
      ctx.translate(-fx, -fy);
    }
    ctx.translate(sh.x, sh.y);
  }

  /** Depth scale for sprites: things lower on the board read slightly larger. */
  private dscale(y: number): number {
    return 0.95 + 0.1 * (y / WORLD_H);
  }

  /** CSS-pixel screen coords → world coords (for input hit-testing). */
  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    const dpr = this.canvas.width / this.canvas.clientWidth;
    return {
      x: (sx * dpr - this.offsetX) / this.scale,
      y: (sy * dpr - this.offsetY) / (this.scale * TILT_Y),
    };
  }

  render(
    prev: GameState,
    curr: GameState,
    alpha: number,
    overlay: OverlayView | null,
    hud: HudView,
    shop: ShopView | null = null,
    restart: RestartView | null = null,
  ): void {
    const t0 = performance.now();
    const { ctx, canvas } = this;
    const now = t0;
    const dt = Math.min(0.05, (now - this.lastFrameAt) / 1000);
    this.lastFrameAt = now;
    const biome = biomeForLevel(curr.cfg.level);

    this.trackLevelChanges(curr, now);
    this.trackDamage(prev, curr, now);
    this.trackFlips(curr, now);
    this.trackDeposits(curr, now);
    this.trackZapsAndWar(curr, now);
    this.trackOverlay(overlay, curr, now);

    // Biome background with parallax drift (baked oversized, one blit).
    if (this.biomeLevel !== curr.cfg.level) {
      this.biomeBg = bakeBiomeBg(biome, canvas.width, canvas.height, Math.ceil(3 * this.scale));
      this.biomeLevel = curr.cfg.level;
    }
    const pad = Math.ceil(3 * this.scale);
    const drift = REDUCED_MOTION()
      ? { x: 0, y: 0 }
      : { x: 1.5 * Math.sin(now / 17000) * this.scale, y: 1.0 * Math.sin(now / 23000) * this.scale };
    ctx.drawImage(this.biomeBg!, -pad + drift.x, -pad + drift.y);

    ctx.save();
    this.applyWorldTransform(now);

    ctx.fillStyle = biome.board;
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);

    this.chevronId = hud.chevronNodeId ?? null;
    this.nudgeId = hud.nudgeNodeId ?? null;
    this.dimChevrons = hud.showDimChevrons ?? false;
    this.dust.draw(ctx, biome.dustColor);
    this.drawFlows(curr);
    this.drawHint(curr, now);
    this.drawDrag(curr, now);
    for (const node of curr.nodes) this.sprites.drawShadow(ctx, node.size, node.x, node.y);
    for (const node of curr.nodes)
      this.drawHalo(node, now);
    for (const node of curr.nodes) this.drawNode(node, curr, now);
    this.drawPackets(curr, alpha);
    this.drawZaps(now);
    if (!overlay && !hud.paused) this.particles.draw(ctx);
    this.drawHud(curr, dt, hud, now);
    drawMuteIcon(ctx, this.getMuted());
    drawPauseIcon(ctx);
    if (curr.cfg.level > 3) this.ticker.draw(ctx);
    this.drawIntro(curr, now);
    ctx.restore();

    if (this.vignette) ctx.drawImage(this.vignette, 0, 0);

    if (shop) this.drawShop(shop);
    else if (restart) this.drawRestartMenu(restart);
    else if (hud.paused) this.drawPauseMenu();
    else if (overlay) {
      this.drawOverlay(overlay, curr, now);
      ctx.save();
      this.applyWorldTransform(now);
      this.particles.draw(ctx);
      ctx.restore();
    }

    this.lastRenderMs = this.lastRenderMs * 0.95 + (performance.now() - t0) * 0.05;
  }

  /* ------------------------------------------------------------ tracking */

  private trackLevelChanges(curr: GameState, now: number): void {
    if (curr.cfg.level !== this.introLevel || curr.tick < this.lastTick) {
      this.introLevel = curr.cfg.level;
      this.introAt = now;
      this.flips.clear();
      this.lastOwners.clear();
      this.lastUnits.clear();
      this.depositPopAt.clear();
      this.lastSizes.clear();
      this.upgradePopAt.clear();
      this.lastHitKickAt = 0;
      this.confettiWaves = 0;
      this.prevPackets = [];
      this.zaps = [];
      this.threatAnnounced.clear();
      this.winFocus = null;
      this.hudShares = [0, 0, 0, 0, 0];
      for (const n of curr.nodes) if (n.owner !== NEUTRAL) this.hudShares[n.owner] = 1;
      for (let f = 0; f <= 4; f++)
        this.factionAlive[f] = curr.nodes.some((n) => n.owner === f);
    }
    this.lastTick = curr.tick;
  }

  private trackFlips(curr: GameState, now: number): void {
    for (const n of curr.nodes) {
      const before = this.lastOwners.get(n.id);
      if (before !== undefined && before !== n.owner) {
        this.flips.set(n.id, { at: now, oldOwner: before });
        this.particles.burst(n.x, n.y, 14, n.owner === NEUTRAL ? P_WHITE : n.owner);
        if (before === PLAYER) this.shake.kick(0.8, 110); // losing ground always thumps
      }
      this.lastOwners.set(n.id, n.owner);
    }
  }

  private trackDeposits(curr: GameState, now: number): void {
    for (const n of curr.nodes) {
      const before = this.lastUnits.get(n.id);
      if (before !== undefined && n.units > before) this.depositPopAt.set(n.id, now);
      this.lastUnits.set(n.id, n.units);
      const sizeBefore = this.lastSizes.get(n.id);
      if (sizeBefore !== undefined && n.size > sizeBefore && n.owner === PLAYER) {
        this.upgradePopAt.set(n.id, now);
        this.particles.burst(n.x, n.y, 18, PLAYER);
      }
      this.lastSizes.set(n.id, n.size);
    }
  }

  /** Shake on damage only: hostile packets landing on player nodes. Reads the
   *  pre-diff prevPackets snapshot, so it must run before trackZapsAndWar. */
  private trackDamage(prev: GameState, curr: GameState, now: number): void {
    for (const p of this.prevPackets) {
      if (p.arriveTick > curr.tick) continue; // still in flight
      if (p.owner === PLAYER) continue; // own reinforcement or return fire
      if (prev.nodes[p.to]?.owner !== PLAYER) continue; // pre-tick owner: node may flip this tick
      if (now - this.lastHitKickAt < 200) return; // tremble, not blur
      this.lastHitKickAt = now;
      this.shake.kick(0.28, 70);
      return;
    }
  }

  /** Packet diff for turret-zap visuals + faction eliminations + threats. */
  private trackZapsAndWar(curr: GameState, now: number): void {
    // Zaps: prev packets that were mid-flight and vanished.
    let ci = 0;
    for (const p of this.prevPackets) {
      if (p.arriveTick <= curr.tick - 1) continue;
      const c = curr.packets[ci];
      if (c && c.owner === p.owner && c.from === p.from && c.departTick === p.departTick) {
        ci++;
        continue;
      }
      // p was zapped mid-flight: find the turret that plausibly did it.
      const a = curr.nodes[p.from];
      const b = curr.nodes[p.to];
      if (a && b) {
        const t = Math.min(1, (curr.tick - 1 - p.departTick) / (p.arriveTick - p.departTick));
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t;
        let turret: Node | null = null;
        let best = TURRET_RANGE * TURRET_RANGE * 1.4;
        for (const n of curr.nodes) {
          if (n.kind !== KIND_TURRET || n.owner === NEUTRAL || n.owner === p.owner) continue;
          const d2 = (n.x - x) ** 2 + (n.y - y) ** 2;
          if (d2 < best) {
            best = d2;
            turret = n;
          }
        }
        if (turret) {
          this.zaps.push({ x0: turret.x, y0: turret.y, x1: x, y1: y, color: FACTION_COLORS[turret.owner]!, at: now });
          this.turretAim.set(turret.id, Math.atan2(y - turret.y, x - turret.x));
          for (let s = 0; s < 3; s++)
            this.particles.spawn(x, y, (Math.random() - 0.5) * 24, (Math.random() - 0.5) * 24, 250, 0.5, P_WHITE);
          if (this.zaps.length > 12) this.zaps.shift();
        }
      }
    }
    this.prevPackets = curr.packets.slice();

    // Faction eliminations → ticker + gray-crumble; announced once each.
    for (let f = 2 as Faction; f <= 4; f++) {
      const alive =
        curr.nodes.some((n) => n.owner === f) || curr.packets.some((p) => p.owner === f);
      if (this.factionAlive[f] && !alive) {
        this.ticker.push(`${FACTION_NAMES[f]} HAS FALLEN`, FACTION_COLORS[f]!);
        this.shake.kick(0.6, 90);
      }
      this.factionAlive[f] = alive;
    }

    // First aggression against the player, per faction.
    for (const fl of curr.flows) {
      const src = curr.nodes[fl.from]!;
      const dst = curr.nodes[fl.to]!;
      if (src.owner >= 2 && dst.owner === PLAYER && !this.threatAnnounced.has(src.owner)) {
        this.threatAnnounced.add(src.owner);
        if (curr.cfg.level > 3)
          this.ticker.push(`${FACTION_NAMES[src.owner]} ATTACKS YOU`, FACTION_COLORS[src.owner]!);
      }
    }
  }

  private trackOverlay(overlay: OverlayView | null, curr: GameState, now: number): void {
    const kind = overlay?.kind ?? null;
    if (kind === this.overlayKind) {
      if (
        kind === "won" &&
        this.confettiWaves < 3 &&
        now - this.overlayAt > this.confettiWaves * 350
      ) {
        this.particles.confetti(34, PLAYER, P_WHITE);
        this.confettiWaves++;
      }
      return;
    }
    this.overlayKind = kind;
    this.overlayAt = now;
    this.confettiWaves = 0;
    if (kind === "lost" || kind === "runover") {
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

  private pendingFocus: { x: number; y: number } | null = null;
  private chevronId: number | null = null;
  private nudgeId: number | null = null;
  private dimChevrons = false;

  /** App layer stores the winning capture position, then triggers the punch. */
  finalBlow(): void {
    this.winFocus = this.pendingFocus
      ? { ...this.pendingFocus, at: performance.now() }
      : { x: WORLD_W / 2, y: WORLD_H / 2, at: performance.now() };
    this.shake.kick(1.5, 120);
    this.particles.burst(this.winFocus.x, this.winFocus.y, 40, PLAYER);
  }

  /* -------------------------------------------------------------- drawing */

  private drawHalo(node: Node, now: number): void {
    if (node.owner === NEUTRAL) return;
    // Per-faction pulse rhythm — identity beyond hue.
    let mult = 1;
    if (!REDUCED_MOTION()) {
      if (node.owner === 2) mult = 1 + 0.06 * Math.max(0, Math.sin((now / 700) * Math.PI * 2)) ** 2;
      else if (node.owner === 3) mult = 1 + 0.04 * Math.sin((now / 2400) * Math.PI * 2);
      else if (node.owner === 4)
        mult = 1 + 0.05 * Math.max(0, Math.sin((now / 1400) * Math.PI * 4)) * (Math.sin((now / 1400) * Math.PI * 2) > 0 ? 1 : 0);
    }
    this.sprites.drawHalo(this.ctx, node.owner, node.size, node.x, node.y, mult);
  }

  private nodeRadius(node: Node, now: number): number {
    let r = NODE_R[node.size] * this.dscale(node.y);
    const flip = this.flips.get(node.id);
    if (flip) {
      const t = (now - flip.at) / FLIP_POP_MS;
      if (t < 1) r *= 1 + 0.15 * (1 - t) * (1 - t) * (1 - t);
      else if (now - flip.at > 600) this.flips.delete(node.id);
    }
    const dep = this.depositPopAt.get(node.id);
    if (dep !== undefined) {
      const t = (now - dep) / DEPOSIT_POP_MS;
      if (t < 1) r *= 1 + (node.kind === KIND_FACTORY ? 0.08 : 0.05) * (1 - t);
      else this.depositPopAt.delete(node.id);
    }
    return r;
  }

  private drawNodeBody(node: Node, r: number, now: number): void {
    const { ctx } = this;
    const flip = this.flips.get(node.id);
    const t = flip ? (now - flip.at) / CROSSFADE_MS : 1;
    let drawn: boolean;
    if (flip && t < 1) {
      drawn = this.sprites.drawSphere(ctx, flip.oldOwner, node.size, node.x, node.y, r);
      this.sprites.drawSphere(ctx, node.owner, node.size, node.x, node.y, r, t);
    } else {
      drawn = this.sprites.drawSphere(ctx, node.owner, node.size, node.x, node.y, r);
    }
    if (!drawn) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      ctx.fillStyle = FACTION_COLORS[node.owner]!;
      ctx.fill();
    }
  }

  private drawNode(node: Node, state: GameState, now: number): void {
    const { ctx } = this;
    const r = this.nodeRadius(node, now);

    // Kind accessories under the sphere.
    if (node.kind === KIND_FACTORY) {
      const interval = prodInterval(state, node);
      const progress = (state.tick % interval) / interval;
      this.kinds.drawGear(ctx, node.owner, node.size, node.x, node.y, (progress * Math.PI * 2) / 8);
    } else if (node.kind === KIND_FORTRESS) {
      this.kinds.drawHex(ctx, node.owner, node.size, node.x, node.y);
    } else if (node.kind === KIND_TURRET) {
      const aim = this.turretAim.get(node.id) ?? -Math.PI / 2;
      ctx.save();
      ctx.translate(node.x, node.y);
      ctx.rotate(aim);
      ctx.fillStyle = "rgba(20,24,33,0.9)";
      ctx.fillRect(r * 0.5, -0.45, 2.2, 0.9);
      ctx.fillStyle = FACTION_COLORS[node.owner]!;
      ctx.fillRect(r * 0.5 + 1.7, -0.45, 0.5, 0.9);
      ctx.restore();
    }

    if (node.selected) {
      const pulse = 0.4 * Math.sin(now / 150);
      ctx.beginPath();
      ctx.arc(node.x, node.y, r + 1.5 + pulse, 0, Math.PI * 2);
      ctx.strokeStyle = ink(0.85 + 0.15 * Math.sin(now / 150));
      ctx.lineWidth = 0.8;
      ctx.stroke();
    } else if (this.nudgeId === node.id) {
      // Teaching spotlight: slower cyan pulse, distinct from selection.
      const pulse = REDUCED_MOTION() ? 0 : 0.5 * Math.sin(now / 250);
      ctx.beginPath();
      ctx.arc(node.x, node.y, r + 2 + pulse, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(143,227,255,0.9)";
      ctx.lineWidth = 0.7;
      ctx.stroke();
    }

    // Upgrade-complete payoff: one expanding ring in the owner's color.
    const up = this.upgradePopAt.get(node.id);
    if (up !== undefined) {
      const t = (now - up) / 450;
      if (t < 1) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 1 + t * 7, 0, Math.PI * 2);
        ctx.strokeStyle = FACTION_COLORS[PLAYER]!;
        ctx.globalAlpha = (1 - t) * 0.8;
        ctx.lineWidth = 1.2 - t;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

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
      // Second, wider shockwave ring in the new owner's color.
      const t2 = (now - flip.at) / 450;
      if (t2 < 1 && flip.oldOwner !== NEUTRAL) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 1 + t2 * 8, 0, Math.PI * 2);
        ctx.strokeStyle = FACTION_COLORS[node.owner]!;
        ctx.globalAlpha = (1 - t2) * 0.7;
        ctx.lineWidth = 1.2 - t2;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    this.drawNodeBody(node, r, now);

    if (node.upgrading !== 0) {
      const total = state.cfg.playerUpgradeTicks || UPGRADE_TICKS;
      const remaining = Math.max(0, node.upgrading - state.tick);
      const progress = 1 - Math.min(1, remaining / total);
      ctx.save();
      ctx.setLineDash([1.2, 1.2]);
      ctx.beginPath();
      ctx.arc(node.x, node.y, r + 1.8, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
      ctx.strokeStyle = ink(0.8);
      ctx.lineWidth = 0.7;
      ctx.stroke();
      ctx.restore();
    }

    if (node.owner !== NEUTRAL) {
      const frac = fullness(node.units, node.size);
      ctx.beginPath();
      ctx.arc(node.x, node.y, r - 0.6, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
      ctx.strokeStyle = node.owner === 3 ? "rgba(28,34,48,0.55)" : ink(0.55);
      ctx.lineWidth = 0.7;
      ctx.stroke();
    }

    ctx.fillStyle = inkOn(node.owner);
    ctx.font = this.pixelFont(NODE_R[node.size]! * 0.85 * this.dscale(node.y), true);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(node.units), node.x, node.y);

    // Upgrade chevron: full + cost label on the selected/nudged node, faint
    // standing hint on other eligible nodes once the nudge has fired.
    if (this.chevronId === node.id || this.nudgeId === node.id) {
      const p = chevronPos(node.x, node.y, r);
      const pulse = 0.6 + 0.4 * Math.abs(Math.sin(now / 350));
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.fillStyle = CORE_HEX;
      this.traceChevron(p.x, p.y);
      ctx.fill();
      ctx.font = this.pixelFont(2.4 * this.u, true);
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(`-${state.cfg.playerUpgradeCost[node.size as 0 | 1]}`, p.x + 2.4 * this.u, p.y);
      ctx.restore();
    } else if (
      this.dimChevrons &&
      !node.selected &&
      node.owner === PLAYER &&
      node.size < 2 &&
      node.upgrading === 0 &&
      node.units >= state.cfg.playerUpgradeCost[node.size as 0 | 1]
    ) {
      const p = chevronPos(node.x, node.y, r);
      ctx.save();
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = CORE_HEX;
      this.traceChevron(p.x, p.y);
      ctx.fill();
      ctx.restore();
    }
  }

  /** Up-arrow glyph path shared by the full, nudged, and dimmed chevrons. */
  private traceChevron(x: number, y: number): void {
    const { ctx } = this;
    const u = this.u;
    ctx.beginPath();
    ctx.moveTo(x, y - 1.6 * u);
    ctx.lineTo(x - 1.8 * u, y + 0.6 * u);
    ctx.lineTo(x - 0.6 * u, y + 0.6 * u);
    ctx.lineTo(x - 0.6 * u, y + 1.8 * u);
    ctx.lineTo(x + 0.6 * u, y + 1.8 * u);
    ctx.lineTo(x + 0.6 * u, y + 0.6 * u);
    ctx.lineTo(x + 1.8 * u, y + 0.6 * u);
    ctx.closePath();
  }

  private drawZaps(now: number): void {
    const { ctx } = this;
    this.zaps = this.zaps.filter((z) => now - z.at < 90);
    for (const z of this.zaps) {
      const a = 1 - (now - z.at) / 90;
      ctx.globalAlpha = a * 0.6;
      ctx.strokeStyle = z.color;
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(z.x0, z.y0);
      ctx.lineTo(z.x1, z.y1);
      ctx.stroke();
      ctx.globalAlpha = a * 0.9;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 0.35;
      ctx.beginPath();
      ctx.moveTo(z.x0, z.y0);
      ctx.lineTo(z.x1, z.y1);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  private drawPackets(state: GameState, alpha: number): void {
    const { ctx } = this;
    const now = state.tick - 1 + alpha;
    const count = state.packets.length;
    const stride = count > 2000 ? 2 : 1;
    const asRects = count > 3000;

    ctx.lineWidth = 1.6;
    ctx.lineCap = "round";
    for (let f = 0 as Faction; f <= 4; f++) {
      let styled = false;
      for (let i = 0; i < count; i += stride) {
        const p = state.packets[i]!;
        if (p.owner !== f) continue;
        const a = state.nodes[p.from]!;
        const b = state.nodes[p.to]!;
        const span = p.arriveTick - p.departTick;
        const t = Math.max(0, Math.min(1, (now - p.departTick) / span));
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t;
        if (!styled) {
          ctx.strokeStyle = FACTION_COLORS[f]!;
          ctx.fillStyle = FACTION_COLORS[f]!;
          styled = true;
        }
        if (asRects) {
          ctx.fillRect(x - 0.55, y - 0.55, 1.1, 1.1);
          continue;
        }
        const tt = Math.max(0, t - 1.5 / span);
        ctx.beginPath();
        ctx.moveTo(a.x + (b.x - a.x) * tt, a.y + (b.y - a.y) * tt);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
    }
  }

  private drawFlows(state: GameState): void {
    const { ctx } = this;
    ctx.save();
    ctx.setLineDash([1.5, 2.5]);
    ctx.lineWidth = 0.5;
    for (const f of state.flows) {
      const a = state.nodes[f.from]!;
      const b = state.nodes[f.to]!;
      ctx.strokeStyle = FACTION_DIM[a.owner]!;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.restore();
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
    ctx.strokeStyle = FACTION_DIM[PLAYER]!;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(tx, ty);
    ctx.stroke();

    const ang = Math.atan2(ty - from.y, tx - from.x);
    ctx.fillStyle = FACTION_DIM[PLAYER]!;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx - 3 * Math.cos(ang - 0.5), ty - 3 * Math.sin(ang - 0.5));
    ctx.lineTo(tx - 3 * Math.cos(ang + 0.5), ty - 3 * Math.sin(ang + 0.5));
    ctx.fill();

    if (drag.hoverNodeId != null) {
      const h = state.nodes[drag.hoverNodeId]!;
      const pulse = 0.3 * Math.sin(now / 120);
      ctx.beginPath();
      ctx.arc(h.x, h.y, NODE_R[h.size] + 2 + pulse, 0, Math.PI * 2);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawHint(state: GameState, now: number): void {
    if (state.firstSendDone || state.cfg.level > 3) return;
    let from: Node | null = null;
    for (const n of state.nodes)
      if (n.owner === PLAYER && (!from || n.units > from.units)) from = n;
    if (!from) return;
    let to: Node | null = null;
    let best = Infinity;
    for (const n of state.nodes) {
      if (n.owner !== NEUTRAL) continue;
      const cost = n.units + dist(from, n) / 4;
      if (cost < best) {
        best = cost;
        to = n;
      }
    }
    if (!to) return;

    const { ctx } = this;
    const pulse = 0.45 + 0.35 * Math.sin(now / 300);
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

    const gt = (now % 1500) / 1500;
    ctx.beginPath();
    ctx.arc(x0 + (x1 - x0) * gt, y0 + (y1 - y0) * gt, 1.1, 0, Math.PI * 2);
    ctx.fillStyle = ink(pulse + 0.2);
    ctx.fill();
    ctx.restore();
  }

  private drawHud(state: GameState, dt: number, hud: HudView, now: number): void {
    const { ctx } = this;
    const u = this.u;
    ctx.save();

    ctx.fillStyle = ink(0.7);
    ctx.font = this.pixelFont(4 * u, true);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(hud.dailyName ? "DAILY" : `LEVEL ${state.cfg.level}`, 2.5 * u, 2.2 * u);
    // Cores balance, always visible next to the top-right icons.
    ctx.textAlign = "right";
    ctx.fillStyle = CORE_HEX;
    ctx.font = this.glyphFont(3.2 * u);
    ctx.fillText(`◈ ${hud.cores}`, WORLD_W - 17 * u, 3.2 * u);
    ctx.textAlign = "left";

    // Win-streak fire: the streak counter burns from 3 up.
    if (hud.streak >= 3) {
      const pulse = 1 + 0.04 * Math.sin(now / 180);
      ctx.save();
      ctx.translate(24 * u, 2.2 * u);
      ctx.scale(pulse, pulse);
      ctx.fillStyle = GOLD_HEX;
      ctx.font = this.glyphFont(3.2 * u); // × isn't reliably in the pixel font
      ctx.fillText(`×${hud.streak}`, 0, 0);
      ctx.restore();
      if (Math.random() < 0.12)
        this.particles.spawn((25.5 + Math.random() * 3) * u, 4.5 * u, (Math.random() - 0.5) * 3, -6 - Math.random() * 5, 400, 0.5, 3);
    }

    for (let i = 0; i < hud.maxLives; i++) {
      ctx.fillStyle = i < hud.lives ? coral(0.95) : ink(0.18);
      ctx.font = this.glyphFont(4 * u);
      ctx.fillText("♥", (2.5 + i * 4.4) * u, 7.4 * u);
    }
    if (hud.bestLevel > 1) {
      ctx.fillStyle = ink(0.4);
      ctx.font = this.pixelFont(3 * u, true);
      const cp = (hud.checkpoint ?? 1) > 1 ? ` · CP ${hud.checkpoint}` : "";
      ctx.fillText(`BEST ${hud.bestLevel}${cp}`, 2.5 * u, 12.6 * u);
    }

    const totals = [0, 0, 0, 0, 0];
    for (const n of state.nodes) if (n.owner !== NEUTRAL) totals[n.owner]! += n.units;
    for (const pk of state.packets) totals[pk.owner]! += 1;
    const total = totals.reduce((a, b) => a + b, 0);
    if (total > 0) {
      const ease = Math.min(1, dt * 8);
      for (let f = 0; f <= 4; f++) {
        const target = totals[f]! / total;
        this.hudShares[f] = this.hudShares[f]! + (target - this.hudShares[f]!) * ease;
      }
      const norm = this.hudShares.reduce((a, b) => a + b, 0) || 1;
      const barW = 50; // width stays fixed — scaling it would collide with cores/streak
      let x = (WORLD_W - barW) / 2;
      const barH = 1.6 * Math.min(u, 2);
      for (let f = 1; f <= 4; f++) {
        const w = (this.hudShares[f]! / norm) * barW;
        if (w <= 0.01) continue;
        ctx.fillStyle = FACTION_COLORS[f]!;
        ctx.fillRect(x, 2.5, w, barH);
        x += w;
      }
    }
    ctx.restore();
  }

  private drawIntro(state: GameState, now: number): void {
    const age = now - this.introAt;
    if (age > INTRO_MS) return;
    const { ctx } = this;
    const fadeIn = Math.min(1, age / 350);
    const fadeOut = Math.min(1, (INTRO_MS - age) / 350);
    const a = Math.min(fadeIn, fadeOut);
    const scale = 1.3 - 0.3 * fadeIn * (2 - fadeIn);
    ctx.save();
    ctx.translate(WORLD_W / 2, WORLD_H / 2 - 14);
    ctx.scale(scale, scale);
    ctx.fillStyle = ink(0.9 * a);
    ctx.font = this.displayFont(10);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`LEVEL ${state.cfg.level}`, 0, 0);
    // Faction roster under the level number on multi-faction boards.
    if (state.cfg.factionCount > 2) {
      const ru = Math.min(this.u, 1.6); // capped: 4 columns must fit the board
      ctx.font = this.pixelFont(3.4 * ru, true);
      let x = -((state.cfg.ais.length - 1) * 14 * ru) / 2;
      for (const fc of state.cfg.ais) {
        ctx.fillStyle = FACTION_COLORS[fc.faction]!;
        ctx.globalAlpha = 0.9 * a;
        ctx.fillText(FACTION_NAMES[fc.faction]!, x, 8 * ru);
        x += 14 * ru;
      }
      ctx.globalAlpha = 1;
    }
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
    ctx.fillStyle = backdropFill(backdrop);
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const u = this.scale * this.u; // device px per wu, boosted on small screens

    const won = overlay.kind === "won" || overlay.kind === "daily-won";
    const title =
      overlay.kind === "won"
        ? "VICTORY"
        : overlay.kind === "lost"
          ? "DEFEATED"
          : overlay.kind === "runover"
            ? "RUN OVER"
            : overlay.kind === "daily-won"
              ? "DAILY CLEARED"
              : "DAILY FAILED";
    const titleColor = won ? FACTION_COLORS[PLAYER]! : FACTION_COLORS[2]!;

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.save();
    ctx.translate(cx, cy - 10 * u);
    ctx.scale(titleScale, titleScale);
    ctx.fillStyle = titleColor;
    ctx.globalAlpha = titleT;
    ctx.font = this.displayFont(12 * u);
    // Shrink-to-fit for narrow portrait screens ("DAILY CLEARED").
    const titleW = ctx.measureText(title).width;
    if (titleW > 0.9 * canvas.width)
      ctx.font = this.displayFont((12 * u * 0.9 * canvas.width) / titleW);
    ctx.fillText(title, 0, 0);
    ctx.restore();

    ctx.globalAlpha = subA;
    ctx.fillStyle = ink(0.85);
    ctx.font = this.pixelFont(4 * u, true);
    if (overlay.kind === "won") {
      if (overlay.stars) {
        ctx.fillStyle = GOLD_HEX;
        ctx.font = this.glyphFont(5 * u);
        ctx.fillText("★".repeat(overlay.stars) + "☆".repeat(3 - overlay.stars), cx, cy + 1 * u);
      }
      ctx.fillStyle = ink(0.85);
      ctx.font = this.pixelFont(4 * u, true);
      if (overlay.cores) {
        ctx.fillStyle = CORE_HEX;
        ctx.fillText(`+${overlay.cores} CORES`, cx, cy + 6.5 * u);
        ctx.fillStyle = ink(0.85);
      }
      ctx.fillText(`TAP FOR LEVEL ${state.cfg.level + 1}`, cx, cy + 12 * u);
      if (overlay.checkpoint) {
        // Gold, not CORE_HEX — next to "+N CORES" a cyan line reads as part of
        // the reward instead of its own banked thing.
        ctx.fillStyle = GOLD_HEX;
        ctx.fillText(`CHECKPOINT · LEVEL ${overlay.checkpoint}`, cx, cy + 17 * u);
        ctx.fillStyle = ink(0.85);
      }
    } else if (overlay.kind === "lost") {
      ctx.fillStyle = coral(0.9);
      ctx.font = this.glyphFont(4 * u);
      ctx.fillText(`♥ ${overlay.lives ?? 1} LEFT`, cx, cy + 2 * u);
      ctx.font = this.pixelFont(4 * u, true);
      ctx.fillStyle = ink(0.85);
      ctx.fillText("TAP TO RETRY", cx, cy + 8 * u);
    } else if (overlay.kind === "runover") {
      ctx.fillText(
        `REACHED LEVEL ${overlay.reachedLevel ?? state.cfg.level} · BEST ${overlay.bestLevel ?? 1}`,
        cx,
        cy + 2 * u,
      );
      // With a checkpoint banked the buttons below carry the prompt: a stray
      // tap must not pick a branch, so there's nothing to "tap for" here.
      if ((overlay.checkpointLevel ?? 1) > 1) ctx.fillText("PICK YOUR START", cx, cy + 8 * u);
      else ctx.fillText("TAP FOR NEW RUN", cx, cy + 8 * u);
    } else if (overlay.kind === "daily-won") {
      if (overlay.cores) {
        ctx.fillStyle = CORE_HEX;
        ctx.fillText(`+${overlay.cores} CORES`, cx, cy + 2 * u);
        ctx.fillStyle = ink(0.85);
      } else {
        ctx.fillText("ALREADY CLAIMED TODAY", cx, cy + 2 * u);
      }
      ctx.fillText("TAP TO RETURN TO YOUR RUN", cx, cy + 8 * u);
    } else {
      ctx.fillText("TAP TO RETURN TO YOUR RUN", cx, cy + 2 * u);
    }

    // Secondary buttons (world coords): UPGRADES / DAILY.
    if (overlay.kind === "won" || overlay.kind === "runover" || overlay.kind === "lost") {
      ctx.save();
      this.applyWorldTransform(now);
      this.applyMenuZoom(menuZoom(OVERLAY_BUTTONS_RECT));
      const btn = (r: { x: number; y: number; w: number; h: number }, label: string) => {
        ctx.globalAlpha = subA;
        ctx.fillStyle = ink(0.08);
        ctx.strokeStyle = ink(0.3);
        ctx.lineWidth = 0.4;
        this.roundRect(r.x, r.y, r.w, r.h, 1.5);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = ink(0.85);
        ctx.font = this.pixelFont(3.2, true);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2);
      };
      // Run-over choice sits a tier higher, inside the same transform so both
      // rows share one menuZoom (see RUNOVER_BUTTONS in fx.ts).
      if (overlay.kind === "runover" && (overlay.checkpointLevel ?? 1) > 1) {
        btn(RUNOVER_BUTTONS.checkpoint, `CHECKPOINT · L${overlay.checkpointLevel}`);
        btn(RUNOVER_BUTTONS.fresh, "START OVER");
      }
      btn(OVERLAY_BUTTONS.shop, "UPGRADES");
      btn(OVERLAY_BUTTONS.daily, "DAILY CHALLENGE");
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /** Upgrade shop panel — canvas-only, same pattern as the pause menu. */
  private drawShop(shop: ShopView): void {
    const { ctx, canvas } = this;
    ctx.save();
    ctx.fillStyle = backdropFill(0.8);
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.scale, this.scale * TILT_Y);
    this.applyMenuZoom(menuZoom(SHOP_MENU.panel));

    const p = SHOP_MENU.panel;
    ctx.fillStyle = BG_PANEL;
    ctx.strokeStyle = ink(0.15);
    ctx.lineWidth = 0.4;
    this.roundRect(p.x, p.y, p.w, p.h, 2.5);
    ctx.fill();
    ctx.stroke();

    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = ink(0.9);
    ctx.font = this.displayFont(4.5);
    ctx.fillText("UPGRADES", p.x + 4, p.y + 5);
    ctx.textAlign = "right";
    ctx.fillStyle = CORE_HEX;
    ctx.font = this.glyphFont(4);
    ctx.fillText(`◈ ${shop.cores}`, p.x + p.w - 4, p.y + 5);

    shop.rows.forEach((row, i) => {
      const y = SHOP_MENU.rowY0 + i * SHOP_MENU.rowGap;
      ctx.fillStyle = row.affordable ? "rgba(77,166,255,0.12)" : ink(0.05);
      ctx.strokeStyle = row.affordable ? "rgba(77,166,255,0.5)" : ink(0.15);
      this.roundRect(SHOP_MENU.rowX, y, SHOP_MENU.rowW, SHOP_MENU.rowH, 1.2);
      ctx.fill();
      ctx.stroke();
      ctx.textAlign = "left";
      ctx.fillStyle = ink(0.9);
      ctx.font = this.pixelFont(2.8, true);
      ctx.fillText(row.name, SHOP_MENU.rowX + 3, y + 2.8);
      ctx.fillStyle = ink(0.55);
      ctx.font = this.pixelFont(2.6);
      ctx.fillText(row.desc, SHOP_MENU.rowX + 3, y + 6);
      // Tier pips.
      for (let t = 0; t < row.maxTier; t++) {
        ctx.fillStyle = t < row.tier ? CORE_HEX : ink(0.15);
        ctx.fillRect(SHOP_MENU.rowX + 40 + t * 3, y + 3.4, 2, 2);
      }
      ctx.textAlign = "right";
      ctx.font = this.pixelFont(3, true);
      if (row.cost === null) {
        ctx.fillStyle = CORE_HEX;
        ctx.fillText("MAX", SHOP_MENU.rowX + SHOP_MENU.rowW - 3, y + SHOP_MENU.rowH / 2);
      } else {
        ctx.fillStyle = row.affordable ? CORE_HEX : ink(0.35);
        ctx.font = this.glyphFont(3);
        ctx.fillText(`◈ ${row.cost}`, SHOP_MENU.rowX + SHOP_MENU.rowW - 3, y + SHOP_MENU.rowH / 2);
      }
    });

    ctx.textAlign = "center";
    ctx.fillStyle = ink(0.7);
    ctx.font = this.pixelFont(3, true);
    ctx.fillText("CLOSE", SHOP_MENU.close.x + SHOP_MENU.close.w / 2, SHOP_MENU.close.y + 3);
    ctx.restore();
  }

  /** RESTART RUN's two-way choice — checkpoint or a clean climb from level 1. */
  private drawRestartMenu(view: RestartView): void {
    const { ctx, canvas } = this;
    ctx.save();
    ctx.fillStyle = backdropFill(0.8);
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.scale, this.scale * TILT_Y);
    this.applyMenuZoom(menuZoom(RESTART_MENU.panel));

    const p = RESTART_MENU.panel;
    ctx.fillStyle = BG_PANEL;
    ctx.strokeStyle = ink(0.15);
    ctx.lineWidth = 0.4;
    this.roundRect(p.x, p.y, p.w, p.h, 2.5);
    ctx.fill();
    ctx.stroke();

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = ink(0.85);
    ctx.font = this.displayFont(4.5);
    ctx.fillText("RESTART RUN", p.x + p.w / 2, p.y + 5.5);
    ctx.fillStyle = ink(0.5);
    ctx.font = this.pixelFont(2.8, true);
    ctx.fillText("WHERE FROM?", p.x + p.w / 2, p.y + 10.5);

    const button = (r: PanelButton, label: string, accent = false) => {
      ctx.fillStyle = accent ? "rgba(77,166,255,0.12)" : ink(0.08);
      ctx.strokeStyle = accent ? "rgba(77,166,255,0.5)" : ink(0.25);
      this.roundRect(r.x, r.y, r.w, r.h, 1.5);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = ink(0.9);
      ctx.font = this.pixelFont(3.4, true);
      ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2);
    };
    button(RESTART_MENU.checkpoint, `CHECKPOINT · L${view.checkpointLevel}`, true);
    button(RESTART_MENU.fresh, "START OVER · L1");
    ctx.fillStyle = ink(0.55);
    ctx.font = this.pixelFont(3, true);
    ctx.fillText(
      "CANCEL",
      RESTART_MENU.cancel.x + RESTART_MENU.cancel.w / 2,
      RESTART_MENU.cancel.y + RESTART_MENU.cancel.h / 2,
    );
    ctx.restore();
  }

  private drawPauseMenu(): void {
    const { ctx, canvas } = this;
    ctx.save();
    ctx.fillStyle = backdropFill(0.72);
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.scale, this.scale * TILT_Y);
    this.applyMenuZoom(menuZoom(PAUSE_MENU.panel));

    const p = PAUSE_MENU.panel;
    ctx.fillStyle = BG_PANEL;
    ctx.strokeStyle = ink(0.15);
    ctx.lineWidth = 0.4;
    this.roundRect(p.x, p.y, p.w, p.h, 2.5);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = ink(0.85);
    ctx.font = this.displayFont(4.5);
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
      ctx.font = this.pixelFont(3.4, true);
      ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2);
    };
    button(PAUSE_MENU.resume, "RESUME");
    button(PAUSE_MENU.restart, "RESTART RUN");
    button(PAUSE_MENU.mute, this.getMuted() ? "SOUND: OFF" : "SOUND: ON");
    button(PAUSE_MENU.shop, "UPGRADES");
    button(PAUSE_MENU.daily, "DAILY CHALLENGE");
    button(PAUSE_MENU.exit, "BACK TO PLAYHOUSE");
    ctx.restore();
  }

  /** Zoom a menu about the world center; hit helpers invert the same factor. */
  private applyMenuZoom(mz: number): void {
    if (mz === 1) return;
    const { ctx } = this;
    ctx.translate(WORLD_W / 2, WORLD_H / 2);
    ctx.scale(mz, mz);
    ctx.translate(-WORLD_W / 2, -WORLD_H / 2);
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

  /** App layer stores the winning capture position before calling finalBlow. */
  setFinalBlowFocus(x: number, y: number): void {
    this.pendingFocus = { x, y };
  }
}
