/** Reproducible difficulty probes. These outcomes do not measure enjoyment. */
import {
  CAMPAIGN_WAVES,
  HERO_ORDER,
  MAP_COUNT,
  type HeroId,
} from "../lib/survival-maxx/content";
import { SurvivalRun } from "../lib/survival-maxx/model";
import {
  createReviewPilot,
  purchaseReviewShop,
} from "../lib/survival-maxx/review";
const option = (name: string) =>
  process.argv.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1];
const heroes = option("hero")
  ? (option("hero")!.split(",") as HeroId[])
  : HERO_ORDER;
const seeds = option("seeds")
  ? option("seeds")!.split(",").map(Number)
  : process.argv.includes("--quick")
    ? [1]
    : [1, 17, 73];
const maxWaves = Number(option("waves") ?? CAMPAIGN_WAVES);
const policies = option("policy")
  ? option("policy")!.split(",")
  : process.argv.includes("--all-policies")
    ? ["stationary", "circle", "weave", "camper"]
    : ["weave"];
const maps =
  option("map") === "all"
    ? Array.from({ length: MAP_COUNT }, (_, i) => i + 1)
    : option("map")
      ? option("map")!.split(",").map(Number)
      : [1];
const pressure = Number(option("pressure") ?? 1);
// The camper parks at an arena edge and only sidesteps bullets. It must die.
function camper(run: SurvivalRun) {
  const p = run.player;
  const y = p.y > -14 ? -1 : 0;
  let x = 0,
    dash = false;
  for (const bullet of run.bullets) {
    if (!bullet.enemy) continue;
    const dx = p.x - bullet.x,
      dy = p.y - bullet.y,
      speed = Math.hypot(bullet.vx, bullet.vy) || 1,
      along = (dx * bullet.vx + dy * bullet.vy) / speed;
    if (along < 0 || along > 6) continue;
    const miss = Math.abs(dx * bullet.vy - dy * bullet.vx) / speed;
    if (miss < 1.6) {
      x += Math.sign(dx * bullet.vy - dy * bullet.vx) || 1;
      if (Math.hypot(dx, dy) < 1.4) dash = true;
    }
  }
  return { x: Math.sign(x), y, dash };
}
const rows: Record<string, unknown>[] = [];
for (const map of maps)
for (const hero of heroes)
  for (const seed of seeds)
    for (const policy of policies) {
      const run = new SurvivalRun(hero, seed, map);
      if (pressure !== 1)
        Object.defineProperty(run, "pressure", { value: pressure });
      let allHits = 0;
      let firstLegendaryWave: number | null = null;
      while (
        (run.phase === "ready" || run.phase === "shop") &&
        run.wave < maxWaves
      ) {
        run.startWave();
        const pilot = createReviewPilot();
        const hpAtStart = run.player.hp;
        let hits = 0,
          damageTaken = 0,
          firstHitAt: number | null = null,
          bossHealing = 0,
          peakEnemies = 0,
          peakBullets = 0;
        const earned = run.earnedSalvage;
        for (
          let frame = 0;
          frame < 180 * 60 && (run.phase as string) === "combat";
          frame++
        ) {
          const angle = run.time * 0.5;
          const target = { x: Math.cos(angle) * 9, y: Math.sin(angle) * 9 },
            dx = target.x - run.player.x,
            dy = target.y - run.player.y,
            d = Math.hypot(dx, dy) || 1;
          const input =
            policy === "stationary"
              ? { x: 0, y: 0 }
              : policy === "circle"
                ? { x: dx / d, y: dy / d }
                : policy === "camper"
                  ? camper(run)
                  : pilot(run, 1 / 60);
          run.step(1 / 60, input);
          for (const event of run.drainEvents()) {
            if (event.type === "hurt") {
              hits++;
              damageTaken += event.amount ?? 0;
              firstHitAt ??= run.time;
            }
            if (event.type === "heal" && event.id === run.boss?.id)
              bossHealing += event.amount ?? 0;
          }
          peakEnemies = Math.max(peakEnemies, run.enemies.length);
          peakBullets = Math.max(peakBullets, run.bullets.length);
          if (
            !Number.isFinite(
              run.player.hp + run.salvage + run.player.x + run.player.y,
            )
          )
            throw Error("Non-finite simulation");
        }
        allHits += hits;
        const before = run.salvage,
          phase = run.phase,
          hpAtEnd = run.player.hp;
        if (run.phase === "shop") purchaseReviewShop(run);
        if (
          !firstLegendaryWave &&
          run.equipment.some((item) => item.level === 6)
        )
          firstLegendaryWave = run.wave;
        rows.push({
          map,
          hero,
          seed,
          policy,
          wave: run.wave,
          phase,
          budget: run.waveBudget,
          enemiesLeft: run.remainingEnemies,
          outcome: run.waveOutcome,
          fullClears: run.fullClears,
          hp: +run.player.hp.toFixed(1),
          hpAtStart: +hpAtStart.toFixed(1),
          hpAtEnd: +hpAtEnd.toFixed(1),
          damageTaken: +damageTaken.toFixed(1),
          firstHitAt: firstHitAt === null ? null : +firstHitAt.toFixed(1),
          bossHealing: +bossHealing.toFixed(1),
          seconds: +run.time.toFixed(1),
          hits,
          allHits,
          kills: run.waveKills,
          earned: Math.round(run.earnedSalvage - earned),
          spent: before - run.salvage,
          remaining: run.salvage,
          bosses: run.bossesDefeated,
          firstLegendaryWave,
          highestRank: Math.max(...run.equipment.map((item) => item.level)),
          bagSize: run.bag.length,
          bag: run.bag.map((item) => `${item.kind}:${item.level}`).join(","),
          drones: run.drones.length,
          peakEnemies,
          peakBullets,
          weapons: run.weapons.map((w) => `${w.kind}:${w.level}`).join(","),
          synergies: run.synergies
            .filter((s) => s.tier)
            .map((s) => `${s.id}:${s.count}`)
            .join(","),
        });
      }
    }
if (process.argv.includes("--json")) console.log(JSON.stringify(rows, null, 2));
else {
  console.log("Diagnostic policies, not player testing.");
  for (const map of maps)
  for (const hero of heroes)
    for (const policy of policies) {
      const ends = seeds.map((seed) =>
        rows
          .filter(
            (row) =>
              row.map === map &&
              row.hero === hero &&
              row.seed === seed &&
              row.policy === policy,
          )
          .at(-1)!,
      );
      console.log(
        `map ${String(map).padStart(2, "0")} ${hero.padEnd(8)} ${policy.padEnd(10)} wins ${ends.filter((row) => row.phase === "won").length}/${ends.length} | ${ends.map((row) => `w${row.wave} ${row.phase} ${row.hp}HP ${row.allHits}hits ${row.fullClears}clr`).join(" | ")}`,
      );
    }
  for (const map of maps) {
    const all = rows.filter((row) => row.map === map && row.policy === "weave");
    if (!all.length) continue;
    const chapter = (lo: number, hi: number) => {
      const set = all.filter((row) => (row.wave as number) >= lo && (row.wave as number) <= hi && (row.wave as number) % 3 !== 0);
      return set.length ? `${Math.round((set.filter((row) => row.outcome === "clear").length / set.length) * 100)}%` : "-";
    };
    console.log(`map ${String(map).padStart(2, "0")} full clears: waves 1-12 ${chapter(1, 12)} | 13-24 ${chapter(13, 24)} | 25-29 ${chapter(25, 29)}`);
  }
  if (process.argv.includes("--detail"))
    for (const row of rows) console.log(JSON.stringify(row));
}
