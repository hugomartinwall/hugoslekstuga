/**
 * Plates and charms, and the offer (spec §6, §3.1).
 *
 * A lit plate fires every time he bounces off it. A body charm changes his
 * numbers for the rest of the night, and those numbers are made in one
 * place, `statsFor`: `step`, the aim line and the bots read `state.stats`
 * and never a charm.
 *
 * After each hour the room offers a choice: up to two dark plates to light
 * and a body charm on the floor. It opens when the hour is clear (or at
 * `offerLatestTick`), arms when he lands or a second later, and only a
 * launch released after that can take one thing from it: a pickup's tile
 * his circle overlaps, or the offered plate that is that launch's first
 * cushion. Taking settles the offer; the next hour closes it.
 *
 * Everything here that changes a State is called from `step` only.
 */
import { BODY_CHARMS, CORNER_MATE, DARK, PLATES, PLATE_SIDE, WALL_CHARMS, isBodyCharm, type WallCharm } from "../content/charms";
import { KINDS } from "../content/kinds";
import { givePip } from "./hot";
import { daze } from "./night";
import { rand } from "./rng";
import type { OfferItem, Side, SimEvent, State, Stats, Thing, Tune } from "./types";

// ── His numbers after charms ──────────────────────────────────────────

/**
 * The numbers after charms. Heavy and Wide multiply together. Without a
 * charm every number is the tune's own, unchanged to the last bit: the
 * feel lock holds his motion against the toy's.
 */
export function statsFor(charms: readonly string[], tune: Tune): Stats {
  const has = (c: string) => charms.includes(c);
  let popImpulse = tune.popImpulseScale;
  if (has("heavy")) popImpulse *= tune.heavyFactor;
  if (has("wide")) popImpulse *= tune.wideFactor;
  return {
    radius: has("wide") ? tune.himRadius + tune.wideRadius : tune.himRadius,
    hotSpeed: (has("longBurn") ? tune.longBurnHotFrac : tune.hotFrac) * tune.maxSpeed,
    popImpulse,
    pipMax: has("fourthPip") ? tune.pipMax + 1 : tune.pipMax,
    maxHearts: has("thickSkin") ? tune.hearts + 1 : tune.hearts,
  };
}

/** How many plates may carry this charm. */
export function capOf(charm: WallCharm, tune: Tune): number {
  switch (charm) {
    case "bumper":
      return tune.capBumper;
    case "pip":
      return tune.capPip;
    case "spark":
      return tune.capSpark;
    case "bell":
      return tune.capBell;
    case "coin":
      return tune.capCoin;
  }
}

// ── Where the plates are ──────────────────────────────────────────────

/**
 * The plate a bounce off `side` belongs to: the one that holds his centre's
 * `x` (top and bottom) or `y` (the sides) at the bounce. A plate owns its
 * lower bound and not its upper; the last plate of a cushion owns both.
 * The top and bottom are cut in the middle of the floor, the sides in
 * thirds of it, so on the default floor at x 180 and at y 8 + 464/3 and
 * 8 + 928/3. The edges are the State's, never constants.
 */
export function plateAt(s: State, side: Side, x: number, y: number): number {
  const room = s.room;
  if (side === "top" || side === "bottom") {
    const right = x >= (room.left + room.right) / 2;
    if (side === "top") return right ? 1 : 0;
    return right ? 5 : 6;
  }
  const h = room.bottom - room.top;
  const third = y < room.top + h / 3 ? 0 : y < room.top + (2 * h) / 3 ? 1 : 2;
  return side === "right" ? 2 + third : 9 - third;
}

/** The middle of a plate along its cushion, and the cushion's inner edge: in units. */
export function plateMiddle(s: State, plate: number): { x: number; y: number } {
  const room = s.room;
  const midX = (room.left + room.right) / 2;
  const h = room.bottom - room.top;
  const along = (i: number) => room.top + (h * (2 * i + 1)) / 6;
  switch (PLATE_SIDE[plate]) {
    case "top":
      return { x: plate === 0 ? (room.left + midX) / 2 : (midX + room.right) / 2, y: room.top };
    case "bottom":
      return { x: plate === 6 ? (room.left + midX) / 2 : (midX + room.right) / 2, y: room.bottom };
    case "right":
      return { x: room.right, y: along(plate - 2) };
    case "left":
      return { x: room.left, y: along(9 - plate) };
  }
}

/** An offered plate's insert is this big, u, and stands this far inside the rail. */
export const INSERT_SIZE = 36;
export const INSERT_INSET = 4;

/** The middle of an offered plate's insert: 36 × 36 u on the floor in front of the plate's middle, 4 u inside the rail. */
export function insertCentre(s: State, plate: number): { x: number; y: number } {
  const m = plateMiddle(s, plate);
  const k = INSERT_INSET + INSERT_SIZE / 2;
  switch (PLATE_SIDE[plate]) {
    case "top":
      return { x: m.x, y: m.y + k };
    case "bottom":
      return { x: m.x, y: m.y - k };
    case "right":
      return { x: m.x - k, y: m.y };
    case "left":
      return { x: m.x + k, y: m.y };
  }
}

/** Does a circle overlap a pickup's square tile? */
export function overlapsTile(x: number, y: number, r: number, d: Thing): boolean {
  const half = KINDS.pickup.boxW / 2;
  const cx = x < d.x - half ? d.x - half : x > d.x + half ? d.x + half : x;
  const cy = y < d.y - half ? d.y - half : y > d.y + half ? d.y + half : y;
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy < r * r;
}

// ── A plate fires ─────────────────────────────────────────────────────

/**
 * He has just bounced off `plate` (cushions.ts's bounce has turned his
 * velocity already). Its charm does its thing. Returns the charm if it
 * did something, else "".
 */
function fire(s: State, tune: Tune, plate: number, events: SimEvent[]): string {
  const p = s.plates[plate];
  const l = s.launch;
  const h = s.him;
  switch (p.charm) {
    case "bumper": {
      // He leaves at bumperSpeed × launch speed in the direction of the
      // bounce, whatever speed he arrived at. Once a launch for each plate.
      if (l.bumped.includes(plate)) return "";
      const sp = Math.hypot(h.vx, h.vy);
      if (!(sp > 0)) return "";
      l.bumped.push(plate);
      const k = (tune.bumperSpeed * tune.maxSpeed) / sp;
      h.vx *= k;
      h.vy *= k;
      return "bumper";
    }
    case "pip":
      // One pip back if he is below the maximum, once a cooldown for each plate.
      if (s.tick < p.readyTick || s.pips >= s.stats.pipMax) return "";
      p.readyTick = s.tick + tune.pipPlateCooldown;
      givePip(s, "plate", events);
      return "pip";
    case "spark":
      // His ring reaches past his edge for a while, while he stays hot.
      l.sparkUntil = s.tick + tune.sparkTicks;
      return "spark";
    case "bell": {
      // Everything in the room that can be dazed by it is, once a cooldown.
      if (s.tick < p.readyTick) return "";
      p.readyTick = s.tick + tune.bellCooldown;
      const until = s.tick + tune.bellDazeTicks;
      for (let i = 0; i < s.things.length; i++) {
        const d = s.things[i];
        if (d.hp <= 0 || s.tick < d.landTick) continue;
        if (d.kind === "bunny" || d.kind === "token" || d.kind === "envelope") daze(s, d, until, events);
      }
      return "bell";
    }
    case "coin":
      // Pops pay coinFactor times for the rest of this launch.
      l.coin = true;
      return "coin";
    default:
      return "";
  }
}

/**
 * A bounce off a cushion, after it has been counted for the score. `first`:
 * it is this launch's first cushion. In order: an offered plate is taken
 * if this is an armed launch's first cushion; then the plate fires; then
 * the cushion event.
 */
export function bounceOff(s: State, tune: Tune, side: Side, first: boolean, speedIn: number, events: SimEvent[]): void {
  const h = s.him;
  const plate = plateAt(s, side, h.x, h.y);
  if (first && canTake(s)) {
    const items = s.offer.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind === "plate" && items[i].plate === plate) {
        take(s, tune, i, events);
        break;
      }
    }
  }
  const charm = s.plates[plate].charm === DARK ? "" : fire(s, tune, plate, events);
  events.push({ type: "cushion", tick: s.tick, x: h.x, y: h.y, side, speed: speedIn, plate, charm });
}

// ── The offer ─────────────────────────────────────────────────────────

/** Fisher-Yates, from the offers stream. */
function shuffle<T>(s: State, list: T[]): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rand(s.rng, "offers") * (i + 1));
    const t = list[i];
    list[i] = list[j];
    list[j] = t;
  }
  return list;
}

/** May `charm` go on `plate`? Pip never beside a Bumper plate, Bumper never beside a Pip plate. */
function mayUse(s: State, charm: WallCharm, plate: number): boolean {
  const mate = CORNER_MATE[plate];
  if (mate < 0) return true;
  const there = s.plates[mate].charm;
  if (charm === "pip") return there !== "bumper";
  if (charm === "bumper") return there !== "pip";
  return true;
}

/** A pickup spot is drawn this far inside every cushion, u. */
const PICKUP_INSET = 40;
/** Two pickups of one offer stand at least this far apart, u: a name is up to 106 px wide. */
const PICKUP_APART = 110;
/** A pickup stands at least this far from the middle of every offered plate's insert, u. */
const PICKUP_FROM_INSERT = 100;

/**
 * Where a pickup lies: up to 24 points drawn inside the floor, 40 u from
 * every cushion. The first that is far enough from him, from the offer's
 * other pickups and from every offered plate's insert; if none is, the
 * one farthest from him.
 */
function pickupSpot(s: State, tune: Tune, taken: { x: number; y: number }[], inserts: { x: number; y: number }[]): { x: number; y: number } {
  const room = s.room;
  const w = Math.max(0, room.right - room.left - 2 * PICKUP_INSET);
  const h = Math.max(0, room.bottom - room.top - 2 * PICKUP_INSET);
  let bx = (room.left + room.right) / 2;
  let by = (room.top + room.bottom) / 2;
  let best = -1;
  for (let i = 0; i < 24; i++) {
    const x = room.left + PICKUP_INSET + rand(s.rng, "offers") * w;
    const y = room.top + PICKUP_INSET + rand(s.rng, "offers") * h;
    const fromHim = Math.hypot(x - s.him.x, y - s.him.y);
    let ok = fromHim >= tune.pickupMinDist;
    for (let k = 0; ok && k < taken.length; k++) if (Math.hypot(x - taken[k].x, y - taken[k].y) < PICKUP_APART) ok = false;
    for (let k = 0; ok && k < inserts.length; k++) if (Math.hypot(x - inserts[k].x, y - inserts[k].y) < PICKUP_FROM_INSERT) ok = false;
    if (ok) return { x, y };
    if (fromHim > best) {
      best = fromHim;
      bx = x;
      by = y;
    }
  }
  return { x: bx, y: by };
}

/** One plate slot: walk the charms, and give the slot to the first that finds a dark plate it may use. */
function fillPlate(s: State, charms: WallCharm[], plates: number[], usedPlates: number[]): { charm: WallCharm; plate: number } | null {
  for (const charm of charms) {
    for (const plate of plates) {
      if (usedPlates.includes(plate)) continue;
      if (mayUse(s, charm, plate)) return { charm, plate };
    }
  }
  return null;
}

/**
 * Make the hour's offer, with the offers stream (§6.3), and put it out.
 * Returns false if there is nothing to offer: the hour is then settled.
 */
function makeOffer(s: State, tune: Tune, events: SimEvent[]): boolean {
  // 1. The wall charms with a copy left under their cap, shuffled; the dark plates, shuffled.
  const lit = (c: WallCharm) => s.plates.filter((p) => p.charm === c).length;
  const charms = shuffle(
    s,
    WALL_CHARMS.filter((c) => lit(c) < capOf(c, tune)),
  );
  const dark: number[] = [];
  for (let p = 0; p < PLATES; p++) if (s.plates[p].charm === DARK) dark.push(p);
  shuffle(s, dark);

  // 2. The first plate. 3. The second: the charms not yet used, the plates
  // not yet used; the same charm twice only if no other can fill the slot
  // and it has two copies left.
  const slots: { charm: WallCharm; plate: number }[] = [];
  const first = fillPlate(s, charms, dark, []);
  if (first) {
    slots.push(first);
    const others = charms.filter((c) => c !== first.charm);
    let second = fillPlate(s, others, dark, [first.plate]);
    if (!second && capOf(first.charm, tune) - lit(first.charm) >= 2) second = fillPlate(s, [first.charm], dark, [first.plate]);
    if (second) slots.push(second);
  }

  // 4 and 5. One body charm he has not taken, on the floor; three if no
  // plate could be offered; none if none is left.
  const bodies = shuffle(
    s,
    BODY_CHARMS.filter((c) => !s.charms.includes(c)),
  );
  const pickups = bodies.slice(0, slots.length === 0 ? 3 : 1);
  if (slots.length === 0 && pickups.length === 0) return false;

  // 6. Where each pickup lies.
  const items: OfferItem[] = slots.map((p) => ({ kind: "plate", charm: p.charm, plate: p.plate, thingId: -1 }));
  const inserts = slots.map((p) => insertCentre(s, p.plate));
  const spots: { x: number; y: number }[] = [];
  for (const charm of pickups) {
    const at = pickupSpot(s, tune, spots, inserts);
    spots.push(at);
    const d: Thing = {
      id: s.nextId++,
      kind: "pickup",
      x: at.x,
      y: at.y,
      px: at.x,
      py: at.y,
      vx: 0,
      vy: 0,
      wx: 0,
      wy: 0,
      hp: KINDS.pickup.hits,
      // It lies there from now on: nothing announces it.
      landTick: s.tick,
      dazedUntil: 0,
      phase: 0,
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
    items.push({ kind: "pickup", charm, plate: -1, thingId: d.id });
  }
  s.offer = { open: true, openTick: s.tick, armedTick: -1, items };
  events.push({ type: "offerOpen", tick: s.tick, items: copyItems(items) });
  return true;
}

function copyItems(items: readonly OfferItem[]): OfferItem[] {
  return items.map((i) => ({ ...i }));
}

/**
 * Step 4's part: the offer opens when the hour is clear, or at
 * `offerLatestTick` if it is not, and arms at the first tick from then on
 * at which he is landed, or `offerArmTicks` after it opened.
 */
export function offerStep(s: State, tune: Tune, into: number, events: SimEvent[]): void {
  const night = s.night;
  if (night.offerTick < 0 && (night.clearTick >= 0 || into >= tune.offerLatestTick)) {
    night.offerTick = s.tick;
    // With offers off, or nothing to offer, the hour is settled the moment the offer would have opened.
    if (!night.offers || !makeOffer(s, tune, events)) night.settledTick = s.tick;
  }
  const o = s.offer;
  if (o.open && o.armedTick < 0 && (!s.him.hot || s.tick >= o.openTick + tune.offerArmTicks)) {
    o.armedTick = s.tick;
    events.push({ type: "offerArmed", tick: s.tick });
  }
}

/** Can the launch in flight take something now? It is armed, it has taken nothing, and the offer is out. */
export function canTake(s: State): boolean {
  const l = s.launch;
  return l.active && l.armed && !l.took && s.offer.open;
}

/** Was this launch released after the offer armed? Asked as it is released. */
export function armedLaunch(s: State): boolean {
  const o = s.offer;
  return o.open && o.armedTick >= 0 && s.tick > o.armedTick;
}

/** The offer goes away: its pickups leave the room by the end of the tick. */
function clearOffer(s: State): void {
  for (const item of s.offer.items) {
    if (item.thingId < 0) continue;
    for (let i = 0; i < s.things.length; i++) {
      if (s.things[i].id === item.thingId) {
        s.things[i].hp = 0;
        break;
      }
    }
  }
  s.offer = { open: false, openTick: -1, armedTick: -1, items: [] };
}

/**
 * Item `i` is taken. The offer is settled and the rest of it goes away. A
 * plate is lit with its charm (and fires on this same bounce: the caller
 * fires it next); a body charm applies at once.
 */
export function take(s: State, tune: Tune, i: number, events: SimEvent[]): void {
  const items = copyItems(s.offer.items);
  const item = items[i];
  s.launch.took = true;
  s.night.settledTick = s.tick;
  clearOffer(s);
  if (item.kind === "plate") {
    s.plates[item.plate] = { charm: item.charm, readyTick: 0 };
  } else if (isBodyCharm(item.charm) && !s.charms.includes(item.charm)) {
    s.charms.push(item.charm);
    s.stats = statsFor(s.charms, tune);
    // Fourth pip: the new pip is filled at once. Thick skin: one heart is healed.
    if (item.charm === "fourthPip" && s.pips < s.stats.pipMax) s.pips++;
    if (item.charm === "thickSkin" && s.hearts < s.stats.maxHearts) s.hearts++;
  }
  events.push({ type: "offerTaken", tick: s.tick, item: i, kind: item.kind, charm: item.charm, plate: item.plate, items });
}

/** He overlaps a pickup's tile during an armed launch: it is taken, if the launch can still take. */
export function takePickup(s: State, tune: Tune, d: Thing, events: SimEvent[]): void {
  const items = s.offer.items;
  for (let i = 0; i < items.length; i++) {
    if (items[i].thingId === d.id) {
      take(s, tune, i, events);
      return;
    }
  }
}

/** The tick he lands is part of the launch: a tile he lands on is taken too. Asked before the launch closes. */
export function takeUnderHim(s: State, tune: Tune, events: SimEvent[]): void {
  if (!canTake(s)) return;
  const h = s.him;
  const blocked = s.launch.blocked;
  for (let i = 0; i < s.things.length; i++) {
    const d = s.things[i];
    if (d.kind !== "pickup" || d.hp <= 0) continue;
    if (blocked.length > 0 && blocked.includes(d.id)) continue;
    if (overlapsTile(h.x, h.y, s.stats.radius, d)) {
      takePickup(s, tune, d, events);
      return;
    }
  }
}

/** The next hour has begun, or the night has ended, with the offer still out: it is lost. */
export function closeOffer(s: State, events: SimEvent[]): void {
  if (!s.offer.open) return;
  const items = copyItems(s.offer.items);
  clearOffer(s);
  events.push({ type: "offerClosed", tick: s.tick, items });
}
