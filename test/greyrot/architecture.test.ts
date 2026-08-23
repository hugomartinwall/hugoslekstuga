import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ARRIVAL_CUE_RADIUS,
  ENCOUNTER_FOV_DEG,
  ENCOUNTER_VIEW_HEIGHT,
  ENCOUNTER_VIEW_LOOK_HEIGHT,
  STAGE_VIEW_HEIGHT,
  STAGE_VIEW_LOOK_HEIGHT,
} from "../../lib/greyrot/sim/staging";

/**
 * The architecture rules from CLAUDE.md §4, enforced instead of remembered.
 *
 * game1 kept sim and presentation apart by discipline and it held — but game1
 * was 5,400 lines. This one will be several times that, across many
 * milestones. Determinism is what buys replay, headless balance testing and
 * the marketing capture pipeline, and it is lost the first time somebody
 * reaches for `Math.random()` or a `performance.now()` inside the sim. That is
 * a one-line mistake nobody would catch in review.
 */

const SRC = new URL("../../lib/greyrot", import.meta.url).pathname;

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...filesUnder(p));
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

const simFiles = filesUnder(join(SRC, "sim"));
const read = (p: string): string => readFileSync(p, "utf8");
const rel = (p: string): string => p.slice(SRC.length + 1);

/** Strip comments and strings so prose about a rule doesn't trip the rule. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");
}

describe("simulation isolation", () => {
  it("has simulation files to check", () => {
    // Guards against the whole suite silently passing on an empty glob.
    expect(simFiles.length).toBeGreaterThan(0);
  });

  it("never imports three", () => {
    const bad = simFiles.filter((f) => /from\s+["']three["']/.test(code(read(f))));
    expect(bad.map(rel)).toEqual([]);
  });

  it("never imports the renderer", () => {
    const bad = simFiles.filter((f) => /from\s+["'][^"']*\/render\//.test(code(read(f))));
    expect(bad.map(rel)).toEqual([]);
  });

  it("never touches the DOM or window", () => {
    const bad = simFiles.filter((f) =>
      /\b(window|document|navigator|localStorage)\b/.test(code(read(f))),
    );
    expect(bad.map(rel)).toEqual([]);
  });

  it("never calls Math.random", () => {
    // The single most damaging one-line mistake available in this codebase.
    const bad = simFiles.filter((f) => /Math\s*\.\s*random/.test(code(read(f))));
    expect(bad.map(rel), "use Rng streams from src/sim/rng.ts").toEqual([]);
  });

  it("never reads wall-clock time", () => {
    // Wall-clock in the sim breaks replay just as thoroughly as randomness,
    // and it is harder to spot because it usually looks like a timer.
    const bad = simFiles.filter((f) =>
      /\b(performance\s*\.\s*now|Date\s*\.\s*now|new\s+Date)\b/.test(code(read(f))),
    );
    expect(bad.map(rel), "drive timing from the tick count").toEqual([]);
  });

  it("never uses frame-based deltaTime", () => {
    const bad = simFiles.filter((f) => /\bdelta\s*Time\b|\bdt\b\s*\*/.test(code(read(f))));
    expect(bad.map(rel), "the sim advances in whole fixed ticks").toEqual([]);
  });
});

describe("platform isolation", () => {
  /**
   * Was "keeps window.CrazyGames behind the single wrapper". On the site there
   * is no wrapper and no SDK, so the assertion got STRONGER rather than
   * vacuous: nothing anywhere may mention it. Greyrot is a client-side game on
   * a site whose whole promise is that it phones nobody, and the old wrapper
   * is one `git show` away for anyone who reaches for it by habit.
   */
  it("carries no trace of the CrazyGames SDK", () => {
    const offenders = filesUnder(SRC).filter((f) => /\bCrazyGames\b/.test(code(read(f))));
    expect(offenders.map(rel), "the SDK is gone — do not reintroduce it").toEqual([]);
  });

  /**
   * The seam that replaced it. `getPlatform()` is lazy on purpose: the old
   * module built its singleton at import time, which on a Next route means
   * during SSR of the client component.
   */
  it("keeps localStorage behind the platform seam and the modules that own a key", () => {
    const allowed = [
      join("platform", "local.ts"),
      join("audio", "audio.ts"),
      join("render", "motion.ts"),
    ];
    const offenders = filesUnder(SRC).filter(
      (f) => !allowed.some((a) => f.endsWith(a)) && /\blocalStorage\b/.test(code(read(f))),
    );
    expect(offenders.map(rel), "persist through getPlatform().save/load").toEqual([]);
  });

  it("namespaces every storage key under hugoslekstuga:greyrot:", () => {
    const keys = filesUnder(SRC).flatMap((f) =>
      // Raw source, NOT code(): that helper blanks every string literal, which
      // is exactly what this assertion needs to read.
      [...read(f).matchAll(/"([^"]*\bgreyrot[.:][^"]*)"/g)].map((m) => m[1]!),
    );
    // Guards the guard: game2's keys were `greyrot.meta` and `greyrot.campaign`,
    // so a pattern that cannot see them proves nothing.
    expect(keys.length, "found no storage keys at all — the pattern has rotted").toBeGreaterThan(2);
    const unnamespaced = keys.filter((k) => !k.startsWith("hugoslekstuga:greyrot:"));
    expect(unnamespaced, "house rule: localStorage keys are hugoslekstuga:*").toEqual([]);
  });
});

describe("the walking camera's constants have exactly one source", () => {
  /**
   * `render/camera.ts`'s `FRAMINGS.stage` is the walking frame. Its
   * `distance` already IMPORTS `STAGE_VIEW_DISTANCE` from `sim/staging.ts`,
   * because encounter placement has to know where the lens stands. The
   * camera-sleeve rule for declared props needs the same of the VERTICAL
   * terms, and it cannot import `render/` to get them.
   *
   * So `sim/staging.ts` holds them and this is a CHECKED COPY, not a derived
   * one (`METHOD.md` law 1): the constant lives on the sim side and this test
   * verifies the transcription. Deriving it the other way — reading the
   * literal out of `camera.ts` and calling that the constant — would make the
   * sleeve agree with whatever the camera happens to say and render it
   * incapable of ever going red, which is precisely how a sleeve tuned for
   * height 3.3 kept passing after R4.5 lowered the lens to 2.6 and put it
   * inside two village hut roofs.
   *
   * ── CURRENT STATE ── PASSES. It is a REGRESSION GUARD: it goes red the
   * moment either side moves alone. It is scaffolding with a known end —
   * when `FRAMINGS.stage` imports these two the way it already imports
   * `distance`, the duplication is gone and this test goes with it.
   */
  const cameraSrc = read(join(SRC, "render", "camera.ts"));
  const stageLine = /stage:\s*\{([^}]*)\}/.exec(cameraSrc)?.[1];

  it("finds the stage framing to check — the vacuity guard", () => {
    // Without this, a rename of `stage:` turns every assertion below into a
    // silent pass on `undefined`, which is the failure this file exists for.
    expect(stageLine, "FRAMINGS.stage not found in render/camera.ts").toBeTruthy();
    expect(stageLine).toMatch(/distance:\s*STAGE_VIEW_DISTANCE/);
  });

  it("declares the same lens height sim/staging.ts does", () => {
    const m = /\bheight:\s*([A-Za-z0-9_.]+)/.exec(stageLine ?? "");
    expect(m, `no height in FRAMINGS.stage: ${stageLine}`).toBeTruthy();
    const written = m![1]!;
    // Either form is correct: the import is the end state, the literal is
    // today's, and a WRONG literal is the thing being caught.
    if (written !== "STAGE_VIEW_HEIGHT") {
      expect(Number(written), "FRAMINGS.stage.height has drifted from STAGE_VIEW_HEIGHT").toBe(
        STAGE_VIEW_HEIGHT,
      );
    }
  });

  it("declares the same look height sim/staging.ts does", () => {
    const m = /\blookHeight:\s*([A-Za-z0-9_.]+)/.exec(stageLine ?? "");
    expect(m, `no lookHeight in FRAMINGS.stage: ${stageLine}`).toBeTruthy();
    const written = m![1]!;
    if (written !== "STAGE_VIEW_LOOK_HEIGHT") {
      expect(
        Number(written),
        "FRAMINGS.stage.lookHeight has drifted from STAGE_VIEW_LOOK_HEIGHT",
      ).toBe(STAGE_VIEW_LOOK_HEIGHT);
    }
  });
});

describe("the encounter framing and its cue have exactly one source", () => {
  /**
   * `stage-validator.ts` V12 judges every reinforcement entry point against
   * the ENCOUNTER frame, so the sim now holds that framing's vertical terms
   * and its fov. Same checked-copy discipline as the walking camera above,
   * and the same known end: gfx is landing the import in `camera.ts`, after
   * which the duplication is gone.
   *
   * ⚠️ The cost of NOT holding these is specific and measured: a uniform 7 m
   * arrival ring shipped with six of its eight entries off camera, and the
   * only reason the rule that catches it cannot rot with the dial is this
   * test.
   *
   * ── CURRENT STATE ── PASSES. REGRESSION GUARD, seen red on each constant.
   */
  const cameraSrc = read(join(SRC, "render", "camera.ts"));
  const encounterLine = /encounter:\s*\{([^}]*)\}/.exec(cameraSrc)?.[1];
  const fxSrc = read(join(SRC, "render", "fx", "rt-event-fx.ts"));

  it("finds the encounter framing and the gather ring — the vacuity guard", () => {
    expect(encounterLine, "FRAMINGS.encounter not found in render/camera.ts").toBeTruthy();
    expect(encounterLine).toMatch(/distance:\s*VIEW_DISTANCE/);
    expect(/const RING = [A-Za-z0-9_.]+;/.test(fxSrc), "no arrival gather RING in rt-event-fx.ts").toBe(
      true,
    );
  });

  const agrees = (field: string, line: string | undefined, symbol: string, value: number): void => {
    const m = new RegExp(`\\b${field}:\\s*([A-Za-z0-9_.]+)`).exec(line ?? "");
    expect(m, `no ${field} in ${line}`).toBeTruthy();
    const written = m![1]!;
    if (written !== symbol) expect(Number(written), `${field} has drifted from ${symbol}`).toBe(value);
  };

  it("declares the same encounter height, look height and fov", () => {
    agrees("height", encounterLine, "ENCOUNTER_VIEW_HEIGHT", ENCOUNTER_VIEW_HEIGHT);
    agrees("lookHeight", encounterLine, "ENCOUNTER_VIEW_LOOK_HEIGHT", ENCOUNTER_VIEW_LOOK_HEIGHT);
    agrees("fov", encounterLine, "ENCOUNTER_FOV_DEG", ENCOUNTER_FOV_DEG);
  });

  it("draws the gather at the radius V12 requires to be in frame", () => {
    // The cue IS the subject of V12 — a rule checking a 2.5 m ring while the
    // renderer draws a 4 m one would be inspecting a cue nobody sees.
    const m = /const RING = ([A-Za-z0-9_.]+);/.exec(fxSrc);
    expect(m, "no RING in rt-event-fx.ts").toBeTruthy();
    const written = m![1]!;
    if (written !== "ARRIVAL_CUE_RADIUS") {
      expect(Number(written), "rt-event-fx RING has drifted from ARRIVAL_CUE_RADIUS").toBe(
        ARRIVAL_CUE_RADIUS,
      );
    }
  });
});
