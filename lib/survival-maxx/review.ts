/** DEV-only preparation for a manual finale review. No fabricated run state. */
import {
  CAMPAIGN_WAVES,
  WEAPONS,
  ITEMS,
  rankScale,
  type HeroId,
  type WeaponId,
  type ItemId,
} from "./content";
import {
  SurvivalRun,
  type Input,
  type ShopOffer,
  type Equipment,
} from "./model";

interface Waypoint {
  index: number;
  frames: number;
  input?: Input;
}

// This is the same imperfect, five-reactions-per-second policy used by the
// balance probe. It only reads visible enemies, projectiles and arena edges.
function weave(run: SurvivalRun, waypoint: Waypoint): Input {
  waypoint.frames++;
  if (waypoint.frames % 12 !== 0 && waypoint.input) return waypoint.input;
  const range = Math.max(
    3.8,
    ...run.weapons.map((weapon) => WEAPONS[weapon.kind].range),
  );
  const boss = run.boss;
  const shortRange = range < 8;
  const radius = boss && shortRange ? Math.max(3.1, range * 0.8) : 9.5;
  const target = () => ({
    x: Math.max(
      -13,
      Math.min(
        13,
        (boss && shortRange ? boss.x : 0) +
          Math.cos((waypoint.index / 12) * Math.PI * 2) * radius,
      ),
    ),
    y: Math.max(
      -13,
      Math.min(
        13,
        (boss && shortRange ? boss.y : 0) +
          Math.sin((waypoint.index / 12) * Math.PI * 2) * radius,
      ),
    ),
  });
  let point = target();
  if (Math.hypot(point.x - run.player.x, point.y - run.player.y) < 1.3) {
    waypoint.index++;
    point = target();
  }
  const x = point.x - run.player.x;
  const y = point.y - run.player.y;
  const length = Math.hypot(x, y) || 1;
  let mx = x / length;
  let my = y / length;
  let danger = false;
  for (const enemy of run.enemies) {
    const dx = run.player.x - enemy.x;
    const dy = run.player.y - enemy.y;
    const distance = Math.hypot(dx, dy) || 0.01;
    const clearance = distance - enemy.radius;
    const buffer = enemy.kind === "boss" && range < 7 ? 1.7 : 4;
    if (clearance < buffer) {
      const force = Math.max(0, (buffer - clearance) / buffer) * 2.2;
      mx += (dx / distance) * force;
      my += (dy / distance) * force;
      if (clearance < (range < 7 ? 1 : 2.1)) danger = true;
    }
  }
  for (const bullet of run.bullets) {
    if (!bullet.enemy) continue;
    const dx = run.player.x - (bullet.x + bullet.vx * 0.22);
    const dy = run.player.y - (bullet.y + bullet.vy * 0.22);
    const distance = Math.hypot(dx, dy) || 0.01;
    if (distance < 3.3) {
      const force = ((3.3 - distance) / 3.3) * 2.6;
      mx += (dx / distance) * force;
      my += (dy / distance) * force;
      if (distance < 1.5) danger = true;
    }
  }
  for (const hazard of run.hazards) {
    const dx = run.player.x - hazard.x,
      dy = run.player.y - hazard.y,
      d = Math.hypot(dx, dy) || 0.01,
      reach = hazard.radius + 1.7;
    if (d < reach) {
      const force = ((reach - d) / reach) * 3.5;
      mx += (dx / d) * force;
      my += (dy / d) * force;
      if (d < hazard.radius + 0.5 && hazard.age > hazard.delay - 0.35)
        danger = true;
    }
  }
  if (Math.abs(run.player.x) > 13)
    mx -= Math.sign(run.player.x) * (Math.abs(run.player.x) - 13) * 1.2;
  if (Math.abs(run.player.y) > 13)
    my -= Math.sign(run.player.y) * (Math.abs(run.player.y) - 13) * 1.2;
  // Choose a safe direction over the next reaction interval. Projectile paths
  // are extrapolated from visible velocity; this does not read future spawns.
  const speed = run.stats.speed;
  const preferred = Math.atan2(my, mx);
  let best = preferred,
    bestScore = -Infinity,
    safestRisk = Infinity;
  for (let candidate = 0; candidate < 20; candidate++) {
    const angle =
      preferred +
      (candidate
        ? (Math.ceil(candidate / 2) * (candidate % 2 ? 1 : -1) * Math.PI) / 10
        : 0);
    const vx = Math.cos(angle) * speed,
      vy = Math.sin(angle) * speed;
    let risk = 0;
    for (const enemy of run.enemies) {
      if (enemy.spawnTime > 0.5) continue;
      const ex = enemy.x + enemy.vx * 0.35,
        ey = enemy.y + enemy.vy * 0.35;
      const d =
        Math.hypot(
          run.player.x + vx * 0.35 - ex,
          run.player.y + vy * 0.35 - ey,
        ) - enemy.radius;
      risk += Math.max(0, 1.35 - d) * 5;
    }
    for (const bullet of run.bullets) {
      if (!bullet.enemy || bullet.hitIds.includes(0)) continue;
      const dx = bullet.x - run.player.x,
        dy = bullet.y - run.player.y;
      if (Math.hypot(dx, dy) > 10) continue;
      const rx = bullet.vx - vx,
        ry = bullet.vy - vy;
      const t = Math.max(
        0,
        Math.min(0.5, -(dx * rx + dy * ry) / (rx * rx + ry * ry || 1)),
      );
      const miss = Math.hypot(dx + rx * t, dy + ry * t);
      risk += Math.max(0, 1.05 - miss) * 9;
    }
    for (const hazard of run.hazards) {
      if (hazard.age + 0.45 < hazard.delay) continue;
      const d = Math.hypot(
        run.player.x + vx * 0.4 - hazard.x,
        run.player.y + vy * 0.4 - hazard.y,
      );
      risk += Math.max(0, hazard.radius + 0.8 - d) * 5;
    }
    const px = run.player.x + vx * 0.5,
      py = run.player.y + vy * 0.5;
    risk +=
      Math.max(0, Math.abs(px) - 15) * 8 + Math.max(0, Math.abs(py) - 15) * 8;
    const score = Math.cos(angle - preferred) - risk;
    if (score > bestScore) {
      bestScore = score;
      best = angle;
      safestRisk = risk;
    }
  }
  waypoint.input = {
    x: Math.cos(best),
    y: Math.sin(best),
    dash: run.player.dashCooldown <= 0 && (safestRisk > 0.6 || danger),
  };
  return waypoint.input;
}

const equipmentScore = (item: Equipment): number => {
  if (item.category === "weapon") {
    const w = WEAPONS[item.kind as WeaponId],
      multi =
        item.kind === "pistol"
          ? 2
          : item.kind === "shotgun"
            ? 5
            : item.kind === "frostgun"
              ? 3
              : item.kind === "arc"
                ? 2
                : item.kind === "blade"
                  ? 1.6
                  : 1;
    return (
      (w.damage / w.cooldown) *
      multi *
      rankScale(item.level) *
      Math.min(1, w.range / 9)
    );
  }
  const d = ITEMS[item.kind as ItemId];
  return (
    rankScale(item.level) *
    (d.category === "drone" && d.drone?.damage
      ? 75
      : item.kind === "power"
        ? 65
        : item.kind === "vitality"
          ? 50
          : item.kind === "plating"
            ? 45
            : 35)
  );
};
function organize(run: SurvivalRun): void {
  for (let i = 0; i < 30; i++) {
    const merge = run.equipment
      .sort((a, b) => b.level - a.level)
      .find((item) => run.canMergeEquipment(item.id));
    if (!merge) break;
    run.mergeEquipment(merge.id);
  }
  for (let i = 0; i < 8; i++) {
    const spare = run.bag
      .filter((item) => item.category === "weapon")
      .sort((a, b) => equipmentScore(b) - equipmentScore(a))[0];
    if (!spare) break;
    const free = Array.from(
      { length: run.weaponSlots },
      (_, slot) => slot,
    ).find((slot) => !run.weapons.some((w) => w.slot === slot));
    if (free !== undefined) {
      run.equipWeapon(spare.id, free);
      continue;
    }
    const weakest = [...run.weapons].sort(
      (a, b) => equipmentScore(a) - equipmentScore(b),
    )[0];
    if (equipmentScore(spare) > equipmentScore(weakest) * 1.04)
      run.equipWeapon(spare.id, weakest.slot);
    else break;
  }
}
export function purchaseReviewShop(run: SurvivalRun): void {
  organize(run);
  const buildValue = (item: Equipment): number => {
    if (item.category === "weapon")
      return (
        equipmentScore(item) *
        (run.weapons.some((w) => w.kind === item.kind && w.level === item.level)
          ? 0.6
          : 0.08)
      );
    const priority =
      (item.kind === "vitality" && run.player.maxHp < 220) ||
      (item.kind === "plating" && run.stats.armor < 30) ||
      (["repair_drone", "mending"].includes(item.kind) &&
        (run.passiveStats.healing ?? 0) < 2 &&
        !run.drones.some((d) => d.kind === "repair_drone"));
    return equipmentScore(item) * (priority ? 3 : 1);
  };
  let rerolls = 0;
  for (let turn = 0; turn < 24; turn++) {
    const priority = (offer: ShopOffer) => {
      if (offer.kind === "heal")
        return run.player.hp < run.player.maxHp * 0.65 ? 0 : 9;
      if (
        offer.kind === "item" &&
        ((offer.contentId === "vitality" && run.player.maxHp < 220) ||
          (offer.contentId === "plating" && run.stats.armor < 30) ||
          (["repair_drone", "mending"].includes(offer.contentId) &&
            (run.passiveStats.healing ?? 0) < 2 &&
            !run.drones.some((d) => d.kind === "repair_drone")))
      )
        return 0.5;
      const matching = run.equipment.some(
        (item) =>
          item.kind === offer.contentId &&
          item.level === offer.level &&
          item.level < 6,
      );
      if (matching) {
        if (
          offer.kind !== "weapon" ||
          run.weapons.some(
            (w) => w.kind === offer.contentId && w.level === offer.level,
          )
        )
          return 1;
        const prospective = equipmentScore({
          id: 0,
          kind: offer.contentId as WeaponId,
          category: "weapon",
          level: offer.level + 1,
        });
        if (prospective > Math.min(...run.weapons.map(equipmentScore)) * 1.1)
          return 2;
        return 7;
      }
      if (offer.kind === "weapon") {
        const weakest = Math.min(...run.weapons.map(equipmentScore));
        return run.weapons.length < run.weaponSlots ||
          equipmentScore({
            id: 0,
            kind: offer.contentId as WeaponId,
            category: "weapon",
            level: offer.level,
          }) >
            weakest * 1.1
          ? 2
          : 7;
      }
      return ITEMS[offer.contentId as ItemId].category === "drone" ? 3 : 4;
    };
    const candidates = run.offers
      .map((offer, index) => ({ offer, index }))
      .filter(({ offer }) => !offer.sold && offer.cost <= run.salvage)
      .sort(
        (a, b) =>
          priority(a.offer) - priority(b.offer) ||
          b.offer.level - a.offer.level ||
          a.offer.cost - b.offer.cost,
      );
    let purchased = false;
    for (const candidate of candidates) {
      if (priority(candidate.offer) >= 7) continue;
      if (!run.canBuy(candidate.index)) {
        const matching = run.equipment.find(
          (item) =>
            item.kind === candidate.offer.contentId &&
            item.level === candidate.offer.level &&
            item.level < 6,
        );
        const weakest = run.bag
          .filter(
            (item) =>
              item.id !== matching?.id &&
              run.canSellEquipment(item.id) &&
              !run.canMergeEquipment(item.id),
          )
          .sort((a, b) => buildValue(a) - buildValue(b))[0];
        if (!weakest) continue;
        const incoming = buildValue({
          id: 0,
          kind: candidate.offer.contentId as WeaponId | ItemId,
          category:
            candidate.offer.kind === "weapon"
              ? "weapon"
              : ITEMS[candidate.offer.contentId as ItemId].category,
          level: candidate.offer.level,
        });
        // A matching pair buys slot efficiency, so compare the merged result's gain.
        const gain = matching
          ? equipmentScore({ ...matching, level: matching.level + 1 }) -
            equipmentScore(matching)
          : incoming;
        if (gain <= buildValue(weakest) * 1.05) continue;
        if (!run.sellEquipment(weakest.id)) continue;
      }
      if (!run.buy(candidate.index)) continue;
      organize(run);
      purchased = true;
      break;
    }
    if (!purchased) {
      if (rerolls < 2 && run.salvage >= run.rerollCost + 20 && run.reroll())
        rerolls++;
      else break;
    }
  }
  organize(run);
}

export function prepareReviewWave(
  hero: HeroId,
  targetWave = CAMPAIGN_WAVES,
): SurvivalRun {
  if (
    !Number.isInteger(targetWave) ||
    targetWave < 1 ||
    targetWave > CAMPAIGN_WAVES
  )
    throw new Error("Invalid review wave");
  // Fixed successful routes for visual QA, selected from the published balance
  // matrix. The full diagnostic still records failures on other seeds.
  const run = new SurvivalRun(hero, hero === "volt" ? 17 : 1);
  for (let wave = 1; wave < targetWave; wave++) {
    if (!run.startWave())
      throw new Error(`Review could not start wave ${wave}`);
    const waypoint: Waypoint = { index: 0, frames: -1 };
    for (let frame = 0; frame < 180 * 60 && run.phase === "combat"; frame++) {
      run.step(1 / 60, weave(run, waypoint));
      run.drainEvents();
    }
    if (run.phase !== "shop")
      throw new Error(`Review preparation ended at wave ${wave}: ${run.phase}`);
    purchaseReviewShop(run);
    run.drainEvents();
  }
  return run;
}

export function prepareFinale(hero: HeroId): SurvivalRun {
  return prepareReviewWave(hero, CAMPAIGN_WAVES);
}

/** DEV review input for the live simulation; this function never changes a run. */
export function createReviewPilot(): (run: SurvivalRun, dt: number) => Input {
  let activeRun: SurvivalRun | undefined;
  let accumulator = 0;
  let waypoint: Waypoint = { index: 0, frames: -1 };
  return (run, dt) => {
    if (activeRun !== run) {
      activeRun = run;
      accumulator = 0;
      waypoint = { index: 0, frames: -1 };
    }
    if (run.phase !== "combat" || !Number.isFinite(dt) || dt <= 0)
      return { x: 0, y: 0 };
    accumulator += Math.min(dt, 0.25);
    while (accumulator + 1e-9 >= 1 / 60) {
      accumulator -= 1 / 60;
      weave(run, waypoint);
    }
    return waypoint.input ?? { x: 0, y: 0 };
  };
}
