/**
 * Dev-only affordances. Guarded blocks are statically dead in production
 * builds, so the automation seam (window.__greyrot) ships nowhere.
 */
export const DEV_HANDLES = process.env.NODE_ENV === "development";
