/**
 * Drawing the plates, the offer and Spark's ring (§6.3, §9.5), plainly:
 * the art comes with step 6. What must hold already is that each kind of
 * offer can be read at a glance on a phone before it is taken.
 *
 *   - A lit plate is its rail segment in its charm's colour.
 *   - An offered plate is the same, and a 36 × 36 u insert on the floor in
 *     front of its middle, 4 u inside the rail, framed in the charm's
 *     colour and carrying its icon at 3 u a cell, with its name beside it.
 *   - A pickup is a 36 × 36 u tile with a phosphor frame and the icon, its
 *     name under it.
 *
 * Nothing offered pulses or blinks, with or without reduced motion.
 */
import { PLATE_SIDE, PLATES } from "../content/charms";
import { CHARM_NAME } from "../content/copy";
import { INSERT_INSET, INSERT_SIZE, insertCentre } from "../sim/charms";
import { ROOM_H, ROOM_W } from "../sim/state";
import type { State } from "../sim/types";
import { C, charmColor } from "./palette";
import type { Paint } from "./renderer";
import { CHARM_ICON } from "./sprites";

/** A tile's frame is this thick, u: the icon's empty ring of cells is under it. */
const FRAME_U = 2;
/** A name stands this far from its insert or tile, px, to the middle of its line. */
const NAME_GAP_PX = 12;

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

/** A 36 × 36 u tile centred on (cx, cy): room-dark, a frame, and the charm's icon at 3 u a cell. */
function drawTile(p: Paint, charm: string, cx: number, cy: number, frame: string, icon: string): void {
  const half = INSERT_SIZE / 2;
  const x0 = cx - half;
  const y0 = cy - half;
  fillU(p, x0, y0, x0 + INSERT_SIZE, y0 + INSERT_SIZE, frame);
  fillU(p, x0 + FRAME_U, y0 + FRAME_U, x0 + INSERT_SIZE - FRAME_U, y0 + INSERT_SIZE - FRAME_U, C.page);
  const rows = CHARM_ICON[charm];
  if (!rows) return;
  const cell = INSERT_SIZE / 12;
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      if (rows[r][c] !== "X") continue;
      fillU(p, x0 + c * cell, y0 + r * cell, x0 + (c + 1) * cell, y0 + (r + 1) * cell, icon);
    }
  }
}

/**
 * A name in Silkscreen at 16 px, its line's middle at `y` (device px). It
 * starts at `x` and runs the way `align` says, and is kept inside the floor.
 */
function drawName(p: Paint, s: State, name: string, x: number, y: number, align: "left" | "center" | "right", color: string): void {
  const { ctx, dpr } = p;
  ctx.font = `${Math.round(16 * dpr)}px ${p.fonts.pixel}`;
  const w = ctx.measureText(name).width;
  const lo = p.X(s.room.left) + 2 * dpr;
  const hi = p.X(s.room.right) - 2 * dpr;
  let left = align === "left" ? x : align === "right" ? x - w : x - w / 2;
  if (left + w > hi) left = hi - w;
  if (left < lo) left = lo;
  p.text(name, left, y, 16, color, "pixel", "left");
}

/** Cushion rails and lit segments: every plate that carries a charm, and every offered one, in its charm's colour. */
export function drawPlates(p: Paint, s: State): void {
  for (let i = 0; i < PLATES; i++) {
    let charm = s.plates[i].charm;
    if (charm === "") {
      const offered = s.offer.open ? s.offer.items.find((it) => it.kind === "plate" && it.plate === i) : undefined;
      if (!offered) continue;
      charm = offered.charm;
    }
    const r = plateRect(s, i);
    fillU(p, r.x0, r.y0, r.x1, r.y1, charmColor(charm));
  }
}

/** The offer on the floor: each offered plate's insert, and each pickup's tile, each with its name. */
export function drawOffer(p: Paint, s: State): void {
  if (!s.offer.open) return;
  const { dpr } = p;
  const room = s.room;
  const half = INSERT_SIZE / 2;
  for (const it of s.offer.items) {
    const name = CHARM_NAME[it.charm] ?? it.charm.toUpperCase();
    if (it.kind === "plate") {
      const c = insertCentre(s, it.plate);
      const color = charmColor(it.charm);
      drawTile(p, it.charm, c.x, c.y, color, color);
      // The name stands on the side of the insert nearer the middle of the room's height.
      const under = it.plate <= 3 || it.plate >= 8;
      const y = under ? p.Y(c.y + half) + NAME_GAP_PX * dpr : p.Y(c.y - half) - NAME_GAP_PX * dpr;
      const side = PLATE_SIDE[it.plate];
      if (side === "top" || side === "bottom") drawName(p, s, name, p.X(c.x), y, "center", color);
      // On a side cushion it starts at the insert's wall-side edge and runs toward the room.
      else if (side === "right") drawName(p, s, name, p.X(room.right - INSERT_INSET), y, "right", color);
      else drawName(p, s, name, p.X(room.left + INSERT_INSET), y, "left", color);
    } else {
      const d = s.things.find((t) => t.id === it.thingId);
      if (!d) continue;
      drawTile(p, it.charm, d.x, d.y, C.ink, charmColor(it.charm));
      drawName(p, s, name, p.X(d.x), p.Y(d.y + half) + NAME_GAP_PX * dpr, "center", C.ink);
    }
  }
}

/** Spark's ring, while it lasts and he is hot: a broken amber ring 12 u past his edge. */
export function drawSparkRing(p: Paint, s: State, hx: number, hy: number, reach: number): void {
  if (!s.him.hot || s.tick >= s.launch.sparkUntil) return;
  p.ring(p.X(hx), p.Y(hy), (s.stats.radius + reach) * p.S, C.amber, Math.max(2, Math.round(p.S * 2)));
}
