/**
 * The cushions, their plates, the floor inserts, the offer and Spark's
 * ring (§6.3, §9.5, §10).
 *
 *   - The cushions are stepped rails 8 u thick, cut into their ten plates
 *     by a groove. A dark plate is a hairline-grey segment with a lip
 *     toward the floor.
 *   - A lit plate is its segment in its charm's colour, and a 28 × 28 u
 *     insert on the floor in front of its middle, 4 u inside the rail: a
 *     tile of the charm's dark tint carrying its icon at 2 u a cell.
 *   - An offered plate is lit the same way on the rail, and its insert is
 *     bigger: 36 × 36 u, framed in the charm's colour, the icon at 3 u a
 *     cell, its name beside it.
 *   - A pickup is a 36 × 36 u tile with a phosphor frame and the icon, its
 *     name under it.
 *   - When a plate fires its segment flashes (not with reduced motion: a
 *     flash is what that setting takes away; the plate's squares still
 *     burst in its colour).
 *
 * The names are placed by render/names.ts so that none lies under a tile
 * or another name. Nothing offered pulses or blinks, with or without
 * reduced motion.
 */
import { PLATE_SIDE, PLATES } from "../content/charms";
import { INSERT_SIZE, insertCentre } from "../sim/charms";
import { ROOM_H, ROOM_W } from "../sim/state";
import type { State } from "../sim/types";
import type { Palette } from "./bake";
import { placeNames } from "./names";
import { C, charmColor, charmSoft, mix } from "./palette";
import type { Paint } from "./renderer";
import { CHARM_ICON, tileBitmap } from "./sprites";

/** A lit plate's insert, u, and how much nearer the rail its middle is than an offered one's. */
const LIT_SIZE = 28;
/** A tile's frame is this thick, u: the icon's empty ring of cells is under it. */
const FRAME_U = 2;
/** The groove between two plates, u. */
const GROOVE_U = 1;

/** The groove the plates sit in: the whole rail is painted this first, under them. */
export const RAIL_GROOVE = mix(C.page, C.rail, 0.45);
const DARK_PLATE = { body: C.rail, lip: mix(C.rail, C.ink, 0.16), outer: mix(C.rail, C.page, 0.35) };

/** A plate's rail segment, in units: the part of its cushion between the floor and the room's outer edge. */
export function plateRect(s: State, plate: number): { x0: number; y0: number; x1: number; y1: number } {
  const room = s.room;
  const mid = (room.left + room.right) / 2;
  const h = room.bottom - room.top;
  const third = (i: number) => room.top + (h * i) / 3;
  switch (PLATE_SIDE[plate]) {
    case "top":
      return plate === 0 ? { x0: room.left, y0: 0, x1: mid, y1: room.top } : { x0: mid, y0: 0, x1: room.right, y1: room.top };
    case "bottom":
      return plate === 6 ? { x0: room.left, y0: room.bottom, x1: mid, y1: ROOM_H } : { x0: mid, y0: room.bottom, x1: room.right, y1: ROOM_H };
    case "right":
      return { x0: room.right, y0: third(plate - 2), x1: ROOM_W, y1: third(plate - 1) };
    case "left":
      return { x0: 0, y0: third(9 - plate), x1: room.left, y1: third(10 - plate) };
  }
}

/** A rectangle in units, snapped to whole device pixels. */
function fillU(p: Paint, x0: number, y0: number, x1: number, y1: number, color: string): void {
  const l = Math.round(p.X(x0));
  const t = Math.round(p.Y(y0));
  const r = Math.round(p.X(x1));
  const b = Math.round(p.Y(y1));
  if (r <= l || b <= t) return;
  p.ctx.fillStyle = color;
  p.ctx.fillRect(l, t, r - l, b - t);
}


/** The charm a plate shows on the rail: its own, or the one offered on it, or "" (dark). */
function plateCharm(s: State, i: number): string {
  if (s.plates[i].charm !== "") return s.plates[i].charm;
  if (!s.offer.open) return "";
  const offered = s.offer.items.find((it) => it.kind === "plate" && it.plate === i);
  return offered ? offered.charm : "";
}

/**
 * The ten plates on the rail, each a segment with a groove at its ends, a
 * lip toward the floor and a darker outer edge. `flash(i)` is how far
 * plate i is into its flash, 0 for none, 1 at its brightest.
 */
export function drawPlates(p: Paint, s: State, flash: (plate: number) => number): void {
  for (let i = 0; i < PLATES; i++) {
    const charm = plateCharm(s, i);
    const r = plateRect(s, i);
    const side = PLATE_SIDE[i];
    const along = side === "top" || side === "bottom";
    // The groove at each end, so each plate reads as a piece.
    const x0 = along ? r.x0 + GROOVE_U : r.x0;
    const x1 = along ? r.x1 - GROOVE_U : r.x1;
    const y0 = along ? r.y0 : r.y0 + GROOVE_U;
    const y1 = along ? r.y1 : r.y1 - GROOVE_U;
    let body: string = DARK_PLATE.body;
    let lip = DARK_PLATE.lip;
    let outer = DARK_PLATE.outer;
    if (charm !== "") {
      const c = charmColor(charm);
      body = c;
      lip = mix(c, C.ink, 0.5);
      outer = mix(c, C.page, 0.35);
    }
    const k = flash(i);
    if (k > 0) {
      body = mix(body, C.ink, 0.7 * k);
      lip = mix(lip, C.ink, 0.7 * k);
    }
    fillU(p, x0, y0, x1, y1, body);
    // The lip: 1 u on the floor's side. The outer edge: 2 u on the room's edge.
    if (side === "top") {
      fillU(p, x0, y1 - 1, x1, y1, lip);
      fillU(p, x0, y0, x1, y0 + 2, outer);
    } else if (side === "bottom") {
      fillU(p, x0, y0, x1, y0 + 1, lip);
      fillU(p, x0, y1 - 2, x1, y1, outer);
    } else if (side === "right") {
      fillU(p, x0, y0, x0 + 1, y1, lip);
      fillU(p, x1 - 2, y0, x1, y1, outer);
    } else {
      fillU(p, x1 - 1, y0, x1, y1, lip);
      fillU(p, x0, y0, x0 + 2, y1, outer);
    }
  }
}

/** The middle of a lit plate's 28 u insert: 4 u inside the rail, in front of the plate's middle. */
export function litInsertCentre(s: State, plate: number): { x: number; y: number } {
  const c = insertCentre(s, plate);
  const back = (INSERT_SIZE - LIT_SIZE) / 2;
  switch (PLATE_SIDE[plate]) {
    case "top":
      return { x: c.x, y: c.y - back };
    case "bottom":
      return { x: c.x, y: c.y + back };
    case "right":
      return { x: c.x + back, y: c.y };
    case "left":
      return { x: c.x - back, y: c.y };
  }
}

/** A tile bitmap stamped centred on (cx, cy). */
function tile(p: Paint, key: string, size: number, frame: number, charm: string, cell: number, pal: Palette, cx: number, cy: number): void {
  const icon = CHARM_ICON[charm];
  if (!icon) return;
  p.stamp(key, tileBitmap(size, frame, icon, cell), pal, cx - size / 2, cy - size / 2);
}

/** Each lit plate's insert on the floor (§10): under everything that moves. */
export function drawLitInserts(p: Paint, s: State): void {
  for (let i = 0; i < PLATES; i++) {
    const charm = s.plates[i].charm;
    if (charm === "") continue;
    const c = litInsertCentre(s, i);
    tile(p, `lit-${charm}`, LIT_SIZE, 0, charm, 2, { i: charmSoft(charm), x: charmColor(charm) }, c.x, c.y);
  }
}

/**
 * The offer on the floor, in two parts (§9.9 puts gum between them): the
 * `inserts`, each offered plate's insert, and the `tiles`, each pickup's
 * tile. The names come after both, and after the love heart's tile
 * (`drawOfferNames`).
 */
export function drawOffer(p: Paint, s: State, part: "inserts" | "tiles"): void {
  if (!s.offer.open) return;
  for (const it of s.offer.items) {
    if ((it.kind === "plate") !== (part === "inserts")) continue;
    if (it.kind === "plate") {
      const c = insertCentre(s, it.plate);
      const color = charmColor(it.charm);
      tile(p, `offer-${it.charm}`, INSERT_SIZE, FRAME_U, it.charm, 3, { f: color, i: C.page, x: color }, c.x, c.y);
    } else {
      const d = s.things.find((t) => t.id === it.thingId);
      if (!d) continue;
      tile(p, `pickup-${it.charm}`, INSERT_SIZE, FRAME_U, it.charm, 3, { f: C.ink, i: C.page, x: charmColor(it.charm) }, d.x, d.y);
    }
  }
}

/** Widths of the names, px at 16 px, as the page's font draws them: measured once each. */
const widths = new Map<string, number>();

/**
 * The offer's names, in Silkscreen at 16 px: a plate's in its charm's
 * colour beside its insert, a pickup's in phosphor under its tile, each
 * where render/names.ts found room. Plate names are drawn last.
 */
export function drawOfferNames(p: Paint, s: State): void {
  if (!s.offer.open) return;
  const { ctx, dpr } = p;
  const font = `${Math.round(16 * dpr)}px ${p.fonts.pixel}`;
  const widthPx = (text: string) => {
    const key = `${p.fonts.pixel}|${text}`;
    let w = widths.get(key);
    if (w === undefined) {
      ctx.font = font;
      w = ctx.measureText(text).width / dpr;
      widths.set(key, w);
    }
    return w;
  };
  const spots = placeNames(s, widthPx, p.layout.s);
  for (const pass of [false, true]) {
    for (const n of spots) {
      if (n.plate !== pass) continue;
      p.text(n.text, p.X(n.x0), p.Y((n.y0 + n.y1) / 2), 16, n.plate ? charmColor(n.charm) : C.ink, "pixel", "left");
    }
  }
}

/** Spark's ring, while it lasts and he is hot: a broken amber ring 12 u past his edge. */
export function drawSparkRing(p: Paint, s: State, hx: number, hy: number, reach: number): void {
  if (!s.him.hot || s.tick >= s.launch.sparkUntil) return;
  p.ring(p.X(hx), p.Y(hy), (s.stats.radius + reach) * p.S, C.amber, Math.max(2, Math.round(p.S * 2)));
}
