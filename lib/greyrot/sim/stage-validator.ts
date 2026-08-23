/**
 * The stage validator (R3): every placement rule chapter 1 paid for in
 * playtest rounds, held against ANY stage list at build time.
 *
 * Each rule is a scar with a paper trail — gates inside trigger discs
 * (fourth playtest), finds inside take envelopes (the SPARK bug), Sella
 * inside the village trigger (round 5), a "dry" pool approach that wasn't
 * (a radius misread as a diameter) — and the hand-written tests that pinned
 * them protected only the stages that existed when they were written. This
 * validator GENERATES those assertions from the declaration, so the next
 * twelve stages inherit every lesson without anyone re-typing it.
 *
 * Pure and sim-side: takes a BUILT world+state (buildScenario) plus the
 * declaration it was built from, returns violations. Every violation names
 * the stage, the rule id, and the offending entity with coordinates — an
 * "invalid" without a where is not a diagnosis (comp's audit standard).
 *
 * One honest note on V2: the road is GENERATED through every exit, so
 * "gate-off-road" cannot be authored into existence today. The rule stays
 * because it guards the MACHINERY (a routing regression that stops visiting
 * exits would trip it), not the author.
 */

import { BIOMES, FOES, STAGES, captiveHoldStage, type StageDef } from "../content";
import { ALLY_JOIN_RADIUS, CORRIDOR_HALF, HERO_RADIUS, MAX_SPEED } from "./constants";
import {
  ARRIVAL_CUE_RADIUS,
  ENCOUNTER_FOV_DEG,
  ENCOUNTER_VIEW_HEIGHT,
  ENCOUNTER_VIEW_LOOK_HEIGHT,
  FRAME_AUDIT_ASPECTS,
  STAGE_VIEW_DISTANCE,
  STAGE_VIEW_HEIGHT,
  VIEW_DISTANCE,
  VIEW_LEAD,
  VIEW_LEAD_TOWARD,
  VIEW_YAW,
} from "./staging";
import { PROP_PROFILE, profileApex, profileDiameter, propSurfaceDistance } from "./prop-volume";
import type { RtState } from "./rt/state";
import { PICKUP_RADIUS } from "./rt/step";
import { standable } from "./scenario";
import { isWetAt, type SimWorld } from "./world";
import type { ObstacleKind } from "./world/obstacles";

export interface StageViolation {
  /** The stage id the violation belongs to. */
  stage: string;
  /** The rule class — comp's audit is one deliberately broken stage per id. */
  rule:
    | "V1-foe-unstandable"
    | "V2-gate-off-road"
    | "V3-gate-trigger-gap"
    | "V4-find-envelope"
    | "V5-captive-margins"
    | "V6-arena-fit"
    | "V7-wet-dry-contract"
    | "V8-dangling-reference"
    | "V9-geometry-sanity"
    | "V10-prop-walked-line"
    | "V11-prop-stage-span"
    | "V12-arrival-off-frame"
    | "V13-prop-in-camera-sleeve";
  /** What, where — entity and coordinates, so the failure is a diagnosis. */
  detail: string;
}

const d2 = (ax: number, az: number, bx: number, bz: number): number =>
  Math.hypot(ax - bx, az - bz);

/**
 * THE WALKED ENVELOPE: how far from the road centreline the hero's BODY can
 * reach, in metres. Written as the expression and never as its value —
 * `5.027` has now been shipped stale at five sites in this repo, one of them
 * inside the sentence addressed to the implementer, so the evaluated form is
 * banned here on purpose (a search for the symbolic form cannot find an
 * evaluated copy — `METHOD.md` law 2).
 *
 * `MAX_SPEED` is in it because `pushOutOfBlockers` (`rt/step.ts`) runs on the
 * INTEGRATED, un-clamped position and the corridor clamp runs later in the
 * SAME tick, so the hero can be one tick of travel outside the clamp at the
 * instant blockers are evaluated. `HERO_RADIUS` because a blocker acts on the
 * hero's surface, not its centre. (comp's derivation, R5.)
 */
const WALKED_ENVELOPE = CORRIDOR_HALF + MAX_SPEED + HERO_RADIUS;
/**
 * ── THE CAMERA SLEEVE (V13) ──────────────────────────────────────────────
 *
 * **How far back along the walk the stage lens trails the hero.** Written as
 * the expression and never as its value: `5.027` has shipped stale at five
 * sites in this repo — one of them inside the sentence addressed to the
 * implementer — and a search for a symbolic form cannot find an evaluated
 * copy (`METHOD.md` law 2). The same discipline, one camera along.
 *
 * `render/camera.ts`'s `FRAMINGS.stage` IMPORTS `STAGE_VIEW_DISTANCE` and
 * `STAGE_VIEW_HEIGHT` from `staging.ts`, so this rule and the frame it governs
 * cannot drift: turn `height` again and V13 moves with it and reds if the
 * world no longer fits. That is precisely the property the near-lens fade
 * radius did not have.
 *
 * The derivation: the lens target is `lookPoint - distance * viewdir` with
 * `lookPoint = hero + lead`, and under `FollowYaw` the view direction IS the
 * walk direction — so on a settled walk the lens sits `distance - lead` behind
 * the hero ALONG the walk, with lead running from 0 (standing, or just
 * started) to its full boosted reach.
 *
 * ⚠️ **`STAGE_VIEW_DISTANCE + VIEW_LEAD * (1 + VIEW_LEAD_TOWARD)` = 10.8 m is
 * the bound on `|lens - hero|`, and it is NOT the bound on this chord.** The
 * distinction is the finding, and it cost a full wrong answer: V13 walks the
 * lens backward along the ROAD HEADING, and a straight chord that long on a
 * road that bends leaves the road entirely. Measured — a 10.8 m chord from
 * road sample 23 put the modelled lens **4.7 m off the road**, somewhere the
 * camera cannot stand, and reddened a probe hut **8 m** from the centreline.
 * The lens only reaches 10.8 m from the hero while the yaw has NOT caught up,
 * and in exactly that state it is off the heading axis, so the axis model
 * cannot represent it at all. **The transient is therefore outside this rule
 * and named in V13's header.** A model that tried to cover it would have to
 * give the lens a free yaw, which rejects every prop within 10 m of the road
 * including the entire village — that is what killed the first proposal.
 * `check-near-lens.mjs` Part B drives real input and therefore sees
 * transients; the two are complementary on purpose.
 */
const LENS_TRAIL = STAGE_VIEW_DISTANCE;

/**
 * The near end of the same band: a full lead pulls the frame forward until the
 * lens is nearly over the hero. |5.6 - 5.2| today.
 */
const LENS_NEAREST = Math.abs(STAGE_VIEW_DISTANCE - VIEW_LEAD * (1 + VIEW_LEAD_TOWARD));

/**
 * Metres of clear air a BROAD declared prop must leave around the stage lens.
 *
 * **This is our own constant, not a derivation** (`METHOD.md` law 1 — a
 * threshold computed from the thing it governs is green by construction). It
 * is chosen against the render-side mitigation it is backing up:
 * `render/world/detail.ts`'s near-lens fade reaches zero at 1.6 m, and
 * `scripts/check-near-lens.mjs` refuses to pass on a margin thinner than
 * 0.4 m. That gate reads the compiled GLSL back off the GPU and refuses to
 * run if the shader's literal has moved, so the cross-check is real and it
 * lives on the render side where the shader is.
 */
const SLEEVE_CLEARANCE = 2.0;

/**
 * What counts as BROAD, and it is the near-lens guard's own contract.
 *
 * The guard is a point-sphere test against a per-fragment distance: it clears
 * a thin occluder by dithering it away, and **structurally cannot clear a
 * surface wider than the bubble's diameter** — measured, the frame came out
 * 40.6% hut with a dithered hole punched in the near half. So a thin prop
 * inside the bubble is the guard WORKING and V13 is silent about it; a broad
 * one is a mass the guard can only perforate.
 *
 * **The exemption is derived from the declared geometry, never from a flag.**
 * A brazier's apex is 1.17 m and its widest point 1.28 m across, so the gating
 * bowl keeps standing beside the road and an author cannot opt anything out.
 * *A category that also functions as an exemption collects every failure that
 * cannot be fixed*, so this one is not writable.
 */
const SLEEVE_BROAD_DIAMETER = 3.2;


/**
 * Who places each obstacle kind. A `Record` over the closed `ObstacleKind`
 * union rather than a lookup with a default: adding a kind to that union
 * without answering "does a stage declaration place this?" is a COMPILE
 * error, so V10/V11 cannot silently acquire a subject they do not check.
 * (The alternative — a hard-coded list of prop kinds — is the enumeration
 * trap: it confirms what it already knows and can never refute.)
 */
const OBSTACLE_SOURCE: Record<ObstacleKind, "declared" | "scatter"> = {
  hut: "declared",
  brazier: "declared",
  tree: "scatter",
  rock: "scatter",
  cypress: "scatter",
  snag: "scatter",
};

/**
 * Distance from a point to the road CENTRELINE (the polyline, not its
 * vertices) plus the index of the nearest sample.
 *
 * Segment distance rather than vertex distance because the road is a
 * polyline and the hero walks the segments. It errs in the safe direction —
 * segment distance is never greater than vertex distance, so this can only
 * make a clearance rule stricter, never laxer.
 */
const roadReach = (
  world: SimWorld,
  x: number,
  z: number,
): { d: number; index: number } => {
  const path = world.roadPath;
  let d = Infinity;
  let index = 0;
  for (let i = 0; i < path.length; i++) {
    const a = path[i]!;
    const vd = d2(a.x, a.z, x, z);
    if (vd < d) {
      d = vd;
      index = i;
    }
    const b = path[i + 1];
    if (!b) continue;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l2 = dx * dx + dz * dz;
    if (l2 <= 0) continue;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2));
    const sd = d2(a.x + t * dx, a.z + t * dz, x, z);
    if (sd < d) {
      d = sd;
      index = t < 0.5 ? i : i + 1;
    }
  }
  return { d, index };
};

/**
 * Where a point lands in the ENCOUNTER frame, in pixels, for a frame centred
 * on `(tx, tz)`.
 *
 * Build-time only. This is the one place in `sim/` that models a lens, and it
 * is legal for the same reason `viewDirection()` is: **placement has to know
 * where the camera stands** (`staging.ts`). Nothing in `rt/` calls it, so no
 * tick and no hash depends on a render dial — the arrival points are AUTHORED
 * numbers and this only judges them.
 *
 * The projection is the standard one: lens at
 * `T + (-sin(yaw)·D, +H, -cos(yaw)·D)` looking at `T + (0, lookHeight, 0)`,
 * point in frame iff `|x_c/z_c| <= tan(fov/2)·aspect` and
 * `|y_c/z_c| <= tan(fov/2)`. Validated against the live camera by gfx before
 * either of us quoted a number from it: horizontal NDC agrees within 0.09 on
 * four real arrivals and every in/out verdict matches. Vertical is the softer
 * axis (flat-ground assumption), so the horizontal edge — which is where the
 * bug lived — is the half this is strongest on.
 */
function encounterPixels(
  world: SimWorld,
  tx: number,
  tz: number,
  px: number,
  pz: number,
  aspect: { w: number; h: number },
): { sx: number; sy: number; depth: number } {
  const ty = world.field.heightAt(tx, tz);
  const cx = tx - Math.sin(VIEW_YAW) * VIEW_DISTANCE;
  const cz = tz - Math.cos(VIEW_YAW) * VIEW_DISTANCE;
  const cy = ty + ENCOUNTER_VIEW_HEIGHT;
  // Forward, right, up — a standard right-handed view basis.
  let fx = tx - cx;
  let fy = ty + ENCOUNTER_VIEW_LOOK_HEIGHT - cy;
  let fz = tz - cz;
  const fl = Math.hypot(fx, fy, fz) || 1;
  fx /= fl;
  fy /= fl;
  fz /= fl;
  let rx = -fz;
  let rz = fx;
  const rl = Math.hypot(rx, rz) || 1;
  rx /= rl;
  rz /= rl;
  // up = right x forward (right has no y component, so this collapses)
  const uX = -rz * fy;
  const uY = rz * fx - rx * fz;
  const uZ = rx * fy;
  const dx = px - cx;
  const dy = world.field.heightAt(px, pz) - cy;
  const dz = pz - cz;
  const depth = dx * fx + dy * fy + dz * fz;
  const xc = dx * rx + dz * rz;
  const yc = dx * uX + dy * uY + dz * uZ;
  const tanH = Math.tan((ENCOUNTER_FOV_DEG * Math.PI) / 360);
  return {
    sx: ((xc / depth / (tanH * (aspect.w / aspect.h))) * 0.5 + 0.5) * aspect.w,
    sy: (0.5 - (yc / depth / tanH) * 0.5) * aspect.h,
    depth,
  };
}

/** Every obstacle a STAGE DECLARATION places, read back off the BUILT world. */
interface DeclaredProp {
  stage: number;
  kind: ObstacleKind;
  x: number;
  z: number;
  /** Blocking radius, read from the built obstacle — never recomputed here. */
  radius: number;
  /** The obstacle's own scale — V13 multiplies the declared volume by it. */
  scale: number;
  atRoad: boolean;
}

/**
 * Pair each declared prop with the obstacle it actually became.
 *
 * Read the BUILT ARTEFACT, not the recipe (`METHOD.md`): `setupTerrain`
 * derives a hut's radius from its scale and a brazier's from a constant, and
 * a copy of either arithmetic here would be a stale number waiting to happen.
 * `setupTerrain` places both at their authored coordinates with no nudging,
 * so the position match is exact — and a mismatch in either direction is
 * itself a finding, which is why both are reported.
 */
function declaredProps(
  world: SimWorld,
  stages: readonly StageDef[],
  bad: (stage: string, rule: StageViolation["rule"], detail: string) => void,
): DeclaredProp[] {
  const wanted = new Map<string, { stage: number; kind: ObstacleKind; atRoad: boolean }>();
  const key = (kind: string, x: number, z: number): string => `${kind}@${x},${z}`;
  stages.forEach((st, si) => {
    for (const h of st.terrain?.huts ?? []) {
      wanted.set(key("hut", h.at[0], h.at[1]), { stage: si, kind: "hut", atRoad: h.atRoad === true });
    }
    for (const b of st.terrain?.braziers ?? []) {
      wanted.set(key("brazier", b.at[0], b.at[1]), { stage: si, kind: "brazier", atRoad: b.atRoad === true });
    }
  });

  const out: DeclaredProp[] = [];
  const found = new Set<string>();
  for (const o of world.obstacles.list) {
    if (OBSTACLE_SOURCE[o.kind] !== "declared") continue;
    const k = key(o.kind, o.x, o.z);
    const w = wanted.get(k);
    if (!w) {
      bad("(world)", "V10-prop-walked-line", `${o.kind} at (${o.x.toFixed(1)}, ${o.z.toFixed(1)}) is in the obstacle list but no stage declares it — an authored blocker outside the declaration is a prop no rule can check`);
      continue;
    }
    found.add(k);
    out.push({ stage: w.stage, kind: o.kind, x: o.x, z: o.z, radius: o.radius, scale: o.scale, atRoad: w.atRoad });
  }
  for (const [k, w] of wanted) {
    if (found.has(k)) continue;
    bad(stages[w.stage]?.id ?? "?", "V10-prop-walked-line", `declared ${k} never became an obstacle — the declaration and the built world disagree`);
  }
  return out;
}

/**
 * Validate a BUILT scenario against its declaration. `stages` must be the
 * same list the world was built from.
 */
export function validateStages(
  world: SimWorld,
  s: RtState,
  stages: readonly StageDef[] = STAGES,
): StageViolation[] {
  const out: StageViolation[] = [];
  const bad = (stage: string, rule: StageViolation["rule"], detail: string): void => {
    out.push({ stage, rule, detail });
  };

  /* ----------------------------------------------- V8: references first */
  const seen = new Set<string>();
  stages.forEach((st) => {
    if (seen.has(st.id)) bad(st.id, "V8-dangling-reference", `duplicate stage id "${st.id}"`);
    seen.add(st.id);
    if (st.biome && !(st.biome in BIOMES)) {
      bad(st.id, "V8-dangling-reference", `unknown biome "${st.biome}"`);
    }
    for (const m of st.markers) {
      for (const f of m.foes) {
        if (!(f.kindId in FOES)) {
          bad(st.id, "V8-dangling-reference", `unknown foe kind "${f.kindId}" at marker (${m.at[0]}, ${m.at[1]})`);
        }
      }
    }
    if (st.captive && st.captive.name.length === 0) {
      bad(st.id, "V8-dangling-reference", "captive with an empty name");
    }
    // A hold biome no stage in the chain ever reaches is a follower who never
    // stops — the declaration reads as a rule and enforces nothing (R4.5).
    if (st.captive?.holdBiome && captiveHoldStage(stages, st.captive) < 0) {
      bad(
        st.id,
        "V8-dangling-reference",
        `"${st.captive.name}" holds at biome "${st.captive.holdBiome}", which no stage in the chain enters`,
      );
    }
  });

  /* -------------------------------------------------- V9: geometry sanity */
  stages.forEach((st) => {
    if (!(st.exit.r > 0)) bad(st.id, "V9-geometry-sanity", `exit radius ${st.exit.r} at (${st.exit.x}, ${st.exit.z})`);
    for (const m of st.markers) {
      if (m.radius !== undefined && !(m.radius > 0)) {
        bad(st.id, "V9-geometry-sanity", `trigger radius ${m.radius} at (${m.at[0]}, ${m.at[1]})`);
      }
      if (m.arena !== undefined && !(m.arena > 0)) {
        bad(st.id, "V9-geometry-sanity", `arena radius ${m.arena} at (${m.at[0]}, ${m.at[1]})`);
      }
    }
    for (const w of st.terrain?.water ?? []) {
      if (!(w.r > 0)) bad(st.id, "V9-geometry-sanity", `water radius ${w.r} at (${w.at[0]}, ${w.at[1]})`);
    }
    for (const h of st.terrain?.huts ?? []) {
      if (!(h.scale > 0)) bad(st.id, "V9-geometry-sanity", `hut scale ${h.scale} at (${h.at[0]}, ${h.at[1]})`);
    }
  });

  /* -------------------------- V1 + V6: the PLACED fights, from the state */
  for (const m of s.markers) {
    const st = stages[m.stage];
    if (!st) continue;
    for (const f of m.foes) {
      const fx = m.x + f.dx;
      const fz = m.z + f.dz;
      if (!standable(world, fx, fz)) {
        bad(st.id, "V1-foe-unstandable", `${f.kindId} at (${fx.toFixed(1)}, ${fz.toFixed(1)}) — placed spawn fails walkability (did terrain land on a fight?)`);
      }
      const body = FOES[f.kindId]?.radius ?? 0;
      const ring = Math.hypot(f.dx, f.dz) + body;
      if (ring > m.arena) {
        bad(st.id, "V6-arena-fit", `${f.kindId} at offset (${f.dx.toFixed(1)}, ${f.dz.toFixed(1)}) needs ${ring.toFixed(1)} m of ring, arena is ${m.arena}`);
      }
    }
    // R5's valve: an ARRIVAL is a foe and owes every guarantee a spawn owes.
    // It arrives mid-fight, when the player is busy and the arena is full, so
    // a body that lands unstandable or straddling the ring is worse here than
    // at spawn — nobody is watching the edge of the clearing.
    if (m.reinforce) {
      if (!(m.reinforce.every > 0) || !(m.reinforce.after >= 0) || m.reinforce.from.length === 0) {
        bad(st.id, "V9-geometry-sanity", `reinforcement cadence ${m.reinforce.every} / gate ${m.reinforce.after} / ${m.reinforce.from.length} entries`);
      }
      if (!(m.reinforce.kindId in FOES)) {
        bad(st.id, "V8-dangling-reference", `reinforcement spawns unknown foe kind "${m.reinforce.kindId}"`);
      }
      const body = FOES[m.reinforce.kindId]?.radius ?? 0;
      for (const e of m.reinforce.from) {
        const ax = m.x + e.dx;
        const az = m.z + e.dz;
        if (!standable(world, ax, az)) {
          bad(st.id, "V1-foe-unstandable", `reinforcement entry at (${ax.toFixed(1)}, ${az.toFixed(1)}) fails walkability`);
        }
        const ring = Math.hypot(e.dx, e.dz) + body;
        if (ring > m.arena) {
          bad(st.id, "V6-arena-fit", `reinforcement entry at offset (${e.dx.toFixed(1)}, ${e.dz.toFixed(1)}) needs ${ring.toFixed(1)} m of ring, arena is ${m.arena}`);
        }
      }
    }
  }

  /* ------------------------------------------- V2: gates ride the road */
  stages.forEach((st, si) => {
    const gi = world.gateIndices[si];
    const sample = gi !== undefined ? world.roadPath[gi] : undefined;
    if (!sample || d2(sample.x, sample.z, st.exit.x, st.exit.z) > st.exit.r) {
      bad(st.id, "V2-gate-off-road", `exit (${st.exit.x}, ${st.exit.z}) r ${st.exit.r} contains no road sample`);
    }
    if (si > 0 && gi !== undefined && world.gateIndices[si - 1] !== undefined) {
      if (gi <= world.gateIndices[si - 1]!) {
        bad(st.id, "V2-gate-off-road", `gate arc index ${gi} not past the previous gate's ${world.gateIndices[si - 1]}`);
      }
    }
  });

  /* --------------------------------- V3: a stride between gate and next */
  stages.forEach((st, si) => {
    const next = stages[si + 1];
    if (!next) return;
    for (const m of s.markers) {
      if (m.stage !== si + 1) continue;
      const gap = d2(st.exit.x, st.exit.z, m.x, m.z) - st.exit.r - m.radius;
      if (gap <= 0) {
        bad(st.id, "V3-gate-trigger-gap", `gate (${st.exit.x}, ${st.exit.z}) overlaps ${next.id}'s trigger at (${m.x.toFixed(1)}, ${m.z.toFixed(1)}) by ${(-gap).toFixed(2)} m`);
      }
    }
  });

  /* --------------------------------------------- V4: the find envelope */
  for (const p of s.pickups) {
    const st = stages[p.stage];
    if (!st) continue;
    if (!standable(world, p.x, p.z)) {
      bad(st.id, "V4-find-envelope", `${String(p.kind)} find at (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) is not standable`);
    }
    const gd = d2(p.x, p.z, st.exit.x, st.exit.z);
    if (gd <= 0.8) {
      bad(st.id, "V4-find-envelope", `${String(p.kind)} find sits on its own gate (${gd.toFixed(2)} m)`);
    }
    for (const m of s.markers) {
      if (m.stage !== p.stage + 1) continue;
      const gap = d2(p.x, p.z, m.x, m.z);
      if (gap < m.radius + PICKUP_RADIUS) {
        bad(st.id, "V4-find-envelope", `${String(p.kind)} find at (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) inside the next fight's take envelope (${gap.toFixed(1)} < ${(m.radius + PICKUP_RADIUS).toFixed(1)})`);
      }
    }
    // Reachable inside its own stretch's corridor (the SPARK doubleback rule).
    const from = p.stage > 0 ? (world.gateIndices[p.stage - 1] ?? 0) : 0;
    let best = Infinity;
    for (let i = from; i < world.roadPath.length; i++) {
      const r = world.roadPath[i]!;
      best = Math.min(best, d2(p.x, p.z, r.x, r.z));
    }
    if (best > CORRIDOR_HALF) {
      bad(st.id, "V4-find-envelope", `${String(p.kind)} find at (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) outside its legal corridor (${best.toFixed(1)} > ${CORRIDOR_HALF})`);
    }
  }

  /* ------------------------------------------- V5: captive rescue beats */
  stages.forEach((st, si) => {
    if (!st.captive) return;
    const b = s.bystanders.find((by) => by.name === st.captive!.name);
    if (!b) {
      bad(st.id, "V5-captive-margins", `captive "${st.captive.name}" was never placed`);
      return;
    }
    const prev = stages[si - 1];
    if (prev) {
      // The rescue fires ALLY_JOIN_RADIUS short of the captive along the
      // approach from the previous gate — the beat must not collide with
      // the seam (round 5's scar, generalized).
      const dd = d2(b.x, b.z, prev.exit.x, prev.exit.z) || 1;
      const rx = b.x - ((b.x - prev.exit.x) / dd) * ALLY_JOIN_RADIUS;
      const rz = b.z - ((b.z - prev.exit.z) / dd) * ALLY_JOIN_RADIUS;
      const gateGap = d2(rx, rz, prev.exit.x, prev.exit.z) - prev.exit.r;
      if (gateGap < 0.5) {
        bad(st.id, "V5-captive-margins", `"${st.captive.name}"'s rescue point (${rx.toFixed(1)}, ${rz.toFixed(1)}) is ${gateGap.toFixed(2)} m from ${prev.id}'s gate disc (needs ≥ 0.5)`);
      }
      for (const m of s.markers) {
        if (m.stage !== si) continue;
        if (d2(b.x, b.z, m.x, m.z) <= m.radius) {
          bad(st.id, "V5-captive-margins", `"${st.captive.name}" at (${b.x.toFixed(1)}, ${b.z.toFixed(1)}) stands inside the fight's trigger disc`);
        }
        const introGap = d2(rx, rz, m.x, m.z) - m.radius;
        if (introGap < 1.0) {
          bad(st.id, "V5-captive-margins", `"${st.captive.name}"'s intro starts ${introGap.toFixed(2)} m before the fight's trigger (needs ≥ 1.0)`);
        }
        break; // the first fight of the stage is the beat that matters
      }
    }
    /* ------------------------------------------------ the post (R4.5) */
    // A follower with a `holdBiome` spends the rest of the chapter standing at
    // one authored point, so that point owes the same margins her rescue spot
    // does. `applyResume` puts her there with NO world to ask — "standable by
    // construction" is a claim this rule is what makes true.
    const hold = captiveHoldStage(stages, st.captive);
    if (hold < 0) return;
    if (hold <= si) {
      bad(st.id, "V5-captive-margins", `"${st.captive.name}" holds at stage ${hold} ("${stages[hold]?.id ?? "?"}"), at or before the stage that frees her — she would never follow at all`);
      return;
    }
    const gate = stages[hold - 1]!.exit;
    if (!standable(world, gate.x, gate.z, HERO_RADIUS)) {
      bad(st.id, "V5-captive-margins", `"${st.captive.name}"'s post at (${gate.x}, ${gate.z}) — ${stages[hold - 1]!.id}'s gate — has no room for a body`);
    }
    // And she waits OUTSIDE the fight she is refusing to walk into: the post
    // is a gate, and the ring drawn round the first fight past it must not
    // reach her (fun's ruling is that the composed fight is hers to miss).
    for (const m of s.markers) {
      if (m.stage !== hold) continue;
      const reach = m.arena - d2(gate.x, gate.z, m.x, m.z);
      if (reach >= 0) {
        bad(st.id, "V5-captive-margins", `"${st.captive.name}"'s post at (${gate.x}, ${gate.z}) is ${reach.toFixed(2)} m inside ${stages[hold]!.id}'s arena ring at (${m.x.toFixed(1)}, ${m.z.toFixed(1)})`);
      }
    }
  });

  /* --------------------------------------- V7: the wet/dry contract */
  stages.forEach((st, si) => {
    if (isWetAt(world, st.exit.x, st.exit.z)) {
      bad(st.id, "V7-wet-dry-contract", `gate (${st.exit.x}, ${st.exit.z}) stands in water`);
    }
    // Placed markers keep declaration order within a stage, so the zip is
    // by index — position matching would fail for non-exact markers, which
    // placement may nudge to flat ground.
    const placed = s.markers.filter((m) => m.stage === si);
    for (let k = 0; k < placed.length; k++) {
      const m = placed[k]!;
      const decl = st.markers[k];
      if (!decl?.wet) continue;
      for (const f of m.foes) {
        if (!isWetAt(world, m.x + f.dx, m.z + f.dz)) {
          bad(st.id, "V7-wet-dry-contract", `declared-wet fight: ${f.kindId} at (${(m.x + f.dx).toFixed(1)}, ${(m.z + f.dz).toFixed(1)}) spawns DRY — the teach became luck`);
        }
      }
      // The dry approach: the trigger-crossing point on the walk from the
      // previous gate must be dry, or the lesson opens as a wet ambush.
      const prev = stages[si - 1];
      if (prev) {
        const dd = d2(prev.exit.x, prev.exit.z, m.x, m.z) || 1;
        const cx = m.x + ((prev.exit.x - m.x) / dd) * m.radius;
        const cz = m.z + ((prev.exit.z - m.z) / dd) * m.radius;
        if (isWetAt(world, cx, cz)) {
          bad(st.id, "V7-wet-dry-contract", `declared-wet fight's trigger line at (${cx.toFixed(1)}, ${cz.toFixed(1)}) is already wet on the approach`);
        }
      }
    }
  });

  //
  // ⚠️ **A PROJECTED CENTRE POINT CANNOT SITE AN EMITTER** (R7, fun). This
  // projects a body and its arrival ring — geometry, which is what it is for.
  // It says nothing about where a FIRE, a plume or a glow lands: measured, a
  // village fire whose projected centre sat 259 px below an 800×450 frame
  // filled ~30% of that frame with its flame column. V13 carries the same
  // caveat. Neither rule may be quoted about an emitter.
  /* ------------------ V12: every arrival enters where the player is looking */
  //
  // fun's binding readability condition on `reinforce`, made structural. The
  // declaration says it in its own words — *"an arrival the player cannot see
  // coming reads as 'the game is adding enemies', which is the one way this
  // mechanic fails even when the sign is right"* — and it shipped with half
  // its ring off camera, because "the ring edge" was reasoned about as a
  // distance from the fight and the frame is not a circle around the fight.
  //
  // THE SUBJECT IS THE CUE, NOT THE BODY. The gather is what draws the eye to
  // the arrival, so the whole `ARRIVAL_CUE_RADIUS` ring must be inside the
  // frame. fun caught the case that distinction exists for: a point whose
  // body landed on screen at 77 px while its gather clipped the edge — the
  // focal point in the picture and the thing pointing at it outside it.
  //
  // EVERY POINT, EVERY AUDITED ASPECT — never a window of arrivals. The
  // measurement that filed this bug came from a log of 7 of 12 arrivals whose
  // cycle order had already spent the east entries, and it read as "only the
  // north point is ever in frame" (`METHOD.md` 12: one window is not the
  // distribution). Two of the eight points were still UNMEASURED at 800x450
  // when the fix was specified. Enumerating settles them without waiting for
  // a cycle to spend the right arrival.
  //
  // ── CURRENT STATE ── PASSES, worst margin 88 px. REGRESSION GUARD. It was
  // seen red on the shipped ring it was written for: 5 of 8 entries out, the
  // worst 1521 px below the frame at 1280x800.
  {
    const marginPx = (a: { w: number; h: number }): number => 0.05 * Math.min(a.w, a.h);
    for (const m of s.markers) {
      const st = stages[m.stage];
      if (!st || !m.reinforce) continue;
      // The frame during a fight is the hero pulled toward the pack centroid,
      // and both are clamped to this arena — so the marker is the frame's
      // resting centre and the honest place to evaluate from. What this does
      // NOT claim: that the guarantee survives a hero pinned to the rim. The
      // fight frame is pulled up to `ENCOUNTER_FIGHT_BIAS` toward the pack,
      // and MEASURED, no ring survives more than ~1.0 m of that drift with
      // its gather intact — so the bias is documented in `staging.ts` and
      // deliberately NOT spent here as an erosion term, because a rule that
      // can never be satisfied is not a rule (`METHOD.md` 7c, 15).
      for (const e of m.reinforce.from) {
        const ex = m.x + e.dx;
        const ez = m.z + e.dz;
        for (const a of FRAME_AUDIT_ASPECTS) {
          const need = marginPx(a);
          // The entry, then its gather ring: twelve samples is enough to
          // catch an edge on any side, and the worst one is the verdict.
          let worst = Infinity;
          let where = { sx: 0, sy: 0 };
          for (let k = 0; k <= 12; k++) {
            const px = k === 0 ? ex : ex + Math.sin((k * Math.PI) / 6) * ARRIVAL_CUE_RADIUS;
            const pz = k === 0 ? ez : ez + Math.cos((k * Math.PI) / 6) * ARRIVAL_CUE_RADIUS;
            const p = encounterPixels(world, m.x, m.z, px, pz, a);
            const inset =
              p.depth <= 0.5
                ? -Infinity
                : Math.min(p.sx, a.w - p.sx, p.sy, a.h - p.sy);
            if (inset < worst) {
              worst = inset;
              where = { sx: p.sx, sy: p.sy };
            }
          }
          if (worst < need) {
            bad(
              st.id,
              "V12-arrival-off-frame",
              `arrival entry [${e.dx.toFixed(2)}, ${e.dz.toFixed(2)}] at (${ex.toFixed(1)}, ${ez.toFixed(1)}) is ${(need - worst).toFixed(0)} px outside the ${a.w}x${a.h} encounter frame with its ${ARRIVAL_CUE_RADIUS} m gather (worst sample at sx ${where.sx.toFixed(0)}, sy ${where.sy.toFixed(0)}; needs ${need.toFixed(0)} px of inset) — a body the player cannot see arrive reads as the game adding enemies`,
            );
          }
        }
      }
    }
  }

  /* ------------------- V10 + V11: the props, against the road they stand on */
  //
  // SCOPE, and it is the whole rule: these two govern props that PLACE AN
  // OBSTACLE. Decoration — gate posts, waymark stones, anything routed
  // through `buildLandmarks` — is deliberately out of scope, because it
  // carries no collision circle: nothing pushes the hero, so it cannot bend
  // the walked line and has no clearance to owe. Twelve gate posts have been
  // walked through since gates existed, inside the measured beats. If a
  // future prop joins `world.obstacles`, `OBSTACLE_SOURCE` is where it must
  // say so, and the compiler will insist.
  //
  // ── CURRENT STATE ── Both PASS on the shipped chapter. They are
  // REGRESSION GUARDS, not reproductions. V10's teeth are shown by a probe
  // post at 4.95 m from the centreline (red) and 5.10 m (green) — 4.95 fires
  // only under `CORRIDOR_HALF + MAX_SPEED + HERO_RADIUS` and not under the
  // superseded `CORRIDOR_HALF + HERO_RADIUS`, so the red-proof also proves
  // the constant. V11's teeth are shown by the kilns case that filed it: a
  // prop declared for one stage, standing past that stage's gate.
  //
  // WHAT THE MEASUREMENT SAID (R5, before either was written): EIGHT of the
  // shipped world's NINE authored blockers stand inside the walked envelope.
  // "Declared props stay out of the walk" was never true of this game, so
  // V10 is not that rule — it is the rule that a prop in the walked line
  // must SAY SO. The tightest margin in the chapter is damp_pyres' west
  // bowl at 0.06 m outside; expect that one to flip first.
  {
    const props = declaredProps(world, stages, bad);
    for (const p of props) {
      const st = stages[p.stage];
      if (!st) continue;
      const road = roadReach(world, p.x, p.z);
      const surface = road.d - p.radius;

      /* ------------------------------------------------ V10: the walk */
      if (surface < WALKED_ENVELOPE && !p.atRoad) {
        bad(
          st.id,
          "V10-prop-walked-line",
          `${p.kind} at (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) puts its surface ${surface.toFixed(3)} m from the road centreline, inside the ${WALKED_ENVELOPE.toFixed(3)} m walked envelope (short by ${(WALKED_ENVELOPE - surface).toFixed(3)} m) — the hero's body reaches it and the walked line bends. Move it out, or declare \`atRoad: true\` and re-baseline the beats`,
        );
      }

      /* ------------------------- V13: the walking camera's sight sleeve */
      //
      // fun walked the mandatory s4->s5 approach and the hero is INVISIBLE
      // for part of it: a hut wall filling ~60% of frame at 12.5 m from the
      // well, the roof filling the left half at 10.5 m, clear at 8.8 m. That
      // is not prop framing, it is a playability defect on a walk every
      // player must make — and the same hut is why the well-ring reads as
      // pop-in, 0 visible pixels through the band and unmistakable at 8.8 m.
      //
      // WHY THE FADE CANNOT FIX IT, so nobody proposes it again: the radius
      // needed to cover a hut roof is larger than the radius that keeps
      // authored frames provably untouched. Those two constraints do not
      // overlap. The guard is a correct backstop for the THIN residual; the
      // broad case has to be an authoring rejection or it is owned by nobody.
      //
      // THE PREDICATE IS LENS-TO-SURFACE CLEARANCE, in 3D, and containment is
      // only its degenerate case. The first version of this rule (recorded in
      // LOOP.md as "the corrected rule") tested whether the lens stands INSIDE
      // the prop's volume; built and run, it reported 9-14 m of clearance for
      // every village hut while the driven `check-near-lens.mjs` measures the
      // lens 1.83 m INSIDE one. Two causes, both worth keeping:
      //   - the lens stands STAGE_VIEW_HEIGHT over the TERRAIN (`main.ts`
      //     passes the ground as the framed point's Y). STAGE_VIEW_LOOK_HEIGHT
      //     is where it LOOKS; adding it lifted the model 0.62 m, which is
      //     exactly enough to clear a 3.20 m hut apex and report "nothing
      //     there".
      //   - the volume table binned by VERTEX, and a roof has no vertices
      //     between its rim and its apex. See `prop-volume.ts`.
      //
      // ── WHAT THIS RULE CANNOT SEE, BY CONSTRUCTION ──
      //  1. LANDMARKS. It enumerates `declaredProps`, which reads the obstacle
      //     list; `buildLandmarks` props carry no collision circle. The
      //     well-ring, kilns, Great Snag, strike-stones and fallen giant are
      //     invisible to it, and so is the `overhead` flag — there is no
      //     overhead exemption here because there is nothing to exempt.
      //     `check-prop-clearance.mjs` and `check-near-lens.mjs` Part B remain
      //     their only cover.
      //  2. THE OFF-CENTRELINE WALK. The lens is swept along the road heading
      //     from centreline samples — the walk the game REQUIRES. Measured:
      //     allow the hero anywhere across the corridor and all four village
      //     huts read 0.00 m, so a rule built on the full reachable set
      //     rejects the village outright. That is what killed the first
      //     proposal, and naming the gap beats a rule that quietly excludes
      //     the case it fails.
      //  3. THE ENCOUNTER AND BOSS FRAMINGS. Stage lens only.
      //  4. WHETHER THE HERO IS VISIBLE. This asserts a clearance, which is a
      //     proxy for a picture. Visibility is a pixel and it belongs to a
      //     seat that looks at one.
      //  5. THE RENDER-SIDE GROUND CLAMP, deliberately. `main.ts` lifts the
      //     lens to `groundSampler + 2.2` when it is inside a hut's collision
      //     cylinder — measured firing on the shipped s4->s5 walk, 5.04 m over
      //     the terrain against 2.6 elsewhere. Modelling it here would let the
      //     mitigation excuse the defect it produces, because what the lift
      //     does is put the lens ABOVE the roof and the roof between the lens
      //     and the hero.
      //
      //  6. WHERE AN EMITTER'S LIGHT GOES. This projects a prop's SOLID, and a
      //     fire, a smoke plume or a glow is not where its geometry is. fun's
      //     own rig reported a village fire 259 px BELOW an 800×450 frame from
      //     its projected centre while the frame was ~30% filled with its flame
      //     column. **A projected centre point cannot site an emitter** — V12
      //     carries the same caveat, and neither rule should be quoted about
      //     one.
      //
      //  7. WHETHER A ROAD SAMPLE IS REACHABLE IN BOTH DIRECTIONS. The min is
      //     taken over every sample, and the one-way gates make some stretches
      //     unwalkable backward — gfx measured the southward village walk
      //     STALLING against the wall at arc 43. A worst case at an unreachable
      //     sample is a frame the game never shows, so this rule is knowingly
      //     over-strict there. Over-strict is the safe direction for a
      //     rejection and it stays until it rejects something we want.
      //
      // ⛔⛔ THE LENS AXIS IS WRONG. DO NOT TRUST THIS RULE'S NUMBERS. (R7, mech)
      //
      // `render/camera.ts:149` sets `FOLLOW_OFFSET = VIEW_YAW` (0.42 rad) and
      // line 206 applies it: `desired = atan2(movedDx, movedDz) +
      // FOLLOW_OFFSET`. **The walking camera's yaw is the commanded walk
      // direction PLUS 0.42 rad.** The sweep below places the lens behind the
      // RAW road heading with no offset term — a ~2.3 m error in lens position
      // at STAGE_VIEW_DISTANCE, which is larger than SLEEVE_CLEARANCE itself.
      //
      // Measured on the shipped world, clearance with the offset applied:
      //   (6.5, 36.0) 2.15 -> 1.11 · (22.95, 40.25) 2.28 -> 0.64
      //   (7.45, 44.75) 2.21 -> 0.40 · (20.6, 46.0) 2.10 -> 1.79
      // **All four under the 2.00 m sleeve, including the one this rule called
      // legal before anything moved.** The rule reports green on a world that
      // breaches its own predicate.
      //
      // ⚑ AND IT RETIRES THE EXCLUSION IN ITEM 2 BELOW. `check-near-lens.mjs`
      // Part B drives the REAL rig and failed on exactly these huts all cycle;
      // that was explained away as "V13 covers the road walk, Part B drives
      // off-road walks, the difference is the declared scope line." **Part B
      // was right and this rule was wrong.** A driven instrument disagreed
      // with a model and the disagreement was settled by an argument instead
      // of a measurement — the failure mode this file's own header is about.
      //
      // ⚑ THE REPAIR IS KNOWN: **the axis is `commanded + VIEW_YAW`.** (gfx,
      // R7, and it took two runs — the first said "neither model" and was
      // drawn from a stretch that could not tell them apart.)
      //
      // THE DISCRIMINATING RUN held **ArrowRight**, so the latched world
      // direction lands ~pi/2 from the authored yaw and the turn is decisive.
      // `s7-rise`, 34 free samples, 0 corridor-pinned:
      //
      //   lens, settled              **-0.713 rad, sd 0.001**
      //   commanded                   -1.151
      //   **commanded + VIEW_YAW**    **-0.731**   <- 0.018 rad away
      //   authored VIEW_YAW            0.420       <- 1.13 rad away
      //   lens - commanded           **0.4382 +/- 0.0014**  vs VIEW_YAW 0.42
      //
      // 0.018 rad is inside `DEADBAND_RELEASE` (0.05). The follow engages,
      // slews, and releases within the release band of the commanded axis.
      //
      // THE RESIDUAL IS A CONVERGENCE BAND AROUND THAT AXIS, NOT EVIDENCE
      // AGAINST IT — but it only CONVERGES on a decisive turn:
      //
      //   decisive turn (ArrowRight)  ~0.02 rad, and it is a real settle:
      //                               sd 0.000 across 16 independent flat windows
      //   **near the engage threshold, THE LENS DOES NOT SETTLE AT ALL.**
      //                               it drifts within ~0.13 rad sd
      //
      // The pathological case is **ArrowUp from rest**, which latches along the
      // camera's OWN forward — so the initial heading error is exactly
      // `FOLLOW_OFFSET` = 0.42, barely over `DEADBAND_ENGAGE` 0.35. Tracking
      // engages weakly and releases early, and the lens then **stops, and stops
      // again somewhere else**: of 180 samples, 106 qualify as locally flat
      // (range under 0.01 rad over 20 ticks) and those flat windows still sit
      // **sd 0.134 rad apart**. So the 0.706 this comment once quoted was never
      // a settle value — it was an average across a trajectory that does not
      // converge, and there is no single number to compare a prediction
      // against. **Do not model a settle point near the threshold; model a
      // band.**
      //
      // **Two earlier readings are withdrawn, in these words so the retraction
      // is legible: "the axis is neither model" and "there is no constant to
      // find". There is one, and it is `VIEW_YAW`** — the first reading was
      // drawn from a stretch where `commanded` and `authored` coincide and
      // which therefore could not rule between them.
      //
      // ⚠️ AND THE PROXY IS NOT EXACT EITHER, so do not read `roadHeading +
      // VIEW_YAW` as the finished answer. The real term is the **latched**
      // world direction (`rt-commands.ts` rule 4 — held movement latches at
      // keydown and does not re-pick), which on a bending road diverges from
      // the local road heading a build-time rule has to use.
      //
      // ⚑ **AND THE PROXY'S ERROR IS LARGEST EXACTLY WHERE THE HUTS ARE.** The
      // village doglegs three times — which is what defeated the first attempt
      // to solve their standoff, by 3 m — so the one stretch this rule most
      // needs to be right about is the one where `roadHeading` is furthest
      // from the latched heading. The shipped-world numbers above were taken
      // with `roadHeading + VIEW_YAW` and are a **best current estimate, not a
      // certified one. Do not re-site on them.**
      //
      // ⚠️ CALIBRATING THIS AGAIN? TWO TRAPS, BOTH PAID FOR IN REAL RUNS:
      //  - **`step(n, cmd)` NEVER TURNS THE CAMERA.** `followYaw.update` reads
      //    the `MoveLatch`, which `gatherRtCommands` fills from
      //    `input.moveIntent()`; `step(n, cmd)` pushes into the sim batch and
      //    never touches the latch, so the follow holds at the authored yaw
      //    forever. A calibration driven that way reports offsets that are
      //    **the authored yaw wearing the name of an offset** — caught on
      //    `lens 0.420 rad, sd 0.000` across three stretches. Use real key
      //    events. (CLAUDE.md §6's aim trap, one axis over: the follow lives
      //    on the same input seam.)
      //  - **A held key latches ONE world direction**, so on a bending road it
      //    walks the hero into the corridor wall and pins him. `s5-fen` came
      //    back 3 free of 180 samples, `s9-char` 28 of 180, `s9-char-right`
      //    **0 of 105**. All excluded, never averaged in. A first calibration
      //    from this seat died the same way.
      //  - **Drive a commanded heading deliberately offset from the authored
      //    yaw.** A held ArrowUp from rest makes `commanded` and `authored`
      //    numerically identical, and a stretch where two hypotheses coincide
      //    cannot rule between them — which is exactly how the first reading
      //    went wrong.
      //
      // ── CURRENT STATE ── GREEN AND NOT TO BE BELIEVED. It is a reproduction
      // of a model, not of the camera. What IS honest evidence that the R7
      // village move helped: `check-near-lens.mjs` PART A went from 1 FAIL to
      // green on the real rig (worst stage framing 1.70 -> 2.65 m), and gfx's
      // pixel rig recovered six fully-hidden poses across both walk directions
      // with none created. The move was good; this rule's margin for it was
      // fiction.
      //
      // ── SUPERSEDED CURRENT-STATE LINE, kept so the correction is legible ──
      // "GREEN, and now a REGRESSION GUARD."
      // ── CURRENT STATE ── GREEN, and now a REGRESSION GUARD. It landed as a
      // reproduction: three of the four village huts red, one legal where it
      // stood, every brazier silent on its own geometry — **a mixed real run,
      // which is stronger evidence than a planted break, because it shows the
      // rule responds to the real condition AND stays quiet where the
      // condition is absent.** The three then moved (R7: story's ruling on the
      // village's shape, gfx's pixel rig on the frames, fun's binding verdict
      // on the cost) and the shipped world clears by 2.10-2.28 m.
      {
        const profile = PROP_PROFILE[p.kind];
        if (!profile) {
          bad(
            st.id,
            "V13-prop-in-camera-sleeve",
            `${p.kind} at (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) is declared by a stage but has no volume in PROP_PROFILE — a declared prop with no shape would be silently exempt from the one rule written for declared props. Measure it off the mesh and add it (see prop-volume.ts)`,
          );
        } else if (profileDiameter(profile, p.scale) > SLEEVE_BROAD_DIAMETER) {
          const base = world.field.heightAt(p.x, p.z);
          const reach = LENS_TRAIL + profileDiameter(profile, p.scale) / 2 + SLEEVE_CLEARANCE;
          let worst = Infinity;
          let worstAt = { x: 0, z: 0, i: 0 };
          const path = world.roadPath;
          for (let i = 0; i < path.length; i++) {
            const here = path[i]!;
            if (d2(here.x, here.z, p.x, p.z) > reach + 1) continue;
            // The camera yaw settles on the walk, and on the road the walk is
            // the road: heading from the neighbouring samples, both ways,
            // because a stage can be walked back down inside its own stretch.
            const a = path[Math.max(0, i - 1)]!;
            const b = path[Math.min(path.length - 1, i + 1)]!;
            const hx = b.x - a.x;
            const hz = b.z - a.z;
            const len = Math.hypot(hx, hz) || 1;
            for (let t = LENS_NEAREST; t <= LENS_TRAIL + 1e-9; t += 0.1) {
              for (const dir of [1, -1]) {
                const lx = here.x - (hx / len) * t * dir;
                const lz = here.z - (hz / len) * t * dir;
                const ly = world.field.heightAt(lx, lz) + STAGE_VIEW_HEIGHT;
                const dist = propSurfaceDistance(profile, p.x, base, p.z, p.scale, lx, ly, lz);
                if (dist < worst) {
                  worst = dist;
                  worstAt = { x: lx, z: lz, i };
                }
              }
            }
          }
          if (worst < SLEEVE_CLEARANCE) {
            bad(
              st.id,
              "V13-prop-in-camera-sleeve",
              `${p.kind} at (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) is ${profileDiameter(profile, p.scale).toFixed(2)} m across and ${profileApex(profile, p.scale).toFixed(2)} m tall, and the walking lens passes ${worst.toFixed(2)} m from its surface at (${worstAt.x.toFixed(1)}, ${worstAt.z.toFixed(1)}) — road sample ${worstAt.i} — inside the ${SLEEVE_CLEARANCE.toFixed(2)} m sleeve (short by ${(SLEEVE_CLEARANCE - worst).toFixed(2)} m). A mass this wide cannot be dithered away by the near-lens guard, so it fills the frame and hides the hero. Move it out of the lens's path`,
            );
          }
        }
      }

      /* --------------------------------------- V11: the stage it is in */
      //
      // A prop's arc position is the road sample nearest it. Clearance-legal
      // and stage-correct are independent properties and only the first had
      // a checker: the kilns' first legal answer sat past its own stage's
      // gate, every geometric check green, met by the player two stages
      // later than the beat it was authored for.
      //
      // The exemption is a DECLARED footprint, not a flag: a stage with a
      // `terrain.flat` disc has said "this whole disc is my ground", and a
      // road may legitimately re-enter a settlement on several stretches —
      // which is exactly what the village road does across s3, s4 and s5.
      // A stage that wants the exemption has to carve the ground for it.
      const from = p.stage > 0 ? world.gateIndices[p.stage - 1] : 0;
      const to = world.gateIndices[p.stage];
      if (from === undefined || to === undefined) continue;
      if (road.index >= from && road.index <= to) continue;
      const flat = st.terrain?.flat;
      if (flat && d2(p.x, p.z, flat.at[0], flat.at[1]) <= flat.r) continue;
      const ownerIndex = stages.findIndex((_s, si) => {
        const f = si > 0 ? world.gateIndices[si - 1] : 0;
        const t = world.gateIndices[si];
        return f !== undefined && t !== undefined && road.index >= f && road.index <= t;
      });
      bad(
        st.id,
        "V11-prop-stage-span",
        `${p.kind} at (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) sits at road sample ${road.index}, outside ${st.id}'s span [${from}..${to}] — the player meets it during ${ownerIndex >= 0 ? `"${stages[ownerIndex]!.id}"` : "no stage"}. Move it into its own stretch, or declare the stage's \`terrain.flat\` footprint around it`,
      );

    }
  }

  return out;
}

/** One line per violation — the failure message a test or a human reads. */
export function formatViolations(v: readonly StageViolation[]): string {
  return v.map((x) => `${x.stage} ${x.rule}: ${x.detail}`).join("\n");
}
