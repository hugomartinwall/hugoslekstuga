import { describe, expect, it } from "vitest";
import { FOES } from "../../lib/greyrot/content/foes";
import {
  ASHCAP_PALETTE,
  CINDERLING_PALETTE,
  FOE_RIGS,
  RIMECAP_PALETTE,
  ROTFANG_PALETTE,
  ROTLING_PALETTE,
  SEEPER_PALETTE,
  SOPLING_PALETTE,
  STORMLING_PALETTE,
  THORNBACK_PALETTE,
  type SporelingPalette,
} from "../../lib/greyrot/render/chars/sporeling";

/**
 * The foe identity kit's two written-but-unenforced rules, made enforceable
 * (R2 — the roster grew from five to eight, which is exactly when unenforced
 * rules start drifting):
 *
 * 1. ART_DIRECTION §2.2: **no Greyrot SURFACE may exceed 0.12 saturation.**
 *    Eyes are glows — the signal channel — and exempt by the same section.
 * 2. Every sim foe kind has an authored rig row. The `FOE_RIGS` lookup falls
 *    back to the rotling so a missing row degrades to a legible body instead
 *    of a crash — but that fallback is a safety net for corrupt data, not a
 *    licence to ship a kind without a silhouette. A kind that renders as a
 *    rotling has no identity, and nothing else fails loudly when that
 *    happens.
 *
 * This is data-level, not rendering: rendering itself stays verified by
 * captures (CLAUDE.md §14), and the black-shape lineup remains the judge of
 * whether the silhouettes actually READ. This test only pins what a capture
 * cannot: the numeric ceiling and the roster pairing.
 */

/** HSV saturation of an sRGB triple: (max − min) / max. */
function saturation([r, g, b]: readonly [number, number, number]): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

/** Every Rot-family palette, by kind. Living characters are exempt — they are
 * high-chroma BY DESIGN (§2.3) and must never appear in this list. */
const ROT_PALETTES: Record<string, SporelingPalette> = {
  rotling: ROTLING_PALETTE,
  ashcap: ASHCAP_PALETTE,
  seeper: SEEPER_PALETTE,
  sopling: SOPLING_PALETTE,
  cinderling: CINDERLING_PALETTE,
  rimecap: RIMECAP_PALETTE,
  rotfang: ROTFANG_PALETTE,
  stormling: STORMLING_PALETTE,
  // The boss rides the same ceiling as the roster — a boss that reads
  // colourful would break the readability system harder than any common.
  thornback: THORNBACK_PALETTE,
};

/**
 * The GLOW slots — the signal channel, exempt from the ceiling by
 * ART_DIRECTION §2.2. Declared rather than implied, because the guard below
 * needs to tell "deliberately exempt" from "nobody classified this".
 */
const GLOW_SLOTS = ["eye", "eyeLight"] as const;

/** The surface slots. `eye`/`eyeLight` are glows and deliberately absent. */
const SURFACE_SLOTS = [
  "cap",
  "spot",
  "gill",
  "stalk",
  "coat",
  "trouser",
  "leather",
  "icicle",
  "thorn",
] as const;

describe("foe identity kit", () => {
  it("keeps every Rot surface at or under the 0.12 saturation ceiling", () => {
    /**
     * ⚠️ THE CEILING USED TO BE ABLE TO ENFORCE ITSELF OVER ZERO COLOURS
     * (comp's R7 empty-subject census, and it was the strongest instance in
     * the suite). `SURFACE_SLOTS` is a hand-maintained string list and every
     * lookup that misses is a `continue`. Rename one palette key — `coat` to
     * `jacket`, say — and every lookup returns undefined, `breaches` is empty,
     * and this reports that **every Rot surface is under the ceiling having
     * measured no surfaces at all.** A green check that measures nothing, in
     * the check named for the property it stopped measuring.
     *
     * Guarded below by `examined`, and the strong guard is the third one: it
     * is not a floor on a count but a CLASSIFICATION of every key that exists.
     * A floor can be satisfied by the slots that still resolve while a renamed
     * one silently drops out; an unknown key cannot hide from an inverse
     * check. That is the same shape as `sightlines.ts`' row-per-placed-prop
     * census, one file along.
     */
    const breaches: string[] = [];
    const examined = new Map<string, number>();
    const unclassified: string[] = [];
    for (const [kind, pal] of Object.entries(ROT_PALETTES)) {
      for (const key of Object.keys(pal)) {
        if (!SURFACE_SLOTS.includes(key as (typeof SURFACE_SLOTS)[number]) &&
            !GLOW_SLOTS.includes(key as (typeof GLOW_SLOTS)[number])) {
          unclassified.push(`${kind}.${key}`);
        }
      }
      let n = 0;
      for (const slot of SURFACE_SLOTS) {
        const c = pal[slot];
        if (!c) continue; // icicle exists on the rimecap only
        n++;
        const s = saturation(c);
        if (s > 0.12) breaches.push(`${kind}.${slot} sat ${s.toFixed(3)}`);
      }
      examined.set(kind, n);
    }
    expect(breaches).toEqual([]);

    // THE THREE GUARDS, weakest to strongest.
    const total = [...examined.values()].reduce((a2, b2) => a2 + b2, 0);
    expect(total, "the ceiling examined almost nothing — SURFACE_SLOTS has drifted").toBeGreaterThan(
      30,
    );
    for (const [kind, n] of examined) {
      expect(n, `${kind} contributed no surface to the ceiling — its palette keys have drifted`)
        .toBeGreaterThan(0);
    }
    expect(
      unclassified,
      "a palette key is neither a declared surface nor a declared glow, so nothing decides " +
        "whether the ceiling applies to it — classify it in SURFACE_SLOTS or GLOW_SLOTS",
    ).toEqual([]);
  });

  it("has an authored rig row for every sim foe kind", () => {
    const missing = Object.keys(FOES).filter((id) => !(id in FOE_RIGS));
    expect(missing, "a kind without a FOE_RIGS row silently renders as a rotling").toEqual([]);
  });

  it("has a Rot palette under ceiling-enforcement for every rig row", () => {
    // The inverse pairing: a rig added without registering its palette above
    // would silently escape the saturation test.
    const unenforced = Object.keys(FOE_RIGS).filter((id) => !(id in ROT_PALETTES));
    expect(unenforced).toEqual([]);
  });
});
