/**
 * Real-time foe kinds.
 *
 * Three archetypes, five kinds — the archetype is the GAIT, the element is
 * the IDENTITY, and each kind exists to test a different thing about the
 * combat feel, not to be a bestiary. The sopling is the first foe whose
 * element is a weakness you exploit: it exists to be sparked; the cinderling
 * extends the same rule to fire — soak it and it dies a hit sooner. `CLAUDE.md`
 * §10 still binds: difficulty comes from composition, telegraph windows and
 * placement, never from a stat multiplier. There is no difficulty scalar in
 * this file and there is not going to be one.
 *
 * These are separate from `enemies.ts` (the turn engine's table) because that
 * one is keyed on ranks and ability ids, both of which are going away. Nothing
 * imports both.
 */

import type { PatchKind } from "./spells";
import type { Element } from "./types";

export type FoeAi =
  /** Runs at you, winds up visibly, swings. The honest baseline. */
  | "charger"
  /** Holds its distance and lobs. Punishes standing still. */
  | "spitter"
  /** Slow, and leaves an oil trail. A walking invitation to set the floor on fire. */
  | "weeper"
  /**
   * Refuses the frontal line: circles to the hero's facing BLIND ARC before
   * it may commit (R2 — the coordination the roster lacked is GEOMETRY, not
   * sync; fun's ruling: synchronized commits read as random unfairness at
   * 800×450 because the player cannot see the sync). Makes facing-as-aiming
   * a cost that never stops being paid. Binding readability contract
   * (R2 spec, three conditions): a sim-enforced stalk phase (`flankTicks`)
   * must precede every commit, wu12 is the telegraph floor (wu10 reachable
   * only behind circling-as-pre-tell verified + the windup-ease dial + an
   * eyes-off tell), and if the eyes-off tell cannot be made readable the
   * windup LENGTHENS — cadence yields to readability.
   */
  | "flanker";

export interface FoeKind {
  id: string;
  name: string;
  maxHp: number;
  /** Metres per second. Converted to per-tick at use. */
  speed: number;
  ai: FoeAi;
  /**
   * The element its attacks carry. Presentation-honest, not a balance knob:
   * the status/patch of a foe attack stays null, but the playtest read every
   * enemy attack as "made of oil" because they were all a hardcoded spore.
   * The render layer keys its bolt colour and telegraph off this, never off
   * the foe kind.
   */
  attackElement: Element;
  /** Metres at which it commits to an attack. */
  range: number;
  /** Ticks of visible wind-up before the blow lands. The telegraph window. */
  windupTicks: number;
  /** Ticks between attacks. */
  recoverTicks: number;
  damage: number;
  /** Body radius, metres — collision and hit testing. */
  radius: number;
  /**
   * How far off a straight line this thing wanders, as a fraction of its own
   * speed applied sideways. 0 is a beeline.
   *
   * This exists because aiming was free: a charger running dead at you is
   * intercepted by any shot fired in its direction, so leading a target was a
   * formality rather than a skill. Weaving makes the lead a real estimate.
   *
   * **A difficulty knob under §10** — AI and movement, never a stat
   * multiplier. Raising this makes a fight harder without making anything
   * tougher, which is exactly the distinction §10 draws.
   */
  juke: number;
  /** Ticks between re-drawing the lateral bias. Longer = lazier, more readable. */
  jukeTicks: number;
  /** Spores dropped on death. Auto-collected; there is no pickup to walk over. */
  loot: number;
  /**
   * Trail laid while walking. CONTENT, not archetype — the weeper AI is the
   * gait; this is what it sheds. The honesty rule (content.test.ts): a
   * dripping foe's `attackElement` matches its drip, so the trail, the
   * telegraph tint and the bite all tell one story.
   */
  drip?: { kind: PatchKind; r: number; ticks: number };
  /**
   * Patch laid where this kind's PROJECTILE lands (spitters only — melee
   * kinds have no projectile). Rides the projectile's existing `patch` field,
   * the same code path as the player's patch-laying mixes, so the render and
   * field rules come wholesale. The honesty rule extends here too: the patch
   * must be the attackElement's own ground (frost lays ice, water lays
   * water), asserted in content.test.ts.
   */
  attackPatch?: PatchKind;
  /**
   * Boss behaviour block (R4, the Sodden Thornback). Present = this kind
   * runs the boss layer on top of its base `ai`: a self-wet cadence paused
   * by lit braziers, an HP-threshold phase turn that spawns adds and starts
   * the bowl-dousing walk (the `douser` steering, reused), and a water slam
   * that lands on the bowl it reached. All numbers are content so the fight
   * is tuned here, never in step.ts.
   */
  boss?: {
    phaseAt: number;
    rewetTicks: number;
    dryRadius: number;
    addKind: string;
    addCount: number;
    /**
     * Hp healed per tick-equivalent while the coat is ON — paid out as ONE
     * discrete pulse of `soakRegen × rewetTicks` per re-wet cadence, never a
     * trickle (gfx's co-design: a beat the HP bar can pulse with; a trickle
     * is an invisible heal, fun's exact complaint pre-written). The recut's
     * anti-kite discriminator: raw single-element chip cannot out-race it,
     * drying the coat switches it off, the wet-read out-damages it. Content
     * on one kind, tuned here — §10's ban is multipliers on the difficulty
     * path, and this scales with nothing.
     */
    soakRegen: number;
  };
  /**
   * Flanker only: consecutive STALK ticks (in the hero's facing blind arc,
   * within stalk range) the sim requires before this kind may begin a windup.
   * This is the enforceable half of the readability contract — the pre-tell
   * is a hashed counter the commit is gated on (`RtFoe.flank`), not an
   * animation somebody hopes plays. The loud warning stays the windup itself:
   * total warning must NOT comfortably exceed a pair's 9-tick cast root, or
   * the kind stops carrying the root cost it exists for — so presentation
   * ramps FAINT through the stalk and unmistakable only at commit.
   */
  flankTicks?: number;
}

export const FOES: Record<string, FoeKind> = {
  rotling: {
    id: "rotling",
    name: "Rotling",
    maxHp: 34,
    speed: 3.1,
    ai: "charger",
    attackElement: "spore",
    range: 1.25,
    // 12 ticks = 0.4 s. Long enough to read and dodge, short enough that
    // three of them at once is genuinely frightening.
    windupTicks: 12,
    recoverTicks: 24,
    damage: 9,
    radius: 0.42,
    // The main target you learn to lead. Enough weave that a shot fired at
    // where it IS misses, little enough that it still reads as a charge.
    juke: 0.55,
    jukeTicks: 14,
    loot: 2,
  },
  ashcap: {
    id: "ashcap",
    name: "Ashcap",
    maxHp: 26,
    speed: 2.2,
    ai: "spitter",
    attackElement: "spore",
    range: 7.5,
    windupTicks: 20,
    recoverTicks: 45,
    damage: 7,
    radius: 0.4,
    // Strafes hardest — it is holding range rather than closing, so sideways
    // is where its movement budget goes anyway.
    juke: 0.85,
    jukeTicks: 20,
    loot: 3,
  },
  seeper: {
    id: "seeper",
    name: "Seeper",
    maxHp: 48,
    speed: 1.7,
    ai: "weeper",
    // The thing that drips oil hits LIKE oil. Its bite carries no oiled
    // status (that would be a balance change); it just stops lying about
    // what it is made of.
    attackElement: "oil",
    range: 1.4,
    windupTicks: 18,
    recoverTicks: 36,
    damage: 11,
    radius: 0.52,
    // Deliberately almost none. The oil trail it lays has to be readable as a
    // line you can plan around; a weaving weeper scribbles instead of drawing.
    juke: 0.12,
    jukeTicks: 30,
    loot: 4,
    drip: { kind: "oil", r: 1.2, ticks: 26 },
  },
  cinderling: {
    id: "cinderling",
    name: "Cinderling",
    // 27, and the number is doing the sopling's trick one chapter later:
    // SPORE 9 ×3 = 27 dies in three hits at the village — the ashcap's own
    // count, so the facing fight's difficulty does not move when this kind
    // replaces it there. At the Ashen Rise the player holds WATER and SPARK:
    // dry, two sparks (26) fall one short and it takes three; SOAKED, Wet's
    // ×1.5 makes two sparks 39 — a whole hit sooner. Douse the fire-thing
    // and it dies faster: water answers fire, extended to BODIES, countable.
    maxHp: 27,
    speed: 2.2,
    ai: "spitter",
    // The thing that lit the village spits FIRE — bolt colour, telegraph
    // tint and ember eyes all say so (the seeper/sopling honesty, third
    // verse). NO drip, and that is a sim truth rather than a style choice: a
    // fire trail burns its own layer — step 7 afflicts every foe standing in
    // a patch regardless of who laid it, so a fire-dripping foe stands at
    // the head of its own line and burns down. The trail-as-identity family
    // stays water/oil; fire arrives only as a THROWN thing.
    attackElement: "fire",
    range: 7.5,
    windupTicks: 20,
    recoverTicks: 45,
    // A shade over the ashcap's 7 — fire bites hotter, and the pair differ
    // by something a player can feel without either replacing the other.
    damage: 8,
    radius: 0.4,
    // The ashcap's strafe verbatim: same gait, different element.
    juke: 0.85,
    jukeTicks: 20,
    loot: 3,
  },
  sopling: {
    id: "sopling",
    name: "Sopling",
    // 2 sparked hits vs 3 dry: SPARK's 13.6 (R6a) at Wet's ×1.5 is 20.4, so 38 dies
    // to two wet bolts (40.8) and survives two dry ones (27.2). The elemental
    // weakness is a COUNTABLE difference — one whole hit — which is what
    // makes it legible rather than a stat footnote. Between rotling 34 and
    // seeper 48; the seeper stays the tank.
    maxHp: 38,
    // Slower and softer than the seeper: it arrives late and visibly, laying
    // its line, and it enters at s5 where the player has half the toolkit
    // they will have at s8.
    speed: 1.9,
    ai: "weeper",
    // The thing that drips water is MADE of water — the trail, the teal
    // telegraph and the bite all say so (same honesty as the seeper's oil).
    attackElement: "water",
    range: 1.4,
    windupTicks: 18,
    recoverTicks: 36,
    damage: 8,
    radius: 0.48,
    // The seeper's rationale verbatim: the trail must read as a LINE.
    juke: 0.12,
    jukeTicks: 30,
    loot: 3,
    // Same geometry as the seeper's trail, so the two read as the same
    // BEHAVIOUR in different colours. Water patches age out faster than oil
    // (PATCH_TICKS 300 vs oil's longer life), so the wet line is naturally
    // shorter — no extra knob. At 1.9 m/s and a drop per 26 ticks it stands
    // at the head of a near-continuous wet line, i.e. it is Wet almost
    // always via the existing field billing: ITS OWN CONDUCTOR.
    drip: { kind: "water", r: 1.2, ticks: 26 },
  },
  rimecap: {
    id: "rimecap",
    name: "Rimecap",
    // The COUNTABLE tuning (the sopling/cinderling trick, fourth verse):
    // 2 × FIRE (11) = 22 kills it, 2 × SPORE (9) = 18 does not and 3 does —
    // fire answers the frost kind ONE WHOLE HIT sooner, which hands FIRE a
    // defensive job (a worth-casting matrix entry for free — fun, R2 spec).
    // Asserted in content.test.ts, not hoped.
    maxHp: 20,
    speed: 2.2,
    // The ashcap's gait verbatim — same band, same strafe — because the KIND
    // is the ice, not the movement. Silhouette separation is render-side
    // (icicle-fringed rim; sheen stays DRY at ~0.85 roughness — cold is not
    // wet, the sopling's glisten must stay unique).
    ai: "spitter",
    // FROST bolt: eye glow, telegraph tint and bolt colour all say so. Two
    // matrix consequences ride the element automatically and are DESIGN, not
    // accidents: a WET hero takes Frozen (wet+frost — your own puddles
    // become freeze setups against you; fun's verdict standard is the pool
    // bar: attributable, with a legible counter — stay dry, or burn the
    // floor), and fire melts its ice back to water (PATCH_REACTION).
    attackElement: "frost",
    // THE ANTI-CAMPING KIND (the star of the R2 spec): every bolt lays ice
    // where it lands, so the ground under a stationary player becomes a
    // skating rink (PATCH_SLIP ice = 4). It attacks FOOTWORK — the named
    // skill axis — with zero stat inflation, which is §10 difficulty done
    // by the book. Answer: reposition, or burn the floor.
    attackPatch: "ice",
    range: 7.5,
    windupTicks: 20,
    // Mildly sharpened vs the ashcap's 45 — ch2+ kinds carry the bite
    // cadence (fun's root-cost ruling: never a global dial, never ch1 kinds;
    // ch1's forgiveness protects the conversion window).
    recoverTicks: 40,
    damage: 7,
    radius: 0.4,
    juke: 0.85,
    jukeTicks: 20,
    loot: 3,
  },
  rotfang: {
    id: "rotfang",
    name: "Rotfang",
    // ("Fenlurk" was the runner-up name — swap if ch2's fiction wants it.)
    maxHp: 30,
    // Faster than the rotling: it spends the speed on the arc, not the line.
    speed: 3.3,
    // THE FLANKER — see the FoeAi doc for the full readability contract.
    // The root-cost carrier: wu12 vs a pair's 9-tick cast root means a
    // player who commits a full mix INTO a committed windup is rooted 9 of
    // the 12 ticks and eats the bite; a warned player who just moves
    // escapes trivially. That triangle (stalk cue faint, windup loud, root
    // 9 < wu 12) is the whole kind. Tuned against the R1 cap-needle facing
    // cue — never against an unreadable hero.
    ai: "flanker",
    attackElement: "spore",
    range: 1.25,
    // wu12: the reactive floor (gfx: most of the pose eases in late; 10
    // leaves ~4 frames of readable full pose at 800×450). wu10 is reachable
    // ONLY behind the three-condition contract in the FoeAi doc.
    windupTicks: 12,
    // THE sharpened cadence: rotling is 24. Priced in the R2 sandbox
    // sitting with fun against ch2 pack compositions.
    recoverTicks: 18,
    damage: 8,
    radius: 0.42,
    // Low: its lateral budget IS the flank arc — a weaving flanker
    // scribbles over its own tell.
    juke: 0.3,
    jukeTicks: 14,
    loot: 3,
    // 24 ticks (0.8 s) of sim-enforced stalking before any commit — the
    // fairness floor for fun's zero-unwarned-hits bar. The LOUD warning is
    // the wu12, not this window; see `flankTicks` on FoeKind.
    flankTicks: 24,
  },
  stormling: {
    id: "stormling",
    name: "Stormling",
    // Glassy: it prices a habit, it does not tank a fight.
    maxHp: 24,
    speed: 2.3,
    ai: "spitter",
    // THE MATRIX TURNED AGAINST THE PLAYER (fun's pick for slot 8 over the
    // thornback, which moved to the boss lane — and the decoupling reason:
    // a common whose lesson hung on R6's Bleeding ruling was the wrong
    // dependency direction). Its bolt is LIGHTNING, so the existing
    // interaction matrix does the rest with no new mechanics: a WET hero
    // takes ×1.5 and the hit CHAINS to every other wet body within 4.5 m —
    // the self-soak habit (fun's whole baseline: "I kept standing in my own
    // puddles") becomes lethal AND legible, priced by the same rule the
    // player uses on the pool. Foe-origin chains are filtered off packmates
    // (hitsFoes threading, R2) — MORE foes must never make a fight easier.
    // Counter: stay dry, or kill it first.
    attackElement: "lightning",
    range: 7.5,
    windupTicks: 20,
    // Sharpened a notch vs the ashcap's 45, like the rimecap's 40.
    recoverTicks: 42,
    // Low base — Wet's ×1.5 is the real number, by design: dry it stings,
    // soaked it hurts, and the difference IS the lesson.
    damage: 6,
    radius: 0.4,
    // The ashcap's strafe; its silhouette hook is the asymmetric wind-tilt
    // cap (gfx, pre-committed).
    juke: 0.85,
    jukeTicks: 20,
    loot: 3,
  },
  thornback: {
    id: "thornback",
    // THE CH1 BOSS (R4, boss lane since R2 — never a roster common). The
    // taught lessons recombined against the player (§10), with the MATRIX
    // doing all the damage work — no bespoke damage rules:
    //
    // - Its SODDEN COAT is literally the Wet status, self-applied on a
    //   cadence (`boss.rewetTicks`). Burning cannot stick on a wet body
    //   (statuses.ts — the anti-synergy), so FIRE's DoT is denied while it
    //   drips... and lightning finds a conductor (×1.5 + chain to wet adds),
    //   so the sodden state is an OPENING for one answer and a wall for the
    //   other. Both answers were taught by s10 and s4–s6 respectively.
    // - The arena's braziers DRY it: a lit bowl within `boss.dryRadius`
    //   pauses the re-wet and the coat runs out — the damp_pyres habit paid
    //   off as tactical terrain, never a counted objective (fun's binding R4
    //   condition: no second chip).
    // - Phase 2 (`boss.phaseAt`): it starts DOUSING the bowls — the douser
    //   walk the player learned to intercept, at boss scale, ending in a
    //   telegraphed water slam — and brings wet sopling adds that douse by
    //   proximity AND stand in its chain radius.
    //
    // Difficulty knobs here are composition and cadence (§10) — never a
    // multiplier. Both slams telegraph WATER (the sodden identity; tint =
    // element, the existing rule).
    name: "Sodden Thornback",
    // THE RECUT (R4 boss sitting, Phase B — fun's live ITERATE answered).
    // The checkpoint fight was a dry-spawned melee charger beside lit bowls,
    // and single-mix spam beat it first-try while the anti-synergy never
    // expressed. Four changes, all behaviour and cadence, no multiplier:
    //
    // - BORN SODDEN: the coat is on from the first standing tick (spawn
    //   rewet = 1) — the fight opens inside the anti-synergy instead of
    //   banking a free burn window before it arrives.
    // - ARTILLERY over melee chase: `ai: "spitter"`, range 6.5 — a hero at
    //   2× its speed simply outruns a chaser forever, so the chase was never
    //   pressure. The lob is; and spore's own 0.6 rangeMul (5.4 m) forces
    //   the raw-spore refuser INSIDE the artillery envelope to deal any
    //   damage at all. Positioning pressure, §10's sanctioned kind.
    // - SOAK REGEN (`boss.soakRegen`): the coat heals in attributable beats
    //   — the anti-kite discriminator. Chip damage under the coat goes
    //   nowhere; drying it or out-damaging it through the matrix are the
    //   taught answers.
    // - The bowls START DARK (stages.ts) and re-arm on a stage retry (the
    //   pinata path): the dry window is EARNED, on every entry path.
    maxHp: 300,
    speed: 2.2,
    ai: "spitter",
    attackElement: "water",
    range: 6.5,
    windupTicks: 16,
    // Slow, heavy cycle — the knob that sets the boss's DPS race (§10:
    // cadence, never a multiplier).
    recoverTicks: 55,
    damage: 9,
    radius: 0.95,
    juke: 0.2,
    jukeTicks: 26,
    loot: 60,
    boss: {
      /** Fraction of maxHp at which phase 2 turns. A behaviour change, not a stat change. */
      phaseAt: 0.5,
      /** Ticks between self-wet reapplications while no lit bowl is near. */
      rewetTicks: 45,
      /** A lit brazier within this range pauses the re-wet — the dry-out. */
      dryRadius: 11,
      /** Phase-2 adds: spawned once at the turn, marker-owned. */
      addKind: "sopling",
      addCount: 2,
      /**
       * ≈42 hp/s while sodden, paid as one 63 hp beat per re-wet cadence —
       * ABOVE the strongest raw play's measured ceiling, deliberately. The
       * sitting walked here in three steps: at the 0.7 opener the kiting
       * spore-double refuser out-raced the coat (net ≈17/s, killed in 20 s);
       * at 1.0 it STILL won (~34 s), because a kiter dodges nearly every
       * lob — artillery detonates where you stood — so its intake is ~zero
       * and any regen under its ~39/s gross gets ground out eventually. A
       * race the refuser can win by margin-of-model is not an exam, so the
       * coat now out-drinks raw damage OUTRIGHT and the discriminator is
       * structural: spore² parks the fight at equilibrium forever (the 60 s
       * stall), while the matrix goes THROUGH — the wet-read l² lands 51 a
       * cast (×1.5 on wet, ≈109/s gross), and the bowls switch the regen
       * off entirely. Not an HP wall: a wall only to the play the exam
       * exists to refuse, with both taught answers cutting it, and the soak
       * beats telegraph the drinking on the bar (fun's watch-item).
       */
      soakRegen: 1.4,
    },
  },
};

export const FOE_IDS = Object.keys(FOES);

export function foeKind(id: string): FoeKind {
  const k = FOES[id];
  if (!k) throw new Error(`unknown foe: ${id}`);
  return k;
}
