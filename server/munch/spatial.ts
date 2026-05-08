// Cheap spatial grid for collision lookups. Without this we'd be doing
// O(players × food) comparisons per tick — fine for ten entities,
// painful for a thousand.

export type SpatialEntity = {
  id: string | number;
  x: number;
  y: number;
};

export class SpatialGrid<T extends SpatialEntity> {
  private cellSize: number;
  private cols: number;
  private rows: number;
  private cells: Map<number, T[]>;

  constructor(worldSize: number, cellSize = 200) {
    this.cellSize = cellSize;
    this.cols = Math.ceil(worldSize / cellSize);
    this.rows = Math.ceil(worldSize / cellSize);
    this.cells = new Map();
  }

  clear(): void {
    this.cells.clear();
  }

  insert(entity: T): void {
    const k = this.keyFor(entity.x, entity.y);
    const bucket = this.cells.get(k);
    if (bucket) bucket.push(entity);
    else this.cells.set(k, [entity]);
  }

  /** Returns all entities within `radius` of (x, y). May include false
   * positives — caller should re-test with the precise distance. */
  nearby(x: number, y: number, radius: number): T[] {
    const out: T[] = [];
    const minCol = Math.floor((x - radius) / this.cellSize);
    const maxCol = Math.floor((x + radius) / this.cellSize);
    const minRow = Math.floor((y - radius) / this.cellSize);
    const maxRow = Math.floor((y + radius) / this.cellSize);
    for (let c = minCol; c <= maxCol; c++) {
      for (let r = minRow; r <= maxRow; r++) {
        const k = this.keyForCol(c, r);
        const bucket = this.cells.get(k);
        if (bucket) out.push(...bucket);
      }
    }
    return out;
  }

  /** Returns all entities whose cell intersects the given rectangle.
   * Used to scope what each player receives in their snapshot. */
  inRect(cx: number, cy: number, hx: number, hy: number): T[] {
    const out: T[] = [];
    const minCol = Math.floor((cx - hx) / this.cellSize);
    const maxCol = Math.floor((cx + hx) / this.cellSize);
    const minRow = Math.floor((cy - hy) / this.cellSize);
    const maxRow = Math.floor((cy + hy) / this.cellSize);
    for (let c = minCol; c <= maxCol; c++) {
      for (let r = minRow; r <= maxRow; r++) {
        const k = this.keyForCol(c, r);
        const bucket = this.cells.get(k);
        if (bucket) out.push(...bucket);
      }
    }
    return out;
  }

  private keyFor(x: number, y: number): number {
    const col = Math.floor(x / this.cellSize);
    const row = Math.floor(y / this.cellSize);
    return this.keyForCol(col, row);
  }

  private keyForCol(col: number, row: number): number {
    return row * this.cols + col;
  }
}
