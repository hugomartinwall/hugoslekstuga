import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The port's structural rules, enforced instead of remembered. Greyrot's
 * suite is the model; the rules are the ones that matter for this engine.
 *
 * Survival Maxx keeps its simulation in four files that never touch the
 * renderer or the page: `model.ts` (the run), `content.ts` (the tables),
 * `progression.ts` (unlocks) and `review.ts` (the diagnostic pilot the tests
 * and the balance script drive). Determinism there is what makes the
 * campaign suite and `scripts/survival-maxx-balance.ts` repeatable.
 */

const SRC = new URL("../../lib/survival-maxx", import.meta.url).pathname;

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...filesUnder(p));
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

const SIM = ["model.ts", "content.ts", "progression.ts", "review.ts"];
const simFiles = SIM.map((name) => join(SRC, name));
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
  it("has the simulation files it expects", () => {
    for (const f of simFiles) expect(statSync(f).isFile()).toBe(true);
  });

  it("never imports three", () => {
    const bad = simFiles.filter((f) => /from\s+["']three/.test(code(read(f))));
    expect(bad.map(rel)).toEqual([]);
  });

  it("never imports the renderer, the interface or the audio engine", () => {
    const bad = simFiles.filter((f) =>
      /from\s+["']\.\/(scene|meshes|geometry|hero-rigs|equipment-art|weapon-pose|ui|audio|main)["']/.test(
        code(read(f)),
      ),
    );
    expect(bad.map(rel)).toEqual([]);
  });

  it("never touches the DOM or window", () => {
    const bad = simFiles.filter((f) =>
      /\b(window|document|navigator|localStorage)\b/.test(code(read(f))),
    );
    expect(bad.map(rel)).toEqual([]);
  });

  it("never calls Math.random", () => {
    // The run seeds its own generator; a stray Math.random breaks every
    // repeatable campaign in this folder.
    const bad = simFiles.filter((f) => /Math\s*\.\s*random/.test(code(read(f))));
    expect(bad.map(rel), "use the run's seeded random()").toEqual([]);
  });

  it("never reads wall-clock time", () => {
    const bad = simFiles.filter((f) =>
      /\b(performance\s*\.\s*now|Date\s*\.\s*now|new\s+Date)\b/.test(code(read(f))),
    );
    expect(bad.map(rel), "drive timing from step(dt)").toEqual([]);
  });
});

describe("platform isolation", () => {
  it("carries no trace of the CrazyGames SDK", () => {
    const offenders = filesUnder(SRC).filter((f) => /\bCrazyGames\b/.test(code(read(f))));
    expect(offenders.map(rel), "the SDK is gone — do not reintroduce it").toEqual([]);
  });

  it("keeps localStorage behind platform.ts", () => {
    const offenders = filesUnder(SRC).filter(
      (f) => !f.endsWith("platform.ts") && /\blocalStorage\b/.test(code(read(f))),
    );
    expect(offenders.map(rel), "persist through Platform").toEqual([]);
  });

  it("namespaces every storage key under hugoslekstuga:survival-maxx:", () => {
    const keys = filesUnder(SRC).flatMap((f) =>
      // Raw source, NOT code(): that helper blanks every string literal, which
      // is exactly what this assertion needs to read.
      [...read(f).matchAll(/"([^"]*\bsurvival-maxx[.:][^"]*)"/g)].map((m) => m[1]!),
    );
    expect(keys.length, "found no storage keys at all — the pattern has rotted").toBeGreaterThan(0);
    const unnamespaced = keys.filter((k) => !k.startsWith("hugoslekstuga:survival-maxx:"));
    expect(unnamespaced, "house rule: localStorage keys are hugoslekstuga:*").toEqual([]);
  });

  it("does nothing at import time that needs a browser", async () => {
    // `main.ts` used to look up ids and bind window listeners as a side effect
    // of being imported. This suite runs in Node with no DOM, so importing the
    // module is the test: it must load and export the factory, nothing more.
    expect(typeof window).toBe("undefined");
    const mod = await import("../../lib/survival-maxx/main");
    expect(typeof mod.createSurvivalMaxx).toBe("function");
    expect(code(read(join(SRC, "main.ts")))).not.toMatch(/import\s*\.\s*meta/);
  });
});
