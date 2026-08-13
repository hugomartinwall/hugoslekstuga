import { describe, expect, it } from "vitest";
import {
  CREDITS_FOOTER,
  DEATH_LINES,
  ENDING_CARD,
  MERCHANT,
  OPENING_CARD,
  WORLD_SCRIPT,
} from "../../lib/adventure/content/script";
import { WORLDS } from "../../lib/adventure/content/worlds";

/** Voice guardrails: no holes, no walls of text, no shouting in body copy. */

describe("script", () => {
  it("every world has all four lines, none over 90 chars", () => {
    for (const w of WORLDS) {
      const s = WORLD_SCRIPT[w.id];
      expect(s, `world ${w.id} script`).toBeTruthy();
      for (const line of [s.intro, s.bossLine, s.shopLine, s.clearLine]) {
        expect(line.length, `world ${w.id}: "${line}"`).toBeGreaterThan(0);
        expect(line.length, `world ${w.id}: "${line}"`).toBeLessThanOrEqual(90);
      }
    }
  });

  it("body copy stays lowercase-comfortable (no all-caps lines)", () => {
    const lines = [
      ...Object.values(WORLD_SCRIPT).flatMap((s) => [s.intro, s.bossLine, s.shopLine, s.clearLine]),
      ...OPENING_CARD,
      ...ENDING_CARD,
      ...DEATH_LINES,
      ...CREDITS_FOOTER,
      ...Object.values(MERCHANT),
    ];
    for (const line of lines) {
      const letters = line.replace(/[^a-zA-Z]/g, "");
      const uppers = line.replace(/[^A-Z]/g, "");
      // Allow shouted words (EXIT, ADVENTURE) but not shouted lines.
      expect(uppers.length, `"${line}"`).toBeLessThan(letters.length * 0.6);
    }
  });

  it("the fixed cards exist", () => {
    expect(OPENING_CARD.length).toBe(2);
    expect(ENDING_CARD.length).toBe(3);
    expect(CREDITS_FOOTER.at(-1)).toContain("potentially useful");
  });
});
