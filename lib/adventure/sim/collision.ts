import { isSolid, ROOM_H, ROOM_W, T, TILE, tileAt, type TileId } from "./rooms";

/**
 * Top-down geometry kit — pure functions over the tile grid and circles.
 * Movement is axis-separated move-and-slide: at ≤ 8 px/tick against 16 px
 * tiles nothing can tunnel, so no swept tests are needed.
 */

export type Mover = { x: number; y: number; r: number };

function solidAt(tiles: Uint8Array, tx: number, ty: number, cleared: boolean): boolean {
  return isSolid(tileAt(tiles, tx, ty), cleared);
}

/** Does a circle at (x, y) overlap any solid tile? */
export function circleHitsSolid(
  tiles: Uint8Array,
  x: number,
  y: number,
  r: number,
  cleared: boolean,
): boolean {
  const minTx = Math.floor((x - r) / TILE);
  const maxTx = Math.floor((x + r) / TILE);
  const minTy = Math.floor((y - r) / TILE);
  const maxTy = Math.floor((y + r) / TILE);
  for (let ty = minTy; ty <= maxTy; ty++) {
    for (let tx = minTx; tx <= maxTx; tx++) {
      if (!solidAt(tiles, tx, ty, cleared)) continue;
      // Closest point on the tile AABB to the circle centre.
      const cx = Math.max(tx * TILE, Math.min(x, tx * TILE + TILE));
      const cy = Math.max(ty * TILE, Math.min(y, ty * TILE + TILE));
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy < r * r) return true;
    }
  }
  return false;
}

/**
 * Move-and-slide: apply (dx, dy) one axis at a time, clamping each axis
 * against solids so the other axis' motion survives (wall sliding).
 * Mutates the mover; returns which axes hit.
 */
export function moveAndSlide(
  tiles: Uint8Array,
  m: Mover,
  dx: number,
  dy: number,
  cleared: boolean,
): { hitX: boolean; hitY: boolean } {
  let hitX = false;
  let hitY = false;

  if (dx !== 0) {
    const nx = m.x + dx;
    if (!circleHitsSolid(tiles, nx, m.y, m.r, cleared)) {
      m.x = nx;
    } else {
      // Binary-nudge to the wall face (3 halvings is sub-pixel at our speeds).
      let lo = 0;
      let hi = dx;
      for (let i = 0; i < 3; i++) {
        const mid = (lo + hi) / 2;
        if (circleHitsSolid(tiles, m.x + mid, m.y, m.r, cleared)) hi = mid;
        else lo = mid;
      }
      m.x += lo;
      hitX = true;
    }
  }

  if (dy !== 0) {
    const ny = m.y + dy;
    if (!circleHitsSolid(tiles, m.x, ny, m.r, cleared)) {
      m.y = ny;
    } else {
      let lo = 0;
      let hi = dy;
      for (let i = 0; i < 3; i++) {
        const mid = (lo + hi) / 2;
        if (circleHitsSolid(tiles, m.x, m.y + mid, m.r, cleared)) hi = mid;
        else lo = mid;
      }
      m.y += lo;
      hitY = true;
    }
  }

  return { hitX, hitY };
}

/** Circle-vs-circle overlap. */
export function circlesOverlap(
  ax: number,
  ay: number,
  ar: number,
  bx: number,
  by: number,
  br: number,
): boolean {
  const dx = ax - bx;
  const dy = ay - by;
  const rr = ar + br;
  return dx * dx + dy * dy < rr * rr;
}

/** Push two overlapping circles apart (mutates both by half each). */
export function separate(
  a: { x: number; y: number; r: number },
  b: { x: number; y: number; r: number },
): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  const overlap = a.r + b.r - d;
  if (overlap <= 0) return;
  const nx = d > 0.001 ? dx / d : 1;
  const ny = d > 0.001 ? dy / d : 0;
  a.x -= (nx * overlap) / 2;
  a.y -= (ny * overlap) / 2;
  b.x += (nx * overlap) / 2;
  b.y += (ny * overlap) / 2;
}

/** Smallest signed angle difference a−b, in (−π, π]. */
export function angDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * Melee sector test: does a circle target sit inside the swing arc?
 * The arc is centred on `ang`, spans `arcRad`, reaches `reach` past the
 * attacker's edge. Near targets always count (no dead zone at the hilt).
 */
export function sectorHits(
  ax: number,
  ay: number,
  ang: number,
  reach: number,
  arcRad: number,
  tx: number,
  ty: number,
  tr: number,
): boolean {
  const dx = tx - ax;
  const dy = ty - ay;
  const d = Math.hypot(dx, dy);
  if (d - tr > reach) return false;
  if (d < tr + 6) return true; // point blank — always connects
  const toTarget = Math.atan2(dy, dx);
  // Widen the test by the target's angular radius so edges connect.
  const slack = Math.atan2(tr, Math.max(d, 1));
  return Math.abs(angDiff(toTarget, ang)) <= arcRad / 2 + slack;
}

/** Clamp a position inside the playfield with a margin. */
export function clampToRoom(m: { x: number; y: number }, margin: number): void {
  m.x = Math.max(margin, Math.min(ROOM_W * TILE - margin, m.x));
  m.y = Math.max(margin, Math.min(ROOM_H * TILE - margin, m.y));
}

/** The tile under a point. */
export function tileUnder(tiles: Uint8Array, x: number, y: number): TileId {
  return tileAt(tiles, Math.floor(x / TILE), Math.floor(y / TILE));
}

/** Is the point on a current-lane tile? Returns flow vector or null. */
export function currentFlow(tiles: Uint8Array, x: number, y: number): { x: number; y: number } | null {
  const t = tileUnder(tiles, x, y);
  if (t === T.CUR_R) return { x: 1, y: 0 };
  if (t === T.CUR_L) return { x: -1, y: 0 };
  if (t === T.CUR_U) return { x: 0, y: -1 };
  if (t === T.CUR_D) return { x: 0, y: 1 };
  return null;
}
