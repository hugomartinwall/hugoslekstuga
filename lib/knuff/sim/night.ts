/**
 * The night: the hour clock, arrivals, the pace, far spots, formations and
 * the room's cap (spec §3.2 to §3.4).
 *
 * content/night.ts holds the timetable as written. This file deals it: it
 * leaves out what the night does not bring (State.night.kinds), shifts the
 * hours whose opening row is left empty, announces each row at its tick
 * or, at pace 2 and 3, sooner, and follows the hour's rows with extra
 * bunches until last call.
 *
 * Everything here is called from `step` and changes the State it is
 * handed; nothing here is called from outside the simulation except
 * `placeRack`, which `createState` uses, and the two readers at the end.
 */
import { KINDS } from "../content/kinds";
import { BUNCH, HOURS, RACK_APEX, ROWS } from "../content/night";
import { bossClock } from "./boss";
import { closeOffer, offerStep } from "./charms";
import { rand } from "./rng";
import type { SimEvent, State, Thing, Tune } from "./types";

// ── The rows a night deals ────────────────────────────────────────────

/** One row as a night deals it: what is left of a written row once the kinds it does not bring are out. */
export type Dealt = {
  /** Its place among the hour's rows as written, from 0. -1 for an extra bunch. */
  row: number;
  /** The tick of the hour it is announced at, at the latest. */
  tick: number;
  /** Dust bunnies: in the opening rack, or in a blob. */
  bunnies: number;
  rack: boolean;
  /** Tokens, each at its own far spot. `alone`: the one thing of its row. */
  loose: number;
  alone: boolean;
  /** Tokens in a file. */
  file: number;
  /** Gum: how many, and where: alone at a far spot, or under the blob (§3.3, "Formations"). */
  gum: number;
  gumForm: "alone" | "under" | "";
  /** Batteries: how many, and where: alone at a far spot, or beside the blob, on the side facing him. */
  battery: number;
  batteryForm: "alone" | "beside" | "";
  /** Envelopes: the newsletter's V of five, which comes from the top edge by its own rule. */
  envelopes: number;
  /** It brings a kind for the first time: it holds the row after it back (the pace's second rule). */
  first: boolean;
};

/** The written ticks of the two bunches that move up when an hour's opening row is left empty, and where they go. */
const SHIFT: readonly (readonly [number, number])[] = [
  [342, 0],
  [684, 342],
];

function dealHour(hour: number, kinds: readonly string[]): Dealt[] {
  const written = ROWS.filter((r) => r.hour === hour);
  const out: Dealt[] = [];
  let openingLeftEmpty = false;
  written.forEach((r, index) => {
    const d: Dealt = {
      row: index,
      tick: r.tick,
      bunnies: 0,
      rack: false,
      loose: 0,
      alone: false,
      file: 0,
      gum: 0,
      gumForm: "",
      battery: 0,
      batteryForm: "",
      envelopes: 0,
      first: r.first !== "",
    };
    let any = false;
    for (const p of r.parts) {
      // A row keeps what the night brings; nothing is swapped back in for what is left out.
      if (!kinds.includes(p.kind)) continue;
      if (p.kind === "bunny" && (p.form === "blob" || p.form === "rack")) {
        d.bunnies += p.n;
        d.rack = p.form === "rack";
      } else if (p.kind === "token" && (p.form === "loose" || p.form === "alone")) {
        d.loose += p.n;
        d.alone = p.form === "alone";
      } else if (p.kind === "token" && p.form === "file") {
        d.file += p.n;
      } else if (p.kind === "gum" && (p.form === "alone" || p.form === "under")) {
        d.gum += p.n;
        d.gumForm = p.form;
      } else if (p.kind === "battery" && (p.form === "alone" || p.form === "beside")) {
        d.battery += p.n;
        d.batteryForm = p.form;
      } else if (p.kind === "envelope" && p.form === "V") {
        d.envelopes += p.n;
      } else {
        // A kind with no rules yet. createState keeps such a kind out of the list.
        continue;
      }
      any = true;
    }
    // A row left empty is skipped.
    if (any) out.push(d);
    else if (r.tick === 0) openingLeftEmpty = true;
  });
  // While an hour's opening row is left out, its bunches at ticks 342 and
  // 684 are announced at ticks 0 and 342. A file stays at 513.
  if (openingLeftEmpty) {
    for (const d of out) {
      for (const [from, to] of SHIFT) {
        if (d.tick === from) {
          d.tick = to;
          break;
        }
      }
    }
    // Array.prototype.sort is stable: rows of one tick keep the table's order.
    out.sort((a, b) => a.tick - b.tick);
  }
  return out;
}

const dealtByKinds = new Map<string, Dealt[][]>();
let lastKinds: readonly string[] = [];
let lastDealt: Dealt[][] | null = null;

function sameList(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * The rows of every hour for a night that brings `kinds`, in the order
 * they are dealt. Worked out once for each list of kinds and kept: the
 * table does not change, so neither does the answer.
 */
export function dealtRows(kinds: readonly string[]): readonly (readonly Dealt[])[] {
  if (lastDealt !== null && sameList(kinds, lastKinds)) return lastDealt;
  const key = kinds.join("+");
  let dealt = dealtByKinds.get(key);
  if (!dealt) {
    dealt = [];
    for (let hour = 0; hour < HOURS; hour++) dealt.push(dealHour(hour, kinds));
    dealtByKinds.set(key, dealt);
  }
  lastKinds = kinds.slice();
  lastDealt = dealt;
  return dealt;
}

// ── Reading the room ──────────────────────────────────────────────────

/** Are the pace's five rules on? They are at pace 2 and 3; anything else deals the table as written. */
export function paced(tune: Tune): boolean {
  return tune.pace === 2 || tune.pace === 3;
}

/** The tick of the hour from which no extra bunch is announced, and before which the hour is not clear. */
export function lastCall(hour: number, tune: Tune): number {
  return hour === 0 ? tune.paceLastCallFirst : tune.paceLastCall;
}

const BUNNY = KINDS.bunny;
const TOKEN = KINDS.token;
const GUM = KINDS.gum;
const BATTERY = KINDS.battery;
const ENVELOPE = KINDS.envelope;
const PICKUP = KINDS.pickup;

/** A thing's row of the kind table. (One comparison: this is asked for every thing on every tick.) */
function rowOf(d: Thing): (typeof KINDS)[Thing["kind"]] {
  switch (d.kind) {
    case "bunny":
      return BUNNY;
    case "token":
      return TOKEN;
    case "gum":
      return GUM;
    case "battery":
      return BATTERY;
    case "envelope":
      return ENVELOPE;
    case "pickup":
      return PICKUP;
  }
}

/** Intruders alive or announced: what the room's cap counts. */
export function intruders(s: State): number {
  let n = 0;
  for (let i = 0; i < s.things.length; i++) {
    const d = s.things[i];
    if (d.hp > 0 && rowOf(d).intruder) n++;
  }
  return n;
}

/** Intruders alive or announced whose kind counts for clear: what "clear" and "called early" count. */
export function threats(s: State): number {
  let n = 0;
  for (let i = 0; i < s.things.length; i++) {
    const d = s.things[i];
    if (d.hp > 0 && rowOf(d).clear) n++;
  }
  return n;
}

// ── Placing ───────────────────────────────────────────────────────────

/** The rack was in the room before the night began: it has no telegraph and no landing. */
const RACK_LAND_TICK = -1;

export function addThing(s: State, kind: Thing["kind"], x: number, y: number, landTick: number, vx: number, vy: number): Thing {
  const row = KINDS[kind];
  // Kept inside the floor: a circle by its radius, a box (gum) by half its size.
  const rx = row.radius > 0 ? row.radius : row.boxW / 2;
  const ry = row.radius > 0 ? row.radius : row.boxH / 2;
  const room = s.room;
  const px = Math.min(room.right - rx, Math.max(room.left + rx, x));
  const py = Math.min(room.bottom - ry, Math.max(room.top + ry, y));
  const d: Thing = {
    id: s.nextId++,
    kind,
    x: px,
    y: py,
    px,
    py,
    vx,
    vy,
    wx: 0,
    wy: 0,
    // Alive until it is popped. A battery takes no hits (it bursts) and is alive until it has.
    hp: Math.max(1, row.hits),
    landTick,
    dazedUntil: 0,
    // A dust bunny's wobble starts where the behaviour stream says.
    phase: kind === "bunny" ? rand(s.rng, "behaviour") * Math.PI * 2 : 0,
    worth0: false,
    fuseTick: -1,
    knockTick: -1,
    mine: false,
    launchId: -1,
    heading: 0,
    v: -1,
    goneTick: -1,
  };
  s.things.push(d);
  return d;
}

/**
 * A far spot: up to 24 points drawn evenly inside the floor, `inset` away
 * from every cushion. The first that is at least `arriveMinDist` from him;
 * if none is, the farthest of the 24.
 */
export function farSpot(s: State, tune: Tune, inset: number): { x: number; y: number } {
  const room = s.room;
  const w = room.right - room.left - 2 * inset;
  const h = room.bottom - room.top - 2 * inset;
  let bx = (room.left + room.right) / 2;
  let by = (room.top + room.bottom) / 2;
  let best = -1;
  for (let i = 0; i < 24; i++) {
    const x = room.left + inset + rand(s.rng, "arrivals") * w;
    const y = room.top + inset + rand(s.rng, "arrivals") * h;
    const dist = Math.hypot(x - s.him.x, y - s.him.y);
    if (dist >= tune.arriveMinDist) return { x, y };
    if (dist > best) {
      best = dist;
      bx = x;
      by = y;
    }
  }
  return { x: bx, y: by };
}

/**
 * The opening rack: dust bunnies in rows of 1, 2, 3, 4, apex toward him,
 * 18 u apart in a row and the rows 16 u apart; a last row that is not full
 * is centred. It is placed when the State is made, not when its row is
 * announced: it stands in the room on the start screen.
 */
export function placeRack(s: State): void {
  if (s.night.hour !== 0) return;
  const opening = dealtRows(s.night.kinds)[0][0];
  if (!opening || !opening.rack) return;
  let left = opening.bunnies;
  for (let line = 0; left > 0; line++) {
    const inLine = Math.min(line + 1, left);
    for (let i = 0; i < inLine; i++) {
      addThing(s, "bunny", RACK_APEX.x + (i - (inLine - 1) / 2) * 18, RACK_APEX.y - line * 16, RACK_LAND_TICK, 0, 0);
    }
    left -= inLine;
  }
}

/** Dust bunnies in a blob are never closer than this, centre to centre, u. */
const BLOB_SPACING = 17;

/**
 * A blob: `n` dust bunnies scattered in a disc of radius 8 + 9√n around a
 * far spot, pushed apart until no two centres are closer than 17 u, and
 * kept inside the floor.
 */
function placeBlob(s: State, tune: Tune, n: number, landTick: number, events: SimEvent[]): { x: number; y: number; R: number } | null {
  if (n <= 0) return null;
  const R = 8 + 9 * Math.sqrt(n);
  const c = farSpot(s, tune, R + 8);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = rand(s.rng, "arrivals") * Math.PI * 2;
    const dist = R * Math.sqrt(rand(s.rng, "arrivals"));
    xs.push(c.x + Math.cos(a) * dist);
    ys.push(c.y + Math.sin(a) * dist);
  }
  const r = KINDS.bunny.radius;
  const room = s.room;
  for (let pass = 0; pass < 80; pass++) {
    let moved = false;
    for (let a = 0; a < n; a++) {
      for (let b = a + 1; b < n; b++) {
        let dx = xs[b] - xs[a];
        let dy = ys[b] - ys[a];
        let dist = Math.hypot(dx, dy);
        if (dist >= BLOB_SPACING - 1e-6) continue;
        if (dist < 1e-9) {
          dx = 1;
          dy = 0;
          dist = 1;
        }
        const push = (BLOB_SPACING - dist) / 2;
        xs[a] -= (dx / dist) * push;
        ys[a] -= (dy / dist) * push;
        xs[b] += (dx / dist) * push;
        ys[b] += (dy / dist) * push;
        moved = true;
      }
    }
    for (let a = 0; a < n; a++) {
      xs[a] = Math.min(room.right - r, Math.max(room.left + r, xs[a]));
      ys[a] = Math.min(room.bottom - r, Math.max(room.top + r, ys[a]));
    }
    if (!moved) break;
  }
  for (let i = 0; i < n; i++) announce(s, addThing(s, "bunny", xs[i], ys[i], landTick, 0, 0), events);
  return { x: c.x, y: c.y, R };
}

/**
 * A battery: alone at a far spot (inset 20), or beside the blob: on its
 * rim on the side facing him, at the blob's spot plus R + 14 u toward him,
 * kept inside the floor. Its fuse runs from its landing.
 */
function placeBattery(s: State, tune: Tune, blob: { x: number; y: number; R: number } | null, landTick: number, events: SimEvent[]): void {
  let x: number;
  let y: number;
  if (blob) {
    const dx = s.him.x - blob.x;
    const dy = s.him.y - blob.y;
    const dist = Math.hypot(dx, dy);
    const k = blob.R + 14;
    x = dist > 1e-6 ? blob.x + (dx / dist) * k : blob.x;
    y = dist > 1e-6 ? blob.y + (dy / dist) * k : blob.y + k;
  } else {
    const p = farSpot(s, tune, 20);
    x = p.x;
    y = p.y;
  }
  const d = addThing(s, "battery", x, y, landTick, 0, 0);
  d.fuseTick = landTick + tune.batteryFuseTicks;
  announce(s, d, events);
}

/** Gum: alone at a far spot (inset 20), or at the blob's spot, under the bunch. */
function placeGum(s: State, tune: Tune, blob: { x: number; y: number } | null, landTick: number, events: SimEvent[]): void {
  const p = blob ?? farSpot(s, tune, 20);
  announce(s, addThing(s, "gum", p.x, p.y, landTick, 0, 0), events);
}

/** One token at its own far spot, rolling in its own direction once it lands. */
function placeToken(s: State, tune: Tune, inset: number, landTick: number, events: SimEvent[]): void {
  const p = farSpot(s, tune, inset);
  const a = rand(s.rng, "arrivals") * Math.PI * 2;
  announce(s, addThing(s, "token", p.x, p.y, landTick, Math.cos(a) * tune.tokenSpeed, Math.sin(a) * tune.tokenSpeed), events);
}

/** A file: `n` tokens in a line, 24 u apart, all rolling the same way along it. The head is at a far spot. */
function placeFile(s: State, tune: Tune, n: number, landTick: number, events: SimEvent[]): void {
  if (n <= 0) return;
  const p = farSpot(s, tune, 60);
  const a = rand(s.rng, "arrivals") * Math.PI * 2;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  for (let i = 0; i < n; i++) {
    announce(s, addThing(s, "token", p.x - ux * 24 * i, p.y - uy * 24 * i, landTick, ux * tune.tokenSpeed, uy * tune.tokenSpeed), events);
  }
}

/** The V's leader stands this far inside the side cushions at most, u: at 61 and 299 the outer envelopes touch them. */
const V_SIDE = 53;
/** The V's three rows, from the leader at its tip to the back: their height under the top cushion, and how far out from the leader they stand, u. */
const V_ROWS: readonly (readonly [number, number])[] = [
  [41, 0],
  [25, 22],
  [9, 44],
];

/**
 * The newsletter: a V of five envelopes just under the top cushion, its tip
 * toward the room (§5.4). The leader lands at (lx, 49), lx his x at the
 * announce tick kept between 61 and 299; if that spot is closer to him than
 * `arriveMinDist`, lx is 61 or 299, whichever is farther from him (61 on a
 * tie). The others land at (lx ± 22, 33) and (lx ± 44, 17). The room's own
 * edges place it: those are the numbers in the room as built. `n` of the
 * five come, counted from the tip: the cap cuts a V from its back. Each
 * envelope carries the leader's id as its V.
 */
function placeV(s: State, tune: Tune, n: number, landTick: number, events: SimEvent[]): void {
  if (n <= 0) return;
  const room = s.room;
  const h = s.him;
  const lo = room.left + V_SIDE;
  const hi = room.right - V_SIDE;
  let lx = Math.min(hi, Math.max(lo, h.x));
  const ly = room.top + V_ROWS[0][0];
  if (Math.hypot(lx - h.x, ly - h.y) < tune.arriveMinDist) lx = Math.abs(hi - h.x) > Math.abs(lo - h.x) ? hi : lo;
  const spots: { x: number; y: number }[] = [{ x: lx, y: ly }];
  for (let row = 1; row < V_ROWS.length; row++) {
    const [down, out] = V_ROWS[row];
    spots.push({ x: lx - out, y: room.top + down }, { x: lx + out, y: room.top + down });
  }
  let leader = -1;
  for (let i = 0; i < n && i < spots.length; i++) {
    const d = addThing(s, "envelope", spots[i].x, spots[i].y, landTick, 0, 0);
    if (leader < 0) leader = d.id;
    d.v = leader;
    announce(s, d, events);
  }
}

export function announce(s: State, d: Thing, events: SimEvent[]): void {
  events.push({ type: "announce", tick: s.tick, x: d.x, y: d.y, id: d.id, kind: d.kind, landTick: d.landTick });
}

// ── Announcing a row ──────────────────────────────────────────────────

/**
 * Announce one row or one extra bunch: cut it to the room's cap, place
 * what is left, and note it as "the row before" for the pace. A row the
 * cap cuts to nothing has still been announced.
 */
function announceRow(s: State, tune: Tune, d: Dealt, how: "tick" | "early" | "clock", events: SimEvent[]): void {
  const night = s.night;
  const firstId = s.nextId;
  let announced = 0;
  let cut = 0;
  let lands = s.tick + tune.telegraphTicks;
  if (d.rack) {
    // The rack was placed when the State was made. Its row is announced on
    // the tick of the first launch, and it has landed at once.
    for (let i = 0; i < s.things.length; i++) if (s.things[i].landTick === RACK_LAND_TICK) announced++;
    lands = s.tick;
  } else {
    let bunnies = d.bunnies;
    let loose = d.loose;
    let file = d.file;
    let gum = d.gum;
    let battery = d.battery;
    let envelopes = d.envelopes;
    // The cap: dust bunnies are cut first, then tokens, then gum, then
    // batteries, then envelopes (from the back of the V). What is cut never arrives.
    let over = intruders(s) + bunnies + loose + file + gum + battery + envelopes - tune.roomCap;
    if (over > 0) {
      cut = Math.min(over, bunnies + loose + file + gum + battery + envelopes);
      const fewerBunnies = Math.min(bunnies, over);
      bunnies -= fewerBunnies;
      over -= fewerBunnies;
      const fewerLoose = Math.min(loose, over);
      loose -= fewerLoose;
      over -= fewerLoose;
      const fewerFile = Math.min(file, over);
      file -= fewerFile;
      over -= fewerFile;
      const fewerGum = Math.min(gum, over);
      gum -= fewerGum;
      over -= fewerGum;
      const fewerBatteries = Math.min(battery, over);
      battery -= fewerBatteries;
      over -= fewerBatteries;
      envelopes -= Math.min(envelopes, over);
    }
    // The blob first; then what is placed by it (a battery beside, gum
    // under), or alone; then each token.
    let blob = placeBlob(s, tune, bunnies, lands, events);
    // A blob the cap cut whole still has its spot, for what lies beside or under it.
    if (!blob && ((battery > 0 && d.batteryForm === "beside") || (gum > 0 && d.gumForm === "under"))) {
      const c = farSpot(s, tune, 16);
      blob = { x: c.x, y: c.y, R: 8 };
    }
    for (let i = 0; i < battery; i++) placeBattery(s, tune, d.batteryForm === "beside" ? blob : null, lands, events);
    for (let i = 0; i < gum; i++) placeGum(s, tune, d.gumForm === "under" ? blob : null, lands, events);
    for (let i = 0; i < loose; i++) placeToken(s, tune, d.alone ? 20 : 9, lands, events);
    placeFile(s, tune, file, lands, events);
    // The V comes from the top edge by its own rule, and draws nothing from the arrivals stream.
    placeV(s, tune, envelopes, lands, events);
    announced = s.nextId - firstId;
  }
  night.rowTick = s.tick;
  night.rowLandTick = lands;
  if (d.first) {
    night.holdFrom = firstId;
    night.holdTo = s.nextId;
  } else {
    night.holdFrom = -1;
    night.holdTo = -1;
  }
  events.push({ type: "row", tick: s.tick, hour: night.hour, row: d.row, how, n: announced, cut });
}

/** An extra bunch: the hour's dust bunnies in a blob, with a few loose tokens before midnight (§3.4). */
function extraBunch(s: State, tune: Tune): Dealt {
  const hour = s.night.hour;
  const kinds = s.night.kinds;
  // None at 19:00, before tokens have appeared; `paceTokens` from 20:00 to
  // 23:00; two fewer from 00:00 on, and never fewer than none.
  const tokens = hour === 0 ? 0 : hour <= 4 ? tune.paceTokens : tune.paceTokens - 2;
  return {
    row: -1,
    tick: s.tick - s.night.hourStart,
    bunnies: kinds.includes("bunny") ? BUNCH[hour][0] : 0,
    rack: false,
    loose: kinds.includes("token") ? Math.max(0, Math.floor(tokens)) : 0,
    alone: false,
    file: 0,
    // An extra bunch carries nothing else: no gum, battery or envelope.
    gum: 0,
    gumForm: "",
    battery: 0,
    batteryForm: "",
    envelopes: 0,
    first: false,
  };
}

/**
 * The pace's test, made once a tick after the rows whose tick has come.
 * It answers how the next thing may come now: called early, by the clock,
 * or ("") not yet.
 */
function paceMoment(s: State, tune: Tune): "early" | "clock" | "" {
  const night = s.night;
  // The hour's first row comes at its tick: there is no row before it.
  if (night.rowTick < 0) return "";
  // A new kind keeps its moment: while anything its row announced is still
  // there, the next row waits for its own tick.
  if (night.holdFrom >= 0) {
    for (let i = 0; i < s.things.length; i++) {
      const d = s.things[i];
      if (d.hp > 0 && d.id >= night.holdFrom && d.id < night.holdTo) return "";
    }
  }
  // Called early: the row before has landed, and the room is nearly clear.
  if (s.tick >= night.rowLandTick && threats(s) <= tune.paceRoom) return "early";
  // The clock: no row waits longer than this after the row before it.
  if (s.tick >= night.rowTick + tune.paceEvery) return "clock";
  return "";
}

/** The rows due this tick: the tabled rows whose tick has come, then what the pace's test announces, one thing at most. */
function announceDue(s: State, tune: Tune, rows: readonly Dealt[], events: SimEvent[]): void {
  const night = s.night;
  const into = s.tick - night.hourStart;
  while (night.nextRow < rows.length && into >= rows[night.nextRow].tick) announceRow(s, tune, rows[night.nextRow++], "tick", events);
  if (!paced(tune)) return;
  if (night.nextRow < rows.length) {
    const how = paceMoment(s, tune);
    if (how !== "") announceRow(s, tune, rows[night.nextRow++], how, events);
  } else if (into < lastCall(night.hour, tune)) {
    const how = paceMoment(s, tune);
    if (how !== "") announceRow(s, tune, extraBunch(s, tune), how, events);
  }
}

// ── The night's part of a tick ────────────────────────────────────────

/**
 * Step 4 of a tick. In order: the hour changes if it is due (an offer still
 * out is closed); the rows due are announced; the things whose telegraph
 * has ended land, dazed if he is close; the clear test; the offer opens and
 * arms. In the boss's hour, 06:00, there are no rows, no clear and no offer:
 * the things land, and then the polisher's clock runs (sim/boss.ts). Returns
 * false when 05:00 has ended and the night has no 06:00 to go to (its kinds
 * leave the polisher out): the night is over, and `step` closes it.
 */
export function nightStep(s: State, tune: Tune, events: SimEvent[]): boolean {
  const night = s.night;
  if (s.phase === "boss") {
    landArrivals(s, tune, events);
    bossClock(s, tune, events);
    return true;
  }

  // The hour changes first, so a row whose tick is 0 is announced on the hour's tick 0.
  const settled = night.clearTick >= 0 && night.settledTick >= 0;
  if (
    (settled && s.tick >= Math.max(night.clearTick, night.settledTick) + tune.hourPauseTicks) ||
    s.tick - night.hourStart >= tune.hourMaxTicks
  ) {
    // An offer nobody took is lost, and the hour's gum is swept away (no points).
    closeOffer(s, events);
    sweepGum(s);
    night.hour++;
    night.hourStart = s.tick;
    night.nextRow = 0;
    night.rowTick = -1;
    night.rowLandTick = -1;
    night.holdFrom = -1;
    night.holdTo = -1;
    night.clearTick = -1;
    night.offerTick = -1;
    night.settledTick = -1;
    if (night.hour >= HOURS) {
      // 05:00 has ended. Without the polisher the night ends here; with it, 06:00 begins.
      if (!night.kinds.includes("polisher")) return false;
      s.phase = "boss";
      events.push({ type: "hour", tick: s.tick, hour: night.hour });
      landArrivals(s, tune, events);
      bossClock(s, tune, events);
      return true;
    }
    events.push({ type: "hour", tick: s.tick, hour: night.hour });
  }

  const rows = dealtRows(night.kinds)[night.hour];
  announceDue(s, tune, rows, events);
  landArrivals(s, tune, events);

  // Clear: every row has been announced (at pace 2 and 3 that is true only
  // from last call on) and nothing that counts for clear is left.
  const into = s.tick - night.hourStart;
  if (night.clearTick < 0) {
    const allOut = night.nextRow >= rows.length && (!paced(tune) || into >= lastCall(night.hour, tune));
    if (allOut && threats(s) === 0) {
      night.clearTick = s.tick;
      events.push({ type: "clear", tick: s.tick, hour: night.hour });
    }
  }
  // The offer opens when the hour is clear, or at `offerLatestTick` if it
  // is not, and arms when he lands or `offerArmTicks` later. If nothing can
  // be offered, or offers are off, the hour counts as settled the moment
  // the offer would have opened.
  offerStep(s, tune, into, events);
  return true;
}

/**
 * Landings. An arrival that lands close to him lands dazed: its spot was
 * chosen a telegraph ago, and he may have flown there since.
 */
function landArrivals(s: State, tune: Tune, events: SimEvent[]): void {
  const h = s.him;
  for (let i = 0; i < s.things.length; i++) {
    const d = s.things[i];
    if (d.landTick !== s.tick) continue;
    const dist = Math.hypot(d.x - h.x, d.y - h.y);
    if (d.kind === "envelope") {
      // All five of a V set off with one heading: from the leader toward him, at the landing tick.
      let lead: Thing = d;
      for (let k = 0; k < s.things.length; k++) {
        if (s.things[k].id === d.v) {
          lead = s.things[k];
          break;
        }
      }
      d.heading = Math.atan2(h.y - lead.y, h.x - lead.x);
    }
    // Every kind that can hurt lands dazed close to him; gum hurts nothing and is never dazed.
    const dazed = dist <= tune.arriveDazedWithin && rowOf(d).hurts;
    if (dazed) daze(s, d, s.tick + tune.dazeTicks, events);
    events.push({ type: "arrive", tick: s.tick, x: d.x, y: d.y, id: d.id, kind: d.kind, dist, dazed });
  }
}

/** The end of an hour: its gum is swept away. Gone by the end of the tick, and it pays nothing. */
function sweepGum(s: State): void {
  for (let i = 0; i < s.things.length; i++) if (s.things[i].kind === "gum") s.things[i].hp = 0;
}

/** Daze a thing until `until`. A new daze never shortens one. */
export function daze(s: State, d: Thing, until: number, events: SimEvent[]): void {
  if (d.dazedUntil >= until) return;
  d.dazedUntil = until;
  events.push({ type: "daze", tick: s.tick, id: d.id, until });
}
