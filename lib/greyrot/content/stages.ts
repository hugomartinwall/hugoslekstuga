/**
 * The campaign: chapters, stages, and the fights standing on them.
 *
 * Content is pure data (`CLAUDE.md` §6). `sim/scenario.ts` turns this into
 * validated world geometry; nothing here searches the terrain, reads a clock or
 * knows a renderer exists.
 *
 * ## Why a stage is a thing at all
 *
 * §8's entire economic argument rests on seam DENSITY rather than session
 * length: Strategy and Adventure both average 17-minute sessions and Strategy
 * earns twice the impressions, because it has twice the break points. A stage
 * is 2–4 minutes and every boundary is a break point. That is the whole reason
 * the campaign is a linear authored chain and not free-roam (§12).
 *
 * And a stage boundary is **not a level load**. The world is continuous, the
 * simulation never stops, and a stage is exactly two things: which fights are
 * currently allowed to wake up, and where you walk to when they are all won.
 * Anything more would be the mode Phase 3 spent a whole commit deleting.
 *
 * ## The road as a curriculum
 *
 * The alpha reset made stages carry the PROGRESSION: the campaign starts with
 * SPORE alone and each stage's gate finds the next power (`grants`). Chapter 1
 * teaches SPORE → WATER → SPARK → the WEAVE (mixing) → FIRE, one per stage,
 * with mixing granted only after the pool has DEMONSTRATED what a combination
 * is. OIL and FROST are chapter 2's finds.
 */

import { CASTABLES, FOUND_WEAVE_BIT } from "./spells";
import type { BiomeId, Element } from "./types";

/** A foe at an offset from its marker's centre, in world metres. */
export interface StageFoe {
  kindId: string;
  dx: number;
  dz: number;
  /**
   * A DOUSER (R4, damp_pyres): this foe walks at the nearest LIT brazier of
   * its stage instead of hunting the hero, and its wet body puts the flame
   * out on contact. The threat is the walk itself — kill it before it
   * arrives, or pay a relight under pressure. Falls back to ordinary AI when
   * no lit brazier remains. Authored per-foe because composition is the
   * difficulty knob (§10): how many walkers, from where, is the dial.
   */
  douser?: boolean;
}

/**
 * Standing water carved with this stage's stretch — one primitive for a
 * village well, a mire pond, a bog pool. Sim truth, not decoration: stand in
 * it and you are Wet, asked fresh every tick.
 */
export interface StageWater {
  at: readonly [number, number];
  r: number;
  /**
   * Shore dressing: reed-cypress clumps planted round the rim (the fen's
   * bog ponds). An explicit flag rather than an inference, because the
   * dressing loop consumes RNG per dressed pond — whether a pond is dressed
   * must be authored data, or adding a well somewhere would silently
   * re-roll every tree planted after it.
   */
  reeds?: boolean;
}

/**
 * A hut: a blocker the sim owns and a roof the renderer reads off the same
 * object (one dataset, two consumers, no drift). `burning` huts become sim
 * fires BOUND TO THIS STAGE — they gate its seam until doused. That binding
 * is the water lesson's whole mechanism (round 7): a lesson you can walk
 * past is not a lesson.
 */
export interface StageHut {
  at: readonly [number, number];
  rotY: number;
  scale: number;
  burning?: boolean;
  /** See `atRoad` on `StageBrazier` — the same declaration, same rule (V10). */
  atRoad?: true;
}

/**
 * A captive standing ON the road before this stage's first fight. The road
 * is routed THROUGH them (a rescue the player can walk past is a rescue they
 * will miss), and R1's rescue-spans-the-corridor rule covers the verge. The
 * validator holds their margins: outside the previous gate's disc, short of
 * this stage's first trigger.
 */
export interface StageCaptive {
  name: string;
  at: readonly [number, number];
  /**
   * THE HANDOFF (R4, fun's binding ruling; `STORY.md` beat 5): once rescued,
   * this follower will NOT enter stages whose effective biome is this one —
   * she stops at the last gate before it and stands there. Sella is a
   * Tidecap and "Tidecaps stop at the ash line": the boss arena is never
   * diluted by a companion, the chain-through-companion misread cannot
   * happen in the composed exam, and her down-state joke never plays inside
   * a boss fight. The hold point doubles as the fix for a measured live
   * wedge — her follow AI stuck reproducibly at the fen/ash gate (z ≈ 72),
   * which is now exactly where she is authored to stop.
   */
  holdBiome?: BiomeId;
}

/**
 * The first stage index a captive's follower refuses to enter (−1 = none):
 * the first stage whose EFFECTIVE biome (sticky, via `stageBiome`) is the
 * captive's `holdBiome`. The hold point is the previous stage's exit — the
 * gate on the boundary itself.
 */
export function captiveHoldStage(
  stages: readonly StageDef[],
  captive: StageCaptive,
): number {
  if (!captive.holdBiome) return -1;
  for (let i = 0; i < stages.length; i++) {
    if (stageBiome(stages, i) === captive.holdBiome) return i;
  }
  return -1;
}

/** A fight standing on the map, waiting to be walked into. */
export interface StageMarker {
  /** Authored position. Placement may nudge it to flat ground unless `exact`. */
  at: readonly [number, number];
  foes: readonly StageFoe[];
  /**
   * Placement is load-bearing here — carve the glade, but never relocate.
   * The pool fight is staged ON the water; drifting off it deletes the lesson.
   */
  exact?: boolean;
  /** Metres at which walking closer spawns the fight. Wider opens at range. */
  radius?: number;
  /**
   * DECLARED wet teach: every foe of this fight must spawn standing in
   * water (validator rule V7). The pool's placement-is-the-lesson, held as
   * data — if the pond shrinks or a foe drifts dry, the build fails instead
   * of the chain demo quietly becoming luck.
   */
  wet?: boolean;
  /**
   * The arena lock radius: how far from the centre the hero AND its foes may
   * go while this fight is live. Generous by default — the lock exists so a
   * stage cannot be jogged past, not to make the fight claustrophobic.
   * Authoring bar (content test): every foe offset plus its body radius fits
   * inside, so nothing spawns straddling the drawn ring.
   */
  arena?: number;
  /**
   * CONDITIONAL REINFORCEMENT (R5, fun's binding design) — the required-mix
   * discriminator, made structural instead of numeric.
   *
   * The gulch's claim ("a pilot that never mixes cannot clear it") was resting
   * on a zero-HP margin inside a chaotic fight: measured across a dense phase
   * sweep, the refuser died in 85% of the window and survived in 15%, and the
   * shipped world's green and the re-baselined red were two draws of one coin.
   * A pack-size race cannot fix that, because more bodies is more dice.
   *
   * A VALVE can. While at least `while` of this fight's foes are alive, one
   * body arrives every `every` ticks, up to `budget` of them. Single-target
   * play removes one at a time and cannot get the pack under the threshold, so
   * its progress is zero or negative — a SIGN, not a margin, and no amount of
   * dice moves a sign. A mass-clear drops the pack under the threshold in one
   * cast and the valve shuts for good, so taught play never sees an arrival
   * and its own margin cannot be inflated by this.
   *
   * `after` is the safety on that promise: arrivals cannot begin until the
   * fight has run this long, which is set above the SLOWEST taught wipe rather
   * than the typical one, so an unlucky-phase correct run still closes the
   * valve before it opens. `budget` makes "endless" unexpressible rather than
   * merely avoided — the fight is finite by construction.
   */
  /**
   * A REUSABLE REQUIRED-MECHANIC PRIMITIVE, not gulch plumbing.
   *
   * The sim carries a per-fight `composed` flag meaning "this player has
   * demonstrated the mechanic at this fight" — set when a mix is cast at it,
   * whether the fight is live or the mix is laid into its ring before the
   * pack walks in. Declaring `reinforce` says: *a player who has not
   * demonstrated it does not get to grind this fight down.*
   *
   * That makes a required-mechanic claim STRUCTURAL rather than a damage
   * race. Any later fight wanting to assert "you must do X here" can reuse
   * the shape — chapter 2's exam stage is the obvious next one — without
   * rediscovering why a threshold cannot do the job. Every version that
   * measured a quantity failed: an HP race is a band, a pack level cannot
   * tell "not swept yet" from "never swept", a burst size puts the modal new
   * player on the wrong side of it, and a fixed gate tick was calibrated on a
   * window narrower than the spread between two competent players. A
   * predicate on player ACTION has no distribution to be wrong about.
   */
  reinforce?: {
    /**
     * Ticks of fight time before the first arrival may land — a BACKSTOP, not
     * the discriminator. The exemption does the work; this only decides how
     * long someone who has not composed yet is left alone, so it wants to be
     * as late as the refusing lane allows.
     */
    after: number;
    /** Ticks between arrivals while the valve is open. */
    every: number;
    /** Total arrivals, ever. Finite by construction. */
    budget: number;
    /** What arrives. */
    kindId: string;
    /**
     * Where arrivals enter, cycled in order. Read from the ring EDGE so a
     * body walks in from a legible direction rather than appearing inside the
     * fight (fun's binding readability condition — an arrival the player
     * cannot see coming reads as "the game is adding enemies", which is the
     * one way this mechanic fails even when the sign is right).
     */
    from: readonly (readonly [number, number])[];
  };
}

export interface StageDef {
  id: string;
  /** Player-facing, for the stage-clear seam. Short enough for 390 px. */
  name: string;
  /** Where the stage is done, once every fight in it is won. */
  exit: { x: number; z: number; r: number };
  /**
   * Authored road waypoints walked BEFORE this stage's first fight — the
   * bends that make the road wind. The route used to be a second,
   * hand-maintained polyline in scenario.ts that had already drifted from
   * this table once; now scenario GENERATES the route from the stages, and
   * these are the only shaping input.
   */
  bends?: readonly (readonly [number, number])[];
  markers: readonly StageMarker[];
  /**
   * What clearing this stage FINDS: an element, or "weave" — mixing itself.
   *
   * Power is found, not chosen (`GAME_DESIGN.md` §3.1): the campaign starts
   * with SPORE alone and this field is the whole progression. The grant lands
   * as a sim command when the player leaves the stage-clear seam, and resume
   * re-derives held power from the cleared bitset plus this table — the
   * bitset is the decision log; the grants are derived (`CLAUDE.md` §7).
   */
  grants?: Element | "weave";
  /** One line for the seam panel when the grant lands. The only prose beat. */
  grantsNote?: string;
  /**
   * The zone this stage's stretch of road runs through. STICKY (R3, gfx's
   * ask): an untagged stage inherits the PREVIOUS stage's zone via
   * `stageBiome`, because zones are stretches and a mid-ash stage silently
   * reverting to meadow compiles clean and renders wrong. The chain's first
   * stages default to "village" (the baseline meadow).
   */
  biome?: BiomeId;
  /**
   * Causeway margin: how far ABOVE the waterline this stage's stretch of
   * road is built where the raw terrain is drowned (default 0.6 — the
   * spawn-lake causeway). A stage property, not a biome one (gfx's R4
   * ruling: "ash but low" must not need a fourth pseudo-biome): the eastern
   * tail declares 0.2 so The Sodden Hollow stands at the actual water's
   * edge — dark soaked shore ground instead of a raised plateau the palette
   * reads as summit lichen. Transitions are slope-limited with the road's
   * own grade cap, so a margin change ramps, never steps.
   */
  causeway?: number;
  /**
   * The terrain this stage carves: flat ground for a settlement, huts,
   * standing water. Moved here from scenario.ts constants (R3) so a stage
   * is ONE declaration — the builders in scenario.ts consume this
   * generically and the validator holds its geometry.
   */
  terrain?: {
    /** Flat ground baked into the heightfield before anything is placed. */
    flat?: { at: readonly [number, number]; r: number };
    huts?: readonly StageHut[];
    water?: readonly StageWater[];
    braziers?: readonly StageBrazier[];
  };
  captive?: StageCaptive;
}

/**
 * A brazier (R4, damp_pyres): a bowl the sim owns — a small blocker plus a
 * scenery fire that must be KEPT burning. The hut-fire grammar inverted:
 * where a burning hut holds its stage's gate shut until DOUSED, a gating
 * brazier holds it shut until LIT. Water (yours, or a wet body brushing the
 * bowl) puts it out; FIRE relights it. This is the Burning+Wet anti-synergy
 * made into an objective rather than a punishment (`PEDAGOGY.md` row 51).
 */
export interface StageBrazier {
  at: readonly [number, number];
  /**
   * Whether this brazier GATES its stage's seam (default true). The ch1 boss
   * arena reuses braziers as tactical terrain — fun's binding R4 condition:
   * no second counted keep-lit objective there — so its bowls set `gates:
   * false` and become `stage: -1` fires, douse/relight-able but never asked.
   */
  gates?: boolean;
  /**
   * Whether the bowl starts BURNING (default true — damp_pyres' objective
   * begins alight). The boss arena's bowls start DARK (fun's fairness bar:
   * the dry window is EARNED — lighting one is the act that buys it), and
   * `newRun` restores this authored state, not a blanket "lit".
   */
  startLit?: boolean;
  /**
   * THE WALKED LINE, DECLARED (R5, `STORY.md` §7 ask 9).
   *
   * This prop places an obstacle whose surface stands inside the hero's
   * reachable envelope — `CORRIDOR_HALF + MAX_SPEED + HERO_RADIUS` of the
   * road centreline — so the hero's body can touch it and the walked line
   * bends around it. Saying so is mandatory: validator rule **V10** fails
   * the build for any prop that lands in that envelope without it, naming
   * the stage, the coordinates and the shortfall.
   *
   * It is an ADMISSION, not a permission. A prop in the walked line is
   * inside the measured opening (`CLAUDE.md` §9): adding one moves every
   * downstream beat, so the flag is where a reviewer sees that a beats
   * re-baseline is owed. The default — no flag — is the safe side.
   *
   * Chapter 1 carries eight of them and every one is deliberate: the road
   * threads the village between its huts, and a brazier you cannot walk up
   * to is not an objective. That census is the honest description of this
   * world; "declared props stay out of the walk" never was.
   */
  atRoad?: true;
}

/**
 * The effective zone of a stage: its own tag, or the nearest tagged stage
 * BEFORE it, or the baseline meadow. Sticky by design — see `biome` above.
 */
export function stageBiome(stages: readonly StageDef[], index: number): BiomeId {
  for (let k = Math.min(index, stages.length - 1); k >= 0; k--) {
    const b = stages[k]?.biome;
    if (b) return b;
  }
  return "village";
}

export interface ChapterDef {
  id: string;
  name: string;
  stages: readonly StageDef[];
}

/** The default arena lock. Comfortably wider than any spawn offset below. */
const ARENA = 7.5;

/**
 * Chapter 1 — the curriculum.
 *
 * Each element gets one stage to be learned SOLO before the next arrives, and
 * mixing itself is a find. The unlock order follows the pedagogy's best trick,
 * proven at the pool: the world DEMONSTRATES a combination before the player
 * is handed the power, and then a fight requires reproducing it without the
 * world's help. `docs/PEDAGOGY.md` bans teaching two things at once; this
 * table is that rule applied to the whole chapter.
 */
export const CHAPTERS: readonly ChapterDef[] = [
  {
    id: "ch1",
    name: "The Rot Road",
    stages: [
      {
        id: "s1",
        name: "The Rot Road",
        // The gate sits between the corridor and the first bend, so WATER is
        // in hand well before the village's burning huts come into view.
        exit: { x: 0.0, z: 19.5, r: 2.4 },
        grants: "water",
        // R6 (story found it, comp ruled it): the old note read "drawn from the
        // spring by the gate" — and s1 declares no `terrain` key, so there is
        // no spring. A caption on the FIRST element the player ever holds,
        // naming an object that is not in the world. No geometric rule can
        // ever catch this class: the subject is absent, not misplaced, so the
        // fix is the string and never the heightfield — a spring carved at the
        // s1 gate would be terrain surgery inside the measured sixty seconds,
        // for a caption. Four words, §2's own title, naming nothing that is
        // not there and pointing the walk north.
        grantsNote: "follow the water up",
        markers: [
          {
            // §9 wants the ambush at ~4 s. The hero covers 4.4 m/s and the
            // trigger radius is 2.6, so contact lands around 3.5 s from here.
            //
            // THE CORRIDOR — two chargers dead ahead on the road axis, and the
            // player holds exactly ONE element: SPORE, Pim's own nature. One
            // lit button and a cast key is the entire first minute to read,
            // which is what the conversion bar wants and what the old
            // six-buttons-at-once opening got wrong.
            at: [0.5, 16],
            foes: [
              { kindId: "rotling", dx: -0.9, dz: 2.6 },
              { kindId: "rotling", dx: 0.9, dz: 2.6 },
            ],
          },
        ],
      },
      {
        id: "s2",
        name: "The Mossy Bend",
        // Fight-only: the road's first turn, and WATER's stage to be USED
        // (douse yourself, soak a pack) without a new find competing for the
        // lesson. One element per spot is the owner's rule; the fight-only
        // stages between finds are what make it true. The gate stops short of
        // Sella's rescue radius and the village fight's trigger — the gap test
        // holds every boundary to that.
        exit: { x: 9.8, z: 31.4, r: 2.4 },
        bends: [[2, 24]],
        markers: [
          {
            // Three rotlings staggered NEAR the axis — they deliver themselves
            // like the corridor pair, so a pilot that never turns still clears
            // this. The facing lesson belongs to the village, one stage on.
            // The trigger is wide and the pack starts DEEP so the approach is
            // a long straight walk into the muzzle — the non-turner's kills
            // happen on the way in, before the standoff ring starts orbiting.
            // The offsets sit ON the gate→marker chord (≈ (0.64, 0.76)): the
            // non-turner walks that line, and collinear is the whole trick —
            // 25° off it, the pack arrives beside the muzzle instead of in it.
            at: [8, 29],
            radius: 4.5,
            foes: [
              { kindId: "rotling", dx: 3.3, dz: 4.0 },
              { kindId: "rotling", dx: 4.1, dz: 4.9 },
              { kindId: "rotling", dx: 4.5, dz: 5.3 },
            ],
          },
        ],
      },
      {
        id: "s3",
        name: "The Village",
        // The gate stands past the village on the rise to the south-east: the
        // walk out passes the trough lip (the water the NEXT stage is staged
        // on, foreshadowed dry), and the walk back in is 13.7 m of open road
        // with SPARK standing on it — the calm frame the pool's lesson needs.
        // Fourth playtest: the old gate at (19, 38.4) sat INSIDE the pool
        // fight's 4.2 m trigger AND inside the trough's 3.6 m water radius,
        // so the demo opened as a wet ambush on the gate tick.
        exit: { x: 26.5, z: 31.5, r: 2.4 },
        grants: "lightning",
        grantsNote: "Sella shares the storm",
        // The village, as data (R3 — this was scenario.ts's VILLAGE const).
        // The whole layout was translated (+16, +14) when the chapter grew
        // from 5 stages to 10; every internal relationship (wells at the
        // gate, Sella south of them, the pool fight ON the mire pond) is
        // preserved by translating together. The burning huts become the
        // fires that GATE this stage — dousing is the water lesson.
        terrain: {
          flat: { at: [16, 41], r: 12 },
          huts: [
            // atRoad: the road is routed THROUGH the village — every one of
            // these four stands inside the walked envelope (surfaces at
            // 2.06 to 3.61 m against the 5.027 m bound), which is what a
            // village on a road is. See `atRoad` on StageBrazier.
            //
            // ⚑ WELLMEAD IS A GREEN, NOT A LANE (R7). Three of the four moved
            // 1.9-4.8 m outward: the walking lens trails the hero down the
            // road at STAGE_VIEW_HEIGHT, and it was passing THROUGH two of
            // these roofs — hero invisible for part of the mandatory s4->s5
            // approach, and the well-ring behind them reading as pop-in.
            // Validator rule **V13** now fails the build for a broad declared
            // prop the lens can reach; these clear it by 2.10-2.28 m.
            //
            // The old comment's *"−0.60 m"* was the tell nobody read: hut
            // (12.2, 45.5)'s surface stood **1.12 m past the road centreline**
            // — the road did not thread the village, it ran through a house.
            // *A hut you walk through is the parapet you walk through*, which
            // is why four props were cut this cycle.
            //
            // The houses now stand back around an open square with the two
            // wells in the middle of it (story's ruling: the village is named
            // for them, and Brookhollow's drowned ring two stages on is the
            // same object dead). **The move costs +1.3 s at the douses and up
            // to +3.2 s downstream** — the pilot walks further to reach a fire
            // — and those beats are asserted in `test/opening.test.ts` against
            // §9's published table, with the six stale rows pinned there.
            // gfx's pixel rig: six fully-hidden poses recovered across the two
            // walk directions at 800x450, none created.
            //
            // ⚑ THE YAWS FACE THE WELLS (R7). `rotY = atan2(dx, dz)` toward the
            // green's centre (16.2, 40.6), plus story's authored jitter
            // (+11° / −7° / +13° / −9°) so four houses on a green do not read
            // as a parade. **A bearing is only half a `rotY`** — gfx verified
            // the other half through the real instance matrix rather than by
            // reading the mesh: `hutMesh`'s door sits at local +1.85 z, and
            // `Scatter`'s `rotation.set(0, rotY, 0)` carries local +Z to world
            // (sin, cos), so these point doors at the green. The check that
            // makes it end-to-end: transformed through the shipped matrix, the
            // four doors land off-green by exactly 11° / 7° / 13° / 9° — **the
            // authored jitter arriving as authored, with nothing else added.**
            // A sign error anywhere in that chain could not reproduce four
            // authored numbers.
            { at: [6.5, 36.0], rotY: 1.32, scale: 1.0, burning: true, atRoad: true },
            { at: [22.95, 40.25], rotY: -1.2921, scale: 0.9, atRoad: true },
            { at: [7.45, 44.75], rotY: 1.8915, scale: 1.05, burning: true, atRoad: true },
            { at: [20.6, 46.0], rotY: -2.615, scale: 0.95, atRoad: true },
          ],
          // The two village wells. The mire pond is s4's water — the fight
          // staged on it belongs to the stage that declares it.
          water: [
            { at: [12.6, 39.6], r: 1.6 },
            { at: [19.8, 41.6], r: 1.5 },
          ],
        },
        // Sella: MID-STRETCH between the s2 gate and the village fight
        // (round 5: she stood inside the fight's trigger disc and her rescue
        // and the fight fired as one beat). The road bends through her by
        // construction; the validator holds the margins the old comment
        // could only claim: rescue point outside the s2 gate disc, intro
        // short of the village trigger.
        // She is a Tidecap, and Tidecaps stop at the ash line (R4.5, fun's
        // binding ruling; `STORY.md` beat 5): once rescued she walks the
        // village and the fen at heel and halts at the last fen gate, so the
        // ch1 boss's composed exam is never diluted by a companion.
        captive: { name: "Sella", at: [15.6, 33.3], holdBiome: "ash" },
        markers: [
          {
            // The FACING lesson, and now the WATER lesson's fight (round 7).
            // The fight is pulled WEST toward the first burning hut, so the
            // douse — REQUIRED to open the gate since round 7 — is in frame.
            // A Rotling delivers itself down the axis while the CINDERLING,
            // the thing that lit the village, holds its 7.5 m band off it —
            // there is no way to finish this without turning, and no way to
            // leave without answering the fires it started. Same spitter
            // gait and 27 HP as the ashcap it replaced, so the fight's
            // difficulty did not move when its story arrived.
            // Was (13.5, 36.6): R4's causeway drop reshuffled the scatter
            // RNG (the constructor resamples on rejection, so ANY terrain
            // change moves every later draw — flagged for a structural fix
            // at R5's opening) and the placed marker drifted 1.4 m SW into
            // three violations. Half a metre NE restores every margin; the
            // fight stays pulled west toward the burning hut it frames.
            at: [14.0, 37.2],
            arena: 9.0,
            foes: [
              { kindId: "rotling", dx: 0.4, dz: 2.9 },
              { kindId: "cinderling", dx: 4.4, dz: 1.0 },
            ],
          },
        ],
      },
      {
        id: "s4",
        biome: "fen",
        // Round 7 renamed the Trough Pool: the fen begins HERE. The pond the
        // fight stands in is the mire's first finger, reaching the village
        // gate — the biome turns bog at this stage and stays bog through the
        // gulch. The GEOMETRY did not move, on purpose: a plan to walk the
        // fight north out of the hut square died on arithmetic (any pond big
        // enough to wet the pack swallows the second burning hut, and there
        // is no room for one before s6's trigger) — and every margin here is
        // playtest-scar-tissue the move would have re-opened.
        name: "The Mire Pool",
        // North of the pond with real margin — the old gate was dry by 8 cm.
        exit: { x: 14.6, z: 45.4, r: 2.4 },
        // The mire's first finger (round 7): the pond the fight stands IN.
        // The big pond spans the walk north out of the village. The first
        // staging used two small troughs with foes merely STARTING in them —
        // one aggroed early, chased over dry ground, and was bone-dry at the
        // join, so the chain never had a second wet target. Water where the
        // fight HAPPENS, not where actors spawn.
        terrain: { water: [{ at: [16.2, 40.6], r: 3.6 }] },
        markers: [
          {
            // SPARK's stage, and the demonstration that sets up the weave: the
            // GROUND wets the pack (the mire pond — placement is the teach, so
            // exact), and the player's newest element chains through the lot.
            // They leave knowing wet + lightning is special, one stage before
            // they are handed the power to MAKE wet themselves.
            at: [16.2, 40.6],
            exact: true,
            radius: 4.2,
            wet: true,
            foes: [
              { kindId: "rotling", dx: -1.8, dz: 2.6 },
              { kindId: "rotling", dx: 0.1, dz: 3.0 },
              { kindId: "rotling", dx: 1.8, dz: 2.6 },
            ],
          },
        ],
      },
      {
        id: "s5",
        biome: "fen",
        name: "The Old Well",
        // The sopling's teach, and the pool row's missing middle beat: s4 the
        // GROUND made the wetness, s5 an ENEMY carries it, s6 YOU make it
        // (Conduction). The sopling spawns deep so it walks in visibly laying
        // its water line, one chain hop from its rotling packmate — and SPARK
        // is the freshest-proven button (DIRECT_CASTS s5 is already
        // ["lightning"]), so casting what the road just taught fires the
        // Chain! combo on the wet body without the player knowing anything
        // new. The ashcap keeps s3's facing lesson as reinforcement, not a
        // second teach. THE WEAVE waits at its gate — found with SPARK
        // already proven at the pool, one stage before mixing is REQUIRED.
        exit: { x: 2.0, z: 58.0, r: 2.4 },
        grants: "weave",
        grantsNote: "two elements, one cast",
        bends: [[10, 49]],
        // Decorative bog water (round 7): the fen reads as DROWNED ground.
        // Sim truth (stand in it, be Wet) but no fight staged on it — placed
        // clear of the arena rings (the well-combo attribution DIES if s5's
        // fight ground can get wet) and of every gate disc, which the
        // validator now holds. `reeds` plants the shore cypress.
        terrain: { water: [{ at: [14.5, 49.5], r: 1.6, reeds: true }] },
        markers: [
          {
            at: [6, 54],
            foes: [
              { kindId: "ashcap", dx: 3.8, dz: 1.4 },
              { kindId: "rotling", dx: -0.6, dz: 2.6 },
              { kindId: "sopling", dx: 1.2, dz: 4.2 },
            ],
          },
        ],
      },
      {
        id: "s6",
        biome: "fen",
        name: "The Dry Gulch",
        exit: { x: -9.0, z: 72.0, r: 2.4 },
        bends: [[-2, 62]],
        // The second bog pond, flanking the walk to the gulch. Same rules as
        // s5's — and the gulch fight itself stays BONE-DRY by placement (the
        // required-mix exam is that Conduction has to MAKE its own water).
        terrain: { water: [{ at: [3.5, 62.5], r: 1.8, reeds: true }] },
        markers: [
          {
            // THE REQUIRED-MIX FIGHT. Seven chargers, bone-dry ground, opening
            // at range so they arrive as a converging pack. One bolt at a time
            // cannot stop seven before they swarm — but the pool just showed
            // what wet + lightning does, the weave was found one gate back,
            // and Conduction (water+spark) LAYS the pool it conducts through.
            // The funnel asserts the hard half: a pilot that never mixes
            // cannot clear this.
            at: [-6, 67],
            radius: 4.0,
            // Tighter than the default: kiting room is exactly what lets a
            // singles player whittle the pack one bolt at a time. The pack is
            // a SURROUND arriving nearly together — six equidistant from the
            // trigger, so the chain meets a clump rather than a queue, plus a
            // seventh trailing from the north that walks into the pools the
            // chain already laid. That seventh is what splits the twins: a
            // chain absorbs one more body for free, one-bolt-at-a-time pays
            // two more perfect hits it does not have. Measured against the
            // singles twin, not chosen — direct clears on 39 hp, singles
            // dies with the pack still standing.
            arena: 8.0,
            foes: [
              { kindId: "rotling", dx: -5.5, dz: 1.5 },
              { kindId: "rotling", dx: 7.0, dz: 2.4 },
              { kindId: "rotling", dx: -3.0, dz: 4.6 },
              { kindId: "rotling", dx: 4.1, dz: 6.2 },
              { kindId: "rotling", dx: 0.0, dz: 6.0 },
              // R5 re-baseline: was dz −3.4, whose one cell lost its standable
              // ground to the re-rolled forest — `findStandableNear` pushed
              // this charger 1.06 m OUTWARD to a ring of 8.045 against an 8 m
              // arena, and V6 caught it by name. Twenty centimetres in; every
              // neighbouring cell places with zero drift, so this is the
              // smallest move that restores the margin (ring 7.575) without
              // touching a fight fun calibrated.
              { kindId: "rotling", dx: -6.4, dz: -3.2 },
              { kindId: "rotling", dx: 1.9, dz: 7.0 },
              // Nine, not seven (round 5's re-measure): the funnel pilot's
              // standoff-ring facing freeze was fixed, and a competent
              // seven-pack turned out to be killable one bolt at a time —
              // the required-mix exam had stopped examining. Two more
              // arrivals restore the discrimination structurally: a linear
              // killer pays two more kills' worth of exposure it cannot
              // afford, a chain sweep absorbs them into hops it was already
              // making.
              { kindId: "rotling", dx: 5.0, dz: -2.5 },
              { kindId: "rotling", dx: -2.0, dz: 6.9 },
              { kindId: "rotling", dx: 5.5, dz: 4.5 },
              // Twelve, not ten (the boss sitting's Phase A re-measure): the
              // edge-hit fix centres every blast on its victim, which handed
              // the singles twin pseudo-chain through the pack's own
              // clumping — it cleared the ten in a three-second sweep and
              // the exam had stopped examining AGAIN. Same structural
              // answer as round 5, on the ring's thin arcs (west and
              // south): a chain absorbs two more hops for free, a splash
              // sweep pays two more kills of exposure it cannot afford.
              { kindId: "rotling", dx: -7.0, dz: 0.5 },
              { kindId: "rotling", dx: 0.5, dz: -6.5 },
            ],
            // THE VALVE (R5). Every number here is a measured separation
            // across 82 phase samples in two windows, not a guess.
            //
            // THE GATE, 150 — a BACKSTOP, not the discriminator, and a
            // PEDAGOGY dial rather than a safety one. The exemption does the
            // discriminating; this only decides how long a player who has not
            // composed yet is left alone before the fight starts teaching.
            //
            // Both pressures, measured. LATER protects a composer who has not
            // demonstrated yet: slowest first-mix is tick 62 (taught composes
            // at 9 in all 82; masher at 34/48/62, and in 3 of 82 it never
            // composes at all). EARLIER teaches better: at 240 the refuser has
            // already ground the pack 12 → 2, so arrivals contradict eight
            // seconds of evidence that singles are working, and read as "I was
            // winning and the game took it back" rather than "this is not
            // shrinking". Upper bound is the refuser's unfed clear at 259.
            //
            // 150 sits 2.4× past the slowest observed first-mix and 109 ticks
            // short of the refuser finishing, while the pack is still large
            // enough for arrivals to read as the pack refusing to shrink.
            //
            // The upper bound is real and it is not the one it first appears
            // to be: not "the refuser decays below a threshold" but "the
            // refuser FINISHES", which nothing in the mechanism affects. A
            // gate at 300 was tried and broke the row outright, because the
            // long refuser fights used to justify it were long only BECAUSE
            // the valve was feeding them — the mechanism inflating the number
            // used to bound it. And a gate at 180 fed FOUR masher samples to
            // death: its fight runs 161–203, so it straddled the gate.
            //
            // Then the sign, and the cadence is set from the FASTEST refuser
            // observed across 82 phase samples, not the typical one: at its
            // best phase a single-target pilot cleared 21 bodies in 301 ticks
            // — one per 14 — where the median is nearer one per 40. A cadence
            // of 10 beats the fastest of them by 40%, so the pack grows at
            // every phase rather than at most of them. That is a SIGN, and
            // dice do not move signs.
            //
            // Budget is NOT the lever here and the measurement says so: raising
            // it 10 → 16 moved this fight's outcome the WRONG way (a survival
            // at 2.7 became one at 7.6), because more bodies is more dice —
            // the 13th-charger failure in miniature. Twelve arrivals, then
            // nothing ever: finite by construction rather than by tuning.
            reinforce: {
              after: 150,
              every: 10,
              budget: 12,
              kindId: "rotling",
              // THE RING EDGE, CYCLED — and it is an ARC, not a circle.
              //
              // ⚠️ It shipped as a uniform 7 m circle and half of it stood
              // OUTSIDE THE ENCOUNTER FRAME. fun measured it live off real
              // `ev.reinforced` events at both landscape viewports: the three
              // west points and the south point never entered the picture,
              // and `[7, 0]` put its body on screen at 77 px while its 2.5 m
              // gather clipped the edge. So the player got a convergence cue
              // with its focal point off-camera and a body walking in five
              // ticks later with nothing attached to it — which is verbatim
              // the failure this mechanic was designed against, three
              // paragraphs up: *"an arrival the player cannot see coming
              // reads as 'the game is adding enemies'."*
              //
              // THE CAUSE IS GEOMETRIC, NOT A TUNING MISS. The encounter lens
              // stands at a fixed authored yaw, so the frame is a lobe
              // opening AWAY from it, not a disc. A point down-screen sits
              // between the lens and the fight: near the camera, hugely
              // off-axis, and occluding the thing it is announcing. With the
              // gather ring included, the frame admits 9 m up-screen and
              // 1.15 m down-screen — so there is nowhere down-screen that is
              // both on camera and outside the brawl, at any radius. The
              // circle was never stageable.
              //
              // These eight are therefore spread across the up-screen lobe
              // (bearings 350°…61° from +z, radius 7.0, ~10° apart), which:
              //   - keeps every entry ≥ 94 px INSIDE its required inset with
              //     the full 2.5 m gather, at 1280×800 AND 800×450. A wider
              //     arc was measured first (340°…61°) and rejected: it read
              //     better on paper and its west end sat 46 px worse, losing
              //     the frame after 0.5 m of frame drift against this set's
              //     1.0 m;
              //   - keeps every entry at the ring edge — 7.42 m of ring
              //     against an 8 m arena — so `METHOD.md` 7c's "the arrival
              //     landed on the player" failure stays shut. Pulling the bad
              //     points inward to where the frame would accept them (3.9 m
              //     east, 1.2 m south) would have traded fun's defect for
              //     that one;
              //   - leaves `[0, 7]` and `[6.1, 3.4]` untouched to the digit.
              //     They were measured in frame and the derivation agrees, so
              //     it moved nothing it did not have to.
              //
              // ⚠️ WHAT THIS DOES NOT CLAIM. The frame during a fight is the
              // hero pulled up to 0.22 toward the pack centroid, so it does
              // not sit still at the marker. Measured: NO ring survives more
              // than ~1.0 m of that drift with its gather intact, and the
              // arena is 8 m wide. So "in frame" is evaluated at the frame's
              // resting centre, and a player who fights from the rim can
              // still crop an arrival. That is a property of an 8 m ring
              // seen through a fixed lens, not something a better ring fixes
              // — `METHOD.md` 15: scoping a check to what was actually
              // promised is a ruling, not a concession.
              //
              // V12 holds this against the framing at build time. If gfx
              // turns the encounter dials, the build reds with coordinates
              // rather than the fight quietly going off-camera again.
              from: [
                [-1.22, 6.89],
                [0, 7.0],
                [1.22, 6.89],
                [2.39, 6.58],
                [3.5, 6.06],
                [4.5, 5.36],
                [5.36, 4.5],
                [6.1, 3.4],
              ],
            },
          },
        ],
      },
      {
        id: "s7",
        biome: "ash",
        name: "The Ashen Rise",
        // Fight-only: a mixed pack with spitters on BOTH flanks — the facing
        // skill under real pressure, with the full pre-fire hand. FIRE waits
        // at the gate — which stands well back from the Seeping Run's trigger,
        // so the find is taken in the clear (its gem used to stand inside the
        // next fight's take envelope, the SPARK bug verbatim).
        exit: { x: -18.0, z: 81.0, r: 2.4 },
        grants: "fire",
        grantsNote: "struck from the ashen stones",
        markers: [
          {
            // R5 re-baseline: was z 79. Controllable placement moved this
            // fight's PLACED point to (−11.5, 78.5) — half a metre toward the
            // fen gate — and its 7.5 m ring then reached Sella's post at
            // (−9, 72) by 0.54 m, which V5 caught. That margin was flagged as
            // 0.12 m in R4.5 with the note that the re-theater would consume
            // it; the placement change consumed it first. Half a metre north
            // restores it to 0.88 m of clearance.
            at: [-12, 79.5],
            // Cinderlings on both flanks (round 7): the ash country is where
            // the fire-things LIVE, and this is the countable payoff of the
            // village's lesson — the player now holds WATER and SPARK, and a
            // soaked cinderling dies a spark sooner (see its HP note). Same
            // spitter gait as the ashcaps they replaced, so the both-flanks
            // facing pressure and every relational test hold. s8-s10 stay
            // cinderling-free ON PURPOSE: their fire spit ignites ground oil,
            // and the seeping run's whole attribution is that the PLAYER is
            // the only ignition source.
            foes: [
              { kindId: "rotling", dx: -1.5, dz: 2.6 },
              { kindId: "rotling", dx: 1.4, dz: 2.9 },
              { kindId: "cinderling", dx: -4.2, dz: 1.2 },
              { kindId: "cinderling", dx: 4.0, dz: 2.0 },
            ],
          },
        ],
      },
      {
        id: "s8",
        biome: "ash",
        name: "The Seeping Run",
        exit: { x: -7.0, z: 91.0, r: 2.4 },
        markers: [
          {
            // oil_run. Two Seepers drip oil along the path (every 26 ticks,
            // juke 0.12, so the trail reads as a LINE), a Rotling forces
            // casting, and nothing else in the fight is flammable: any
            // ignition proves the ground participated. FIRE is one stage old
            // here — the ignition is the player's first, on hazard they could
            // not have laid (OIL is chapter 2's find).
            //
            // Was (-10, 87): R4's tail fold changed the graded road profile's
            // BACKWARD slope-limit pass (it propagates from the route's end),
            // the flatness search re-nudged this marker ~1 m, and the FIRE
            // find's take envelope broke to 5.1 m against the 5.8 bar — the
            // validator's catch. One metre deeper restores the margin at the
            // authored source instead of leaning on placement luck.
            at: [-9.5, 87.8],
            radius: 3.2,
            foes: [
              { kindId: "seeper", dx: -1.4, dz: 4.2 },
              { kindId: "seeper", dx: 1.6, dz: 5.0 },
              { kindId: "rotling", dx: 0.2, dz: 2.8 },
            ],
          },
        ],
      },
      {
        id: "s9",
        biome: "ash",
        name: "The Char Hollow",
        // Fight-only: the fire curriculum paid off — seepers keep drawing the
        // hazard, and now the player knows exactly what it is for.
        exit: { x: 0.5, z: 105.0, r: 2.4 },
        bends: [[-3, 98]],
        markers: [
          {
            at: [1, 102],
            foes: [
              { kindId: "seeper", dx: -1.2, dz: 3.8 },
              { kindId: "seeper", dx: 1.5, dz: 4.4 },
              { kindId: "rotling", dx: -0.9, dz: 2.5 },
              { kindId: "rotling", dx: 1.0, dz: 2.9 },
            ],
          },
        ],
      },
      {
        id: "damp_pyres",
        biome: "ash",
        causeway: 0.2,
        name: "The Damp Pyres",
        // R4, PEDAGOGY row 51 — the anti-synergy as an OBJECTIVE. Two lit
        // braziers stand inside the fight's arena, and the stage's gate
        // refuses while either is dark (the douse-gate grammar inverted).
        // Two soplings are DOUSERS: they ignore the hero and walk their wet
        // bodies at the bowls while two rotlings press. One douser spawns a
        // two-second amble from its bowl, so every pilot — however naive —
        // SEES a flame die to a wet body early in the fight (the observed
        // half of the row); the fix is FIRE, three stages proven by now.
        // Kill the walkers before they arrive, or pay the relight under
        // pressure; your own water splashing a bowl costs the same — the
        // extinguish is the matrix, not a scripted trap.
        //
        // GEOMETRY: the chapter's tail folds EAST here. The playable world
        // ends at ±118 (Obstacles' halfSize is WORLD_SIZE/2 − 2, and 8b's
        // clamp holds every body inside it) — the first northward extension
        // walked the Camp Gate to z 121, measured as a gate the pilot stood
        // 3 m from forever, pinned at z 118.00 exactly by the world clamp.
        // The fold turns the road east-southeast instead, every arena ring
        // fully inside the bound, with eastward room left for the boss. Arc
        // order makes the fold legal the same way it made the s3 doubleback
        // legal.
        exit: { x: 14, z: 104.5, r: 2.4 },
        bends: [[4, 106]],
        terrain: {
          // Flanking the road perpendicular at the fight — the road runs
          // THROUGH this arena on the eastward fold, and a bowl near the
          // roadline trips the wall-in-the-road rule (measured twice: 2.24 m
          // from the bend sample, then 2.87 from the exit leg). The north
          // bowl also has to clear the PLACED douser spawn (placement
          // validates before terrain lands, so the bowls respect the placed
          // offsets, not the other way round — V1's catch). Both bowls sit
          // ≥3 m from every road sample and ≥1.5 m from every placed spawn.
          // The east bowl is the one the road passes (surface 3.35 m, inside
          // the walked envelope — you relight it from the road). The west
          // bowl clears it by 0.06 m and therefore carries no `atRoad`:
          // the tightest margin in the chapter, and the first thing a
          // terrain nudge here will flip. V10 reds with its coordinates.
          braziers: [{ at: [7.2, 112.0] }, { at: [9.9, 102.0], atRoad: true }],
        },
        markers: [
          {
            at: [9.5, 106.5],
            radius: 4.0,
            arena: 8.5,
            foes: [
              { kindId: "rotling", dx: -1.5, dz: 2.6 },
              { kindId: "rotling", dx: 1.5, dz: 2.8 },
              // The near walker: ~2.5 m from the east bowl — the guaranteed,
              // countable extinguish. The far walker gives the lesson its
              // second beat and the intercept its real decision.
              { kindId: "sopling", dx: 1.5, dz: 3.5, douser: true },
              { kindId: "sopling", dx: 0.5, dz: 5.5, douser: true },
            ],
          },
        ],
      },
      {
        id: "s10",
        biome: "ash",
        causeway: 0.2,
        name: "The Camp Gate",
        // The chapter's closing fight: the heaviest composition on the road,
        // every archetype at once AND both element-carriers — the sopling
        // beside the seeper, so the exam fields the whole vocabulary and the
        // taught play (Conduction) gets one free chain node. OIL and FROST
        // are chapter 2's finds, visible as the two empty slots in the arc.
        // R4 translated the whole stage onto the eastward fold to make room
        // for the Damp Pyres ahead of it — every internal relationship
        // preserved by translating together, the village-move discipline.
        exit: { x: 24, z: 110.5, r: 2.4 },
        markers: [
          {
            at: [21, 107.5],
            radius: 4.0,
            arena: 8.5,
            foes: [
              { kindId: "rotling", dx: -2.8, dz: 2.6 },
              { kindId: "rotling", dx: 2.6, dz: 2.8 },
              { kindId: "sopling", dx: -1.2, dz: 4.6 },
              { kindId: "rotling", dx: 1.4, dz: 4.9 },
              { kindId: "ashcap", dx: 4.4, dz: 1.2 },
              { kindId: "seeper", dx: 0.0, dz: 6.2 },
            ],
          },
        ],
      },
      {
        id: "sodden_hollow",
        biome: "ash",
        causeway: 0.2,
        name: "The Sodden Hollow",
        // THE CH1 BOSS (R4). Chapter end — the camp seam lands on the boss
        // kill (§8's chapter-boss placement; fun's binding order ruling).
        // The eastward fold continues; the arena ring (10.0 at the marker)
        // stays fully inside the ±118 world bound. Three braziers ring the
        // fight as TACTICAL terrain (`gates: false` → stage −1 fires): lit
        // they dry the boss's sodden coat, dark they hand it its conductor
        // — and no chip ever counts them (fun's condition). The boss
        // douses them itself in phase 2; the player's damp_pyres habit is
        // the counter-play.
        exit: { x: 35, z: 113, r: 2.4 },
        terrain: {
          // startLit: false (the recut, fun's fairness bar): the dry window
          // is EARNED — lighting a bowl is the act that buys it, on every
          // entry path (a stage retry re-arms these to dark; damp_pyres'
          // gating bowls keep their inherit-on-retry semantics, which are
          // progress, not fight state).
          // atRoad on all three: tactical bowls the player must be able to
          // reach and light mid-fight, so they stand inside the walked
          // envelope by design (surfaces 3.35–4.81 m).
          braziers: [
            { at: [27, 104], gates: false, startLit: false, atRoad: true },
            { at: [36, 104.5], gates: false, startLit: false, atRoad: true },
            { at: [30, 112.5], gates: false, startLit: false, atRoad: true },
          ],
        },
        markers: [
          {
            at: [31.5, 107.5],
            radius: 4.5,
            arena: 10.0,
            foes: [{ kindId: "thornback", dx: 0, dz: 4.5 }],
          },
        ],
      },
    ],
  },
];

/** Every stage, flattened, in play order. Stage index means index into this. */
export const STAGES: readonly StageDef[] = CHAPTERS.flatMap((c) => c.stages);

/** Which chapter a stage index belongs to. */
export function chapterOfStage(stageIndex: number): number {
  let seen = 0;
  for (let c = 0; c < CHAPTERS.length; c++) {
    seen += CHAPTERS[c]!.stages.length;
    if (stageIndex < seen) return c;
  }
  return CHAPTERS.length - 1;
}

/** True if this stage is the last of its chapter — where the camp is (§8). */
export function isChapterEnd(stageIndex: number): boolean {
  const c = chapterOfStage(stageIndex);
  let end = -1;
  for (let i = 0; i <= c; i++) end += CHAPTERS[i]!.stages.length;
  return stageIndex === end;
}

/**
 * The `found` bitmask a save from BEFORE finds were takeable could hold at
 * `stage`: with contact-collection, every find of a stage the player fought
 * PAST (index < stage − 1) was provably crossed; the last cleared stage's
 * find stands ahead of the resume point. Used by the v2→v3 save migration
 * and the debug stage jump — never by a v3 save, whose `found` is a recorded
 * decision, not a derivation.
 */
export function foundBitsThroughStage(stage: number): number {
  let bits = 0;
  STAGES.forEach((st, i) => {
    if (i >= stage - 1 || !st.grants) return;
    if (st.grants === "weave") {
      bits |= FOUND_WEAVE_BIT;
    } else {
      const k = CASTABLES.findIndex((c) => c.element === st.grants);
      if (k >= 0) bits |= 1 << k;
    }
  });
  return bits;
}

export { ARENA as DEFAULT_ARENA };
