import { COLOR_HEX, COLOR_HEX_SOFT, CREAM_HEX, INK_HEX } from "@/lib/colors";
import { hexRgb } from "@/lib/hugo/sprite";

/**
 * Colour literals. A canvas cannot read the site's CSS variables, so the
 * tokens it needs are repeated here, from lib/colors.ts where they exist.
 */
export const C = {
  /** Room dark: the page. */
  page: CREAM_HEX,
  /** The floor he moves on, as in the toy. */
  floor: "#10121d",
  /** Phosphor. */
  ink: INK_HEX,
  /** Muted phosphor (--color-ink-muted). */
  inkMuted: "#8e97a8",
  /** A dark cushion: the hairline grey, flattened onto the room dark. */
  rail: "#2e3136",
  /** A dummy, as in the toy. */
  ash: "#9aa7b8",
  /** The darkest the floor gets (03:00), and the warm it turns toward morning. */
  floorNight: "#07080f",
  floorWarm: "#1d1612",
  /** The floor when the lights come on at the end of a night that reached the boss's end (§10). */
  lightsOn: "#1b1f2e",
  /** An envelope: paper white, a shade off phosphor. */
  paper: "#f6f0dc",
  /** A raised key (--color-panel). */
  panel: "#1e2136",
  /** The polisher's casing, and the grey of its pad while the pad is off: grey boxes until the art comes. */
  casing: "#5b6172",
  casingDark: "#3b3f4c",
  magenta: COLOR_HEX.pink,
  mint: COLOR_HEX.green,
  acid: COLOR_HEX.yellow,
  coral: COLOR_HEX.tomato,
  amber: COLOR_HEX.orange,
  violet: COLOR_HEX.purple,
} as const;

/**
 * Each wall charm's colour (§6.1): on its plate, its insert and its name.
 * Body charms are drawn in phosphor.
 */
export const CHARM_COLOR: Readonly<Record<string, string>> = {
  bumper: C.coral,
  pip: C.mint,
  spark: C.amber,
  bell: C.violet,
  coin: C.acid,
};

/** Each wall charm's dark tint (the site's soft variants): a lit plate's floor insert. */
const CHARM_SOFT: Readonly<Record<string, string>> = {
  bumper: COLOR_HEX_SOFT.tomato,
  pip: COLOR_HEX_SOFT.green,
  spark: COLOR_HEX_SOFT.orange,
  bell: COLOR_HEX_SOFT.purple,
  coin: COLOR_HEX_SOFT.yellow,
};

/** A charm's dark tint, for the tile under its icon; the panel's colour for a body charm. */
export function charmSoft(charm: string): string {
  return CHARM_SOFT[charm] ?? C.panel;
}

/** The colour a charm is drawn and named in: its own for a wall charm, phosphor for a body charm. */
export function charmColor(charm: string): string {
  return CHARM_COLOR[charm] ?? C.ink;
}

export function rgba(color: string, a: number): string {
  const [r, g, b] = hexRgb(color);
  return `rgba(${r},${g},${b},${a})`;
}

/** `color` moved the share `t` of the way to `to`. */
export function mix(color: string, to: string, t: number): string {
  const a = hexRgb(color);
  const b = hexRgb(to);
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;
}
