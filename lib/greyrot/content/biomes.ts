/**
 * The biome PROFILE table (R3, gfx's ask): what a zone's dressing IS, as
 * compiler-checked content instead of three compiler-invisible conditionals.
 *
 * Round 7's real plumbing cost was that adding a biome walked through none of
 * the code that defines one: dressBiomes' re-kind if-chain, plantWalls'
 * fence-kind ternary and the renderer's inline bare-ground predicate each
 * hardcoded the zone ids. A new BiomeId now fails compilation until it has a
 * row HERE — and a row in the renderer's BIOME_GROUND palette table, which the
 * content graph test asserts both halves of.
 *
 * Dressing is COLLISION truth (scatter instances sim blockers 1:1), which is
 * why this is content and not art: the palette stays in `render/art.ts` where
 * the capture loop iterates it (no colour literal outside that file); this
 * table owns what grows, what stands and what goes bare.
 */

import type { BiomeId } from "./types";

export interface BiomeProfile {
  /**
   * What this zone's forest IS. Ambient trees re-kind to it, and the road
   * fence plants it (rocks stay universal — shores and camera sleeves).
   */
  forestKind: "tree" | "cypress" | "snag";
  /**
   * Fraction of the re-kinded forest left standing. 1 keeps every trunk; the
   * ash country fells to sparse snags (~1 in 4). The felling draw consumes
   * RNG only when this is < 1, so adding a full-keep biome cannot shift the
   * dressing stream of the zones after it.
   */
  forestKeep: number;
  /** Whether ground grass grows here. The ash country goes bare (§2.1b). */
  grass: boolean;
}

export const BIOMES: Record<BiomeId, BiomeProfile> = {
  village: { forestKind: "tree", forestKeep: 1, grass: true },
  fen: { forestKind: "cypress", forestKeep: 1, grass: true },
  ash: { forestKind: "snag", forestKeep: 0.27, grass: false },
};
