/**
 * The merchant's whole catalogue, and the hero maths derived from it.
 *
 * One marquee VERB per world — the drip-feed is the run's spine: you start
 * with only a swing, and every shop teaches you a new way to play. Stat
 * SKUs fill out each shop. Every SKU is sold exactly once per run (the
 * upgrades suite enforces it), and prices are tuned against the room
 * income tables so a player who clears rooms always affords the verb —
 * with change for one or two stats, never everything.
 *
 * All hp numbers are in half-hearts. All timings in ticks at 60/s.
 */

export type UpgradeKind = "verb" | "stat";

export type Upgrade = {
  id: string;
  name: string;
  desc: string; // shop card copy — lowercase, short
  price: number;
  world: number; // which shop stocks it
  kind: UpgradeKind;
};

export const UPGRADES: Upgrade[] = [
  // ---- world 1 ------------------------------------------------------
  { id: "roll", name: "dodge roll", desc: "a quick tumble. brief invincibility.", price: 40, world: 1, kind: "verb" },
  { id: "heart1", name: "heart container", desc: "+1 heart. filled on delivery.", price: 30, world: 1, kind: "stat" },
  { id: "speed1", name: "boots I", desc: "walk a little faster.", price: 25, world: 1, kind: "stat" },
  // ---- world 2 ------------------------------------------------------
  { id: "dagger", name: "throwing daggers", desc: "pointy mail. unlimited stamps.", price: 55, world: 2, kind: "verb" },
  { id: "dmg1", name: "whetstone I", desc: "sword damage up.", price: 35, world: 2, kind: "stat" },
  { id: "rollcd1", name: "loose laces", desc: "roll again sooner.", price: 25, world: 2, kind: "stat" },
  { id: "magnet1", name: "coin magnet I", desc: "coins drift toward you.", price: 20, world: 2, kind: "stat" },
  // ---- world 3 ------------------------------------------------------
  { id: "charge", name: "charge slash", desc: "hold, glint, release. breaks shields.", price: 70, world: 3, kind: "verb" },
  { id: "heart2", name: "heart container", desc: "+1 heart. filled on delivery.", price: 40, world: 3, kind: "stat" },
  { id: "daggerdmg", name: "sharper daggers", desc: "dagger damage doubled.", price: 35, world: 3, kind: "stat" },
  { id: "speed2", name: "boots II", desc: "walk faster still.", price: 30, world: 3, kind: "stat" },
  // ---- world 4 ------------------------------------------------------
  { id: "parry", name: "parry", desc: "meet it head on. returns to sender.", price: 85, world: 4, kind: "verb" },
  { id: "dmg2", name: "whetstone II", desc: "sword damage up again.", price: 50, world: 4, kind: "stat" },
  { id: "flask", name: "cream soda flask", desc: "heals two hearts. refills at shops.", price: 40, world: 4, kind: "stat" },
  { id: "magnet2", name: "coin magnet II", desc: "coins hurry toward you.", price: 30, world: 4, kind: "stat" },
  // ---- world 5 ------------------------------------------------------
  { id: "dash", name: "dash strike", desc: "a blade with momentum. no mercy, no i-frames.", price: 100, world: 5, kind: "verb" },
  { id: "heart3", name: "heart container", desc: "+1 heart. filled on delivery.", price: 50, world: 5, kind: "stat" },
  { id: "rollcd2", name: "lighter boots", desc: "roll much sooner.", price: 40, world: 5, kind: "stat" },
  { id: "speed3", name: "boots III", desc: "frankly quick now.", price: 35, world: 5, kind: "stat" },
  // ---- world 6 ------------------------------------------------------
  { id: "whirl", name: "whirlwind", desc: "everything around you, at once.", price: 115, world: 6, kind: "verb" },
  { id: "arc1", name: "wider swing I", desc: "sword arc 90° → 120°.", price: 45, world: 6, kind: "stat" },
  { id: "fan", name: "dagger fan", desc: "three daggers per throw.", price: 55, world: 6, kind: "stat" },
  { id: "flask2", name: "second flask charge", desc: "more cream soda.", price: 40, world: 6, kind: "stat" },
  // ---- world 7 ------------------------------------------------------
  { id: "bomb", name: "bomb", desc: "lobbed opinion. flushes what hides.", price: 140, world: 7, kind: "verb" },
  { id: "dmg3", name: "whetstone III", desc: "sword damage up again.", price: 70, world: 7, kind: "stat" },
  { id: "pierce", name: "dagger pierce", desc: "daggers keep going through one kill.", price: 50, world: 7, kind: "stat" },
  { id: "magnet3", name: "coin magnet III", desc: "the whole room's coins are yours.", price: 35, world: 7, kind: "stat" },
  // ---- world 8 ------------------------------------------------------
  { id: "flash", name: "flash", desc: "one bright argument. ghosts hate it.", price: 150, world: 8, kind: "verb" },
  { id: "heart4", name: "heart container", desc: "+1 heart. filled on delivery.", price: 70, world: 8, kind: "stat" },
  { id: "roll2", name: "double roll", desc: "two rolls before the cooldown.", price: 60, world: 8, kind: "stat" },
  { id: "oil", name: "lantern oil", desc: "a wider, longer cone of light.", price: 35, world: 8, kind: "stat" },
  // ---- world 9 ------------------------------------------------------
  { id: "beam", name: "sword beam", desc: "at full hearts, the swing travels. the classic.", price: 160, world: 9, kind: "verb" },
  { id: "heart5", name: "heart container", desc: "+1 heart. filled on delivery.", price: 70, world: 9, kind: "stat" },
  { id: "dmg4", name: "whetstone IV", desc: "sword damage up. it hums now.", price: 90, world: 9, kind: "stat" },
  { id: "speed4", name: "boots IV", desc: "the fast ones.", price: 40, world: 9, kind: "stat" },
  // ---- world 10 -----------------------------------------------------
  { id: "overclock", name: "overclock", desc: "brief. brilliant. everything, faster.", price: 170, world: 10, kind: "verb" },
  { id: "arc2", name: "wider swing II", desc: "sword arc 120° → 150°.", price: 60, world: 10, kind: "stat" },
  { id: "flask3", name: "third flask charge", desc: "the last cream soda.", price: 50, world: 10, kind: "stat" },
  { id: "coin", name: "one (1) coin", desc: "a coin. for a coin. it's the principle of the thing.", price: 1, world: 10, kind: "stat" },
];

/** The marquee verb of each world, in canonical order. */
export const VERB_ORDER = [
  "roll",
  "dagger",
  "charge",
  "parry",
  "dash",
  "whirl",
  "bomb",
  "flash",
  "beam",
  "overclock",
] as const;

export function upgradeById(id: string): Upgrade | undefined {
  return UPGRADES.find((u) => u.id === id);
}

// -----------------------------------------------------------------------
// Derived hero stats — the one place gear becomes numbers.
// -----------------------------------------------------------------------

export type HeroStats = {
  maxHp: number; // half-hearts
  dmg: number; // sword damage per hit
  speed: number; // px/s
  arcDeg: number; // sword arc
  reach: number; // sword reach px
  magnetR: number; // coin magnet radius px
  rollCd: number; // ticks after a roll before the next
  rollCharges: number;
  flaskMax: number; // flask charges
  daggerDmg: number;
  daggerFan: boolean;
  daggerPierce: boolean;
  coneWide: boolean; // lantern oil
  has: (id: string) => boolean;
};

export const BASE_HEARTS = 3;
export const BASE_DMG = 2;
export const BASE_SPEED = 80;
export const BASE_ARC = 90;
export const SWORD_REACH = 22;

export function heroStats(gear: readonly string[]): HeroStats {
  const owned = new Set(gear);
  const has = (id: string) => owned.has(id);
  const hearts =
    BASE_HEARTS +
    ["heart1", "heart2", "heart3", "heart4", "heart5"].filter(has).length;
  const dmg = BASE_DMG + ["dmg1", "dmg2", "dmg3", "dmg4"].filter(has).length;
  const speed =
    BASE_SPEED + 6 * ["speed1", "speed2", "speed3", "speed4"].filter(has).length;
  const arcDeg = has("arc2") ? 150 : has("arc1") ? 120 : BASE_ARC;
  const magnetR = has("magnet3") ? 400 : has("magnet2") ? 96 : has("magnet1") ? 48 : 12;
  const rollCd = has("rollcd2") ? 14 : has("rollcd1") ? 22 : 30;
  const flaskMax = has("flask") ? 1 + (has("flask2") ? 1 : 0) + (has("flask3") ? 1 : 0) : 0;
  return {
    maxHp: hearts * 2,
    dmg,
    speed,
    arcDeg,
    reach: SWORD_REACH,
    magnetR,
    rollCd,
    rollCharges: has("roll2") ? 2 : 1,
    flaskMax,
    daggerDmg: has("daggerdmg") ? 2 : 1,
    daggerFan: has("fan"),
    daggerPierce: has("pierce"),
    coneWide: has("oil"),
    has,
  };
}

/**
 * The DPS model the boss-TTK tests compute from — a named table, not a
 * magic number inside a test. Sustained damage/s ≈ sword damage ×
 * swings/s × uptime, plus flat bonuses for the ranged/riposte verbs.
 */
export const DPS_MODEL = {
  swingsPerSec: 1.2,
  uptime: 0.55,
  daggerBonus: 0.3,
  parryBonus: 0.2,
  beamBonus: 0.2,
} as const;

/** Expected gear at world N's boss: every verb through N, damage tiers on pace. */
export function expectedGearAtWorld(world: number): string[] {
  const gear: string[] = [];
  for (const u of UPGRADES) {
    if (u.world > world) continue;
    if (u.kind === "verb") gear.push(u.id);
  }
  // The on-pace stat path: damage and hearts bought as they appear.
  for (const id of ["dmg1", "dmg2", "dmg3", "dmg4", "heart1", "heart2", "heart3", "heart4", "heart5"]) {
    const u = upgradeById(id)!;
    if (u.world <= world) gear.push(id);
  }
  return gear;
}

export function expectedDps(world: number): number {
  const stats = heroStats(expectedGearAtWorld(world));
  let dps = stats.dmg * DPS_MODEL.swingsPerSec * DPS_MODEL.uptime;
  if (stats.has("dagger")) dps += DPS_MODEL.daggerBonus;
  if (stats.has("parry")) dps += DPS_MODEL.parryBonus;
  if (stats.has("beam")) dps += DPS_MODEL.beamBonus;
  return dps;
}
