// Server-authoritative simulation for Munch.
//
// One tick per ~33 ms (TICK_HZ). All state lives here; the WebSocket
// layer just feeds inputs in and pulls snapshots out.

import {
  EAT_RATIO,
  FOOD_MASS,
  FOOD_TARGET,
  MIN_MASS,
  SPLIT_MIN_MASS,
  SPLIT_PROJECTILE_DECEL,
  SPLIT_PROJECTILE_LIFETIME_MS,
  SPLIT_PROJECTILE_SPEED,
  START_MASS,
  TICK_HZ,
  WORLD_SIZE,
  radiusForMass,
  speedForMass,
  type FoodView,
  type LeaderboardEntry,
  type PlayerView,
  type ProjectileView,
} from "../../lib/munch/protocol.js";
import { SpatialGrid } from "./spatial.js";

const PALETTE = [
  "#ff5a3c",
  "#4f66f2",
  "#ffc233",
  "#ff7ab2",
  "#3fa66e",
  "#9333ea",
  "#f97316",
  "#0d9488",
];

export type Player = {
  id: string;
  name: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  mass: number;
  color: string;
  alive: boolean;
  // Pending input — set by the WebSocket layer when a packet arrives,
  // consumed at the next tick.
  inputDir: { x: number; y: number };
  splitRequested: boolean;
  // For AFK kicking and dead → respawn UX.
  lastInputAt: number;
  killedBy: string | null;
  finalScore: number;
  // Aim direction is the last non-zero input dir, used as the vector
  // for splits when the player is currently stationary.
  lastAim: { x: number; y: number };
};

export type Food = {
  id: number;
  x: number;
  y: number;
  color: string;
};

export type Projectile = {
  id: number;
  ownerId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  mass: number;
  color: string;
  expiresAt: number; // ms epoch
};

export class Game {
  players = new Map<string, Player>();
  food = new Map<number, Food>();
  projectiles = new Map<number, Projectile>();

  private nextFoodId = 1;
  private nextProjectileId = 1;
  private tickCount = 0;

  constructor() {
    this.refillFood();
  }

  /* -------------------------- player ops -------------------------- */

  addPlayer(id: string, name: string): Player {
    const color = PALETTE[Math.floor(Math.random() * PALETTE.length)];
    const player: Player = {
      id,
      name,
      x: Math.random() * WORLD_SIZE,
      y: Math.random() * WORLD_SIZE,
      vx: 0,
      vy: 0,
      mass: START_MASS,
      color,
      alive: true,
      inputDir: { x: 0, y: 0 },
      splitRequested: false,
      lastInputAt: Date.now(),
      killedBy: null,
      finalScore: 0,
      lastAim: { x: 0, y: -1 }, // default aim is up
    };
    this.players.set(id, player);
    return player;
  }

  removePlayer(id: string): void {
    this.players.delete(id);
  }

  setInput(
    id: string,
    dir: { x: number; y: number },
    split: boolean,
  ): void {
    const p = this.players.get(id);
    if (!p) return;
    // Normalise so a key combo of two arrows isn't sqrt(2) faster.
    const len = Math.hypot(dir.x, dir.y);
    if (len > 0.001) {
      p.inputDir = { x: dir.x / len, y: dir.y / len };
      p.lastAim = { ...p.inputDir };
    } else {
      p.inputDir = { x: 0, y: 0 };
    }
    if (split) p.splitRequested = true;
    p.lastInputAt = Date.now();
  }

  respawn(id: string): void {
    const p = this.players.get(id);
    if (!p) return;
    p.x = Math.random() * WORLD_SIZE;
    p.y = Math.random() * WORLD_SIZE;
    p.vx = 0;
    p.vy = 0;
    p.mass = START_MASS;
    p.alive = true;
    p.killedBy = null;
    p.finalScore = 0;
    p.inputDir = { x: 0, y: 0 };
    p.splitRequested = false;
  }

  /* -------------------------- main tick --------------------------- */

  tick(): void {
    const dt = 1 / TICK_HZ;
    const now = Date.now();
    this.tickCount++;

    // ---- 1. integrate player movement ----
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const speed = speedForMass(p.mass);
      p.vx = p.inputDir.x * speed;
      p.vy = p.inputDir.y * speed;
      p.x = clamp(p.x + p.vx * dt, 0, WORLD_SIZE);
      p.y = clamp(p.y + p.vy * dt, 0, WORLD_SIZE);
    }

    // ---- 2. handle splits ----
    for (const p of this.players.values()) {
      if (!p.alive || !p.splitRequested) continue;
      p.splitRequested = false;
      if (p.mass < SPLIT_MIN_MASS) continue;
      const aim = p.lastAim;
      const aimLen = Math.hypot(aim.x, aim.y) || 1;
      const ax = aim.x / aimLen;
      const ay = aim.y / aimLen;
      const halfMass = p.mass / 2;
      p.mass = halfMass;
      const projId = this.nextProjectileId++;
      // Spawn just outside the player's body so it doesn't immediately
      // collide with itself.
      const r = radiusForMass(halfMass);
      const projectile: Projectile = {
        id: projId,
        ownerId: p.id,
        x: p.x + ax * (r + 4),
        y: p.y + ay * (r + 4),
        vx: ax * SPLIT_PROJECTILE_SPEED,
        vy: ay * SPLIT_PROJECTILE_SPEED,
        mass: halfMass,
        color: p.color,
        expiresAt: now + SPLIT_PROJECTILE_LIFETIME_MS,
      };
      this.projectiles.set(projId, projectile);
    }

    // ---- 3. integrate projectiles (decelerate, expire) ----
    for (const proj of [...this.projectiles.values()]) {
      if (now >= proj.expiresAt) {
        this.projectiles.delete(proj.id);
        continue;
      }
      proj.x = clamp(proj.x + proj.vx * dt, 0, WORLD_SIZE);
      proj.y = clamp(proj.y + proj.vy * dt, 0, WORLD_SIZE);
      // Multiplicative deceleration each second.
      const decay = Math.pow(1 / SPLIT_PROJECTILE_DECEL, dt);
      proj.vx *= decay;
      proj.vy *= decay;
    }

    // ---- 4. resolve eats ----
    // Build a fresh spatial grid each tick — simple and correct.
    const grid = new SpatialGrid<{ id: string | number; x: number; y: number; kind: "player" | "food" | "proj" }>(
      WORLD_SIZE,
      200,
    );
    grid.clear();
    for (const p of this.players.values()) {
      if (p.alive) grid.insert({ id: p.id, x: p.x, y: p.y, kind: "player" });
    }
    for (const f of this.food.values()) {
      grid.insert({ id: f.id, x: f.x, y: f.y, kind: "food" });
    }
    for (const proj of this.projectiles.values()) {
      grid.insert({ id: proj.id, x: proj.x, y: proj.y, kind: "proj" });
    }

    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const r = radiusForMass(p.mass);
      const candidates = grid.nearby(p.x, p.y, r + 60);
      for (const c of candidates) {
        if (c.kind === "food") {
          const f = this.food.get(c.id as number);
          if (!f) continue;
          const dx = f.x - p.x;
          const dy = f.y - p.y;
          if (dx * dx + dy * dy < r * r) {
            this.food.delete(f.id);
            p.mass += FOOD_MASS;
          }
        } else if (c.kind === "player") {
          if (c.id === p.id) continue;
          const other = this.players.get(c.id as string);
          if (!other || !other.alive) continue;
          if (p.mass < other.mass * EAT_RATIO) continue; // can't eat
          const dx = other.x - p.x;
          const dy = other.y - p.y;
          const dist = Math.hypot(dx, dy);
          // Engulf rule: closest edge of small must be inside big.
          if (dist < r - radiusForMass(other.mass) * 0.5) {
            p.mass += other.mass;
            other.alive = false;
            other.killedBy = p.name;
            other.finalScore = Math.max(MIN_MASS, Math.floor(other.mass));
            other.mass = MIN_MASS;
          }
        } else if (c.kind === "proj") {
          const proj = this.projectiles.get(c.id as number);
          if (!proj) continue;
          if (proj.ownerId === p.id) continue; // own projectile passes through
          const dx = proj.x - p.x;
          const dy = proj.y - p.y;
          const dist = Math.hypot(dx, dy);
          const projR = radiusForMass(proj.mass);
          if (p.mass >= proj.mass * EAT_RATIO && dist < r - projR * 0.5) {
            // Player eats the projectile.
            p.mass += proj.mass;
            this.projectiles.delete(proj.id);
          } else if (proj.mass >= p.mass * EAT_RATIO && dist < projR - r * 0.5) {
            // Projectile is bigger and engulfs the player.
            const owner = this.players.get(proj.ownerId);
            const killerName = owner?.name ?? "a stray";
            // The projectile absorbs the player's mass.
            proj.mass += p.mass;
            p.alive = false;
            p.killedBy = killerName;
            p.finalScore = Math.max(MIN_MASS, Math.floor(p.mass));
            p.mass = MIN_MASS;
          }
        }
      }
    }

    // Projectile-vs-projectile: bigger eats smaller.
    const projList = [...this.projectiles.values()];
    for (let i = 0; i < projList.length; i++) {
      const a = projList[i];
      if (!this.projectiles.has(a.id)) continue;
      for (let j = i + 1; j < projList.length; j++) {
        const b = projList[j];
        if (!this.projectiles.has(b.id)) continue;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.hypot(dx, dy);
        const ra = radiusForMass(a.mass);
        const rb = radiusForMass(b.mass);
        if (a.mass >= b.mass * EAT_RATIO && dist < ra - rb * 0.5) {
          a.mass += b.mass;
          this.projectiles.delete(b.id);
        } else if (b.mass >= a.mass * EAT_RATIO && dist < rb - ra * 0.5) {
          b.mass += a.mass;
          this.projectiles.delete(a.id);
          break;
        }
      }
    }

    // ---- 5. refill food ----
    if (this.food.size < FOOD_TARGET) {
      const need = Math.min(20, FOOD_TARGET - this.food.size);
      for (let i = 0; i < need; i++) this.spawnFood();
    }
  }

  /* -------------------------- snapshots --------------------------- */

  snapshotFor(playerId: string, viewHx: number, viewHy: number): {
    you: { x: number; y: number; mass: number; alive: boolean };
    players: PlayerView[];
    food: FoodView[];
    projectiles: ProjectileView[];
    leaderboard: LeaderboardEntry[];
  } {
    const me = this.players.get(playerId);
    if (!me) {
      return {
        you: { x: 0, y: 0, mass: START_MASS, alive: false },
        players: [],
        food: [],
        projectiles: [],
        leaderboard: this.leaderboard(),
      };
    }
    const cx = me.x;
    const cy = me.y;
    const players: PlayerView[] = [];
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      if (p.id === playerId) continue; // self is delivered via `you`
      if (Math.abs(p.x - cx) > viewHx + 80) continue;
      if (Math.abs(p.y - cy) > viewHy + 80) continue;
      players.push({
        id: p.id,
        name: p.name,
        x: p.x,
        y: p.y,
        mass: p.mass,
        color: p.color,
      });
    }
    const food: FoodView[] = [];
    for (const f of this.food.values()) {
      if (Math.abs(f.x - cx) > viewHx + 20) continue;
      if (Math.abs(f.y - cy) > viewHy + 20) continue;
      food.push({ id: f.id, x: f.x, y: f.y, color: f.color });
    }
    const projectiles: ProjectileView[] = [];
    for (const proj of this.projectiles.values()) {
      if (Math.abs(proj.x - cx) > viewHx + 80) continue;
      if (Math.abs(proj.y - cy) > viewHy + 80) continue;
      projectiles.push({
        id: proj.id,
        ownerId: proj.ownerId,
        x: proj.x,
        y: proj.y,
        mass: proj.mass,
        color: proj.color,
      });
    }
    return {
      you: { x: me.x, y: me.y, mass: me.mass, alive: me.alive },
      players,
      food,
      projectiles,
      leaderboard: this.leaderboard(),
    };
  }

  leaderboard(): LeaderboardEntry[] {
    const alive: LeaderboardEntry[] = [];
    for (const p of this.players.values()) {
      if (p.alive) alive.push({ id: p.id, name: p.name, mass: Math.floor(p.mass) });
    }
    return alive.sort((a, b) => b.mass - a.mass).slice(0, 10);
  }

  /* -------------------------- helpers ----------------------------- */

  private spawnFood(): void {
    const id = this.nextFoodId++;
    this.food.set(id, {
      id,
      x: Math.random() * WORLD_SIZE,
      y: Math.random() * WORLD_SIZE,
      color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
    });
  }

  private refillFood(): void {
    while (this.food.size < FOOD_TARGET) this.spawnFood();
  }
}

function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}
