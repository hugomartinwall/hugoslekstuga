/**
 * Reduced-motion preference, cached, with a player override.
 * Overrun's module with Adventure's storage key — see that file's
 * comments for the history (the matchMedia-per-frame bug and the
 * pulse() period-units incident both live there).
 *
 * Three states rather than a boolean: the OS setting is a default, not a
 * verdict. The override wins in *both* directions. Reduced motion changes
 * presentation only — sim timings never change, so the game stays fair.
 *
 * Imports nothing, so anything in the render layer can depend on it.
 */

export type MotionPref = "auto" | "on" | "off";

const PREF_KEY = "hugoslekstuga:adventure:motion";

let osReduced = false;
let pref: MotionPref = "auto";
let effective = false;
const listeners: ((reduced: boolean) => void)[] = [];

/** Pure, and exported for tests: the whole policy in one expression. */
export function effectiveReduced(p: MotionPref, os: boolean): boolean {
  return p === "auto" ? os : p === "on";
}

function recompute(): void {
  const next = effectiveReduced(pref, osReduced);
  if (next === effective) return;
  effective = next;
  for (const fn of listeners) fn(next);
}

// Gated on `window`, not just wrapped in try/catch: node defines a localStorage
// global now, and merely touching it makes the test runner emit a warning.
if (typeof window !== "undefined") {
  try {
    const raw = window.localStorage.getItem(PREF_KEY);
    if (raw === "auto" || raw === "on" || raw === "off") pref = raw;
  } catch {
    /* sandboxed iframe without storage access — stay on "auto" */
  }
}

if (typeof matchMedia === "function") {
  const mq = matchMedia("(prefers-reduced-motion: reduce)");
  osReduced = mq.matches;
  mq.addEventListener?.("change", (e) => {
    osReduced = e.matches;
    recompute();
  });
}
effective = effectiveReduced(pref, osReduced);

/** Cached — never calls matchMedia. Safe to call several times per frame. */
export function reducedMotion(): boolean {
  return effective;
}

export function motionPref(): MotionPref {
  return pref;
}

export function setMotionPref(p: MotionPref): void {
  pref = p;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(PREF_KEY, p);
    } catch {
      /* fine — the preference just won't survive a reload */
    }
  }
  recompute();
}

/** Cycles auto → off → on → auto. "off" means full motion. */
export function nextMotionPref(p: MotionPref): MotionPref {
  return p === "auto" ? "off" : p === "off" ? "on" : "auto";
}

export function onMotionChange(fn: (reduced: boolean) => void): void {
  listeners.push(fn);
}

/**
 * A sine pulse that flattens to 0 when motion is reduced. `periodMs` is a
 * PERIOD — the wall-clock time for one full cycle, NOT a `sin(now / n)`
 * divisor. When converting such an expression, multiply by 2π.
 */
export function pulse(now: number, periodMs: number): number {
  return effective ? 0 : Math.sin((now / periodMs) * Math.PI * 2);
}
