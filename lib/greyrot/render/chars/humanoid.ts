/**
 * The parametric humanoid — the base every hero and human-shaped enemy is
 * built from.
 *
 * ## Rigid parts, not skinning
 *
 * Characters are a hierarchy of separate solid parts, not a skinned mesh. No
 * vertex weights, no bone matrices, no skinning cost per frame — which matters
 * on the 4 GB Chromebook floor (CLAUDE.md §5). Chunky articulated parts is also
 * a deliberate art direction rather than a concession: it reads as stylised,
 * the way For The King or Wildermyth do, instead of as bad skinning.
 *
 * A generator returns a `Rig`: named parts with local geometry, a parent, and a
 * joint offset. Presentation assembles that into Object3Ds; procedural
 * animation rotates joints. The bind-pose flatten exists for the preview and
 * the regression screenshot.
 */

import { Euler, Matrix4 } from "three";
import {
  Mesh,
  box,
  lathe,
  loft,
  sphere,
  tube,
  type RGB,
  type Vec3,
} from "../mesh/dsl";
import { registerMesh } from "../mesh/registry";

export interface HumanoidParams {
  /** Total height in world units (metres). 1.8 is an average adult. */
  height: number;
  /** 0 = lean, 1 = heavy. Drives torso and limb thickness. */
  build: number;
  /** Multiplier on head size. >1 reads younger and more stylised. */
  headScale: number;
  /** Shoulder width multiplier. Heroes read better a little wide. */
  shoulders: number;
  palette: HumanoidPalette;
}

export interface HumanoidPalette {
  skin: RGB;
  hair: RGB;
  tunic: RGB;
  /** Legs. Distinct from the tunic or the whole figure reads as one blue mass. */
  trouser: RGB;
  leather: RGB;
  metal: RGB;
  boot: RGB;
}

export const DEFAULT_PALETTE: HumanoidPalette = {
  skin: [0.82, 0.62, 0.48],
  hair: [0.26, 0.17, 0.12],
  tunic: [0.34, 0.46, 0.60],
  trouser: [0.21, 0.27, 0.36],
  leather: [0.42, 0.28, 0.18],
  metal: [0.62, 0.65, 0.71],
  boot: [0.24, 0.18, 0.14],
};

export const DEFAULT_HUMANOID: HumanoidParams = {
  height: 1.8,
  build: 0.45,
  headScale: 1.12,
  shoulders: 1.0,
  palette: DEFAULT_PALETTE,
};

/** One rigid part in the hierarchy. */
export interface RigPart {
  name: string;
  /** Geometry in the part's own local space, origin at its joint. */
  mesh: Mesh;
  /** Parent part name, or null for the root. */
  parent: string | null;
  /** Joint position relative to the parent's joint. */
  offset: Vec3;
  /**
   * Rest rotation at this joint (XYZ Euler, radians). The bind pose is a
   * relaxed A-pose, not a T-pose: arms need to clear the torso or the
   * silhouette closes up into a blob, and silhouette is what decides whether a
   * character reads at 800×450.
   *
   * ⚠️ SIGN CONVENTION — get this wrong and limbs bend backwards.
   * Characters face local **+Z** (`group.rotation.y = atan2(fx, fz)`), and
   * every limb segment hangs down **−Y** from its joint. A *positive* X
   * rotation carries a −Y limb toward **−Z**, i.e. BEHIND the character.
   * So: knees flex with POSITIVE x (correct, knees bend backwards); elbows
   * flex with NEGATIVE x (hands come forward). The first pass had both
   * positive and shipped a hero whose hands hung behind their hips — caught
   * in playtest, not in review.
   */
  rest?: Vec3;
}

export interface Rig {
  parts: RigPart[];
  /** Eye height, for camera framing and nameplates. */
  eyeHeight: number;
}

/* ------------------------------------------------------------------ helpers */

/**
 * An elliptical ring. Humanoid cross-sections are wider than they are deep;
 * circles read as a snowman.
 *
 * Winding matches `circleRing` in the DSL (clockwise in XZ) so `loft` produces
 * outward normals.
 */
function ellipseRing(rx: number, rz: number, y: number, sides: number): Vec3[] {
  const ring: Vec3[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    ring.push([Math.cos(a) * rx, y, -Math.sin(a) * rz]);
  }
  return ring;
}

/** A tapered limb segment running down -Y from its joint at the origin. */
function limb(length: number, rTop: number, rBottom: number, sides = 7): Mesh {
  const path: Vec3[] = [
    [0, 0, 0],
    [0, -length * 0.5, 0],
    [0, -length, 0],
  ];
  return tube(path, [rTop, (rTop + rBottom) * 0.5, rBottom], sides);
}

/* -------------------------------------------------------------- the builder */

export function humanoidRig(p: Partial<HumanoidParams> = {}): Rig {
  const c = { ...DEFAULT_HUMANOID, ...p };
  const pal = { ...DEFAULT_PALETTE, ...(p.palette ?? {}) };
  const H = c.height;
  const thick = 0.85 + c.build * 0.45;

  // Stylised heroic proportions, ~7 heads. Deliberately not realistic:
  // oversized hands and feet and an exaggerated shoulder-to-waist taper all
  // survive being shrunk to a 40 px figure on a phone, where accurate
  // proportions turn to mush.
  //
  // Heights are absolute (world units from the ground) so joints line up by
  // construction rather than by coincidence — the previous pass left a hole
  // between pelvis and torso because their spans were derived separately.
  const headR = H * 0.072 * c.headScale;
  const kneeY = H * 0.25;
  const hipY = H * 0.465;
  const waistY = H * 0.575;
  const chestY = H * 0.715;
  const neckY = H * 0.83;

  const hipHalf = H * 0.082 * thick;
  const waistHalf = H * 0.062 * thick; // the cinch
  const chestHalf = H * 0.105 * thick;
  const shoulderHalf = H * 0.135 * c.shoulders * thick;
  const depth = 0.6; // bodies are wider than they are deep

  // Legs are derived FROM the hip width so they can never overlap: the inner
  // edge of each thigh sits a clear gap away from the centreline. Two legs
  // that touch read as one column at distance, which is what killed the first
  // version — but too thin and the figure reads as a spider, which killed the
  // second. These ratios leave a ~4 cm gap on a 1.8 m figure.
  const legOffset = hipHalf * 0.58;
  const thighR = hipHalf * 0.44;
  const shinR = hipHalf * 0.32;

  // Shared cross-sections: the pelvis's top ring and the torso's bottom ring
  // are literally the same ring, so the seam is invisible.
  const waistRing = (y: number): Vec3[] => ellipseRing(waistHalf, waistHalf * depth, y, 8);

  const parts: RigPart[] = [];

  /* --- pelvis: the root ------------------------------------------------- */
  // Short, and tapering back inward at the bottom so the thighs emerge from it
  // rather than dangling out of a flat slab. A wide flat-bottomed pelvis in a
  // contrasting colour reads unmistakably as a nappy.
  const pelvis = loft(
    [
      ellipseRing(legOffset + thighR * 0.95, hipHalf * depth * 0.9, -H * 0.028, 8),
      ellipseRing(hipHalf, hipHalf * depth * 1.05, 0, 8),
      ellipseRing(hipHalf * 0.92, hipHalf * depth, (waistY - hipY) * 0.45, 8),
      waistRing(waistY - hipY),
    ],
    { closed: true, capStart: true, capEnd: true },
  )
    .smooth(1, 0.2)
    // The top of the trousers. Reading it as part of the legs rather than the
    // torso is what stops it looking like a nappy.
    .color(pal.trouser);
  parts.push({ name: "pelvis", mesh: pelvis, parent: null, offset: [0, hipY, 0] });

  /* --- torso: cinched at the waist, broad at the chest ------------------ */
  const torsoH = neckY - waistY;
  const chestT = (chestY - waistY) / torsoH;
  const torso = loft(
    [
      waistRing(0),
      ellipseRing(waistHalf * 1.06, waistHalf * depth * 1.1, torsoH * 0.18, 8),
      ellipseRing(chestHalf * 0.94, chestHalf * depth, torsoH * chestT * 0.72, 8),
      ellipseRing(chestHalf, chestHalf * depth * 1.02, torsoH * chestT, 8),
      // Carry the chest width almost all the way up so the pauldrons land on
      // shoulders instead of hovering beside a narrow neck.
      ellipseRing(shoulderHalf * 0.94, chestHalf * depth * 0.96, torsoH * 0.88, 8),
      ellipseRing(shoulderHalf * 0.62, chestHalf * depth * 0.66, torsoH, 8),
    ],
    { closed: true, capStart: true, capEnd: true },
  ).smooth(1, 0.2);

  // A belt. One dark horizontal band at the narrowest point does more for
  // readability than any amount of geometry — it separates torso from legs.
  const beltY = torsoH * 0.1;
  const belt = loft(
    [
      ellipseRing(waistHalf * 1.1, waistHalf * depth * 1.14, beltY - H * 0.014, 8),
      ellipseRing(waistHalf * 1.13, waistHalf * depth * 1.17, beltY, 8),
      ellipseRing(waistHalf * 1.1, waistHalf * depth * 1.14, beltY + H * 0.014, 8),
    ],
    { closed: true, capStart: true, capEnd: true },
  ).color(pal.leather);

  torso.paint((cen) => (cen[1] > torsoH * chestT * 0.95 ? pal.leather : pal.tunic));
  torso.merge(belt);
  parts.push({
    name: "torso",
    mesh: torso,
    parent: "pelvis",
    offset: [0, waistY - hipY, 0],
  });

  /* --- head ------------------------------------------------------------- */
  const head = new Mesh();
  const neck = limb(headR * 0.45, headR * 0.38, headR * 0.44, 6).color(pal.skin);
  const skull = sphere(headR, 2)
    .scaleBy(0.88, 1.0, 0.94)
    // Narrow the jaw, keep the cranium full. Stops it reading as a ball —
    // but gently: a hard taper turns the face into a wedge.
    .taper("y", (t) => 0.84 + 0.16 * Math.min(1, t * 1.6))
    .translate(0, headR * 0.88, 0)
    .color(pal.skin);
  // Hair as a lathed dome. Clamping a sphere's lower vertices (the previous
  // attempt) flattens them into a disc that reads as a helmet brim.
  const hair = lathe(
    [
      [headR * 1.02, -headR * 0.55],
      [headR * 1.08, -headR * 0.1],
      [headR * 1.02, headR * 0.35],
      [headR * 0.82, headR * 0.72],
      [headR * 0.42, headR * 0.95],
      [0, headR * 1.02],
    ],
    10,
  )
    .scaleBy(0.9, 1.0, 0.98)
    // Push the mass backwards so the face stays clear and the head reads as
    // having a front from any angle.
    .warp((v) => [v[0], v[1], v[2] < 0 ? v[2] * 1.12 : v[2] * 0.82])
    .translate(0, headR * 0.92, -headR * 0.05)
    .color(pal.hair);
  head.merge(neck, skull, hair);
  parts.push({ name: "head", mesh: head, parent: "torso", offset: [0, torsoH, 0] });

  /* --- arms ------------------------------------------------------------- */
  const upperArmL = H * 0.185;
  const foreArmL = H * 0.172;
  const armR = H * 0.032 * thick;

  for (const side of [-1, 1] as const) {
    const s = side < 0 ? "L" : "R";
    // A pauldron reads as "hero" at a glance and widens the silhouette exactly
    // where it helps most. Sunk into the shoulder, not perched beside it.
    const pauldron = sphere(armR * 1.6, 1)
      .scaleBy(1.2, 0.78, 1.05)
      .translate(-side * armR * 0.2, armR * 0.2, 0)
      .color(pal.leather);
    const upper = limb(upperArmL, armR * 0.98, armR * 0.8, 7).color(pal.tunic);
    pauldron.merge(upper);
    parts.push({
      name: `upperArm${s}`,
      mesh: pauldron,
      parent: "torso",
      offset: [side * shoulderHalf * 0.8, torsoH * 0.86, 0],
      // A-pose with a natural hang: out from the ribcage, pitched a touch
      // forward (negative x — see the sign convention on RigPart.rest).
      // Dead-straight arms read as a shop mannequin.
      //
      // ⚠️ z sign: a limb hangs down −Y and a POSITIVE z rotation carries its
      // tip toward +X, so the LEFT arm (side = −1) needs a NEGATIVE z to swing
      // OUT. The original `side * -0.15` tucked both arms inward, closing the
      // silhouette it was written to open.
      rest: [-0.1, 0, side * 0.18],
    });

    const fore = limb(foreArmL, armR * 0.82, armR * 0.6, 7).color(pal.skin);
    // Oversized blocky hand — legible at distance, and it gives weapons an
    // obvious place to attach.
    const hand = box(armR * 1.5, armR * 1.9, armR * 1.15)
      .translate(0, -foreArmL - armR * 0.8, armR * 0.1)
      .color(pal.skin);
    fore.merge(hand);
    parts.push({
      name: `foreArm${s}`,
      mesh: fore,
      parent: `upperArm${s}`,
      offset: [0, -upperArmL, 0],
      // A relaxed elbow carries a real bend (~0.3 rad) FORWARD, hands
      // drifting in toward the front of the thighs.
      rest: [-0.3, 0, side * 0.06],
    });
  }

  /* --- legs ------------------------------------------------------------- */
  const ankleY = H * 0.055;
  const thighL = hipY - kneeY;
  const shinL = kneeY - ankleY;

  for (const side of [-1, 1] as const) {
    const s = side < 0 ? "L" : "R";
    const thigh = limb(thighL, thighR, thighR * 0.78, 7).color(pal.trouser);
    parts.push({
      name: `thigh${s}`,
      mesh: thigh,
      parent: "pelvis",
      offset: [side * legOffset, -H * 0.015, 0],
      // Legs splay very slightly. A perfectly parallel stance fuses into one
      // column at distance.
      rest: [0, 0, side * -0.05],
    });

    const shin = limb(shinL, shinR, shinR * 0.78, 7).color(pal.trouser);
    // Foot: an oversized wedge forward of the ankle. It reads as facing
    // direction from a high camera, which the combat framing needs.
    const foot = box(shinR * 2.1, ankleY * 1.5, shinR * 4.4)
      .translate(0, -shinL - ankleY * 0.4, shinR * 1.2)
      .color(pal.boot);
    shin.merge(foot);
    parts.push({
      name: `shin${s}`,
      mesh: shin,
      parent: `thigh${s}`,
      offset: [0, -thighL, 0],
      rest: [0, 0, side * 0.05], // straighten back up under the hip
    });
  }

  return { parts, eyeHeight: neckY + headR * 1.1 };
}

/**
 * Flatten a rig to a single mesh in bind pose.
 *
 * For the preview and the regression screenshot only — at runtime the parts
 * stay separate so joints can rotate.
 */
export function flattenRig(rig: Rig): Mesh {
  const out = Mesh.empty();
  for (const part of rig.parts) {
    out.merge(part.mesh.clone().applyMatrix(worldMatrix(rig, part.name)));
  }
  return out;
}

/**
 * World transform of a joint in the rest pose — offset then rest rotation,
 * composed up the parent chain. The runtime does the same thing with
 * Object3Ds; this exists so the preview and the regression screenshot see the
 * pose the game will actually show.
 */
export function worldMatrix(rig: Rig, partName: string): Matrix4 {
  const byName = new Map(rig.parts.map((p) => [p.name, p]));
  const chain: RigPart[] = [];
  let cur = byName.get(partName);
  while (cur) {
    chain.unshift(cur);
    cur = cur.parent ? byName.get(cur.parent) : undefined;
  }
  const m = new Matrix4();
  for (const part of chain) {
    const local = new Matrix4().makeTranslation(
      part.offset[0],
      part.offset[1],
      part.offset[2],
    );
    if (part.rest) {
      local.multiply(
        new Matrix4().makeRotationFromEuler(
          new Euler(part.rest[0], part.rest[1], part.rest[2], "XYZ"),
        ),
      );
    }
    m.multiply(local);
  }
  return m;
}

/* ------------------------------------------------------------- variants */

const VARIANTS: Array<[string, Partial<HumanoidParams>]> = [
  ["hero", {}],
  ["lean", { build: 0.05, shoulders: 0.9, height: 1.76 }],
  ["heavy", { build: 1.0, shoulders: 1.18, height: 1.86 }],
  [
    "mage",
    {
      build: 0.3,
      height: 1.72,
      palette: {
        ...DEFAULT_PALETTE,
        tunic: [0.38, 0.28, 0.54],
        trouser: [0.24, 0.18, 0.34],
        leather: [0.22, 0.16, 0.3],
      },
    },
  ],
];

for (const [name, params] of VARIANTS) {
  registerMesh({
    id: `humanoid/${name}`,
    group: "character",
    build: () => flattenRig(humanoidRig(params)),
  });
}

/** Exported for the animation layer, which needs the parts separate. */
export { VARIANTS as HUMANOID_VARIANTS };
