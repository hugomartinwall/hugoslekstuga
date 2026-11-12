/**
 * The balance table (§13.2): what a batch of nights adds up to for one
 * player, the bounds the step-1 table sets, and the table as text.
 *
 * The script (scripts/knuff-balance.ts) prints it; the `bots` suite
 * asserts the same bounds on fewer nights, widened as §13.5 says. Both
 * read the one list here, so a bound cannot mean two things.
 *
 * No bound is moved to pass. A row that is outside is printed as FAIL.
 */
import { CLOCK, HOURS } from "../content/night";
import type { Tune } from "../sim/types";
import { realSeconds, type Night } from "./driver";

export function median(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  const a = xs.slice().sort((p, q) => p - q);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function quantile(xs: readonly number[], q: number): number {
  if (xs.length === 0) return NaN;
  const a = xs.slice().sort((p, r) => p - r);
  return a[Math.min(a.length - 1, Math.max(0, Math.round(q * (a.length - 1))))];
}

/** One player's batch of nights, added up. */
export type Sum = {
  key: string;
  label: string;
  n: number;
  /** aliveAt[h]: nights still going when hour h began; aliveAt[11]: alive when 05:00 ended. */
  aliveAt: number[];
  endHourMedian: number;
  endHourP10: number;
  endHourP90: number;
  scoreMedian: number;
  realMedian: number;
  simMedian: number;
  heartsPerNight: number;
  heartsByBunny: number;
  heartsByToken: number;
  hearts: number;
  nightsWithHeart: number;
  /** Nights with a heart lost within 120 ticks of the first launch. */
  earlyHeartNights: number;
  unfair: number;
  /** Nights that reached the end of 05:00: simulated seconds. */
  doneN: number;
  doneSimMin: number;
  doneSimMedian: number;
  doneSimMax: number;
  doneRealMedian: number;
  /** Share of ticks with nothing alive or announced, all nights pooled: with the pause between hours, and with it taken out. */
  emptyShare: number;
  emptyShareNoPause: number;
  longestEmptyMedian: number;
  meanRoom: number;
  maxRoom: number;
  capRefusedPerNight: number;
  capRefused: number;
  capRefusedNights: number;
  announcedPerNight: number;
  extrasPerNight: number;
  earlyPerNight: number;
  near: number;
  nearLanded: number;
  tokenSeen: number;
  tokenAlone: number;
  tokenAloneTicksMedian: number;
  heartsByHour: number[];
  hourLenMedian: number[];
  launchesPerNight: number;
  landedNoPipShare: number;
  /** Seconds the batch took to run. */
  secs: number;
};

export function summarise(key: string, label: string, nights: readonly Night[], tune: Tune, secs = 0): Sum {
  const n = nights.length;
  const aliveAt: number[] = [];
  for (let h = 0; h <= HOURS; h++) aliveAt.push(nights.filter((x) => x.hour >= h).length);
  const done = nights.filter((x) => x.ended === "morning");
  const sim = (x: Night) => x.ticks / 60;
  let hearts = 0;
  let byBunny = 0;
  let byToken = 0;
  let early = 0;
  let unfair = 0;
  let ticks = 0;
  let empty = 0;
  let emptyPause = 0;
  let roomSum = 0;
  let maxRoom = 0;
  let cap = 0;
  let capNights = 0;
  let announced = 0;
  let extras = 0;
  let earlyRows = 0;
  let near = 0;
  let nearLanded = 0;
  let tokenSeen = 0;
  let tokenAlone = 0;
  let launches = 0;
  let landed = 0;
  let landedNoPip = 0;
  const tokenTicks: number[] = [];
  const heartsByHour: number[] = new Array(HOURS).fill(0);
  for (const x of nights) {
    hearts += x.heartsLost;
    unfair += x.unfair;
    let soon = false;
    for (const l of x.losses) {
      if (l.by === "bunny") byBunny++;
      else byToken++;
      if (l.tick <= 120) soon = true;
      if (l.hour < HOURS) heartsByHour[l.hour]++;
    }
    if (soon) early++;
    ticks += x.ticks;
    empty += x.ticksEmpty;
    emptyPause += x.ticksEmptyPause;
    roomSum += x.roomSum;
    if (x.maxRoom > maxRoom) maxRoom = x.maxRoom;
    cap += x.capRefused;
    if (x.capRefused > 0) capNights++;
    announced += x.announced;
    extras += x.extras;
    earlyRows += x.early;
    if (x.near) near++;
    if (x.nearLanded) nearLanded++;
    if (x.tokenHour >= 0) {
      tokenSeen++;
      if (x.tokenAlone) tokenAlone++;
      if (x.tokenAloneTicks >= 0) tokenTicks.push(x.tokenAloneTicks);
    }
    launches += x.launches;
    landed += x.ticksLanded;
    landedNoPip += x.ticksLandedNoPip;
  }
  const hourLenMedian: number[] = [];
  for (let h = 0; h < HOURS; h++) hourLenMedian.push(median(nights.filter((x) => x.hourLen.length > h).map((x) => x.hourLen[h])));
  const doneSim = done.map(sim);
  const div = (a: number, b: number) => (b > 0 ? a / b : 0);
  return {
    key,
    label,
    n,
    aliveAt,
    endHourMedian: median(nights.map((x) => x.hour)),
    endHourP10: quantile(nights.map((x) => x.hour), 0.1),
    endHourP90: quantile(nights.map((x) => x.hour), 0.9),
    scoreMedian: median(nights.map((x) => x.score)),
    realMedian: median(nights.map((x) => realSeconds(x, tune))),
    simMedian: median(nights.map(sim)),
    heartsPerNight: div(hearts, n),
    heartsByBunny: byBunny,
    heartsByToken: byToken,
    hearts,
    nightsWithHeart: nights.filter((x) => x.heartsLost > 0).length,
    earlyHeartNights: early,
    unfair,
    doneN: done.length,
    doneSimMin: doneSim.length ? Math.min(...doneSim) : NaN,
    doneSimMedian: median(doneSim),
    doneSimMax: doneSim.length ? Math.max(...doneSim) : NaN,
    doneRealMedian: median(done.map((x) => realSeconds(x, tune))),
    emptyShare: div(empty, ticks),
    emptyShareNoPause: div(empty - emptyPause, ticks - emptyPause),
    longestEmptyMedian: median(nights.map((x) => x.longestEmpty)),
    meanRoom: div(roomSum, ticks),
    maxRoom,
    capRefusedPerNight: div(cap, n),
    capRefused: cap,
    capRefusedNights: capNights,
    announcedPerNight: div(announced, n),
    extrasPerNight: div(extras, n),
    earlyPerNight: div(earlyRows, n),
    near,
    nearLanded,
    tokenSeen,
    tokenAlone,
    tokenAloneTicksMedian: median(tokenTicks),
    heartsByHour,
    hourLenMedian,
    launchesPerNight: div(launches, n),
    landedNoPipShare: div(landedNoPip, landed),
    secs,
  };
}

// ── The bounds ────────────────────────────────────────────────────────

export type Sums = ReadonlyMap<string, Sum>;

/**
 * How far a bound is loosened. The script: not at all. The smoke check
 * (§13.5): a share of nights by 10 points in 100 (20 for a look-ahead
 * row); a bound of another kind by a tenth of itself (a fifth); a median
 * hour by one hour either way. An invariant, and a bound that says "in
 * any night" or "ever", is never loosened: one case fails.
 */
export type Widen = { share: number; self: number; hour: number };
export const AS_WRITTEN: Widen = { share: 0, self: 0, hour: 0 };
export const SMOKE: Widen = { share: 0.1, self: 0.1, hour: 1 };
export const SMOKE_LOOK_AHEAD: Widen = { share: 0.2, self: 0.2, hour: 1 };

export type Verdict = { ok: boolean; measured: string };

export type Bound = {
  /** The player whose row it is; "every" for the invariants and the length of a night. */
  row: string;
  /** The players whose nights it reads. Empty: whoever is there. */
  needs: readonly string[];
  text: string;
  check(sums: Sums, tune: Tune, w: Widen): Verdict;
};

const END = HOURS;
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const of = (x: number, n: number) => `${pct(n ? x / n : 0)} (${x} of ${n})`;
const f0 = (x: number) => (Number.isFinite(x) ? x.toFixed(0) : "-");
const share = (x: number, n: number) => (n ? x / n : 0);
export const clock = (h: number) => (h >= END ? "alive when 05:00 ends" : CLOCK[Math.max(0, Math.floor(h))]);

function get(sums: Sums, key: string): Sum {
  const s = sums.get(key);
  if (!s) throw new Error(`the bound needs the nights of "${key}"`);
  return s;
}

/** The players who do not aim (§13.2). */
export const AIMLESS = ["once", "spam", "flicker", "rhythm", "kiter"] as const;

/** The step-1 table. */
export const STEP1_BOUNDS: readonly Bound[] = [
  {
    row: "once",
    needs: ["once"],
    text: "Once: not alive at 21:00, in any night",
    check: (m) => {
      const s = get(m, "once");
      return { ok: s.aliveAt[2] === 0, measured: `${s.aliveAt[2]} of ${s.n} alive at 21:00 (at 20:00: ${s.aliveAt[1]})` };
    },
  },
  {
    row: "spam",
    needs: ["spam"],
    text: "Spam: alive at 00:00 in at most 1 night in 10",
    check: (m, _t, w) => {
      const s = get(m, "spam");
      return { ok: share(s.aliveAt[5], s.n) <= 0.1 + w.share, measured: of(s.aliveAt[5], s.n) };
    },
  },
  {
    row: "spam",
    needs: ["spam"],
    text: "Spam: never alive when 05:00 ends",
    check: (m) => {
      const s = get(m, "spam");
      return { ok: s.aliveAt[END] === 0, measured: `${s.aliveAt[END]} of ${s.n}` };
    },
  },
  {
    row: "spam",
    needs: ["spam", "expert"],
    text: "Spam: scores at most a third of the Expert's median",
    check: (m, _t, w) => {
      const s = get(m, "spam");
      const third = get(m, "expert").scoreMedian / 3;
      return { ok: s.scoreMedian <= third * (1 + w.self), measured: `${f0(s.scoreMedian)} against ${f0(third)}` };
    },
  },
  {
    row: "flicker",
    needs: ["flicker"],
    text: "Flicker: alive when 05:00 ends in at most 1 night in 10",
    check: (m, _t, w) => {
      const s = get(m, "flicker");
      return { ok: share(s.aliveAt[END], s.n) <= 0.1 + w.share, measured: `${of(s.aliveAt[END], s.n)}; at 00:00 ${pct(share(s.aliveAt[5], s.n))}` };
    },
  },
  {
    row: "flicker",
    needs: ["flicker", "expert"],
    text: "Flicker: scores at most a third of the Expert's median",
    check: (m, _t, w) => {
      const s = get(m, "flicker");
      const third = get(m, "expert").scoreMedian / 3;
      return { ok: s.scoreMedian <= third * (1 + w.self), measured: `${f0(s.scoreMedian)} against ${f0(third)}` };
    },
  },
  {
    row: "rhythm",
    needs: ["rhythm"],
    text: "Rhythm: alive when 05:00 ends in at most 1 night in 20",
    check: (m, _t, w) => {
      const s = get(m, "rhythm");
      return { ok: share(s.aliveAt[END], s.n) <= 0.05 + w.share, measured: `${of(s.aliveAt[END], s.n)}; at 00:00 ${pct(share(s.aliveAt[5], s.n))}` };
    },
  },
  {
    row: "kiter",
    needs: ["kiter"],
    text: "Kiter: alive when 05:00 ends in at most 1 night in 10",
    check: (m, _t, w) => {
      const s = get(m, "kiter");
      return { ok: share(s.aliveAt[END], s.n) <= 0.1 + w.share, measured: of(s.aliveAt[END], s.n) };
    },
  },
  {
    row: "kiter",
    needs: ["kiter", "ordinary"],
    text: "Kiter: scores at most 0.9 of the Ordinary's median",
    check: (m, _t, w) => {
      const s = get(m, "kiter");
      const o = get(m, "ordinary").scoreMedian;
      return { ok: s.scoreMedian <= 0.9 * o * (1 + w.self), measured: `${f0(s.scoreMedian)} against 0.9 x ${f0(o)} = ${f0(0.9 * o)} (ratio ${(s.scoreMedian / o).toFixed(2)})` };
    },
  },
  {
    row: "corner",
    needs: ["corner", "ordinary"],
    text: "Corner: scores at most 0.9 of the Ordinary's median",
    check: (m, _t, w) => {
      const s = get(m, "corner");
      const o = get(m, "ordinary").scoreMedian;
      return {
        ok: s.scoreMedian <= 0.9 * o * (1 + w.self),
        measured: `${f0(s.scoreMedian)} against ${f0(0.9 * o)} (ratio ${(s.scoreMedian / o).toFixed(2)}); alive when 05:00 ends ${pct(share(s.aliveAt[END], s.n))}, at 00:00 ${pct(share(s.aliveAt[5], s.n))}`,
      };
    },
  },
  {
    row: "straight",
    needs: ["straight", ...AIMLESS],
    text: "Straight: scores more than every player who does not aim",
    check: (m, _t, w) => {
      const s = get(m, "straight");
      const others = AIMLESS.map((k) => get(m, k));
      const best = others.reduce((a, b) => (b.scoreMedian > a.scoreMedian ? b : a));
      return {
        ok: s.scoreMedian > best.scoreMedian * (1 - w.self),
        measured: `${f0(s.scoreMedian)} against the best of them, ${best.label} ${f0(best.scoreMedian)} (${others.map((o) => `${o.label} ${f0(o.scoreMedian)}`).join(", ")})`,
      };
    },
  },
  {
    row: "cautious",
    needs: ["cautious"],
    text: "Cautious: alive at 20:00 in at least 9 nights in 10",
    check: (m, _t, w) => {
      const s = get(m, "cautious");
      return { ok: share(s.aliveAt[1], s.n) >= 0.9 - w.share, measured: of(s.aliveAt[1], s.n) };
    },
  },
  {
    row: "cautious",
    needs: ["cautious"],
    text: "Cautious: lasts a median of at least 45 s of real time",
    check: (m, _t, w) => {
      const s = get(m, "cautious");
      return { ok: s.realMedian >= 45 * (1 - w.self), measured: `${s.realMedian.toFixed(1)} s real (${s.simMedian.toFixed(1)} s simulated)` };
    },
  },
  {
    row: "cautious",
    needs: ["cautious"],
    text: "Cautious: no heart lost within 120 ticks of its first launch, in any night",
    check: (m) => {
      const s = get(m, "cautious");
      return { ok: s.earlyHeartNights === 0, measured: `${s.earlyHeartNights} of ${s.n} nights` };
    },
  },
  {
    row: "cautious",
    needs: ["cautious"],
    text: "Cautious: alive when 05:00 ends in at most 3 nights in 100",
    check: (m, _t, w) => {
      const s = get(m, "cautious");
      return { ok: share(s.aliveAt[END], s.n) <= 0.03 + w.share, measured: of(s.aliveAt[END], s.n) };
    },
  },
  {
    row: "ordinary",
    needs: ["ordinary"],
    text: "Ordinary: alive when 05:00 ends in at least 1 night in 20",
    check: (m, _t, w) => {
      const s = get(m, "ordinary");
      return { ok: share(s.aliveAt[END], s.n) >= 0.05 - w.share, measured: of(s.aliveAt[END], s.n) };
    },
  },
  {
    row: "ordinary",
    needs: ["ordinary"],
    text: "Ordinary: alive when 05:00 ends in at most 1 night in 4",
    check: (m, _t, w) => {
      const s = get(m, "ordinary");
      return { ok: share(s.aliveAt[END], s.n) <= 0.25 + w.share, measured: of(s.aliveAt[END], s.n) };
    },
  },
  {
    row: "ordinary",
    needs: ["ordinary"],
    text: "Ordinary: its median night ends no sooner than 22:00 and no later than 01:00",
    check: (m, _t, w) => {
      const s = get(m, "ordinary");
      return { ok: s.endHourMedian >= 3 - w.hour && s.endHourMedian <= 6 + w.hour, measured: `${clock(s.endHourMedian)} (p10 ${clock(s.endHourP10)}, p90 ${clock(s.endHourP90)})` };
    },
  },
  {
    row: "ordinary",
    needs: ["ordinary"],
    text: "Ordinary: a landed intruder that is not dazed within 120 u of him in the first 600 ticks, in at least 9 nights in 10",
    check: (m, _t, w) => {
      const s = get(m, "ordinary");
      return { ok: share(s.near, s.n) >= 0.9 - w.share, measured: `${of(s.near, s.n)}; while he was landed and could be hurt ${pct(share(s.nearLanded, s.n))}` };
    },
  },
  {
    row: "ordinary",
    needs: ["ordinary"],
    text: "Ordinary: the room empty for at most 15% of the ticks from its first launch to the end of its night",
    check: (m, _t, w) => {
      const s = get(m, "ordinary");
      return { ok: s.emptyShare <= 0.15 * (1 + w.self), measured: `${pct(s.emptyShare)} with the pause between hours, ${pct(s.emptyShareNoPause)} without it; longest empty stretch, median ${f0(s.longestEmptyMedian)} ticks` };
    },
  },
  {
    row: "expert",
    needs: ["expert"],
    text: "Expert: alive when 05:00 ends in at least 4 nights in 10",
    check: (m, _t, w) => {
      const s = get(m, "expert");
      return { ok: share(s.aliveAt[END], s.n) >= 0.4 - w.share, measured: of(s.aliveAt[END], s.n) };
    },
  },
  {
    row: "expert",
    needs: ["expert"],
    text: "Expert: alive when 05:00 ends in at most 85 nights in 100",
    check: (m, _t, w) => {
      const s = get(m, "expert");
      return { ok: share(s.aliveAt[END], s.n) <= 0.85 + w.share, measured: of(s.aliveAt[END], s.n) };
    },
  },
  {
    row: "expert",
    needs: ["expert"],
    text: "Expert: loses a heart in at least 6 nights in 10",
    check: (m, _t, w) => {
      const s = get(m, "expert");
      return { ok: share(s.nightsWithHeart, s.n) >= 0.6 - w.share, measured: `${of(s.nightsWithHeart, s.n)}; ${s.heartsPerNight.toFixed(2)} hearts a night` };
    },
  },
  {
    row: "expert",
    needs: ["expert"],
    text: "Expert: the room empty for at most 25% of its ticks",
    check: (m, _t, w) => {
      const s = get(m, "expert");
      return { ok: s.emptyShare <= 0.25 * (1 + w.self), measured: `${pct(s.emptyShare)} with the pause, ${pct(s.emptyShareNoPause)} without it; longest empty stretch, median ${f0(s.longestEmptyMedian)} ticks` };
    },
  },
  {
    row: "every",
    needs: [],
    text: "Every player: no heart lost to a thing announced for less than 36 ticks, or to a close arrival that was not dazed",
    check: (m) => {
      let cases = 0;
      let hearts = 0;
      for (const s of m.values()) {
        cases += s.unfair;
        hearts += s.hearts;
      }
      return { ok: cases === 0, measured: `${cases} cases in ${hearts} lost hearts` };
    },
  },
  {
    row: "every",
    needs: [],
    text: "Every player: never more than roomCap (24) intruders alive or announced",
    check: (m, tune) => {
      let most = 0;
      let cut = 0;
      let cutNights = 0;
      let nights = 0;
      const by: string[] = [];
      for (const s of m.values()) {
        if (s.maxRoom > most) most = s.maxRoom;
        cut += s.capRefused;
        cutNights += s.capRefusedNights;
        nights += s.n;
        if (s.capRefused > 0) by.push(`${s.label} ${s.capRefused} in ${s.capRefusedNights} of ${s.n} nights`);
      }
      return { ok: most <= tune.roomCap, measured: `most seen: ${most}; the cap refused ${cut} intruders in ${cutNights} of ${nights} nights${by.length ? ` (${by.join("; ")})` : ""}` };
    },
  },
  {
    row: "every",
    needs: [],
    text: "Every player: the first token comes alone, at tick 0 of 20:00, as the only thing that hour has sent",
    check: (m) => {
      let seen = 0;
      let alone = 0;
      for (const s of m.values()) {
        seen += s.tokenSeen;
        alone += s.tokenAlone;
      }
      return { ok: alone === seen, measured: `${alone} of ${seen} nights that reached it` };
    },
  },
  {
    row: "every",
    needs: [],
    text: "Nights that reach the end of 05:00: last at least 3 minutes of simulated time and at most 7",
    check: (m, _t, w) => {
      let ok = true;
      const parts: string[] = [];
      for (const s of m.values()) {
        if (s.doneN === 0) continue;
        if (s.doneSimMin < 180 * (1 - w.self) || s.doneSimMax > 420 * (1 + w.self)) ok = false;
        parts.push(`${s.label} ${f0(s.doneSimMin)}/${f0(s.doneSimMedian)}/${f0(s.doneSimMax)} s (${s.doneN} nights)`);
      }
      return { ok, measured: parts.length ? `shortest/median/longest: ${parts.join("; ")}` : "no night reached the end" };
    },
  },
];

/** The bounds of one row that can be checked with the players at hand. */
export function boundsFor(row: string, sums: Sums): Bound[] {
  return STEP1_BOUNDS.filter((b) => b.row === row && b.needs.every((k) => sums.has(k)));
}

/** The full-night table (§13.2). Its rows wait for charms, the later kinds and the boss: printed, not run, before step 5. */
export const FULL_NIGHT_ROWS: readonly string[] = [
  "Ordinary, with charms: reaches morning in at least 1 night in 10 and at most 1 in 3",
  "Expert, with charms: reaches morning in at least 3 nights in 4; loses a heart in more than half its nights",
  "Every player: the fairness rules, the cap, and every new kind first alone at tick 0 of its hour",
  "Nights that reach morning: last at least 3.5 minutes of simulated time and at most 7",
];

// ── The table as text ─────────────────────────────────────────────────

export type Printed = { lines: string[]; fails: number; checked: number };

/** The step-1 table, the counts of what the pace sent, and every bound with pass or FAIL beside it. */
export function printTable(title: string, order: readonly string[], sums: Sums, tune: Tune): Printed {
  const lines: string[] = [];
  const say = (s = "") => lines.push(s);
  const rows = order.map((k) => sums.get(k)).filter((s): s is Sum => s !== undefined);
  const pc = (x: number, n: number) => (n ? `${Math.round((x / n) * 100)}%` : "-");
  const pad = (s: Sum) => s.label.padEnd(29);

  say(`THE STEP-1 TABLE: ${title}`);
  say(
    `the knobs the simulation read: pace ${tune.pace}; popHotTicks ${tune.popHotTicks}; pipRefillTicks ${tune.pipRefillTicks}; paceRoom ${tune.paceRoom}; paceEvery ${tune.paceEvery}; paceLastCall ${tune.paceLastCall}, at 19:00 ${tune.paceLastCallFirst}; paceTokens ${tune.paceTokens}; dazeTicks ${tune.dazeTicks}; bunnySpeed ${tune.bunnySpeed}; tokenSpeed ${tune.tokenSpeed}; roomCap ${tune.roomCap}; hourPauseTicks ${tune.hourPauseTicks}${tune.pace === 2 || tune.pace === 3 ? "" : " (at this pace the five pace numbers are not used)"}`,
  );
  say("");
  say("player                        | nights | alive at 20:00 | at 00:00 | when 05:00 ends | median night ends (p10..p90) | median real s | median sim s | median score | hearts lost a night (by dust bunny + by token) | nights with a lost heart | room empty: with the pause / without | room: mean, most | launches a night | landed with no pip, share of landed ticks | seconds to run");
  for (const s of rows) {
    say(
      `${pad(s)} | ${String(s.n).padStart(6)} | ${pc(s.aliveAt[1], s.n).padStart(5)} (${s.aliveAt[1]}) | ${pc(s.aliveAt[5], s.n).padStart(4)} | ${pc(s.aliveAt[END], s.n).padStart(4)} (${s.aliveAt[END]}) | ${clock(s.endHourMedian)} (${clock(s.endHourP10)}..${clock(s.endHourP90)}) | ${f0(s.realMedian).padStart(4)} | ${f0(s.simMedian).padStart(4)} | ${f0(s.scoreMedian).padStart(6)} | ${s.heartsPerNight.toFixed(2)} (${s.heartsByBunny} + ${s.heartsByToken}) | ${pc(s.nightsWithHeart, s.n)} | ${pct(s.emptyShare)} / ${pct(s.emptyShareNoPause)} | ${s.meanRoom.toFixed(1)}, ${s.maxRoom} | ${f0(s.launchesPerNight)} | ${pct(s.landedNoPipShare)} | ${f0(s.secs)}`,
    );
  }
  say("");
  say("WHAT THE PACE SENDS (a night; the opening rack is not counted)");
  say("player                        | intruders sent | extra bunches | tabled rows announced before their tick (called early or by the clock) | intruders the cap refused (nights it refused any) | hour lengths in ticks, median over the hours that ended: 19:00 .. 05:00");
  for (const s of rows) {
    say(`${pad(s)} | ${f0(s.announcedPerNight).padStart(4)} | ${s.extrasPerNight.toFixed(1).padStart(5)} | ${s.earlyPerNight.toFixed(1).padStart(5)} | ${s.capRefusedPerNight.toFixed(2)} (${s.capRefusedNights}) | ${s.hourLenMedian.map(f0).join(" ")}`);
  }
  say("");
  say("NIGHTS THAT REACHED THE END OF 05:00 (simulated seconds)");
  say("player                        | nights | shortest | median | longest | median real s");
  for (const s of rows) {
    say(`${pad(s)} | ${String(s.doneN).padStart(4)} of ${s.n} | ${f0(s.doneSimMin)} | ${f0(s.doneSimMedian)} | ${f0(s.doneSimMax)} | ${f0(s.doneRealMedian)}`);
  }
  say("");
  say("THE FIRST 600 TICKS AND THE FAIRNESS RULES");
  say("player                        | a landed intruder that is not dazed within 120 u in the first 600 ticks: at any moment / while he was landed and could be hurt | nights with a heart lost within 120 ticks of the first launch | hearts lost against a fairness rule | most intruders alive or announced | first token: nights it came alone at tick 0 of 20:00 / nights it came at all; ticks it stood alone, median | hearts lost by hour 19:00 .. 05:00");
  for (const s of rows) {
    say(`${pad(s)} | ${pc(s.near, s.n)} / ${pc(s.nearLanded, s.n)} | ${s.earlyHeartNights} | ${s.unfair} | ${s.maxRoom} | ${s.tokenAlone} / ${s.tokenSeen}; ${f0(s.tokenAloneTicksMedian)} | ${s.heartsByHour.join(" ")}`);
  }

  say("");
  say("THE BOUNDS OF THE STEP-1 TABLE (13.2), as written");
  say("verdict | bound | measured");
  let fails = 0;
  let checked = 0;
  for (const b of STEP1_BOUNDS) {
    if (b.needs.length === 0 ? sums.size === 0 : !b.needs.every((k) => sums.has(k))) {
      say(`not run | ${b.text} | needs ${b.needs.filter((k) => !sums.has(k)).join(", ")}`);
      continue;
    }
    const v = b.check(sums, tune, AS_WRITTEN);
    checked++;
    if (!v.ok) fails++;
    say(`${v.ok ? "pass   " : "FAIL   "} | ${b.text} | ${v.measured}`);
  }
  const rk = sums.get("kiter-random");
  if (rk) {
    const o = sums.get("ordinary");
    say(`printed | (no bound) the tie-break studies' kiter, which flings at random | alive when 05:00 ends ${of(rk.aliveAt[END], rk.n)}; score ${f0(rk.scoreMedian)}${o ? ` (${(rk.scoreMedian / o.scoreMedian).toFixed(2)} of the Ordinary's)` : ""}`);
  }
  say("");
  say(`${fails} of ${checked} bounds FAIL${checked < STEP1_BOUNDS.length ? `; ${STEP1_BOUNDS.length - checked} not run` : ""}.`);
  say("");
  say("THE FULL-NIGHT TABLE (13.2): printed, not required before step 5");
  for (const r of FULL_NIGHT_ROWS) say(`not run | ${r} | needs charms, the later kinds and the boss (steps 2 to 5)`);
  return { lines, fails, checked };
}
