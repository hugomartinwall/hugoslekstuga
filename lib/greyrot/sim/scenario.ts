/**
 * Scenario setup: what the world contains when play begins.
 *
 * M1 scope: the road north from spawn, three visible encounters along it, the
 * village, and Sella waiting to be freed between the first fight and the pool.
 *
 * Placement never trusts magic coordinates. Ground is validated against the
 * same walkability rules the movement controller enforces, arenas additionally
 * demand flatness and an unobstructed camera sight line, and everything is
 * deterministic — so every player meets the same fights in the same places.
 *
 * Where the procedural world will not cooperate, the scenario AUTHORS what it
 * needs: it grades a road and it fells trees for a glade. That is level design,
 * not a workaround, and it is only possible because the camera angle is fixed.
 */

import { BIOMES, STAGES, captiveHoldStage, foundHas, stageBiome } from "../content";
import type { BiomeId } from "../content/types";
import { DEFAULT_ARENA, type StageDef } from "../content/stages";
import { mulberry32 } from "./math/noise";
import { STAGE_VIEW_DISTANCE, VIEW_DISTANCE, VIEW_LEAD, viewDirection } from "./staging";
import { ROAD_HALF_WIDTH, WADE_DEPTH } from "./constants";
import type { RtState } from "./rt/state";
import { addBystander, applyGrant } from "./rt/step";
import { biomeAt, createSimWorld, type SimWorld } from "./world";
import { Heightfield, type FlatSpot } from "./world/heightfield";
import { createRtState } from "./rt/state";

/** Sella, by name. The road routes via whoever this is, not via index 0. */
export const SELLA_NAME = "Sella";

/** True if a unit can stand here: dry-enough, gentle, clear of blockers. */
export function standable(world: SimWorld, x: number, z: number, clearance = 0.9): boolean {
  const h = world.field.heightAt(x, z);
  if (h < world.waterLevel - WADE_DEPTH * 0.5) return false; // at most ankle-deep
  if (world.field.slopeAt(x, z) > 0.18) return false;
  for (const o of world.obstacles.near(x, z)) {
    const dx = x - o.x;
    const dz = z - o.z;
    const min = o.radius + clearance;
    if (dx * dx + dz * dz < min * min) return false;
  }
  return true;
}

/**
 * Find a standable spot near (x, z), spiralling outward deterministically.
 * Throws if none exists within `maxRadius` — a scenario that cannot place its
 * actors is a content bug, and it should fail loudly in tests, not shuffle
 * enemies quietly into a lake.
 */
export function findStandableNear(
  world: SimWorld,
  x: number,
  z: number,
  maxRadius = 8,
): { x: number; z: number } {
  if (standable(world, x, z)) return { x, z };
  // Square-ring spiral at 0.75 m resolution. Deterministic scan order.
  for (let r = 0.75; r <= maxRadius; r += 0.75) {
    for (let i = -r; i <= r; i += 0.75) {
      const candidates: [number, number][] = [
        [x + i, z - r],
        [x + i, z + r],
        [x - r, z + i],
        [x + r, z + i],
      ];
      for (const [cx, cz] of candidates) {
        if (standable(world, cx, cz)) return { x: cx, z: cz };
      }
    }
  }
  throw new Error(`no standable ground within ${maxRadius}m of (${x}, ${z})`);
}


/**
 * Flatness sample radius. A terrain question — how much level ground is there
 * — and unchanged by the pivot.
 */
const ARENA_CLEAR = 5;

/**
 * Felling radius. Larger than the flatness radius, deliberately.
 *
 * In real time the fight MOVES: a charger closes, a spitter holds its band at
 * 7.5 m, the hero backpedals. A turn-based arena stayed pinned on its marker
 * and could be carved exactly as wide as the formation. These are separate
 * numbers rather than one raised number because sampling `slopeAt` at 6.5 m on
 * a 7 m road clearing sits right at the lip and would send `findArenaNear`
 * hunting for ground it already has.
 */
const ARENA_CARVE = 6.5;

/** Camera-corridor half-width. Was 2.2, for a camera that stood on one spot. */
const CORRIDOR_R = 3.0;

/**
 * Find FLAT standable ground for an arena, then CARVE the glade it needs.
 *
 * Two problems had to be solved together here, and only one of them can be
 * solved by searching:
 *
 * 1. **Flatness.** `standable` checks the one point you ask about, which is
 *    right for placing an actor and wrong for staging a fight — a spot at the
 *    foot of a bank is perfectly standable, and with a fixed 3/4 camera that
 *    bank is a wall the camera ends up buried in. So flatness is sampled
 *    across the whole arena. This part is searchable.
 * 2. **Obstacles.** A fight needs floor space AND an unobstructed sight line
 *    back to where the camera will stand. Searching a dense procedural forest
 *    for a spot satisfying both has, empirically, no solutions within a sane
 *    radius — the first attempt failed outright. So the glade is *authored*:
 *    trees inside the arena and inside the camera corridor are felled.
 *
 * Carving is not a cheat. It is what a level designer does with exactly this
 * problem, and it is possible at all only because the camera angle is fixed
 * (`sim/staging.ts`) — a free camera could never know in advance which
 * trees to remove.
 */
export function findArenaNear(
  world: SimWorld,
  x: number,
  z: number,
  clear = ARENA_CLEAR,
  // Deliberately short. The road is graded and widened at each fight, so the
  // authored spot should qualify immediately; a long search means something is
  // wrong with the road, and wandering 10 m off it to find flat ground puts
  // the fight somewhere the player never walks. Fail loudly instead.
  maxRadius = 5,
): { x: number; z: number } {
  const isFlat = (cx: number, cz: number): boolean => {
    if (!standable(world, cx, cz)) return false;
    const h0 = world.field.heightAt(cx, cz);
    for (let a = 0; a < 8; a++) {
      const t = (a / 8) * Math.PI * 2;
      const sx = cx + Math.cos(t) * clear;
      const sz = cz + Math.sin(t) * clear;
      if (world.field.slopeAt(sx, sz) > 0.24) return false;
      if (Math.abs(world.field.heightAt(sx, sz) - h0) > 1.8) return false;
    }
    return true;
  };

  // THE AUTHORED POINT IS A REQUEST, AND IT HAS TO BE HONOURED PREDICTABLY
  // (R5). This was a 1 m INTEGER ring scan that took the first flat hit in
  // scan order, so a placed fight was the authored point plus an integer
  // offset chosen by iteration order rather than by distance. Measured over a
  // 3 m sweep in 25 cm steps: one nudge moved the fight up to 3.01 m — twice
  // NORTH when authored south — and authoring 2.0 m south returned the SAME
  // point as authoring nothing. Twelve stages of re-theater against that is
  // authoring by guesswork, and it exhausts whoever builds it.
  //
  // Quarter-metre lattice, NEAREST wins. The trade, stated plainly: sub-metre
  // nudges below the terrain's own flat-spot granularity now move the fight
  // NOT AT ALL, where before they moved it somewhere surprising. "Nothing
  // happened" is something an author can reason about; "it jumped 3 m east"
  // is not. Measured after: zero wrong-way steps, worst surprise 1.60 m.
  let spot: { x: number; z: number } | null = isFlat(x, z) ? { x, z } : null;
  const STEP = 0.25;
  if (!spot) {
    let bestD = Infinity;
    const steps = Math.round(maxRadius / STEP);
    for (let iz = -steps; iz <= steps; iz++) {
      for (let ix = -steps; ix <= steps; ix++) {
        // Squared distance in metres; ties keep the earlier candidate, which
        // is scan order and therefore deterministic.
        const d = (ix * ix + iz * iz) * STEP * STEP;
        if (d > maxRadius * maxRadius || d >= bestD) continue;
        const cx = x + ix * STEP;
        const cz = z + iz * STEP;
        if (isFlat(cx, cz)) {
          bestD = d;
          spot = { x: cx, z: cz };
        }
      }
    }
  }
  if (!spot) throw new Error(`no flat arena within ${maxRadius}m of (${x}, ${z})`);

  carveArena(world, spot.x, spot.z, ARENA_CARVE);
  return spot;
}

/**
 * Carve the road: spawn → first fight → Sella → the pool → the last fight.
 *
 * §9's opening is "already running down a road", and until now there was no
 * road — the hero auto-ran straight into a procedural forest and ground along
 * tree trunks, which turned a 4-second run-in into a 25-second one. Naive
 * straight-line steering is correct for this game (no pathfinding, by design);
 * what it needs is somewhere to go.
 *
 * The corridor is cleared of blockers, which reads as a path through the
 * trees on its own. Call AFTER encounters and the village are placed, so the
 * road connects where things actually ended up rather than where they were
 * authored.
 */
export function setupRoad(
  world: SimWorld,
  s: RtState,
  stages: readonly StageDef[] = STAGES,
): void {
  const points: { x: number; z: number }[] = [{ x: 0, z: 0 }];
  // Which POINT is each stage's exit — resolved to a sample index below, so
  // the corridor clamp can know where "behind the last gate" begins on the
  // ordered polyline (`SimWorld.gateIndices`). Arc order is what makes the
  // one-way road survive the s3 doubleback: the walk back to SPARK is
  // FORWARD along the road even though it is south-west in space.
  const exitPoint: number[] = [];
  // By NAME, not by array index. `setupVillage` is the only thing adding a
  // bystander at boot today, but "bystanders[0] is Sella" is an invariant
  // nothing enforces, and a road routed via the wrong body is a silent
  // level-design bug rather than a crash.
  stages.forEach((st, si) => {
    // The authored bends first — the physical road has to take the same turns
    // the graded profile took, or it cuts the corners the grading paid for.
    for (const b of st.bends ?? []) points.push({ x: b[0], z: b[1] });
    const placed = s.markers.filter((m) => m.stage === si);
    placed.forEach((m, k) => {
      // A captive stands before their stage's first fight; the road goes via
      // them, because a rescue the player can walk past is a rescue they
      // will miss. Generalized from Sella (R3): any stage may declare one.
      // The PLACED body, not the authored point — placement may have nudged
      // them to standable ground.
      if (k === 0 && st.captive) {
        const b = s.bystanders.find((by) => by.name === st.captive!.name);
        if (b) points.push({ x: b.x, z: b.z });
      }
      points.push({ x: m.x, z: m.z });
    });
    // The stage exit is a place the player walks to, so it needs road under it
    // as much as any fight does.
    const stage = s.stages[si];
    if (stage) {
      points.push({ x: stage.exitX, z: stage.exitZ });
      exitPoint[si] = points.length - 1;
    }
  });

  // One source of truth with the exit discs and the crossing rule's
  // on/off-road split (`constants.ts`).
  const HALF_WIDTH = ROAD_HALF_WIDTH;
  const samples: { x: number; z: number }[] = [];
  // Sample index of each authored point, filled as the resample walks.
  const pointSample: number[] = [0];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(1, Math.ceil(len));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      samples.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    }
    pointSample[i + 1] = samples.length - 1;
  }
  // The centreline, published for the renderer to tint the ground along
  // (`SimWorld.roadPath`). The first playtest's clearest finding: the road
  // existed as physics — carved, graded, blocker-free — and not as a picture,
  // so "which way is forward" was a guess.
  world.roadPath.push(...samples);
  // Where each gate sits along that centreline, in sample order — the
  // one-way road's boundary lookups. Setup-derived like roadPath itself:
  // nothing new to hash.
  world.gateIndices.push(...stages.map((_, si) => pointSample[exitPoint[si] ?? 0] ?? 0));
  // The biome spans (round 7), compiled from the stage tags: a stage's
  // stretch of road runs from the PREVIOUS gate to its own, so a new zone
  // begins at the gate you cross into it. The fen therefore starts at the
  // village gate — which is the authored fiction exactly: the mire's first
  // finger reaches the gate, and the SPARK doubleback walks into the bog.
  stages.forEach((_st, si) => {
    // STICKY (R3): an untagged stage inherits its predecessor's zone, so a
    // mid-ash stage cannot silently revert its stretch to meadow.
    const biome = stageBiome(stages, si);
    const last = world.biomeSpans[world.biomeSpans.length - 1];
    if (!last) {
      world.biomeSpans.push({ biome, from: 0 });
    } else if (last.biome !== biome) {
      world.biomeSpans.push({ biome, from: world.gateIndices[si - 1] ?? 0 });
    }
  });

  world.obstacles.clearRegion((o) => {
    if (o.kind === "hut" || o.kind === "brazier") return true; // authored scenery stays
    for (const p of samples) {
      const dx = o.x - p.x;
      const dz = o.z - p.z;
      if (dx * dx + dz * dz < (o.radius + HALF_WIDTH) ** 2) return false;
    }
    return true;
  });

  // Zone dressing BEFORE the fence, so the walls plantWalls raises are the
  // zone's own kinds while the ambient forest is already converted/thinned.
  dressBiomes(world, samples, stages);

  plantWalls(world, s, samples, stages);
}

/** The zone a point belongs to, by the dominant half of its blend. */
function dominantZone(world: SimWorld, x: number, z: number): BiomeId {
  const b = biomeAt(world, x, z);
  return b.t < 0.5 ? b.a : b.b;
}

/**
 * Dress the ambient world per zone (round 7): the fen's forest turns to
 * cypress, the ash country's thins to scattered charred snags — bare ground
 * IS its statement — and the decorative bog ponds grow cypress in their
 * shallows, which ambient placement's `minAboveWater` can never do.
 *
 * In-place kind conversion is grid-safe (positions and radii unchanged); the
 * ash thinning goes through `clearRegion`, which rebuilds the grid. Its own
 * seeded stream, independent of every other, and deterministic in list order.
 * The pond cypress respects the road lane; anything it plants near the
 * camera's standing band is felled by `plantWalls`' own clear moments later.
 */
function dressBiomes(
  world: SimWorld,
  samples: { x: number; z: number }[],
  stages: readonly StageDef[],
): void {
  // The dressed ponds, from the DECLARED water (see `StageWater.reeds`).
  const reedPonds = stages.flatMap((st) =>
    (st.terrain?.water ?? [])
      .filter((w) => w.reeds)
      .map((w) => ({ x: w.at[0], z: w.at[1], r: w.r })),
  );
  const rand = mulberry32(0xb105e5);
  // The zone's forest, from the profile table (R3, gfx's ask): re-kinding
  // and felling used to be a compiler-invisible if-chain a new biome walked
  // straight past. `BIOMES` is content — a new id fails compilation until it
  // says what its forest IS.
  for (const o of world.obstacles.list) {
    if (o.kind !== "tree") continue;
    const kind = BIOMES[dominantZone(world, o.x, o.z)].forestKind;
    if (kind !== "tree") o.kind = kind;
  }
  // Felling per profile (ash keeps ~1 in 4 snags). Rocks stay — they read
  // everywhere. The draw is consumed ONLY for kinds a profile fells, so
  // adding a full-keep biome cannot shift the stream (RNG-order contract).
  const keepByKind: Partial<Record<string, number>> = {};
  for (const p of Object.values(BIOMES)) {
    if (p.forestKeep < 1) {
      keepByKind[p.forestKind] = Math.min(keepByKind[p.forestKind] ?? 1, p.forestKeep);
    }
  }
  world.obstacles.clearRegion((o) => {
    const keep = keepByKind[o.kind];
    return keep === undefined || rand() < keep;
  });

  for (const pond of reedPonds) {
    if (dominantZone(world, pond.x, pond.z) !== "fen") continue;
    const n = 2 + Math.floor(rand() * 2);
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const rr = pond.r * (0.6 + rand() * 0.35);
      const x = pond.x + Math.cos(a) * rr;
      const z = pond.z + Math.sin(a) * rr;
      // Never into the road lane — the ponds flank it by construction, but a
      // shoreward candidate can lean back in.
      let nearRoad = false;
      for (const p of samples) {
        const dx = x - p.x;
        const dz = z - p.z;
        if (dx * dx + dz * dz < 2.9 * 2.9) {
          nearRoad = true;
          break;
        }
      }
      if (nearRoad) continue;
      const scale = 0.8 + rand() * 0.5;
      world.obstacles.addStatic({
        kind: "cypress",
        x,
        z,
        y: world.field.heightAt(x, z),
        scale,
        rotY: rand() * Math.PI * 2,
        radius: 0.42 * scale,
      });
    }
  }
}

/**
 * Line the road with trees, so the corridor is a PLACE and not a suggestion.
 *
 * The second playtest's "I should not be able to free roam" has two layers:
 * this one, which the player can see — a forest edge a stride past the road
 * verge, rendered as real trees because scatter instances sim blockers 1:1 —
 * and the sim-side corridor clamp (`rtStep` 8b², at CORRIDOR_HALF just beyond
 * the treeline), which is the guarantee for whatever gap the jitter leaves.
 * An invisible wall alone is the §11 failure; a treeline alone is a fence
 * with holes. Together the world reads as "the road goes THERE".
 *
 * Deterministic: a fixed-seed stream, independent of every other stream, so a
 * reroll elsewhere cannot re-plant the forest. Skips are conservative — near
 * fights, gates, finds, Sella, the village, existing blockers, or a second
 * pass of the road itself (switchbacks) — because a wall that blocks play is
 * worse than a gap.
 */
function plantWalls(
  world: SimWorld,
  s: RtState,
  samples: { x: number; z: number }[],
  stages: readonly StageDef[],
): void {
  const rand = mulberry32(0x57a11);
  const OFFSET = 4.6;
  // Every captive, and every declared flat (the village square) — the fence
  // stays clear of both. Generalized from Sella/VILLAGE (R3).
  const captives = s.bystanders.filter((b) => stages.some((st) => st.captive?.name === b.name));
  const flats = stages.flatMap((st) =>
    st.terrain?.flat ? [{ x: st.terrain.flat.at[0], z: st.terrain.flat.at[1], r: st.terrain.flat.r }] : [],
  );

  const clearOf = (x: number, z: number, r: number): boolean => {
    // The road itself, ANY pass of it — a switchback's far side must not get
    // a wall planted in its lane by the near side's loop.
    for (const p of samples) {
      const dx = x - p.x;
      const dz = z - p.z;
      if (dx * dx + dz * dz < 3.7 * 3.7) return false;
    }
    // Inside a fight's arena, or on a validated spawn: the margin covers a
    // spawn offset at the arena's own edge plus standable()'s clearance, so
    // the trees can never grow on a fight.
    for (const m of s.markers) {
      if (Math.hypot(x - m.x, z - m.z) < m.arena + r + 1.3) return false;
      for (const f of m.foes) {
        if (Math.hypot(x - (m.x + f.dx), z - (m.z + f.dz)) < r + 1.5) return false;
      }
    }
    for (const st of s.stages) {
      if (Math.hypot(x - st.exitX, z - st.exitZ) < st.exitR + 1.5) return false;
    }
    for (const p of s.pickups) {
      if (Math.hypot(x - p.x, z - p.z) < 3.5) return false;
    }
    for (const b of captives) {
      if (Math.hypot(x - b.x, z - b.z) < 3) return false;
    }
    for (const fl of flats) {
      if (Math.hypot(x - fl.x, z - fl.z) < fl.r) return false;
    }
    // A blocker already standing here IS the wall — but only a DEEP overlap
    // skips, because adjacent fence trees are meant to close ranks: trunks a
    // stride apart with merged canopies is what a forest edge looks like.
    for (const o of world.obstacles.near(x, z)) {
      if (Math.hypot(x - o.x, z - o.z) < (o.radius + r) * 0.55) return false;
    }
    return true;
  };

  // The fixed camera's dividend, applied to the fence: the camera stands at a
  // KNOWN offset from wherever the hero walks (`staging.ts`), so the sleeve of
  // ground its sight line crosses for a hero anywhere on the road is knowable
  // now. A tree there fills the frame with canopy — the first browser drive
  // hit exactly that. Trees in the sleeve become ROCKS: still a wall to the
  // body, but low, so the camera looks over them. (§11: the picture and the
  // blockers must agree — an occluding fence and an invisible one are both
  // wrong.)
  const view = viewDirection();
  const inCameraSleeve = (x: number, z: number, r: number): boolean => {
    for (const p of samples) {
      const vx = x - p.x;
      const vz = z - p.z;
      const along = vx * view.dx + vz * view.dz;
      if (along < -1 || along > VIEW_DISTANCE + 2) continue;
      const px = vx - view.dx * along;
      const pz = vz - view.dz * along;
      // CORRIDOR_R plus a canopy margin — the trunk is the blocker but the
      // CROWN is what occludes, and it overhangs the trunk by metres — plus
      // VIEW_LEAD, because the walking frame now drifts that far along the
      // hero's velocity and the sight line drifts with it.
      if (px * px + pz * pz < (CORRIDOR_R + VIEW_LEAD + r + 1.2) ** 2) return true;
    }
    return false;
  };

  // The walking camera's STANDING band, emptied outright. The ambient forest
  // scatter (`world/obstacles.ts`) knows nothing about roads, and the first
  // led drive found a full-grown tree exactly in the lens at the s3 gate —
  // plus rise boulders close enough to fill half the frame. Samples are ~1 m
  // apart, so per-sample discs cover the whole line the lead slides the
  // camera along.
  const stand = samples.map((p) => ({
    x: p.x + view.dx * STAGE_VIEW_DISTANCE,
    z: p.z + view.dz * STAGE_VIEW_DISTANCE,
  }));
  world.obstacles.clearRegion((o) => {
    if (o.kind === "hut" || o.kind === "brazier") return true; // authored scenery stays
    for (const c of stand) {
      const dx = o.x - c.x;
      const dz = o.z - c.z;
      if (dx * dx + dz * dz < (o.radius + 2.0) ** 2) return false;
    }
    return true;
  });

  // Ambient TREES in the sight sleeve get the fence's own rule: tall
  // occludes, low doesn't, so they become rocks in place. In-place mutation
  // is grid-safe (position unchanged) and runs before any planting, so the
  // fence's clearOf sees the converted radii.
  for (const o of world.obstacles.list) {
    if (o.kind === "tree" && inCameraSleeve(o.x, o.z, o.radius)) {
      o.kind = "rock";
      o.radius = 0.5 * o.scale;
    }
  }

  const plant = (x: number, z: number, downstage = false): void => {
    const h = world.field.heightAt(x, z);
    // Deep water needs no fence; shallow banks take a rock, dry ground the
    // tree the forest is made of — the causeway reads as a rocky shore.
    if (h < world.waterLevel + 0.05) return;
    const scale = 1.0 + rand() * 0.6;
    const rocky =
      downstage || h < world.waterLevel + 0.4 || inCameraSleeve(x, z, 0.5 * scale);
    const radius = (rocky ? 0.5 : 0.42) * scale;
    // Never plant in the walking camera's standing band — on the legs that
    // run across the view axis the fence line and the stand line nearly
    // coincide, and even a LOW rock fills half the frame from 2 m away. The
    // gap is invisible (it is where the lens is) and the sim-side corridor
    // clamp still fences movement.
    for (const c of stand) {
      const dx = x - c.x;
      const dz = z - c.z;
      if (dx * dx + dz * dz < (radius + 2.0) ** 2) return;
    }
    if (!clearOf(x, z, radius)) return;
    // The fence is built from the ZONE's own forest (round 7), read off the
    // profile table (R3). Rocks stay universal.
    world.obstacles.addStatic({
      kind: rocky ? "rock" : BIOMES[dominantZone(world, x, z)].forestKind,
      x,
      z,
      y: h,
      scale,
      rotY: rand() * Math.PI * 2,
      radius,
    });
  };

  // The straights: one pair per road sample (~1 m apart), tight enough that
  // the trunks themselves fence before the clamp is ever consulted.
  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i]!;
    const b = samples[i + 1]!;
    const seg = Math.hypot(b.x - a.x, b.z - a.z);
    if (seg === 0) continue;
    const nx = -(b.z - a.z) / seg;
    const nz = (b.x - a.x) / seg;
    for (const side of [-1, 1]) {
      const lateral = OFFSET + rand() * 1.3 - 0.4;
      plant(
        a.x + nx * side * lateral + (rand() - 0.5) * 0.5,
        a.z + nz * side * lateral + (rand() - 0.5) * 0.5,
      );
    }
  }

  // The glades: the fights sit every ~15 m ON the road, so their lock discs
  // blanket most of it — flank pairs alone would leave the fence in tatters.
  // Each arena gets an explicit tree RING at its felled edge instead, gapped
  // where the road passes through (clearOf's road sleeve): a clearing wrapped
  // in forest, which is what a level designer would draw for an ambush anyway.
  for (const m of s.markers) {
    const ring = m.arena + 2.1;
    const steps = Math.ceil((2 * Math.PI * ring) / 1.05);
    for (let k = 0; k < steps; k++) {
      const a = ((k + rand() * 0.4) / steps) * Math.PI * 2;
      const rr = ring + rand() * 0.6;
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      // The camera-facing arc is DOWNSTAGE: the encounter camera orbits the
      // brawl from `view`'s side, and a tall tree there ends up between the
      // lens and the fight. Rocks downstage, trees upstage — a theatre.
      plant(m.x + dx * rr, m.z + dz * rr, dx * view.dx + dz * view.dz > 0.2);
    }
  }
}

/**
 * Fell everything inside the arena and inside the camera's corridor.
 *
 * The corridor is wider than the turn build needed. There the fight was pinned
 * to the marker, so the camera's ground position was known exactly; here the
 * brawl drifts and the camera follows the hero, so the sight line is an
 * approximation and wants margin.
 */
function carveArena(world: SimWorld, x: number, z: number, clear: number): void {
  const view = viewDirection();
  // Sample points along the sight line, from the arena edge out to just past
  // where the camera will stand.
  const corridor: [number, number][] = [];
  for (let d = 0; d <= VIEW_DISTANCE + 1.5; d += 1) {
    corridor.push([x + view.dx * d, z + view.dz * d]);
  }
  world.obstacles.clearRegion((o) => {
    // Huts and braziers are authored scenery, never felled by an encounter.
    if (o.kind === "hut" || o.kind === "brazier") return true;
    const dx = o.x - x;
    const dz = o.z - z;
    if (dx * dx + dz * dz < (o.radius + clear) ** 2) return false;
    for (const [sx, sz] of corridor) {
      const cx = o.x - sx;
      const cz = o.z - sz;
      if (cx * cx + cz * cz < (o.radius + CORRIDOR_R) ** 2) return false;
    }
    return true;
  });
}

/* -------------------------------------------------------------- the village */

/**
 * The village layout — the single source both sides read. The SIM applies the
 * blockers and wet zones; the RENDERER reads the same object for hut visuals,
 * fire, and trough water. One dataset, two consumers, no drift.
 *
 * Geography: spawn → bandit road (z≈13) → village (z≈27). The troughs lie
 * across the approach to the mage, and her guards idle IN them — so when she
 * joins and casts her first bolt, the Wet+Lightning chain teaches itself
 * (PEDAGOGY.md row 4: the correct play is the obvious play).
 */
export interface VillageLayout {
  centre: FlatSpot;
  huts: { x: number; z: number; rotY: number; scale: number; burning: boolean }[];
  troughs: { x: number; z: number; r: number }[];
}

/**
 * DERIVED from the stage table (R3): the stage declaration is the single
 * authoring surface for terrain now, and this is the compatibility view of
 * it — main.ts reads `VILLAGE.huts` for the hut visuals in exactly the shape
 * it always did (huts in table order, so the burning-hut → hutFires index
 * mapping is unchanged). The values are the same numbers that lived here as
 * constants; only their home moved.
 */
export const VILLAGE: VillageLayout = (() => {
  const flatStage = STAGES.find((st) => st.terrain?.flat);
  const hutStage = STAGES.find((st) => (st.terrain?.huts?.length ?? 0) > 0);
  const flat = flatStage?.terrain?.flat;
  if (!flat || !hutStage) {
    throw new Error("no stage declares the village terrain (flat + huts)");
  }
  return {
    centre: { x: flat.at[0], z: flat.at[1], r: flat.r },
    huts: (hutStage.terrain?.huts ?? []).map((h) => ({
      x: h.at[0],
      z: h.at[1],
      rotY: h.rotY,
      scale: h.scale,
      burning: !!h.burning,
    })),
    troughs: STAGES.flatMap((st) =>
      (st.terrain?.water ?? [])
        .filter((w) => !w.reeds)
        .map((w) => ({ x: w.at[0], z: w.at[1], r: w.r })),
    ),
  };
})();


/**
 * The stage whose terrain declares the village — kept as an export for the
 * places that still speak in its terms, DERIVED so it cannot drift from the
 * table (by id rather than index: indices renumber every time a stage is
 * added, and that has silently broken once already).
 */
export const VILLAGE_STAGE_ID: string = (() => {
  const st = STAGES.find((s) => (s.terrain?.huts?.length ?? 0) > 0);
  if (!st) throw new Error("no stage declares huts — the village is missing");
  return st.id;
})();

/**
 * World dimensions for the campaign. Grew 160 → 240 when the chapter grew to
 * ten stages: the route is ~150 m of winding road and the movement clamp sits
 * at `size/2 − 2`, so the old field ended two stages early. Segments keep the
 * cell at 1.25 m. The sandbox keeps the default 160 — it is a flat arena and
 * has no road to fit.
 */
export const WORLD_SIZE = 240;
export const WORLD_SEGMENTS = 192;

/**
 * The campaign's water level — one constant, shared with `main.ts` and the
 * road grading below, because the road must know where the water is: the
 * northern third of the route crosses a lake basin, and an ungraded profile
 * followed the terrain straight under the waterline, where nothing is
 * standable and every arena search failed.
 */
export const CAMPAIGN_WATER_LEVEL = -1.2;

/**
 * Terrain options the scenario needs baked into the heightfield. Pass to
 * createSimWorld — the village must sit on flat ground.
 */
export function scenarioHeightfieldOptions(
  seed = 1337,
  stages: readonly StageDef[] = STAGES,
): {
  size: number;
  segments: number;
  flatSpots: FlatSpot[];
} {
  // Every declared flat (the village square), then the graded road.
  const flats: FlatSpot[] = stages.flatMap((st) =>
    st.terrain?.flat
      ? [{ x: st.terrain.flat.at[0], z: st.terrain.flat.at[1], r: st.terrain.flat.r }]
      : [],
  );
  return {
    size: WORLD_SIZE,
    segments: WORLD_SEGMENTS,
    flatSpots: [...flats, ...gradedRoadSpots(seed, stages)],
  };
}

/**
 * The authored route north, GENERATED from the stage table: spawn → each
 * stage's bends → (Sella, before the village fight) → each fight → each gate.
 *
 * This used to be a second, hand-maintained polyline whose coordinates
 * duplicated `stages.ts` entry by entry — with nothing asserting the copies
 * agreed. Now the stage table is the only author; the road follows it by
 * construction. `arena` marks the points that get a wide flat clearing.
 */
function authoredRoute(
  stages: readonly StageDef[],
): { x: number; z: number; arena: boolean; causeway: number }[] {
  const pts: { x: number; z: number; arena: boolean; causeway: number }[] = [
    { x: 0, z: 0, arena: false, causeway: stages[0]?.causeway ?? 0.6 },
  ];
  for (const st of stages) {
    // The stage's causeway margin rides every point of its stretch (R4 —
    // the eastern tail is built low, at the water's edge).
    const cw = st.causeway ?? 0.6;
    for (const b of st.bends ?? []) pts.push({ x: b[0], z: b[1], arena: false, causeway: cw });
    st.markers.forEach((m, k) => {
      // The grading mirrors setupRoad's routing exactly: a captive is a
      // route vertex before their stage's first fight. AUTHORED position
      // here (the profile is built before placement can nudge anybody).
      if (k === 0 && st.captive) {
        pts.push({ x: st.captive.at[0], z: st.captive.at[1], arena: false, causeway: cw });
      }
      pts.push({ x: m.at[0], z: m.at[1], arena: true, causeway: cw });
    });
    pts.push({ x: st.exit.x, z: st.exit.z, arena: false, causeway: cw });
  }
  return pts;
}

/** Maximum road grade. 0.12 ≈ 7° — a road, not a scramble. */
const ROAD_GRADE = 0.12;

/**
 * Build the road as a chain of flat discs carrying a GRADED height profile.
 *
 * §9's opening is "already running down a road", and the first version had no
 * road at all: the hero auto-ran straight up a hillside, where the movement
 * controller's grade cap throttled them to ~1 m/s and made them slip sideways.
 * A 4-second run-in measured 25 seconds.
 *
 * Clearing trees was not enough and neither was ordinary flattening — a disc
 * that flattens to its own local height removes bumps and leaves the hill. So
 * the profile is smoothed explicitly: sample the raw terrain along the route,
 * then limit how fast the road may climb, in both directions, so it cuts and
 * fills its way across the landscape the way a real path does.
 *
 * It needs the terrain to exist before it can sample it, hence the throwaway
 * probe field. Deterministic — same seed, same road.
 */
function gradedRoadSpots(seed: number, stages: readonly StageDef[]): FlatSpot[] {
  const probe = new Heightfield({
    seed,
    size: WORLD_SIZE,
    segments: WORLD_SEGMENTS,
    // The declared flats only — the probe must see the same pre-road terrain
    // the real heightfield bakes.
    flatSpots: stages.flatMap((st) =>
      st.terrain?.flat
        ? [{ x: st.terrain.flat.at[0], z: st.terrain.flat.at[1], r: st.terrain.flat.r }]
        : [],
    ),
  });

  const ROUTE = authoredRoute(stages);
  const STEP = 1.5;
  const pts: { x: number; z: number }[] = [];
  /** Per-sample causeway margin, lerped along each segment (R4). */
  const margins: number[] = [];
  for (let i = 0; i < ROUTE.length - 1; i++) {
    const { x: ax, z: az } = ROUTE[i]!;
    const { x: bx, z: bz } = ROUTE[i + 1]!;
    const len = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.round(len / STEP));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      pts.push({ x: ax + (bx - ax) * t, z: az + (bz - az) * t });
      margins.push(ROUTE[i]!.causeway + (ROUTE[i + 1]!.causeway - ROUTE[i]!.causeway) * t);
    }
  }
  pts.push({ x: ROUTE[ROUTE.length - 1]!.x, z: ROUTE[ROUTE.length - 1]!.z });
  margins.push(ROUTE[ROUTE.length - 1]!.causeway);

  const raw = pts.map((p) => probe.heightAt(p.x, p.z));
  const seg = pts.map((p, i) =>
    i === 0 ? 0 : Math.hypot(p.x - pts[i - 1]!.x, p.z - pts[i - 1]!.z),
  );

  // Forward then backward slope-limiting, averaged. One pass alone lags the
  // terrain in whichever direction it ran.
  const fwd = [...raw];
  for (let i = 1; i < fwd.length; i++) {
    const cap = ROAD_GRADE * seg[i]!;
    fwd[i] = Math.max(fwd[i - 1]! - cap, Math.min(fwd[i - 1]! + cap, raw[i]!));
  }
  const bwd = [...raw];
  for (let i = bwd.length - 2; i >= 0; i--) {
    const cap = ROAD_GRADE * seg[i + 1]!;
    bwd[i] = Math.max(bwd[i + 1]! - cap, Math.min(bwd[i + 1]! + cap, raw[i]!));
  }

  // THE CAUSEWAY FLOOR. The graded profile follows the terrain, and the
  // northern third of the route crosses a lake basin — followed honestly, the
  // road dives under the waterline and nothing on it is standable. A road
  // that meets water gets built UP; this is that, numerically: never below
  // ankle depth, and the flat-spot skirts blend it into banks.
  //
  // PER-STAGE since R4 (`StageDef.causeway`): the eastern tail is built at
  // 0.2 — the water's edge — instead of the spawn lake's 0.6, so The Sodden
  // Hollow stands on dark soaked shore ground rather than a raised plateau
  // the palette reads as summit lichen (gfx's catch). The margin array gets
  // the road's OWN slope-limit so a margin change ramps, never cliffs.
  const mfwd = [...margins];
  for (let i = 1; i < mfwd.length; i++) {
    const cap = ROAD_GRADE * seg[i]!;
    mfwd[i] = Math.max(mfwd[i - 1]! - cap, Math.min(mfwd[i - 1]! + cap, margins[i]!));
  }
  const mbwd = [...margins];
  for (let i = mbwd.length - 2; i >= 0; i--) {
    const cap = ROAD_GRADE * seg[i + 1]!;
    mbwd[i] = Math.max(mbwd[i + 1]! - cap, Math.min(mbwd[i + 1]! + cap, margins[i]!));
  }
  const grade = (i: number): number =>
    Math.max(CAMPAIGN_WATER_LEVEL + Math.min(mfwd[i]!, mbwd[i]!), (fwd[i]! + bwd[i]!) / 2);

  const spots: FlatSpot[] = pts.map((p, i) => ({
    x: p.x,
    z: p.z,
    // Wide enough to walk without clipping the skirt, narrow enough that the
    // road reads as a road rather than as a plain.
    r: 2.4,
    h: grade(i),
  }));

  // THE ROAD WIDENS WHERE THE FIGHTS ARE.
  //
  // An arena needs ~5 m of flat ground in every direction, and the road is
  // 2.4 m wide — so `findArenaNear` sampled 5 m out, found hillside, and went
  // hunting. It found flat ground 10 m off the road, put the fights there, and
  // the hero walked off the graded path into the hills to reach them.
  //
  // Widening the road at the encounter waypoints fixes the cause rather than
  // the symptom, and it is what a level designer would draw anyway: a clearing
  // where the path opens out is exactly where you stage an ambush. Every
  // marker gets one — the old hand-picked waypoint list missed a fight once.
  for (const w of ROUTE) {
    if (!w.arena) continue;
    // Nearest sampled road point carries the graded height for this clearing.
    let best = 0;
    let bestD = Infinity;
    pts.forEach((p, k) => {
      const d = (p.x - w.x) ** 2 + (p.z - w.z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    });
    spots.push({ x: w.x, z: w.z, r: 7, h: grade(best) });
  }
  return spots;
}

/**
 * Apply the village to the sim world: hut blockers, trough wet zones, and
 * Sella waiting to be freed.
 *
 * The troughs are not decoration — the pool encounter is staged on top of them
 * so both foes are Wet for as long as they stand there, which is how the
 * opening teaches Wet + Lightning without a word of text (`docs/PEDAGOGY.md`).
 * In the turn build that was resolved once, at encounter start; the real-time
 * sim asks the ground every tick (`rt/step.ts`, step 7), so a foe that walks
 * out of the pool dries off and one that walks in gets soaked.
 */
export function setupTerrain(
  world: SimWorld,
  s: RtState,
  stages: readonly StageDef[] = STAGES,
): void {
  // Fires bind to STAGE INDICES, so the stages must be placed first. Refuse
  // to guess: a silent mis-bind would quietly turn the required douse lesson
  // back into decoration.
  if (s.stages.length !== stages.length) {
    throw new Error("setupTerrain before setupEncounters: the fires need their stages");
  }
  stages.forEach((st, si) => {
    const t = st.terrain;
    for (const hut of t?.huts ?? []) {
      world.obstacles.addStatic({
        kind: "hut",
        x: hut.at[0],
        z: hut.at[1],
        y: world.field.heightAt(hut.at[0], hut.at[1]),
        scale: hut.scale,
        rotY: hut.rotY,
        radius: 1.9 * hut.scale,
      });
      // The burning huts become SIM fires, because the first playtest cast
      // water at one and the world ignored them. Radius matches the hut's
      // blocker with margin — the flames wrap the roof, not a point. Bound
      // to the DECLARING stage: they gate its seam until doused.
      if (hut.burning) {
        s.hutFires.push({
          id: s.nextId++,
          x: hut.at[0],
          z: hut.at[1],
          r: 2.2 * hut.scale,
          lit: true,
          stage: si,
          keepLit: false,
          lit0: true,
          stage0: si,
        });
      }
    }
    // Braziers (R4, damp_pyres): a bowl blocker the render instances 1:1
    // (gfx's brazierMesh keys the kind), plus a KEEP-LIT scenery fire — the
    // hut grammar inverted. `gates: false` (the boss arena's tactical bowls,
    // fun's R4 condition: no second counted objective there) binds the fire
    // to stage −1, the established never-gates convention.
    for (const bz of t?.braziers ?? []) {
      world.obstacles.addStatic({
        kind: "brazier",
        x: bz.at[0],
        z: bz.at[1],
        y: world.field.heightAt(bz.at[0], bz.at[1]),
        scale: 1,
        rotY: 0,
        radius: 0.6,
      });
      s.hutFires.push({
        id: s.nextId++,
        x: bz.at[0],
        z: bz.at[1],
        r: 1.3,
        lit: bz.startLit !== false,
        stage: bz.gates === false ? -1 : si,
        keepLit: true,
        lit0: bz.startLit !== false,
        // The authored stage survives the −1 never-gates convention — the
        // retry re-arm (the pinata-path fix) scopes by it.
        stage0: si,
      });
    }
    for (const w of t?.water ?? []) {
      world.wetZones.push({ x: w.at[0], z: w.at[1], r: w.r });
    }
    // A captive stands on the road before this stage's first fight; the
    // route is carved through them (setupRoad reads the PLACED body).
    if (st.captive) {
      const m = findStandableNear(world, st.captive.at[0], st.captive.at[1]);
      // Her post rides the declaration: `holdBiome` compiles to the first
      // stage of that zone, and the sim holds only the index (R4.5).
      addBystander(s, m.x, m.z, st.captive.name, captiveHoldStage(stages, st.captive));
    }
  });
}

/**
 * The name this function had when the village was its only content — kept so
 * the setup order reads the same everywhere (encounters → terrain → road).
 */
export const setupVillage = setupTerrain;

/**
 * PLACE the authored campaign: the stage chain, and the fights standing on it.
 *
 * The fights themselves used to be an inline table here and are now
 * `content/stages.ts`, which is where the lesson plan and its reasoning live.
 * What is left in this file is the half that needs the terrain: validating
 * every spawn against the same walkability rules the movement controller
 * enforces, and carving the glade each arena needs.
 *
 * That split is the point. Content is a typed const table (`CLAUDE.md` §6) and
 * placement is a search over a procedural world; keeping them in one function
 * meant authoring a stage required understanding both, which is exactly the
 * content-pipeline cost M3 is meant to pay down.
 *
 * Fights are visible and discrete and are walked into — no random battles
 * (`docs/GAME_DESIGN.md` §2). In the turn build a marker opened a separate
 * mode; in real time there is no mode, so a marker is simply a trigger that
 * spawns its foes into a simulation that never stopped.
 *
 * Foes spawn at world offsets from the marker centre and their archetype AI
 * takes over on the same tick, so an offset encodes exactly two things: who is
 * on the hero's forward axis, and who is not.
 */
export function setupEncounters(
  world: SimWorld,
  s: RtState,
  stages: readonly StageDef[] = STAGES,
): void {
  s.stages = stages.map((st) => ({
    id: st.id,
    exitX: st.exit.x,
    exitZ: st.exit.z,
    exitR: st.exit.r,
    cleared: false,
  }));
  s.stageIndex = 0;

  let id = 0;
  s.markers = stages.flatMap((st, stageIndex) =>
    st.markers.map((sp) => {
      // 5 m of clear floor, and a wider carve than that: a turn-based arena
      // stayed on its marker, but a real-time brawl MOVES — a charger closes,
      // the hero backpedals — so the felled floor has to be bigger than the
      // staged floor ever needed to be.
      const p = sp.exact
        ? (carveArena(world, sp.at[0], sp.at[1], ARENA_CARVE), { x: sp.at[0], z: sp.at[1] })
        : findArenaNear(world, sp.at[0], sp.at[1]);
      return {
        id: id++,
        stage: stageIndex,
        x: p.x,
        z: p.z,
        // Generous: the player should never brush past a fight they meant to
        // take, and every fight here is one they can see coming.
        radius: sp.radius ?? 2.6,
        arena: sp.arena ?? DEFAULT_ARENA,
        // Every spawn point is validated against the SAME walkability rules the
        // movement controller enforces, here at setup, and the VALIDATED offset
        // is what gets stored — so `rtStep` never searches, and stays trig-free.
        foes: sp.foes.map((f) => {
          const q = findStandableNear(world, p.x + f.dx, p.z + f.dz, 3);
          return { kindId: f.kindId, dx: q.x - p.x, dz: q.z - p.z, douser: f.douser ?? false };
        }),
        triggered: false,
        cleared: false,
        // The valve (R5), compiled from the declaration. Entry points are
        // pushed to standable ground the same way spawns are — an arrival that
        // cannot stand where it lands would be shoved, and a body sliding out
        // of a rock is the opposite of a legible entrance.
        reinforce: sp.reinforce
          ? {
              after: sp.reinforce.after,
              every: sp.reinforce.every,
              budget: sp.reinforce.budget,
              kindId: sp.reinforce.kindId,
              from: sp.reinforce.from.map((e) => {
                const q = findStandableNear(world, p.x + e[0], p.z + e[1], 3);
                return { dx: q.x - p.x, dz: q.z - p.z };
              }),
            }
          : null,
        fightTicks: 0,
        reinforceLeft: sp.reinforce?.budget ?? 0,
        composed: false,
      };
    }),
  );

  placePickups(world, s, stages);
}

/**
 * How far past its gate a find stands, capped by the fraction of the walk to
 * the next waypoint it may take up. Close enough that the ceremony belongs to
 * the gate that earned it; the fraction keeps a short walk (the trough pool is
 * 3.6 m beyond the village gate) from putting the find inside the next fight.
 */
const PICKUP_AHEAD = 3.5;

/**
 * The finds, made physical (the second playtest's ask): each element and THE
 * WEAVE stands ON the walk out of the stage that earns it — from the gate
 * toward the next stage's first waypoint, which is the line every walk north
 * crosses. PICKUP_RADIUS (2.6 m) is wider than the road half-width (2.4 m),
 * so the corridor cannot be threaded past a find; a road-suite test asserts
 * the placement geometry rather than trusting it.
 */
function placePickups(world: SimWorld, s: RtState, stages: readonly StageDef[]): void {
  let id = 0;
  stages.forEach((st, si) => {
    if (!st.grants) return;
    const next = stages[si + 1];
    const target: readonly [number, number] = next
      ? (next.bends?.[0] ?? next.markers[0]?.at ?? [next.exit.x, next.exit.z])
      : [st.exit.x, st.exit.z + PICKUP_AHEAD];
    const dx = target[0] - st.exit.x;
    const dz = target[1] - st.exit.z;
    const len = Math.hypot(dx, dz) || 1;
    const d = Math.min(PICKUP_AHEAD, len * 0.45);
    const p = findStandableNear(world, st.exit.x + (dx / len) * d, st.exit.z + (dz / len) * d);
    s.pickups.push({ id: id++, stage: si, kind: st.grants, x: p.x, z: p.z, taken: false });
  });
}

/**
 * Build a complete campaign world from a stage list — THE pipeline entry
 * (R3). The shipped campaign is `buildScenario()` with the defaults; a
 * throwaway stage list (the smoke test, the validator's broken-stage
 * fixtures) is `buildScenario(myStages)`. Same functions, same order, same
 * seed discipline as `main.ts`'s boot — authoring a stage never means
 * learning the setup choreography.
 */
export function buildScenario(
  stages: readonly StageDef[] = STAGES,
  seed = 1337,
): { world: SimWorld; state: RtState } {
  const world = createSimWorld({
    seed,
    waterLevel: CAMPAIGN_WATER_LEVEL,
    heightfield: scenarioHeightfieldOptions(seed, stages),
  });
  const state = createRtState(seed);
  setupEncounters(world, state, stages);
  setupTerrain(world, state, stages);
  setupRoad(world, state, stages);
  return { world, state };
}

/**
 * Rebuild a resumed campaign's world flags from the two decisions the save
 * records: the stage index and the FOUND bitmask (§7 — decisions and seeds,
 * never derived state). Extracted from `main.ts` so it is testable.
 *
 * `found` stopped being derivable the day finds became takeable (third
 * playtest): a player can clear stages while deliberately leaving a find
 * standing, so the save records what was taken and this replays it verbatim
 * — a taken find is granted and lies flat, a skipped one stands back up on
 * the road exactly where it was left. Never duplicated, never lost, never
 * invented. (Saves from the contact-collection era derive their bitmask once,
 * in `migrateSave`, via `foundBitsThroughStage`.)
 */
export function applyResume(
  state: RtState,
  stage: number,
  found: number,
  stages: readonly StageDef[] = STAGES,
): void {
  if (stage <= 0 || stage >= state.stages.length) return;
  // THE FIND-WINDOW CLAMP (R4, fun's live catch). The gate-refusal rule
  // means no seam can close behind an untaken find — so a save claiming a
  // stage past one was recorded BEFORE the rule and is poisoned: resuming
  // it verbatim puts the player past the one-way boundary with the find
  // unreachable forever, silently. Resume instead at the nearest stage the
  // rules could actually have reached: the untaken find's own stage. The
  // `found` bitmask stays exactly as recorded (a skipped find stays
  // skipped); post-fix saves satisfy the invariant already and never clamp.
  for (const p of state.pickups) {
    if (!foundHas(found, p.kind)) stage = Math.min(stage, Math.max(1, p.stage + 1));
  }
  state.stageIndex = stage;
  // The crossing debounce (R1) belongs to one gate; a resume starts fresh.
  state.gateCrossTicks = 0;
  for (let i = 0; i < stage; i++) {
    const st = state.stages[i];
    if (st) st.cleared = true;
    for (const m of state.markers) {
      if (m.stage === i) {
        m.triggered = true;
        m.cleared = true;
      }
    }
  }
  const entry = state.stages[stage - 1];
  if (entry) {
    state.hero.x = entry.exitX;
    state.hero.z = entry.exitZ;
  }
  // Fires that gate a cleared stage were provably doused — the gate does not
  // open around a burning hut (rt/step.ts 2c). Leaving them lit would be
  // derived state contradicting the decision log, and would relight a village
  // the save says was saved. Braziers invert (R4): a cleared pyre stage was
  // provably left with every bowl BURNING, so they resume lit.
  for (const hf of state.hutFires) {
    if (hf.stage >= 0 && state.stages[hf.stage]?.cleared) hf.lit = hf.keepLit;
  }
  // Captives of cleared stages were provably RESCUED (R4, fun's R3 finding —
  // a resume past the village left Sella standing captive behind the one-way
  // road, her follower voice gone for the rest of the run): the road is
  // carved THROUGH a captive, the rescue spans the corridor (R1), and the
  // gate stands past her — her stage clearing implies the walk crossed her.
  // Same derivation class as the fires above: decisions in, world flags out.
  //
  // AND STANDING WHERE THE HERO IS (R4.5, fun's ship-blocker). The flag alone
  // was half a rescue: her BODY stayed at the captive point, so every
  // mid-chapter reload started her up to 78 m behind a hero she can only reach
  // by a naive seek with no path. Measured on the pre-fix tree: an s9 resume
  // wedged her at (3.1, 62.2), 30.5 m out and unmoved after 60 s; the boss
  // stage wedged her 40.0 m out. The road is ONE-WAY, so nothing later in that
  // run can recover her — the companion and every line she still owes are gone
  // for good.
  //
  // The placement needs no world, and that is the point: past her post she
  // stands AT it (a stage exit — validated standable at build, V5), and short
  // of it she stands on the hero's own resume spot, which this very function
  // has just proved standable by putting the hero on it. Two points, both
  // already justified, no third case and no walkability query in a function
  // that has no world to ask.
  //
  // She lands ON the hero for one tick, deliberately: the separation pass
  // never displaces the hero and the follow steer moves her to the heel slot
  // on the next tick, so the cost is one frame of coincident bodies against a
  // guarantee that the ground under her holds a body (comp's R4.5 note — it
  // is the kind of thing that reads as a bug in a screenshot, so it is
  // written down here rather than discovered there).
  stages.forEach((st, si) => {
    if (!st.captive || si >= stage || !state.stages[si]?.cleared) return;
    const b = state.bystanders.find((by) => by.name === st.captive!.name);
    if (!b) return;
    b.ai = "following";
    b.crossTicks = 0;
    const hold = captiveHoldStage(stages, st.captive);
    const post = hold >= 0 && stage >= hold ? state.stages[hold - 1] : undefined;
    b.x = post ? post.exitX : state.hero.x;
    b.z = post ? post.exitZ : state.hero.z;
    b.vx = 0;
    b.vz = 0;
  });
  if (foundHas(found, "weave")) applyGrant(state, null, "weave");
  for (const p of state.pickups) {
    if (foundHas(found, p.kind)) {
      p.taken = true;
      applyGrant(state, null, p.kind);
    }
  }
}
