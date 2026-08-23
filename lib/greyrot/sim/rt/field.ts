/**
 * The ground field — patches of water, fire, oil and ice lying on the world.
 *
 * This is the half of the design the turn engine could never have had, and it
 * is the reason real-time is worth the third rewrite. The status matrix stops
 * being a rule about a target and becomes a property of the *floor*: you oil a
 * corridor, back through it, and light it twenty seconds later. Nothing in
 * `content/statuses.ts` had to change for that to work — the matrix was always
 * keyed on "what is already here", and the floor is now allowed to be a thing
 * that is already here.
 *
 * Deterministic: no wall clock, no randomness, durations in ticks. Patch ids
 * come from a counter in the state so a replay reproduces them exactly.
 *
 * Bounded on purpose: patches merge with overlapping neighbours of the same
 * kind and the list is capped, because an uncapped field is both a save-size
 * problem (§7) and the thing that would blow the Chromebook budget (§5).
 */

import {
  PATCH_REACTION,
  PATCH_SLIP,
  PATCH_STATUS,
  PATCH_TICKS,
  type Element,
  type PatchKind,
  type StatusId,
} from "../../content";

export interface FieldPatch {
  id: number;
  kind: PatchKind;
  x: number;
  z: number;
  r: number;
  ticksLeft: number;
  /** Ticks it started with, so the renderer can fade it out honestly. */
  totalTicks: number;
}

/**
 * Hard cap on simultaneous patches.
 *
 * 48 at a 2 m radius covers a whole arena floor. Past that, the oldest is
 * retired rather than refusing the new one — a spell that silently does
 * nothing because of an invisible budget is worse than a floor that forgets.
 */
export const MAX_PATCHES = 48;

/** Merge distance: a new patch this close to a same-kind one grows it instead. */
const MERGE_FACTOR = 0.75;

/**
 * Lay a patch, merging into an overlapping same-kind neighbour if there is one.
 *
 * Returns the patch that ended up carrying it, which may be an existing one.
 */
export function addPatch(
  patches: FieldPatch[],
  nextId: () => number,
  kind: PatchKind,
  x: number,
  z: number,
  r: number,
  ticks = PATCH_TICKS[kind],
): FieldPatch {
  for (const p of patches) {
    if (p.kind !== kind) continue;
    const d = Math.hypot(p.x - x, p.z - z);
    if (d > (p.r + r) * MERGE_FACTOR) continue;
    // Grow toward the new centre rather than snapping to it, so repeated casts
    // in one place spread a pool instead of teleporting it.
    const grown = Math.min(5.5, Math.max(p.r, (d + r + p.r) * 0.5));
    p.x += (x - p.x) * 0.35;
    p.z += (z - p.z) * 0.35;
    p.r = grown;
    p.ticksLeft = Math.max(p.ticksLeft, ticks);
    p.totalTicks = Math.max(p.totalTicks, ticks);
    return p;
  }

  if (patches.length >= MAX_PATCHES) {
    // Retire whichever has least life left — the least missed.
    let oldest = 0;
    for (let i = 1; i < patches.length; i++) {
      if (patches[i]!.ticksLeft < patches[oldest]!.ticksLeft) oldest = i;
    }
    patches.splice(oldest, 1);
  }

  const patch: FieldPatch = {
    id: nextId(),
    kind,
    x,
    z,
    r,
    ticksLeft: ticks,
    totalTicks: ticks,
  };
  patches.push(patch);
  return patch;
}

/** Every patch containing this point, innermost first is not guaranteed. */
export function patchesAt(
  patches: readonly FieldPatch[],
  x: number,
  z: number,
): FieldPatch[] {
  const out: FieldPatch[] = [];
  for (const p of patches) {
    const dx = x - p.x;
    const dz = z - p.z;
    if (dx * dx + dz * dz <= p.r * p.r) out.push(p);
  }
  return out;
}

/** Statuses the floor imposes on anything standing at this point. */
export function fieldStatusesAt(
  patches: readonly FieldPatch[],
  x: number,
  z: number,
): StatusId[] {
  const out: StatusId[] = [];
  for (const p of patchesAt(patches, x, z)) {
    const s = PATCH_STATUS[p.kind];
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

/** Friction multiplier at this point — oil is slick, ice is worse. */
export function fieldSlipAt(
  patches: readonly FieldPatch[],
  x: number,
  z: number,
): number {
  let slip = 1;
  for (const p of patchesAt(patches, x, z)) {
    slip = Math.max(slip, PATCH_SLIP[p.kind]);
  }
  return slip;
}

/**
 * An element lands on the field. Patches transform, vanish, or ignore it.
 *
 * Returns the ids of patches that CONDUCTED — water struck by lightning — so
 * the caller can chain into everything standing in them. Conduction is handled
 * by the caller rather than here because it needs the actor list, and this
 * module deliberately knows nothing about actors.
 */
export function elementOnField(
  patches: FieldPatch[],
  nextId: () => number,
  element: Element,
  x: number,
  z: number,
  radius: number,
): { conducted: FieldPatch[]; ignited: FieldPatch[] } {
  const conducted: FieldPatch[] = [];
  const ignited: FieldPatch[] = [];

  for (const p of [...patches]) {
    const d = Math.hypot(p.x - x, p.z - z);
    if (d > p.r + radius) continue;

    if (p.kind === "water" && element === "lightning") {
      conducted.push(p);
      continue;
    }

    const reaction = PATCH_REACTION[p.kind]?.[element];
    if (reaction === undefined) continue;

    if (reaction === null) {
      const i = patches.indexOf(p);
      if (i >= 0) patches.splice(i, 1);
      continue;
    }

    if (reaction !== p.kind) {
      // Oil becoming fire is the discovery everybody makes first, and it should
      // be bigger than what lit it — the whole slick goes up, not the bit you
      // hit. Radius is preserved and life is reset from the NEW kind's budget.
      const was = p.kind;
      p.kind = reaction;
      p.ticksLeft = PATCH_TICKS[reaction];
      p.totalTicks = PATCH_TICKS[reaction];
      if (was === "oil" && reaction === "fire") {
        p.r = Math.min(5.5, p.r * 1.25);
        ignited.push(p);
      }
    }
  }

  void nextId;
  return { conducted, ignited };
}

/**
 * Advance the field one tick: fire spreads into touching oil, everything ages.
 *
 * Fire spreading is capped to one new ignition per tick. Without the cap a
 * field of connected oil converts in a single frame, which reads as a bug
 * rather than as a fire — the spread has to be *watchable* to be the payoff.
 */
export function stepField(patches: FieldPatch[]): FieldPatch[] {
  const ignited: FieldPatch[] = [];

  outer: for (const fire of patches) {
    if (fire.kind !== "fire") continue;
    for (const oil of patches) {
      if (oil.kind !== "oil") continue;
      const d = Math.hypot(fire.x - oil.x, fire.z - oil.z);
      if (d > fire.r + oil.r) continue;
      oil.kind = "fire";
      oil.ticksLeft = PATCH_TICKS.fire;
      oil.totalTicks = PATCH_TICKS.fire;
      oil.r = Math.min(5.5, oil.r * 1.25);
      ignited.push(oil);
      break outer;
    }
  }

  for (let i = patches.length - 1; i >= 0; i--) {
    if (--patches[i]!.ticksLeft <= 0) patches.splice(i, 1);
  }
  return ignited;
}
