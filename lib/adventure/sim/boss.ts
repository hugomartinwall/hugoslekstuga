import { BOSS_DEFS } from "../content/bosses";
import { worldDef } from "../content/worlds";
import { fireShot, makeMinion } from "./ai";
import { angDiff, circleHitsSolid } from "./collision";
import { ROOM_PX_H, ROOM_PX_W } from "./rooms";
import { Rng } from "./rng";
import type { BossState, GameState, Zone } from "./state";

/**
 * The ten bosses — bespoke pattern machines over a small shared toolbox
 * (telegraph zones, projectile rings/fans, add spawning). Every attack
 * telegraphs at or above the world's floor; the vulnerability windows are
 * the fights' grammar. Damage is in half-hearts.
 */

const CX = ROOM_PX_W / 2;
const CY = ROOM_PX_H / 2;

export function initBoss(state: GameState): void {
  const def = BOSS_DEFS[worldDef(state.world).boss];
  state.boss = {
    kind: def.kind,
    x: def.kind === "heron" || def.kind === "proprietor" ? CX : CX + 60,
    y: def.kind === "heron" ? 30 : def.kind === "proprietor" ? 52 : CY,
    vx: 0,
    vy: 0,
    hp: def.hp,
    maxHp: def.hp,
    r: def.r,
    phase: 1,
    mode: "enter",
    t: 0,
    mem: [0, 0, 0, 0, 0, 0],
    faceAng: Math.PI,
    lastHitSwing: -1,
    hitFlash: 0,
    vulnerable: true,
    contactHarmless: false,
    contactDmg: def.contactDmg,
    announcedPhase: 1,
    dead: false,
  };
}

// ---- zone helpers -----------------------------------------------------

function zc(state: GameState, x: number, y: number, r: number, lead: number, dmg: number, kind: string, activeFor = 6): Zone {
  const z: Zone = { kind, shape: "circle", x, y, x2: 0, y2: 0, r, w: 0, a1: 0, a2: 0, fireAt: state.tick + lead, activeFor, dmg, harmless: false };
  state.room.zones.push(z);
  return z;
}

function zl(state: GameState, x: number, y: number, x2: number, y2: number, w: number, lead: number, dmg: number, kind: string, activeFor = 6): Zone {
  const z: Zone = { kind, shape: "line", x, y, x2, y2, r: 0, w, a1: 0, a2: 0, fireAt: state.tick + lead, activeFor, dmg, harmless: false };
  state.room.zones.push(z);
  return z;
}

function zr(state: GameState, x: number, y: number, x2: number, y2: number, lead: number, dmg: number, kind: string, activeFor = 6): Zone {
  const z: Zone = { kind, shape: "rect", x, y, x2, y2, r: 0, w: 0, a1: 0, a2: 0, fireAt: state.tick + lead, activeFor, dmg, harmless: false };
  state.room.zones.push(z);
  return z;
}

function zring(state: GameState, x: number, y: number, r: number, lead: number, dmg: number, a1: number, a2: number): Zone {
  const z: Zone = { kind: "slamring", shape: "ring", x, y, x2: 0, y2: 0, r, w: 14, a1, a2, fireAt: state.tick + lead, activeFor: 6, dmg, harmless: false };
  state.room.zones.push(z);
  return z;
}

function ring(state: GameState, x: number, y: number, n: number, speed: number, kind = "shard"): void {
  for (let i = 0; i < n; i++) {
    fireShot(state, x, y, (i / n) * Math.PI * 2, speed, 2, kind);
  }
}

function fan(state: GameState, x: number, y: number, ang: number, n: number, spreadDeg: number, speed: number, kind = "shot"): void {
  const spread = (spreadDeg * Math.PI) / 180;
  for (let i = 0; i < n; i++) {
    const a = n === 1 ? ang : ang - spread / 2 + (spread * i) / (n - 1);
    fireShot(state, x, y, a, speed, 2, kind);
  }
}

/** Boss adds — stats come from MINION_KINDS, never overridden inline. */
function addMinion(state: GameState, kind: "cartling" | "addSapling" | "litter", x: number, y: number, cap: number): void {
  const alive = state.room.entities.filter((e) => e.kind === kind).length;
  if (alive >= cap) return;
  state.room.entities.push(makeMinion(state, kind, x, y));
}

const toPlayer = (b: BossState, s: GameState) => Math.atan2(s.player.y - b.y, s.player.x - b.x);
const playerDist = (b: BossState, s: GameState) => Math.hypot(s.player.x - b.x, s.player.y - b.y);
const go = (b: BossState, ang: number, pxPerSec: number) => {
  b.vx = (Math.cos(ang) * pxPerSec) / 60;
  b.vy = (Math.sin(ang) * pxPerSec) / 60;
};

/** Advance the boss one tick. The tick pipeline handles hits and death. */
export function stepBoss(state: GameState, rng: Rng): void {
  const b = state.boss;
  if (!b || b.dead) return;
  const floor = worldDef(state.world).telegraphFloor;
  b.t++;
  if (b.hitFlash > 0) b.hitFlash--;

  // Phase promotion (2-phase bosses at 50%; the finale at thirds).
  const def = BOSS_DEFS[b.kind];
  const frac = b.hp / b.maxHp;
  const wantPhase = def.phases === 3 ? (frac <= 140 / 430 ? 3 : frac <= 280 / 430 ? 2 : 1) : frac <= 0.5 ? 2 : 1;
  if (wantPhase > b.phase) {
    b.phase = wantPhase;
    b.mode = "phaseIn";
    b.t = 0;
    b.vx = 0;
    b.vy = 0;
  }
  if (b.mode === "phaseIn") {
    b.vulnerable = false;
    if (b.t >= 60) {
      b.mode = "idle";
      b.t = 0;
      b.vulnerable = true;
    }
    return;
  }
  if (b.mode === "enter") {
    b.vulnerable = false;
    if (b.t >= 30) {
      b.mode = "idle";
      b.t = 0;
      b.vulnerable = true;
    }
    return;
  }

  // Punish windows are melee-safe: standing next to a stunned machine to
  // collect your reward must not cost a heart.
  b.contactHarmless =
    b.mode === "stun" || b.mode === "vent" || b.mode === "preen" || b.mode === "surfaced" || b.mode === "rest";

  switch (b.kind) {
    case "cartking":
      stepCartKing(state, b, rng, floor);
      break;
    case "stump":
      stepStump(state, b, rng, floor);
      break;
    case "heron":
      stepHeron(state, b, rng, floor);
      break;
    case "toad":
      stepToad(state, b, rng, floor);
      break;
    case "zamboni":
      stepZamboni(state, b, rng, floor);
      break;
    case "foreman":
      stepForeman(state, b, rng, floor);
      break;
    case "antlion":
      stepAntlion(state, b, rng, floor);
      break;
    case "archivist":
      stepArchivist(state, b, rng, floor);
      break;
    case "playtester":
      stepPlaytester(state, b, rng, floor);
      break;
    case "proprietor":
      stepProprietor(state, b, rng, floor);
      break;
  }

  // Integrate with wall collision for the grounded bosses.
  if (b.vx !== 0 || b.vy !== 0) {
    const grounded = b.kind !== "heron" && b.kind !== "archivist";
    const nx = b.x + b.vx;
    const ny = b.y + b.vy;
    if (!grounded || !circleHitsSolid(state.room.tiles, nx, ny, b.r, false)) {
      b.x = nx;
      b.y = ny;
    } else {
      // Wall stop — the charge patterns read this via mem.
      b.mem[5] = 1;
      b.vx = 0;
      b.vy = 0;
    }
  }
  b.x = Math.max(20, Math.min(ROOM_PX_W - 20, b.x));
  b.y = Math.max(20, Math.min(ROOM_PX_H - 20, b.y));
}

// ---- 1. THE CART KING -------------------------------------------------

function stepCartKing(state: GameState, b: BossState, rng: Rng, floor: number): void {
  b.vulnerable = b.mode === "stun";
  switch (b.mode) {
    case "idle":
      b.mode = "track";
      b.t = 0;
      break;
    case "track":
      b.faceAng = toPlayer(b, state);
      go(b, b.faceAng, 30);
      if (b.t >= 60) {
        b.mode = "rattle";
        b.t = 0;
        b.vx = 0;
        b.vy = 0;
      }
      break;
    case "rattle": {
      const windup = Math.max(28, floor);
      b.faceAng = toPlayer(b, state);
      if (b.t >= windup) {
        b.mode = "charge";
        b.t = 0;
        b.mem[0] = b.faceAng;
        b.mem[5] = 0;
      }
      break;
    }
    case "charge":
      go(b, b.mem[0], 240);
      if (b.mem[5] === 1 || b.t > 90) {
        // Crash. Coins spill; every second crash sheds a cartling.
        b.mem[1]++;
        state.room.coins.push(
          { x: b.x, y: b.y - 10, vx: rng.range(-1, 1), vy: rng.range(-1.5, -0.5), value: 1, t: 0 },
          { x: b.x, y: b.y - 10, vx: rng.range(-1, 1), vy: rng.range(-1.5, -0.5), value: 1, t: 0 },
        );
        if (b.mem[1] % 2 === 0 || b.phase === 2) {
          addMinion(state, "cartling", b.x + 12, b.y, 3);
        }
        if (b.phase === 2 && b.mem[2] === 0) {
          // Chained second charge: brief re-aim, then go again.
          b.mem[2] = 1;
          b.mode = "rattle";
          // Shortened re-aim: the rattle restarts part-way through, so the
          // second charge still shows ≥ 12 visible telegraph ticks.
          b.t = Math.max(0, Math.max(28, floor) - 12);
        } else {
          b.mem[2] = 0;
          b.mode = "stun";
          b.t = 0;
        }
        b.vx = 0;
        b.vy = 0;
      }
      break;
    case "stun":
      if (b.t >= (b.phase === 2 ? 60 : 110)) {
        b.mode = "track";
        b.t = 0;
      }
      break;
  }
}

// ---- 2. MOTHER STUMP --------------------------------------------------

function stepStump(state: GameState, b: BossState, rng: Rng, floor: number): void {
  b.x = CX;
  b.y = CY;
  b.vulnerable = true;
  const windup = Math.max(30, floor);
  switch (b.mode) {
    case "idle":
      if (b.t >= 60) {
        b.mode = "roots";
        b.t = 0;
        b.mem[0] = 0;
      }
      break;
    case "roots": {
      const volleys = b.phase === 2 ? 2 : 3;
      if (b.t % (windup + 14) === 0 && b.mem[0] < volleys) {
        const ang = toPlayer(b, state) + rng.range(-0.15, 0.15);
        zl(state, b.x, b.y, b.x + Math.cos(ang) * 300, b.y + Math.sin(ang) * 300, 12, windup, 2, "root");
        b.mem[0]++;
      }
      if (b.mem[0] >= volleys && b.t >= volleys * (windup + 14) + 20) {
        b.mode = b.phase === 2 ? "sweep" : "spawn";
        b.t = 0;
        b.mem[0] = 0;
      }
      break;
    }
    case "sweep": {
      // A rotating vine arm — each segment telegraphed ahead of the sweep.
      if (b.t % 24 === 0 && b.mem[0] < 10) {
        const a = b.mem[1] + (b.mem[0] * Math.PI) / 5;
        zl(state, b.x + Math.cos(a) * 26, b.y + Math.sin(a) * 26, b.x + Math.cos(a) * 88, b.y + Math.sin(a) * 88, 14, Math.max(30, floor), 2, "vine");
        b.mem[0]++;
      }
      if (b.mem[0] >= 10 && b.t >= 10 * 24 + 40) {
        b.mode = "spawn";
        b.t = 0;
        b.mem[0] = 0;
        b.mem[1] = rng.range(0, Math.PI * 2);
      }
      break;
    }
    case "spawn": {
      addMinion(state, "addSapling", b.x - 30, b.y + 20, b.phase === 2 ? 3 : 2);
      addMinion(state, "addSapling", b.x + 30, b.y + 20, b.phase === 2 ? 3 : 2);
      b.mode = "rest";
      b.t = 0;
      break;
    }
    case "rest":
      if (b.t >= 60) {
        b.mode = "idle";
        b.t = 0;
      }
      break;
  }
}

// ---- 3. THE HARBORMASTER ----------------------------------------------

function stepHeron(state: GameState, b: BossState, rng: Rng, floor: number): void {
  const windup = Math.max(24, floor);
  b.vulnerable = b.mode === "preen" || b.mode === "dive";
  switch (b.mode) {
    case "idle":
      b.mode = "strut";
      b.t = 0;
      b.mem[1] = 0;
      break;
    case "strut": {
      // Walk the dock (top edge), out of sword reach.
      b.y += (28 - b.y) * 0.2;
      const targetX = CX + Math.sin(b.t / 50) * 110;
      b.vx = (targetX - b.x) * 0.06;
      b.vy = 0;
      b.faceAng = toPlayer(b, state);
      if (b.t >= 70) {
        b.mem[1]++;
        b.t = 0;
        if (b.mem[1] % 4 === 0) {
          b.mode = "diveTele";
          b.vx = 0;
        } else {
          b.mode = "volley";
        }
      }
      break;
    }
    case "volley":
      if (b.t === windup) {
        fan(state, b.x, b.y, toPlayer(b, state), b.phase === 2 ? 5 : 3, b.phase === 2 ? 30 : 15, 130, "bubble");
      }
      if (b.t >= windup + 12) {
        b.mode = "strut";
        b.t = 0;
      }
      break;
    case "diveTele": {
      if (b.t === 1) {
        const ang = toPlayer(b, state);
        b.mem[2] = ang;
        zl(state, b.x, b.y, b.x + Math.cos(ang) * 320, b.y + Math.sin(ang) * 320, 16, Math.max(36, floor), 0, "wake");
      }
      if (b.t >= Math.max(36, floor)) {
        b.mode = "dive";
        b.t = 0;
      }
      break;
    }
    case "dive":
      go(b, b.mem[2], 300);
      if (b.phase === 2 && b.t % 12 === 0 && b.t < 40) {
        zc(state, b.x, b.y, 14, 30, 2, "geyser");
      }
      if (b.y > ROOM_PX_H - 50 || b.t > 45 || b.mem[5] === 1) {
        b.mem[5] = 0;
        b.vx = 0;
        b.vy = 0;
        b.mode = "preen";
        b.t = 0;
      }
      break;
    case "preen":
      if (b.t >= 120) {
        b.mode = "return";
        b.t = 0;
      }
      break;
    case "return":
      go(b, Math.atan2(28 - b.y, CX - b.x), 200);
      if (b.y <= 34) {
        b.mode = "strut";
        b.t = 0;
      }
      break;
  }
}

// ---- 4. THE LANDLORD --------------------------------------------------

function stepToad(state: GameState, b: BossState, rng: Rng, floor: number): void {
  b.vulnerable = b.mode === "rest" || b.mode === "crouch";
  const crouch = Math.max(24, floor);
  switch (b.mode) {
    case "idle":
      b.mode = "crouch";
      b.t = 0;
      break;
    case "crouch":
      b.faceAng = toPlayer(b, state);
      if (b.t >= crouch) {
        b.mode = "hop";
        b.t = 0;
        b.mem[0] = state.player.x;
        b.mem[1] = state.player.y;
        // The landing marker appears at launch and grows for the flight.
        const z = zc(state, b.mem[0], b.mem[1], 22, 30, 2, "hopmark");
        void z;
      }
      break;
    case "hop": {
      const t = b.t / 30;
      if (b.t <= 30) {
        b.x = b.x + (b.mem[0] - b.x) * 0.15;
        b.y = b.y + (b.mem[1] - b.y) * 0.15 - Math.sin(t * Math.PI) * 2;
      }
      if (b.t === 30) {
        // Landing leaves a poison pool.
        const pool = zc(state, b.x, b.y, 16, 0, 1, "poison", 300);
        void pool;
        if (b.phase === 2 && b.mem[2] === 0) {
          b.mem[2] = 1;
          b.mode = "crouch";
          b.t = crouch - 10;
          break;
        }
        b.mem[2] = 0;
        b.mode = "tongueTele";
        b.t = 0;
        if (b.phase === 2) {
          for (let i = 0; i < 4; i++) {
            zc(state, state.player.x + rng.range(-60, 60), state.player.y + rng.range(-60, 60), 12, Math.max(30, floor), 2, "geyser");
          }
        }
      }
      break;
    }
    case "tongueTele": {
      if (b.t === 1) {
        const ang = toPlayer(b, state);
        b.mem[3] = ang;
        zl(state, b.x, b.y, b.x + Math.cos(ang) * 95, b.y + Math.sin(ang) * 95, 10, Math.max(24, floor), 2, "tongue");
      }
      if (b.t >= Math.max(24, floor) + 10) {
        b.mode = "rest";
        b.t = 0;
      }
      break;
    }
    case "rest":
      if (b.t >= 60) {
        b.mode = "crouch";
        b.t = 0;
      }
      break;
  }
}

// ---- 5. THE ZAMBONI ---------------------------------------------------

function stepZamboni(state: GameState, b: BossState, rng: Rng, floor: number): void {
  b.vulnerable = b.mode === "vent";
  const lead = Math.max(45, floor);
  switch (b.mode) {
    case "idle":
      b.mode = "aim";
      b.t = 0;
      break;
    case "aim": {
      if (b.t === 1) {
        // Pick a row or column through the player.
        const horizontal = rng.chance(0.5);
        b.mem[0] = horizontal ? 1 : 0;
        if (horizontal) {
          b.mem[1] = state.player.y;
          zr(state, 16, b.mem[1] - 14, ROOM_PX_W - 16, b.mem[1] + 14, lead, 2, "stripe", 40);
        } else {
          b.mem[1] = state.player.x;
          zr(state, b.mem[1] - 14, 16, b.mem[1] + 14, ROOM_PX_H - 16, lead, 2, "stripe", 40);
        }
      }
      if (b.t >= lead) {
        b.mode = "sweep";
        b.t = 0;
        // Teleport to the stripe's start (it drove around the back).
        if (b.mem[0] === 1) {
          b.x = 24;
          b.y = b.mem[1];
          b.mem[2] = 0;
        } else {
          b.x = b.mem[1];
          b.y = 24;
          b.mem[2] = Math.PI / 2;
        }
      }
      break;
    }
    case "sweep": {
      go(b, b.mem[2], 220);
      b.faceAng = b.mem[2];
      if (b.phase === 2 && b.t % 40 === 0) {
        ring(state, b.x, b.y, 8, 110);
      }
      const done = b.mem[0] === 1 ? b.x > ROOM_PX_W - 28 : b.y > ROOM_PX_H - 28;
      if (done || b.t > 120) {
        b.vx = 0;
        b.vy = 0;
        b.mem[3]++;
        if (b.mem[3] % 2 === 0 && b.phase === 1) {
          ring(state, b.x, b.y, 6, 110);
        }
        const passes = b.phase === 2 ? 3 : 2;
        if (b.mem[3] % passes === 0) {
          b.mode = "vent";
          b.t = 0;
        } else {
          b.mode = "aim";
          b.t = 0;
        }
      }
      break;
    }
    case "vent":
      if (b.t >= (b.phase === 2 ? 150 : 90)) {
        b.mode = "aim";
        b.t = 0;
      }
      break;
  }
}

// ---- 6. THE FOREMAN ---------------------------------------------------

function stepForeman(state: GameState, b: BossState, rng: Rng, floor: number): void {
  b.vulnerable = b.mode === "rest" || b.mode === "idle";
  const windup = Math.max(30, floor);
  switch (b.mode) {
    case "idle":
      b.faceAng = toPlayer(b, state);
      go(b, b.faceAng, 26);
      if (b.t >= 50) {
        b.mode = "slam";
        b.t = 0;
        b.vx = 0;
        b.vy = 0;
      }
      break;
    case "slam": {
      if (b.t === 1) {
        const n1 = rng.range(0, Math.PI * 2);
        zring(state, b.x, b.y, 56, windup, 2, n1, n1 + Math.PI);
        if (b.phase === 2) {
          const n2 = rng.range(0, Math.PI * 2);
          const z = zring(state, b.x, b.y, 84, windup + 30, 2, n2, n2 + Math.PI);
          void z;
        }
      }
      if (b.t >= windup + (b.phase === 2 ? 40 : 10)) {
        b.mode = "embers";
        b.t = 0;
        b.mem[0] = 0;
      }
      break;
    }
    case "embers": {
      const count = b.phase === 2 ? 5 : 3;
      if (b.t % 14 === 0 && b.mem[0] < count) {
        zc(state, state.player.x + rng.range(-50, 50), state.player.y + rng.range(-50, 50), 13, Math.max(40, floor), 2, "ember");
        b.mem[0]++;
      }
      if (b.mem[0] >= count && b.t >= count * 14 + Math.max(40, floor)) {
        b.mode = "rest";
        b.t = 0;
      }
      break;
    }
    case "rest":
      if (b.t >= 60) {
        b.mode = "idle";
        b.t = 0;
      }
      break;
  }
}

// ---- 7. THE ANTLION EMERITUS ------------------------------------------

function stepAntlion(state: GameState, b: BossState, rng: Rng, floor: number): void {
  b.vulnerable = b.mode === "surfaced";
  switch (b.mode) {
    case "idle":
      b.mode = "mound";
      b.t = 0;
      break;
    case "mound": {
      b.faceAng = toPlayer(b, state);
      go(b, b.faceAng, 70);
      if (b.phase === 2 && b.t === 1 && b.mem[3] === 0) {
        b.mem[3] = 1; // decoys exist (rendered off mem; they never erupt)
      }
      if (b.t >= 90 || playerDist(b, state) < 30) {
        b.mode = "spray";
        b.t = 0;
        b.vx = 0;
        b.vy = 0;
        zc(state, b.x, b.y, b.phase === 2 ? 34 : 28, Math.max(24, floor), 2, "erupt");
      }
      break;
    }
    case "spray":
      if (b.t >= Math.max(24, floor)) {
        b.mode = "surfaced";
        b.t = 0;
        b.mem[0] = 0;
      }
      break;
    case "surfaced": {
      b.faceAng = toPlayer(b, state);
      if (b.t % 45 === 20 && b.mem[0] < 2) {
        zc(state, state.player.x + rng.range(-40, 40), state.player.y + rng.range(-40, 40), 12, Math.max(30, floor), 2, "glob");
        b.mem[0]++;
      }
      if (b.phase === 2 && b.t === 60) {
        ring(state, b.x, b.y, 6, 110, "pellet");
      }
      if (b.t >= 120) {
        b.mode = "mound";
        b.t = 0;
      }
      break;
    }
  }
}

// ---- 8. THE ARCHIVIST -------------------------------------------------

function stepArchivist(state: GameState, b: BossState, rng: Rng, floor: number): void {
  // Lit = solid. The tick pipeline gates damage on b.vulnerable.
  const p = state.player;
  const d = playerDist(b, state);
  const toB = Math.atan2(b.y - p.y, b.x - p.x);
  const inCone =
    d < (p.gear.includes("oil") ? 150 : 110) &&
    Math.abs(angDiff(toB, p.faceAng)) <= (p.gear.includes("oil") ? 0.86 : 0.66);
  b.vulnerable = inCone || state.tick < p.flashUntil;

  // Drift away from the cone's centreline.
  const fleeAng = p.faceAng + (angDiff(toB, p.faceAng) > 0 ? 1.2 : -1.2);
  go(b, fleeAng, b.phase === 2 ? 60 : 45);
  b.faceAng = toPlayer(b, state);

  const wispEvery = b.phase === 2 ? 180 : 240;
  if (b.t % wispEvery === 0 && b.t > 0) {
    const n = b.phase === 2 ? 5 : 3;
    for (let i = 0; i < n; i++) {
      fireShot(state, b.x, b.y, rng.range(0, Math.PI * 2), 90, 2, "wisp", 0.06, 300);
    }
  }
  const shelfEvery = 480;
  if (b.t % shelfEvery === 200) {
    const n = b.phase === 2 ? 4 : 3;
    for (let i = 0; i < n; i++) {
      const x = p.x + rng.range(-70, 70);
      const y = p.y + rng.range(-50, 50);
      zr(state, x - 12, y - 20, x + 12, y + 20, Math.max(40, floor), 2, "shelf");
    }
  }
  if (b.phase === 2 && b.t % 300 === 150) {
    // Re-shelve: teleport with a puff, breaking cone lock.
    b.x = 60 + rng.next() * (ROOM_PX_W - 120);
    b.y = 50 + rng.next() * (ROOM_PX_H - 100);
  }
}

// ---- 9. THE PLAYTESTER ------------------------------------------------

function stepPlaytester(state: GameState, b: BossState, rng: Rng, floor: number): void {
  const speed = b.mem[4] > 0 && b.t < b.mem[4] ? 130 : 100;
  b.vulnerable = b.mode !== "parry";
  const windup = Math.max(20, floor);
  switch (b.mode) {
    case "idle": {
      b.faceAng = toPlayer(b, state);
      go(b, b.faceAng, speed);
      const d = playerDist(b, state);
      if (b.phase === 2 && d < 30 && rng.chance(0.04)) {
        b.mode = "whirlTele";
        b.t = 0;
        b.vx = 0;
        b.vy = 0;
        break;
      }
      if (d < 34) {
        b.mode = "swordTele";
        b.t = 0;
        b.vx = 0;
        b.vy = 0;
      } else if (b.t > 60 && rng.chance(0.03)) {
        b.mode = rng.chance(0.5) ? "fanTele" : "dashTele";
        b.t = 0;
        b.vx = 0;
        b.vy = 0;
      } else if (b.phase === 2 && b.t > 45 && rng.chance(0.012)) {
        b.mode = "parry";
        b.t = 0;
        b.vx = 0;
        b.vy = 0;
      }
      break;
    }
    case "swordTele":
      b.faceAng = toPlayer(b, state);
      if (b.t === 1) {
        const a = toPlayer(b, state);
        zc(state, b.x + Math.cos(a) * 18, b.y + Math.sin(a) * 18, 18, windup, 2, "slash");
      }
      if (b.t >= windup + 8) {
        b.mode = "idle";
        b.t = 0;
      }
      break;
    case "fanTele":
      if (b.t >= Math.max(24, floor)) {
        fan(state, b.x, b.y, toPlayer(b, state), 3, 24, 200, "dagger");
        b.mode = "idle";
        b.t = 0;
      }
      break;
    case "dashTele": {
      if (b.t === 1) {
        const a = toPlayer(b, state);
        b.mem[0] = a;
        zl(state, b.x, b.y, b.x + Math.cos(a) * 130, b.y + Math.sin(a) * 130, 12, Math.max(30, floor), 2, "wake");
      }
      if (b.t >= Math.max(30, floor)) {
        b.mode = "dash";
        b.t = 0;
      }
      break;
    }
    case "dash":
      go(b, b.mem[0], 300);
      if (b.t >= 26 || b.mem[5] === 1) {
        b.mem[5] = 0;
        b.vx = 0;
        b.vy = 0;
        b.mode = "idle";
        b.t = 0;
      }
      break;
    case "whirlTele":
      if (b.t >= Math.max(24, floor)) {
        zc(state, b.x, b.y, 34, 2, 2, "whirl");
        b.mode = "idle";
        b.t = 0;
      }
      break;
    case "parry":
      // Glowing stance — melee into it staggers the player (tick handles).
      if (b.t >= 45) {
        b.mode = "idle";
        b.t = 0;
      }
      break;
  }
  // Overclock at 25%: telegraphed by the announce flag; render strobes
  // (or holds a steady outline under reduced motion).
  if (b.hp <= b.maxHp * 0.25 && b.mem[4] === 0) {
    b.mem[4] = b.t + 240;
  }
  // Dodge roll after eating hits: tick increments mem[2] on damage.
  if (b.mem[2] >= 8 && b.mode === "idle") {
    b.mem[2] = 0;
    const away = toPlayer(b, state) + Math.PI + rng.range(-0.8, 0.8);
    b.x += Math.cos(away) * 30;
    b.y += Math.sin(away) * 30;
  }
}

// ---- 10. THE PROPRIETOR -----------------------------------------------

function stepProprietor(state: GameState, b: BossState, rng: Rng, floor: number): void {
  b.x = CX;
  b.y = 52;
  b.vx = 0;
  b.vy = 0;
  const lead = Math.max(40, floor);
  b.vulnerable = b.mode !== "beam";

  if (b.phase === 1) {
    // Attract mode: marquee beams + hologram waves.
    if (b.t % 200 === 60) {
      const x = state.player.x + rng.range(-30, 30);
      zr(state, x - 14, 16, x + 14, ROOM_PX_H - 16, lead, 2, "beam", 20);
    }
    if (b.t % 480 === 240) {
      addMinion(state, "cartling", CX - 60, 90, 3);
      addMinion(state, "cartling", CX + 60, 90, 3);
    }
  } else if (b.phase === 2) {
    // Service mode: the UI attacks.
    if (b.t % 260 === 40) {
      for (let i = 0; i < 3; i++) {
        const x = 50 + rng.next() * (ROOM_PX_W - 100);
        const y = 60 + rng.next() * (ROOM_PX_H - 100);
        zr(state, x - 14, y - 14, x + 14, y + 14, Math.max(45, floor), 2, "letter");
      }
    }
    if (b.t % 260 === 170) {
      const y = state.player.y;
      zr(state, 16, y - 12, ROOM_PX_W - 16, y + 12, lead, 2, "healthbar", 30);
    }
    if (b.t % 300 === 150) {
      for (let i = 0; i < 4; i++) {
        fireShot(state, b.x, b.y + 20, rng.range(0, Math.PI * 2), 80, 2, "fakecoin", 0.05, 240);
      }
    }
  } else {
    // Free play: borrow one earlier pattern per channel, never two at once.
    const interval = b.hp <= b.maxHp * 0.1 ? 225 : 300;
    if (b.t % interval === 30) {
      b.mem[0] = (b.mem[0] + 1) % 6;
      const pick = b.mem[0];
      const p = state.player;
      if (pick === 0) {
        for (let i = 0; i < 3; i++) {
          const ang = toPlayer(b, state) + rng.range(-0.5, 0.5);
          zl(state, b.x, b.y, b.x + Math.cos(ang) * 300, b.y + Math.sin(ang) * 300, 12, Math.max(30, floor), 2, "root");
        }
      } else if (pick === 1) {
        fan(state, b.x, b.y + 20, toPlayer(b, state), 5, 30, 130, "bubble");
      } else if (pick === 2) {
        const n1 = rng.range(0, Math.PI * 2);
        zring(state, p.x, p.y, 56, lead, 2, n1, n1 + Math.PI);
      } else if (pick === 3) {
        ring(state, b.x, b.y + 30, 8, 110);
      } else if (pick === 4) {
        for (let i = 0; i < 3; i++) {
          fireShot(state, b.x, b.y + 20, rng.range(0, Math.PI * 2), 90, 2, "wisp", 0.06, 280);
        }
      } else {
        for (let i = 0; i < 6; i++) {
          zc(state, p.x + rng.range(-70, 70), p.y + rng.range(-50, 50), 12, Math.max(30, floor), 2, "ember");
        }
      }
    }
  }
}
