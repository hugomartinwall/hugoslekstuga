export type HeroId =
  | "ember"
  | "volt"
  | "bastion"
  | "cinder"
  | "frost"
  | "thorn"
  | "wisp"
  | "flux"
  | "reaper"
  | "prism";
export const HERO_ORDER: HeroId[] = [
  "ember",
  "volt",
  "bastion",
  "cinder",
  "frost",
  "thorn",
  "wisp",
  "flux",
  "reaper",
  "prism",
];
export const CAMPAIGN_WAVES = 30;
/** A boss closes every chapter; the campaign length is a multiple of this. */
export const BOSS_INTERVAL = 3;
export type FamilyId =
  "kinetic" | "thermal" | "storm" | "frost" | "toxic" | "drone";
export type WeaponId =
  | "pistol"
  | "shotgun"
  | "arc"
  | "blade"
  | "rocket"
  | "flame"
  | "frostgun"
  | "needle"
  | "railgun"
  | "boomerang"
  | "beam";
export type ItemId =
  | "power"
  | "haste"
  | "vitality"
  | "plating"
  | "stride"
  | "magnet"
  | "mending"
  | "focus"
  | "kinetic_core"
  | "thermal_core"
  | "storm_core"
  | "frost_core"
  | "toxic_core"
  | "drone_core"
  | "orbit_drone"
  | "gun_drone"
  | "shock_drone"
  | "repair_drone"
  | "magnet_drone";
export type EnemyKind =
  | "grunt"
  | "runner"
  | "brute"
  | "shooter"
  | "charger"
  | "splitter"
  | "shielder"
  | "bomber"
  | "medic"
  | "sniper"
  | "boss";
export interface HeroDefinition {
  id: HeroId;
  name: string;
  role: string;
  tagline: string;
  description: string;
  color: string;
  weapon: WeaponId;
  weaponSlots: number;
  maxHp: number;
  speed: number;
  dashCooldown: number;
  ability: string;
  abilityDescription: string;
  passive: string;
  passiveDescription: string;
}
export const HEROES: Record<HeroId, HeroDefinition> = {
  ember: {
    id: "ember",
    name: "Rook",
    role: "Gunner",
    tagline: "Keep it moving.",
    description: "Fast shots. Easy to learn.",
    color: "#ffb653",
    weapon: "pistol",
    weaponSlots: 2,
    maxHp: 110,
    speed: 6.4,
    dashCooldown: 3.8,
    ability: "Crossfire",
    abilityDescription: "Dash fires 7 shots.",
    passive: "Steady hands",
    passiveDescription: "+10% damage.",
  },
  volt: {
    id: "volt",
    name: "Volt",
    role: "Lightning",
    tagline: "Connect the dots.",
    description: "Lightning jumps between enemies.",
    color: "#75e2ed",
    weapon: "arc",
    weaponSlots: 2,
    maxHp: 105,
    speed: 6.2,
    dashCooldown: 4.1,
    ability: "Short circuit",
    abilityDescription: "Dash shocks nearby enemies.",
    passive: "Live wire",
    passiveDescription: "15% chance to hit another enemy with lightning.",
  },
  bastion: {
    id: "bastion",
    name: "Bastion",
    role: "Tank",
    tagline: "Make room.",
    description: "More health. Dash through crowds.",
    color: "#b7ec82",
    weapon: "shotgun",
    weaponSlots: 2,
    maxHp: 150,
    speed: 5.8,
    dashCooldown: 4.4,
    ability: "Bulldoze",
    abilityDescription: "Dash damages enemies you run through.",
    passive: "Heavy frame",
    passiveDescription: "+8 armor. +40% knockback.",
  },
  cinder: {
    id: "cinder",
    name: "Cinder",
    role: "Fire",
    tagline: "Leave a mark.",
    description: "Burn enemies up close.",
    color: "#ff6a45",
    weapon: "flame",
    weaponSlots: 2,
    maxHp: 115,
    speed: 6.1,
    dashCooldown: 4,
    ability: "Flashover",
    abilityDescription: "Dash burns nearby enemies.",
    passive: "Kindling",
    passiveDescription: "Hits burn for 5 damage/sec.",
  },
  frost: {
    id: "frost",
    name: "Frost",
    role: "Ice",
    tagline: "Take your time.",
    description: "Slow enemies and keep your distance.",
    color: "#9bdeff",
    weapon: "frostgun",
    weaponSlots: 2,
    maxHp: 105,
    speed: 6.25,
    dashCooldown: 4.1,
    ability: "Cold snap",
    abilityDescription: "Dash slows nearby enemies by 60%.",
    passive: "Permafrost",
    passiveDescription: "Hits slow enemies by 20%.",
  },
  thorn: {
    id: "thorn",
    name: "Thorn",
    role: "Poison",
    tagline: "Let it sink in.",
    description: "Poison keeps hurting enemies after each hit.",
    color: "#b9db55",
    weapon: "needle",
    weaponSlots: 2,
    maxHp: 105,
    speed: 6.35,
    dashCooldown: 3.9,
    ability: "Spore burst",
    abilityDescription: "Dash fires 12 poison needles around you.",
    passive: "Venom",
    passiveDescription: "Hits add poison: 4 damage/sec. Stacks up to 3 times.",
  },
  wisp: {
    id: "wisp",
    name: "Wisp",
    role: "Drones",
    tagline: "Never alone.",
    description: "One weapon. Stronger drones.",
    color: "#c9b4ff",
    weapon: "pistol",
    weaponSlots: 1,
    maxHp: 100,
    speed: 6.6,
    dashCooldown: 4.4,
    ability: "Swarm",
    abilityDescription: "Dash: drones attack and heal 3× faster for 4s.",
    passive: "Wingmates",
    passiveDescription: "Starts with a Gunner drone. +40% drone damage.",
  },
  flux: {
    id: "flux",
    name: "Flux",
    role: "Collector",
    tagline: "Nothing goes to waste.",
    description: "Returning blades. Extra emeralds.",
    color: "#ffd879",
    weapon: "boomerang",
    weaponSlots: 2,
    maxHp: 110,
    speed: 6.35,
    dashCooldown: 3.9,
    ability: "Vacuum",
    abilityDescription: "Dash pulls in nearby enemies and pickups.",
    passive: "Prospector",
    passiveDescription: "+25% emeralds. +50% pickup range.",
  },
  reaper: {
    id: "reaper",
    name: "Reaper",
    role: "Swordfighter",
    tagline: "Stay close.",
    description: "Fight up close. Heal as you attack.",
    color: "#ec8ba5",
    weapon: "blade",
    weaponSlots: 2,
    maxHp: 120,
    speed: 6.5,
    dashCooldown: 3.2,
    ability: "Harvest",
    abilityDescription: "Dash hits nearby enemies and heals you.",
    passive: "Blood circuit",
    passiveDescription: "Sword kills restore 2 health.",
  },
  prism: {
    id: "prism",
    name: "Prism",
    role: "Four weapons",
    tagline: "Try everything.",
    description: "Carry four weapons. Mix them for more damage.",
    color: "#eab5f7",
    weapon: "beam",
    weaponSlots: 4,
    maxHp: 110,
    speed: 6.3,
    dashCooldown: 4.1,
    ability: "Refraction",
    abilityDescription: "Dash fires 3 beams through enemies.",
    passive: "Spectrum",
    passiveDescription: "+3% damage per equipped weapon type.",
  },
};
export interface WeaponDefinition {
  id: WeaponId;
  name: string;
  description: string;
  color: string;
  cost: number;
  damage: number;
  cooldown: number;
  range: number;
  families: FamilyId[];
  stats: string[];
}
export const WEAPONS: Record<WeaponId, WeaponDefinition> = {
  pistol: {
    id: "pistol",
    name: "Sidearm",
    description: "Pistol. Fires two shots at once.",
    color: "#ffb56d",
    cost: 14,
    damage: 14,
    cooldown: 0.36,
    range: 13,
    families: ["kinetic"],
    stats: ["14 × 2 damage", "0.36s per attack"],
  },
  shotgun: {
    id: "shotgun",
    name: "Scattergun",
    description: "Shotgun. Pellets in a wide spread.",
    color: "#bfdc8a",
    cost: 17,
    damage: 13,
    cooldown: 0.84,
    range: 9,
    families: ["kinetic"],
    stats: ["13 × 5 damage", "Wide spread"],
  },
  arc: {
    id: "arc",
    name: "Arc coil",
    description: "Lightning that jumps between enemies.",
    color: "#7ae8ff",
    cost: 18,
    damage: 25,
    cooldown: 0.82,
    range: 11,
    families: ["storm"],
    stats: ["25 damage", "4 targets"],
  },
  blade: {
    id: "blade",
    name: "Scrapblade",
    description: "Sword. Wide swings push enemies back.",
    color: "#ffba65",
    cost: 15,
    damage: 44,
    cooldown: 0.65,
    range: 3.8,
    families: ["kinetic", "toxic"],
    stats: ["44 damage", "Close range"],
  },
  rocket: {
    id: "rocket",
    name: "Firework",
    description: "Rocket launcher. Explodes on impact.",
    color: "#f6a1db",
    cost: 22,
    damage: 64,
    cooldown: 1.15,
    range: 15,
    families: ["thermal"],
    stats: ["64 damage", "Blast radius 2.85"],
  },
  flame: {
    id: "flame",
    name: "Torch",
    description: "Flamethrower. Burns nearby enemies.",
    color: "#ff794d",
    cost: 17,
    damage: 10,
    cooldown: 0.19,
    range: 6.5,
    families: ["thermal"],
    stats: ["10 damage", "6 burn damage/sec"],
  },
  frostgun: {
    id: "frostgun",
    name: "Coldfront",
    description: "Ice gun. Three shards slow enemies.",
    color: "#a4dfff",
    cost: 17,
    damage: 16,
    cooldown: 0.5,
    range: 12,
    families: ["frost"],
    stats: ["16 × 3 damage", "30% slow"],
  },
  needle: {
    id: "needle",
    name: "Stinger",
    description: "Needle gun. Pierces and poisons.",
    color: "#b4d863",
    cost: 16,
    damage: 12,
    cooldown: 0.22,
    range: 13,
    families: ["toxic"],
    stats: ["12 damage", "4 poison damage/sec"],
  },
  railgun: {
    id: "railgun",
    name: "Longshot",
    description: "Rifle. Fires through enemies in a line.",
    color: "#aaceea",
    cost: 23,
    damage: 92,
    cooldown: 1.35,
    range: 19,
    families: ["kinetic", "storm"],
    stats: ["92 damage", "Hits enemies in a line"],
  },
  boomerang: {
    id: "boomerang",
    name: "Returner",
    description: "Boomerang. Hits on the way out and back.",
    color: "#f0d17f",
    cost: 18,
    damage: 28,
    cooldown: 0.85,
    range: 13,
    families: ["kinetic", "drone"],
    stats: ["28 damage", "Hits on return"],
  },
  beam: {
    id: "beam",
    name: "Splitter",
    description: "Laser. Fires through enemies in a line.",
    color: "#d6b8fb",
    cost: 22,
    damage: 25,
    cooldown: 0.32,
    range: 12,
    families: ["thermal", "storm"],
    stats: ["25 damage", "Hits enemies in a line"],
  },
};
export type DroneId =
  "orbit_drone" | "gun_drone" | "shock_drone" | "repair_drone" | "magnet_drone";
export type PassiveStat =
  | "damage"
  | "attackSpeed"
  | "maxHp"
  | "armor"
  | "speed"
  | "magnet"
  | "healing"
  | "dashRecovery"
  | "salvage"
  | "burnDamage"
  | "poisonDamage";
export interface ItemDefinition {
  id: ItemId;
  name: string;
  description: string;
  cost: number;
  color: string;
  category: "passive" | "drone";
  families: FamilyId[];
  family?: FamilyId;
  stats: string[];
  passiveStats: Partial<Record<PassiveStat, number>>;
  drone?: {
    attack: "orbit" | "gun" | "shock" | "repair" | "magnet";
    damage: number;
    cooldown: number;
    range: number;
  };
}
const item = (
  id: ItemId,
  name: string,
  description: string,
  cost: number,
  color: string,
  passiveStats: ItemDefinition["passiveStats"],
  families: FamilyId[] = [],
): ItemDefinition => ({
  id,
  name,
  description,
  cost,
  color,
  category: "passive",
  families,
  family: families[0],
  stats: [description],
  passiveStats,
});
export const ITEMS: Record<ItemId, ItemDefinition> = {
  power: item(
    "power",
    "Hot core",
    "+14% damage",
    12,
    "#ff9468",
    { damage: 0.14 },
    ["thermal"],
  ),
  haste: item(
    "haste",
    "Quickdraw",
    "+10% attack speed",
    13,
    "#efd378",
    { attackSpeed: 0.1 },
    ["kinetic"],
  ),
  vitality: item(
    "vitality",
    "Second heart",
    "+22 max health",
    13,
    "#ef8c9d",
    { maxHp: 22 },
    ["toxic"],
  ),
  plating: item(
    "plating",
    "Ceramic plate",
    "+7 armor",
    12,
    "#a9c895",
    { armor: 7 },
    ["kinetic"],
  ),
  stride: item(
    "stride",
    "Servo boost",
    "+7% movement speed",
    11,
    "#a8e4d5",
    { speed: 0.07 },
    ["frost"],
  ),
  magnet: item(
    "magnet",
    "Lucky pull",
    "+35% pickup range. +8% emeralds.",
    10,
    "#dbcc84",
    { magnet: 0.35, salvage: 0.08 },
    ["drone"],
  ),
  mending: item(
    "mending",
    "Repair cell",
    "Heal 1 health every 3 seconds.",
    14,
    "#9bdf9e",
    { healing: 1 / 3 },
    ["toxic"],
  ),
  focus: item(
    "focus",
    "Second wind",
    "Dash recharges 14% faster.",
    12,
    "#b7c4fa",
    { dashRecovery: 0.14 },
    ["storm"],
  ),
  kinetic_core: item(
    "kinetic_core",
    "Physical module",
    "+6% damage. +3 armor.",
    15,
    "#edc280",
    { damage: 0.06, armor: 3 },
    ["kinetic"],
  ),
  thermal_core: item(
    "thermal_core",
    "Fire module",
    "+6% damage. Your hits burn for 3 / second.",
    15,
    "#ff8658",
    { damage: 0.06, burnDamage: 3 },
    ["thermal"],
  ),
  storm_core: item(
    "storm_core",
    "Lightning module",
    "+5% attack speed. Dash recharges 6% faster.",
    15,
    "#8ce5f2",
    { attackSpeed: 0.05, dashRecovery: 0.06 },
    ["storm"],
  ),
  frost_core: item(
    "frost_core",
    "Ice module",
    "+8 max health. +3% movement speed.",
    15,
    "#a6dfff",
    { maxHp: 8, speed: 0.03 },
    ["frost"],
  ),
  toxic_core: item(
    "toxic_core",
    "Poison module",
    "Heal 0.5 health every 3 seconds. Your hits poison for 2 / second.",
    15,
    "#badb72",
    { healing: 1 / 6, poisonDamage: 2 },
    ["toxic"],
  ),
  drone_core: item(
    "drone_core",
    "Drone module",
    "+5% attack speed. +10% pickup range.",
    15,
    "#d1b5ff",
    { attackSpeed: 0.05, magnet: 0.1 },
    ["drone"],
  ),
  orbit_drone: {
    ...item(
      "orbit_drone",
      "Orbit drone",
      "Circles you and hits nearby enemies.",
      20,
      "#ccb8ff",
      {},
      ["drone"],
    ),
    category: "drone",
    drone: { attack: "orbit", damage: 28, cooldown: 0.45, range: 1.8 },
  },
  gun_drone: {
    ...item(
      "gun_drone",
      "Gunner drone",
      "Follows you and shoots enemies.",
      20,
      "#f2bc7e",
      {},
      ["drone", "kinetic"],
    ),
    category: "drone",
    drone: { attack: "gun", damage: 23, cooldown: 0.55, range: 14 },
  },
  shock_drone: {
    ...item(
      "shock_drone",
      "Arc drone",
      "Lightning hits up to 3 enemies.",
      23,
      "#91e1e9",
      {},
      ["drone", "storm"],
    ),
    category: "drone",
    drone: { attack: "shock", damage: 22, cooldown: 0.9, range: 10 },
  },
  repair_drone: {
    ...item(
      "repair_drone",
      "Medic drone",
      "Restores health every 4 seconds.",
      22,
      "#b1e7a7",
      {},
      ["drone", "toxic"],
    ),
    category: "drone",
    drone: { attack: "repair", damage: 2, cooldown: 4, range: 0 },
  },
  magnet_drone: {
    ...item(
      "magnet_drone",
      "Collector drone",
      "+30% pickup range. +10% emeralds. Pulls in nearby emeralds.",
      18,
      "#f0d78e",
      { magnet: 0.3, salvage: 0.1 },
      ["drone"],
    ),
    category: "drone",
    drone: { attack: "magnet", damage: 0, cooldown: 1, range: 0 },
  },
};
export const RANKS = [
  { level: 1, name: "Scrap", color: "#a9b0b5" },
  { level: 2, name: "Forged", color: "#8ed49c" },
  { level: 3, name: "Rare", color: "#76baff" },
  { level: 4, name: "Epic", color: "#c6a1ff" },
  { level: 5, name: "Mythic", color: "#f47c7c" },
  { level: 6, name: "Legendary", color: "#ffe293" },
] as const;
export const rankScale = (level: number): number =>
  [1, 1.5, 2.25, 3.4, 5.1, 7.7][
    Math.max(0, Math.min(5, Math.floor(level) - 1))
  ];
export function rankStatLines(
  kind: WeaponId | ItemId,
  level: number,
): string[] {
  const scale = rankScale(level);
  if (kind in WEAPONS) {
    const weapon = WEAPONS[kind as WeaponId];
    const pellets =
      kind === "pistol"
        ? 2
        : kind === "shotgun"
          ? level >= 3
            ? 7
            : 5
          : kind === "frostgun"
            ? 3
            : 1;
    return [
      `${Math.round(weapon.damage * scale)}${pellets > 1 ? ` × ${pellets}` : ""} damage`,
      `${weapon.cooldown}s per attack`,
      kind === "shotgun" && level >= 3
        ? "Shotgun. Seven pellets in a wide spread."
        : weapon.description,
    ];
  }
  const item = ITEMS[kind as ItemId],
    lines: string[] = [];
  const labels: Record<PassiveStat, string> = {
    damage: "damage",
    attackSpeed: "attack speed",
    maxHp: "max health",
    armor: "armor",
    speed: "movement speed",
    magnet: "pickup range",
    healing: "health / second",
    dashRecovery: "dash recharge",
    salvage: "emeralds",
    burnDamage: "burn / second",
    poisonDamage: "poison / second",
  };
  for (const [key, value] of Object.entries(item.passiveStats) as [
    PassiveStat,
    number,
  ][]) {
    const amount = value * scale;
    lines.push(
      key === "healing"
        ? `+${Math.round(amount * 3 * 10) / 10} health / 3s`
        : ["maxHp", "armor", "burnDamage", "poisonDamage"].includes(key)
          ? `+${Math.round(amount * 10) / 10} ${labels[key]}`
          : `+${Math.round(amount * 100)}% ${labels[key]}`,
    );
  }
  if (item.drone) {
    const d = item.drone;
    if (d.attack === "repair")
      lines.push(
        `${Math.round(d.damage * scale * 10) / 10} health / ${d.cooldown}s`,
      );
    else if (d.damage)
      lines.push(`${Math.round(d.damage * scale)} damage / ${d.cooldown}s`);
  }
  return [...lines, ...(item.category === "drone" ? [item.description] : [])];
}
export interface FamilyDefinition {
  id: FamilyId;
  name: string;
  color: string;
  thresholds: { 2: string; 4: string };
}
export const FAMILIES: Record<FamilyId, FamilyDefinition> = {
  kinetic: {
    id: "kinetic",
    name: "Physical",
    color: "#edc280",
    thresholds: {
      2: "10% critical chance. Critical hits deal 60% more damage.",
      4: "20% critical chance. Shots pass through 1 extra enemy.",
    },
  },
  thermal: {
    id: "thermal",
    name: "Fire",
    color: "#ff8658",
    thresholds: {
      2: "Hits burn enemies for 6 damage/sec.",
      4: "Hits burn enemies for 12 damage/sec.",
    },
  },
  storm: {
    id: "storm",
    name: "Lightning",
    color: "#8ce5f2",
    thresholds: {
      2: "10% chance to hit another enemy for 45% damage.",
      4: "22% chance to hit another enemy for 45% damage.",
    },
  },
  frost: {
    id: "frost",
    name: "Ice",
    color: "#a6dfff",
    thresholds: {
      2: "Hits slow enemies by 20%.",
      4: "Hits slow enemies by 35%.",
    },
  },
  toxic: {
    id: "toxic",
    name: "Poison",
    color: "#badb72",
    thresholds: {
      2: "Poison: 4 damage/sec per stack. Up to 3 stacks.",
      4: "Poison: 8 damage/sec per stack. Poison kills heal 2.",
    },
  },
  drone: {
    id: "drone",
    name: "Drones",
    color: "#d1b5ff",
    thresholds: {
      2: "+10% attack speed. +5% movement speed.",
      4: "+22% attack speed. +10% movement speed.",
    },
  },
};
export interface Synergy {
  id: FamilyId;
  name: string;
  color: string;
  count: number;
  tier: 0 | 1 | 2;
  next: 2 | 4 | null;
  description: string;
}
export function getSynergies(
  weapons: ReadonlyArray<{ kind: WeaponId }>,
  items:
    | Partial<Record<ItemId, number>>
    | ReadonlyArray<{ kind: WeaponId | ItemId; category: string }>,
): Synergy[] {
  return Object.values(FAMILIES).map((family) => {
    const active = Array.isArray(items)
      ? items
          .filter((e) => e.category !== "weapon")
          .map((e) => ITEMS[e.kind as ItemId])
      : Object.values(ITEMS).filter(
          (item) =>
            ((items as Partial<Record<ItemId, number>>)[item.id] ?? 0) > 0,
        );
    const count =
      weapons.filter((weapon) =>
        WEAPONS[weapon.kind].families.includes(family.id),
      ).length +
      active.filter((item) => item.families.includes(family.id)).length;
    const tier: 0 | 1 | 2 = count >= 4 ? 2 : count >= 2 ? 1 : 0;
    return {
      ...family,
      count,
      tier,
      next: tier === 2 ? null : tier === 1 ? 4 : 2,
      description: tier === 2 ? family.thresholds[4] : family.thresholds[2],
    };
  });
}
export const THREATS: {
  wave: number;
  kind: EnemyKind;
  name: string;
  description: string;
}[] = [
  {
    wave: 4,
    kind: "runner",
    name: "Runners",
    description: "Fast enemies. Keep moving.",
  },
  {
    wave: 7,
    kind: "brute",
    name: "Brutes",
    description: "Slow, tough, and hits hard.",
  },
  {
    wave: 10,
    kind: "shooter",
    name: "Shooters",
    description: "Fires from a distance. Dodge the shots.",
  },
  {
    wave: 13,
    kind: "charger",
    name: "Chargers",
    description: "Rushes straight at you. Move to the side.",
  },
  {
    wave: 16,
    kind: "splitter",
    name: "Splitters",
    description: "Splits into 3 Runners when defeated.",
  },
  {
    wave: 19,
    kind: "shielder",
    name: "Shielders",
    description: "Protects nearby enemies. Break its shield.",
  },
  {
    wave: 22,
    kind: "bomber",
    name: "Bombers",
    description: "Explodes nearby. Leave the marked circle.",
  },
  {
    wave: 25,
    kind: "medic",
    name: "Medics",
    description: "Heals nearby enemies. Defeat it first.",
  },
  {
    wave: 28,
    kind: "sniper",
    name: "Snipers",
    description: "Aims, then fires fast. Dodge the aim line.",
  },
];
export const BOSS_NAMES = [
  "Gatekeeper",
  "Breaker",
  "Furnace",
  "Stormheart",
  "Broodmother",
  "Iron Choir",
  "Venom Regent",
  "Citadel",
  "Lifebinder",
  "The Crucible",
];
export const waveDuration = (wave: number) =>
  wave % BOSS_INTERVAL === 0
    ? 45
    : Math.min(
        45,
        30 + ((wave - 1) % BOSS_INTERVAL) * 3 + Math.floor((wave - 1) / 10) * 2,
      );
export const WAVE_DURATIONS = Array.from(
  { length: CAMPAIGN_WAVES },
  (_, index) => waveDuration(index + 1),
);
export const ARENA_RADIUS = 17;
export const MAX_WEAPONS = 4;
export const BAG_CAPACITY = 12;
export const ENEMY_STATS: Record<
  EnemyKind,
  {
    hp: number;
    speed: number;
    radius: number;
    damage: number;
    salvage: number;
  }
> = {
  grunt: { hp: 50, speed: 2.6, radius: 0.54, damage: 10, salvage: 1 },
  runner: { hp: 20, speed: 3.5, radius: 0.4, damage: 8, salvage: 1 },
  brute: { hp: 125, speed: 1.22, radius: 0.83, damage: 18, salvage: 2 },
  shooter: { hp: 56, speed: 1.55, radius: 0.53, damage: 12, salvage: 2 },
  charger: { hp: 88, speed: 1.8, radius: 0.65, damage: 17, salvage: 2 },
  splitter: { hp: 95, speed: 1.6, radius: 0.64, damage: 12, salvage: 3 },
  shielder: { hp: 130, speed: 1.1, radius: 0.77, damage: 16, salvage: 4 },
  bomber: { hp: 48, speed: 2.35, radius: 0.48, damage: 25, salvage: 2 },
  medic: { hp: 85, speed: 1.3, radius: 0.58, damage: 9, salvage: 4 },
  sniper: { hp: 90, speed: 1.15, radius: 0.58, damage: 22, salvage: 4 },
  boss: { hp: 2400, speed: 1.08, radius: 1.9, damage: 22, salvage: 40 },
};
