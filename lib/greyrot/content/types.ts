/**
 * Content types.
 *
 * Content is typed TS const tables, not JSON (`CLAUDE.md` §6): it tree-shakes,
 * type-checks, costs nothing to parse, and a rename is compiler-verified rather
 * than discovered at runtime in Act 3. `content.test.ts` asserts referential
 * integrity on top — every id referenced by an ability, hero or enemy exists.
 *
 * Everything here is DATA. No functions, no classes, no imports from the
 * renderer, and nothing that reads a clock or a random number — the simulation
 * imports this module and the determinism guarantees in §4 extend to it.
 */

/* ---------------------------------------------------------------- elements */

/**
 * The damage/interaction element. This is what drives the status matrix — the
 * combos live in `element × target's statuses`, not in per-ability special
 * cases, so a new ability inherits every interaction for free and cannot
 * forget one.
 */
export type Element = "spore" | "fire" | "frost" | "lightning" | "water" | "oil";

/* ------------------------------------------------------------------ biomes */

/**
 * The zone a stage's stretch of road runs through (round 7). Sequential along
 * the one road — village meadow, then the drowned fen, then the ash country —
 * compiled at setup into arc-length spans over `roadPath` and consumed by the
 * terrain tint, the scatter dressing, and nothing in the sim's rules: a biome
 * changes what the world LOOKS like, never how it behaves.
 */
export type BiomeId = "village" | "fen" | "ash";

/* ---------------------------------------------------------------- statuses */

export type StatusId = "burning" | "wet" | "shocked" | "frozen" | "oiled" | "bleeding";

export interface Status {
  id: StatusId;
  name: string;
  /** Damage applied at the end of the afflicted's own turn. */
  damagePerTurn: number;
  /** Multiplier applied to incoming damage of these elements. */
  incoming: Partial<Record<Element, number>>;
  /** Flat change to initiative speed while afflicted. */
  speedDelta: number;
  /** The afflicted loses their turn while this is active. */
  skipsTurn: boolean;
  /** Default duration in the afflicted's own turns. */
  turns: number;
}

/* --------------------------------------------------------------- abilities */

/**
 * How an ability spreads across the three ranks. Free 2D positioning was
 * deliberately traded for ranks (`CLAUDE.md` §10.2) — the shapes stay readable
 * at 800×450 and tappable on a phone, which is what makes the depth real
 * rather than nominal.
 */
export type Shape = "single" | "rank" | "column" | "all";

/** Melee reaches the enemy FRONT rank only. Ranged reaches any rank. */
export type Reach = "melee" | "ranged";

export interface Ability {
  id: string;
  name: string;
  /**
   * One word, for the funnel's single lit button (`CLAUDE.md` §9). If it does
   * not fit on a 44 px control at 12 px type, it is the wrong verb.
   */
  verb: string;
  element: Element;
  shape: Shape;
  reach: Reach;
  /** Base damage before status multipliers. 0 for pure utility. */
  damage: number;
  /** Healing to the target. Targets allies when > 0 and damage is 0. */
  heal: number;
  /**
   * Resource cost. NEGATIVE generates resource — that is what makes the Capper
   * feel different: it builds Grit by acting and by being hit, rather than
   * spending down a bar.
   */
  cost: number;
  /** Turns before this combatant may use it again. 0 = every turn. */
  cooldown: number;
  /** Status applied to each target hit. */
  applies?: StatusId;
  /** Ranks the target is pushed back (positive) or pulled forward (negative). */
  shove: number;
  /** Threat generated, on top of damage dealt. */
  threat: number;
  /**
   * Forces enemies to target the caster for a couple of turns, whatever the
   * threat table says.
   *
   * An explicit flag rather than an inference from "high threat and no
   * damage" — the engine originally sniffed for that shape, which meant any
   * future utility ability would silently become a taunt.
   */
  taunt: boolean;
  /** Requires a full ultimate charge, and spends it. */
  ultimate: boolean;
  /** One line, shown on the ability button. No paragraphs — §9 bans text walls. */
  blurb: string;
}

/* ------------------------------------------------------------------ heroes */

export type ResourceId = "grit" | "ember" | "dew";

export interface HeroClass {
  id: string;
  name: string;
  resource: ResourceId;
  resourceName: string;
  maxHp: number;
  maxResource: number;
  /** Resource regained at the start of each of this hero's turns. */
  resourceRegen: number;
  /** Base initiative. Higher acts earlier. */
  speed: number;
  /** Exactly two abilities plus one ultimate (`CLAUDE.md` §10.4). */
  abilities: [string, string, string];
}

/* ----------------------------------------------------------------- enemies */

/**
 * AI archetype. Difficulty comes from these, from composition, from telegraph
 * windows and from placement — **never** from a global stat multiplier
 * (`CLAUDE.md` §10, and a test asserts no such multiplier exists).
 */
export type AiArchetype =
  /** Hits whoever has the most threat it can reach. The honest baseline. */
  | "brawler"
  /** Ignores threat and dives the lowest-HP target it can reach. */
  | "stalker"
  /** Stays back, prefers ranged, applies statuses before damage. */
  | "caster";

export interface EnemyKind {
  id: string;
  name: string;
  maxHp: number;
  speed: number;
  ai: AiArchetype;
  /** Rank it prefers to occupy when the encounter is laid out. */
  preferredRank: number;
  abilities: string[];
  /** Coins dropped. Sim truth; the economy hangs off it later. */
  loot: number;
}
