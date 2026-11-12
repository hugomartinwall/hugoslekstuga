import { fileURLToPath } from "node:url";
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
  // The app's "@/…" imports. The suites in test/site import the modules
  // they guard (the sprite painter, the share-image code) instead of
  // reading them as text, and those modules reach each other this way.
  resolve: {
    alias: [
      {
        find: /^@\//,
        replacement: fileURLToPath(new URL("./", import.meta.url)),
      },
    ],
  },
  test: {
    include: ["test/**/*.test.ts"],
    // Survival Maxx's geometry sweeps take several seconds each; its campaign
    // suite carries its own four-minute budget.
    testTimeout: 30_000,
  },
});
