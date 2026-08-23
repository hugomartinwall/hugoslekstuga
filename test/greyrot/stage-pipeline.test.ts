import { describe, expect, it } from "vitest";
import { STAGES, type StageDef } from "../../lib/greyrot/content";
import { buildScenario } from "../../lib/greyrot/sim/scenario";
import { PROP_PROFILE } from "../../lib/greyrot/sim/prop-volume";
import { formatViolations, validateStages } from "../../lib/greyrot/sim/stage-validator";

/**
 * The declarative stage pipeline (R3).
 *
 * Half of this file is the GENERATED placement suite: every rule chapter 1
 * paid for in playtest scars, run against whatever the stage table currently
 * says — a new stage inherits every lesson without anyone re-typing it.
 *
 * The other half is the validator's own teeth: one deliberately broken stage
 * per violation class, each caught with a failure that names the stage and
 * the rule. comp authors an independent set at audit; these are the
 * pipeline's own red-provability and the fixture examples.
 */

/**
 * Deep-clone the shipped table for fixture surgery. Plain data by contract.
 *
 * `any` is deliberate and scoped to this file's fixtures. Every cast below
 * exists to build a stage that VIOLATES the authored shape — a hut missing its
 * road anchor, a marker reinforcing from nowhere — so the validator can be
 * caught failing to reject it. Typing them accurately would mean describing
 * the invalid states as valid, which is the opposite of the point.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- see above: these
   fixtures are intentionally ill-typed authored data */
type Mut = {
  -readonly [K in keyof StageDef]: StageDef[K] extends object ? any : StageDef[K];
};
const clone = (): Mut[] => structuredClone(STAGES) as unknown as Mut[];

const violations = (stages: readonly StageDef[]) => {
  const { world, state } = buildScenario(stages);
  return validateStages(world, state, stages);
};

describe("the stage pipeline", () => {
  /**
   * The three village huts V13 reds on the shipped world (R7).
   *
   * **This is a PINNED REPRODUCTION, not a permission.** The camera-sleeve
   * rule landed before the fix it demands, because the fix moves scenery
   * inside the measured opening and therefore owes fun's binding verdict and
   * a beats re-baseline. Pinning it keeps the suite honest in both
   * directions: a FOURTH breach reds here, and so does one of these three
   * quietly going away — nobody gets to bank a silent change.
   *
   * **The day the huts move, this list becomes `[]` and this test reds until
   * someone deletes it.** That is deliberate. A tracked red with an expiry is
   * a different animal from a permanently red gate, which is what kept
   * `check-near-lens.mjs` out of the standing set for two cycles.
   */
  it("validates the shipped campaign clean — the generated placement suite", () => {
    const v = violations(STAGES);
    expect(v, formatViolations(v)).toEqual([]);
  });

  it("V1: terrain landing on a fight is caught (a hut on a spawn)", () => {
    const list = clone();
    list[1]!.terrain = { huts: [{ at: [11.5, 33.5], rotY: 0, scale: 1.0 }] };
    const v = violations(list);
    expect(v.some((x) => x.rule === "V1-foe-unstandable" && x.stage === "s2"), formatViolations(v)).toBe(
      true,
    );
  });

  it("V2: a declaration the world was not built from is caught", () => {
    // The road is generated THROUGH every exit, so V2 cannot be authored
    // into a consistent build — it guards machinery/declaration drift.
    // Validate the real build against a list whose gate moved 30 m.
    const { world, state } = buildScenario(STAGES);
    const list = clone();
    list[1]!.exit = { x: list[1]!.exit.x + 30, z: list[1]!.exit.z, r: list[1]!.exit.r };
    const v = validateStages(world, state, list as unknown as StageDef[]);
    expect(v.some((x) => x.rule === "V2-gate-off-road" && x.stage === "s2"), formatViolations(v)).toBe(
      true,
    );
  });

  it("V3: a gate inside the next stage's trigger is caught (the fourth-playtest scar)", () => {
    const list = clone();
    list[1]!.exit = { x: 13.0, z: 34.5, r: 2.4 };
    const v = violations(list);
    expect(v.some((x) => x.rule === "V3-gate-trigger-gap" && x.stage === "s2"), formatViolations(v)).toBe(
      true,
    );
  });

  it("V4: a find inside the next fight's take envelope is caught (the SPARK scar)", () => {
    const list = clone();
    list[3]!.markers[0].radius = 20;
    const v = violations(list);
    expect(v.some((x) => x.rule === "V4-find-envelope" && x.stage === "s3"), formatViolations(v)).toBe(
      true,
    );
  });

  it("V5: a captive inside the fight's trigger is caught (the round-5 scar)", () => {
    const list = clone();
    list[2]!.captive = { name: "Sella", at: [13.8, 35.8] };
    const v = violations(list);
    expect(v.some((x) => x.rule === "V5-captive-margins" && x.stage === "s3"), formatViolations(v)).toBe(
      true,
    );
  });

  it("V5: a post with no room for a body is caught (R4.5 — resume stands her there)", () => {
    // `applyResume` puts the companion on her post with no world to ask, so
    // "standable by construction" has to be constructed by this rule. A hut
    // dropped on the fen/ash gate is the authoring error it guards.
    const list = clone();
    list[5]!.terrain = { huts: [{ at: [-9, 72], rotY: 0, scale: 1.0 }] };
    const v = violations(list);
    expect(
      v.some((x) => x.rule === "V5-captive-margins" && /no room for a body/.test(x.detail)),
      formatViolations(v),
    ).toBe(true);
  });

  it("V5: a post inside the arena she is refusing to enter is caught (R4.5)", () => {
    // fun's ruling is that the composed fight past the line is hers to MISS.
    // A post the next fight's ring reaches puts her in it anyway.
    const list = clone();
    list[6]!.markers[0].arena = 12;
    const v = violations(list);
    expect(
      v.some((x) => x.rule === "V5-captive-margins" && /arena ring/.test(x.detail)),
      formatViolations(v),
    ).toBe(true);
  });

  it("V5: a follower who holds at or before her own rescue is caught (R4.5)", () => {
    const list = clone();
    list[2]!.captive = { name: "Sella", at: [15.6, 33.3], holdBiome: "village" };
    const v = violations(list);
    expect(
      v.some((x) => x.rule === "V5-captive-margins" && /never follow/.test(x.detail)),
      formatViolations(v),
    ).toBe(true);
  });

  it("V8: a hold biome no stage ever enters is caught (R4.5)", () => {
    // The zone gets renamed, the captive's declaration does not, and a rule
    // that reads like a rule silently stops enforcing anything.
    const list = clone();
    for (const st of list) if (st.biome === "ash") st.biome = "fen";
    const v = violations(list);
    expect(
      v.some((x) => x.rule === "V8-dangling-reference" && /holds at biome/.test(x.detail)),
      formatViolations(v),
    ).toBe(true);
  });

  it("V6: a spawn outside its own arena ring is caught", () => {
    const list = clone();
    list[2]!.markers[0].arena = 3.0;
    const v = violations(list);
    expect(v.some((x) => x.rule === "V6-arena-fit" && x.stage === "s3"), formatViolations(v)).toBe(
      true,
    );
  });

  it("V7: a declared-wet fight whose foes spawn dry is caught", () => {
    const list = clone();
    list[1]!.markers[0].wet = true;
    const v = violations(list);
    expect(
      v.some((x) => x.rule === "V7-wet-dry-contract" && x.stage === "s2"),
      formatViolations(v),
    ).toBe(true);
  });

  it("V7: a gate standing in water is caught (the 8 cm scar)", () => {
    const list = clone();
    list[3]!.exit = { x: 16.2, z: 42.5, r: 2.4 };
    const v = violations(list);
    expect(
      v.some((x) => x.rule === "V7-wet-dry-contract" && x.stage === "s4" && /gate/.test(x.detail)),
      formatViolations(v),
    ).toBe(true);
  });

  it("V8: an unknown foe kind and a duplicate stage id are caught", () => {
    const list = clone();
    list[1]!.markers[0].foes[0].kindId = "gribble";
    list[4]!.id = "s1";
    const v = violations(list);
    expect(v.some((x) => x.rule === "V8-dangling-reference" && /gribble/.test(x.detail))).toBe(true);
    expect(v.some((x) => x.rule === "V8-dangling-reference" && /duplicate/.test(x.detail))).toBe(
      true,
    );
  });

  it("V9: a zero-radius gate is caught", () => {
    const list = clone();
    list[1]!.exit = { ...list[1]!.exit, r: 0 };
    const v = violations(list);
    expect(v.some((x) => x.rule === "V9-geometry-sanity" && x.stage === "s2"), formatViolations(v)).toBe(
      true,
    );
  });

  /* ------------------------------------------------------ V10 (ask 9) */
  //
  // The probe post stands on s1's straight stretch — road sample 11 at
  // (0.32, 10.35), unit normal (−1.000, 0.031) — offset perpendicular so its
  // SURFACE lands at a chosen distance from the centreline. A brazier is the
  // right probe: 0.6 m of radius is a post, and it is the thinnest thing the
  // declaration can place.
  //
  // ⚠ THE PAIR IS THE POINT, and comp specified it: 4.95 m fires ONLY under
  // `CORRIDOR_HALF + MAX_SPEED + HERO_RADIUS` (5.027) and NOT under the
  // superseded `CORRIDOR_HALF + HERO_RADIUS` (4.88), while 5.10 m must stay
  // silent. Together they bracket the boundary inside (4.95, 5.10) and
  // exclude 4.88 — so the red-proof doubles as a proof of the constant. A
  // single red at 4.4 m would fire under either and prove neither.
  const POST_R = 0.6;
  const postAt = (surface: number): [number, number] => [
    0.32 + -1.0 * (surface + POST_R),
    10.35 + 0.031 * (surface + POST_R),
  ];
  /** Distance to the road, measured WITHOUT the validator's own helper. */
  const surfaceOf = (world: { roadPath: { x: number; z: number }[] }, p: [number, number]) => {
    let d = Infinity;
    for (const r of world.roadPath) d = Math.min(d, Math.hypot(r.x - p[0], r.z - p[1]));
    return d - POST_R;
  };
  const withPost = (surface: number) => {
    const p = postAt(surface);
    const list = clone();
    list[0]!.terrain = { braziers: [{ at: p, gates: false, startLit: false }] };
    const { world, state } = buildScenario(list as unknown as StageDef[]);
    return {
      v: validateStages(world, state, list as unknown as StageDef[]),
      measured: surfaceOf(world, p),
    };
  };

  it("V10: a post at 4.95 m is caught — and the red proves the CONSTANT", () => {
    const { v, measured } = withPost(4.95);
    // Vacuity guard: if the road ever moves under this probe, fail here
    // rather than reporting a red that is about a different distance.
    expect(measured).toBeGreaterThan(4.9);
    expect(measured).toBeLessThan(5.0);
    const hit = v.filter((x) => x.rule === "V10-prop-walked-line");
    expect(hit.length, formatViolations(v)).toBe(1);
    expect(hit[0]!.stage).toBe("s1");
    expect(hit[0]!.detail).toMatch(/short by 0\.0[0-9]{2} m/);
  });

  it("V10: the same post at 5.10 m is silent — the positive control", () => {
    // Law 20: shake the thing that should be immune alongside the thing under
    // test. Without this the rule could be reddening on the mere presence of
    // a declared prop and nobody would know.
    const { v, measured } = withPost(5.1);
    expect(measured).toBeGreaterThan(5.05);
    expect(measured).toBeLessThan(5.2);
    expect(v, formatViolations(v)).toEqual([]);
  });

  it("V10: `atRoad` is what makes the shipped village legal, not the geometry", () => {
    // Eight of chapter 1's nine authored blockers stand INSIDE the walked
    // envelope. Strip the admission off the village and the build says so —
    // which is the evidence that the shipped green is a declaration and not
    // an accident of placement.
    const list = clone();
    for (const h of (list[2]!.terrain as any).huts) delete h.atRoad;
    const v = violations(list);
    const hit = v.filter((x) => x.rule === "V10-prop-walked-line");
    expect(hit.length, formatViolations(v)).toBe(4);
    expect(hit.every((x) => x.stage === "s3")).toBe(true);
  });

  it("V10: declaration/world drift is caught in both directions (the V2 trick)", () => {
    // `setupTerrain` places every declared prop unconditionally, so neither
    // half can be authored into a consistent build — these guard the
    // MACHINERY, exactly as V2 does. Validate a real build against a
    // declaration whose hut moved and both halves fire at once.
    const { world, state } = buildScenario(STAGES);
    const list = clone();
    (list[2]!.terrain as any).huts[0].at = [10.5, 39.5];
    const v = validateStages(world, state, list as unknown as StageDef[]);
    expect(v.some((x) => /no stage declares it/.test(x.detail)), formatViolations(v)).toBe(true);
    expect(v.some((x) => /never became an obstacle/.test(x.detail)), formatViolations(v)).toBe(true);
  });

  /* ----------------------------------------------------- V11 (ask 10) */

  it("V11: a prop past its own stage's gate is caught (the kilns case)", () => {
    // The case that filed the rule: the kilns' first CLEARANCE-LEGAL answer
    // sat past its own stage's gate, every geometric check green, met by the
    // player two stages after the beat it was authored for. This probe sits
    // clear of the walked envelope on purpose, so V10 stays silent and the
    // only thing under test is which stretch it belongs to.
    const list = clone();
    list[8]!.terrain = {
      ...(list[8]!.terrain ?? {}),
      braziers: [{ at: [7.3, 100.27], gates: false, startLit: false }],
    };
    const v = violations(list);
    expect(v.some((x) => x.rule === "V10-prop-walked-line"), formatViolations(v)).toBe(false);
    const hit = v.filter((x) => x.rule === "V11-prop-stage-span");
    expect(hit.length, formatViolations(v)).toBe(1);
    expect(hit[0]!.stage).toBe("s9");
    expect(hit[0]!.detail).toMatch(/meets it during "damp_pyres"/);
  });

  it("V11: the SAME prop declared for the stretch it stands on is silent", () => {
    // The positive control, and it is what makes the red above a diagnosis
    // rather than a rejection of the coordinates.
    const list = clone();
    list[9]!.terrain = {
      ...(list[9]!.terrain ?? {}),
      braziers: [
        ...(list[9]!.terrain?.braziers ?? []),
        { at: [7.3, 100.27], gates: false, startLit: false },
      ],
    };
    const v = violations(list);
    expect(v, formatViolations(v)).toEqual([]);
  });

  it("V11: the `terrain.flat` exemption is load-bearing, not decorative", () => {
    // Shrink the village's declared footprint and three of its huts fall out
    // of s3's span — the road re-enters the village on s4's and s5's
    // stretches. That is the s3/s4/s5 collision LOOP.md already names,
    // reproduced from geometry alone, and it is the reason the exemption is a
    // DECLARED disc rather than a flag: a stage that wants it has to carve
    // the ground for it.
    const list = clone();
    (list[2]!.terrain as any).flat = { at: [16, 41], r: 4 };
    const v = violations(list);
    const hit = v.filter((x) => x.rule === "V11-prop-stage-span");
    expect(hit.length, formatViolations(v)).toBe(3);
    expect(hit.every((x) => x.stage === "s3")).toBe(true);
  });

  /* ----------------------------------------------------- V12 (fun's ITERATE) */

  const gulchIndex = STAGES.findIndex((st) => st.markers.some((m) => m.reinforce));
  /** The ring exactly as it shipped before fun measured it: a uniform 7 m circle. */
  const SHIPPED_CIRCLE = [
    [0, 7.0], [-6.1, 3.4], [6.1, 3.4], [-7.0, 0],
    [7.0, 0], [-6.1, -3.4], [6.1, -3.4], [0, -7.0],
  ];
  const withRing = (from: number[][]) => {
    const list = clone();
    (list[gulchIndex]!.markers[0] as any).reinforce.from = from;
    return violations(list);
  };

  it("V12: the ring that SHIPPED is caught — 6 of 8 entries off the encounter frame", () => {
    // Not a planted break: this is the exact configuration in the tree when
    // fun drove it, so the red is the real defect rather than a mutation
    // invented to make a rule fire. And it is MIXED — the north and east
    // entries pass in the same run, which is what proves the rule responds to
    // the condition rather than to the presence of a `reinforce` block.
    //
    // Assertions are on WORLD coordinates, not authored offsets, because
    // `scenario.ts` nudges each entry up to 3 m onto standable ground: the old
    // west point [-6.1, 3.4] is PLACED at [-6.85, 2.65]. Its landing spot is
    // the thing the player sees and the thing fun measured — and these eight
    // world positions reproduce fun's live table to the digit, which is the
    // positive control on this whole instrument.
    const v = withRing(SHIPPED_CIRCLE);
    const hit = v.filter((x) => x.rule === "V12-arrival-off-frame");
    const at = (x: { detail: string }): string =>
      x.detail.slice(x.detail.indexOf("at ("), x.detail.indexOf(") is") + 1);
    // SIX distinct entries, not the four fun could name from its arrival log:
    // the two extra are `[7, 0]` and `[6.1, -3.4]`, the pair it flagged as
    // "marginal — the gather ring clips the edge" without being able to
    // settle them. Enumerating every point settled them.
    expect(new Set(hit.map(at)).size, formatViolations(v)).toBe(6);
    // The four fun named — the three west points and the south point.
    for (const w of ["(-12.8, 69.7)", "(-13.0, 67.0)", "(-12.1, 63.6)", "(-6.0, 60.0)"]) {
      expect(hit.some((h) => h.detail.includes(w)), `${w} was not caught`).toBe(true);
    }
    // The north and east entries fun told me to leave alone stay clean.
    for (const w of ["(-6.0, 74.0)", "(0.1, 70.4)"]) {
      expect(hit.some((h) => h.detail.includes(w)), `${w} should not have been flagged`).toBe(
        false,
      );
    }
  });

  it("V12: the CUE is the subject, not the body — [7, 0] lands on screen and still fails", () => {
    // The distinction fun found and the reason the rule samples the gather
    // ring: this entry puts its body inside the frame at 77 px, and its 2.5 m
    // convergence clips the edge. A cue whose focal point is in the picture
    // and whose pointer is outside it is not a cue.
    const v = withRing([[7.0, 0], [0, 7.0]]);
    const hit = v.filter((x) => x.rule === "V12-arrival-off-frame");
    expect(hit.some((x) => x.detail.includes("(1.0, 67.0)")), formatViolations(v)).toBe(true);
    expect(hit.some((x) => x.detail.includes("(-6.0, 74.0)")), formatViolations(v)).toBe(false);
  });

  it("V12: both audited aspects are live — 16:10 is the narrower one", () => {
    // THE TRAP THAT HID THIS BUG. The fov is VERTICAL, so horizontal coverage
    // is `tan(fov/2) x aspect`: 1280x800 is 16:10 and shows LESS world
    // sideways than the 800x450 we habitually call the hard case. A rule
    // auditing only 800x450 would pass entries that are off-frame on the more
    // common monitor.
    //
    // This probe entry is CONSTRUCTED, and says so: it sits due east at 4.5 m,
    // inside the 16:9 horizontal limit there and outside the 16:10 one. No
    // shipped entry separates the two aspects — all six reds fail at both —
    // so a claim about aspect coverage needs a case built to test it rather
    // than one borrowed from the world. It demonstrates the rule's reach, not
    // a world defect. (East is also the bearing where the split is widest,
    // which is why the west points were caught at both and this one is not.)
    const v = withRing([[4.5, 0], [0, 7.0]]).filter((x) => x.rule === "V12-arrival-off-frame");
    const aspects = new Set(v.map((x) => /(\d+x\d+)/.exec(x.detail)![1]!));
    expect(aspects.has("1280x800"), formatViolations(v)).toBe(true);
    expect(aspects.has("800x450"), formatViolations(v)).toBe(false);
  });

  it("V12: the shipped ring passes with real margin — the positive control", () => {
    // Law 20: the instrument has to be shown distinguishing, not merely
    // passing. The two tests above are its reds on real configurations; this
    // is its green on the authored one.
    const v = violations(STAGES).filter((x) => x.rule === "V12-arrival-off-frame");
    expect(v, formatViolations(v)).toEqual([]);
    expect(STAGES[gulchIndex]!.markers[0]!.reinforce!.from.length).toBe(8);
  });


  /* -------------------------------------------------- V13: the camera sleeve */
  //
  // The probe is a HUT on s1's straight opening stretch, walked out from the
  // road centreline. A straight stretch on purpose: the boundary is then a
  // number anyone can re-derive by hand (centre distance minus the profile's
  // radius at lens height), so a red here is checkable without trusting the
  // rule's own arithmetic.
  //
  // ⚠️ A PERTURBATION IS A CONSEQUENCE ASSERTED INTO AN INSTANCE, exactly like
  // the thing it tests. The first solve of the village used a straight lens
  // line for a road that doglegs three times and was wrong by 3 m; a chord
  // bound taken from `|lens - hero|` put the modelled lens 4.7 m off the road
  // and reddened a hut standing 8 m out. Both were caught by MEASURING the
  // break rather than designing it, which is why every probe below asserts
  // its own geometry before it asserts the rule's verdict.
  const hutAt = (centre: number): [number, number] => [0.32 - centre, 10.35 + 0.031 * centre];
  const withHut = (centre: number, scale = 1.0) => {
    const at = hutAt(centre);
    const list = clone();
    list[0]!.terrain = { huts: [{ at, rotY: 0, scale, burning: false, atRoad: true }] };
    const { world, state } = buildScenario(list as unknown as StageDef[]);
    let road = Infinity;
    for (const r of world.roadPath) road = Math.min(road, Math.hypot(r.x - at[0], r.z - at[1]));
    return { v: validateStages(world, state, list as unknown as StageDef[]), road, at };
  };
  const sleeveOf = (v: ReturnType<typeof violations>, at: [number, number]) =>
    v.filter(
      (x) =>
        x.rule === "V13-prop-in-camera-sleeve" &&
        x.detail.includes(`(${at[0].toFixed(1)}, ${at[1].toFixed(1)})`),
    );

  it("V13: a hut 4.00 m from the centreline is caught — the lens walks into it", () => {
    const { v, road, at } = withHut(4.0);
    // Vacuity guard: if the road moves under this probe, fail HERE rather than
    // reporting a red that is about a different distance.
    expect(road).toBeGreaterThan(3.95);
    expect(road).toBeLessThan(4.05);
    const hit = sleeveOf(v, at);
    expect(hit.length, formatViolations(v)).toBe(1);
    // The red must be for the RIGHT REASON — a surface-clearance number, not a
    // containment boolean. fun's acceptance bar, as an assertion.
    expect(hit[0]!.detail).toMatch(/lens passes 1\.8[0-9] m from its surface/);
    expect(hit[0]!.detail).toMatch(/short by 0\.1[0-9] m/);
  });

  it("V13: the same hut at 4.25 m is silent — the companion just outside", () => {
    // Law 20, and fun's specific bar for this rule: a threshold that only ever
    // reds has not been shown to have a boundary, and a boundary nobody probed
    // is a boundary nobody can defend. 4.00 red / 4.25 silent brackets it.
    const { v, road, at } = withHut(4.25);
    expect(road).toBeGreaterThan(4.2);
    expect(road).toBeLessThan(4.3);
    expect(sleeveOf(v, at), formatViolations(v)).toEqual([]);
  });

  it("V13: the boundary MOVES WITH THE PROP'S SIZE — it is geometry, not a distance", () => {
    // A 0.8-scale hut is legal exactly where a 1.0-scale one is not. If this
    // ever stops holding, the rule has quietly become a lateral-distance rule
    // with a height-shaped comment on it — which is what the first proposal
    // was, and it declared the village and both brazier stages illegal.
    const big = withHut(4.0, 1.0);
    const small = withHut(4.0, 0.8);
    expect(sleeveOf(big.v, big.at).length).toBe(1);
    expect(sleeveOf(small.v, small.at), formatViolations(small.v)).toEqual([]);
  });

  it("V13: a BRAZIER at the hut's own red position is silent — the exemption is the geometry", () => {
    // The gating brazier stands beside the road because a brazier you cannot
    // walk up to is not an objective. It survives this rule with no flag and
    // no clause: its apex is 1.17 m, the lens flies at STAGE_VIEW_HEIGHT, and
    // it is 1.28 m across against a 3.2 m breadth bar. **An exemption an
    // author can write is an exemption that collects every failure that cannot
    // be fixed**, so there is not one.
    const at = hutAt(4.0);
    const list = clone();
    list[0]!.terrain = { braziers: [{ at, gates: false, startLit: false, atRoad: true }] };
    const { world, state } = buildScenario(list as unknown as StageDef[]);
    const v = validateStages(world, state, list as unknown as StageDef[]);
    expect(v.filter((x) => x.rule === "V13-prop-in-camera-sleeve"), formatViolations(v)).toEqual([]);
  });

  it("V13: a declared prop with NO volume fails loudly rather than being skipped", () => {
    // The hole this rule would otherwise have: a kind added to the obstacle
    // union and declared by a stage, with nobody having measured its shape.
    // A profile lookup that returns nothing must be a violation, never a
    // `continue` — `scripts/prop-volume.mjs` shipped exactly that hole for two
    // cycles, silently reporting the parapet stubs as "not placed".
    const at = hutAt(4.0);
    const list = clone();
    list[0]!.terrain = { huts: [{ at, rotY: 0, scale: 1.0, burning: false, atRoad: true }] };
    const { world, state } = buildScenario(list as unknown as StageDef[]);
    const original = PROP_PROFILE.hut;
    try {
      (PROP_PROFILE as Record<string, unknown>).hut = null;
      const v = validateStages(world, state, list as unknown as StageDef[]);
      const hit = v.filter((x) => x.rule === "V13-prop-in-camera-sleeve");
      expect(hit.length).toBeGreaterThan(0);
      expect(hit[0]!.detail).toMatch(/no volume in PROP_PROFILE/);
    } finally {
      (PROP_PROFILE as Record<string, unknown>).hut = original;
    }
  });

  it("every violation names its stage and carries coordinates", () => {
    // The audit standard: "invalid" without a where is not a diagnosis.
    const list = clone();
    list[1]!.exit = { x: 13.0, z: 34.5, r: 2.4 };
    list[2]!.markers[0].arena = 3.0;
    const v = violations(list);
    expect(v.length).toBeGreaterThan(1);
    for (const x of v) {
      expect(x.stage.length).toBeGreaterThan(0);
      expect(x.detail).toMatch(/\d/);
    }
  });
});
