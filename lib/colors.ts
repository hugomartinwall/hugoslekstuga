import type { ToolColor } from "./tools";

/**
 * Single source of truth for the eight accent colours.
 *
 * Mirrors the @theme tokens declared in app/globals.css. Every component that
 * needs to map a Tool's `color` to a Tailwind class or a literal hex pulls
 * from here — never from a hand-rolled local record. Tailwind needs the
 * literal class strings to be visible at build time, so each helper returns
 * a string-literal-typed value (no template interpolation) to keep the JIT
 * scanner happy.
 */

/**
 * The two neutrals as literals, for canvas/SVG code that can't read CSS
 * variables. Mirrors --color-ink / --color-cream in @theme. "Cream" is a
 * historical name — it means "the page surface", whatever the skin says
 * that is; "ink" means "the text colour on it". In Nattöppet the surface
 * is room-dark and the ink is phosphor.
 */
export const INK_HEX = "#e8f2e9";
export const CREAM_HEX = "#0b0c14";

/** Raw hex codes, phosphor edition. Mirrors @theme in app/globals.css. */
export const COLOR_HEX: Record<ToolColor, string> = {
  tomato: "#ff6e5e", // coral
  blue: "#35e0ff", // cyan
  yellow: "#d8ff3d", // acid
  pink: "#ff4fd8", // magenta
  green: "#3df08a", // mint
  purple: "#a78bff", // violet
  orange: "#ffb13d", // amber
  teal: "#8af0ff", // ice
};

/** Soft variants — dark accent-tinted surfaces. Mirrors --color-{name}-soft. */
export const COLOR_HEX_SOFT: Record<ToolColor, string> = {
  tomato: "#3a252f",
  blue: "#1a3749",
  yellow: "#343c2a",
  pink: "#3a2042",
  green: "#1b3a36",
  purple: "#2c2a49",
  orange: "#3a302a",
  teal: "#283a49",
};

/**
 * Every phosphor accent is bright enough to want the room-dark text on
 * top ("cream" = the page surface = room dark). The set is kept so a
 * future skin can flip individual accents back.
 */
const NEEDS_INK = new Set<ToolColor>([]);

export function preferredTextHex(c: ToolColor): "#e8f2e9" | "#0b0c14" {
  return NEEDS_INK.has(c) ? "#e8f2e9" : "#0b0c14";
}

export function preferredTextClass(c: ToolColor): "text-ink" | "text-cream" {
  return NEEDS_INK.has(c) ? "text-ink" : "text-cream";
}

/** Solid background. */
export function bgClass(c: ToolColor): string {
  return ({
    tomato: "bg-tomato",
    blue: "bg-blue",
    yellow: "bg-yellow",
    pink: "bg-pink",
    green: "bg-green",
    purple: "bg-purple",
    orange: "bg-orange",
    teal: "bg-teal",
  } satisfies Record<ToolColor, string>)[c];
}

/** Soft background. */
export function bgSoftClass(c: ToolColor): string {
  return ({
    tomato: "bg-tomato-soft",
    blue: "bg-blue-soft",
    yellow: "bg-yellow-soft",
    pink: "bg-pink-soft",
    green: "bg-green-soft",
    purple: "bg-purple-soft",
    orange: "bg-orange-soft",
    teal: "bg-teal-soft",
  } satisfies Record<ToolColor, string>)[c];
}

/**
 * Soft background that turns solid on hover. Returned as a literal pair so
 * Tailwind JIT can see both the base and the `hover:bg-*` class at build time
 * (it can't see classes built via template interpolation in JSX).
 */
export function bgSoftHoverClass(c: ToolColor): string {
  return ({
    tomato: "bg-tomato-soft hover:bg-tomato",
    blue: "bg-blue-soft hover:bg-blue",
    yellow: "bg-yellow-soft hover:bg-yellow",
    pink: "bg-pink-soft hover:bg-pink",
    green: "bg-green-soft hover:bg-green",
    purple: "bg-purple-soft hover:bg-purple",
    orange: "bg-orange-soft hover:bg-orange",
    teal: "bg-teal-soft hover:bg-teal",
  } satisfies Record<ToolColor, string>)[c];
}

/** Text colour matching the accent. */
export function textClass(c: ToolColor): string {
  return ({
    tomato: "text-tomato",
    blue: "text-blue",
    yellow: "text-yellow",
    pink: "text-pink",
    green: "text-green",
    purple: "text-purple",
    orange: "text-orange",
    teal: "text-teal",
  } satisfies Record<ToolColor, string>)[c];
}

/** Native form-control accent (range thumb, checkbox, radio). */
export function accentClass(c: ToolColor): string {
  return ({
    tomato: "accent-tomato",
    blue: "accent-blue",
    yellow: "accent-yellow",
    pink: "accent-pink",
    green: "accent-green",
    purple: "accent-purple",
    orange: "accent-orange",
    teal: "accent-teal",
  } satisfies Record<ToolColor, string>)[c];
}

/** Ring colour matching the accent. */
export function ringClass(c: ToolColor): string {
  return ({
    tomato: "ring-tomato",
    blue: "ring-blue",
    yellow: "ring-yellow",
    pink: "ring-pink",
    green: "ring-green",
    purple: "ring-purple",
    orange: "ring-orange",
    teal: "ring-teal",
  } satisfies Record<ToolColor, string>)[c];
}

/** Convenience: full-fill (bg + the readable text colour on top). */
export function fillClasses(c: ToolColor): string {
  return `${bgClass(c)} ${preferredTextClass(c)}`;
}
