/**
 * The in-game guide, generated from content.ts alone. No DOM, no CSS: every
 * builder returns plain data or an HTML string that ui.ts drops into the
 * guide screen. Weapons, items, drones, mods, maps and heroes added to the
 * content records appear here without any change to this file.
 */
import {
  BAG_CAPACITY,
  BAG_SLOT_COST,
  BOSS_INTERVAL,
  BOSS_NAMES,
  CAMPAIGN_WAVES,
  ELITE,
  ENEMY_STATS,
  FAMILIES,
  FAMILY_ORDER,
  HEROES,
  HERO_ORDER,
  HINTS,
  ITEMS,
  MAPS,
  MAP_COUNT,
  MAP_ORDER,
  MAP_RAMP,
  MAX_EXTRA_SLOTS,
  RANKS,
  REPAIR_HEAL,
  SELL_RATE,
  SET_TIERS,
  SHOP_OFFERS,
  THREATS,
  WAVE_CLEAR_BONUS,
  WAVE_END_HEAL,
  WEAPONS,
  WEAVE,
  bossAddBudget,
  eliteChance,
  hordeCount,
  hordeSize,
  mapStatLines,
  mapThreatSchedule,
  offerPrice,
  rankScale,
  rankStatLines,
  repairCost,
  rerollCost,
  waveBudget,
  waveDuration,
  type EnemyKind,
  type EquipmentCategory,
  type FamilyDefinition,
  type FamilyId,
  type HeroDefinition,
  type HeroId,
  type ItemDefinition,
  type ItemId,
  type MapDefinition,
  type MapId,
  type PatternSpec,
  type SetTierSize,
  type WeaponDefinition,
  type WeaponId,
  DRONE_STACK_RATE,
} from "./content";

export type GuideTab =
  | "weapons"
  | "items"
  | "drones"
  | "mods"
  | "sets"
  | "maps"
  | "heroes"
  | "enemies"
  | "howto";

export interface GuideTabDefinition {
  id: GuideTab;
  label: string;
  icon: string;
  usesFamily: boolean;
  usesRank: boolean;
  layout: "catalog" | "panel";
}

export const GUIDE_TABS: GuideTabDefinition[] = [
  { id: "weapons", label: "Weapons", icon: "pistol", usesFamily: true, usesRank: true, layout: "catalog" },
  { id: "items", label: "Items", icon: "power", usesFamily: true, usesRank: true, layout: "catalog" },
  { id: "drones", label: "Drones", icon: "drone", usesFamily: true, usesRank: true, layout: "catalog" },
  { id: "mods", label: "Mods", icon: "settings", usesFamily: true, usesRank: true, layout: "catalog" },
  { id: "sets", label: "Sets", icon: "merge", usesFamily: true, usesRank: false, layout: "panel" },
  { id: "maps", label: "Maps", icon: "trophy", usesFamily: false, usesRank: false, layout: "catalog" },
  { id: "heroes", label: "Characters", icon: "heart", usesFamily: false, usesRank: false, layout: "catalog" },
  { id: "enemies", label: "Enemies", icon: "shield", usesFamily: false, usesRank: false, layout: "panel" },
  { id: "howto", label: "How to play", icon: "info", usesFamily: false, usesRank: false, layout: "panel" },
];

export interface GuideEntry {
  id: string;
  name: string;
  description: string;
  families: FamilyId[];
  category: EquipmentCategory | "map" | "hero";
  icon: string;
  accent?: string;
  insane?: boolean;
  minWave?: number;
}

export interface GuideLine {
  icon: string;
  text: string;
}

export interface GuideView {
  icon: (id: string, className?: string) => string;
  art?: Record<string, string>;
  escape: (s: string) => string;
  rankBadge: (level: number) => string;
  familyChip: (id: FamilyId) => string;
  clearedBy?: Partial<Record<MapId, HeroId[]>>;
  heroRecords?: Partial<Record<HeroId, number>>;
}

export interface GuideState {
  family: FamilyId | "all";
  rank: number;
  selected: string | null;
}

/* ---------------------------------------------------------------------------
 * Small formatting helpers. Every number passes through `num` so a float such
 * as 4.550000001 prints as 4.55 and nothing non-finite ever reaches the page.
 * ------------------------------------------------------------------------- */
const num = (value: number): string =>
  Number.isFinite(value) ? String(Math.round(value * 100) / 100) : "0";
const pct = (fraction: number): string => `${num(fraction * 100)}%`;
const plural = (count: number, word: string, many = `${word}s`): string =>
  `${num(count)} ${count === 1 ? word : many}`;
const seconds = (value: number): string => `${num(value)}s`;
const capitalize = (text: string): string =>
  text.length ? text[0].toUpperCase() + text.slice(1) : text;
const rankName = (level: number): string =>
  RANKS[Math.max(0, Math.min(RANKS.length - 1, Math.floor(level) - 1))].name;
const clampRank = (level: number): number =>
  Math.max(1, Math.min(RANKS.length, Math.floor(Number.isFinite(level) ? level : 1)));
const pad2 = (wave: number): string => String(Math.max(0, Math.floor(wave))).padStart(2, "0");

/** Icon for a stat line, following the shop's metric-chip conventions. */
function statIcon(line: string): string {
  const label = line.toLowerCase();
  if (/per attack|attack speed|fire rate/.test(label)) return "haste";
  if (/armor/.test(label)) return "plating";
  if (/move(?:ment)? speed/.test(label)) return "speed";
  if (/pickup (?:reach|range)/.test(label)) return "magnet";
  if (/emeralds|salvage/.test(label)) return "coin";
  if (/health\s*\/|^heal /.test(label)) return "mending";
  if (/health/.test(label)) return "heart";
  if (/dash/.test(label)) return "dash";
  if (/burn/.test(label)) return "thermal";
  if (/poison/.test(label)) return "toxic";
  if (/slow|freez/.test(label)) return "frost";
  if (/lightning|chain|target|jump/.test(label)) return "storm";
  if (/splash|blast|explo/.test(label)) return "rocket";
  if (/pierc|line|reach|range/.test(label)) return "railgun";
  if (/return/.test(label)) return "boomerang";
  if (/orbit/.test(label)) return "orbit";
  if (/knock|spread|pellet/.test(label)) return "shotgun";
  if (/damage/.test(label)) return "power";
  return "info";
}

const line = (icon: string, text: string): GuideLine => ({ icon, text });

/* ---------------------------------------------------------------------------
 * Entries.
 * ------------------------------------------------------------------------- */
const weaponEntry = (weapon: WeaponDefinition): GuideEntry => ({
  id: weapon.id,
  name: weapon.name,
  description: weapon.description,
  families: weapon.families,
  category: "weapon",
  icon: weapon.id,
  accent: weapon.color,
  ...(weapon.unique ? { insane: true } : {}),
  ...(weapon.minWave && weapon.minWave > 1 ? { minWave: weapon.minWave } : {}),
});

const itemEntry = (item: ItemDefinition): GuideEntry => ({
  id: item.id,
  name: item.name,
  description: item.description,
  families: item.families,
  category: item.category,
  icon: item.id,
  accent: item.color,
});

const mapEntry = (map: MapDefinition): GuideEntry => ({
  id: String(map.id),
  name: map.name,
  description: map.tagline,
  families: [],
  category: "map",
  icon: "trophy",
  accent: `#${map.palette.accent.toString(16).padStart(6, "0")}`,
});

const heroEntry = (hero: HeroDefinition): GuideEntry => ({
  id: hero.id,
  name: hero.name,
  description: hero.description,
  families: hero.setPiece,
  category: "hero",
  icon: hero.weapon,
  accent: hero.color,
});

const weaponList = (): WeaponDefinition[] => Object.values(WEAPONS);
const itemList = (category: ItemDefinition["category"]): ItemDefinition[] =>
  Object.values(ITEMS).filter((item) => item.category === category);
const mapList = (): MapDefinition[] =>
  MAP_ORDER.map((id) => MAPS.find((map) => map.id === id)).filter(
    (map): map is MapDefinition => !!map,
  );
const mapOf = (entry: GuideEntry): MapDefinition | undefined =>
  MAPS.find((map) => String(map.id) === entry.id);
const heroOf = (entry: GuideEntry): HeroDefinition | undefined =>
  HEROES[entry.id as HeroId];

const GEAR_TABS: Record<
  Extract<GuideTab, "weapons" | "items" | "drones" | "mods">,
  () => GuideEntry[]
> = {
  weapons: () => weaponList().map(weaponEntry),
  items: () => itemList("passive").map(itemEntry),
  drones: () => itemList("drone").map(itemEntry),
  mods: () => itemList("mod").map(itemEntry),
};

export function guideEntries(
  tab: GuideTab,
  family: FamilyId | "all",
): GuideEntry[] {
  if (tab in GEAR_TABS) {
    const entries = GEAR_TABS[tab as keyof typeof GEAR_TABS]();
    return family === "all"
      ? entries
      : entries.filter((entry) => entry.families.includes(family));
  }
  if (tab === "maps") return mapList().map(mapEntry);
  if (tab === "heroes") return HERO_ORDER.map((id) => heroEntry(HEROES[id]));
  return [];
}

/* ---------------------------------------------------------------------------
 * Detail lines.
 * ------------------------------------------------------------------------- */
function patternLines(spec: PatternSpec): GuideLine[] {
  const lines: GuideLine[] = [];
  const knock = (value: number | undefined) => {
    if (value && value >= 2) lines.push(line("shotgun", `Knockback ${num(value)}`));
  };
  switch (spec.kind) {
    case "bullet": {
      if (spec.pierce >= 20) lines.push(line("railgun", "Passes through every enemy"));
      else if (spec.pierce > 1) lines.push(line("railgun", `Pierces ${plural(spec.pierce, "enemy", "enemies")}`));
      if (spec.splash) lines.push(line("rocket", `Splash radius ${num(spec.splash)}`));
      if (spec.bounces) lines.push(line("boomerang", `Bounces ${plural(spec.bounces, "time")}`));
      if (spec.returning) lines.push(line("boomerang", "Returns to you and hits again"));
      if (spec.homing) lines.push(line("focus", "Homes in on enemies"));
      if (spec.children)
        lines.push(
          line(
            "shotgun",
            `Bursts into ${plural(spec.children.count, "shard")} at ${pct(spec.children.damage)} damage`,
          ),
        );
      if (spec.trail)
        lines.push(
          line(
            "thermal",
            `Leaves a trail: ${num(spec.trail.damage)} damage in radius ${num(spec.trail.radius)} for ${seconds(spec.trail.duration)}`,
          ),
        );
      if (spec.pull)
        lines.push(line("magnet", `Pulls enemies within ${num(spec.pull.radius)} for ${seconds(spec.pull.duration)}`));
      if (spec.emit)
        lines.push(
          line(
            spec.emit.kind === "zap" ? "storm" : spec.emit.kind === "crush" ? "plating" : "pistol",
            `${capitalize(spec.emit.kind)}s every ${seconds(spec.emit.every)} for ${num(spec.emit.damage)} damage within ${num(spec.emit.reach)}`,
          ),
        );
      if (spec.stationary) lines.push(line("focus", "Stays where it is cast"));
      if (spec.grow) lines.push(line("orbit", `Ring grows ${num(spec.grow)} per second`));
      if (spec.fuse && !spec.children) lines.push(line("haste", `Lasts ${seconds(spec.fuse)}`));
      if (spec.maxActive) lines.push(line("info", `Up to ${num(spec.maxActive)} active at once`));
      knock(spec.knock);
      break;
    }
    case "line":
      lines.push(line("railgun", `Reach ${num(spec.reach)}`));
      lines.push(line("railgun", "Hits every enemy in a line"));
      knock(spec.knock);
      break;
    case "cone": {
      const degrees = Math.round((Math.acos(Math.max(-1, Math.min(1, spec.arc))) * 2 * 180) / Math.PI);
      lines.push(line("flame", `Reach ${num(spec.reach)}`));
      lines.push(line("flame", `${num(degrees)}° cone`));
      knock(spec.knock);
      break;
    }
    case "chain":
      lines.push(line("storm", `${plural(spec.jumps, "target")}`));
      lines.push(line("storm", `Jumps up to ${num(spec.reach)} between enemies`));
      if (spec.falloff < 1) lines.push(line("storm", `${pct(1 - spec.falloff)} less damage per jump`));
      knock(spec.knock);
      break;
    case "melee":
      lines.push(line("blade", `Reach ${num(spec.reach)}`));
      lines.push(line("blade", spec.arc !== undefined && spec.arc < 0 ? "Wide swing" : "Forward swing"));
      knock(spec.knock);
      break;
    case "orbit":
      lines.push(line("orbit", `Orbit radius ${num(spec.radius)}`));
      lines.push(line("haste", `Rearms after ${seconds(spec.rearm)}`));
      break;
    case "strike":
      lines.push(line("rocket", `Blast radius ${num(spec.radius)}`));
      lines.push(line("haste", `Lands after ${seconds(spec.delay)}`));
      knock(spec.knock);
      break;
    case "bolts":
      if (spec.splash) lines.push(line("rocket", `Splash radius ${num(spec.splash)}`));
      knock(spec.knock);
      break;
    case "singularity":
      lines.push(line("magnet", `Pulls enemies within ${num(spec.pull.radius)} for ${seconds(spec.pull.duration)}`));
      lines.push(line("plating", `Crushes every ${seconds(spec.crush.every)} for ${num(spec.crush.damage)} damage`));
      lines.push(line("rocket", `Collapses for ${num(spec.collapse.damage)} damage in radius ${num(spec.collapse.radius)}`));
      lines.push(line("storm", `Bolts reach ${num(spec.bolts.reach)} for ${num(spec.bolts.damage)} damage`));
      break;
  }
  return lines;
}

const DRONE_BEHAVIOUR: Record<string, string> = {
  orbit: "Circles you and strikes enemies it touches",
  gun: "Follows you and shoots the nearest enemy",
  shock: "Chains lightning through nearby enemies",
  repair: "Restores your health over time",
  magnet: "Pulls in emeralds and widens pickup range",
};

function weaponLines(weapon: WeaponDefinition, rank: number): GuideLine[] {
  const level = weapon.unique ? 1 : rank,
    lines: GuideLine[] = [];
  for (const text of rankStatLines(weapon.id, level))
    if (text !== weapon.description) lines.push(line(statIcon(text), text));
  lines.push(line("railgun", `Range ${num(weapon.range)}`));
  lines.push(...patternLines(weapon.pattern(level)));
  const fromWave = Math.max(1, weapon.minWave ?? 1);
  lines.push(
    line(
      "coin",
      `From ${num(offerPrice(weapon.cost, fromWave, level))} emeralds at wave ${num(fromWave)}`,
    ),
  );
  if (weapon.unique)
    lines.push(line("lock", "Insane: one per run. No rank scaling, no merging."));
  if (fromWave > 1) lines.push(line("info", `Appears in the shop from wave ${num(fromWave)}`));
  if (weapon.weight === 0) lines.push(line("info", "Not in the normal shop pool"));
  return lines;
}

function itemLines(item: ItemDefinition, rank: number): GuideLine[] {
  const lines: GuideLine[] = [];
  for (const text of rankStatLines(item.id, rank))
    if (text !== item.description) lines.push(line(statIcon(text), text));
  if (item.drone) {
    const d = item.drone;
    lines.push(
      line(
        item.id,
        DRONE_BEHAVIOUR[d.attack] ?? `${capitalize(String(d.attack))} drone`,
      ),
    );
    if (d.range > 0) lines.push(line("railgun", `Range ${num(d.range)}`));
    if (d.cooldown > 0) lines.push(line("haste", `Acts every ${seconds(d.cooldown)}`));
    lines.push(
      line(
        "drone",
        `Each drone after your second acts ${pct(1 - DRONE_STACK_RATE)} slower than the one before it.`,
      ),
    );
  }
  lines.push(line("coin", `From ${num(offerPrice(item.cost, 1, rank))} emeralds at wave 1`));
  lines.push(
    line(
      "bag",
      item.category === "mod"
        ? "Works from the bag. Changes how your attacks behave."
        : "Active in your bag.",
    ),
  );
  return lines;
}

function mapLines(map: MapDefinition): GuideLine[] {
  const lines: GuideLine[] = mapStatLines(map).map((text) => line(statIcon(text), text));
  lines.push(line("info", `${map.rule.title}: ${map.rule.description}`));
  const schedule = mapThreatSchedule(map);
  if (schedule.length)
    lines.push(
      line(
        "shield",
        `New enemies: ${schedule.map((threat) => `${threat.name} wave ${num(threat.wave)}`).join(" · ")}`,
      ),
    );
  lines.push(
    line(
      "trophy",
      `${num(CAMPAIGN_WAVES)} waves. Clear wave ${num(CAMPAIGN_WAVES)} to finish the map and open Endless here.`,
    ),
  );
  lines.push(
    line(
      map.id === 1 ? "unlock" : "lock",
      map.id === 1 ? "Open from the start" : `Clear map ${num(map.id - 1)} first`,
    ),
  );
  return lines;
}

function heroLines(hero: HeroDefinition): GuideLine[] {
  const index = HERO_ORDER.indexOf(hero.id),
    previous = index > 0 ? HEROES[HERO_ORDER[index - 1]] : undefined,
    starting = WEAPONS[hero.weapon];
  return [
    line("info", `Role: ${hero.role}`),
    line("heart", `${num(hero.maxHp)} health`),
    line("speed", `Speed ${num(hero.speed)}`),
    line("dash", `Dash every ${seconds(hero.dashCooldown)}`),
    line("hand", plural(hero.weaponSlots, "hand")),
    line(hero.weapon, `Starts with ${starting?.name ?? capitalize(hero.weapon)}`),
    line("power", `${hero.signature}: ${hero.signatureDescription}`),
    line("close", `${hero.downside}: ${hero.downsideDescription}`),
    line("dash", `${hero.ability}: ${hero.abilityDescription}`),
    ...hero.setPiece.map((family) =>
      line(family, `Counts as 1 ${FAMILIES[family]?.name ?? family} piece`),
    ),
    line(
      previous ? "lock" : "unlock",
      previous
        ? `Complete map 1 with ${previous.name} to unlock`
        : "Unlocked from the start",
    ),
  ];
}

export function guideDetailLines(entry: GuideEntry, rank: number): GuideLine[] {
  const level = clampRank(rank);
  switch (entry.category) {
    case "weapon": {
      const weapon = WEAPONS[entry.id as WeaponId];
      return weapon ? weaponLines(weapon, level) : [];
    }
    case "passive":
    case "mod":
    case "drone": {
      const item = ITEMS[entry.id as ItemId];
      return item ? itemLines(item, level) : [];
    }
    case "map": {
      const map = mapOf(entry);
      return map ? mapLines(map) : [];
    }
    case "hero": {
      const hero = heroOf(entry);
      return hero ? heroLines(hero) : [];
    }
  }
  return [];
}

/* ---------------------------------------------------------------------------
 * Sets, enemies, bosses.
 * ------------------------------------------------------------------------- */
export interface SetGuideRow {
  family: FamilyDefinition;
  tiers: { size: SetTierSize; text: string }[];
  members: GuideEntry[];
  heroes: HeroId[];
}

export function setGuideRows(): SetGuideRow[] {
  const gear = [
    ...weaponList().map(weaponEntry),
    ...Object.values(ITEMS).map(itemEntry),
  ];
  return FAMILY_ORDER.map((id) => {
    const family = FAMILIES[id];
    return {
      family,
      tiers: SET_TIERS.map((size) => ({ size, text: family.thresholds[size] })),
      members: gear.filter((entry) => entry.families.includes(id)),
      heroes: HERO_ORDER.filter((hero) => HEROES[hero].setPiece.includes(id)),
    };
  });
}

export interface EnemyGuideRow {
  kind: EnemyKind;
  name: string;
  firstWave: number;
  hp: number;
  speed: number;
  damage: number;
  salvage: number;
  tip: string;
}

export function enemyGuideRows(): EnemyGuideRow[] {
  const row = (
    kind: EnemyKind,
    name: string,
    firstWave: number,
    tip: string,
  ): EnemyGuideRow => {
    const stats = ENEMY_STATS[kind];
    return {
      kind,
      name,
      firstWave,
      hp: stats?.hp ?? 0,
      speed: stats?.speed ?? 0,
      damage: stats?.damage ?? 0,
      salvage: stats?.salvage ?? 0,
      tip,
    };
  };
  const rows: EnemyGuideRow[] = [
    row("grunt", "Grunts", 1, "The basic enemy. Walks straight at you."),
    ...THREATS.map((threat) => row(threat.kind, threat.name, threat.wave, threat.description)),
  ];
  const covered = new Set(rows.map((entry) => entry.kind));
  for (const kind of Object.keys(ENEMY_STATS) as EnemyKind[])
    if (kind !== "boss" && !covered.has(kind)) {
      rows.push(row(kind, `${capitalize(kind)}s`, CAMPAIGN_WAVES, "A late arrival. Watch how it moves."));
      covered.add(kind);
    }
  if (ENEMY_STATS.boss)
    rows.push(
      row(
        "boss",
        "Bosses",
        BOSS_INTERVAL,
        `A boss closes every ${num(BOSS_INTERVAL)} waves and grows stronger each time. Adds keep spawning during the fight.`,
      ),
    );
  return rows;
}

export function bossGuideRows(): { wave: number; name: string }[] {
  const count = Math.floor(CAMPAIGN_WAVES / BOSS_INTERVAL);
  return Array.from({ length: count }, (_, index) => ({
    wave: (index + 1) * BOSS_INTERVAL,
    name: BOSS_NAMES.length ? BOSS_NAMES[index % BOSS_NAMES.length] : `Boss ${index + 1}`,
  }));
}

/* ---------------------------------------------------------------------------
 * How to play.
 * ------------------------------------------------------------------------- */
export interface HowToSection {
  id: string;
  title: string;
  icon: string;
  lines: string[];
}

const moveHint = () => HINTS.find((hint) => hint.trigger === "wave1") ?? HINTS[0];

function handsSummary(): string {
  const groups = new Map<number, HeroDefinition[]>();
  for (const id of HERO_ORDER) {
    const hero = HEROES[id];
    groups.set(hero.weaponSlots, [...(groups.get(hero.weaponSlots) ?? []), hero]);
  }
  const sorted = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  if (!sorted.length) return "Weapons occupy hands.";
  const [common, ...rest] = sorted;
  const others = rest.map(
    ([slots, heroes]) =>
      `${heroes.map((hero) => hero.name).join(" and ")} ${heroes.length === 1 ? "has" : "have"} ${num(slots)}`,
  );
  return `Weapons occupy hands. Most characters have ${num(common[0])}${others.length ? `; ${others.join("; ")}` : ""}.`;
}

export function howToSections(): HowToSection[] {
  const hint = moveHint(),
    durations = Array.from({ length: CAMPAIGN_WAVES }, (_, i) => waveDuration(i + 1)),
    shortest = Math.min(...durations),
    longest = Math.max(...durations),
    firstElite =
      Array.from({ length: CAMPAIGN_WAVES }, (_, i) => i + 1).find(
        (wave) => eliteChance(wave) > 0,
      ) ?? null,
    peakElite = Math.max(...Array.from({ length: CAMPAIGN_WAVES }, (_, i) => eliteChance(i + 1))),
    sample = weaponList()[0],
    mods = itemList("mod"),
    insane = weaponList().filter((weapon) => weapon.unique),
    freePieces = HERO_ORDER.map((id) => HEROES[id]).filter((hero) => hero.setPiece.length);
  return [
    {
      id: "controls",
      title: "Controls",
      icon: "dash",
      lines: [
        `Keyboard: ${hint?.keys ?? "WASD to move · SPACE to dash"}.`,
        `Touch: ${hint?.touch ?? "Drag to move · Tap Dash to dodge"}.`,
        "Weapons aim and fire on their own. You move, dash and shop.",
        "P or Escape pauses. The shop opens after every wave.",
      ],
    },
    {
      id: "waves",
      title: "Waves",
      icon: "trophy",
      lines: [
        `The campaign is ${num(CAMPAIGN_WAVES)} waves. A boss closes every ${num(BOSS_INTERVAL)} waves, so ${num(Math.floor(CAMPAIGN_WAVES / BOSS_INTERVAL))} bosses stand between you and the finish.`,
        `Waves last ${num(shortest)}–${num(longest)} seconds; boss waves run the full ${num(waveDuration(BOSS_INTERVAL))} seconds.`,
        `Each wave has a fixed enemy budget: ${num(waveBudget(1))} enemies on wave 1, ${num(waveBudget(CAMPAIGN_WAVES))} on wave ${num(CAMPAIGN_WAVES)}. The counter shows what is left; clear it to end the wave early. The timer still ends the wave.`,
        `Boss waves also spawn adds: about ${num(bossAddBudget(BOSS_INTERVAL))} on wave ${num(BOSS_INTERVAL)}, ${num(bossAddBudget(CAMPAIGN_WAVES))} on wave ${num(CAMPAIGN_WAVES)}.`,
        `Hordes ring you mid-wave: ${num(hordeCount(1))} on the first waves, up to ${num(hordeCount(CAMPAIGN_WAVES))} later, ${num(hordeSize(1))}–${num(hordeSize(CAMPAIGN_WAVES))} enemies each. Move before the rings close.`,
        firstElite
          ? `Elites appear from wave ${num(firstElite)}, up to ${pct(peakElite)} of spawns. They have ${num(ELITE.hp)}× health, ${num(ELITE.speed)}× speed and drop ${num(ELITE.salvage)}× emeralds.`
          : "Elites do not spawn on the base curve.",
        `Dodge boost: dodge ${num(WEAVE.dodges)} shots closely for +${pct(WEAVE.bonus)} damage for ${seconds(WEAVE.duration)}.`,
        `Clearing a wave pays ${num(WAVE_CLEAR_BONUS(1))} emeralds on wave 1 (+${num(WAVE_CLEAR_BONUS(2) - WAVE_CLEAR_BONUS(1))} per wave) and heals ${pct(WAVE_END_HEAL)} of max health.`,
      ],
    },
    {
      id: "shop",
      title: "Shop",
      icon: "coin",
      lines: [
        `The shop shows ${num(SHOP_OFFERS)} offers after every wave. Prices rise with the wave and the rank${sample ? `: a ${rankName(1)} ${sample.name} costs ${num(offerPrice(sample.cost, 1, 1))} emeralds on wave 1 and ${num(offerPrice(sample.cost, CAMPAIGN_WAVES, 1))} on wave ${num(CAMPAIGN_WAVES)}` : ""}.`,
        `Reroll costs ${num(rerollCost(1, 0))} emeralds on wave 1. Each reroll that wave adds ${num(rerollCost(1, 1) - rerollCost(1, 0))}, and every wave adds ${num(rerollCost(2, 0) - rerollCost(1, 0))}.`,
        "Lock an offer to keep it through rerolls. Locked offers stay until you buy or unlock them.",
        `Repair heals ${pct(REPAIR_HEAL)} of max health. It costs ${num(repairCost(1))} emeralds on wave 1 and ${num(repairCost(CAMPAIGN_WAVES))} on wave ${num(CAMPAIGN_WAVES)}.`,
        `Selling returns ${pct(SELL_RATE)} of the price.`,
        `The bag holds ${num(BAG_CAPACITY)} items, drones and mods. Buy up to ${num(MAX_EXTRA_SLOTS)} extra slots per run at ${num(BAG_SLOT_COST)} emeralds each.`,
        `${handsSummary()} Weapons in the bag are inactive and do not count toward sets.`,
        `Drones stack with diminishing returns: each drone after your second acts ${pct(1 - DRONE_STACK_RATE)} slower than the one before it.`,
      ],
    },
    {
      id: "ranks",
      title: "Ranks & merging",
      icon: "merge",
      lines: [
        `Ranks: ${RANKS.map((rank) => rank.name).join(" → ")}.`,
        `Each rank multiplies a piece's stats: ${RANKS.map((rank) => `${rank.name} ×${num(rankScale(rank.level))}`).join(", ")}.`,
        "Merge two matching pieces at the same rank to make one of the next rank. It frees a slot.",
        "Merging removes a piece, so a set can lose a piece and its bonus can switch off.",
        insane.length
          ? `Insane weapons (${insane.map((weapon) => weapon.name).join(", ")}) are one per run, do not scale with rank and cannot merge.`
          : "Insane weapons are one per run, do not scale with rank and cannot merge.",
      ],
    },
    {
      id: "sets",
      title: "Sets",
      icon: "kinetic",
      lines: [
        `Set bonuses switch on at ${SET_TIERS.map(num).join(", ")} pieces of one family.`,
        "Equipped weapons, items, drones and mods each count once for every family they belong to. Weapons in the bag do not count.",
        freePieces.length
          ? `Some characters bring a free piece: ${freePieces.map((hero) => `${hero.name} counts as ${hero.setPiece.map((family) => FAMILIES[family]?.name ?? family).join(" and ")}`).join("; ")}.`
          : "No character brings a free set piece.",
        `Families: ${FAMILY_ORDER.map((id) => FAMILIES[id].name).join(", ")}.`,
      ],
    },
    {
      id: "mods",
      title: "Mods",
      icon: "settings",
      lines: [
        "Mods change how all your attacks behave. They work from the bag and rank up like items.",
        ...(mods.length
          ? mods.map((mod) => `${mod.name}: ${mod.description}`)
          : ["No mods are in the pool yet."]),
      ],
    },
    {
      id: "maps",
      title: "Maps & unlocks",
      icon: "trophy",
      lines: [
        `${num(MAP_COUNT)} maps. Every map is the full ${num(CAMPAIGN_WAVES)}-wave campaign with its own multipliers and one rule. Map modifiers reach full strength by wave ${num(MAP_RAMP.fullWave)}.`,
        "Clearing a map unlocks the next map for that character.",
        "Clearing map 1 with a character unlocks the next character.",
        "Endless opens per character and map once that map is cleared. It has no finish line; your best wave counts.",
        ...mapList().map((map) => `${num(map.id)}. ${map.name} — ${map.rule.title}: ${map.rule.description}`),
      ],
    },
    {
      id: "tips",
      title: "Tips",
      icon: "info",
      lines: HINTS.map((hint) => hint.text),
    },
  ];
}

/* ---------------------------------------------------------------------------
 * Rendering. Only the content region: the tab strip, family filter and rank
 * selector belong to ui.ts.
 * ------------------------------------------------------------------------- */
const rank = (level: number) => RANKS[clampRank(level) - 1];

function emptyMessage(tab: GuideTab, family: FamilyId | "all"): string {
  if (tab === "mods" && !itemList("mod").length)
    return "No mods yet. They arrive with a later update.";
  if (family !== "all") return "No gear in this set.";
  return "Nothing here yet.";
}

function art(view: GuideView, entry: GuideEntry, fallback: string): string {
  const image = view.art?.[entry.id];
  return image
    ? `<img src="${view.escape(image)}" alt="" draggable="false"/>`
    : view.icon(fallback);
}

function cardMeta(entry: GuideEntry, view: GuideView): string {
  if (entry.category === "map") {
    const map = mapOf(entry);
    return map ? `<small>${view.escape(map.rule.title)}</small>` : "";
  }
  if (entry.category === "hero") {
    const hero = heroOf(entry);
    return hero ? `<small>${view.escape(hero.role)}</small>` : "";
  }
  if (entry.insane) return `<span class="rz-insane-badge">Insane</span>`;
  if (entry.minWave) return `<small>Wave ${num(entry.minWave)}+</small>`;
  return "";
}

function detailFootnote(entry: GuideEntry, view: GuideView): string {
  switch (entry.category) {
    case "weapon":
      return entry.insane
        ? "One per run. Stats do not change with rank."
        : "Base stats at this rank. Equip to attack.";
    case "drone":
    case "passive":
      return "Active in your bag.";
    case "mod":
      return "Works from the bag.";
    case "map": {
      const map = mapOf(entry);
      const heroes = map ? (view.clearedBy?.[map.id] ?? []) : [];
      return heroes.length
        ? `Cleared by ${heroes.map((id) => view.escape(HEROES[id]?.name ?? id)).join(", ")}.`
        : "Not cleared yet.";
    }
    case "hero": {
      const record = view.heroRecords?.[entry.id as HeroId] ?? 0;
      return record > 0 ? `Best wave ${pad2(record)}.` : "No runs yet.";
    }
  }
  return "";
}

function relatedMods(entry: GuideEntry, view: GuideView): string {
  const mods = itemList("mod");
  if (!mods.length) return "";
  const chips = (items: { id: string; name: string }[]) =>
    items
      .map((item) => `<span>${view.icon(item.id)}${view.escape(item.name)}</span>`)
      .join("");
  if (entry.category === "weapon") {
    const weapon = WEAPONS[entry.id as WeaponId];
    if (!weapon || weapon.pattern(1).kind !== "bullet") return "";
    return `<div class="rz-catalog-mods"><span class="rz-eyebrow">WORKS WITH MODS</span>${chips(mods)}</div>`;
  }
  if (entry.category === "mod") {
    const weapons = weaponList().filter((weapon) => weapon.pattern(1).kind === "bullet");
    if (!weapons.length) return "";
    return `<div class="rz-catalog-mods"><span class="rz-eyebrow">AFFECTS</span>${chips(weapons)}</div>`;
  }
  return "";
}

function renderCatalog(
  tab: GuideTabDefinition,
  state: GuideState,
  view: GuideView,
): string {
  const entries = guideEntries(tab.id, tab.usesFamily ? state.family : "all"),
    selected = entries.find((entry) => entry.id === state.selected) ?? entries[0],
    level = rank(state.rank),
    rankStyle = tab.usesRank ? ` rz-rank-${level.level}` : "",
    cards = entries
      .map((entry) => {
        const classes = [
          "rz-catalog-card",
          rankStyle.trim(),
          entry.id === selected?.id ? "is-selected" : "",
          entry.insane ? "is-insane" : "",
          entry.category === "map" ? "is-map" : "",
          entry.category === "hero" ? "is-hero" : "",
        ]
          .filter(Boolean)
          .join(" ");
        const style = [
          tab.usesRank ? `--rank:${level.color}` : "",
          entry.accent ? `--card-accent:${view.escape(entry.accent)}` : "",
        ]
          .filter(Boolean)
          .join(";");
        return `<button type="button" class="${classes}"${style ? ` style="${style}"` : ""} data-action="catalogItem" data-value="${view.escape(entry.id)}" data-focus-key="catalog:${view.escape(entry.id)}" aria-pressed="${entry.id === selected?.id}" aria-label="${view.escape(entry.name)}${entry.insane ? ", insane" : ""}">${art(view, entry, entry.icon)}<strong>${view.escape(entry.name)}</strong>${cardMeta(entry, view)}</button>`;
      })
      .join("");
  const count = `<div class="rz-catalog-count">${num(entries.length)} ${view.escape(tab.label.toLowerCase())}</div>`;
  const grid = `<div class="rz-catalog-grid" data-scroll-key="catalog-grid">${cards || `<p class="rz-catalog-empty">${view.escape(emptyMessage(tab.id, state.family))}</p>`}</div>`;
  if (!selected) return `${count}${grid}`;
  const lines = guideDetailLines(selected, level.level)
    .map(
      (entry) =>
        `<div>${view.icon(entry.icon)}<span>${view.escape(entry.text)}</span></div>`,
    )
    .join("");
  const detailStyle = [
    tab.usesRank ? `--rank:${level.color}` : "",
    selected.accent ? `--card-accent:${view.escape(selected.accent)}` : "",
  ]
    .filter(Boolean)
    .join(";");
  const detail = `<section class="rz-catalog-detail${rankStyle}${selected.insane ? " is-insane" : ""}${selected.category === "map" ? " is-map" : ""}${selected.category === "hero" ? " is-hero" : ""}" data-scroll-key="catalog-detail"${detailStyle ? ` style="${detailStyle}"` : ""}><div class="rz-catalog-art">${art(view, selected, selected.icon)}</div>${tab.usesRank && !selected.insane ? view.rankBadge(level.level) : ""}${selected.insane ? `<span class="rz-insane-badge">Insane</span>` : ""}<h1>${view.escape(selected.name)}</h1><p>${view.escape(selected.description)}</p><div class="rz-catalog-stats">${lines}</div>${selected.families.length ? `<div class="rz-family-tags">${selected.families.map((id) => view.familyChip(id)).join("")}</div>` : ""}${relatedMods(selected, view)}<small>${detailFootnote(selected, view)}</small></section>`;
  return `${count}${grid}${detail}`;
}

function renderSets(state: GuideState, view: GuideView): string {
  const rows = setGuideRows().filter(
    (row) => state.family === "all" || row.family.id === state.family,
  );
  const body = rows
    .map((row) => {
      const tiers = row.tiers
        .map(
          (tier) =>
            `<div class="rz-set-tier"><strong>${num(tier.size)}</strong><p>${view.escape(tier.text)}</p></div>`,
        )
        .join("");
      const members = [
        ...row.heroes.map(
          (id) =>
            `<span class="is-hero">${view.icon(HEROES[id].weapon)}${view.escape(HEROES[id].name)}<small>character</small></span>`,
        ),
        ...row.members.map(
          (member) =>
            `<span class="is-${view.escape(member.category)}">${art(view, member, member.icon)}${view.escape(member.name)}</span>`,
        ),
      ].join("");
      return `<article class="rz-set-row" style="--family:${view.escape(row.family.color)}"><header>${view.icon(row.family.id)}<h2>${view.escape(row.family.name)}</h2><small>${num(row.members.length + row.heroes.length)} pieces</small></header><div class="rz-set-tiers">${tiers}</div><div class="rz-set-members">${members || "<span>No pieces yet.</span>"}</div></article>`;
    })
    .join("");
  return `<div class="rz-guide-panel" data-scroll-key="guide-panel"><p class="rz-guide-intro">Set bonuses switch on at ${SET_TIERS.map(num).join(", ")} pieces. Equipped weapons, bag items, drones and mods each count once per family. Weapons in the bag do not count.</p>${body || `<p class="rz-catalog-empty">No set matches this filter.</p>`}</div>`;
}

function renderEnemies(view: GuideView): string {
  const rows = enemyGuideRows()
    .map(
      (row) =>
        `<tr class="is-${view.escape(row.kind)}"><th scope="row">${view.escape(row.name)}</th><td>${num(row.firstWave)}</td><td>${num(row.hp)}</td><td>${num(row.speed)}</td><td>${num(row.damage)}</td><td>${num(row.salvage)}</td><td>${view.escape(row.tip)}</td></tr>`,
    )
    .join("");
  const bosses = bossGuideRows()
    .map(
      (row) =>
        `<tr><th scope="row">Wave ${pad2(row.wave)}</th><td>${view.escape(row.name)}</td></tr>`,
    )
    .join("");
  return `<div class="rz-guide-panel" data-scroll-key="guide-panel"><p class="rz-guide-intro">Base stats on map 1, wave 1. Enemies gain health, speed and damage every wave; maps multiply on top. Elites have ${num(ELITE.hp)}× health and drop ${num(ELITE.salvage)}× emeralds.</p><div class="rz-guide-table-wrap"><table class="rz-guide-table"><thead><tr><th scope="col">Enemy</th><th scope="col">From wave</th><th scope="col">Health</th><th scope="col">Speed</th><th scope="col">Damage</th><th scope="col">Emeralds</th><th scope="col">Tip</th></tr></thead><tbody>${rows}</tbody></table></div><h2>${view.icon("shield")}Bosses</h2><p class="rz-guide-intro">A boss arrives every ${num(BOSS_INTERVAL)} waves. Each one is stronger than the last.</p><div class="rz-guide-table-wrap"><table class="rz-guide-table rz-guide-bosses"><thead><tr><th scope="col">Wave</th><th scope="col">Boss</th></tr></thead><tbody>${bosses}</tbody></table></div></div>`;
}

function renderHowTo(view: GuideView): string {
  const sections = howToSections()
    .map(
      (section) =>
        `<section class="rz-howto-section" id="rz-howto-${view.escape(section.id)}"><h2>${view.icon(section.icon)}${view.escape(section.title)}</h2><ul>${section.lines.map((text) => `<li>${view.escape(text)}</li>`).join("")}</ul></section>`,
    )
    .join("");
  return `<div class="rz-guide-panel" data-scroll-key="guide-panel"><div class="rz-howto-grid">${sections}</div></div>`;
}

export function renderGuideTab(
  tab: GuideTab,
  state: GuideState,
  view: GuideView,
): string {
  const definition = GUIDE_TABS.find((entry) => entry.id === tab) ?? GUIDE_TABS[0];
  switch (definition.id) {
    case "sets":
      return renderSets(state, view);
    case "enemies":
      return renderEnemies(view);
    case "howto":
      return renderHowTo(view);
    default:
      return renderCatalog(definition, state, view);
  }
}

/* ---------------------------------------------------------------------------
 * Helpers for the shop and the roster.
 * ------------------------------------------------------------------------- */
/** Families that reach a new tier when a piece with these families is added. */
export function completesSetTier(
  families: FamilyId[],
  counts: Partial<Record<FamilyId, number>>,
  willBeActive: boolean,
): { family: FamilyId; size: SetTierSize }[] {
  if (!willBeActive) return [];
  const reached: { family: FamilyId; size: SetTierSize }[] = [];
  for (const family of new Set(families)) {
    const next = (counts[family] ?? 0) + 1;
    const size = SET_TIERS.find((tier) => tier === next);
    if (size) reached.push({ family, size });
  }
  return reached;
}

export interface DeployHelpArgs {
  heroName: string;
  previousHeroName: string;
  heroUnlocked: boolean;
  /** 1-based map number, as in MapId. */
  mapIndex: number;
  mapUnlocked: boolean;
  cleared: boolean;
  bestWave: number;
  endless: boolean;
}

export function deployHelp(args: DeployHelpArgs): string {
  if (!args.heroUnlocked)
    return `Complete map 1 with ${args.previousHeroName} to unlock ${args.heroName}`;
  if (!args.mapUnlocked)
    return `Clear map ${num(Math.max(1, args.mapIndex - 1))} with ${args.heroName} first`;
  if (args.endless)
    return args.bestWave > 0
      ? `Endless has no finish line. Best wave ${pad2(args.bestWave)} on this map.`
      : "Endless has no finish line. Best wave counts.";
  const hint = moveHint();
  return hint?.keys ?? "WASD to move · SPACE to dash · Weapons fire on their own";
}
