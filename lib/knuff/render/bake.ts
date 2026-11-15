/**
 * Bitmaps, baked once and stamped many times.
 *
 * The things in the room are pixel art on a 1 u grid (render/sprites.ts).
 * Drawn a cell at a time, a late-night room of 24 things is thousands of
 * rectangles a frame. So each bitmap is painted once, in its colours, at
 * the room's scale, into a canvas of its own, and the frame stamps that
 * canvas with one `drawImage` at a whole device pixel. Every cell edge is
 * rounded to a whole device pixel when it is baked: where the scale is a
 * whole number of device pixels a unit (a phone at 1 px a unit) every
 * cell is the same size; where it is not (a room shrunk to fit) a cell is
 * one pixel wider in some places than in others, as §9.1 accepts.
 *
 * Nothing here runs at load: the canvas is made inside a function.
 */

/** Rows of cells; each character names a colour in the palette it is baked with. Any character the palette lacks is empty. */
export type Bitmap = readonly string[];
export type Palette = Readonly<Record<string, string>>;

export type Baker = {
  /**
   * The bitmap baked in `palette` at `S` device pixels a unit, or null where
   * no canvas can be made. `key` names the bitmap and palette together:
   * the same key must always mean the same picture.
   */
  get(key: string, rows: Bitmap, palette: Palette, S: number): HTMLCanvasElement | null;
  /** Forget everything (the scale changed). */
  clear(): void;
  /** How many bitmaps are held: for the speed check. */
  readonly size: number;
};

/** The width of a bitmap, in cells: its longest row. */
export function bitmapWidth(rows: Bitmap): number {
  let w = 0;
  for (const r of rows) w = Math.max(w, r.length);
  return w;
}

export function createBaker(): Baker {
  const held = new Map<string, HTMLCanvasElement | null>();
  let scale = 0;
  return {
    get(key, rows, palette, S) {
      if (S !== scale) {
        held.clear();
        scale = S;
      }
      const have = held.get(key);
      if (have !== undefined) return have;
      const cols = bitmapWidth(rows);
      const w = Math.max(1, Math.round(cols * S));
      const h = Math.max(1, Math.round(rows.length * S));
      let out: HTMLCanvasElement | null = null;
      try {
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const ctx = c.getContext("2d");
        if (ctx) {
          for (let r = 0; r < rows.length; r++) {
            const y0 = Math.round(r * S);
            const y1 = Math.round((r + 1) * S);
            const row = rows[r];
            // One rectangle per run of a colour along the row.
            let c0 = 0;
            while (c0 < row.length) {
              const ch = row[c0];
              let c1 = c0 + 1;
              while (c1 < row.length && row[c1] === ch) c1++;
              const color = palette[ch];
              if (color) {
                ctx.fillStyle = color;
                const x0 = Math.round(c0 * S);
                ctx.fillRect(x0, y0, Math.round(c1 * S) - x0, y1 - y0);
              }
              c0 = c1;
            }
          }
          out = c;
        }
      } catch {
        out = null;
      }
      held.set(key, out);
      return out;
    },
    clear() {
      held.clear();
    },
    get size() {
      return held.size;
    },
  };
}

/**
 * The cells of a bitmap that lie on its outline: every filled cell with an
 * empty cell (or the bitmap's edge) above, below or beside it, all named
 * `ch`. The rest is empty. Gum's outline, drawn again over a bunch that
 * hides it, is this.
 */
export function outlineOf(rows: Bitmap, ch: string, empty = "-"): Bitmap {
  const filled = (r: number, c: number) => r >= 0 && r < rows.length && c >= 0 && c < rows[r].length && rows[r][c] !== empty;
  return rows.map((row, r) => {
    let out = "";
    for (let c = 0; c < row.length; c++) {
      const edge = filled(r, c) && (!filled(r - 1, c) || !filled(r + 1, c) || !filled(r, c - 1) || !filled(r, c + 1));
      out += edge ? ch : empty;
    }
    return out;
  });
}

/**
 * Where a picture `w` × `h` device pixels, scaled by (`sx`, `sy`) about
 * (`cx`, `cy`), is stamped: a rectangle a whole number of device pixels
 * wide and tall with its corners on whole device pixels (`cx` and `cy`
 * are whole). Stamped there nearest neighbour (`imageSmoothingEnabled`
 * off), a cell of the picture is a whole number of pixels: one wider in
 * some places than in others where the scale is not whole, as §9.1
 * accepts, and never a soft edge. A negative `sx` (a mirror) gives the
 * same rectangle mirrored about `cx`.
 */
export function stampRect(cx: number, cy: number, w: number, h: number, sx: number, sy: number): { x: number; y: number; w: number; h: number } {
  const dw = Math.max(1, Math.round(w * Math.abs(sx)));
  const dh = Math.max(1, Math.round(h * Math.abs(sy)));
  const left = cx - Math.round(dw / 2);
  return { x: sx < 0 ? 2 * cx - left - dw : left, y: cy - Math.round(dh / 2), w: dw, h: dh };
}
