import { CREAM_HEX, INK_HEX } from "@/lib/colors";
import type { ToolColor } from "@/lib/tools";
import { drawHugoSprite, withAlpha } from "@/lib/hugo/sprite";
import { F, type BossState, type Entity, type GameState, type Zone } from "../sim/state";
import { ROOM_H, ROOM_PX_H, ROOM_PX_W, ROOM_W, T, TILE } from "../sim/rooms";
import { REGEN_GRACE, zoneContains } from "../sim/tick";
import { biomeFor, type Biome } from "./palette";
import { drawHero } from "./hero";
import { pulse, reducedMotion } from "./motion";
import {
  drawCard,
  drawCredits,
  drawHelp,
  drawPause,
  drawSettings,
  drawShop,
  drawTitle,
  type Card,
  type CreditsView,
  type GameFonts,
  type Hit,
  type ScreenCtx,
  type SettingsView,
  type ShopView,
} from "./screens";
import { computeTouchLayout, type TouchLayout } from "./ui-layout";
import { computeView, type SafeInsets, type ViewLayout } from "./view";

export type { GameFonts };

export type SceneId =
  | "title"
  | "opening"
  | "worldIntro"
  | "play"
  | "shop"
  | "bossIntro"
  | "clear"
  | "death"
  | "ending"
  | "credits";

export type TouchIndicator = {
  active: boolean;
  stick: { ox: number; oy: number; dx: number; dy: number } | null;
};

export type RenderFrame = {
  scene: SceneId;
  overlay: "pause" | "settings" | "help" | null;
  prev: GameState | null;
  curr: GameState | null;
  alpha: number;
  menuSel: number;
  accent: ToolColor; // world accent
  hugoAccent: string; // his persisted colour, hex
  card: Card | null;
  shop: ShopView | null;
  settings: SettingsView | null;
  credits: CreditsView | null;
  hasSave: boolean;
  worldsCleared: number;
  wipe: number; // 0..1 door-transition coverage
  touch: TouchIndicator;
  now: number;
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export class Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private fonts: GameFonts;
  private dpr = 1;
  private w = 0; // css px
  private h = 0;
  private ro: ResizeObserver;
  private safe: SafeInsets = { top: 0, right: 0, bottom: 0, left: 0 };
  private shade: HTMLCanvasElement; // offscreen darkness layer
  view: ViewLayout;
  touchLayout: TouchLayout | null = null;
  hits: Hit[] = [];
  private shakeMag = 0;
  private lastHp = -1;

  constructor(canvas: HTMLCanvasElement, fonts: GameFonts) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d context unavailable");
    this.ctx = ctx;
    this.fonts = fonts;
    this.shade = document.createElement("canvas");
    this.view = computeView(1, 1, this.safe);
    this.resize();
    // ResizeObserver on the canvas itself — also catches the mobile URL
    // bar collapsing, which resizes the container without a window resize.
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
  }

  destroy(): void {
    this.ro.disconnect();
  }

  private readSafeInsets(): void {
    const cs = getComputedStyle(document.documentElement);
    const read = (name: string) => {
      const v = parseFloat(cs.getPropertyValue(name));
      return Number.isFinite(v) ? v : 0;
    };
    this.safe = {
      top: read("--sat"),
      right: read("--sar"),
      bottom: read("--sab"),
      left: read("--sal"),
    };
  }

  private resize(): void {
    this.readSafeInsets();
    const rect = this.canvas.getBoundingClientRect();
    this.w = Math.max(1, rect.width);
    this.h = Math.max(1, rect.height);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.view = computeView(this.w, this.h, this.safe);
  }

  kick(mag: number): void {
    if (reducedMotion()) return;
    this.shakeMag = Math.min(6, this.shakeMag + mag);
  }

  render(frame: RenderFrame): void {
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = CREAM_HEX;
    ctx.fillRect(0, 0, this.w, this.h);
    this.hits = [];

    const s: ScreenCtx = { ctx, w: this.w, h: this.h, fonts: this.fonts, now: frame.now, hits: this.hits };
    const biome = biomeFor(frame.accent);
    const roomAccent =
      frame.curr && frame.curr.room
        ? biomeFor(roomAccentColor(frame) ?? frame.accent)
        : biome;

    const inWorld =
      frame.curr &&
      (frame.scene === "play" || frame.scene === "shop" || frame.scene === "bossIntro" || frame.scene === "clear" || frame.scene === "death");

    if (inWorld && frame.curr) {
      this.drawWorld(frame, roomAccent, s);
    }

    // Scene chrome.
    switch (frame.scene) {
      case "title":
        drawTitle(s, frame.menuSel, frame.hasSave, frame.hugoAccent, frame.worldsCleared);
        break;
      case "opening":
      case "worldIntro":
      case "bossIntro":
      case "clear":
      case "death":
      case "ending":
        if (frame.card) drawCard(s, frame.card, roomAccent.accent, true);
        break;
      case "shop":
        if (frame.shop) drawShop(s, frame.shop, roomAccent.accent);
        break;
      case "credits":
        if (frame.credits) drawCredits(s, frame.credits, frame.hugoAccent);
        break;
      case "play":
        break;
    }

    // Overlays over anything.
    if (frame.overlay === "pause") drawPause(s, frame.menuSel, roomAccent.accent);
    else if (frame.overlay === "settings" && frame.settings) drawSettings(s, frame.settings, roomAccent.accent);
    else if (frame.overlay === "help") drawHelp(s, roomAccent.accent);

    // Door-transition wipe: stepped vertical shutter, very Nattöppet.
    if (frame.wipe > 0) {
      ctx.fillStyle = CREAM_HEX;
      const bands = 8;
      const bandH = this.h / bands;
      for (let i = 0; i < bands; i++) {
        const wBand = this.w * Math.min(1, frame.wipe * 1.25 - (i % 2 === 0 ? 0 : 0.12));
        if (wBand <= 0) continue;
        ctx.fillRect(i % 2 === 0 ? 0 : this.w - wBand, i * bandH, wBand, bandH + 1);
      }
    }
  }

  // ---- the playfield --------------------------------------------------

  private drawWorld(frame: RenderFrame, biome: Biome, s: ScreenCtx): void {
    const { ctx } = this;
    const curr = frame.curr!;
    const prev = frame.prev ?? curr;
    const a = frame.alpha;
    const view = this.view;

    // Screen shake — render-only, decays on wall clock.
    if (curr.player.hp !== this.lastHp) {
      if (this.lastHp > curr.player.hp && this.lastHp >= 0) this.kick(4);
      this.lastHp = curr.player.hp;
    }
    this.shakeMag *= 0.88;
    const shakeX = this.shakeMag > 0.3 ? Math.sin(frame.now / 17) * this.shakeMag : 0;
    const shakeY = this.shakeMag > 0.3 ? Math.cos(frame.now / 23) * this.shakeMag : 0;

    ctx.save();
    ctx.translate(view.ox + shakeX, view.oy + shakeY);
    ctx.scale(view.scale, view.scale);

    this.drawRoom(curr, biome, frame.now);
    this.drawZones(curr, biome, frame.now);

    // Coins.
    for (const c of curr.room.coins) {
      const glint = !reducedMotion() && ((frame.now / 160) | 0) % 4 === (c.t % 4);
      ctx.fillStyle = glint ? INK_HEX : biome.accent;
      ctx.fillRect(Math.round(c.x) - 2, Math.round(c.y) - 2, 4, 4);
      ctx.fillStyle = withAlpha(CREAM_HEX, 0.5);
      ctx.fillRect(Math.round(c.x) - 1, Math.round(c.y) - 1, 1, 1);
    }

    // Entities (interpolated when both frames hold them).
    const prevById = new Map<number, Entity>();
    for (const e of prev.room.entities) prevById.set(e.id, e);
    for (const e of curr.room.entities) {
      const pe = prevById.get(e.id) ?? e;
      this.drawEnemy(curr, e, lerp(pe.x, e.x, a), lerp(pe.y, e.y, a), biome, frame.now);
    }

    // Boss.
    if (curr.boss && !curr.boss.dead) {
      const pb = prev.boss ?? curr.boss;
      this.drawBoss(curr, curr.boss, lerp(pb.x, curr.boss.x, a), lerp(pb.y, curr.boss.y, a), biome, frame.now);
    }

    // Merchant (shop rooms).
    if (curr.room.merchant) {
      this.drawMerchant(curr.room.merchant.x, curr.room.merchant.y, biome, frame.now);
    }

    // The hero.
    const hp = { x: lerp(prev.player.x, curr.player.x, a), y: lerp(prev.player.y, curr.player.y, a) };
    const moving = Math.abs(curr.player.x - prev.player.x) + Math.abs(curr.player.y - prev.player.y) > 0.15;
    drawHero(ctx, curr, Math.round(hp.x), Math.round(hp.y), frame.hugoAccent, moving);

    // Projectiles on top.
    for (const pr of curr.room.projectiles) {
      this.drawProjectile(pr.x, pr.y, pr.kind, pr.hostile, biome, frame.now, pr.t, pr.ttl);
    }

    // Darkness (the crypt) — an offscreen shade with the cone cut out.
    if (curr.room.mechanic === "dark") {
      this.drawDarkness(curr, hp.x, hp.y, biome);
    }

    ctx.restore();

    // Playfield frame.
    ctx.strokeStyle = withAlpha(INK_HEX, 0.16);
    ctx.strokeRect(view.ox - 0.5, view.oy - 0.5, ROOM_PX_W * view.scale + 1, ROOM_PX_H * view.scale + 1);

    this.drawHud(frame, biome, s);
    this.drawTouchControls(frame, biome, s);
  }

  private drawRoom(state: GameState, biome: Biome, now: number): void {
    const { ctx } = this;
    const tiles = state.room.tiles;
    const mech = state.room.mechanic;
    const lavaT = state.hazardT % 600;
    const floodZone = T.LAVA_A + state.hazardPhase;
    const warning = mech === "lava" && lavaT >= 420 && lavaT < 480;
    const flooded = mech === "lava" && lavaT >= 480;

    for (let ty = 0; ty < ROOM_H; ty++) {
      for (let tx = 0; tx < ROOM_W; tx++) {
        const tile = tiles[ty * ROOM_W + tx];
        const x = tx * TILE;
        const y = ty * TILE;
        const checker = (tx + ty) % 2 === 0;
        switch (tile) {
          case T.WALL: {
            ctx.fillStyle = biome.wall;
            ctx.fillRect(x, y, TILE, TILE);
            ctx.fillStyle = biome.wallTop;
            ctx.fillRect(x, y, TILE, 4);
            break;
          }
          case T.DOOR: {
            if (state.room.cleared) {
              ctx.fillStyle = biome.floor;
              ctx.fillRect(x, y, TILE, TILE);
              const glow = reducedMotion() ? 0.5 : 0.35 + 0.25 * (pulse(now, 1400) * 0.5 + 0.5);
              ctx.fillStyle = withAlpha(biome.accent, glow);
              ctx.fillRect(x + 4, y, TILE - 4, TILE);
            } else {
              ctx.fillStyle = biome.wall;
              ctx.fillRect(x, y, TILE, TILE);
              ctx.fillStyle = biome.accent;
              for (let i = 0; i < 3; i++) ctx.fillRect(x + 4 + i * 4, y + 2, 2, TILE - 4);
            }
            break;
          }
          case T.GRASS: {
            ctx.fillStyle = biome.floor;
            ctx.fillRect(x, y, TILE, TILE);
            ctx.fillStyle = biome.hazard;
            ctx.fillRect(x + 3, y + 6, 2, 6);
            ctx.fillRect(x + 8, y + 3, 2, 9);
            ctx.fillRect(x + 12, y + 7, 2, 5);
            break;
          }
          case T.THORN: {
            ctx.fillStyle = biome.floorAlt;
            ctx.fillRect(x, y, TILE, TILE);
            ctx.fillStyle = biome.deco;
            ctx.fillRect(x + 2, y + 2, 3, 3);
            ctx.fillRect(x + 9, y + 5, 3, 3);
            ctx.fillRect(x + 4, y + 10, 3, 3);
            ctx.fillRect(x + 11, y + 11, 3, 3);
            break;
          }
          case T.CUR_R:
          case T.CUR_L:
          case T.CUR_U:
          case T.CUR_D: {
            ctx.fillStyle = biome.hazard;
            ctx.fillRect(x, y, TILE, TILE);
            // Drifting flow dashes.
            const drift = reducedMotion() ? 0 : ((now / 60) | 0) % TILE;
            ctx.fillStyle = withAlpha(INK_HEX, 0.22);
            if (tile === T.CUR_R) ctx.fillRect(x + ((drift + tx * 5) % TILE), y + (checker ? 5 : 10), 5, 1);
            else if (tile === T.CUR_L) ctx.fillRect(x + TILE - ((drift + tx * 5) % TILE) - 5, y + (checker ? 5 : 10), 5, 1);
            else if (tile === T.CUR_D) ctx.fillRect(x + (checker ? 5 : 10), y + ((drift + ty * 5) % TILE), 1, 5);
            else ctx.fillRect(x + (checker ? 5 : 10), y + TILE - ((drift + ty * 5) % TILE) - 5, 1, 5);
            break;
          }
          case T.BOG: {
            ctx.fillStyle = biome.hazard;
            ctx.fillRect(x, y, TILE, TILE);
            ctx.fillStyle = withAlpha(CREAM_HEX, 0.25);
            if (checker) ctx.fillRect(x + 4, y + 4, 3, 2);
            else ctx.fillRect(x + 9, y + 9, 3, 2);
            break;
          }
          case T.LAVA_A:
          case T.LAVA_B:
          case T.LAVA_C: {
            const mine = tile === floodZone;
            if (flooded && mine) {
              ctx.fillStyle = biome.accent;
              ctx.fillRect(x, y, TILE, TILE);
              ctx.fillStyle = withAlpha(INK_HEX, 0.5);
              if ((tx + ty + ((now / 200) | 0)) % 3 === 0) ctx.fillRect(x + 6, y + 6, 3, 3);
            } else {
              ctx.fillStyle = checker ? biome.floor : biome.floorAlt;
              ctx.fillRect(x, y, TILE, TILE);
              if (warning && mine) {
                const on = reducedMotion() || ((now / 180) | 0) % 2 === 0;
                if (on && (tx + ty) % 2 === 0) {
                  ctx.fillStyle = withAlpha(biome.accent, 0.35);
                  ctx.fillRect(x, y, TILE, TILE);
                }
              }
            }
            break;
          }
          case T.BRAZIER: {
            ctx.fillStyle = biome.floor;
            ctx.fillRect(x, y, TILE, TILE);
            ctx.fillStyle = biome.deco;
            ctx.fillRect(x + 5, y + 8, 6, 6);
            ctx.fillStyle = biome.accent;
            ctx.fillRect(x + 6, y + 4, 4, 4);
            break;
          }
          case T.POT: {
            ctx.fillStyle = biome.floor;
            ctx.fillRect(x, y, TILE, TILE);
            ctx.fillStyle = biome.deco;
            ctx.fillRect(x + 4, y + 5, 8, 9);
            ctx.fillStyle = biome.wallTop;
            ctx.fillRect(x + 5, y + 3, 6, 3);
            break;
          }
          default: {
            ctx.fillStyle = checker ? biome.floor : biome.floorAlt;
            ctx.fillRect(x, y, TILE, TILE);
          }
        }
      }
    }
  }

  private drawZones(state: GameState, biome: Biome, now: number): void {
    const { ctx } = this;
    for (const z of state.room.zones) {
      const firing = state.tick >= z.fireAt;
      const lead = z.fireAt - state.tick;
      const total = Math.max(1, z.fireAt - (z.fireAt - 60));
      void total;
      if (!firing) {
        // Warning: dithered accent outline + three countdown pips.
        const alpha = reducedMotion() ? 0.5 : 0.35 + 0.25 * (pulse(now, 400) * 0.5 + 0.5);
        ctx.strokeStyle = withAlpha(biome.accent, alpha);
        ctx.fillStyle = withAlpha(biome.accent, 0.12);
        ctx.lineWidth = 1;
        this.traceZone(z);
        ctx.fill();
        ctx.stroke();
        const pips = Math.min(3, Math.ceil(lead / 20));
        ctx.fillStyle = biome.accent;
        const cx = z.shape === "line" ? (z.x + z.x2) / 2 : z.shape === "rect" ? (z.x + z.x2) / 2 : z.x;
        const cy = z.shape === "line" ? (z.y + z.y2) / 2 : z.shape === "rect" ? (z.y + z.y2) / 2 : z.y;
        for (let i = 0; i < pips; i++) ctx.fillRect(cx - 5 + i * 4, cy - 1, 2, 2);
      } else {
        ctx.fillStyle = z.kind === "poison" ? withAlpha(biome.hazard, 0.75) : withAlpha(biome.accent, z.kind === "blast" ? 0.5 : 0.8);
        this.traceZone(z);
        ctx.fill();
      }
    }
  }

  private traceZone(z: Zone): void {
    const { ctx } = this;
    ctx.beginPath();
    if (z.shape === "circle") {
      ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2);
    } else if (z.shape === "rect") {
      ctx.rect(z.x, z.y, z.x2 - z.x, z.y2 - z.y);
    } else if (z.shape === "ring") {
      // Ring with two safe notches — draw as arc segments.
      for (const [from, to] of ringArcs(z)) {
        ctx.moveTo(z.x + Math.cos(from) * z.r, z.y + Math.sin(from) * z.r);
        ctx.arc(z.x, z.y, z.r + z.w / 2, from, to);
        ctx.arc(z.x, z.y, Math.max(1, z.r - z.w / 2), to, from, true);
      }
    } else {
      const ang = Math.atan2(z.y2 - z.y, z.x2 - z.x);
      const nx = Math.cos(ang + Math.PI / 2) * (z.w / 2);
      const ny = Math.sin(ang + Math.PI / 2) * (z.w / 2);
      ctx.moveTo(z.x + nx, z.y + ny);
      ctx.lineTo(z.x2 + nx, z.y2 + ny);
      ctx.lineTo(z.x2 - nx, z.y2 - ny);
      ctx.lineTo(z.x - nx, z.y - ny);
      ctx.closePath();
    }
  }

  private drawProjectile(x: number, y: number, kind: string, hostile: boolean, biome: Biome, now: number, t: number, ttl: number): void {
    const { ctx } = this;
    const rx = Math.round(x);
    const ry = Math.round(y);
    if (kind === "dagger" || kind === "riposte" || kind === "beam") {
      ctx.fillStyle = INK_HEX;
      ctx.fillRect(rx - 2, ry - 1, 4, 2);
      if (kind === "beam") {
        ctx.fillStyle = withAlpha(biome.accent, 0.7);
        ctx.fillRect(rx - 4, ry - 2, 8, 4);
      }
    } else if (kind === "bomb") {
      const blink = (ttl - t < 20 && ((now / 90) | 0) % 2 === 0) || (reducedMotion() && ttl - t < 20);
      ctx.fillStyle = blink ? INK_HEX : biome.deco;
      ctx.fillRect(rx - 3, ry - 3, 6, 6);
      ctx.fillStyle = biome.accent;
      ctx.fillRect(rx - 1, ry - 5, 2, 2);
    } else if (kind === "wisp") {
      ctx.fillStyle = withAlpha(biome.accent, 0.85);
      ctx.fillRect(rx - 2, ry - 2, 4, 4);
      ctx.fillStyle = withAlpha(INK_HEX, 0.5);
      ctx.fillRect(rx - 1, ry - 1, 2, 2);
    } else if (kind === "fakecoin") {
      ctx.fillStyle = biome.accent;
      ctx.fillRect(rx - 2, ry - 2, 4, 4);
    } else {
      ctx.fillStyle = hostile ? biome.accent : INK_HEX;
      ctx.beginPath();
      ctx.arc(rx, ry, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawEnemy(state: GameState, e: Entity, x: number, y: number, biome: Biome, now: number): void {
    const { ctx } = this;
    const rx = Math.round(x);
    const ry = Math.round(y);
    const telegraphing = e.mode === "telegraph" || e.mode === "windup" || e.mode === "dartTele" || e.mode === "fuse";
    const jitter = telegraphing && !reducedMotion() ? Math.round(Math.sin(now / 25) * 1.5) : 0;
    const flash = e.hitFlash > 0;
    const phasing = e.flags & F.PHASEDARK && state.room.mechanic === "dark";
    const body = flash ? INK_HEX : telegraphing ? biome.accent : biome.deco;
    const mound = e.flags & F.BURROW && (e.mode === "burrow" || e.mode === "idle");

    ctx.save();
    if (phasing) ctx.globalAlpha = 0.4;
    if (e.spawnGrace > 0) ctx.globalAlpha = 0.55;

    if (mound) {
      // A travelling bulge in the sand.
      ctx.fillStyle = biome.wallTop;
      ctx.fillRect(rx - 6 + jitter, ry - 2, 12, 4);
      ctx.fillRect(rx - 4 + jitter, ry - 4, 8, 2);
      ctx.restore();
      return;
    }

    const r = e.r;
    switch (e.arch) {
      case "chaser":
        ctx.fillStyle = body;
        ctx.fillRect(rx - r + jitter, ry - r + 2, r * 2, r * 2 - 2);
        ctx.fillStyle = flash ? CREAM_HEX : INK_HEX;
        ctx.fillRect(rx - 3 + jitter, ry - 2, 2, 2);
        ctx.fillRect(rx + 1 + jitter, ry - 2, 2, 2);
        break;
      case "shooter": {
        ctx.fillStyle = body;
        ctx.fillRect(rx - r, ry - r + 3, r * 2, r * 2 - 3);
        const bx = Math.round(Math.cos(e.faceAng) * (r + 2));
        const by = Math.round(Math.sin(e.faceAng) * (r + 2));
        ctx.fillStyle = telegraphing ? INK_HEX : biome.wallTop;
        ctx.fillRect(rx + bx - 1, ry + by - 1, 3, 3);
        break;
      }
      case "charger":
        ctx.fillStyle = body;
        ctx.fillRect(rx - r + jitter, ry - r + 2, r * 2, r * 2 - 3);
        ctx.fillStyle = flash ? CREAM_HEX : INK_HEX;
        ctx.fillRect(rx - r + jitter, ry - r, 3, 3);
        ctx.fillRect(rx + r - 3 + jitter, ry - r, 3, 3);
        break;
      case "splitter":
        ctx.fillStyle = body;
        ctx.beginPath();
        ctx.arc(rx, ry, r + (reducedMotion() ? 0 : Math.sin(now / 200) * 1), 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = withAlpha(CREAM_HEX, 0.4);
        ctx.fillRect(rx - 2, ry - 2, 2, 2);
        ctx.fillRect(rx + 1, ry + 1, 2, 2);
        break;
      case "orbiter":
        ctx.fillStyle = body;
        ctx.fillRect(rx - 2, ry - r, 4, r * 2);
        ctx.fillRect(rx - r, ry - 2, r * 2, 4);
        break;
      case "shielded": {
        ctx.fillStyle = body;
        ctx.fillRect(rx - r + 2, ry - r + 2, (r - 2) * 2, (r - 2) * 2);
        if (e.shieldHp > 0) {
          const sx = Math.round(Math.cos(e.faceAng) * (r - 1));
          const sy = Math.round(Math.sin(e.faceAng) * (r - 1));
          ctx.fillStyle = e.flags & F.HOTSHIELD ? biome.accent : INK_HEX;
          const vertical = Math.abs(Math.cos(e.faceAng)) > 0.5;
          if (vertical) ctx.fillRect(rx + sx - 1, ry - r, 3, r * 2);
          else ctx.fillRect(rx - r, ry + sy - 1, r * 2, 3);
        }
        break;
      }
      case "spawner":
        ctx.fillStyle = body;
        ctx.fillRect(rx - r, ry - r + 4, r * 2, r * 2 - 4);
        ctx.fillStyle = CREAM_HEX;
        ctx.fillRect(rx - 3, ry - 1, 6, 4);
        break;
      case "exploder": {
        const fusing = e.mode === "fuse";
        const blink = fusing && (reducedMotion() ? true : ((now / 80) | 0) % 2 === 0);
        ctx.fillStyle = blink ? INK_HEX : body;
        ctx.beginPath();
        ctx.arc(rx + jitter, ry, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = biome.accent;
        ctx.fillRect(rx - 1 + jitter, ry - r - 3, 2, 3);
        break;
      }
      case "healer": {
        ctx.fillStyle = body;
        ctx.fillRect(rx - r + 2, ry - r + 2, (r - 2) * 2, (r - 2) * 2);
        ctx.fillStyle = INK_HEX;
        ctx.fillRect(rx - 1, ry - 4, 2, 8);
        ctx.fillRect(rx - 4, ry - 1, 8, 2);
        // Tether beam — the "kill me first" arrow.
        const target = state.room.entities.find((o) => o.id === e.mem[0]);
        if (target) {
          ctx.strokeStyle = withAlpha(biome.accent, 0.6);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(rx, ry);
          ctx.lineTo(target.x, target.y);
          ctx.stroke();
        }
        break;
      }
    }

    // Telegraph "!"
    if (telegraphing) {
      ctx.fillStyle = biome.accent;
      ctx.fillRect(rx - 1, ry - e.r - 9, 2, 5);
      ctx.fillRect(rx - 1, ry - e.r - 3, 2, 2);
    }
    ctx.restore();
  }

  private drawMerchant(x: number, y: number, biome: Biome, now: number): void {
    const { ctx } = this;
    const rx = Math.round(x);
    const ry = Math.round(y);
    // VÄXEL: a squat change machine on casters. Coin-slot eyes.
    ctx.fillStyle = "#262b47";
    ctx.fillRect(rx - 9, ry - 12, 18, 22);
    ctx.fillStyle = biome.accent;
    ctx.fillRect(rx - 9, ry - 12, 18, 3);
    ctx.fillStyle = INK_HEX;
    ctx.fillRect(rx - 5, ry - 6, 2, 4);
    ctx.fillRect(rx + 3, ry - 6, 2, 4);
    ctx.fillStyle = "#12141f";
    ctx.fillRect(rx - 6, ry + 2, 12, 4);
    // Casters.
    ctx.fillStyle = "#12141f";
    ctx.fillRect(rx - 8, ry + 10, 4, 3);
    ctx.fillRect(rx + 4, ry + 10, 4, 3);
    // The idle bounce of a machine pretending not to watch you.
    if (!reducedMotion() && ((now / 800) | 0) % 4 === 0) {
      ctx.fillStyle = biome.accent;
      ctx.fillRect(rx + 7, ry - 16, 2, 2);
    }
  }

  // ---- bosses ---------------------------------------------------------

  private drawBoss(state: GameState, b: BossState, x: number, y: number, biome: Biome, now: number): void {
    const { ctx } = this;
    const rx = Math.round(x);
    const ry = Math.round(y);
    const flash = b.hitFlash > 2;
    const tele = b.mode === "rattle" || b.mode.endsWith("Tele") || b.mode === "crouch" || b.mode === "slam" || b.mode === "aim" || b.mode === "spray";
    const jit = tele && !reducedMotion() ? Math.round(Math.sin(now / 22) * 1.5) : 0;
    const body = flash ? INK_HEX : "#262b47";
    const dark = "#12141f";

    ctx.save();
    switch (b.kind) {
      case "cartking": {
        for (let i = 0; i < 3; i++) {
          ctx.fillStyle = i === 1 ? dark : body;
          ctx.fillRect(rx - 13 + jit, ry - 14 + i * 9, 26, 8);
          ctx.fillStyle = withAlpha(INK_HEX, 0.25);
          ctx.fillRect(rx - 11 + jit, ry - 12 + i * 9, 22, 1);
        }
        ctx.fillStyle = biome.accent;
        ctx.fillRect(rx + (Math.cos(b.faceAng) > 0 ? 8 : -12) + jit, ry - 10, 4, 4);
        ctx.fillStyle = dark;
        ctx.fillRect(rx - 12, ry + 13, 5, 3);
        ctx.fillRect(rx + 7, ry + 13, 5, 3);
        if (b.mode === "stun" && !reducedMotion()) {
          ctx.fillStyle = INK_HEX;
          ctx.fillRect(rx - 16 + ((now / 120) | 0) % 8, ry - 20, 2, 2);
        }
        break;
      }
      case "stump": {
        ctx.fillStyle = body;
        ctx.fillRect(rx - 16, ry - 12, 32, 26);
        ctx.fillStyle = dark;
        ctx.fillRect(rx - 16, ry + 8, 32, 6);
        ctx.strokeStyle = withAlpha(INK_HEX, 0.3);
        for (let i = 1; i <= 3; i++) {
          ctx.strokeRect(rx - 4 * i, ry - 3 - i, 8 * i, 6 + i);
        }
        ctx.fillStyle = biome.hazard;
        ctx.fillRect(rx - 14, ry - 14, 6, 3);
        ctx.fillRect(rx + 6, ry - 15, 8, 4);
        ctx.fillStyle = flash ? CREAM_HEX : biome.accent;
        ctx.fillRect(rx - 6, ry - 4, 3, 3);
        ctx.fillRect(rx + 3, ry - 4, 3, 3);
        break;
      }
      case "heron": {
        // Long-legged harbormaster; struts the dock.
        ctx.fillStyle = body;
        ctx.fillRect(rx - 8, ry - 4, 16, 10); // body
        ctx.fillStyle = dark;
        ctx.fillRect(rx - 2, ry + 6, 2, 8);
        ctx.fillRect(rx + 3, ry + 6, 2, 8);
        const dir = Math.cos(b.faceAng) >= 0 ? 1 : -1;
        ctx.fillStyle = body;
        ctx.fillRect(rx + dir * 6, ry - 12, 3, 9); // neck
        ctx.fillRect(rx + dir * 4, ry - 16, 8, 5); // head
        ctx.fillStyle = biome.accent;
        ctx.fillRect(rx + dir * 4, ry - 18, 8, 3); // the cap
        ctx.fillStyle = INK_HEX;
        ctx.fillRect(rx + dir * 10, ry - 14, 4, 2); // beak
        break;
      }
      case "toad": {
        ctx.fillStyle = body;
        ctx.fillRect(rx - 15 + jit, ry - 8, 30, 20);
        ctx.fillRect(rx - 11 + jit, ry - 13, 22, 6);
        ctx.fillStyle = biome.hazard;
        ctx.fillRect(rx - 12 + jit, ry - 2, 4, 3);
        ctx.fillRect(rx + 6 + jit, ry + 2, 5, 3);
        ctx.fillRect(rx - 3 + jit, ry + 6, 4, 3);
        ctx.fillStyle = flash ? CREAM_HEX : INK_HEX;
        ctx.fillRect(rx - 7 + jit, ry - 12, 3, 3);
        ctx.fillRect(rx + 4 + jit, ry - 12, 3, 3);
        ctx.strokeStyle = INK_HEX;
        ctx.strokeRect(rx + 3 + jit, ry - 13, 5, 5); // monocle
        break;
      }
      case "zamboni": {
        ctx.fillStyle = body;
        ctx.fillRect(rx - 20, ry - 10, 40, 20);
        ctx.fillStyle = dark;
        ctx.fillRect(rx - 20, ry + 6, 40, 4);
        const dir = Math.cos(b.faceAng) >= 0 ? 1 : -1;
        ctx.fillStyle = biome.accent;
        ctx.fillRect(rx + dir * 10 - 4, ry - 6, 8, 6); // windshield eye
        ctx.fillStyle = flash ? INK_HEX : biome.hazard;
        const spin = reducedMotion() ? 0 : ((now / 90) | 0) % 3;
        ctx.fillRect(rx - dir * 18, ry - 8 + spin * 5, 6, 4); // brush
        if (b.mode === "vent") {
          ctx.fillStyle = withAlpha(INK_HEX, 0.5);
          ctx.fillRect(rx - 4, ry - 16, 3, 4);
          ctx.fillRect(rx + 2, ry - 19, 3, 5);
        }
        break;
      }
      case "foreman": {
        ctx.fillStyle = body;
        ctx.fillRect(rx - 14 + jit, ry - 16, 28, 30);
        ctx.fillStyle = biome.accent; // hi-vis stripe
        ctx.fillRect(rx - 14 + jit, ry - 4, 28, 5);
        ctx.fillStyle = dark;
        ctx.fillRect(rx - 14 + jit, ry - 16, 28, 4);
        ctx.fillStyle = flash ? CREAM_HEX : biome.accent;
        ctx.fillRect(rx - 7 + jit, ry - 10, 4, 3);
        ctx.fillRect(rx + 3 + jit, ry - 10, 4, 3);
        ctx.fillStyle = INK_HEX; // the clipboard
        ctx.fillRect(rx + 15 + jit, ry - 2, 5, 7);
        break;
      }
      case "antlion": {
        if (b.mode === "mound" || b.mode === "idle") {
          ctx.fillStyle = biome.wallTop;
          const fastPulse = reducedMotion() ? 0 : Math.round(Math.sin(now / 90) * 1.5);
          ctx.fillRect(rx - 9, ry - 3 + fastPulse * 0, 18, 6);
          ctx.fillRect(rx - 6, ry - 6 - fastPulse, 12, 4);
          if (b.phase === 2) {
            // Decoys: slower pulse — the readable tell.
            for (const off of [[-46, 22], [40, -18]]) {
              ctx.fillStyle = biome.wallTop;
              ctx.fillRect(rx + off[0] - 8, ry + off[1] - 2, 16, 5);
            }
          }
        } else {
          ctx.fillStyle = body;
          ctx.fillRect(rx - 15 + jit, ry - 8, 30, 18);
          ctx.fillStyle = dark;
          ctx.fillRect(rx - 17 + jit, ry - 2, 6, 8); // mandible
          ctx.fillRect(rx + 11 + jit, ry - 2, 6, 8);
          ctx.strokeStyle = INK_HEX; // reading glasses
          ctx.strokeRect(rx - 7 + jit, ry - 6, 5, 4);
          ctx.strokeRect(rx + 2 + jit, ry - 6, 5, 4);
        }
        break;
      }
      case "archivist": {
        ctx.globalAlpha = b.vulnerable ? 1 : 0.35;
        ctx.fillStyle = flash ? INK_HEX : body;
        ctx.fillRect(rx - 9, ry - 12, 18, 20);
        ctx.fillStyle = dark;
        ctx.fillRect(rx - 9, ry - 12, 18, 6); // hood
        ctx.fillStyle = b.vulnerable ? biome.accent : withAlpha(biome.accent, 0.6);
        ctx.fillRect(rx - 4, ry - 8, 3, 2);
        ctx.fillRect(rx + 2, ry - 8, 3, 2);
        // Orbiting books.
        const orb = reducedMotion() ? 0 : now / 600;
        for (let i = 0; i < 3; i++) {
          const a = orb + (i * Math.PI * 2) / 3;
          ctx.fillStyle = biome.deco;
          ctx.fillRect(rx + Math.round(Math.cos(a) * 16) - 2, ry + Math.round(Math.sin(a) * 12) - 1, 5, 3);
        }
        break;
      }
      case "playtester": {
        // You, inverted. One sprite module — the rule holds even for him.
        const strobing = b.mem[4] > 0 && b.t < b.mem[4];
        const inv = strobing && !reducedMotion() && ((now / 120) | 0) % 2 === 0 ? biome.accent : "#1a1f33";
        drawHugoSprite(ctx, {
          x: rx,
          y: ry,
          px: 1,
          accent: flash ? INK_HEX : inv,
          eye: { open: true, wide: false, dx: Math.cos(b.faceAng) > 0.3 ? 1 : Math.cos(b.faceAng) < -0.3 ? -1 : 0, dy: 0 },
          feet: (((state.tick >> 3) & 1) as 0 | 1),
          scaleX: Math.cos(b.faceAng) < -0.2 ? -1 : 1,
        });
        if (strobing && reducedMotion()) {
          ctx.strokeStyle = biome.accent;
          ctx.strokeRect(rx - 9, ry - 9, 18, 18);
        }
        if (b.mode === "parry") {
          ctx.strokeStyle = INK_HEX;
          ctx.strokeRect(rx - 11, ry - 11, 22, 22);
        }
        break;
      }
      case "proprietor": {
        // The cabinet itself. The biggest sprite in the game.
        const chan = b.phase === 3 ? ((state.tick / 300) | 0) % 8 : -1;
        const CH: ToolColor[] = ["orange", "green", "blue", "yellow", "teal", "tomato", "orange", "purple"];
        const marquee = chan >= 0 ? biomeFor(CH[chan]).accent : biome.accent;
        ctx.fillStyle = flash ? INK_HEX : "#1e2136";
        ctx.fillRect(rx - 24, ry - 32, 48, 64);
        ctx.fillStyle = "#12141f";
        ctx.fillRect(rx + 18, ry - 32, 6, 64);
        ctx.fillStyle = marquee;
        ctx.fillRect(rx - 21, ry - 29, 42, 7);
        ctx.fillStyle = "#07080f";
        ctx.fillRect(rx - 19, ry - 18, 38, 26);
        // The face: two eyes and a mouth that knows something.
        const windowGlow = b.vulnerable ? biomeFor("green").accent : marquee;
        ctx.fillStyle = windowGlow;
        ctx.fillRect(rx - 12, ry - 12, 6, 6);
        ctx.fillRect(rx + 6, ry - 12, 6, 6);
        ctx.fillRect(rx - 8, ry - 1, 16, 3);
        ctx.fillStyle = "#262b47";
        ctx.fillRect(rx - 21, ry + 12, 42, 8);
        ctx.fillStyle = biome.accent;
        ctx.fillRect(rx - 14, ry + 14, 4, 4);
        ctx.fillStyle = biomeFor("blue").accent;
        ctx.fillRect(rx - 4, ry + 14, 4, 4);
        break;
      }
    }
    ctx.restore();

    // Boss telegraph "!".
    if (tele) {
      ctx.fillStyle = biome.accent;
      ctx.fillRect(rx - 1, ry - b.r - 12, 3, 7);
      ctx.fillRect(rx - 1, ry - b.r - 3, 3, 3);
    }
  }

  private drawDarkness(state: GameState, hx: number, hy: number, biome: Biome): void {
    const { ctx } = this;
    const sc = this.shade;
    if (sc.width !== ROOM_PX_W || sc.height !== ROOM_PX_H) {
      sc.width = ROOM_PX_W;
      sc.height = ROOM_PX_H;
    }
    const sctx = sc.getContext("2d")!;
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.globalCompositeOperation = "source-over";
    sctx.fillStyle = "rgba(4,5,10,0.87)";
    sctx.fillRect(0, 0, ROOM_PX_W, ROOM_PX_H);

    sctx.globalCompositeOperation = "destination-out";
    const p = state.player;
    const lit = state.tick < p.flashUntil;
    const wide = p.gear.includes("oil");
    const range = lit ? 200 : wide ? 150 : 110;
    const half = lit ? Math.PI : wide ? 0.86 : 0.66;

    // The cone.
    const g = sctx.createRadialGradient(hx, hy, 6, hx, hy, range);
    g.addColorStop(0, "rgba(0,0,0,1)");
    g.addColorStop(0.75, "rgba(0,0,0,0.9)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    sctx.fillStyle = g;
    sctx.beginPath();
    sctx.moveTo(hx, hy);
    sctx.arc(hx, hy, range, p.faceAng - half, p.faceAng + half);
    sctx.closePath();
    sctx.fill();
    // A small glow so Hugo is never swallowed.
    sctx.beginPath();
    sctx.arc(hx, hy, 22, 0, Math.PI * 2);
    sctx.fill();
    // Braziers.
    for (let ty = 0; ty < ROOM_H; ty++) {
      for (let tx = 0; tx < ROOM_W; tx++) {
        if (state.room.tiles[ty * ROOM_W + tx] !== T.BRAZIER) continue;
        const bg = sctx.createRadialGradient(tx * TILE + 8, ty * TILE + 8, 4, tx * TILE + 8, ty * TILE + 8, 44);
        bg.addColorStop(0, "rgba(0,0,0,1)");
        bg.addColorStop(1, "rgba(0,0,0,0)");
        sctx.fillStyle = bg;
        sctx.beginPath();
        sctx.arc(tx * TILE + 8, ty * TILE + 8, 44, 0, Math.PI * 2);
        sctx.fill();
      }
    }
    // Candle-head shooters carry their own glow.
    for (const e of state.room.entities) {
      if (e.kind !== "candle") continue;
      const cg = sctx.createRadialGradient(e.x, e.y, 3, e.x, e.y, 26);
      cg.addColorStop(0, "rgba(0,0,0,0.9)");
      cg.addColorStop(1, "rgba(0,0,0,0)");
      sctx.fillStyle = cg;
      sctx.beginPath();
      sctx.arc(e.x, e.y, 26, 0, Math.PI * 2);
      sctx.fill();
    }
    void biome;
    ctx.drawImage(sc, 0, 0);
  }

  // ---- HUD ------------------------------------------------------------

  private drawHud(frame: RenderFrame, biome: Biome, s: ScreenCtx): void {
    const { ctx } = this;
    const curr = frame.curr!;
    const view = this.view;
    const y = view.safe.top + view.hudH / 2 + 2;
    const left = Math.max(view.safe.left + 10, view.ox);

    // Hearts (half-heart resolution). The heart currently refilling
    // pulses while out-of-combat regen is armed — recovery should read
    // on screen, not surprise you. Steady under reduced motion.
    const hearts = curr.player.maxHp / 2;
    const regenArmed =
      curr.player.hp > 0 &&
      curr.player.hp < curr.player.maxHp &&
      curr.tick - curr.player.lastHurtAt >= REGEN_GRACE;
    const fillingIdx = Math.floor(curr.player.hp / 2);
    for (let i = 0; i < hearts; i++) {
      const hx = left + i * 13;
      const fill = curr.player.hp - i * 2;
      drawHeart(ctx, hx, y - 4, fill >= 2 ? "full" : fill === 1 ? "half" : "empty", biome.accent);
      if (regenArmed && i === fillingIdx) {
        const a = reducedMotion() ? 0.4 : 0.25 + 0.25 * (pulse(frame.now, 900) * 0.5 + 0.5);
        ctx.fillStyle = withAlpha(biome.accent, a);
        ctx.fillRect(hx, y - 4, 9, 8);
      }
    }
    // Flasks.
    for (let i = 0; i < curr.player.flasks; i++) {
      ctx.fillStyle = biome.accent;
      ctx.fillRect(left + i * 8, y + 8, 5, 7);
      ctx.fillStyle = INK_HEX;
      ctx.fillRect(left + i * 8 + 1, y + 6, 3, 2);
    }

    // Coins, right.
    const right = Math.min(this.w - view.safe.right - 10, view.ox + ROOM_PX_W * view.scale);
    ctx.font = `12px ${this.fonts.pixel}`;
    ctx.fillStyle = INK_HEX;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(`${curr.player.coins}¢`, right - 40, y);
    ctx.fillStyle = biome.accent;
    ctx.fillRect(right - 34, y - 3, 6, 6);

    // World tag, centre.
    ctx.textAlign = "center";
    ctx.fillStyle = "#8e97a8";
    ctx.font = `10px ${this.fonts.pixel}`;
    ctx.fillText(`ADVENTURE ${curr.world}`, this.w / 2, y - 7);

    // Boss bar.
    const b = curr.boss;
    if (b && !b.dead) {
      const bw = Math.min(300, this.w * 0.5);
      const bx = this.w / 2 - bw / 2;
      const by = y + 4;
      ctx.fillStyle = "#1e2136";
      ctx.fillRect(bx, by, bw, 7);
      ctx.fillStyle = b.vulnerable ? biome.accent : withAlpha(biome.accent, 0.45);
      ctx.fillRect(bx + 1, by + 1, (bw - 2) * Math.max(0, b.hp / b.maxHp), 5);
      // Phase ticks.
      const def = b.maxHp;
      const marks = b.kind === "proprietor" ? [280 / 430, 140 / 430] : [0.5];
      ctx.fillStyle = CREAM_HEX;
      for (const m of marks) ctx.fillRect(bx + (bw - 2) * m, by, 1, 7);
      void def;
    }

    // Verb cooldown pips, desktop, bottom-left of the playfield.
    if (!frame.touch.active && frame.scene === "play") {
      const verbs = ["dagger", "parry", "dash", "whirl", "bomb", "flash", "overclock"] as const;
      const keys: Record<string, string> = { dagger: "q", parry: "e", dash: "r", whirl: "f", bomb: "g", flash: "v", overclock: "x" };
      let i = 0;
      for (const v of verbs) {
        if (!curr.player.gear.includes(v)) continue;
        const vx = view.ox + 8 + i * 30;
        const vy = view.oy + ROOM_PX_H * view.scale + 14;
        if (vy > this.h - 8) break;
        const readyAt = curr.player.cool[v] ?? 0;
        const ready = curr.tick >= readyAt;
        ctx.fillStyle = ready ? biome.accent : "#1e2136";
        ctx.fillRect(vx, vy - 8, 22, 16);
        ctx.fillStyle = ready ? CREAM_HEX : "#8e97a8";
        ctx.font = `9px ${this.fonts.pixel}`;
        ctx.textAlign = "center";
        ctx.fillText(keys[v], vx + 11, vy + 1);
        i++;
      }
    }
    void s;
  }

  // ---- touch controls -------------------------------------------------

  private drawTouchControls(frame: RenderFrame, biome: Biome, s: ScreenCtx): void {
    if (!frame.touch.active || frame.scene !== "play") {
      this.touchLayout = null;
      return;
    }
    const { ctx } = this;
    const curr = frame.curr!;
    const layout = computeTouchLayout(this.view, curr.player.gear);
    this.touchLayout = layout;

    // The floating stick.
    const st = frame.touch.stick;
    if (st) {
      ctx.strokeStyle = withAlpha(INK_HEX, 0.35);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(st.ox, st.oy, 40, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = withAlpha(biome.accent, 0.7);
      ctx.beginPath();
      ctx.arc(st.ox + st.dx * 28, st.oy + st.dy * 28, 16, 0, Math.PI * 2);
      ctx.fill();
    }

    const LABELS: Record<string, string> = {
      attack: "⚔",
      roll: "◉",
      dagger: "▸",
      parry: "◇",
      dash: "»",
      whirl: "✱",
      bomb: "●",
      flash: "☀",
      overclock: "↯",
      flask: "♥",
    };
    for (const btn of layout.buttons) {
      const readyAt = curr.player.cool[btn.id] ?? 0;
      const onCd = btn.id !== "attack" && btn.id !== "roll" && btn.id !== "flask" && curr.tick < readyAt;
      const rollWait = btn.id === "roll" && curr.player.dodgeCharges <= 0 && curr.tick < curr.player.dodgeReadyAt;
      ctx.fillStyle = withAlpha(onCd || rollWait ? "#1e2136" : biome.accent, 0.55);
      ctx.beginPath();
      ctx.arc(btn.x, btn.y, btn.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = withAlpha(INK_HEX, 0.4);
      ctx.stroke();
      ctx.fillStyle = withAlpha(CREAM_HEX, 0.9);
      ctx.font = `${Math.round(btn.r * 0.7)}px ${this.fonts.pixel}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(LABELS[btn.id] ?? "?", btn.x, btn.y + 1);
    }

    // Pause chip.
    ctx.fillStyle = withAlpha("#1e2136", 0.8);
    ctx.fillRect(layout.pause.x, layout.pause.y, layout.pause.w, layout.pause.h);
    ctx.fillStyle = INK_HEX;
    ctx.fillRect(layout.pause.x + layout.pause.w / 2 - 5, layout.pause.y + layout.pause.h / 2 - 5, 3, 10);
    ctx.fillRect(layout.pause.x + layout.pause.w / 2 + 2, layout.pause.y + layout.pause.h / 2 - 5, 3, 10);
    void s;
  }
}

/** The drawable arcs of a slam ring: everything except the two safe notches. */
function ringArcs(z: Zone): [number, number][] {
  const TAU = Math.PI * 2;
  const norm = (a: number) => ((a % TAU) + TAU) % TAU;
  const HW = 0.6; // notch halfwidth — matches zoneContains
  const [a, b] = [norm(z.a1), norm(z.a2)].sort((p, q) => p - q);
  const arcs: [number, number][] = [];
  if (b - a > HW * 2) arcs.push([a + HW, b - HW]);
  if (a + TAU - b > HW * 2) arcs.push([b + HW, a - HW + TAU]);
  return arcs;
}

function drawHeart(ctx: CanvasRenderingContext2D, x: number, y: number, kind: "full" | "half" | "empty", accent: string): void {
  ctx.fillStyle = kind === "empty" ? "#1e2136" : accent;
  // 9×8 chunky heart.
  ctx.fillRect(x + 1, y, 3, 2);
  ctx.fillRect(x + 5, y, 3, 2);
  ctx.fillRect(x, y + 2, 9, 3);
  ctx.fillRect(x + 1, y + 5, 7, 2);
  ctx.fillRect(x + 3, y + 7, 3, 1);
  if (kind === "half") {
    ctx.fillStyle = "#1e2136";
    ctx.fillRect(x + 5, y, 4, 8);
  }
}

/** World 9 rooms borrow their source world's accent. */
function roomAccentColor(frame: RenderFrame): ToolColor | null {
  const curr = frame.curr;
  if (!curr) return null;
  // Room-level accent override is resolved by game.ts into frame.accent;
  // this hook exists for the interpolation edge during transitions.
  return frame.accent;
}

export { zoneContains };
