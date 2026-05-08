// Server-authoritative simulation for Munch.
//
// Multi-cell players: each player has 1..MAX_CELLS cells. Pressing space
// halves the largest cell and ejects the new half forward. Cells of the
// same player feel a strong gravitational pull toward their centroid so
// the ejected cell quickly drifts back; once SPLIT_REJOIN_MS has passed
// they're allowed to merge on contact.
//
// One tick per ~33 ms (TICK_HZ). All state lives here; the WebSocket
// layer just feeds inputs in and pulls snapshots out.

import {
  CELL_PULL,
  EAT_RATIO,
  FOOD_MASS,
  FOOD_TARGET,
  INPUT_SMOOTH,
  MAX_CELLS_PER_PLAYER,
  MIN_MASS,
  SPLIT_EJECT_SPEED,
  SPLIT_MIN_MASS,
  SPLIT_PULL_DELAY_MS,
  SPLIT_PULL_RAMP_MS,
  SPAWN_PROTECT_MS,
  SPLIT_REJOIN_MS,
  SPLIT_VELOCITY_DAMP,
  START_MASS,
  TICK_HZ,
  TRAIL_EXPONENT,
  WORLD_SIZE,
  radiusForMass,
  speedForMass,
  type CellView,
  type FoodView,
  type LeaderboardEntry,
  type PlayerView,
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

export type Cell = {
  id: number;
  x: number;
  y: number;
  /** Residual eject momentum from a split. Decays exponentially each
   *  tick via SPLIT_VELOCITY_DAMP — separate from the smoothed input
   *  velocity so a desperate eject can punch through pull/drag without
   *  getting smoothed away. */
  vx: number;
  vy: number;
  /** Smoothed input velocity. Each tick eases toward the target
   *  (input direction × per-cell speed) with INPUT_SMOOTH so pressing
   *  arrows feels responsive but not snappy/twitchy. */
  svx: number;
  svy: number;
  mass: number;
  /** Epoch ms when this cell came from a split. 0 means it's allowed
   *  to merge immediately (i.e. an original or post-merge cell). */
  splitAt: number;
};

export type Player = {
  id: string;
  name: string;
  color: string;
  cells: Cell[];
  alive: boolean;
  inputDir: { x: number; y: number };
  splitRequested: boolean;
  lastInputAt: number;
  killedBy: string | null;
  finalScore: number;
  /** Last non-zero input direction; used as the ejection vector when
   *  splitting from a stationary blob. */
  lastAim: { x: number; y: number };
  /** Epoch ms when this player spawned (or respawned). Used to grant
   * temporary spawn protection — they can't be eaten and can't eat
   * during SPAWN_PROTECT_MS. Cleared (set to 0) when they split, so
   * protection can't be used offensively. */
  spawnedAt: number;
};

export type Food = {
  id: number;
  x: number;
  y: number;
  color: string;
};

export class Game {
  players = new Map<string, Player>();
  food = new Map<number, Food>();

  private nextFoodId = 1;
  private nextCellId = 1;

  constructor() {
    this.refillFood();
  }

  /* -------------------------- player ops -------------------------- */

  addPlayer(id: string, name: string): Player {
    const color = PALETTE[Math.floor(Math.random() * PALETTE.length)];
    const cell: Cell = {
      id: this.nextCellId++,
      x: Math.random() * WORLD_SIZE,
      y: Math.random() * WORLD_SIZE,
      vx: 0,
      vy: 0,
      svx: 0,
      svy: 0,
      mass: START_MASS,
      splitAt: 0,
    };
    const player: Player = {
      id,
      name,
      color,
      cells: [cell],
      alive: true,
      inputDir: { x: 0, y: 0 },
      splitRequested: false,
      lastInputAt: Date.now(),
      killedBy: null,
      finalScore: 0,
      lastAim: { x: 0, y: -1 },
      spawnedAt: Date.now(),
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
    p.cells = [
      {
        id: this.nextCellId++,
        x: Math.random() * WORLD_SIZE,
        y: Math.random() * WORLD_SIZE,
        vx: 0,
        vy: 0,
        svx: 0,
        svy: 0,
        mass: START_MASS,
        splitAt: 0,
      },
    ];
    p.alive = true;
    p.killedBy = null;
    p.finalScore = 0;
    p.inputDir = { x: 0, y: 0 };
    p.splitRequested = false;
    p.spawnedAt = Date.now();
  }

  /* -------------------------- main tick --------------------------- */

  tick(): void {
    const dt = 1 / TICK_HZ;
    const now = Date.now();

    // ---- 1. integrate cell motion ----
    //
    // Each cell's position evolves from three forces:
    //   a) Input velocity — the player pressing arrows. Multi-cell uses
    //      a unified speed reference so the small split-off doesn't
    //      magically outpace the heavy primary; a TRAIL_EXPONENT scales
    //      smaller cells' contribution down so they lag behind in the
    //      direction of motion (the "moving through water" feel).
    //   b) Eject momentum — from a recent split. Decays exponentially
    //      via SPLIT_VELOCITY_DAMP each tick.
    //   c) Centroid pull — gravity toward the cluster's mass-weighted
    //      centre. Suppressed for the first SPLIT_PULL_DELAY_MS after a
    //      split (so the eject actually travels) and ramped back in over
    //      SPLIT_PULL_RAMP_MS.
    for (const p of this.players.values()) {
      if (!p.alive || p.cells.length === 0) continue;

      // Centroid + max mass for the cluster.
      let cx = 0;
      let cy = 0;
      let sumMass = 0;
      let maxMass = 0;
      for (const c of p.cells) {
        cx += c.x * c.mass;
        cy += c.y * c.mass;
        sumMass += c.mass;
        if (c.mass > maxMass) maxMass = c.mass;
      }
      if (sumMass > 0) {
        cx /= sumMass;
        cy /= sumMass;
      }

      const isCluster = p.cells.length > 1;
      const refSpeed = speedForMass(maxMass);

      for (const cell of p.cells) {
        // (a) Target input velocity. In a cluster, scale by mass-ratio
        // with the trailing exponent so smaller cells move slower in
        // the input direction.
        const massFraction = isCluster
          ? Math.pow(cell.mass / maxMass, TRAIL_EXPONENT)
          : 1;
        const inputSpeed = isCluster
          ? refSpeed * massFraction
          : speedForMass(cell.mass);
        const targetVx = p.inputDir.x * inputSpeed;
        const targetVy = p.inputDir.y * inputSpeed;

        // Ease the smoothed velocity toward the target. This is what
        // makes movement feel weighty rather than twitchy — pressing or
        // releasing arrows has a brief ramp instead of a hard snap.
        cell.svx += (targetVx - cell.svx) * INPUT_SMOOTH;
        cell.svy += (targetVy - cell.svy) * INPUT_SMOOTH;

        // (b) Decay eject momentum exponentially.
        cell.vx *= SPLIT_VELOCITY_DAMP;
        cell.vy *= SPLIT_VELOCITY_DAMP;

        // (c) Centroid pull, gated by post-split delay/ramp.
        let pullVx = 0;
        let pullVy = 0;
        if (isCluster) {
          const sinceSplit = cell.splitAt > 0 ? now - cell.splitAt : Infinity;
          let pullFactor = 1;
          if (sinceSplit < SPLIT_PULL_DELAY_MS) {
            pullFactor = 0;
          } else if (sinceSplit < SPLIT_PULL_DELAY_MS + SPLIT_PULL_RAMP_MS) {
            pullFactor = (sinceSplit - SPLIT_PULL_DELAY_MS) / SPLIT_PULL_RAMP_MS;
          }
          if (pullFactor > 0) {
            pullVx = (cx - cell.x) * CELL_PULL * pullFactor;
            pullVy = (cy - cell.y) * CELL_PULL * pullFactor;
          }
        }

        const totalVx = cell.svx + cell.vx + pullVx;
        const totalVy = cell.svy + cell.vy + pullVy;

        cell.x = clamp(cell.x + totalVx * dt, 0, WORLD_SIZE);
        cell.y = clamp(cell.y + totalVy * dt, 0, WORLD_SIZE);
      }
    }

    // ---- 2. handle splits ----
    for (const p of this.players.values()) {
      if (!p.alive || !p.splitRequested) continue;
      p.splitRequested = false;
      if (p.cells.length >= MAX_CELLS_PER_PLAYER) continue;
      // Find the largest cell that's big enough to split.
      let source: Cell | null = null;
      for (const c of p.cells) {
        if (c.mass >= SPLIT_MIN_MASS && (!source || c.mass > source.mass)) {
          source = c;
        }
      }
      if (!source) continue;

      // Splitting cancels spawn protection — you can't shoot while
      // invulnerable.
      p.spawnedAt = 0;
      const aim = p.lastAim;
      const aimLen = Math.hypot(aim.x, aim.y) || 1;
      const ax = aim.x / aimLen;
      const ay = aim.y / aimLen;
      const halfMass = source.mass / 2;
      source.mass = halfMass;
      source.splitAt = now;
      const r = radiusForMass(halfMass);
      const newCell: Cell = {
        id: this.nextCellId++,
        x: source.x + ax * (r * 2 + 4),
        y: source.y + ay * (r * 2 + 4),
        vx: ax * SPLIT_EJECT_SPEED,
        vy: ay * SPLIT_EJECT_SPEED,
        // Inherit the source cell's smoothed velocity so the new cell
        // doesn't suffer a fresh acceleration ramp on top of its eject.
        svx: source.svx,
        svy: source.svy,
        mass: halfMass,
        splitAt: now,
      };
      p.cells.push(newCell);
    }

    // ---- 3. resolve eats (per-cell, against food and other players' cells) ----
    type CellRef = { kind: "player"; ownerId: string; cellIdx: number; x: number; y: number };
    type FoodRef = { kind: "food"; id: number; x: number; y: number };
    const grid = new SpatialGrid<{ id: string | number; x: number; y: number } & (CellRef | FoodRef)>(
      WORLD_SIZE,
      200,
    );
    grid.clear();
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      for (let i = 0; i < p.cells.length; i++) {
        const c = p.cells[i];
        grid.insert({
          id: c.id,
          x: c.x,
          y: c.y,
          kind: "player",
          ownerId: p.id,
          cellIdx: i,
        });
      }
    }
    for (const f of this.food.values()) {
      grid.insert({ id: f.id, x: f.x, y: f.y, kind: "food" });
    }

    // We need stable indices into player.cells, but eats may remove cells.
    // To keep things simple: collect all eats first, then apply them.
    type Eat =
      | { kind: "food"; eaterPlayer: string; eaterCellId: number; foodId: number }
      | {
          kind: "player";
          eaterPlayer: string;
          eaterCellId: number;
          victimPlayer: string;
          victimCellId: number;
        };
    const eats: Eat[] = [];

    const isProtected = (player: Player): boolean =>
      player.spawnedAt > 0 && now - player.spawnedAt < SPAWN_PROTECT_MS;

    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const eaterProtected = isProtected(p);
      for (const cell of p.cells) {
        const r = radiusForMass(cell.mass);
        const candidates = grid.nearby(cell.x, cell.y, r + 60);
        for (const cand of candidates) {
          if (cand.kind === "food") {
            // Food eating is always allowed — protection only gates
            // player-vs-player eats, otherwise spawn protection would
            // mean you can't grow either.
            const dx = cand.x - cell.x;
            const dy = cand.y - cell.y;
            if (dx * dx + dy * dy < r * r) {
              eats.push({
                kind: "food",
                eaterPlayer: p.id,
                eaterCellId: cell.id,
                foodId: cand.id as number,
              });
            }
          } else if (cand.kind === "player") {
            if (cand.ownerId === p.id) continue; // own cells handled by merge
            const victim = this.players.get(cand.ownerId);
            if (!victim || !victim.alive) continue;
            // Protected players are immune in either direction.
            if (eaterProtected || isProtected(victim)) continue;
            const victimCell = victim.cells.find((c) => c.id === (cand.id as number));
            if (!victimCell) continue;
            if (cell.mass < victimCell.mass * EAT_RATIO) continue;
            const dx = victimCell.x - cell.x;
            const dy = victimCell.y - cell.y;
            const dist = Math.hypot(dx, dy);
            if (dist < r - radiusForMass(victimCell.mass) * 0.5) {
              eats.push({
                kind: "player",
                eaterPlayer: p.id,
                eaterCellId: cell.id,
                victimPlayer: victim.id,
                victimCellId: victimCell.id,
              });
            }
          }
        }
      }
    }

    // Apply eats. A given cell or food is eaten only by the first eater
    // we see (deterministic-ish — first iteration wins).
    const eatenFood = new Set<number>();
    const eatenCells = new Set<number>(); // cell id, regardless of owner
    for (const e of eats) {
      if (e.kind === "food") {
        if (eatenFood.has(e.foodId)) continue;
        const eater = this.players.get(e.eaterPlayer);
        const cell = eater?.cells.find((c) => c.id === e.eaterCellId);
        if (!cell || !this.food.has(e.foodId)) continue;
        cell.mass += FOOD_MASS;
        this.food.delete(e.foodId);
        eatenFood.add(e.foodId);
      } else {
        if (eatenCells.has(e.victimCellId)) continue;
        const eater = this.players.get(e.eaterPlayer);
        const eaterCell = eater?.cells.find((c) => c.id === e.eaterCellId);
        const victim = this.players.get(e.victimPlayer);
        if (!eater || !eaterCell || !victim) continue;
        const victimCell = victim.cells.find((c) => c.id === e.victimCellId);
        if (!victimCell) continue;
        eaterCell.mass += victimCell.mass;
        victim.cells = victim.cells.filter((c) => c.id !== victimCell.id);
        eatenCells.add(victimCell.id);
        // Did this kill the victim?
        if (victim.cells.length === 0 && victim.alive) {
          victim.alive = false;
          victim.killedBy = eater.name;
          victim.finalScore = Math.max(MIN_MASS, Math.floor(victim.finalScore));
        }
      }
    }

    // Track running peak mass per player so the score reflects what they
    // achieved at the high point, not the dribbled-down post-eaten state.
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const total = p.cells.reduce((a, c) => a + c.mass, 0);
      if (total > p.finalScore) p.finalScore = Math.floor(total);
    }

    // ---- 4. own-cell separation: cells of the same player can touch
    // but never overlap while still within the rejoin cooldown. The
    // gravity from step 1 keeps pulling them together; this constraint
    // resolves the resulting clip so they rest exactly at touch.
    for (const p of this.players.values()) {
      if (!p.alive || p.cells.length < 2) continue;
      const cooled = (c: Cell) => c.splitAt === 0 || now - c.splitAt > SPLIT_REJOIN_MS;
      // Up to a couple of relaxation passes to settle multi-cell jams.
      for (let pass = 0; pass < 3; pass++) {
        let moved = false;
        for (let i = 0; i < p.cells.length; i++) {
          for (let j = i + 1; j < p.cells.length; j++) {
            const a = p.cells[i];
            const b = p.cells[j];
            // Skip pairs that ARE allowed to merge — those go through
            // the merge step below instead of bouncing apart.
            if (cooled(a) && cooled(b)) continue;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const dist = Math.hypot(dx, dy);
            const minDist = radiusForMass(a.mass) + radiusForMass(b.mass);
            if (dist < minDist && dist > 0.0001) {
              const overlap = minDist - dist;
              const nx = dx / dist;
              const ny = dy / dist;
              // Push along the contact normal, weighted by inverse mass
              // so a small cell gets pushed more than a big one.
              const total = a.mass + b.mass;
              a.x = clamp(a.x - nx * overlap * (b.mass / total), 0, WORLD_SIZE);
              a.y = clamp(a.y - ny * overlap * (b.mass / total), 0, WORLD_SIZE);
              b.x = clamp(b.x + nx * overlap * (a.mass / total), 0, WORLD_SIZE);
              b.y = clamp(b.y + ny * overlap * (a.mass / total), 0, WORLD_SIZE);
              moved = true;
            }
          }
        }
        if (!moved) break;
      }
    }

    // ---- 5. own-cell merges (after split cooldown) ----
    for (const p of this.players.values()) {
      if (!p.alive || p.cells.length < 2) continue;
      const cooled = (c: Cell) => c.splitAt === 0 || now - c.splitAt > SPLIT_REJOIN_MS;
      let didMerge = true;
      while (didMerge) {
        didMerge = false;
        for (let i = 0; i < p.cells.length; i++) {
          for (let j = i + 1; j < p.cells.length; j++) {
            const a = p.cells[i];
            const b = p.cells[j];
            if (!cooled(a) || !cooled(b)) continue;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const dist = Math.hypot(dx, dy);
            const overlap = (radiusForMass(a.mass) + radiusForMass(b.mass)) * 0.7;
            if (dist < overlap) {
              const total = a.mass + b.mass;
              a.x = (a.x * a.mass + b.x * b.mass) / total;
              a.y = (a.y * a.mass + b.y * b.mass) / total;
              a.mass = total;
              a.splitAt = 0;
              p.cells.splice(j, 1);
              didMerge = true;
              break;
            }
          }
          if (didMerge) break;
        }
      }
    }

    // ---- 6. refill food ----
    if (this.food.size < FOOD_TARGET) {
      const need = Math.min(20, FOOD_TARGET - this.food.size);
      for (let i = 0; i < need; i++) this.spawnFood();
    }
  }

  /* -------------------------- snapshots --------------------------- */

  snapshotFor(playerId: string, viewHx: number, viewHy: number): {
    you: { cells: CellView[]; alive: boolean };
    players: PlayerView[];
    food: FoodView[];
    leaderboard: LeaderboardEntry[];
  } {
    const me = this.players.get(playerId);
    const now = Date.now();
    const cooldownFor = (cell: Cell): number => {
      if (cell.splitAt <= 0) return 0;
      const since = now - cell.splitAt;
      if (since >= SPLIT_REJOIN_MS) return 0;
      return Math.max(0, 1 - since / SPLIT_REJOIN_MS);
    };

    const isProtected = (player: Player): boolean =>
      player.spawnedAt > 0 && now - player.spawnedAt < SPAWN_PROTECT_MS;

    if (!me) {
      return {
        you: { cells: [], alive: false },
        players: [],
        food: [],
        leaderboard: this.leaderboard(),
      };
    }
    // Centroid drives the camera + viewport-cull.
    let cx = 0;
    let cy = 0;
    if (me.cells.length > 0) {
      let sum = 0;
      for (const c of me.cells) {
        cx += c.x * c.mass;
        cy += c.y * c.mass;
        sum += c.mass;
      }
      if (sum > 0) {
        cx /= sum;
        cy /= sum;
      }
    }

    const players: PlayerView[] = [];
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      if (p.id === playerId) continue;
      const playerProt = isProtected(p);
      const visible: CellView[] = [];
      for (const cell of p.cells) {
        if (Math.abs(cell.x - cx) > viewHx + 80) continue;
        if (Math.abs(cell.y - cy) > viewHy + 80) continue;
        visible.push({
          id: cell.id,
          x: cell.x,
          y: cell.y,
          mass: cell.mass,
          cd: cooldownFor(cell),
          prot: playerProt,
        });
      }
      if (visible.length === 0) continue;
      players.push({
        id: p.id,
        name: p.name,
        color: p.color,
        cells: visible,
      });
    }

    const food: FoodView[] = [];
    for (const f of this.food.values()) {
      if (Math.abs(f.x - cx) > viewHx + 20) continue;
      if (Math.abs(f.y - cy) > viewHy + 20) continue;
      food.push({ id: f.id, x: f.x, y: f.y, color: f.color });
    }

    const meProt = isProtected(me);
    return {
      you: {
        cells: me.cells.map((c) => ({
          id: c.id,
          x: c.x,
          y: c.y,
          mass: c.mass,
          cd: cooldownFor(c),
          prot: meProt,
        })),
        alive: me.alive,
      },
      players,
      food,
      leaderboard: this.leaderboard(),
    };
  }

  leaderboard(): LeaderboardEntry[] {
    const out: LeaderboardEntry[] = [];
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const total = p.cells.reduce((a, c) => a + c.mass, 0);
      out.push({ id: p.id, name: p.name, mass: Math.floor(total) });
    }
    return out.sort((a, b) => b.mass - a.mass).slice(0, 10);
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
