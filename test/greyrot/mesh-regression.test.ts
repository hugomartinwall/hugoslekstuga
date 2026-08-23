import { describe, expect, it } from "vitest";
import manifest from "./fixtures/mesh-manifest.json";
import { allMeshes } from "../../lib/greyrot/render/mesh/all";
import { fingerprint } from "../../lib/greyrot/render/mesh/hash";
import { propPlacements } from "../../lib/greyrot/render/world/landmarks";

/**
 * The roster guard.
 *
 * There is no 3D artist on this project — every creature is a function, and
 * those functions all sit on top of one shared DSL. A change to `subdivide` or
 * `loft` can therefore deform every character in the game at once, in a way
 * nobody notices until it is on a store cover.
 *
 * If this fails and the change was intentional: look at the mesh in the preview
 * harness first (`npm run dev` → /preview.html), then `npm run mesh:snapshot`.
 */

type Fingerprint = { vertices: number; triangles: number; hash: string };
const golden = manifest as Record<string, Fingerprint>;

describe("mesh roster", () => {
  it("has a fingerprint recorded for every registered mesh", () => {
    const missing = allMeshes()
      .map((e) => e.id)
      .filter((id) => !(id in golden));
    expect(missing, "run: npm run mesh:snapshot").toEqual([]);
  });

  it("has no orphaned fingerprints for meshes that no longer exist", () => {
    const live = new Set(allMeshes().map((e) => e.id));
    const orphans = Object.keys(golden).filter((id) => !live.has(id));
    expect(orphans, "run: npm run mesh:snapshot").toEqual([]);
  });

  for (const entry of allMeshes()) {
    it(`${entry.id} is unchanged`, () => {
      const expected = golden[entry.id];
      if (!expected) return; // reported by the coverage test above
      expect(fingerprint(entry.build())).toEqual(expected);
    });
  }

  /**
   * NO PROP MESH MAY BE REGISTERED AND UNPLACED (R6, mech's catch on gfx's cut).
   *
   * `sightlines.ts`' census asserts a row per PLACED prop, so a deletion reds
   * within a minute — and that is exactly why it cannot see this one:
   * **it is keyed on `propPlacements()`, so a generator that is registered and
   * placed nowhere is invisible to it by construction.** mech flagged the gap
   * rather than filling it in this area, which is the right call and the reason
   * it is here.
   *
   * The hole is real and it has two independent costs. `registerMesh` is a
   * top-level side effect, so an unplaced generator is **shipped Tier-0 geometry
   * for an object no player can see**; and it is **a loaded gun for a future
   * seat**, because a mesh that exists is a mesh someone places again in R9
   * on the grounds that it is there. R6's cut deleted `parapetStubMesh` for
   * exactly those two reasons after story ruled the crossing out. Nothing
   * enforced it — the cut was a decision somebody remembered to make.
   *
   * ⚠️ **THE EXCEPTIONS ARE NAMED, NOT PATTERN-MATCHED.** Two prop meshes are
   * placed by paths that are not `PROPS`, and listing them by hand with a
   * reason is the point: an id-prefix rule would silently absorb the next
   * abandoned generator that happened to be called `prop/something-instanced`.
   * A new exception costs one line and one sentence of justification, which is
   * the price this rule is charging on purpose.
   */
  it("registers no prop mesh that nothing in the world places", () => {
    const placedElsewhere = new Map([
      // Instanced by `Scatter` off the obstacle list, one per authored brazier.
      ["prop/brazier", "scatter.ts, per `obstacles.list` brazier"],
      // The drowned stump: a single hand-placed landmark inside `buildLandmarks`
      // at STUMP_AT, not a `PROPS` row, because it is authored into water and
      // needs the waterline clamp that the generic path does not do.
      ["prop/stump", "landmarks.ts, STUMP_AT, water-clamped by hand"],
    ]);
    const placed = new Set(propPlacements().map((p) => `prop/${p.mesh}`));
    const abandoned = allMeshes()
      .map((e) => e.id)
      .filter((id) => id.startsWith("prop/"))
      .filter((id) => !placed.has(id) && !placedElsewhere.has(id));
    expect(
      abandoned,
      "a registered prop mesh that nothing places is shipped bytes for an invisible object — " +
        "delete the generator, or place it, or add it to placedElsewhere WITH a reason",
    ).toEqual([]);
  });

  it("stays inside the triangle budget", () => {
    // Characters are drawn many times per frame on a 4 GB Chromebook
    // (CLAUDE.md §5). A creature drifting past ~2.5k triangles is a budget
    // decision, not an accident — make it deliberately.
    for (const entry of allMeshes()) {
      if (entry.group !== "character") continue;
      const { triangles } = fingerprint(entry.build());
      expect(triangles, `${entry.id} is too dense`).toBeLessThan(2500);
    }
  });

  it("is deterministic across repeated builds", () => {
    for (const entry of allMeshes()) {
      expect(fingerprint(entry.build())).toEqual(fingerprint(entry.build()));
    }
  });
});
