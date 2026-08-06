import { defineConfig } from "vitest/config";

/**
 * The site's only test runner, and it exists for exactly one reason:
 * Overrun's sim. The suites in test/ are copied verbatim from the upstream
 * game so a re-sync stays a straight copy — don't hand-edit them to fit,
 * fix the engine instead.
 *
 * Node environment on purpose: every suite is pure (sim, run, nudge, audio
 * event diffing). Nothing here touches a DOM or a canvas.
 */
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
});
