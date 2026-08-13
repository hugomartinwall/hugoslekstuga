import { MINION_KINDS } from "../content/enemies";
import type { Rng } from "./rng";
import { F, type Entity, type GameState } from "./state";
import { angDiff, circleHitsSolid, tileUnder } from "./collision";
import { T } from "./rooms";

/**
 * Enemy behaviour steppers — one per archetype, shared by every reskin.
 * A stepper reads the world, writes the entity's desired velocity (dvx/dvy
 * in px/tick via e.mem scratch → returned object) and fires projectiles.
 * Windups always respect the world's telegraph floor: readability is a
 * rule, not a tuning knob.
 */

export type AiCtx = {
  floor: number; // telegraph floor, ticks
  dark: boolean; // room mechanic is darkness
  ice: boolean;
  rng: Rng;
};

export function fireShot(
  state: GameState,
  x: number,
  y: number,
  ang: number,
  speed: number, // px/s
  dmg: number,
  kind = "shot",
  homing = 0,
  ttl = 300,
): void {
  state.room.projectiles.push({
    x,
    y,
    vx: (Math.cos(ang) * speed) / 60,
    vy: (Math.sin(ang) * speed) / 60,
    r: 3,
    dmg,
    hostile: true,
    kind,
    t: 0,
    ttl,
    pierce: 0,
    homing,
  });
}

const angleTo = (e: Entity, x: number, y: number) => Math.atan2(y - e.y, x - e.x);
const distTo = (e: Entity, x: number, y: number) => Math.hypot(x - e.x, y - e.y);

/** Is a phasing ghost currently solid? (lantern cone, flash, or lit room) */
export function ghostLit(state: GameState, e: Entity): boolean {
  if (!(e.flags & F.PHASEDARK)) return true;
  if (state.room.mechanic !== "dark") return true;
  const p = state.player;
  if (state.tick < p.flashUntil) return true;
  // Inside the lantern cone?
  const stats = p.gear.includes("oil");
  const range = stats ? 150 : 110;
  const half = (stats ? 0.55 : 0.42) * Math.PI * 0.5;
  const d = distTo(e, p.x, p.y);
  if (d > range) return false;
  return Math.abs(angDiff(angleTo(e, p.x, p.y) + Math.PI, p.faceAng)) <= half;
}

/**
 * Step one enemy. Returns the desired velocity in px/tick; the tick
 * integrates it (with ice inertia, currents, bog slow, knockback).
 */
export function stepEnemy(
  state: GameState,
  e: Entity,
  ctx: AiCtx,
): { dvx: number; dvy: number } {
  const p = state.player;
  const spd = e.speed / 60;
  const d = distTo(e, p.x, p.y);
  const toPlayer = angleTo(e, p.x, p.y);
  e.t++;

  // Terrain speed shaping.
  let mult = 1;
  const tile = tileUnder(state.room.tiles, e.x, e.y);
  if (tile === T.BOG) mult = e.flags & F.BOGFAST ? 1.4 : 0.55;
  else if (e.flags & F.BOGFAST) mult = 0.6;

  const chase = (speedMult = 1) => ({
    dvx: Math.cos(toPlayer) * spd * mult * speedMult,
    dvy: Math.sin(toPlayer) * spd * mult * speedMult,
  });
  const still = { dvx: 0, dvy: 0 };

  switch (e.arch) {
    case "chaser": {
      if (e.mode === "idle") {
        if (d <= 130 || e.t > 300) e.mode = "pursue";
        // Lazy wander.
        if (e.t % 60 === 0) e.mem[0] = ctx.rng.range(0, Math.PI * 2);
        e.faceAng = e.mem[0];
        return { dvx: Math.cos(e.mem[0]) * spd * 0.3 * mult, dvy: Math.sin(e.mem[0]) * spd * 0.3 * mult };
      }
      e.faceAng = toPlayer;
      // Phasing ghosts drift straight through everything toward you.
      return chase();
    }

    case "shooter": {
      const windup = Math.max(24, ctx.floor);
      if (e.mode === "windup") {
        e.faceAng = e.mem[0];
        if (e.t >= windup) {
          const shots = e.flags & F.BURST ? 3 : 1;
          if (e.mem[1] < shots) {
            if (e.t >= windup + e.mem[1] * 12) {
              fireShot(state, e.x, e.y, e.mem[0], 120, 2, e.flags & F.PUDDLE ? "glob" : "shot");
              e.mem[1]++;
            }
            return still;
          }
          e.mode = "cool";
          e.t = 0;
        }
        return still;
      }
      if (e.mode === "cool") {
        if (e.t >= 90) {
          e.mode = "idle";
          e.t = 0;
        }
      } else if (d < 220 && e.t >= 30) {
        e.mode = "windup";
        e.t = 0;
        e.mem[0] = toPlayer;
        e.mem[1] = 0;
        e.faceAng = toPlayer;
        return still;
      }
      // Kite to the 90–140 px band (rooted kinds have speed 0).
      e.faceAng = toPlayer;
      if (spd === 0) return still;
      if (d < 90) return chase(-1);
      if (d > 140) return chase(1);
      return still;
    }

    case "charger": {
      const windup = Math.max(30, ctx.floor);
      if (e.flags & F.BURROW) {
        // Dune variant: unhittable mound → telegraph → surface charge.
        if (e.mode === "idle" || e.mode === "burrow") {
          e.mode = "burrow";
          e.faceAng = toPlayer;
          if (d < 120 && e.t > 45) {
            e.mode = "telegraph";
            e.t = 0;
            e.mem[0] = toPlayer;
          }
          return chase(0.8);
        }
        if (e.mode === "telegraph") {
          if (e.t >= windup) {
            e.mode = "charge";
            e.t = 0;
          }
          return still;
        }
        if (e.mode === "charge") {
          const v = 240 / 60;
          const nx = e.x + Math.cos(e.mem[0]) * v;
          const ny = e.y + Math.sin(e.mem[0]) * v;
          if (e.t > 50 || circleHitsSolid(state.room.tiles, nx, ny, e.r, state.room.cleared)) {
            e.mode = "stun";
            e.t = 0;
            return still;
          }
          return { dvx: Math.cos(e.mem[0]) * v, dvy: Math.sin(e.mem[0]) * v };
        }
        // stun (surfaced, vulnerable)
        if (e.t >= 60) {
          e.mode = "burrow";
          e.t = 0;
        }
        return still;
      }
      if (e.mode === "idle") {
        // Align on a cardinal axis toward the player.
        const dx = p.x - e.x;
        const dy = p.y - e.y;
        const alignedX = Math.abs(dy) < 18;
        const alignedY = Math.abs(dx) < 18;
        if ((alignedX || alignedY) && d < 240 && e.t > 30) {
          e.mode = "telegraph";
          e.t = 0;
          e.mem[0] = alignedX ? (dx > 0 ? 0 : Math.PI) : dy > 0 ? Math.PI / 2 : -Math.PI / 2;
          e.faceAng = e.mem[0];
          return still;
        }
        e.faceAng = toPlayer;
        return chase(0.8);
      }
      if (e.mode === "telegraph") {
        if (e.t >= windup) {
          e.mode = "charge";
          e.t = 0;
        }
        return still;
      }
      if (e.mode === "charge") {
        const v = 240 / 60;
        const nx = e.x + Math.cos(e.mem[0]) * v;
        const ny = e.y + Math.sin(e.mem[0]) * v;
        if (circleHitsSolid(state.room.tiles, nx, ny, e.r, state.room.cleared)) {
          e.mode = "stun";
          e.t = 0;
          return still;
        }
        return { dvx: Math.cos(e.mem[0]) * v, dvy: Math.sin(e.mem[0]) * v };
      }
      // stun — on ice the crash is longer (they overshoot comically).
      if (e.t >= (ctx.ice ? 60 : 45)) {
        e.mode = "idle";
        e.t = 0;
      }
      return still;
    }

    case "splitter": {
      e.faceAng = toPlayer;
      return chase(0.75);
    }

    case "orbiter": {
      const windup = Math.max(20, ctx.floor);
      if (e.mode === "dartTele") {
        if (e.t >= windup) {
          e.mode = "dart";
          e.t = 0;
          e.mem[1] = toPlayer;
        }
        return still;
      }
      if (e.mode === "dart") {
        if (e.t >= 24) {
          e.mode = "idle";
          e.t = 0;
        }
        return { dvx: Math.cos(e.mem[1]) * (200 / 60), dvy: Math.sin(e.mem[1]) * (200 / 60) };
      }
      // Orbit the player at r≈70.
      e.mem[0] += (e.speed / 70 / 60) * (e.id % 2 === 0 ? 1 : -1);
      const tx = p.x + Math.cos(e.mem[0]) * 70;
      const ty = p.y + Math.sin(e.mem[0]) * 70;
      e.faceAng = toPlayer;
      if (e.t > 150 && ctx.rng.chance(0.02)) {
        e.mode = "dartTele";
        e.t = 0;
        return still;
      }
      const da = angleTo(e, tx, ty);
      const dd = Math.min(distTo(e, tx, ty), spd * 1.6 * 60) / 60;
      return { dvx: Math.cos(da) * dd, dvy: Math.sin(da) * dd };
    }

    case "shielded": {
      e.faceAng = toPlayer;
      return chase(e.shieldHp > 0 ? 1 : 1.25);
    }

    case "spawner": {
      // Flinch after a hit — hitFlash doubles as the interrupted-spawn timer.
      if (e.hitFlash > 0) e.t = Math.min(e.t, 180);
      const litterCap = 3;
      const alive = state.room.entities.filter((o) => o.kind === "litter").length;
      if (e.t >= 240 && alive < litterCap) {
        e.t = 0;
        const ang = ctx.rng.range(0, Math.PI * 2);
        const litter = { x: e.x + Math.cos(ang) * 14, y: e.y + Math.sin(ang) * 14 };
        // Direct import of spawnEnemy would cycle; tick handles pending spawns.
        state.room.entities.push(makeMinion(state, "litter", litter.x, litter.y));
      }
      return still;
    }

    case "exploder": {
      if (e.mode === "fuse") {
        if (e.t >= Math.max(30, ctx.floor)) {
          e.hp = 0; // detonation handled by the death pass
          e.mem[3] = 1; // exploded (skip the coin-less shame of a plain death)
        }
        return still;
      }
      e.faceAng = toPlayer;
      if (d < 24) {
        e.mode = "fuse";
        e.t = 0;
        return still;
      }
      return chase(d < 100 ? 2.0 : 1);
    }

    case "healer": {
      // Tether the most-wounded ally in range; otherwise flee the player.
      let best: Entity | null = null;
      let bestFrac = 1;
      for (const o of state.room.entities) {
        if (o === e || o.hp <= 0 || o.arch === "healer") continue;
        const frac = o.hp / o.maxHp;
        if (frac < bestFrac && distTo(e, o.x, o.y) < 140) {
          best = o;
          bestFrac = frac;
        }
      }
      e.mem[0] = best ? best.id : -1;
      if (best && e.t % 60 === 0) {
        best.hp = Math.min(best.maxHp, best.hp + 1);
      }
      e.faceAng = toPlayer + Math.PI;
      if (d < 110) {
        return { dvx: -Math.cos(toPlayer) * spd * mult, dvy: -Math.sin(toPlayer) * spd * mult };
      }
      return still;
    }
  }
}

/**
 * Build a minion entity (splitter shards, spawner litters, boss adds).
 * Stats come from MINION_KINDS — one table, no hand-rolled copies.
 */
function makeMinion(state: GameState, kind: keyof typeof MINION_KINDS, x: number, y: number): Entity {
  const def = MINION_KINDS[kind];
  return {
    id: state.nextId++,
    kind,
    arch: "chaser",
    x,
    y,
    vx: 0,
    vy: 0,
    hp: def.hp,
    maxHp: def.hp,
    r: def.r,
    speed: def.speed,
    coins: def.coins,
    touchDmg: def.touchDmg,
    faceAng: 0,
    mode: "pursue",
    t: 0,
    mem: [0, 0, 0, 0],
    lastHitSwing: -1,
    iframesUntil: 0,
    kbx: 0,
    kby: 0,
    shieldHp: 0,
    spawnGrace: 20,
    hitFlash: 0,
    flags: 0,
  };
}

export { makeMinion };
