/** Reproducible difficulty probes. These outcomes do not measure enjoyment. */
import {
  CAMPAIGN_WAVES,
  HERO_ORDER,
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
  ? [option("policy")!]
  : process.argv.includes("--all-policies")
    ? ["stationary", "circle", "weave"]
    : ["weave"];
const rows: Record<string, unknown>[] = [];
for (const hero of heroes)
  for (const seed of seeds)
    for (const policy of policies) {
      const run = new SurvivalRun(hero, seed);
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
          frame < 180 * 60 &&
          (run.phase as SurvivalRun["phase"]) === "combat";
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
          hero,
          seed,
          policy,
          wave: run.wave,
          phase,
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
  for (const hero of heroes)
    for (const policy of policies) {
      const ends = seeds.map((seed) =>
        rows
          .filter(
            (row) =>
              row.hero === hero && row.seed === seed && row.policy === policy,
          )
          .at(-1)!,
      );
      console.log(
        `${hero.padEnd(8)} ${policy.padEnd(10)} wins ${ends.filter((row) => row.phase === "won").length}/${ends.length} | ${ends.map((row) => `w${row.wave} ${row.phase} ${row.hp}HP ${row.allHits}hits`).join(" | ")}`,
      );
    }
  if (process.argv.includes("--detail"))
    for (const row of rows) console.log(JSON.stringify(row));
}
