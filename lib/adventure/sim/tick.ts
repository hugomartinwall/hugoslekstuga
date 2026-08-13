import { heroStats } from "../content/upgrades";
import { worldDef } from "../content/worlds";
import { ghostLit, makeMinion, stepEnemy } from "./ai";
import { stepBoss } from "./boss";
import {
  circleHitsSolid,
  circlesOverlap,
  clampToRoom,
  currentFlow,
  moveAndSlide,
  sectorHits,
  separate,
  tileUnder,
} from "./collision";
import { ROOM_W, T, TILE } from "./rooms";
import { Rng } from "./rng";
import { F, type Entity, type GameState, type Intent, type Zone } from "./state";

export const TICK_HZ = 60;
export const TICK_MS = 1000 / TICK_HZ;

// ---- combat frame data (ticks @ 60/s) --------------------------------
export const SWING_WINDUP = 5;
export const SWING_ACTIVE = 6;
export const SWING_RECOVER = 3;
export const CHARGE_HOLD = 30;
export const DODGE_TICKS = 18;
export const DODGE_IFRAME_START = 2; // i-frames t2–11
export const DODGE_IFRAME_END = 11;
export const DODGE_DIST = 56;
export const HURT_IFRAMES = 45;
export const HIT_STOP = 3;
export const PARRY_ACTIVE = 12;
export const PARRY_RECOVER = 20;
export const PARRY_CD = 45;
export const DAGGER_CD = 24;
export const DASH_CD = 90;
export const DASH_TICKS = 18;
export const WHIRL_TICKS = 36;
export const WHIRL_CD = 120;
export const BOMB_CD = 90;
export const BOMB_FUSE = 60;
export const FLASH_CD = 480;
export const FLASH_LIT = 180;
export const OVERCLOCK_CD = 1200;
export const OVERCLOCK_TICKS = 180;
export const STAGGER_TICKS = 30;
// Out-of-combat regen: stay unhit this long, then hearts trickle back.
// A scrappy room costs tempo, not the run; burst damage still threatens
// because nothing regens while you're being hurt (or standing in bog).
export const REGEN_GRACE = 180; // 3s
export const REGEN_EVERY = 90; // +1 half-heart per 1.5s

const dropCoin = (state: GameState, x: number, y: number, rng: Rng, value = 1) => {
  state.room.coins.push({
    x,
    y,
    vx: rng.range(-1.2, 1.2),
    vy: rng.range(-1.2, 1.2),
    value,
    t: 0,
  });
};

function hurtPlayer(state: GameState, dmg: number, fromX: number, fromY: number, kb = 3): boolean {
  const p = state.player;
  if (state.tick < p.iframesUntil) return false;
  if (p.dodgeT >= DODGE_TICKS - DODGE_IFRAME_END && p.dodgeT <= DODGE_TICKS - DODGE_IFRAME_START) {
    return false; // mid-roll invulnerability
  }
  p.hp -= dmg;
  p.lastHurtAt = state.tick;
  p.iframesUntil = state.tick + HURT_IFRAMES;
  const ang = Math.atan2(p.y - fromY, p.x - fromX);
  p.kbx = Math.cos(ang) * kb;
  p.kby = Math.sin(ang) * kb;
  p.hitStop = HIT_STOP;
  if (p.hp <= 0) fatal(state);
  return true;
}

/** The killing blow — unless second wind is banked and unspent. */
function fatal(state: GameState): void {
  const p = state.player;
  if (!p.windUsed && p.gear.includes("wind")) {
    p.windUsed = true;
    p.hp = 1;
    p.iframesUntil = state.tick + HURT_IFRAMES * 2; // room to breathe
    return;
  }
  state.playerDied = true;
}

// A connected swing SHOVES — hitting something buys space. That's the
// melee contract; tune the default kb with the 0.88 decay below in mind
// (together they move a hit enemy about two tiles).
function hurtEnemy(state: GameState, e: Entity, dmg: number, fromAng: number, kb = 4.2): void {
  e.hp -= dmg;
  e.hitFlash = 4;
  e.kbx = Math.cos(fromAng) * kb;
  e.kby = Math.sin(fromAng) * kb;
}

/** A melee-class hit against an enemy, honouring shields and ghosts. */
function meleeHitEnemy(
  state: GameState,
  e: Entity,
  dmg: number,
  swingId: number,
  breaksShield: boolean,
  kbMult = 1,
): void {
  if (e.lastHitSwing === swingId) return;
  e.lastHitSwing = swingId;
  if (!ghostLit(state, e)) return; // phasing ghost — the swing passes through
  if (e.flags & F.BURROW && e.mode === "burrow") return; // mounds can't be hit
  const p = state.player;
  const fromAng = Math.atan2(e.y - p.y, e.x - p.x);
  if (e.shieldHp > 0) {
    // Frontal shield: does the hit land on the shielded face?
    const front = Math.abs(angleDiff(fromAng + Math.PI, e.faceAng)) < 1.3;
    if (front && !breaksShield) {
      e.shieldHp -= 1;
      e.hitFlash = 2;
      if (e.flags & F.HOTSHIELD) hurtPlayer(state, 1, e.x, e.y, 2);
      return;
    }
    if (front && breaksShield) e.shieldHp = 0;
  }
  hurtEnemy(state, e, dmg, fromAng, 4.2 * kbMult);
  p.hitStop = HIT_STOP;
}

function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

function explode(state: GameState, x: number, y: number, r: number, dmg: number, hurtsPlayer: boolean): void {
  for (const e of state.room.entities) {
    if (!circlesOverlap(x, y, r, e.x, e.y, e.r)) continue;
    if (e.flags & F.BURROW && e.mode === "burrow") {
      // Flushed! The bomb's whole reason to exist.
      e.mode = "stun";
      e.t = 0;
    }
    hurtEnemy(state, e, dmg, Math.atan2(e.y - y, e.x - x), 3.5);
  }
  const b = state.boss;
  if (b && !b.dead && circlesOverlap(x, y, r, b.x, b.y, b.r) && b.vulnerable) {
    b.hp -= dmg;
    b.hitFlash = 4;
    if (b.kind === "playtester") b.mem[2] += dmg;
  }
  if (hurtsPlayer && circlesOverlap(x, y, r, state.player.x, state.player.y, 6)) {
    hurtPlayer(state, 2, x, y, 4);
  }
  state.room.zones.push({
    kind: "blast",
    shape: "circle",
    x,
    y,
    x2: 0,
    y2: 0,
    r,
    w: 0,
    a1: 0,
    a2: 0,
    fireAt: state.tick,
    activeFor: 1,
    dmg: 0,
    harmless: true, // damage already applied — this zone is the flash
  });
}

/** One fixed step of the simulation. Mutates state in place. */
export function tick(state: GameState, intent: Intent): void {
  const p = state.player;

  // Hit-stop: the world holds its breath for a few ticks.
  if (p.hitStop > 0) {
    p.hitStop--;
    state.tick++;
    return;
  }

  state.tick++;
  const rng = new Rng(state.rng);
  const world = worldDef(state.world);
  const mech = state.room.mechanic;
  const stats = heroStats(p.gear);
  const overclocked = state.tick < p.overclockUntil;

  // ---- input buffers -------------------------------------------------
  if (intent.attack) p.bufAttack = 6;
  else if (p.bufAttack > 0) p.bufAttack--;
  if (intent.dodge) p.bufDodge = 8;
  else if (p.bufDodge > 0) p.bufDodge--;

  // ---- player: verbs -------------------------------------------------
  const ready = (id: string, cd: number): boolean => {
    if (!stats.has(id)) return false;
    if ((p.cool[id] ?? 0) > state.tick) return false;
    p.cool[id] = state.tick + Math.round(cd / (overclocked ? 1.5 : 1));
    return true;
  };
  const busy = p.attack.phase !== "idle" && p.attack.phase !== "charging";
  const moveAng = intent.mx || intent.my ? Math.atan2(intent.my, intent.mx) : p.faceAng;

  if (!busy && p.dodgeT <= 0) {
    if (intent.whirl && ready("whirl", WHIRL_CD)) {
      p.attack.phase = "whirl";
      p.attack.t = 0;
      p.attack.id++;
      p.attack.whirlHits = 0;
    } else if (intent.dash && ready("dash", DASH_CD)) {
      p.attack.phase = "dashing";
      p.attack.t = 0;
      p.attack.ang = moveAng;
      p.attack.id++;
      p.faceAng = moveAng;
    } else if (intent.parry && ready("parry", PARRY_CD)) {
      p.parryT = PARRY_ACTIVE;
    } else if (intent.dagger && ready("dagger", DAGGER_CD)) {
      const n = stats.daggerFan ? 3 : 1;
      const spread = (20 * Math.PI) / 180;
      for (let i = 0; i < n; i++) {
        const a = n === 1 ? p.faceAng : p.faceAng - spread / 2 + (spread * i) / (n - 1);
        state.room.projectiles.push({
          x: p.x,
          y: p.y,
          vx: (Math.cos(a) * 200) / 60,
          vy: (Math.sin(a) * 200) / 60,
          r: 3,
          dmg: stats.daggerDmg,
          hostile: false,
          kind: "dagger",
          t: 0,
          ttl: 42,
          pierce: stats.daggerPierce ? 1 : 0,
          homing: 0,
        });
      }
    } else if (intent.bomb && ready("bomb", BOMB_CD)) {
      state.room.projectiles.push({
        x: p.x,
        y: p.y,
        vx: Math.cos(p.faceAng) * 1.0,
        vy: Math.sin(p.faceAng) * 1.0,
        r: 4,
        dmg: 4,
        hostile: false,
        kind: "bomb",
        t: 0,
        ttl: BOMB_FUSE,
        pierce: 0,
        homing: 0,
      });
    } else if (intent.flash && ready("flash", FLASH_CD)) {
      p.flashUntil = state.tick + FLASH_LIT;
      for (const e of state.room.entities) {
        if (Math.hypot(e.x - p.x, e.y - p.y) < 70) e.spawnGrace = Math.max(e.spawnGrace, 90);
      }
    } else if (intent.overclock && ready("overclock", OVERCLOCK_CD)) {
      p.overclockUntil = state.tick + OVERCLOCK_TICKS;
    } else if (intent.flask && p.flasks > 0 && p.hp < p.maxHp) {
      p.flasks--;
      p.hp = Math.min(p.maxHp, p.hp + 4);
    }
  }

  // ---- player: dodge -------------------------------------------------
  if (p.bufDodge > 0 && p.dodgeT <= 0 && !busy && stats.has("roll")) {
    if (p.dodgeCharges > 0) {
      p.dodgeCharges--;
      p.bufDodge = 0;
      p.dodgeT = DODGE_TICKS;
      p.dodgeAng = moveAng;
      if (p.attack.phase === "charging") p.attack.phase = "idle";
    }
  }
  if (p.dodgeCharges < stats.rollCharges && state.tick >= p.dodgeReadyAt && p.dodgeT <= 0) {
    p.dodgeCharges = stats.rollCharges;
  }

  // ---- player: sword state machine ----------------------------------
  const atkSpeed = overclocked ? 1.5 : 1;
  const a = p.attack;
  switch (a.phase) {
    case "idle":
      if (p.bufAttack > 0 && p.dodgeT <= 0) {
        p.bufAttack = 0;
        if (stats.has("charge") && intent.attackHeld) {
          a.phase = "charging";
          p.chargeT = 0;
        } else {
          a.phase = "windup";
          a.t = 0;
          a.ang = moveAng;
          a.id++;
          p.faceAng = moveAng;
        }
      }
      break;
    case "charging":
      p.chargeT++;
      a.ang = moveAng;
      p.faceAng = moveAng;
      if (!intent.attackHeld) {
        if (p.chargeT >= CHARGE_HOLD) {
          a.phase = "chargeSwing";
          a.t = 0;
          a.id++;
        } else {
          a.phase = "windup";
          a.t = 0;
          a.id++;
        }
      }
      break;
    case "windup":
      a.t += atkSpeed;
      if (a.t >= SWING_WINDUP) {
        a.phase = "swing";
        a.t = 0;
        // The classic: at full hearts the swing travels.
        if (stats.has("beam") && p.hp === p.maxHp) {
          state.room.projectiles.push({
            x: p.x,
            y: p.y,
            vx: (Math.cos(a.ang) * 220) / 60,
            vy: (Math.sin(a.ang) * 220) / 60,
            r: 4,
            dmg: 2,
            hostile: false,
            kind: "beam",
            t: 0,
            ttl: 120,
            pierce: 99,
            homing: 0,
          });
        }
      }
      break;
    case "swing":
      a.t += atkSpeed;
      if (a.t >= SWING_ACTIVE) {
        a.phase = "recover";
        a.t = 0;
      }
      break;
    case "recover":
      a.t += atkSpeed;
      if (a.t >= SWING_RECOVER) a.phase = "idle";
      break;
    case "chargeSwing":
      a.t += atkSpeed;
      if (a.t >= 8) a.phase = "recover";
      break;
    case "whirl":
      a.t += atkSpeed;
      if (a.t >= WHIRL_TICKS) a.phase = "idle";
      break;
    case "dashing":
      a.t += atkSpeed;
      if (a.t >= DASH_TICKS) a.phase = "idle";
      break;
    case "stagger":
      a.t++;
      if (a.t >= STAGGER_TICKS) a.phase = "idle";
      break;
  }
  if (p.parryT > 0) p.parryT--;

  // ---- player: movement ---------------------------------------------
  let desiredX = 0;
  let desiredY = 0;
  const tileHere = tileUnder(state.room.tiles, p.x, p.y);
  const onIce = mech === "ice" && tileHere !== T.WALL;
  {
    let spd = (stats.speed / 60) * (overclocked ? 1.5 : 1);
    if (tileHere === T.BOG) spd *= 0.6;
    if (a.phase === "windup" || a.phase === "swing" || a.phase === "recover") spd *= 0.4;
    if (a.phase === "whirl") spd *= 0.5;
    if (a.phase === "stagger") spd = 0;
    const mag = Math.min(1, Math.hypot(intent.mx, intent.my));
    if (mag > 0.01 && p.dodgeT <= 0 && a.phase !== "dashing" && a.phase !== "chargeSwing") {
      const ang = Math.atan2(intent.my, intent.mx);
      desiredX = Math.cos(ang) * spd * mag;
      desiredY = Math.sin(ang) * spd * mag;
      if (a.phase === "idle" || a.phase === "charging") p.faceAng = ang;
    }
  }
  if (p.dodgeT > 0) {
    p.dodgeT--;
    const v = DODGE_DIST / DODGE_TICKS;
    desiredX = Math.cos(p.dodgeAng) * v;
    desiredY = Math.sin(p.dodgeAng) * v;
    if (p.dodgeT === 0) {
      p.dodgeReadyAt = state.tick + stats.rollCd;
      if (p.dodgeCharges <= 0) p.dodgeCharges = 0;
    }
  }
  if (a.phase === "dashing") {
    desiredX = (Math.cos(a.ang) * 300) / 60;
    desiredY = (Math.sin(a.ang) * 300) / 60;
  }
  if (a.phase === "chargeSwing") {
    desiredX = (Math.cos(a.ang) * 300) / 60;
    desiredY = (Math.sin(a.ang) * 300) / 60;
  }

  if (onIce) {
    p.vx += (desiredX - p.vx) * 0.08;
    p.vy += (desiredY - p.vy) * 0.08;
  } else {
    p.vx = desiredX;
    p.vy = desiredY;
  }
  // Currents push everyone.
  const flow = currentFlow(state.room.tiles, p.x, p.y);
  const fx = flow ? (flow.x * 30) / 60 : 0;
  const fy = flow ? (flow.y * 30) / 60 : 0;
  // Knockback decays.
  p.kbx *= 0.85;
  p.kby *= 0.85;
  if (Math.abs(p.kbx) < 0.05) p.kbx = 0;
  if (Math.abs(p.kby) < 0.05) p.kby = 0;

  const pm = { x: p.x, y: p.y, r: 5 };
  moveAndSlide(state.room.tiles, pm, p.vx + fx + p.kbx, p.vy + fy + p.kby, state.room.cleared);
  p.x = pm.x;
  p.y = pm.y;
  clampToRoom(p, 8);

  // ---- terrain damage ------------------------------------------------
  const nowTile = tileUnder(state.room.tiles, p.x, p.y);
  if (nowTile === T.THORN && !stats.thornProof) {
    hurtPlayer(state, 2, p.x + Math.cos(p.faceAng), p.y + Math.sin(p.faceAng), 3.5);
  }
  if (nowTile === T.BOG) {
    p.bogT++;
    if (p.bogT > 30 && p.bogT % 60 === 0) {
      p.hp -= 1;
      p.lastHurtAt = state.tick;
      if (p.hp <= 0) fatal(state);
    }
  } else {
    p.bogT = 0;
  }

  // Out-of-combat regen — never while standing in bog (attrition is the
  // bog's whole identity), never while the hurt clock is fresh. The
  // blanket upgrades shorten the grace and quicken the beat.
  if (
    p.hp > 0 &&
    p.hp < p.maxHp &&
    nowTile !== T.BOG &&
    state.tick - p.lastHurtAt >= stats.regenGrace &&
    (state.tick - p.lastHurtAt - stats.regenGrace) % stats.regenEvery === 0
  ) {
    p.hp += 1;
  }

  // ---- lava tides ----------------------------------------------------
  if (mech === "lava") {
    state.hazardT++;
    const t = state.hazardT % 600;
    if (t === 0) state.hazardPhase = (state.hazardPhase + 1) % 3;
    const flooded = t >= 480;
    if (flooded) {
      const zoneTile = (T.LAVA_A + state.hazardPhase) as typeof T.LAVA_A;
      if (nowTile === zoneTile) hurtPlayer(state, 2, p.x, p.y + 4, 2);
    }
  }

  // ---- sword arcs: enemies, boss, grass, pots ------------------------
  const swingActive = a.phase === "swing" || a.phase === "chargeSwing";
  const whirlWave = a.phase === "whirl" && Math.floor(a.t) % 12 === 0;
  if (swingActive || whirlWave || a.phase === "dashing") {
    const isCharge = a.phase === "chargeSwing";
    const arcRad = a.phase === "whirl" ? Math.PI * 2 : ((isCharge ? 150 : stats.arcDeg) * Math.PI) / 180;
    const reach = a.phase === "whirl" ? 26 : stats.reach + (isCharge ? 8 : 0);
    const dmg = (isCharge ? stats.dmg * 2 : stats.dmg) * (overclocked ? 1.5 : 1);
    const swingId = a.id * 10 + (a.phase === "whirl" ? p.attack.whirlHits : 0);
    if (whirlWave) p.attack.whirlHits++;

    for (const e of state.room.entities) {
      if (e.hp <= 0) continue;
      if (!sectorHits(p.x, p.y, a.ang, reach, arcRad, e.x, e.y, e.r)) continue;
      meleeHitEnemy(state, e, Math.round(dmg), swingId, isCharge || a.phase === "dashing", stats.kbMult);
    }
    const b = state.boss;
    if (b && !b.dead && b.lastHitSwing !== swingId && sectorHits(p.x, p.y, a.ang, reach + 6, arcRad, b.x, b.y, b.r)) {
      b.lastHitSwing = swingId;
      if (b.kind === "playtester" && b.mode === "parry") {
        // It parried you. Rude. Effective.
        a.phase = "stagger";
        a.t = 0;
        const ang = Math.atan2(p.y - b.y, p.x - b.x);
        p.kbx = Math.cos(ang) * 4;
        p.kby = Math.sin(ang) * 4;
      } else if (b.vulnerable) {
        b.hp -= Math.round(dmg);
        b.hitFlash = 4;
        p.hitStop = HIT_STOP;
        if (b.kind === "playtester") b.mem[2] += dmg;
      } else {
        b.hitFlash = 1; // clink
      }
    }
    // Cut grass, break pots.
    if (swingActive) {
      const minTx = Math.max(0, Math.floor((p.x - reach - 8) / TILE));
      const maxTx = Math.min(ROOM_W - 1, Math.floor((p.x + reach + 8) / TILE));
      for (let ty = Math.max(0, Math.floor((p.y - reach - 8) / TILE)); ty <= Math.floor((p.y + reach + 8) / TILE); ty++) {
        for (let tx = minTx; tx <= maxTx; tx++) {
          const idx = ty * ROOM_W + tx;
          const tile = state.room.tiles[idx];
          if (tile !== T.GRASS && tile !== T.POT) continue;
          const cx = tx * TILE + TILE / 2;
          const cy = ty * TILE + TILE / 2;
          if (!sectorHits(p.x, p.y, a.ang, reach + 4, arcRad, cx, cy, 7)) continue;
          state.room.tiles[idx] = T.FLOOR;
          if (tile === T.POT) {
            dropCoin(state, cx, cy, rng);
          } else {
            const hidden = state.room.hidden[idx];
            if (hidden === 1) dropCoin(state, cx, cy, rng);
            else if (hidden === 2) state.room.entities.push(makeMinion(state, "litter", cx, cy));
            state.room.hidden[idx] = 0;
          }
        }
      }
    }
  }

  // ---- enemies -------------------------------------------------------
  const ctx = { floor: world.telegraphFloor, dark: mech === "dark", ice: mech === "ice", rng };
  for (const e of state.room.entities) {
    if (e.hp <= 0) continue;
    e.hitFlash = Math.max(0, e.hitFlash - 1);
    if (e.spawnGrace > 0) {
      e.spawnGrace--;
      continue;
    }
    const { dvx, dvy } = stepEnemy(state, e, ctx);
    let evx = dvx;
    let evy = dvy;
    if (ctx.ice && !(e.flags & F.CRAMPONS)) {
      e.vx += (dvx - e.vx) * 0.08;
      e.vy += (dvy - e.vy) * 0.08;
      evx = e.vx;
      evy = e.vy;
    } else {
      e.vx = dvx;
      e.vy = dvy;
    }
    const eFlow = currentFlow(state.room.tiles, e.x, e.y);
    if (eFlow) {
      evx += (eFlow.x * 30) / 60;
      evy += (eFlow.y * 30) / 60;
    }
    e.kbx *= 0.88;
    e.kby *= 0.88;
    const phasing = e.flags & F.PHASEDARK && !ghostLit(state, e);
    if (phasing) {
      // Ghosts ignore walls.
      e.x += evx + e.kbx;
      e.y += evy + e.kby;
      clampToRoom(e, 10);
    } else {
      const em = { x: e.x, y: e.y, r: e.r };
      moveAndSlide(state.room.tiles, em, evx + e.kbx, evy + e.kby, state.room.cleared);
      e.x = em.x;
      e.y = em.y;
    }

    // Contact damage (mounds and graced spawns don't bite).
    const canTouch = !(e.flags & F.BURROW && e.mode === "burrow") && e.touchDmg > 0;
    if (canTouch && circlesOverlap(e.x, e.y, e.r * 0.8, p.x, p.y, 5)) {
      if (p.parryT > 0) {
        // Parried: the attacker staggers and is briefly harmless.
        const ang = Math.atan2(e.x - p.x, 0) || 0;
        e.kbx = Math.cos(Math.atan2(e.y - p.y, e.x - p.x)) * 4.5;
        e.kby = Math.sin(Math.atan2(e.y - p.y, e.x - p.x)) * 4.5;
        e.spawnGrace = 60;
        e.hitFlash = 4;
        void ang;
      } else {
        hurtPlayer(state, e.touchDmg, e.x, e.y);
      }
    }
  }
  // Separate overlapping enemies (skip phasing ghosts and mounds).
  const ents = state.room.entities;
  for (let i = 0; i < ents.length; i++) {
    for (let j = i + 1; j < ents.length; j++) {
      const A = ents[i];
      const B = ents[j];
      if (A.hp <= 0 || B.hp <= 0) continue;
      if (A.flags & F.BURROW || B.flags & F.BURROW) continue;
      separate(A, B);
    }
  }

  // ---- boss ----------------------------------------------------------
  if (state.boss && !state.boss.dead) {
    stepBoss(state, rng);
    const b = state.boss;
    if (!b.dead && b.contactDmg > 0 && !b.contactHarmless && b.kind !== "archivist") {
      if (circlesOverlap(b.x, b.y, b.r * 0.85, p.x, p.y, 5)) {
        hurtPlayer(state, b.contactDmg, b.x, b.y, 4);
      }
    }
    if (b.hp <= 0) {
      b.dead = true;
      state.bossDownAt = state.tick;
      state.room.zones.length = 0;
      state.room.projectiles = state.room.projectiles.filter((pr) => !pr.hostile);
      const bonus = world.bossCoins;
      for (let i = 0; i < bonus; i++) dropCoin(state, b.x, b.y, rng);
      state.room.cleared = true;
    }
  }

  // ---- projectiles ---------------------------------------------------
  const projectiles = state.room.projectiles;
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const pr = projectiles[i];
    pr.t++;
    if (pr.homing > 0 && pr.hostile) {
      const ang = Math.atan2(p.y - pr.y, p.x - pr.x);
      const cur = Math.atan2(pr.vy, pr.vx);
      const next = cur + Math.max(-pr.homing, Math.min(pr.homing, angleDiff(ang, cur)));
      const spd = Math.hypot(pr.vx, pr.vy);
      pr.vx = Math.cos(next) * spd;
      pr.vy = Math.sin(next) * spd;
    }
    const prFlow = currentFlow(state.room.tiles, pr.x, pr.y);
    pr.x += pr.vx + (prFlow ? (prFlow.x * 30) / 60 : 0);
    pr.y += pr.vy + (prFlow ? (prFlow.y * 30) / 60 : 0);

    let dead = pr.t >= pr.ttl;
    if (pr.kind === "bomb") {
      pr.vx *= 0.94;
      pr.vy *= 0.94;
      if (dead) explode(state, pr.x, pr.y, 40, pr.dmg, true);
    } else if (circleHitsSolid(state.room.tiles, pr.x, pr.y, pr.r, state.room.cleared)) {
      dead = true;
    }

    if (!dead && pr.kind !== "bomb") {
      if (pr.hostile) {
        if (p.parryT > 0 && stats.has("parry") && circlesOverlap(pr.x, pr.y, pr.r + 12, p.x, p.y, 6)) {
          // Returned to sender, with interest.
          pr.hostile = false;
          pr.dmg *= 2;
          pr.vx = -pr.vx * 1.2;
          pr.vy = -pr.vy * 1.2;
          pr.homing = 0;
          pr.kind = "riposte";
        } else if (circlesOverlap(pr.x, pr.y, pr.r, p.x, p.y, 5)) {
          if (hurtPlayer(state, pr.dmg, pr.x - pr.vx * 4, pr.y - pr.vy * 4)) {
            if (pr.kind === "glob") {
              state.room.zones.push({
                kind: "poison", shape: "circle", x: pr.x, y: pr.y, x2: 0, y2: 0, r: 12, w: 0, a1: 0, a2: 0,
                fireAt: state.tick, activeFor: 180, dmg: 1, harmless: false,
              });
            }
            dead = true;
          }
        } else if (pr.kind === "glob" && pr.t >= pr.ttl - 1) {
          state.room.zones.push({
            kind: "poison", shape: "circle", x: pr.x, y: pr.y, x2: 0, y2: 0, r: 12, w: 0, a1: 0, a2: 0,
            fireAt: state.tick, activeFor: 180, dmg: 1, harmless: false,
          });
        }
      } else {
        // Player shot vs enemies and boss.
        for (const e of state.room.entities) {
          if (e.hp <= 0 || dead) continue;
          if (!circlesOverlap(pr.x, pr.y, pr.r, e.x, e.y, e.r)) continue;
          if (!ghostLit(state, e)) continue;
          if (e.flags & F.BURROW && e.mode === "burrow") continue;
          if (e.shieldHp > 0) {
            const fromAng = Math.atan2(e.y - pr.y, e.x - pr.x);
            if (Math.abs(angleDiff(fromAng + Math.PI, e.faceAng)) < 1.3) {
              e.shieldHp -= 1;
              e.hitFlash = 2;
              dead = true;
              continue;
            }
          }
          hurtEnemy(state, e, pr.dmg, Math.atan2(pr.vy, pr.vx), 1.5);
          if (pr.pierce > 0) pr.pierce--;
          else dead = true;
        }
        const b = state.boss;
        if (b && !b.dead && !dead && circlesOverlap(pr.x, pr.y, pr.r + 2, b.x, b.y, b.r)) {
          if (b.vulnerable) {
            b.hp -= pr.dmg;
            b.hitFlash = 4;
            if (b.kind === "playtester") b.mem[2] += pr.dmg;
          } else {
            b.hitFlash = 1;
          }
          if (pr.pierce > 0) pr.pierce--;
          else dead = true;
        }
      }
    }
    if (dead) projectiles.splice(i, 1);
  }

  // ---- zones ---------------------------------------------------------
  const zones = state.room.zones;
  for (let i = zones.length - 1; i >= 0; i--) {
    const z = zones[i];
    if (state.tick >= z.fireAt && state.tick < z.fireAt + z.activeFor && !z.harmless) {
      if (zoneContains(z, p.x, p.y)) hurtPlayer(state, z.dmg, z.x, z.y + 8, 2.5);
    }
    if (state.tick >= z.fireAt + z.activeFor) zones.splice(i, 1);
  }

  // ---- deaths --------------------------------------------------------
  for (let i = ents.length - 1; i >= 0; i--) {
    const e = ents[i];
    if (e.hp > 0) continue;
    if (e.arch === "exploder") {
      explode(state, e.x, e.y, e.flags & F.BIGBLAST ? 44 : 36, 2, true);
    }
    if (e.arch === "splitter") {
      for (const dx of [-8, 8]) {
        const shard = makeMinion(state, "shard", e.x + dx, e.y);
        shard.kind = "shard";
        if (e.flags & F.BOGFAST) shard.flags |= F.BOGFAST;
        ents.push(shard);
      }
    }
    for (let c = 0; c < e.coins; c++) dropCoin(state, e.x, e.y, rng);
    ents.splice(i, 1);
  }

  // ---- coins ---------------------------------------------------------
  const coins = state.room.coins;
  for (let i = coins.length - 1; i >= 0; i--) {
    const c = coins[i];
    c.t++;
    c.vx *= 0.9;
    c.vy *= 0.9;
    c.x += c.vx;
    c.y += c.vy;
    const d = Math.hypot(c.x - p.x, c.y - p.y);
    if (d < stats.magnetR && c.t > 12) {
      const ang = Math.atan2(p.y - c.y, p.x - c.x);
      const pull = Math.min(3.4, 60 / Math.max(d, 8));
      c.x += Math.cos(ang) * pull;
      c.y += Math.sin(ang) * pull;
    }
    if (d < 10 && c.t > 8) {
      p.coins += c.value;
      coins.splice(i, 1);
    }
  }

  // ---- room clear + door ---------------------------------------------
  if (!state.room.cleared && state.room.kind === "combat" && ents.length === 0) {
    state.room.cleared = true;
  }
  if (state.room.cleared && !state.pendingDoor) {
    for (const doorIdx of state.room.doorTiles) {
      const tx = doorIdx % ROOM_W;
      const ty = Math.floor(doorIdx / ROOM_W);
      if (circlesOverlap(tx * TILE + TILE / 2, ty * TILE + TILE / 2, 10, p.x, p.y, 6)) {
        state.pendingDoor = true;
        break;
      }
    }
  }

  state.rng = rng.state;
}

export function zoneContains(z: Zone, x: number, y: number): boolean {
  if (z.shape === "circle") {
    return circlesOverlap(z.x, z.y, z.r, x, y, 4);
  }
  if (z.shape === "rect") {
    return x >= z.x - 4 && x <= z.x2 + 4 && y >= z.y - 4 && y <= z.y2 + 4;
  }
  if (z.shape === "ring") {
    const d = Math.hypot(x - z.x, y - z.y);
    if (d < z.r - z.w || d > z.r + z.w) return false;
    const ang = Math.atan2(y - z.y, x - z.x);
    // Two safe notches, half-width 0.6 rad.
    for (const na of [z.a1, z.a2]) {
      if (Math.abs(angleDiff(ang, na)) < 0.6) return false;
    }
    return true;
  }
  // line: distance from segment.
  const dx = z.x2 - z.x;
  const dy = z.y2 - z.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - z.x) * dx + (y - z.y) * dy) / len2)) : 0;
  const cx = z.x + dx * t;
  const cy = z.y + dy * t;
  return Math.hypot(x - cx, y - cy) < z.w / 2 + 4;
}
