/**
 * The boss check of step 3 (§14): fights started at 06:00, and what the
 * balance script prints about them.
 *
 * Over 200 fights started at 06:00 with three hearts, two wall charms and
 * two body charms at random: the Expert wins at least 3 in 4, in a median
 * of 1,200 to 3,600 ticks (20 to 60 s of simulated time); a player who
 * does not aim wins fewer than 1 in 10; at the end of no tick is he inside
 * the machine's box. These are starting targets (§14).
 *
 * The build of each fight is drawn from its own stream, seeded from the
 * night's seed, never from the State's: the same seed gives every player
 * the same build and the same night.
 */
import { BODY_CHARMS, CORNER_MATE, DARK, PLATES, WALL_CHARMS } from "../content/charms";
import { BOSS_HOUR } from "../content/night";
import type { StartOptions } from "../sim/state";
import type { Tune } from "../sim/types";
import { playerStream, type Night } from "./driver";
import { median } from "./table";

/** Fights a player in the check. */
export const BOSS_FIGHTS = 200;
/** The players of the check: the Expert, the Ordinary beside it, and every player who does not aim. */
export const BOSS_PLAYERS = ["expert", "ordinary", "once", "spam", "flicker", "rhythm", "kiter", "kiter-random"] as const;
/** The players who do not aim: each must win fewer than 1 fight in 10. */
export const BOSS_AIMLESS = ["once", "spam", "flicker", "rhythm", "kiter", "kiter-random"] as const;

/** The bounds of the check. */
export const BOSS_BOUNDS = {
  /** The Expert wins at least this share. */
  expertWins: 0.75,
  /** In a median of this many ticks, from 06:00's first. */
  expertTicksLo: 1200,
  expertTicksHi: 3600,
  /** A player who does not aim wins fewer than this share. */
  aimlessWins: 0.1,
} as const;

/** The build a fight begins with: two wall charms on two dark plates (Pip never beside a Bumper), two body charms. */
export type Build = { plates: string[]; charms: string[] };

/** Draw a fight's build from its own stream. */
export function fightBuild(seed: number): Build {
  const r = playerStream(seed, "boss-build");
  const pick = <T>(list: readonly T[]): T => list[Math.floor(r() * list.length)];
  const walls = WALL_CHARMS.slice();
  const first = walls.splice(Math.floor(r() * walls.length), 1)[0];
  const second = pick(walls);
  const bodies = BODY_CHARMS.slice();
  const b1 = bodies.splice(Math.floor(r() * bodies.length), 1)[0];
  const b2 = pick(bodies);
  const plates: string[] = new Array<string>(PLATES).fill(DARK);
  for (const charm of [first, second]) {
    // A dark plate it may use: Pip never shares a corner with a Bumper plate, nor Bumper with a Pip plate.
    const free: number[] = [];
    for (let p = 0; p < PLATES; p++) {
      if (plates[p] !== DARK) continue;
      const mate = CORNER_MATE[p] >= 0 ? plates[CORNER_MATE[p]] : DARK;
      if ((charm === "pip" && mate === "bumper") || (charm === "bumper" && mate === "pip")) continue;
      free.push(p);
    }
    plates[pick(free)] = charm;
  }
  return { plates, charms: [b1, b2] };
}

/** How a fight begins: at 06:00, with three hearts and the build drawn for its seed. Nothing is offered in the boss's hour. */
export function fightStart(seed: number): StartOptions {
  const b = fightBuild(seed);
  return { hour: BOSS_HOUR, hearts: 3, plates: b.plates, charms: b.charms, offers: false };
}

export type FightSum = {
  player: string;
  n: number;
  wins: number;
  dawns: number;
  /** Fights lost with the last heart. */
  falls: number;
  /** Ticks from 06:00 to the win: median, and the quartiles; NaN when there was no win. */
  winTicksMedian: number;
  winTicksLo: number;
  winTicksHi: number;
  /** Ticks of every fight, won or not: median. */
  ticksMedian: number;
  /** Means a fight. */
  hits: number;
  twos: number;
  throws: number;
  throwsHurt: number;
  /** Hearts to the pad a fight, landed and hot; and in all fights, those on an end shown as the pad for less than a telegraph. */
  padLanded: number;
  padHot: number;
  padUnread: number;
  heartsLost: number;
  launches: number;
  /** Hearts left at a win: mean. */
  heartsAtWin: number;
  scoreMedian: number;
  /** Ticks at whose end he was inside the box, in all fights; the deepest overlap, u. */
  insideTicks: number;
  deepest: number;
};

const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

function quantile(xs: readonly number[], q: number): number {
  if (xs.length === 0) return NaN;
  const a = xs.slice().sort((p, x) => p - x);
  const i = Math.min(a.length - 1, Math.max(0, Math.floor(q * (a.length - 1))));
  return a[i];
}

export function sumFights(player: string, nights: readonly Night[], tune: Tune): FightSum {
  const won = nights.filter((n) => n.fight.ended === "morning");
  const winTicks = won.map((n) => n.fight.ticks);
  return {
    player,
    n: nights.length,
    wins: won.length,
    dawns: nights.filter((n) => n.fight.ended === "dawn").length,
    falls: nights.filter((n) => n.fight.ended === "hearts").length,
    winTicksMedian: median(winTicks),
    winTicksLo: quantile(winTicks, 0.25),
    winTicksHi: quantile(winTicks, 0.75),
    ticksMedian: median(nights.map((n) => n.fight.ticks)),
    hits: mean(nights.map((n) => n.fight.hits)),
    twos: mean(nights.map((n) => n.fight.twos)),
    throws: mean(nights.map((n) => n.fight.throws)),
    throwsHurt: mean(nights.map((n) => n.fight.throwsHurt)),
    padLanded: mean(nights.map((n) => n.fight.padLanded)),
    padHot: mean(nights.map((n) => n.fight.padHot)),
    padUnread: nights.reduce((a, n) => a + n.fight.padUnread, 0),
    heartsLost: mean(nights.map((n) => n.fight.hearts)),
    launches: mean(nights.map((n) => n.fight.launches)),
    heartsAtWin: mean(won.map((n) => (n.fight.bonus - tune.nightBonus) / tune.heartBonus)),
    scoreMedian: median(nights.map((n) => n.score)),
    insideTicks: nights.reduce((a, n) => a + n.fight.insideTicks, 0),
    deepest: Math.max(0, ...nights.map((n) => n.fight.deepest)),
  };
}

const r2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : "-");
const f0 = (x: number) => (Number.isFinite(x) ? x.toFixed(0) : "-");
const pct = (x: number, n: number) => (n ? `${((100 * x) / n).toFixed(1)}%` : "-");

/** The boss check as text, with pass or FAIL beside each bound. */
export function printFights(sums: ReadonlyMap<string, FightSum>, title: string): { lines: string[]; fails: number } {
  const lines: string[] = [];
  const say = (s = "") => lines.push(s);
  say(`THE BOSS CHECK (14, step 3): ${title}`);
  say("each fight begun at 06:00 with three hearts, two wall charms on two plates and two body charms, drawn at random for its seed; nothing offered");
  say("");
  say("player        | fights | won (share) | lights came on | last heart | win in ticks: median (quartiles) | every fight, ticks: median | plug hits a fight (of them two) | throws a fight (of them a heart) | hearts lost a fight | launches a fight | hearts left at a win | score median | ticks ending inside the box; deepest u");
  for (const s of sums.values()) {
    say(
      `${s.player.padEnd(13)} | ${String(s.n).padStart(4)} | ${s.wins} (${pct(s.wins, s.n)}) | ${s.dawns} | ${s.falls} | ${f0(s.winTicksMedian)} (${f0(s.winTicksLo)} to ${f0(s.winTicksHi)}) | ${f0(s.ticksMedian)} | ${r2(s.hits)} (${r2(s.twos)}) | ${r2(s.throws)} (${r2(s.throwsHurt)}) | ${r2(s.heartsLost)} | ${r2(s.launches)} | ${r2(s.heartsAtWin)} | ${f0(s.scoreMedian)} | ${s.insideTicks}; ${s.deepest.toFixed(6)}`,
    );
  }
  say("");
  let fails = 0;
  const verdict = (ok: boolean, text: string, measured: string) => {
    if (!ok) fails++;
    say(`${ok ? "pass" : "FAIL"} | ${text} | ${measured}`);
  };
  const e = sums.get("expert");
  if (e) {
    verdict(e.wins >= BOSS_BOUNDS.expertWins * e.n, "Expert wins at least 3 in 4", `${e.wins} of ${e.n}`);
    verdict(
      e.winTicksMedian >= BOSS_BOUNDS.expertTicksLo && e.winTicksMedian <= BOSS_BOUNDS.expertTicksHi,
      "Expert's median win in 1,200 to 3,600 ticks",
      `${f0(e.winTicksMedian)} ticks (${r2(e.winTicksMedian / 60)} s)`,
    );
  }
  for (const key of BOSS_AIMLESS) {
    const a = sums.get(key);
    if (!a) continue;
    verdict(a.wins < BOSS_BOUNDS.aimlessWins * a.n, `${key} (does not aim) wins fewer than 1 in 10`, `${a.wins} of ${a.n}`);
  }
  const inside = [...sums.values()].reduce((a, s) => a + s.insideTicks, 0);
  const deepest = Math.max(0, ...[...sums.values()].map((s) => s.deepest));
  verdict(inside === 0, "at the end of no tick is he inside the machine's box (every player, every fight)", `${inside} ticks; deepest ${deepest.toExponential(2)} u`);
  say("");
  say(`${fails} bound${fails === 1 ? "" : "s"} FAIL.`);
  say("");
  say("The pad's hearts (printed, not gating): a fight, while he was landed and while he was hot; and in all fights, those on an end drawn as the pad for less than a telegraph (from the polisher's announcement, and from the start of each stall, the pad to come)");
  for (const s of sums.values()) say(`${s.player.padEnd(13)} | landed ${r2(s.padLanded)} | hot ${r2(s.padHot)} | shown under 36 ticks: ${s.padUnread}`);
  return { lines, fails };
}
