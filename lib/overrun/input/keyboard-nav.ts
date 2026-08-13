/**
 * Spatial keyboard navigation over the board.
 *
 * Screen space, not world space. The camera quarter-turns the board in
 * portrait (see render/camera.ts), so "left" has to mean left on the player's
 * screen — navigating in world coordinates would send the arrow keys sideways
 * on a phone. Callers pass screen positions from `worldToScreen`.
 *
 * Pure and DOM-free so it can be tested; ties break on id so it is
 * deterministic.
 */

export interface NavCandidate {
  id: number;
  sx: number;
  sy: number;
}

export type NavDir = "up" | "down" | "left" | "right";

/** Unit vector of a direction in screen space (y grows downward). */
const AXIS: Record<NavDir, { x: number; y: number }> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/**
 * The best candidate in `dir` from `from`.
 *
 * Scored by distance along the direction plus twice the lateral offset, so a
 * node slightly further away but straight ahead beats a near one off to the
 * side — which is what "press right" means to a player. Candidates behind the
 * start point are excluded; if that leaves nothing, we wrap to the furthest
 * candidate on the opposite side so the arrows never dead-end.
 */
export function stepFocus(
  from: { sx: number; sy: number } | null,
  candidates: readonly NavCandidate[],
  dir: NavDir,
): number | null {
  if (candidates.length === 0) return null;
  if (!from) return candidates.reduce((a, b) => (a.id <= b.id ? a : b)).id;

  const ax = AXIS[dir];
  let best: { id: number; score: number } | null = null;
  let wrap: { id: number; score: number } | null = null;

  for (const c of candidates) {
    const dx = c.sx - from.sx;
    const dy = c.sy - from.sy;
    const along = dx * ax.x + dy * ax.y;
    const lateral = Math.abs(dx * ax.y - dy * ax.x);
    if (Math.abs(along) < 0.01 && lateral < 0.01) continue; // the node itself

    if (along > 0.5) {
      const score = along + 2 * lateral;
      if (!best || score < best.score || (score === best.score && c.id < best.id)) {
        best = { id: c.id, score };
      }
    } else {
      // Furthest in the opposite direction, for the wrap — with the SAME
      // lateral penalty as the forward case, so wrapping lands on the node
      // straight across rather than whichever one is most diagonal.
      const score = -along - 2 * lateral;
      if (!wrap || score > wrap.score || (score === wrap.score && c.id < wrap.id)) {
        wrap = { id: c.id, score };
      }
    }
  }
  return (best ?? wrap)?.id ?? null;
}

/** Next/previous in a stable id-ordered ring. Used by Tab. */
export function cycleFocus(
  current: number | null,
  ids: readonly number[],
  delta: 1 | -1,
): number | null {
  if (ids.length === 0) return null;
  const sorted = [...ids].sort((a, b) => a - b);
  if (current === null) return delta === 1 ? sorted[0]! : sorted[sorted.length - 1]!;
  const i = sorted.indexOf(current);
  if (i < 0) return sorted[0]!;
  return sorted[(i + delta + sorted.length) % sorted.length]!;
}

/** Move a menu cursor, clamped to the row count and wrapping at both ends. */
export function stepMenu(current: number, count: number, delta: 1 | -1): number {
  if (count <= 0) return 0;
  return (current + delta + count) % count;
}
