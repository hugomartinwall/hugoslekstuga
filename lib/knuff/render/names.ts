/**
 * Where the offer's names stand (§6.3), worked out so that no plate's name
 * lies under a pickup's tile or another name.
 *
 * The spec puts an offered plate's name beside its insert, on the side
 * nearer the middle of the room's height, and a pickup's name under its
 * tile. Pickups are placed 100 u from every offered insert's middle, but a
 * name is up to 106 px wide: in 6,000 offers a plate's name lay over a
 * pickup's name 16 times, by up to 12.5 px, and over its tile 5 times (the
 * step-2 check). So each name tries the spec's spot first, then a few
 * others near its insert or tile, and takes the first that is clear of
 * every insert, every tile and every name already placed, inside the
 * floor. Plate names are placed first and drawn last, so even where no
 * spot is clear (none was, in 6,000 offers, step6-look/runs) a plate's
 * name is never drawn under anything.
 *
 * Pure: the State, the width of each name in px and the scale go in;
 * boxes in room units come out. No DOM, so it is tested under Node.
 */
import { CHARM_NAME } from "../content/copy";
import { PLATE_SIDE } from "../content/charms";
import { INSERT_INSET, INSERT_SIZE, insertCentre } from "../sim/charms";
import type { State } from "../sim/types";

/** A box in room units. */
export type UBox = { x0: number; y0: number; x1: number; y1: number };
export type NameSpot = UBox & { text: string; charm: string; plate: boolean };

/** From the insert's or tile's edge to the middle of its name's line, px (§6.3's drawing). */
export const NAME_GAP_PX = 12;
/** A name's line is this tall, px: Silkscreen at 16 px with a pixel above and below. */
export const NAME_H_PX = 14;
/** A name keeps this far inside the floor, px. */
const EDGE_PX = 2;
/** The love heart's tile, u. */
const HEART_TILE = 28;

export function overlaps(a: UBox, b: UBox): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

/** The squares on the floor a name must keep off: offered inserts, pickup tiles, the love heart's tile. */
export function offerTiles(s: State): UBox[] {
  const half = INSERT_SIZE / 2;
  const out: UBox[] = [];
  if (s.offer.open) {
    for (const it of s.offer.items) {
      const c = it.kind === "plate" ? insertCentre(s, it.plate) : s.things.find((t) => t.id === it.thingId);
      if (c) out.push({ x0: c.x - half, y0: c.y - half, x1: c.x + half, y1: c.y + half });
    }
  }
  for (const d of s.things) {
    if (d.kind === "heart" && d.hp > 0 && s.tick >= d.landTick) {
      out.push({ x0: d.x - HEART_TILE / 2, y0: d.y - HEART_TILE / 2, x1: d.x + HEART_TILE / 2, y1: d.y + HEART_TILE / 2 + 4 });
    }
  }
  return out;
}

/**
 * Every offered name's box, in units. `widthPx(name)` is the name's width
 * in CSS px at 16 px; `scale` is the room's px per unit.
 */
export function placeNames(s: State, widthPx: (text: string) => number, scale: number): NameSpot[] {
  if (!s.offer.open) return [];
  const k = 1 / Math.max(0.05, scale);
  const gap = NAME_GAP_PX * k;
  const h = NAME_H_PX * k;
  const edge = EDGE_PX * k;
  const room = s.room;
  const half = INSERT_SIZE / 2;
  const tiles = offerTiles(s);
  const placed: NameSpot[] = [];

  /** A box `w` wide whose line's middle is at `ym`, starting at `left`, kept inside the floor. */
  const box = (left: number, w: number, ym: number): UBox => {
    let l = left;
    if (l + w > room.right - edge) l = room.right - edge - w;
    if (l < room.left + edge) l = room.left + edge;
    let m = ym;
    if (m - h / 2 < room.top + edge) m = room.top + edge + h / 2;
    if (m + h / 2 > room.bottom - edge) m = room.bottom - edge - h / 2;
    return { x0: l, y0: m - h / 2, x1: l + w, y1: m + h / 2 };
  };
  const clear = (b: UBox) => !tiles.some((t) => overlaps(b, t)) && !placed.some((n) => overlaps(b, n));
  const take = (text: string, charm: string, plate: boolean, tries: UBox[]) => {
    const pick = tries.find(clear) ?? tries[0];
    placed.push({ ...pick, text, charm, plate });
  };

  // The plates first: their names must never be under anything.
  for (const it of s.offer.items) {
    if (it.kind !== "plate") continue;
    const text = CHARM_NAME[it.charm] ?? it.charm.toUpperCase();
    const w = widthPx(text) * k;
    const c = insertCentre(s, it.plate);
    const side = PLATE_SIDE[it.plate];
    const under = it.plate <= 3 || it.plate >= 8;
    const below = c.y + half + gap;
    const above = c.y - half - gap;
    const tries: UBox[] = [];
    if (side === "top" || side === "bottom") {
      const ym = side === "top" ? below : above;
      const further = side === "top" ? ym + h : ym - h;
      tries.push(box(c.x - w / 2, w, ym));
      // Beside the insert, toward the middle of the room's width, then away from it.
      const right = c.x < (room.left + room.right) / 2;
      const inward = right ? c.x + half + gap / 2 : c.x - half - gap / 2 - w;
      const outward = right ? c.x - half - gap / 2 - w : c.x + half + gap / 2;
      tries.push(box(inward, w, c.y), box(outward, w, c.y), box(c.x - w / 2, w, further));
    } else {
      // On a side cushion a name starts at the insert's wall-side edge and runs toward the room.
      const left = side === "right" ? room.right - INSERT_INSET - w : room.left + INSERT_INSET;
      const first = under ? below : above;
      const other = under ? above : below;
      tries.push(box(left, w, first), box(left, w, other));
      // Beside the insert, on the room's side of it.
      const beside = side === "right" ? c.x - half - gap / 2 - w : c.x + half + gap / 2;
      tries.push(box(beside, w, c.y), box(left, w, under ? first + h : first - h), box(left, w, under ? other - h : other + h));
    }
    take(text, it.charm, true, tries);
  }

  // Then the pickups: under the tile, as the spec has it, or above it, or beside it.
  for (const it of s.offer.items) {
    if (it.kind !== "pickup") continue;
    const d = s.things.find((t) => t.id === it.thingId);
    if (!d) continue;
    const text = CHARM_NAME[it.charm] ?? it.charm.toUpperCase();
    const w = widthPx(text) * k;
    take(text, it.charm, false, [
      box(d.x - w / 2, w, d.y + half + gap),
      box(d.x - w / 2, w, d.y - half - gap),
      box(d.x + half + gap / 2, w, d.y),
      box(d.x - half - gap / 2 - w, w, d.y),
    ]);
  }
  return placed;
}

/**
 * A floating number's box, in units, drawn centred on (x, y): its face is
 * about 10 px a character at 22 px, 13 at 28 (`big`), as render/effects.ts
 * stacks them; `scale` is the room's px per unit.
 */
export function floatBox(x: number, y: number, text: string, big: boolean, scale: number): UBox {
  const k = 1 / Math.max(0.05, scale);
  const w = (text.length * (big ? 13 : 10) + 4) * k;
  const h = (big ? 24 : 19) * k;
  return { x0: x - w / 2, y0: y - h / 2, x1: x + w / 2, y1: y + h / 2 };
}

/**
 * Is a floating number in the offer's way? A number that rises onto an
 * offered name, an offered insert, a pickup's tile, the love heart's tile
 * or a lit plate's insert (`clear`: what the renderer drew this frame) is
 * faded back, as one over him is: 'SPARK' with 'x4' on it read 'SPARKx4'
 * (the play check of step 6).
 */
export function floatOver(b: UBox, clear: readonly UBox[]): boolean {
  return clear.some((c) => overlaps(b, c));
}
