/** Render between fixed simulation snapshots, one tick behind the live state. */
export function interpolatedPosition(
  entity: { x: number; y: number; prevX?: number; prevY?: number },
  alpha: number,
) {
  const blend = Math.max(0, Math.min(1, alpha));
  return {
    x:
      (entity.prevX ?? entity.x) +
      (entity.x - (entity.prevX ?? entity.x)) * blend,
    y:
      (entity.prevY ?? entity.y) +
      (entity.y - (entity.prevY ?? entity.y)) * blend,
  };
}
