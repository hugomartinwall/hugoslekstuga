/**
 * Knuff's balance table (§13): every player of §13.1 through the real
 * step, and the step-1 table of §13.2 with pass or FAIL beside each bound.
 *
 *   npx tsx scripts/knuff-balance.ts
 *       [--seeds=200]            nights a player (half as many for the Expert and the Corner)
 *       [--first=0]              the number of the first night: another sample, on other seeds
 *       [--player=expert,kiter]  only these players
 *       [--from=23]              start every night at an hour (19 to 05)
 *       [--tune='{"popHotTicks":15}']
 *       [--pace=1|2|3]           the same as --tune='{"pace":3}'
 *       [--charms]               the charm test of §13.3 (there are no charms before step 2)
 *       [--out=<dir> --tag=<name>]  keep every night as JSON, one file a player; a run with the
 *                                same tag, tune and seeds reads a stored player and does not run it
 *                                again, so a table can be run in pieces, side by side, and printed
 *                                from the pieces
 *
 * The table goes to stdout, progress to stderr. It exits 1 if a bound fails.
 *
 * The numbers decide nothing about fun. After the bots, hands.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CAST, STEP1_NIGHT, nightSeed, player, runNight, type Night } from "../lib/knuff/bots/driver";
import { printTable, summarise, type Sum } from "../lib/knuff/bots/table";
import { CLOCK } from "../lib/knuff/content/night";
import { DEFAULT_TUNE, mergeTune } from "../lib/knuff/content/tune";
import type { Tune } from "../lib/knuff/sim/types";

const option = (name: string): string | undefined => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? undefined : hit.slice(name.length + 3);
};

if (process.argv.includes("--charms")) {
  console.log("The charm test (13.3) needs charms. They are built in step 2; nothing was run.");
  process.exit(0);
}

const seeds = Number(option("seeds") ?? 200);
const first = Number(option("first") ?? 0);
const named: Partial<Tune> = { ...(JSON.parse(option("tune") ?? "{}") as Partial<Tune>) };
if (option("pace") !== undefined) named.pace = Number(option("pace"));
const tune = mergeTune(DEFAULT_TUNE, named);
const who = option("player")?.split(",") ?? CAST.map((c) => c.key);
const outDir = option("out");
const tag = option("tag") ?? "table";

// --from=23 is a clock hour; the State counts hours from 19:00.
const fromClock = option("from");
const fromHour = fromClock === undefined ? 0 : (Number(fromClock) - 19 + 24) % 24;
if (!(fromHour >= 0 && fromHour <= 10)) {
  console.error(`--from takes an hour of the night, 19 to 05; got ${fromClock}`);
  process.exit(2);
}
const start = { ...STEP1_NIGHT, hour: fromHour };

/** 200 seeds; 100 for the Expert and the Corner (§13.2). */
const nightsFor = (key: string) => (key === "expert" || key === "corner" ? Math.ceil(seeds / 2) : seeds);

type Stored = { key: string; tune: Tune; first: number; fromHour: number; secs: number; nights: Night[] };

function nightsOf(key: string): { nights: Night[]; secs: number } {
  const count = nightsFor(key);
  const file = outDir ? join(outDir, `${tag}__${key}.json`) : "";
  if (file && existsSync(file)) {
    const st = JSON.parse(readFileSync(file, "utf8")) as Stored;
    if (JSON.stringify(st.tune) === JSON.stringify(tune) && st.first === first && st.fromHour === fromHour && st.nights.length === count) {
      console.error(`${key.padEnd(13)} read from ${file}`);
      return { nights: st.nights, secs: st.secs };
    }
  }
  const who1 = player(key);
  const t0 = Date.now();
  const nights: Night[] = [];
  for (let i = first; i < first + count; i++) nights.push(runNight(nightSeed(i), who1, tune, start));
  const secs = (Date.now() - t0) / 1000;
  console.error(`${key.padEnd(13)} nights ${first}..${first + count - 1} in ${secs.toFixed(0)} s (${(secs / count).toFixed(2)} s a night); alive at the end ${nights.filter((n) => n.ended === "morning").length} of ${count}`);
  if (file) {
    mkdirSync(outDir!, { recursive: true });
    const st: Stored = { key, tune, first, fromHour, secs, nights };
    writeFileSync(file, JSON.stringify(st));
  }
  return { nights, secs };
}

const sums = new Map<string, Sum>();
for (const key of who) {
  const def = player(key);
  const { nights, secs } = nightsOf(key);
  sums.set(key, summarise(key, def.label, nights, tune, secs));
}

const title = `pace ${tune.pace}, popHotTicks ${tune.popHotTicks}; the step-1 night (eleven hours, dust bunnies and tokens only)${fromHour ? `, from ${CLOCK[fromHour]}` : ""}; nights ${first} to ${first + seeds - 1} (half as many for the Expert and the Corner)${Object.keys(named).length ? `; named: ${JSON.stringify(named)}` : ""}`;
const table = printTable(
  title,
  CAST.map((c) => c.key),
  sums,
  tune,
);
console.log(table.lines.join("\n"));
process.exit(table.fails > 0 ? 1 : 0);
