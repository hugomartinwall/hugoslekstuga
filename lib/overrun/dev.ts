/**
 * Site shim for upstream src/dev.ts.
 *
 * Upstream gates its debug/automation handles (`window.__game`, the `?theta`
 * camera pin) on Vite's `import.meta.env`. Next doesn't define that, but
 * `process.env.NODE_ENV` is statically replaced the same way, so the guarded
 * blocks are dead code in production bundles here too.
 */
export const DEV_HANDLES = process.env.NODE_ENV === "development";
