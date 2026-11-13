/**
 * The charm test (§13.3) and the offer checks of step 2 (§14): what the
 * balance script prints about charms.
 *
 * The charm test: for every charm, 120 nights on the same seeds with it and
 * without it, for the Expert and the Ordinary, each started at 23:00 with
 * that one charm and nothing offered. A wall charm goes on the first dark
 * plate in number order that it may use (the two starting plates stay
 * lit, in both arms). Measured on hours survived, score and hearts lost.
 *
 *   Pass: neither hours survived nor score falls below 0.9 times, and
 *   score stays under 2 times.
 *   It must matter: for at least one of the two players, hours survived,
 *   score or hearts lost moves by 10% or more (5% over 480 nights).
 *
 * Hours survived is a mean (it is counted in whole hours, and a median of
 * whole hours cannot move by a tenth); score is a median, as every score
 * in the tables is; hearts lost is a mean a night.
 */
import { CHARMS, CORNER_MATE, DARK, PLATES, START_PLATES, isWallCharm } from "../content/charms";
import { CLOCK, HOURS } from "../content/night";
import type { StartOptions } from "../sim/state";
import { median } from "./table";
import type { Night, OfferSeen } from "./driver";

/** The hour the charm test starts at: 23:00. */
export const CHARM_FROM = 4;
/** Nights a charm, for each player and each arm. */
export const CHARM_NIGHTS = 120;
/** The players of the charm test. */
export const CHARM_PLAYERS = ["expert", "ordinary"] as const;

/** The plates of the charm test's night: the starting two, and a wall charm on the first dark plate it may use. */
export function platesWith(charm: string): string[] {
  const plates = START_PLATES.slice();
  if (!isWallCharm(charm)) return plates;
  for (let p = 0; p < PLATES; p++) {
    if (plates[p] !== DARK) continue;
    const there = CORNER_MATE[p] >= 0 ? plates[CORNER_MATE[p]] : DARK;
    if (charm === "pip" && there === "bumper") continue;
    if (charm === "bumper" && there === "pip") continue;
    plates[p] = charm;
    return plates;
  }
  return plates;
}

/** The night of one arm: "" is the arm without a charm. */
export function charmNight(charm: string): StartOptions {
  return {
    hour: CHARM_FROM,
    kinds: ["bunny", "token"],
    offers: false,
    plates: platesWith(charm),
    charms: charm !== "" && !isWallCharm(charm) ? [charm] : [],
  };
}

/** The arms of the test: none, then each charm. */
export const CHARM_ARMS: readonly string[] = ["", ...CHARMS];

export type CharmSum = {
  player: string;
  charm: string;
  n: number;
  hoursMean: number;
  hoursMedian: number;
  scoreMedian: number;
  scoreMean: number;
  heartsMean: number;
  aliveAtEnd: number;
  /** How often its plate fired a night (wall charms; from the cushion events). */
  firedPerNight: number;
};

/** Hours survived from 23:00: the hour he fell in, counted from it; 7 if he was alive when 05:00 ended. */
export function hoursSurvived(n: Night): number {
  return Math.min(HOURS, n.hour) - CHARM_FROM;
}

export function sumCharm(player: string, charm: string, nights: readonly Night[], fired: number): CharmSum {
  const hours = nights.map(hoursSurvived);
  const scores = nights.map((x) => x.score);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
  return {
    player,
    charm,
    n: nights.length,
    hoursMean: mean(hours),
    hoursMedian: median(hours),
    scoreMedian: median(scores),
    scoreMean: mean(scores),
    heartsMean: mean(nights.map((x) => x.heartsLost)),
    aliveAtEnd: nights.filter((x) => x.hour >= HOURS).length,
    firedPerNight: nights.length ? fired / nights.length : 0,
  };
}

const r2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : "-");
const f0 = (x: number) => (Number.isFinite(x) ? x.toFixed(0) : "-");

/** The charm test as text, with pass or FAIL and "matters" or "DEAD" beside each charm. */
export function printCharmTest(sums: ReadonlyMap<string, CharmSum>, title: string): { lines: string[]; fails: number } {
  const nights = Math.max(0, ...[...sums.values()].map((x) => x.n));
  const lines: string[] = [];
  const say = (s = "") => lines.push(s);
  const get = (player: string, charm: string) => sums.get(`${player}|${charm}`);
  say(`THE CHARM TEST (13.3): ${title}`);
  say(`each arm ${nights} nights on the same seeds (the test asks for ${CHARM_NIGHTS}), started at ${CLOCK[CHARM_FROM]} with nothing offered; the starting plates lit in every arm`);
  say("ratios are with the charm against without it: hours survived (mean), score (median), hearts lost (mean)");
  say("");
  say("charm       | player   | hours survived mean (median) | ratio | score median (mean) | ratio | hearts lost a night | ratio | alive when 05:00 ends | plate fired a night");
  let fails = 0;
  for (const charm of CHARM_ARMS) {
    for (const player of CHARM_PLAYERS) {
      const c = get(player, charm);
      const b = get(player, "");
      if (!c || !b) continue;
      const hr = c.hoursMean / b.hoursMean;
      const sr = c.scoreMedian / b.scoreMedian;
      const lr = c.heartsMean / b.heartsMean;
      say(
        `${(charm || "(none)").padEnd(11)} | ${player.padEnd(8)} | ${r2(c.hoursMean)} (${f0(c.hoursMedian)}) | ${charm ? r2(hr) : "-"} | ${f0(c.scoreMedian)} (${f0(c.scoreMean)}) | ${charm ? r2(sr) : "-"} | ${r2(c.heartsMean)} | ${charm ? r2(lr) : "-"} | ${c.aliveAtEnd} of ${c.n} | ${isWallCharm(charm) ? r2(c.firedPerNight) : "-"}`,
      );
    }
  }
  say("");
  say("verdict | charm | pass: neither hours nor score under 0.9 times, score under 2 times | matters: a move of 10% or more for one of the two players");
  for (const charm of CHARMS) {
    let pass = true;
    let matters = false;
    const why: string[] = [];
    let seen = 0;
    for (const player of CHARM_PLAYERS) {
      const c = get(player, charm);
      const b = get(player, "");
      if (!c || !b) continue;
      seen++;
      const hr = c.hoursMean / b.hoursMean;
      const sr = c.scoreMedian / b.scoreMedian;
      const lr = b.heartsMean > 0 ? c.heartsMean / b.heartsMean : 1;
      const big = Math.max(c.n, b.n) >= 480 ? 0.05 : 0.1;
      if (hr < 0.9) {
        pass = false;
        why.push(`${player} hours ${r2(hr)}`);
      }
      if (sr < 0.9 || sr >= 2) {
        pass = false;
        why.push(`${player} score ${r2(sr)}`);
      }
      const moved = [
        ["hours", hr],
        ["score", sr],
        ["hearts lost", lr],
      ].filter(([, x]) => Math.abs((x as number) - 1) >= big);
      if (moved.length) {
        matters = true;
        why.push(`${player}: ${moved.map(([k, x]) => `${k} ${r2(x as number)}`).join(", ")}`);
      }
    }
    if (seen === 0) {
      say(`not run | ${charm} |`);
      continue;
    }
    const ok = pass && matters;
    if (!ok) fails++;
    say(`${ok ? "pass   " : pass ? "DEAD   " : "FAIL   "} | ${charm.padEnd(10)} | ${pass ? "within" : "OUTSIDE"}; ${matters ? "matters" : "moves nothing by 10%"} | ${why.join("; ") || "-"}`);
  }
  say("");
  say(`${fails} of ${CHARMS.length} charms FAIL or move nothing.`);
  return { lines, fails };
}

// ── The offer checks ──────────────────────────────────────────────────

/** What a batch of nights says about its offers: how they opened, and how they were taken. */
export function printOffers(rows: readonly { label: string; nights: readonly Night[]; takes: boolean }[], title: string): string[] {
  const lines: string[] = [];
  const say = (s = "") => lines.push(s);
  const pct = (x: number, n: number) => (n ? `${((100 * x) / n).toFixed(1)}%` : "-");
  say(`THE OFFERS: ${title}`);
  say("");
  say("player                 | nights | offers | at clear | at tick 1,320 (of them with intruders in the room; intruders there, median) | taken | taken by accident (by a launch aimed at the room) | of the offers in which it released an armed launch, taken by accident | taken wrong (aimed at another) | the named one: offers it was got in / named; launches aimed at it that took it / launches aimed");
  for (const row of rows) {
    const all: OfferSeen[] = row.nights.flatMap((n) => n.offers);
    const atClear = all.filter((o) => o.clear).length;
    const late = all.filter((o) => !o.clear);
    const crowded = late.filter((o) => o.crowd > 0);
    const taken = all.filter((o) => o.taken >= 0).length;
    const accident = all.filter((o) => o.takenBy === "accident").length;
    // An offer nobody launched at while it was armed could not be taken by accident: an empty room, where a player who ignores offers does not launch.
    const exposed = all.filter((o) => o.armedLaunches > 0);
    const exposedAccident = exposed.filter((o) => o.takenBy === "accident").length;
    const wrong = all.filter((o) => o.takenBy === "wrong").length;
    const named = all.filter((o) => o.wanted >= 0);
    const got = named.filter((o) => o.taken === o.wanted).length;
    const tries = named.reduce((a, o) => a + o.tries, 0);
    const hits = named.reduce((a, o) => a + o.hits, 0);
    say(
      `${row.label.padEnd(22)} | ${String(row.nights.length).padStart(4)} | ${String(all.length).padStart(4)} | ${atClear} | ${late.length} (${crowded.length}; ${f0(median(crowded.map((o) => o.crowd)))}) | ${taken} (${pct(taken, all.length)}) | ${accident} (${pct(accident, all.length)} of offers) | ${exposedAccident} of ${exposed.length} (${pct(exposedAccident, exposed.length)}) | ${wrong} | ${row.takes ? `${got} / ${named.length} (${pct(got, named.length)}); ${hits} / ${tries} (${pct(hits, tries)})` : "-"}`,
    );
  }
  say("");
  say("what was taken, by kind of offer and by what was named (players who take one):");
  for (const row of rows) {
    if (!row.takes) continue;
    const named = row.nights.flatMap((n) => n.offers).filter((o) => o.wanted >= 0);
    for (const kind of ["plate", "pickup"]) {
      const these = named.filter((o) => o.wantedKind === kind);
      const got = these.filter((o) => o.taken === o.wanted).length;
      const tries = these.reduce((a, o) => a + o.tries, 0);
      const hits = these.reduce((a, o) => a + o.hits, 0);
      say(`${row.label.padEnd(22)} | named a ${kind.padEnd(6)} | got it in ${got} of ${these.length} offers (${pct(got, these.length)}) | ${hits} of ${tries} launches aimed at it took it (${pct(hits, tries)})`);
    }
    const lost = named.filter((o) => o.taken !== o.wanted);
    const why = { closed: lost.filter((o) => o.taken < 0).length, other: lost.filter((o) => o.taken >= 0).length };
    say(`${row.label.padEnd(22)} | not got: ${why.closed} closed with nothing taken (the night or the hour ended first), ${why.other} took another thing`);
  }
  return lines;
}
