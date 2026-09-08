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
  category: "weapon" | "passive" | "drone";
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
}
export interface Weapon {
  id: number;
  kind: WeaponId;
  level: number;
  cooldown: number;
  category: "weapon";
  slot: number;
}
export interface ShopOffer {
  id: number;
  kind: "weapon" | "item" | "heal";
  contentId: string;
  title: string;
  description: string;
  cost: number;
  sold: boolean;
  locked: boolean;
  rarity: "common" | "rare" | "epic";
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
  | "shieldBreak";
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
}

const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n));
const distance = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
const sqDistance = (a: Vec, b: Vec) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const levelScale = rankScale;
/** All simulation work happens in 1/60 second steps. Rendering never changes outcomes. */
export class SurvivalRun {
  readonly hero: HeroId;
  readonly seed: number;
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
  combo = 0;
  bestCombo = 0;
  comboTime = 0;
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

  constructor(hero: HeroId = "ember", seed = 1) {
    this.hero = HEROES[hero] ? hero : "ember";
    this.seed = seed >>> 0;
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
    return {
      damage:
        (1 +
          n("damage") +
          (this.hero === "ember"
            ? 0.1
            : this.hero === "prism"
              ? new Set(this.weapons.map((w) => w.kind)).size * 0.03
              : 0)) *
        (this.weaveTime > 0 ? 1.25 : 1),
      attackSpeed: Math.min(
        4.5,
        1 + n("attackSpeed") + (drone === 2 ? 0.22 : drone === 1 ? 0.1 : 0),
      ),
      speed:
        HEROES[this.hero].speed *
        (1 +
          Math.min(0.7, n("speed")) +
          (drone === 2 ? 0.1 : drone === 1 ? 0.05 : 0)),
      maxHp: HEROES[this.hero].maxHp + n("maxHp"),
      armor: (this.hero === "bastion" ? 8 : 0) + n("armor"),
      magnet: 3.8 * (1 + n("magnet") + (this.hero === "flux" ? 0.5 : 0)),
      dashCooldown: Math.max(
        1.2,
        HEROES[this.hero].dashCooldown / (1 + n("dashRecovery")),
      ),
      healing: n("healing"),
      critChance: kinetic === 2 ? 0.2 : kinetic === 1 ? 0.1 : 0,
      shockChance: Math.min(
        0.5,
        (storm === 2 ? 0.22 : storm === 1 ? 0.1 : 0) +
          (this.hero === "volt" ? 0.15 : 0),
      ),
      pierce: kinetic === 2 ? 1 : 0,
      burnDamage:
        Math.max(
          thermal === 2 ? 12 : thermal === 1 ? 6 : 0,
          this.hero === "cinder" ? 5 : 0,
        ) + n("burnDamage"),
      poisonDamage:
        Math.max(
          toxic === 2 ? 8 : toxic === 1 ? 4 : 0,
          this.hero === "thorn" ? 4 : 0,
        ) + n("poisonDamage"),
      slowFactor: Math.min(
        frost === 2 ? 0.65 : frost === 1 ? 0.8 : 1,
        this.hero === "frost" ? 0.8 : 1,
      ),
      toxicHealing: toxic === 2 ? 2 : 0,
    };
  }
  get synergies() {
    return getSynergies(this.weapons, this.bag);
  }
  get waveThreat() {
    return THREATS.find((threat) => threat.wave === this.wave) ?? null;
  }
  get renderAlpha() {
    return clamp(this.accumulator * 60, 0, 1);
  }
  get isBossWave() {
    return this.wave > 0 && this.wave % BOSS_INTERVAL === 0;
  }
  get bossName() {
    return BOSS_NAMES[
      (Math.max(1, Math.ceil(this.wave / BOSS_INTERVAL)) - 1) % BOSS_NAMES.length
    ];
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
    return 4 + this.wave + this.shopRolls * 3;
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
    this.waveDuration = waveDuration(this.wave);
    this.timeRemaining = this.waveDuration;
    this.waveKills = 0;
    this.spawnTimer = 0.45;
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
    this.combo = 0;
    this.comboTime = 0;
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
    this.spawn("grunt", { x: -near, y: -0.8 });
    this.spawn("grunt", { x: near, y: 1.2 });
    this.spawn("grunt", { x: -1.2, y: -near - 1 });
    this.spawn("grunt", { x: 1.6, y: near + 1 });
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
    return this.bag.length < BAG_CAPACITY;
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
        this.player.hp + Math.ceil(this.player.maxHp * 0.45),
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
          ["gun", "orbit", "shock"].includes(
            ITEMS[item.kind as ItemId].drone!.attack,
          ),
      )
    );
  }
  canUnequipWeapon(id: number): boolean {
    return (
      this.phase === "shop" &&
      this.weapons.some((w) => w.id === id) &&
      this.bag.length < BAG_CAPACITY &&
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
    return Math.max(1, Math.floor(price * rankScale(item.level) * 0.5));
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
    this.comboTime = Math.max(0, this.comboTime - dt);
    if (!this.comboTime) this.combo = 0;
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
    const target = this.nearest(p, 16);
    if (target) p.angle = Math.atan2(target.y - p.y, target.x - p.x);
    this.healTimer += dt;
    if (this.healTimer >= 3) {
      this.healTimer -= 3;
      p.hp = Math.min(p.maxHp, p.hp + stats.healing * 3);
    }

    if (this.isBossWave && !this.bossSpawned && this.time > 1.5) {
      this.spawn("boss");
      this.bossSpawned = true;
      this.emit({ type: "boss", x: 0, y: -15 });
    }
    if (this.waveThreat && !this.openingShooterSpawned && this.time >= 0.8) {
      this.spawn(this.waveThreat.kind);
      this.openingShooterSpawned = true;
    }
    if (this.time < this.waveDuration) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawnTimer += Math.max(
          0.8,
          2 - Math.min(this.wave, 24) * 0.055 - this.waveProgress * 0.35,
        );
        // Simultaneous entries create choices between directions, with enough
        // travel time to read a gap. A lone trickle never pressures an auto-aim gun.
        const arrivals =
          this.wave === 1 ? 3 : this.wave < 9 || this.wave >= 19 ? 4 : 3;
        for (let i = 0; i < arrivals && this.enemies.length < 60; i++)
          this.spawn(this.chooseEnemy());
      }
    }
    this.moveDrones(dt);
    for (const weapon of this.weapons) {
      weapon.cooldown -= dt;
      if (weapon.cooldown <= 0) {
        const target = this.nearest(p, WEAPONS[weapon.kind].range);
        if (target) {
          this.fire(weapon, target);
          weapon.cooldown = WEAPONS[weapon.kind].cooldown / stats.attackSpeed;
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
    if (this.isBossWave && this.bossDefeated) {
      this.completeWave();
      return;
    }
    if (!this.isBossWave && this.time >= this.waveDuration) this.completeWave();
  }

  private chooseEnemy(): EnemyKind {
    const unlocked = THREATS.filter((t) => t.wave <= this.wave),
      roll = this.random();
    if (!unlocked.length || roll < 0.4) return "grunt";
    const newest = unlocked[unlocked.length - 1];
    if (roll < 0.6) return newest.kind;
    return unlocked[Math.floor(this.random() * unlocked.length)].kind;
  }
  private spawn(kind: EnemyKind, position?: Vec): void {
    const side = Math.floor(this.random() * 4),
      offset = (this.random() * 2 - 1) * 15;
    let x = side === 0 ? -16.8 : side === 1 ? 16.8 : offset;
    let y = side === 2 ? -16.8 : side === 3 ? 16.8 : offset;
    if (kind === "boss") {
      x = 0;
      y = -15.5;
    }
    if (position) {
      x = position.x;
      y = position.y;
    }
    if (!position && distance({ x, y }, this.player) < 7) {
      x *= -1;
      y *= -1;
    }
    const definition = ENEMY_STATS[kind];
    const age = this.wave - 1,
      bossTier = Math.ceil(this.wave / BOSS_INTERVAL);
    // Grunts gain a fixed opening buffer; their old growth stays intact so
    // two opening volleys do not turn late waves into health sponges.
    const scaledHp =
      kind === "boss"
        ? // Tiers arrive every third wave against younger builds; the base is
          // lower than the boss table's nominal value and the curve is steeper.
          definition.hp * 0.71 * Math.pow(bossTier, 1.6)
        : definition.hp +
          (kind === "grunt" ? 24 : definition.hp) *
            (age * 0.18 + age * age * 0.009);
    const hp =
      kind === "grunt"
        ? Math.max(scaledHp, Math.min(120, 50 + age * 36))
        : scaledHp;
    const enemy: Enemy = {
      id: this.nextId++,
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
      radius: definition.radius,
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
      bossVariant: kind === "boss" ? (bossTier - 1) % 10 : 0,
      attackCount: 0,
      statusTick: 0,
      spawnTime: 0.6,
      shield:
        kind === "shielder"
          ? hp * 0.75
          : kind === "boss" && [6, 8].includes(((bossTier - 1) % 10) + 1)
            ? hp * 0.15
            : 0,
      maxShield:
        kind === "shielder"
          ? hp * 0.75
          : kind === "boss" && [6, 8].includes(((bossTier - 1) % 10) + 1)
            ? hp * 0.15
            : 0,
      healTimer: 2.5,
    };
    this.enemies.push(enemy);
    this.emit({
      type: "spawn",
      x,
      y,
      id: enemy.id,
      kind,
      radius: definition.radius,
    });
  }

  private fire(weapon: Weapon, target: Enemy): void {
    const p = this.player,
      definition = WEAPONS[weapon.kind],
      damage =
        definition.damage *
        levelScale(weapon.level) *
        (this.combatStats ?? this.stats).damage;
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
    if (weapon.kind === "pistol") {
      for (const spread of [-0.045, 0.045])
        this.spawnBullet(
          p,
          aim + spread,
          "pistol",
          damage,
          24,
          0.68,
          weapon.level >= 3 ? 2 : 1,
          weapon.level,
        );
    } else if (weapon.kind === "shotgun") {
      const pellets = weapon.level >= 3 ? 7 : 5;
      for (let i = 0; i < pellets; i++)
        this.spawnBullet(
          p,
          aim + (i - (pellets - 1) / 2) * 0.12,
          "shotgun",
          damage,
          21,
          0.44,
          1,
          weapon.level,
        );
    } else if (weapon.kind === "rocket")
      this.spawnBullet(p, aim, "rocket", damage, 12, 1.7, 1, weapon.level);
    else if (weapon.kind === "frostgun") {
      for (const spread of [-0.1, 0, 0.1])
        this.spawnBullet(
          p,
          aim + spread,
          "frostgun",
          damage,
          22,
          0.62,
          1,
          weapon.level,
        );
    } else if (weapon.kind === "needle")
      this.spawnBullet(p, aim, "needle", damage, 27, 0.58, 2, weapon.level);
    else if (weapon.kind === "boomerang")
      this.spawnBullet(p, aim, "boomerang", damage, 16, 1.7, 20, weapon.level);
    else if (weapon.kind === "railgun" || weapon.kind === "beam") {
      const range = definition.range + (weapon.level - 1) * 0.7;
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
          this.hitEnemy(
            enemy,
            damage,
            p,
            weapon.kind === "railgun" ? 3 : 0.5,
            true,
            weapon.kind,
          );
      }
    } else if (weapon.kind === "flame") {
      const radius = definition.range + (weapon.level - 1) * 0.35;
      this.emit({
        type: "slash",
        ...p,
        angle: aim,
        radius,
        weapon: "flame",
        id: weapon.id,
        level: weapon.level,
      });
      for (const enemy of this.enemies)
        if (
          distance(enemy, p) < radius + enemy.radius &&
          Math.cos(Math.atan2(enemy.y - p.y, enemy.x - p.x) - aim) > 0.78
        )
          this.hitEnemy(enemy, damage, p, 0.4, true, "flame");
    } else if (weapon.kind === "arc") {
      let from: Vec = p,
        next: Enemy | undefined = target;
      const hit: number[] = [];
      for (let chain = 0; chain < 3 + weapon.level; chain++) {
        if (!next) break;
        const enemy: Enemy = next;
        this.emit({
          type: "arc",
          x: from.x,
          y: from.y,
          targetX: enemy.x,
          targetY: enemy.y,
          targetId: enemy.id,
          weapon: "arc",
          id: weapon.id,
          level: weapon.level,
        });
        hit.push(enemy.id);
        this.hitEnemy(
          enemy,
          damage * Math.pow(0.86, chain),
          from,
          0.35,
          true,
          "arc",
        );
        from = { x: enemy.x, y: enemy.y };
        next = this.nearest(from, 4.2 + weapon.level * 0.35, hit);
      }
    } else {
      const radius = definition.range + (weapon.level - 1) * 0.35;
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
          if (weapon.kind === "blade") {
            const angle = Math.atan2(enemy.y - p.y, enemy.x - p.x) - aim;
            if (Math.cos(angle) < -0.3) continue;
          }
          this.hitEnemy(
            enemy,
            damage,
            p,
            weapon.kind === "blade" ? 3 : 1,
            true,
            weapon.kind,
          );
        }
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
      radius: weapon === "rocket" ? 0.3 : weapon === "enemy" ? 0.22 : 0.12,
      life,
      angle,
      pierce:
        pierce +
        (weapon === "enemy" ? 0 : (this.combatStats ?? this.stats).pierce),
      hitIds: [],
      level,
      age: 0,
      grazed: false,
      returning: false,
    });
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
          (this.hero === "wisp" ? 1.4 : 1),
        target = this.nearest(drone, definition.range);
      if (definition.attack === "repair") {
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
      else if (definition.attack === "gun") {
        const aim = Math.atan2(target.y - drone.y, target.x - drone.x);
        drone.aimAngle = aim;
        this.spawnBullet(drone, aim, "pistol", power, 24, 0.7, 1, drone.level);
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
        (definition.attack === "repair" ? 1 : stats.attackSpeed);
    }
  }
  private addHazard(
    origin: Vec,
    radius: number,
    damage: number,
    kind: "blast" | "toxic",
    delay = 0.9,
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
      duration: kind === "toxic" ? 4 : 0.18,
      triggered: false,
      tick: 0,
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
          enemy: true,
          weapon: "enemy",
        });
      }
      hazard.tick -= dt;
      if (hazard.tick <= 0) {
        if (distance(hazard, this.player) < hazard.radius + this.player.radius)
          this.hurtPlayer(hazard.damage, hazard);
        hazard.tick = hazard.kind === "toxic" ? 1 : 99;
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
      let speed =
          def.speed *
          (1 + Math.min(0.55, (this.wave - 1) * 0.024)) *
          enemy.slowFactor,
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
                enemy.kind === "sniper" ? 23 : 7,
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
        speed = (enemy.kind === "boss" ? 8.5 : 10) * enemy.slowFactor;
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
            enemy.kind === "boss" ? 2.2 : enemy.kind === "sniper" ? 3.5 : 2.6;
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
        this.hurtPlayer(def.damage * this.enemyDamageScale(), enemy);
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
        this.spawn(this.wave >= 21 ? "splitter" : "grunt", {
          x: enemy.x + (i ? 2 : -2),
          y: enemy.y + 1,
        });
    }
    if ((variant === 5 || variant === 7) && count % 3 === 0) {
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
  private moveBullets(dt: number): void {
    for (const bullet of this.bullets) {
      bullet.age += dt;
      if (bullet.weapon === "boomerang" && bullet.age >= 0.6) {
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
      bullet.x += bullet.vx * dt;
      bullet.y += bullet.vy * dt;
      bullet.life -= dt;
      if (bullet.life <= 0) continue;
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
            this.weaveCharge = Math.min(1, this.weaveCharge + 1 / 3);
            if (this.weaveCharge >= 0.999) {
              this.weaveCharge = 0;
              this.weaveTime = 3.5;
              this.emit({ type: "weave", ...this.player, amount: 1.25 });
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
      } else {
        for (const enemy of this.enemies) {
          if (
            enemy.hp <= 0 ||
            bullet.hitIds.includes(enemy.id) ||
            distance(bullet, enemy) >= bullet.radius + enemy.radius
          )
            continue;
          bullet.hitIds.push(enemy.id);
          if (bullet.weapon === "rocket") {
            const radius = 2.5 + bullet.level * 0.35;
            this.emit({
              type: "explosion",
              ...bullet,
              radius,
              weapon: "rocket",
            });
            for (const target of this.enemies)
              if (distance(bullet, target) < radius + target.radius)
                this.hitEnemy(target, bullet.damage, bullet, 6, true, "rocket");
          } else
            this.hitEnemy(
              enemy,
              bullet.damage,
              bullet,
              bullet.weapon === "shotgun" ? 2.2 : 0.55,
              true,
              bullet.weapon as WeaponId,
            );
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
    if (critical) damage *= 1.6;
    if (weapon) enemy.lastWeapon = weapon;
    if (effects) {
      const burn =
        Math.max(stats.burnDamage, weapon === "flame" ? 6 : 0) * stats.damage;
      const poison =
        Math.max(stats.poisonDamage, weapon === "needle" ? 4 : 0) *
        stats.damage;
      const slow = Math.min(stats.slowFactor, weapon === "frostgun" ? 0.7 : 1);
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
        enemy.poisonStacks = Math.min(3, enemy.poisonStacks + 1);
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
      (this.hero === "bastion" ? 1.4 : 1);
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
    });
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
      this.combo++;
      this.comboTime = 2.8;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
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
        value: ENEMY_STATS[enemy.kind].salvage,
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
    if (effects && stats.shockChance > 0 && this.random() < stats.shockChance) {
      const next = this.nearest(enemy, 4.5, [enemy.id]);
      if (next) {
        this.emit({
          type: "arc",
          x: enemy.x,
          y: enemy.y,
          targetX: next.x,
          targetY: next.y,
          weapon: "arc",
        });
        this.hitEnemy(next, damage * 0.45, enemy, 0.4, false, "arc");
      }
    }
  }
  private enemyDamageScale(): number {
    const age = this.wave - 1;
    return 1 + age * 0.035 + age * age * 0.0015;
  }
  private hurtPlayer(damage: number, origin: Vec): void {
    const p = this.player;
    if (p.hurtTime > 0 || p.dashTime > 0 || p.hp <= 0) return;
    const reduced =
      damage * (1 - Math.min(0.65, this.stats.armor / (this.stats.armor + 35)));
    p.hp = Math.max(0, p.hp - reduced);
    p.hurtTime = 0.7;
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
      1 + (this.passiveStats.salvage ?? 0) + (this.hero === "flux" ? 0.25 : 0);
    // Fractional bonuses accumulate instead of making low-value pickups worthless.
    const before = Math.floor(this.earnedSalvage);
    this.earnedSalvage += amount * multiplier;
    this.salvage += Math.floor(this.earnedSalvage) - before;
  }
  private completeWave(): void {
    this.weaveTime = 0;
    this.weaveCharge = 0;
    this.combatStats = undefined;
    for (const pickup of this.pickups)
      if (pickup.kind === "salvage") this.bankSalvage(pickup.value);
    this.bankSalvage(9 + this.wave * 2);
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
      this.player.hp + Math.ceil(this.player.maxHp * 0.1),
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
    this.offers = shelf as ShopOffer[];
  }
  private makeOffer(slot: number, used: Set<string>): ShopOffer {
    const common = {
      id: this.nextId++,
      sold: false,
      locked: false,
      rarity: "common" as "common" | "rare" | "epic",
    };
    const maxRank = Math.min(5, 1 + Math.floor(this.wave / 6));
    let level = Math.max(1, maxRank - (this.random() < 0.45 ? 1 : 0));
    const wantWeapon =
      slot === 0 || (slot === 1 && (this.wave === 1 || this.random() < 0.55));
    if (wantWeapon) {
      const ids = (Object.keys(WEAPONS) as WeaponId[]).filter(
        (id) => !used.has(id),
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
        kind = list[Math.floor(this.random() * list.length)];
      }
      const definition = WEAPONS[kind];
      return {
        ...common,
        kind: "weapon",
        contentId: kind,
        title: definition.name,
        description: rankStatLines(kind, level).slice(0, 2).join(" · "),
        cost: this.offerCost(definition.cost, level),
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
        description: "Restore 45% of max health",
        cost: 8 + this.wave * 2,
        level: 1,
      };
    const ids = (Object.keys(ITEMS) as ItemId[]).filter((id) => !used.has(id));
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
    } else kind = ids[Math.floor(this.random() * ids.length)];
    const definition = ITEMS[kind];
    return {
      ...common,
      kind: "item",
      contentId: kind,
      title: definition.name,
      description: rankStatLines(kind, level).slice(0, 2).join(" · "),
      cost: this.offerCost(definition.cost, level),
      level,
      rarity: level >= 4 ? "epic" : level >= 3 ? "rare" : "common",
    };
  }
  private offerCost(base: number, level: number): number {
    return Math.ceil(
      (base + this.wave * 1.3) * [1, 1.35, 1.9, 2.8, 4.1, 6][level - 1],
    );
  }
}
