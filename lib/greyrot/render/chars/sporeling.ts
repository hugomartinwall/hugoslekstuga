/**
 * The sporeling — the hero species of *Greyrot*, and the shape the whole game
 * is judged on at 40 px.
 *
 * ## Why it is built the way it is
 *
 * `ART_DIRECTION.md` §4: a sporeling is a **wide cap over a narrow stalk**, and
 * the cap carries the silhouette. Cap width here is ~2.5× body width — well
 * past the 1.6× floor — because that overhang is the entire read at distance
 * and it is what stops the roster looking like the humanoid rig in hats.
 *
 * The cap is also the **helmet slot**. Gear that changes the cap changes the
 * silhouette, which is how `PEDAGOGY.md` teaches "gear is visible and matters"
 * without a single line of text.
 *
 * ## It reuses the humanoid's joint names on purpose
 *
 * `pelvis / torso / head / upperArm{L,R} / foreArm{L,R} / thigh{L,R} /
 * shin{L,R}` — the same names `Puppet` animates. That means the walk cycle,
 * the attack swing and the overlay system all work on a mushroom for free, and
 * `Puppet.set()` no-ops on any joint a rig happens not to have.
 *
 * The one addition is **`cap`**, a child of `head` carrying the cap geometry so
 * it can trail the body under spring-damper secondary motion. A sporeling whose
 * cap does not lag behind its head looks dead (`ART_DIRECTION.md` §5).
 *
 * ⚠️ Limb rotation signs follow the rig convention documented on
 * `RigPart.rest` in humanoid.ts: forward is +Z, and a POSITIVE x rotation
 * carries a limb BEHIND the character. Knees flex positive, elbows negative.
 */

import { Mesh, box, cone, lathe, loft, sphere, tube, type RGB, type Vec3 } from "../mesh/dsl";
import { registerMesh } from "../mesh/registry";
import { flattenRig, type Rig, type RigPart } from "./humanoid";

export interface SporelingPalette {
  /** The cap — the character's identity colour. High chroma, warm. */
  cap: RGB;
  /** Speckles on the cap. Set equal to `cap` for an unspotted variant. */
  spot: RGB;
  /** Gills, under the cap rim. Always darker than the cap. */
  gill: RGB;
  /** The stalk — head, arms and legs. Pale and warm. This is the "skin". */
  stalk: RGB;
  /**
   * The coat over the torso. Without it a sporeling is one flat cream tube
   * from belt to cap, which is one colour short of the two-plus-accent rule
   * in `ART_DIRECTION.md` §4 and reads as unfinished.
   */
  coat: RGB;
  /** Trousers. Darker than the coat so the legs separate from the body. */
  trouser: RGB;
  /** Belt, satchel straps, boots. */
  leather: RGB;
  /** Eyes. Near-black, never pure black. */
  eye: RGB;
  /** Eye highlight. The single cheapest thing that makes eyes look alive. */
  eyeLight: RGB;
  /**
   * Icicle fringe (rimecap only). A SURFACE, not a glow — it obeys the 0.12
   * Rot saturation ceiling like every other surface. Paler than the cap so
   * the fringe reads as ice against it in the lit render; in black shape the
   * geometry alone carries the read.
   */
  icicle?: RGB;
  /**
   * Thorn crest (thornback only). A SURFACE under the 0.12 ceiling, same
   * logic as the icicle: pale bone-violet tips over the family's darkest
   * body, so the crest reads lit while the sagittal geometry alone carries
   * the black shape.
   */
  thorn?: RGB;
}

export interface SporelingParams {
  /** Total height in metres. A sporeling is knee-high to a human by design. */
  height: number;
  /** 0 = slight, 1 = stout. Drives stalk and limb thickness. */
  build: number;
  /** Cap radius as a fraction of height. Bigger = more mushroom, less person. */
  capSpread: number;
  /**
   * Cap droop, radians. 0 is a proud dome; positive pulls the rim down and
   * forward, which instantly reads as tired, sickly or hostile — this is how
   * a Rotling is built from the same generator.
   */
  droop: number;
  /**
   * Vertical scale on the dome above the rim (default 1). The silhouette
   * axis the family lacked (round 7): droop and build alone carried four
   * foes, and the fifth needed a POINTED-vs-FLATTENED read — an ashcap
   * spikes at 1.5, a seeper flattens to 0.7 — for the black-shape test
   * (ART_DIRECTION §4.1) to keep passing at 800×450.
   */
  capPeak?: number;
  /**
   * Paint a bold spot-coloured wedge over the FRONT of the cap (R1's facing
   * cue). The cap is the silhouette AND it is rotationally symmetric — from
   * the 3/4 camera it occludes every body cue that says which way the
   * character points, which is why forward-fire whiffed for a pilot who had
   * no way to read the aim. The blaze makes the dome a compass: paint only,
   * zero geometry, so the black-shape test is untouched. Hero-only — a foe's
   * facing is telegraphed by its wind-up, and Rot caps are unspotted anyway.
   */
  blaze?: boolean;
  /**
   * Backward shear on the cap dome, in metres of −Z per metre above the rim
   * (R2's rotfang axis). Every other cap is fore-aft symmetric; a swept
   * crest is the black-shape read for "this one MOVES". Pairs with `lean`.
   */
  capSweep?: number;
  /**
   * Lateral wind-tilt: a +X shear on the dome plus a whole-cap roll
   * (R2's stormling axis, pre-committed in the roster spec). The family's
   * only left-right asymmetry — a cap blown sideways by weather nothing
   * else in the frame is standing in. Reads at every yaw except the two
   * exact profiles, where `capPeak` and the thin frame still separate it.
   */
  capTilt?: number;
  /**
   * Hang an icicle fringe from the cap rim (R2's rimecap axis). The
   * family's only BROKEN rim — every sibling silhouette is smooth-edged, so
   * a jagged underside reads in pure black at 800×450 before any colour is
   * seen. Anchors follow the droop warp so the fringe hugs the rim at any
   * droop. Front arc is left clear: the face must stay readable under it.
   */
  icicles?: boolean;
  /**
   * Forward pitch on the torso, radians (rotfang). Positive x carries the
   * torso's up-vector toward +Z — forward, the lunge — per the sign
   * convention on `RigPart.rest`. The head counter-pitches at 0.7× so the
   * eyes keep facing where the body is going rather than the floor.
   */
  lean?: number;
  palette: SporelingPalette;
}

/* ------------------------------------------------------------------ palettes */

/** Pim — Capper. Red-ochre cap, cream stalk (`ART_DIRECTION.md` §2.3). */
export const PIM_PALETTE: SporelingPalette = {
  cap: [0.78, 0.26, 0.2],
  spot: [0.95, 0.9, 0.76],
  gill: [0.46, 0.16, 0.14],
  stalk: [0.88, 0.8, 0.62],
  // Moss green against the red cap: complementary, and it ties the hero to the
  // world he is trying to save.
  coat: [0.34, 0.44, 0.26],
  trouser: [0.29, 0.26, 0.2],
  leather: [0.34, 0.23, 0.15],
  eye: [0.09, 0.07, 0.08],
  eyeLight: [0.98, 0.96, 0.92],
};

/** Sella — Tidecap. Teal cap, sand coat. */
export const SELLA_PALETTE: SporelingPalette = {
  ...PIM_PALETTE,
  cap: [0.24, 0.48, 0.62],
  spot: [0.82, 0.92, 0.94],
  gill: [0.14, 0.28, 0.38],
  stalk: [0.86, 0.82, 0.7],
  coat: [0.72, 0.6, 0.36],
  trouser: [0.3, 0.28, 0.26],
};

/** Emberkin. Amber cap, deep plum coat. */
export const EMBERKIN_PALETTE: SporelingPalette = {
  ...PIM_PALETTE,
  cap: [0.86, 0.52, 0.16],
  spot: [0.96, 0.86, 0.6],
  gill: [0.5, 0.28, 0.1],
  stalk: [0.84, 0.78, 0.6],
  coat: [0.36, 0.24, 0.32],
  trouser: [0.28, 0.2, 0.22],
};

/**
 * Rotling. Violet-grey, never black — black reads as a hole in the frame,
 * violet-grey reads as *drained*, which is the story. Saturation stays under
 * the 0.12 ceiling `ART_DIRECTION.md` §2.2 sets, so Rot creatures can never
 * compete with the party for attention.
 *
 * R2 trimmed gill/coat/trouser's blue channel by ≤ 0.007: this palette
 * PREDATES the written ceiling, and the first enforced audit
 * (foe-identity.test.ts) caught the founder itself at 0.121–0.138 on those
 * three slots. The trims are below anything a capture can distinguish; the
 * violet lean is untouched.
 */
export const ROTLING_PALETTE: SporelingPalette = {
  cap: [0.36, 0.34, 0.38],
  spot: [0.36, 0.34, 0.38], // unspotted — the Rot takes pattern away too
  gill: [0.22, 0.21, 0.237],
  stalk: [0.48, 0.46, 0.52],
  coat: [0.3, 0.29, 0.325],
  trouser: [0.26, 0.25, 0.28],
  leather: [0.26, 0.25, 0.28],
  eye: [0.62, 0.58, 0.7], // pale spore-glow eyes: the one bright thing on them
  eyeLight: [0.62, 0.58, 0.7], // no catchlight — nothing behind the eyes
};

/**
 * Sopling — the Rot made it sodden. Blue-LEANING within the §2.2 saturation
 * ceiling (every surface ≤ 0.12), and the one bright thing on it tells the
 * truth: it is always Wet (it stands at the head of its own water trail), so
 * the eyes glow `FX.wet` — the status colour naming the body the spark
 * wants. Glows are exempt from the surface ceiling; the rotling's spore-glow
 * eyes are the precedent.
 */
export const SOPLING_PALETTE: SporelingPalette = {
  cap: [0.34, 0.36, 0.385],
  spot: [0.34, 0.36, 0.385], // unspotted, like every Rot creature
  gill: [0.21, 0.22, 0.235],
  stalk: [0.45, 0.47, 0.5],
  coat: [0.285, 0.3, 0.32],
  trouser: [0.25, 0.26, 0.275],
  leather: [0.25, 0.26, 0.275],
  eye: [0.31, 0.7, 0.78], // FX.wet — see the palette comment above
  eyeLight: [0.31, 0.7, 0.78], // no catchlight — nothing behind the eyes
};

/**
 * Cinderling — the Rot burnt it stiff. Warm-LEANING within the §2.2 ceiling
 * (every surface ≤ 0.12 sat, R-max where the rotling family is B-max, so the
 * two hue directions separate at 800×450 without either leaving grey). NOT
 * `EMBERKIN_PALETTE`: Emberkin is a living character with a living amber cap;
 * a Rot foe never gets living colour. The one hot thing on it tells the
 * truth the sopling's eyes told — it spits fire, so the eyes are embers
 * (`FX.burning`), the status colour naming what its bolts carry.
 */
export const CINDERLING_PALETTE: SporelingPalette = {
  cap: [0.325, 0.3, 0.29],
  spot: [0.325, 0.3, 0.29], // unspotted, like every Rot creature
  gill: [0.185, 0.17, 0.165],
  stalk: [0.43, 0.41, 0.395],
  coat: [0.265, 0.245, 0.235],
  trouser: [0.225, 0.21, 0.2],
  leather: [0.225, 0.21, 0.2],
  eye: [1.0, 0.42, 0.1], // FX.burning — ember eyes on a cold char body
  eyeLight: [1.0, 0.42, 0.1], // no catchlight — nothing behind the eyes
};

/**
 * Ashcap — the palest of the Rot family (round 7's identity pass). It holds
 * a 7.5 m band, so it is read farther away than any sibling; the brightest
 * surfaces in the family are what keep it legible at that range. Violet
 * B-max like the rotling — same element, same hue direction, BY DESIGN: the
 * vocabulary is per element, and the silhouette (tall spike, capPeak 1.5)
 * is what separates the two spore-kin.
 */
export const ASHCAP_PALETTE: SporelingPalette = {
  cap: [0.475, 0.455, 0.505],
  spot: [0.475, 0.455, 0.505], // unspotted, like every Rot creature
  gill: [0.27, 0.26, 0.29],
  stalk: [0.52, 0.51, 0.545],
  coat: [0.33, 0.32, 0.355],
  trouser: [0.28, 0.27, 0.3],
  leather: [0.28, 0.27, 0.3],
  eye: [0.62, 0.58, 0.7], // spore-glow, shared with the rotling — one element, one signal
  eyeLight: [0.62, 0.58, 0.7],
};

/**
 * Seeper — brown-LEANING within the ceiling, the family's tank. Its eyes are
 * `ELEMENT_COLOUR.oil` and deliberately DIM: three siblings glow bright, so
 * among them dimness itself is the read — tar-filled eyes on the thing whose
 * trail is tar, matching its telegraph tint exactly.
 */
export const SEEPER_PALETTE: SporelingPalette = {
  cap: [0.36, 0.345, 0.325],
  spot: [0.36, 0.345, 0.325], // unspotted, like every Rot creature
  gill: [0.215, 0.2, 0.19],
  stalk: [0.48, 0.465, 0.44],
  coat: [0.3, 0.285, 0.27],
  trouser: [0.255, 0.245, 0.235],
  leather: [0.255, 0.245, 0.235],
  eye: [0.35, 0.28, 0.2], // ELEMENT_COLOUR.oil — dim tar, and the dimness is the point
  eyeLight: [0.35, 0.28, 0.2],
};

/**
 * Rimecap — the Rot froze it dry. Ice-blue B-max within the §2.2 ceiling
 * (every surface ≤ 0.12 sat), one value step BELOW the ashcap: "palest of
 * the family" stays the ashcap's title, and the two same-band spitters
 * separate by hue direction (violet vs ice) plus the fringe. Cold is not
 * wet — it renders DRY (roughness 0.85; the sopling keeps the glisten).
 * The eyes are `FX.frozen`: it spits frost, and the eye-glow-is-attack-
 * element rule (§2.2a) holds for the whole roster.
 */
export const RIMECAP_PALETTE: SporelingPalette = {
  cap: [0.42, 0.45, 0.475],
  spot: [0.42, 0.45, 0.475], // unspotted, like every Rot creature
  gill: [0.245, 0.26, 0.275],
  stalk: [0.5, 0.52, 0.545],
  coat: [0.3, 0.315, 0.335],
  trouser: [0.26, 0.27, 0.285],
  leather: [0.26, 0.27, 0.285],
  eye: [0.72, 0.9, 0.96], // FX.frozen — frost spitter, frost eyes
  eyeLight: [0.72, 0.9, 0.96], // no catchlight — nothing behind the eyes
  icicle: [0.58, 0.61, 0.645], // pale ice SURFACE (sat 0.10) — not a glow
};

/**
 * Rotfang — the Rot made it hungry. The family's violet, one value step
 * DARKER than the rotling: a lurker reads darker than the thing it circles
 * behind. Same B-max hue direction as rotling/ashcap BY DESIGN — its bite
 * is spore, and the vocabulary is per element (§2.2a), so the eyes share
 * the spore-glow. The silhouette (low, wide, swept, leaning) is what
 * separates it, never the colour.
 */
export const ROTFANG_PALETTE: SporelingPalette = {
  cap: [0.33, 0.31, 0.35],
  spot: [0.33, 0.31, 0.35], // unspotted, like every Rot creature
  gill: [0.2, 0.19, 0.215],
  stalk: [0.44, 0.42, 0.475],
  coat: [0.275, 0.265, 0.3],
  trouser: [0.235, 0.225, 0.255],
  leather: [0.235, 0.225, 0.255],
  eye: [0.62, 0.58, 0.7], // spore-glow — its bite is spore, same signal as the rotling
  eyeLight: [0.62, 0.58, 0.7], // no catchlight — nothing behind the eyes
};

/**
 * Stormling — the Rot charged it. Slate storm-blue between the sopling's
 * dark water-lean and the rimecap's pale ice: three cold hue directions,
 * three elements, separated by VALUE and silhouette exactly as the violet
 * pair is. The one bright thing tells the truth the whole family tells:
 * it spits lightning, so the eyes are `FX.shocked` white-blue.
 */
export const STORMLING_PALETTE: SporelingPalette = {
  cap: [0.37, 0.39, 0.42],
  spot: [0.37, 0.39, 0.42], // unspotted, like every Rot creature
  gill: [0.225, 0.235, 0.255],
  stalk: [0.47, 0.49, 0.52],
  coat: [0.3, 0.315, 0.34],
  trouser: [0.255, 0.265, 0.285],
  leather: [0.255, 0.265, 0.285],
  eye: [0.72, 0.83, 1.0], // FX.shocked — lightning spitter, storm eyes
  eyeLight: [0.72, 0.83, 1.0], // no catchlight — nothing behind the eyes
};

/**
 * Thornback — the ch1 boss (R4): the Rot's bruiser, permanently sodden. The
 * DARKEST body in the family, one value step under the rotfang — the lurker
 * rule extended to its logical end: the apex reads darkest of all. Violet
 * B-max with every surface under the §2.2 ceiling; the thorn crest is the
 * icicle logic restated (pale SURFACE tips on a dark body, geometry carries
 * the black shape). The eyes are `FX.wet` by the sopling's own precedent:
 * the one bright thing tells the truth, and this body is ALWAYS Wet — its
 * sodden hide is the fight's whole mechanism (fire fizzles on it, spark
 * chains off it), so the status colour names the boss's coat, not a bolt.
 */
export const THORNBACK_PALETTE: SporelingPalette = {
  cap: [0.3, 0.28, 0.315],
  spot: [0.3, 0.28, 0.315], // unspotted, like every Rot creature
  gill: [0.18, 0.17, 0.192],
  stalk: [0.4, 0.38, 0.425],
  coat: [0.25, 0.24, 0.27],
  trouser: [0.215, 0.205, 0.23],
  leather: [0.215, 0.205, 0.23],
  eye: [0.31, 0.7, 0.78], // FX.wet — the sodden hide, named in the §6 vocabulary
  eyeLight: [0.31, 0.7, 0.78], // no catchlight — nothing behind the eyes
  thorn: [0.545, 0.52, 0.575], // pale bone SURFACE (sat 0.10) — not a glow
};

export const DEFAULT_SPORELING: SporelingParams = {
  height: 1.15,
  build: 0.5,
  capSpread: 0.3,
  droop: 0,
  palette: PIM_PALETTE,
};

/* ------------------------------------------------------------------- helpers */

/** A tapered limb segment running down −Y from its joint at the origin. */
function limb(length: number, rTop: number, rBottom: number, sides = 7): Mesh {
  return tube(
    [
      [0, 0, 0],
      [0, -length * 0.5, 0],
      [0, -length, 0],
    ],
    [rTop, (rTop + rBottom) * 0.5, rBottom],
    sides,
  );
}

/**
 * An elliptical ring. Bodies are wider than they are deep; circles read as a
 * snowman. Winding matches `circleRing` so `loft` gives outward normals.
 */
function ring(rx: number, rz: number, y: number, sides = 9): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    out.push([Math.cos(a) * rx, y, -Math.sin(a) * rz]);
  }
  return out;
}

/**
 * Cap spots as authored positions — `[angle, radius fraction, size fraction]`.
 *
 * The first pass hashed each face's centroid instead, which sounds equivalent
 * and is not: a lathe's faces are a regular polar grid, so a per-face hash
 * paints whole wedges and the cap comes out as a fairground pinwheel. Spots
 * have to be defined in cap space and tested against, so they stay round
 * wherever the tessellation happens to fall.
 */
const CAP_SPOTS: [number, number, number][] = [
  [0.35, 0.24, 0.15],
  [1.9, 0.3, 0.13],
  [3.5, 0.2, 0.12],
  [5.1, 0.34, 0.14],
  [0.95, 0.62, 0.12],
  [2.7, 0.58, 0.13],
  [4.4, 0.66, 0.11],
  [5.9, 0.55, 0.12],
  [1.45, 0.86, 0.1],
  [3.9, 0.88, 0.09],
];

function wrapPi(a: number): number {
  return ((a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
}

/* ------------------------------------------------------------------ the cap */

/**
 * The cap, as a lathed profile revolved around Y. Built at the origin so the
 * `cap` joint can rotate it freely for secondary motion.
 *
 * The profile runs UNDERSIDE-CENTRE → RIM → DOME TOP, i.e. with increasing y,
 * because that is the winding `lathe`/`loft` produce outward normals for.
 * Both ends sit at radius 0, so lathe leaves them uncapped and the result is a
 * closed solid.
 */
/**
 * Blaze wedge half-angle, radians (~48° full wedge). Sized to read as one
 * bold marking at 40 px — the CAP_SPOTS are 0.09–0.15 size fractions and
 * deliberately busy; the blaze must outrank them or it is just an eleventh
 * spot.
 */
const BLAZE_HALF_ANGLE = 0.42;
/**
 * Blaze inner edge, fraction of cap radius. NEAR THE APEX on purpose: the
 * first cut started at 0.45 and read as a rim patch — foreshortened to
 * almost nothing at east/west yaws (capture-verified). Anchored at the apex
 * the wedge is a compass NEEDLE: the dome's top is visible from the 3/4
 * camera at every facing, so the taper always points somewhere readable.
 */
const BLAZE_INNER = 0.16;
/** Spot-free zone around the blaze, radians — the marking stands alone. */
const BLAZE_CLEAR_ANGLE = 0.95;

/**
 * Icicle fringe layout — `[polar angle, length fraction]`, authored like
 * CAP_SPOTS so the fringe is irregular the way ice is, not a gear wheel.
 * Front is +Z (θ ≈ π/2 in the same atan2 space the paint uses); the arc
 * (1.05, 2.1) is deliberately empty so the fringe never curtains the face.
 */
const ICICLE_FRINGE: [number, number][] = [
  // Seven, not nine, and long: at fight distance the cap is ~14 px and a
  // 0.55·capH icicle rendered as 2 px of rim roughness, not teeth
  // (capture-judged at 800×450). Fewer, bigger units is §4's oversized-
  // features rule applied to ice.
  [2.35, 0.9],
  [3.0, 1.0],
  [3.65, 0.75],
  [4.3, 1.0],
  [4.95, 0.8],
  [5.6, 1.0],
  [0.55, 0.85],
];

interface CapShape {
  /** Rotfang: −Z shear on the dome above the widest point. */
  sweep?: number | undefined;
  /** Stormling: +X dome shear plus a whole-cap roll toward +X. */
  tilt?: number | undefined;
  /** Rimecap: hang ICICLE_FRINGE from the rim underside. */
  icicles?: boolean | undefined;
}

function capMesh(
  capR: number,
  capH: number,
  pal: SporelingPalette,
  droop: number,
  peak = 1,
  blaze = false,
  shape: CapShape = {},
): Mesh {
  // `peak` scales only the DOME — everything above the widest point — so the
  // rim line and gill underside stay put while the top spikes or flattens.
  // The one new silhouette axis of round 7 (see SporelingParams.capPeak).
  const domeY = (f: number): number => capH * (0.36 + (f - 0.36) * peak);
  const m = lathe(
    [
      [0, 0],
      [capR * 0.2, capH * 0.02],
      [capR * 0.58, capH * 0.08],
      [capR * 0.92, capH * 0.2], // rim underside
      [capR * 1.0, capH * 0.36], // widest point — the silhouette
      [capR * 0.96, domeY(0.48)],
      [capR * 0.87, domeY(0.6)],
      [capR * 0.72, domeY(0.74)],
      [capR * 0.52, domeY(0.87)],
      [capR * 0.28, domeY(0.96)],
      [0, domeY(1.0)],
    ],
    20, // enough angular resolution that a spot reads as round, not as a wedge
  );

  // Droop pulls the rim down and forward. A dome is proud; a drooping cap is
  // sickly. Same generator, opposite body language.
  if (droop !== 0) {
    m.warp((v) => {
      const t = Math.min(1, Math.hypot(v[0], v[2]) / capR);
      return [v[0], v[1] - droop * t * t * capH, v[2] + droop * t * capH * 0.25];
    });
  }

  // Sweep: shear the dome BEHIND (−Z) above the widest point, zero at the
  // rim so the gill line stays put. Pure x/z shear — y is untouched, so the
  // paint's rim test below still sees the true underside.
  if (shape.sweep) {
    const y0 = capH * 0.36;
    const k = shape.sweep;
    m.warp((v) => (v[1] <= y0 ? v : [v[0], v[1], v[2] - k * (v[1] - y0)]));
  }

  // Wind-tilt, part 1: shear the dome toward +X. Part 2 (the whole-cap
  // roll) happens after painting, because a roll moves y and would smear
  // the gill/cap boundary the paint keys on.
  if (shape.tilt) {
    const y0 = capH * 0.2;
    const k = shape.tilt;
    m.warp((v) => (v[1] <= y0 ? v : [v[0] + k * (v[1] - y0), v[1], v[2]]));
  }

  const rimY = capH * 0.22;
  const spotted = pal.spot !== pal.cap;
  m.paint((c) => {
    if (c[1] < rimY) return pal.gill;
    if (!spotted && !blaze) return pal.cap;
    const r = Math.hypot(c[0], c[2]);
    const theta = Math.atan2(c[2], c[0]);
    // The facing blaze: one bold wedge of the spot colour over the FRONT of
    // the dome (+Z is forward in cap space — the droop warp pulls the rim
    // toward +z and calls it forward). Tested before the spots so the wedge
    // stays one clean shape rather than a merge of overlapping rounds.
    if (blaze) {
      const off = Math.abs(wrapPi(theta - Math.PI / 2));
      if (r > capR * BLAZE_INNER && off < BLAZE_HALF_ANGLE) return pal.spot;
      // Keep the front hemisphere otherwise CLEAN: at 1280×800 the compass
      // read from east/west facings dissolved into the neighbouring spots
      // (capture-verified), and one bold marking on plain ground is the
      // whole point — an eleventh spot is noise.
      if (off < BLAZE_CLEAR_ANGLE) return pal.cap;
    }
    if (!spotted) return pal.cap;
    // Test the face centre against each authored spot in cap-polar space. The
    // arc term is scaled by radius so spots stay round rather than fanning out
    // toward the rim.
    for (const [ts, rf, sf] of CAP_SPOTS) {
      const rs = rf * capR;
      const arc = wrapPi(theta - ts) * ((r + rs) * 0.5);
      const dr = r - rs;
      const rad = sf * capR;
      if (dr * dr + arc * arc < rad * rad) return pal.spot;
    }
    return pal.cap;
  });
  m.smooth(1, 0.18);

  // The fringe merges AFTER the smooth: an icicle's point is the read, and
  // even one 0.18-strength pass would blunt a five-sided spike. Anchors
  // re-apply the droop formula so the fringe hugs the rim wherever the warp
  // put it, at any droop value.
  if (shape.icicles) {
    const rimR = capR * 0.92;
    const t = Math.min(1, rimR / capR);
    const rimY = capH * 0.2 - droop * t * t * capH;
    const rimZ = droop * t * capH * 0.25;
    for (const [a, lf] of ICICLE_FRINGE) {
      m.merge(
        cone(capH * 0.09 * (0.6 + lf * 0.4), capH * 0.55 * lf, 5)
          .rotate(Math.PI, 0, 0) // apex down — it hangs
          .translate(Math.cos(a) * rimR, rimY + capH * 0.06, Math.sin(a) * rimR + rimZ)
          .color(pal.icicle ?? pal.stalk),
      );
    }
  }

  // Wind-tilt, part 2: roll the finished cap toward +X (negative z angle
  // carries the apex to +X under the sign convention). The shear bends the
  // dome; the roll commits the whole cap, rim line included, so the
  // asymmetry survives even a dead-on front silhouette.
  if (shape.tilt) m.rotate(0, 0, -shape.tilt * 0.35);

  return m;
}

/* -------------------------------------------------------------- the builder */

export function sporelingRig(p: Partial<SporelingParams> = {}): Rig {
  const c = { ...DEFAULT_SPORELING, ...p };
  const pal = { ...PIM_PALETTE, ...(p.palette ?? {}) };
  const H = c.height;
  const thick = 0.85 + c.build * 0.4;

  // Proportions. Legs are deliberately stubby and the cap starts at ~60% of
  // total height: a sporeling is mostly cap and torso, which is what keeps it
  // from reading as a short human.
  const ankleY = H * 0.04;
  const kneeY = H * 0.15;
  const hipY = H * 0.3;
  const waistY = H * 0.4;
  const neckY = H * 0.62;

  const hipR = H * 0.115 * thick;
  const waistR = H * 0.104 * thick;
  const chestR = H * 0.126 * thick;
  const neckR = H * 0.085 * thick;
  const depth = 0.82; // sporelings are rounder than humans, but not spherical

  const capR = H * c.capSpread;
  const capH = H * 0.32;

  const parts: RigPart[] = [];

  /* --- pelvis: the root ------------------------------------------------- */
  const pelvis = loft(
    [
      ring(hipR * 0.72, hipR * 0.72 * depth, -H * 0.03),
      ring(hipR, hipR * depth, 0),
      ring(waistR * 1.02, waistR * 1.02 * depth, waistY - hipY),
    ],
    { closed: true, capStart: true, capEnd: true },
  )
    .smooth(1, 0.2)
    .color(pal.trouser);
  parts.push({ name: "pelvis", mesh: pelvis, parent: null, offset: [0, hipY, 0] });

  /* --- torso: a plump stalk, cinched then flared ------------------------ */
  const torsoH = neckY - waistY;
  const torso = loft(
    [
      ring(waistR, waistR * depth, 0),
      ring(waistR * 1.08, waistR * 1.08 * depth, torsoH * 0.22),
      ring(chestR, chestR * depth, torsoH * 0.58),
      ring(chestR * 0.94, chestR * 0.94 * depth, torsoH * 0.8),
      ring(neckR, neckR * depth, torsoH),
    ],
    { closed: true, capStart: true, capEnd: true },
  ).smooth(1, 0.2);
  // Coat below the collar, bare stalk at the neck. That collar line gives the
  // shoulders a read at 40 px that a single-colour tube never has.
  torso.paint((cc) => (cc[1] > torsoH * 0.86 ? pal.stalk : pal.coat));

  // A belt. One dark band at the narrowest point separates torso from legs and
  // does more for readability at 40 px than any amount of geometry.
  const beltY = torsoH * 0.12;
  const belt = loft(
    [
      ring(waistR * 1.1, waistR * 1.1 * depth, beltY - H * 0.016),
      ring(waistR * 1.14, waistR * 1.14 * depth, beltY),
      ring(waistR * 1.1, waistR * 1.1 * depth, beltY + H * 0.016),
    ],
    { closed: true, capStart: true, capEnd: true },
  ).color(pal.leather);
  torso.merge(belt);
  parts.push({
    name: "torso",
    mesh: torso,
    parent: "pelvis",
    offset: [0, waistY - hipY, 0],
    // The lunge (rotfang): positive x pitches the torso's up-vector toward
    // +Z — forward. Absent for everyone else, so the rest of the roster is
    // byte-identical to before this param existed.
    ...(c.lean ? { rest: [c.lean, 0, 0] as Vec3 } : {}),
  });

  /* --- head: the face knob. The cap is its own joint, below. ------------ */
  // The head has to carry real mass. At a smaller radius the cap dominated so
  // completely that the eyes read as two dots floating on a bare neck — the
  // face needs a volume to sit on, or the character looks like a skull on a
  // stick from the diorama camera.
  const headR = H * 0.135 * thick;
  const head = new Mesh();
  const knob = sphere(headR, 2)
    .scaleBy(1.04, 0.82, 0.96)
    .translate(0, headR * 0.42, 0)
    .color(pal.stalk);
  head.merge(knob);

  // Eyes: large, dark, set wide and FORWARD (+Z). Big dark eyes are the single
  // cheapest thing that makes a shape read as a character rather than an
  // object, and at 800x450 they are most of the face the player ever sees.
  const eyeR = headR * 0.31;
  for (const side of [-1, 1] as const) {
    head.merge(
      sphere(eyeR, 1)
        .scaleBy(0.9, 1.15, 0.75)
        .translate(side * headR * 0.42, headR * 0.46, headR * 0.82)
        .color(pal.eye),
    );
    // Catchlight. Two flat dark dots read as a doll; one bright speck in the
    // upper-inner corner of each reads as alive, and it costs 8 triangles.
    head.merge(
      sphere(eyeR * 0.42, 0)
        .translate(side * headR * 0.33, headR * 0.56, headR * 0.92)
        .color(pal.eyeLight),
    );
  }
  parts.push({
    name: "head",
    mesh: head,
    parent: "torso",
    offset: [0, torsoH, 0],
    // Chin up. From the 3/4 diorama camera a level head puts the eyes under
    // the cap's own shadow and the character loses its face entirely — which
    // is exactly what the first render did. A leaning body counter-pitches
    // at 0.7× so the lunge doesn't point the face at the floor.
    rest: [-0.16 - (c.lean ?? 0) * 0.7, 0, 0],
  });

  /* --- cap: child of head so it can trail under secondary motion -------- */
  parts.push({
    name: "cap",
    mesh: capMesh(capR, capH, pal, c.droop, c.capPeak ?? 1, c.blaze ?? false, {
      sweep: c.capSweep,
      tilt: c.capTilt,
      icicles: c.icicles,
    }),
    parent: "head",
    offset: [0, headR * 0.58, 0],
    // Worn pushed back, like a hat shoved off the brow. Negative x lifts the
    // FRONT rim (the cap points up, so the sign inverts relative to limbs),
    // which is what lets the camera see the eyes under a cap this wide.
    rest: [-0.3, 0, 0],
  });

  /* --- arms: stubby, with oversized hands ------------------------------- */
  const upperLen = H * 0.15;
  const foreLen = H * 0.14;
  const armR = H * 0.038 * thick;

  for (const side of [-1, 1] as const) {
    const s = side < 0 ? "L" : "R";
    parts.push({
      name: `upperArm${s}`,
      // Sleeve in the coat colour, bare forearm below — the same trick as the
      // collar, giving the arm a joint the eye can find at distance.
      mesh: limb(upperLen, armR, armR * 0.86).color(pal.coat),
      parent: "torso",
      offset: [side * chestR * 0.92, torsoH * 0.72, 0],
      // Out from the body so the silhouette stays open, pitched slightly
      // forward — negative x is forward (see RigPart.rest in humanoid.ts).
      //
      // ⚠️ z sign: a limb hangs down −Y, and a POSITIVE z rotation carries its
      // tip toward +X. So the LEFT arm (side = −1) needs a NEGATIVE z to swing
      // outward. Writing `side * -0.34` tucks both arms into the torso and the
      // character loses its arms entirely inside its own silhouette.
      rest: [-0.12, 0, side * 0.38],
    });

    const fore = limb(foreLen, armR * 0.88, armR * 0.66).color(pal.stalk);
    // Oversized blunt hand: legible at distance and an obvious mount point for
    // a weapon prop.
    fore.merge(
      sphere(armR * 1.5, 1)
        .scaleBy(1.0, 1.15, 0.85)
        .translate(0, -foreLen - armR * 0.7, armR * 0.15)
        .color(pal.stalk),
    );
    parts.push({
      name: `foreArm${s}`,
      mesh: fore,
      parent: `upperArm${s}`,
      offset: [0, -upperLen, 0],
      // Elbows flex FORWARD, so negative x. The z brings the hands back in
      // toward the front of the body — opposite sign to the shoulder.
      rest: [-0.34, 0, side * -0.14],
    });
  }

  /* --- legs: short, with big feet --------------------------------------- */
  const thighLen = hipY - kneeY;
  const shinLen = kneeY - ankleY;
  // Wide enough that the two boots stay visibly separate — at a narrower
  // stance they merged into one dark plank under the body.
  const legOffset = hipR * 0.62;
  const thighR = hipR * 0.46;
  const shinR = hipR * 0.36;

  for (const side of [-1, 1] as const) {
    const s = side < 0 ? "L" : "R";
    parts.push({
      name: `thigh${s}`,
      mesh: limb(thighLen, thighR, thighR * 0.84).color(pal.trouser),
      parent: "pelvis",
      offset: [side * legOffset, -H * 0.012, 0],
      rest: [0, 0, side * -0.06],
    });

    const shin = limb(shinLen, shinR, shinR * 0.82).color(pal.stalk);
    // Foot: an oversized wedge forward of the ankle. From the 3/4 diorama
    // camera the feet are what say which way the character is facing.
    shin.merge(
      box(shinR * 2.0, ankleY * 1.7, shinR * 4.6)
        .translate(0, -shinLen - ankleY * 0.45, shinR * 1.4)
        .color(pal.leather),
    );
    parts.push({
      name: `shin${s}`,
      mesh: shin,
      parent: `thigh${s}`,
      offset: [0, -thighLen, 0],
      rest: [0, 0, side * 0.06],
    });
  }

  return { parts, eyeHeight: neckY + headR * 0.55 };
}

/** A Rotling: the same creature, drained. Drooping cap, no speckle, hunched. */
export function rotlingRig(p: Partial<SporelingParams> = {}): Rig {
  return sporelingRig({
    height: 1.05,
    build: 0.7,
    capSpread: 0.27,
    droop: 0.55,
    palette: ROTLING_PALETTE,
    ...p,
  });
}

/* ------------------------------------------------------------ the thornback */

/**
 * Crest layout — `[u, length fraction, rake radians]`, authored irregular
 * like `ICICLE_FRINGE`. `u` runs the cap's sagittal midline: +1 is the front
 * rim (+Z), 0 the apex, −1 the rear rim. Rake is an x-rotation on the thorn:
 * POSITIVE tips the point forward (+Z), negative sweeps it back — the row
 * reads as one brow horn and a wind-swept saw behind it, biggest at the
 * crown (§4's fewer-bigger-units rule, the icicle lesson at boss scale).
 */
const CREST_THORNS: [number, number, number][] = [
  [0.48, 0.68, 0.2], // the brow horn — the one FORWARD point on the body
  [0.24, 0.85, -0.15],
  [-0.02, 1.0, -0.45], // the king thorn, at the crown
  [-0.3, 0.9, -0.72],
  [-0.58, 0.75, -0.98],
  [-0.84, 0.55, -1.22], // rear, raked almost flat along the dome
];

/**
 * Thornback — the chapter-1 boss (R4). Boss lane, not roster: it lost the
 * slot-8 vote to the stormling and kept its concept for this. A boss-scale
 * bruiser on the family rig — twice the rotling's height, maximum build,
 * knuckle-heavy — with the family's one unclaimed silhouette axis: a BROKEN
 * TOP. Every roster dome is smooth-crested (the rimecap's break is the RIM);
 * the thornback carries a sagittal thorn crest, readable at every yaw — saw
 * ridge in profile, peak row head-on.
 *
 * Built as a post-process on `sporelingRig` rather than new params: the
 * eight shipped rigs stay byte-identical (mesh-snapshot is the proof), and
 * everything boss-only lives here. The crest is its OWN rig part, parented
 * to the cap: it rides cap secondary motion for free, and the phase-2 "thorn
 * flare" (mech's `phase` field) can scale one named joint — `crest` —
 * without touching geometry.
 */
export function thornbackRig(): Rig {
  const H = 2.15; // ~2× rotling. The arena reads the rest of "boss".
  const capSpread = 0.325;
  // 0.5, down from a first-render 0.62: that droop CURTAINED the face, and
  // the FX.wet eye glow is the identity kit's whole signal on this body —
  // a boss with no visible eyes reads as furniture (capture-judged).
  const droop = 0.5;
  const capPeak = 0.9; // flattened dome — the crest owns the top line
  const capSweep = 0.55; // mass raked rearward: mid-charge even at rest
  const rig = sporelingRig({
    height: H,
    build: 1.0,
    capSpread,
    droop,
    capPeak,
    capSweep,
    lean: 0.3, // hunched into the shoulders, per the rotfang precedent
    palette: THORNBACK_PALETTE,
  });

  // Brawn: oversized forearms and fists — §4's oversized-features rule spent
  // where a bruiser carries its story. Scaled about the elbow joint, so the
  // reach drops toward the knuckle-drag the lean already suggests.
  for (const s of ["L", "R"] as const) {
    rig.parts.find((p) => p.name === `foreArm${s}`)?.mesh.scaleBy(1.35, 1.2, 1.35);
  }

  // The crest. Anchors sit on the cap's sagittal midline, computed from the
  // same profile/droop/sweep maths `capMesh` warps its dome with, then each
  // thorn is sunk ~15% so the base misfit disappears into the hide.
  const capR = H * capSpread;
  const capH = H * 0.32;
  // r/capR → profile fraction f, straight from capMesh's lathe table; the
  // dome height is domeY(f) with the same peak scale.
  const PROFILE: [number, number][] = [
    [1.0, 0.36],
    [0.96, 0.48],
    [0.87, 0.6],
    [0.72, 0.74],
    [0.52, 0.87],
    [0.28, 0.96],
    [0.0, 1.0],
  ];
  const domeY = (f: number): number => capH * (0.36 + (f - 0.36) * capPeak);
  const surfaceY = (r: number): number => {
    for (let i = 0; i < PROFILE.length - 1; i++) {
      const [r0, f0] = PROFILE[i]!;
      const [r1, f1] = PROFILE[i + 1]!;
      if (r <= r0 && r >= r1) return domeY(f0 + ((f1 - f0) * (r0 - r)) / (r0 - r1));
    }
    return domeY(1.0);
  };
  const crest = new Mesh();
  for (const [u, lf, rake] of CREST_THORNS) {
    const r = Math.abs(u) * capR;
    const t = r / capR;
    let y = surfaceY(r);
    let z = Math.sign(u) * r;
    // The droop warp, re-applied (the icicle-fringe pattern): rim pulled
    // down and forward, so the crest hugs the dome wherever the warp put it.
    y -= droop * t * t * capH;
    z += droop * t * capH * 0.25;
    // The sweep shear, on the post-droop height like capMesh does it.
    const y0 = capH * 0.36;
    if (y > y0) z -= capSweep * (y - y0);
    const len = capH * 0.68 * lf;
    crest.merge(
      cone(len * 0.24, len, 5)
        .rotate(rake, 0, 0) // +rake tips forward: R_x(+θ) carries the +Y apex toward +Z
        .translate(0, y - len * 0.1, z)
        .color(THORNBACK_PALETTE.thorn ?? THORNBACK_PALETTE.stalk),
    );
  }
  rig.parts.push({ name: "crest", mesh: crest, parent: "cap", offset: [0, 0, 0] });

  // Wear the cap shoved further back than the family's −0.3: the front rim
  // lifts and the eye glow reads from under the brim — the boss's face is a
  // pair of wet-cyan lamps in a dark socket, not a curtained blank.
  const capPart = rig.parts.find((p) => p.name === "cap");
  if (capPart) capPart.rest = [-0.44, 0, 0];
  return rig;
}

/* ------------------------------------------------------------- foe rigs */

/**
 * THE one table a foe kind's look comes from (round 7). Two consumers, no
 * drift: `rt-view` builds live puppets from it (per-kind rigs are cached
 * there and their geometries shared — the first fight's spawn was the perf
 * gate's worst frame before that), and the variant registry below feeds the
 * same entries to the preview harness and the mesh-regression manifest. The
 * ternary this replaced and the old VARIANTS list had already drifted apart
 * (ashcap and seeper were invisible to the tooling).
 *
 * An unknown kind falls back to the rotling at the LOOKUP site — a missing
 * row must degrade to a legible body, never to a crash or an invisible foe.
 */
export interface FoeRigSpec {
  rig: () => Rig;
  /** Sheen carries wetness without colour (ART_DIRECTION §2.2). */
  roughness: number;
  /**
   * Windup-tint attenuation (R4). The telegraph tint's luminance match was
   * tuned on ~1 m bodies; on the thornback's 2.15 m mass the same emissive
   * washed the whole boss to a ghost for a large fraction of the fight
   * (wu16 melee + douser slams — capture-judged). The HUE stays the attack
   * element per §6; this scales only the weight. Default 1.
   */
  windupTint?: number;
  /**
   * Foe HP bar anchor height in metres (R4). The bar rode a flat 1.6 m and
   * rendered INSIDE the thornback's face; a bar belongs above the body it
   * measures. Default 1.6 — the roster's height class.
   */
  barHeight?: number;
}

/** The HP-bar anchor for a kind — above the head, whatever the head's height. */
export function foeBarHeight(kindId: string): number {
  return FOE_RIGS[kindId]?.barHeight ?? 1.6;
}

export const FOE_RIGS: Record<string, FoeRigSpec> = {
  // The baseline: dome-mid, the shape every other kind diverges from.
  rotling: { rig: () => rotlingRig(), roughness: 0.8 },
  // The tall thin SPIKE — near-zero droop and the family's peakiest cap, in
  // its palest colours: it reads from its own 7.5 m band. Dry and dusty.
  ashcap: {
    rig: () =>
      rotlingRig({
        build: 0.3,
        height: 1.1,
        capSpread: 0.22,
        droop: 0.25,
        capPeak: 1.5,
        palette: ASHCAP_PALETTE,
      }),
    roughness: 0.85,
  },
  // The wide FLAT heavy pancake, brown-leaned, faintly oily. 0.62, not 0.45:
  // at 0.45 the 2.6-intensity key read it as porcelain, which rewrote an
  // existing look instead of seasoning it.
  seeper: {
    rig: () =>
      rotlingRig({
        build: 0.75,
        height: 1.24,
        capSpread: 0.34,
        droop: 0.7,
        capPeak: 0.7,
        palette: SEEPER_PALETTE,
      }),
    roughness: 0.62,
  },
  // Sodden: the heaviest droop of the family, slighter and shorter than the
  // rotling (1.05/0.7) so the foe silhouettes pass the black-shape test.
  sopling: {
    rig: () => rotlingRig({ build: 0.5, height: 0.98, droop: 0.85, palette: SOPLING_PALETTE }),
    roughness: 0.55,
  },
  // Burnt stiff: small, upright, faintly conical — near-zero droop and a
  // peaked cap on the family's smallest frame, ember eyes on a char body
  // (see CINDERLING_PALETTE).
  cinderling: {
    rig: () =>
      rotlingRig({
        build: 0.45,
        height: 0.95,
        capSpread: 0.24,
        droop: 0.15,
        capPeak: 1.3,
        palette: CINDERLING_PALETTE,
      }),
    roughness: 0.8,
  },
  // R2's three, each on a silhouette axis no sibling uses (the family had
  // spent height, width, droop and peak on the first five):
  //
  // Frozen dry: the BROKEN RIM — an icicle fringe on an ashcap-class frame.
  // Same band as the ashcap, so the pair separate by fringe, spread (0.3 vs
  // 0.22) and hue direction (ice vs violet), never by gait. DRY at 0.85 —
  // cold is not wet; the sopling keeps the glisten (mech's roster spec).
  rimecap: {
    rig: () =>
      rotlingRig({
        build: 0.4,
        height: 1.08,
        capSpread: 0.3,
        droop: 0.35,
        capPeak: 1.1,
        icicles: true,
        palette: RIMECAP_PALETTE,
      }),
    roughness: 0.85,
  },
  // The mover: the family's only HORIZONTAL — lowest frame, widest build,
  // torso pitched into the lunge, cap swept back like it is already
  // mid-spring. In black shape it is a wedge among mushrooms.
  rotfang: {
    rig: () =>
      rotlingRig({
        build: 0.85,
        height: 0.92,
        capSpread: 0.29,
        droop: 0.3,
        // Flattened AND swept: the roster's other hunched shape (sopling)
        // carries a round drooped dome, so the wedge read rests on the cap
        // FORM as much as the lean — at 30 px the pair separated on
        // width/mass alone, which was the weakest margin in the eight
        // (capture-judged at 800×450).
        capPeak: 0.85,
        capSweep: 1.05,
        lean: 0.42,
        palette: ROTFANG_PALETTE,
      }),
    roughness: 0.8,
  },
  // The charged one: the family's only LEFT-RIGHT asymmetry — the
  // pre-committed wind-tilt cap on a thin tall frame. Not the ashcap's
  // spike (peak 1.15 vs 1.5): the tilt is the read, the frame just keeps
  // it in the spitter class.
  stormling: {
    rig: () =>
      rotlingRig({
        build: 0.35,
        height: 1.12,
        capSpread: 0.26,
        droop: 0.2,
        capPeak: 1.25,
        capTilt: 0.9,
        palette: STORMLING_PALETTE,
      }),
    roughness: 0.8,
  },
  // The ch1 boss (R4, boss lane — not a roster kind). Sodden: the deepest
  // glisten in the game, past the sopling's 0.55 — its permanently-wet hide
  // is the fight's mechanism, and the sheen is that state's resting read
  // (rt-view eases it matte during a dried-by-braziers window). Tint 0.5
  // and bar 3.05 per the R4 capture findings on the FoeRigSpec fields.
  thornback: { rig: thornbackRig, roughness: 0.35, windupTint: 0.5, barHeight: 3.05 },
};

/* ------------------------------------------------------------- variants */

const VARIANTS: Array<[string, () => Rig]> = [
  // Blaze on, matching the live hero in rt-view — the registry mirrors the
  // game or the preview tooling drifts (the round-7 lesson).
  ["pim", () => sporelingRig({ palette: PIM_PALETTE, blaze: true })],
  ["sella", () => sporelingRig({ palette: SELLA_PALETTE, build: 0.35, height: 1.12 })],
  ["emberkin", () => sporelingRig({ palette: EMBERKIN_PALETTE, build: 0.4 })],
  // Every foe kind, straight from the live table — one source, no drift.
  ...Object.entries(FOE_RIGS).map(([id, spec]): [string, () => Rig] => [id, spec.rig]),
];

for (const [name, build] of VARIANTS) {
  registerMesh({
    id: `sporeling/${name}`,
    group: "character",
    build: () => flattenRig(build()),
  });
}

export { VARIANTS as SPORELING_VARIANTS };
