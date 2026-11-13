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
 *       [--plates]               the step-1 table with the two starting plates lit (Bumper on 0, Pip on 4)
 *       [--now]                  the step-1 table on the night as it now stands: the step-1 night with
 *                                every kind built so far but the polisher switched on in its rows (gum
 *                                and batteries since step 4), plates dark, nothing offered; it still ends
 *                                when 05:00 ends, where the table counts to
 *       [--charms]               the charm test of §13.3: 120 nights a charm (--seeds), from 23:00,
 *                                for the Expert and the Ordinary (--player=expert or ordinary);
 *                                --arms=bell,coin runs those charms only, beside the arm without one
 *       [--boss]                 the boss check of step 3 (§14): fights begun at 06:00 with three hearts,
 *                                two wall charms and two body charms at random, 200 a player (--seeds),
 *                                for the Expert, the Ordinary and the players who do not aim (--player)
 *       [--offers]               the offer checks of step 2 (§14): offers made, how they opened,
 *                                taken by accident by a player who ignores them, and the named one
 *                                got by a player who takes one; on the night as it stands
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
import { BOSS_FIGHTS, BOSS_PLAYERS, fightStart, printFights, sumFights, type FightSum } from "../lib/knuff/bots/boss";
import { CHARM_ARMS, CHARM_NIGHTS, CHARM_PLAYERS, charmNight, printCharmTest, printOffers, sumCharm, type CharmSum } from "../lib/knuff/bots/charms";
import { CAST, STEP1_NIGHT, TAKERS, nightSeed, player, runNight, type Night } from "../lib/knuff/bots/driver";
import { printTable, summarise, type Sum } from "../lib/knuff/bots/table";
import { START_PLATES } from "../lib/knuff/content/charms";
import { BUILT } from "../lib/knuff/content/kinds";
import { CLOCK } from "../lib/knuff/content/night";
import { DEFAULT_TUNE, mergeTune } from "../lib/knuff/content/tune";
import type { StartOptions } from "../lib/knuff/sim/state";
import type { SimEvent, Tune } from "../lib/knuff/sim/types";

const option = (name: string): string | undefined => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? undefined : hit.slice(name.length + 3);
};

const seeds = Number(option("seeds") ?? 200);
const first = Number(option("first") ?? 0);
const named: Partial<Tune> = { ...(JSON.parse(option("tune") ?? "{}") as Partial<Tune>) };
if (option("pace") !== undefined) named.pace = Number(option("pace"));
const tune = mergeTune(DEFAULT_TUNE, named);
const asked = option("player")?.split(",");
const who = asked ?? CAST.map((c) => c.key);
const outDir = option("out");
const tag = option("tag") ?? "table";
const lit = process.argv.includes("--plates");
const now = process.argv.includes("--now");

// --from=23 is a clock hour; the State counts hours from 19:00.
const fromClock = option("from");
const fromHour = fromClock === undefined ? 0 : (Number(fromClock) - 19 + 24) % 24;
if (!(fromHour >= 0 && fromHour <= 10)) {
  console.error(`--from takes an hour of the night, 19 to 05; got ${fromClock}`);
  process.exit(2);
}
/** The step-1 night; with --plates, the two starting plates lit on it; with --now, the kinds built since in its rows. */
const nowKinds = BUILT.filter((k) => k !== "polisher");
const start: StartOptions = { ...STEP1_NIGHT, hour: fromHour, ...(lit ? { plates: START_PLATES } : {}), ...(now ? { kinds: nowKinds } : {}) };

/** 200 seeds; 100 for the Expert and the Corner (§13.2). */
const nightsFor = (key: string) => (key === "expert" || key === "corner" || key === "expert-takes" ? Math.ceil(seeds / 2) : seeds);

type Stored = { key: string; tune: Tune; first: number; fromHour: number; night: string; secs: number; fired: number; nights: Night[] };

/**
 * One player's nights on one night's start, read from `--out` if a run with
 * the same tag, tune, seeds and start is stored there. `fired` counts the
 * cushion events on which `charm` fired (the charm test's plates).
 */
function nightsOf(
  key: string,
  count: number,
  on: StartOptions | ((seed: number) => StartOptions),
  file: string,
  charm = "",
): { nights: Night[]; secs: number; fired: number } {
  // A start made afresh for each seed (the boss check's builds) is stored by its first night's.
  const startFor = typeof on === "function" ? on : () => on;
  const night = JSON.stringify(typeof on === "function" ? { perSeed: on(nightSeed(first)) } : on);
  if (file && existsSync(file)) {
    const st = JSON.parse(readFileSync(file, "utf8")) as Stored;
    if (JSON.stringify(st.tune) === JSON.stringify(tune) && st.first === first && st.night === night && st.nights.length === count) {
      console.error(`${key.padEnd(13)} read from ${file}`);
      return { nights: st.nights, secs: st.secs, fired: st.fired ?? 0 };
    }
  }
  const who1 = player(key);
  const t0 = Date.now();
  const nights: Night[] = [];
  let fired = 0;
  const watch = charm === "" ? undefined : (events: readonly SimEvent[]) => {
    for (const e of events) if (e.type === "cushion" && e.charm === charm) fired++;
  };
  for (let i = first; i < first + count; i++) nights.push(runNight(nightSeed(i), who1, tune, startFor(nightSeed(i)), watch));
  const secs = (Date.now() - t0) / 1000;
  console.error(`${`${key}${charm ? ` + ${charm}` : ""}`.padEnd(24)} nights ${first}..${first + count - 1} in ${secs.toFixed(0)} s (${(secs / count).toFixed(2)} s a night); alive at the end ${nights.filter((n) => n.ended === "morning").length} of ${count}`);
  if (file) {
    mkdirSync(outDir!, { recursive: true });
    const st: Stored = { key, tune, first, fromHour, night, secs, fired, nights };
    writeFileSync(file, JSON.stringify(st));
  }
  return { nights, secs, fired };
}

const fileFor = (name: string) => (outDir ? join(outDir, `${tag}__${name}.json`) : "");

if (process.argv.includes("--charms")) {
  // The charm test: every arm for each player asked for (both by default), on the same seeds.
  const count = option("seeds") === undefined ? CHARM_NIGHTS : seeds;
  const players = (asked ?? [...CHARM_PLAYERS]).filter((k): k is (typeof CHARM_PLAYERS)[number] => (CHARM_PLAYERS as readonly string[]).includes(k));
  // --arms=bell,coin: those charms only (and the arm without one), for a longer run of the ones that sit on a line.
  const only = option("arms")?.split(",");
  const arms = CHARM_ARMS.filter((c) => c === "" || !only || only.includes(c));
  const sums = new Map<string, CharmSum>();
  for (const key of players) {
    for (const charm of arms) {
      const { nights, fired } = nightsOf(key, count, charmNight(charm), fileFor(`${key}__${charm || "none"}`), charm);
      sums.set(`${key}|${charm}`, sumCharm(key, charm, nights, fired));
    }
  }
  const t = printCharmTest(sums, `pace ${tune.pace}, popHotTicks ${tune.popHotTicks}; nights ${first} to ${first + count - 1}${Object.keys(named).length ? `; named: ${JSON.stringify(named)}` : ""}`);
  console.log(t.lines.join("\n"));
  process.exit(t.fails > 0 ? 1 : 0);
}

if (process.argv.includes("--boss")) {
  // The boss check: every player asked for on the same fights, each begun at 06:00 with its seed's build.
  const count = option("seeds") === undefined ? BOSS_FIGHTS : seeds;
  const keys = asked ?? [...BOSS_PLAYERS];
  const sums = new Map<string, FightSum>();
  for (const key of keys) sums.set(key, sumFights(key, nightsOf(key, count, fightStart, fileFor(`boss__${key}`)).nights, tune));
  const t = printFights(sums, `pace ${tune.pace}, popHotTicks ${tune.popHotTicks}; fights ${first} to ${first + count - 1}${Object.keys(named).length ? `; named: ${JSON.stringify(named)}` : ""}`);
  console.log(t.lines.join("\n"));
  process.exit(t.fails > 0 ? 1 : 0);
}

if (process.argv.includes("--offers")) {
  // The night as it stands: the starting plates lit, offers made. Players who ignore them, and players who take one.
  const keys = asked ?? ["ordinary", "expert", "ordinary-takes", "expert-takes"];
  const night: StartOptions = { hour: fromHour };
  const rows = keys.map((key) => ({
    label: player(key).label.replace(", no charms", ", ignores offers"),
    nights: nightsOf(key, nightsFor(key), night, fileFor(`offers__${key}`)).nights,
    takes: TAKERS.some((t) => t.key === key),
  }));
  const lines = printOffers(rows, `pace ${tune.pace}, popHotTicks ${tune.popHotTicks}; the night as it stands at step 2 (dust bunnies and tokens, the two starting plates lit, offers made)${fromHour ? `, from ${CLOCK[fromHour]}` : ""}; nights ${first} on (half as many for the Expert)`);
  console.log(lines.join("\n"));
  process.exit(0);
}

const sums = new Map<string, Sum>();
for (const key of who) {
  const def = player(key);
  const { nights, secs } = nightsOf(key, nightsFor(key), start, fileFor(key));
  sums.set(key, summarise(key, def.label, nights, tune, secs));
}

const title = `pace ${tune.pace}, popHotTicks ${tune.popHotTicks}; ${now ? `the NIGHT AS IT NOW STANDS (eleven hours; in its rows: ${nowKinds.join(", ")}; no 06:00` : "the step-1 night (eleven hours, dust bunnies and tokens only"}${lit ? "; the two starting plates LIT: Bumper on plate 0, Pip on plate 4" : ", all plates dark"}, nothing offered)${fromHour ? `, from ${CLOCK[fromHour]}` : ""}; nights ${first} to ${first + seeds - 1} (half as many for the Expert and the Corner)${Object.keys(named).length ? `; named: ${JSON.stringify(named)}` : ""}`;
const table = printTable(
  title,
  CAST.map((c) => c.key),
  sums,
  tune,
);
console.log(table.lines.join("\n"));
process.exit(table.fails > 0 ? 1 : 0);
