import { isBossLevel, type PlayerBoosts } from "../sim/level";
import { PROD_INTERVAL, UPGRADE_COST, UPGRADE_TICKS } from "../sim/constants";
import type { AbilityCharges } from "../sim/state";
import { COACH_STEPS } from "./coach";

/**
 * Run/lives progression + meta progression — pure and DOM-free so it's
 * unit-testable. A run = a climb from level 1 with a save-derived number of
 * lives. Cores earned on wins buy permanent upgrade tracks.
 */

export const BASE_LIVES = 2;

export interface RunState {
  level: number;
  lives: number;
  /**
   * Attempts already spent on `level`, 0 on arrival.
   *
   * Feeds `seedSequence(level, attempt)` and nothing else: attempt 0 draws the
   * level's historic board, and every later attempt draws a different
   * verified-winnable one. That is the whole unstick mechanism — a player who
   * cannot beat a board is handed another rather than the same wall.
   *
   * One counter rather than a per-level map: it is scoped to the level the run
   * is on, `applyWin` clears it, and a map would grow without bound inside the
   * 1 MB cloud-save cap for no benefit.
   */
  attempt: number;
}

export type TrackKey =
  | "garrison"
  | "production"
  | "engineering"
  | "salvage"
  | "secondWind";

/** The three actives sold on the POWERS tab. Tier 0 = locked; 1..3 = charges per level. */
export type AbilityKey = keyof AbilityCharges;

export interface UpgradeTrack {
  key: TrackKey;
  name: string;
  /** Cost of tier 1..maxTier. */
  costs: readonly number[];
  describe: (tier: number) => string;
}

/**
 * The five permanent tracks (the DOCTRINE tab).
 *
 * `describe` states the resulting CONDITION in the game's own units — seconds,
 * units, cores — never a delta and never a percentage. A row that reads
 * "+7% production" tells a player nothing they can picture; "a unit every
 * 1.4s" is the thing they actually watch during a level's opening.
 *
 * (That 7% was not even true: the interval table moves 45→42, 30→28 and 24→22
 * ticks, which is 6.7%, 7.1% and 9.1% depending on node size.)
 *
 * ENGINEERING replaces UPGRADE DISCOUNT + RAPID DEPLOY, merged because both
 * were measured dead: the reference bot never buys an in-run node upgrade and
 * the arithmetic says that is CORRECT play (a 0→1 upgrade takes 45 s to pay
 * for itself against a 39 s median win — see the upgradePass note in
 * solver.ts). Two cheap multipliers on a mechanic that does not pay were two
 * dead shop rows; one track that discounts AND accelerates at every tier at
 * least concentrates the bet. Each tier gives BOTH -2 upgrade cost and
 * -10 build ticks: cost max(9, 15-2t)/max(19, 25-2t), ticks 90-10t floored
 * at 60 — the same end values the two old tracks reached separately.
 *
 * Tier-1 costs came down ~35% in an earlier pass, and the reason is purchase
 * cadence, not generosity. Cores arrive at ~7-28 per early level, so at a
 * 60-core entry price the FIRST purchase landed at level 5 — the shop stayed
 * abstract through the whole window where a new player decides to stay.
 * At 40 it lands around level 3. Tiers 2-3 stay expensive: the late grind is
 * the retention curve. Boost-side effects only ever STRENGTHEN the player,
 * so screened boards stay verified (see main.ts boardFor).
 */
export const TRACKS: readonly UpgradeTrack[] = [
  { key: "garrison", name: "START GARRISON", costs: [40, 180, 420],
    describe: (t) =>
      t === 0 ? "Bare starting balls" : `+${[0, 2, 4, 6][t]} units on every start ball` },
  { key: "production", name: "PRODUCTION DRIVE", costs: [70, 260, 550],
    // Small-node interval at 30 Hz: PROD_TIERS[t][0] ticks per unit.
    describe: (t) => `Small balls: +1 unit / ${[1.5, 1.4, 1.3, 1.2][t]!.toFixed(1)}s` },
  { key: "engineering", name: "ENGINEERING", costs: [55, 210, 460],
    // Both effects, both exact at every tier: max(9,15-2t)/max(19,25-2t)
    // bottoms out at exactly t = 3, and 90-10t hits the 60-tick floor there
    // too. toFixed, or tier 3 prints "2s" beside "2.7s" and "2.3s".
    describe: (t) =>
      t === 0
        ? "Ball upgrades at full price and speed"
        : `Ball upgrades cost ${2 * t} less, finish in ${[3.0, 2.7, 2.3, 2.0][t]!.toFixed(1)}s` },
  { key: "salvage", name: "CORE SALVAGE", costs: [60, 240, 500],
    describe: (t) =>
      t === 0 ? "No salvage bonus" : `+${t} core${t === 1 ? "" : "s"} banked per win` },
  { key: "secondWind", name: "SECOND WIND", costs: [450],
    // describe() is called with tier+1 when unmaxed and tier when maxed, and
    // this track has one tier — so the old "+1 life per run" branch was
    // unreachable. Both live values now say the same true thing.
    describe: (t) => (t > 0 ? "A third life every run" : "Two lives per run") },
];

/* -------------------------------------------------------------- abilities */

export interface AbilityDef {
  key: AbilityKey;
  name: string;
  /** Cost of tier 1..3. Tier = charges granted per level. */
  costs: readonly number[];
  describe: (tier: number) => string;
}

/** "N charges per level" with the plural the salvage track already models. */
const perLevel = (t: number): string => `${t} charge${t === 1 ? "" : "s"} per level`;

/**
 * The POWERS tab: three player-only actives (see sim/tick.ts useAbility).
 * Same describe discipline as TRACKS — the CONDITION in game units, never a
 * percentage. Costs sit above the passive entry tiers on purpose: an active
 * is a depth purchase, and the first one should land around L6-8, after the
 * coach has retired and the passive habit is formed.
 */
export const ABILITIES: readonly AbilityDef[] = [
  { key: "overcharge", name: "OVERCHARGE", costs: [120, 260, 420],
    describe: (t) =>
      t === 0 ? "Locked" : `One of your balls makes units 4x faster for 10s · ${perLevel(t)}` },
  { key: "stasis", name: "STASIS", costs: [140, 280, 450],
    describe: (t) => (t === 0 ? "Locked" : `Freeze a ball for 5s · ${perLevel(t)}`) },
  { key: "recall", name: "RECALL", costs: [160, 300, 480],
    describe: (t) =>
      t === 0 ? "Locked" : `Pull every unit in flight back to your nearest ball · ${perLevel(t)}` },
];

/** Player-only production interval tables per Production Drive tier. */
const PROD_TIERS: readonly (readonly [number, number, number])[] = [
  PROD_INTERVAL,
  [42, 28, 22],
  [39, 26, 20],
  [36, 24, 18],
];

/**
 * The v3 save shape, kept ONLY as the migration input type — note the OLD
 * six-track upgrade record. The app uses SaveV4 everywhere else.
 */
export interface SaveV3 {
  v: 3;
  bestLevel: number;
  clearedMax: number;
  run: RunState;
  cores: number;
  upgrades: Record<
    "garrison" | "production" | "discount" | "buildSpeed" | "salvage" | "secondWind",
    number
  >;
  stars: Record<string, number>;
  daily: { lastClearUTC: string; dayStreak: number } | null;
  flags: SaveV4["flags"];
}

export interface SaveV4 {
  v: 4;
  bestLevel: number;
  /** Highest level ever WON (for first-clear core bonuses). */
  clearedMax: number;
  run: RunState;
  cores: number;
  upgrades: Record<TrackKey, number>;
  /** Ability tiers: 0 = locked; 1..3 = unlocked, tier = charges per level. */
  abilities: AbilityCharges;
  /** Best star rating per level (stringified level keys via JSON). */
  stars: Record<string, number>;
  daily: { lastClearUTC: string; dayStreak: number } | null;
  flags: {
    upgradeNudgeShown: boolean;
    /**
     * Onboarding steps completed (see app/coach.ts). One counter rather than a
     * flag per step, so the "STEP n OF m" readout falls out for free and adding
     * a step later cannot strand a flag. Skipping jumps it straight to the end.
     */
    coachProgress: number;
    /** The camera-discovery line fired once, on the first scrolling board. */
    panHintShown: boolean;
  };
}

export function livesFor(save: SaveV4): number {
  return BASE_LIVES + (save.upgrades.secondWind > 0 ? 1 : 0);
}

/* ------------------------------------------------------------- checkpoints */

/**
 * A run resumes from the last checkpoint reached, not from level 1.
 *
 * Losing a run used to send a player who had reached level 30 back to the
 * teaching levels, which is a punishment out of all proportion to the mistake
 * and the single least fun thing the game did. Getting far is most of the
 * reward on offer here; taking all of it away asks the player to re-earn
 * something they already proved.
 *
 * The roguelite loop survives because a checkpoint is only every third level:
 * a bad run still costs ground, just never much of it. (Was every fifth;
 * Hugo's 2026-08-10 playtest verdict wanted the Candy-Crush rhythm — frequent
 * banked progress with the map to show it.)
 *
 * Deliberately derived from `clearedMax` rather than stored. It is already
 * maintained by applyWin, already persisted, and already means exactly this —
 * so there is no new save field, no migration, and no way for a stored
 * checkpoint to drift out of step with what the player has actually beaten.
 */
export const CHECKPOINT_EVERY = 3;

/**
 * Levels that must be cleared before the Daily Challenge opens.
 *
 * The daily is a **L12-grade full-cast 4-way board** (`createDailyLevel` pins
 * `levelParams(12)`), and it was one tap from the level-1 victory screen. A
 * player who has finished exactly one tutorial level would meet three rivals on
 * the hardest topology the game ships, ninety seconds in — inside the first
 * minutes that decide whether a new player stays.
 *
 * Three, so it lines up with the first checkpoint: the daily arrives as a
 * reward for the first banked progress rather than as a trapdoor. (Hugo chose
 * to keep the alignment when checkpoints moved to every third level — this IS
 * earlier exposure to a hard board than the old level-5 gate; if daily
 * conversion looks bad on the dashboard, raise this before blaming the daily.)
 */
export const DAILY_UNLOCK_CLEARED = 3;

export function dailyUnlocked(save: SaveV4): boolean {
  return save.clearedMax >= DAILY_UNLOCK_CLEARED;
}

/** The level a fresh run starts on, given everything cleared so far. */
export function checkpointLevel(clearedMax: number): number {
  return Math.floor(Math.max(0, clearedMax) / CHECKPOINT_EVERY) * CHECKPOINT_EVERY + 1;
}

/** True if clearing `level` banks a new checkpoint — used to call it out. */
export function isCheckpoint(level: number): boolean {
  return level % CHECKPOINT_EVERY === 0;
}

/** One level on the progress path — everything a map node needs to draw. */
export interface ProgressEntry {
  level: number;
  /** Best stars earned on this level, 0–3. */
  stars: number;
  cleared: boolean;
  checkpoint: boolean;
  boss: boolean;
  /** The level the player is on (or about to start). Exactly one per path. */
  current: boolean;
  /** Beyond the frontier: not cleared and not the next level to play. */
  locked: boolean;
}

/**
 * A window of the level path around `current`, for the progress strip and the
 * map screen. Pure — the renderer draws these entries and derives nothing,
 * which keeps one owner for the progression rules (see OverlayView's note).
 *
 * The window slides so `current` sits centred once the journey is long enough,
 * but it is ANCHORED at level 1 early on: a new player's map starts at the
 * start, it does not show three locked levels of runway behind them.
 */
export function progressPath(save: SaveV4, current: number, count: number): ProgressEntry[] {
  const start = Math.max(1, current - Math.floor(count / 2));
  return Array.from({ length: count }, (_, i) => {
    const level = start + i;
    return {
      level,
      stars: save.stars[String(level)] ?? 0,
      cleared: level <= save.clearedMax,
      checkpoint: isCheckpoint(level),
      boss: isBossLevel(level),
      current: level === current,
      locked: level > save.clearedMax + 1,
    };
  });
}

export function newRun(save?: SaveV4): RunState {
  return {
    level: save ? checkpointLevel(save.clearedMax) : 1,
    lives: save ? livesFor(save) : BASE_LIVES,
    attempt: 0,
  };
}

export function newSave(): SaveV4 {
  const save: SaveV4 = {
    v: 4,
    bestLevel: 1,
    clearedMax: 0,
    run: { level: 1, lives: BASE_LIVES, attempt: 0 },
    cores: 0,
    upgrades: { garrison: 0, production: 0, engineering: 0, salvage: 0, secondWind: 0 },
    abilities: { overcharge: 0, stasis: 0, recall: 0 },
    stars: {},
    daily: null,
    flags: { upgradeNudgeShown: false, coachProgress: 0, panHintShown: false },
  };
  return save;
}

/** Fold permanent upgrades into the sim-facing boost object. */
export function boostsFor(save: SaveV4): PlayerBoosts {
  const u = save.upgrades;
  const a = save.abilities;
  const anyAbility = a.overcharge > 0 || a.stasis > 0 || a.recall > 0;
  return {
    startUnits: [0, 2, 4, 6][u.garrison]!,
    prodInterval: PROD_TIERS[u.production]!,
    upgradeCost: [
      Math.max(9, UPGRADE_COST[0] - 2 * u.engineering),
      Math.max(19, UPGRADE_COST[1] - 2 * u.engineering),
    ] as const,
    upgradeTicks: Math.max(60, UPGRADE_TICKS - 10 * u.engineering),
    // Tier = charges per level, copied straight through. ABSENT when nothing
    // is owned — that keeps cfg.abilities unset and the built state
    // byte-identical to a pre-ability build (the hash contract in state.ts).
    ...(anyAbility ? { abilities: { overcharge: a.overcharge, stasis: a.stasis, recall: a.recall } } : {}),
  };
}

/* ------------------------------------------------------------------ cores */

export interface WinContext {
  level: number;
  stars: 1 | 2 | 3;
  streak: number;
  rivalsEliminatedByPlayer: number;
}

/** Cores earned for a level win (losses pay 0). */
export function coresForWin(save: SaveV4, w: WinContext): number {
  const starMult = [0, 1, 1.5, 2][w.stars]!;
  const base = Math.floor(w.level * starMult);
  const first = w.level > save.clearedMax ? 5 : 0;
  const fire = w.streak >= 3 ? 3 : 0;
  const bounty = 3 * w.rivalsEliminatedByPlayer;
  const salvage = save.upgrades.salvage;
  return Math.min(base + first + fire + bounty + salvage, 2 * w.level + 10);
}

/* -------------------------------------------------------------------- stars */

/** Career star total. `save.stars` was write-only before this had readers. */
export function totalStars(save: SaveV4): number {
  let n = 0;
  for (const k in save.stars) n += save.stars[k]!;
  return n;
}

/**
 * Star-total milestones and what they pay.
 *
 * This is what makes the per-level rating a currency rather than a decoration:
 * a 1★ level is now a visible IOU. Spacing is ~8-16 clean levels per step —
 * far enough apart to be events, close enough that the first one lands inside
 * the first session.
 */
export const STAR_MILESTONES: readonly { at: number; cores: number }[] = [
  { at: 15, cores: 30 },
  { at: 40, cores: 60 },
  { at: 75, cores: 100 },
  { at: 120, cores: 150 },
];

/**
 * Cores owed for milestones crossed between two star totals.
 *
 * Pure and monotone-safe: totals only ever rise (applyWin takes a max per
 * level), so "crossed" can never pay twice and needs no persisted flag.
 */
export function starMilestoneBonus(prevTotal: number, newTotal: number): number {
  let bonus = 0;
  for (const m of STAR_MILESTONES) if (prevTotal < m.at && newTotal >= m.at) bonus += m.cores;
  return bonus;
}

export function buyUpgrade(save: SaveV4, key: TrackKey): boolean {
  const track = TRACKS.find((t) => t.key === key)!;
  const tier = save.upgrades[key];
  if (tier >= track.costs.length) return false;
  const cost = track.costs[tier]!;
  if (save.cores < cost) return false;
  save.cores -= cost;
  save.upgrades[key] = tier + 1;
  return true;
}

/** Same flow as buyUpgrade, over the POWERS table. Tier = charges per level. */
export function buyAbility(save: SaveV4, key: AbilityKey): boolean {
  const def = ABILITIES.find((a) => a.key === key)!;
  const tier = save.abilities[key];
  if (tier >= def.costs.length) return false;
  const cost = def.costs[tier]!;
  if (save.cores < cost) return false;
  save.cores -= cost;
  save.abilities[key] = tier + 1;
  return true;
}

/* -------------------------------------------------------------- transitions */

export interface DefeatResult {
  save: SaveV4;
  runOver: boolean;
  reachedLevel: number;
  /** Where the next run begins. Equals 1 until the first checkpoint is banked. */
  resumeLevel: number;
}

/** Winning level N advances the run; caller applies cores separately. */
export function applyWin(save: SaveV4, w: WinContext): SaveV4 {
  const level = save.run.level + 1;
  const stars = { ...save.stars };
  const prev = stars[String(w.level)] ?? 0;
  if (w.stars > prev) stars[String(w.level)] = w.stars;
  // Milestone cores ride the same credit as the win itself. Computed from the
  // before/after totals, so a replay that improves 1★ -> 3★ counts its two new
  // stars — and can itself cross a milestone.
  const bonus = starMilestoneBonus(totalStars(save), Object.values(stars).reduce((a, b) => a + b, 0));
  return {
    ...save,
    bestLevel: Math.max(save.bestLevel, level),
    clearedMax: Math.max(save.clearedMax, w.level),
    cores: save.cores + coresForWin(save, w) + bonus,
    stars,
    run: { level, lives: save.run.lives, attempt: 0 },
  };
}

export function applyDefeat(save: SaveV4): DefeatResult {
  const level = save.run.level;
  const attempt = save.run.attempt + 1;
  const lives = save.run.lives - 1;
  if (lives <= 0) {
    const base = newRun(save);
    // A run-over that lands the player back on the SAME level is still another
    // attempt at that level, and the counter has to survive it or the board
    // never changes. This is not an edge case: clearing L5 makes L6 the
    // checkpoint floor, so losing L6 twice resumes on L6 — which is exactly the
    // loop players reported being stuck in. Reset only when the fallback
    // actually moves them somewhere else.
    const run = { ...base, attempt: base.level === level ? attempt : 0 };
    return {
      save: { ...save, run },
      runOver: true,
      reachedLevel: level,
      resumeLevel: run.level,
    };
  }
  return {
    save: { ...save, run: { level, lives, attempt } },
    runOver: false,
    reachedLevel: level,
    resumeLevel: level,
  };
}

/* -------------------------------------------------------------------- daily */

/** UTC date string → deterministic seed (FNV-1a). Same board worldwide. */
export function dailySeed(dateUTC: string): number {
  let h = 2166136261;
  for (let i = 0; i < dateUTC.length; i++) {
    h ^= dateUTC.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h | 0;
}

export function todayUTC(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Cores for a daily clear; pays once per UTC day. Returns 0 if already paid. */
/**
 * What a daily clear pays on streak day N.
 *
 * Exported because the OVERLAY needs it for "TOMORROW PAYS 45" — the streak
 * was persisted and never displayed anywhere, which made it a retention
 * mechanic with the retention part missing.
 */
export function dailyRewardFor(dayStreak: number): number {
  return 30 + Math.min(25, 5 * (dayStreak - 1));
}

export function applyDailyClear(save: SaveV4, dateUTC: string): number {
  if (save.daily?.lastClearUTC === dateUTC) return 0;
  const yesterday = new Date(new Date(dateUTC).getTime() - 86_400_000).toISOString().slice(0, 10);
  const dayStreak = save.daily?.lastClearUTC === yesterday ? save.daily.dayStreak + 1 : 1;
  const reward = dailyRewardFor(dayStreak);
  save.daily = { lastClearUTC: dateUTC, dayStreak };
  save.cores += reward;
  return reward;
}

/* ---------------------------------------------------------------- migration */

/** Per-tier prices the RETIRED v3 tracks actually charged, for the refund. */
const V3_DISCOUNT_COSTS = [55, 200, 450] as const;
const V3_BUILD_COSTS = [50, 190, 400] as const;

const clampTier = (x: unknown, max = 3): number =>
  Math.max(0, Math.min(max, Math.floor(Number(x) || 0)));

/**
 * Fold v3's UPGRADE DISCOUNT + RAPID DEPLOY into one ENGINEERING tier, and
 * price the difference.
 *
 * The carried tier is max(discount, buildSpeed) — engineering gives both
 * effects, so the stronger of the two is what the player keeps. The refund is
 * what they actually paid on BOTH old tracks minus what the carried tiers
 * would have cost at engineering prices, floored at zero: a buildSpeed-only
 * save paid slightly less than the engineering ladder charges (50 vs 55 at
 * tier 1) and now owns strictly more than it bought, so "player-positive"
 * there means no refund, never a charge.
 */
function mergeEngineering(
  discount: unknown,
  buildSpeed: unknown,
): { tier: number; refund: number } {
  const d = clampTier(discount);
  const b = clampTier(buildSpeed);
  const tier = Math.max(d, b);
  const eng = TRACKS.find((t) => t.key === "engineering")!.costs;
  let paid = 0;
  for (let i = 0; i < d; i++) paid += V3_DISCOUNT_COSTS[i]!;
  for (let i = 0; i < b; i++) paid += V3_BUILD_COSTS[i]!;
  let carried = 0;
  for (let i = 0; i < tier; i++) carried += eng[i]!;
  return { tier, refund: Math.max(0, paid - carried) };
}

/**
 * Normalise an almost-v4 object into a valid SaveV4. One body for the v4
 * pass-through and the v3 upgrade, so the corrupt-field discipline cannot
 * fork: an absent field defaults correctly via the `...base` spread, but a
 * present-and-corrupt one would flow straight into seedSequence (attempt),
 * livesFor (lives) or the shop (tiers).
 */
function normalizeV4(o: Record<string, unknown>): SaveV4 {
  const base = newSave();
  const run = (o.run ?? {}) as Partial<RunState>;
  const merged: SaveV4 = {
    ...base,
    ...(o as unknown as SaveV4),
    v: 4,
    run: {
      level: Math.max(1, Math.floor(Number(run.level) || 1)),
      lives: Math.max(1, Math.min(3, Math.floor(Number(run.lives) || BASE_LIVES))),
      attempt: Math.max(0, Math.min(9999, Math.floor(Number(run.attempt) || 0))),
    },
    upgrades: { ...base.upgrades, ...(o.upgrades as SaveV4["upgrades"] | undefined) },
    abilities: { ...base.abilities, ...(o.abilities as SaveV4["abilities"] | undefined) },
    flags: { ...base.flags, ...(o.flags as SaveV4["flags"] | undefined) },
  };
  // Ability tiers are 0..3 by construction; a corrupt one would grant charges
  // forever, so clamp on load exactly like the attempt counter.
  merged.abilities = {
    overcharge: clampTier(merged.abilities.overcharge),
    stasis: clampTier(merged.abilities.stasis),
    recall: clampTier(merged.abilities.recall),
  };
  // A save from before the onboarding existed has no coachProgress, so it
  // would default to 0 and re-teach the drag to someone on level 40. Anyone
  // who has cleared the teaching band has demonstrably been taught.
  if (merged.clearedMax >= 3) merged.flags.coachProgress = COACH_STEPS.length;
  merged.bestLevel = Math.max(merged.bestLevel, merged.run.level);
  merged.cores = Math.max(0, Math.floor(merged.cores));
  return merged;
}

export function migrateSave(raw: unknown): SaveV4 {
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (o.v === 4 && typeof o.bestLevel === "number" && o.run && typeof o.run === "object") {
      return normalizeV4(o);
    }
    if (o.v === 3 && typeof o.bestLevel === "number" && o.run && typeof o.run === "object") {
      // v3 -> v4: the two retired tracks fold into ENGINEERING (see
      // mergeEngineering); everything else carries. Abilities start locked —
      // they did not exist to be bought.
      const up = (o.upgrades ?? {}) as Partial<SaveV3["upgrades"]>;
      const { tier, refund } = mergeEngineering(up.discount, up.buildSpeed);
      const upgrades: SaveV4["upgrades"] = {
        garrison: clampTier(up.garrison),
        production: clampTier(up.production),
        engineering: tier,
        salvage: clampTier(up.salvage),
        secondWind: clampTier(up.secondWind, 1),
      };
      return normalizeV4({
        ...o,
        upgrades,
        abilities: undefined, // locked; normalizeV4 fills the zeros
        cores: Math.max(0, Math.floor(Number(o.cores) || 0)) + refund,
      });
    }
    // v2: keep best + run, welcome-back core gift so veterans buy something.
    if (o.v === 2 && typeof o.bestLevel === "number" && o.bestLevel >= 1) {
      const save = newSave();
      const run = (o.run ?? {}) as Partial<RunState>;
      save.bestLevel = Math.floor(o.bestLevel as number);
      save.clearedMax = Math.max(0, save.bestLevel - 1);
      save.run = {
        level: Math.max(1, Math.floor(run.level ?? 1)),
        lives: Math.max(1, Math.min(BASE_LIVES, Math.floor(run.lives ?? BASE_LIVES))),
        // A v2 save predates the attempt counter entirely, so this player has
        // never been screened a board. Start them on the historic one.
        attempt: 0,
      };
      save.cores = 5 * save.bestLevel;
      save.flags.coachProgress = COACH_STEPS.length;
      return save;
    }
    // v1
    if (typeof o.highestLevel === "number" && o.highestLevel >= 1) {
      const save = newSave();
      save.bestLevel = Math.floor(o.highestLevel);
      save.clearedMax = Math.max(0, save.bestLevel - 1);
      save.cores = 5 * save.bestLevel;
      save.flags.coachProgress = COACH_STEPS.length;
      return save;
    }
  }
  return newSave();
}
