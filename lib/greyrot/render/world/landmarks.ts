/**
 * Authored landmarks (R4, story §5's sodden_hollow entry, PM-routed): pure
 * PRESENTATION scenery — no collision, no sim contact — so everything here
 * must be unreachable or flat, or it would lie about presence (scatter.ts'
 * rule: what blocks you and what you see are the same objects).
 *
 * Two pieces this cycle:
 *
 *  - THE DROWNED STUMP — the boss arena reads as the ruin of something
 *    colossal: Hollowstump's dark mirror, a charred giant stump standing in
 *    the water NE of the Sodden Hollow ring, with the rest of its fallen
 *    trunk sinking beside it. It stands BEYOND the ±118 body bound and the
 *    arena clamp in 2–3 m of water — no body can ever reach it, so
 *    render-only is honest. The boss camera faces this water in every
 *    framing, which is why this one landmark is worth authoring: it sits in
 *    the fight's persistent backdrop for free.
 *
 *  - THE DEAD FIRE-RING — a char stain under EVERY brazier bowl (physically
 *    true anywhere a fire has burned), plus two LARGER cold stains at the
 *    Sodden Hollow with no bowl left standing: the ring held more pyres
 *    once, and bigger ones. Bosk the charcoal-burner's ring, told entirely
 *    in ground stains — zero height, so bodies crossing them lie about
 *    nothing.
 *
 * Coupling note: the stump and dead-stain coordinates are authored against
 * the campaign scenario's Sodden Hollow (content/stages.ts, marker
 * [31.5, 107.5] r10). If R4.5 migrates landmarks into the stage pipeline,
 * these constants move into the declaration; until then, translating the
 * stage means updating these (grep: SODDEN_STUMP).
 */

import {
  BufferAttribute,
  BufferGeometry,
  Mesh,
  MeshStandardMaterial,
  type Material,
  type Object3D,
} from "three";
import type { Heightfield } from "../../sim/world/heightfield";
import type { Obstacles } from "../../sim/world/obstacles";
import { WORLD } from "../art";
import { box, lathe, sphere, srgbToLinear, tube, type Mesh as DslMesh, type RGB } from "../mesh/dsl";
import { registerMesh } from "../mesh/registry";

const CHAR: RGB = [...WORLD.charBark];
/**
 * Bleached driftwood — scatterRock value-shaded down 10%. A DROWNED stump is
 * silver-grey, not char: years in the water bleach it, and a charBark mass
 * this size rendered as a flat black cutout against the bright lake ("black
 * reads as a hole"). The dark heart stays charBark: the bore and the roots
 * at the waterline.
 */
const DRIFT: RGB = [WORLD.scatterRock[0] * 0.9, WORLD.scatterRock[1] * 0.9, WORLD.scatterRock[2] * 0.9];

/** SODDEN_STUMP — authored placement (see coupling note above). */
const STUMP_AT: [number, number] = [45.5, 127.0];

const DEAD_STAINS: readonly [number, number][] = [
  [24.5, 111.5],
  [36.5, 110.0],
];

/**
 * The colossal drowned stump. Silhouette-first (ART_DIRECTION §4.1): a
 * hollow bore with a jagged saw-tooth crown and a root flare — identifiable
 * as a dead giant stump in filled black shape. Two colours: bleached
 * driftwood body (DRIFT), charBark roots and fallen trunk at the waterline
 * — the SHAPE does the silhouette work against the lake, not blackness.
 */
export function stumpMesh(): DslMesh {
  // The bore: outside up, over the rim, inner wall down — hollow from every
  // angle that can see over the rim (the diorama always can).
  const bore = lathe(
    [
      [1.9, 0],
      [1.75, 1.1],
      [1.6, 2.2],
      [1.5, 3.3], // outer rim
      [1.28, 3.2], // rim top, inward
      [1.15, 2.3], // inner wall
      [0.9, 1.7],
      [0, 1.55], // dark bore floor
    ],
    9,
  ).color(DRIFT);
  // The crown: broken shards of the old wall, varying heights — the
  // saw-tooth black-shape signature (the thornback crest logic at
  // landmark scale).
  const shards = [0, 1, 2, 3, 4, 5].map((i) => {
    const a = (i / 6) * Math.PI * 2 + 0.4;
    const h = [1.25, 0.6, 1.0, 0.4, 0.8, 0.5][i]!;
    const r = 1.45;
    return tube(
      [
        [Math.cos(a) * r, 3.05, Math.sin(a) * r],
        [Math.cos(a) * (r - 0.08), 3.3 + h, Math.sin(a) * (r - 0.08)],
      ],
      [0.36, 0.11],
      5,
    ).color(DRIFT);
  });
  // The root flare, into the water.
  const roots = [0, 1, 2, 3, 4].map((i) => {
    const a = (i / 5) * Math.PI * 2 + 1.1;
    return tube(
      [
        [Math.cos(a) * 1.45, 0.7, Math.sin(a) * 1.45],
        [Math.cos(a) * 2.7, -0.5, Math.sin(a) * 2.7],
      ],
      [0.5, 0.2],
      5,
    ).color(CHAR);
  });
  // The rest of it: the fallen trunk, sinking away NE.
  const fallen = tube(
    [
      [2.2, 1.4, 1.3],
      [5.1, 0.4, 3.4],
      [7.8, -0.7, 5.6],
    ],
    [1.1, 0.95, 0.7],
    7,
  ).color(CHAR);
  return bore.merge(...shards, ...roots, fallen);
}

registerMesh({ id: "prop/stump", group: "prop", build: stumpMesh });

/* ==================================================================== */
/*  THE ROAD'S OWN BONES (R5, STORY.md §8 row 1)                        */
/*                                                                      */
/*  Five objects on the five stages fun could not name, plus the        */
/*  standing Great Snag. Read in walk order they are the trade road's   */
/*  history: a well, a crossing, a worksite, a fallen giant, a kiln     */
/*  field.                                                              */
/*                                                                      */
/*  They live HERE, not in rt-view, and that is load-bearing: this      */
/*  module is handed `scatterMaterial` (world/index.ts), which is the   */
/*  material carrying the near-lens dither, so anything built here      */
/*  inherits the guard. A prop built with a local material gets none —  */
/*  the twelve gate posts are the shipped example, safe only by being   */
/*  13 cm thick.                                                        */
/*                                                                      */
/*  Two rules every one of them is authored against:                    */
/*                                                                      */
/*  - VARY THE SILHOUETTE, NOT THE PAINT. Four objects that are all "a  */
/*    post" recolour into the same object exactly the way twelve        */
/*    stretches recolour into the same road, which is the failure this  */
/*    row exists to fix, reproduced at prop scale.                      */
/*  - BREADTH IS DECIDED HERE AND CANNOT BE FIXED LATER. The near-lens  */
/*    guard is a point-sphere test, so it clears a thin prop and        */
/*    structurally cannot clear a broad one (ART_DIRECTION §4a). Thin is */
/*    strictly cheaper in obligations. Where a thing must be broad, it  */
/*    is broad on purpose and its placement carries the cost.           */
/* ==================================================================== */

const STONE: RGB = [...WORLD.scatterRock];
/** Coping and shadowed masonry — the terrain band, one step cooler than STONE. */
const STONE_DARK: RGB = [...WORLD.rock];
const TIMBER: RGB = [...WORLD.bark];
/**
 * WORKED timber, as opposed to a tree: the village's own wall colour.
 *
 * R6, from the frames rather than from taste. The well-ring's A-frame is the
 * one part of the object that says *well* instead of *kerb stones* — story's
 * noun rule, and this file's own "the only pierced silhouette in the chapter" —
 * and at `WORLD.bark` (value 0.22) it was 1.7 m of dark brown standing against
 * a cypress stand of the same value. Two captures in a row show the ring
 * reading and the windlass simply absent. `hutWall` is value 0.65: **43 points
 * of separation against the trunks, where ART_DIRECTION asks for 25.**
 *
 * It is also the honest colour. Everything else on this road is either stone
 * or a tree; this is the one piece of village carpentry left standing outside
 * Wellmead, and it is made of what Wellmead's walls are made of.
 */
const WORKED_TIMBER: RGB = [...WORLD.hutWall];
const MOSS: RGB = [...WORLD.moss];
/** Fired clay. `hutRoof` is the only baked-earth colour in the spec and a kiln is baked earth. */
const CLAY: RGB = [...WORLD.hutRoof];

/**
 * THE WELL-RING (s5, The Old Well) — Brookhollow's last stone above the bog.
 *
 * **The windlass is the object; the ring is not.** A 3.2 m kerb at 0.45 m,
 * seen from a lens pitched 19.5° down, is a flat annulus — it sits below the
 * hero's own 1.15 m, never breaks a horizon line, and has no black shape at
 * all. story specified ~1 m overall and adopted the correction: the A-frame
 * and its cross beam are what make this read as a well from up the road, on
 * the stage fun calls the chapter's worst identity failure.
 *
 * Silhouette: two splayed legs, a crossbar, a drum, and a low broken ring —
 * the only object in the chapter with a HOLE in its silhouette, which is what
 * separates it from every stone and stump on the road.
 *
 * Thin by construction (the frame is 0.16 m timber), so the near-lens guard
 * covers it; the kerb is the broad part and it is knee-high.
 */
export function wellRingMesh(): DslMesh {
  // The kerb: a broken ring of laid stone. Two arcs with a gap, not a torus —
  // a continuous ring reads as machined, and the gap is where the bucket goes.
  const kerb: DslMesh[] = [];
  for (let i = 0; i < 11; i++) {
    const a = (i / 13) * Math.PI * 2 + 0.25;
    const r = 1.05;
    kerb.push(
      box(0.34, 0.3 + (i % 3) * 0.06, 0.5)
        .rotate(0, -a, (i % 2 ? 1 : -1) * 0.05)
        .translate(Math.cos(a) * r, 0.15, Math.sin(a) * r)
        .color(i % 4 === 1 ? STONE_DARK : STONE),
    );
  }
  // The A-frame: two splayed legs on opposite kerb stones.
  const legs = [-1, 1].map((s) =>
    tube(
      [
        [s * 0.95, 0.25, 0],
        [s * 0.34, 1.62, 0],
      ],
      [0.15, 0.1],
      5,
    ).color(WORKED_TIMBER),
  );
  // The cross beam, overhanging both legs — the horizontal that makes the
  // silhouette a frame rather than a tent. Worked timber, like the legs: the
  // frame is the noun, so the frame is what has to survive the treeline.
  const beam = box(1.5, 0.15, 0.17).translate(0, 1.66, 0).color(WORKED_TIMBER);
  // The drum, and the crank that says a hand turned it.
  const drum = tube(
    [
      [-0.45, 1.44, 0],
      [0.45, 1.44, 0],
    ],
    [0.13, 0.13],
    7,
  ).color(TIMBER);
  const crank = box(0.1, 0.34, 0.1)
    .rotate(0.5, 0, 0)
    .translate(0.55, 1.36, 0.06)
    .color(TIMBER);
  // Moss on the shaded north stones: the ring has stood in a bog for years.
  const growth = sphere(0.3, 1)
    .noise(0.1, 4, 7)
    .scaleBy(1.5, 0.35, 1.1)
    .translate(-0.85, 0.29, 0.5)
    .color(MOSS);
  return kerb[0]!.merge(...kerb.slice(1), ...legs, beam, drum, crank, growth);
}

registerMesh({ id: "prop/well-ring", group: "prop", build: wellRingMesh });

/*
 * THE PARAPET STUB GENERATOR IS GONE (R6). Cut here rather than left dormant:
 * `registerMesh` is a side-effecting top-level call, so an unplaced generator
 * is still shipped geometry — and a mesh that exists is a mesh someone places
 * again in R9 because it is there.
 *
 * The object was four stubs at a dry crossing, and it died in two rulings, both
 * of them measurements rather than taste:
 *
 *  - **fun, binding:** with both pairs in the world, BOTH SIDES were on screen
 *    together for **0.8% / 5.0% / 0.0%** of s6 (1280x800 / 800x450 / portrait)
 *    against a 50% bar. A crossing is two banks straddling the walk axis and
 *    the walking frame spans -11.4° to +59.5° about that axis, so one bank is
 *    always in the blind half. **No coordinate fixes it.**
 *  - **story, after the east pair was re-sited clear of the fight ring:** the
 *    clearance that bought the ring put the far stub **3.08 m from the Great
 *    Snag**, inside the 3.12 m limb reach the Snag was given standoff for, and
 *    at road-arc 116.0 — past s6 entirely. The Snag is the one prop in the
 *    chapter every seat agrees works.
 *
 * s6 keeps its identity in TERRAIN (row 9's bed carve, promoted) rather than in
 * an object, and it already has the Snag. **No shipped string may say bridge,
 * span or crossing** — nothing in the world supports one, so a string that says
 * it is the defect, not the placement.
 */

/**
 * BOSK'S STRIKE-STONES (s7, The Ashen Rise) — the stones FIRE is struck from.
 *
 * FIRE's canon grantsNote has always read *"struck from the ashen stones"* and
 * until now it pointed at nothing on screen. **A cluster, not a circle:** a
 * circle reads as a monument and a worksite is what this is.
 *
 * Silhouette: leaning slabs of different heights, one snapped short — angular
 * and irregular, where every other object on the road is either upright or
 * horizontal. The struck faces carry char, which is the trade made visible and
 * the second colour.
 */
export function strikeStonesMesh(): DslMesh {
  // [x, z, height, lean, yaw, chipped]
  const SLABS: readonly [number, number, number, number, number, boolean][] = [
    [0, 0, 1.95, 0.09, 0.3, false],
    [1.35, 0.55, 1.55, -0.16, 1.2, false],
    [-0.95, 1.1, 1.72, 0.13, 2.4, true],
    [0.7, -1.25, 0.62, 0.31, 0.8, true],
    [-1.5, -0.5, 1.18, -0.08, 4.0, false],
  ];
  const parts = SLABS.map(([x, z, h, lean, yaw, chipped]) => {
    // A slab, not a pillar: wide on one axis, thin on the other, so it turns
    // from a plank into an edge as you walk past it.
    const slab = box(0.78, h, 0.34)
      .taper("y", (t: number) => 1 - t * 0.22)
      .noise(0.045, 3.5, Math.round(x * 7 + z * 13 + 40))
      .rotate(lean, yaw, lean * 0.6)
      .translate(x, h * 0.5, z)
      .color(STONE);
    if (!chipped) return slab;
    // The snapped ones lose their top corner — a struck stone wears out.
    return slab.merge(
      box(0.5, 0.2, 0.3)
        .rotate(0.4, yaw, 0.3)
        .translate(x + 0.3, h - 0.05, z + 0.15)
        .color(STONE_DARK),
    );
  });
  // The strike faces: soot where the steel has come down, banked at the foot
  // of the two tallest. `charBark`, the ash country's own colour.
  const soot = [
    sphere(0.34, 1).scaleBy(1.35, 0.28, 1.2).translate(0.15, 0.05, 0.42).color(CHAR),
    sphere(0.28, 1).scaleBy(1.1, 0.25, 1.0).translate(-0.8, 0.04, 1.5).color(CHAR),
  ];
  return parts[0]!.merge(...parts.slice(1), ...soot);
}

registerMesh({ id: "prop/strike-stones", group: "prop", build: strikeStonesMesh });

/**
 * THE FALLEN GIANT (s8, The Seeping Run) — a colossal trunk down across the
 * way, the road passing under it. Declares `overhead: true`.
 *
 * NOT a rotated snag: a snag is 2.63 m tall and 0.4 m at the butt, so laid
 * down it is a log rather than a colossus. This is its own tapered trunk with
 * a root plate and a broken crown, and **both of those are structure, not
 * dressing** — a 10 m trunk floating 4.5 m above the road with nothing holding
 * it up reads as a bug report, not as an instrument.
 *
 * It spans local X. The road passes under near x = 0, where the underside sits
 * at ~4.3 m: the corridor is 4.5 m either side, so the span has to clear
 * roughly 9 m of walked width AND stay above the lens, which reaches 2.6 m
 * over the hero's ground. Clearance yields to the camera, never to the road
 * (STORY.md row 1d's yield order).
 *
 * **This is the one BROAD object in the family and it is broad on purpose** —
 * mass filling the top of the frame is the whole point, and it is the only
 * stage that uses the top of the frame at all. The near-lens guard will not
 * save it; its clearance is what keeps the lens out of it.
 *
 * Colour follows the drowned stump's lesson: a `charBark` mass this size
 * rendered against a bright sky is a hole punched in the picture, so the body
 * is bleached driftwood and the char is kept for the bore, the roots and the
 * shadowed underside.
 */
export function fallenGiantMesh(): DslMesh {
  // The trunk: butt at −5.6, snapped crown at +5.4, sagging very slightly in
  // the middle so it reads as resting rather than as a girder.
  const trunk = tube(
    [
      [-5.6, 5.05, 0.35],
      [-2.6, 4.86, 0.12],
      [0, 4.78, 0],
      [2.8, 4.9, -0.15],
      [5.4, 5.18, -0.3],
    ],
    [1.02, 0.86, 0.74, 0.62, 0.44],
    9,
  ).color(DRIFT);
  // The root plate: the giant came out of the west bank and took the bank with
  // it. This is what holds the near end up, and it is the reason the whole
  // thing is off the ground.
  // A DISC standing on edge, facing back down the road — the torn root ball a
  // windthrown giant pulls up with it, which is the single most recognisable
  // thing about a fallen tree. A first cut laid it along the trunk axis, where
  // it read edge-on as a blunt end and the whole object became a spiked log.
  // `rotate(0, 0, 1.45)` lays the lathe's own axis along −X so its face is
  // broadside to the walk.
  const plate = lathe(
    [
      [0, 0],
      [1.6, 0.18],
      [2.5, 0.5],
      [2.7, 0.95],
      [2.3, 1.25],
      [0, 1.35],
    ],
    9,
  )
    .noise(0.14, 1.8, 31)
    .rotate(0, 0, 1.45)
    .translate(-5.9, 3.4, 0.35)
    .color(CHAR);
  // Torn roots, off the plate's RIM and back into the bank it came out of.
  // Anchored on the rim rather than near the axis: the first version started
  // them close to the trunk and they hung in the air like dropped sticks.
  const roots = [0, 1, 2, 3, 4].map((i) => {
    const a = (i / 5) * Math.PI * 2 + 0.35;
    const ry = 3.4 + Math.sin(a) * 2.35;
    const rz = 0.35 + Math.cos(a) * 2.35;
    return tube(
      [
        [-5.75, ry * 0.55 + 1.55, rz * 0.6],
        [-6.15, ry, rz],
        [-6.55, Math.max(0.4, ry - 1.1), rz * 1.5],
      ],
      [0.3, 0.19, 0.07],
      5,
    ).color(CHAR);
  });
  // The crown end, resting on the east verge: the far support, and the reason
  // the trunk is a bridge rather than a cantilever.
  const rest = tube(
    [
      [5.3, 5.15, -0.3],
      [6.5, 4.1, -0.5],
      [7.4, 2.4, -0.75],
    ],
    [0.44, 0.36, 0.5],
    7,
  ).color(DRIFT);
  // Snapped limb stumps — the saw-tooth that stops an 11 m cylinder reading as
  // a pipe. SHORT and swept, not vertical: a first cut aimed them straight up
  // and the giant read as a caterpillar. Each is a thick stump that stops
  // where it broke, which is what a dead limb looks like.
  const stubs = [
    [-3.9, 0.5, 1.15, 0.55],
    [-1.4, -0.6, 0.35, -1.35],
    [1.7, 0.45, 0.9, 1.2],
    [3.9, -0.35, 0.5, -0.95],
  ].map(([x, dy, dxo, dz], i) =>
    tube(
      [
        [x!, 5.15, (i % 2 ? 0.35 : -0.35)],
        [x! + dxo! * 0.6, 5.3 + dy! * 0.6, (i % 2 ? 0.35 : -0.35) + dz! * 0.55],
        [x! + dxo!, 5.3 + dy!, (i % 2 ? 0.35 : -0.35) + dz!],
      ],
      [0.3, 0.19, 0.07],
      5,
    ).color(DRIFT),
  );
  // The shadowed underside, in char: the face the player walks beneath, and
  // the one that must not read as a bright ceiling.
  const under = tube(
    [
      [-4.4, 4.2, 0.2],
      [0, 3.98, 0],
      [4.2, 4.2, -0.2],
    ],
    [0.42, 0.36, 0.3],
    6,
  ).color(CHAR);
  return trunk.merge(plate, ...roots, rest, ...stubs, under);
}

registerMesh({ id: "prop/fallen-giant", group: "prop", build: fallenGiantMesh });

/**
 * THE COLLAPSED KILN DOMES (s9, The Char Hollow) — Bosk's kiln field, broken.
 *
 * Its OWN squashed sphere with a stoke hole, **not** the brazier chalice: a
 * chalice at this scale reads as a giant cup. There is no CSG in the DSL, so
 * the stoke mouth is a lathe profile that turns inward at the opening — the
 * drowned stump's hollow-bore trick — and the collapse is shard tubes off the
 * rim.
 *
 * Silhouette: a broken dome, which is a curve with a bite out of it, and one
 * flue stub standing clear of the group — a vertical against four horizontals,
 * so the field reads as a field rather than as three rocks.
 *
 * Fired clay against cinder ground: the kilns separate from s9's floor by HUE
 * as well as value, which the ash country badly needs.
 */
export function kilnDomesMesh(): DslMesh {
  // [x, z, radius, height, broken 0..1, flue]
  const DOMES: readonly [number, number, number, number, number, boolean][] = [
    [0, 0, 1.5, 1.95, 0.35, true],
    [3.1, 1.4, 1.3, 1.5, 0.8, false],
    [-2.4, 1.9, 1.4, 1.1, 1.0, false],
    [1.2, -2.6, 1.2, 1.62, 0.55, false],
  ];
  const parts: DslMesh[] = [];
  for (const [x, z, r, h, broken, flue] of DOMES) {
    const top = h * (1 - broken * 0.62);
    // A beehive: wide foot, shoulder, and a mouth that turns INWARD so the
    // interior is visibly hollow from the diorama's angle.
    const dome = lathe(
      [
        [r, 0],
        [r * 0.98, h * 0.28],
        [r * 0.8, h * 0.62],
        [r * 0.52, top],
        [r * 0.4, top - 0.12], // rim, turning in
        [r * 0.34, h * 0.45], // inner wall
        [0, h * 0.32], // dark floor
      ],
      8,
    )
      .noise(0.05, 2.6, Math.round(x * 11 + z * 5 + 3))
      .translate(x, 0, z)
      .color(CLAY);
    parts.push(dome);
    // The stoke mouth: a recessed arch at the foot, in soot. Small, dark, and
    // the one detail that says kiln rather than hut.
    parts.push(
      box(0.52, 0.62, 0.5)
        .rotate(0, -Math.atan2(z, x) + Math.PI / 2, 0)
        .translate(x + r * 0.72, 0.29, z + r * 0.2)
        .color(CHAR),
    );
    // The collapse: shards off the broken rim, leaning out.
    const n = Math.round(2 + broken * 3);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + x;
      parts.push(
        box(0.42, 0.16, 0.36)
          .rotate(0.25 + i * 0.2, a, 0.35)
          .translate(x + Math.cos(a) * (r + 0.35), 0.1 + (i % 2) * 0.08, z + Math.sin(a) * (r + 0.35))
          .color(i % 2 ? CLAY : CHAR),
      );
    }
    // The one surviving flue: a sooted stub standing well clear of the domes.
    if (flue) {
      parts.push(
        lathe(
          [
            [0.4, 0],
            [0.3, 0.7],
            [0.28, 1.55],
            [0.31, 1.7],
            [0.21, 1.72],
            [0.19, 1.0],
            [0, 0.9],
          ],
          7,
        )
          .translate(x - r * 0.15, top - 0.1, z - r * 0.2)
          .color(CHAR),
      );
    }
  }
  return parts[0]!.merge(...parts.slice(1));
}

registerMesh({ id: "prop/kiln-domes", group: "prop", build: kilnDomesMesh });

/**
 * THE GREAT SNAG, STANDING (the fen's pull, read at ~30.8 m).
 *
 * Cut when the frame had a ceiling, restored by the landed camera: ~5 m at
 * 30.8 m is dead centre of the 20–40 m authoring band and inside Low tier's
 * fog. It does not displace the strike-stones — the Snag is the thing you walk
 * AT from two stages away, the stones are the thing you stand AMONG when you
 * arrive.
 *
 * Cheaper than the arch, not equal to it: this is `snagMesh`'s vocabulary with
 * fatter numbers plus the drowned stump's broken crown.
 *
 * **Value is chosen against the FOG, not against the near-field palette.** At
 * 30.8 m on Low tier this sits at ~34% fog, so a `charBark` mass would go to a
 * soft grey smudge. Bleached driftwood body, char kept for the bore and the
 * root flare — the drowned stump's lesson run backwards (that one had to be
 * bleached because char against a BRIGHT lake read as a hole; this one is
 * bleached because char inside fog reads as nothing at all).
 *
 * story's bearing ruling: sited against the fen's GROUND, not against sky.
 */
export function greatSnagMesh(): DslMesh {
  const trunk = tube(
    [
      [0, 0, 0],
      [0.11, 1.5, -0.07],
      [0.05, 3.0, 0.09],
      [-0.06, 4.35, 0.14],
    ],
    [0.85, 0.6, 0.42, 0.3],
    8,
  ).color(DRIFT);
  // The buttressed foot: what makes a 5 m trunk look planted instead of
  // pushed into the ground, and the widest part of the silhouette.
  const flare = lathe(
    [
      [1.5, 0],
      [1.05, 0.5],
      [0.86, 1.1],
    ],
    8,
  )
    .noise(0.07, 2.2, 19)
    .color(CHAR);
  // The crown: snapped open, three shards of the old wall at different
  // heights. The saw-tooth is the read at 30 m — a smooth-topped trunk at that
  // distance is a fence post.
  const shards = [0, 1, 2].map((i) => {
    const a = (i / 3) * Math.PI * 2 + 0.7;
    const h = [0.95, 0.42, 0.68][i]!;
    return tube(
      [
        [Math.cos(a) * 0.24, 4.2, Math.sin(a) * 0.24],
        [Math.cos(a) * 0.3, 4.45 + h, Math.sin(a) * 0.3],
      ],
      [0.24, 0.07],
      5,
    ).color(DRIFT);
  });
  // Three heavy dead limbs, asymmetric, so the object has a facing and does not
  // read the same from every approach.
  //
  // **They are LONG on purpose and that is the whole identity of the object.**
  // A first cut kept them as short stumps and the black shape came back reading
  // as a rock spire or a ruined tower — correct mass, wrong noun, on a landmark
  // whose entire job is to be a charred giant seen from two stages away. The
  // limbs are what separate a snag from a menhir at 30 m, where the trunk is
  // four pixels wide and the branches are the only thing with a direction.
  const arms = [
    tube(
      [
        [0.05, 2.55, 0],
        [1.25, 3.3, 0.35],
        [2.35, 3.55, 0.7],
        [2.95, 3.1, 0.95],
      ],
      [0.28, 0.17, 0.09, 0.04],
      6,
    ).color(DRIFT),
    tube(
      [
        [0, 1.75, 0],
        [-1.15, 2.25, -0.4],
        [-2.1, 2.05, -0.75],
      ],
      [0.24, 0.13, 0.05],
      6,
    ).color(DRIFT),
    tube(
      [
        [-0.02, 3.35, 0.05],
        [-0.75, 3.95, 0.85],
        [-1.15, 4.45, 1.5],
      ],
      [0.2, 0.11, 0.04],
      5,
    ).color(DRIFT),
  ];
  // The bore: the dark heart of a hollow dead giant, visible where the crown
  // broke open. Char, and it is the only dark value in the object.
  const bore = lathe(
    [
      [0.3, 0],
      [0.26, 0.5],
      [0, 0.62],
    ],
    7,
  )
    .translate(-0.06, 4.05, 0.14)
    .color(CHAR);
  return trunk.merge(flare, ...shards, ...arms, bore);
}

registerMesh({ id: "prop/great-snag", group: "prop", build: greatSnagMesh });

/**
 * THE ROADSIDE FAMILY'S PLACEMENTS (R5) — story's coordinates, solved against
 * the real route polyline and every stage's arena rings, and verified by
 * `scripts/check-prop-clearance.mjs`.
 *
 * Ground height is SAMPLED, never transcribed: story's table quotes a `y` per
 * object, and a copied height goes stale the moment the terrain pass moves a
 * metre of ground. `lift` is an authored offset from the sampled terrain, which
 * is the only number here that is a decision rather than a measurement.
 *
 * `yaw` is presentation. None of these collide, so rotation costs nothing and
 * buys the difference between a prop facing the road and a prop facing away.
 */
interface PropPlacement {
  id: string;
  build: () => DslMesh;
  at: [number, number];
  yaw: number;
  /** The stage whose arena rings this prop must clear — where it STANDS. */
  stage: string;
  /** Metres above sampled terrain. */
  lift?: number;
  /** Tilt, radians — a leaning object needs its lean authored, not noised. */
  tilt?: [number, number];
  /**
   * The road passes UNDER it, so the lateral clearance rule does not apply and
   * must not be made to pass by accident. Its real constraint is vertical and
   * it is a frame measurement, not a geometry one (STORY.md row 1d).
   */
  overhead?: true;
}

/**
 * Where each one stands. story's solved coordinates, 6/6 through
 * `check-prop-clearance.mjs` against the route polyline and every arena ring.
 *
 * Two of the six needed re-solving AFTER passing the geometry, which is the
 * useful part to know: the kilns' first legal answer sat past s9's own gate,
 * inside damp_pyres' stretch — legal, and in the wrong stage — and the Snag's
 * first answer stood 6.2 m off the road, legal but with no room for the limbs
 * that are its entire identity at distance. **Clearance is necessary and not
 * sufficient; the stage a thing belongs to is an authoring fact.**
 */
const PROPS: readonly PropPlacement[] = [
  // s5, The Old Well — Brookhollow's last stone. Turned so the windlass frame
  // is broadside to the walk: seen end-on, the frame's pierced silhouette
  // collapses to a post and the whole point of the object is lost.
  //
  // RE-SITED (story, R5) from (5, 44.5), which was measured in frame for only
  // 14 of 70 ticks of the approach and whose best frame was at MAXIMUM distance
  // — seen from far off and gone by the time you reached it, which is the
  // definition of the pass-by this stage was supposed to stop being. The move
  // was unlocked by the breadth correction: once the well-ring measures 0.75 m
  // per component it is thin, so no corridor or arena rule binds it and the
  // siting could solve for the FRAME alone instead of for clearance.
  //
  // RE-SITED AGAIN (R6, story's ruling on fun's live frame): (11.5, 55.5) was
  // ruled in by fun on presence — sx 358, sy 232, 4.8 m from the hero — and the
  // number below is that siting pushed 0.72 m further out. At story's own
  // coordinate the ring's surface sits 3.83 m from the road centreline, INSIDE
  // the 4.5 m corridor: the hero walks through the stonework. `check-prop-
  // clearance.mjs` passes it because thin+deco carries no clearance rule at
  // all, which is the gap, not the licence. 5.95 m of lateral offset puts the
  // surface at 4.55 m and costs 3 points of in-frame time (71% -> 68% over the
  // walk in to the s5 fight, best frame dead centre at 14.4 m).
  //
  // yaw is DERIVED, not chosen: the A-frame's beam runs local X, so it reads as
  // a frame only when the beam is perpendicular to the view direction, which is
  // `roadHeading + VIEW_YAW` = -0.785 + 0.42. Seen end-on it collapses to a
  // post and the object is a pile of kerb stones. The old 0.9 was correct for
  // the old siting's bearing and would be wrong here.
  // ...and then MOVED AGAIN, 3.0 m, by the frame rather than by the geometry.
  // The first R6 capture at (12.05, 55.97) shows the kerb reading cleanly at
  // 6.3 m and NO WINDLASS AT ALL: a cypress at (12.75, 57.11), scale 1.46,
  // stands **0.73 m from the ring's edge**, and the A-frame — which is the only
  // thing that says "well" rather than "kerb stones" — is inside it. Neither
  // the clearance gate nor the wedge could see that: one measures the road, the
  // other measures the frustum, and NEITHER ASKS WHETHER ANYTHING IS IN THE WAY.
  //
  // (10.25, 58.25) is the best trunk clearance within 3.2 m of the ruled point
  // — 2.13 m to the nearest trunk against 0.73, road 6.01 (surface 4.61) — and
  // it improves the approach as well: 88%/92% in frame over the walk to the s5
  // fight against 68%/72%, run 12.3 m. It is still a cypress stand: 42% of
  // approach samples have a trunk within 1 m of the lens->prop line, against
  // 26% at the old bog site. **fun's presence ruling was made on the frame at
  // the ruled point and this is 3 m from it, so it is fun's to re-rule.**
  { id: "well-ring", build: wellRingMesh, at: [10.25, 58.25], yaw: -0.37, stage: "s5" },
  //
  // **s6 HAS NO PROP AT ALL, and that is a decision with two measurements under
  // it** (the generator is gone too — see the note where it used to be). fun cut
  // the crossing on the both-sides-at-once number; story then cut the surviving
  // east pair, because the clearance that got it out of the fight ring put the
  // far stub **3.08 m from the Great Snag** — inside the 3.12 m of limb reach
  // the Snag was given its standoff for — and at road-arc 116.0, past s6.
  //
  // Both cuts are the same lesson in different clothes and it is the one to
  // carry forward: **a prop has THREE siting numbers, and R5 had a checker for
  // one.** Lateral clearance is measured (`check-prop-clearance.mjs`),
  // longitudinal position is measured (`frame-wedge.mjs`), and *is anything
  // already there* was measured by nobody — first a cypress standing in the
  // well's windlass at 0.73 m, then a masonry slab standing in the Snag's limbs
  // at 3.08 m. **The third number is the one that cost this cycle two objects.**
  //
  // s6's identity is terrain (row 9's bed carve) plus the Snag it already had.
  // BOSK'S STRIKE-STONES — re-sited (story's R6 ruling) from (-16.5, 75.5) to
  // stand at the FIRE take: `s7.grantsNote` says fire is *struck from the ashen
  // stones*, so the gem stands among them and FIRE becomes the one find in the
  // chapter taken at a made place.
  //
  // TWO clusters, not one, and the road passes between them. **"Around" is not
  // buildable and the reason is the road's own width**: the gem stands ON the
  // road, the corridor is 9 m wide, and a cluster whose slabs all clear it sits
  // 6.5 m out. A ring of stones a hero walks through is the same lie as a
  // parapet he walks through, one object along.
  //
  // The siting was SEARCHED, not chosen, over every point 5-14 m from the gem
  // clearing the WHOLE placed polyline by 6.48 m — and the search is why these
  // are not the neat pair either story or I first drew. The road doglegs here:
  // the tidy mirror at (-9.25, 79.67) measures 6.5 m from the road AT THE GEM'S
  // ARC and **2.05 m from the leg the hero has just walked down**, so it would
  // have been walked through on the way in. A local lateral offset cannot see a
  // road that doubles back; `check-prop-clearance.mjs` measures to the whole
  // polyline and caught it.
  //
  // They divide the two moments between them, which one cluster could not do:
  // the WEST cluster carries the WALK IN (80% of the last 16 m, best frame dead
  // centre at ~12 m) and is off-frame once you stop at the gem; the EAST cluster
  // is the one still IN FRAME while you press F (ndc x -0.26 at 15 m).
  // Not one search result was both — at a standstill the frame reaches 3.4 m
  // west and 6.4 m east of the hero, and nothing corridor-legal fits in that.
  //
  // `stage` is s8 because that is where they STAND — the FIRE gem is placed
  // 3.5 m past s7's gate and sits at road-arc 133, inside s8's span. The FICTION
  // is s7's. Declaring the stage they stand in is what the field means and what
  // keeps the arena rings honest; clearance-legal and stage-correct are
  // independent properties and only one of them has a checker.
  { id: "strike-stones-w", build: strikeStonesMesh, at: [-18.75, 89.0], yaw: 1.5, stage: "s8" },
  { id: "strike-stones-e", build: strikeStonesMesh, at: [-5.0, 83.0], yaw: 0.4, stage: "s8" },
  // s9, the kiln field — inside s9's own z-band, not past its gate.
  { id: "kiln-domes", build: kilnDomesMesh, at: [-11.0, 97.0], yaw: 0.4, stage: "s9" },
  // The fen's pull, at 26.2 m from the s5 fight and 11.14 m of road standoff —
  // the standoff exists so the limbs have ground to read against.
  { id: "great-snag", build: greatSnagMesh, at: [0.0, 79.5], yaw: 1.35, stage: "s7" },
  // s8, the fallen giant. Its trunk spans local X, so `yaw` is the road's own
  // heading between the s8 marker (-9.5, 87.8) and its gate (-7, 91) — the
  // trunk lies ACROSS the walk and the road passes under it. `lift` is the
  // clearance decision: the mesh already carries its underside at ~4 m, and
  // the lens reaches 2.6 m above the hero's ground, so the gap is the margin.
  // Yield order (STORY.md row 1d): clearance yields to the camera, never to
  // the road — if this ever occludes the walking frame, it rises.
  { id: "fallen-giant", build: fallenGiantMesh, at: [-8.2, 89.4], yaw: 0.66, lift: 0.35, tilt: [0, 0.04], stage: "s8", overhead: true },
];

/**
 * The placements as plain data, for `scripts/check-prop-clearance.mjs`.
 *
 * A FUNCTION, not a const: it builds every mesh to measure its radius, and the
 * shipped game has no reason to pay for that.
 *
 * The check took its prop list as a JSON argument, which meant it was
 * validating a list somebody typed rather than the list that ships — a green
 * run proving that a transcription clears the corridor, while the coordinates
 * actually rendered went unchecked. Exporting them closes the gap: the gate now
 * reads the same array the renderer builds from, so the two cannot disagree.
 *
 * This is the derive-an-IDENTITY case, not the derive-a-THRESHOLD one: the
 * clearance bounds stay imported from `sim/constants`, and only the question
 * "where do the props actually stand" is answered from the source of truth.
 */
export function propPlacements(): {
  id: string;
  label: string;
  stage: string;
  x: number;
  z: number;
  r: number;
  componentR: number;
  broad: boolean;
  blocks: boolean;
  path: string;
  /**
   * The MESH this placement builds, kebab-cased from the generator's own name
   * — `parapetStubMesh` -> `parapet-stub`. Derived from source rather than
   * typed beside it (METHOD law 1: an identity may be derived, a threshold may
   * not), because the consumer that needs it is a coverage check:
   * `prop-volume.mjs` reds when a declared prop has no radius profile, and it
   * was silently reporting "not placed" for the parapet stubs the whole of R5
   * because it matched on the placement's `id` and no id ever equalled a mesh
   * name.
   */
  mesh: string;
  /** Presentation yaw, radians — the sleeve rule needs it for a sector test. */
  yaw: number;
  /** Authored lift above the sampled terrain, metres. */
  lift: number;
  overhead: boolean;
}[] {
  return PROPS.map((p) => {
    const mesh = p.build();
    // The FOOTPRINT radius, measured off the mesh the renderer builds. A typed
    // radius is the defect the prop-height table already caught one level down,
    // and the first run of the clearance check defaulted every prop to r = 0.5
    // — so a 10 m kiln field and a 5.4 m well-ring were both cleared as points.
    let r = 0;
    for (const [vx, , vz] of mesh.positions) r = Math.max(r, Math.hypot(vx, vz));

    // BREADTH IS PER CONNECTED COMPONENT, NOT PER GROUP — and getting this
    // wrong the first time nearly moved a prop that was fine. The near-lens
    // guard is a point-sphere test against fragments, so what defeats it is one
    // CONTINUOUS surface wider than the bubble. A cluster of five thin slabs
    // spread over four metres has a big bounding radius and no broad surface
    // anywhere: the guard clears each slab exactly as it clears a trunk. Judged
    // by bounding radius, the strike-stones read as a solid mass and reported a
    // breach that does not exist.
    //
    // `merge()` appends geometry without sharing vertices, so a union-find over
    // faces recovers the authored pieces exactly.
    const parent = mesh.positions.map((_, i) => i);
    const find = (i: number): number => {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]!]!;
        i = parent[i]!;
      }
      return i;
    };
    for (const f of mesh.faces) {
      for (let k = 1; k < f.length; k++) {
        const a = find(f[0]!);
        const b = find(f[k]!);
        if (a !== b) parent[b] = a;
      }
    }
    const groups = new Map<number, number[]>();
    for (let i = 0; i < mesh.positions.length; i++) {
      const root = find(i);
      const g = groups.get(root);
      if (g) g.push(i);
      else groups.set(root, [i]);
    }
    let widest = 0;
    for (const idx of groups.values()) {
      let cx = 0;
      let cz = 0;
      for (const i of idx) {
        cx += mesh.positions[i]![0];
        cz += mesh.positions[i]![2];
      }
      cx /= idx.length;
      cz /= idx.length;
      let cr = 0;
      for (const i of idx) {
        cr = Math.max(cr, Math.hypot(mesh.positions[i]![0] - cx, mesh.positions[i]![2] - cz));
      }
      widest = Math.max(widest, cr);
    }

    return {
      id: p.id,
      label: p.id,
      stage: p.stage,
      x: p.at[0],
      z: p.at[1],
      r: +r.toFixed(2),
      /** The widest single continuous surface — what the guard actually faces. */
      componentR: +widest.toFixed(2),
      // The near-lens guard's own threshold: one surface wider than the 1.6 m
      // bubble's diameter cannot be contained by it at any lens position.
      broad: widest * 2 > 3.2,
      blocks: false,
      path: "landmarks",
      overhead: p.overhead === true,
      mesh: p.build.name
        .replace(/Mesh$/, "")
        .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
        .toLowerCase(),
      yaw: p.yaw,
      lift: p.lift ?? 0,
    };
  });
}

/**
 * One terrain-conforming char stain: an 8-gon fan whose ring vertices sample
 * the heightfield — flat ground truth, no collision to lie about, no
 * floating edge on a slope.
 */
function stainInto(
  pos: number[],
  col: number[],
  idx: number[],
  field: Heightfield,
  x: number,
  z: number,
  r: number,
  rot: number,
): void {
  const base = pos.length / 3;
  const [cr, cg, cb] = CHAR;
  // The scorch is charBark VERBATIM — the same char the snags and bowls
  // wear, and comfortably darker than any ground band. A first cut at
  // ×0.55 of it rendered as a dead-black hole (the no-black rule, on the
  // ground). The colour attribute feeds the LINEAR pipeline directly
  // (this geometry bypasses the DSL's own conversion), so convert here,
  // exactly as terrain.ts does.
  const c: RGB = [srgbToLinear(cr), srgbToLinear(cg), srgbToLinear(cb)];
  // Hover over the terrain facets: the mesh triangulates its grid quads, so
  // the drawn surface deviates from the bilinear heightAt the ring samples
  // — polygon offset (below) bridges the near-coplanar cases, the hover the
  // rest.
  const LIFT = 0.12;
  pos.push(x, field.heightAt(x, z) + LIFT, z);
  col.push(...c);
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rot;
    // Slightly irregular ring — a burn scar, not a coaster.
    const rr = r * (0.82 + 0.28 * Math.abs(Math.sin(a * 2.7 + rot)));
    const px = x + Math.cos(a) * rr;
    const pz = z + Math.sin(a) * rr;
    pos.push(px, field.heightAt(px, pz) + LIFT, pz);
    col.push(...c);
  }
  for (let i = 0; i < n; i++) {
    // Ring order REVERSED per triangle: a horizontal fan laid out with the
    // angle increasing in the XZ plane winds clockwise as seen from +Y, so
    // its front faces point DOWN and backface culling hides the whole
    // stain from every camera above it — an invisible mesh that cost a
    // four-measurement hunt (colour space, lift height and polygon offset
    // were all "fixed" before the winding was even looked at).
    idx.push(base, base + 1 + ((i + 1) % n), base + 1 + i);
  }
}

/**
 * Build the landmark objects for the campaign world. `[]` when the world has
 * no road (the sandbox) — landmark coordinates only mean anything against
 * the authored scenario.
 */
export function buildLandmarks(
  field: Heightfield,
  obstacles: Obstacles,
  waterLevel: number,
  hasRoad: boolean,
  material: Material,
): Object3D[] {
  if (!hasRoad) return [];
  const out: Object3D[] = [];

  /* ---- the roadside family (R5, story's solved coordinates) ---- */
  for (const p of PROPS) {
    const [px, pz] = p.at;
    const mesh = new Mesh(p.build().toGeometry({ flat: true }), material);
    mesh.position.set(px, field.heightAt(px, pz) + (p.lift ?? 0), pz);
    mesh.rotation.set(p.tilt?.[0] ?? 0, p.yaw, p.tilt?.[1] ?? 0);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // Tagged so a capture rig can ask about ONE prop rather than guessing from
    // bounding spheres — "is this object in frame" is the question, and it
    // needs to name the object.
    mesh.userData.propId = p.id;
    out.push(mesh);
  }

  /* ---- the drowned stump ---- */
  const [sx, sz] = STUMP_AT;
  let sy = field.heightAt(sx, sz);
  // The heightfield's edge returns its resting value; a landmark authored in
  // water must never ride that up above the surface.
  if (sy > waterLevel - 0.5) sy = waterLevel - 1.8;
  const stump = new Mesh(stumpMesh().toGeometry({ flat: true }), material);
  stump.position.set(sx, sy, sz);
  stump.rotation.set(0.09, 0.6, -0.05); // a dead lean; the fallen trunk runs NE, AWAY from the fight
  // No cast shadow: standing in open water, its shadow could only fall on
  // the water plane, where it rendered as a murky blob.
  stump.castShadow = false;
  stump.receiveShadow = true;
  out.push(stump);

  /* ---- the dead fire-ring stains ---- */
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  for (const o of obstacles.list) {
    if (o.kind === "brazier") stainInto(pos, col, idx, field, o.x, o.z, 0.85, o.rotY);
  }
  for (const [i, [x, z]] of DEAD_STAINS.entries()) {
    // Larger than any live bowl's: the pyres that stood here were bigger.
    stainInto(pos, col, idx, field, x, z, 1.2, i * 2.1 + 0.7);
  }
  if (idx.length > 0) {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute("color", new BufferAttribute(new Float32Array(col), 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    // A DECAL material, not the shared scatter one: the terrain mesh
    // triangulates its grid quads, so the drawn surface deviates from the
    // bilinear heightAt the stain ring samples — a small lift sinks into
    // facets and the stains vanish (measured: stain pixel == ground pixel).
    // Polygon offset pulls the stain's depth in front of coplanar-ish
    // terrain without lifting the geometry into a floating disc.
    const stainMat = new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      depthWrite: false,
    });
    const stains = new Mesh(g, stainMat);
    stains.renderOrder = 1;
    stains.receiveShadow = true;
    out.push(stains);
  }

  return out;
}
