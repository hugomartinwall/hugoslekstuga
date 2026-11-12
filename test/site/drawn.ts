import { createHash } from "node:crypto";

/**
 * What an image route hands to ImageResponse, read without rendering it.
 *
 * The share images and the apple icon are drawn out of absolutely placed
 * boxes (lib/og.tsx says why), so the tree an image route builds says
 * exactly what will be painted. `drawn` walks that tree the way the
 * renderer does: function components are called, and every box comes
 * out with its place in px from the image's top-left corner.
 *
 * A suite that imports an image route swaps next/og for `RecordedImage`,
 * which keeps the tree instead of painting it:
 *
 *   vi.mock("next/og", async () => ({
 *     ImageResponse: (await import("./drawn")).RecordedImage,
 *   }));
 */

/** Stands in for next/og's ImageResponse: it remembers what it was given. */
export class RecordedImage {
  constructor(
    readonly element: unknown,
    readonly options: unknown,
  ) {}
}

/** The tree an image route returned (it is typed as a real ImageResponse). */
export function recorded(response: unknown): RecordedImage {
  if (!(response instanceof RecordedImage)) {
    throw new Error("next/og is not mocked with RecordedImage in this suite");
  }
  return response;
}

export type Box = {
  /** Px from the image's top-left corner. */
  x: number;
  y: number;
  /** Px, or "100%" on the sheet everything is drawn on. */
  w: unknown;
  h: unknown;
  /** Its solid colour, lower-case #rrggbb; undefined if it has none. */
  color: string | undefined;
  /** Every style property the element was given. */
  style: Readonly<Record<string, unknown>>;
};

export type Drawn = {
  /** Every element, in painting order. */
  boxes: Box[];
  /** The `text` of every component that sets words (PixelText). */
  texts: string[];
};

type Element = { type: unknown; props: Record<string, unknown> };

function isElement(node: unknown): node is Element {
  return (
    typeof node === "object" && node !== null && "type" in node && "props" in node
  );
}

/** `#rrggbb`, from that or from `rgb(r, g, b)`. Anything else is returned as it is. */
export function hex(color: string): string {
  const rgb = color.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
  if (!rgb) return color.toLowerCase();
  return `#${rgb
    .slice(1)
    .map((v) => Number(v).toString(16).padStart(2, "0"))
    .join("")}`;
}

function px(value: unknown): number {
  if (value === undefined) return 0;
  if (typeof value !== "number") throw new Error(`a position that is not px: ${String(value)}`);
  return value;
}

export function drawn(
  node: unknown,
  at: { x: number; y: number } = { x: 0, y: 0 },
  out: Drawn = { boxes: [], texts: [] },
): Drawn {
  if (node === null || node === undefined || typeof node === "boolean") return out;
  if (Array.isArray(node)) {
    for (const child of node) drawn(child, at, out);
    return out;
  }
  if (!isElement(node)) {
    // The images have no font: a text node would be set in nothing.
    throw new Error(`text in an image: ${JSON.stringify(node)}`);
  }
  const { type, props } = node;
  if (typeof type === "function") {
    if (typeof props.text === "string") out.texts.push(props.text);
    return drawn((type as (p: unknown) => unknown)(props), at, out);
  }
  if (type !== "div") throw new Error(`<${String(type)}> in an image`);
  const style = (props.style ?? {}) as Record<string, unknown>;
  const here =
    style.position === "absolute"
      ? { x: at.x + px(style.left), y: at.y + px(style.top) }
      : at;
  const color = style.backgroundColor ?? style.background;
  out.boxes.push({
    ...here,
    w: style.width,
    h: style.height,
    color: typeof color === "string" ? hex(color) : undefined,
    style,
  });
  return drawn(props.children, here, out);
}

/**
 * Paint `boxes` onto a grid of `cell` px squares, `size` squares each
 * way, with the grid's corner at `origin`. Returns the colour of every
 * square, null where nothing was painted. Throws if a box does not sit
 * on whole squares: pixel art that is off its grid is blurred.
 */
export function cells(
  boxes: readonly Box[],
  cell: number,
  size: number,
  origin: { x: number; y: number } = { x: 0, y: 0 },
): (string | null)[][] {
  const grid = Array.from({ length: size }, () => Array<string | null>(size).fill(null));
  for (const box of boxes) {
    if (box.color === undefined) continue;
    const full = box.w === "100%" && box.h === "100%";
    const [x, y, w, h] = full
      ? [0, 0, size, size]
      : [box.x - origin.x, box.y - origin.y, px(box.w), px(box.h)].map((v) => v / cell);
    if (![x, y, w, h].every(Number.isInteger)) {
      throw new Error(
        `a box at ${box.x},${box.y}, ${String(box.w)}×${String(box.h)} px, is off the ${cell} px grid`,
      );
    }
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        if (yy < 0 || yy >= size || xx < 0 || xx >= size) {
          throw new Error(`a box at ${box.x},${box.y} reaches outside the ${size}×${size} grid`);
        }
        grid[yy][xx] = box.color;
      }
    }
  }
  return grid;
}

/**
 * The fingerprint of a picture: eight hex digits made from everything
 * the renderer is handed, which is the image's size and every element
 * with all its props, nested as it is. Two images with the same
 * fingerprint are the same picture, and one whose fingerprint changes
 * has, as far as anyone can tell without painting it, a new picture.
 */
export function fingerprint(image: RecordedImage): string {
  return createHash("sha256")
    .update(JSON.stringify([image.options, plain(image.element)], inOrder))
    .digest("hex")
    .slice(0, 8);
}

/** A tree as plain data: components called, children as one list. */
function plain(node: unknown): unknown[] {
  if (node === null || node === undefined || typeof node === "boolean") return [];
  if (Array.isArray(node)) return node.flatMap(plain);
  if (!isElement(node)) return [node];
  const { type, props } = node;
  if (typeof type === "function") {
    return plain((type as (p: unknown) => unknown)(props));
  }
  const { children, ...rest } = props;
  return [[String(type), rest, plain(children)]];
}

/** For JSON.stringify: an object's keys in one order, however it was written. */
function inOrder(_key: string, value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  return Object.fromEntries(
    Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}
