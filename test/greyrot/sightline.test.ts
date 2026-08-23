import { describe, expect, it } from "vitest";
import { STAGES } from "../../lib/greyrot/content";
import { SIGHTLINES } from "../../lib/greyrot/content/sightlines";
import { buildScenario } from "../../lib/greyrot/sim/scenario";
import { propPlacements } from "../../lib/greyrot/render/world/landmarks";

/**
 * THE PROP-SITING RULE (R6) — a prop a stretch DEPENDS on must be sited where
 * that stretch can see it.
 *
 * fun's unifying R5 finding, one defect with four symptoms: props on one side
 * of the road are systematically outside the walking frame, and props sited at
 * the very start or end of their stage are walked AWAY from. gfx measured both
 * halves; story ruled the subject (`content/sightlines.ts`); this is the rule.
 *
 * ── WHAT THIS RULE IS, AND WHAT IT DELIBERATELY IS NOT ──
 *
 * It is a RULER for two questions and it refuses to be a ruler for a third.
 *
 *   A. THE STRETCH (longitudinal). Does the prop stand inside the road-arc
 *      span of the stage whose walk it carries? Pure geometry over the BUILT
 *      road (`world.roadPath`), no camera model anywhere in it. gfx measured
 *      four props sited at the extreme ends of their stage — the well-ring
 *      declared s5 stood 5.7 m INSIDE s6 — *clearance-legal and stage-wrong*,
 *      which is METHOD's own law with a measured instance.
 *
 *   B. THE SIDE (lateral). The walking frame is not symmetric about the road:
 *      `FollowYaw` holds VIEW_YAW between the walk and the lens, so the wedge
 *      reaches ~59.5° one way and ~11.4° the other. A subject placed wholly in
 *      the narrow half is being sited in the blind spot.
 *
 *   C. **WHETHER A GIVEN METRE IS IN FRAME — NOT ASSERTED HERE, ON PURPOSE.**
 *      All three other seats measured the projector and reached the same
 *      verdict: *"this is a compass, not a ruler"* (story), *"a siting
 *      instrument, not a verdict"* (gfx), and fun's own correction that every
 *      percentage is window-relative and must name its window — three
 *      instruments once returned 0.0%, 96/96 and 23% for one prop by choosing
 *      three different windows, and METHOD 11c-bis is the record of it.
 *      Percentages are a smell test; the frames in `captures/` are the
 *      evidence, and a contested siting goes to a live walk. A build-time
 *      threshold on in-frame share would be a number standing in for a
 *      picture, which is Face A of this project's named failure mode.
 *
 *   D. **WHETHER A WITNESS HOLDS ACROSS EVERY APPROACH A PLAYER CAN REACH —
 *      REFUSED, AND THIS RULE IS SINGLE-PATH BY CONSTRUCTION.** fun drove the
 *      SPARK beat's shipped trigger three times at 1280x800, *same instant,
 *      same viewport*, and the gem projected at sx **-407, -506 and +683** —
 *      off the left edge twice, dead centre once. The discriminator is the
 *      heading the player carries into the gate, set by which of two burning
 *      huts 7.6 m apart they doused last. **A prop can pass every clause here
 *      and still fail most players.** Clause A is a ruler over the built road:
 *      one deterministic path, and it can only ever report the approach it
 *      drove.
 *
 *      **This rule therefore does not certify a path-dependent witness — it
 *      refuses it.** Not by averaging: an average over approaches is the
 *      share problem one level up, and this cycle killed that instrument
 *      twice. The runtime answer is the one that works, and it already
 *      exists — `main.ts`' `awaitTake` holds a find-adjacent line until the
 *      find's own chip is ON SCREEN, so *"the referent is visible"* becomes a
 *      trigger condition instead of a build-time hope. **A build-time rule
 *      cannot make a path-dependent witness safe; a runtime gate can.**
 *
 * ⚑ **THE THREE SEVERITIES ARE NOT ONE KIND OF DEFECT** (story, R6, after
 * proposing a placement-shaped fix for a gating-shaped problem):
 *   - **ABSENT** — the referent is not in the world at all (s1's caption named
 *     a spring; s1 declares no terrain). **A writing defect. No geometric rule
 *     can ever see it** — the subject is missing, not misplaced.
 *   - **UNREACHABLE** — no approach frames it (the well-ring, the strike-stones).
 *     A placement defect, and **the only one of the three this file governs.**
 *   - **PATH-DEPENDENT** — framed on some approaches and not others (the SPARK
 *     gem). A gating defect, answered at runtime by `awaitTake`, never here.
 *
 * ⚠️ **AND IT CANNOT CERTIFY IDENTIFIABILITY, WHICH IS A DIFFERENT PROPERTY.**
 * A prop can pass every clause here and still read as the scenery it stands
 * in. Four of ours did: fun looked at the kilns' best pose and read *"rust-
 * brown angular masses — broken masonry or rock, not kilns"*; the well-ring at
 * 14 m read as scatter boulders. Worse, a prop's noun can live in ONE component
 * — gfx's well-ring cypress hid the *windlass* while the kerb read perfectly,
 * so the object was unoccluded and still lost the part that says *well*.
 * **A green here means the prop is where the stretch can see it. It does not
 * mean the player gets the prop.** That question belongs to `capture-roadside.mjs`,
 * to value separation, and to fun's eye.
 *
 * ── CURRENT STATE ── clause A, the census and both vacuity guards are
 * REGRESSION GUARDS and pass on gfx's settled R6 table. Red-proven, each at its
 * own condition: clause A from the PLACEMENT side (the well-ring returned to
 * road-arc 99.5, its pre-R6 position inside s6) and from the DECLARATION side
 * (told to carry s4 while standing where it stands); the census by renaming a
 * prop in `landmarks.ts` with no ruling here; the sign guard by inverting the
 * lateral convention, which reds on the Great Snag; the span guard by making
 * the spans unbounded. Clause B is measured and REPORTED, not asserted — see
 * its own note; the kiln field is the open row and it belongs to story.
 *
 * ⚠️ **THE FIRST RED-PROOF OF CLAUSE A WAS TOO WEAK AND CAME BACK GREEN**, and
 * the reason is worth keeping: I moved the well-ring 5.75 m north expecting it
 * to leave s5, and it did not — the prop stands 6 m off the road, so its
 * nearest road sample crawls, and z 58.25 → 64.0 moves the arc only 91.0 →
 * 94.8 against a boundary at 96.7. **A perturbation is a consequence asserted
 * into an instance like any other**, and the fix was to measure the arc as a
 * function of the position rather than to assume a metre of world was a metre
 * of road. If a red-proof comes back green, suspect the perturbation before
 * the check.
 */

const { world } = buildScenario();

/** Cumulative arc length along the BUILT road, metres — not the authored route. */
const ARC: number[] = [0];
for (let i = 1; i < world.roadPath.length; i++) {
  const a = world.roadPath[i - 1]!;
  const b = world.roadPath[i]!;
  ARC.push(ARC[i - 1]! + Math.hypot(b.x - a.x, b.z - a.z));
}

function nearestSample(x: number, z: number): number {
  let bi = 0;
  let bd = Infinity;
  world.roadPath.forEach((p, i) => {
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < bd) {
      bd = d;
      bi = i;
    }
  });
  return bi;
}

/** A stage's own stretch of road, in arc metres, from its predecessor's gate. */
function stageSpan(stageId: string): { from: number; to: number } {
  const si = STAGES.findIndex((st) => st.id === stageId);
  expect(si, `no stage with id ${stageId}`).toBeGreaterThanOrEqual(0);
  const from = si > 0 ? (world.gateIndices[si - 1] ?? 0) : 0;
  const to = world.gateIndices[si] ?? world.roadPath.length - 1;
  return { from: ARC[from]!, to: ARC[to]! };
}

/**
 * Signed lateral offset from the road, in WALK-LEG terms: positive is the
 * player's LEFT on this leg, which is the wide half of the frame.
 *
 * ⚠️ **NEVER WRITE THIS RULE IN COMPASS TERMS** (story's LAW 5, and the
 * instruction is exactly where that rot would survive). Chapter 1 walks north,
 * so the wide half reads as *east* — and chapter 2 turns south-east, where it
 * is *north-east*. A rule that said "east" would put every chapter-2 subject
 * in the blind half. The invariant is the walk leg; the compass is not.
 */
function lateral(x: number, z: number): { off: number; arc: number } {
  const i = nearestSample(x, z);
  const last = world.roadPath.length - 1;
  const a = world.roadPath[Math.max(0, i - 1)]!;
  const b = world.roadPath[Math.min(last, i + 1)]!;
  const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  const hx = (b.x - a.x) / len;
  const hz = (b.z - a.z) / len;
  const p = world.roadPath[i]!;
  return { off: (x - p.x) * hz - (z - p.z) * hx, arc: ARC[i]! };
}

const PLACED = propPlacements();

describe("the prop-siting rule", () => {
  it("classifies every placed prop — no prop is silently unclassified", () => {
    // The REQUIRED-no-default half. A prop added to `landmarks.ts` without a
    // ruling in `sightlines.ts` reds here rather than defaulting to "owes
    // nothing", which is the quiet half of the failure this rule is about.
    const placed = PLACED.map((p) => p.id).sort();
    const ruled = SIGHTLINES.map((s) => s.id).sort();
    expect(ruled, "sightlines.ts and landmarks.ts' PROPS disagree").toEqual(placed);
    expect(new Set(ruled).size, "a prop is ruled on twice").toBe(ruled.length);
  });

  it("names a real stage for everything it says is load-bearing", () => {
    for (const s of SIGHTLINES) {
      if (!s.bearing) {
        expect(s.carries, `${s.id} owes nothing but names a stretch`).toBeNull();
        continue;
      }
      expect(s.carries, `${s.id} is load-bearing for nothing`).not.toBeNull();
      expect(
        STAGES.some((st) => st.id === s.carries),
        `${s.id} carries "${s.carries}", which is not a stage`,
      ).toBe(true);
      expect(s.says.length, `${s.id} has no sentence — the red would teach nobody`).toBeGreaterThan(20);
    }
  });

  it("CLAUSE A: a load-bearing prop stands inside the stretch it carries", () => {
    // The longitudinal half. `PROPS.stage` is where a prop STANDS (whose arena
    // rings it clears); `carries` is whose walk it must serve. They differ for
    // the strike-stones on purpose, and that difference is exactly why this
    // reads `carries` and not `stage`.
    const failures: string[] = [];
    for (const s of SIGHTLINES) {
      if (!s.bearing) continue;
      const p = PLACED.find((q) => q.id === s.id)!;
      if (p.overhead) continue;
      const { from, to } = stageSpan(s.carries!);
      const { arc } = lateral(p.x, p.z);
      if (arc < from || arc > to) {
        failures.push(
          `${s.id} stands at road-arc ${arc.toFixed(1)} m but carries ${s.carries} ` +
            `(${from.toFixed(1)}..${to.toFixed(1)} m) — the stretch is spent walking away from it. ` +
            `It says: "${s.says}"`,
        );
      }
    }
    expect(failures.join("\n")).toBe("");
  });

  it("CLAUSE A vacuity guard: the spans are real and the props are inside them, not merely unmeasured", () => {
    // Without this, a `stageSpan` that returned 0..Infinity would pass clause A
    // for every prop forever. Each span must be a plausible stage of road, and
    // at least one load-bearing prop must sit strictly INSIDE its span rather
    // than on a boundary the arithmetic cannot distinguish from "unmeasured".
    let strictlyInside = 0;
    for (const s of SIGHTLINES) {
      if (!s.bearing) continue;
      const { from, to } = stageSpan(s.carries!);
      expect(to - from, `${s.carries} has an implausible stretch`).toBeGreaterThan(5);
      expect(to - from, `${s.carries} has an implausible stretch`).toBeLessThan(40);
      const p = PLACED.find((q) => q.id === s.id)!;
      const { arc } = lateral(p.x, p.z);
      if (arc > from + 1 && arc < to - 1) strictlyInside++;
    }
    expect(strictlyInside, "no prop is strictly inside its stretch — clause A is measuring nothing")
      .toBeGreaterThanOrEqual(5);
  });

  it("CLAUSE B: every load-bearing subject reaches the wide half of the frame", () => {
    /**
     * THE LATERAL HALF, and it is a SUBJECT-level rule on purpose.
     *
     * The walking frame is not symmetric about the road: `FollowYaw` holds
     * VIEW_YAW between the walk and the lens, so the wedge reaches ~59.5° one
     * way and ~11.4° the other. A subject placed wholly in the narrow half is
     * being sited in the blind spot, whatever its headline in-frame percentage
     * says.
     *
     * **At least one MEMBER wide, not every member**, because story authored
     * the stone circle as an ENCLOSURE — members on both sides, so the player
     * is inside rather than passing. A per-prop rule would forbid a shape that
     * was chosen deliberately, so the rule is written to permit the authoring
     * intent rather than to police it.
     *
     * The sign convention is not assumed. It is checked against the **Great
     * Snag**, the one prop every seat agrees reads — story's own counter-example
     * — which must measure furthest into the wide half. If it ever measures
     * narrow, the convention has flipped and every line of this test is
     * backwards (METHOD law 20: shake the thing that should be immune).
     */
    const wide = new Map<string, boolean>();
    const heldBy = new Map<string, string | null>();
    const rows: string[] = [];
    for (const s of SIGHTLINES) {
      if (!s.bearing) continue;
      const p = PLACED.find((q) => q.id === s.id)!;
      const { off, arc } = lateral(p.x, p.z);
      const key = s.group ?? s.id;
      wide.set(key, (wide.get(key) ?? false) || off > 0);
      if (s.held) heldBy.set(key, s.held);
      rows.push(
        `  ${s.id.padEnd(16)} carries=${String(s.carries).padEnd(4)} arc=${arc.toFixed(1).padStart(6)} ` +
          `lateral=${off.toFixed(2).padStart(6)} ${off > 0 ? "WIDE" : "narrow"}${s.held ? "  [HELD]" : ""}`,
      );
    }
    console.log("[sightline] subject census, walk-leg lateral (+ = wide half):\n" + rows.join("\n"));

    const snag = PLACED.find((q) => q.id === "great-snag")!;
    expect(
      lateral(snag.x, snag.z).off,
      "the Great Snag measured narrow — the sign convention is inverted and every row above is backwards",
    ).toBeGreaterThan(0);

    const blind = [...wide.entries()].filter(([, w]) => !w).map(([k]) => k);
    const unheld = blind.filter((k) => !heldBy.has(k));
    expect(
      unheld.map((k) => {
        const s = SIGHTLINES.find((x) => (x.group ?? x.id) === k)!;
        return `subject "${k}" has no member in the wide half of the walking frame — it is sited in ` +
          `the blind spot for the whole of ${s.carries}. It says: "${s.says}"`;
      }).join("\n"),
    ).toBe("");
  });

  it("CLAUSE B anti-rot: a HELD subject must still be failing, or the hold is stale", () => {
    /**
     * ⚠️ THE ASSERTION THAT KEEPS A HOLD FROM BECOMING A PERMANENT EXEMPTION.
     *
     * A held row says "this is load-bearing, it fails, and we know". The
     * failure mode of that idea is that someone fixes the world, the hold stays
     * in the table, and the gate quietly stops checking the subject it was
     * written for — a green check that has stopped measuring, arrived at by
     * good intentions. So the hold itself is asserted: a held subject that has
     * STARTED passing reds here and the row must be removed.
     */
    for (const s of SIGHTLINES) {
      if (!s.held) continue;
      expect(s.bearing, `${s.id} is held but owes nothing — a hold on scenery is meaningless`).toBe(true);
      expect(s.held.length, `${s.id}'s hold names no exit criteria`).toBeGreaterThan(40);
      const key = s.group ?? s.id;
      const members = SIGHTLINES.filter((x) => (x.group ?? x.id) === key);
      const anyWide = members.some((m) => {
        const p = PLACED.find((q) => q.id === m.id)!;
        return lateral(p.x, p.z).off > 0;
      });
      expect(
        anyWide,
        `${key} is marked HELD but now reaches the wide half — the hold is stale. Delete it ` +
          `from sightlines.ts so clause B guards this subject again.`,
      ).toBe(false);
    }
  });
});
