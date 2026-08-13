import { COLOR_HEX, CREAM_HEX, INK_HEX } from "@/lib/colors";
import type { ToolColor } from "@/lib/tools";
import { hexRgb, mixHex, withAlpha } from "@/lib/hugo/sprite";

/**
 * Biome palettes — every colour on screen is derived from the world's
 * accent plus the two page constants, so all ten worlds stay unmistakably
 * Nattöppet: phosphor tints over room dark.
 */

export type Biome = {
  accent: string;
  floor: string;
  floorAlt: string; // checker shimmer
  wall: string;
  wallTop: string;
  hazard: string; // bog/lava/current fill
  glow: string; // soft accent wash
  deco: string;
};

const ROOM_RGB = hexRgb(CREAM_HEX);
const INK_RGB = hexRgb(INK_HEX);

const cache = new Map<string, Biome>();

export function biomeFor(color: ToolColor): Biome {
  const key = color;
  const hit = cache.get(key);
  if (hit) return hit;
  const accent = COLOR_HEX[color];
  const b: Biome = {
    accent,
    floor: mixHex(accent, ROOM_RGB, 0.93),
    floorAlt: mixHex(accent, ROOM_RGB, 0.9),
    wall: mixHex(accent, ROOM_RGB, 0.74),
    wallTop: mixHex(accent, ROOM_RGB, 0.62),
    hazard: mixHex(accent, ROOM_RGB, 0.55),
    glow: withAlpha(accent, 0.14),
    deco: mixHex(accent, INK_RGB, 0.45),
  };
  cache.set(key, b);
  return b;
}

export { CREAM_HEX, INK_HEX, mixHex, withAlpha };
