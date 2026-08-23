/**
 * WHICH PROPS OWE A SIGHTLINE — the declared subject of the prop-siting rule.
 *
 * fun's R5 finding was one defect with four symptoms: the s5 well-ring at
 * sx 2295 on a 1280 frame, parapet-west never appearing, s7's strike-stones at
 * 0.0% of their stretch, and the gulch's west arrivals. The remedy is a
 * build-time rule — and a rule needs a SUBJECT, because **a rule over all props
 * would be exactly as false as the walked-line rule that declared 8 of 9
 * blockers illegal.** Not every prop owes a sightline. A stump is scenery.
 *
 * **Which props are load-bearing is a NARRATIVE fact, so story rules it** and
 * this table is that ruling, transcribed. It is deliberately a table of its own
 * rather than a field on `landmarks.ts`' `PROPS`, for three reasons: the
 * declaration is content and `PROPS` is presentation; a separate table makes
 * "every placed prop is classified" a referential-integrity assertion rather
 * than a TypeScript default (a defaulted field would silently classify a new
 * prop as not-load-bearing, which is the quiet half of the failure); and it
 * keeps the rule from being derived from the geometry it governs, which would
 * make it agree with whatever the world already does — green by construction
 * and incapable of ever going red (METHOD law 1).
 *
 * ⚠️ **THE NEGATIVE ROWS ARE NOT PADDING.** A list of only load-bearing props
 * cannot tell *"story decided this one owes nothing"* from *"story forgot it"*,
 * and that difference is the whole value of a declared subject. Every id in
 * `propPlacements()` appears here exactly once, `bearing: false` included.
 *
 * ⚑ **AMBIENT BY DESIGN IS NOT AMBIENT BY DEFEAT** (story's ruling, R6).
 * `bearing: false` is honest for a stain or a gate post — something *authored*
 * to be unlooked-at. **A prop authored as a witness that ends up owing no
 * sightline has not been reclassified; it has been abandoned in place.** The
 * question is never "does it still owe a sightline" but "would we author it
 * today, knowing what it now is." The east parapets are the worked example and
 * the answer was no.
 *
 * ⚑ **A WITNESS'S STRETCH IS WHERE ITS MOMENT HAPPENS, NOT WHERE ITS FICTION
 * BELONGS** (story's ruling, R6, extracted here because it will recur). The
 * strike-stones are the worked example and they reddened clause A the instant
 * the fiction was transcribed instead of the moment. `carries` and the stage a
 * thing's story belongs to are **different fields and must never be collapsed**
 * — exactly as `PROPS.stage` (whose arena rings must this clear) is a third,
 * different field again.
 *
 * ── CURRENT STATE ── eight rows against eight placements, asserted equal by
 * `test/sightline.test.ts`. Adding a prop without a row REDS; so does deleting
 * a prop and leaving its row, which is how the crossing's cut was caught within
 * a minute of gfx landing it.
 */

/** One prop's standing in the narrative. */
export interface Sightline {
  /** The `id` in `render/world/landmarks.ts`' `PROPS`. An address, not prose. */
  id: string;
  /**
   * True when a stage's identity DEPENDS on the player seeing this. False for
   * scenery — legal, wanted, and owing nothing.
   */
  bearing: boolean;
  /**
   * The stage stretch it is load-bearing FOR, by stage id — which is NOT
   * always the stage it stands in. `PROPS.stage` means *where it stands*
   * (whose arena rings it must clear); this means *whose walk it must carry*.
   * The strike-stones are the worked example: they stand in s8 because the
   * FIRE gem sits 3.5 m past s7's gate at road-arc 133, and they belong to
   * s7's fiction. Conflating the two is how a prop ends up clearance-legal and
   * stage-wrong, which METHOD already has a law about.
   */
  carries: string | null;
  /**
   * story's own sentence for what it says. Quoted verbatim into the failure
   * message, because a red reading "prop X is out of frame" teaches nobody and
   * one reading "the stage is named for it and it is never in shot" is a
   * design finding.
   */
  says: string;
  /**
   * Ids that carry the same subject together. A crossing is FOUR stubs at the
   * corners and a stone circle is two clusters; the subject is the pair, and a
   * rule that demanded each member individually satisfy every clause would
   * forbid the enclosure shape story authored on purpose (objects on BOTH
   * sides, so you are inside rather than passing).
   */
  group: string | null;
  /**
   * A KNOWN-FAILING ROW, with the reason and the exit criteria. The subject is
   * load-bearing, it does not satisfy the rule, and that is recorded rather
   * than excused — the gate reports it instead of breaking the build.
   *
   * ⚠️ **A HOLD IS ITSELF ASSERTED.** `test/sightline.test.ts` requires a held
   * row to be *currently failing*: the moment it starts passing, the hold reds
   * and must be removed. Otherwise a hold is a permanent exemption wearing a
   * deadline, and the next seat reads a green gate that has quietly stopped
   * checking the thing it was written for.
   */
  held: string | null;
}

export const SIGHTLINES: readonly Sightline[] = [
  {
    id: "well-ring",
    bearing: true,
    carries: "s5",
    says: "a village drowned around its water — and the stage is NAMED The Old Well",
    group: "well",
    held: null,
  },
  /**
   * ⛔ THE CROSSING IS CUT, AND THE REASON IS THE RULE ABOVE (fun's binding
   * verdict, PM-ratified, story R6). Both banks in frame measured **0.8% /
   * 5.0% / 0.0%** against a 50% bar — and not as a siting slip: the walking
   * frame runs about −11.4° to +59.5° about the walk axis, and **a crossing is
   * by definition two banks straddling that axis**, so one bank is always in
   * the blind half. The object is unbuildable under `FollowYaw`. The west pair
   * is gone from `landmarks.ts`; the east pair survives as a **roadside ruin**
   * and is therefore `bearing: false` — it owes no sightline and must never be
   * declared a witness.
   *
   * **Standing constraint for anyone writing s6 strings: no shipped string may
   * say bridge, span or crossing.** Nothing in the world supports one. The
   * PM's formulation is this rule read backwards and belongs here: *if a
   * string says bridge, the string is the defect, not the placement.*
   */
  /**
   * ⛔ **THE CROSSING IS GONE — WEST PAIR AND EAST PAIR BOTH, AND THE REASON IS
   * GEOMETRIC RATHER THAN A SITING SLIP** (fun's binding verdict, PM-ratified,
   * story R6). The west pair went first: both banks in frame measured **0.8% /
   * 5.0% / 0.0%** against a 50% bar, because the walking frame runs about
   * -11.4° to +59.5° about the walk axis and **a crossing is by definition two
   * banks straddling that axis**, so one bank is always in the blind half. The
   * object is unbuildable under `FollowYaw`.
   *
   * The east pair survived one ruling as a roadside ruin and then went too:
   * the only site that cleared s6's arena ring put `parapet-e-far` **3.08 m**
   * from the Great Snag — inside the 11.14 m road standoff gfx bought that
   * prop *specifically* so its limbs would have ground to read against — and
   * put both stubs past s6's exit at z 72, reproducing the well-ring's
   * arc-102.4 defect three rulings after it was written down.
   *
   * **No rows remain, and the census is why that is cheap.** Both cuts
   * reddened `test/sightline.test.ts` within a minute of gfx landing them,
   * before anyone read a message about either — the row-per-placed-prop
   * assertion turns a deletion into a red instead of a hunt.
   *
   * **Standing constraint for anyone writing s6 strings: no shipped string may
   * say bridge, span or crossing.** Nothing in the world supports one. The
   * PM's formulation belongs here: *if a string says bridge, the string is the
   * defect, not the placement.*
   */
  /**
   * ⚠️ THE FICTION IS s7 AND THE WALK IS s8, AND THAT IS NOT A CONTRADICTION.
   *
   * STORY.md lists the strike-stones under s7 — *"the burnt country has an
   * owner, and a trade"*, the stones FIRE is struck from — and gfx places them
   * with `stage: "s8"`. Both are right, and the first draft of this table
   * transcribed the fiction, which **reddened clause A immediately**: they
   * stand at road-arc 133.5 and 140.4 against s7's stretch of 114.6..129.5.
   *
   * The resolution is in story's own sentence: they stand *"AROUND the FIRE
   * gem at the s7 gate"*, and the FIRE gem sits past that gate at arc ~133 —
   * which is s8's opening metres. R6 moved them there deliberately, because
   * sited as a pass-by on the fen leg they measured **0.0%** of s7's stretch.
   * `carries` means *whose walk must be able to see it*, and that walk is the
   * one the player takes to the gem. The fiction they SERVE is s7's; the
   * stretch they must SURVIVE is s8's opening.
   *
   * Flagged to story for ratification rather than settled by me — the subject
   * is theirs. If they rule the stones belong to s7's walk after all, this row
   * changes and clause A reds until the stones move back, which is the rule
   * working rather than failing.
   */
  { id: "strike-stones-w", bearing: true, carries: "s8", says: "the burnt country has an owner, and a trade — FIRE is struck from these, and they stand around the gem", group: "stones", held: null },
  { id: "strike-stones-e", bearing: true, carries: "s8", says: "the burnt country has an owner, and a trade — FIRE is struck from these, and they stand around the gem", group: "stones", held: null },
  /**
   * ⚠️ HELD, and it is TWO independent failures on one subject — neither of
   * which fixes the other (story's ruling, R6):
   *   1. it is the only load-bearing subject with **no member in the wide
   *      half** (lateral −6.45 m, measured on the built road); and
   *   2. fun read its best pose as *"rust-brown angular masses — broken
   *      masonry or rock, not kilns"*, so it is also unidentified.
   * s9 is one of the five sag stages, and a landmark that never enters the
   * wide half is a pass-by with a landmark's declaration.
   */
  {
    id: "kiln-domes",
    bearing: true,
    carries: "s9",
    says: "an industry died here",
    group: "kilns",
    held:
      "row 9. Discharges only when all three land TOGETHER, in this order: " +
      "(1) the mesh is RE-CUT first — siting a shape that reads as rubble optimises the frame " +
      "around the wrong object; (2) the re-site puts at least one dome in the wide half; " +
      "(3) the bowl carve gives s9 its approach.",
  },
  {
    id: "great-snag",
    bearing: true,
    carries: "s7",
    says: "the counter-example that already works — story's law 4 as written, carrying s7's wide-half verge",
    group: "snag",
    held: null,
  },
  {
    /**
     * The road passes UNDER it. Its constraint is VERTICAL and it is a frame
     * measurement, not a geometry one (STORY.md row 1d), so the lateral rule
     * must not be made to pass on it by accident. Declared `bearing: false`
     * here and exempted by `overhead` in the rule — belt and braces on purpose,
     * because this is the one row where a silent pass would look like a check.
     */
    id: "fallen-giant",
    bearing: false,
    carries: null,
    says: "the burnt country is falling — but overhead, so the lateral rule does not govern it",
    group: null,
    held: null,
  },
];
