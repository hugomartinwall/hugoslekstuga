/**
 * A small SVG file of pixel art, read strictly.
 *
 * The favicon (app/icon.svg) is a static file: a browser hands it to an
 * XML parser, and a file that parser refuses is no icon at all. So this
 * reader takes a narrow kind of file and throws on everything else. What
 * it takes is always well-formed XML: elements with double-quoted
 * attributes, comments and white space between them, in plain ASCII. No
 * text, no entities, no doctype, no processing instruction, no
 * stylesheet.
 */

/** One element: its attributes as they are written, and its child elements. */
export type Tag = { name: string; attrs: Record<string, string>; children: Tag[] };

const SPACE = "[ \\t\\r\\n]";
const NAME = "[A-Za-z][\\w.:-]*";
/** A comment, a tag or white space: the three things that may stand in the file. */
const TOKEN = new RegExp(
  `<!--([^]*?)-->|<(/?)(${NAME})((?:${SPACE}+${NAME}="[^"<&]*")*)${SPACE}*(/?)>|${SPACE}+`,
  "y",
);
const ATTRIBUTE = new RegExp(`(${NAME})="([^"]*)"`, "g");

/** The elements at the top of the file. Throws where the file stops being that narrow kind. */
export function parseSvg(src: string): Tag[] {
  const odd = src.match(/[^\t\n\r -~]/);
  if (odd) {
    throw new Error(`a character that is not plain ASCII, at ${odd.index}: ${JSON.stringify(odd[0])}`);
  }
  const top: Tag[] = [];
  const open: Tag[] = [];
  let at = 0;
  while (at < src.length) {
    TOKEN.lastIndex = at;
    const token = TOKEN.exec(src);
    if (!token) {
      throw new Error(`not a tag, a comment or white space, at ${at}: ${JSON.stringify(src.slice(at, at + 40))}`);
    }
    at = TOKEN.lastIndex;
    const [, comment, closing, name, attributes, selfClosing] = token;
    if (comment !== undefined) {
      // XML has no "--" inside a comment, and none that ends "--->".
      if (/--|-$/.test(comment)) throw new Error(`"--" in a comment: <!--${comment}-->`);
      continue;
    }
    if (name === undefined) continue;
    if (closing) {
      if (attributes || selfClosing) throw new Error(`a closing tag with more in it: ${token[0]}`);
      if (open.pop()?.name !== name) throw new Error(`</${name}> closes nothing that is open`);
      continue;
    }
    const pairs = [...attributes.matchAll(ATTRIBUTE)].map((a) => [a[1], a[2]]);
    const tag: Tag = { name, attrs: Object.fromEntries(pairs), children: [] };
    if (Object.keys(tag.attrs).length !== pairs.length) {
      throw new Error(`an attribute given twice: ${token[0]}`);
    }
    (open.at(-1)?.children ?? top).push(tag);
    if (!selfClosing) open.push(tag);
  }
  if (open.length > 0) throw new Error(`<${open.at(-1)!.name}> is never closed`);
  return top;
}

/**
 * The cells that `groups` paint on a grid of `size` units each way: the
 * colour of each, null where nothing is painted. A group is
 * `<g fill="#rrggbb">` and holds `<rect x y width height/>` in whole
 * units; a rect takes its group's colour and paints over what came
 * before. Throws on anything else: another element, a rect with a fill,
 * a radius or a transform of its own, a rect that leaves the grid.
 */
export function rectCells(groups: readonly Tag[], size: number): (string | null)[][] {
  const grid = Array.from({ length: size }, () => Array<string | null>(size).fill(null));
  const only = (tag: Tag, name: string, attrs: string[]) => {
    const has = Object.keys(tag.attrs).sort().join(" ");
    if (tag.name !== name || has !== [...attrs].sort().join(" ")) {
      throw new Error(`<${tag.name} ${has}> where only <${name} ${attrs.join(" ")}> may stand`);
    }
  };
  for (const group of groups) {
    only(group, "g", ["fill"]);
    const { fill } = group.attrs;
    if (!/^#[0-9a-f]{6}$/.test(fill)) throw new Error(`a fill that is not #rrggbb: ${fill}`);
    for (const rect of group.children) {
      only(rect, "rect", ["x", "y", "width", "height"]);
      if (rect.children.length > 0) throw new Error("a rect with something inside it");
      const [x, y, width, height] = ["x", "y", "width", "height"].map((name) => {
        if (!/^\d+$/.test(rect.attrs[name])) {
          throw new Error(`a rect's ${name} that is not a whole number: ${rect.attrs[name]}`);
        }
        return Number(rect.attrs[name]);
      });
      if (width < 1 || height < 1 || x + width > size || y + height > size) {
        throw new Error(`a rect at ${x},${y}, ${width}×${height}, is not cells of the ${size}×${size} grid`);
      }
      for (let yy = y; yy < y + height; yy++) {
        for (let xx = x; xx < x + width; xx++) grid[yy][xx] = fill;
      }
    }
  }
  return grid;
}
