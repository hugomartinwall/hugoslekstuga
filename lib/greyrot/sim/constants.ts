/**
 * Movement tuning. All values are PER TICK at 30 Hz — never per second, never
 * multiplied by a frame delta (CLAUDE.md §4).
 */

import { TICK_HZ } from "./tick";

/** Top ground speed, metres per tick (≈ 4.4 m/s — brisk ARPG jog). */
export const MAX_SPEED = 4.4 / TICK_HZ;

/**
 * Pivot brake: fraction of the input-OPPOSED velocity component kept per tick.
 *
 * `FRICTION` only fires with no input at all, so before this existed a full
 * 180° reversal fought its own momentum at plain accel for ~10 ticks — a third
 * of a second drifting the wrong way, which the first playtest read as
 * unresponsive ("cheap"). With the opposed component halved per tick a
 * reversal crosses zero in ~2 ticks. Perpendicular velocity is untouched, so
 * curved steering still arcs; only fighting your own momentum brakes.
 */
export const PIVOT_BRAKE = 0.5;

/**
 * Velocity multiplier per tick when there is no input. 0.7^5 ≈ 0.17, so the
 * hero stops in about a sixth of a second — responsive, not skatey.
 */
export const FRICTION = 0.7;

/** Below this speed with no input, snap to zero so idle is exactly idle. */
export const STOP_EPSILON = 0.003;

/** Hero collision radius, metres. */
export const HERO_RADIUS = 0.38;

/**
 * Half-width of the playable corridor around the road centreline, metres.
 * AT the wall treeline (`scenario.ts` plantWalls, offset ≈ 4.6 ± 1), so the
 * clamp engages exactly where the trunks stand and the stop reads as the
 * trees doing the stopping. Deliberately NOT past the treeline: a hero who
 * crosses the fence puts its trees between themself and the fixed camera,
 * and no placement rule can fell a wall the hero is hiding behind — measured
 * in the first browser drive as a frame full of canopy. The clamp yields to
 * the arena lock.
 */
export const CORRIDOR_HALF = 4.5;

/** Metres per tick the corridor clamp may pull — eased, never a snap. */
export const CORRIDOR_PULL = 0.2;

/**
 * Half-width of the ROAD SURFACE, metres — the paved band, not the walkable
 * corridor (CORRIDOR_HALF). One source of truth: the road carve, the exit
 * discs (2.4 by convention in `content/stages.ts`) and the arc-order
 * crossing's on/off-road split below all mean the same band.
 */
export const ROAD_HALF_WIDTH = 2.4;

/**
 * Guard radius for ARC-ORDER crossings (R1). Three findings in one geometry
 * hole: the exit discs (r 2.4) and Sella's join disc (3.0) span the ROAD
 * SURFACE, but the corridor clamp grants 4.5 m of lateral freedom — so a
 * verge walk could pass a gate unclosed, pass Sella un-rescued, and reach a
 * post-gate gem whose take then silently refused. The fix is the one-way
 * wall's own trick pointed forward: a thing on the road is CROSSED when the
 * hero's nearest legal road sample moves to or past its sample. This guard
 * keeps that rule local — it only fires within this radius of the crossed
 * sample, so a winding road cannot fire it across a hedge. Must exceed the
 * clamp's worst abeam distance: CORRIDOR_HALF plus a sample spacing (~1 m)
 * of slack.
 *
 * The DISC keeps every approach: a crossing must additionally HOLD for
 * CROSS_PERSIST_TICKS before it counts (see `roadArcFlipped`) — position
 * alone cannot tell a hairpin approach from a completed pass, and the
 * one-tick approach artifact cost the beats-check's 45-tick calm-approach
 * stride exactly its tick before the debounce existed.
 */
export const ROAD_CROSS_RADIUS = CORRIDOR_HALF + 1.0;

/**
 * Ticks an arc-order crossing must hold before it counts. A real pass keeps
 * the flip for tens of ticks (the ROAD_CROSS_RADIUS window is metres wide at
 * walking speed); the hairpin approach artifact keeps it for one, and the
 * gate disc — which owns every approach — resolves that tick first.
 */
export const CROSS_PERSIST_TICKS = 5;

/**
 * The flanker's blind arc (R2): a foe counts as "behind" while the dot of
 * the hero's facing with the hero→foe direction is at or below this. −0.15
 * puts the arc a little wider than a strict half-plane, so a hero who almost
 * faces the foe is still facing it for commit purposes — the kind must never
 * bite from anywhere the player could fairly claim to have been looking.
 * Facing is a unit vector and this is a dot product: no trig, per §4.
 */
export const FLANK_DOT = -0.15;

/**
 * Metres within which a flanker's stalk counter accrues. Wide enough that
 * the circling approach itself counts as the pre-tell (the cue has time to
 * ramp), tight enough that a flanker loitering across the arena is not
 * "stalking" anybody.
 */
export const FLANK_STALK_RANGE = 6.0;

/**
 * Ticks of recovery after a cast LAUNCHES before the next may commit — the
 * spam ceiling (third playtest: "d space d space" needs a loading bar). A
 * press during recovery buffers rather than drops, so mashing paces casts
 * instead of losing them.
 *
 * 8 is measured, not guessed: a single's wind-up is 6 ticks, so the full
 * cycle is 14 — exactly the funnel pilots' own cadence, which keeps every
 * curriculum timing intact (12 here starved the pilots ~30% and the direct
 * pilot died at the pool). The human spam ceiling still falls from ~5
 * casts/s to ~2.1. Sandbox dial: `setCastCooldown`.
 */
export const CAST_COOLDOWN_TICKS = 8;

/**
 * Maximum climbable grade: height gained per tick may not exceed
 * (distance moved this tick) × MAX_GRADE. 0.8 ≈ a 38.5° incline — a real
 * scramble limit.
 *
 * Deliberately a GRADE CAP rather than a check of the surface normal at the
 * destination: sampling slope at a point is grid-resolution dependent and let
 * the hero ratchet up cliff faces cell by cell. Capping height gained per
 * distance moved is resolution-independent and is the actual physics claim —
 * you cannot ascend faster than the max grade, full stop.
 */
export const MAX_GRADE = 0.8;

/**
 * Water is wadeable to this depth (metres below the waterline). Shallows are
 * walkable gameplay space — the M1 funnel's water-trough lightning teach
 * depends on that. Beyond it, water blocks.
 */
export const WADE_DEPTH = 0.45;

/**
 * A hero already deeper than WADE_DEPTH (knockback, later mechanics) may move
 * anywhere that doesn't take them more than this much deeper per step. The
 * first escape rule was monotone with a 1e-6 epsilon, and 4 cm shoreline
 * ripples pinned the hero in place forever — found by instrumenting the
 * water-escape test, not by playing.
 */
export const DEEP_STEP_TOLERANCE = 0.05;

/**
 * Facing turn rate: blend factor per tick toward the movement direction.
 * Full about-face in roughly 6–7 ticks. The default for foes and bystanders —
 * a readable charge is part of the telegraph.
 */
export const TURN_RATE = 0.35;

/**
 * The hero turns faster — about-face in ~4 ticks. Casts fire along facing, so
 * turn rate IS aim responsiveness, and it is one of the two sanctioned dials
 * when forward-fire feels imprecise (`CLAUDE.md` §12 — the other is blast
 * radius). Facing stays slaved to velocity: "aim is footwork" (§10.6).
 */
export const HERO_TURN_RATE = 0.5;

/* ----------------------------------------------------------------- units */

export const HERO_MAX_HP = 100;

/* ------------------------------------------------------- friendly fire */

/**
 * **The friendly-fire dial.** Fraction of the hero's OWN cast damage that
 * reaches the hero (`GAME_DESIGN.md` §3.2).
 *
 * The decision is *full status, reduced damage* — the same shape bystanders
 * already take. Set your own oil alight under your feet and you burn; what you
 * cannot do is delete yourself in the first sixty seconds, which is exactly
 * where §9's 80%-conversion bar is measured and where a player has least idea
 * what they are doing. Full self-damage is the Magicka answer and the funnier
 * one, but Magicka is co-op: dying there is a punchline someone witnesses, and
 * here it is just a restart.
 *
 * Deliberately ONE constant, and deliberately here rather than buried in
 * `rt/step.ts`, so a playtest verdict of "too punishing" is a one-line answer
 * and "make it Magicka" is `= 1`.
 *
 * Note what it does NOT scale: the status itself. Burning applied by your own
 * oil burns at the normal rate, because "full status" is the half of the rule
 * that makes the ground field frightening rather than decorative.
 */
export const HERO_SELF_DAMAGE = 0.35;

/**
 * Multiplier on the SELF form's nova damage — the R2/R6 nova dial's authored
 * default. 1.0 is the pre-dial behaviour; fun's baseline found the nova
 * dominant vs melee at 1.0 (full aimed damage, no aim requirement, no
 * self-chip), and the converged direction is < 1 so self becomes the
 * utility/setup form. The R2 sandbox sitting prices it provisionally
 * (`__sandbox.setNovaPower`); R6 owns the final number inside the full
 * worth-casting matrix pass. Seeds `RtState.selfPower`.
 */
export const SELF_FORM_POWER = 1.0;

/* ------------------------------------------------------------- defeat */

/**
 * The down window: ticks the hero lies there before the defeat is final.
 *
 * 150 ticks = 5 s, which is `CLAUDE.md` §8's number, not ours — it is the
 * window their action guidance wants a revive offer to live in.
 */
export const DOWN_TICKS = 5 * TICK_HZ;

/**
 * Invulnerability granted on revive. §8 asks for 2–3 s; this is 2.5.
 *
 * Long enough to walk out of the fire you died in, short enough that it is not
 * a free clear. Spent through the ordinary `iframes` field rather than a second
 * mechanism, so there is exactly one way to be untouchable.
 */
export const REVIVE_GRACE_TICKS = Math.round(2.5 * TICK_HZ);

/** Health restored by a revive, as a fraction of max. Not a full heal. */
export const REVIVE_HP_FRACTION = 0.5;

/* -------------------------------------------------------------- leash */

/**
 * How far the HERO may get from a fight before its foes give up and go home.
 *
 * A §10 knob — AI and positioning, never a stat. Without it a player outruns
 * one fight into the next and arrives with five foes, which is not difficulty,
 * it is the absence of encounter design.
 *
 * **Measured on the FIGHT's distance from the player, not the foe's**, and the
 * difference is not cosmetic. Keying it on how far the foe has strayed produces
 * a permanent oscillation: it gives up at the boundary, walks back, becomes
 * interested again the moment it is home, runs out to the boundary, and paces
 * that loop forever. Both plausible release values were tried and both did it —
 * re-engaging at 6 m orbited at 6.1 m, re-engaging on arrival orbited between
 * home and 9 m.
 *
 * Asking where the PLAYER is has no such cycle, needs no state on the foe to be
 * correct, and says the thing actually meant: a foe fights in its own arena. It
 * also covers the case the other rule handled badly — a foe knocked 12 m out by
 * a Shatter Hammer simply walks back and rejoins, because the fight never left.
 */
export const LEASH_RADIUS = 9.0;

/** Hero back within this of the fight and its foes take an interest again. */
export const LEASH_RELEASE = 7.5;

/** Proximity at which a captive ally joins the party (no dialog — §9). */
export const ALLY_JOIN_RADIUS = 3.0;
/** The ally trails the hero at this distance. */
export const ALLY_FOLLOW_DISTANCE = 1.9;
export const ALLY_SPEED = MAX_SPEED * 0.95;
export const ALLY_ACCEL = ALLY_SPEED / 5;

/*
 * The retired real-time model's constants — strike damage and arc, bandit AI
 * ranges and wind-ups, weapon damage, pickup radii, the mage's bolt, and the
 * tick-based Wet/chain tuning — were deleted with it.
 *
 * Their replacements are CONTENT, not constants: abilities, enemies and the
 * status matrix live in typed tables under `src/content/` (`CLAUDE.md` §6), so
 * balance is authored where the fiction is and a dangling reference fails at
 * build time rather than at runtime in Act 3.
 */
