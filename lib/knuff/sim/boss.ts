/**
 * The boss: the floor polisher of 06:00 (spec §8).
 *
 * A box 120 u long in its direction of travel and 60 u across. It walks
 * eight lanes from side to side: along a lane until its leading end reaches
 * the far cushion, a stall there with the pad off, a move to the next lane
 * along the wall, and off the other way. The lanes are walked 0, 1, ... 7,
 * 6, ... 0, 1 again: an end lane is not repeated.
 *
 * Its leading end is the pad: while it moves along a lane the pad costs a
 * heart whether he is hot or landed, and throws him clear. The middle 24 u
 * of its trailing end is the plug: a hot launch hits it once, twice off a
 * cushion, and only while it moves along a lane. The rest is casing: he
 * bounces off it as off a cushion, and it never counts as one. While it is
 * stalled or changing lane every face is casing.
 *
 * A hit stalls it, coughs out three dust bunnies along a long side and
 * turns it round, faster. So the fight always ends: without a hit for 25 s
 * it speeds up all the same, and 90 s after 06:00 began the night ends
 * whether it is beaten or not.
 *
 * It moves and pushes in the substeps of `step` (§12.4 step 7), and its
 * clock runs in the night's part of the tick (step 4). Everything here that
 * changes a State is called from `step` only.
 */
import { KINDS, POLISHER } from "../content/kinds";
import { bursting, queueBurst } from "./battery";
import { armedLaunch } from "./charms";
import { endLaunch, isHot, land, loseHeart } from "./hot";
import { overlapped } from "./intruders";
import { addThing, announce, daze, farSpot, intruders } from "./night";
import type { Boss, SimEvent, State, Tune } from "./types";

/** Lanes: 0 at the top to 7 at the bottom. */
export const LANES = 8;
/** Lane `k` begins this many units below the one before it (the last lane is set against the bottom cushion). */
export const LANE_PITCH = 58;
/** The polisher is announced this long before it lands, ticks: an outline of the machine and an arrow. */
export const BOSS_TELEGRAPH = 120;
/** Half its length in its direction of travel, and half its width across, u. */
const HALF_L = POLISHER.boxL / 2;
const HALF_W = POLISHER.boxW / 2;
/** A cushion within this far ahead of the pad: the pad throws him along it instead, u. */
const THROW_ALONG_WITHIN = 60;
/** A coughed-out dust bunny's centre stands this far outside the casing, u. */
const COUGH_OUT = 12;
/** A dust bunny that trickles in during the boss stands alone, this far in from every cushion (§3.3, "alone"). */
const TRICKLE_INSET = 20;

// ── Where it is ───────────────────────────────────────────────────────

/** The polisher before 06:00: not in the room. */
export function noBoss(tune: Tune): Boss {
  return {
    present: false,
    x: 0,
    y: 0,
    px: 0,
    py: 0,
    dir: 1,
    lane: 0,
    laneStep: 1,
    speed: tune.bossSpeed,
    hp: tune.bossHits,
    mode: "arriving",
    modeUntil: -1,
    beganTick: -1,
    lastHitTick: -1,
    nextTrickleTick: -1,
    shovedTick: -1,
  };
}

/**
 * The top of lane `k`: 8 + 58k on the default floor, and the last lane set
 * against the bottom cushion (412 to 472). Neighbours overlap by 2 to 4 u,
 * so the floor is covered and no strip is left to sit in.
 */
export function laneTop(s: State, lane: number): number {
  return Math.min(s.room.top + LANE_PITCH * lane, s.room.bottom - POLISHER.boxW);
}

/** The middle of lane `k` across: where the machine's axis runs while it is in that lane. */
export function laneMiddle(s: State, lane: number): number {
  return laneTop(s, lane) + HALF_W;
}

/** The machine's box, edges in units. */
export type Box = { x0: number; y0: number; x1: number; y1: number };

export function boxOf(b: Boss): Box {
  return { x0: b.x - HALF_L, y0: b.y - HALF_W, x1: b.x + HALF_L, y1: b.y + HALF_W };
}

/** Is it solid: in the room and landed (beaten, it still stands where it stopped)? */
export function solid(b: Boss): boolean {
  return b.present && b.mode !== "arriving";
}

/** Is the pad on, and can the plug be hit? Only while it moves along a lane. */
export function live(b: Boss): boolean {
  return b.present && b.mode === "lane";
}

/** The lane it goes to next: where the arrow points while it stalls at a wall. */
export function nextLane(b: Boss): number {
  return b.lane + b.laneStep;
}

/** How far into the box a circle reaches, u: 0 when it does not overlap. For the checks and the bots. */
export function overlapDepth(b: Boss, x: number, y: number, r: number): number {
  if (!solid(b)) return 0;
  const box = boxOf(b);
  const px = x < box.x0 ? box.x0 : x > box.x1 ? box.x1 : x;
  const py = y < box.y0 ? box.y0 : y > box.y1 ? box.y1 : y;
  const dx = x - px;
  const dy = y - py;
  const d2 = dx * dx + dy * dy;
  if (d2 > 0) return Math.max(0, r - Math.sqrt(d2));
  // The centre is inside: the depth is to the nearest face, plus the radius.
  return r + Math.min(x - box.x0, box.x1 - x, y - box.y0, box.y1 - y);
}

// ── Getting out of its way ────────────────────────────────────────────

type Face = "L" | "R" | "T" | "B";

/** Where a circle stands touching face `f` from outside, the other coordinate kept; null if that is outside the floor. */
function faceSpot(s: State, box: Box, f: Face, x: number, y: number, r: number): { x: number; y: number } | null {
  const room = s.room;
  const cx = Math.min(room.right - r, Math.max(room.left + r, x));
  const cy = Math.min(room.bottom - r, Math.max(room.top + r, y));
  switch (f) {
    case "L":
      return box.x0 - r >= room.left + r ? { x: box.x0 - r, y: cy } : null;
    case "R":
      return box.x1 + r <= room.right - r ? { x: box.x1 + r, y: cy } : null;
    case "T":
      return box.y0 - r >= room.top + r ? { x: cx, y: box.y0 - r } : null;
    case "B":
      return box.y1 + r <= room.bottom - r ? { x: cx, y: box.y1 + r } : null;
  }
}

/** The nearest of these faces' spots, `prefer` first if it has one; null if none has room. */
function nearestSpot(
  s: State,
  box: Box,
  faces: readonly Face[],
  x: number,
  y: number,
  r: number,
  prefer: Face | "",
): { x: number; y: number } | null {
  if (prefer !== "" && faces.includes(prefer)) {
    const p = faceSpot(s, box, prefer, x, y, r);
    if (p) return p;
  }
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (const f of faces) {
    const p = faceSpot(s, box, f, x, y, r);
    if (!p) continue;
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

const ALL: readonly Face[] = ["L", "R", "T", "B"];
/** Out over the top or under the bottom: the way along a side cushion. Out past an end: the way along the top or bottom cushion. */
const OVER: readonly Face[] = ["T", "B"];
const PAST: readonly Face[] = ["L", "R"];

/**
 * Where a circle overlapping the box is put: out by the shortest way,
 * touching it. If that would squeeze it between the machine and a cushion,
 * it is moved along that cushion instead, to the nearest spot clear of the
 * machine (`toward` says which way, when there is a choice). `avoid` is a
 * face not to be put against while any other has room (the pad, when the
 * machine lands on top of him). Returns null when the circle does not
 * overlap the box. `nx`, `ny` is the way it was pushed: the face's normal,
 * or the corner's.
 */
function clearSpot(
  s: State,
  box: Box,
  x: number,
  y: number,
  r: number,
  toward: Face | "" = "",
  avoid: Face | "" = "",
): { x: number; y: number; nx: number; ny: number } | null {
  const px = x < box.x0 ? box.x0 : x > box.x1 ? box.x1 : x;
  const py = y < box.y0 ? box.y0 : y > box.y1 ? box.y1 : y;
  const dx = x - px;
  const dy = y - py;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return null;
  const room = s.room;
  const inFloor = (q: { x: number; y: number }) =>
    q.x >= room.left + r - 1e-9 && q.x <= room.right - r + 1e-9 && q.y >= room.top + r - 1e-9 && q.y <= room.bottom - r + 1e-9;

  if (d2 > 0 && avoid === "") {
    // Outside the box, touching it too closely: out along the line from its nearest point.
    const d = Math.sqrt(d2);
    const nx = dx / d;
    const ny = dy / d;
    const q = { x: px + nx * r, y: py + ny * r };
    if (inFloor(q)) return { ...q, nx, ny };
    // Squeezed against a cushion: along that cushion, to the nearest spot clear of the machine.
    const sideways = q.x < room.left + r || q.x > room.right - r;
    const along = sideways ? OVER : PAST;
    const p = nearestSpot(s, box, along, x, y, r, toward) ?? nearestSpot(s, box, ALL, x, y, r, toward);
    if (p) return { ...p, nx, ny };
    return { x: Math.min(room.right - r, Math.max(room.left + r, q.x)), y: Math.min(room.bottom - r, Math.max(room.top + r, q.y)), nx, ny };
  }

  // The centre is inside (or the pad is to be avoided): out through the face it is nearest.
  const faces = avoid === "" ? ALL : ALL.filter((f) => f !== avoid);
  const reach: Record<Face, number> = { L: x - box.x0, R: box.x1 - x, T: y - box.y0, B: box.y1 - y };
  let best: Face | "" = "";
  for (const f of faces) {
    if (!faceSpot(s, box, f, x, y, r)) continue;
    if (best === "" || reach[f] < reach[best]) best = f;
  }
  if (best === "" && avoid !== "" && faceSpot(s, box, avoid, x, y, r)) best = avoid;
  if (best === "") {
    const p = nearestSpot(s, box, ALL, x, y, r, toward);
    return p ? { ...p, nx: 0, ny: -1 } : null;
  }
  const p = faceSpot(s, box, best, x, y, r)!;
  const n = best === "L" ? [-1, 0] : best === "R" ? [1, 0] : best === "T" ? [0, -1] : [0, 1];
  return { ...p, nx: n[0], ny: n[1] };
}

/**
 * The intruders it meets are pushed out of its body; a token bounces off
 * it; a battery he knocked bursts on it. Pickups and gum lie where they lie.
 */
function pushThings(s: State): void {
  const box = boxOf(s.boss);
  for (let i = 0; i < s.things.length; i++) {
    const d = s.things[i];
    if (d.hp <= 0 || s.tick < d.landTick || d.kind === "pickup" || d.kind === "gum" || bursting(s, d)) continue;
    const r = KINDS[d.kind].radius;
    if (d.x + r <= box.x0 || d.x - r >= box.x1 || d.y + r <= box.y0 || d.y - r >= box.y1) continue;
    const q = clearSpot(s, box, d.x, d.y, r);
    if (!q) continue;
    if (d.kind === "battery" && d.knockTick >= 0) {
      queueBurst(s, d, "touch");
      continue;
    }
    d.x = q.x;
    d.y = q.y;
    if (d.kind === "token") {
      // It mirrors off the face as off a cushion, at its own speed.
      const into = d.vx * q.nx + d.vy * q.ny;
      if (into < 0) {
        d.vx -= 2 * into * q.nx;
        d.vy -= 2 * into * q.ny;
      }
    }
  }
}

// ── Its clock: the night's part of a tick ─────────────────────────────

/** 06:00 begins: the polisher is announced, in lane 0 at the left end, heading right. */
function announceBoss(s: State, tune: Tune): void {
  const b = s.boss;
  b.present = true;
  b.dir = 1;
  b.lane = 0;
  b.laneStep = 1;
  b.x = s.room.left + HALF_L;
  b.y = laneMiddle(s, 0);
  b.px = b.x;
  b.py = b.y;
  b.speed = tune.bossSpeed;
  b.hp = tune.bossHits;
  b.mode = "arriving";
  b.modeUntil = s.tick + BOSS_TELEGRAPH;
  b.beganTick = s.tick;
  b.lastHitTick = -1;
  b.nextTrickleTick = s.tick + tune.bossTrickleTicks;
  b.shovedTick = -1;
}

/**
 * The machine moves him: it lands on him, or a face that is not the pad
 * pushes him. The tick is kept, so that the pad does not take a heart from
 * him before he has had a telegraph to see where it has put him.
 */
function shove(s: State, x: number, y: number): void {
  const h = s.him;
  if (x === h.x && y === h.y) return;
  h.x = x;
  h.y = y;
  if (!h.hot) s.boss.shovedTick = s.tick;
}

/** It lands: whatever is inside its box, him included, is pushed out, never hurt. Not into the pad's way, while there is another way out. */
function landBoss(s: State, events: SimEvent[]): void {
  const b = s.boss;
  b.mode = "lane";
  b.modeUntil = -1;
  b.lastHitTick = s.tick;
  const box = boxOf(b);
  const pad: Face = b.dir > 0 ? "R" : "L";
  const h = s.him;
  const q = clearSpot(s, box, h.x, h.y, s.stats.radius, "", pad);
  if (q) shove(s, q.x, q.y);
  pushThings(s);
  events.push({ type: "bossArrive", tick: s.tick, x: b.x, y: b.y, lane: b.lane, dir: b.dir });
}

/**
 * The hit turn: is he landed in the way of the end that leads, his centre
 * at or beyond its plane and his circle across the lane, so that the pad
 * will meet him as it sets off? He hit the plug, which is the end that now
 * leads, and the launch he would need to get out of its way was spent on
 * the hit. So he counts as put there by the machine (`shovedTick`): for a
 * telegraph, until he launches, the pad throws him and takes no heart.
 * Flying, he is not in its way: his launch decides where he goes.
 */
function inTheWay(s: State): boolean {
  const b = s.boss;
  const h = s.him;
  if (h.hot) return false;
  const lead = b.x + b.dir * HALF_L;
  return b.dir * (h.x - lead) >= 0 && Math.abs(h.y - b.y) < HALF_W + s.stats.radius;
}

/** It sped up: after a hit, or after a long gap without one. */
function faster(s: State, tune: Tune, why: "hit" | "time", events: SimEvent[]): void {
  const b = s.boss;
  b.speed *= tune.bossSpeedUp;
  events.push({ type: "bossFaster", tick: s.tick, x: b.x, y: b.y, speed: b.speed, why });
}

/**
 * The polisher's clock, in the night's part of the tick (step 4): it is
 * announced at tick 0 of 06:00 and lands a telegraph later; stalls end; it
 * speeds up after `bossNoHitTicks` without a hit; a dust bunny is
 * announced every `bossTrickleTicks`, by the usual arrival rule.
 */
export function bossClock(s: State, tune: Tune, events: SimEvent[]): void {
  const b = s.boss;
  if (!b.present) announceBoss(s, tune);
  if (b.mode === "arriving") {
    if (s.tick >= b.modeUntil) landBoss(s, events);
  } else if (b.mode === "wallStall") {
    if (s.tick >= b.modeUntil) {
      // On to the next lane along the wall, at its current speed.
      b.mode = "laneMove";
      b.modeUntil = -1;
      events.push({ type: "bossLane", tick: s.tick, x: b.x, y: b.y, from: b.lane, lane: nextLane(b) });
    }
  } else if (b.mode === "hitStall") {
    if (s.tick >= b.modeUntil) {
      // It turns round on the spot: the pad now faces where he hit it from. And it sets off faster.
      b.dir = b.dir > 0 ? -1 : 1;
      b.mode = "lane";
      b.modeUntil = -1;
      // Landed in the way of the end that now leads, he is where the machine put him (the lead's decision 14).
      if (inTheWay(s)) b.shovedTick = s.tick;
      events.push({ type: "bossTurn", tick: s.tick, x: b.x, y: b.y, dir: b.dir });
      faster(s, tune, "hit", events);
    }
  }
  // So the fight always ends: a long gap without a hit speeds it up as a hit would, with no stall and no turn.
  if (b.mode !== "arriving" && b.mode !== "down" && b.lastHitTick >= 0 && s.tick - b.lastHitTick >= tune.bossNoHitTicks) {
    b.lastHitTick = s.tick;
    faster(s, tune, "time", events);
  }
  // One dust bunny, worth nothing, so pips can be earned back. While the room is full it does not come.
  if (b.mode !== "down" && s.tick >= b.nextTrickleTick) {
    b.nextTrickleTick += tune.bossTrickleTicks;
    if (intruders(s) < tune.roomCap) {
      const at = farSpot(s, tune, TRICKLE_INSET);
      const d = addThing(s, "bunny", at.x, at.y, s.tick + tune.telegraphTicks, 0, 0);
      d.worth0 = true;
      announce(s, d, events);
    }
  }
}

// ── Its motion: a substep of step 7 ───────────────────────────────────

/** Its leading end has reached the far cushion: it stalls with the pad off, and the arrow shows the next lane. */
function wallStall(s: State, tune: Tune, events: SimEvent[]): void {
  const b = s.boss;
  b.mode = "wallStall";
  b.modeUntil = s.tick + tune.bossLaneStallTicks;
  // An end lane is not repeated: at lane 7 it turns back up the room, at lane 0 down.
  const next = b.lane + b.laneStep;
  if (next < 0 || next >= LANES) b.laneStep = b.laneStep > 0 ? -1 : 1;
  events.push({ type: "bossStall", tick: s.tick, x: b.x, y: b.y, why: "wall", until: b.modeUntil });
}

/**
 * One substep of its motion: along the lane, or across to the next one.
 * Then the intruders that meet it are pushed out of its body, whether it
 * moved or not: stalled at a wall or after a hit it is as solid as when it
 * moves, so a dust bunny cannot walk in under it and a token cannot roll
 * through it. He is met in `bossContact`, which `step` calls next.
 */
export function moveBoss(s: State, tune: Tune, sub: number, events: SimEvent[]): void {
  const b = s.boss;
  const room = s.room;
  if (!solid(b)) return;
  if (b.mode === "lane") {
    b.x += b.dir * b.speed * sub;
    if (b.dir > 0 ? b.x + HALF_L >= room.right : b.x - HALF_L <= room.left) {
      b.x = b.dir > 0 ? room.right - HALF_L : room.left + HALF_L;
      wallStall(s, tune, events);
    }
  } else if (b.mode === "laneMove") {
    const to = nextLane(b);
    const target = laneMiddle(s, to);
    const by = b.speed * sub;
    if (Math.abs(target - b.y) <= by) {
      // In the next lane: it sets off the other way. What was the trailing end now leads.
      b.y = target;
      b.lane = to;
      b.dir = b.dir > 0 ? -1 : 1;
      b.mode = "lane";
      events.push({ type: "bossTurn", tick: s.tick, x: b.x, y: b.y, dir: b.dir });
    } else {
      b.y += target > b.y ? by : -by;
    }
  }
  pushThings(s);
}

// ── Him against it ────────────────────────────────────────────────────

/** A launch that costs no pip: the pad's throw. A new launch for the score, with carry 0. */
function throwHim(s: State, tune: Tune, vx: number, vy: number, hurt: boolean, metX: number, metY: number, events: SimEvent[]): void {
  const h = s.him;
  endLaunch(s, events);
  s.launch = {
    id: s.launch.id + 1,
    startTick: s.tick,
    active: true,
    carry: 0,
    pops: 0,
    bodyPops: 0,
    refunded: false,
    cushions: 0,
    lastCushionTick: -1,
    coin: false,
    sparkUntil: -1,
    bumped: [],
    hit: [],
    thrown: true,
    points: 0,
    blocked: overlapped(s),
    vPops: [],
    armed: armedLaunch(s),
    took: false,
    popped: false,
  };
  h.vx = vx;
  h.vy = vy;
  h.hot = isHot(s, tune, Math.hypot(vx, vy));
  events.push({ type: "bossThrow", tick: s.tick, x: metX, y: metY, tx: h.x, ty: h.y, vx, vy, hurt });
}

/**
 * The pad. It costs a heart whether he is hot or landed (`padHurtsHot`
 * off: only landed), unless he is invulnerable, and either way it throws
 * him: straight ahead of the pad, or, with a cushion within 60 u ahead,
 * along that cushion toward the side with more room. So the pad cannot pin
 * him: thrown along the cushion, he sets off from the nearest spot on that
 * side clear of the machine, as a lane change moves him when it would
 * squeeze him. Returns false if that was his last heart.
 *
 * Nor does it take a heart from him, landed where the machine itself put
 * him less than a telegraph ago, before he has launched: a lane change
 * into an end lane can slide him along the cushion onto the very face that
 * leads when it sets off, and he must have the time to read that. The turn
 * after a hit counts as putting him there when he is landed in the way of
 * the end that now leads (`inTheWay`).
 */
function padHit(s: State, tune: Tune, box: Box, events: SimEvent[]): boolean {
  const b = s.boss;
  const h = s.him;
  const r = s.stats.radius;
  const metX = h.x;
  const metY = h.y;
  const putThere = !h.hot && b.shovedTick >= 0 && s.tick - b.shovedTick < tune.telegraphTicks && s.launch.startTick <= b.shovedTick;
  let hurt = false;
  if (s.tick >= h.invulnUntil && !putThere && (tune.padHurtsHot || !h.hot)) {
    loseHeart(s, tune, { kind: "polisher", id: 0 }, events);
    hurt = true;
    if (s.hearts <= 0) {
      // The last heart: the night ends where it stands, with him set clear of the machine and not thrown.
      const q = clearSpot(s, box, h.x, h.y, r);
      if (q) {
        h.x = q.x;
        h.y = q.y;
      }
      return false;
    }
  }
  const lead = b.dir > 0 ? box.x1 : box.x0;
  const ahead = b.dir > 0 ? s.room.right - lead : lead - s.room.left;
  let vx = b.dir * tune.padThrowSpeed;
  let vy = 0;
  let q: { x: number; y: number } | null;
  if (ahead <= THROW_ALONG_WITHIN) {
    vx = 0;
    const up = h.y - s.room.top > s.room.bottom - h.y;
    vy = up ? -tune.padThrowSpeed : tune.padThrowSpeed;
    q = faceSpot(s, box, up ? "T" : "B", h.x, h.y, r) ?? clearSpot(s, box, h.x, h.y, r, up ? "T" : "B");
  } else {
    q = clearSpot(s, box, h.x, h.y, r);
  }
  if (q) {
    h.x = q.x;
    h.y = q.y;
  }
  throwHim(s, tune, vx, vy, hurt, metX, metY, events);
  return true;
}

/** A counted hit on the plug: it stalls, coughs out dust bunnies, and later turns round, faster. The last powers it down. */
function hitPlug(s: State, tune: Tune, events: SimEvent[]): void {
  const b = s.boss;
  const l = s.launch;
  const h = s.him;
  // Off a cushion it counts as two; on a plug with one left it takes one off.
  const two = l.cushions > 0;
  const off = Math.min(b.hp, two ? 2 : 1);
  b.hp -= off;
  // Flat: never multiplied, not a pop. It is part of the launch's total.
  const points = POLISHER.points * off;
  l.points += points;
  s.score += points;
  if (l.points > s.bestShot) s.bestShot = l.points;
  l.hit.push(0);
  events.push({ type: "hit", tick: s.tick, x: h.x, y: h.y, kind: "polisher", id: 0, left: b.hp, points, two, source: "body", stop: false });
  if (b.hp <= 0) {
    b.mode = "down";
    b.modeUntil = -1;
    events.push({ type: "bossHit", tick: s.tick, x: b.x, y: b.y, left: 0, coughed: 0 });
    events.push({ type: "bossDown", tick: s.tick, x: b.x, y: b.y });
    return;
  }
  b.mode = "hitStall";
  b.modeUntil = s.tick + tune.bossStallTicks;
  b.lastHitTick = s.tick;
  const coughed = cough(s, tune, events);
  events.push({ type: "bossHit", tick: s.tick, x: b.x, y: b.y, left: b.hp, coughed });
  events.push({ type: "bossStall", tick: s.tick, x: b.x, y: b.y, why: "hit", until: b.modeUntil });
}

/**
 * It coughs out `bossCough` dust bunnies along one long side, at a quarter,
 * a half and three quarters of its length, 12 u outside the casing: the
 * top side if his centre is at or below its axis, else the bottom one, and
 * the other if that side lies against a cushion. They are dazed 36 ticks
 * and worth nothing. While the room is full they do not appear.
 */
function cough(s: State, tune: Tune, events: SimEvent[]): number {
  const b = s.boss;
  const box = boxOf(b);
  let top = s.him.y >= b.y;
  if (top && box.y0 <= s.room.top) top = false;
  else if (!top && box.y1 >= s.room.bottom) top = true;
  const y = top ? box.y0 - COUGH_OUT : box.y1 + COUGH_OUT;
  let n = 0;
  for (let i = 1; i <= tune.bossCough; i++) {
    if (intruders(s) >= tune.roomCap) break;
    const d = addThing(s, "bunny", box.x0 + (POLISHER.boxL * i) / (tune.bossCough + 1), y, s.tick, 0, 0);
    d.worth0 = true;
    announce(s, d, events);
    daze(s, d, s.tick + tune.dazeTicks, events);
    events.push({ type: "arrive", tick: s.tick, x: d.x, y: d.y, id: d.id, kind: d.kind, dist: Math.hypot(d.x - s.him.x, d.y - s.him.y), dazed: true });
    n++;
  }
  return n;
}

/**
 * Him against the polisher, in a substep after it has moved (§8, "Contact
 * with him"): find the point of its box nearest his centre. On the leading
 * end while it moves along a lane, it is the pad. On the trailing end
 * within 12 u of its middle, while he is hot and it moves along a lane, it
 * is the plug: he bounces off (`bodyRestitution`), and it is a hit if this
 * launch has not hit it yet. Anywhere else, and every face while it is
 * stalled or changing lane, it is casing: hot, he bounces off as off a
 * cushion, by his speed relative to the face; landed, he is pushed. He is
 * never left inside its box. Returns false if he lost his last heart.
 */
export function bossContact(s: State, tune: Tune, events: SimEvent[]): boolean {
  const b = s.boss;
  if (!solid(b)) return true;
  const h = s.him;
  const r = s.stats.radius;
  const box = boxOf(b);
  if (h.x + r <= box.x0 || h.x - r >= box.x1 || h.y + r <= box.y0 || h.y - r >= box.y1) return true;
  const px = h.x < box.x0 ? box.x0 : h.x > box.x1 ? box.x1 : h.x;
  const py = h.y < box.y0 ? box.y0 : h.y > box.y1 ? box.y1 : h.y;
  const dx = h.x - px;
  const dy = h.y - py;
  if (dx * dx + dy * dy >= r * r) return true;

  const moving = live(b);
  const lead = b.dir > 0 ? box.x1 : box.x0;
  const trail = b.dir > 0 ? box.x0 : box.x1;
  // Which end his centre is nearest when it is inside the box (a fast face can go past a tenth of his radius in a substep, never more).
  const inside = dx === 0 && dy === 0;
  const toLead = Math.abs(lead - h.x);
  const toTrail = Math.abs(h.x - trail);
  const toSide = Math.min(h.y - box.y0, box.y1 - h.y);
  const atLead = inside ? toLead <= toTrail && toLead <= toSide : b.dir * (h.x - lead) >= 0;
  const atTrail = inside ? toTrail < toLead && toTrail <= toSide : b.dir * (h.x - trail) <= 0;
  // The pad meets a throw once: while the throw it gave him is in flight, it is casing to him.
  if (moving && atLead && !(s.launch.active && s.launch.thrown)) return padHit(s, tune, box, events);

  const plug = moving && h.hot && atTrail && Math.abs(h.y - b.y) <= tune.plugWidth / 2;
  // His heading decides which way he goes along a cushion if he must.
  const q = clearSpot(s, box, h.x, h.y, r, h.vy < 0 ? "T" : "B");
  if (!h.hot) {
    // Landed: the casing pushes him, and he is never hurt by it.
    if (q) shove(s, q.x, q.y);
    return true;
  }
  const speedIn = Math.hypot(h.vx, h.vy);
  let nx = 0;
  let ny = -1;
  if (q) {
    nx = q.nx;
    ny = q.ny;
    h.x = q.x;
    h.y = q.y;
  }
  // A moving face: his speed relative to it along its normal, as the toy's body contact does.
  const vbx = moving ? b.dir * b.speed : 0;
  const vby = b.mode === "laneMove" ? (nextLane(b) > b.lane ? b.speed : -b.speed) : 0;
  const closing = (h.vx - vbx) * nx + (h.vy - vby) * ny;
  const e = plug ? tune.bodyRestitution : tune.wallRestitution;
  if (closing < 0) {
    h.vx -= (1 + e) * closing * nx;
    h.vy -= (1 + e) * closing * ny;
  }
  // A bounce off the polisher, and a hit on its plug, are contacts (§3.5).
  h.lastContactTick = s.tick;
  if (plug && !s.launch.hit.includes(0)) hitPlug(s, tune, events);
  else events.push({ type: "bossBounce", tick: s.tick, x: h.x, y: h.y, part: plug ? "plug" : "casing", speed: speedIn, vx: h.vx, vy: h.vy });
  // The landing test, after every contact.
  h.hot = isHot(s, tune, Math.hypot(h.vx, h.vy));
  if (!h.hot) land(s, tune, events);
  return true;
}

/** What the polisher adds to the score when it is beaten: the night's bonus, and a bonus for each heart left. */
export function nightBonus(s: State, tune: Tune): number {
  return tune.nightBonus + tune.heartBonus * s.hearts;
}
