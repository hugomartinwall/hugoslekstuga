import {
  ARENA_RADIUS,
  CAMPAIGN_WAVES,
  BOSS_INTERVAL,
  ENEMY_STATS,
  HEROES,
  ITEMS,
  BAG_CAPACITY,
  THREATS,
  BOSS_NAMES,
  rankScale,
  rankStatLines,
  rerollCost,
  repairCost,
  offerPrice,
  REPAIR_HEAL,
  SELL_RATE,
  WAVE_CLEAR_BONUS,
  WAVE_END_HEAL,
  WEAVE,
  type DroneId,
  type PassiveStat,
  getSynergies,
  waveDuration,
  WEAPONS,
  type EnemyKind,
  type HeroId,
  type ItemId,
  type WeaponId,
  type FamilyId,
  type BulletSpec,
  type BulletChildren,
  type WeaponDefinition,
  type LineSpec,
  type ConeSpec,
  type ChainSpec,
  type MeleeSpec,
  type EquipmentCategory,
  type MapDefinition,
  type MapId,
  mapById,
  mapRamp,
  threatWave,
  waveBudget,
  bossAddBudget,
  spawnGroupSize,
  hordeProgress,
  hordeSize,
  ENEMY_CAP,
  SPAWN_TELEGRAPH,
  HORDE_TELEGRAPH,
  SPAWN_DISTANCE,
  HORDE_RING,
  eliteChance,
  ELITE,
  ENEMY_CURVE,
  RANGED_GROUPS_FROM,
  spawnDistanceMax,
  droneStackRate,
  BAG_SLOT_COST,
  MAX_EXTRA_SLOTS,
  OFFENSIVE_DRONES,
  type OrbitSpec,
  type StrikeSpec,
  type BoltsSpec,
} from "./content";

export type Phase = "ready" | "combat" | "shop" | "won" | "lost";
export interface Vec {
  x: number;
  y: number;
  prevX?: number;
  prevY?: number;
}
export interface Input extends Vec {
  dash?: boolean;
}
export interface Player extends Vec {
  hp: number;
  maxHp: number;
  angle: number;
  dashCooldown: number;
  dashTime: number;
  hurtTime: number;
  radius: number;
  vx: number;
  vy: number;
  abilityTime: number;
  /** Shield charges that absorb one hit each. */
  barrier: number;
  barrierTimer: number;
}
export interface Enemy extends Vec {
  id: number;
  kind: EnemyKind;
  hp: number;
  maxHp: number;
  angle: number;
  state: "walk" | "windup" | "charge" | "recover";
  telegraph: number;
  attackTimer: number;
  stateTime: number;
  radius: number;
  vx: number;
  vy: number;
  hitTime: number;
  knockX: number;
  knockY: number;
  dashHit: number;
  burnTime: number;
  burnDamage: number;
  poisonTime: number;
  poisonDamage: number;
  poisonStacks: number;
  slowTime: number;
  slowFactor: number;
  bossTier: number;
  bossVariant: number;
  attackCount: number;
  statusTick: number;
  lastWeapon?: WeaponId;
  spawnTime: number;
  shield: number;
  maxShield: number;
  healTimer: number;
  repairLockUntil?: number;
  /** Counts toward the wave's enemy counter. Children and boss adds do not. */
  budgeted?: boolean;
  elite?: boolean;
  freezeTime?: number;
}
/** A telegraphed spawn: the enemy arrives when `age` reaches `delay`. */
export interface SpawnMarker extends Vec {
  id: number;
  kind: EnemyKind;
  age: number;
  delay: number;
  budgeted: boolean;
  elite: boolean;
  horde: boolean;
  radius: number;
}
export interface Bullet extends Vec {
  id: number;
  vx: number;
  vy: number;
  enemy: boolean;
  weapon: WeaponId | "enemy";
  damage: number;
  radius: number;
  life: number;
  angle: number;
  pierce: number;
  hitIds: number[];
  level: number;
  age: number;
  grazed: boolean;
  returning: boolean;
  /** The pattern that fired it; enemy and ability bullets have none. */
  behavior?: BulletSpec;
  ownerId?: number;
  timer?: number;
  bounces?: number;
  splits?: number;
  child?: boolean;
  orbitAngle?: number;
  rearmAt?: number;
  /** Distance flown, for range-scaling bonuses. */
  travel?: number;
  fused?: boolean;
  emitTimer?: number;
  trailTimer?: number;
  /** The enemy kind that fired an enemy bullet. */
  source?: EnemyKind;
}
export interface Pickup extends Vec {
  id: number;
  value: number;
  age: number;
  kind: "salvage" | "heal";
}
export interface Equipment {
  id: number;
  kind: WeaponId | ItemId;
  category: EquipmentCategory;
  level: number;
}
export interface Drone extends Vec {
  id: number;
  kind: DroneId;
  level: number;
  angle: number;
  aimAngle: number;
  cooldown: number;
  pulse: number;
}
export interface Hazard extends Vec {
  id: number;
  radius: number;
  age: number;
  delay: number;
  duration: number;
  damage: number;
  kind: "blast" | "toxic";
  triggered: boolean;
  tick: number;
  /** Player hazards hurt enemies and never the player. */
  owner?: "player";
  weapon?: WeaponId;
  knock?: number;
  tickRate?: number;
}
export interface Weapon {
  id: number;
  kind: WeaponId;
  level: number;
  cooldown: number;
  category: "weapon";
  slot: number;
  /** Seconds until a Double shot echo fires. */
  echo?: number;
}
export interface ShopOffer {
  id: number;
  kind: "weapon" | "item" | "heal";
  contentId: string;
  title: string;
  description: string;
  cost: number;
  /** Price before discounts, so a new Discount re-prices the shelf. */
  baseCost: number;
  sold: boolean;
  locked: boolean;
  rarity: "common" | "rare" | "epic" | "insane";
  level: number;
}
export interface Stats {
  damage: number;
  attackSpeed: number;
  speed: number;
  maxHp: number;
  armor: number;
  magnet: number;
  dashCooldown: number;
  healing: number;
  critChance: number;
  shockChance: number;
  pierce: number;
  burnDamage: number;
  poisonDamage: number;
  slowFactor: number;
  toxicHealing: number;
  critDamage: number;
  shockDamage: number;
  shockDepth: number;
  burnExplode: number;
  frostBonus: number;
  poisonStacks: number;
  plagueSpread: number;
  droneRate: number;
  droneDamage: number;
  range: number;
  knockback: number;
  dotPower: number;
  slowPower: number;
  momentum: number;
  thorns: number;
  barrierRate: number;
  ricochet: number;
  split: number;
  splash: number;
  homing: number;
  lifesteal: number;
  echo: number;
  pierceMod: number;
  interest: number;
  discount: number;
  freeRerolls: number;
  luck: number;
  emergency: number;
}
export type EventKind =
  | "spawn"
  | "fire"
  | "hit"
  | "kill"
  | "hurt"
  | "dash"
  | "pickup"
  | "explosion"
  | "arc"
  | "slash"
  | "waveStart"
  | "waveEnd"
  | "buy"
  | "upgrade"
  | "boss"
  | "lost"
  | "won"
  | "telegraph"
  | "weave"
  | "status"
  | "heal"
  | "shieldBreak"
  | "spawnMark"
  | "horde"
  | "pull"
  | "bounce"
  | "burst"
  | "crush"
  | "strike"
  | "barrier";
export interface GameEvent extends Vec {
  type: EventKind;
  id?: number;
  targetId?: number;
  targetX?: number;
  targetY?: number;
  amount?: number;
  radius?: number;
  angle?: number;
  weapon?: WeaponId | "enemy";
  kind?: EnemyKind;
  enemy?: boolean;
  level?: number;
  critical?: boolean;
  status?: "burn" | "poison" | "slow";
  /** The deployed bullet (sentry turret) that fired, when the owner's hand did not. */
  source?: number;
}

/** Set bonuses by tier (0 = none, 1 = two pieces, 2 = four, 3 = six). */
const SET_ATTACK_SPEED = [0, 0.1, 0.22, 0.35],
  SET_MOVE_SPEED = [0, 0.05, 0.1, 0.15],
  SET_CRIT = [0, 0.1, 0.2, 0.3],
  SET_SHOCK = [0, 0.1, 0.22, 0.35],
  SET_PIERCE = [0, 0, 1, 2],
  SET_BURN = [0, 6, 12, 20],
  SET_POISON = [0, 4, 8, 12],
  SET_SLOW = [1, 0.8, 0.65, 0.5],
  SET_TOXIC_HEAL = [0, 0, 2, 4],
  SET_CRIT_DAMAGE = [0.6, 0.6, 0.6, 1],
  SET_SHOCK_DAMAGE = [0.45, 0.45, 0.45, 0.6],
  SET_SHOCK_DEPTH = [1, 1, 1, 2],
  SET_BURN_EXPLODE = [0, 0, 0, 0.3],
  SET_FROST_BONUS = [0, 0, 0, 0.2],
  SET_POISON_STACKS = [3, 3, 3, 5],
  SET_PLAGUE = [0, 0, 0, 1],
  SET_DRONE_RATE = [1, 1, 1, 1.6],
  SET_DRONE_DAMAGE = [1, 1, 1, 1.35];
const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n));
const distance = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
const sqDistance = (a: Vec, b: Vec) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const levelScale = rankScale;
/** All simulation work happens in 1/60 second steps. Rendering never changes outcomes. */
export class SurvivalRun {
  readonly hero: HeroId;
  readonly seed: number;
  readonly map: MapDefinition;
  readonly mapId: MapId;
  phase: Phase = "ready";
  wave = 0;
  time = 0;
  timeRemaining = 0;
  waveDuration = 0;
  totalTime = 0;
  salvage = 0;
  earnedSalvage = 0;
  kills = 0;
  waveKills = 0;
  /** Enemies this wave will spawn, and how many have been drawn from it. */
  waveBudget = 0;
  spawnedCount = 0;
  hordesFired = 0;
  hordeWarning = 0;
  fullClears = 0;
  fastestClear = Infinity;
  waveOutcome: "timer" | "clear" | "boss" | null = null;
  spawnQueue: SpawnMarker[] = [];
  /** Bag slots bought this run. */
  extraSlots = 0;
  player: Player;
  enemies: Enemy[] = [];
  bullets: Bullet[] = [];
  pickups: Pickup[] = [];
  weapons: Weapon[];
  bag: Equipment[] = [];
  drones: Drone[] = [];
  hazards: Hazard[] = [];
  offers: ShopOffer[] = [];
  events: GameEvent[] = [];
  bossDefeated = false;
  endless = false;
  bossesDefeated = 0;
  weaveCharge = 0;
  weaveTime = 0;
  private randomState: number;
  private nextId = 1;
  private accumulator = 0;
  private spawnTimer = 0;
  private healTimer = 0;
  private dashDirection: Vec = { x: 0, y: 1 };
  private dashNumber = 0;
  private dashWasHeld = false;
  private shopRolls = 0;
  private bossSpawned = false;
  private openingShooterSpawned = false;
  private pendingDash = false;
  private combatStats?: Stats;
  private trickleTotal = 0;
  private trickleInterval = 2;
  private trickled = 0;
  private groupsSpawned = 0;
  private stillTime = 0;
  private scorchTick = 0;
  private movingTime = 0;
  private voltKills = 0;
  private bloodlust = 0;
  private bloodlustTime = 0;
  private emergencyUsed = false;
  private splashing = false;

  constructor(hero: HeroId = "ember", seed = 1, map: MapId | number = 1) {
    this.hero = HEROES[hero] ? hero : "ember";
    this.map = mapById(map);
    this.mapId = this.map.id;
    this.seed = seed >>> 0;
    this.extraSlots = this.hero === "flux" ? 2 : 0;
    this.randomState = this.seed || 0x6d2b79f5;
    const definition = HEROES[this.hero];
    this.player = {
      x: 0,
      y: 0,
      hp: definition.maxHp,
      maxHp: definition.maxHp,
      angle: -Math.PI / 2,
      dashCooldown: 0,
      dashTime: 0,
      hurtTime: 0,
      radius: 0.48,
      vx: 0,
      vy: 0,
      abilityTime: 0,
      barrier: 0,
      barrierTimer: 0,
    };
    this.weapons = [
      {
        id: this.nextId++,
        kind: definition.weapon,
        level: 1,
        cooldown: 0,
        category: "weapon",
        slot: 0,
      },
    ];
    if (this.hero === "wisp")
      this.bag.push({
        id: this.nextId++,
        kind: "gun_drone",
        category: "drone",
        level: 1,
      });
    this.syncDrones();
  }

  get items(): Partial<Record<ItemId, number>> {
    const counts: Partial<Record<ItemId, number>> = {};
    for (const item of this.bag)
      if (item.category !== "weapon")
        counts[item.kind as ItemId] =
          (counts[item.kind as ItemId] ?? 0) + rankScale(item.level);
    return counts;
  }
  get weaponSlots() {
    return HEROES[this.hero].weaponSlots;
  }
  get equipment(): Equipment[] {
    return [...this.weapons, ...this.bag];
  }
  get passiveStats(): Partial<Record<PassiveStat, number>> {
    const total: Partial<Record<PassiveStat, number>> = {};
    for (const instance of this.bag)
      if (instance.category !== "weapon")
        for (const [key, value] of Object.entries(
          ITEMS[instance.kind as ItemId].passiveStats,
        ) as [PassiveStat, number][])
          total[key] = (total[key] ?? 0) + value * rankScale(instance.level);
    return total;
  }
  get stats(): Stats {
    const totals = this.passiveStats,
      n = (id: PassiveStat) => totals[id] ?? 0,
      sets = this.synergies,
      tier = (id: FamilyId) => sets.find((s) => s.id === id)!.tier;
    const drone = tier("drone"),
      kinetic = tier("kinetic"),
      thermal = tier("thermal"),
      storm = tier("storm"),
      frost = tier("frost"),
      toxic = tier("toxic");
    const armor = (this.hero === "bastion" ? 8 : 0) + n("armor");
    return {
      damage:
        (1 +
          n("damage") +
          (this.hero === "ember"
            ? 0.1
            : this.hero === "prism"
              ? new Set(this.weapons.map((w) => w.kind)).size * 0.05
              : this.hero === "bastion"
                ? armor * 0.01
                : this.hero === "flux"
                  ? -0.1
                  : 0) +
          (this.movingTime > 0.5 ? n("momentum") : 0)) *
        (this.weaveTime > 0 ? 1 + WEAVE.bonus : 1),
      attackSpeed: Math.min(
        4.5,
        (1 +
          n("attackSpeed") +
          SET_ATTACK_SPEED[drone] +
          (this.hero === "reaper" ? Math.min(10, this.bloodlust) * 0.04 : 0)) *
          (this.hero === "bastion" || this.hero === "frost" ? 0.85 : 1),
      ),
      speed:
        HEROES[this.hero].speed *
        (1 + Math.min(0.7, n("speed")) + SET_MOVE_SPEED[drone]),
      maxHp:
        Math.round(
          HEROES[this.hero].maxHp *
            (this.hero === "volt" ? 0.8 : this.hero === "prism" ? 0.85 : 1),
        ) + n("maxHp"),
      armor,
      magnet: 3.8 * (1 + n("magnet") + (this.hero === "flux" ? 0.5 : 0)),
      dashCooldown: Math.max(
        1.2,
        HEROES[this.hero].dashCooldown / (1 + n("dashRecovery")),
      ),
      healing: n("healing"),
      critChance: Math.min(0.75, SET_CRIT[kinetic] + n("critChance")),
      shockChance: Math.min(
        0.5,
        SET_SHOCK[storm] + (this.hero === "volt" ? 0.15 : 0),
      ),
      pierce: SET_PIERCE[kinetic],
      burnDamage:
        Math.max(SET_BURN[thermal], this.hero === "cinder" ? 5 : 0) +
        n("burnDamage"),
      poisonDamage:
        Math.max(SET_POISON[toxic], this.hero === "thorn" ? 4 : 0) +
        n("poisonDamage"),
      slowFactor: Math.min(SET_SLOW[frost], this.hero === "frost" ? 0.8 : 1),
      toxicHealing: SET_TOXIC_HEAL[toxic],
      critDamage: SET_CRIT_DAMAGE[kinetic] + Math.min(1.5, n("critDamage")),
      shockDamage: SET_SHOCK_DAMAGE[storm],
      shockDepth: SET_SHOCK_DEPTH[storm],
      burnExplode: SET_BURN_EXPLODE[thermal],
      frostBonus: SET_FROST_BONUS[frost],
      poisonStacks: Math.max(SET_POISON_STACKS[toxic], this.hero === "thorn" ? 5 : 3),
      plagueSpread: SET_PLAGUE[toxic],
      droneRate: SET_DRONE_RATE[drone],
      droneDamage: SET_DRONE_DAMAGE[drone],
      range: 1 + n("range"),
      knockback: n("knockback"),
      dotPower: n("dotPower"),
      slowPower: Math.min(0.35, n("slowPower")),
      momentum: n("momentum"),
      thorns: n("thorns"),
      barrierRate: n("barrierRate"),
      ricochet: n("ricochet"),
      split: n("split"),
      splash: Math.min(0.9, n("splash")),
      homing: Math.min(14, n("homing")),
      lifesteal: Math.min(0.04, n("lifesteal")),
      echo: Math.min(0.6, n("echo")),
      pierceMod: Math.min(4, n("pierce")),
      interest: n("interest"),
      discount: Math.min(0.35, n("discount")),
      freeRerolls: Math.min(3, n("freeRerolls")),
      luck: n("luck"),
      emergency: Math.min(0.9, n("emergency")),
    };
  }
  get synergies() {
    // Prism's lattice lets stowed weapons count; everyone else counts hands only.
    const weapons =
      this.hero === "prism"
        ? [
            ...this.weapons,
            ...this.bag
              .filter((item) => item.category === "weapon")
              .map((item) => ({ kind: item.kind as WeaponId })),
          ]
        : this.weapons;
    return getSynergies(weapons, this.bag, HEROES[this.hero].setPiece);
  }
  get waveThreat() {
    return (
      THREATS.find((threat) => threatWave(threat, this.map) === this.wave) ??
      null
    );
  }
  private threatUnlocked(kind: EnemyKind): boolean {
    const threat = THREATS.find((t) => t.kind === kind);
    return !!threat && threatWave(threat, this.map) <= this.wave;
  }
  /** Enemies still to come this wave: unspawned, telegraphed and alive. */
  /** Reaper's Harvest stacks (0-10), for the blood-ring aura. */
  get bloodlustStacks(): number {
    return this.bloodlust;
  }
  get remainingEnemies(): number {
    return (
      Math.max(0, this.waveBudget - this.spawnedCount) +
      this.spawnQueue.filter((marker) => marker.budgeted).length +
      this.enemies.filter((enemy) => enemy.budgeted && enemy.hp > 0).length
    );
  }
  get enemiesAlive(): number {
    return this.enemies.filter((enemy) => enemy.hp > 0).length;
  }
  get enemyCap(): number {
    return ENEMY_CAP + 6 * this.tuning.spawnGroup;
  }
  get groupSize(): number {
    return spawnGroupSize(this.wave) + this.tuning.spawnGroup;
  }
  /** A hook for difficulty experiments; the shipped game never scales by gear. */
  get pressure(): number {
    return 1;
  }
  get eliteChance(): number {
    const base = eliteChance(this.wave);
    return this.rule === "elites" ? Math.min(0.4, Math.max(0.2, base * 2)) : base;
  }
  get bagCapacity(): number {
    return BAG_CAPACITY + this.extraSlots;
  }
  canBuySlot(): boolean {
    return (
      this.phase === "shop" &&
      this.extraSlots < MAX_EXTRA_SLOTS &&
      this.salvage >= BAG_SLOT_COST
    );
  }
  buySlot(): boolean {
    if (!this.canBuySlot()) return false;
    this.salvage -= BAG_SLOT_COST;
    this.extraSlots++;
    this.emit({ type: "buy", ...this.player, amount: BAG_SLOT_COST });
    return true;
  }
  get renderAlpha() {
    return clamp(this.accumulator * 60, 0, 1);
  }
  get isBossWave() {
    return this.wave > 0 && this.wave % this.bossInterval === 0;
  }
  get bossName() {
    return BOSS_NAMES[
      (Math.max(1, Math.ceil(this.wave / this.bossInterval)) - 1) %
        BOSS_NAMES.length
    ];
  }
  get tuning() {
    return this.map.tuning;
  }
  get rule() {
    return this.map.rule.id;
  }
  /** Waves between bosses on this map. */
  get bossInterval() {
    return this.rule === "gauntlet" ? 2 : BOSS_INTERVAL;
  }
  /** A map multiplier blended in over the opening waves. */
  private scaled(key: "hp" | "damage" | "bossHp" | "budget"): number {
    return 1 + (this.tuning[key] - 1) * mapRamp(this.wave);
  }
  private price(amount: number): number {
    return Math.ceil(amount * this.tuning.prices);
  }
  /** Weapon and drone reach after map rules. */
  private reach(range: number): number {
    return range * (this.rule === "fog" ? 0.75 : 1);
  }
  /** Hand weapon reach: map rules plus the hero's own limits. */
  private weaponReach(range: number): number {
    return (
      this.reach(range) *
      (this.hero === "cinder" ? 0.8 : 1) *
      (this.combatStats ?? this.stats).range
    );
  }
  continueEndless(): boolean {
    if (this.phase !== "won" || this.wave !== CAMPAIGN_WAVES || this.endless)
      return false;
    this.endless = true;
    this.phase = "shop";
    this.shopRolls = 0;
    this.makeShop(true);
    return true;
  }
  get rerollCost() {
    if (this.shopRolls < Math.floor(this.stats.freeRerolls)) return 0;
    return this.price(
      rerollCost(this.wave, this.shopRolls) * (this.hero === "flux" ? 0.5 : 1),
    );
  }
  get boss() {
    return this.enemies.find((enemy) => enemy.kind === "boss");
  }
  get waveProgress() {
    return this.waveDuration ? clamp(this.time / this.waveDuration, 0, 1) : 0;
  }
  get weaponCount() {
    return this.weapons.length;
  }
  drainEvents(): GameEvent[] {
    const result = this.events;
    this.events = [];
    return result;
  }

  startWave(): boolean {
    if (
      (this.phase !== "ready" && this.phase !== "shop") ||
      (!this.endless && this.wave >= CAMPAIGN_WAVES)
    )
      return false;
    this.wave++;
    this.phase = "combat";
    this.time = 0;
    this.waveDuration = waveDuration(this.wave, this.bossInterval);
    this.timeRemaining = this.waveDuration;
    this.waveKills = 0;
    this.spawnTimer = 0.45;
    this.waveOutcome = null;
    this.spawnQueue = [];
    this.spawnedCount = 0;
    this.hordesFired = 0;
    this.hordeWarning = 0;
    this.trickled = 0;
    this.groupsSpawned = 0;
    this.emergencyUsed = false;
    this.player.barrier = 0;
    this.player.barrierTimer = 0;
    this.stillTime = 0;
    this.scorchTick = 0;
    this.movingTime = 0;
    this.waveBudget = Math.max(
      5,
      Math.round(
        (this.isBossWave ? bossAddBudget(this.wave) : waveBudget(this.wave)) *
          this.scaled("budget") *
          this.pressure,
      ),
    );
    {
      const hordes = hordeProgress(this.wave).length * this.hordeSize,
        opening = 4 + (this.waveThreat ? 1 : 0);
      this.trickleTotal = Math.max(0, this.waveBudget - opening - hordes);
      const groups = Math.max(1, Math.ceil(this.trickleTotal / this.groupSize));
      this.trickleInterval = clamp(
        (0.9 * this.waveDuration - 0.6) / groups,
        0.55,
        2.4,
      );
    }
    this.healTimer = 0;
    this.accumulator = 0;
    this.player.x = 0;
    this.player.y = 0;
    this.player.prevX = 0;
    this.player.prevY = 0;
    this.player.hurtTime = 0.5;
    this.player.dashCooldown = 0;
    this.player.dashTime = 0;
    this.player.vx = 0;
    this.player.vy = 0;
    this.enemies = [];
    this.bullets = [];
    this.pickups = [];
    this.hazards = [];
    this.syncDrones();
    for (const drone of this.drones) {
      drone.x = this.player.x;
      drone.y = this.player.y;
      drone.prevX = drone.x;
      drone.prevY = drone.y;
      drone.cooldown = 0;
    }
    this.pendingDash = false;
    this.dashWasHeld = false;
    this.openingShooterSpawned = false;
    this.bossSpawned = false;
    this.bossDefeated = false;
    this.weaveCharge = 0;
    this.weaveTime = 0;
    for (const drone of this.drones) drone.cooldown = 0;
    this.player.abilityTime = 0;
    this.combatStats = undefined;
    for (const weapon of this.weapons) weapon.cooldown = 0;
    this.emit({ type: "waveStart", ...this.player, amount: this.wave });
    // The first foes are already entering the arena: combat begins on the first beat.
    const near = Math.max(
      6.5,
      Math.min(8, WEAPONS[HEROES[this.hero].weapon].range * 0.75),
    );
    const opening = { budgeted: true };
    this.spawn("grunt", { x: -near, y: -0.8 }, opening);
    this.spawn("grunt", { x: near, y: 1.2 }, opening);
    this.spawn("grunt", { x: -1.2, y: -near - 1 }, opening);
    this.spawn("grunt", { x: 1.6, y: near + 1 }, opening);
    this.spawnedCount = 4;
    return true;
  }

  step(dt: number, input: Input = { x: 0, y: 0 }): void {
    if (this.phase !== "combat" || !Number.isFinite(dt) || dt <= 0) return;
    const safeInput = {
      x: Number.isFinite(input.x) ? input.x : 0,
      y: Number.isFinite(input.y) ? input.y : 0,
      dash: !!input.dash,
    };
    if (safeInput.dash && !this.dashWasHeld) this.pendingDash = true;
    this.dashWasHeld = safeInput.dash;
    this.accumulator += Math.min(dt, 0.25);
    while (this.accumulator + 1e-9 >= 1 / 60 && this.phase === "combat") {
      this.accumulator -= 1 / 60;
      this.tick(1 / 60, safeInput);
    }
  }

  dash(direction?: Vec): boolean {
    if (
      this.phase !== "combat" ||
      this.player.dashCooldown > 0 ||
      this.player.dashTime > 0
    )
      return false;
    const length = direction ? Math.hypot(direction.x, direction.y) : 0;
    this.dashDirection =
      length > 0.05
        ? { x: direction!.x / length, y: direction!.y / length }
        : { x: Math.cos(this.player.angle), y: Math.sin(this.player.angle) };
    this.player.dashTime = this.hero === "bastion" ? 0.28 : 0.2;
    this.player.dashCooldown = this.stats.dashCooldown;
    this.dashNumber++;
    this.emit({
      type: "dash",
      ...this.player,
      angle: Math.atan2(this.dashDirection.y, this.dashDirection.x),
      radius: this.hero === "volt" ? 5 : 1,
    });
    if (this.hero === "ember") {
      const target = this.nearest(this.player, 16);
      const aim = target
        ? Math.atan2(target.y - this.player.y, target.x - this.player.x)
        : this.player.angle;
      for (let i = -3; i <= 3; i++)
        this.spawnBullet(
          this.player,
          aim + i * 0.14,
          "pistol",
          21 * this.stats.damage,
          24,
          1.4,
          1,
          1,
        );
    } else if (this.hero === "volt") {
      for (const enemy of [...this.enemies])
        if (distance(enemy, this.player) < 5.2) {
          this.emit({
            type: "arc",
            ...this.player,
            targetX: enemy.x,
            targetY: enemy.y,
            targetId: enemy.id,
            weapon: "arc",
          });
          this.hitEnemy(enemy, 42 * this.stats.damage, this.player, 3);
        }
    } else if (
      this.hero === "cinder" ||
      this.hero === "frost" ||
      this.hero === "reaper"
    ) {
      const radius = this.hero === "reaper" ? 3.8 : 5.5;
      this.emit({
        type: "explosion",
        ...this.player,
        radius,
        weapon:
          this.hero === "frost"
            ? "frostgun"
            : this.hero === "reaper"
              ? "blade"
              : "flame",
      });
      let healed = 0;
      for (const enemy of this.enemies)
        if (distance(enemy, this.player) < radius + enemy.radius) {
          this.hitEnemy(
            enemy,
            (this.hero === "reaper" ? 90 : this.hero === "cinder" ? 35 : 22) *
              this.stats.damage,
            this.player,
            4,
            true,
            this.hero === "reaper"
              ? "blade"
              : this.hero === "frost"
                ? "frostgun"
                : "flame",
          );
          if (this.hero === "frost") {
            enemy.slowFactor = 0.4;
            enemy.slowTime = 3;
            enemy.freezeTime = 1;
          }
          if (this.hero === "cinder") {
            enemy.burnDamage = Math.max(
              enemy.burnDamage,
              12 * this.stats.damage,
            );
            enemy.burnTime = 3;
          }
          if (this.hero === "reaper" && healed < 12) {
            const heal = Math.min(4, 12 - healed);
            this.player.hp = Math.min(this.player.maxHp, this.player.hp + heal);
            healed += heal;
          }
        }
    } else if (this.hero === "thorn") {
      for (let i = 0; i < 12; i++)
        this.spawnBullet(
          this.player,
          (Math.PI * 2 * i) / 12,
          "needle",
          22 * this.stats.damage,
          22,
          0.65,
          2,
          1,
        );
    } else if (this.hero === "wisp") {
      this.player.abilityTime = 4;
      for (const drone of this.drones) drone.cooldown = 0;
    } else if (this.hero === "flux") {
      this.emit({
        type: "explosion",
        ...this.player,
        radius: 8,
        weapon: "boomerang",
      });
      for (const enemy of this.enemies)
        if (distance(enemy, this.player) < 8)
          this.hitEnemy(
            enemy,
            28 * this.stats.damage,
            this.player,
            -10,
            true,
            "boomerang",
          );
      for (const pickup of this.pickups)
        if (distance(pickup, this.player) < 12) pickup.age = 20;
    } else if (this.hero === "prism") {
      const target = this.nearest(this.player, 18),
        aim = target
          ? Math.atan2(target.y - this.player.y, target.x - this.player.x)
          : this.player.angle;
      for (const spread of [-0.23, 0, 0.23])
        this.spawnBullet(
          this.player,
          aim + spread,
          "beam",
          80 * this.stats.damage,
          30,
          0.65,
          20,
          1,
        );
    }
    return true;
  }

  canBuy(index: number): boolean {
    const offer = this.offers[index];
    if (
      this.phase !== "shop" ||
      !offer ||
      offer.sold ||
      this.salvage < offer.cost
    )
      return false;
    if (offer.kind === "heal") return this.player.hp < this.player.maxHp;
    if (offer.kind === "weapon" && this.weapons.length < this.weaponSlots)
      return true;
    return this.bag.length < this.bagCapacity;
  }
  buy(index: number): boolean {
    if (!this.canBuy(index)) return false;
    const offer = this.offers[index],
      oldMax = this.player.maxHp;
    this.salvage -= offer.cost;
    offer.sold = true;
    offer.locked = false;
    if (offer.kind === "heal")
      this.player.hp = Math.min(
        this.player.maxHp,
        this.player.hp + Math.ceil(this.player.maxHp * REPAIR_HEAL),
      );
    else {
      const equipment: Equipment = {
        id: this.nextId++,
        kind: offer.contentId as WeaponId | ItemId,
        category:
          offer.kind === "weapon"
            ? "weapon"
            : ITEMS[offer.contentId as ItemId].category,
        level: offer.level,
      };
      if (
        equipment.category === "weapon" &&
        this.weapons.length < this.weaponSlots
      ) {
        const slot = Array.from({ length: this.weaponSlots }, (_, i) => i).find(
          (i) => !this.weapons.some((w) => w.slot === i),
        )!;
        this.weapons.push({
          ...equipment,
          kind: equipment.kind as WeaponId,
          category: "weapon",
          slot,
          cooldown: 0,
        });
        this.weapons.sort((a, b) => a.slot - b.slot);
      } else this.bag.push(equipment);
    }
    this.refreshInventory(oldMax);
    this.emit({ type: "buy", ...this.player, amount: offer.cost });
    return true;
  }
  equipmentById(id: number): Equipment | undefined {
    return this.equipment.find((item) => item.id === id);
  }
  canMergeEquipment(id: number): boolean {
    const item = this.equipmentById(id);
    return (
      this.phase === "shop" &&
      !!item &&
      item.level < 6 &&
      !(item.category === "weapon" && WEAPONS[item.kind as WeaponId].unique) &&
      this.equipment.some(
        (other) =>
          other.id !== id &&
          other.category === item.category &&
          other.kind === item.kind &&
          other.level === item.level,
      )
    );
  }
  mergeEquipment(id: number): boolean {
    if (!this.canMergeEquipment(id)) return false;
    const selected = this.equipmentById(id)!,
      other = this.equipment.find(
        (item) =>
          item.id !== id &&
          item.category === selected.category &&
          item.kind === selected.kind &&
          item.level === selected.level,
      )!;
    const selectedHand = this.weapons.find((w) => w.id === id),
      otherHand = this.weapons.find((w) => w.id === other.id),
      slot = selectedHand?.slot ?? otherHand?.slot,
      oldMax = this.player.maxHp;
    this.weapons = this.weapons.filter((w) => w.id !== id && w.id !== other.id);
    this.bag = this.bag.filter((w) => w.id !== id && w.id !== other.id);
    const merged = { ...selected, level: selected.level + 1 };
    if (slot !== undefined)
      this.weapons.push({
        ...merged,
        kind: merged.kind as WeaponId,
        category: "weapon",
        slot,
        cooldown: 0,
      });
    else this.bag.push(merged);
    this.weapons.sort((a, b) => a.slot - b.slot);
    this.refreshInventory(oldMax);
    this.emit({
      type: "upgrade",
      ...this.player,
      id,
      level: merged.level,
      weapon:
        merged.category === "weapon" ? (merged.kind as WeaponId) : undefined,
    });
    return true;
  }
  equipWeapon(id: number, slot: number): boolean {
    if (
      this.phase !== "shop" ||
      !Number.isInteger(slot) ||
      slot < 0 ||
      slot >= this.weaponSlots
    )
      return false;
    const item = this.equipmentById(id);
    if (!item || item.category !== "weapon") return false;
    const held = this.weapons.find((w) => w.id === id),
      target = this.weapons.find((w) => w.slot === slot);
    if (held) {
      const old = held.slot;
      if (target && target !== held) target.slot = old;
      held.slot = slot;
    } else {
      this.bag = this.bag.filter((w) => w.id !== id);
      if (target) {
        this.weapons = this.weapons.filter((w) => w.id !== target.id);
        this.bag.push({
          id: target.id,
          kind: target.kind,
          category: "weapon",
          level: target.level,
        });
      }
      this.weapons.push({
        ...item,
        kind: item.kind as WeaponId,
        category: "weapon",
        slot,
        cooldown: 0,
      });
    }
    this.weapons.sort((a, b) => a.slot - b.slot);
    this.refreshInventory();
    return true;
  }
  private stillArmed(without: number): boolean {
    if (this.weapons.some((w) => w.id !== without)) return true;
    return (
      this.hero === "wisp" &&
      this.bag.some(
        (item) =>
          item.id !== without &&
          item.category === "drone" &&
          OFFENSIVE_DRONES.includes(ITEMS[item.kind as ItemId].drone!.attack),
      )
    );
  }
  canUnequipWeapon(id: number): boolean {
    return (
      this.phase === "shop" &&
      this.weapons.some((w) => w.id === id) &&
      this.bag.length < this.bagCapacity &&
      this.stillArmed(id)
    );
  }
  unequipWeapon(id: number): boolean {
    if (!this.canUnequipWeapon(id)) return false;
    const weapon = this.weapons.find((w) => w.id === id)!;
    this.weapons = this.weapons.filter((w) => w.id !== id);
    this.bag.push({
      id,
      kind: weapon.kind,
      category: "weapon",
      level: weapon.level,
    });
    this.refreshInventory();
    return true;
  }
  equipmentSellValue(id: number): number {
    const item = this.equipmentById(id);
    if (!item) return 0;
    const price =
      item.category === "weapon"
        ? WEAPONS[item.kind as WeaponId].cost
        : ITEMS[item.kind as ItemId].cost;
    return Math.max(1, Math.floor(price * rankScale(item.level) * SELL_RATE));
  }
  canSellEquipment(id: number): boolean {
    const item = this.equipmentById(id);
    if (this.phase !== "shop" || !item) return false;
    return !(
      (this.weapons.some((w) => w.id === id) ||
        (this.hero === "wisp" && item.category === "drone")) &&
      !this.stillArmed(id)
    );
  }
  sellEquipment(id: number): boolean {
    if (!this.canSellEquipment(id)) return false;
    this.salvage += this.equipmentSellValue(id);
    this.weapons = this.weapons.filter((w) => w.id !== id);
    this.bag = this.bag.filter((w) => w.id !== id);
    this.refreshInventory();
    return true;
  }
  private refreshInventory(oldMax = this.player.maxHp): void {
    this.combatStats = undefined;
    this.player.maxHp = this.stats.maxHp;
    const discount = this.stats.discount;
    for (const offer of this.offers)
      if (!offer.sold) offer.cost = Math.ceil(offer.baseCost * (1 - discount));
    this.player.hp = Math.min(
      this.player.maxHp,
      this.player.hp + Math.max(0, this.player.maxHp - oldMax),
    );
    this.syncDrones();
  }
  private syncDrones(): void {
    const old = new Map(this.drones.map((d) => [d.id, d]));
    this.drones = this.bag
      .filter((item) => item.category === "drone")
      .map((item) => ({
        ...old.get(item.id),
        id: item.id,
        kind: item.kind as DroneId,
        level: item.level,
        x: old.get(item.id)?.x ?? this.player.x,
        y: old.get(item.id)?.y ?? this.player.y,
        angle: old.get(item.id)?.angle ?? 0,
        aimAngle: old.get(item.id)?.aimAngle ?? this.player.angle,
        cooldown: old.get(item.id)?.cooldown ?? 0,
        pulse: 0,
      }));
  }
  reroll(): boolean {
    if (
      this.phase !== "shop" ||
      this.salvage < this.rerollCost ||
      this.offers.every((o) => o.locked && !o.sold)
    )
      return false;
    this.salvage -= this.rerollCost;
    this.shopRolls++;
    this.makeShop(true);
    return true;
  }
  lockShop(index?: number): void {
    if (this.phase !== "shop") return;
    if (index !== undefined) {
      const offer = this.offers[index];
      if (offer && !offer.sold) offer.locked = !offer.locked;
    } else {
      const locked = !this.offers.filter((o) => !o.sold).every((o) => o.locked);
      for (const offer of this.offers) if (!offer.sold) offer.locked = locked;
    }
  }
  sellValue(index: number): number {
    return this.weapons[index]
      ? this.equipmentSellValue(this.weapons[index].id)
      : 0;
  }
  sellWeapon(index: number): boolean {
    return this.weapons[index]
      ? this.sellEquipment(this.weapons[index].id)
      : false;
  }
  private random(): number {
    let t = (this.randomState += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  private emit(event: GameEvent): void {
    if (this.events.length < 500) this.events.push(event);
  }
  private nearest(
    origin: Vec,
    range: number,
    excluded: number[] = [],
  ): Enemy | undefined {
    let best: Enemy | undefined,
      bestD = range * range;
    for (const enemy of this.enemies) {
      if (enemy.hp <= 0 || excluded.includes(enemy.id)) continue;
      const d = sqDistance(origin, enemy);
      if (d < bestD) {
        best = enemy;
        bestD = d;
      }
    }
    return best;
  }

  private tick(dt: number, input: Input): void {
    for (const entity of [
      this.player,
      ...this.enemies,
      ...this.bullets,
      ...this.pickups,
      ...this.drones,
    ]) {
      entity.prevX = entity.x;
      entity.prevY = entity.y;
    }
    this.time += dt;
    this.totalTime += dt;
    this.timeRemaining = Math.max(0, this.waveDuration - this.time);
    this.weaveTime = Math.max(0, this.weaveTime - dt);
    const stats = (this.combatStats = this.stats),
      p = this.player;
    p.abilityTime = Math.max(0, p.abilityTime - dt);
    p.hurtTime = Math.max(0, p.hurtTime - dt);
    p.dashCooldown = Math.max(0, p.dashCooldown - dt);
    this.bloodlustTime = Math.max(0, this.bloodlustTime - dt);
    if (!this.bloodlustTime) this.bloodlust = 0;
    if (this.pendingDash) {
      this.dash(input);
      this.pendingDash = false;
    }
    let ix = input.x,
      iy = input.y;
    const length = Math.hypot(ix, iy);
    if (length > 1) {
      ix /= length;
      iy /= length;
    }
    if (p.dashTime > 0) {
      p.dashTime = Math.max(0, p.dashTime - dt);
      p.vx = this.dashDirection.x * stats.speed * 3.2;
      p.vy = this.dashDirection.y * stats.speed * 3.2;
    } else {
      p.vx = ix * stats.speed;
      p.vy = iy * stats.speed;
    }
    p.x = clamp(p.x + p.vx * dt, -ARENA_RADIUS + 0.65, ARENA_RADIUS - 0.65);
    p.y = clamp(p.y + p.vy * dt, -ARENA_RADIUS + 0.65, ARENA_RADIUS - 0.65);
    if (length > 0.05) p.angle = Math.atan2(iy, ix);
    this.movingTime = length > 0.05 || p.dashTime > 0 ? this.movingTime + dt : 0;
    if (this.rule === "scorched") {
      // Standing still on the furnace floor burns through armor and i-frames.
      this.stillTime =
        length < 0.05 && p.dashTime <= 0 ? this.stillTime + dt : 0;
      if (this.stillTime > 1) {
        this.scorchTick -= dt;
        if (this.scorchTick <= 0) {
          this.scorchTick = 0.5;
          const burn = p.maxHp * 0.02;
          p.hp = Math.max(0, p.hp - burn);
          this.emit({ type: "hurt", ...p, amount: burn, angle: p.angle });
        }
      }
    }
    const target = this.nearest(p, this.reach(16));
    if (target) p.angle = Math.atan2(target.y - p.y, target.x - p.x);
    this.healTimer += dt;
    if (this.healTimer >= 3) {
      this.healTimer -= 3;
      p.hp = Math.min(p.maxHp, p.hp + stats.healing * 3);
    }
    if (stats.barrierRate > 0) {
      p.barrierTimer += dt * stats.barrierRate;
      if (p.barrierTimer >= 1) {
        p.barrierTimer -= 1;
        const before = p.barrier;
        p.barrier = Math.min(1 + Math.floor(stats.barrierRate * 12), p.barrier + 1);
        if (p.barrier > before)
          this.emit({ type: "barrier", x: p.x, y: p.y, id: 0, amount: p.barrier });
      }
    }

    if (this.isBossWave && !this.bossSpawned && this.time > 1.5) {
      this.spawn("boss");
      this.bossSpawned = true;
      this.emit({ type: "boss", x: 0, y: -15 });
      if (this.wave === CAMPAIGN_WAVES && this.rule === "twinFinale") {
        this.spawn("boss", { x: 0, y: 15.5 }, { variant: 1 });
        this.emit({ type: "boss", x: 0, y: 15 });
      }
    }
    if (this.waveThreat && !this.openingShooterSpawned && this.time >= 0.8) {
      this.enqueueSpawn(
        this.waveThreat.kind,
        this.pickSpawnPoint(false),
        SPAWN_TELEGRAPH,
        { budgeted: true },
      );
      this.openingShooterSpawned = true;
    }
    this.scheduleSpawns(dt);
    this.activateSpawns(dt);
    this.moveDrones(dt);
    for (const weapon of this.weapons) {
      weapon.cooldown -= dt;
      if (weapon.echo && weapon.echo > 0) {
        weapon.echo -= dt;
        if (weapon.echo <= 0) {
          const target = this.nearest(
            p,
            this.weaponReach(WEAPONS[weapon.kind].range),
          );
          if (target) this.fire(weapon, target);
        }
      }
      if (weapon.cooldown <= 0) {
        const target = this.nearest(
          p,
          this.weaponReach(WEAPONS[weapon.kind].range),
        );
        if (target) {
          this.fire(weapon, target);
          weapon.cooldown = WEAPONS[weapon.kind].cooldown / stats.attackSpeed;
          if (stats.echo > 0 && this.random() < stats.echo) weapon.echo = 0.08;
        } else weapon.cooldown = 0;
      }
    }
    this.moveEnemies(dt);
    this.moveBullets(dt);
    this.movePickups(dt);
    this.moveHazards(dt);
    this.enemies = this.enemies.filter((e) => e.hp > 0);
    if (p.hp <= 0) {
      this.phase = "lost";
      this.emit({ type: "lost", ...p });
      return;
    }
    if (this.isBossWave && this.bossDefeated && !this.boss) {
      this.completeWave("boss");
      return;
    }
    if (!this.isBossWave) {
      if (this.time >= this.waveDuration) this.completeWave("timer");
      else if (
        this.spawnedCount >= this.waveBudget &&
        !this.spawnQueue.length &&
        !this.enemies.length
      )
        this.completeWave("clear");
    }
  }
  get hordeSize(): number {
    return Math.round(hordeSize(this.wave) * (1 + 0.15 * this.tuning.spawnGroup));
  }
  private get unspawned(): number {
    return Math.max(0, this.waveBudget - this.spawnedCount);
  }
  /** Feeds the wave budget into the arena: a steady trickle plus hordes. */
  private scheduleSpawns(dt: number): void {
    this.hordeWarning = Math.max(0, this.hordeWarning - dt);
    if (this.time >= this.waveDuration) return;
    const progress = hordeProgress(this.wave);
    if (
      this.hordesFired < progress.length &&
      this.waveProgress >= progress[this.hordesFired] &&
      this.unspawned > 0
    ) {
      this.hordesFired++;
      this.horde(Math.min(this.unspawned, this.hordeSize));
    }
    if (this.unspawned <= 0) return;
    const group = this.groupSize;
    this.spawnTimer -= dt;
    // Never idle while budget remains: a fast player pulls the schedule forward,
    // and a slow one still receives the whole wave before the timer runs out.
    if (this.enemiesAlive + this.spawnQueue.length < 2 + group)
      this.spawnTimer = Math.min(this.spawnTimer, 0.35);
    const span = Math.max(1, 0.9 * this.waveDuration - 0.6),
      expected = this.trickleTotal * clamp((this.time - 0.6) / span, 0, 1);
    if (this.trickled < expected) this.spawnTimer = Math.min(this.spawnTimer, 0);
    if (this.spawnTimer > 0) return;
    this.spawnTimer += this.trickleInterval;
    const behind = this.wave >= 3 && this.random() < 0.3,
      point = this.pickSpawnPoint(behind);
    // Late in a campaign every third group brings a shooter, so a player who
    // parks still takes fire from range.
    const ranged =
      this.wave >= RANGED_GROUPS_FROM && this.groupsSpawned++ % 3 === 0
        ? (["sniper", "shooter"] as EnemyKind[]).find((kind) =>
            this.threatUnlocked(kind),
          )
        : undefined;
    for (let i = 0; i < group && this.unspawned > 0; i++) {
      if (this.enemiesAlive + this.spawnQueue.length >= this.enemyCap) break;
      const jitter = {
        x: clamp(point.x + (this.random() * 2 - 1) * 1.2, -16.2, 16.2),
        y: clamp(point.y + (this.random() * 2 - 1) * 1.2, -16.2, 16.2),
      };
      this.enqueueSpawn(
        i === 0 && ranged ? ranged : this.chooseEnemy(),
        jitter,
        SPAWN_TELEGRAPH,
        { budgeted: true },
      );
      this.trickled++;
    }
  }
  /** A ring of enemies closes on the player after a longer telegraph. */
  private horde(size: number): void {
    const p = this.player,
      ring =
        this.hordesFired >= hordeProgress(this.wave).length
          ? HORDE_RING.inner
          : HORDE_RING,
      radius = ring.min + this.random() * (ring.max - ring.min),
      phase = this.random() * Math.PI * 2,
      room = this.enemyCap + 10 - this.enemiesAlive - this.spawnQueue.length,
      count = Math.max(0, Math.min(size, room));
    for (let i = 0; i < count; i++) {
      const a = phase + (i / count) * Math.PI * 2;
      this.enqueueSpawn(
        this.hordeKind(),
        {
          x: clamp(p.x + Math.cos(a) * radius, -16.2, 16.2),
          y: clamp(p.y + Math.sin(a) * radius, -16.2, 16.2),
        },
        HORDE_TELEGRAPH,
        { budgeted: true, horde: true },
      );
    }
    if (!count) return;
    this.hordeWarning = 1.4;
    this.emit({ type: "horde", x: p.x, y: p.y, radius });
  }
  private hordeKind(): EnemyKind {
    const pool = THREATS.filter(
      (t) =>
        threatWave(t, this.map) <= this.wave &&
        ["runner", "brute", "charger", "shielder"].includes(t.kind),
    ).map((t) => t.kind);
    const roll = this.random();
    if (!pool.length || roll < 0.6) return "grunt";
    if (roll < 0.85 && pool.includes("runner")) return "runner";
    return pool[pool.length - 1];
  }
  /** Anywhere in the arena, never on top of the player, sometimes behind them. */
  private pickSpawnPoint(behind: boolean): Vec {
    const p = this.player,
      facing =
        Math.hypot(p.vx, p.vy) > 1 ? Math.atan2(p.vy, p.vx) : p.angle,
      limit = 16.2;
    for (let attempt = 0; attempt < 6; attempt++) {
      const angle = behind
          ? facing + Math.PI + (this.random() - 0.5) * ((100 * Math.PI) / 180)
          : this.random() * Math.PI * 2,
        radius =
          SPAWN_DISTANCE.min +
          this.random() * (spawnDistanceMax(this.wave) - SPAWN_DISTANCE.min),
        point = {
          x: clamp(p.x + Math.cos(angle) * radius, -limit, limit),
          y: clamp(p.y + Math.sin(angle) * radius, -limit, limit),
        };
      if (distance(point, p) >= SPAWN_DISTANCE.min) return point;
    }
    // Corners: step toward the centre, which always stays inside the arena.
    const d = Math.hypot(p.x, p.y) || 1,
      ux = d > 0.5 ? -p.x / d : 1,
      uy = d > 0.5 ? -p.y / d : 0;
    return {
      x: clamp(p.x + ux * (SPAWN_DISTANCE.min + 0.5), -limit, limit),
      y: clamp(p.y + uy * (SPAWN_DISTANCE.min + 0.5), -limit, limit),
    };
  }
  private enqueueSpawn(
    kind: EnemyKind,
    point: Vec,
    delay: number,
    opts: { budgeted?: boolean; horde?: boolean } = {},
  ): void {
    const elite = kind !== "boss" && this.random() < this.eliteChance;
    const marker: SpawnMarker = {
      id: this.nextId++,
      kind,
      x: point.x,
      y: point.y,
      age: 0,
      delay,
      budgeted: !!opts.budgeted,
      elite,
      horde: !!opts.horde,
      radius: ENEMY_STATS[kind].radius * (elite ? ELITE.radius : 1),
    };
    this.spawnQueue.push(marker);
    if (marker.budgeted) this.spawnedCount++;
    this.emit({
      type: "spawnMark",
      x: marker.x,
      y: marker.y,
      id: marker.id,
      kind,
      radius: marker.radius,
      amount: delay,
    });
  }
  private activateSpawns(dt: number): void {
    const waiting: SpawnMarker[] = [];
    for (const marker of this.spawnQueue) {
      marker.age += dt;
      const cap = this.enemyCap + (marker.horde ? 10 : 0);
      if (marker.age < marker.delay || this.enemiesAlive >= cap) {
        waiting.push(marker);
        continue;
      }
      this.spawn(marker.kind, marker, {
        budgeted: marker.budgeted,
        elite: marker.elite,
        grace: 0.35,
        id: marker.id,
      });
    }
    this.spawnQueue = waiting;
  }

  private chooseEnemy(): EnemyKind {
    if (this.rule === "stampede" && this.random() < 0.22) return "runner";
    const unlocked = THREATS.filter(
        (t) => threatWave(t, this.map) <= this.wave,
      ),
      roll = this.random();
    if (!unlocked.length || roll < 0.4) return "grunt";
    const newest = unlocked[unlocked.length - 1];
    if (roll < 0.6) return newest.kind;
    return unlocked[Math.floor(this.random() * unlocked.length)].kind;
  }
  private spawn(
    kind: EnemyKind,
    position?: Vec,
    opts: {
      budgeted?: boolean;
      elite?: boolean;
      grace?: number;
      variant?: number;
      id?: number;
    } = {},
  ): void {
    let x = 0,
      y = -15.5;
    if (position) {
      x = position.x;
      y = position.y;
    } else if (kind !== "boss") {
      const point = this.pickSpawnPoint(false);
      x = point.x;
      y = point.y;
    }
    const definition = ENEMY_STATS[kind];
    const age = this.wave - 1,
      bossTier = Math.ceil(this.wave / this.bossInterval),
      // Boss health follows the campaign clock, not the boss count, so a
      // gauntlet's wave-30 boss matches a standard map's.
      bossPower = Math.max(0.25, this.wave / BOSS_INTERVAL);
    const scaledHp =
      kind === "boss"
        ? definition.hp *
          ENEMY_CURVE.bossBase *
          Math.pow(bossPower, ENEMY_CURVE.bossPower) *
          this.scaled("bossHp")
        : (definition.hp +
            (kind === "grunt" ? 24 : definition.hp) *
              (age * ENEMY_CURVE.hpLinear +
                age * age * ENEMY_CURVE.hpQuadratic)) *
          // Late chapters keep pace with rank VI and set capstones.
          (1 +
            Math.max(0, this.wave - ENEMY_CURVE.chapterStart) *
              ENEMY_CURVE.chapterHp) *
          this.scaled("hp");
    let hp =
      kind === "grunt"
        ? Math.max(scaledHp, Math.min(120, 50 + age * 36) * this.scaled("hp"))
        : scaledHp;
    if (opts.elite) hp *= ELITE.hp;
    const variant =
        kind === "boss" ? (opts.variant ?? (bossTier - 1) % 10) : 0,
      warded = kind === "boss" && this.rule === "wardedBosses",
      shield =
        kind === "shielder"
          ? hp * 0.75
          : kind === "boss"
            ? Math.max(
                [6, 8].includes(variant + 1) ? hp * 0.15 : 0,
                warded ? hp * 0.3 : 0,
              )
            : 0;
    const enemy: Enemy = {
      id: opts.id ?? this.nextId++,
      kind,
      x,
      y,
      hp,
      maxHp: hp,
      angle: 0,
      state: "recover",
      telegraph: 0,
      attackTimer: kind === "boss" ? 2 : 1.8 + this.random() * 2,
      stateTime: 0.5,
      radius: definition.radius * (opts.elite ? ELITE.radius : 1),
      vx: 0,
      vy: 0,
      hitTime: 0,
      knockX: 0,
      knockY: 0,
      dashHit: -1,
      burnTime: 0,
      burnDamage: 0,
      poisonTime: 0,
      poisonDamage: 0,
      poisonStacks: 0,
      slowTime: 0,
      slowFactor: 1,
      bossTier: kind === "boss" ? bossTier : 0,
      bossVariant: variant,
      attackCount: 0,
      statusTick: 0,
      spawnTime: opts.grace ?? 0.6,
      shield,
      maxShield: shield,
      healTimer: 2.5,
      budgeted: !!opts.budgeted,
      elite: !!opts.elite,
    };
    this.enemies.push(enemy);
    this.emit({
      type: "spawn",
      x,
      y,
      id: enemy.id,
      kind,
      radius: enemy.radius,
    });
  }

  private fire(weapon: Weapon, target: Enemy): void {
    const p = this.player,
      definition = WEAPONS[weapon.kind],
      spec = definition.pattern(weapon.level),
      damage =
        definition.damage *
        (definition.unique ? 1 : levelScale(weapon.level)) *
        (this.combatStats ?? this.stats).damage *
        (this.hero === "wisp"
          ? 0.75
          : this.hero === "reaper" && definition.range > 6
            ? 0.7
            : 1);
    if (spec.kind === "bullet" && spec.aimCluster) {
      // The densest cluster in reach, not the nearest straggler.
      let best = target,
        bestCount = -1;
      for (const enemy of this.enemies) {
        if (enemy.hp <= 0 || distance(enemy, p) > this.weaponReach(definition.range)) continue;
        const count = this.enemies.filter(
          (other) => other.hp > 0 && distance(other, enemy) < 5,
        ).length;
        if (count > bestCount) {
          bestCount = count;
          best = enemy;
        }
      }
      target = best;
    }
    const aim = Math.atan2(target.y - p.y, target.x - p.x);
    this.emit({
      type: "fire",
      ...p,
      angle: aim,
      weapon: weapon.kind,
      id: weapon.id,
      level: weapon.level,
      targetId: target.id,
    });
    switch (spec.kind) {
      case "bullet":
        this.fireBullets(weapon, spec, aim, damage);
        break;
      case "orbit":
        this.fireOrbit(weapon, spec, damage);
        break;
      case "strike":
        this.fireStrike(weapon, spec, target, damage);
        break;
      case "bolts":
        this.fireBolts(weapon, spec, damage);
        break;
      case "line":
        this.fireLine(
          weapon,
          { ...spec, reach: this.weaponReach(spec.reach) },
          aim,
          damage,
        );
        break;
      case "cone":
        this.fireCone(
          weapon,
          { ...spec, reach: this.weaponReach(spec.reach) },
          aim,
          damage,
        );
        break;
      case "chain":
        this.fireChain(
          weapon,
          {
            ...spec,
            jumps: spec.jumps + (this.hero === "volt" ? 1 : 0),
            reach: this.weaponReach(spec.reach),
          },
          target,
          damage,
        );
        break;
      case "melee":
        this.fireMelee(
          weapon,
          { ...spec, reach: this.weaponReach(spec.reach) },
          aim,
          damage,
        );
        break;
      default:
        this.fireMelee(
          weapon,
          {
            kind: "melee",
            reach: this.weaponReach(definition.range),
            knock: 1,
          },
          aim,
          damage,
        );
    }
  }
  private fireBullets(
    weapon: Weapon,
    spec: BulletSpec,
    aim: number,
    damage: number,
  ): void {
    if (spec.maxActive) {
      const active = this.bullets
        .filter((b) => b.ownerId === weapon.id && !b.child && b.life > 0)
        .sort((a, b) => b.age - a.age);
      for (let i = 0; i <= active.length - spec.maxActive; i++)
        active[i].life = 0;
    }
    for (let i = 0; i < spec.count; i++)
      this.spawnBullet(
        this.player,
        aim + (i - (spec.count - 1) / 2) * spec.spread,
        weapon.kind,
        damage,
        spec.speed,
        spec.life,
        spec.pierce,
        weapon.level,
        spec,
        weapon.id,
      );
  }
  private fireLine(
    weapon: Weapon,
    spec: LineSpec,
    aim: number,
    damage: number,
  ): void {
    const p = this.player,
      range = spec.reach;
    this.emit({
      type: "arc",
      ...p,
      targetX: p.x + Math.cos(aim) * range,
      targetY: p.y + Math.sin(aim) * range,
      weapon: weapon.kind,
      id: weapon.id,
      level: weapon.level,
    });
    for (const enemy of this.enemies) {
      const dx = enemy.x - p.x,
        dy = enemy.y - p.y,
        along = dx * Math.cos(aim) + dy * Math.sin(aim),
        across = Math.abs(-dx * Math.sin(aim) + dy * Math.cos(aim));
      if (along >= 0 && along < range && across < enemy.radius + 0.2)
        this.hitEnemy(enemy, damage, p, spec.knock, true, weapon.kind);
    }
  }
  private fireCone(
    weapon: Weapon,
    spec: ConeSpec,
    aim: number,
    damage: number,
  ): void {
    const p = this.player,
      radius = spec.reach;
    this.emit({
      type: "slash",
      ...p,
      angle: aim,
      radius,
      weapon: weapon.kind,
      id: weapon.id,
      level: weapon.level,
    });
    for (const enemy of this.enemies)
      if (
        distance(enemy, p) < radius + enemy.radius &&
        Math.cos(Math.atan2(enemy.y - p.y, enemy.x - p.x) - aim) > spec.arc
      )
        this.hitEnemy(enemy, damage, p, spec.knock, true, weapon.kind);
  }
  private fireChain(
    weapon: Weapon,
    spec: ChainSpec,
    target: Enemy,
    damage: number,
  ): void {
    let from: Vec = this.player,
      next: Enemy | undefined = target;
    const hit: number[] = [];
    for (let chain = 0; chain < spec.jumps; chain++) {
      if (!next) break;
      const enemy: Enemy = next;
      this.emit({
        type: "arc",
        x: from.x,
        y: from.y,
        targetX: enemy.x,
        targetY: enemy.y,
        targetId: enemy.id,
        weapon: weapon.kind,
        id: weapon.id,
        level: weapon.level,
      });
      hit.push(enemy.id);
      this.hitEnemy(
        enemy,
        damage * Math.pow(spec.falloff, chain),
        from,
        spec.knock,
        true,
        weapon.kind,
      );
      from = { x: enemy.x, y: enemy.y };
      next = this.nearest(from, spec.reach, hit);
    }
  }
  private fireMelee(
    weapon: Weapon,
    spec: MeleeSpec,
    aim: number,
    damage: number,
  ): void {
    const p = this.player,
      radius = spec.reach;
    this.emit({
      type: "slash",
      ...p,
      angle: aim,
      radius,
      weapon: weapon.kind,
      id: weapon.id,
      level: weapon.level,
    });
    for (const enemy of this.enemies)
      if (distance(enemy, p) < radius + enemy.radius && enemy.hp > 0) {
        if (spec.arc !== undefined) {
          const angle = Math.atan2(enemy.y - p.y, enemy.x - p.x) - aim;
          if (Math.cos(angle) < spec.arc) continue;
        }
        this.hitEnemy(enemy, damage, p, spec.knock, true, weapon.kind);
      }
  }
  private fireOrbit(weapon: Weapon, spec: OrbitSpec, damage: number): void {
    for (const bullet of this.bullets)
      if (bullet.ownerId === weapon.id && bullet.behavior?.orbit) bullet.life = 0;
    for (let i = 0; i < spec.count; i++) {
      const angle = this.time * spec.angular + (i / spec.count) * Math.PI * 2;
      this.spawnBullet(
        this.player,
        angle,
        weapon.kind,
        damage,
        0,
        spec.life,
        999,
        weapon.level,
        {
          kind: "bullet",
          count: spec.count,
          spread: 0,
          speed: 0,
          life: spec.life,
          pierce: 999,
          radius: 0.42,
          knock: 1.2,
          orbit: { radius: spec.radius, angular: spec.angular, rearm: spec.rearm },
        },
        weapon.id,
      );
      const bullet = this.bullets[this.bullets.length - 1];
      bullet.orbitAngle = angle;
      bullet.rearmAt = spec.rearm;
      bullet.x = this.player.x + Math.cos(angle) * spec.radius;
      bullet.y = this.player.y + Math.sin(angle) * spec.radius;
    }
  }
  private fireStrike(
    weapon: Weapon,
    spec: StrikeSpec,
    target: Enemy,
    damage: number,
  ): void {
    const targets: Enemy[] = [target];
    if (spec.shells > 1) {
      const next = this.nearest(
        this.player,
        this.weaponReach(WEAPONS[weapon.kind].range),
        [target.id],
      );
      if (next) targets.push(next);
    }
    for (const enemy of targets) {
      const point = {
        x: enemy.x + enemy.vx * spec.delay * 0.5,
        y: enemy.y + enemy.vy * spec.delay * 0.5,
      };
      this.emit({
        type: "strike",
        x: this.player.x,
        y: this.player.y,
        targetX: point.x,
        targetY: point.y,
        weapon: weapon.kind,
        id: weapon.id,
        amount: spec.delay,
        radius: spec.radius,
        level: weapon.level,
      });
      this.addHazard(point, spec.radius, damage, "blast", spec.delay, {
        owner: "player",
        weapon: weapon.kind,
        knock: spec.knock,
      });
    }
  }
  private fireBolts(weapon: Weapon, spec: BoltsSpec, damage: number): void {
    const p = this.player,
      reach = this.weaponReach(WEAPONS[weapon.kind].range),
      targets = this.enemies
        .filter((enemy) => enemy.hp > 0 && distance(enemy, p) <= reach)
        .sort((a, b) => sqDistance(a, p) - sqDistance(b, p))
        .slice(0, spec.targets);
    for (const enemy of targets) {
      this.emit({
        type: "arc",
        x: enemy.x,
        y: enemy.y - 7,
        targetX: enemy.x,
        targetY: enemy.y,
        targetId: enemy.id,
        weapon: weapon.kind,
        id: weapon.id,
        level: weapon.level,
      });
      this.emit({
        type: "explosion",
        x: enemy.x,
        y: enemy.y,
        radius: spec.splash,
        weapon: weapon.kind,
      });
      for (const other of this.enemies)
        if (other.hp > 0 && distance(other, enemy) < spec.splash + other.radius)
          this.hitEnemy(other, damage, enemy, spec.knock, true, weapon.kind);
    }
  }
  private spawnBullet(
    origin: Vec,
    angle: number,
    weapon: WeaponId | "enemy",
    damage: number,
    speed: number,
    life: number,
    pierce: number,
    level: number,
    behavior?: BulletSpec,
    ownerId?: number,
    child = false,
  ): void {
    this.bullets.push({
      id: this.nextId++,
      x: origin.x + Math.cos(angle) * 0.45,
      y: origin.y + Math.sin(angle) * 0.45,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      enemy: weapon === "enemy",
      weapon,
      damage,
      radius: behavior?.radius ?? (weapon === "enemy" ? 0.22 : 0.12),
      life,
      angle,
      pierce:
        pierce +
        (weapon === "enemy"
          ? 0
          : (this.combatStats ?? this.stats).pierce +
            Math.floor((this.combatStats ?? this.stats).pierceMod)),
      hitIds: [],
      level,
      age: 0,
      grazed: false,
      returning: false,
      behavior,
      ownerId,
      timer: 0,
      bounces:
        (behavior?.bounces ?? 0) +
        (weapon === "enemy" || child
          ? 0
          : Math.min(6, Math.floor((this.combatStats ?? this.stats).ricochet))),
      splits:
        weapon === "enemy" || child || behavior?.noContact
          ? 0
          : Math.min(6, Math.floor((this.combatStats ?? this.stats).split)),
      child,
      orbitAngle: 0,
      rearmAt: 0,
      emitTimer: behavior?.emit?.every ?? 0,
      trailTimer: 0,
      source: weapon === "enemy" ? (origin as { kind?: EnemyKind }).kind : undefined,
    });
  }
  /** Fragments and wasps: child bullets that never split again. */
  private burst(bullet: Bullet, children: BulletChildren, aim: number): void {
    this.emit({
      type: "burst",
      x: bullet.x,
      y: bullet.y,
      weapon: bullet.weapon,
      amount: children.count,
      angle: aim,
      radius: children.radial ? 1 : 0,
    });
    for (let i = 0; i < children.count; i++) {
      const angle = children.radial
        ? aim + (i / children.count) * Math.PI * 2
        : aim + (i - (children.count - 1) / 2) * 0.35;
      this.spawnBullet(
        bullet,
        angle,
        bullet.weapon,
        bullet.damage * children.damage,
        children.speed,
        children.life,
        children.pierce,
        bullet.level,
        {
          kind: "bullet",
          count: 1,
          spread: 0,
          speed: children.speed,
          life: children.life,
          pierce: children.pierce,
          radius: 0.12,
          homing: children.homing,
        },
        bullet.ownerId,
        true,
      );
    }
  }

  private moveDrones(dt: number): void {
    const stats = this.combatStats ?? this.stats;
    for (let index = 0; index < this.drones.length; index++) {
      const drone = this.drones[index],
        definition = ITEMS[drone.kind].drone!;
      const angle =
          this.time * (definition.attack === "orbit" ? 1.8 : 0.35) +
          (index * Math.PI * 2) / Math.max(1, this.drones.length),
        radius = definition.attack === "orbit" ? 2.9 : 1.8;
      drone.x = this.player.x + Math.cos(angle) * radius;
      drone.y = this.player.y + Math.sin(angle) * radius;
      drone.angle = angle;
      drone.cooldown -= dt;
      drone.pulse = Math.max(0, drone.pulse - dt);
      if (drone.cooldown > 0) continue;
      const power =
          definition.damage *
          rankScale(drone.level) *
          stats.damage *
          stats.droneDamage *
          (this.hero === "wisp" ? 1.4 : 1),
        target = this.nearest(drone, this.reach(definition.range));
      if (definition.attack === "guard") {
        this.player.barrier = Math.min(2, this.player.barrier + 1);
        drone.pulse = 0.35;
        this.emit({
          type: "barrier",
          x: this.player.x,
          y: this.player.y,
          id: drone.id,
          amount: this.player.barrier,
        });
      } else if (definition.attack === "repair") {
        if (this.player.hp < this.player.maxHp) {
          this.player.hp = Math.min(
            this.player.maxHp,
            this.player.hp + definition.damage * rankScale(drone.level),
          );
          drone.pulse = 0.35;
          this.emit({
            type: "pickup",
            x: drone.x,
            y: drone.y,
            id: drone.id,
            amount: definition.damage * rankScale(drone.level),
          });
        }
      } else if (definition.attack === "magnet") {
        for (const pickup of this.pickups)
          if (distance(pickup, drone) < 3) pickup.age = 20;
      } else if (!target) continue;
      else if (definition.attack === "flame") {
        const aim = Math.atan2(target.y - drone.y, target.x - drone.x),
          reach = this.reach(definition.range);
        drone.aimAngle = aim;
        this.emit({ type: "slash", x: drone.x, y: drone.y, id: drone.id, weapon: "flame", radius: reach, angle: aim, level: drone.level });
        for (const enemy of this.enemies)
          if (
            enemy.hp > 0 &&
            distance(enemy, drone) < reach + enemy.radius &&
            Math.cos(Math.atan2(enemy.y - drone.y, enemy.x - drone.x) - aim) > 0.78
          )
            this.hitEnemy(enemy, power, drone, 0.4, true, "flame");
      } else if (definition.attack === "pulse") {
        const reach = this.reach(definition.range);
        this.emit({ type: "slash", x: drone.x, y: drone.y, id: drone.id, weapon: "frostgun", radius: reach, angle, level: drone.level });
        for (const enemy of this.enemies)
          if (enemy.hp > 0 && distance(enemy, drone) < reach + enemy.radius)
            this.hitEnemy(enemy, power, drone, 1, true, "frostgun");
      } else if (definition.attack === "strike") {
        let farthest = target,
          far = 0;
        const reach = this.reach(definition.range);
        for (const enemy of this.enemies) {
          const d = distance(enemy, drone);
          if (enemy.hp > 0 && d <= reach && d > far) {
            far = d;
            farthest = enemy;
          }
        }
        drone.aimAngle = Math.atan2(farthest.y - drone.y, farthest.x - drone.x);
        this.emit({
          type: "strike",
          x: drone.x,
          y: drone.y,
          targetX: farthest.x,
          targetY: farthest.y,
          weapon: "mortar",
          id: drone.id,
          amount: 0.8,
          radius: 2,
          level: drone.level,
        });
        this.addHazard(farthest, 2, power, "blast", 0.8, { owner: "player", weapon: "rocket", knock: 4 });
      } else if (definition.attack === "spray") {
        drone.aimAngle = Math.atan2(target.y - drone.y, target.x - drone.x);
        this.emit({
          type: "strike",
          x: drone.x,
          y: drone.y,
          targetX: target.x,
          targetY: target.y,
          weapon: "needle",
          id: drone.id,
          amount: 0,
          radius: 1.6,
          level: drone.level,
        });
        this.addHazard(target, 1.6, power, "toxic", 0, { owner: "player", weapon: "needle", duration: 4, tickRate: 0.25, knock: 0 });
      } else if (definition.attack === "gun") {
        const aim = Math.atan2(target.y - drone.y, target.x - drone.x);
        drone.aimAngle = aim;
        this.spawnBullet(drone, aim, "pistol", power, 24, 0.7, 1, drone.level, undefined, drone.id);
        this.emit({
          type: "fire",
          x: drone.x,
          y: drone.y,
          id: drone.id,
          weapon: "pistol",
          angle: aim,
          level: drone.level,
        });
      } else if (definition.attack === "orbit") {
        this.hitEnemy(target, power, drone, 2, true, "blade");
        this.emit({
          type: "slash",
          x: drone.x,
          y: drone.y,
          id: drone.id,
          weapon: "blade",
          radius: definition.range,
          angle,
          level: drone.level,
        });
      } else if (definition.attack === "shock") {
        drone.aimAngle = Math.atan2(target.y - drone.y, target.x - drone.x);
        let origin: Vec = drone,
          next: Enemy | undefined = target;
        const hit: number[] = [];
        for (let i = 0; i < 3 && next; i++) {
          const enemy: Enemy = next;
          hit.push(enemy.id);
          this.emit({
            type: "arc",
            x: origin.x,
            y: origin.y,
            id: drone.id,
            targetX: enemy.x,
            targetY: enemy.y,
            weapon: "arc",
            level: drone.level,
          });
          this.hitEnemy(
            enemy,
            power * Math.pow(0.85, i),
            origin,
            0.3,
            true,
            "arc",
          );
          origin = enemy;
          next = this.nearest(enemy, 4.5, hit);
        }
      }
      drone.pulse = 0.2;
      drone.cooldown =
        definition.cooldown /
        (this.player.abilityTime > 0 && this.hero === "wisp" ? 3 : 1) /
        (this.hero === "wisp" ? 1.5 : 1) /
        // Each drone after the second fires slower, so a bag of drones does
        // not add up to a wall of fire.
        droneStackRate(index) /
        (definition.attack === "repair" || definition.attack === "guard"
          ? 1
          : stats.attackSpeed * stats.droneRate);
    }
  }
  private addHazard(
    origin: Vec,
    radius: number,
    damage: number,
    kind: "blast" | "toxic",
    delay = 0.9,
    opts: {
      owner?: "player";
      weapon?: WeaponId;
      knock?: number;
      duration?: number;
      tickRate?: number;
    } = {},
  ): void {
    this.hazards.push({
      id: this.nextId++,
      x: origin.x,
      y: origin.y,
      radius,
      damage,
      kind,
      delay,
      age: 0,
      duration: opts.duration ?? (kind === "toxic" ? 4 : 0.18),
      triggered: false,
      tick: 0,
      owner: opts.owner,
      weapon: opts.weapon,
      knock: opts.knock,
      tickRate: opts.tickRate,
    });
  }
  private moveHazards(dt: number): void {
    for (const hazard of this.hazards) {
      hazard.age += dt;
      if (hazard.age < hazard.delay) continue;
      if (!hazard.triggered) {
        hazard.triggered = true;
        this.emit({
          type: "explosion",
          x: hazard.x,
          y: hazard.y,
          radius: hazard.radius,
          enemy: !hazard.owner,
          weapon: hazard.owner ? hazard.weapon : "enemy",
        });
      }
      hazard.tick -= dt;
      if (hazard.tick <= 0) {
        if (hazard.owner === "player") {
          for (const enemy of this.enemies)
            if (enemy.hp > 0 && distance(hazard, enemy) < hazard.radius + enemy.radius)
              this.hitEnemy(enemy, hazard.damage, hazard, hazard.knock ?? 1, true, hazard.weapon);
        } else if (
          distance(hazard, this.player) <
          hazard.radius + this.player.radius
        )
          this.hurtPlayer(hazard.damage, hazard);
        hazard.tick = hazard.tickRate ?? (hazard.kind === "toxic" ? 1 : 99);
      }
    }
    this.hazards = this.hazards.filter((h) => h.age < h.delay + h.duration);
  }
  private moveEnemies(dt: number): void {
    const p = this.player;
    for (const enemy of this.enemies) {
      if (enemy.hp <= 0) continue;
      enemy.spawnTime = Math.max(0, enemy.spawnTime - dt);
      enemy.statusTick += dt;
      if (enemy.statusTick >= 0.25) {
        enemy.statusTick -= 0.25;
        if (enemy.burnTime > 0)
          this.hitEnemy(
            enemy,
            enemy.burnDamage * 0.25,
            enemy,
            0,
            false,
            enemy.lastWeapon,
            "burn",
          );
        if (enemy.poisonTime > 0)
          this.hitEnemy(
            enemy,
            enemy.poisonDamage * enemy.poisonStacks * 0.25,
            enemy,
            0,
            false,
            enemy.lastWeapon,
            "poison",
          );
      }
      enemy.burnTime = Math.max(0, enemy.burnTime - dt);
      enemy.poisonTime = Math.max(0, enemy.poisonTime - dt);
      enemy.slowTime = Math.max(0, enemy.slowTime - dt);
      if (enemy.poisonTime <= 0) enemy.poisonStacks = 0;
      if (enemy.slowTime <= 0) enemy.slowFactor = 1;
      if (enemy.freezeTime) enemy.freezeTime = Math.max(0, enemy.freezeTime - dt);
      if (enemy.hp <= 0) continue;
      const def = ENEMY_STATS[enemy.kind],
        dx = p.x - enemy.x,
        dy = p.y - enemy.y,
        d = Math.hypot(dx, dy) || 0.001;
      enemy.hitTime = Math.max(0, enemy.hitTime - dt);
      enemy.attackTimer -= dt;
      enemy.stateTime -= dt;
      enemy.healTimer -= dt;
      if (enemy.kind === "medic" && enemy.healTimer <= 0) {
        enemy.healTimer = 3;
        for (const ally of this.enemies)
          if (
            ally.id !== enemy.id &&
            ally.hp > 0 &&
            (ally.repairLockUntil ?? 0) <= this.time &&
            distance(ally, enemy) < 5
          ) {
            // A medic's output scales with its own hardware. Scaling repairs
            // only with a boss's huge pool can out-heal an otherwise viable build.
            const amount = Math.min(
              ally.maxHp * 0.08,
              enemy.maxHp * 0.22,
              ally.maxHp - ally.hp,
            );
            ally.hp += amount;
            if (amount > 0) {
              // A target can absorb one repair pulse per cycle, even if a
              // support pack overlaps. More medics widen coverage, not healing.
              ally.repairLockUntil = this.time + 3;
              this.emit({
                type: "heal",
                x: ally.x,
                y: ally.y,
                id: ally.id,
                amount,
                radius: 5,
                kind: "medic",
              });
            }
          }
      }
      if (
        enemy.kind === "shielder" &&
        enemy.shield <= 0 &&
        enemy.healTimer <= 0
      ) {
        enemy.shield = enemy.maxShield * 0.35;
        enemy.healTimer = 8;
      }
      const bonus = this.tuning.speedBonus;
      let speed =
          def.speed *
          (1 +
            Math.min(
              ENEMY_CURVE.speedCap + bonus,
              (this.wave - 1) * ENEMY_CURVE.speedPerWave + bonus,
            )) *
          enemy.slowFactor *
          (enemy.elite ? ELITE.speed : 1) *
          (enemy.freezeTime ? 0 : 1),
        mx = dx / d,
        my = dy / d;
      if (enemy.kind === "grunt" && this.wave >= 2) {
        // A broad, committed approach arc closes from different angles instead
        // of feeding every enemy directly down the same firing lane.
        const flank =
          Math.sin(enemy.id * 2.39996) * 0.9 * clamp((d - 3) / 7, 0, 1);
        const length = Math.hypot(1, flank);
        mx = (dx / d - (dy / d) * flank) / length;
        my = (dy / d + (dx / d) * flank) / length;
      }
      if (enemy.state === "walk") {
        const desired = Math.atan2(dy, dx);
        enemy.angle +=
          Math.atan2(
            Math.sin(desired - enemy.angle),
            Math.cos(desired - enemy.angle),
          ) *
          (1 - Math.exp(-dt * 12));
        if (enemy.kind === "shooter") speed *= clamp((d - 13.8) / 2.5, -0.6, 1);
        if (enemy.kind === "sniper") speed *= clamp((d - 16) / 3, -0.65, 1);
        if (enemy.kind === "medic") speed *= clamp((d - 9) / 3, -0.5, 1);
        const attack =
          ["shooter", "charger", "boss", "bomber", "sniper"].includes(
            enemy.kind,
          ) &&
          enemy.attackTimer <= 0 &&
          d <
            (enemy.kind === "bomber"
              ? 3
              : enemy.kind === "charger"
                ? 13
                : 40) &&
          enemy.spawnTime <= 0;
        if (attack) {
          enemy.state = "windup";
          enemy.stateTime =
            enemy.kind === "boss"
              ? 1.1
              : enemy.kind === "sniper"
                ? 1.6
                : enemy.kind === "bomber"
                  ? 0.95
                  : 0.8;
          enemy.telegraph = 0;
          this.emit({
            type: "telegraph",
            x: enemy.x,
            y: enemy.y,
            id: enemy.id,
            kind: enemy.kind,
            angle: enemy.angle,
            radius: enemy.kind === "bomber" ? 3.2 : 0,
            enemy: true,
          });
        }
      }
      if (enemy.state === "windup") {
        speed = 0;
        const duration =
          enemy.kind === "boss"
            ? 1.1
            : enemy.kind === "sniper"
              ? 1.6
              : enemy.kind === "bomber"
                ? 0.95
                : 0.8;
        enemy.telegraph = clamp(1 - enemy.stateTime / duration, 0, 1);
        if (enemy.stateTime <= 0) {
          enemy.telegraph = 0;
          if (enemy.kind === "bomber") {
            this.addHazard(
              enemy,
              3.2,
              def.damage * this.enemyDamageScale(),
              "blast",
              0,
            );
            enemy.hp = 0;
            continue;
          }
          const bossCharge =
            enemy.kind === "boss" &&
            [1, 9].includes(enemy.bossVariant) &&
            enemy.attackCount % 3 === 0;
          if (enemy.kind === "charger" || bossCharge) {
            enemy.state = "charge";
            enemy.stateTime = enemy.kind === "boss" ? 0.75 : 0.85;
            enemy.attackCount++;
          } else {
            if (enemy.kind === "boss") this.bossAttack(enemy);
            else {
              this.spawnBullet(
                enemy,
                enemy.angle,
                "enemy",
                def.damage * this.enemyDamageScale(),
                enemy.kind === "sniper"
                  ? ENEMY_CURVE.sniperBulletSpeed +
                    Math.min(
                      ENEMY_CURVE.sniperBulletSpeedBonusCap,
                      Math.max(0, this.wave - 28) *
                        ENEMY_CURVE.sniperBulletSpeedPerWave,
                    )
                  : ENEMY_CURVE.shooterBulletSpeed +
                    Math.min(
                      ENEMY_CURVE.shooterBulletSpeedBonusCap,
                      Math.max(0, this.wave - 10) *
                        ENEMY_CURVE.shooterBulletSpeedPerWave,
                    ),
                5,
                enemy.kind === "sniper" ? 3 : 1,
                1,
              );
              this.emit({
                type: "fire",
                x: enemy.x,
                y: enemy.y,
                id: enemy.id,
                kind: enemy.kind,
                weapon: "enemy",
                angle: enemy.angle,
                enemy: true,
              });
            }
            enemy.state = "recover";
            enemy.stateTime = enemy.kind === "boss" ? 0.8 : 0.5;
          }
        }
      } else if (enemy.state === "charge") {
        speed =
          (enemy.kind === "boss"
            ? 8.5
            : ENEMY_CURVE.chargerSpeed +
              Math.min(
                ENEMY_CURVE.chargerSpeedBonusCap,
                Math.max(0, this.wave - 13) * ENEMY_CURVE.chargerSpeedPerWave,
              )) *
          enemy.slowFactor *
          (enemy.freezeTime ? 0 : 1);
        mx = Math.cos(enemy.angle);
        my = Math.sin(enemy.angle);
        if (enemy.stateTime <= 0) {
          enemy.state = "recover";
          enemy.stateTime = 1.1;
          speed = 0;
        }
      } else if (enemy.state === "recover") {
        speed = 0;
        if (enemy.stateTime <= 0) {
          enemy.state = "walk";
          enemy.attackTimer =
            enemy.kind === "boss"
              ? 2.2
              : enemy.kind === "sniper"
                ? 3.5
                : Math.max(
                    ENEMY_CURVE.shooterIntervalFloor,
                    ENEMY_CURVE.shooterInterval -
                      Math.max(0, this.wave - 10) *
                        ENEMY_CURVE.shooterIntervalPerWave,
                  );
        }
      }
      const accel = 1 - Math.exp(-dt * (enemy.state === "charge" ? 20 : 10));
      enemy.vx += (mx * speed + enemy.knockX - enemy.vx) * accel;
      enemy.vy += (my * speed + enemy.knockY - enemy.vy) * accel;
      enemy.x = clamp(enemy.x + enemy.vx * dt, -17.6, 17.6);
      enemy.y = clamp(enemy.y + enemy.vy * dt, -17.6, 17.6);
      enemy.knockX *= Math.exp(-dt * 11);
      enemy.knockY *= Math.exp(-dt * 11);
      if (
        this.hero === "bastion" &&
        p.dashTime > 0 &&
        d < enemy.radius + 1.1 &&
        enemy.dashHit !== this.dashNumber
      ) {
        enemy.dashHit = this.dashNumber;
        this.hitEnemy(
          enemy,
          85 * (this.combatStats ?? this.stats).damage,
          p,
          9,
        );
      }
      if (
        enemy.hp > 0 &&
        enemy.spawnTime <= 0 &&
        distance(enemy, p) < enemy.radius + p.radius
      ) {
        const before = p.hurtTime;
        this.hurtPlayer(def.damage * this.enemyDamageScale(), enemy);
        const thorns = Math.floor((this.combatStats ?? this.stats).thorns);
        if (thorns > 0 && before <= 0 && p.hurtTime > 0) {
          const stats = this.combatStats ?? this.stats;
          enemy.poisonTime = 3;
          enemy.poisonDamage = Math.max(
            enemy.poisonDamage,
            Math.max(4, stats.poisonDamage) * stats.damage,
          );
          enemy.poisonStacks = Math.min(
            stats.poisonStacks,
            enemy.poisonStacks + thorns,
          );
          enemy.lastWeapon ??= "needle";
        }
        if (p.dashTime <= 0) {
          const overlap = enemy.radius + p.radius - distance(enemy, p);
          enemy.x -= mx * overlap * 0.5;
          enemy.y -= my * overlap * 0.5;
        }
      }
    }
    for (let i = 0; i < this.enemies.length; i++)
      for (let j = i + 1; j < this.enemies.length; j++) {
        const a = this.enemies[i],
          b = this.enemies[j];
        if (a.hp <= 0 || b.hp <= 0) continue;
        const dx = a.x - b.x,
          dy = a.y - b.y,
          d = Math.hypot(dx, dy),
          min = (a.radius + b.radius) * 0.82;
        if (d > 0.001 && d < min) {
          const push = (min - d) * 0.12,
            px = (dx / d) * push,
            py = (dy / d) * push;
          if (a.kind !== "boss") {
            a.x += px;
            a.y += py;
          }
          if (b.kind !== "boss") {
            b.x -= px;
            b.y -= py;
          }
        }
      }
  }
  private bossAttack(enemy: Enemy): void {
    const variant = enemy.bossVariant,
      count = enemy.attackCount++,
      damage = ENEMY_STATS.boss.damage * this.enemyDamageScale(),
      enraged = enemy.hp < enemy.maxHp * 0.5;
    if (variant === 2 || variant === 6 || (variant === 9 && count % 3 === 1)) {
      const toxic = variant === 6;
      for (let i = 0; i < 3; i++) {
        const angle = (i * Math.PI * 2) / 3;
        this.addHazard(
          {
            x: clamp(this.player.x + Math.cos(angle) * (i ? 3 : 0), -15, 15),
            y: clamp(this.player.y + Math.sin(angle) * (i ? 3 : 0), -15, 15),
          },
          toxic ? 2.8 : 2.2,
          damage * (toxic ? 0.4 : 1),
          toxic ? "toxic" : "blast",
          1.1,
        );
      }
    }
    if (variant === 4 && this.enemies.length < 55) {
      for (let i = 0; i < 2; i++)
        this.spawn(this.threatUnlocked("splitter") ? "splitter" : "grunt", {
          x: enemy.x + (i ? 2 : -2),
          y: enemy.y + 1,
        });
    }
    if (
      (variant === 5 || variant === 7 || this.rule === "wardedBosses") &&
      count % 3 === 0
    ) {
      enemy.shield = Math.max(enemy.shield, enemy.maxShield * 0.3);
    }
    if (variant === 7) {
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2;
        this.addHazard(
          {
            x: this.player.x + Math.cos(a) * 3,
            y: this.player.y + Math.sin(a) * 3,
          },
          1.6,
          damage,
          "blast",
          1.2,
        );
      }
    }
    if (variant === 8) {
      const heal = Math.min(enemy.maxHp * 0.012, enemy.maxHp - enemy.hp);
      enemy.hp += heal;
      this.emit({
        type: "heal",
        x: enemy.x,
        y: enemy.y,
        id: enemy.id,
        amount: heal,
        radius: 5,
        kind: "boss",
      });
      if (count % 3 === 0 && this.enemies.length < 55)
        this.spawn("medic", { x: enemy.x + 2, y: enemy.y + 1 });
    }
    const fan = [1, 3, 8, 9].includes(variant) && count % 2 === 0,
      shots = fan ? 7 : 10 + Math.min(6, enemy.bossTier) + (enraged ? 4 : 0);
    for (let i = 0; i < shots; i++)
      this.spawnBullet(
        enemy,
        enemy.angle +
          (fan
            ? (i - (shots - 1) / 2) * 0.15
            : (i / shots) * Math.PI * 2 + count * 0.16),
        "enemy",
        damage,
        fan ? 8 : enraged ? 6 : 5,
        5,
        1,
        1,
      );
    this.emit({
      type: "fire",
      x: enemy.x,
      y: enemy.y,
      id: enemy.id,
      kind: "boss",
      weapon: "enemy",
      enemy: true,
      angle: enemy.angle,
    });
  }
  private steer(bullet: Bullet, rate: number, dt: number): void {
    const target = this.nearest(bullet, 9, bullet.hitIds);
    if (!target) return;
    const speed = Math.hypot(bullet.vx, bullet.vy);
    if (speed < 0.01) return;
    const desired = Math.atan2(target.y - bullet.y, target.x - bullet.x),
      current = Math.atan2(bullet.vy, bullet.vx),
      delta = Math.atan2(Math.sin(desired - current), Math.cos(desired - current)),
      turn = clamp(delta, -rate * dt, rate * dt),
      angle = current + turn;
    bullet.vx = Math.cos(angle) * speed;
    bullet.vy = Math.sin(angle) * speed;
    bullet.angle = angle;
  }
  /** Detonate a splash bullet at its position; returns true if it exploded. */
  private detonate(bullet: Bullet): boolean {
    const b = bullet.behavior;
    if (!b?.splash) return false;
    this.emit({ type: "explosion", ...bullet, source: undefined, radius: b.splash, weapon: bullet.weapon });
    for (const target of this.enemies)
      if (target.hp > 0 && distance(bullet, target) < b.splash + target.radius)
        this.hitEnemy(
          target,
          bullet.damage,
          bullet,
          b.knock ?? 6,
          true,
          bullet.weapon as WeaponId,
        );
    if (b.bolts)
      for (const target of this.enemies)
        if (target.hp > 0 && distance(bullet, target) < b.bolts.reach) {
          this.emit({
            type: "arc",
            x: bullet.x,
            y: bullet.y,
            targetX: target.x,
            targetY: target.y,
            targetId: target.id,
            weapon: bullet.weapon,
          });
          this.hitEnemy(
            target,
            bullet.damage * b.bolts.damage,
            bullet,
            2,
            true,
            bullet.weapon as WeaponId,
          );
        }
    return true;
  }
  private moveBullets(dt: number): void {
    const stats = this.combatStats ?? this.stats;
    for (const bullet of this.bullets) {
      bullet.age += dt;
      const b = bullet.behavior;
      if (b?.returning && bullet.age >= 0.6) {
        if (!bullet.returning) {
          bullet.returning = true;
          bullet.hitIds = [];
        }
        const dx = this.player.x - bullet.x,
          dy = this.player.y - bullet.y,
          d = Math.hypot(dx, dy) || 1;
        bullet.vx = (dx / d) * 19;
        bullet.vy = (dy / d) * 19;
        bullet.angle = Math.atan2(dy, dx);
        if (d < 0.7) bullet.life = 0;
      }
      if (b?.orbit) {
        bullet.orbitAngle = (bullet.orbitAngle ?? 0) + b.orbit.angular * dt;
        bullet.x = this.player.x + Math.cos(bullet.orbitAngle) * b.orbit.radius;
        bullet.y = this.player.y + Math.sin(bullet.orbitAngle) * b.orbit.radius;
        bullet.angle = bullet.orbitAngle + Math.PI / 2;
        if (bullet.age >= (bullet.rearmAt ?? 0)) {
          bullet.hitIds = [];
          bullet.rearmAt = bullet.age + b.orbit.rearm;
        }
      }
      if (b?.grow) bullet.radius += b.grow * dt;
      if (!bullet.enemy) {
        const homing = Math.max(b?.homing ?? 0, bullet.child ? 0 : stats.homing);
        if (homing > 0 && !b?.stationary && !bullet.fused)
          this.steer(bullet, homing, dt);
      }
      if (b?.fuse && !bullet.fused && bullet.age >= b.fuse) {
        bullet.fused = true;
        if (b.children) {
          this.burst(bullet, b.children, bullet.angle);
          bullet.life = 0;
          continue;
        }
        bullet.vx = 0;
        bullet.vy = 0;
        bullet.timer = b.pull?.duration ?? 0;
        if (b.pull) this.emit({ type: "pull", ...bullet, source: undefined, radius: b.pull.radius, weapon: bullet.weapon });
      }
      if (bullet.fused && b?.pull) {
        for (const enemy of this.enemies) {
          if (enemy.hp <= 0) continue;
          const dx = bullet.x - enemy.x,
            dy = bullet.y - enemy.y,
            d = Math.hypot(dx, dy);
          if (d < b.pull.radius && d > 0.3) {
            const weight = enemy.kind === "boss" ? 0.04 : enemy.kind === "brute" ? 0.35 : 1;
            enemy.knockX += (dx / d) * b.pull.force * dt * weight * 3;
            enemy.knockY += (dy / d) * b.pull.force * dt * weight * 3;
          }
        }
        bullet.timer = (bullet.timer ?? 0) - dt;
        if (bullet.timer <= 0) {
          this.detonate(bullet);
          bullet.life = 0;
          continue;
        }
      }
      // A crushing orb only crushes once it has stopped and started pulling.
      if (b?.emit && !bullet.enemy && !(b.emit.kind === "crush" && b.pull && !bullet.fused)) {
        bullet.emitTimer = (bullet.emitTimer ?? b.emit.every) - dt;
        if (bullet.emitTimer <= 0) {
          bullet.emitTimer += b.emit.every;
          const amount = bullet.damage * b.emit.damage;
          if (b.emit.kind === "crush") {
            this.emit({
              type: "crush",
              x: bullet.x,
              y: bullet.y,
              radius: b.emit.reach,
              weapon: bullet.weapon,
              id: bullet.id,
            });
            for (const enemy of this.enemies)
              if (enemy.hp > 0 && distance(enemy, bullet) < b.emit.reach + enemy.radius)
                this.hitEnemy(enemy, amount, bullet, 0, true, bullet.weapon as WeaponId);
          } else {
            const target = this.nearest(bullet, b.emit.reach);
            if (target) {
              const aim = Math.atan2(target.y - bullet.y, target.x - bullet.x);
              bullet.angle = b.stationary ? aim : bullet.angle;
              if (b.emit.kind === "zap") {
                this.emit({
                  type: "arc",
                  x: bullet.x,
                  y: bullet.y,
                  targetX: target.x,
                  targetY: target.y,
                  targetId: target.id,
                  weapon: bullet.weapon,
                });
                this.hitEnemy(target, amount, bullet, 0.3, true, bullet.weapon as WeaponId);
              } else {
                this.emit({
                  type: "fire",
                  x: bullet.x,
                  y: bullet.y,
                  angle: aim,
                  weapon: bullet.weapon,
                  id: bullet.ownerId,
                  level: bullet.level,
                  source: bullet.id,
                });
                this.spawnBullet(
                  bullet,
                  aim,
                  bullet.weapon,
                  amount,
                  24,
                  0.6,
                  1,
                  bullet.level,
                  undefined,
                  bullet.ownerId,
                  true,
                );
              }
            }
          }
        }
      }
      if (b?.trail && !bullet.enemy) {
        bullet.trailTimer = (bullet.trailTimer ?? 0) - dt;
        if (bullet.trailTimer <= 0) {
          bullet.trailTimer += b.trail.every;
          this.addHazard(bullet, b.trail.radius, bullet.damage * b.trail.damage, "blast", 0, {
            owner: "player",
            weapon: bullet.weapon as WeaponId,
            duration: b.trail.duration,
            tickRate: 0.25,
            knock: 0,
          });
        }
      }
      if (!b?.stationary && !b?.orbit) {
        bullet.x += bullet.vx * dt;
        bullet.y += bullet.vy * dt;
        bullet.travel = (bullet.travel ?? 0) + Math.hypot(bullet.vx, bullet.vy) * dt;
      }
      bullet.life -= dt;
      if (bullet.life <= 0) {
        if (b?.stationary && b.splash && !b.noContact && bullet.age >= b.life)
          this.detonate(bullet);
        continue;
      }
      if (bullet.enemy) {
        const d = distance(bullet, this.player),
          away =
            (bullet.x - this.player.x) * (bullet.vx - this.player.vx) +
            (bullet.y - this.player.y) * (bullet.vy - this.player.vy);
        if (
          !bullet.grazed &&
          d < 1.35 &&
          d > bullet.radius + this.player.radius + 0.12 &&
          away > 0 &&
          this.player.dashTime <= 0 &&
          this.player.hurtTime <= 0 &&
          Math.hypot(this.player.vx, this.player.vy) > 1
        ) {
          bullet.grazed = true;
          if (this.weaveTime <= 0) {
            this.weaveCharge = Math.min(1, this.weaveCharge + 1 / WEAVE.dodges);
            if (this.weaveCharge >= 0.999) {
              this.weaveCharge = 0;
              this.weaveTime = WEAVE.duration;
              this.emit({ type: "weave", ...this.player, amount: 1 + WEAVE.bonus });
            }
          }
        }
        if (
          distance(bullet, this.player) <
          bullet.radius + this.player.radius
        ) {
          if (this.player.dashTime <= 0 && !bullet.hitIds.includes(0)) {
            this.hurtPlayer(bullet.damage, bullet);
            bullet.hitIds.push(0);
            bullet.pierce--;
            if (bullet.pierce <= 0) bullet.life = 0;
          }
        }
      } else if (!b?.noContact) {
        for (const enemy of this.enemies) {
          if (
            enemy.hp <= 0 ||
            bullet.hitIds.includes(enemy.id) ||
            distance(bullet, enemy) >= bullet.radius + enemy.radius
          )
            continue;
          bullet.hitIds.push(enemy.id);
          const knock = b?.knock ?? 0.55;
          if (this.hero === "ember")
            bullet.damage *= 1 + Math.min(0.4, (bullet.travel ?? 0) * 0.02);
          if (b?.splash) this.detonate(bullet);
          else
            this.hitEnemy(
              enemy,
              bullet.damage,
              bullet,
              knock,
              true,
              bullet.weapon as WeaponId,
            );
          if (b?.children && !bullet.fused) {
            bullet.fused = true;
            this.burst(bullet, b.children, bullet.angle);
            bullet.life = 0;
            break;
          }
          if ((bullet.splits ?? 0) > 0) {
            const fragments = Math.min(6, 1 + (bullet.splits ?? 0));
            bullet.splits = 0;
            this.burst(
              bullet,
              { count: fragments, damage: 0.35, speed: 18, life: 0.45, pierce: 1, radial: true },
              bullet.angle,
            );
          }
          if ((bullet.bounces ?? 0) > 0) {
            const next = this.nearest(bullet, 8, bullet.hitIds);
            if (next) {
              bullet.bounces = (bullet.bounces ?? 0) - 1;
              const speed = Math.hypot(bullet.vx, bullet.vy) || 1,
                angle = Math.atan2(next.y - bullet.y, next.x - bullet.x);
              bullet.vx = Math.cos(angle) * speed;
              bullet.vy = Math.sin(angle) * speed;
              bullet.angle = angle;
              this.emit({
                type: "bounce",
                x: bullet.x,
                y: bullet.y,
                angle,
                weapon: bullet.weapon,
                id: bullet.id,
              });
              continue;
            }
          }
          bullet.pierce--;
          if (bullet.pierce <= 0) {
            bullet.life = 0;
            break;
          }
        }
      }
    }
    this.bullets = this.bullets.filter(
      (b) => b.life > 0 && Math.abs(b.x) < 22 && Math.abs(b.y) < 22,
    );
  }
  private hitEnemy(
    enemy: Enemy,
    damage: number,
    origin: Vec,
    knock: number,
    effects = true,
    weapon?: WeaponId,
    dot?: "burn" | "poison",
  ): void {
    if (enemy.hp <= 0) return;
    const stats = this.combatStats ?? this.stats;
    const critical =
      effects && stats.critChance > 0 && this.random() < stats.critChance;
    if (critical) damage *= 1 + stats.critDamage;
    if (weapon) enemy.lastWeapon = weapon;
    if (!dot) {
      // Hero signatures and downsides on direct hits.
      const range = distance(enemy, this.player);
      if (this.hero === "ember" && range < 3) damage *= 0.9;
      if (this.hero === "thorn") damage *= 0.8;
      if (this.hero === "reaper" && range < 4) damage *= 1.3;
      if (this.hero === "cinder" && enemy.burnTime > 0) damage *= 1.25;
      if (this.hero === "frost" && enemy.slowTime > 0) damage *= 1.25;
      if (enemy.slowTime > 0) damage *= 1 + stats.frostBonus;
    }
    if (effects) {
      const burn =
        Math.max(stats.burnDamage, weapon === "flame" ? 6 : 0) *
        stats.damage *
        (1 + stats.dotPower);
      const poison =
        Math.max(stats.poisonDamage, weapon === "needle" ? 4 : 0) *
        stats.damage *
        (1 + stats.dotPower);
      let slow = Math.min(stats.slowFactor, weapon === "frostgun" ? 0.7 : 1);
      if (slow < 1 && this.hero === "frost") slow = Math.max(0.1, 1 - (1 - slow) * 1.5);
      if (slow < 1) slow = Math.max(0.1, slow - stats.slowPower);
      if (burn > 0) {
        if (enemy.burnTime <= 0) enemy.burnDamage = 0;
        if (enemy.burnTime <= 0)
          this.emit({
            type: "status",
            x: enemy.x,
            y: enemy.y,
            id: enemy.id,
            status: "burn",
          });
        enemy.burnTime = 2.4;
        enemy.burnDamage = Math.max(enemy.burnDamage, burn);
      }
      if (poison > 0) {
        if (enemy.poisonTime <= 0) enemy.poisonDamage = 0;
        if (enemy.poisonTime <= 0)
          this.emit({
            type: "status",
            x: enemy.x,
            y: enemy.y,
            id: enemy.id,
            status: "poison",
          });
        enemy.poisonTime = 3;
        enemy.poisonDamage = Math.max(enemy.poisonDamage, poison);
        enemy.poisonStacks = Math.min(
          stats.poisonStacks,
          enemy.poisonStacks + 1,
        );
      }
      if (slow < 1) {
        if (enemy.slowTime <= 0)
          this.emit({
            type: "status",
            x: enemy.x,
            y: enemy.y,
            id: enemy.id,
            status: "slow",
          });
        enemy.slowTime = Math.max(enemy.slowTime, 1.6);
        enemy.slowFactor = Math.min(enemy.slowFactor, slow);
      }
    }
    if (!dot) {
      if (
        enemy.kind !== "shielder" &&
        this.enemies.some(
          (ally) =>
            ally.hp > 0 &&
            ally.kind === "shielder" &&
            ally.shield > 0 &&
            distance(ally, enemy) < 3.2,
        )
      )
        damage *= 0.65;
      if (enemy.shield > 0) {
        const absorbed = Math.min(enemy.shield, damage);
        enemy.shield -= absorbed;
        damage -= absorbed;
        if (enemy.shield <= 0) {
          enemy.healTimer = 8;
          this.emit({
            type: "shieldBreak",
            x: enemy.x,
            y: enemy.y,
            id: enemy.id,
            kind: enemy.kind,
          });
        }
      }
    }
    enemy.hp -= damage;
    if (!dot) enemy.hitTime = 0.13;
    const dx = enemy.x - origin.x,
      dy = enemy.y - origin.y,
      d = Math.hypot(dx, dy) || 1;
    const weight =
      (enemy.kind === "boss" ? 0.04 : enemy.kind === "brute" ? 0.35 : 1) *
      (this.hero === "bastion" ? 1.4 : 1) *
      (1 + stats.knockback);
    enemy.knockX += (dx / d) * knock * weight;
    enemy.knockY += (dy / d) * knock * weight;
    this.emit({
      type: "hit",
      x: enemy.x,
      y: enemy.y,
      id: enemy.id,
      amount: damage,
      kind: enemy.kind,
      critical,
      weapon,
      status: dot,
    });
    if (!dot && stats.lifesteal > 0 && damage > 0)
      this.player.hp = Math.min(
        this.player.maxHp,
        this.player.hp + damage * stats.lifesteal,
      );
    if (effects && !dot && stats.splash > 0 && !this.splashing) {
      this.splashing = true;
      for (const other of this.enemies)
        if (other.hp > 0 && other.id !== enemy.id && distance(other, enemy) < 1.6 + other.radius)
          this.hitEnemy(other, damage * stats.splash, enemy, 0.3, false, weapon);
      this.splashing = false;
    }
    if (enemy.hp <= 0) {
      if (enemy.kind === "splitter" && this.enemies.length < 64) {
        for (let i = 0; i < 3; i++) {
          const angle = (i * Math.PI * 2) / 3;
          this.spawn("runner", {
            x: enemy.x + Math.cos(angle) * 0.7,
            y: enemy.y + Math.sin(angle) * 0.7,
          });
        }
      }
      this.kills++;
      this.waveKills++;
      if (this.hero === "reaper") {
        this.bloodlust = Math.min(10, this.bloodlust + 1);
        this.bloodlustTime = 3;
      }
      if (this.hero === "volt" && ++this.voltKills % 5 === 0) {
        this.emit({ type: "explosion", ...this.player, radius: 4, weapon: "arc" });
        for (const other of this.enemies)
          if (other.hp > 0 && other.id !== enemy.id && distance(other, this.player) < 4)
            this.hitEnemy(other, 40 * stats.damage, this.player, 2, false, "arc");
      }
      if (
        this.rule === "volatile" &&
        (enemy.kind === "grunt" || enemy.kind === "runner") &&
        this.hazards.length < 24
      )
        this.addHazard(
          { x: enemy.x, y: enemy.y },
          1.3,
          ENEMY_STATS.grunt.damage * 0.8 * this.enemyDamageScale(),
          "blast",
          0.45,
        );
      if (enemy.burnTime > 0 && (this.hero === "cinder" || stats.burnExplode > 0)) {
        if (stats.burnExplode > 0) {
          this.emit({ type: "explosion", x: enemy.x, y: enemy.y, radius: 2, weapon: "flame" });
          for (const other of this.enemies)
            if (other.hp > 0 && other.id !== enemy.id && distance(other, enemy) < 2 + other.radius)
              this.hitEnemy(other, enemy.maxHp * stats.burnExplode, enemy, 1, false, "flame");
        }
        if (this.hero === "cinder") {
          const next = this.nearest(enemy, 2 + 0.5, [enemy.id]);
          if (next) {
            next.burnTime = Math.max(next.burnTime, enemy.burnTime);
            next.burnDamage = Math.max(next.burnDamage, enemy.burnDamage);
            next.lastWeapon ??= enemy.lastWeapon;
            this.emit({
              type: "arc",
              x: enemy.x,
              y: enemy.y,
              targetX: next.x,
              targetY: next.y,
              targetId: next.id,
              weapon: "flame",
            });
          }
        }
      }
      if (
        dot === "poison" &&
        enemy.poisonStacks > 0 &&
        (this.hero === "thorn" || stats.plagueSpread)
      ) {
        this.emit({
          type: "status",
          status: "poison",
          x: enemy.x,
          y: enemy.y,
          id: enemy.id,
          radius: 2.5,
        });
        for (const other of this.enemies)
          if (other.hp > 0 && other.id !== enemy.id && distance(other, enemy) < 2.5) {
            other.poisonTime = Math.max(other.poisonTime, 3);
            other.poisonDamage = Math.max(other.poisonDamage, enemy.poisonDamage);
            other.poisonStacks = Math.min(
              stats.poisonStacks,
              Math.max(other.poisonStacks, enemy.poisonStacks),
            );
            other.lastWeapon ??= enemy.lastWeapon;
          }
      }
      this.emit({
        type: "kill",
        x: enemy.x,
        y: enemy.y,
        id: enemy.id,
        kind: enemy.kind,
        radius: enemy.radius,
      });
      if (enemy.kind === "boss") {
        this.bossDefeated = true;
        this.bossesDefeated++;
      }
      if (this.hero === "reaper" && weapon === "blade")
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + 2);
      if (dot === "poison" && stats.toxicHealing > 0)
        this.player.hp = Math.min(
          this.player.maxHp,
          this.player.hp + stats.toxicHealing,
        );
      this.pickups.push({
        id: this.nextId++,
        x: enemy.x,
        y: enemy.y,
        value: ENEMY_STATS[enemy.kind].salvage * (enemy.elite ? ELITE.salvage : 1),
        age: 0,
        kind: "salvage",
      });
      if (this.player.hp < this.player.maxHp * 0.8 && this.random() < 0.025)
        this.pickups.push({
          id: this.nextId++,
          x: enemy.x + 0.25,
          y: enemy.y,
          value: 7,
          age: 0,
          kind: "heal",
        });
    }
    if (effects && stats.shockChance > 0 && this.random() < stats.shockChance)
      this.shock(enemy, damage, stats, 1);
  }
  /** The storm set's chain proc; deeper tiers let it jump again. */
  private shock(from: Enemy, damage: number, stats: Stats, depth: number): void {
    const next = this.nearest(from, 4.5, [from.id]);
    if (!next) return;
    this.emit({
      type: "arc",
      x: from.x,
      y: from.y,
      targetX: next.x,
      targetY: next.y,
      weapon: "arc",
    });
    const dealt = damage * stats.shockDamage;
    this.hitEnemy(next, dealt, from, 0.4, false, "arc");
    if (depth < stats.shockDepth && this.random() < stats.shockChance)
      this.shock(next, dealt, stats, depth + 1);
  }
  private enemyDamageScale(): number {
    const age = this.wave - 1;
    return (
      (1 +
        age * ENEMY_CURVE.damageLinear +
        age * age * ENEMY_CURVE.damageQuadratic) *
      this.scaled("damage")
    );
  }
  private hurtPlayer(damage: number, origin: Vec): void {
    const p = this.player;
    if (p.hurtTime > 0 || p.dashTime > 0 || p.hp <= 0) return;
    const stats = this.combatStats ?? this.stats;
    if (p.barrier > 0) {
      p.barrier--;
      p.hurtTime = 0.7;
      this.emit({ type: "shieldBreak", ...p, id: 0, kind: "grunt" });
      return;
    }
    const reduced =
      damage *
      (1 - Math.min(ENEMY_CURVE.armorCap, stats.armor / (stats.armor + 35)));
    p.hp = Math.max(0, p.hp - reduced);
    p.hurtTime = 0.7;
    if (
      stats.emergency > 0 &&
      !this.emergencyUsed &&
      p.hp > 0 &&
      p.hp < p.maxHp * 0.25
    ) {
      this.emergencyUsed = true;
      const heal = Math.round(p.maxHp * stats.emergency);
      p.hp = Math.min(p.maxHp, p.hp + heal);
      this.emit({ type: "heal", ...p, id: 0, amount: heal, kind: "grunt" });
    }
    this.emit({
      type: "hurt",
      ...p,
      amount: reduced,
      angle: Math.atan2(p.y - origin.y, p.x - origin.x),
    });
  }
  private movePickups(dt: number): void {
    for (const pickup of this.pickups) {
      pickup.age += dt;
      const d = distance(pickup, this.player);
      if (d < this.stats.magnet || pickup.age > 16) {
        const speed = pickup.age > 16 ? 18 : 10 + (this.stats.magnet - d) * 4;
        const step = Math.min(d, speed * dt);
        if (d > 0) {
          pickup.x += ((this.player.x - pickup.x) / d) * step;
          pickup.y += ((this.player.y - pickup.y) / d) * step;
        }
      }
      if (distance(pickup, this.player) < 0.75) {
        if (pickup.kind === "heal")
          this.player.hp = Math.min(
            this.player.maxHp,
            this.player.hp + pickup.value,
          );
        else this.bankSalvage(pickup.value);
        this.emit({
          type: "pickup",
          x: pickup.x,
          y: pickup.y,
          id: pickup.id,
          amount: pickup.value,
        });
        pickup.value = 0;
      }
    }
    this.pickups = this.pickups.filter((p) => p.value > 0);
  }
  private bankSalvage(amount: number): void {
    const multiplier =
      (1 + (this.passiveStats.salvage ?? 0) + (this.hero === "flux" ? 0.25 : 0)) *
      this.tuning.salvage;
    // Fractional bonuses accumulate instead of making low-value pickups worthless.
    const before = Math.floor(this.earnedSalvage);
    this.earnedSalvage += amount * multiplier;
    this.salvage += Math.floor(this.earnedSalvage) - before;
  }
  private completeWave(reason: "timer" | "clear" | "boss"): void {
    this.waveOutcome = reason;
    if (reason === "clear") {
      this.fullClears++;
      this.fastestClear = Math.min(this.fastestClear, this.time);
    }
    this.spawnQueue = [];
    this.hordeWarning = 0;
    this.weaveTime = 0;
    this.weaveCharge = 0;
    this.combatStats = undefined;
    for (const pickup of this.pickups)
      if (pickup.kind === "salvage") this.bankSalvage(pickup.value);
    this.bankSalvage(WAVE_CLEAR_BONUS(this.wave));
    this.pickups = [];
    this.bullets = [];
    this.hazards = [];
    for (const enemy of this.enemies)
      this.emit({
        type: "kill",
        x: enemy.x,
        y: enemy.y,
        id: enemy.id,
        kind: enemy.kind,
        radius: enemy.radius,
      });
    this.enemies = [];
    this.player.hp = Math.min(
      this.player.maxHp,
      this.player.hp + Math.ceil(this.player.maxHp * WAVE_END_HEAL),
    );
    this.player.dashTime = 0;
    this.player.vx = 0;
    this.player.vy = 0;
    this.emit({ type: "waveEnd", ...this.player, amount: this.wave });
    if (this.wave === CAMPAIGN_WAVES && !this.endless) {
      this.phase = "won";
      this.emit({ type: "won", ...this.player });
    } else {
      this.phase = "shop";
      this.shopRolls = 0;
      const interest = this.stats.interest;
      if (interest > 0)
        this.bankSalvage(Math.min(interest * 500, this.salvage * interest));
      this.makeShop(true);
    }
  }
  private makeShop(preserveLocks: boolean): void {
    const old = this.offers,
      shelf: (ShopOffer | undefined)[] = Array.from({ length: 4 }, (_, i) =>
        preserveLocks && old[i]?.locked && !old[i].sold ? old[i] : undefined,
      );
    const used = new Set(
      shelf.flatMap((offer) => (offer ? [offer.contentId] : [])),
    );
    for (let slot = 0; slot < 4; slot++)
      if (!shelf[slot]) {
        shelf[slot] = this.makeOffer(slot, used);
        used.add(shelf[slot]!.contentId);
      }
    // A unique weapon late in a run: rare, once, and never over a locked offer.
    const unique = (Object.values(WEAPONS) as WeaponDefinition[]).find((w) => w.unique);
    if (
      unique &&
      this.wave >= (unique.minWave ?? 1) &&
      !this.equipment.some((e) => e.kind === unique.id) &&
      !shelf.some((o) => o?.contentId === unique.id) &&
      !shelf[2]?.locked &&
      this.random() < (this.shopRolls ? 0.015 : 0.06)
    ) {
      const cost = this.offerCost(unique.cost, 6);
      shelf[2] = {
        id: this.nextId++,
        kind: "weapon",
        contentId: unique.id,
        title: unique.name,
        description: rankStatLines(unique.id, 6).slice(0, 1).join(" · "),
        cost,
        baseCost: cost,
        sold: false,
        locked: false,
        rarity: "insane",
        level: 6,
      };
    }
    this.offers = shelf as ShopOffer[];
  }
  private pickWeighted<T extends string>(ids: T[], weight: (id: T) => number): T {
    const weights = ids.map((id) => Math.max(0, weight(id))),
      total = weights.reduce((a, b) => a + b, 0);
    let roll = this.random() * total;
    for (let i = 0; i < ids.length; i++) {
      roll -= weights[i];
      if (roll < 0) return ids[i];
    }
    return ids[ids.length - 1];
  }
  /** Gear from families the build already leans into shows up a little more. */
  private affinity(families: FamilyId[]): number {
    const sets = this.synergies;
    return Math.min(
      3,
      families.filter((id) => (sets.find((s) => s.id === id)?.count ?? 0) >= 2)
        .length,
    );
  }
  private makeOffer(slot: number, used: Set<string>): ShopOffer {
    const common = {
      id: this.nextId++,
      sold: false,
      locked: false,
      rarity: "common" as ShopOffer["rarity"],
    };
    const maxRank = Math.min(5, 1 + Math.floor(this.wave / 6)),
      luck = this.stats.luck,
      discount = this.stats.discount;
    let level = Math.max(1, maxRank - (this.random() < 0.45 - luck ? 1 : 0));
    if (luck > 0 && level < 5 && this.random() < luck) level++;
    const wantWeapon =
      slot === 0 || (slot === 1 && (this.wave === 1 || this.random() < 0.55));
    if (wantWeapon) {
      const ids = (Object.keys(WEAPONS) as WeaponId[]).filter(
        (id) =>
          !used.has(id) &&
          !WEAPONS[id].unique &&
          (WEAPONS[id].weight ?? 1) > 0 &&
          (WEAPONS[id].minWave ?? 1) <= this.wave,
      );
      const matches = this.equipment.filter(
        (e) =>
          e.category === "weapon" &&
          e.level < 6 &&
          e.level <= maxRank &&
          !used.has(e.kind),
      );
      let kind: WeaponId;
      if (this.wave === 1 && slot === 0) {
        kind = HEROES[this.hero].weapon;
        level = 1;
      } else if (matches.length && this.random() < 0.72) {
        const chosen = matches.sort((a, b) => b.level - a.level)[0];
        kind = chosen.kind as WeaponId;
        level = chosen.level;
      } else {
        const newIds = ids.filter(
          (id) => !this.equipment.some((e) => e.kind === id),
        );
        const list =
          this.wave === 1 && slot === 1 && newIds.length ? newIds : ids;
        kind = this.pickWeighted(
          list,
          (id) =>
            (WEAPONS[id].weight ?? 1) *
            (1 + 0.25 * this.affinity(WEAPONS[id].families)),
        );
      }
      const definition = WEAPONS[kind],
        baseCost = this.offerCost(definition.cost, level);
      return {
        ...common,
        kind: "weapon",
        contentId: kind,
        title: definition.name,
        description: rankStatLines(kind, level).slice(0, 2).join(" · "),
        cost: Math.ceil(baseCost * (1 - discount)),
        baseCost,
        level,
        rarity: level >= 4 ? "epic" : level >= 3 ? "rare" : "common",
      };
    }
    if (
      slot === 3 &&
      this.player.hp < this.player.maxHp * 0.7 &&
      !used.has("heal")
    )
      return {
        ...common,
        kind: "heal",
        contentId: "heal",
        title: "Repair",
        description: `Restore ${Math.round(REPAIR_HEAL * 100)}% of max health`,
        cost: Math.ceil(this.price(repairCost(this.wave)) * (1 - discount)),
        baseCost: this.price(repairCost(this.wave)),
        level: 1,
      };
    const ids = (Object.keys(ITEMS) as ItemId[]).filter(
      (id) =>
        !used.has(id) &&
        (ITEMS[id].weight ?? 1) > 0 &&
        (ITEMS[id].minWave ?? 1) <= this.wave,
    );
    const matches = this.bag.filter(
      (e) =>
        e.category !== "weapon" &&
        e.level < 6 &&
        e.level <= maxRank &&
        !used.has(e.kind),
    );
    let kind: ItemId;
    if (matches.length && this.random() < 0.65) {
      const selected = matches.sort((a, b) => b.level - a.level)[
        Math.floor(this.random() * Math.min(3, matches.length))
      ];
      kind = selected.kind as ItemId;
      level = selected.level;
    } else
      kind = this.pickWeighted(
        ids,
        (id) =>
          (ITEMS[id].weight ?? 1) * (1 + 0.25 * this.affinity(ITEMS[id].families)),
      );
    const definition = ITEMS[kind],
      baseCost = this.offerCost(
        definition.cost,
        level,
        definition.category === "drone",
      );
    return {
      ...common,
      kind: "item",
      contentId: kind,
      title: definition.name,
      description: rankStatLines(kind, level).slice(0, 2).join(" · "),
      cost: Math.ceil(baseCost * (1 - discount)),
      baseCost,
      level,
      rarity: level >= 4 ? "epic" : level >= 3 ? "rare" : "common",
    };
  }
  private offerCost(base: number, level: number, drone = false): number {
    return this.price(
      offerPrice(base, this.wave, level) *
        (drone && this.hero === "wisp" ? 0.75 : 1),
    );
  }
}
