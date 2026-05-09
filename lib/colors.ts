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

/** Raw hex codes. Mirrors @theme in app/globals.css. */
export const COLOR_HEX: Record<ToolColor, string> = {
  tomato: "#ff5a3c",
  blue: "#4f66f2",
  yellow: "#ffc233",
  pink: "#ff7ab2",
  green: "#3fa66e",
  purple: "#9333ea",
  orange: "#f97316",
  teal: "#0d9488",
};

/** Soft variants. Mirrors --color-{name}-soft tokens. */
export const COLOR_HEX_SOFT: Record<ToolColor, string> = {
  tomato: "#ffd5cc",
  blue: "#d6dcfc",
  yellow: "#ffeec2",
  pink: "#ffd6e7",
  green: "#cce8d8",
  purple: "#ead8fc",
  orange: "#fed7aa",
  teal: "#b8f0e7",
};

/** Yellow and pink want ink text on top of them; the other six want cream. */
const NEEDS_INK = new Set<ToolColor>(["yellow", "pink"]);

export function preferredTextHex(c: ToolColor): "#1a1812" | "#fbf6ee" {
  return NEEDS_INK.has(c) ? "#1a1812" : "#fbf6ee";
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
